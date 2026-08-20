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
      rawHtml: input.rawHtml === undefined ? undefined : stripUncapturableHtml(input.rawHtml),
      renderedXPaths: input.evaluation.rows,
    }],
  });
}

export function stripUncapturableHtml(html: string): string {
  let output = html;
  const artifactOpenPatterns = [
    /<(browser-mcp-container)\b[^>]*>/i,
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sdata-uf-extension-ui=(?:"true"|'true'))[^>]*>/i,
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sdata-wxt-shadow-root(?:\s|=|>))[^>]*>/i,
    /<([a-zA-Z][\w:-]*)(?=[^>]*\sid=(?:"(?:browser-mcp-container|unfluffify-[^"]*)"|'(?:browser-mcp-container|unfluffify-[^']*)'))[^>]*>/i,
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
    (openTag, tagName: string, attributes: string) => {
      const consentHidden = /\sdata-uf-consent-hidden(?:=(?:"true"|'true'|true))?/i.test(attributes);
      let sanitized = attributes;
      if (consentHidden) {
        sanitized = sanitized.replace(/\sstyle=("([^"]*)"|'([^']*)')/i, (_style, quoted: string, double: string, single: string) => {
          const quote = quoted[0];
          const value = (double ?? single ?? "")
            .replace(/(?:^|;)\s*(?:opacity\s*:\s*0|visibility\s*:\s*hidden|pointer-events\s*:\s*none)\s*!important\s*;?/gi, "")
            .trim();
          return value ? ` style=${quote}${value}${quote}` : "";
        });
      }
      sanitized = sanitized.replace(/\sdata-uf-[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "");
      return `<${tagName}${sanitized}>`;
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
