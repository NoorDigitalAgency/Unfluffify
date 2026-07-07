import { z } from "zod";

import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
} from "../constants";

const POSITIONAL_XPATH_PATTERN =
  /^\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\](?:\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])*$/;

export const MarkModeSchema = z.enum([
  "disabled",
  "passthrough",
  "include",
  "exclude",
]);

export const ClassificationSchema = z.enum([
  "implicit-include",
  "explicit-include",
  "exception",
  "immutable",
  "closed-shadow",
]);

export const ImmutableTagSchema = z.enum(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS);
export const ToggleableDefaultTagSchema = z.enum(DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS);

export const MarkRowSchema = z.object({
  xpath: z
    .string()
    .regex(POSITIONAL_XPATH_PATTERN, "xpath must be a positional /tag[index] path")
    .refine((xpath) => {
      const normalized = xpath.toLowerCase();
      return normalized !== "/html[1]" && normalized !== "/html[1]/body[1]";
    }, "document roots are never mark rows"),
  excluded: z.boolean(),
  explicit: z.boolean().optional(),
});

export const CanonicalMarkSetSchema = z.object({
  rows: z.array(MarkRowSchema),
});

export type MarkMode = z.infer<typeof MarkModeSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type ImmutableTag = z.infer<typeof ImmutableTagSchema>;
export type ToggleableDefaultTag = z.infer<typeof ToggleableDefaultTagSchema>;
export type MarkRow = z.infer<typeof MarkRowSchema>;
export type CanonicalMarkSet = z.infer<typeof CanonicalMarkSetSchema>;
