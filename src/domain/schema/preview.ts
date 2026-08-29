import { z } from "zod";

import { SelectorSetSchema } from "../../storage/config";
import { MarkRowSchema } from "./marking";

export const PreviewClassificationSchema = z.enum([
  "explicit-included",
  "implicit-included",
  "excluded",
  "undetected",
  "immutable",
  "closed-shadow",
]);

export const PreviewShadowProvenanceSchema = z.enum([
  "light",
  "open",
  "force-open-closed",
  "inaccessible-closed",
]);

export const PreviewTargetStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available") }),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["detached", "not-visible", "no-rendered-box"]),
  }),
]);

export const PreviewRowSchema = z.object({
  id: z.string().min(1),
  classification: PreviewClassificationSchema,
  text: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 80,
    "preview text must contain at most 80 Unicode code points",
  ),
  xpath: MarkRowSchema.shape.xpath,
  selector: z.string().min(1).optional(),
  shadow: PreviewShadowProvenanceSchema,
  // Optional keeps stored/in-flight projections from older rewrite builds
  // readable. New projections always publish this field.
  target: PreviewTargetStatusSchema.optional(),
});

export const PreviewProjectionSchema = z.object({
  projectionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  pageUrl: z.string().url(),
  rows: z.array(PreviewRowSchema),
});

export const PreviewProjectRequestSchema = z.object({
  pageUrl: z.string().url(),
  selectors: SelectorSetSchema,
});

export const PreviewTargetRequestSchema = z.object({
  pageUrl: z.string().url(),
  projectionId: z.string().min(1),
  rowId: z.string().min(1),
});

export const PreviewEmphasizeRequestSchema = PreviewTargetRequestSchema.extend({
  active: z.boolean(),
});

export const PreviewTargetResponseSchema = z.object({
  targeted: z.boolean(),
});

export type PreviewClassification = z.infer<typeof PreviewClassificationSchema>;
export type PreviewShadowProvenance = z.infer<typeof PreviewShadowProvenanceSchema>;
export type PreviewTargetStatus = z.infer<typeof PreviewTargetStatusSchema>;
export type PreviewRow = z.infer<typeof PreviewRowSchema>;
export type PreviewProjection = z.infer<typeof PreviewProjectionSchema>;
export type PreviewProjectRequest = z.infer<typeof PreviewProjectRequestSchema>;
export type PreviewTargetRequest = z.infer<typeof PreviewTargetRequestSchema>;
export type PreviewEmphasizeRequest = z.infer<typeof PreviewEmphasizeRequestSchema>;
export type PreviewTargetResponse = z.infer<typeof PreviewTargetResponseSchema>;
