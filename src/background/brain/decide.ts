import type { BrainSignalName } from "../../domain/schema/signals";
import type { TabFacts } from "../../domain/schema/facts";

export type SignalDecision = Readonly<{
  name: BrainSignalName;
  cause: string;
  payload: Readonly<Record<string, string | number | boolean>>;
}>;

export function decideSignals(prev: TabFacts | null, next: TabFacts): readonly SignalDecision[] {
  const decisions: SignalDecision[] = [];
  const pageUrl = next.pageUrl ?? prev?.pageUrl ?? "";
  const baseUrl = next.baseUrl ?? prev?.baseUrl ?? "";
  if (prev?.pageUrl && next.pageUrl && prev.pageUrl !== next.pageUrl) {
    decisions.push({
      name: "session.navigated",
      cause: "navigation",
      payload: { fromUrl: prev.pageUrl, toUrl: next.pageUrl, pageUrl: next.pageUrl },
    });
  }
  if (prev?.markingEnabled !== true && next.markingEnabled) {
    decisions.push({
      name: "marking.enabled",
      cause: "activate-ok",
      payload: { baseUrl: next.baseUrl ?? "", pageUrl: next.pageUrl ?? "" },
    });
  }
  if (prev?.markingEnabled === true && !next.markingEnabled) {
    decisions.push({
      name: "marking.disabled",
      cause: prev.pageUrl && next.pageUrl && prev.pageUrl !== next.pageUrl ? "navigation" : "deactivate-ok",
      payload: { baseUrl: next.baseUrl ?? "", pageUrl: next.pageUrl ?? prev.pageUrl ?? "", cause: "fold" },
    });
  }
  if ((prev?.markingChangeSeq ?? 0) < (next.markingChangeSeq ?? 0)) {
    decisions.push({
      name: "markings.changed",
      cause: "marking-change",
      payload: { pageUrl, markedCount: next.markingChangeSeq ?? 0 },
    });
  }
  if (prev?.runPhase !== "running" && next.runPhase === "running") {
    decisions.push({
      name: "run.started",
      cause: "ai-run",
      payload: { sessionId: next.runSessionId ?? "", pageUrl },
    });
  }
  if (prev?.runPhase === "running" && next.runPhase === "completed") {
    decisions.push({
      name: "run.completed",
      cause: "ai-run",
      payload: { sessionId: next.runSessionId ?? "", pageUrl },
    });
  }
  if (prev?.runPhase === "running" && next.runPhase === "failed") {
    decisions.push({
      name: "run.failed",
      cause: "ai-run",
      payload: { sessionId: next.runSessionId ?? "", pageUrl },
    });
  }
  if (prev?.previewActive !== true && next.previewActive === true) {
    decisions.push({
      name: "preview.opened",
      cause: "preview",
      payload: { pageUrl, origin: "marking" },
    });
  }
  if (prev?.previewExitRequested !== true && next.previewExitRequested === true) {
    decisions.push({
      name: "preview.exit.requested",
      cause: "preview",
      payload: { pageUrl, restore: true },
    });
  }
  if (prev?.previewActive === true && next.previewActive !== true) {
    decisions.push({
      name: "preview.exited",
      cause: "preview",
      payload: { pageUrl },
    });
  }
  if ((prev?.savedSeq ?? 0) < (next.savedSeq ?? 0)) {
    decisions.push({
      name: "session.saved",
      cause: "save",
      payload: { pageUrl, baseUrl },
    });
  }
  if ((prev?.discardedSeq ?? 0) < (next.discardedSeq ?? 0)) {
    decisions.push({
      name: "session.discarded",
      cause: "discard",
      payload: { pageUrl, baseUrl },
    });
  }
  if (prev?.inspectionPending !== true && next.inspectionPending === true) {
    decisions.push({
      name: "inspection.started",
      cause: "inspection",
      payload: { pageUrl },
    });
  }
  if (prev?.inspectionPending === true && next.inspectionPending !== true) {
    decisions.push({
      name: "inspection.ended",
      cause: "inspection",
      payload: { pageUrl },
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
