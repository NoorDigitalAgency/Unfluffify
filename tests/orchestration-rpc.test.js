import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createRpcClient } from "../orchestration/rpc-client.mjs";
import { createRpcServer } from "../orchestration/rpc-server.mjs";

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
