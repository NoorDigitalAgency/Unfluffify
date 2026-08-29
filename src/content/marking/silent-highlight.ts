import type { VisibilityGeometry } from "../../domain/visibility";
import { isUserVisible } from "../../domain/visibility";
import type { EvaluationResult } from "../../domain/evaluate";

function xpathDepth(xpath: string): number {
  return xpath.split("/").length;
}

export function hasXpathAncestor(xpath: string, ancestors: ReadonlySet<string>): boolean {
  let cursor = xpath;
  while (cursor.lastIndexOf("/") > 0) {
    cursor = cursor.slice(0, cursor.lastIndexOf("/"));
    if (ancestors.has(cursor)) {
      return true;
    }
  }
  return false;
}

export function shallowXpathBoundaries(xpaths: Iterable<string>): readonly string[] {
  const selected = new Set<string>();
  for (const xpath of [...new Set(xpaths)].sort((left, right) => xpathDepth(left) - xpathDepth(right))) {
    if (!hasXpathAncestor(xpath, selected)) {
      selected.add(xpath);
    }
  }
  return [...selected];
}

export function buildSilentHighlights(
  evaluation: EvaluationResult,
  geometryByXpath: Pick<ReadonlyMap<string, VisibilityGeometry>, "get">,
): readonly string[] {
  const retained = new Set<string>();
  const xpaths: string[] = [];
  for (const row of [...evaluation.rows].sort((left, right) => xpathDepth(left.xpath) - xpathDepth(right.xpath))) {
    if (row.excluded) {
      continue;
    }
    // Silent paint is a shallow physical projection. Explicit includes retain
    // their own occurrence, while ordinary descendants underneath an already
    // included boundary would only create dense duplicate rectangles. Prune
    // those descendants before resolving layout geometry: large pages commonly
    // contain thousands of included descendants beneath a few retained owners,
    // and reading every rectangle forces a synchronous layout-shaped long task.
    if (row.explicit !== true && hasXpathAncestor(row.xpath, retained)) {
      continue;
    }
    if (row.explicit !== true) {
      const geometry = geometryByXpath.get(row.xpath);
      if (geometry && !isUserVisible(row.xpath, geometry)) {
        continue;
      }
    }
    if (!retained.has(row.xpath)) {
      retained.add(row.xpath);
      xpaths.push(row.xpath);
    }
  }
  return xpaths;
}
