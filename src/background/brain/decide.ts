import type { BrainSignalName } from "../../domain/schema/signals";
import type { TabFacts } from "../../domain/schema/facts";

export type SignalDecision = Readonly<{
  name: BrainSignalName;
  cause: string;
  payload: Readonly<Record<string, string | number | boolean>>;
}>;

export function decideSignals(prev: TabFacts | null, next: TabFacts): readonly SignalDecision[] {
  const decisions: SignalDecision[] = [];
  if (prev?.pageUrl && next.pageUrl && prev.pageUrl !== next.pageUrl) {
    decisions.push({
      name: "session.navigated",
      cause: "navigation",
      payload: { fromUrl: prev.pageUrl, toUrl: next.pageUrl },
    });
  }
  if (prev?.markingEnabled !== true && next.markingEnabled) {
    decisions.push({
      name: "marking.enabled",
      cause: "activate-ok",
      payload: { baseUrl: next.baseUrl ?? "" },
    });
  }
  if (prev?.markingEnabled === true && !next.markingEnabled) {
    decisions.push({
      name: "marking.disabled",
      cause: prev.pageUrl && next.pageUrl && prev.pageUrl !== next.pageUrl ? "navigation" : "deactivate-ok",
      payload: { baseUrl: next.baseUrl ?? "", cause: "fold" },
    });
  }
  if (prev?.reconciliationPending !== true && next.reconciliationPending) {
    decisions.push({
      name: "reconciliation.started",
      cause: "save-lifecycle",
      payload: { reason: "pending" },
    });
  }
  if (prev?.reconciliationPending === true && !next.reconciliationPending) {
    decisions.push({
      name: "reconciliation.ended",
      cause: "save-lifecycle",
      payload: { reason: "settled" },
    });
  }
  return decisions;
}
