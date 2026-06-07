import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createRpcClient } from "../orchestration/rpc-client.mjs";
import { createRpcServer } from "../orchestration/rpc-server.mjs";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = new Map();
    queueMicrotask(() => {
      this.#emit("error", { type: "error" });
    });
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  #emit(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

test("rpc server handles system.ping and system.preflight over json-rpc", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "unfluffify-rpc-test-"));
  const rpc = createRpcServer({
    runRoot,
    token: "secret-token",
    repoPath: process.cwd(),
    extensionPath: process.cwd()
  });

  try {
    const listening = await rpc.listen(0);
    const client = createRpcClient({
      url: listening.url,
      token: "secret-token",
      requestTimeoutMs: 5000
    });

    const ping = await client.request("system.ping");
    assert.equal(ping.ok, true);
    assert.equal(typeof ping.pid, "number");
    assert.equal(typeof ping.nodeVersion, "string");

    const preflight = await client.request("system.preflight");
    assert.equal(preflight.checks.repoGit, true);
    assert.equal(preflight.checks.extensionManifest, true);
    assert.equal(preflight.checks.runDirWritable, true);

    const shutdown = await client.request("system.shutdown");
    assert.equal(shutdown.ok, true);
    client.close();
  } finally {
    await rpc.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("rpc client wraps non-Error open failures in Error instances", async () => {
  const client = createRpcClient({
    url: "ws://127.0.0.1:9876",
    WebSocketImpl: MockWebSocket
  });

  await assert.rejects(client.waitForOpen(), (error) => {
    assert(error instanceof Error);
    assert.equal(error.message, "RPC socket error before opening");
    return true;
  });
});

test("rpc server enforces upgrade token when configured", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "unfluffify-rpc-auth-test-"));
  const rpc = createRpcServer({
    runRoot,
    token: "secret-token",
    repoPath: process.cwd(),
    extensionPath: process.cwd()
  });

  try {
    const listening = await rpc.listen(0);
    const unauthorizedClient = createRpcClient({
      url: listening.url,
      requestTimeoutMs: 2000
    });
    await assert.rejects(
      unauthorizedClient.request("system.ping"),
      /closed|Error|timeout/i
    );
    unauthorizedClient.close();
  } finally {
    await rpc.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});
