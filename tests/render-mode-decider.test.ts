import { describe, expect, it } from "vitest";

import { createStateStore } from "../background/brain/state-store.js";
import { projectViews } from "../background/brain/view-projector.js";
import {
  RENDER_MODE_EVENT_TYPES,
  RENDER_MODE_REQUEST_TYPES,
} from "../common/bus/contracts/render-mode.js";

describe("render-mode contracts and projection scaffolding", () => {
  it("exposes the typed track-4 render-mode request and event names", () => {
    expect(RENDER_MODE_REQUEST_TYPES).toEqual({
      RUN_INSPECTION: "renderMode.runInspection",
      END_INSPECTION: "renderMode.endInspection",
      CONTENT_BEGIN: "renderMode.contentBegin",
      CONTENT_HIDE_CONSENT: "renderMode.contentHideConsent",
      CONTENT_CAPTURE_HTML: "renderMode.contentCaptureHtml",
      CONTENT_END: "renderMode.contentEnd",
    });
    expect(RENDER_MODE_EVENT_TYPES).toEqual({
      INSPECTION_RECORDED: "renderMode.inspectionRecorded",
      NO_JS_HOLD_CHANGED: "renderMode.noJsHoldChanged",
    });
  });

  it("starts each tab with an idle render-mode snapshot", () => {
    const state = createStateStore().getOrInit(41);

    expect(state.renderMode).toEqual({
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

  it("projects cloned render-mode state into popup and content views", () => {
    const store = createStateStore();
    const state = store.mutate(88, "render-mode:test", (draft) => {
      draft.renderMode.inspecting = true;
      draft.renderMode.javaScriptDisabled = true;
      draft.renderMode.noJsHeld = true;
      draft.renderMode.operationId = "render-mode:88:1";
      draft.renderMode.baseUrl = "https://example.com";
      draft.renderMode.lastSnapshotPageUrl = "https://example.com/page";
      draft.renderMode.followUpCompleted = true;
      draft.renderMode.lastError = "";
    });

    const { popupView, contentDirective } = projectViews(state);

    expect(popupView.renderMode).toEqual({
      inspecting: true,
      javaScriptDisabled: true,
      noJsHeld: true,
      operationId: "render-mode:88:1",
      baseUrl: "https://example.com",
      lastSnapshotPageUrl: "https://example.com/page",
      followUpCompleted: true,
      lastError: "",
    });
    expect(contentDirective.renderMode).toEqual({
      inspecting: true,
      operationId: "render-mode:88:1",
      noJsHeld: true,
      javaScriptDisabled: true,
    });
    expect(popupView.renderMode).not.toBe(state.renderMode);
    expect(contentDirective.renderMode).not.toBe(state.renderMode);
  });
});
