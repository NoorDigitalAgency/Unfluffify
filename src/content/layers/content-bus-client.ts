import { createBus, type Bus } from "../../common/bus/bus";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index";
import type {
  RenderModeContentBeginReply,
  RenderModeContentCaptureHtmlReply,
  RenderModeContentEndReply,
  RenderModeContentHideConsentReply,
} from "../../common/bus/contracts/render-mode";
import { isBusEnvelope, type BusEnvelope } from "../../common/bus/envelope";
import { REALMS } from "../../common/bus/realms";
import { createContentTransport } from "../../common/bus/transport/content-transport";
import type { Browser } from "../../common/browser";
import { startContentLayerHost } from "./layer-host";
import { registerRenderModeInspectionExecutor } from "./modes/render-mode-inspection-executor";

let contentBus: Bus | null = null;
let contentTransport: ReturnType<typeof createContentTransport> | null = null;
let contentLayerHostStop: (() => void) | null = null;

export type ContentBusClientOptions = {
  renderModeHandlers?: {
    beginInspection: (payload?: Record<string, unknown>) => RenderModeContentBeginReply;
    hideConsent: () => RenderModeContentHideConsentReply;
    captureHtml: (payload?: Record<string, unknown>) => Promise<RenderModeContentCaptureHtmlReply>;
    endInspection: (payload?: Record<string, unknown>) => RenderModeContentEndReply;
  };
};

export function startContentBusClient(options: ContentBusClientOptions = {}): Bus {
  if (contentBus && contentTransport) {
    return contentBus;
  }

  contentTransport = createContentTransport();
  contentTransport.start();
  contentBus = createBus({
    realm: REALMS.CONTENT,
    transport: contentTransport,
    logger: console,
  });
  contentBus.registerHandler(DIAGNOSTIC_REQUEST_TYPES.PING, (payload: { nonce: string }) => ({
    nonce: payload.nonce,
    realm: REALMS.CONTENT,
  }));
  if (options.renderModeHandlers) {
    registerRenderModeInspectionExecutor(contentBus, {
      handlers: options.renderModeHandlers,
    });
  }
  contentLayerHostStop = startContentLayerHost(contentBus);
  return contentBus;
}

export async function handleContentBusMessage(
  message: unknown,
  sender?: Browser.runtime.MessageSender,
): Promise<BusEnvelope | void> {
  if (!contentTransport || !isBusEnvelope(message)) {
    return;
  }
  return await contentTransport.inbound(message, sender);
}

export function stopContentBusClient(): void {
  contentLayerHostStop?.();
  contentLayerHostStop = null;
  contentTransport?.stop();
  contentTransport = null;
  contentBus = null;
}
