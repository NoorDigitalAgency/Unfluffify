import { describe, expect, it } from "vitest";

import { deriveSecondaryGatesViewState } from "../src/background/brain/deciders/secondary-gates-decider.js";
import { AI_RUN_PHASES } from "../src/common/bus/contracts/session-state.js";

function buildFacts(overrides = {}) {
  return {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: true,
    pageInspectionBusy: false,
    desktopPreviewVisible: true,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: false,
    silentModeActive: true,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    aiRunUpToDate: true,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: true,
    lynxChecklistCanSend: true,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: "",
    ...overrides,
  };
}

describe("secondary gates decider", () => {
  it("keeps preview-latest disabled until the session has a fresh AI run", () => {
    const result = deriveSecondaryGatesViewState(buildFacts({
      aiRunUpToDate: false,
      sessionRequiresAiRun: true,
    }));

    expect(result.previewLatestButtonDisabled).toBe(true);
    expect(result.previewLatestBlockedReason).toBe("requires_ai_run");
  });

  it("projects desktop preview gating and Lynx checklist blocking details", () => {
    const result = deriveSecondaryGatesViewState(buildFacts({
      desktopPreviewActive: true,
      pageInspectionBusy: true,
      lynxChecklistCanSend: false,
      lynxChecklistBlockingReason: {
        code: "missing_page_types",
        pageTypeKeys: ["product"],
      },
    }));

    expect(result.desktopPreviewVisible).toBe(true);
    expect(result.desktopPreviewEnabled).toBe(true);
    expect(result.desktopPreviewDisabled).toBe(true);
    expect(result.desktopPreviewBlockedReason).toBe("page_inspection");
    expect(result.lynxChecklistSendBlockedReason).toEqual({
      code: "missing_page_types",
      pageTypeKeys: ["product"],
    });
    expect(result.navigationInspectionActive).toBe(true);
  });

  it("blocks checklist submission when the popup leaves silent mode", () => {
    const result = deriveSecondaryGatesViewState(buildFacts({
      silentModeActive: false,
      lynxChecklistCanSend: true,
    }));

    expect(result.lynxChecklistSendBlockedReason).toEqual({
      code: "not_available",
      pageTypeKeys: [],
    });
  });
});
