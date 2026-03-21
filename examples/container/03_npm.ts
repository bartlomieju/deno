// npm packages work inside containers, sharing the host's cache

const c = Deno.container({ name: "npm-demo" });

// Import and use an npm package via evalAsync (supports top-level await)
const cow = await c.evalAsync(`
  const { default: cowsay } = await import("npm:cowsay@1.6.0");
  return cowsay.say({ text: "Hello from a container!" });
`);
console.log(cow);

// Second container reuses the cached npm package — near instant
const c2 = Deno.container({ name: "npm-cached" });
const start = performance.now();
await c2.evalAsync(`await import("npm:cowsay@1.6.0")`);
console.log(`\nSecond import (cached): ${(performance.now() - start).toFixed(0)}ms`);

c.close();
c2.close();
