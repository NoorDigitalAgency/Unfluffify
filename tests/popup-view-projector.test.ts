import { describe, expect, it } from "vitest";

import { projectViews } from "../src/background/brain/view-projector.js";
import type { TabLayerState } from "../src/background/brain/state-store.js";
import { AI_RUN_PHASES } from "../src/common/bus/contracts/session-state.js";

const baseSessionFacts = {
  baseUrlReady: true,
  pageScopedUiDisabled: false,
  navigationInspectionPending: false,
  siteIdReady: true,
  renderModeReady: true,
  pageTypeUiBlocked: false,
  currentPageHasPendingChanges: false,
  pageInspectionBusy: false,
  desktopPreviewVisible: false,
  desktopPreviewActive: false,
  deviceControlsDisabled: false,
  isEnabled: true,
  silentModeActive: false,
  aiReady: true,
  aiBusy: false,
  aiComputing: false,
  aiRunPhase: AI_RUN_PHASES.PRE_AI,
  aiRunUpToDate: false,
  previewActive: false,
  previewBlocked: false,
  previewItemsPending: false,
  previewRestorePending: false,
  sessionHasPendingChanges: false,
  sessionRequiresAiRun: false,
  currentDraftDirty: false,
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
} as const;

describe("popup view projector", () => {
  it("projects the compatibility popup view fields from tab state", () => {
    const state: TabLayerState = {
      tabId: 12,
      version: 3,
      popupView: {
        traceEnabled: true,
        traceEvents: [{
          at: 10,
          channel: "broker",
          event: "state-update",
          payload: {
            type: "LIFECYCLE_EVENT",
            kind: "activation",
            phase: "started",
            message: "warming",
            label: "spinner-extra",
          },
        }],
        lifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationKind: "content-bootstrap",
          operationPhase: "page-inspection",
          contentMode: "marking",
        },
      },
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        javaScriptDisabled: true,
        noJsHeld: true,
        operationId: "render-mode:12:1",
        baseUrl: "https://example.com",
        lastSnapshotPageUrl: "https://example.com/page",
        followUpCompleted: true,
        lastError: "",
      },
      sessionFactsReported: true,
      sessionFacts: { ...baseSessionFacts },
      sessionDictation: null,
      propertyLockView: {
        propertyLockVisible: true,
        propertyLockTone: "warning",
        propertyLockIcon: "map-marker-alert-outline",
        propertyLockStatusText: "Off candidate page",
        propertyLockDetailText: "Return soon",
        propertyLockSuggestVisible: false,
        propertyLockTakeVisible: false,
        propertyLockTakeText: "",
        propertyLockContinueVisible: false,
        propertyLockContinueText: "",
        propertyLockContinueDisabled: false,
        propertyLockForceContinueVisible: false,
        propertyLockForceContinueText: "",
        propertyLockSuggestionVisible: false,
        propertyLockAcceptVisible: false,
        propertyLockRejectVisible: false,
      },
      propertyLockTimer: {
        kind: "off_candidate",
        source: "deadline",
        deadlineAt: 4_000,
        secondsRemaining: 3,
      },
      secondaryGates: {
        pageSaveBlockedReason: "",
        pageRevertBlockedReason: "",
        markingPreviewBlockedReason: "",
        saveExcludesButtonDisabled: false,
        saveExcludesBlockedReason: "",
        previewLatestButtonDisabled: true,
        previewLatestBlockedReason: "requires_ai_run",
        desktopPreviewVisible: true,
        desktopPreviewEnabled: true,
        desktopPreviewDisabled: false,
        desktopPreviewBlockedReason: "",
        lynxChecklistSendBlockedReason: {
          code: "missing_page_types",
          pageTypeKeys: ["product"],
        },
        navigationInspectionActive: false,
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    const { popupView, contentDirective } = projectViews(state);

    expect(contentDirective).toEqual({
      version: 3,
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        operationId: "render-mode:12:1",
        noJsHeld: true,
        javaScriptDisabled: true,
      },
      markingEditsBlocked: false,
    });
    expect(popupView).toEqual({
      version: 3,
      tabId: 12,
      traceEnabled: true,
      traceEvents: [{
        at: 10,
        channel: "broker",
        event: "state-update",
        payload: {
          type: "LIFECYCLE_EVENT",
          kind: "activation",
          phase: "started",
          message: "warming",
          label: "spinner-extra",
        },
      }],
      lifecycle: {
        kind: "activation",
        phase: "started",
        message: "warming",
        busy: true,
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        contentMode: "marking",
      },
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        javaScriptDisabled: true,
        noJsHeld: true,
        operationId: "render-mode:12:1",
        baseUrl: "https://example.com",
        lastSnapshotPageUrl: "https://example.com/page",
        followUpCompleted: true,
        lastError: "",
      },
      sessionPhase: null,
      sessionDictation: null,
      propertyLockView: {
        propertyLockVisible: true,
        propertyLockTone: "warning",
        propertyLockIcon: "map-marker-alert-outline",
        propertyLockStatusText: "Off candidate page",
        propertyLockDetailText: "Return soon",
        propertyLockSuggestVisible: false,
        propertyLockTakeVisible: false,
        propertyLockTakeText: "",
        propertyLockContinueVisible: false,
        propertyLockContinueText: "",
        propertyLockContinueDisabled: false,
        propertyLockForceContinueVisible: false,
        propertyLockForceContinueText: "",
        propertyLockSuggestionVisible: false,
        propertyLockAcceptVisible: false,
        propertyLockRejectVisible: false,
      },
      propertyLockTimer: {
        kind: "off_candidate",
        source: "deadline",
        deadlineAt: 4_000,
        secondsRemaining: 3,
      },
      secondaryGates: {
        pageSaveBlockedReason: "",
        pageRevertBlockedReason: "",
        markingPreviewBlockedReason: "",
        saveExcludesButtonDisabled: false,
        saveExcludesBlockedReason: "",
        previewLatestButtonDisabled: true,
        previewLatestBlockedReason: "requires_ai_run",
        desktopPreviewVisible: true,
        desktopPreviewEnabled: true,
        desktopPreviewDisabled: false,
        desktopPreviewBlockedReason: "",
        lynxChecklistSendBlockedReason: {
          code: "missing_page_types",
          pageTypeKeys: ["product"],
        },
        navigationInspectionActive: false,
      },
      spinnerQueue: [],
      activeSpinnerLease: null,
    });
  });

  it("clones nested popup view data instead of sharing references", () => {
    const state: TabLayerState = {
      tabId: 2,
      version: 1,
      popupView: {
        traceEnabled: false,
        traceEvents: [{
          at: 1,
          channel: "broker",
          event: "event",
          payload: {
            message: "before",
          },
        }],
        lifecycle: {
          message: "before",
        },
      },
      activation: {
        contentReady: false,
        bootstrapStatus: "idle",
        restorePending: false,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "before",
          busy: true,
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: false,
        javaScriptDisabled: false,
        noJsHeld: false,
        operationId: "",
        baseUrl: "",
        lastSnapshotPageUrl: "",
        followUpCompleted: false,
        lastError: "",
      },
      sessionFactsReported: true,
      sessionFacts: { ...baseSessionFacts },
      sessionDictation: null,
      propertyLockView: null,
      propertyLockTimer: null,
      secondaryGates: {
        pageSaveBlockedReason: "",
        pageRevertBlockedReason: "",
        markingPreviewBlockedReason: "",
        saveExcludesButtonDisabled: false,
        saveExcludesBlockedReason: "",
        previewLatestButtonDisabled: false,
        previewLatestBlockedReason: "",
        desktopPreviewVisible: false,
        desktopPreviewEnabled: false,
        desktopPreviewDisabled: true,
        desktopPreviewBlockedReason: "not_available",
        lynxChecklistSendBlockedReason: {
          code: "",
          pageTypeKeys: [],
        },
        navigationInspectionActive: false,
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    const projected = projectViews(state).popupView;
    state.popupView.traceEvents[0].payload = {
      message: "after",
    };
    state.popupView.lifecycle = {
      message: "after",
    };
    state.activation.lastLifecycle = {
      kind: "activation",
      phase: "finished",
      message: "after",
      busy: false,
      reason: "activation-finished",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/page",
    };
    expect(projected.traceEvents[0].payload).toEqual({ message: "before" });
    expect(projected.lifecycle).toEqual({ message: "before" });
    expect(projected.activation).toEqual({
      contentReady: false,
      bootstrapStatus: "idle",
      restorePending: false,
      lastError: "",
      lastLifecycle: {
        kind: "activation",
        phase: "started",
        message: "before",
        busy: true,
        reason: "activation-started",
        source: "background",
        contentMode: "marking",
        markingEnabled: true,
        pageUrl: "https://example.com/page",
      },
      lastContentPageUrl: "https://example.com/page",
    });
    expect(projected.spinnerQueue).toEqual([]);
    expect(projected.activeSpinnerLease).toEqual(null);
    expect(projected.renderMode).toEqual({
      inspecting: false,
      javaScriptDisabled: false,
      noJsHeld: false,
      operationId: "",
      baseUrl: "",
      lastSnapshotPageUrl: "",
      followUpCompleted: false,
      lastError: "",
    });
    expect(projected.propertyLockView).toEqual(null);
    expect(projected.propertyLockTimer).toEqual(null);
    expect(projected.secondaryGates).toEqual({
      pageSaveBlockedReason: "",
      pageRevertBlockedReason: "",
      markingPreviewBlockedReason: "",
      saveExcludesButtonDisabled: false,
      saveExcludesBlockedReason: "",
      previewLatestButtonDisabled: false,
      previewLatestBlockedReason: "",
      desktopPreviewVisible: false,
      desktopPreviewEnabled: false,
      desktopPreviewDisabled: true,
      desktopPreviewBlockedReason: "not_available",
      lynxChecklistSendBlockedReason: {
        code: "",
        pageTypeKeys: [],
      },
      navigationInspectionActive: false,
    });
  });

  it("projects activation lifecycle into the popup lifecycle view for activation-owned states", () => {
    const state: TabLayerState = {
      tabId: 91,
      version: 7,
      popupView: {
        traceEnabled: false,
        traceEvents: [],
        lifecycle: null,
      },
      activation: {
        contentReady: false,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "Preparing page content for marking...",
          busy: true,
          operationId: "activation:91:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/property",
        },
        lastContentPageUrl: "https://example.com/property",
      },
      renderMode: {
        inspecting: false,
        javaScriptDisabled: false,
        noJsHeld: false,
        operationId: "",
        baseUrl: "",
        lastSnapshotPageUrl: "",
        followUpCompleted: false,
        lastError: "",
      },
      sessionFactsReported: false,
      sessionFacts: { ...baseSessionFacts },
      sessionDictation: null,
      propertyLockView: null,
      propertyLockTimer: null,
      secondaryGates: null,
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    expect(projectViews(state).popupView.lifecycle).toEqual({
      operationId: "activation:91:1",
      kind: "activation",
      phase: "started",
      message: "Preparing page content for marking...",
      reason: "activation-started",
      source: "background",
      busy: true,
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/property",
    });
  });

  it("keeps markingEditsBlocked through POST_AI and AI_PREVIEW, off in PRE_AI", () => {
    const buildState = (facts: typeof baseSessionFacts): TabLayerState => ({
      tabId: 91,
      version: 7,
      popupView: {
        traceEnabled: false,
        traceEvents: [],
        lifecycle: null,
      },
      activation: {
        contentReady: false,
        bootstrapStatus: "bootstrapping",
        restorePending: false,
        lastError: "",
        lastLifecycle: null,
        lastContentPageUrl: "",
      },
      renderMode: {
        inspecting: false,
        javaScriptDisabled: false,
        noJsHeld: false,
        operationId: "",
        baseUrl: "",
        lastSnapshotPageUrl: "",
        followUpCompleted: false,
        lastError: "",
      },
      sessionFactsReported: true,
      sessionFacts: facts,
      sessionDictation: null,
      propertyLockView: null,
      propertyLockTimer: null,
      secondaryGates: null,
      spinners: { popup: null, pageCurtain: null, banner: null },
    });

    expect(projectViews(buildState({ ...baseSessionFacts, aiRunPhase: AI_RUN_PHASES.POST_AI })).contentDirective.markingEditsBlocked).toBe(true);
    expect(projectViews(buildState({ ...baseSessionFacts, aiRunPhase: AI_RUN_PHASES.AI_PREVIEW })).contentDirective.markingEditsBlocked).toBe(true);
    expect(projectViews(buildState({ ...baseSessionFacts, aiRunPhase: AI_RUN_PHASES.PRE_AI })).contentDirective.markingEditsBlocked).toBe(false);
  });
});
