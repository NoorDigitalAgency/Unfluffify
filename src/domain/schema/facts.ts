import { z } from "zod";

import { RenderModeSchema, SiteIdSchema } from "./property";

export const LockRoleSchema = z.enum(["unknown", "editor", "passive"]);

export const TabFactsSchema = z.object({
  tabId: z.number().int().nonnegative(),
  siteId: SiteIdSchema.nullable().optional(),
  baseUrl: z.string().url().nullable().optional(),
  pageUrl: z.string().url().nullable().optional(),
  renderMode: RenderModeSchema.nullable().optional(),
  candidate: z.boolean().optional(),
  markingEnabled: z.boolean().default(false),
  lockRole: LockRoleSchema.default("unknown"),
  configPresent: z.boolean().default(false),
  reconciliationPending: z.boolean().default(false),
  lastSignalSeq: z.number().int().nonnegative().default(0),
});

export type LockRole = z.infer<typeof LockRoleSchema>;
export type TabFacts = z.infer<typeof TabFactsSchema>;
