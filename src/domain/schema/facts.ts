import { z } from "zod";

import { RenderModeSchema, SiteIdSchema } from "./property";

export const LockRoleSchema = z.enum(["unknown", "editor", "passive"]);

const RunSelectorsSchema = z.object({
  exclusionSelectors: z.array(z.string()),
  inclusionSelectors: z.array(z.string()),
});

export const TabFactsSchema = z.object({
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
  inspectionPending: z.boolean().optional(),
  lockRole: LockRoleSchema.default("unknown"),
  lockCanEdit: z.boolean().optional(),
  lockBlockedReason: z.string().optional(),
  lockBanner: z.object({
    visible: z.boolean(),
    text: z.string(),
    countdownSeconds: z.number().int().nonnegative().optional(),
  }).optional(),
  configPresent: z.boolean().default(false),
  reconciliationPending: z.boolean().default(false),
  reconciliationReason: z.string().optional(),
  lastSignalSeq: z.number().int().nonnegative().default(0),
});

export type LockRole = z.infer<typeof LockRoleSchema>;
export type TabFacts = z.infer<typeof TabFactsSchema>;
