import { z } from "zod";

export const CommandFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const CommandReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), failure: CommandFailureSchema }),
]);

export const CommandEnvelopeSchema = z.object({
  kind: z.literal("uf-command/1"),
  name: z.string().min(1),
  tabId: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandReply = z.infer<typeof CommandReplySchema>;
