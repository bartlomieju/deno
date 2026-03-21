// HTTP server where each request is handled in an isolated container
// Keeps running so you can curl it and inspect the process

const pool: Deno.Container[] = [];
const POOL_SIZE = 3;

// Pre-warm a pool of containers
for (let i = 0; i < POOL_SIZE; i++) {
  pool.push(
    Deno.container({
      name: `handler-${i}`,
      resources: { memoryLimit: "32m", cpuTimeout: "5s" },
      nest: false,
    }),
  );
}

console.log(`Container pool ready (${POOL_SIZE} containers). PID: ${Deno.pid}`);

let requestCount = 0;

Deno.serve({ port: 8100 }, async (req) => {
  const url = new URL(req.url);
  requestCount++;

  // Round-robin across the pool
  const container = pool[requestCount % POOL_SIZE];

  if (url.pathname === "/eval" && req.method === "POST") {
    const code = await req.text();
    try {
      const result = await container.eval(code);
      return new Response(result + "\n", { status: 200 });
    } catch (e) {
      return new Response("Error: " + e.message + "\n", { status: 500 });
    }
  }

  if (url.pathname === "/stats") {
    const stats = Deno.containers().map((s) => ({
      name: s.name,
      requests: s.requestCount,
      errors: s.errorCount,
      uptimeMs: s.uptimeMs,
      cpu: s.cpuUsage,
    }));
    return new Response(JSON.stringify(stats, null, 2) + "\n", {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(
    `Container HTTP Server

  POST /eval  — evaluate JS code in a sandboxed container
  GET  /stats — show container pool stats

Try:
  curl -X POST http://localhost:8100/eval -d '1 + 2'
  curl -X POST http://localhost:8100/eval -d 'Math.random()'
  curl http://localhost:8100/stats
`,
    { status: 200 },
  );
});
