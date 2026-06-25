import type { Bus } from "../../../common/bus/bus.js";
import {
  RENDER_MODE_REQUEST_TYPES,
  type RenderModeContentBeginPayload,
  type RenderModeContentBeginReply,
  type RenderModeContentCaptureHtmlPayload,
  type RenderModeContentCaptureHtmlReply,
  type RenderModeContentEndPayload,
  type RenderModeContentEndReply,
  type RenderModeContentHideConsentReply,
} from "../../../common/bus/contracts/render-mode.js";

type RenderModeInspectionExecutorHandlers = {
  beginInspection: (payload?: Record<string, unknown>) => RenderModeContentBeginReply;
  hideConsent: () => RenderModeContentHideConsentReply;
  captureHtml: (payload?: Record<string, unknown>) => Promise<RenderModeContentCaptureHtmlReply>;
  endInspection: (payload?: Record<string, unknown>) => RenderModeContentEndReply;
};

function normalizePayload<TPayload>(payload: TPayload): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

export function createRenderModeInspectionExecutor(options: {
  handlers: RenderModeInspectionExecutorHandlers;
}) {
  const { handlers } = options;

  return {
    handleBegin(payload: RenderModeContentBeginPayload) {
      return handlers.beginInspection(normalizePayload(payload));
    },
    handleHideConsent() {
      return handlers.hideConsent();
    },
    handleCaptureHtml(payload: RenderModeContentCaptureHtmlPayload) {
      return handlers.captureHtml(normalizePayload(payload));
    },
    handleEnd(payload: RenderModeContentEndPayload) {
      return handlers.endInspection(normalizePayload(payload));
    },
  };
}

export function registerRenderModeInspectionExecutor(
  bus: Bus,
  options: { handlers: RenderModeInspectionExecutorHandlers },
): void {
  const executor = createRenderModeInspectionExecutor(options);
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_BEGIN, (payload) => executor.handleBegin(payload as RenderModeContentBeginPayload));
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_HIDE_CONSENT, () => executor.handleHideConsent());
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_CAPTURE_HTML, (payload) => executor.handleCaptureHtml(payload as RenderModeContentCaptureHtmlPayload));
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_END, (payload) => executor.handleEnd(payload as RenderModeContentEndPayload));
}
