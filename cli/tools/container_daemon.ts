// Deno Container Daemon
// Hosts all container isolates in a single process.
// CLI clients connect via Unix domain socket to create/eval/kill containers.

import { openPty, setWinSize, closeFd, readFd, writeFd, setNonBlocking } from "./container_pty.ts";

// Use the OS temp dir to match the Rust client's std::env::temp_dir()
function getTempDir(): string {
  // On macOS, Deno.env.get("TMPDIR") returns /var/folders/... which matches
  // Rust's std::env::temp_dir(). Using "/tmp" would mismatch.
  const envTmp = Deno.env.get("TMPDIR") || Deno.env.get("TMP") ||
    Deno.env.get("TEMP");
  if (envTmp) {
    // Remove trailing slash
    return envTmp.replace(/\/+$/, "");
  }
  return "/tmp";
}

const SOCKET_PATH = (Deno.env.get("DENO_CONTAINER_SOCK") ||
  `${getTempDir()}/deno-container-daemon.sock`);

// Clean up stale socket
try {
  await Deno.remove(SOCKET_PATH);
} catch {
  // doesn't exist, fine
}

// Container registry: id -> { container, entry, cwd, createdAt, type, cron?, action? }
const containers = new Map();
let nextId = 1;

// --- Cron schedule parser ---
// Supports: @yearly, @monthly, @weekly, @daily, @hourly, @every_Ns/Nm/Nh,
// and standard 5-field cron expressions (minute hour dom month dow)

const CRON_ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.push(i);
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      for (let i = a; i <= b; i += step) values.push(i);
    } else {
      values.push(Number(range));
    }
  }
  return values;
}

