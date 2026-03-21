import { useEffect, useRef, useState } from "preact/hooks";

interface Container {
  id: number;
  name: string;
  containerType: string;
  cwd: string;
  requestCount: number;
  errorCount: number;
  uptimeMs: number;
  cpuUsage?: { user: number; system: number };
  cronExpr?: string;
  runCount?: number;
}

interface LogEntry {
  ts: number;
  level: string;
  msg: string;
}

function formatUptime(ms: number): string {
  if (ms > 86400000) return `${Math.floor(ms / 86400000)}d ${Math.floor((ms % 86400000) / 3600000)}h`;
  if (ms > 3600000) return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  if (ms > 60000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  if (ms > 1000) return `${Math.floor(ms / 1000)}s`;
  return `${ms}ms`;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

export default function Dashboard() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [daemonPid, setDaemonPid] = useState("?");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFrom, setLogFrom] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Spawn form state
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnCode, setSpawnCode] = useState("console.log('Hello from container!');");
  const [spawnName, setSpawnName] = useState("");
  const [spawnMemory, setSpawnMemory] = useState("");
  const [spawnTimeout, setSpawnTimeout] = useState("");
  const [spawnCron, setSpawnCron] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [spawnResult, setSpawnResult] = useState<string | null>(null);

  // Poll containers every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const resp = await fetch("/api/containers");
        const data = await resp.json();
        setContainers(data.containers || []);
        setDaemonPid(data.daemonPid || "?");
      } catch { /* daemon not running */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Poll logs for selected container
  useEffect(() => {
    if (selectedId === null) return;
    setLogs([]);
    setLogFrom(0);

    let from = 0;
    const poll = async () => {
      try {
        const resp = await fetch(`/api/containers/${selectedId}/logs?from=${from}`);
        const data = await resp.json();
        if (data.logs?.length > 0) {
          setLogs((prev) => [...prev, ...data.logs]);
          from = data.total;
          setLogFrom(data.total);
          setTimeout(() => {
            if (logRef.current) {
              logRef.current.scrollTop = logRef.current.scrollHeight;
            }
          }, 50);
        }
      } catch { /* */ }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [selectedId]);

  const handleKill = async (id: number) => {
    await fetch(`/api/containers/${id}/kill`, { method: "POST" });
    if (selectedId === id) {
      setSelectedId(null);
      setLogs([]);
    }
  };

  const handleSpawn = async () => {
    setSpawning(true);
    setSpawnResult(null);
    try {
      const body: Record<string, string> = { code: spawnCode };
      if (spawnName.trim()) body.name = spawnName.trim();
      if (spawnMemory.trim()) body.memoryLimit = spawnMemory.trim();
      if (spawnTimeout.trim()) body.cpuTimeout = spawnTimeout.trim();
      if (spawnCron.trim()) body.cron = spawnCron.trim();

      const resp = await fetch("/api/containers/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.ok) {
        setSpawnResult(`Container ${data.id} created`);
        setSelectedId(data.id);
        // Reset form after short delay
        setTimeout(() => setSpawnResult(null), 3000);
      } else {
        setSpawnResult(`Error: ${data.error}`);
      }
    } catch (e) {
      setSpawnResult(`Error: ${(e as Error).message}`);
    }
    setSpawning(false);
  };

  const totalReqs = containers.reduce((s, c) => s + c.requestCount, 0);
  const totalErrs = containers.reduce((s, c) => s + c.errorCount, 0);
  const cronCount = containers.filter((c) => c.containerType === "cron").length;

  return (
    <div>
      <div class="header">
        <h1>Deno Containers</h1>
        <span class="badge">{containers.length > 0 ? "LIVE" : "IDLE"}</span>
        <button
          class="btn btn-spawn"
          onClick={() => setShowSpawn(!showSpawn)}
        >
          {showSpawn ? "- Close" : "+ New Container"}
        </button>
        <span class="pid">daemon pid: {daemonPid}</span>
      </div>
      <div class="content">
        {/* Spawn form */}
        {showSpawn && (
          <div class="spawn-panel">
            <div class="spawn-row">
              <div class="spawn-editor">
                <label class="spawn-label">Code</label>
                <textarea
                  class="code-input"
                  value={spawnCode}
                  onInput={(e) => setSpawnCode((e.target as HTMLTextAreaElement).value)}
                  rows={6}
                  placeholder="console.log('hello');"
                  spellcheck={false}
                />
              </div>
              <div class="spawn-options">
                <div class="spawn-field">
                  <label class="spawn-label">Name</label>
                  <input
                    type="text"
                    class="spawn-input"
                    value={spawnName}
                    onInput={(e) => setSpawnName((e.target as HTMLInputElement).value)}
                    placeholder="my-container"
                  />
                </div>
                <div class="spawn-field">
                  <label class="spawn-label">Memory limit</label>
                  <input
                    type="text"
                    class="spawn-input"
                    value={spawnMemory}
                    onInput={(e) => setSpawnMemory((e.target as HTMLInputElement).value)}
                    placeholder="64m"
                  />
                </div>
                <div class="spawn-field">
                  <label class="spawn-label">CPU timeout</label>
                  <input
                    type="text"
                    class="spawn-input"
                    value={spawnTimeout}
                    onInput={(e) => setSpawnTimeout((e.target as HTMLInputElement).value)}
                    placeholder="5s"
                  />
                </div>
                <div class="spawn-field">
                  <label class="spawn-label">Cron schedule</label>
                  <input
                    type="text"
                    class="spawn-input"
                    value={spawnCron}
                    onInput={(e) => setSpawnCron((e.target as HTMLInputElement).value)}
                    placeholder="@every_5s, @hourly, */5 * * * *"
                  />
                </div>
                <button
                  class="btn btn-go"
                  onClick={handleSpawn}
                  disabled={spawning || !spawnCode.trim()}
                >
                  {spawning ? "Spawning..." : "Spawn"}
                </button>
                {spawnResult && (
                  <div class={`spawn-result ${spawnResult.startsWith("Error") ? "spawn-error" : "spawn-ok"}`}>
                    {spawnResult}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div class="stats-row">
          <div class="stat-card">
            <div class="label">Containers</div>
            <div class="value">{containers.length}</div>
          </div>
          <div class="stat-card">
            <div class="label">Cron Jobs</div>
            <div class="value">{cronCount}</div>
          </div>
          <div class="stat-card">
            <div class="label">Total Requests</div>
            <div class="value">{totalReqs}</div>
          </div>
          <div class="stat-card">
            <div class="label">Errors</div>
            <div class="value" style={totalErrs > 0 ? "color:#f87171" : ""}>{totalErrs}</div>
          </div>
        </div>

        {containers.length === 0 && !showSpawn ? (
          <div class="empty">
            <p style="font-size:24px">No containers running</p>
            <p>Click "+ New Container" above or run: deno container -d --eval "console.log('hello')"</p>
          </div>
        ) : containers.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Name</th>
                <th>CWD</th>
                <th>Requests</th>
                <th>Errors</th>
                <th>Uptime</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.id} style={selectedId === c.id ? "background:#1a1a2e" : ""}>
                  <td style="color:#888">{c.id}</td>
                  <td>
                    <span class={`type-badge type-${c.containerType}`}>
                      {c.containerType}
                    </span>
                  </td>
                  <td style="color:#fff">{c.name}</td>
                  <td style="color:#666;font-size:11px">{c.cwd}</td>
                  <td>{c.requestCount}</td>
                  <td style={c.errorCount > 0 ? "color:#f87171" : ""}>{c.errorCount}</td>
                  <td>{formatUptime(c.uptimeMs)}</td>
                  <td>
                    <button class="btn btn-primary" onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}>
                      {selectedId === c.id ? "hide logs" : "logs"}
                    </button>
                    {" "}
                    <button class="btn btn-danger" onClick={() => handleKill(c.id)}>
                      kill
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {selectedId !== null && (
          <div class="log-panel">
            <div class="log-header">
              <h3>Logs — Container {selectedId}</h3>
              <span style="color:#666;font-size:12px">{logs.length} lines (live)</span>
            </div>
            <div class="log-body" ref={logRef}>
              {logs.length === 0 ? (
                <div style="color:#555;text-align:center;padding:20px">No log output yet</div>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} class={`log-line log-${entry.level}`}>
                    <span class="log-ts">{formatTs(entry.ts)}</span>
                    {" "}
                    <span class={`level-tag log-${entry.level}`}>{entry.level}</span>
                    {" "}
                    {entry.msg}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
