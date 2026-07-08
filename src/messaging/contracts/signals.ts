import { BrainSignalSchema } from "../../domain/schema/signals";
import type { z } from "zod";

export const SignalFrameSchema = BrainSignalSchema;
export type SignalFrame = z.infer<typeof SignalFrameSchema>;
