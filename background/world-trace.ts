export const WORLD_TRACE_EVENT_LIMIT = 160;

type WorldTraceEvent = {
  at: number;
  channel: string;
  event: string;
  payload: Record<string, unknown> | null;
};

type WorldTraceState = {
  events: WorldTraceEvent[];
};

type WorldTraceOptions = {
  traceStateByTabId?: Map<number, WorldTraceState>;
  normalizeTabId?: (value: unknown) => number | null;
  isFeatureEnabled?: (flag: string) => boolean;
  isDebugFlagEnabled?: (flag: string) => boolean;
  eventLimit?: unknown;
};

function defaultNormalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function createWorldTrace(options = {}) {
  const typedOptions = options as WorldTraceOptions;
  const traceStateByTabId = typedOptions.traceStateByTabId instanceof Map
    ? typedOptions.traceStateByTabId
    : new Map<number, WorldTraceState>();
  const normalizeTabId = typeof typedOptions.normalizeTabId === "function"
    ? typedOptions.normalizeTabId
    : defaultNormalizeTabId;
  const isFeatureEnabled = typeof typedOptions.isFeatureEnabled === "function"
    ? typedOptions.isFeatureEnabled
    : () => false;
  const isDebugFlagEnabled = typeof typedOptions.isDebugFlagEnabled === "function"
    ? typedOptions.isDebugFlagEnabled
    : () => false;
  const eventLimitCandidate = typedOptions.eventLimit;
  const eventLimit = Number.isFinite(eventLimitCandidate) && (eventLimitCandidate as number) > 0
    ? Math.trunc(eventLimitCandidate as number)
    : WORLD_TRACE_EVENT_LIMIT;

  function ensureTraceState(tabId: unknown): WorldTraceState {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return { events: [] };
    }
    if (!traceStateByTabId.has(normalizedTabId)) {
      traceStateByTabId.set(normalizedTabId, {
        events: []
      });
    }
    return traceStateByTabId.get(normalizedTabId) as WorldTraceState;
  }

  function isWorldTraceEnabled(): boolean {
    return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
  }

  function appendWorldTraceEvent(tabId: unknown, channel: unknown, event: unknown, payload: any = null): void {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !isWorldTraceEnabled()) {
      return;
    }
    const traceState = ensureTraceState(normalizedTabId);
    const traceEvent: WorldTraceEvent = {
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
