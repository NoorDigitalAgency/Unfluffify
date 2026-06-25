import { BusError, BUS_ERROR_CODES } from "../bus-errors.js";
import { BUS_KINDS, makeReplyEnvelope } from "../envelope.js";
import type { BusEnvelope } from "../envelope.js";
import type { Transport, InboundTransportHandler } from "./transport-types.js";
import { isPageWorldRelayReady, requestPageWorldCommand } from "../../../content/page-world-relay.js";
import { isPageWorldRelayCommand } from "../../page-world-protocol.js";

function normalizePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function createPageRelayTransport(): Transport {
  let inboundHandler: InboundTransportHandler | null = null;

  return {
    async send(env: BusEnvelope): Promise<BusEnvelope | void> {
      if (env.dst !== "page") {
        throw new BusError(
          BUS_ERROR_CODES.UNREACHABLE_REALM,
          `Page relay transport cannot reach ${env.dst}`,
          { dst: env.dst, type: env.t },
        );
      }
      if (!isPageWorldRelayReady()) {
        throw new BusError(
          BUS_ERROR_CODES.UNREACHABLE_REALM,
          "Page-world relay is not ready",
          { type: env.t },
        );
      }
      if (!isPageWorldRelayCommand(env.t)) {
        throw new BusError(
          BUS_ERROR_CODES.UNREACHABLE_REALM,
          `Unsupported page-world bus type ${env.t}`,
          { type: env.t },
        );
      }

      const result = await requestPageWorldCommand(env.t, normalizePayload(env.payload));
      if (env.k === BUS_KINDS.REQUEST) {
        return makeReplyEnvelope(env, true, result);
      }
      return;
    },
    onInbound(handler: InboundTransportHandler): void {
      inboundHandler = handler;
    },
    start(): void {
      void inboundHandler;
    },
    stop(): void {
      inboundHandler = null;
    },
  };
}
