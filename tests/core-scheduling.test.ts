import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  disable,
  handleScroll,
  resetNavigationNotifierForTests,
  scheduleDraftPersist,
  scheduleExplicitOverlayRefresh,
  scheduleSnapshotSave,
  startUrlWatcher,
  state
} from "../src/content/core.js";

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

async function withDisableFlushHarness(callback) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalChrome = globalThis.chrome;
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalState = {};
  Object.keys(state).forEach((key) => {
    originalState[key] = state[key];
  });
  const pageUrl = "https://example.com/page";
  const baseUrl = "https://example.com";
  const scheduled = [];
  const cleared = [];
  const intervals = [];
  const clearedIntervals = [];
  const dispatchedEvents = [];
  const runtimeMessages = [];
  const windowListeners = {};
  let nextId = 1;
  const classList = {
    add() {},
    remove() {},
    toggle() {}
  };
  const fakeElement = {
    nodeType: 1,
    tagName: "HTML",
    classList,
    style: {
      length: 0,
      setProperty() {},
      removeProperty() {}
    },
    attributes: [],
    appendChild() {},
    remove() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    querySelectorAll() {
      return [];
    },
    cloneNode() {
      return this;
    }
  };

  globalThis.window = {
    setTimeout(fn, delay) {
      const id = nextId;
      nextId += 1;
      scheduled.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
    setInterval(fn, delay) {
      const id = nextId;
      nextId += 1;
      intervals.push({ id, fn, delay });
      return id;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
    },
    addEventListener(type, fn) {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const handlers = windowListeners[type];
      if (!handlers) {
        return;
      }
      const index = handlers.indexOf(fn);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event && event.type);
      return true;
    },
    postMessage() {},
    history: {
      pushState() {},
      replaceState() {}
    }
  };
  globalThis.document = {
    title: "Example Page",
    documentElement: fakeElement,
    body: fakeElement,
    head: fakeElement,
    addEventListener() {},
    removeEventListener() {},
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return { ...fakeElement };
    }
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getURL(path = "") {
        return `chrome-extension://unfluffify/${path}`;
      },
      sendMessage(message) {
        runtimeMessages.push(message);
        if (message && message.type === "idbGet") {
          return Promise.resolve({ ok: true, result: { configs: {} } });
        }
        if (message && message.type === "idbSet") {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      }
    }
  };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      href: pageUrl,
      origin: baseUrl
    }
  });
  Object.assign(state, {
    enabled: true,
    baseUrl,
    currentPageType: "",
    config: {
      pageMarkings: {
        [pageUrl]: {
          title: "Example Page",
          timestamp: "2026-06-06T00:00:00.000Z",
          xpaths: [{ xpath: "/html/body/main", excluded: true, explicit: true }],
          includeXpaths: [],
          selectorSuppressedXpaths: [],
          silentWhitespaceExcludedXpaths: [],
          submissionXpaths: [],
          renderedHtml: "",
          rawHtml: ""
        }
      }
    },
    overlay: null,
    layers: {},
    aiPopover: null,
    renderRaf: 0,
    renderTimer: 0,
    explicitFullRenderTimer: 0,
    pendingRenderInvalidate: false,
    scrollHideTimer: 0,
    snapshotTimer: 0,
    draftPersistTimer: 0,
    urlCheckTimer: 0,
    mutationObserver: null,
    savedPageEntry: null,
    savedPageUrl: "",
    cleanBaselineFingerprintByPageUrl: new Map(),
    pageSaveReconciliation: null,
    disabledUnsavedDraft: null,
    consentRootElements: new Set(),
    layerBoxes: new WeakMap(),
    cachedCollections: null,
    markingSettleTimers: [],
    hoverRaf: 0,
    currentPageUrl: pageUrl,
    currentPageEntry: null,
    toggleAckTimer: 0,
    toggleMutationQueue: [],
    toggleMutationHandle: 0,
    toggleMutationHandleType: "",
    explicitOverlayRefreshScheduled: false,
    explicitOverlayRefreshHandle: 0,
    explicitOverlayRefreshHandleType: "",
    explicitOverlayRefreshEntry: null,
    explicitOverlayRefreshContext: null,
    pageMotionPause: null,
    lazyLoadSuppressRestorer: null
  });

  try {
    resetNavigationNotifierForTests();
    await callback({
      baseUrl,
      pageUrl,
      scheduled,
      cleared,
      intervals,
      clearedIntervals,
      dispatchedEvents,
      runtimeMessages,
      windowListeners
    });
  } finally {
    resetNavigationNotifierForTests();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
    if (originalLocationDescriptor) {
      Object.defineProperty(globalThis, "location", originalLocationDescriptor);
    } else {
      delete globalThis.location;
    }
    Object.keys(originalState).forEach((key) => {
      state[key] = originalState[key];
    });
  }
}

