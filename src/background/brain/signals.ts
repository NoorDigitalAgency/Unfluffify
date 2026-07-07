import { BrainSignalSchema, type BrainSignal, type BrainSignalName } from "../../domain/schema/signals";

export type SignalLogOptions = Readonly<{
  tabId: number;
  startSeq?: number;
  now?: () => number;
  maxEntries?: number;
}>;

export type EmitSignalInput = Readonly<{
  name: BrainSignalName;
  cause: string;
  payload?: Readonly<Record<string, string | number | boolean>>;
  source?: "brain" | "content" | "popup";
}>;

export function createSignalLog(options: SignalLogOptions) {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 128;
  const entries: BrainSignal[] = [];
  const consumedByOrgan = new Map<string, number>();
  let seq = options.startSeq ?? 0;

  const append = (input: EmitSignalInput): BrainSignal => {
    seq += 1;
    const signal = BrainSignalSchema.parse({
      kind: "uf-signal/1",
      tabId: options.tabId,
      seq,
      name: input.name,
      source: input.source ?? "brain",
      cause: input.cause,
      at: now(),
      payload: input.payload ?? {},
    });
    entries.push(signal);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    return signal;
  };

  return {
    append,
    head(): number {
      return seq;
    },
    pull(afterSeq: number): readonly BrainSignal[] {
      return entries.filter((signal) => signal.seq > afterSeq);
    },
    pullUnconsumed(organId: string): readonly BrainSignal[] {
      return entries.filter((signal) => signal.seq > (consumedByOrgan.get(organId) ?? 0));
    },
    pullForOrgan(organId: string, afterSeq = 0): readonly BrainSignal[] {
      const cursor = Math.max(afterSeq, consumedByOrgan.get(organId) ?? 0);
      return entries.filter((signal) => signal.seq > cursor);
    },
    markConsumed(organId: string, consumedSeq: number): void {
      consumedByOrgan.set(organId, Math.max(consumedByOrgan.get(organId) ?? 0, consumedSeq));
    },
    snapshot(): readonly BrainSignal[] {
      return [...entries];
    },
  };
}
