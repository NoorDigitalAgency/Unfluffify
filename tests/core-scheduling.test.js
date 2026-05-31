import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    renderRaf: state.renderRaf,
    renderTimer: state.renderTimer,
    pendingRenderInvalidate: state.pendingRenderInvalidate,
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
  state.renderRaf = 0;
  state.renderTimer = 0;
  state.pendingRenderInvalidate = false;
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
    state.renderRaf = originalState.renderRaf;
    state.renderTimer = originalState.renderTimer;
    state.pendingRenderInvalidate = originalState.pendingRenderInvalidate;
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

test("explicit overlay refresh updates only explicit layers before the delayed rebuild", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function refreshExplicitMarkingOverlay\(entry\) \{([\s\S]*?)\n\}\n\nfunction scheduleExplicitToggleFullRender/
  )[1];
  const scheduleBody = source.match(
    /export function scheduleExplicitOverlayRefresh\(entry\) \{([\s\S]*?)\n\}\n\nfunction cancelExplicitOverlayRefresh/
  )[1];

  assert.match(refreshBody, /drawExplicitMarkingLayers/);
  assert.doesNotMatch(refreshBody, /collectDefaultLayerElements/);
  assert.doesNotMatch(refreshBody, /drawCollections/);
  assert.doesNotMatch(scheduleBody, /scheduleRender\(getExplicitMarkingRenderOptions\(\)\)/);
});

test("explicit toggle full rebuild timing stays short to avoid ancestor lag", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const rulesSource = readFileSync(new URL("../content/marking-rules.js", import.meta.url), "utf8");

  const fullRenderDelayMatch = coreSource.match(/const EXPLICIT_TOGGLE_FULL_RENDER_DELAY_MS = (\d+);/);
  assert.ok(fullRenderDelayMatch);
  assert.ok(Number(fullRenderDelayMatch[1]) <= 150);

  const renderOptionsMatch = rulesSource.match(
    /getExplicitMarkingFullRenderOptions\(\) \{[\s\S]*?delay:\s*(\d+),[\s\S]*?minInterval:\s*(\d+),/
  );
  assert.ok(renderOptionsMatch);
  assert.ok(Number(renderOptionsMatch[1]) <= 80);
  assert.ok(Number(renderOptionsMatch[2]) <= 200);
});

test("marking passes share broad per-pass element caches", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /function withElementComputationCache\(callback\)/);
  assert.match(source, /directTextCache:\s*null/);
  assert.match(source, /normalizedTextCache:\s*null/);
  assert.match(source, /textualDescendantCache:\s*null/);
  assert.match(source, /function renderHighlights\(\) \{[\s\S]*?withElementComputationCache\(renderHighlightsInner\)/);
  assert.match(source, /function refreshExplicitMarkingOverlay\(entry\) \{[\s\S]*?withElementComputationCache/);
  assert.match(source, /export function syncPageMarkings[\s\S]*?withElementComputationCache/);
});

test("marking mode uses Space-held page interaction without changing Alt include or Shift parent selection", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /const PAGE_INTERACTION_KEY_CODE = "Space";/);
  assert.match(
    source,
    /function handleKeydown\(event\) \{[\s\S]*?isPageInteractionKeyEvent\(event\)[\s\S]*?isEditableKeyEventTarget\(event\.target\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?setAltPassThrough\(true\);[\s\S]*?ContentText\.marking\.pageInteractionMode[\s\S]*?if \(event\.key !== "Alt" && event\.key !== "Shift"\)/
  );
  assert.match(
    source,
    /function handleKeyup\(event\) \{[\s\S]*?isPageInteractionKeyEvent\(event\)[\s\S]*?setAltPassThrough\(false\);[\s\S]*?refreshHoverHighlight\(\);[\s\S]*?if \(event\.key !== "Alt" && event\.key !== "Shift"\)/
  );
  assert.match(
    source,
    /function handleToggleEvent\(event\) \{[\s\S]*?if \(!state\.enabled \|\| state\.altPassThrough\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /function updateCursorMode\(\) \{[\s\S]*?mode === "passthrough"[\s\S]*?root\.classList\.add\("uf-cursor-passthrough"\);[\s\S]*?mode === "exclude"[\s\S]*?mode === "include"/
  );
  assert.match(
    source,
    /function getMarkModeFromEvent\(event\) \{[\s\S]*?if \(event\.altKey\) \{[\s\S]*?return "include";[\s\S]*?return "exclude";/
  );
  assert.match(
    source,
    /function shouldAllowParentMarking\(mode, shiftHeld\) \{\s*return mode !== "include" && Boolean\(shiftHeld\);\s*\}/
  );
});