async function flushPendingPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test("disable flushes a pending draft persist using the pre-clear base URL and config", async () => {
  await withDisableFlushHarness(async ({ baseUrl, pageUrl, cleared, runtimeMessages }) => {
    state.draftPersistTimer = 77;

    disable();
    await flushPendingPromises();

    assert.equal(state.draftPersistTimer, 0);
    assert.deepEqual(cleared, [77]);
    const saveMessage = runtimeMessages.find((message) => message.type === "idbSet");
    assert.ok(saveMessage, "disable should persist the pending draft before teardown completes");
    assert.ok(saveMessage.items.configs[baseUrl], "save should use the captured base URL");
    assert.equal(saveMessage.items.configs[""], undefined);
    assert.equal(
      saveMessage.items.configs[baseUrl].pageMarkings[pageUrl].xpaths[0].xpath,
      "/html/body/main"
    );
  });
});

test("disable does not persist when no draft or snapshot timer is pending", async () => {
  await withDisableFlushHarness(async ({ runtimeMessages }) => {
    disable();
    await flushPendingPromises();

    assert.equal(runtimeMessages.some((message) => message.type === "idbSet"), false);
  });
});

test("URL watcher disables marking without preserving drafts across same-base same-document URL changes", async () => {
  const cases = [
    ["pushState", "https://example.com/page/details"],
    ["replaceState", "https://example.com/page?step=2"],
    ["hash", "https://example.com/page#details"]
  ];

  for (const [label, nextUrl] of cases) {
    await withDisableFlushHarness(async ({
      pageUrl,
      dispatchedEvents,
      windowListeners
    }) => {
      state.cleanBaselineFingerprintByPageUrl.set(pageUrl, "clean-before-user-edit");

      startUrlWatcher();
      globalThis.location.href = nextUrl;
      if (label === "hash") {
        (windowListeners.hashchange || []).forEach((fn) => fn());
      } else {
        globalThis.window.history[label]({}, "", nextUrl);
      }

      assert.equal(state.enabled, false, label);
      // Marking data only lives while marking is enabled: no unsaved-draft cache
      // survives the navigation, so the next enable starts fresh.
      assert.equal(state.disabledUnsavedDraft || null, null, label);
      assert.deepEqual(dispatchedEvents, ["unfluffify:url-changed"], label);
    });
  }
});

test("URL watcher discards temporary draft cache for clean or cross-base URL changes", async () => {
  const cases = [
    {
      label: "clean same-base",
      nextUrl: "https://example.com/page#clean",
      dirty: false
    },
    {
      label: "dirty cross-base",
      nextUrl: "https://other.example/page",
      dirty: true
    }
  ];

  for (const { label, nextUrl, dirty } of cases) {
    await withDisableFlushHarness(async ({ pageUrl, dispatchedEvents, windowListeners }) => {
      if (dirty) {
        state.cleanBaselineFingerprintByPageUrl.set(pageUrl, "clean-before-user-edit");
      }

      startUrlWatcher();
      globalThis.location.href = nextUrl;
      if (nextUrl.includes("#")) {
        (windowListeners.hashchange || []).forEach((fn) => fn());
      } else {
        (windowListeners.popstate || []).forEach((fn) => fn());
      }

      assert.equal(state.enabled, false, label);
      assert.equal(state.disabledUnsavedDraft, null, label);
      assert.deepEqual(dispatchedEvents, ["unfluffify:url-changed"], label);
    });
  }
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
    assert.equal(scheduled[1].delay, 0);
  }, { withRaf: true });
});

