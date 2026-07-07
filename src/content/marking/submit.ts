import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../domain/constants";
import { AiRunPayloadSnapshotSchema, type AiRunPayloadSnapshot } from "../../domain/schema/submission";
import type { RenderMode } from "../../domain/schema/property";
import type { EvaluationResult } from "../../domain/evaluate";

export function buildSubmissionSnapshot(input: Readonly<{
  baseUrl: string;
  renderMode: RenderMode;
  pageUrl: string;
  renderedHtml: string;
  rawHtml?: string;
  evaluation: EvaluationResult;
}>): AiRunPayloadSnapshot {
  return AiRunPayloadSnapshotSchema.parse({
    baseUrl: input.baseUrl,
    renderMode: input.renderMode,
    defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
    pages: [{
      url: input.pageUrl,
      renderedHtml: input.renderedHtml,
      rawHtml: input.rawHtml,
      renderedXPaths: input.evaluation.rows,
    }],
  });
}
