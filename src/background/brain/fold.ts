import { z } from "zod";

import {
  LockBannerVocabularySchema,
  LockReasonSchema,
  TabFactsSchema,
  type TabFacts,
} from "../../domain/schema/facts";

export const BrainSensationSourceSchema = z.enum(["background", "content", "popup", "page"]);

export const TabFactsPatchSchema = z.object({
  tabId: z.number().int().nonnegative(),
  siteId: z.number().int().positive().nullable().optional(),
  baseUrl: z.string().url().nullable().optional(),
  pageUrl: z.string().url().nullable().optional(),
  renderMode: z.enum(["rendered", "static"]).nullable().optional(),
  candidate: z.boolean().optional(),
  markingEnabled: z.boolean().optional(),
  /** Monotonic count of operator toggles. Never a row count: the page moves
   *  that on its own. */
  markingToggleSeq: z.number().int().nonnegative().optional(),
  runPhase: z.enum(["idle", "running", "completed", "failed"]).optional(),
  runSessionId: z.string().optional(),
  runDeadlineAt: z.number().int().nonnegative().optional(),
  runAiSessionId: z.string().optional(),
  runSelectors: z.object({
    exclusionSelectors: z.array(z.string()),
    inclusionSelectors: z.array(z.string()),
  }).optional(),
  runFailureReason: z.string().optional(),
  previewActive: z.boolean().optional(),
  previewOrigin: z.enum(["silent", "post_ai", "marking"]).optional(),
  previewExitRequested: z.boolean().optional(),
  savedSeq: z.number().int().nonnegative().optional(),
  discardedSeq: z.number().int().nonnegative().optional(),
  hasUnsavedWork: z.boolean().optional(),
  inspectionPending: z.boolean().optional(),
  lockRole: z.enum(["unknown", "editor", "passive"]).optional(),
  lockCanEdit: z.boolean().optional(),
  lockBlockedReason: LockReasonSchema.optional(),
  lockBanner: LockBannerVocabularySchema.optional(),
  configPresent: z.boolean().optional(),
  reconciliationPending: z.boolean().optional(),
  reconciliationReason: z.string().optional(),
});

export const BrainSensationSchema = z.object({
  tabId: z.number().int().nonnegative(),
  source: BrainSensationSourceSchema,
  reason: z.string().min(1),
  facts: TabFactsPatchSchema,
});

export type BrainSensationSource = z.infer<typeof BrainSensationSourceSchema>;
export type TabFactsPatch = z.infer<typeof TabFactsPatchSchema>;
export type BrainSensation = z.infer<typeof BrainSensationSchema>;

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
