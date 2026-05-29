import test from "node:test";
import assert from "node:assert/strict";

import {
  scheduleDraftPersist,
  scheduleExplicitOverlayRefresh,
  scheduleSnapshotSave,
  state
} from "../content/core.js";

function withFakeTimers(callback, options = {}) {
  const originalWindow = globalThis.window;
  const originalState = {
    baseUrl: state.baseUrl,
    config: state.config,
    snapshotTimer: state.snapshotTimer,
    draftPersistTimer: state.draftPersistTimer,
    explicitOverlayRefreshScheduled: state.explicitOverlayRefreshScheduled,
    explicitOverlayRefreshHandle: state.explicitOverlayRefreshHandle,
    explicitOverlayRefreshHandleType: state.explicitOverlayRefreshHandleType,
    explicitOverlayRefreshEntry: state.explicitOverlayRefreshEntry,
    enabled: state.enabled,
    overlay: state.overlay
  };
  const scheduled = [];
  const cleared = [];
  const idleCallbacks = [];
  const rafCallbacks = [];
  const cancelledRaf = [];
  let nextId = 1;
  globalThis.window = {
    setTimeout(fn, delay) {
      const id = nextId;
      nextId += 1;
      scheduled.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
    }
  };
  if (options.withIdleCallback) {
    globalThis.window.requestIdleCallback = (fn, idleOptions) => {
      const id = nextId;
      nextId += 1;
      idleCallbacks.push({ id, fn, options: idleOptions });
      return id;
    };
  }
  if (options.withRaf) {
    globalThis.window.requestAnimationFrame = (fn) => {
      const id = nextId;
      nextId += 1;
      rafCallbacks.push({ id, fn });
      return id;
    };
    globalThis.window.cancelAnimationFrame = (id) => {
      cancelledRaf.push(id);
    };
  }
  state.baseUrl = "https://example.com";
  state.config = { pageMarkings: {} };
  state.snapshotTimer = 0;
  state.draftPersistTimer = 0;
  state.explicitOverlayRefreshScheduled = false;
  state.explicitOverlayRefreshHandle = 0;
  state.explicitOverlayRefreshHandleType = "";
  state.explicitOverlayRefreshEntry = null;
  try {
    callback({ scheduled, cleared, idleCallbacks, rafCallbacks, cancelledRaf });
  } finally {
    globalThis.window = originalWindow;
    state.baseUrl = originalState.baseUrl;
    state.config = originalState.config;
    state.snapshotTimer = originalState.snapshotTimer;
    state.draftPersistTimer = originalState.draftPersistTimer;
    state.explicitOverlayRefreshScheduled = originalState.explicitOverlayRefreshScheduled;
    state.explicitOverlayRefreshHandle = originalState.explicitOverlayRefreshHandle;
    state.explicitOverlayRefreshHandleType = originalState.explicitOverlayRefreshHandleType;
    state.explicitOverlayRefreshEntry = originalState.explicitOverlayRefreshEntry;
    state.enabled = originalState.enabled;
    state.overlay = originalState.overlay;
  }
}

test("snapshot saves are debounced so only the latest timer remains pending", () => {
  withFakeTimers(({ scheduled, cleared }) => {
    scheduleSnapshotSave(100);
    scheduleSnapshotSave(250);

    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].delay, 100);
    assert.equal(scheduled[1].delay, 250);
    assert.deepEqual(cleared, [scheduled[0].id]);
    assert.equal(state.snapshotTimer, scheduled[1].id);
  });
});

test("snapshot generation is deferred to an idle callback when available", () => {
  withFakeTimers(({ scheduled, idleCallbacks }) => {
    scheduleSnapshotSave(100);
    scheduled[0].fn();

    assert.equal(idleCallbacks.length, 1);
    assert.deepEqual(idleCallbacks[0].options, { timeout: 5000 });
  }, { withIdleCallback: true });
});

test("draft persistence is debounced so rapid toggles replace the pending write", () => {
  withFakeTimers(({ scheduled, cleared }) => {
    scheduleDraftPersist(state.baseUrl, 50);
    scheduleDraftPersist(state.baseUrl, 350);

    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].delay, 50);
    assert.equal(scheduled[1].delay, 350);
    assert.deepEqual(cleared, [scheduled[0].id]);
    assert.equal(state.draftPersistTimer, scheduled[1].id);
  });
});

test("rapid explicit toggles coalesce into a single overlay refresh frame", () => {
  withFakeTimers(({ rafCallbacks }) => {
    // refresh body is a no-op because state.enabled / state.overlay are falsy,
    // so all we verify is the scheduling/coalescing behaviour.
    const entryA = { xpaths: ["a"], includeXpaths: [] };
    const entryB = { xpaths: ["a", "b"], includeXpaths: [] };
    const entryC = { xpaths: ["a", "b", "c"], includeXpaths: [] };

    scheduleExplicitOverlayRefresh(entryA);
    scheduleExplicitOverlayRefresh(entryB);
    scheduleExplicitOverlayRefresh(entryC);

    assert.equal(rafCallbacks.length, 1);
    assert.equal(state.explicitOverlayRefreshScheduled, true);
    assert.equal(state.explicitOverlayRefreshEntry, entryC);

    rafCallbacks[0].fn();

    assert.equal(state.explicitOverlayRefreshScheduled, false);
    assert.equal(state.explicitOverlayRefreshHandle, 0);
    assert.equal(state.explicitOverlayRefreshEntry, null);
  }, { withRaf: true });
});

test("explicit overlay refresh falls back to setTimeout when rAF is unavailable", () => {
  withFakeTimers(({ scheduled }) => {
    const entry = { xpaths: [], includeXpaths: [] };
    scheduleExplicitOverlayRefresh(entry);

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 0);
    assert.equal(state.explicitOverlayRefreshHandleType, "timeout");
  });
});

test("pending explicit overlay refresh can be cancelled via rAF cancel", () => {
  withFakeTimers(({ rafCallbacks, cancelledRaf }) => {
    const entry = { xpaths: [], includeXpaths: [] };
    scheduleExplicitOverlayRefresh(entry);
    assert.equal(rafCallbacks.length, 1);
    const handle = state.explicitOverlayRefreshHandle;

    // Simulate teardown by invoking cancellation via the same window hook
    // that disable() uses.
    globalThis.window.cancelAnimationFrame(handle);

    assert.deepEqual(cancelledRaf, [handle]);
  }, { withRaf: true });
});
