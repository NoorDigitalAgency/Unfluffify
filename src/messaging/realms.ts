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
  },
  events: {
    "fact.reported": FactEnvelopeSchema,
    "signal.emitted": SignalFrameSchema,
  },
});

export function createRealmBus(options: DefineBusOptions) {
  return defineBus(applicationContract, options);
}
