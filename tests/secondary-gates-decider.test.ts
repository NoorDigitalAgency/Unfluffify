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
  it("enables silent preview-latest from stored selectors without a fresh AI run", () => {
    const result = deriveSecondaryGatesViewState(buildFacts({
      aiRunUpToDate: false,
      sessionRequiresAiRun: true,
    }));

    expect(result.previewLatestButtonDisabled).toBe(false);
    expect(result.previewLatestBlockedReason).toBe("");
  });

  it("blocks silent preview-latest when no stored selectors exist", () => {
    const result = deriveSecondaryGatesViewState(buildFacts({
      hasStoredSelectors: false,
    }));

    expect(result.previewLatestButtonDisabled).toBe(true);
    expect(result.previewLatestBlockedReason).toBe("no_stored_selectors");
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

  it("keeps Discard reachable in POST_AI even with no current page draft changes", () => {
    // The dictation-decider enables Discard in POST_AI so the AI run can always
    // be cleared back to PRE_AI; the AI selectors are session-level, so the page
    // draft has no changes. The blocked-reason must stay NONE so the page-revert
    // handler does not refuse the click ("no changes to save").
    const result = deriveSecondaryGatesViewState(buildFacts({
      aiRunPhase: AI_RUN_PHASES.POST_AI,
      currentPageHasPendingChanges: false,
      sessionHasPendingChanges: true,
    }));

    expect(result.pageRevertBlockedReason).toBe("");

    // A pending save reconciliation must also not block Discard in POST_AI
    // (Discard is how a stuck reconciliation gets cleared).
    const reconciling = deriveSecondaryGatesViewState(buildFacts({
      aiRunPhase: AI_RUN_PHASES.POST_AI,
      currentPageHasPendingChanges: false,
      pageSaveReconciliationPending: true,
    }));
    expect(reconciling.pageRevertBlockedReason).toBe("");

    // Outside POST_AI with no page changes it stays blocked (button is disabled).
    const preAi = deriveSecondaryGatesViewState(buildFacts({
      aiRunPhase: AI_RUN_PHASES.PRE_AI,
      currentPageHasPendingChanges: false,
    }));
    expect(preAi.pageRevertBlockedReason).toBe("no_page_changes");
  });
});
