import { BUS_ERROR_CODES, BusError } from "../bus-errors.js";
import { BUS_KINDS, isBusEnvelope, makeReplyEnvelope, type BusEnvelope, type BusRequestEnvelope } from "../envelope.js";
import { browser, type Browser } from "../../browser.js";
import { sendBusEnvelope } from "../../extension-messaging.js";
import { buildBusPortName, type InboundTransportHandler, type Transport } from "./transport-types.js";

function toBusError(error: unknown, fallbackCode: string, fallbackMessage: string): BusError {
  if (error instanceof BusError) {
    return error;
  }
  return new BusError(
    fallbackCode,
    error instanceof Error && error.message ? error.message : fallbackMessage,
  );
}

export function createPopupTransport(tabId: number): Transport {
  let inboundHandler: InboundTransportHandler | null = null;
  let port: Browser.runtime.Port | null = null;

  function ensurePort(): Browser.runtime.Port {
    if (port) {
      return port;
    }
    port = browser.runtime.connect({ name: buildBusPortName(tabId) });
    port.onMessage.addListener((message: unknown) => {
      if (!isBusEnvelope(message) || !inboundHandler || message.k === BUS_KINDS.REPLY) {
        return;
      }
      inboundHandler(message)
        .then((reply) => {
          if (message.k === BUS_KINDS.REQUEST && reply && port) {
            port.postMessage(reply);
          }
        })
        .catch((error: unknown) => {
          if (message.k !== BUS_KINDS.REQUEST || !port) {
            return;
          }
          const busError = toBusError(error, BUS_ERROR_CODES.HANDLER_FAILED, `Bus handler failed for ${message.t}`);
          port.postMessage(makeReplyEnvelope(message as BusRequestEnvelope, false, {
            code: BUS_ERROR_CODES.HANDLER_FAILED,
            error: busError.message,
            details: busError.details,
          }));
        });
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  return {
    async send(env: BusEnvelope): Promise<BusEnvelope | void> {
      if (env.k === BUS_KINDS.EVENT) {
        ensurePort().postMessage(env);
        return;
      }
      try {
        return await sendBusEnvelope(env);
      } catch (error) {
        throw new BusError(
          BUS_ERROR_CODES.TRANSPORT_FAILED,
          error instanceof Error && error.message ? error.message : `Popup transport failed for ${env.t}`,
          { type: env.t, tabId },
        );
      }
    },
    onInbound(handler: InboundTransportHandler): void {
      inboundHandler = handler;
    },
    start(): void {
      ensurePort();
    },
    stop(): void {
      if (!port) {
        return;
      }
      try {
        port.disconnect();
      } finally {
        port = null;
      }
    },
  };
}
