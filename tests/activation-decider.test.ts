import { describe, expect, it } from "vitest";

import { projectViews } from "../background/brain/view-projector.js";
import { createStateStore } from "../background/brain/state-store.js";
import {
  ACTIVATION_EVENT_TYPES,
  ACTIVATION_REQUEST_TYPES,
} from "../common/bus/contracts/activation.js";

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
});
