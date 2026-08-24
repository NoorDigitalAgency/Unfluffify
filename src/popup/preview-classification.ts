import type {
  PreviewClassification,
  PreviewRow,
  PreviewShadowProvenance,
} from "../domain/schema/preview";
import { popupDebugBuildEnabled } from "./build-mode";

export type PreviewDisplayClassification = "included" | "excluded";

export type PreviewDebugDetail = Readonly<{
  classification: PreviewClassification;
  xpath: string;
  selector?: string;
  shadow: PreviewShadowProvenance;
}>;

/** The only row fields the production view is allowed to consume. Raw selector,
 * XPath, evaluator classification and shadow provenance stay behind the literal
 * debug build branch. */
export type PreviewDisplayRow = Readonly<{
  id: string;
  text: string;
  classification: PreviewDisplayClassification;
  debugDetail: PreviewDebugDetail | null;
}>;

export function previewDebugDetailEnabled(): boolean {
  return popupDebugBuildEnabled();
}

export function projectPreviewClassification(
  classification: PreviewClassification,
): PreviewDisplayClassification {
  return classification === "excluded"
    || classification === "immutable"
    || classification === "closed-shadow"
    ? "excluded"
    : "included";
}

const TECHNICAL_SOURCE_LABELS: Readonly<Record<string, string>> = {
  script: "Script or embedded code",
  style: "Style rules",
  noscript: "No-script fallback content",
};

function productionPreviewText(row: PreviewRow): string {
  const lastElement = Array.from(row.xpath.matchAll(/\/([a-zA-Z][\w:-]*)\[\d+\]/g)).at(-1);
  const tagName = lastElement?.[1]?.toLowerCase();
  return tagName === undefined ? row.text : TECHNICAL_SOURCE_LABELS[tagName] ?? row.text;
}

/** Pure production/debug seam used by both rendering and parity tests. */
export function projectPreviewRow(
  row: PreviewRow,
  debug = previewDebugDetailEnabled(),
): PreviewDisplayRow {
  return {
    id: row.id,
    text: debug ? row.text : productionPreviewText(row),
    classification: projectPreviewClassification(row.classification),
    debugDetail: debug
      ? {
        classification: row.classification,
        xpath: row.xpath,
        ...(row.selector === undefined ? {} : { selector: row.selector }),
        shadow: row.shadow,
      }
      : null,
  };
}
