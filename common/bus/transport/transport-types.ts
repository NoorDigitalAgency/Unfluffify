import type { BusEnvelope } from "../envelope.js";

export type InboundTransportHandler = (env: BusEnvelope) => Promise<BusEnvelope | void>;

export interface Transport {
  send(env: BusEnvelope): Promise<BusEnvelope | void>;
  onInbound(handler: InboundTransportHandler): void;
  start(): void;
  stop(): void;
}
