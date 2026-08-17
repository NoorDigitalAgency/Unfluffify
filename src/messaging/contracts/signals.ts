import { BrainSignalSchema } from "../../domain/schema/signals";
import { z } from "zod";

export const SignalFrameSchema = BrainSignalSchema;
export const SignalPullRequestSchema = z.object({
  tabId: z.number().int().nonnegative(),
  afterSeq: z.number().int().nonnegative(),
  organId: z.string().min(1).optional(),
});
export const SignalConsumeRequestSchema = z.object({
  tabId: z.number().int().nonnegative(),
  organId: z.string().min(1),
  seq: z.number().int().nonnegative(),
});
export type SignalFrame = z.infer<typeof SignalFrameSchema>;
export type SignalPullRequest = z.infer<typeof SignalPullRequestSchema>;
export type SignalConsumeRequest = z.infer<typeof SignalConsumeRequestSchema>;
