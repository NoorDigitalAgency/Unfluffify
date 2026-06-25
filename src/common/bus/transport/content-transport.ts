import { BUS_ERROR_CODES, BusError } from "../bus-errors.js";
import { type BusEnvelope } from "../envelope.js";
import { REALMS } from "../realms.js";
import { type Browser } from "../../browser.js";
import { sendBusEnvelope } from "../../extension-messaging.js";
import { createPageRelayTransport } from "./page-relay-transport.js";
import type { InboundTransportHandler, Transport } from "./transport-types.js";

export type ContentTransport = Transport & {
  inbound(env: BusEnvelope, sender?: Browser.runtime.MessageSender): Promise<BusEnvelope | void>;
};

export function createContentTransport(): ContentTransport {
  let inboundHandler: InboundTransportHandler | null = null;
  const pageRelayTransport = createPageRelayTransport();

  async function sendToRuntime(env: BusEnvelope): Promise<BusEnvelope | void> {
    try {
      return await sendBusEnvelope(env);
    } catch (error) {
      throw new BusError(
        BUS_ERROR_CODES.TRANSPORT_FAILED,
        error instanceof Error && error.message ? error.message : `Content transport failed for ${env.t}`,
        { type: env.t, dst: env.dst },
      );
    }
  }

  return {
    async send(env: BusEnvelope): Promise<BusEnvelope | void> {
      if (env.dst === REALMS.PAGE) {
        return await pageRelayTransport.send(env);
      }
      return await sendToRuntime(env);
    },
    onInbound(handler: InboundTransportHandler): void {
      inboundHandler = handler;
    },
    start(): void {
      pageRelayTransport.start();
    },
    stop(): void {
      pageRelayTransport.stop();
    },
    async inbound(env: BusEnvelope): Promise<BusEnvelope | void> {
      if (env.dst === REALMS.CONTENT || env.dst === "broadcast") {
        if (!inboundHandler) {
          throw new BusError(BUS_ERROR_CODES.NO_HANDLER, `Content inbound handler is not installed for ${env.t}`);
        }
        return await inboundHandler(env);
      }
      if (env.dst === REALMS.PAGE) {
        return await pageRelayTransport.send(env);
      }
      return await sendToRuntime(env);
    },
  };
}
