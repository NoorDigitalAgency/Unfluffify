import type { PopupContentRow } from "./organ/machine";
import { popupDebugBuildEnabled } from "./build-mode";

export type PreviewDisplayClassification = PopupContentRow["classification"];

export function previewDebugDetailEnabled(): boolean {
  return popupDebugBuildEnabled();
}

/** The evaluator retains all classification detail. Production deliberately
 * presents only the operator-facing included/excluded distinction; debug builds
 * may expose immutable and closed-shadow provenance for diagnosis. */
export function projectPreviewClassification(
  classification: PopupContentRow["classification"],
  debug = previewDebugDetailEnabled(),
): PreviewDisplayClassification {
  if (debug || classification === "included" || classification === "excluded") {
    return classification;
  }
  return "excluded";
}