test("user-driven explicit toggles draw the marking overlay synchronously (issue #6)", () => {
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const completeStart = coreSource.indexOf("function completeExplicitToggle(");
  const completeBody = coreSource.slice(completeStart, coreSource.indexOf("\n}\n", completeStart));

  // Only non-immediate deferred toggles take the slower async reconcile; user
  // clicks (immediateFullRender) draw the explicit overlay synchronously so the
  // mark appears right away instead of after the ~2s async document re-scan.
  assert.match(completeBody, /options\.deferMarkingRefresh && !immediateFullRender/);
  assert.match(completeBody, /scheduleAsyncExplicitToggleReconcile\(entry, \{/);
  assert.match(completeBody, /\} else \{[\s\S]*?scheduleExplicitOverlayRefresh\(entry, \{/);
});

test("marking UI scheduling uses extension-owned timers during page motion pause", () => {
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const scheduleRenderBody = coreSource.match(
    /export function scheduleRender\(options(?:\s*\?:\s*[^)]+)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*export function mergeDraftEntry/
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

test("hover highlighting reuses the last probe result before re-running the expensive hover path", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const updateHoverBody = source.match(
    /function updateHoverHighlight\(\s*x(?:\s*:\s*[^,]+)?,\s*y(?:\s*:\s*[^,]+)?,\s*allowParent(?:\s*:\s*[^,]+)?,\s*allowExcludedParentChildren(?:\s*:\s*[^,]+)?,\s*allowImmutableChildren(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{([\s\S]*?)\n\}/
  )[1];

  assert.match(source, /function buildHoverHighlightOptionsKey\(/);
  assert.match(source, /function getHoverProbeElements\(/);
  assert.match(source, /function getHoverTargetBoundsKey\(/);
  assert.match(source, /function canReuseHoverHighlight\(/);
  assert.match(source, /function rememberHoverHighlight\(/);
  assert.match(source, /function clearHoverHighlight\(\)(?:: [^{]+)? \{[\s\S]*?invalidateHoverHighlightCache\(\);[\s\S]*?clearLayer\(state\.layers\["hover"\]\);/);
  assert.match(source, /function completeExplicitToggle\([\s\S]*?invalidateHoverHighlightCache\(\);[\s\S]*?(?:scheduleAsyncExplicitToggleReconcile|scheduleExplicitOverlayRefresh)\(/);
  assert.match(source, /function startObservers\(\) \{[\s\S]*?const renderMode = getMutationRenderMode\(mutations\);[\s\S]*?if \(renderMode === "none"\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?invalidateHoverHighlightCache\(\);[\s\S]*?scheduleRender\(\{[\s\S]*?delay: 120,[\s\S]*?minInterval: 250/);
  assert.match(
    updateHoverBody,
    /const hoverOptionsKey = buildHoverHighlightOptionsKey\([\s\S]*?const probeElements = getHoverProbeElements\(x, y\);[\s\S]*?if \(canReuseHoverHighlight\(probeElements, hoverOptionsKey\)\) \{\s*return;\s*\}[\s\S]*?const hoverResult = withElementComputationCache\(\(\) => \{[\s\S]*?const target = getMarkableTarget\(x, y, \{[\s\S]*?rememberHoverHighlight\(probeElements, hoverResult\.target, hoverOptionsKey\);/
  );
});

test("page inspection completion waits for a real render before lifting the curtain", () => {
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

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
  assert.match(finishBody, /finishPageInspectionUi\(\);(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*\s*resolve\(\);/);
});

test("marking mode uses Space-held page interaction without changing Alt include or Shift parent selection", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /const PAGE_INTERACTION_KEY_CODE = "Space";/);
  assert.match(
    source,
    /function handleKeydown\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?isPageInteractionKeyEvent\(event\)[\s\S]*?isEditableKeyEventTarget\(event\.target\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?setAltPassThrough\(true\);[\s\S]*?ContentText\.marking\.pageInteractionMode[\s\S]*?if \(event\.key !== "Alt" && event\.key !== "Shift"\)/
  );
  assert.match(
    source,
    /function handleKeyup\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?isPageInteractionKeyEvent\(event\)[\s\S]*?setAltPassThrough\(false\);[\s\S]*?refreshHoverHighlight\(\);[\s\S]*?if \(event\.key !== "Alt" && event\.key !== "Shift"\)/
  );
  assert.match(
    source,
    /function handleToggleEvent\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?if \(!state\.enabled \|\| state\.altPassThrough\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /function updateCursorMode\(\) \{[\s\S]*?mode === "passthrough"[\s\S]*?root\.classList\.add\("uf-cursor-passthrough"\);[\s\S]*?mode === "exclude"[\s\S]*?mode === "include"/
  );
  assert.match(
    source,
    /function getMarkModeFromEvent\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?if \(event\.altKey\) \{[\s\S]*?return "include";[\s\S]*?return "exclude";/
  );
  assert.match(
    source,
    /function shouldAllowParentMarking\(\s*mode(?:\s*:\s*[^,]+)?\s*,\s*shiftHeld(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{\s*return mode !== "include" && Boolean\(shiftHeld\);\s*\}/
  );
});

test("explicit toggles acknowledge immediately and queue the heavy mutation work", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const handleToggleEventBody = source.match(
    /function handleToggleEvent\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*function handleClick/
  )[1];

  assert.match(source, /function scheduleQueuedToggleMutationDrain\(\) \{/);
  assert.match(source, /function scheduleQueuedToggleMutation\(job(?:\s*:\s*[^)]+)?\) \{/);
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
  assert.match(
    source,
    /if \(Array\.isArray\(state\.toggleMutationQueue\) && state\.toggleMutationQueue\.length\) \{[\s\S]*?scheduleQueuedToggleMutationDrain\(\);/
  );
  assert.match(source, /toggleExplicitInclude\(nextJob\.target, \{ deferMarkingRefresh: true, immediateFullRender: true \}\);/);
  assert.match(source, /toggleExplicitExclude\(nextJob\.target, \{ deferMarkingRefresh: true, immediateFullRender: true \}\);/);
});

test("async explicit-toggle reconcile aborts before committing stale entry state", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function syncPageMarkingsInnerAsync");
  assert.notEqual(start, -1);
  const syncBody = source.slice(start);

  assert.match(
    syncBody,
    /const abortResult = \(\) => \(\{ changed: false, entry, persisted: false, hadEntry, aborted: true \}\);/
  );
  const changedIndex = syncBody.indexOf("const changed =");
  const finalAbortIndex = syncBody.indexOf("if (isAbortRequested()) {", changedIndex);
  const includeCommitIndex = syncBody.indexOf("entry.includeXpaths = filteredIncludeXpaths;", finalAbortIndex);
  const xpathCommitIndex = syncBody.indexOf("entry.xpaths = items;", includeCommitIndex);
  assert.ok(changedIndex > -1);
  assert.ok(finalAbortIndex > changedIndex);
  assert.ok(includeCommitIndex > finalAbortIndex);
  assert.ok(xpathCommitIndex > includeCommitIndex);
});

test("marking mode surfaces temporary disabled state while save sync blocks editing", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const textSource = readFileSync(new URL("../src/common/text.ts", import.meta.url), "utf8");

  assert.match(source, /const MARKING_DISABLED_OVERLAY_CLASS = "uf-marking-temporarily-disabled";/);
  assert.match(source, /const MARKING_DISABLED_CURSOR_CLASS = "uf-cursor-disabled";/);
  assert.match(source, /disabledNotice\.className = "uf-marking-disabled-notice";/);
  assert.match(source, /disabledNotice\.setAttribute\("data-uf-extension-ui", "true"\);/);
  assert.match(source, /disabledNotice\.setAttribute\("role", "status"\);/);
  assert.match(source, /disabledNotice\.setAttribute\("aria-live", "polite"\);/);
  assert.match(
    source,
    /function getMarkingTemporarilyDisabledReason\(\) \{[\s\S]*?return getMarkingEditsBlockedReasonByDirective\(\);[\s\S]*?\}/
  );
  assert.match(source, /function updateMarkingTemporarilyDisabledUi\(\) \{[\s\S]*?classList\.toggle\(MARKING_DISABLED_OVERLAY_CLASS, disabled\)[\s\S]*?setAttribute\("aria-disabled", "true"\)[\s\S]*?clearHoverHighlight\(\)[\s\S]*?getMarkingTemporarilyDisabledMessage\(reason\)/);
  assert.match(source, /function getMarkMode\(\s*\)(?:: [^{]+)? \{[\s\S]*?isMarkingTemporarilyDisabled\(\)[\s\S]*?return "disabled";[\s\S]*?state\.altPassThrough/);
  assert.match(source, /export async function setPageSaveReconciliationPending[\s\S]*?state\.pageSaveReconciliation = reconciliation;[\s\S]*?updateMarkingTemporarilyDisabledUi\(\);[\s\S]*?notifyDraftStatus\(pageUrl\);/);
  assert.match(source, /export async function clearPageSaveReconciliation[\s\S]*?state\.pageSaveReconciliation = null;[\s\S]*?updateMarkingTemporarilyDisabledUi\(\);[\s\S]*?notifyDraftStatus\(pageUrl\);/);
  assert.match(textSource, /temporarilyDisabledSaving: "Saving page\.\.\. marking paused"/);
  assert.match(textSource, /temporarilyDisabledSyncing: "Save sync pending\.\.\. marking paused"/);
});

test("marking render cache keys include selector and entry fingerprints before reuse", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /cachedCollectionsKey:\s*""/);
  assert.match(
    source,
    /function buildMarkingCollectionsCacheKey\(\s*\{[\s\S]*?pageUrl = ""[\s\S]*?selectorSet = null[\s\S]*?entry = null[\s\S]*?\}(?:: [^)]+)? = \{\}\s*\)/
  );
  assert.match(
    source,
    /function resolveMarkingSelectorContext\(configValue(?:\s*:\s*[^,]+)?, entry(?:\s*:\s*[^=]+)? = null\)/
  );
  assert.match(source, /const nextCollectionsCacheKey = buildMarkingCollectionsCacheKey\(\{/);
  assert.match(source, /if \(cached && state\.cachedCollectionsKey === nextCollectionsCacheKey\)/);
  assert.match(source, /state\.cachedCollectionsKey = buildMarkingCollectionsCacheKey\(\{/);
  assert.match(source, /function invalidateCachedCollections\(\) \{[\s\S]*?state\.cachedCollectionsKey = "";/);
});

test("marking enable schedules settle renders that force invalidating rebuilds", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /const MARKING_MODE_SETTLE_RENDER_DELAYS_MS = \[180, 700, 1800\];/);
  assert.match(source, /function clearMarkingSettleRenders\(\)/);
  assert.match(source, /function scheduleMarkingSettleRenders\(\) \{[\s\S]*?MARKING_MODE_SETTLE_RENDER_DELAYS_MS/);
  assert.match(source, /scheduleRender\(\{[\s\S]*?reason: "marking-settle",[\s\S]*?invalidate: true/);
  assert.match(source, /export async function enableForBaseUrl\(baseUrl(?:\s*:\s*[^,]+)?, options = \{\}\) \{[\s\S]*?scheduleRender\(\);[\s\S]*?scheduleMarkingSettleRenders\(\);/);
  assert.match(source, /export function disable\(options = \{\}\) \{[\s\S]*?clearMarkingSettleRenders\(\);/);
});

test("page popup-busy overlay is independent from reveal inspection and freeze UI", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const busyStartMatch = source.match(
    /export function setPopupBusyOnPage\(\s*active(?:\s*:\s*[^,)]+)?\s*,\s*message\s*=\s*""\s*,\s*options(?:\s*:\s*[^)=]+)?\s*=\s*\{\}\s*\)/
  );
  const busyStart = busyStartMatch ? busyStartMatch.index : -1;
  const busyEnd = source.indexOf("export function isPopupBusyOnPageActive", busyStart);
  assert.ok(busyStart > -1);
  assert.ok(busyEnd > busyStart);
  const busySource = source.slice(busyStart, busyEnd);

  assert.match(source, /popupBusyOverlay: null/);
  assert.match(source, /popupBusyBlocker: null/);
  assert.match(source, /const POPUP_BUSY_OVERLAY_ID = "unfluffify-popup-busy-overlay";/);
  assert.match(source, /const preferredParent = state\.overlay \|\| document\.body \|\| document\.documentElement;/);
  assert.match(source, /existing\.parentElement !== preferredParent[\s\S]*?preferredParent\.appendChild\(existing\);/);
  assert.match(source, /state\.overlay = overlay;[\s\S]*?overlay\.appendChild\(state\.popupBusyOverlay\);/);
  assert.match(source, /function startPopupBusyInputBlocker\(\) \{[\s\S]*?PAGE_INSPECTION_INPUT_EVENTS/);
  assert.match(source, /function stopPopupBusyInputBlocker\(\) \{/);
  assert.match(source, /popupBusyOperationId: ""/);
  assert.match(busySource, /leaseOptions\.operationId[\s\S]*?ignored: true[\s\S]*?return[\s\S]*?clearPopupBusyFailOpenTimer\(\);/);
  assert.match(source, /state\.popupBusyFailOpenTimer = extensionSetTimeout\(\(\) => \{[\s\S]*?setPopupBusyOnPage\(false, "", \{ operationId \}\);/);
  // Long data-affecting operations pass their real deadline as releaseBy; the
  // fail-open watchdog honors it up to a hard ceiling so the block survives a
  // popup disconnect (which stops the curtain re-broadcast re-arm) instead of
  // failing open at the short default after 65s.
  assert.match(source, /const POPUP_BUSY_PAGE_MAX_WATCHDOG_MS = 10 \* 60 \* 1000;/);
  assert.match(busySource, /Math\.min\(POPUP_BUSY_PAGE_MAX_WATCHDOG_MS, Math\.ceil\(leaseOptions\.releaseBy - Date\.now\(\)\)\)/);
  assert.match(source, /setPopupBusyOnPage\(false, "", \{ operationId \}\);[\s\S]*?stopPageInspectionInputBlocker\(\);/);
  assert.doesNotMatch(busySource, /setPageInspectionUiActive|PAGE_INSPECTION_OVERLAY_CLASS|pausePageMotion|PAGE_MOTION_PAUSE/);
});

test("paint reachability allows in-path hits deeper in the hit stack and falls back when all checks reject", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /function getPaintReachabilityForRect\(el(?::[^,]+)?, rect(?::[^)]+)?\)(?:: [^{]+)? \{[\s\S]*?elementsAtPoint\.some\(\(hit\) => isElementInHitPath\(hit, el\)\)/);
  assert.match(source, /function filterPaintReachableRects\(el(?::[^,]+)?, rects(?::[^)]+)?\)(?:: [^{]+)? \{[\s\S]*?const reachableRects = rects\.filter\(\(rect\) => getPaintReachabilityForRect\(el, rect\) !== false\);/);
  assert.match(source, /if \(reachableRects\.length > 0\) \{[\s\S]*?return reachableRects;/);
  assert.match(source, /if \([\s\S]*?isVisible\(el\)[\s\S]*?!isDefinitelyHiddenSubtreeElement\(el\)[\s\S]*?\) \{[\s\S]*?return rects;/);
});

test("paint reachability fallback emits throttled counter telemetry in toggle perf logs", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /paintReachabilityFallbackCount:\s*0/);
  assert.match(source, /paintReachabilityFallbackLastLoggedAt:\s*0/);
  assert.match(source, /function reportPaintReachabilityFallback\(el(?::[^,]+)?, rectCount(?::[^)]+)?\)(?:: [^{]+)? \{/);
  assert.match(source, /state\.paintReachabilityFallbackCount \+= 1;/);
  assert.match(source, /count <= 3 \|\|[\s\S]*?count % 25 === 0 \|\|[\s\S]*?paintReachabilityFallbackLastLoggedAt >= 5000/);
  assert.match(source, /logTogglePerf\("render\.reachability-fallback", nowMs\(\), \{/);
  assert.match(source, /reportPaintReachabilityFallback\(el, rects\.length\);/);
  assert.match(source, /state\.paintReachabilityFallbackCount = 0;/);
  assert.match(source, /state\.paintReachabilityFallbackLastLoggedAt = 0;/);
});
