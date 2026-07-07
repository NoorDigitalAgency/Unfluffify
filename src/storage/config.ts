import { z } from "zod";

import { MarkRowSchema } from "../domain/schema/marking";
import { BaseUrlSchema, RenderModeSchema, SiteIdSchema } from "../domain/schema/property";

export const SelectorSetSchema = z.object({
  exclusionSelectors: z.array(z.string()),
  inclusionSelectors: z.array(z.string()),
});

export const PageMarkingSnapshotSchema = z.object({
  timestamp: z.string().min(1),
  title: z.string().optional(),
  pageType: z.string().optional(),
  renderedHtml: z.string(),
  rawHtml: z.string().optional(),
  rows: z.array(MarkRowSchema),
});

export const ConfigSnapshotSchema = z.object({
  version: z.number().int().positive(),
  baseUrl: BaseUrlSchema,
  siteId: SiteIdSchema.nullable(),
  renderMode: RenderModeSchema,
  renderModeUpdatedAt: z.string().min(1),
  selectors: SelectorSetSchema,
  selectorsUpdatedAt: z.string().min(1),
  submittedSelectorsFingerprint: z.string(),
  pageMarkings: z.record(z.string().url(), PageMarkingSnapshotSchema),
});

export type SelectorSet = z.infer<typeof SelectorSetSchema>;
export type PageMarkingSnapshot = z.infer<typeof PageMarkingSnapshotSchema>;
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

export function parseConfigSnapshot(value: unknown): ConfigSnapshot {
  return ConfigSnapshotSchema.parse(value);
}
