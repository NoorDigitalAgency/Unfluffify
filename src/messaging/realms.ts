import { defineContract } from "./contract";
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
  LockReasonSchema,
  LockRoleSchema,
} from "../domain/schema/facts";
import { RenderModeSchema } from "../domain/schema/property";
import { ConfigSnapshotSchema, PageKeySchema, PropertySaveRequestSchema, SelectorSetSchema } from "../storage/config";
import { MarkRowSchema } from "../domain/schema/marking";
import { ConnectionSettingsSchema } from "../storage/settings";

const LockDirectiveRequestSchema = z.object({
  tabId: z.number().int().nonnegative(),
  pageUrl: z.string(),
  baseUrl: z.string().optional(),
  siteId: z.number().int().positive().nullable().optional(),
  hasUnsavedChanges: z.boolean().optional(),
});

/** Why there is or is not a lock. Declared once here so the runtime that
 *  produces these and the surfaces that read them cannot drift apart. */
export const LockStatusSchema = z.enum(["ok", "not_configured", "not_candidate", "signed_out", "unavailable"]);
export type LockStatus = z.infer<typeof LockStatusSchema>;

const LockStateResponseSchema = z.object({
  status: LockStatusSchema,
  baseUrl: z.string().url(),
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

const EmulationApplyRequestSchema = z.object({
  tabId: z.number().int().positive(),
  mode: z.enum(["mobile", "desktop"]),
  scale: z.number(),
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
});

/* Comparing the two views is the operator's job, so the command only reloads
   the tab in the requested JavaScript mode; nothing is captured or judged. */
const RenderModeInspectRequestSchema = z.object({
  tabId: z.number().int().positive(),
  javascriptEnabled: z.boolean(),
});

const RenderModeInspectResponseSchema = z.object({
  status: z.enum(["ok", "unavailable", "error"]),
  reclaimLockAfterReload: z.boolean(),
});

/** What a content script needs to know about the page it just loaded, before any
 *  popup is open. Consent hiding and the reveal/freeze ritual are both page-load
 *  behaviours, so waiting for an operator to open the popup is too late. */
const PageContextRequestSchema = z.object({
  tabId: z.number().int().nonnegative().optional(),
  pageUrl: z.string(),
});

const PageContextResponseSchema = z.object({
  /** Whether this URL belongs to a managed property at all. The only gate on
   *  consent hiding — not candidacy, not the render mode. */
  property: z.boolean(),
  baseUrl: z.string(),
  siteId: z.number().int().positive().nullable(),
  /** Whether the property has an established render mode. Marks taken under an
   *  unestablished one describe a page nobody has looked at, and the ritual is part
   *  of preparing the page to be marked. */
  renderModeSet: z.boolean(),
  /** Whether this exact page carries a stored marking record — legacy's candidate
   *  page. The ritual prepares pages the crawler actually wants. */
  candidatePage: z.boolean(),
  /** Whether the property has any page records at all. A property with none has no
   *  way to say which pages matter, so candidacy cannot be required of it — and
   *  requiring it anyway means such a property is never prepared, on any load. */
  hasPageRecords: z.boolean(),
  /** Why the answer is what it is, for the operator-facing log. */
  reason: z.string(),
});

const OffscreenRefineXpathsRequestSchema = z.object({
  html: z.string(),
  rows: z.array(MarkRowSchema),
});

export const applicationContract = defineContract({
  commands: {
    "command.dispatch": {
      request: CommandEnvelopeSchema,
      response: CommandReplySchema,
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
        snapshot: AiRunPayloadSnapshotSchema,
      }),
      response: z.object({
        status: z.string(),
        sessionId: z.string().optional(),
        httpStatus: z.number().optional(),
        selectors: SelectorSetSchema.optional(),
      }),
    },
    "ai.resume": {
      request: z.object({
        tabId: z.number().int().positive(),
        siteId: z.number().int().positive(),
        pageKey: PageKeySchema,
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
          renderModeSource: z.literal("backend"),
        }),
        z.object({
          status: z.enum([
            "auth_error",
            "not_found",
            "invalid",
            "integrity_shrink",
            "environment_unconfigured",
            "error",
          ]),
          httpStatus: z.number().optional(),
          renderMode: RenderModeSchema.optional(),
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
        z.object({ status: z.literal("ok"), config: ConfigSnapshotSchema }),
        z.object({
          status: z.enum([
            "conflict",
            "empty",
            "auth_error",
            "invalid",
            "integrity_shrink",
            "environment_unconfigured",
            "error",
          ]),
          httpStatus: z.number().optional(),
          config: ConfigSnapshotSchema.optional(),
        }),
      ]),
    },
    /* The JWT never crosses this boundary: the popup reads and writes only the
       endpoint fields, and learns about the credential as a boolean. */
    "settings.load": {
      request: z.object({}),
      response: z.object({
        settings: ConnectionSettingsSchema,
        hasToken: z.boolean(),
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
    "emulation.apply": {
      request: EmulationApplyRequestSchema,
      response: EmulationStateResponseSchema,
    },
    "emulation.clear": {
      request: z.object({ tabId: z.number().int().positive() }),
      response: z.object({ status: z.literal("ok") }),
    },
    "page.context": {
      request: PageContextRequestSchema,
      response: PageContextResponseSchema,
    },
    "renderMode.inspect": {
      request: RenderModeInspectRequestSchema,
      response: RenderModeInspectResponseSchema,
    },
    "offscreen.refineXpaths": {
      request: OffscreenRefineXpathsRequestSchema,
      response: z.object({ rows: z.array(MarkRowSchema) }),
    },
  },
  events: {
    "fact.reported": FactEnvelopeSchema,
  },
});

export function createRealmBus(options: DefineBusOptions) {
  return defineBus(applicationContract, options);
}
