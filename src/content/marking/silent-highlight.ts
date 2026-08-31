import type { VisibilityGeometry } from "../../domain/visibility";
import { isUserVisible } from "../../domain/visibility";
import type { EvaluationResult } from "../../domain/evaluate";

function xpathDepth(xpath: string): number {
  return xpath.split("/").length;
}

export function hasXpathAncestor(xpath: string, ancestors: ReadonlySet<string>): boolean {
  let cursor = xpath;
  let parentEnd = cursor.lastIndexOf("/");
  while (parentEnd > 0) {
    cursor = cursor.slice(0, parentEnd);
    if (ancestors.has(cursor)) {
      return true;
    }
    parentEnd = cursor.lastIndexOf("/");
  }
  return false;
}

function shallowFirst<T>(values: readonly T[], xpathFor: (value: T) => string): T[] {
  // xpathDepth parses the complete path. Calling it from Array.sort's
  // comparator repeats that work O(N log N) times on large storefronts and can
  // turn a sliced silent refresh back into a main-thread long task.
  return values
    .map((value, index) => ({ value, index, depth: xpathDepth(xpathFor(value)) }))
    .sort((left, right) => left.depth - right.depth || left.index - right.index)
    .map(({ value }) => value);
}

export function shallowXpathBoundaries(xpaths: Iterable<string>): readonly string[] {
  const selected = new Set<string>();
  for (const xpath of shallowFirst([...new Set(xpaths)], (value) => value)) {
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
  for (const row of shallowFirst(evaluation.rows, (value) => value.xpath)) {
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
    const geometry = geometryByXpath.get(row.xpath);
    if (geometry && !isUserVisible(row.xpath, geometry)) {
      continue;
    }
    if (!retained.has(row.xpath)) {
      retained.add(row.xpath);
      xpaths.push(row.xpath);
    }
  }
  return xpaths;
}
