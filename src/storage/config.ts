import { z } from "zod";

import { MarkRowSchema } from "../domain/schema/marking";
import { BaseUrlSchema, RenderModeSchema, SiteIdSchema } from "../domain/schema/property";

export const EnvironmentKeySchema = z.string().trim().min(1);

export const SelectorSetSchema = z.object({
  exclusionSelectors: z.array(z.string()),
  inclusionSelectors: z.array(z.string()),
});

export const PageKeySchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
  "pageKey must contain only the relative path, query, and fragment",
);

export const PageMarkingSnapshotSchema = z.object({
  timestamp: z.string().min(1),
  title: z.string().optional(),
  pageType: z.string().min(1),
  renderedHtml: z.string(),
  rawHtml: z.string().optional(),
  rows: z.array(MarkRowSchema),
});

export const ReconciliationMetadataSchema = z.object({
  revision: z.number().int().nonnegative(),
  feedFingerprint: z.string(),
  removedPageKeys: z.array(PageKeySchema),
  relabelledPages: z.array(z.object({
    pageKey: PageKeySchema,
    previousPageType: z.string().min(1),
    pageType: z.string().min(1),
  })),
});

export const PropertyOperationalBlockSchema = z.object({
  status: z.string().min(1),
  conflicts: z.array(z.object({
    pageKey: PageKeySchema,
    pageTypes: z.array(z.string().min(1)),
    resolution: z.string().min(1),
  })),
  detectedAt: z.string().min(1),
});

export const PropertyOperationMetadataSchema = z.object({
  operationId: z.string().min(1),
  status: z.string().min(1),
});

export const ConfigSnapshotSchema = z.object({
  version: z.literal(2),
  environmentKey: EnvironmentKeySchema,
  siteId: SiteIdSchema,
  baseUrl: BaseUrlSchema,
  propertyRevision: z.number().int().nonnegative(),
  feedRevision: z.number().int().nonnegative(),
  membershipFingerprint: z.string(),
  assignmentFingerprint: z.string(),
  renderMode: RenderModeSchema,
  renderModeUpdatedAt: z.string().min(1),
  selectors: SelectorSetSchema,
  selectorsUpdatedAt: z.string().min(1),
  submittedSelectorsFingerprint: z.string(),
  pages: z.record(PageKeySchema, PageMarkingSnapshotSchema),
  reconciliation: ReconciliationMetadataSchema,
  operationalBlock: PropertyOperationalBlockSchema.optional(),
  operation: PropertyOperationMetadataSchema.optional(),
}).strict();

export const PropertyMutationEnvelopeSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  environmentKey: EnvironmentKeySchema,
  siteId: SiteIdSchema,
  editorSessionId: z.string().trim().min(1),
  lockToken: z.string().trim().min(1),
  expectedPropertyRevision: z.number().int().nonnegative(),
  expectedFeedRevision: z.number().int().nonnegative(),
});

export const PropertySavePageSchema = z.object({
  pageKey: PageKeySchema,
  title: z.string().max(1024).optional(),
  pageType: z.string().min(1),
  renderedHtml: z.string().min(1),
  rawHtml: z.string().optional(),
  rows: z.array(MarkRowSchema),
});

export const PropertySaveRequestSchema = PropertyMutationEnvelopeSchema.extend({
  page: PropertySavePageSchema,
  selectors: SelectorSetSchema,
  renderMode: RenderModeSchema,
}).strict();

export type SelectorSet = z.infer<typeof SelectorSetSchema>;
export type PageMarkingSnapshot = z.infer<typeof PageMarkingSnapshotSchema>;
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;
export type PropertyMutationEnvelope = z.infer<typeof PropertyMutationEnvelopeSchema>;
export type PropertySavePage = z.infer<typeof PropertySavePageSchema>;
export type PropertySaveRequest = z.infer<typeof PropertySaveRequestSchema>;

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
