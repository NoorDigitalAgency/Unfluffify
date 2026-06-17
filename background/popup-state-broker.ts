// @ts-nocheck
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES,
  isCurtainBearingLifecycleKind,
  isLifecycleTerminalPhase
} from "../common/world-messaging-contract.js";

function defaultNormalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function defaultEnsureTraceState() {
  return { events: [] };
}

function defaultUpdateRuntime() {}

function defaultIsWorldTraceEnabled() {
  return false;
}

export function createPopupStateBroker(options = {}) {
  const lifecycleStateByTabId = options.lifecycleStateByTabId instanceof Map
    ? options.lifecycleStateByTabId
    : new Map();
  const spinnerQueueByTabId = options.spinnerQueueByTabId instanceof Map
    ? options.spinnerQueueByTabId
    : new Map();
  const popupStatePortsByTabId = options.popupStatePortsByTabId instanceof Map
    ? options.popupStatePortsByTabId
    : new Map();
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const appendTrace = typeof options.appendTrace === "function"
    ? options.appendTrace
    : () => {};
  const ensureTraceState = typeof options.ensureTraceState === "function"
    ? options.ensureTraceState
    : defaultEnsureTraceState;
  const isWorldTraceEnabled = typeof options.isWorldTraceEnabled === "function"
    ? options.isWorldTraceEnabled
    : defaultIsWorldTraceEnabled;
  const updateRuntime = typeof options.updateRuntime === "function"
    ? options.updateRuntime
    : defaultUpdateRuntime;

  function getSpinnerQueueForTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return null;
    }
    if (!spinnerQueueByTabId.has(normalizedTabId)) {
      spinnerQueueByTabId.set(normalizedTabId, new Map());
    }
    return spinnerQueueByTabId.get(normalizedTabId);
  }

  function serializeSpinnerQueue(tabId) {
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

  function buildBrokerState(tabId) {
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

  function broadcastBrokerState(tabId) {
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

  function clearNavInspectCurtain(normalizedTabId) {
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

  function updateLifecycleState(tabId, event = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !event || typeof event !== "object") {
      return buildBrokerState(normalizedTabId);
    }
    const previous = lifecycleStateByTabId.get(normalizedTabId) || {};
    const eventOperationId = typeof event.operationId === "string" && event.operationId
      ? event.operationId
      : "";
    const eventPhase = typeof event.phase === "string" && event.phase ? event.phase : "";
    const eventKind = typeof event.kind === "string" && event.kind ? event.kind : "";
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
      ? event.operationId
      : previous.operationId || `lifecycle:${normalizedTabId}:${Date.now()}`;
    const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
    const next = {
      ...previous,
      ...event,
      operationId,
      kind: typeof event.kind === "string" && event.kind ? event.kind : previous.kind || LIFECYCLE_KINDS.UNKNOWN,
      phase: eventPhase || previous.phase || LIFECYCLE_PHASES.UNKNOWN,
      message: typeof event.message === "string" ? event.message : previous.message || "",
      busy: hasBusy ? Boolean(event.busy) : Boolean(previous.busy),
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
