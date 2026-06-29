import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES
} from "../src/common/world-messaging-contract.js";
import { createPopupStateBroker } from "../src/background/popup-state-broker.js";

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

test("popup-state broker mirrors lifecycle updates into the brain view even with no popup ports", () => {
  const mirroredStates = [];
  const broker = createPopupStateBroker({
    lifecycleStateByTabId: new Map(),
    spinnerQueueByTabId: new Map(),
    popupStatePortsByTabId: new Map(),
    normalizeTabId,
    ensureTraceState: () => ({ events: [] }),
    isWorldTraceEnabled: () => false,
    updateRuntime: () => {},
    syncPopupView: (tabId, state, reason) => {
      mirroredStates.push({ tabId, state, reason });
    }
  });

  broker.updateLifecycleState(11, {
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "warming"
  });

  assert.equal(mirroredStates.length, 1);
  assert.equal(mirroredStates[0].tabId, 11);
  assert.equal(mirroredStates[0].reason, "popup-state-broker:lifecycle-update");
  assert.equal(mirroredStates[0].state.lifecycle.kind, LIFECYCLE_KINDS.ACTIVATION);
  assert.equal(mirroredStates[0].state.lifecycle.phase, LIFECYCLE_PHASES.STARTED);
  assert.equal(mirroredStates[0].state.lifecycle.busy, true);
  assert.equal(mirroredStates[0].state.lifecycle.message, "warming");
});

test("popup-state broker mirrors direct broadcasts for spinner-originated updates only on valid tabs", () => {
  const mirroredStates = [];
  const broker = createPopupStateBroker({
    lifecycleStateByTabId: new Map([[12, { kind: LIFECYCLE_KINDS.ACTIVATION, phase: LIFECYCLE_PHASES.STARTED }]]),
    spinnerQueueByTabId: new Map(),
    popupStatePortsByTabId: new Map(),
    normalizeTabId,
    ensureTraceState: () => ({ events: [] }),
    isWorldTraceEnabled: () => false,
    updateRuntime: () => {},
    syncPopupView: (tabId, state, reason) => {
      mirroredStates.push({ tabId, state, reason });
    }
  });

  broker.broadcastBrokerState(12);
  broker.broadcastBrokerState(0);

  assert.equal(mirroredStates.length, 1);
  assert.equal(mirroredStates[0].tabId, 12);
  assert.equal(mirroredStates[0].reason, "popup-state-broker:broadcast");
  assert.equal(mirroredStates[0].state.tabId, 12);
});

test("popup-state broker reports terminal curtain-bearing lifecycle without removing nav inspect spinner", () => {
  const lifecycleStateByTabId = new Map([[4, { operationId: "op-1" }]]);
  const spinnerQueueByTabId = new Map([[4, new Map([[SPINNER_KEYS.NAV_INSPECT, { persistent: true, startedAt: 1 }]])]]);
  const popupStatePortsByTabId = new Map();
  const traceEvents = [];
  const mirroredStates = [];

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
    updateRuntime: () => {},
    syncPopupView(tabId, state, reason) {
      mirroredStates.push({ tabId, state, reason });
    }
  });

  broker.updateLifecycleState(4, {
    operationId: "op-1",
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.FINISHED,
    busy: false
  });

  assert.equal(spinnerQueueByTabId.has(4), true);
  assert.equal(spinnerQueueByTabId.get(4).has(SPINNER_KEYS.NAV_INSPECT), true);
  assert.equal(traceEvents.some((entry) => entry.channel === "lifecycle" && entry.event === "terminal-curtain-fact"), true);
  assert.equal(traceEvents.some((entry) => entry.channel === "spinner" && entry.event === "remove"), false);
  assert.equal(mirroredStates.length, 1);
  assert.equal(mirroredStates[0].reason, "popup-state-broker:lifecycle-update");
  assert.equal(mirroredStates[0].state.spinnerQueue.length, 1);
});

