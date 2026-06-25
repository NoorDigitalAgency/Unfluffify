import { describe, expect, it } from "vitest";

import { createStateStore } from "../background/brain/state-store.js";
import {
  buildPopupViewFromBrokerState,
  getPopupView,
  updatePopupViewFromBrokerState,
} from "../background/brain/deciders/popup-state-decider.js";

describe("popup state decider", () => {
  it("builds a compatibility popup view from broker state", () => {
    const brokerState = {
      ok: true,
      tabId: 9,
      traceEnabled: true,
      traceEvents: [{
        at: 1,
        channel: "broker",
        event: "state-update",
        payload: {
          message: "warming",
          label: "legacy-extra",
        },
      }],
      lifecycle: {
        kind: "activation",
        message: "warming",
        contentMode: "marking",
      },
      spinnerQueue: [{
        key: "navInspect",
        message: "Inspecting",
        persistent: true,
        owner: "popup",
        reason: "page-inspection-pending",
        source: "background",
        startedAt: 1_000,
        progress: 0,
        operationId: "op-1",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        timerMode: "elapsed",
        deadlineAt: 0,
        maxDurationMs: 0,
        updatedAt: 1_000,
      }],
      activeSpinnerLease: null,
    } as const;

    expect(buildPopupViewFromBrokerState(brokerState, 4)).toEqual({
      version: 4,
      tabId: 9,
      traceEnabled: true,
      traceEvents: [{
        at: 1,
        channel: "broker",
        event: "state-update",
        payload: {
          message: "warming",
          label: "legacy-extra",
        },
      }],
      lifecycle: {
        kind: "activation",
        message: "warming",
        contentMode: "marking",
      },
      legacySpinnerQueue: [{
        key: "navInspect",
        message: "Inspecting",
        persistent: true,
        owner: "popup",
        reason: "page-inspection-pending",
        source: "background",
        startedAt: 1_000,
        progress: 0,
        operationId: "op-1",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        timerMode: "elapsed",
        deadlineAt: 0,
        maxDurationMs: 0,
        updatedAt: 1_000,
      }],
      legacyActiveSpinnerLease: null,
    });
  });

  it("mirrors broker state into the brain store and returns the projected popup view", () => {
    const store = createStateStore();

    const result = updatePopupViewFromBrokerState(store, 5, {
      ok: true,
      tabId: 5,
      traceEnabled: false,
      traceEvents: [],
      lifecycle: {
        kind: "activation",
        phase: "started",
      },
      spinnerQueue: [],
      activeSpinnerLease: null,
    }, "popup-state:update");

    expect(result).toMatchObject({
      version: 1,
      tabId: 5,
      lifecycle: {
        kind: "activation",
        phase: "started",
      },
    });
    expect(store.get(5)?.popupView.lifecycle).toEqual({
      kind: "activation",
      phase: "started",
    });
  });

  it("returns the default projected popup view for tabs with no mirrored broker state yet", () => {
    const store = createStateStore();

    expect(getPopupView(store, 7)).toEqual({
      version: 0,
      tabId: 7,
      traceEnabled: false,
      traceEvents: [],
      lifecycle: null,
      activation: {
        contentReady: false,
        bootstrapStatus: "idle",
        restorePending: false,
        lastError: "",
        lastLifecycle: null,
        lastContentPageUrl: "",
      },
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    });
  });
});
