import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createRenderModeInspectionHandlers } from "../src/content/render-mode-inspection-handlers.js";

function createBaseDeps(overrides = {}) {
  let revealInFlight = 0;
  let revealCounter = 0;
  let inspectionActive = false;
  const lifecycleEvents = [];

  const deps = {
    armRenderModeInspectionWatchdog: () => {},
    cancelSilentHighlightEditorActivation: () => {},
    createCurrentPageSnapshot: () => ({ renderedHtml: "<html>rendered</html>", renderMode: "dynamic" }),
    createLifecycleOperationId: () => "op-generated",
    emitLifecycleEvent: (event) => lifecycleEvents.push(event),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    fetchCurrentPageRawHtml: async () => "<html>raw</html>",
    finishPageInspectionUi: () => {},
    getPageUrl: () => "https://example.test/page",
    getPropertyLockBannerMode: () => "no_banner",
    getSilentHighlightEditorRevealInFlight: () => revealInFlight,
    hideConsentElements: () => 3,
    isPageWithinBaseUrl: () => true,
    isRenderModeInspectionActive: () => inspectionActive,
    isRenderModeInspectionFlagSet: () => inspectionActive,
    consumePageVisitRevealFreezeAttempt: () => true,
    markSilentHighlightEditorRevealPrepared: () => {},
    nextRevealId: () => {
      revealCounter += 1;
      return revealCounter;
    },
    renderPropertyLockBanner: () => {},
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    resolveBaseUrlForCurrentPage: async () => "https://example.test",
    setRenderModeInspectionActive: (value) => {
      inspectionActive = Boolean(value);
    },
    setSilentHighlightEditorRevealInFlight: (value) => {
      revealInFlight = value;
    },
    updatePropertyLockBannerMode: () => {},
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    warmupSilentHighlightingBeforeMotionPause: async () => true,
    LIFECYCLE_KINDS: { RENDER_MODE_INSPECTION: "render-mode" },
    LIFECYCLE_PHASES: {
      STARTED: "started",
      REVEAL_STARTED: "reveal_started",
      REVEAL_FINISHED: "reveal_finished",
      HTML_CAPTURED: "html_captured",
      FINISHED: "finished",
      FAILED: "failed"
    },
    SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON: "silent-highlighting"
  };

  return {
    deps: { ...deps, ...overrides },
    getLifecycleEvents: () => lifecycleEvents
  };
}

test("render-mode handlers begin and end emit lifecycle events", () => {
  const { deps, getLifecycleEvents } = createBaseDeps();
  const handlers = createRenderModeInspectionHandlers(deps);

  const beginResult = handlers.begin({ operationId: "op-1" });
  const endResult = handlers.end({ operationId: "op-1" });

  assert.equal(beginResult.ok, true);
  assert.equal(endResult.ok, true);
  const events = getLifecycleEvents();
  assert.equal(events[0].phase, "started");
  assert.equal(events[1].phase, "finished");
});

test("render-mode handlers capture html returns snapshot payload", async () => {
  const { deps } = createBaseDeps({
    isRenderModeInspectionActive: () => true
  });
  const handlers = createRenderModeInspectionHandlers(deps);

  const response = await handlers.captureHtml({ operationId: "op-2" });
  assert.equal(response.ok, true);
  assert.equal(response.pageUrl, "https://example.test/page");
  assert.equal(response.rawHtml, "<html>raw</html>");
  assert.equal(response.renderedHtml, "<html>rendered</html>");
});

test("render-mode handlers hideConsent reports hidden count", () => {
  const { deps } = createBaseDeps({
    hideConsentElements: () => 7
  });
  const handlers = createRenderModeInspectionHandlers(deps);

  const response = handlers.hideConsent();
  assert.deepEqual(response, { ok: true, hiddenCount: 7 });
});

test("render-mode reveal skips warmup after page visit already consumed reveal", async () => {
  let warmupCalls = 0;
  let preparedCalls = 0;
  const { deps } = createBaseDeps({
    consumePageVisitRevealFreezeAttempt: () => false,
    markSilentHighlightEditorRevealPrepared: () => {
      preparedCalls += 1;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    warmupSilentHighlightingBeforeMotionPause: async () => {
      warmupCalls += 1;
      return true;
    }
  });
  const handlers = createRenderModeInspectionHandlers(deps);

  const response = await handlers.revealOnce({ operationId: "op-skip" });

  assert.equal(response.ok, true);
  assert.equal(response.skippedReveal, true);
  assert.equal(warmupCalls, 0);
  assert.equal(preparedCalls, 0);
});

test("render-mode reveal marks page visit prepared after successful warmup", async () => {
  let preparedCalls = 0;
  const { deps } = createBaseDeps({
    markSilentHighlightEditorRevealPrepared: () => {
      preparedCalls += 1;
    }
  });
  const handlers = createRenderModeInspectionHandlers(deps);

  const response = await handlers.revealOnce({ operationId: "op-reveal" });

  assert.equal(response.ok, true);
  assert.equal(response.skippedReveal, undefined);
  assert.equal(preparedCalls, 1);
});
