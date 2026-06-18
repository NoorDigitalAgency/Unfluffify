import { assert } from "./test-kit.ts";
import { mkdtemp, rm } from "./file-kit.ts";
import os from "node:os";
import { path } from "./file-kit.ts";
import { test } from "./test-kit.ts";

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
      (err) => {
        assert(err instanceof Error);
        return true;
      }
    );
    unauthorizedClient.close();
  } finally {
    await rpc.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("rpc client wraps JSON-RPC error responses in Error instances", async () => {
  class MockRpcSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = MockRpcSocket.OPEN;
      this.listeners = new Map();
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

    send(data) {
      const parsed = JSON.parse(data);
      queueMicrotask(() => {
        const errorResponse = {
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32601, message: "Method not found", data: { method: parsed.method } }
        };
        this.#emit("message", { data: JSON.stringify(errorResponse) });
      });
    }

    close() {
      this.readyState = MockRpcSocket.CLOSED;
    }

    #emit(type, event) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }
  }

  const client = createRpcClient({
    url: "ws://127.0.0.1:9876",
    WebSocketImpl: MockRpcSocket
  });

  await assert.rejects(
    client.request("unknown.method"),
    (err) => {
      assert(err instanceof Error);
      assert.equal(err.message, "Method not found");
      assert.equal(err.code, -32601);
      assert.deepEqual(err.data, { method: "unknown.method" });
      return true;
    }
  );

  client.close();
});

test("rpc server method-not-found errors use stable message and include method in data", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "unfluffify-rpc-method-not-found-test-"));
  const rpc = createRpcServer({
    runRoot,
    repoPath: process.cwd(),
    extensionPath: process.cwd()
  });

  try {
    const listening = await rpc.listen(0);
    const client = createRpcClient({
      url: listening.url,
      requestTimeoutMs: 5000
    });
    await assert.rejects(
      client.request("unknown.method"),
      (err) => {
        assert(err instanceof Error);
        assert.equal(err.message, "Method not found");
        assert.equal(err.code, -32601);
        assert.deepEqual(err.data, { method: "unknown.method" });
        return true;
      }
    );
    client.close();
  } finally {
    await rpc.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("rpc client keeps numeric and string ids distinct in pending map", async () => {
  class MockCollisionSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = MockCollisionSocket.OPEN;
      this.listeners = new Map();
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

    send(data) {
      const parsed = JSON.parse(data);
      const delay = typeof parsed.id === "number" ? 5 : 0;
      setTimeout(() => {
        this.#emit("message", {
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { method: parsed.method, idType: typeof parsed.id }
          })
        });
      }, delay);
    }

    close() {
      this.readyState = MockCollisionSocket.CLOSED;
    }

    #emit(type, event) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }
  }

  const client = createRpcClient({
    url: "ws://127.0.0.1:9876",
    requestTimeoutMs: 1000,
    WebSocketImpl: MockCollisionSocket
  });
  const [numeric, stringy] = await Promise.all([
    client.request("numeric.id", {}, { id: 1 }),
    client.request("string.id", {}, { id: "1" })
  ]);
  assert.deepEqual(numeric, { method: "numeric.id", idType: "number" });
  assert.deepEqual(stringy, { method: "string.id", idType: "string" });
  client.close();
});
