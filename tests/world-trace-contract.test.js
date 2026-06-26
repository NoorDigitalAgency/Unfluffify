import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { WORLD_MESSAGE_TYPES } from "../src/common/world-messaging-contract.js";
import { WORLD_TRACE_EVENT_LIMIT, createWorldTrace } from "../src/background/world-trace.js";

test("world messaging contract no longer exposes runtime trace toggle message types", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(WORLD_MESSAGE_TYPES, "TRACE_SET"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(WORLD_MESSAGE_TYPES, "CONTENT_TRACE_SET"), false);
});

test("world trace uses the stable default event limit", () => {
  const worldTrace = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => true,
    isDebugFlagEnabled: () => true,
    eventLimit: 0,
  });

  for (let index = 0; index <= WORLD_TRACE_EVENT_LIMIT; index += 1) {
    worldTrace.appendWorldTraceEvent(1, "broker", `event-${index}`);
  }

  const events = worldTrace.ensureTraceState(1).events;
  assert.equal(events.length, WORLD_TRACE_EVENT_LIMIT);
  assert.equal(events[0].event, "event-1");
  assert.equal(events[events.length - 1].event, `event-${WORLD_TRACE_EVENT_LIMIT}`);
});

test("world trace normalizes payload metadata to stable primitives", () => {
  const worldTrace = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => true,
    isDebugFlagEnabled: () => true,
  });

  worldTrace.appendWorldTraceEvent(1, "broker", "state-update", {
    type: "ufLifecycleEvent",
    kind: "activation",
    phase: "started",
    operationId: "op-1",
    busy: 1,
    message: 42,
    reason: null,
    source: undefined,
    key: "navInspect",
  });

  const [event] = worldTrace.ensureTraceState(1).events;
  assert.deepEqual(event.payload, {
    type: "ufLifecycleEvent",
    kind: "activation",
    phase: "started",
    operationId: "op-1",
    busy: true,
    message: "",
    reason: "",
    source: "",
    key: "navInspect",
  });
});
