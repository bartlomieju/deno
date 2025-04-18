// deno-fmt-ignore-file
// deno-lint-ignore-file

// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// Taken from Node 23.9.0
// This file is automatically generated by `tests/node_compat/runner/setup.ts`. Do not modify this file manually.

'use strict';

// Test that http.ClientRequest,prototype.destroy() returns `this`.
require('../common');

const assert = require('assert');
const http = require('http');
const clientRequest = new http.ClientRequest({ createConnection: () => {} });

assert.strictEqual(clientRequest.destroyed, false);
assert.strictEqual(clientRequest.destroy(), clientRequest);
assert.strictEqual(clientRequest.destroyed, true);
assert.strictEqual(clientRequest.destroy(), clientRequest);
