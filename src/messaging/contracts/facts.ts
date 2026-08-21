import { z } from "zod";

import { BrainSensationSchema } from "../../domain/schema/facts";

export const FactEnvelopeSchema = z.object({
  kind: z.literal("uf-fact/1"),
  sensation: BrainSensationSchema,
});

export type FactEnvelope = z.infer<typeof FactEnvelopeSchema>;
