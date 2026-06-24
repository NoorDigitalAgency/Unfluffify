import { createBus, type Bus } from "../../common/bus/bus.js";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index.js";
import { isBusEnvelope, type BusEnvelope } from "../../common/bus/envelope.js";
import { REALMS } from "../../common/bus/realms.js";
import { createContentTransport } from "../../common/bus/transport/content-transport.js";
import { startContentLayerHost } from "./layer-host.js";

let contentBus: Bus | null = null;
let contentTransport: ReturnType<typeof createContentTransport> | null = null;
let contentLayerHostStop: (() => void) | null = null;

export function startContentBusClient(): Bus {
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
  contentLayerHostStop = startContentLayerHost(contentBus);
  return contentBus;
}

export async function handleContentBusMessage(
  message: unknown,
  sender?: chrome.runtime.MessageSender,
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
