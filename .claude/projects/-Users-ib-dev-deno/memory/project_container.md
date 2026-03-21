---
name: deno-container-project
description: Secret project - Deno.container() API for nested permission-scoped V8 isolates with resource limits
type: project
---

`Deno.container()` — creates nested, permission-scoped, resource-limited V8 isolates inside the host process. Secret project, do NOT open PRs.

Branch: `deno_container`

**Why:** Replace 30k-line bridge code (like secure-exec) with a native runtime primitive. Target: ~3 MB incremental memory, ~17ms cold start.

**How to apply:** All work stays on `deno_container` branch. No PRs. Design doc is `PROJECT.md` in repo root.

## Phases
- Phase 0: Feasibility (DONE — existing worker_threads infra covers memory limits, permissions, isolate creation)
- Phase 1: Core `Container` Rust struct + `Deno.container()` JS binding
- Phase 2: Resource limits (heap + CPU timeout) + clean teardown + nesting control
- Phase 3: npm support (execNpm, shared cache, full require resolution)
- Phase 4: CLI + daemon (`deno container`, `deno ps`, `deno kill`)
- Phase 5: Basic OTel per-isolate metrics

## Key findings from Phase 0
- Memory limits: V8 CreateParams + near-heap-limit callback already wired in `cli/lib/worker.rs:387-515`
- CPU timeouts: No worker support, but `ext/node/ops/vm.rs:185-234` has watchdog pattern to reuse
- Permissions: `create_child_permissions()` in `runtime/ops/worker_host.rs:189-197` already supports child scoping
- Worker creation: WebWorker infrastructure spawns V8 isolate on OS thread with all extensions
