import type { BrainSignal, BrainSignalName } from "../../domain/schema/signals";
import type { LockBannerVocabulary, TabFacts } from "../../domain/schema/facts";

export type SignalDecision = Readonly<{
  name: BrainSignalName;
  cause: string;
  payload: BrainSignal["payload"];
}>;

/** The countdown is a continuously changing presentation value, not a new lock
 * decision. Every other banner field can change what the operator sees or can
 * do, so it remains part of the signal edge identity. */
function semanticLockBanner(
  banner: LockBannerVocabulary | undefined,
): Omit<LockBannerVocabulary, "countdownSeconds"> | null {
  if (!banner) {
    return null;
  }
  const { countdownSeconds: _countdownSeconds, ...semantic } = banner;
  return semantic;
}

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
  /* Driven by a count of the operator's toggles, never by how many rows the page
     currently has. A dynamic page moves its own row count, which would be wrong
     in both directions: rows the page grows would read as an edit, and a toggle
     that removes rows would not read as one at all. A toggle count only ever goes
     up, and only when the operator marks something. */
  if ((prev?.markingToggleSeq ?? 0) < (next.markingToggleSeq ?? 0)) {
    decisions.push({
      name: "markings.changed",
      cause: "marking-toggle",
      payload: {
        pageUrl,
        markedCount: next.markingToggleSeq ?? 0,
        dirty: next.markingDirty !== false,
        ...(next.markingFingerprint === undefined
          ? {}
          : { fingerprint: next.markingFingerprint }),
      },
    });
  }
  if (prev?.runPhase !== "running" && next.runPhase === "running") {
    decisions.push({
      name: "run.started",
      cause: "ai-run",
      payload: {
        sessionId: next.runSessionId ?? "",
        pageUrl,
        ...(next.runDeadlineAt === undefined ? {} : { deadlineAt: next.runDeadlineAt }),
      },
    });
  }
  if (prev?.runPhase === "running" && next.runPhase === "completed") {
    decisions.push({
      name: "run.completed",
      cause: "ai-run",
      payload: {
        sessionId: next.runSessionId ?? "",
        pageUrl,
        ...(next.runAiSessionId === undefined ? {} : { aiSessionId: next.runAiSessionId }),
        ...(next.runSelectors === undefined ? {} : { selectors: next.runSelectors }),
      },
    });
  }
  if (prev?.runPhase === "running" && next.runPhase === "failed") {
    decisions.push({
      name: "run.failed",
      cause: "ai-run",
      payload: {
        sessionId: next.runSessionId ?? "",
        pageUrl,
        ...(next.runFailureReason === undefined ? {} : { reason: next.runFailureReason }),
      },
    });
  }
  if (prev?.previewActive !== true && next.previewActive === true) {
    decisions.push({
      name: "preview.opened",
      cause: "preview",
      payload: { pageUrl, origin: next.previewOrigin ?? "marking" },
    });
  }
  const previewExitSequenceAdvanced =
    (prev?.previewExitRequestSeq ?? 0) < (next.previewExitRequestSeq ?? 0);
  if (
    previewExitSequenceAdvanced ||
    (prev?.previewExitRequested !== true && next.previewExitRequested === true)
  ) {
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
      payload: { pageUrl, restored: true },
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
  const lockPresentationChanged =
    prev?.lockBlockedReason !== next.lockBlockedReason ||
    JSON.stringify(semanticLockBanner(prev?.lockBanner)) !==
      JSON.stringify(semanticLockBanner(next.lockBanner));
  if (next.lockCanEdit === false && (prev?.lockCanEdit !== false || lockPresentationChanged)) {
    decisions.push({
      name: "lock.blocked",
      cause: "property-lock",
      payload: {
        pageUrl,
        blockedReason: next.lockBlockedReason ?? "locked",
        banner: next.lockBanner ?? { visible: true, reason: "locked" },
      },
    });
  }
  if (prev?.lockCanEdit === false && next.lockCanEdit === true) {
    decisions.push({
      name: "lock.acquired",
      cause: "property-lock",
      payload: { pageUrl },
    });
  }
  if (prev?.reconciliationPending !== true && next.reconciliationPending) {
    decisions.push({
      name: "reconciliation.started",
      cause: "save-lifecycle",
      payload: { pageUrl, reason: next.reconciliationReason ?? "pending" },
    });
  }
  if (prev?.reconciliationPending === true && !next.reconciliationPending) {
    decisions.push({
      name: "reconciliation.ended",
      cause: "save-lifecycle",
      payload: { pageUrl, reason: next.reconciliationReason ?? "settled" },
    });
  }
  return decisions;
}
