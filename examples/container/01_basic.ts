// Basic container usage — eval, state persistence, isolation

const c1 = Deno.container({ name: "alice" });
const c2 = Deno.container({ name: "bob" });

// State persists within a container
await c1.eval("globalThis.secret = 'alice-secret-123'");
console.log("Alice's secret:", await c1.eval("secret"));

// But is fully isolated from other containers
console.log("Bob sees Alice's secret?", await c2.eval("typeof secret"));

// Each container is a separate V8 isolate on its own thread
console.log("Alice's eval:", await c1.eval("2 ** 32"));
console.log("Bob's eval:", await c2.eval("Math.PI.toFixed(5)"));

c1.close();
c2.close();
