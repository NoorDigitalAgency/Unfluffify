import { z } from "zod";

import { RenderModeSchema, SiteIdSchema } from "./property";

export const LockRoleSchema = z.enum(["unknown", "editor", "passive"]);

export const LockActionKindSchema = z.enum([
  "continue-here",
  "suggest-takeover",
  "accept-takeover",
  "reject-takeover",
  "take-over",
]);

export const LockActionSchema = z.object({
  kind: LockActionKindSchema,
  suggestionId: z.string().min(1).optional(),
  /** The action knowingly destroys another editor session's reported work. The
   *  surface must confirm before dispatching it; the background repeats this
   *  bit in the fenced Hub command. */
  confirmDiscard: z.boolean().optional(),
}).strict();

/** Stable lock vocabulary shared across realms. These values describe what the
 *  lock is doing; each surface owns the words it shows for them. */
export const LockReasonSchema = z.enum([
  "extension-context-invalidated",
  "connecting",
  "transfer",
  "disconnect-warning",
  "inactivity-warning",
  "off-candidate",
  "cross-property",
  "takeover-suggested",
  "editor",
  "locked",
  "not-configured",
  "not-candidate",
  "candidate-removed",
  "candidate-feed-conflict",
  "signed-out",
  "unavailable",
]);

export const LockBannerVocabularySchema = z.object({
  visible: z.boolean(),
  reason: LockReasonSchema,
  countdownSeconds: z.number().int().nonnegative().optional(),
  editorName: z.string().optional(),
  fromName: z.string().optional(),
  toName: z.string().optional(),
  actions: z.array(LockActionSchema).optional(),
}).strict();

const RunSelectorsSchema = z.object({
  exclusionSelectors: z.array(z.string()),
  inclusionSelectors: z.array(z.string()),
});

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
  /** @deprecated Accepted only as a no-op migration input. P16 inspection
   *  authority lives in the durable background inspection session. */
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

const TabFactsCompatibilitySchema = z.object({
  tabId: z.number().int().nonnegative(),
  siteId: SiteIdSchema.nullable().optional(),
  baseUrl: z.string().url().nullable().optional(),
  pageUrl: z.string().url().nullable().optional(),
  renderMode: RenderModeSchema.nullable().optional(),
  candidate: z.boolean().optional(),
  markingEnabled: z.boolean().default(false),
  /** Monotonic count of operator toggles. Never a row count: the page moves
   *  that on its own. */
  markingToggleSeq: z.number().int().nonnegative().optional(),
  runPhase: z.enum(["idle", "running", "completed", "failed"]).optional(),
  runSessionId: z.string().optional(),
  runDeadlineAt: z.number().int().nonnegative().optional(),
  runAiSessionId: z.string().optional(),
  runSelectors: RunSelectorsSchema.optional(),
  runFailureReason: z.string().optional(),
  previewActive: z.boolean().optional(),
  previewOrigin: z.enum(["silent", "post_ai", "marking"]).optional(),
  previewExitRequested: z.boolean().optional(),
  savedSeq: z.number().int().nonnegative().optional(),
  discardedSeq: z.number().int().nonnegative().optional(),
  hasUnsavedWork: z.boolean().default(false),
  /** @deprecated P16 render inspection is owned by its durable background
   *  session. Accept this field only so pre-P16 durable records can migrate. */
  inspectionPending: z.boolean().optional(),
  lockRole: LockRoleSchema.default("unknown"),
  lockCanEdit: z.boolean().optional(),
  lockBlockedReason: LockReasonSchema.optional(),
  lockBanner: LockBannerVocabularySchema.optional(),
  configPresent: z.boolean().default(false),
  reconciliationPending: z.boolean().default(false),
  reconciliationReason: z.string().optional(),
  lastSignalSeq: z.number().int().nonnegative().default(0),
});

export const TabFactsSchema = TabFactsCompatibilitySchema.transform(({
  inspectionPending: _retiredInspectionPending,
  ...facts
}) => facts);

export type LockRole = z.infer<typeof LockRoleSchema>;
export type LockActionKind = z.infer<typeof LockActionKindSchema>;
export type LockAction = z.infer<typeof LockActionSchema>;
export type LockReason = z.infer<typeof LockReasonSchema>;
export type LockBannerVocabulary = z.infer<typeof LockBannerVocabularySchema>;
export type TabFacts = z.infer<typeof TabFactsSchema>;
export type BrainSensationSource = z.infer<typeof BrainSensationSourceSchema>;
export type TabFactsPatch = z.infer<typeof TabFactsPatchSchema>;
export type BrainSensation = z.infer<typeof BrainSensationSchema>;
