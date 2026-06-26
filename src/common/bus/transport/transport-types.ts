import type { BusEnvelope } from "../envelope";

export const BUS_PORT_PREFIX = "ufBus:";

export function buildBusPortName(tabId: number | string): string {
  return `${BUS_PORT_PREFIX}${tabId}`;
}

export type InboundTransportHandler = (env: BusEnvelope) => Promise<BusEnvelope | void>;

export interface Transport {
  send(env: BusEnvelope): Promise<BusEnvelope | void>;
  onInbound(handler: InboundTransportHandler): void;
  start(): void;
  stop(): void;
}
