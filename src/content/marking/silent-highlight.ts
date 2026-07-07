import type { VisibilityGeometry } from "../../domain/visibility";
import { isUserVisible } from "../../domain/visibility";
import type { EvaluationResult } from "../../domain/evaluate";

export function buildSilentHighlights(
  evaluation: EvaluationResult,
  geometryByXpath: ReadonlyMap<string, VisibilityGeometry>,
): readonly string[] {
  return evaluation.rows
    .filter((row) => !row.excluded)
    .filter((row) => {
      if (row.explicit === true) {
        return true;
      }
      const geometry = geometryByXpath.get(row.xpath);
      return geometry ? isUserVisible(row.xpath, geometry) : true;
    })
    .map((row) => row.xpath);
}
