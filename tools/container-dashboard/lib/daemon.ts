// Daemon client — talks to the container daemon over Unix socket

function getSocketPath(): string {
  const env = Deno.env.get("DENO_CONTAINER_SOCK");
  if (env) return env;

  const tmpDir = Deno.env.get("TMPDIR") || Deno.env.get("TMP") ||
    Deno.env.get("TEMP") || "/tmp";
  return `${tmpDir.replace(/\/+$/, "")}/deno-container-daemon.sock`;
}

export async function daemonRequest(cmd: Record<string, unknown>): Promise<any> {
  const path = getSocketPath();
  const conn = await Deno.connect({ transport: "unix", path });

  const msg = JSON.stringify(cmd) + "\n";
  await conn.write(new TextEncoder().encode(msg));

  const buf = new Uint8Array(65536);
  const n = await conn.read(buf);
  conn.close();

  if (n === null) throw new Error("Empty response from daemon");
  const line = new TextDecoder().decode(buf.subarray(0, n)).trim();
  return JSON.parse(line);
}

export async function listContainers() {
  try {
    const resp = await daemonRequest({ type: "list" });
    if (resp.ok) return resp.containers;
    return [];
  } catch {
    return [];
  }
}

export async function getContainerLogs(id: number, from = 0) {
  try {
    const resp = await daemonRequest({ type: "logs", id, from });
    if (resp.ok) return { logs: resp.logs, total: resp.total };
    return { logs: [], total: 0 };
  } catch {
    return { logs: [], total: 0 };
  }
}

export async function killContainer(id: number) {
  const resp = await daemonRequest({ type: "kill", id });
  return resp.ok;
}

export async function getDaemonPid(): Promise<string> {
  const pidPath = getSocketPath() + ".pid";
  try {
    return (await Deno.readTextFile(pidPath)).trim();
  } catch {
    return "?";
  }
}
