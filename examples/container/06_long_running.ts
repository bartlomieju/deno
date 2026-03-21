// Long-running containers — keeps containers alive so you can inspect the process tree
// Run this, then in another terminal: ps aux | grep deno, or use Activity Monitor

const containers = [];

// Spawn 5 containers that each do periodic work
for (let i = 0; i < 5; i++) {
  const c = Deno.container({
    name: `worker-${i}`,
    resources: { memoryLimit: "64m" },
  });
  containers.push(c);

  // Kick off a long-running task in each container
  c.eval(`
    globalThis.counter = 0;
    globalThis.intervalId = setInterval(() => {
      globalThis.counter++;
    }, 100);
  `);
}

console.log(`Spawned ${containers.length} containers. PID: ${Deno.pid}`);
console.log("Inspect with: ps -M " + Deno.pid);
console.log("Press Ctrl+C to exit.\n");

// Print stats every 2 seconds
const interval = setInterval(async () => {
  console.log(`--- ${new Date().toLocaleTimeString()} ---`);
  for (const c of containers) {
    if (c.closed) continue;
    const s = c.stats();
    const counter = await c.eval("globalThis.counter");
    console.log(
      `  ${s.name}: counter=${counter}, cpu=${(s.cpuUsage?.user / 1000).toFixed(1)}ms user, uptime=${s.uptimeMs}ms`,
    );
  }
  console.log();
}, 2000);

// Cleanup on Ctrl+C
Deno.addSignalListener("SIGINT", () => {
  console.log("\nShutting down...");
  clearInterval(interval);
  for (const c of containers) c.close();
  console.log("All containers closed.");
  Deno.exit(0);
});
