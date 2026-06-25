import {
  isRenderModeRunInspectionOperationReply,
  isRenderModeRunInspectionResult,
} from "../../../common/bus/contracts/render-mode.js";
import type {
  RenderModeEndInspectionPayload,
  RenderModeEndInspectionReply,
  RenderModeRunInspectionPayload,
  RenderModeRunInspectionReply,
} from "../../../common/bus/contracts/render-mode.js";
import {
  requestPopupRenderModeEnd,
  requestPopupRenderModeRun,
} from "../popup-bus-client.js";

type PopupLayerReply<TReply> =
  | { ok: true; result: TReply }
  | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

type LayerError = Error & {
  code?: unknown;
  details?: { reply?: unknown } | Record<string, unknown>;
};

type PopupRenderModeInspectionLayerDeps = {
  requestRunInspection: (tabId: number, payload: RenderModeRunInspectionPayload) => Promise<RenderModeRunInspectionReply>;
  requestEndInspection: (tabId: number, payload: RenderModeEndInspectionPayload, timeoutMs?: number) => Promise<RenderModeEndInspectionReply>;
};

function buildLayerFailure(error: unknown, fallback: string): PopupLayerReply<never> {
  const layerError = error as LayerError | null | undefined;
  const reply = layerError && layerError.details && typeof layerError.details === "object" && "reply" in layerError.details
    ? layerError.details.reply
    : null;
  return {
    ok: false,
    code: typeof layerError?.code === "string"
      ? layerError.code
      : (reply && typeof reply === "object" && typeof (reply as { code?: unknown }).code === "string"
        ? (reply as { code: string }).code
        : "handler_failed"),
    error: layerError instanceof Error && layerError.message
      ? layerError.message
      : (reply && typeof reply === "object" && typeof (reply as { error?: unknown }).error === "string"
        ? (reply as { error: string }).error
        : fallback),
    details: reply && typeof reply === "object" && typeof (reply as { details?: unknown }).details === "object"
      ? (reply as { details: Record<string, unknown> }).details
      : {},
  };
}

function getRunInspectionFailureMessage(reply: RenderModeRunInspectionReply): string {
  if (isRenderModeRunInspectionOperationReply(reply)) {
    if (typeof reply.error === "string" && reply.error) {
      return reply.error;
    }
    if (isRenderModeRunInspectionResult(reply.result)) {
      if (typeof reply.result.followUpError === "string" && reply.result.followUpError) {
        return reply.result.followUpError;
      }
      if (reply.result.reloadResult && typeof reply.result.reloadResult.error === "string" && reply.result.reloadResult.error) {
        return reply.result.reloadResult.error;
      }
    }
  }
  if (isRenderModeRunInspectionResult(reply)) {
    if (typeof reply.followUpError === "string" && reply.followUpError) {
      return reply.followUpError;
    }
    if (reply.reloadResult && typeof reply.reloadResult.error === "string" && reply.reloadResult.error) {
      return reply.reloadResult.error;
    }
  }
  return "Unable to inspect render mode";
}

function runInspectionNeedsCleanup(reply: RenderModeRunInspectionReply): boolean {
  if (isRenderModeRunInspectionOperationReply(reply)) {
    return !reply.ok;
  }
  return !reply.ok;
}

export function createPopupRenderModeInspectionLayer(
  deps: PopupRenderModeInspectionLayerDeps = {
    requestRunInspection: requestPopupRenderModeRun,
    requestEndInspection: requestPopupRenderModeEnd,
  },
) {
  return {
    async requestRunInspection(tabId: number, payload: RenderModeRunInspectionPayload): Promise<PopupLayerReply<RenderModeRunInspectionReply>> {
      if (!tabId) {
        return { ok: false, error: "Missing tab" };
      }
      try {
        const reply = await deps.requestRunInspection(tabId, payload);
        if (runInspectionNeedsCleanup(reply)) {
          if (typeof payload.operationId === "string" && payload.operationId) {
            await deps.requestEndInspection(tabId, { operationId: payload.operationId }, 5000).catch(() => null);
          }
          return {
            ok: false,
            error: getRunInspectionFailureMessage(reply),
          };
        }
        return {
          ok: true,
          result: reply,
        };
      } catch (error) {
        if (typeof payload.operationId === "string" && payload.operationId) {
          await deps.requestEndInspection(tabId, { operationId: payload.operationId }, 5000).catch(() => null);
        }
        return buildLayerFailure(error, "Unable to inspect render mode");
      }
    },

    async requestEndInspection(
      tabId: number,
      payload: RenderModeEndInspectionPayload,
    ): Promise<PopupLayerReply<RenderModeEndInspectionReply>> {
      if (!tabId) {
        return { ok: false, error: "Missing tab" };
      }
      try {
        return {
          ok: true,
          result: await deps.requestEndInspection(tabId, payload),
        };
      } catch (error) {
        return buildLayerFailure(error, "Unable to end render mode inspection");
      }
    },
  };
}

const popupRenderModeInspectionLayer = createPopupRenderModeInspectionLayer();

export function requestPopupRenderModeInspection(
  tabId: number,
  payload: RenderModeRunInspectionPayload,
) {
  return popupRenderModeInspectionLayer.requestRunInspection(tabId, payload);
}

export function requestPopupRenderModeInspectionEnd(
  tabId: number,
  payload: RenderModeEndInspectionPayload,
) {
  return popupRenderModeInspectionLayer.requestEndInspection(tabId, payload);
}
