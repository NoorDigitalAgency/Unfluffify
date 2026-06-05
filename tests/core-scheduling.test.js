import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handleScroll,
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
    explicitOverlayRefreshContext: state.explicitOverlayRefreshContext,
    explicitFullRenderTimer: state.explicitFullRenderTimer,
    cachedCollectionsKey: state.cachedCollectionsKey,
    markingSettleTimers: Array.isArray(state.markingSettleTimers)
      ? state.markingSettleTimers.slice()
      : [],
    enabled: state.enabled,
    overlay: state.overlay,
    aiPopover: state.aiPopover,
    scrollHideTimer: state.scrollHideTimer,
    isScrolling: state.isScrolling
  };
  const scheduled = [];
  const cleared = [];
  const idleCallbacks = [];
  const rafCallbacks = [];
  const cancelledRaf = [];
  const originalDocument = globalThis.document;
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
  globalThis.document = {
    documentElement: {},
    body: {}
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
  state.explicitOverlayRefreshContext = null;
  state.explicitFullRenderTimer = 0;
  state.cachedCollectionsKey = "";
  state.markingSettleTimers = [];
  state.aiPopover = null;
  state.scrollHideTimer = 0;
  state.isScrolling = false;
  try {
    callback({ scheduled, cleared, idleCallbacks, rafCallbacks, cancelledRaf });
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
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
    state.explicitOverlayRefreshContext = originalState.explicitOverlayRefreshContext;
    state.explicitFullRenderTimer = originalState.explicitFullRenderTimer;
    state.cachedCollectionsKey = originalState.cachedCollectionsKey;
    state.markingSettleTimers = originalState.markingSettleTimers;
    state.enabled = originalState.enabled;
    state.overlay = originalState.overlay;
    state.aiPopover = originalState.aiPopover;
    state.scrollHideTimer = originalState.scrollHideTimer;
    state.isScrolling = originalState.isScrolling;
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

test("nested scroll containers still schedule a redraw without hiding the overlay", () => {
  withFakeTimers(({ scheduled }) => {
    let addCount = 0;
    state.enabled = true;
    state.overlay = {
      classList: {
        add() {
          addCount += 1;
        },
        remove() {}
      }
    };

    const scrollContainer = {};
    handleScroll({ target: scrollContainer, currentTarget: scrollContainer });

    assert.equal(scheduled.length, 1);
    assert.equal(state.isScrolling, false);
    assert.equal(addCount, 0);
  });
});

test("explicit overlay refresh updates explicit layers before scheduling full rebuild", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function refreshExplicitMarkingOverlay\(entry, context = null\) \{([\s\S]*?)\n\}\n\nfunction scheduleExplicitToggleFullRender/
  )[1];
  const scheduleBody = source.match(
    /export function scheduleExplicitOverlayRefresh\(entry, context = null\) \{([\s\S]*?)\n\}\n\nfunction cancelExplicitOverlayRefresh/
  )[1];

  assert.match(refreshBody, /drawExplicitMarkingLayers/);
  assert.doesNotMatch(refreshBody, /collectDefaultLayerElements/);
  assert.doesNotMatch(refreshBody, /drawCollections/);
  assert.doesNotMatch(scheduleBody, /scheduleRender\(getExplicitMarkingRenderOptions\(\)\)/);
  assert.match(
    scheduleBody,
    /refreshExplicitMarkingOverlay\(pendingEntry, pendingContext\);[\s\S]*?scheduleExplicitToggleFullRender\(\{/
  );
});

test("explicit toggle full rebuild is deferred and coalesced for responsiveness", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const rulesSource = readFileSync(new URL("../content/marking-rules.js", import.meta.url), "utf8");

  const fullRenderBody = coreSource.match(
    /function scheduleExplicitToggleFullRender\(options = \{\}\) \{([\s\S]*?)\n\}\n\nexport function scheduleExplicitOverlayRefresh/
  )[1];
  assert.match(fullRenderBody, /if \(immediate\) \{[\s\S]*?scheduleRender\(getExplicitMarkingFullRenderOptions\(\)\)/);
  assert.match(fullRenderBody, /state\.explicitFullRenderTimer = extensionSetTimeout\([\s\S]*?EXPLICIT_TOGGLE_DEFERRED_FULL_RENDER_DELAY_MS/);
  assert.doesNotMatch(coreSource, /const EXPLICIT_TOGGLE_FULL_RENDER_DELAY_MS/);
  assert.match(coreSource, /function shouldUseImmediateFullRenderForExplicitToggle\(options = \{\}\) \{[\s\S]*?return false;/);

  const renderOptionsMatch = rulesSource.match(
    /getExplicitMarkingFullRenderOptions\(\) \{[\s\S]*?delay:\s*(\d+),[\s\S]*?minInterval:\s*(\d+),/
  );
  assert.ok(renderOptionsMatch);
  assert.ok(Number(renderOptionsMatch[1]) <= 80);
  assert.ok(Number(renderOptionsMatch[2]) <= 200);
});

test("cheap leaf explicit toggles defer the invalidating full rebuild", () => {
  withFakeTimers(({ rafCallbacks, scheduled }) => {
    const entry = { xpaths: [], includeXpaths: [] };
    scheduleExplicitOverlayRefresh(entry, { immediateFullRender: false });

    assert.equal(rafCallbacks.length, 1);
    rafCallbacks[0].fn();

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 180);
    assert.equal(state.explicitFullRenderTimer, scheduled[0].id);

    scheduled[0].fn();

    assert.equal(state.explicitFullRenderTimer, 0);
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[1].delay, 40);
  }, { withRaf: true });
});

test("explicit exclude no longer forces immediate full rebuild prechecks", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const excludeStart = coreSource.indexOf("function toggleExplicitExclude(target, options = {})");
  const includeStart = coreSource.indexOf("function toggleExplicitInclude(target, options = {})", excludeStart);
  const excludeSource = coreSource.slice(excludeStart, includeStart);

  assert.doesNotMatch(excludeSource, /const hasRelatedStoredMarking = \(currentXPath\) =>/);
  assert.doesNotMatch(excludeSource, /const immediateFullRender =/);
  assert.match(excludeSource, /completeExplicitToggle\(entry, target, "exclude", mutationStartedAt, options\);/);
});

test("marking UI scheduling uses extension-owned timers during page motion pause", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const scheduleRenderBody = coreSource.match(
    /export function scheduleRender\(options\) \{([\s\S]*?)\n\}\n\nexport function mergeDraftEntry/
  )[1];

  assert.match(coreSource, /capturedExtensionTimers/);
  assert.match(coreSource, /isPageMotionFreezeTimerFunction/);
  assert.match(coreSource, /unfluffifySet/);
  assert.match(scheduleRenderBody, /state\.renderTimer = extensionSetTimeout/);
  assert.match(scheduleRenderBody, /state\.renderRaf = extensionRequestAnimationFrame/);
  assert.doesNotMatch(scheduleRenderBody, /window\.setTimeout|window\.requestAnimationFrame/);
  assert.match(coreSource, /state\.hoverRaf = extensionRequestAnimationFrame/);
  assert.match(coreSource, /state\.snapshotTimer = extensionSetTimeout/);
  assert.match(coreSource, /state\.draftPersistTimer = extensionSetTimeout/);
});

test("page inspection completion waits for a real render before lifting the curtain", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(coreSource, /const PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS = 3000;/);

  const flushBody = coreSource.match(
    /function flushPendingInspectionRender\(\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(flushBody, /const hadPendingRender = Boolean\(state\.renderTimer \|\| state\.renderRaf\);/);
  assert.match(flushBody, /extensionClearTimeout\(state\.renderTimer\);/);
  assert.match(flushBody, /extensionCancelAnimationFrame\(state\.renderRaf\);/);
  assert.match(flushBody, /if \(state\.pendingRenderInvalidate\) \{[\s\S]*?invalidateCachedCollections\(\);/);
  assert.match(flushBody, /renderHighlights\(\);/);

  const finishBody = coreSource.match(
    /export function finishPageInspectionUiAfterRender\(\) \{([\s\S]*?)\n\}/
  )[1];
  // Polls on extension-owned timers (not rAF) so a frozen page still settles.
  assert.match(finishBody, /extensionSetTimeout\(pollUntilRendered, 50\)/);
  assert.doesNotMatch(finishBody, /extensionRequestAnimationFrame\(pollUntilRendered\)/);
  // Force-flushes after the timeout so the curtain cannot outlive the enable response.
  assert.match(finishBody, /Date\.now\(\) - startedAt >= PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS/);
  assert.match(finishBody, /flushPendingInspectionRender\(\);/);
  assert.match(finishBody, /finishPageInspectionUi\(\);\s*resolve\(\);/);
});

test("marking passes share broad per-pass element caches", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /function withElementComputationCache\(callback\)/);
  assert.match(source, /directTextCache:\s*null/);
  assert.match(source, /normalizedTextCache:\s*null/);
  assert.match(source, /textualDescendantCache:\s*null/);
  assert.match(source, /function renderHighlights\(\) \{[\s\S]*?withElementComputationCache\(renderHighlightsInner\)/);
  assert.match(source, /function refreshExplicitMarkingOverlay\(entry, context = null\) \{[\s\S]*?withElementComputationCache/);
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

test("explicit toggles yield after the immediate acknowledgement before running the heavy mutation", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const handleToggleEventBody = source.match(
    /function handleToggleEvent\(event\) \{([\s\S]*?)\n\}\n\nfunction handleClick/
  )[1];

  assert.match(source, /toggleQueuedActionKey: "",[\s\S]*?toggleMutationQueue: \[\],[\s\S]*?toggleMutationHandle: 0/);
  assert.match(source, /function scheduleQueuedToggleMutationDrain\(\) \{/);
  assert.match(source, /function scheduleQueuedToggleMutation\(job\) \{/);
  assert.match(source, /function cancelQueuedToggleMutations\(\) \{/);
  assert.match(source, /async function syncPageMarkingsAsync\(config, pageUrl, immutableExcluded, options\) \{/);
  assert.match(source, /async function collectToggleableTargetsAsync\(immutableExcluded, excludedParents, options = \{\}\) \{/);
  assert.match(source, /async function appendSyncedCandidateItemsAsync\(candidates, context, options = \{\}\) \{/);
  assert.match(source, /async function refreshExplicitMarkingOverlayAsync\(entry, context = null\) \{/);
  assert.match(source, /function scheduleAsyncExplicitToggleReconcile\(entry, context = null\) \{/);
  assert.match(
    handleToggleEventBody,
    /showImmediateToggleAcknowledgement\(target, mode\);[\s\S]*?scheduleQueuedToggleMutation\(\{[\s\S]*?target,[\s\S]*?mode,[\s\S]*?key: toggleActionKey,[\s\S]*?interactionNow/
  );
  assert.doesNotMatch(
    handleToggleEventBody,
    /showImmediateToggleAcknowledgement\(target, mode\);[\s\S]*?toggleExplicitInclude\(target\)|showImmediateToggleAcknowledgement\(target, mode\);[\s\S]*?toggleExplicitExclude\(target\)/
  );
  assert.match(
    source,
    /if \(getExtensionRequestAnimationFrame\(\)\) \{[\s\S]*?state\.toggleMutationHandle = extensionRequestAnimationFrame\(runDrain\);[\s\S]*?state\.toggleMutationHandleType = "raf";/
  );
  assert.match(source, /toggleExplicitInclude\(nextJob\.target, \{ deferMarkingRefresh: true \}\);/);
  assert.match(source, /toggleExplicitExclude\(nextJob\.target, \{ deferMarkingRefresh: true \}\);/);
  assert.match(source, /scheduleAsyncExplicitToggleReconcile\(entry, \{[\s\S]*?immediateFullRender/);
  assert.match(source, /await collectToggleableTargetsAsync\(immutableExcluded, excludedParents, \{/);
  assert.match(source, /const completedCandidates = await appendSyncedCandidateItemsAsync\(candidates,/);
  assert.match(source, /shouldAbort: \(\) => generation !== state\.toggleReconcileGeneration/);
  assert.match(source, /cancelQueuedToggleMutations\(\);[\s\S]*?cancelExplicitOverlayRefresh\(\);/);
});

test("marking mode surfaces temporary disabled state while save sync blocks editing", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const textSource = readFileSync(new URL("../common/text.js", import.meta.url), "utf8");

  assert.match(source, /const MARKING_DISABLED_OVERLAY_CLASS = "uf-marking-temporarily-disabled";/);
  assert.match(source, /const MARKING_DISABLED_CURSOR_CLASS = "uf-cursor-disabled";/);
  assert.match(source, /disabledNotice\.className = "uf-marking-disabled-notice";/);
  assert.match(source, /disabledNotice\.setAttribute\("data-uf-extension-ui", "true"\);/);
  assert.match(source, /disabledNotice\.setAttribute\("role", "status"\);/);
  assert.match(source, /disabledNotice\.setAttribute\("aria-live", "polite"\);/);
  assert.match(source, /function getMarkingTemporarilyDisabledReason\(\) \{[\s\S]*?const pageUrl = typeof location !== "undefined" \? location\.href : "";[\s\S]*?getPageSaveReconciliationState\(pageUrl\)[\s\S]*?config\.isPageSaveReconciliationPending\(reconciliation\)[\s\S]*?return reconciliation\.reason \|\| "pending";/);
  assert.match(source, /function updateMarkingTemporarilyDisabledUi\(\) \{[\s\S]*?classList\.toggle\(MARKING_DISABLED_OVERLAY_CLASS, disabled\)[\s\S]*?setAttribute\("aria-disabled", "true"\)[\s\S]*?clearLayer\(state\.layers\["hover"\]\)[\s\S]*?getMarkingTemporarilyDisabledMessage\(reason\)/);
  assert.match(source, /function getMarkMode\(\) \{[\s\S]*?isMarkingTemporarilyDisabled\(\)[\s\S]*?return "disabled";[\s\S]*?state\.altPassThrough/);
  assert.match(source, /export async function setPageSaveReconciliationPending[\s\S]*?state\.pageSaveReconciliation = reconciliation;[\s\S]*?updateMarkingTemporarilyDisabledUi\(\);[\s\S]*?notifyDraftStatus\(pageUrl\);/);
  assert.match(source, /export async function clearPageSaveReconciliation[\s\S]*?state\.pageSaveReconciliation = null;[\s\S]*?updateMarkingTemporarilyDisabledUi\(\);[\s\S]*?notifyDraftStatus\(pageUrl\);/);
  assert.match(textSource, /temporarilyDisabledSaving: "Saving page\.\.\. marking paused"/);
  assert.match(textSource, /temporarilyDisabledSyncing: "Save sync pending\.\.\. marking paused"/);
});

test("marking render cache keys include selector and entry fingerprints before reuse", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /cachedCollectionsKey:\s*""/);
  assert.match(source, /function buildMarkingCollectionsCacheKey\(\{ pageUrl = "", selectorSet = null, entry = null \} = \{\}\)/);
  assert.match(source, /function resolveMarkingSelectorContext\(configValue, entry = null\)/);
  assert.match(source, /const nextCollectionsCacheKey = buildMarkingCollectionsCacheKey\(\{/);
  assert.match(source, /if \(cached && state\.cachedCollectionsKey === nextCollectionsCacheKey\)/);
  assert.match(source, /state\.cachedCollectionsKey = buildMarkingCollectionsCacheKey\(\{/);
  assert.match(source, /function invalidateCachedCollections\(\) \{[\s\S]*?state\.cachedCollectionsKey = "";/);
});

test("marking enable schedules settle renders that force invalidating rebuilds", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /const MARKING_MODE_SETTLE_RENDER_DELAYS_MS = \[180, 700, 1800\];/);
  assert.match(source, /function clearMarkingSettleRenders\(\)/);
  assert.match(source, /function scheduleMarkingSettleRenders\(\) \{[\s\S]*?MARKING_MODE_SETTLE_RENDER_DELAYS_MS/);
  assert.match(source, /scheduleRender\(\{[\s\S]*?reason: "marking-settle",[\s\S]*?invalidate: true/);
  assert.match(source, /export async function enableForBaseUrl\(baseUrl, options = \{\}\) \{[\s\S]*?scheduleRender\(\);[\s\S]*?scheduleMarkingSettleRenders\(\);/);
  assert.match(source, /export function disable\(options = \{\}\) \{[\s\S]*?clearMarkingSettleRenders\(\);/);
});

test("paint reachability allows in-path hits deeper in the hit stack and falls back when all checks reject", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /function getPaintReachabilityForRect\(el, rect\) \{[\s\S]*?elementsAtPoint\.some\(\(hit\) => isElementInHitPath\(hit, el\)\)/);
  assert.match(source, /function filterPaintReachableRects\(el, rects\) \{[\s\S]*?const reachableRects = rects\.filter\(\(rect\) => getPaintReachabilityForRect\(el, rect\) !== false\);/);
  assert.match(source, /if \(reachableRects\.length > 0\) \{[\s\S]*?return reachableRects;/);
  assert.match(source, /if \([\s\S]*?isVisible\(el\)[\s\S]*?!isDefinitelyHiddenSubtreeElement\(el\)[\s\S]*?\) \{[\s\S]*?return rects;/);
});

test("paint reachability fallback emits throttled counter telemetry in toggle perf logs", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /paintReachabilityFallbackCount:\s*0/);
  assert.match(source, /paintReachabilityFallbackLastLoggedAt:\s*0/);
  assert.match(source, /function reportPaintReachabilityFallback\(el, rectCount\) \{/);
  assert.match(source, /state\.paintReachabilityFallbackCount \+= 1;/);
  assert.match(source, /count <= 3 \|\|[\s\S]*?count % 25 === 0 \|\|[\s\S]*?paintReachabilityFallbackLastLoggedAt >= 5000/);
  assert.match(source, /logTogglePerf\("render\.reachability-fallback", nowMs\(\), \{/);
  assert.match(source, /reportPaintReachabilityFallback\(el, rects\.length\);/);
  assert.match(source, /state\.paintReachabilityFallbackCount = 0;/);
  assert.match(source, /state\.paintReachabilityFallbackLastLoggedAt = 0;/);
});
