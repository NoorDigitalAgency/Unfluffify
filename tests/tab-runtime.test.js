import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import {
  __resetTabRuntimeForTests,
  appendTabCommandLedger,
  deleteTabRuntime,
  getTabRuntime,
  getTabRuntimeSnapshot,
  updateTabRuntime
} from "../src/background/tab-runtime.js";

test("tab runtime keeps state isolated per tab id", () => {
  __resetTabRuntimeForTests();

  updateTabRuntime(11, {
    contentReady: true,
    mode: "marking",
    operation: { id: "op-a" },
    spinnerQueue: new Map([["spin-a", { message: "A" }]])
  });
  updateTabRuntime(22, {
    contentReady: false,
    mode: "silent",
    operation: { id: "op-b" },
    spinnerQueue: new Map([["spin-b", { message: "B" }]])
  });

  const tabA = getTabRuntimeSnapshot(11);
  const tabB = getTabRuntimeSnapshot(22);

  assert.equal(tabA.tabId, 11);
  assert.equal(tabB.tabId, 22);
  assert.equal(tabA.mode, "marking");
  assert.equal(tabB.mode, "silent");
  assert.deepEqual(tabA.operation, { id: "op-a" });
  assert.deepEqual(tabB.operation, { id: "op-b" });
  assert.equal(tabA.spinnerQueue.length, 1);
  assert.equal(tabB.spinnerQueue.length, 1);
  assert.equal(tabA.spinnerQueue[0].key, "spin-a");
  assert.equal(tabB.spinnerQueue[0].key, "spin-b");
});

test("deleting one tab runtime does not remove other runtimes", () => {
  __resetTabRuntimeForTests();

  updateTabRuntime(101, { mode: "marking" });
  updateTabRuntime(202, { mode: "silent" });

  assert.equal(deleteTabRuntime(101), true);
  assert.equal(getTabRuntimeSnapshot(101).mode, "idle");
  assert.equal(getTabRuntimeSnapshot(202).mode, "silent");
});

test("command ledger is tab-scoped and capped per tab", () => {
  __resetTabRuntimeForTests();

  for (let i = 0; i < 60; i += 1) {
    appendTabCommandLedger(7, {
      id: `id-${i}`,
      type: "TAB_CMD",
      startedAt: i,
      finishedAt: i + 1,
      durationMs: 1,
      status: "ok"
    });
  }
  appendTabCommandLedger(8, {
    id: "other-tab",
    type: "TAB_CMD",
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    status: "ok"
  });

  const tab7 = getTabRuntimeSnapshot(7);
  const tab8 = getTabRuntimeSnapshot(8);

  assert.equal(tab7.commandLedger.length, 50);
  assert.equal(tab7.commandLedger[0].id, "id-10");
  assert.equal(tab7.commandLedger[49].id, "id-59");
  assert.equal(tab8.commandLedger.length, 1);
  assert.equal(tab8.commandLedger[0].id, "other-tab");
});

test("runtime objects are created lazily for valid tab ids only", () => {
  __resetTabRuntimeForTests();

  assert.equal(getTabRuntime(0), null);
  assert.equal(getTabRuntime(-3), null);
  assert.equal(getTabRuntime("abc"), null);
  assert.equal(getTabRuntime(5).tabId, 5);
});
