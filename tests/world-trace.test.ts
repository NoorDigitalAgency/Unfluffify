import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createWorldTrace } from "../src/background/world-trace.js";

test("world trace keeps state scoped per tab", () => {
  const traceStateByTabId = new Map();
  const worldTrace = createWorldTrace({
    traceStateByTabId,
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => true,
    isDebugFlagEnabled: () => true,
    eventLimit: 5
  });

  worldTrace.appendWorldTraceEvent(1, "broker", "tab-one-event");
  worldTrace.appendWorldTraceEvent(2, "broker", "tab-two-event");

  const tabOneEvents = worldTrace.ensureTraceState(1).events;
  const tabTwoEvents = worldTrace.ensureTraceState(2).events;

  assert.equal(tabOneEvents.length, 1);
  assert.equal(tabTwoEvents.length, 1);
  assert.equal(tabOneEvents[0].event, "tab-one-event");
  assert.equal(tabTwoEvents[0].event, "tab-two-event");
});

test("world trace enforces the configured event cap", () => {
  const worldTrace = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => true,
    isDebugFlagEnabled: () => true,
    eventLimit: 2
  });

  worldTrace.appendWorldTraceEvent(1, "broker", "first");
  worldTrace.appendWorldTraceEvent(1, "broker", "second");
  worldTrace.appendWorldTraceEvent(1, "broker", "third");

  const events = worldTrace.ensureTraceState(1).events;
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "second");
  assert.equal(events[1].event, "third");
});

test("world trace enablement requires both diagnostics feature and debug flag", () => {
  const enabledWorldTrace = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: (name) => name === "traceDiagnostics",
    isDebugFlagEnabled: (name) => name === "worldTraceEnabled"
  });
  const disabledByFeature = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => false,
    isDebugFlagEnabled: () => true
  });
  const disabledByFlag = createWorldTrace({
    traceStateByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    isFeatureEnabled: () => true,
    isDebugFlagEnabled: () => false
  });

  assert.equal(enabledWorldTrace.isWorldTraceEnabled(), true);
  assert.equal(disabledByFeature.isWorldTraceEnabled(), false);
  assert.equal(disabledByFlag.isWorldTraceEnabled(), false);
});
