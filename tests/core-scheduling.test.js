import test from "node:test";
import assert from "node:assert/strict";

import {
  scheduleDraftPersist,
  scheduleSnapshotSave,
  state
} from "../content/core.js";

function withFakeTimers(callback, options = {}) {
  const originalWindow = globalThis.window;
  const originalState = {
    baseUrl: state.baseUrl,
    config: state.config,
    snapshotTimer: state.snapshotTimer,
    draftPersistTimer: state.draftPersistTimer
  };
  const scheduled = [];
  const cleared = [];
  const idleCallbacks = [];
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
  state.baseUrl = "https://example.com";
  state.config = { pageMarkings: {} };
  state.snapshotTimer = 0;
  state.draftPersistTimer = 0;
  try {
    callback({ scheduled, cleared, idleCallbacks });
  } finally {
    globalThis.window = originalWindow;
    state.baseUrl = originalState.baseUrl;
    state.config = originalState.config;
    state.snapshotTimer = originalState.snapshotTimer;
    state.draftPersistTimer = originalState.draftPersistTimer;
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

  test("snapshot generation is deferred to an idle callback when available", () => {
    withFakeTimers(({ scheduled, idleCallbacks }) => {
      scheduleSnapshotSave(100);
      scheduled[0].fn();

      assert.equal(idleCallbacks.length, 1);
      assert.deepEqual(idleCallbacks[0].options, { timeout: 5000 });
    }, { withIdleCallback: true });
  });
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