test("popup-state broker can clear only activation-scoped lifecycle state", () => {
  const lifecycleStateByTabId = new Map([
    [5, { kind: LIFECYCLE_KINDS.ACTIVATION, phase: LIFECYCLE_PHASES.STARTED }],
    [6, { kind: LIFECYCLE_KINDS.RENDER_MODE_INSPECTION, phase: LIFECYCLE_PHASES.STARTED }]
  ]);
  const mirroredStates = [];
  const broker = createPopupStateBroker({
    lifecycleStateByTabId,
    spinnerQueueByTabId: new Map(),
    popupStatePortsByTabId: new Map(),
    normalizeTabId,
    ensureTraceState: () => ({ events: [] }),
    isWorldTraceEnabled: () => false,
    appendTrace: () => {},
    updateRuntime: () => {},
    syncPopupView(tabId, state, reason) {
      mirroredStates.push({ tabId, state, reason });
    }
  });

  const cleared = broker.clearLifecycleState(5, {
    kinds: [LIFECYCLE_KINDS.ACTIVATION, LIFECYCLE_KINDS.CONTENT_READY],
    reason: "popup-state-broker:lifecycle-clear:activation"
  });
  const untouched = broker.clearLifecycleState(6, {
    kinds: [LIFECYCLE_KINDS.ACTIVATION, LIFECYCLE_KINDS.CONTENT_READY],
    reason: "popup-state-broker:lifecycle-clear:activation"
  });

  assert.equal(lifecycleStateByTabId.has(5), false);
  assert.equal(lifecycleStateByTabId.has(6), true);
  assert.equal(cleared.lifecycle, null);
  assert.equal(untouched.lifecycle.kind, LIFECYCLE_KINDS.RENDER_MODE_INSPECTION);
  assert.equal(mirroredStates.length, 1);
  assert.equal(mirroredStates[0].reason, "popup-state-broker:lifecycle-clear:activation");
});

test("popup-state broker serializes active spinner lease metadata", () => {
  const spinnerQueueByTabId = new Map([
    [7, new Map([
      ["navInspect", {
        message: "Inspecting",
        persistent: true,
        reason: "page-inspection-pending",
        source: "test",
        startedAt: 1_000
      }]
    ])]
  ]);
  const broker = createPopupStateBroker({
    spinnerQueueByTabId,
    normalizeTabId
  });

  const state = broker.buildBrokerState(7);
  assert.equal(state.ok, true);
  assert.equal(state.activeSpinnerLease.operationKind, "content-bootstrap");
  assert.equal(state.activeSpinnerLease.operationPhase, "page-inspection");
  assert.equal(state.activeSpinnerLease.timerMode, "elapsed");
  assert.deepEqual(state.activeSpinnerLease.blockSurfaces, { page: true, popup: true });
  assert.equal(state.spinnerQueue[0].operationId, "content-bootstrap:page-inspection:7:1000");
});

test("popup-state broker prefers the newest blocking lease over background-only leases", () => {
  const spinnerQueueByTabId = new Map([
    [8, new Map([
      ["config", {
        message: "Syncing",
        reason: "config-sync-saving",
        startedAt: 2_000
      }],
      ["ai", {
        message: "Waiting",
        reason: "tab-run-ai-running",
        startedAt: 3_000
      }]
    ])]
  ]);
  const broker = createPopupStateBroker({
    spinnerQueueByTabId,
    normalizeTabId
  });

  const state = broker.buildBrokerState(8);
  assert.equal(state.activeSpinnerLease.operationKind, "ai-run");
  assert.equal(state.activeSpinnerLease.operationPhase, "remote-wait");
  assert.equal(state.activeSpinnerLease.deadlineAt, 483_000);
});

test("popup-state broker keeps unresolved legacy spinners blocking after snapshots", () => {
  const spinnerQueueByTabId = new Map([
    [9, new Map([
      ["legacy", {
        message: "Disabling marking",
        reason: "marking-disable",
        startedAt: 1_000
      }],
      ["background", {
        message: "Syncing",
        reason: "config-sync-saving",
        startedAt: 2_000
      }]
    ])]
  ]);
  const broker = createPopupStateBroker({
    spinnerQueueByTabId,
    normalizeTabId
  });

  const state = broker.buildBrokerState(9);
  assert.equal(Object.prototype.hasOwnProperty.call(state.spinnerQueue[0], "blockSurfaces"), false);
  assert.deepEqual(state.spinnerQueue[1].blockSurfaces, { page: false, popup: false });
  assert.equal(state.activeSpinnerLease.key, "legacy");
});
