import type {
  PopupLegacySpinnerEntry,
  PopupLifecycleState,
  PopupTraceEvent,
} from "../../common/bus/contracts/popup-state.js";

export type SpinnerSelection = Readonly<{
  kind: string;
  phase: string;
  startedAt: number;
  deadlineAt: number;
  operationId?: string;
}>;

export type PopupViewState = Readonly<{
  traceEnabled: boolean;
  traceEvents: PopupTraceEvent[];
  lifecycle: PopupLifecycleState | null;
  legacySpinnerQueue: PopupLegacySpinnerEntry[];
  legacyActiveSpinnerLease: PopupLegacySpinnerEntry | null;
}>;

export type TabLayerState = {
  tabId: number;
  version: number;
  popupView: {
    traceEnabled: boolean;
    traceEvents: PopupTraceEvent[];
    lifecycle: PopupLifecycleState | null;
    legacySpinnerQueue: PopupLegacySpinnerEntry[];
    legacyActiveSpinnerLease: PopupLegacySpinnerEntry | null;
  };
  spinners: {
    popup: SpinnerSelection | null;
    pageCurtain: SpinnerSelection | null;
    banner: SpinnerSelection | null;
  };
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
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    },
    spinners: {
      popup: null,
      pageCurtain: null,
      banner: null,
    },
  };
}

export function createStateStore() {
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
