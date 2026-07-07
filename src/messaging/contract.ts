import { z } from "zod";

export const BUS_FRAME_KIND = "uf-bus/1" as const;

export const BusFrameTypeSchema = z.enum(["request", "reply", "event"]);
export const BusRealmSchema = z.enum(["background", "content", "popup", "page"]);
export const BusFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const BusFrameSchema = z.object({
  kind: z.literal(BUS_FRAME_KIND),
  frameType: BusFrameTypeSchema,
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  name: z.string().min(1),
  source: BusRealmSchema,
  sourceInstance: z.string().min(1).optional(),
  target: z.union([BusRealmSchema, z.literal("broadcast")]),
  payload: z.unknown(),
  ok: z.boolean().optional(),
  failure: BusFailureSchema.optional(),
});

export const PageCommandNameSchema = z.enum([
  "ARM",
  "SET_MOTION_PAUSED",
  "SET_LAZY_LOADING_SUPPRESSED",
  "DESTROY",
]);

export type BusRealm = z.infer<typeof BusRealmSchema>;
export type BusFrameType = z.infer<typeof BusFrameTypeSchema>;
export type BusFailure = z.infer<typeof BusFailureSchema>;
export type BusFrame = z.infer<typeof BusFrameSchema>;
export type PageCommandName = z.infer<typeof PageCommandNameSchema>;

export type CommandSchema = Readonly<{
  request: z.ZodType;
  response: z.ZodType;
}>;

export type EventSchema = z.ZodType;

export type BusContractDefinition = Readonly<{
  commands: Readonly<Record<string, CommandSchema>>;
  events: Readonly<Record<string, EventSchema>>;
}>;

export type InferCommandRequest<
  Contract extends BusContractDefinition,
  Name extends keyof Contract["commands"],
> = z.infer<Contract["commands"][Name]["request"]>;

export type InferCommandResponse<
  Contract extends BusContractDefinition,
  Name extends keyof Contract["commands"],
> = z.infer<Contract["commands"][Name]["response"]>;

export type InferEventPayload<
  Contract extends BusContractDefinition,
  Name extends keyof Contract["events"],
> = z.infer<Contract["events"][Name]>;

export function defineContract<const Contract extends BusContractDefinition>(
  contract: Contract,
): Contract {
  return contract;
}
