import { z } from "zod";

export const RenderInspectionPropertyScopeSchema = z.object({
  environmentKey: z.string().trim().min(1),
  siteId: z.number().int().positive(),
  baseUrl: z.string().url(),
});

export const RenderInspectionPhaseSchema = z.enum([
  "arming",
  "awaiting_document",
  "adopted",
  "terminal",
]);

export const RenderInspectionTerminalReasonSchema = z.enum([
  "paint-acknowledged",
  "cancelled",
  "superseded",
  "start-failed",
  "content-failed",
  "unexpected-navigation",
  "timeout",
  "unregistered",
  "tab-closed",
  "extension-invalidated",
]);

/** A complete, durable view of one inspection generation. Consumers never
 * infer success from a reload callback or from a prior boolean poll. */
export const RenderInspectionSessionObjectSchema = z.object({
  token: z.string().min(1),
  generation: z.number().int().positive(),
  phase: RenderInspectionPhaseSchema,
  property: RenderInspectionPropertyScopeSchema,
  pageUrl: z.string().url(),
  javascriptEnabled: z.boolean(),
  documentId: z.string().min(1).nullable(),
  documentNonce: z.string().min(1).nullable(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative(),
  terminalReason: RenderInspectionTerminalReasonSchema.nullable(),
});

export const RenderInspectionSessionSchema = RenderInspectionSessionObjectSchema.superRefine((session, context) => {
  if (session.phase === "terminal" && session.terminalReason === null) {
    context.addIssue({
      code: "custom",
      path: ["terminalReason"],
      message: "A terminal inspection requires a terminal reason",
    });
  }
  if (session.phase !== "terminal" && session.terminalReason !== null) {
    context.addIssue({
      code: "custom",
      path: ["terminalReason"],
      message: "An active inspection cannot have a terminal reason",
    });
  }
  if (session.phase === "adopted" && (!session.documentId || !session.documentNonce)) {
    context.addIssue({
      code: "custom",
      path: ["documentNonce"],
      message: "An adopted inspection requires a document identity and nonce",
    });
  }
});

export const RenderInspectionStartRequestSchema = z.object({
  tabId: z.number().int().positive(),
  property: RenderInspectionPropertyScopeSchema,
  pageUrl: z.string().url(),
  javascriptEnabled: z.boolean(),
});

export const RenderInspectionStartResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("started"),
    session: RenderInspectionSessionSchema,
  }),
  z.object({
    status: z.literal("error"),
    reason: z.string().min(1),
    session: RenderInspectionSessionSchema,
  }),
]);

export const RenderInspectionCurrentRequestSchema = z.object({
  tabId: z.number().int().positive(),
});

export const RenderInspectionCurrentResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("inactive") }),
  z.object({
    status: z.literal("active"),
    session: RenderInspectionSessionSchema,
  }),
  z.object({
    status: z.literal("terminal"),
    session: RenderInspectionSessionSchema,
  }),
]);

export const RenderInspectionCancelRequestSchema = z.object({
  tabId: z.number().int().positive(),
  token: z.string().min(1),
  generation: z.number().int().positive(),
});

export const RenderInspectionAdoptRequestSchema = z.object({
  tabId: z.number().int().positive().optional(),
  pageUrl: z.string().url(),
  documentNonce: z.string().min(1).max(256),
});

export const RenderInspectionAdoptResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("inactive") }),
  z.object({
    status: z.literal("adopt"),
    session: RenderInspectionSessionSchema,
  }),
  z.object({
    status: z.literal("terminal"),
    session: RenderInspectionSessionSchema,
  }),
  z.object({
    status: z.literal("stale"),
    reason: z.string().min(1),
    session: RenderInspectionSessionSchema.optional(),
  }),
]);

export const RenderInspectionDocumentFenceSchema = z.object({
  tabId: z.number().int().positive().optional(),
  token: z.string().min(1),
  generation: z.number().int().positive(),
  pageUrl: z.string().url(),
  documentNonce: z.string().min(1).max(256),
});

export const RenderInspectionAckPaintRequestSchema = RenderInspectionDocumentFenceSchema;

export const RenderInspectionFailRequestSchema = RenderInspectionDocumentFenceSchema.extend({
  reason: z.string().trim().min(1).max(512),
});

export const RenderInspectionMutationResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("inactive") }),
  z.object({
    status: z.literal("ok"),
    session: RenderInspectionSessionSchema,
  }),
  z.object({
    status: z.literal("stale"),
    reason: z.string().min(1),
    session: RenderInspectionSessionSchema.optional(),
  }),
]);

export type RenderInspectionPropertyScope = z.infer<typeof RenderInspectionPropertyScopeSchema>;
export type RenderInspectionPhase = z.infer<typeof RenderInspectionPhaseSchema>;
export type RenderInspectionTerminalReason = z.infer<typeof RenderInspectionTerminalReasonSchema>;
export type RenderInspectionSession = z.infer<typeof RenderInspectionSessionSchema>;
export type RenderInspectionStartRequest = z.infer<typeof RenderInspectionStartRequestSchema>;
export type RenderInspectionStartResponse = z.infer<typeof RenderInspectionStartResponseSchema>;
export type RenderInspectionCurrentResponse = z.infer<typeof RenderInspectionCurrentResponseSchema>;
export type RenderInspectionAdoptResponse = z.infer<typeof RenderInspectionAdoptResponseSchema>;
export type RenderInspectionMutationResponse = z.infer<typeof RenderInspectionMutationResponseSchema>;
