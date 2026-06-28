import { describe, expect, it } from "vitest";

import { projectViews } from "../src/background/brain/view-projector.js";
import type { TabLayerState } from "../src/background/brain/state-store.js";

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
            label: "spinner-extra",
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
        spinnerQueue: [{
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
        activeSpinnerLease: {
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
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        javaScriptDisabled: true,
        noJsHeld: true,
        operationId: "render-mode:12:1",
        baseUrl: "https://example.com",
        lastSnapshotPageUrl: "https://example.com/page",
        followUpCompleted: true,
        lastError: "",
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    const { popupView, contentDirective } = projectViews(state);

    expect(contentDirective).toEqual({
      version: 3,
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        operationId: "render-mode:12:1",
        noJsHeld: true,
        javaScriptDisabled: true,
      },
    });
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
          label: "spinner-extra",
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
      activation: {
        contentReady: true,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "warming",
          busy: true,
          operationId: "activation:12:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: true,
        javaScriptDisabled: true,
        noJsHeld: true,
        operationId: "render-mode:12:1",
        baseUrl: "https://example.com",
        lastSnapshotPageUrl: "https://example.com/page",
        followUpCompleted: true,
        lastError: "",
      },
      sessionPhase: null,
      sessionDictation: null,
      spinnerQueue: [{
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
      activeSpinnerLease: {
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
        spinnerQueue: [{
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
        activeSpinnerLease: null,
      },
      activation: {
        contentReady: false,
        bootstrapStatus: "idle",
        restorePending: false,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "before",
          busy: true,
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/page",
        },
        lastContentPageUrl: "https://example.com/page",
      },
      renderMode: {
        inspecting: false,
        javaScriptDisabled: false,
        noJsHeld: false,
        operationId: "",
        baseUrl: "",
        lastSnapshotPageUrl: "",
        followUpCompleted: false,
        lastError: "",
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
    state.activation.lastLifecycle = {
      kind: "activation",
      phase: "finished",
      message: "after",
      busy: false,
      reason: "activation-finished",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/page",
    };
    state.popupView.spinnerQueue[0].blockSurfaces = {
      popup: false,
    };

    expect(projected.traceEvents[0].payload).toEqual({ message: "before" });
    expect(projected.lifecycle).toEqual({ message: "before" });
    expect(projected.activation).toEqual({
      contentReady: false,
      bootstrapStatus: "idle",
      restorePending: false,
      lastError: "",
      lastLifecycle: {
        kind: "activation",
        phase: "started",
        message: "before",
        busy: true,
        reason: "activation-started",
        source: "background",
        contentMode: "marking",
        markingEnabled: true,
        pageUrl: "https://example.com/page",
      },
      lastContentPageUrl: "https://example.com/page",
    });
    expect(projected.spinnerQueue[0].blockSurfaces).toEqual({ popup: true });
    expect(projected.renderMode).toEqual({
      inspecting: false,
      javaScriptDisabled: false,
      noJsHeld: false,
      operationId: "",
      baseUrl: "",
      lastSnapshotPageUrl: "",
      followUpCompleted: false,
      lastError: "",
    });
  });

  it("projects activation lifecycle into the popup lifecycle view for activation-owned states", () => {
    const state: TabLayerState = {
      tabId: 91,
      version: 7,
      popupView: {
        traceEnabled: false,
        traceEvents: [],
        lifecycle: null,
        spinnerQueue: [],
        activeSpinnerLease: null,
      },
      activation: {
        contentReady: false,
        bootstrapStatus: "bootstrapping",
        restorePending: true,
        lastError: "",
        lastLifecycle: {
          kind: "activation",
          phase: "started",
          message: "Preparing page content for marking...",
          busy: true,
          operationId: "activation:91:1",
          reason: "activation-started",
          source: "background",
          contentMode: "marking",
          markingEnabled: true,
          pageUrl: "https://example.com/property",
        },
        lastContentPageUrl: "https://example.com/property",
      },
      renderMode: {
        inspecting: false,
        javaScriptDisabled: false,
        noJsHeld: false,
        operationId: "",
        baseUrl: "",
        lastSnapshotPageUrl: "",
        followUpCompleted: false,
        lastError: "",
      },
      spinners: {
        popup: null,
        pageCurtain: null,
        banner: null,
      },
    };

    expect(projectViews(state).popupView.lifecycle).toEqual({
      operationId: "activation:91:1",
      kind: "activation",
      phase: "started",
      message: "Preparing page content for marking...",
      reason: "activation-started",
      source: "background",
      busy: true,
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/property",
    });
  });
});
