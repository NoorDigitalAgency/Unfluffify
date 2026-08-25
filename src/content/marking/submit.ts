import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../domain/constants";
import { AiRunPayloadSnapshotSchema, type AiRunPayloadSnapshot } from "../../domain/schema/submission";
import type { RenderMode } from "../../domain/schema/property";
import type { EvaluationResult } from "../../domain/evaluate";
import { CONSENT_HIDDEN_ATTR } from "../consent";
import { sanitizeCaptureClassValue } from "./capture-hygiene";

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
      rawHtml: input.rawHtml === undefined ? undefined : stripUncapturableHtml(input.rawHtml),
      renderedXPaths: input.evaluation.rows,
    }],
  });
}

export function stripUncapturableHtml(html: string): string {
  let output = html;
  const artifactOpenPatterns = [
    /<(browser-mcp-container)\b[^>]*>/i,
    new RegExp(
      `<([a-zA-Z][\\w:-]*)(?=[^>]*\\s${CONSENT_HIDDEN_ATTR}(?:\\s|=|>))[^>]*>`,
      "i",
    ),
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sdata-uf-extension-ui=(?:"true"|'true'))[^>]*>/i,
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sdata-wxt-shadow-root(?:\s|=|>))[^>]*>/i,
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sid=(?:"(?:browser-mcp-container|uf-consent-bypass|unfluffify-[^"]*)"|'(?:browser-mcp-container|uf-consent-bypass|unfluffify-[^']*)'))[^>]*>/i,
  ];
  for (const openPattern of artifactOpenPatterns) {
    let match = openPattern.exec(output);
    while (match) {
      const [openTag, tagName] = match;
      const start = match.index;
      const end = findMatchingClose(output, tagName, start + openTag.length);
      output = output.slice(0, start) + output.slice(end);
      match = openPattern.exec(output);
    }
  }
  return output.replace(
    /<([a-zA-Z][\w:-]*)([^>]*)>/g,
    (_openTag, tagName: string, attributes: string) => {
      const sanitizedAttributes = attributes
        .replace(/\sdata-uf-[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
        .replace(
          /\sclass=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
          (_classAttribute, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
            const value = sanitizeCaptureClassValue(
              doubleQuoted ?? singleQuoted ?? unquoted ?? "",
              tagName,
            );
            if (!value) {
              return "";
            }
            const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
            return ` class=${quote}${value}${quote}`;
          },
        );
      return `<${tagName}${sanitizedAttributes}>`;
    },
  );
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
