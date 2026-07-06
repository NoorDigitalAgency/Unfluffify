import type {
  ActivationBootstrapStatus,
  ActivationLifecycleSnapshot,
  ActivationSnapshot,
} from "../../common/bus/contracts/activation";
import type {
  PopupLifecycleState,
  PopupTraceEvent,
} from "../../common/bus/contracts/popup-state";
import type {
  PropertyLockTimerState,
  PropertyLockViewState
} from "../../common/bus/contracts/property-lock-state";
import type { RenderModeViewState } from "../../common/bus/contracts/render-mode";
import type { SecondaryGatesViewState } from "../../common/bus/contracts/secondary-gates-state";
import {
  AI_RUN_PHASES,
  type SessionAiRunPhase,
  type SessionDictation,
  type SessionFacts
} from "../../common/bus/contracts/session-state";
import type { AiRunEventType } from "../../common/bus/contracts/ai-run";
import { createDefaultSessionFacts } from "./deciders/session-phase-decider";

export type SpinnerSelection = Readonly<{
  kind: string;
  phase: string;
  startedAt: number;
  deadlineAt: number;
  operationId?: string;
  message: string;
  reason: string;
  source: string;
  spinnerKey: string;
}>;

export type PopupViewState = Readonly<{
  traceEnabled: boolean;
  traceEvents: PopupTraceEvent[];
  lifecycle: PopupLifecycleState | null;
}>;

export type ActivationState = ActivationSnapshot;

export type RenderModeState = RenderModeViewState;
export type SessionFactsState = SessionFacts;
export type SessionDictationState = SessionDictation | null;
export type PropertyLockViewProjectionState = PropertyLockViewState | null;
export type PropertyLockTimerProjectionState = PropertyLockTimerState | null;
export type SecondaryGatesProjectionState = SecondaryGatesViewState | null;

export type AiRunState = {
  active: boolean;
  phase: SessionAiRunPhase;
  deadlineAt: number;
  leaseStartedAt: number;
  lastEvent: AiRunEventType | "";
  sessionId: string;
  reason: string;
};

function createInitialAiRunState(): AiRunState {
  return {
    active: false,
    phase: AI_RUN_PHASES.PRE_AI,
    deadlineAt: 0,
    leaseStartedAt: 0,
    lastEvent: "",
    sessionId: "",
    reason: "",
  };
}

function createInitialActivationState(): ActivationState {
  return {
    contentReady: false,
    bootstrapStatus: "idle" satisfies ActivationBootstrapStatus,
    restorePending: false,
    lastError: "",
    lastLifecycle: null,
    lastContentPageUrl: "",
  };
}

function createInitialRenderModeState(): RenderModeState {
  return {
    inspecting: false,
    javaScriptDisabled: false,
    noJsHeld: false,
    operationId: "",
    baseUrl: "",
    lastSnapshotPageUrl: "",
    followUpCompleted: false,
    lastError: "",
  };
}

