// Copyright 2018-2026 the Deno authors. MIT license.

import { core, primordials } from "ext:core/mod.js";
import {
  op_create_worker,
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
globalThis.onmessage = async function(e) {
  const msg = e.data;
  let response;

  try {
    if (msg.type === "eval") {
      const result = (0, eval)(msg.code);
      const resolved = await result;
      response = { ok: true, value: typeof resolved === "undefined" ? undefined : String(resolved) };
    } else if (msg.type === "execFile") {
      const mod = await import(msg.path);
      response = { ok: true, value: mod.default !== undefined ? String(mod.default) : undefined };
    } else if (msg.type === "close") {
      globalThis.close();
      return;
    } else {
      response = { ok: false, error: "Unknown message type: " + msg.type };
    }
  } catch (e) {
    response = { ok: false, error: String(e), name: e?.name, stack: e?.stack };
  }

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

class Container {
  #id;
  #status = "running"; // "running" | "closed"
  #pendingRequests = new Map(); // requestId -> { resolve, reject }
  #controlPromise;
  #messagePromise;
  #cpuTimeout; // per-request timeout in ms

  constructor(options = {}) {
    const {
      permissions = null,
      resources = {},
      nest = true,
    } = options;

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
      name: "container",
      permissions: null,
      sourceCode: bootstrapCode,
      specifier: "file:///container",
      workerType: "node",
      closeOnIdle: false,
      resourceLimits: resourceLimits || undefined,
    });

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
          pending.reject(err);
        }
      }
    }
  };

  #sendRequest(msg, timeoutOverride) {
    if (this.#status !== "running") {
      return Promise.reject(new Error("Container is closed"));
    }

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

  async execFile(path, options = {}) {
    const timeout = options.timeout !== undefined
      ? parseTimeout(options.timeout)
      : undefined;
    return await this.#sendRequest({ type: "execFile", path }, timeout);
  }

  close() {
    if (this.#status === "running") {
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

export { container, Container };
