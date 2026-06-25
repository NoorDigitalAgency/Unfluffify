import { describe, expect, it } from "vitest";

import { projectViews } from "../background/brain/view-projector.js";
import type { TabLayerState } from "../background/brain/state-store.js";

describe("popup view projector", () => {
  it("projects the compatibility popup view fields from tab state", () => {
    const state: TabLayerState = {
      tabId: 12,
      version: 3,
      popupView: {
        traceEnabled: true,
        traceEvents: [{
          at: 10,
          channel: "broker",
          event: "state-update",
          payload: {
            type: "LIFECYCLE_EVENT",
            kind: "activation",
            phase: "started",
            message: "warming",
            label: "legacy-extra",
          },
        }],
        lifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationKind: "content-bootstrap",
          operationPhase: "page-inspection",
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
          operationId: "content-bootstrap:page-inspection:12:1000",
          operationKind: "content-bootstrap",
          operationPhase: "page-inspection",
          timerMode: "elapsed",
          deadlineAt: 0,
          maxDurationMs: 0,
          updatedAt: 1_000,
          blockSurfaces: {
            page: true,
            popup: true,
          },
        }],
        legacyActiveSpinnerLease: {
          key: "navInspect",
          message: "Inspecting",
          persistent: true,
          owner: "popup",
          reason: "page-inspection-pending",
          source: "background",
          startedAt: 1_000,
          progress: 0,
          operationId: "content-bootstrap:page-inspection:12:1000",
          operationKind: "content-bootstrap",
          operationPhase: "page-inspection",
          timerMode: "elapsed",
          deadlineAt: 0,
          maxDurationMs: 0,
          updatedAt: 1_000,
          blockSurfaces: {
            page: true,
            popup: true,
          },
        },
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    const { popupView, contentDirective } = projectViews(state);

    expect(contentDirective).toEqual({ version: 3 });
    expect(popupView).toEqual({
      version: 3,
      tabId: 12,
      traceEnabled: true,
      traceEvents: [{
        at: 10,
        channel: "broker",
        event: "state-update",
        payload: {
          type: "LIFECYCLE_EVENT",
          kind: "activation",
          phase: "started",
          message: "warming",
          label: "legacy-extra",
        },
      }],
      lifecycle: {
        kind: "activation",
        phase: "started",
        message: "warming",
        busy: true,
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
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
        operationId: "content-bootstrap:page-inspection:12:1000",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        timerMode: "elapsed",
        deadlineAt: 0,
        maxDurationMs: 0,
        updatedAt: 1_000,
        blockSurfaces: {
          page: true,
          popup: true,
        },
      }],
      legacyActiveSpinnerLease: {
        key: "navInspect",
        message: "Inspecting",
        persistent: true,
        owner: "popup",
        reason: "page-inspection-pending",
        source: "background",
        startedAt: 1_000,
        progress: 0,
        operationId: "content-bootstrap:page-inspection:12:1000",
        operationKind: "content-bootstrap",
        operationPhase: "page-inspection",
        timerMode: "elapsed",
        deadlineAt: 0,
        maxDurationMs: 0,
        updatedAt: 1_000,
        blockSurfaces: {
          page: true,
          popup: true,
        },
      },
    });
  });

  it("clones nested popup view data instead of sharing references", () => {
    const state: TabLayerState = {
      tabId: 2,
      version: 1,
      popupView: {
        traceEnabled: false,
        traceEvents: [{
          at: 1,
          channel: "broker",
          event: "event",
          payload: {
            message: "before",
          },
        }],
        lifecycle: {
          message: "before",
        },
        legacySpinnerQueue: [{
          key: "q",
          message: "Queue",
          persistent: false,
          owner: "",
          reason: "",
          source: "",
          startedAt: 1,
          progress: 0,
          operationId: "",
          operationKind: "",
          operationPhase: "",
          timerMode: "",
          deadlineAt: 0,
          maxDurationMs: 0,
          updatedAt: 1,
          blockSurfaces: {
            popup: true,
          },
        }],
        legacyActiveSpinnerLease: null,
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    const projected = projectViews(state).popupView;
    state.popupView.traceEvents[0].payload = {
      message: "after",
    };
    state.popupView.lifecycle = {
      message: "after",
    };
    state.popupView.legacySpinnerQueue[0].blockSurfaces = {
      popup: false,
    };

    expect(projected.traceEvents[0].payload).toEqual({ message: "before" });
    expect(projected.lifecycle).toEqual({ message: "before" });
    expect(projected.legacySpinnerQueue[0].blockSurfaces).toEqual({ popup: true });
  });
});
