import { defineContract } from "./contract";
import {
  CommandEnvelopeSchema,
  CommandReplySchema,
  FactEnvelopeSchema,
  SignalConsumeRequestSchema,
  SignalEmitRequestSchema,
  SignalFrameSchema,
  SignalPullRequestSchema,
} from "./contracts";
import { defineBus, type DefineBusOptions } from "./bus";
import { z } from "zod";
import { AiRunPayloadSnapshotSchema } from "../domain/schema/submission";
import { LockRoleSchema } from "../domain/schema/facts";
import { ConfigSnapshotSchema, SelectorSetSchema } from "../storage/config";
import { MarkRowSchema } from "../domain/schema/marking";
import { SettingsSchema } from "../storage/settings";

const LockDirectiveRequestSchema = z.object({
  tabId: z.number().int().nonnegative(),
  pageUrl: z.string(),
  baseUrl: z.string().optional(),
  siteId: z.number().int().positive().nullable().optional(),
  hasUnsavedChanges: z.boolean().optional(),
});

const LockDirectiveResponseSchema = z.object({
  status: z.enum(["ok", "not_configured", "not_candidate", "unavailable"]),
  siteId: z.number().int().positive().nullable(),
  lockRole: LockRoleSchema,
  directive: z.unknown(),
  lockBanner: z.object({
    visible: z.boolean(),
    text: z.string(),
    countdownSeconds: z.number().optional(),
  }),
});

const EmulationApplyRequestSchema = z.object({
  tabId: z.number().int().positive(),
  mode: z.enum(["mobile", "desktop"]),
  scale: z.number(),
});

const EmulationStateResponseSchema = z.object({
  mode: z.enum(["mobile", "desktop"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scale: z.number(),
  active: z.boolean(),
});

const RenderModeInspectRequestSchema = z.object({
  tabId: z.number().int().positive(),
  pageUrl: z.string().url(),
  baseUrl: z.string().url(),
  deviceSimulationEnabled: z.boolean(),
});

const RenderModeInspectResponseSchema = z.object({
  status: z.string(),
  renderedHtml: z.string().optional(),
  rawHtml: z.string().optional(),
  reclaimLockAfterReload: z.boolean().optional(),
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
    "signals.emit": {
      request: SignalEmitRequestSchema,
      response: SignalFrameSchema.array(),
    },
    "signals.consume": {
      request: SignalConsumeRequestSchema,
      response: z.object({ ok: z.literal(true) }),
    },
    "ai.run": {
      request: AiRunPayloadSnapshotSchema,
      response: z.object({
        status: z.string(),
        sessionId: z.string().optional(),
        httpStatus: z.number().optional(),
        selectors: SelectorSetSchema.optional(),
      }),
    },
    "config.save": {
      request: ConfigSnapshotSchema,
      response: z.object({
        status: z.string(),
        httpStatus: z.number().optional(),
      }),
    },
    "settings.load": {
      request: z.object({}),
      response: z.object({ settings: SettingsSchema }),
    },
    "settings.save": {
      request: SettingsSchema,
      response: z.object({ status: z.literal("ok"), settings: SettingsSchema }),
    },
    "lock.directive": {
      request: LockDirectiveRequestSchema,
      response: LockDirectiveResponseSchema,
    },
    "emulation.apply": {
      request: EmulationApplyRequestSchema,
      response: EmulationStateResponseSchema,
    },
    "emulation.clear": {
      request: z.object({ tabId: z.number().int().positive() }),
      response: z.object({ status: z.literal("ok") }),
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
    "signal.emitted": SignalFrameSchema,
  },
});

export function createRealmBus(options: DefineBusOptions) {
  return defineBus(applicationContract, options);
}
