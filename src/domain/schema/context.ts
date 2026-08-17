import { z } from "zod";

export const PropertyContextStatusSchema = z.enum([
  "candidate_feed_valid",
  "managed_candidate",
  "managed_non_candidate",
  "candidate_feed_conflict",
  "property_not_found",
  "authentication_required",
  "access_denied",
  "environment_not_registered",
  "invalid_request",
  "invalid_upstream",
  "upstream_unavailable",
]);

export const PropertyContextPageSchema = z.object({
  pageKey: z.string().min(1),
  wordsCount: z.number().int().nonnegative().nullable(),
});

export const PropertyContextPageTypeSchema = z.object({
  pageType: z.string(),
  pages: z.array(PropertyContextPageSchema),
});

export type PropertyContextPageType = z.infer<typeof PropertyContextPageTypeSchema>;

export const PropertyContextConflictSchema = z.object({
  pageKey: z.string().min(1),
  pageTypes: z.array(z.string()),
  resolution: z.string(),
});

/** The exact response owned by Hub /context. Its page key and feed are already
 * canonical; the extension must not recreate either from the observed origin. */
export const PropertyContextResponseSchema = z.object({
  status: PropertyContextStatusSchema,
  environmentKey: z.string(),
  siteId: z.number().int().positive().nullable(),
  baseUrl: z.string().nullable(),
  pageKey: z.string().nullable(),
  pageTypes: z.array(PropertyContextPageTypeSchema),
  membershipFingerprint: z.string().nullable(),
  assignmentFingerprint: z.string().nullable(),
  conflicts: z.array(PropertyContextConflictSchema),
  upstreamCode: z.string().nullable().optional().default(null),
});

export type PropertyContextResponse = z.infer<typeof PropertyContextResponseSchema>;

export const PageContextOutcomeStatusSchema = z.enum([
  "managed_candidate",
  "managed_non_candidate",
  "suspended_candidate_removed",
  "suspended_candidate_feed_conflict",
  "unmanaged",
  "authentication_required",
  "access_denied",
  "environment_not_registered",
  "unavailable",
  "stale",
]);

export const DraftDispositionSchema = z.enum(["preserve", "terminate"]);

/** The background's generation-safe projection. Transient results may carry the
 * last valid context for the same observed page while draftDisposition remains
 * preserve; stale generations never carry context from the page that replaced
 * them. */
export const PageContextResolutionSchema = z.object({
  status: PageContextOutcomeStatusSchema,
  generation: z.number().int().positive(),
  observedUrl: z.string(),
  draftDisposition: DraftDispositionSchema,
  environmentKey: z.string().nullable(),
  siteId: z.number().int().positive().nullable(),
  baseUrl: z.string().nullable(),
  pageKey: z.string().nullable(),
  pageTypes: z.array(PropertyContextPageTypeSchema),
  membershipFingerprint: z.string().nullable(),
  assignmentFingerprint: z.string().nullable(),
  conflicts: z.array(PropertyContextConflictSchema),
  upstreamCode: z.string().nullable(),
});

export type PageContextResolution = z.infer<typeof PageContextResolutionSchema>;
