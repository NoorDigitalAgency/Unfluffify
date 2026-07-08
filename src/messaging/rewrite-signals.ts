import type { BrainSignal } from "../domain/schema/signals";
import type { createRealmBus } from "./realms";

export type RewriteSignalBus = ReturnType<typeof createRealmBus>;

export function parseSenderTabId(sourceInstance?: string): number | null {
  const match = sourceInstance?.match(/(?:^|:)tab:(\d+):/);
  if (!match) {
    return null;
  }
  const tabId = Number.parseInt(match[1], 10);
  return Number.isFinite(tabId) ? tabId : null;
}

export async function emitRewriteSignal(
  bus: RewriteSignalBus,
  tabId: number,
  signal: Omit<BrainSignal, "kind" | "tabId" | "seq" | "at">,
) {
  return await bus.request("signals.emit", { tabId, signal }, { target: "background" });
}

export async function pullRewriteSignals(
  bus: RewriteSignalBus,
  input: Readonly<{ tabId: number; afterSeq: number; organId?: string }>,
) {
  return await bus.request("signals.pull", input, { target: "background" });
}