interface CronSchedule {
  type: "cron";
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

interface IntervalSchedule {
  type: "interval";
  intervalMs: number;
}

type Schedule = CronSchedule | IntervalSchedule;

function parseSchedule(expr: string): Schedule {
  // Handle @every_Xs, @every_Xm, @every_Xh
  const everyMatch = expr.match(/^@every[_\s]?(\d+)(s|m|h)$/i);
  if (everyMatch) {
    const val = Number(everyMatch[1]);
    const unit = everyMatch[2].toLowerCase();
    const ms = unit === "s" ? val * 1000 : unit === "m" ? val * 60000 : val * 3600000;
    return { type: "interval", intervalMs: ms };
  }

  const resolved = CRON_ALIASES[expr.toLowerCase()] || expr;
  const parts = resolved.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`);

  return {
    type: "cron",
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minutes.includes(date.getMinutes()) &&
    schedule.hours.includes(date.getHours()) &&
    schedule.daysOfMonth.includes(date.getDate()) &&
    schedule.months.includes(date.getMonth() + 1) &&
    schedule.daysOfWeek.includes(date.getDay())
  );
}

async function getProcessMemory(pid: number): Promise<number> {
  // Get RSS in bytes for a process via `ps`
  const cmd = new Deno.Command("ps", {
    args: ["-o", "rss=", "-p", String(pid)],
    stdout: "piped",
    stderr: "null",
  });
  const output = await cmd.output();
  const rss = parseInt(new TextDecoder().decode(output.stdout).trim(), 10);
  // ps reports RSS in KB
  return isNaN(rss) ? 0 : rss * 1024;
}

async function collectLogs(record: any) {
  if (!record.container || record.container.closed) return;
  try {
    const resp = await record.container.logs({ from: record.logNextFrom });
    if (resp && typeof resp === "string") {
      const parsed = JSON.parse(resp);
      if (parsed.logs && parsed.logs.length > 0) {
        for (const l of parsed.logs) {
          record.logs.push(l);
          // Cap at 10000 lines
          if (record.logs.length > 10000) record.logs.shift();
        }
        record.logNextFrom = parsed.nextFrom;
      }
    }
  } catch { /* container may be busy or closed */ }
}

async function executeCronAction(record: any) {
  if (!record.action) return;
  record.runCount = (record.runCount || 0) + 1;
  record.lastRun = Date.now();

  try {
    if (record.action.kind === "eval") {
      await record.container.eval(record.action.code);
    } else if (record.action.kind === "execFile") {
      await record.container.execFile(record.action.path);
    }
  } catch (e) {
    record.lastError = e.message;
  }
  collectLogs(record);
}

// Cron scheduler — checks every second
setInterval(() => {
  const now = new Date();
  // Only fire at the start of each minute (second 0)
  if (now.getSeconds() !== 0) return;

  for (const [_id, record] of containers) {
    if (record.containerType !== "cron" || !record.schedule) continue;
    if (record.container.closed) continue;

    if (record.schedule.type === "cron" && cronMatches(record.schedule, now)) {
      executeCronAction(record);
    }
  }
}, 1000);

// Interval scheduler — for @every_Xs/Xm/Xh
function startIntervalScheduler(record: any) {
  if (record.schedule?.type !== "interval") return;
  // Run immediately on creation, then on interval
  executeCronAction(record);
  record.intervalHandle = setInterval(() => {
    if (record.container.closed) {
      clearInterval(record.intervalHandle);
      return;
    }
    executeCronAction(record);
  }, record.schedule.intervalMs);
}

function writeResponse(conn, response) {
  const msg = JSON.stringify(response) + "\n";
  const encoder = new TextEncoder();
  try {
    conn.write(encoder.encode(msg));
  } catch {
    // connection closed
  }
}

// Returns "exec" if the command took ownership of the connection (exec mode)
async function handleCommand(cmd, conn): Promise<string | void> {
  switch (cmd.type) {
    case "create": {
      const id = nextId++;
      const c = Deno.container({
        name: cmd.name || `container-${id}`,
        resources: cmd.resources || {},
        nest: cmd.nest !== false,
      });
      const isCron = !!cmd.cron;
      const record: any = {
        container: c,
        entry: cmd.entry || "(eval)",
        cwd: cmd.cwd || "",
        createdAt: Date.now(),
        containerType: isCron ? "cron" : "run",
        action: cmd.action || null,
        runCount: 0,
        lastRun: null,
        lastError: null,
        logs: [],       // accumulated log lines
        logNextFrom: 0, // next offset to fetch from container
      };

      if (isCron) {
        try {
          record.schedule = parseSchedule(cmd.cron);
          record.cronExpr = cmd.cron;
        } catch (e) {
          c.close();
          writeResponse(conn, { ok: false, error: `Invalid cron: ${e.message}` });
          return;
        }
      }

      containers.set(id, record);

      // Start interval scheduler if applicable
      if (isCron && record.schedule?.type === "interval") {
        startIntervalScheduler(record);
      }

      writeResponse(conn, { ok: true, id });
      return;
    }

    case "eval": {
      const record = containers.get(cmd.id);
      if (!record) {
        writeResponse(conn, { ok: false, error: `Container ${cmd.id} not found` });
        return;
      }
      try {
        const result = await record.container.eval(cmd.code);
        writeResponse(conn, { ok: true, value: result });
      } catch (e) {
        writeResponse(conn, { ok: false, error: e.message });
      }
      // Collect logs after eval
      collectLogs(record);
      return;
    }

    case "evalAsync": {
      const record = containers.get(cmd.id);
      if (!record) {
        writeResponse(conn, { ok: false, error: `Container ${cmd.id} not found` });
        return;
      }
      try {
        const result = await record.container.evalAsync(cmd.code);
        writeResponse(conn, { ok: true, value: result });
      } catch (e) {
        writeResponse(conn, { ok: false, error: e.message });
      }
      collectLogs(record);
      return;
    }

    case "execFile": {
      const record = containers.get(cmd.id);
      if (!record) {
        writeResponse(conn, { ok: false, error: `Container ${cmd.id} not found` });
        return;
      }
      try {
        const result = await record.container.execFile(cmd.path);
        writeResponse(conn, { ok: true, value: result });
      } catch (e) {
        writeResponse(conn, { ok: false, error: e.message });
      }
      collectLogs(record);
      return;
    }

    case "logs": {
      const record = containers.get(cmd.id);
      if (!record) {
        writeResponse(conn, { ok: false, error: `Container ${cmd.id} not found` });
        return;
      }
      // Fetch latest logs from container first
      await collectLogs(record);
      const from = cmd.from || 0;
      const logs = record.logs.slice(from);
      writeResponse(conn, { ok: true, logs, total: record.logs.length });
      return;
    }

    case "list": {
      const list = [];
      const memoryPromises = [];

      for (const [id, record] of containers) {
        const c = record.container;

        // For JS containers, check if closed
        if (c && c.closed) {
          if (record.intervalHandle) clearInterval(record.intervalHandle);
          containers.delete(id);
          continue;
        }

        const uptimeMs = Date.now() - record.createdAt;
        const entry: any = {
          id,
          name: c ? c.name : record.entry,
          entry: record.entry,
          cwd: record.cwd,
          containerType: record.containerType || "run",
          uptimeMs,
          requestCount: c ? c.stats().requestCount : record.runCount || 0,
          errorCount: c ? c.stats().errorCount : 0,
        };

        if (c) {
          const stats = c.stats();
          entry.cpuUsage = stats.cpuUsage;
        }

        if (record.containerType === "cron") {
          entry.cronExpr = record.cronExpr;
          entry.runCount = record.runCount || 0;
          entry.lastRun = record.lastRun;
          entry.lastError = record.lastError;
        }
        list.push(entry);

        // Query memory usage
        if (c) {
          // JS container: query V8 heap via message
          memoryPromises.push(
            c.memoryUsage()
              .then((mem: any) => { entry.memory = mem; })
              .catch(() => { /* container busy or closed */ })
          );
        } else if (record.process) {
          // exec container: get RSS from child process
          memoryPromises.push(
            getProcessMemory(record.process.pid)
              .then((rss) => {
                if (rss > 0) entry.memory = { rss, heapUsed: rss };
              })
              .catch(() => { /* */ })
          );
        }
      }

      // Wait for all memory queries (with a timeout)
      if (memoryPromises.length > 0) {
        await Promise.race([
          Promise.allSettled(memoryPromises),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      }

      writeResponse(conn, { ok: true, containers: list });
      return;
    }

    case "kill": {
      const record = containers.get(cmd.id);
      if (!record) {
        writeResponse(conn, { ok: false, error: `Container ${cmd.id} not found` });
        return;
      }
      if (record.intervalHandle) clearInterval(record.intervalHandle);
      if (record.container) record.container.close();
      if (record.process) record.process.kill("SIGTERM");
      containers.delete(cmd.id);
      writeResponse(conn, { ok: true });
      return;
    }

    case "close": {
      const record = containers.get(cmd.id);
      if (record) {
        if (record.intervalHandle) clearInterval(record.intervalHandle);
        if (record.container) record.container.close();
        if (record.process) record.process.kill("SIGTERM");
          containers.delete(cmd.id);
      }
      writeResponse(conn, { ok: true });
      return;
    }

    case "exec": {
      // Run a JS/TS/npm specifier as an in-process container (V8 isolate thread)
      // with a real PTY for terminal support (isatty=true, colors, raw input).
      //
      // Architecture:
      // 1. Allocate PTY pair via FFI (posix_openpt)
      // 2. Create a Deno.container() with ptyPath pointing to the PTY slave
      //    → worker's stdin/stdout/stderr are the PTY slave (real terminal)
      // 3. Import the specifier inside the container (runs as a module)
      // 4. Proxy PTY master I/O ↔ Unix socket ↔ CLI client's terminal
      //
      // The program runs as a thread in the daemon process, sharing V8/npm cache.

      const rows = cmd.rows || 24;
      const cols = cmd.cols || 80;
      const args: string[] = cmd.args || [];
      const cwd = cmd.cwd || Deno.cwd();

      const specifier = args[0];
      if (!specifier) {
        writeResponse(conn, { ok: false, error: "No specifier provided" });
        return;
      }

      const isNpm = specifier.startsWith("npm:");
      const isUrl = specifier.startsWith("file://") || specifier.startsWith("http://") || specifier.startsWith("https://");
      const isJsTsFile = /\.(js|ts|mjs|mts|jsx|tsx)$/.test(specifier);
      if (!isNpm && !isUrl && !isJsTsFile) {
        writeResponse(conn, {
          ok: false,
          error: `Only JS/TS files and npm: specifiers are supported. Got: ${specifier}`,
        });
        return;
      }

      // Allocate a PTY pair
      let pty: { masterFd: number; slavePath: string };
      try {
        pty = openPty(rows, cols);
      } catch (e) {
        writeResponse(conn, { ok: false, error: `PTY allocation failed: ${e.message}` });
        return;
      }

      // Resolve the specifier to a proper URL for the worker module loader.
      let resolvedSpecifier = specifier;
      if (specifier.startsWith("npm:")) {
        // For npm packages, resolve the bin entry since import() can't
        // handle packages that only have bin (no main/exports).
        // Use `deno info --json` to find the package folder, then read
        // package.json to find the bin entry.
        try {
          const infoCmd = new Deno.Command(Deno.execPath(), {
            args: ["info", "--json", specifier],
            stdout: "piped",
            stderr: "null",
          });
          const infoOut = await infoCmd.output();
          const info = JSON.parse(new TextDecoder().decode(infoOut.stdout));

          // Find the npm package folder from the npmPackages map
          // Strip npm: prefix and optional version constraint
          const pkgName = specifier.replace(/^npm:/, "").replace(/@[^/@]*$/, "");
          let pkgFolder = "";
          for (const [id, pkg] of Object.entries(info.npmPackages || {}) as any) {
            // id is like "@anthropic-ai/claude-code@2.1.81"
            // pkgName is like "@anthropic-ai/claude-code"
            const idName = id.substring(0, id.lastIndexOf("@"));
            if (idName === pkgName || id.startsWith(pkgName + "@")) {
              // Cache layout: <host>/<name>/<version>/
              // id format: "@scope/name@version" -> "@scope/name/version"
              const lastAt = id.lastIndexOf("@");
              const name = id.substring(0, lastAt);
              const version = id.substring(lastAt + 1);
              const host = pkg.registryUrl ? new URL(pkg.registryUrl).host : "registry.npmjs.org";
              pkgFolder = `${Deno.env.get("HOME")}/Library/Caches/deno/npm/${host}/${name}/${version}`;
              break;
            }
          }

          if (pkgFolder) {
            // Read package.json to find bin entry
            const pkgJsonPath = `${pkgFolder}/package.json`;
            try {
              const pkgJson = JSON.parse(await Deno.readTextFile(pkgJsonPath));
              let binFile = "";
              if (typeof pkgJson.bin === "string") {
                binFile = pkgJson.bin;
              } else if (typeof pkgJson.bin === "object") {
                // Use the first bin entry
                binFile = Object.values(pkgJson.bin)[0] as string;
              }
              if (binFile) {
                resolvedSpecifier = new URL(binFile, `file://${pkgFolder}/`).href;
              }
            } catch { /* fall through to npm: specifier */ }
          }
        } catch { /* fall through to npm: specifier */ }
      } else if (!specifier.startsWith("http") && !specifier.startsWith("file://")) {
        // Resolve relative/absolute file paths to file:// URLs
        const path = specifier.startsWith("/") ? specifier : `${cwd}/${specifier}`;
        resolvedSpecifier = new URL(`file://${path}`).href;
      }

      // Create an in-process container with PTY slave as stdio.
      // Using execSpecifier mode: the worker loads the module directly
      // as its main module. No bootstrap code - stdio goes through PTY.
      const c = Deno.container({
        name: specifier,
        ptyPath: pty.slavePath,
        execSpecifier: resolvedSpecifier,
      });

      const id = nextId++;
      const record: any = {
        container: c,
        entry: specifier,
        cwd,
        createdAt: Date.now(),
        containerType: "exec",
        action: null,
        runCount: 0,
        lastRun: null,
        lastError: null,
        logs: [],
        logNextFrom: 0,
        ptyMasterFd: pty.masterFd,
      };
      containers.set(id, record);

      writeResponse(conn, { ok: true, id, mode: "pty" });

      // Set PTY master to non-blocking
      setNonBlocking(pty.masterFd);

      // The module runs as the worker's main module. We wait for
      // the worker to exit by polling its control channel.
      const execPromise = new Promise<void>((resolve) => {
        const poll = async () => {
          while (!c.closed) {
            await new Promise((r) => setTimeout(r, 100));
          }
          resolve();
        };
        poll();
      });

      // PTY master ↔ socket streaming as background task.
      (async () => {
        const buf = new Uint8Array(16384);
        let alive = true;

        // PTY master → socket (program output → CLI terminal)
        const readLoop = (async () => {
          while (alive) {
            try {
              const n = readFd(pty.masterFd, buf);
              if (n > 0) {
                await conn.write(buf.subarray(0, n));
              } else if (n === 0) {
                alive = false;
                break;
              } else {
                // EAGAIN
                await new Promise((r) => setTimeout(r, 5));
              }
            } catch {
              alive = false;
              break;
            }
          }
        })();

        // Socket → PTY master (CLI keystrokes → program stdin)
        const writeLoop = (async () => {
          const sbuf = new Uint8Array(16384);
          while (alive) {
            try {
              const n = await conn.read(sbuf);
              if (n === null) { alive = false; break; }
              const data = sbuf.subarray(0, n);
              // Check for resize escape: \x1b[8;<rows>;<cols>t
              const str = new TextDecoder().decode(data);
              const resizeMatch = str.match(/\x1b\[8;(\d+);(\d+)t/);
              if (resizeMatch) {
                setWinSize(pty.masterFd, Number(resizeMatch[1]), Number(resizeMatch[2]));
                const cleaned = new TextEncoder().encode(
                  str.replace(/\x1b\[8;\d+;\d+t/g, ""),
                );
                if (cleaned.length > 0) writeFd(pty.masterFd, cleaned);
              } else {
                writeFd(pty.masterFd, data);
              }
            } catch {
              alive = false;
              break;
            }
          }
        })();

        // Wait for the module to finish
        await execPromise;
        // Give a moment for final output to flush through PTY
        await new Promise((r) => setTimeout(r, 200));
        alive = false;

        // Drain remaining PTY output
        try {
          while (true) {
            const n = readFd(pty.masterFd, buf);
            if (n <= 0) break;
            await conn.write(buf.subarray(0, n));
          }
        } catch { /* */ }

        closeFd(pty.masterFd);
        try { c.close(); } catch { /* */ }
        containers.delete(id);
        try { conn.close(); } catch { /* */ }
      })();

      return "exec_takeover";
    }

    case "ping": {
      writeResponse(conn, { ok: true, pid: Deno.pid, containers: containers.size });
      return;
    }

    case "shutdown": {
      writeResponse(conn, { ok: true });
      for (const [, record] of containers) {
        record.container.close();
      }
      containers.clear();
      console.log("[daemon] Shutdown requested, exiting.");
      Deno.exit(0);
    }

    default:
      writeResponse(conn, { ok: false, error: `Unknown command: ${cmd.type}` });
  }
}

