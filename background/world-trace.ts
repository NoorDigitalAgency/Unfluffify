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

  function appendWorldTraceEvent(tabId: unknown, channel: unknown, event: unknown, payload: unknown = null): void {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !isWorldTraceEnabled()) {
      return;
    }
    const traceState = ensureTraceState(normalizedTabId);
    const payloadRecord = payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : null;
    const traceEvent: WorldTraceEvent = {
      at: Date.now(),
      channel: typeof channel === "string" ? channel : "broker",
      event: typeof event === "string" ? event : "event",
      payload: payloadRecord
        ? {
          type: payloadRecord.type || "",
          kind: payloadRecord.kind || "",
          phase: payloadRecord.phase || "",
          operationId: payloadRecord.operationId || "",
          busy: Object.prototype.hasOwnProperty.call(payloadRecord, "busy") ? Boolean(payloadRecord.busy) : undefined,
          message: typeof payloadRecord.message === "string" ? payloadRecord.message : "",
          reason: typeof payloadRecord.reason === "string" ? payloadRecord.reason : "",
          source: typeof payloadRecord.source === "string" ? payloadRecord.source : "",
          key: typeof payloadRecord.key === "string" ? payloadRecord.key : ""
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
