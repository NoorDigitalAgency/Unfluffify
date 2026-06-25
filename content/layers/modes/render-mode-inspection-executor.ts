import type { Bus } from "../../../common/bus/bus.js";
import type { Browser } from "../../../common/browser.js";
import {
  createRequestEnvelope,
  isReplyEnvelope,
  MESSAGE_SOURCES,
  MESSAGE_TARGETS,
  type RequestEnvelope,
} from "../../../common/message-protocol.js";
import {
  RENDER_MODE_REQUEST_TYPES,
  type RenderModeContentBeginPayload,
  type RenderModeContentBeginReply,
  type RenderModeContentCaptureHtmlPayload,
  type RenderModeContentCaptureHtmlReply,
  type RenderModeContentEndPayload,
  type RenderModeContentEndReply,
  type RenderModeContentHideConsentPayload,
  type RenderModeContentHideConsentReply,
} from "../../../common/bus/contracts/render-mode.js";

type DispatchContentCommandMessage = (
  message: RequestEnvelope,
  sender: Browser.runtime.MessageSender | undefined,
) => Promise<unknown>;

type ExecutorError = Error & {
  code?: string;
  details?: { reply?: unknown };
};

function normalizePayload<TPayload>(payload: TPayload): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

function normalizeTabId(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function unwrapReply<TReply>(reply: unknown, fallback: string): TReply {
  if (!isReplyEnvelope(reply)) {
    throw new Error(fallback);
  }
  if (!reply.ok) {
    const error = new Error(reply.error || fallback) as ExecutorError;
    error.code = reply.code;
    error.details = { reply };
    throw error;
  }
  return (reply.result && typeof reply.result === "object" ? reply.result : {}) as TReply;
}

export function createRenderModeInspectionExecutor(options: {
  dispatchContentCommandMessage: DispatchContentCommandMessage;
}) {
  const { dispatchContentCommandMessage } = options;

  async function dispatchLegacyContentCommand<TReply>(
    commandType: string,
    payload: Record<string, unknown>,
    meta: { tab?: unknown },
    fallback: string,
  ): Promise<TReply> {
    const request = createRequestEnvelope(commandType, payload, {
      source: MESSAGE_SOURCES.BACKGROUND,
      target: MESSAGE_TARGETS.CONTENT,
      tabId: normalizeTabId(meta.tab),
    });
    const reply = await dispatchContentCommandMessage(request, undefined);
    return unwrapReply<TReply>(reply, fallback);
  }

  return {
    handleBegin(payload: RenderModeContentBeginPayload, meta: { tab?: unknown }) {
      return dispatchLegacyContentCommand<RenderModeContentBeginReply>(
        "renderModeInspectionBegin",
        normalizePayload(payload),
        meta,
        "Unable to begin render mode inspection",
      );
    },
    handleHideConsent(payload: RenderModeContentHideConsentPayload, meta: { tab?: unknown }) {
      return dispatchLegacyContentCommand<RenderModeContentHideConsentReply>(
        "hideConsentForInspection",
        normalizePayload(payload),
        meta,
        "Unable to hide consent form",
      );
    },
    handleCaptureHtml(payload: RenderModeContentCaptureHtmlPayload, meta: { tab?: unknown }) {
      return dispatchLegacyContentCommand<RenderModeContentCaptureHtmlReply>(
        "captureRenderModeInspectionHtml",
        normalizePayload(payload),
        meta,
        "Unable to capture render mode HTML",
      );
    },
    handleEnd(payload: RenderModeContentEndPayload, meta: { tab?: unknown }) {
      return dispatchLegacyContentCommand<RenderModeContentEndReply>(
        "renderModeInspectionEnd",
        normalizePayload(payload),
        meta,
        "Unable to end render mode inspection",
      );
    },
  };
}

export function registerRenderModeInspectionExecutor(
  bus: Bus,
  options: { dispatchContentCommandMessage: DispatchContentCommandMessage },
): void {
  const executor = createRenderModeInspectionExecutor(options);
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_BEGIN, (payload, meta) => executor.handleBegin(payload as RenderModeContentBeginPayload, meta));
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_HIDE_CONSENT, (payload, meta) => executor.handleHideConsent(payload as RenderModeContentHideConsentPayload, meta));
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_CAPTURE_HTML, (payload, meta) => executor.handleCaptureHtml(payload as RenderModeContentCaptureHtmlPayload, meta));
  bus.registerHandler(RENDER_MODE_REQUEST_TYPES.CONTENT_END, (payload, meta) => executor.handleEnd(payload as RenderModeContentEndPayload, meta));
}
