import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createSpinnerOperations } from "../background/spinner-operations.js";

function createHarness() {
  const queueByTabId = new Map();
  const traces = [];
  const broadcasts = [];
  const mirroredQueues = [];

  const operations = createSpinnerOperations({
    queueByTabId,
    normalizeTabId(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      const normalized = Math.trunc(numeric);
      return normalized > 0 ? normalized : 0;
    },
    appendTrace(tabId, channel, action, payload) {
      traces.push({ tabId, channel, action, payload });
    },
    broadcastState(tabId) {
      broadcasts.push(tabId);
    },
    buildState(tabId) {
      return {
        ok: Boolean(tabId),
        tabId,
        spinnerQueue: operations.serializeSpinnerQueue(tabId)
      };
    },
    updateRuntimeSpinnerQueue() {
      // Test harness intentionally does not track runtime state.
    },
    syncProjectedSpinnerState(tabId, queue, reason) {
      mirroredQueues.push({
        tabId,
        reason,
        queue
      });
    }
  });

  return {
    operations,
    queueByTabId,
    traces,
    broadcasts,
    mirroredQueues
  };
}

test("withTabSpinner removes spinner after successful work", async () => {
  const { operations, queueByTabId } = createHarness();

  const result = await operations.withTabSpinner(
    10,
    { key: "sync-a", message: "Running" },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async ({ key }) => {
      const queue = queueByTabId.get(10);
      assert.equal(queue.has(key), true);
      return { ok: true };
    }
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(queueByTabId.has(10), false);
});

test("withTabSpinner removes spinner and rethrows when work fails", async () => {
  const { operations, queueByTabId } = createHarness();

  await assert.rejects(
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    operations.withTabSpinner(11, { key: "sync-b", message: "Running" }, async () => {
      throw new Error("boom");
    }),
    /boom/
  );

  assert.equal(queueByTabId.has(11), false);
});

test("spinner update can reset startedAt and progress metadata", async () => {
  const { operations, queueByTabId } = createHarness();

  await operations.withTabSpinner(
    12,
    {
      key: "sync-c",
      message: "Preparing",
      startedAt: 100,
      progress: 0
    },
    async ({ key, update }) => {
      const before = queueByTabId.get(12).get(key);
      assert.equal(before.progress, 0);
      assert.equal(before.startedAt, 100);

      await update({ progress: 60, resetStartedAt: true, message: "Working" });

      const after = queueByTabId.get(12).get(key);
      assert.equal(after.progress, 60);
      assert.equal(after.message, "Working");
      assert.equal(after.startedAt >= 100, true);
      return { done: true };
    }
  );
});

test("same spinner key in different tabs does not conflict", () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(21, "shared", { message: "one" });
  operations.setBackgroundSpinnerEntry(22, "shared", { message: "two" });

  const tab21 = operations.serializeSpinnerQueue(21);
  const tab22 = operations.serializeSpinnerQueue(22);

  assert.equal(tab21.length, 1);
  assert.equal(tab22.length, 1);
  assert.equal(tab21[0].message, "one");
  assert.equal(tab22[0].message, "two");
});

test("persistent spinner survives transient clear but not full clear", () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(31, "persist", {
    message: "Persist",
    persistent: true
  });
  operations.setBackgroundSpinnerEntry(31, "temp", {
    message: "Temp",
    persistent: false
  });

  operations.clearBackgroundSpinnerQueue(31, { transientOnly: true });
  const afterTransientClear = operations.serializeSpinnerQueue(31);
  assert.equal(afterTransientClear.length, 1);
  assert.equal(afterTransientClear[0].key, "persist");

  operations.clearBackgroundSpinnerQueue(31, { transientOnly: false });
  const afterFullClear = operations.serializeSpinnerQueue(31);
  assert.equal(afterFullClear.length, 0);
});

test("spinner entries publish deterministic operation lease metadata", () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(41, "ai", {
    message: "Waiting",
    reason: "tab-run-ai-running",
    startedAt: 1_000
  });

  const [entry] = operations.serializeSpinnerQueue(41);
  assert.equal(entry.operationId, "ai-run:remote-wait:41:1000");
  assert.equal(entry.operationKind, "ai-run");
  assert.equal(entry.operationPhase, "remote-wait");
  assert.equal(entry.timerMode, "countdown");
  assert.equal(entry.deadlineAt, 481_000);
  assert.deepEqual(entry.blockSurfaces, { page: true, popup: true });
});

test("spinner queue mutations mirror serialized queue snapshots for projection", () => {
  const { operations, mirroredQueues } = createHarness();

  operations.setBackgroundSpinnerEntry(51, "first", {
    message: "Blocking",
    reason: "page-inspection-pending"
  });
  operations.setBackgroundSpinnerEntry(51, "second", {
    message: "Saving",
    reason: "config-sync-saving"
  });
  operations.removeBackgroundSpinnerEntry(51, "second");
  operations.clearBackgroundSpinnerQueue(51);

  assert.deepEqual(
    mirroredQueues.map(({ tabId, reason, queue }) => ({
      tabId,
      reason,
      keys: queue.map((entry) => entry.key)
    })),
    [
      { tabId: 51, reason: "set", keys: ["first"] },
      { tabId: 51, reason: "set", keys: ["first", "second"] },
      { tabId: 51, reason: "remove", keys: ["first"] },
      { tabId: 51, reason: "clear", keys: [] }
    ]
  );
});

test("spinner operation metadata survives progress-only updates", async () => {
  const { operations, queueByTabId } = createHarness();

  operations.setBackgroundSpinnerEntry(42, "navInspect", {
    message: "Inspecting",
    reason: "page-inspection-pending",
    startedAt: 2_000
  });

  await operations.updateBackgroundSpinnerEntry(42, "navInspect", {
    progress: 40
  });

  const entry = queueByTabId.get(42).get("navInspect");
  assert.equal(entry.operationKind, "content-bootstrap");
  assert.equal(entry.operationPhase, "page-inspection");
  assert.equal(entry.progress, 40);
});

test("spinner reason phase transitions do not inherit stale lease metadata", async () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(43, "ai", {
    message: "Preparing",
    reason: "tab-run-ai-preparing",
    startedAt: 1_000
  });

  await operations.updateBackgroundSpinnerEntry(43, "ai", {
    message: "Waiting",
    reason: "tab-run-ai-running"
  });

  const [entry] = operations.serializeSpinnerQueue(43);
  assert.equal(entry.operationId, "ai-run:remote-wait:43:1000");
  assert.equal(entry.operationKind, "ai-run");
  assert.equal(entry.operationPhase, "remote-wait");
  assert.equal(entry.timerMode, "countdown");
  assert.equal(entry.deadlineAt, 481_000);
  assert.deepEqual(entry.blockSurfaces, { page: true, popup: true });
});
