// Copyright 2018-2026 the Deno authors. MIT license.

import { core, primordials } from "ext:core/mod.js";
import {
  op_create_worker,
  op_host_get_worker_cpu_usage,
  op_host_post_message,
  op_host_recv_ctrl,
  op_host_recv_message,
  op_host_terminate_worker,
} from "ext:core/ops";
import {
  deserializeJsMessageData,
  serializeJsMessageData,
} from "ext:deno_web/13_message_port.js";

const { Promise, Symbol, Error, TypeError } = primordials;

// Parse a size string like "64m", "1g", "512k" into bytes
function parseMemoryLimit(limit) {
  if (typeof limit === "number") return limit;
  if (typeof limit !== "string") return undefined;

  const match = limit.match(/^(\d+)\s*(k|m|g|kb|mb|gb)?$/i);
  if (!match) throw new TypeError(`Invalid memory limit: ${limit}`);

  const value = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();

  switch (unit) {
    case "k":
    case "kb":
      return value * 1024;
    case "":
    case "m":
    case "mb":
      return value * 1024 * 1024;
    case "g":
    case "gb":
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

// Parse a timeout string like "5s", "500ms", "1m" into milliseconds
function parseTimeout(timeout) {
  if (typeof timeout === "number") return timeout;
  if (typeof timeout !== "string") return undefined;

  const match = timeout.match(/^(\d+)\s*(ms|s|m)?$/i);
  if (!match) throw new TypeError(`Invalid timeout: ${timeout}`);

  const value = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();

  switch (unit) {
    case "":
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      return value;
  }
}

// Track whether we're inside a container (for nesting control)
let insideContainer = false;

// The bootstrap code that runs inside the container worker.
// Uses the standard Web Worker message API (onmessage/postMessage)
// which is set up by the worker runtime bootstrap before this code runs.
const CONTAINER_BOOTSTRAP = `
"use strict";
// Capture console output into a log buffer
globalThis.__logs = [];
const __origConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};
function __capture(level, args) {
  const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  globalThis.__logs.push({ ts: Date.now(), level, msg: line });
  // Keep max 10000 lines to prevent unbounded growth
  if (globalThis.__logs.length > 10000) globalThis.__logs.shift();
}
console.log = (...args) => { __capture("LOG", args); __origConsole.log(...args); };
console.error = (...args) => { __capture("ERR", args); __origConsole.error(...args); };
console.warn = (...args) => { __capture("WRN", args); __origConsole.warn(...args); };
console.info = (...args) => { __capture("INF", args); __origConsole.info(...args); };
console.debug = (...args) => { __capture("DBG", args); __origConsole.debug(...args); };

globalThis.onmessage = async function(e) {
  const msg = e.data;
  let response;

  // Track log position so we can return new logs with each response
  const logStart = globalThis.__logs.length;

  try {
    if (msg.type === "eval") {
      const result = (0, eval)(msg.code);
      const resolved = await result;
      response = { ok: true, value: typeof resolved === "undefined" ? undefined : String(resolved) };
    } else if (msg.type === "evalAsync") {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction(msg.code);
      const resolved = await fn();
      response = { ok: true, value: typeof resolved === "undefined" ? undefined : String(resolved) };
    } else if (msg.type === "execFile") {
      const mod = await import(msg.path);
      response = { ok: true, value: mod.default !== undefined ? String(mod.default) : undefined };
    } else if (msg.type === "getLogs") {
      // Return logs from the requested offset
      const from = msg.from || 0;
      const logs = globalThis.__logs.slice(from);
      response = { ok: true, value: JSON.stringify({ logs, nextFrom: globalThis.__logs.length }) };
      globalThis.postMessage(response);
      return;
    } else if (msg.type === "getMemory") {
      const mem = Deno.memoryUsage();
      response = { ok: true, value: JSON.stringify(mem) };
      globalThis.postMessage(response);
      return;
    } else if (msg.type === "close") {
      globalThis.close();
      return;
    } else {
      response = { ok: false, error: "Unknown message type: " + msg.type };
    }
  } catch (e) {
    response = { ok: false, error: String(e), name: e?.name, stack: e?.stack };
  }

  // Attach new log lines to the response
  response.logs = globalThis.__logs.slice(logStart);

  globalThis.postMessage(response);
};
`;

// Bootstrap code that disables Deno.container() inside the container
// when nest: false
const CONTAINER_NO_NEST_BOOTSTRAP = `
"use strict";
if (typeof Deno !== "undefined" && Deno.container) {
  Deno.container = function() {
    throw new Error("Nesting is disabled for this container");
  };
  delete Deno.Container;
}
` + CONTAINER_BOOTSTRAP;

let nextRequestId = 0;

// Global container registry for `Deno.containers` listing
const containerRegistry = new Map();

class Container {
  #id;
  #status = "running"; // "running" | "closed"
  #pendingRequests = new Map(); // requestId -> { resolve, reject }
  #controlPromise;
  #messagePromise;
  #cpuTimeout; // per-request timeout in ms

  // Stats tracking
  #createdAt;
  #requestCount = 0;
  #errorCount = 0;
  #lastError = null;
  #name;
  #cpuBuffer = new Float64Array(2);

  constructor(options = {}) {
    const {
      permissions = null,
      resources = {},
      nest = true,
      name = "container",
    } = options;

    this.#createdAt = Date.now();
    this.#name = name;

    // Parse resource limits
    const memoryLimitBytes = resources.memoryLimit
      ? parseMemoryLimit(resources.memoryLimit)
      : undefined;
    this.#cpuTimeout = resources.cpuTimeout
      ? parseTimeout(resources.cpuTimeout)
      : undefined;

    // Build resource limits for the worker (V8 heap limits)
    let resourceLimits = undefined;
    if (memoryLimitBytes !== undefined) {
      const memoryLimitMb = Math.ceil(memoryLimitBytes / (1024 * 1024));
      resourceLimits = {
        // Allocate ~80% to old generation, ~20% to young generation
        maxOldGenerationSizeMb: Math.ceil(memoryLimitMb * 0.8),
        maxYoungGenerationSizeMb: Math.max(
          1,
          Math.ceil(memoryLimitMb * 0.2),
        ),
      };
    }

    const bootstrapCode = nest
      ? CONTAINER_BOOTSTRAP
      : CONTAINER_NO_NEST_BOOTSTRAP;

    // Create worker with the container bootstrap code
    this.#id = op_create_worker({
      hasSourceCode: true,
      name,
      permissions: null,
      sourceCode: bootstrapCode,
      specifier: "file:///container",
      workerType: "node",
      closeOnIdle: false,
      resourceLimits: resourceLimits || undefined,
    });

    // Register in global registry
    containerRegistry.set(this.#id, this);

    // Start polling for control events and messages
    this.#pollControl();
    this.#pollMessages();
  }

  #pollControl = async () => {
    while (this.#status === "running") {
      this.#controlPromise = op_host_recv_ctrl(this.#id);
      const { 0: type, 1: data } = await this.#controlPromise;

      if (this.#status === "closed") return;

      switch (type) {
        case 1: { // TerminalError
          this.#status = "closed";
          const errorMsg = data?.message ||
            "Container terminated with error";
          // Reject all pending requests
          for (const [, pending] of this.#pendingRequests) {
            pending.reject(new Error(errorMsg));
          }
          this.#pendingRequests.clear();
          return;
        }
        case 3: // Close
          this.#status = "closed";
          // Resolve remaining pending requests as undefined
          for (const [, pending] of this.#pendingRequests) {
            pending.reject(new Error("Container closed"));
          }
          this.#pendingRequests.clear();
          return;
      }
    }
  };

  #pollMessages = async () => {
    while (this.#status !== "closed") {
      this.#messagePromise = op_host_recv_message(this.#id);
      const data = await this.#messagePromise;
      if (this.#status === "closed" || data === null) return;

      let message;
      try {
        const v = deserializeJsMessageData(data);
        message = v[0];
      } catch {
        continue;
      }

      // The container sends responses sequentially, so we resolve
      // the oldest pending request.
      const firstEntry = this.#pendingRequests.entries().next();
      if (!firstEntry.done) {
        const [id, pending] = firstEntry.value;
        this.#pendingRequests.delete(id);

        // Clear the timeout if set
        if (pending.timeoutId !== undefined) {
          clearTimeout(pending.timeoutId);
        }

        if (message.ok) {
          pending.resolve(message.value);
        } else {
          const err = new Error(message.error);
          if (message.name) err.name = message.name;
          if (message.stack) err.stack = message.stack;
          this.#errorCount++;
          this.#lastError = err.message;
          pending.reject(err);
        }
      }
    }
  };

  #sendRequest(msg, timeoutOverride) {
    if (this.#status !== "running") {
      return Promise.reject(new Error("Container is closed"));
    }

    this.#requestCount++;
    const id = nextRequestId++;
    const timeout = timeoutOverride !== undefined
      ? timeoutOverride
      : this.#cpuTimeout;

    const promise = new Promise((resolve, reject) => {
      const entry = { resolve, reject, timeoutId: undefined };

      if (timeout !== undefined) {
        entry.timeoutId = setTimeout(() => {
          this.#pendingRequests.delete(id);
          // Terminate the container on timeout
          this.close();
          reject(
            new Error(
              `Container execution timed out after ${timeout}ms`,
            ),
          );
        }, timeout);
      }

      this.#pendingRequests.set(id, entry);
    });

    const data = serializeJsMessageData(msg, []);
    op_host_post_message(this.#id, data);

    return promise;
  }

  async eval(code, options = {}) {
    const timeout = options.timeout !== undefined
      ? parseTimeout(options.timeout)
      : undefined;
    return await this.#sendRequest({ type: "eval", code }, timeout);
  }

  async evalAsync(code, options = {}) {
    const timeout = options.timeout !== undefined
      ? parseTimeout(options.timeout)
      : undefined;
    return await this.#sendRequest({ type: "evalAsync", code }, timeout);
  }

  async import(specifier) {
    // Import a module (npm:, file:, https:, etc.) inside the container
    return await this.#sendRequest({
      type: "evalAsync",
      code: `return await import(${JSON.stringify(specifier)});`,
    });
  }

  async execFile(path, options = {}) {
    const timeout = options.timeout !== undefined
      ? parseTimeout(options.timeout)
      : undefined;
    return await this.#sendRequest({ type: "execFile", path }, timeout);
  }

  async memoryUsage() {
    const result = await this.#sendRequest({ type: "getMemory" });
    return JSON.parse(result);
  }

  async logs(options = {}) {
    const from = options.from || 0;
    return await this.#sendRequest({ type: "getLogs", from });
  }

  async execNpm(packageName, options = {}) {
    const timeout = options.timeout !== undefined
      ? parseTimeout(options.timeout)
      : undefined;
    // Resolve npm package and execute its main/bin entry
    const specifier = packageName.startsWith("npm:")
      ? packageName
      : `npm:${packageName}`;
    return await this.#sendRequest({ type: "execFile", path: specifier }, timeout);
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  stats() {
    const stats = {
      id: this.#id,
      name: this.#name,
      status: this.#status,
      createdAt: this.#createdAt,
      uptimeMs: Date.now() - this.#createdAt,
      requestCount: this.#requestCount,
      errorCount: this.#errorCount,
      lastError: this.#lastError,
      pendingRequests: this.#pendingRequests.size,
    };

    // Get CPU usage if container is still running
    if (this.#status === "running") {
      try {
        op_host_get_worker_cpu_usage(this.#id, this.#cpuBuffer);
        stats.cpuUsage = {
          user: this.#cpuBuffer[0], // microseconds
          system: this.#cpuBuffer[1], // microseconds
        };
      } catch {
        // Worker may have just terminated
      }
    }

    return stats;
  }

  close() {
    if (this.#status === "running") {
      containerRegistry.delete(this.#id);
      // Clear all pending timeouts
      for (const [, pending] of this.#pendingRequests) {
        if (pending.timeoutId !== undefined) {
          clearTimeout(pending.timeoutId);
        }
      }

      // Try to send a close message, then terminate
      try {
        const data = serializeJsMessageData({ type: "close" }, []);
        op_host_post_message(this.#id, data);
      } catch {
        // Worker may already be closed
      }
      this.#status = "closed";
      op_host_terminate_worker(this.#id);
    }
  }

  get closed() {
    return this.#status === "closed";
  }

  [Symbol.dispose]() {
    this.close();
  }
}

function container(options) {
  return new Container(options);
}

function containers() {
  const result = [];
  for (const [, c] of containerRegistry) {
    result.push(c.stats());
  }
  return result;
}

export { container, Container, containers };
