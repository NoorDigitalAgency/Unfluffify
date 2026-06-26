import { describe, expect, it } from "vitest";

import {
  getActivationSnapshot,
  mirrorActivationLifecycle,
  updateActivationBootstrapState,
} from "../src/background/brain/deciders/activation-decider.js";
import { projectViews } from "../src/background/brain/view-projector.js";
import { createStateStore } from "../src/background/brain/state-store.js";
import {
  ACTIVATION_EVENT_TYPES,
  ACTIVATION_REQUEST_TYPES,
} from "../src/common/bus/contracts/activation.js";
import { LIFECYCLE_KINDS, LIFECYCLE_PHASES } from "../src/common/world-messaging-contract.js";

describe("activation contracts and projection scaffolding", () => {
  it("exposes the typed track-3 activation request and event names", () => {
    expect(ACTIVATION_REQUEST_TYPES).toEqual({
      ENSURE_CONTENT_READY: "activation.ensureContentReady",
    });
    expect(ACTIVATION_EVENT_TYPES).toEqual({
      LIFECYCLE_REPORTED: "activation.lifecycleReported",
      CONTENT_READY: "activation.contentReady",
      RESTORE_REQUESTED: "activation.restoreRequested",
    });
  });

  it("starts each tab with an idle activation snapshot", () => {
    const state = createStateStore().getOrInit(41);

    expect(state.activation).toEqual({
      contentReady: false,
      bootstrapStatus: "idle",
      restorePending: false,
      lastError: "",
      lastLifecycle: null,
      lastContentPageUrl: "",
    });
  });

  it("projects cloned activation state into popup and content views", () => {
    const store = createStateStore();
    const state = store.mutate(88, "activation:test", (draft) => {
      draft.activation.contentReady = true;
      draft.activation.bootstrapStatus = "ready";
      draft.activation.restorePending = true;
      draft.activation.lastError = "";
      draft.activation.lastContentPageUrl = "https://example.com/page";
      draft.activation.lastLifecycle = {
        kind: "activation",
        phase: "started",
        message: "Preparing page content for marking...",
        busy: true,
        operationId: "activation:88:1",
        reason: "activation-started",
        source: "background",
        contentMode: "marking",
        markingEnabled: true,
        pageUrl: "https://example.com/page",
      };
    });

    const { popupView, contentDirective } = projectViews(state);

    expect(popupView.activation).toEqual({
      contentReady: true,
      bootstrapStatus: "ready",
      restorePending: true,
      lastError: "",
      lastLifecycle: {
        kind: "activation",
        phase: "started",
        message: "Preparing page content for marking...",
        busy: true,
        operationId: "activation:88:1",
        reason: "activation-started",
        source: "background",
        contentMode: "marking",
        markingEnabled: true,
        pageUrl: "https://example.com/page",
      },
      lastContentPageUrl: "https://example.com/page",
    });
    expect(contentDirective.activation).toEqual(popupView.activation);

    const popupLifecycle = popupView.activation?.lastLifecycle;
    const directiveLifecycle = contentDirective.activation.lastLifecycle;
    expect(popupLifecycle).not.toBe(state.activation.lastLifecycle);
    expect(directiveLifecycle).not.toBe(state.activation.lastLifecycle);

    if (popupLifecycle) {
      popupLifecycle.message = "changed in popup view";
    }
    if (directiveLifecycle) {
      directiveLifecycle.message = "changed in content directive";
    }

    expect(state.activation.lastLifecycle?.message).toBe(
      "Preparing page content for marking...",
    );
  });

  it("mirrors bootstrap patches without clearing the last lifecycle snapshot", () => {
    const store = createStateStore();

    mirrorActivationLifecycle(store, 8, {
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      message: "Preparing page content for marking...",
      busy: true,
      operationId: "activation:8:1",
      reason: "activation-started",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/page",
    }, "activation:lifecycle");

    const activation = updateActivationBootstrapState(store, 8, {
      contentReady: true,
      bootstrapStatus: "ready",
      lastError: "",
    }, "activation:bootstrap");

    expect(activation).toMatchObject({
      contentReady: true,
      bootstrapStatus: "ready",
      restorePending: true,
      lastError: "",
    });
    expect(activation.lastLifecycle).toMatchObject({
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
    });
  });

  it("promotes content-ready lifecycle events into the activation snapshot", () => {
    const store = createStateStore();

    mirrorActivationLifecycle(store, 9, {
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      message: "Preparing page content for marking...",
      busy: true,
      operationId: "activation:9:1",
      reason: "activation-started",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/ready",
    }, "activation:started");

    const activation = mirrorActivationLifecycle(store, 9, {
      kind: LIFECYCLE_KINDS.CONTENT_READY,
      phase: LIFECYCLE_PHASES.FINISHED,
      message: "",
      busy: false,
      reason: "content-ready",
      source: "content-lifecycle",
      contentMode: "silent",
      markingEnabled: false,
      pageUrl: "https://example.com/ready",
    }, "activation:content-ready");

    expect(activation).toMatchObject({
      contentReady: true,
      bootstrapStatus: "ready",
      restorePending: false,
      lastError: "",
      lastContentPageUrl: "https://example.com/ready",
    });
    expect(getActivationSnapshot(store, 9).lastLifecycle).toMatchObject({
      kind: LIFECYCLE_KINDS.CONTENT_READY,
      phase: LIFECYCLE_PHASES.FINISHED,
      operationId: "activation:9:1",
      pageUrl: "https://example.com/ready",
    });
  });

  it("ignores non-activation lifecycle kinds so activation state stays scoped", () => {
    const store = createStateStore();

    mirrorActivationLifecycle(store, 12, {
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      message: "Preparing page content for marking...",
      busy: true,
      operationId: "activation:12:1",
      reason: "activation-started",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/page",
    }, "activation:started");

    const activation = mirrorActivationLifecycle(store, 12, {
      kind: LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
      phase: LIFECYCLE_PHASES.STARTED,
      message: "Inspecting render mode...",
      busy: true,
      operationId: "render-mode:12:1",
      reason: "render-mode-inspection",
      source: "background",
      contentMode: "marking",
      markingEnabled: true,
      pageUrl: "https://example.com/page",
    }, "activation:ignored-non-activation");

    expect(activation.lastLifecycle).toMatchObject({
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      operationId: "activation:12:1",
    });
  });
});
