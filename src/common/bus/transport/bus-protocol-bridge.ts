import { BUS_PROTOCOL } from "../envelope.js";

export function createBusProtocolBridge() {
  return {
    isBusMessage(message: unknown): boolean {
      return Boolean(message) && typeof message === "object" && (message as { p?: unknown }).p === BUS_PROTOCOL;
    },
  };
}
