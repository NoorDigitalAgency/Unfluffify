import { describe, expect, it } from "vitest";

import { SPINNER_OPERATION_KINDS, SPINNER_OPERATION_PHASES, SPINNER_TIMER_MODES } from "../src/common/spinner-contract.js";
import { phaseToSpinnerState, projectSpinners } from "../src/background/brain/spinner-authority.js";
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
  it("maps countdown phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      { startedAt: 10, deadlineAt: 20 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.COUNTDOWN,
      title: "Waiting for AI results",
      deadlineAt: 20,
      startedAt: 10,
      maxDurationMs: 480_000,
    });
  });

  it("maps elapsed phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
      SPINNER_OPERATION_PHASES.REVEAL_FREEZE.REVEALING_CONTENT,
      { startedAt: 30, deadlineAt: 0 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.ELAPSED,
      title: "Revealing lazy-loaded content",
      maxDurationMs: 120_000,
    });
  });

  it("maps none-timer phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
      { startedAt: 40, deadlineAt: 0 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.NONE,
      title: "Preparing page content for AI",
    });
  });

  it("prefers the live spinner message and carries popup metadata", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      {
        startedAt: 50,
        deadlineAt: 70,
        operationId: "op-2",
        message: "Waiting on AI run",
        reason: "tab-run-ai-running",
        source: "background-spinner-broker",
        spinnerKey: "ai",
      },
    );

    expect(state).toMatchObject({
      message: "Waiting on AI run",
      operationId: "op-2",
      reason: "tab-run-ai-running",
      source: "background-spinner-broker",
      spinnerKey: "ai",
    });
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 480_000,
      startedAt: 1_000,
    });
    expect(projected.pageCurtain).toMatchObject({
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
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
          phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
          startedAt: 2_000,
          deadlineAt: 2_500,
          operationId: "open-preview",
          message: "Opening preview",
          reason: "phase-opening-preview",
          source: "spinner-broker",
          spinnerKey: "ai-popup-only",
        },
        pageCurtain: null,
        banner: null,
      },
    }));

    expect(projected.popup).toMatchObject({
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
      message: "Opening preview",
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
          phase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
          startedAt: 2_300,
          deadlineAt: 2_700,
          operationId: "open-preview",
          message: "Opening preview",
          reason: "phase-opening-preview",
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.OPENING_PREVIEW,
    });
    expect(projected.pageCurtain).toBeNull();
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
          kind: SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
          phase: SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.POPUP_REFRESH,
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 486_000,
      startedAt: 6_000,
    });
    expect(projected.pageCurtain).toMatchObject({
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
    });
    expect(projected.pageCurtain).toMatchObject({
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
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
      operationKind: SPINNER_OPERATION_KINDS.AI_RUN,
      operationPhase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      deadlineAt: 495_000,
      startedAt: 5_000,
    });
  });
});
