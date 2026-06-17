// @ts-nocheck
export const WORLD_TRACE_EVENT_LIMIT = 160;

function defaultNormalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function createWorldTrace(options = {}) {
  const traceStateByTabId = options.traceStateByTabId instanceof Map
    ? options.traceStateByTabId
    : new Map();
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const isFeatureEnabled = typeof options.isFeatureEnabled === "function"
    ? options.isFeatureEnabled
    : () => false;
  const isDebugFlagEnabled = typeof options.isDebugFlagEnabled === "function"
    ? options.isDebugFlagEnabled
    : () => false;
  const eventLimit = Number.isFinite(options.eventLimit) && options.eventLimit > 0
    ? Math.trunc(options.eventLimit)
    : WORLD_TRACE_EVENT_LIMIT;

  function ensureTraceState(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return { events: [] };
    }
    if (!traceStateByTabId.has(normalizedTabId)) {
      traceStateByTabId.set(normalizedTabId, {
        events: []
      });
    }
    return traceStateByTabId.get(normalizedTabId);
  }

  function isWorldTraceEnabled() {
    return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
  }

  function appendWorldTraceEvent(tabId, channel, event, payload = null) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !isWorldTraceEnabled()) {
      return;
    }
    const traceState = ensureTraceState(normalizedTabId);
    const traceEvent = {
      at: Date.now(),
      channel: typeof channel === "string" ? channel : "broker",
      event: typeof event === "string" ? event : "event",
      payload: payload && typeof payload === "object"
        ? {
          type: payload.type || "",
          kind: payload.kind || "",
          phase: payload.phase || "",
          operationId: payload.operationId || "",
          busy: Object.prototype.hasOwnProperty.call(payload, "busy") ? Boolean(payload.busy) : undefined,
          message: typeof payload.message === "string" ? payload.message : "",
          reason: typeof payload.reason === "string" ? payload.reason : "",
          source: typeof payload.source === "string" ? payload.source : "",
          key: typeof payload.key === "string" ? payload.key : ""
        }
        : null
    };
    traceState.events.push(traceEvent);
    if (traceState.events.length > eventLimit) {
      traceState.events.splice(0, traceState.events.length - eventLimit);
    }
    try {
      console.debug("[world-trace][background]", normalizedTabId, traceEvent.channel, traceEvent.event, traceEvent.payload || {});
    } catch {
      // Trace logging must never break runtime behavior.
    }
  }

  return {
    ensureTraceState,
    isWorldTraceEnabled,
    appendWorldTraceEvent
  };
}
