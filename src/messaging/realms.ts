import { defineContract, PageCommandNameSchema } from "./contract";
import {
  CommandEnvelopeSchema,
  CommandReplySchema,
  FactEnvelopeSchema,
  SignalConsumeRequestSchema,
  SignalFrameSchema,
  SignalPullRequestSchema,
} from "./contracts";
import { defineBus, type DefineBusOptions } from "./bus";
import { z } from "zod";
import { AiRunPayloadSnapshotSchema } from "../domain/schema/submission";
import {
  LockBannerVocabularySchema,
  LockActionSchema,
  LockReasonSchema,
  LockRoleSchema,
} from "../domain/schema/facts";
import { RenderModeSchema } from "../domain/schema/property";
import {
  ConfigSnapshotSchema,
  PageKeySchema,
  PropertyPublishRequestSchema,
  PropertySaveFailureStatusSchema,
  PropertySaveRequestSchema,
  SelectorSetSchema,
} from "../storage/config";
import { MarkRowSchema } from "../domain/schema/marking";
import {
  PreviewCurrentRequestSchema,
  PreviewCurrentResponseSchema,
  PreviewEmphasizeRequestSchema,
  PreviewProjectRequestSchema,
  PreviewProjectionSchema,
  PreviewTargetRequestSchema,
  PreviewTargetResponseSchema,
} from "../domain/schema/preview";
import { ConnectionSettingsSchema } from "../storage/settings";
import { PageContextResolutionSchema } from "../domain/schema/context";
import { TodoCoverageSchema } from "../domain/schema/todo";
import { PublicationCommandStatusSchema, PublicationSnapshotStatusSchema } from "../domain/schema/publication";
import {
  ShieldPostureAdoptRetainedRequestSchema,
  ShieldPostureClearRequestSchema,
  ShieldPostureCurrentRequestSchema,
  ShieldPostureMutationResponseSchema,
  ShieldPostureProjectionSchema,
  ShieldPostureReadResponseSchema,
  ShieldPostureSetRequestSchema,
} from "./shield-posture";
import {
  RenderInspectionAckPaintRequestSchema,
  RenderInspectionAckReloadRequestSchema,
  RenderInspectionAdoptRequestSchema,
  RenderInspectionAdoptResponseSchema,
  RenderInspectionCancelRequestSchema,
  RenderInspectionCurrentRequestSchema,
  RenderInspectionCurrentResponseSchema,
  RenderInspectionFailRequestSchema,
  RenderInspectionMutationResponseSchema,
  RenderInspectionStartRequestSchema,
  RenderInspectionStartResponseSchema,
} from "./render-inspection";

const LockDirectiveRequestSchema = z.object({
  tabId: z.number().int().nonnegative(),
  pageUrl: z.string(),
  baseUrl: z.string().optional(),
  hasUnsavedChanges: z.boolean().optional(),
  refreshFence: z.boolean().optional(),
});

const LockActionRequestSchema = LockActionSchema.extend({
  /** Content frames derive this from the runtime sender; popup frames name the
   *  tab explicitly because a side panel is not itself a tab. */
  tabId: z.number().int().nonnegative().optional(),
});

/** Why there is or is not a lock. Declared once here so the runtime that
 *  produces these and the surfaces that read them cannot drift apart. */
export const LockStatusSchema = z.enum([
  "ok",
  "not_configured",
  "not_candidate",
  "suspended_candidate_removed",
  "suspended_candidate_feed_conflict",
  "signed_out",
  "unavailable",
]);
export type LockStatus = z.infer<typeof LockStatusSchema>;

const LockStateResponseSchema = z.object({
  status: LockStatusSchema,
  baseUrl: z.string().url(),
  environmentKey: z.string().min(1).nullable().optional(),
  siteId: z.number().int().positive().nullable(),
  lockRole: LockRoleSchema,
  configPresent: z.boolean(),
  canEdit: z.boolean(),
  blockedReason: LockReasonSchema,
  authority: z.object({
    environmentKey: z.string().min(1),
    editorSessionId: z.string().min(1),
    lockToken: z.string().min(1),
    propertyRevision: z.number().int().nonnegative(),
    feedRevision: z.number().int().nonnegative(),
  }).optional(),
  lockBanner: LockBannerVocabularySchema,
});

