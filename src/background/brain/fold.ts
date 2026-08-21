import {
  BrainSensationSchema,
  BrainSensationSourceSchema,
  TabFactsPatchSchema,
  TabFactsSchema,
  type BrainSensation,
  type BrainSensationSource,
  type TabFacts,
  type TabFactsPatch,
} from "../../domain/schema/facts";

export {
  BrainSensationSchema,
  BrainSensationSourceSchema,
  TabFactsPatchSchema,
  type BrainSensation,
  type BrainSensationSource,
  type TabFactsPatch,
};

export function createInitialTabFacts(tabId: number): TabFacts {
  return TabFactsSchema.parse({ tabId });
}

export function fold(prevFacts: TabFacts | null, sensation: BrainSensation): TabFacts {
  const parsed = BrainSensationSchema.parse(sensation);
  const prev = prevFacts ?? createInitialTabFacts(parsed.tabId);
  const pageUrlChanged =
    typeof parsed.facts.pageUrl === "string" &&
    typeof prev.pageUrl === "string" &&
    parsed.facts.pageUrl !== prev.pageUrl;
  const markingExited = prev.markingEnabled === true && parsed.facts.markingEnabled === false;
  const saved = (parsed.facts.savedSeq ?? prev.savedSeq ?? 0) > (prev.savedSeq ?? 0);
  const discarded = (parsed.facts.discardedSeq ?? prev.discardedSeq ?? 0) > (prev.discardedSeq ?? 0);
  const becameDirty = (parsed.facts.markingToggleSeq ?? 0) > (prev.markingToggleSeq ?? 0) ||
    parsed.facts.runPhase === "running" ||
    parsed.facts.runPhase === "completed" ||
    (parsed.facts.reconciliationPending === true && parsed.facts.reconciliationReason === "saving");
  const hasUnsavedWork = parsed.facts.hasUnsavedWork ?? (
    pageUrlChanged || markingExited || saved || discarded
      ? false
      : becameDirty ? true : prev.hasUnsavedWork
  );

  return TabFactsSchema.parse({
    ...prev,
    ...parsed.facts,
    tabId: parsed.tabId,
    markingEnabled: pageUrlChanged ? false : parsed.facts.markingEnabled ?? prev.markingEnabled,
    markingToggleSeq: pageUrlChanged
      ? parsed.facts.markingToggleSeq ?? 0
      : parsed.facts.markingToggleSeq ?? prev.markingToggleSeq,
    runPhase: pageUrlChanged ? parsed.facts.runPhase ?? "idle" : parsed.facts.runPhase ?? prev.runPhase,
    previewActive: pageUrlChanged ? false : parsed.facts.previewActive ?? prev.previewActive,
    previewExitRequested: pageUrlChanged
      ? false
      : parsed.facts.previewExitRequested ?? prev.previewExitRequested,
    hasUnsavedWork,
    reconciliationPending: pageUrlChanged
      ? false
      : parsed.facts.reconciliationPending ?? prev.reconciliationPending,
  });
}
