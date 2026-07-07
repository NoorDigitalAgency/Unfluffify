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
  const renderedHtml = stripUncapturableHtml(input.renderedHtml);
  return AiRunPayloadSnapshotSchema.parse({
    baseUrl: input.baseUrl,
    renderMode: input.renderMode,
    defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
    pages: [{
      url: input.pageUrl,
      renderedHtml,
      rawHtml: input.rawHtml,
      renderedXPaths: input.evaluation.rows,
    }],
  });
}

export function stripUncapturableHtml(html: string): string {
  let output = html;
  const openPattern = /<([a-zA-Z][\w:-]*)(?=[^>]*\sdata-uf-closed-shadow-host=(?:"true"|'true'))[^>]*>/i;
  let match = openPattern.exec(output);
  while (match) {
    const [openTag, tagName] = match;
    const start = match.index;
    const end = findMatchingClose(output, tagName, start + openTag.length);
    output = output.slice(0, start) + output.slice(end);
    match = openPattern.exec(output);
  }
  return output;
}

function findMatchingClose(html: string, tagName: string, startIndex: number): number {
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 1;
  let match = tagPattern.exec(html);
  while (match) {
    const token = match[0];
    if (token.startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return match.index + token.length;
      }
    } else if (!token.endsWith("/>")) {
      depth += 1;
    }
    match = tagPattern.exec(html);
  }
  return startIndex;
}