const EmulationPhysicalViewportHintSchema = z.object({
  /** The side panel is not inside the emulated page, so its content height is
   * an independent measurement of the user's currently visible tab height. */
  height: z.number().finite().positive(),
}).strict();

const EmulationApplyRequestSchema = z.object({
  tabId: z.number().int().positive(),
  mode: z.enum(["mobile", "desktop"]),
  scale: z.number(),
  physicalViewportHint: EmulationPhysicalViewportHintSchema.optional(),
  /** Whether the caller is in a position to survive a page reload. Establishing a
   *  spoofed identity needs one — Chrome fixes navigator.userAgent per document —
   *  and only the popup knows whether a marking session would lose work to it. */
  allowReload: z.boolean().optional(),
});

const EmulationStateResponseSchema = z.object({
  mode: z.enum(["mobile", "desktop"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scale: z.number(),
  active: z.boolean(),
  /** True when the document was loaded under a different identity than the one now
   *  in force, so what the operator is looking at is not what the override says. */
  identityStale: z.boolean().optional(),
  /** Chrome accepted the identity override and reload, but the replacement
   * document still owes an exact measured proof before `active` may become true. */
  reloadRequired: z.boolean().optional(),
  failureReason: z.enum([
    "viewport_mismatch",
    "physical_fit_mismatch",
    "device_pixel_ratio_mismatch",
    "page_scale_mismatch",
    "touch_mismatch",
    "pointer_media_mismatch",
    "identity_unavailable",
    "identity_mismatch",
    "proof_unavailable",
    "consent_suppression_disabled",
  ]).optional(),
});

/** What a content script needs to know about the page it just loaded, before any
 *  popup is open. Consent hiding and the reveal/freeze ritual are both page-load
 *  behaviours, so waiting for an operator to open the popup is too late. */
const PageContextRequestSchema = z.object({
  tabId: z.number().int().nonnegative().optional(),
  pageUrl: z.string(),
  refresh: z.boolean().optional(),
  /** A scheduled authority sample. The background coalesces separate popup
   * consumers onto the same 15-second property resolution window. */
  backstop: z.boolean().optional(),
});

const PageContextResponseSchema = PageContextResolutionSchema.extend({
  /** Explicit Unregister is tab-scoped and survives its reload. Only the separate
   *  consent.suppression.register command clears this background-owned tombstone. */
  consentSuppressionAllowed: z.boolean().default(true),
  /** Whether the property has an established render mode. Marks taken under an
   *  unestablished one describe a page nobody has looked at, and the ritual is part
   *  of preparing the page to be marked. */
  renderModeSet: z.boolean(),
  todo: TodoCoverageSchema,
  /** Atomically rebound background authority for this exact content document.
   * Silent selectors can survive a same-property reload; preview/busy posture
   * cannot. The content realm may adopt this before any popup exists. */
  shieldPosture: ShieldPostureProjectionSchema.default({
    status: "inactive",
    revision: 0,
  }),
});

const PageWorldCommandResultSchema = z.object({
  ok: z.boolean(),
  nonce: z.string(),
  command: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  failure: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
});

const PageWorldOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), result: PageWorldCommandResultSchema }),
  z.object({
    status: z.enum(["stale", "unavailable"]),
    reason: z.string().min(1),
  }),
]);

const StaticHtmlFetchResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    status: z.number().int().nonnegative(),
    url: z.string().url(),
    html: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    status: z.number().int().nonnegative().optional(),
    error: z.string().min(1),
  }),
]);

export const TransferPayloadHandleSchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1).max(256),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
  byteLength: z.number().int().nonnegative(),
});
export type TransferPayloadHandle = z.infer<typeof TransferPayloadHandleSchema>;

const OffscreenRefineXpathsRequestSchema = z.object({
  renderedHtmlRef: TransferPayloadHandleSchema,
  rawHtmlRef: TransferPayloadHandleSchema.optional(),
  rows: z.array(MarkRowSchema),
});

