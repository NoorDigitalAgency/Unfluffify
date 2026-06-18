import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES
} from "../common/world-messaging-contract.js";
import { createPopupStateBroker } from "../background/popup-state-broker.js";

function normalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

test("popup-state broker builds a stable background snapshot shape", () => {
  const lifecycleStateByTabId = new Map([[3, { kind: LIFECYCLE_KINDS.ACTIVATION, phase: LIFECYCLE_PHASES.STARTED }]]);
  const spinnerQueueByTabId = new Map([[3, new Map([["k1", { message: "Busy", persistent: true, owner: "popup", startedAt: 1 }]])]]);
  const popupStatePortsByTabId = new Map();
  const broker = createPopupStateBroker({
    lifecycleStateByTabId,
    spinnerQueueByTabId,
    popupStatePortsByTabId,
    normalizeTabId,
    ensureTraceState: () => ({ events: [{ at: 1, channel: "broker", event: "e" }] }),
    isWorldTraceEnabled: () => true
  });

  const state = broker.buildBrokerState(3);
  assert.equal(state.ok, true);
  assert.equal(state.tabId, 3);
  assert.deepEqual(state.lifecycle, { kind: LIFECYCLE_KINDS.ACTIVATION, phase: LIFECYCLE_PHASES.STARTED });
  assert.equal(state.spinnerQueue.length, 1);
  assert.equal(state.spinnerQueue[0].key, "k1");
  assert.equal(state.traceEnabled, true);
  assert.equal(state.traceEvents.length, 1);
});

test("popup-state broker lifecycle updates broadcast only to target tab ports", () => {
  const lifecycleStateByTabId = new Map();
  const spinnerQueueByTabId = new Map();
  const targetMessages = [];
  const otherMessages = [];
  const popupStatePortsByTabId = new Map([
    [7, new Set([{ postMessage: (message) => targetMessages.push(message) }])],
    [8, new Set([{ postMessage: (message) => otherMessages.push(message) }])]
  ]);

  const broker = createPopupStateBroker({
    lifecycleStateByTabId,
    spinnerQueueByTabId,
    popupStatePortsByTabId,
    normalizeTabId,
    ensureTraceState: () => ({ events: [] }),
    isWorldTraceEnabled: () => false,
    updateRuntime: () => {}
  });

  broker.updateLifecycleState(7, {
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "warming"
  });

  assert.equal(targetMessages.length, 1);
  assert.equal(targetMessages[0].type, WORLD_MESSAGE_TYPES.BACKGROUND_STATE);
  assert.equal(otherMessages.length, 0);
});

test("popup-state broker terminal curtain-bearing lifecycle removes nav inspect spinner", () => {
  const lifecycleStateByTabId = new Map([[4, { operationId: "op-1" }]]);
  const spinnerQueueByTabId = new Map([[4, new Map([[SPINNER_KEYS.NAV_INSPECT, { persistent: true, startedAt: 1 }]])]]);
  const popupStatePortsByTabId = new Map();
  const traceEvents = [];

  const broker = createPopupStateBroker({
    lifecycleStateByTabId,
    spinnerQueueByTabId,
    popupStatePortsByTabId,
    normalizeTabId,
    ensureTraceState: () => ({ events: [] }),
    isWorldTraceEnabled: () => false,
    appendTrace: (tabId, channel, event, payload) => {
      traceEvents.push({ tabId, channel, event, payload });
    },
    updateRuntime: () => {}
  });

  broker.updateLifecycleState(4, {
    operationId: "op-1",
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.FINISHED,
    busy: false
  });

  assert.equal(spinnerQueueByTabId.has(4), false);
  assert.equal(traceEvents.some((entry) => entry.channel === "spinner" && entry.event === "remove"), true);
});
