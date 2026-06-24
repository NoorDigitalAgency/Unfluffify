import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewComputeLockHandler } from "../content/ai-preview-compute-lock-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    beginModes: [],
    setItems: [],
    scheduled: [],
    refreshed: 0,
    exited: 0,
    cleared: 0
  };

  const deps = {
    beginAiPreviewMode: (options) => {
      calls.beginModes.push(options);
    },
    setAiPreviewItems: (items) => {
      calls.setItems.push(items);
    },
    scheduleAiComputeLockRelease: (expiresAt) => {
      calls.scheduled.push(expiresAt);
    },
    refreshSilentHighlightings: () => {
      calls.refreshed += 1;
      return Promise.resolve();
    },
    isComputeLockPreviewActive: () => false,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    exitAiPreviewMode: async () => {
      calls.exited += 1;
    },
    hasComputeLockReleaseTimer: () => false,
    clearComputeLockReleaseTimer: () => {
      calls.cleared += 1;
    },
    ...overrides
  };

  return {
    calls,
    deps
  };
}

test("compute-lock handler starts lock mode and schedules release", async () => {
  const { calls, deps } = createDeps();
  const handler = createAiPreviewComputeLockHandler(deps);

  const response = await handler.handleMessage({ active: true, expiresAt: "120" });

  assert.deepEqual(response, { ok: true, active: true });
  assert.deepEqual(calls.beginModes, [{ mode: "compute_lock" }]);
  assert.deepEqual(calls.setItems, [[]]);
  assert.deepEqual(calls.scheduled, [120]);
  assert.equal(calls.refreshed, 1);
  assert.equal(calls.exited, 0);
  assert.equal(calls.cleared, 0);
});

test("compute-lock handler exits preview mode when lock is being released", async () => {
  const { calls, deps } = createDeps({
    isComputeLockPreviewActive: () => true
  });
  const handler = createAiPreviewComputeLockHandler(deps);

  const response = await handler.handleMessage({ active: false });

  assert.deepEqual(response, { ok: true, active: false });
  assert.equal(calls.exited, 1);
  assert.equal(calls.cleared, 0);
});

test("compute-lock handler clears orphan release timers when lock preview is inactive", async () => {
  const { calls, deps } = createDeps({
    hasComputeLockReleaseTimer: () => true
  });
  const handler = createAiPreviewComputeLockHandler(deps);

  const response = await handler.handleMessage({ active: false });

  assert.deepEqual(response, { ok: true, active: false });
  assert.equal(calls.exited, 0);
  assert.equal(calls.cleared, 1);
});
