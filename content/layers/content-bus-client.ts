import { createBus, type Bus } from "../../common/bus/bus.js";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index.js";
import { isBusEnvelope, type BusEnvelope } from "../../common/bus/envelope.js";
import { REALMS } from "../../common/bus/realms.js";
import { createContentTransport } from "../../common/bus/transport/content-transport.js";
import type { Browser } from "../../common/browser.js";
import type { RequestEnvelope } from "../../common/message-protocol.js";
import { startContentLayerHost } from "./layer-host.js";
import { registerRenderModeInspectionExecutor } from "./modes/render-mode-inspection-executor.js";

let contentBus: Bus | null = null;
let contentTransport: ReturnType<typeof createContentTransport> | null = null;
let contentLayerHostStop: (() => void) | null = null;

export type ContentBusClientOptions = {
  dispatchContentCommandMessage?: (
    message: RequestEnvelope,
    sender: Browser.runtime.MessageSender | undefined,
  ) => Promise<unknown>;
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
  if (typeof options.dispatchContentCommandMessage === "function") {
    registerRenderModeInspectionExecutor(contentBus, {
      dispatchContentCommandMessage: options.dispatchContentCommandMessage,
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
