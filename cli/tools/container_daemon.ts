// Deno Container Daemon
// Hosts all container isolates in a single process.
// CLI clients connect via Unix domain socket to create/eval/kill containers.

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

// Container registry: id -> { container, entry, cwd, createdAt }
const containers = new Map();
let nextId = 1;

function writeResponse(conn, response) {
  const msg = JSON.stringify(response) + "\n";
  const encoder = new TextEncoder();
  try {
    conn.write(encoder.encode(msg));
  } catch {
    // connection closed
  }
}

async function handleCommand(cmd, conn) {
  switch (cmd.type) {
    case "create": {
      const id = nextId++;
      const c = Deno.container({
        name: cmd.name || `container-${id}`,
        resources: cmd.resources || {},
        nest: cmd.nest !== false,
      });
      containers.set(id, {
        container: c,
        entry: cmd.entry || "(eval)",
        cwd: cmd.cwd || "",
        createdAt: Date.now(),
      });
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
      return;
    }

    case "list": {
      const list = [];
      for (const [id, record] of containers) {
        const c = record.container;
        if (c.closed) {
          containers.delete(id);
          continue;
        }
        const stats = c.stats();
        list.push({
          id,
          name: stats.name,
          entry: record.entry,
          cwd: record.cwd,
          uptimeMs: stats.uptimeMs,
          requestCount: stats.requestCount,
          errorCount: stats.errorCount,
          cpuUsage: stats.cpuUsage,
          memMb: stats.cpuUsage ? undefined : undefined, // placeholder
        });
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
      record.container.close();
      containers.delete(cmd.id);
      writeResponse(conn, { ok: true });
      return;
    }

    case "close": {
      const record = containers.get(cmd.id);
      if (record) {
        record.container.close();
        containers.delete(cmd.id);
      }
      writeResponse(conn, { ok: true });
      return;
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
          await handleCommand(cmd, conn);
        } catch (e) {
          writeResponse(conn, { ok: false, error: `Parse error: ${e.message}` });
        }
      }
    }
  } catch {
    // connection reset
  } finally {
    try { conn.close(); } catch { /* */ }
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
