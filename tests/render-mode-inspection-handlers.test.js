import test from "node:test";
import assert from "node:assert/strict";

import { createRenderModeInspectionHandlers } from "../content/render-mode-inspection-handlers.js";

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
    fetchCurrentPageRawHtml: async () => "<html>raw</html>",
    finishPageInspectionUi: () => {},
    getPageUrl: () => "https://example.test/page",
    getPropertyLockBannerMode: () => "no_banner",
    getSilentHighlightEditorRevealInFlight: () => revealInFlight,
    hideConsentElements: () => 3,
    isPageWithinBaseUrl: () => true,
    isRenderModeInspectionActive: () => inspectionActive,
    isRenderModeInspectionFlagSet: () => inspectionActive,
    nextRevealId: () => {
      revealCounter += 1;
      return revealCounter;
    },
    renderPropertyLockBanner: () => {},
    resolveBaseUrlForCurrentPage: async () => "https://example.test",
    setRenderModeInspectionActive: (value) => {
      inspectionActive = Boolean(value);
    },
    setSilentHighlightEditorRevealInFlight: (value) => {
      revealInFlight = value;
    },
    updatePropertyLockBannerMode: () => {},
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
