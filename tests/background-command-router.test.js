import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetBackgroundCommandRegistryForTests,
  dispatchBackgroundCommand,
  registerBackgroundCommand
} from "../background/command-router.js";
import {
  __resetTabRuntimeForTests,
  appendTabCommandLedger,
  deleteTabRuntime,
  getTabRuntime,
  getTabRuntimeSnapshot,
  updateTabRuntime
} from "../background/tab-runtime.js";

function createEnvelope(overrides = {}) {
  return {
    id: "req-1",
    type: "TEST_COMMAND",
    source: "popup",
    target: "background",
    tabId: 1,
    frameId: 0,
    expectsReply: true,
    payload: {},
    ...overrides
  };
}

test.beforeEach(() => {
  __resetBackgroundCommandRegistryForTests();
  __resetTabRuntimeForTests();
});

test("unknown command returns handler_not_found", async () => {
  const reply = await dispatchBackgroundCommand(
    createEnvelope({ type: "NO_SUCH_COMMAND" }),
    {},
    { requireTabForTypes: new Set() }
  );
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "handler_not_found");
});

test("missing tab id for tab-scoped command fails with invalid_tab", async () => {
  registerBackgroundCommand("TAB_SCOPED", async () => ({ ok: true }));
  const reply = await dispatchBackgroundCommand(
    createEnvelope({ type: "TAB_SCOPED", tabId: null }),
    {},
    { requireTabForTypes: new Set(["TAB_SCOPED"]) }
  );
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid_tab");
});

test("same URL tabs keep separate runtimes", () => {
  const runtimeOne = updateTabRuntime(11, {
    contentReady: true,
    mode: "marking",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: true
    }
  });
  const runtimeTwo = updateTabRuntime(22, {
    contentReady: false,
    mode: "silent",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: false
    }
  });

  assert.equal(runtimeOne.tabId, 11);
  assert.equal(runtimeTwo.tabId, 22);

  const snapshotOne = getTabRuntimeSnapshot(11);
  const snapshotTwo = getTabRuntimeSnapshot(22);

  assert.equal(snapshotOne.mode, "marking");
  assert.equal(snapshotTwo.mode, "silent");
  assert.equal(snapshotOne.lastKnownContentState.url, snapshotTwo.lastKnownContentState.url);
});

test("command ledger records success and failure per tab", () => {
  appendTabCommandLedger(71, {
    id: "ok-1",
    type: "TAB_ACTIVATE_MARKING",
    startedAt: 10,
    finishedAt: 20,
    durationMs: 10,
    status: "ok"
  });
  appendTabCommandLedger(71, {
    id: "fail-1",
    type: "TAB_CAPTURE_RENDER_MODE_HTML",
    startedAt: 30,
    finishedAt: 45,
    durationMs: 15,
    status: "error",
    errorCode: "handler_failed"
  });

  appendTabCommandLedger(72, {
    id: "ok-2",
    type: "TAB_ACTIVATE_MARKING",
    startedAt: 50,
    finishedAt: 52,
    durationMs: 2,
    status: "ok"
  });

  const tab71 = getTabRuntimeSnapshot(71);
  const tab72 = getTabRuntimeSnapshot(72);

  assert.equal(tab71.commandLedger.length, 2);
  assert.equal(tab71.commandLedger[0].status, "ok");
  assert.equal(tab71.commandLedger[1].status, "error");
  assert.equal(tab72.commandLedger.length, 1);
  assert.equal(tab72.commandLedger[0].status, "ok");
});

test("deleting one tab runtime does not affect another", () => {
  updateTabRuntime(4001, { contentReady: true });
  updateTabRuntime(4002, { contentReady: false });

  assert.equal(deleteTabRuntime(4001), true);
  assert.equal(deleteTabRuntime(4001), false);

  const remaining = getTabRuntimeSnapshot(4002);
  assert.equal(remaining.tabId, 4002);
  assert.equal(remaining.contentReady, false);

  const recreated = getTabRuntime(4001);
  assert.equal(recreated.tabId, 4001);
  assert.equal(recreated.contentReady, false);
});