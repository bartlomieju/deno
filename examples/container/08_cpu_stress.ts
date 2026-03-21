// CPU-intensive containers — good for watching thread activity in htop/Activity Monitor

const containers = [];

// Spawn containers that do real CPU work
for (let i = 0; i < 4; i++) {
  const c = Deno.container({
    name: `cruncher-${i}`,
    resources: { memoryLimit: "64m" },
  });
  containers.push(c);
}

console.log(`Spawned ${containers.length} CPU workers. PID: ${Deno.pid}`);
console.log("Watch threads: ps -M " + Deno.pid + " | head -20");
console.log("Or: top -pid " + Deno.pid);
console.log("Press Ctrl+C to exit.\n");

// Each container computes primes in a loop
const tasks = containers.map(async (c, i) => {
  while (!c.closed) {
    const start = performance.now();
    const result = await c.eval(`
      let count = 0;
      for (let n = 2; n < 50000; n++) {
        let isPrime = true;
        for (let d = 2; d * d <= n; d++) {
          if (n % d === 0) { isPrime = false; break; }
        }
        if (isPrime) count++;
      }
      count
    `);
    const elapsed = (performance.now() - start).toFixed(0);
    const s = c.stats();
    console.log(
      `  ${c.name}: found ${result} primes in ${elapsed}ms (total cpu: ${(s.cpuUsage?.user / 1000).toFixed(0)}ms)`,
    );
  }
});

Deno.addSignalListener("SIGINT", () => {
  console.log("\nShutting down...");
  for (const c of containers) c.close();
  Deno.exit(0);
});

await Promise.allSettled(tasks);