export const applicationContract = defineContract({
  commands: {
    "command.dispatch": {
      request: CommandEnvelopeSchema,
      response: CommandReplySchema,
    },
    "preview.project": {
      request: PreviewProjectRequestSchema,
      response: PreviewProjectionSchema,
    },
    "preview.current": {
      request: PreviewCurrentRequestSchema,
      response: PreviewCurrentResponseSchema,
    },
    "preview.emphasize": {
      request: PreviewEmphasizeRequestSchema,
      response: PreviewTargetResponseSchema,
    },
    "preview.activate": {
      request: PreviewTargetRequestSchema,
      response: PreviewTargetResponseSchema,
    },
    "signals.pull": {
      request: SignalPullRequestSchema,
      response: SignalFrameSchema.array(),
    },
    "signals.consume": {
      request: SignalConsumeRequestSchema,
      response: z.object({ ok: z.literal(true) }),
    },
    "ai.run": {
      request: z.object({
        tabId: z.number().int().positive(),
        siteId: z.number().int().positive(),
        pageKey: PageKeySchema,
        clientRunId: z.string().min(1),
        editorSessionId: z.string().min(1),
        snapshot: AiRunPayloadSnapshotSchema,
      }),
      response: z.object({
        status: z.string(),
        sessionId: z.string().optional(),
        httpStatus: z.number().optional(),
        failureStage: z.enum(["start", "status", "result", "timeout", "transport"]).optional(),
        reason: z.string().optional(),
        selectors: SelectorSetSchema.optional(),
      }),
    },
    "ai.resume": {
      request: z.object({
        tabId: z.number().int().positive(),
        siteId: z.number().int().positive(),
        pageKey: PageKeySchema,
        clientRunId: z.string().min(1),
        editorSessionId: z.string().min(1),
      }),
      response: z.discriminatedUnion("status", [
        z.object({
          status: z.literal("fresh"),
          sessionId: z.string().min(1),
          clientRunId: z.string().min(1),
          deadlineAt: z.number().int().nonnegative().optional(),
          selectors: SelectorSetSchema,
        }),
        z.object({
          status: z.literal("running"),
          sessionId: z.string().min(1),
          clientRunId: z.string().min(1),
          deadlineAt: z.number().int().nonnegative().optional(),
        }),
        z.object({
          status: z.enum(["failed", "stale"]),
          sessionId: z.string().min(1),
          clientRunId: z.string().min(1),
          deadlineAt: z.number().int().nonnegative().optional(),
          error: z.string().optional(),
          failureStage: z.enum(["start", "status", "result", "timeout", "transport"]).optional(),
          reason: z.string().optional(),
        }),
        z.object({ status: z.enum(["not_found", "invalid", "environment_unconfigured"]) }),
      ]),
    },
    /* Reads a property's stored settings back, so a render mode decided in an
       earlier session is not re-asked on every popup open. */
    "config.load": {
      request: z.object({ siteId: z.number().int().positive() }),
      response: z.discriminatedUnion("status", [
        z.object({
          status: z.literal("ok"),
          config: ConfigSnapshotSchema,
          renderMode: RenderModeSchema.optional(),
          pendingRenderMode: RenderModeSchema.optional(),
          renderModeSource: z.literal("backend"),
        }),
        z.object({
          status: z.literal("integrity_shrink"),
          config: ConfigSnapshotSchema,
          reason: z.string().min(1),
          renderMode: RenderModeSchema.optional(),
          pendingRenderMode: RenderModeSchema.optional(),
          renderModeSource: z.literal("backend"),
        }),
        z.object({
          status: z.enum([
            "auth_error",
            "not_found",
            "invalid",
            "environment_unconfigured",
            "error",
          ]),
          httpStatus: z.number().optional(),
          renderMode: RenderModeSchema.optional(),
          pendingRenderMode: RenderModeSchema.optional(),
          renderModeSource: z.enum(["backend", "local"]),
        }),
      ]),
    },
    /* Stores an operator's choice for a property the backend has no
       configuration for. Refused otherwise — see local-property.ts. */
    "renderMode.remember": {
      request: z.object({
        siteId: z.number().int().positive(),
        renderMode: RenderModeSchema,
      }),
      response: z.object({
        stored: z.boolean(),
        reason: z.string().optional(),
      }),
    },
    "config.save": {
      request: PropertySaveRequestSchema,
      response: z.discriminatedUnion("status", [
        // Save success is a commit acknowledgement only. The caller must issue
        // a distinct config.load to obtain the latest complete authority.
        z.object({ status: z.literal("ok") }),
        z.object({
          status: z.union([
            z.enum([
              "conflict",
              "empty",
              "auth_error",
              "invalid",
              "integrity_shrink",
              "environment_unconfigured",
              "error",
            ]),
            PropertySaveFailureStatusSchema,
          ]),
          httpStatus: z.number().optional(),
          config: ConfigSnapshotSchema.optional(),
          propertyRevision: z.number().int().nonnegative().optional(),
          feedRevision: z.number().int().nonnegative().optional(),
          duplicateOperation: z.boolean().optional(),
          reason: z.string().optional(),
        }),
      ]),
    },
    "config.publish": {
      request: PropertyPublishRequestSchema,
      response: z.object({
        status: PublicationCommandStatusSchema,
        httpStatus: z.number().optional(),
        reason: z.string().optional(),
        config: ConfigSnapshotSchema.optional(),
      }).superRefine((value, context) => {
        if (PublicationSnapshotStatusSchema.safeParse(value.status).success && !value.config) {
          context.addIssue({ code: "custom", message: "authoritative publication outcomes require config" });
        }
      }),
    },
    /* The JWT never crosses this boundary: the popup reads and writes only the
       endpoint fields, and learns about the credential as a boolean. */
    "settings.load": {
      request: z.object({}),
      response: z.object({
        status: z.enum(["ok", "invalid"]).optional(),
        settings: ConnectionSettingsSchema,
        hasToken: z.boolean(),
        reason: z.string().optional(),
      }),
    },
    "settings.save": {
      request: ConnectionSettingsSchema,
      response: z.object({
        status: z.literal("ok"),
        settings: ConnectionSettingsSchema,
        hasToken: z.boolean(),
      }),
    },
    "cache.clearDomain": {
      request: z.object({ origin: z.string().min(1) }),
      response: z.discriminatedUnion("status", [
        z.object({ status: z.literal("ok"), origin: z.string().url() }),
        z.object({ status: z.literal("error"), message: z.string().min(1) }),
      ]),
    },
    /** A terminal tab boundary shared by definitive configuration deletion and
     *  the explicit Unregister action. It releases the lease and clears every
     *  resumable tab-scoped record; it does not delete property configuration. */
    "session.unregister": {
      request: z.object({ tabId: z.number().int().positive() }),
      response: z.object({ status: z.literal("ok") }),
    },
    "accounts.login": {
      request: z.object({
        email: z.string().min(1),
        password: z.string().min(1),
      }),
      response: z.object({
        status: z.enum(["ok", "skipped", "missing_token", "rejected"]),
        httpStatus: z.number().optional(),
        message: z.string().optional(),
      }),
    },
    "accounts.logout": {
      request: z.object({}),
      response: z.object({ status: z.literal("ok") }),
    },
    "accounts.validate": {
      request: z.object({}),
      response: z.object({
        status: z.enum(["valid", "invalid", "skipped", "error"]),
        httpStatus: z.number().optional(),
      }),
    },
    /* The cached verdict from the periodic monitor, so a popup opening after a
       background check learns the token is dead without re-validating. */
    "accounts.status": {
      request: z.object({}),
      response: z.object({
        state: z.enum(["unknown", "valid", "invalid"]),
        checkedAt: z.number().int().nonnegative(),
      }),
    },
    "lock.directive": {
      request: LockDirectiveRequestSchema,
      response: LockStateResponseSchema,
    },
    "lock.action": {
      request: LockActionRequestSchema,
      response: z.object({ status: z.enum(["ok", "unavailable"]) }),
    },
    "emulation.apply": {
      request: EmulationApplyRequestSchema,
      response: EmulationStateResponseSchema,
    },
    "emulation.current": {
      request: EmulationApplyRequestSchema.pick({
        tabId: true,
        mode: true,
        scale: true,
        physicalViewportHint: true,
      }),
      response: EmulationStateResponseSchema.nullable(),
    },
    "emulation.clear": {
      request: z.object({ tabId: z.number().int().positive() }),
      response: z.object({ status: z.literal("ok") }),
    },
    "emulation.refit": {
      request: z.object({
        tabId: z.number().int().positive(),
        physicalViewportHint: EmulationPhysicalViewportHintSchema.optional(),
      }),
      response: z.object({ status: z.literal("ok") }),
    },
    "page.context": {
      request: PageContextRequestSchema,
      response: PageContextResponseSchema,
    },
    "pageWorld.acquire": {
      request: z.object({ pageUrl: z.string().url() }),
      response: PageWorldOutcomeSchema,
    },
    "pageWorld.command": {
      request: z.object({
        pageUrl: z.string().url(),
        nonce: z.string().min(1).max(256),
        sessionNonce: z.string().min(1).max(256).optional(),
        command: PageCommandNameSchema,
        payload: z.record(z.string(), z.unknown()),
      }),
      response: PageWorldOutcomeSchema,
    },
    "shield.posture.current": {
      request: ShieldPostureCurrentRequestSchema,
      response: ShieldPostureReadResponseSchema,
    },
    "shield.posture.adoptRetained": {
      request: ShieldPostureAdoptRetainedRequestSchema,
      response: ShieldPostureReadResponseSchema,
    },
    "shield.posture.set": {
      request: ShieldPostureSetRequestSchema,
      response: ShieldPostureMutationResponseSchema,
    },
    "shield.posture.clear": {
      request: ShieldPostureClearRequestSchema,
      response: ShieldPostureMutationResponseSchema,
    },
    "consent.suppression.register": {
      request: z.object({ tabId: z.number().int().positive() }),
      response: z.object({ status: z.enum(["ok", "stale"]) }),
    },
    "staticHtml.fetch": {
      request: z.object({ url: z.string() }),
      response: StaticHtmlFetchResponseSchema,
    },
    "renderInspection.start": {
      request: RenderInspectionStartRequestSchema,
      response: RenderInspectionStartResponseSchema,
    },
    "renderInspection.current": {
      request: RenderInspectionCurrentRequestSchema,
      response: RenderInspectionCurrentResponseSchema,
    },
    "renderInspection.cancel": {
      request: RenderInspectionCancelRequestSchema,
      response: RenderInspectionMutationResponseSchema,
    },
    "renderInspection.adopt": {
      request: RenderInspectionAdoptRequestSchema,
      response: RenderInspectionAdoptResponseSchema,
    },
    "renderInspection.paintFallbackTick": {
      request: RenderInspectionAckPaintRequestSchema,
      response: z.discriminatedUnion("status", [
        z.object({ status: z.literal("ready") }),
        z.object({ status: z.literal("stale"), reason: z.string().min(1) }),
      ]),
    },
    "renderInspection.ackPaint": {
      request: RenderInspectionAckPaintRequestSchema,
      response: RenderInspectionMutationResponseSchema,
    },
    "renderInspection.ackReload": {
      request: RenderInspectionAckReloadRequestSchema,
      response: RenderInspectionMutationResponseSchema,
    },
    "renderInspection.fail": {
      request: RenderInspectionFailRequestSchema,
      response: RenderInspectionMutationResponseSchema,
    },
    "transferPayload.put": {
      request: z.object({
        scope: z.string().min(1).max(256),
        value: z.string(),
      }),
      response: z.object({ handle: TransferPayloadHandleSchema }),
    },
    "transferPayload.get": {
      request: z.object({ handle: TransferPayloadHandleSchema }),
      response: z.discriminatedUnion("status", [
        z.object({ status: z.literal("ok"), value: z.string() }),
        z.object({ status: z.literal("missing") }),
      ]),
    },
    "transferPayload.release": {
      request: z.object({ scope: z.string().min(1).max(256) }),
      response: z.object({ released: z.number().int().nonnegative() }),
    },
    "offscreen.refineXpaths": {
      request: OffscreenRefineXpathsRequestSchema,
      response: z.object({ rows: z.array(MarkRowSchema) }),
    },
  },
  events: {
    "fact.reported": FactEnvelopeSchema,
    "preview.focused": z.object({
      pageUrl: z.string().min(1),
      projectionId: z.string().min(1),
      rowId: z.string().min(1),
    }),
    "signals.available": z.object({
      tabId: z.number().int().positive(),
    }),
    "page.urlChanged": z.object({
      tabId: z.number().int().positive(),
      documentId: z.string().min(1),
      pageUrl: z.string().url(),
    }),
  },
});

export function createRealmBus(options: DefineBusOptions) {
  return defineBus(applicationContract, options);
}