async function handleConnection(conn) {
  const decoder = new TextDecoder();
  const buf = new Uint8Array(65536);
  let partial = "";
  let takenOver = false;

  try {
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;

      partial += decoder.decode(buf.subarray(0, n));

      // Process complete lines (newline-delimited JSON)
      const lines = partial.split("\n");
      partial = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const cmd = JSON.parse(line);
          const result = await handleCommand(cmd, conn);
          if (result === "exec_takeover") {
            // The exec handler now owns this connection.
            // Do NOT close it — exec manages the lifecycle.
            takenOver = true;
            return;
          }
        } catch (e) {
          writeResponse(conn, { ok: false, error: `Parse error: ${e.message}` });
        }
      }
    }
  } catch {
    // connection reset
  } finally {
    if (!takenOver) {
      try { conn.close(); } catch { /* */ }
    }
  }
}

const listener = Deno.listen({ transport: "unix", path: SOCKET_PATH });
console.log(`[daemon] PID ${Deno.pid} listening on ${SOCKET_PATH}`);
console.log(`[daemon] Ready for connections.`);

// Write PID file so CLI can find us
const pidPath = SOCKET_PATH + ".pid";
await Deno.writeTextFile(pidPath, String(Deno.pid));

// Clean up on exit
globalThis.addEventListener("unload", () => {
  try { Deno.removeSync(SOCKET_PATH); } catch { /* */ }
  try { Deno.removeSync(pidPath); } catch { /* */ }
});

for await (const conn of listener) {
  handleConnection(conn);
}
