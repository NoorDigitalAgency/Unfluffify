import { defineContract } from "./contract";
import { CommandEnvelopeSchema, CommandReplySchema, FactEnvelopeSchema, SignalFrameSchema } from "./contracts";
import { defineBus, type DefineBusOptions } from "./bus";
import { z } from "zod";

export const applicationContract = defineContract({
  commands: {
    "command.dispatch": {
      request: CommandEnvelopeSchema,
      response: CommandReplySchema,
    },
    "signals.pull": {
      request: z.object({
        tabId: z.number().int().nonnegative(),
        afterSeq: z.number().int().nonnegative(),
        organId: z.string().min(1).optional(),
      }),
      response: SignalFrameSchema.array(),
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
