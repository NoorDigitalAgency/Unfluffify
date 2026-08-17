import { z } from "zod";

type SignalJsonValue = string | number | boolean | null | SignalJsonValue[] | { [key: string]: SignalJsonValue };

export const BrainSignalNameSchema = z.enum([
  "marking.enabled",
  "marking.disabled",
  "markings.changed",
  "run.started",
  "run.completed",
  "run.failed",
  "preview.opened",
  "preview.exit.requested",
  "preview.exited",
  "session.saved",
  "session.discarded",
  "session.navigated",
  "inspection.started",
  "inspection.ended",
  "reconciliation.started",
  "reconciliation.ended",
  "lock.blocked",
  "lock.acquired",
]);

export const BrainSignalSourceSchema = z.enum(["brain", "content", "popup"]);

export const SignalPayloadValueSchema: z.ZodType<SignalJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(SignalPayloadValueSchema),
  z.record(z.string(), SignalPayloadValueSchema),
]));

export const BrainSignalSchema = z.object({
  kind: z.literal("uf-signal/1"),
  tabId: z.number().int().nonnegative(),
  seq: z.number().int().positive(),
  name: BrainSignalNameSchema,
  source: BrainSignalSourceSchema,
  cause: z.string().min(1),
  at: z.number().int().nonnegative(),
  payload: z.record(z.string(), SignalPayloadValueSchema),
});

export type BrainSignalName = z.infer<typeof BrainSignalNameSchema>;
export type BrainSignalSource = z.infer<typeof BrainSignalSourceSchema>;
export type BrainSignal = z.infer<typeof BrainSignalSchema>;
