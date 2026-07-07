import { z } from "zod";

import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../constants";
import { MarkRowSchema } from "./marking";
import { BaseUrlSchema, RenderModeSchema } from "./property";

export const AiRunPayloadPageSchema = z.object({
  url: z.string().url(),
  renderedHtml: z.string(),
  rawHtml: z.string().optional(),
  renderedXPaths: z.array(MarkRowSchema),
});

export const AiRunPayloadSnapshotSchema = z
  .object({
    baseUrl: BaseUrlSchema,
    renderMode: RenderModeSchema,
    defaultExclusionSelectors: z.array(z.enum(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS)),
    pages: z.array(AiRunPayloadPageSchema).min(1),
  })
  .superRefine((snapshot, ctx) => {
    if (
      snapshot.defaultExclusionSelectors.length !== DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.length ||
      snapshot.defaultExclusionSelectors.some(
        (selector, index) => selector !== DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS[index],
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "defaultExclusionSelectors must exactly match the immutable tag contract",
        path: ["defaultExclusionSelectors"],
      });
    }
    snapshot.pages.forEach((page, index) => {
      if (snapshot.renderMode === "rendered" && page.rawHtml !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "rawHtml is only allowed for static render mode",
          path: ["pages", index, "rawHtml"],
        });
      }
      if (snapshot.renderMode === "static" && page.rawHtml === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "rawHtml is required for static render mode",
          path: ["pages", index, "rawHtml"],
        });
      }
    });
  });

export type AiRunPayloadPage = z.infer<typeof AiRunPayloadPageSchema>;
export type AiRunPayloadSnapshot = z.infer<typeof AiRunPayloadSnapshotSchema>;
