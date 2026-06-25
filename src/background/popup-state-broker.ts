import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES,
  isCurtainBearingLifecycleKind,
  isLifecycleTerminalPhase
} from "../common/world-messaging-contract.js";
import { createSpinnerOperationLease } from "../common/spinner-contract.js";
import type {
  PopupLegacySpinnerEntry,
  PopupLifecycleState,
  PopupTraceEvent,
} from "../common/bus/contracts/popup-state.js";

type LifecycleState = PopupLifecycleState;
type SpinnerEntry = Record<string, unknown>;
type TraceState = { events: PopupTraceEvent[] };

export type PopupBrokerState = Readonly<{
  ok: boolean;
  tabId: number | null;
  lifecycle: PopupLifecycleState | null;
  spinnerQueue: PopupLegacySpinnerEntry[];
  activeSpinnerLease: PopupLegacySpinnerEntry | null;
  traceEnabled: boolean;
  traceEvents: PopupTraceEvent[];
}>;

type PopupStateBrokerOptions = {
  lifecycleStateByTabId?: Map<number, LifecycleState>;
  spinnerQueueByTabId?: Map<number, Map<string, SpinnerEntry>>;
  popupStatePortsByTabId?: Map<number, Set<chrome.runtime.Port>>;
  normalizeTabId?: (value: unknown) => number | null;
  appendTrace?: (tabId: number, channel: string, event: string, payload: Record<string, unknown>) => void;
  ensureTraceState?: (tabId: number | null) => TraceState;
  isWorldTraceEnabled?: () => boolean;
  updateRuntime?: (tabId: number, patch: Record<string, unknown>) => void;
  syncPopupView?: (tabId: number, state: PopupBrokerState, reason: string) => void;
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

function defaultSyncPopupView(): void {}

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
  const syncPopupView = typeof typedOptions.syncPopupView === "function"
    ? typedOptions.syncPopupView
    : defaultSyncPopupView;

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

  function serializeSpinnerQueue(tabId: number): PopupLegacySpinnerEntry[] {
    const queue = spinnerQueueByTabId.get(tabId);
    if (!queue || queue.size === 0) {
      return [];
    }
    return [...queue.entries()].map(([key, entry]) => {
      const message = entry && typeof entry.message === "string" ? entry.message : "";
      const reason = entry && typeof entry.reason === "string" ? entry.reason : "";
      const startedAt = entry && Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : 0;
      const blockSurfaces = entry && entry.blockSurfaces && typeof entry.blockSurfaces === "object"
        ? entry.blockSurfaces as Record<string, boolean>
        : undefined;
      const details = entry && entry.details && typeof entry.details === "object"
        ? entry.details
        : undefined;
      const lease = createSpinnerOperationLease({
        blockSurfaces,
        deadlineAt: entry && Number.isFinite(entry.deadlineAt) ? entry.deadlineAt : undefined,
        details,
        kind: entry && typeof entry.operationKind === "string" ? entry.operationKind : undefined,
        maxDurationMs: entry && Number.isFinite(entry.maxDurationMs) ? entry.maxDurationMs : undefined,
        message,
        operationId: entry && typeof entry.operationId === "string" ? entry.operationId : undefined,
        operationPhase: entry && typeof entry.operationPhase === "string" ? entry.operationPhase : undefined,
        reason,
        spinnerKey: key,
        startedAt: startedAt || Date.now(),
        tabId,
        timerMode: entry && typeof entry.timerMode === "string" ? entry.timerMode : undefined,
        updatedAt: entry && Number.isFinite(entry.updatedAt) ? entry.updatedAt : undefined
      });
      return {
        key,
        message,
        persistent: Boolean(entry && entry.persistent),
        owner: entry && typeof entry.owner === "string" ? entry.owner : "",
        reason,
        source: entry && typeof entry.source === "string" ? entry.source : "",
        startedAt,
        progress: entry && Number.isFinite(entry.progress) ? Number(entry.progress) : 0,
        operationId: lease ? lease.operationId : "",
        operationKind: lease ? lease.kind : "",
        operationPhase: lease ? lease.phase : "",
        timerMode: lease ? lease.timerMode : "",
        deadlineAt: lease ? lease.deadlineAt : 0,
        maxDurationMs: lease ? lease.maxDurationMs : 0,
        updatedAt: lease ? lease.updatedAt : 0,
        ...(lease ? { blockSurfaces: { ...lease.blockSurfaces } } : {}),
      } satisfies PopupLegacySpinnerEntry;
    });
  }

  function getActiveSpinnerLease(tabId: number): PopupLegacySpinnerEntry | null {
    const serializedQueue = serializeSpinnerQueue(tabId);
    for (const entry of serializedQueue.slice().reverse()) {
      if (!Object.prototype.hasOwnProperty.call(entry, "blockSurfaces")) {
        return entry;
      }
      const blockSurfaces = entry.blockSurfaces && typeof entry.blockSurfaces === "object"
        ? entry.blockSurfaces as Record<string, unknown>
        : {};
      if (blockSurfaces.popup === true || blockSurfaces.page === true) {
        return entry;
      }
    }
    return serializedQueue.length ? serializedQueue[serializedQueue.length - 1] : null;
  }

  function buildBrokerState(tabId: unknown): PopupBrokerState {
    const normalizedTabId = normalizeTabId(tabId);
    const traceState = ensureTraceState(normalizedTabId);
    return {
      ok: Boolean(normalizedTabId),
      tabId: normalizedTabId,
      lifecycle: normalizedTabId ? (lifecycleStateByTabId.get(normalizedTabId) || null) : null,
      spinnerQueue: normalizedTabId ? serializeSpinnerQueue(normalizedTabId) : [],
      activeSpinnerLease: normalizedTabId ? getActiveSpinnerLease(normalizedTabId) : null,
      traceEnabled: isWorldTraceEnabled(),
      traceEvents: traceState && Array.isArray(traceState.events) ? [...traceState.events] : []
    };
  }

  function broadcastBrokerState(tabId: unknown, reason = "popup-state-broker:broadcast"): PopupBrokerState {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return buildBrokerState(normalizedTabId);
    }
    const state = buildBrokerState(normalizedTabId);
    const ports = popupStatePortsByTabId.get(normalizedTabId);
    if (ports && ports.size > 0) {
      ports.forEach((port) => {
        try {
          port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state });
        } catch {
          ports.delete(port);
        }
      });
    }
    syncPopupView(normalizedTabId, state, reason);
    return state;
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
    const previous: PopupLifecycleState = lifecycleStateByTabId.get(normalizedTabId) || {};
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
      ? eventOperationId
      : previous.operationId || `lifecycle:${normalizedTabId}:${Date.now()}`;
    // const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
    const hasBusy = Object.prototype.hasOwnProperty.call(eventRecord, "busy");
    const next: PopupLifecycleState = {
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
    return broadcastBrokerState(normalizedTabId, "popup-state-broker:lifecycle-update");
  }

  function clearLifecycleState(
    tabId: unknown,
    options: Readonly<{
      kinds?: readonly string[];
      reason?: string;
      runtimeLifecycle?: Readonly<Record<string, unknown>> | null;
    }> = {},
  ) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return buildBrokerState(normalizedTabId);
    }
    const previous = lifecycleStateByTabId.get(normalizedTabId) || null;
    if (!previous) {
      return buildBrokerState(normalizedTabId);
    }
    const previousKind = typeof previous.kind === "string" ? previous.kind : "";
    const kinds = Array.isArray(options.kinds)
      ? options.kinds.filter((kind): kind is string => typeof kind === "string" && kind.length > 0)
      : [];
    if (kinds.length > 0 && !kinds.includes(previousKind)) {
      return buildBrokerState(normalizedTabId);
    }
    lifecycleStateByTabId.delete(normalizedTabId);
    updateRuntime(normalizedTabId, {
      lifecycle: Object.prototype.hasOwnProperty.call(options, "runtimeLifecycle")
        ? options.runtimeLifecycle || null
        : null
    });
    appendTrace(normalizedTabId, "lifecycle", "state-clear", {
      kind: previousKind,
      reason: typeof options.reason === "string" ? options.reason : "popup-state-broker:lifecycle-clear"
    });
    return broadcastBrokerState(
      normalizedTabId,
      typeof options.reason === "string" && options.reason
        ? options.reason
        : "popup-state-broker:lifecycle-clear"
    );
  }

  return {
    getSpinnerQueueForTab,
    serializeSpinnerQueue,
    buildBrokerState,
    broadcastBrokerState,
    updateLifecycleState,
    clearLifecycleState,
    clearNavInspectCurtain
  };
}
