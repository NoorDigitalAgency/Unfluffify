import { describe, expect, it } from "vitest";

import { SPINNER_OPERATION_KINDS, SPINNER_OPERATION_PHASES } from "../src/common/spinner-contract.js";
import { projectSpinners } from "../src/background/brain/spinner-authority.js";
import type { TabLayerState } from "../src/background/brain/state-store.js";

function createState(overrides: Partial<TabLayerState> = {}): TabLayerState {
  return {
    tabId: 9,
    version: 1,
    popupView: {
      traceEnabled: false,
      traceEvents: [],
      lifecycle: null,
    },
    activation: {
      contentReady: false,
      bootstrapStatus: "idle",
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
    sessionFactsReported: false,
    sessionFacts: {
      baseUrlReady: false,
      pageScopedUiDisabled: false,
      navigationInspectionPending: false,
      siteIdReady: false,
      renderModeReady: false,
      pageTypeUiBlocked: false,
      currentPageHasPendingChanges: false,
      pageInspectionBusy: false,
      desktopPreviewVisible: false,
      desktopPreviewActive: false,
      deviceControlsDisabled: false,
      isEnabled: false,
      silentModeActive: false,
      aiReady: false,
      aiBusy: false,
      aiComputing: false,
      aiRunPhase: "",
      aiRunUpToDate: false,
      previewActive: false,
      previewBlocked: false,
      previewItemsPending: false,
      previewRestorePending: false,
      sessionHasPendingChanges: false,
      sessionRequiresAiRun: false,
      currentDraftDirty: false,
      pageSaveReconciliationPending: false,
      pageSaveReconciliationReason: "",
      propertyLockBlocked: false,
      saving: false,
      discarding: false,
      hasStoredSelectors: false,
      lynxChecklistCanSend: false,
      lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
    },
    sessionDictation: null,
    aiRun: {
      active: false,
      phase: "pre_ai",
      deadlineAt: 0,
      leaseStartedAt: 0,
      lastEvent: "",
      sessionId: "",
      reason: "",
    },
    navigationInspectionCurtainClearBefore: 0,
    aiRunLeaseOwned: false,
    propertyLockView: null,
    propertyLockTimer: null,
    secondaryGates: null,
    spinners: {
      popup: null,
      pageCurtain: null,
      banner: null,
    },
    tabState: {
      enabled: false,
      baseUrl: "",
      pageType: "",
    },
    siteId: null,
    pageDataLoadStatus: null,
    ...overrides,
  };
}

describe("spinner authority", () => {
  it("projects surface vocabulary only - no composed presentation on the wire", () => {
    const projected = projectSpinners(createState({
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
          startedAt: 10,
          deadlineAt: 20,
          operationId: "op-1",
          message: "legacy message ignored",
          reason: "tab-run-ai-running",
          source: "spinner-broker",
          spinnerKey: "ai",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toEqual({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      startedAt: 10,
      deadlineAt: 20,
      operationId: "op-1",
      reason: "tab-run-ai-running",
      spinnerKey: "ai",
    });
  });

  it("drops selections the shared phase contract does not know", () => {
    const projected = projectSpinners(createState({
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: "not-a-real-phase",
          startedAt: 10,
          deadlineAt: 20,
          operationId: "op-x",
          message: "",
          reason: "",
          source: "",
          spinnerKey: "",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toBeNull();
  });

  it("falls back to a brain-owned page curtain for fresh active AI runs", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 480_000,
        leaseStartedAt: 1_000,
        lastEvent: "ai-run.started",
        sessionId: "session-1",
        reason: "ai-run-started",
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 480_000,
      startedAt: 1_000,
    });
    expect(projected.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 480_000,
      startedAt: 1_000,
    });
  });

  it("does not force the page curtain during explicit popup-only AI-run phases", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 480_000,
        leaseStartedAt: 2_000,
        lastEvent: "ai-run.started",
        sessionId: "session-2",
        reason: "ai-run-started",
      },
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
          startedAt: 2_000,
          deadlineAt: 2_500,
          operationId: "refine-xpaths",
          message: "Refining XPaths",
          reason: "tab-run-ai-refine-xpaths",
          source: "spinner-broker",
          spinnerKey: "ai-popup-only",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
    });
    expect(projected.pageCurtain).toBeNull();
  });

  it("clears stale AI-run page curtains when popup advances to a popup-only phase", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 482_000,
        leaseStartedAt: 2_100,
        lastEvent: "ai-run.started",
        sessionId: "session-popup-only",
        reason: "ai-run-started",
      },
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
          startedAt: 2_300,
          deadlineAt: 2_700,
          operationId: "refine-xpaths",
          message: "Refining XPaths",
          reason: "tab-run-ai-refine-xpaths",
          source: "spinner-broker",
          spinnerKey: "ai-popup-only",
        },
        pageCurtain: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
          startedAt: 2_100,
          deadlineAt: 482_000,
          operationId: "stale-page-curtain",
          message: "Computing selectors",
          reason: "phase-remote-wait",
          source: "spinner-broker",
          spinnerKey: "ai-page",
        },
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
    });
    expect(projected.pageCurtain).toBeNull();
  });

  // The "Preparing content list..." hold (ai-run:opening-preview) is
  // PAGE_AND_POPUP: after results-applied (aiRun settles inactive) it must
  // drive BOTH surfaces until the popup releases it at list-rendered.
  it("projects the opening-preview hold to both surfaces after the run settles", () => {
    const holdSelection = {
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
      startedAt: 3_000,
      deadlineAt: 0,
      operationId: "preparing-content-list",
      message: "Preparing content list...",
      reason: "tab-run-ai-opening-preview",
      source: "popup-ai-run",
      spinnerKey: "run-ai-preview-open",
    };
    const projected = projectSpinners(createState({
      aiRun: {
        active: false,
        phase: "post_ai",
        deadlineAt: 0,
        leaseStartedAt: 2_000,
        lastEvent: "ai-run.resultsApplied",
        sessionId: "session-3",
        reason: "results-ready",
      },
      spinners: {
        popup: holdSelection,
        pageCurtain: holdSelection,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
    });
    expect(projected.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
    });
  });

  it("keeps the brain-owned AI-run popup selection ahead of unrelated popup spinners", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 485_000,
        leaseStartedAt: 2_500,
        lastEvent: "ai-run.started",
        sessionId: "session-popup-fallback",
        reason: "ai-run-started",
      },
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.POPUP_BOOTSTRAP,
          phase: SPINNER_OPERATION_PHASES.POPUP_BOOTSTRAP.REFRESHING_STATE,
          startedAt: 2_600,
          deadlineAt: 2_900,
          operationId: "popup-refresh",
          message: "Refreshing popup",
          reason: "popup-refresh",
          source: "spinner-broker",
          spinnerKey: "popup-refresh",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 485_000,
      startedAt: 2_500,
    });
  });

  it("ignores stale AI-run popup phases when a fresh AI run starts", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 486_000,
        leaseStartedAt: 6_000,
        lastEvent: "ai-run.started",
        sessionId: "session-fresh-run",
        reason: "ai-run-started",
      },
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
          startedAt: 5_000,
          deadlineAt: 5_400,
          operationId: "stale-popup",
          message: "Opening preview",
          reason: "phase-opening-preview",
          source: "spinner-broker",
          spinnerKey: "stale-popup",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 486_000,
      startedAt: 6_000,
    });
    expect(projected.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 486_000,
      startedAt: 6_000,
    });
  });

  it("still falls back to the brain-owned page curtain when the explicit AI-run phase blocks the page", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 490_000,
        leaseStartedAt: 3_000,
        lastEvent: "ai-run.started",
        sessionId: "session-3",
        reason: "ai-run-started",
      },
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
          startedAt: 3_000,
          deadlineAt: 3_500,
          operationId: "prepare-page",
          message: "Preparing page content for AI",
          reason: "phase-preparing-page",
          source: "spinner-broker",
          spinnerKey: "ai-page-blocking",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
    });
    expect(projected.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 490_000,
      startedAt: 3_000,
    });
  });

  it("prefers the fresh brain-owned page curtain over stale AI-run page selections", () => {
    const projected = projectSpinners(createState({
      aiRun: {
        active: true,
        phase: "pre_ai",
        deadlineAt: 495_000,
        leaseStartedAt: 5_000,
        lastEvent: "ai-run.started",
        sessionId: "session-4",
        reason: "ai-run-started",
      },
      spinners: {
        popup: null,
        pageCurtain: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
          startedAt: 4_000,
          deadlineAt: 490_000,
          operationId: "stale-ai-run",
          message: "Computing selectors",
          reason: "phase-remote-wait",
          source: "spinner-broker",
          spinnerKey: "stale-ai-run",
        },
        banner: null,
      },
    }));

    expect(projected.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.AI_RUN,
      phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 495_000,
      startedAt: 5_000,
    });
  });
  it("expires blocking surfaces past their phase budget when projected with a clock", () => {
    // Regression (live-reported): the render-mode inspection spinner selection is
    // persisted with the brain store while the spinner queue's REMOVE lives in
    // service-worker memory — an MV3 suspension mid-operation (the long
    // "With JavaScript" flow after a "Without JavaScript" hold) lost the REMOVE
    // and the popup projected the stuck curtain forever. The recovery-policy
    // budget (maxDurationMs + grace) must expire the surface at projection time.
    const startedAt = 1_000_000;
    const state = createState({
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
          phase: SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.RELOADING_FOR_INSPECTION,
          startedAt,
          deadlineAt: 0,
          operationId: "render-mode-inspection:9",
          message: "",
          reason: "tab-render-mode-reload",
          source: "background-command-router",
          spinnerKey: "render-mode-inspection:9",
        },
        pageCurtain: {
          kind: SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
          phase: SPINNER_OPERATION_PHASES.RENDER_MODE_INSPECTION.RELOADING_FOR_INSPECTION,
          startedAt,
          deadlineAt: 0,
          operationId: "render-mode-inspection:9",
          message: "",
          reason: "tab-render-mode-reload",
          source: "background-command-router",
          spinnerKey: "render-mode-inspection:9",
        },
        banner: null,
      },
    });

    // Within the phase budget (60s) + grace (30s): still projected.
    const live = projectSpinners(state, startedAt + 60_000);
    expect(live.popup).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    });
    expect(live.pageCurtain).toMatchObject({
      kind: SPINNER_OPERATION_KINDS.RENDER_MODE_INSPECTION,
    });

    // Past budget + grace: the stuck surface fail-opens.
    const expired = projectSpinners(state, startedAt + 91_000);
    expect(expired.popup).toBeNull();
    expect(expired.pageCurtain).toBeNull();
  });

  it("expires countdown selections past their deadline plus grace", () => {
    const projected = projectSpinners(createState({
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
          startedAt: 1_000_000,
          deadlineAt: 1_480_000,
          operationId: "op-run",
          message: "",
          reason: "tab-run-ai-running",
          source: "spinner-broker",
          spinnerKey: "run-ai:9",
        },
        pageCurtain: null,
        banner: null,
      },
    }), 1_480_000 + 31_000);

    expect(projected.popup).toBeNull();
  });

  it("keeps legacy clockless projection behavior when no now is provided", () => {
    const projected = projectSpinners(createState({
      spinners: {
        popup: {
          kind: SPINNER_OPERATION_KINDS.AI_RUN,
          phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
          startedAt: 10,
          deadlineAt: 20,
          operationId: "op-legacy",
          message: "",
          reason: "",
          source: "",
          spinnerKey: "legacy",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({ operationId: "op-legacy" });
  });
});
