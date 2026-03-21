// Resource limits — memory ceiling and CPU timeout

// Memory limit: container is killed if it exceeds 32MB
console.log("--- Memory limit ---");
const oom = Deno.container({
  name: "memory-test",
  resources: { memoryLimit: "32m" },
});
try {
  await oom.eval(
    "const a=[]; for(let i=0;i<1e7;i++) a.push('x'.repeat(100))",
  );
} catch (e) {
  console.log("OOM caught (process still alive!):", e.message);
}

// CPU timeout: container is killed if eval takes too long
console.log("\n--- CPU timeout ---");
const slow = Deno.container({
  name: "cpu-test",
  resources: { cpuTimeout: "500ms" },
});
try {
  await slow.eval("while(true) {}");
} catch (e) {
  console.log("Timeout caught:", e.message);
}

// Per-eval timeout override
console.log("\n--- Per-eval timeout ---");
const c = Deno.container({ name: "per-eval" });
try {
  await c.eval("while(true) {}", { timeout: "200ms" });
} catch (e) {
  console.log("Per-eval timeout:", e.message);
}

// Normal operations work fine within limits
console.log("\n--- Within limits ---");
const ok = Deno.container({
  name: "normal",
  resources: { memoryLimit: "64m", cpuTimeout: "5s" },
});
console.log("Result:", await ok.eval("Array.from({length:100}, (_,i) => i).reduce((a,b) => a+b)"));
ok.close();
