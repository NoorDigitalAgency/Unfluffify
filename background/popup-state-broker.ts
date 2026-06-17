import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES,
  isCurtainBearingLifecycleKind,
  isLifecycleTerminalPhase
} from "../common/world-messaging-contract.js";

type LifecycleState = Record<string, unknown>;
type SpinnerEntry = Record<string, unknown>;
type TraceState = { events: unknown[] };

type PopupStateBrokerOptions = {
  lifecycleStateByTabId?: Map<number, LifecycleState>;
  spinnerQueueByTabId?: Map<number, Map<string, SpinnerEntry>>;
  popupStatePortsByTabId?: Map<number, Set<chrome.runtime.Port>>;
  normalizeTabId?: (value: unknown) => number | null;
  appendTrace?: (tabId: number, channel: string, event: string, payload: Record<string, unknown>) => void;
  ensureTraceState?: (tabId: number | null) => TraceState;
  isWorldTraceEnabled?: () => boolean;
  updateRuntime?: (tabId: number, patch: Record<string, unknown>) => void;
};

function defaultNormalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function defaultEnsureTraceState(): TraceState {
  return { events: [] };
}

function defaultUpdateRuntime(): void {}

function defaultIsWorldTraceEnabled(): boolean {
  return false;
}

export function createPopupStateBroker(options = {}) {
  const typedOptions = options as PopupStateBrokerOptions;
  const lifecycleStateByTabId = typedOptions.lifecycleStateByTabId instanceof Map
    ? typedOptions.lifecycleStateByTabId
    : new Map<number, LifecycleState>();
  const spinnerQueueByTabId = typedOptions.spinnerQueueByTabId instanceof Map
    ? typedOptions.spinnerQueueByTabId
    : new Map<number, Map<string, SpinnerEntry>>();
  const popupStatePortsByTabId = typedOptions.popupStatePortsByTabId instanceof Map
    ? typedOptions.popupStatePortsByTabId
    : new Map<number, Set<chrome.runtime.Port>>();
  const normalizeTabId = typeof typedOptions.normalizeTabId === "function"
    ? typedOptions.normalizeTabId
    : defaultNormalizeTabId;
  const appendTrace = typeof typedOptions.appendTrace === "function"
    ? typedOptions.appendTrace
    : () => undefined;
  const ensureTraceState = typeof typedOptions.ensureTraceState === "function"
    ? typedOptions.ensureTraceState
    : defaultEnsureTraceState;
  const isWorldTraceEnabled = typeof typedOptions.isWorldTraceEnabled === "function"
    ? typedOptions.isWorldTraceEnabled
    : defaultIsWorldTraceEnabled;
  const updateRuntime = typeof typedOptions.updateRuntime === "function"
    ? typedOptions.updateRuntime
    : defaultUpdateRuntime;

  function getSpinnerQueueForTab(tabId: unknown): Map<string, SpinnerEntry> | null {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return null;
    }
    if (!spinnerQueueByTabId.has(normalizedTabId)) {
      spinnerQueueByTabId.set(normalizedTabId, new Map<string, SpinnerEntry>());
    }
    return spinnerQueueByTabId.get(normalizedTabId) || null;
  }

  function serializeSpinnerQueue(tabId: number): Array<Record<string, unknown>> {
    const queue = spinnerQueueByTabId.get(tabId);
    if (!queue || queue.size === 0) {
      return [];
    }
    return [...queue.entries()].map(([key, entry]) => ({
      key,
      message: entry && typeof entry.message === "string" ? entry.message : "",
      persistent: Boolean(entry && entry.persistent),
      owner: entry && typeof entry.owner === "string" ? entry.owner : "",
      reason: entry && typeof entry.reason === "string" ? entry.reason : "",
      source: entry && typeof entry.source === "string" ? entry.source : "",
      startedAt: entry && Number.isFinite(entry.startedAt) ? entry.startedAt : 0
    }));
  }

  function buildBrokerState(tabId: unknown): Record<string, unknown> {
    const normalizedTabId = normalizeTabId(tabId);
    const traceState = ensureTraceState(normalizedTabId);
    return {
      ok: Boolean(normalizedTabId),
      tabId: normalizedTabId,
      lifecycle: normalizedTabId ? (lifecycleStateByTabId.get(normalizedTabId) || null) : null,
      spinnerQueue: normalizedTabId ? serializeSpinnerQueue(normalizedTabId) : [],
      traceEnabled: isWorldTraceEnabled(),
      traceEvents: traceState && Array.isArray(traceState.events) ? [...traceState.events] : []
    };
  }

  function broadcastBrokerState(tabId: unknown): void {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return;
    }
    const ports = popupStatePortsByTabId.get(normalizedTabId);
    if (!ports || ports.size === 0) {
      return;
    }
    const state = buildBrokerState(normalizedTabId);
    ports.forEach((port) => {
      try {
        port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state });
      } catch {
        ports.delete(port);
      }
    });
  }

  // function clearNavInspectCurtain(normalizedTabId) {
  //   queue.delete(SPINNER_KEYS.NAV_INSPECT)
  // }
  function clearNavInspectCurtain(normalizedTabId: number): boolean {
    const queue = spinnerQueueByTabId.get(normalizedTabId);
    if (!queue || !queue.delete(SPINNER_KEYS.NAV_INSPECT)) {
      return false;
    }
    if (queue.size === 0) {
      spinnerQueueByTabId.delete(normalizedTabId);
    }
    updateRuntime(normalizedTabId, {
      spinnerQueue: queue
    });
    appendTrace(normalizedTabId, "spinner", "remove", {
      type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
      message: SPINNER_KEYS.NAV_INSPECT,
      reason: "lifecycle-terminal"
    });
    return true;
  }

  // function updateLifecycleState(tabId, event = {}) {
  function updateLifecycleState(tabId: unknown, event: unknown = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !event || typeof event !== "object") {
      return buildBrokerState(normalizedTabId);
    }
    const eventRecord = event as Record<string, unknown>;
    const previous = lifecycleStateByTabId.get(normalizedTabId) || {};
    const eventOperationId = typeof eventRecord.operationId === "string" && eventRecord.operationId
      ? eventRecord.operationId
      : "";
    const eventPhase = typeof eventRecord.phase === "string" && eventRecord.phase ? eventRecord.phase : "";
    const eventKind = typeof eventRecord.kind === "string" && eventRecord.kind ? eventRecord.kind : "";
    const isTerminalEvent = isLifecycleTerminalPhase(eventPhase);
    if (
      eventOperationId &&
      previous.operationId &&
      eventOperationId !== previous.operationId &&
      isTerminalEvent
    ) {
      // Superseded terminal lifecycle events must not tear down the current
      // operation's navigation-inspection curtain. Ignore stale terminal events
      // entirely and keep the active operation authoritative.
      return buildBrokerState(normalizedTabId);
    }
    // Authoritative curtain teardown: a terminal curtain-bearing event
    // (inspection/activation finished/failed) means that operation's persistent
    // navigation-inspection curtain is now stale, so drop it for this tab.
    // Routine terminal kinds (content-ready, which fires on every load) are
    // excluded so unrelated curtains are untouched.
    const clearsCurtain = isTerminalEvent && isCurtainBearingLifecycleKind(eventKind);
    if (clearsCurtain) {
      clearNavInspectCurtain(normalizedTabId);
    }
    const operationId = eventOperationId
      ? eventRecord.operationId
      : previous.operationId || `lifecycle:${normalizedTabId}:${Date.now()}`;
    // const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
    const hasBusy = Object.prototype.hasOwnProperty.call(eventRecord, "busy");
    const next = {
      ...previous,
      ...eventRecord,
      operationId,
      kind: typeof eventRecord.kind === "string" && eventRecord.kind ? eventRecord.kind : previous.kind || LIFECYCLE_KINDS.UNKNOWN,
      phase: eventPhase || previous.phase || LIFECYCLE_PHASES.UNKNOWN,
      message: typeof eventRecord.message === "string" ? eventRecord.message : previous.message || "",
      // busy: hasBusy ? Boolean(event.busy) : Boolean(previous.busy)
      busy: hasBusy ? Boolean(eventRecord.busy) : Boolean(previous.busy),
      updatedAt: Date.now()
    };
    lifecycleStateByTabId.set(normalizedTabId, next);
    updateRuntime(normalizedTabId, {
      lifecycle: next
    });
    appendTrace(normalizedTabId, "lifecycle", "state-update", next);
    broadcastBrokerState(normalizedTabId);
    return buildBrokerState(normalizedTabId);
  }

  return {
    getSpinnerQueueForTab,
    serializeSpinnerQueue,
    buildBrokerState,
    broadcastBrokerState,
    updateLifecycleState,
    clearNavInspectCurtain
  };
}
