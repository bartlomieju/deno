## The idea

`Deno.container()` (naming TBD) — creates a nested, permission-scoped,
resource-limited V8 isolate inside the host process. ~3 MB incremental memory,
~17ms startup.

The isolate starts bare — nothing but JS language builtins. You opt in:

- **Built-in modules.** Enable `node:fs`, `node:net`, etc. individually — or
  omit `node:vm`, `node:child_process`.
- **npm packages.** Allowed packages with version constraints. Host controls
  install budget and caches aggressively.
- **Permissions.** Scoped read/write/net/run, same as Deno's existing model.
- **Resources.** Memory ceiling, CPU timeout.
- **Nesting.** Whether the child can spawn sub-isolates.
- **eval/Function.** Whether `eval()` and `new Function()` are available.
  Disabled by default.
- **Native addons.** Whether `.node` code can be loaded by dlopen / also applies
  to FFI.

This is the opposite of [secure-exec](https://github.com/rivet-dev/secure-exec),
which starts with all of Node and tries to wall things off. Here you start with
nothing and grant capabilities explicitly.

## API sketch

These are rough. The point is to show the shape.

For comparison — [secure-exec](https://github.com/rivet-dev/secure-exec) today
(Node + [isolated-vm](https://github.com/laverdet/isolated-vm) + 30k lines of
bridge code):

```tsx
const runtime = new NodeRuntime({
  systemDriver: createNodeDriver({
    permissions: {
      fs: () => ({ allow: true }),
      network: () => ({ allow: true }),
    },
  }),
  runtimeDriverFactory: createNodeRuntimeDriverFactory(),
  memoryLimit: 64,
  cpuTimeLimitMs: 5000,
});
```

Deno equivalent — the runtime does the work that secure-exec's 30k-line bridge
does:

```tsx
const runtime = Deno.container({
  builtins: ["node:fs", "node:http"],
  permissions: { read: true, net: true },
  resources: { memoryLimit: "64m", cpuTimeout: "5s" },
});
```

Both used identically with the Vercel AI SDK:

```tsx
const { text } = await ai.generateText({
  model: anthropic("claude-sonnet-4-6"),
  prompt: "write an http server",
  tools: {
    execute: ai.tool({
      description: "Run JavaScript",
      inputSchema: z.object({ code: z.string() }),
      execute: ({ code }) => runtime.eval(code),
    }),
  },
});
```

### More examples

Spawn from an npm package

```jsx
const runtime = Deno.container({
  permissions: {
    read: ["/home/user/project"],
    write: ["/home/user/project"],
    net: ["api.anthropic.com"],
  },
});
await runtime.execNpm("@anthropic-ai/claude-code");
```

Nested runtime — agent spawning a tool call

```jsx
const toolCall = Deno.container({
  builtins: ["node:fs", "node:path"],
  permissions: { read: ["/project/src"] },
  resources: { memoryLimit: "32m", cpuTimeout: "5s" },
  nest: false, // leaf isolate, cannot spawn children
});
const result = await toolCall.execFile("analyze.js");
```

Bare isolate — pure computation, no builtins

```tsx
const sandbox = Deno.container({
  resources: { memoryLimit: "16m", cpuTimeout: "1s" },
});
await sandbox.eval("JSON.parse(input)");
```

Multi-tenant hosting

```jsx
const server = Deno.serve(async (req) => {
  const host = req.headers.get("host");
  const runtime = pool.getOrCreate(host, {
    pkg: tenants[host].package,
    permissions: { net: tenants[host].allowedHosts },
    resources: { memoryLimit: "16m", cpuTimeout: "50ms" },
  });
  return runtime.fetch(req);
});
```

## CLI

`deno container` is `docker run` for JavaScript:

```bash
$ deno container @anthropic-ai/claude-code \\
    --allow-read=. \\
    --allow-net=api.anthropic.com \\
    --memory=512m
```

Every `deno container` is a thin client. The actual execution happens as an
isolate thread inside a shared daemon process (auto-starts on first use, cleans
up when empty). All isolates share the same OS process — Rust runtime,
`ext/node`, npm cache, V8 code caches. That's what enables ~3 MB incremental. A
hypervisor that calls `Deno.container()` in its own code is itself an isolate in
the daemon — its children are sub-isolates within the same process.

```bash
# Terminal 1 — run an agent
$ deno container --allow-read=. --allow-net=api.anthropic.com @anthropic-ai/claude-code 

# Terminal 2 — another agent, ~3 MB incremental
$ cd ~/src/deno && deno container --allow-read=. --allow-net=api.anthropic.com @anthropic-ai/claude-code

# Terminal 3 — run a multi-tenant hypervisor
$ deno container hypervisor.ts

# What's running? All isolates are threads in one daemon process.
$ deno ps
  ID    ENTRY                       CWD             MEM
  1     @anthropic-ai/claude-code   ~/src/fresh     45mb
  2     @anthropic-ai/claude-code   ~/src/deno       3mb
  3     hypervisor.ts               ~/src/platform  12mb
  3.1     express@4.21              —                4mb
  3.2     next@15.3                 —                6mb
  3.3     hono@4.7                  —                3mb

$ deno kill 3.2   # kill one tenant, hypervisor stays up
```

## Thread isolation

Each isolate is a thread with its own V8 heap. Shared address space means the
Rust runtime, `ext/node`, compiled modules, and npm cache exist once — this is
how the ~3 MB incremental cost works. Same model as CF Workers. The tradeoffs:

- **Cross-tenant data access**: prevented by per-isolate permissions enforced in
  Rust at the op layer.
- **Resource exhaustion**: prevented by per-isolate memory limits and CPU
  timeouts.
- **Process crash**: a V8 bug or native addon segfault takes down all isolates.
  Defense in depth: run multiple Deno processes behind a load balancer.
- **Side channels**: mitigatable with timer fuzzing per isolate.

**Implementation options:** Threads with isolated V8 isolates (most likely path
to 17ms / 3 MB) or subprocesses with CoW memory sharing. Both worth prototyping.
Native addons work in either model.

## Performance targets

| Metric     | Target     | Why                                                                                                                 |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Cold start | ~17ms      | Competitive with [isolated-vm](https://github.com/laverdet/isolated-vm). Tool calls can't have perceptible startup. |
| Warm start | <5ms       | V8 code caching / snapshots.                                                                                        |
| Memory     | ~3 MB base | 50-100 concurrent isolates per process, 1000+ with minimal working sets.                                            |
| Teardown   | <1ms       | Kill a runtime, reclaim everything. No zombie handles, no leaked memory.                                            |

## npm integration

Must work with real `package.json` projects — not toy scripts. Full `require()`
resolution (conditional exports, CJS/ESM, transitive deps), safe install (no
lifecycle scripts, minimum release age, lockfile enforcement), shared npm cache
across all isolates, and V8 code caching so warm starts hit <5ms.

## OpenTelemetry

Every isolate is automatically instrumented: trace context propagates into
children (nested isolates form a span tree), per-isolate resource metrics
(memory, CPU, I/O), and permission denial events. No instrumentation code — the
runtime emits it because it _is_ the execution boundary.
