import { z } from "zod";

export const TodoCandidateSchema = z.object({
  pageKey: z.string().min(1),
  wordsCount: z.number().int().nonnegative().nullable(),
  marked: z.boolean(),
  current: z.boolean(),
});

export const TodoPageTypeSchema = z.object({
  pageType: z.string(),
  markedCount: z.number().int().nonnegative(),
  current: z.boolean(),
  candidates: z.array(TodoCandidateSchema).min(1),
});

export const TodoCoverageSchema = z.object({
  covered: z.number().int().nonnegative(),
  actionable: z.number().int().nonnegative(),
  pageTypes: z.array(TodoPageTypeSchema),
});

export type TodoCoverage = z.infer<typeof TodoCoverageSchema>;