export type TabLayerState = {
  tabId: number;
  version: number;
  popupView: {
    traceEnabled: boolean;
    traceEvents: PopupTraceEvent[];
    lifecycle: PopupLifecycleState | null;
  };
  activation: {
    contentReady: boolean;
    bootstrapStatus: ActivationBootstrapStatus;
    restorePending: boolean;
    lastError: string;
    lastLifecycle: ActivationLifecycleSnapshot | null;
    lastContentPageUrl: string;
  };
  renderMode: {
    inspecting: boolean;
    javaScriptDisabled: boolean;
    noJsHeld: boolean;
    operationId: string;
    baseUrl: string;
    lastSnapshotPageUrl: string;
    followUpCompleted: boolean;
    lastError: string;
  };
  sessionFactsReported: boolean;
  sessionFacts: SessionFactsState;
  sessionDictation: SessionDictationState;
  aiRun: AiRunState;
  navigationInspectionCurtainClearBefore: number;
  /**
   * True while the brain is the authority for aiBusy/aiComputing because an
   * active AI-run compute spinner lease drove those facts. Lets the brain clear
   * only the facts it set from a lease, without clobbering the resume path where
   * the popup legitimately owns aiBusy/aiComputing (no background lease exists).
   */
  aiRunLeaseOwned: boolean;
  propertyLockView: PropertyLockViewProjectionState;
  propertyLockTimer: PropertyLockTimerProjectionState;
  secondaryGates: SecondaryGatesProjectionState;
  spinners: {
    popup: SpinnerSelection | null;
    pageCurtain: SpinnerSelection | null;
    banner: SpinnerSelection | null;
  };
  tabState: {
    enabled: boolean;
    baseUrl: string;
    pageType: string;
  };
  siteId: number | null;
  pageDataLoadStatus: "ok" | "not_found" | "skipped" | "error" | "auth_error" | null;
  // True once the editor/popup has activated this tab (mirrors the tab-state
  // "initial.active" the popup bootstrap sets). The PASSIVE page-load content
  // activation (background requestContentActivation on a property page) leaves this
  // false, so reveal/freeze + silent highlighting wait for the REAL activation
  // (popup bootstrap, incl. post-render-mode-view) and do not consume the
  // one-per-visit reveal at load — which otherwise left the real activation blank.
  // Consent hiding is decoupled in content and still runs on every property page at
  // load. Internal brain state only: intentionally NOT part of the projected
  // ActivationSnapshot contract.
  editorActivated: boolean;
};

type ProjectionCallback = (tabId: number, state: TabLayerState, reason: string) => void;

function createInitialTabState(tabId: number): TabLayerState {
  return {
    tabId,
    version: 0,
    popupView: {
      traceEnabled: false,
      traceEvents: [],
      lifecycle: null,
    },
    activation: createInitialActivationState(),
    renderMode: createInitialRenderModeState(),
    sessionFactsReported: false,
    sessionFacts: createDefaultSessionFacts(),
    sessionDictation: null,
    aiRun: createInitialAiRunState(),
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
    tabState: { enabled: false, baseUrl: "", pageType: "" },
    siteId: null,
    pageDataLoadStatus: null,
    editorActivated: false,
  };
}

type StateStoreOptions = {
  persist?: (states: Map<number, TabLayerState>) => void;
};

export function createStateStore(options: StateStoreOptions = {}) {
  const persist = typeof options.persist === "function" ? options.persist : null;
  const tabStates = new Map<number, TabLayerState>();
  const projectionCallbacks = new Set<ProjectionCallback>();
  const pendingReasons = new Map<number, string>();

  function get(tabId: number): TabLayerState | null {
    return tabStates.get(tabId) || null;
  }

  function getOrInit(tabId: number): TabLayerState {
    const existing = tabStates.get(tabId);
    if (existing) {
      return existing;
    }
    const created = createInitialTabState(tabId);
    tabStates.set(tabId, created);
    return created;
  }

  function scheduleProjection(tabId: number): void {
    if (!pendingReasons.has(tabId)) {
      return;
    }
    queueMicrotask(() => {
      const reason = pendingReasons.get(tabId);
      const state = tabStates.get(tabId);
      pendingReasons.delete(tabId);
      if (!reason || !state) {
        return;
      }
      for (const callback of projectionCallbacks) {
        callback(tabId, state, reason);
      }
      if (persist) {
        persist(tabStates);
      }
    });
  }

  function mutate(tabId: number, reason: string, fn: (state: TabLayerState) => void): TabLayerState {
    const state = getOrInit(tabId);
    fn(state);
    state.version += 1;
    if (!pendingReasons.has(tabId)) {
      pendingReasons.set(tabId, reason);
      scheduleProjection(tabId);
    }
    return state;
  }

  function forEachTab(callback: (state: TabLayerState) => void): void {
    for (const state of tabStates.values()) {
      callback(state);
    }
  }

  function dispose(tabId: number): void {
    tabStates.delete(tabId);
    pendingReasons.delete(tabId);
  }

  function onProjection(callback: ProjectionCallback): () => void {
    projectionCallbacks.add(callback);
    return () => {
      projectionCallbacks.delete(callback);
    };
  }

  return {
    get,
    getOrInit,
    mutate,
    forEachTab,
    dispose,
    onProjection,
  };
}
