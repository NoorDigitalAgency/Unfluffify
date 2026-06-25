import { describe, expect, it, vi } from "vitest";

import { createBus } from "../common/bus/bus.js";
import { POPUP_STATE_EVENT_TYPES } from "../common/bus/contracts/popup-state.js";
import { SPINNER_EVENT_TYPES } from "../common/bus/contracts/spinner.js";
import { REALMS } from "../common/bus/realms.js";
import { getLatestPopupView, startPopupLayerHostWithOptions } from "../popup/layers/layer-host.js";
import { getLatestPopupSpinnerState } from "../popup/layers/spinner-layer.js";

function createTestBus() {
  return createBus({
    realm: REALMS.POPUP,
    transport: {
      send() {
        return Promise.resolve(undefined);
      },
      onInbound() {},
      start() {},
      stop() {},
    },
  });
}

describe("popup layer host", () => {
  it("delivers popup view updates into the compatibility callback", async () => {
    const bus = createTestBus();
    const applyPopupView = vi.fn();
    const stop = startPopupLayerHostWithOptions(bus, { applyPopupView });

    await bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, {
      version: 4,
      tabId: 12,
      traceEnabled: true,
      traceEvents: [],
      lifecycle: { kind: "activation", phase: "started" },
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    }, { target: REALMS.POPUP, tab: 12 });

    expect(applyPopupView).toHaveBeenCalledWith(expect.objectContaining({
      version: 4,
      tabId: 12,
    }));
    expect(getLatestPopupView()).toMatchObject({
      version: 4,
      tabId: 12,
    });

    stop();
  });

  it("ignores the popup view callback when none is provided", async () => {
    const bus = createTestBus();
    const stop = startPopupLayerHostWithOptions(bus, {});

    await expect(bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, {
      version: 1,
      tabId: 5,
      traceEnabled: false,
      traceEvents: [],
      lifecycle: null,
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    }, { target: REALMS.POPUP, tab: 5 })).resolves.toBeUndefined();

    stop();
  });

  it("stores projected spinner surfaces for popup-side busy derivation", async () => {
    const bus = createTestBus();
    const stop = startPopupLayerHostWithOptions(bus, {});

    await bus.publish(SPINNER_EVENT_TYPES.SET, {
      surface: "pageCurtain",
      state: {
        title: "Inspecting page",
        message: "Inspecting page... it will be ready soon",
        startedAt: 10,
        deadlineAt: 20,
        blockSurfaces: { page: true, popup: true },
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        operationId: "op-1",
        reason: "page-inspection-pending",
        source: "background-spinner-broker",
        spinnerKey: "navInspect",
      },
    }, { target: REALMS.POPUP, tab: 12 });

    await bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, {
      version: 5,
      tabId: 12,
      traceEnabled: false,
      traceEvents: [],
      lifecycle: { kind: "activation", phase: "started" },
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    }, { target: REALMS.POPUP, tab: 12 });

    expect(getLatestPopupSpinnerState("pageCurtain")).toMatchObject({
      operationId: "op-1",
      reason: "page-inspection-pending",
      spinnerKey: "navInspect",
    });

    stop();
  });
});
