import { z } from "zod";

import { SelectorSetSchema } from "../storage/config";

export const ShieldPropertyScopeSchema = z.object({
  environmentKey: z.string().trim().min(1),
  siteId: z.number().int().positive(),
  baseUrl: z.string().url(),
});

export const ShieldExpectedScopeSchema = ShieldPropertyScopeSchema.extend({
  contextGeneration: z.number().int().positive(),
  pageUrl: z.string().url(),
  /** Opaque lifetime token for the adopted Chrome document. Popup callers do
   * not receive MessageSender.documentId, so this token fences their delayed
   * mutations across Unregister/reload even if numeric revisions restart. */
  documentKey: z.string().min(1),
});

export const ShieldMutationFenceSchema = ShieldExpectedScopeSchema.extend({
  revision: z.number().int().nonnegative(),
});

export const ShieldSilentPostureSchema = z.object({
  kind: z.literal("silent-selectors"),
  selectors: SelectorSetSchema,
});

export const ShieldPreviewPostureSchema = z.object({
  kind: z.literal("preview"),
  origin: z.enum(["silent", "post_ai"]),
  selectors: SelectorSetSchema.optional(),
});

export const ShieldBlockedPostureSchema = z.object({
  kind: z.literal("blocked-organ"),
  organState: z.enum(["running", "exit_restoring", "inspecting", "reconciling"]),
  blockedReason: z.string().trim().min(1),
  selectors: SelectorSetSchema.optional(),
});

export const ShieldDocumentPostureSchema = z.discriminatedUnion("kind", [
  ShieldPreviewPostureSchema,
  ShieldBlockedPostureSchema,
]);

export const ShieldPostureUpdateSchema = z.discriminatedUnion("kind", [
  ShieldSilentPostureSchema,
  ShieldPreviewPostureSchema,
  ShieldBlockedPostureSchema,
]);

const ShieldDirectiveOrganSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("silent") }),
  ShieldPreviewPostureSchema.omit({ kind: true }).extend({ state: z.literal("preview") }),
  ShieldBlockedPostureSchema.omit({ kind: true }).extend({ state: z.literal("blocked-organ") }),
]);

export const ShieldDirectiveSchema = z.object({
  silentSelectors: SelectorSetSchema.optional(),
  organ: ShieldDirectiveOrganSchema,
}).superRefine((directive, context) => {
  if (directive.organ.state === "silent" && !directive.silentSelectors) {
    context.addIssue({
      code: "custom",
      path: ["silentSelectors"],
      message: "A silent directive requires property-scoped selectors",
    });
  }
});

export const ShieldPostureProjectionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    revision: z.number().int().positive(),
    scope: ShieldExpectedScopeSchema,
    directive: ShieldDirectiveSchema,
  }),
  z.object({
    status: z.literal("inactive"),
    revision: z.number().int().nonnegative(),
    scope: ShieldExpectedScopeSchema.optional(),
  }),
]);

export const ShieldPostureReadResponseSchema = z.discriminatedUnion("status", [
  ...ShieldPostureProjectionSchema.options,
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const ShieldPostureMutationResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    posture: ShieldPostureProjectionSchema,
  }),
  z.object({
    status: z.enum(["stale", "unbound", "unavailable"]),
    reason: z.string().min(1),
  }),
]);

export const ShieldPostureCurrentRequestSchema = z.object({
  tabId: z.number().int().positive().optional(),
  pageUrl: z.string().url(),
});

export const ShieldPostureAdoptRetainedRequestSchema = z.object({
  tabId: z.number().int().positive().optional(),
  pageUrl: z.string().url(),
});

export const ShieldPostureSetRequestSchema = z.object({
  tabId: z.number().int().positive().optional(),
  expected: ShieldMutationFenceSchema,
  posture: ShieldPostureUpdateSchema,
});

export const ShieldPostureClearReasonSchema = z.enum([
  "save",
  "discard",
  "unregister",
  "property-exit",
  "config-removed",
  "silent-cleared",
  "navigation",
  "failure",
  "cancel",
  "extension-invalidation",
]);

export const ShieldPostureClearRequestSchema = z.object({
  tabId: z.number().int().positive().optional(),
  expected: ShieldMutationFenceSchema,
  reason: ShieldPostureClearReasonSchema,
});

export type ShieldPropertyScope = z.infer<typeof ShieldPropertyScopeSchema>;
export type ShieldExpectedScope = z.infer<typeof ShieldExpectedScopeSchema>;
export type ShieldMutationFence = z.infer<typeof ShieldMutationFenceSchema>;
export type ShieldSilentPosture = z.infer<typeof ShieldSilentPostureSchema>;
export type ShieldDocumentPosture = z.infer<typeof ShieldDocumentPostureSchema>;
export type ShieldPostureUpdate = z.infer<typeof ShieldPostureUpdateSchema>;
export type ShieldDirective = z.infer<typeof ShieldDirectiveSchema>;
export type ShieldPostureProjection = z.infer<typeof ShieldPostureProjectionSchema>;
export type ShieldPostureReadResponse = z.infer<typeof ShieldPostureReadResponseSchema>;
export type ShieldPostureMutationResponse = z.infer<typeof ShieldPostureMutationResponseSchema>;
export type ShieldPostureClearReason = z.infer<typeof ShieldPostureClearReasonSchema>;
