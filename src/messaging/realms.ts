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
import { ConfigSnapshotSchema, SelectorSetSchema } from "../storage/config";

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
  },
  events: {
    "fact.reported": FactEnvelopeSchema,
    "signal.emitted": SignalFrameSchema,
  },
});

export function createRealmBus(options: DefineBusOptions) {
  return defineBus(applicationContract, options);
}
