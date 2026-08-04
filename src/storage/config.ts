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

/** The timestamp a config carries until something actually decides the render
 *  mode. Legacy called this PAGE_TIMESTAMP_FALLBACK. */
export const RENDER_MODE_NEVER_DECIDED_AT = "1970-01-01T00:00:00Z";

/** A stored render mode only counts once something set it. Otherwise the value
 *  is just the schema default, and adopting it would present a guess as a
 *  decision — the same reason the popup starts unset. An unparseable timestamp
 *  is treated as never-decided, matching legacy's normalize-then-compare. */
export function isRenderModeConfirmed(config: Readonly<{ renderModeUpdatedAt?: unknown }> | null | undefined): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }
  const raw = config.renderModeUpdatedAt;
  if (typeof raw !== "string" || raw.trim() === "") {
    return false;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed !== Date.parse(RENDER_MODE_NEVER_DECIDED_AT);
}
