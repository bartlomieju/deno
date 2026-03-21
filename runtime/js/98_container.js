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

const { Promise, Symbol, Error } = primordials;

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

let nextRequestId = 0;

class Container {
  #id;
  #status = "running"; // "running" | "closed"
  #pendingRequests = new Map(); // requestId -> { resolve, reject }
  #controlPromise;
  #messagePromise;

  constructor(options = {}) {
    const {
      permissions = {},
      resources = {},
      nest = true,
    } = options;

    // Create worker with the container bootstrap code.
    // workerType "classic" triggers execute_script (sloppy mode) path,
    // but we need "module" type for the worker runtime to be set up fully.
    // With hasSourceCode: true and workerType "module", the code won't be
    // executed as a module but via execute_script in sloppy mode.
    this.#id = op_create_worker({
      hasSourceCode: true,
      name: "container",
      permissions: null,
      sourceCode: CONTAINER_BOOTSTRAP,
      specifier: "file:///container",
      workerType: "module",
      closeOnIdle: false,
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
        case 1: // TerminalError
          this.#status = "closed";
          // Reject all pending requests
          for (const [, pending] of this.#pendingRequests) {
            pending.reject(
              new Error(data?.message || "Container terminated with error"),
            );
          }
          this.#pendingRequests.clear();
          return;
        case 3: // Close
          this.#status = "closed";
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

  #sendRequest(msg) {
    if (this.#status !== "running") {
      return Promise.reject(new Error("Container is closed"));
    }

    const id = nextRequestId++;
    const promise = new Promise((resolve, reject) => {
      this.#pendingRequests.set(id, { resolve, reject });
    });

    const data = serializeJsMessageData(msg, []);
    op_host_post_message(this.#id, data);

    return promise;
  }

  async eval(code) {
    return await this.#sendRequest({ type: "eval", code });
  }

  async execFile(path) {
    return await this.#sendRequest({ type: "execFile", path });
  }

  close() {
    if (this.#status === "running") {
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
