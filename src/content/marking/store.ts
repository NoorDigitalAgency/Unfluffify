import { evaluate, evaluateBranch, type DomView, type EvaluationNode, type EvaluationResult } from "../../domain/evaluate";
import type { CanonicalMarkSet, MarkMode, MarkRow } from "../../domain/schema/marking";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import { isXPathInSubtree } from "../../domain/xpath";

export function applyToggle(
  markSet: CanonicalMarkSet,
  xpath: string,
  mode: Exclude<MarkMode, "disabled" | "passthrough">,
  options: Readonly<{ unexcludeAncestorXpaths?: ReadonlySet<string> }> = {},
): CanonicalMarkSet {
  const existing = markSet.rows.find((row) => row.xpath === xpath);
  if (existing && !existing.excluded && existing.explicit === true) {
    return {
      rows: markSet.rows.filter((row) => row.xpath !== xpath && !isXPathInSubtree(row.xpath, xpath)),
    };
  }
  if (mode === "exclude" && existing?.excluded) {
    const rows = markSet.rows.filter((row) => row.xpath !== xpath && !isXPathInSubtree(row.xpath, xpath));
    rows.push({ xpath, excluded: false });
    return { rows };
  }
  const rows = markSet.rows.filter((row) =>
    row.xpath !== xpath &&
    !isXPathInSubtree(row.xpath, xpath) &&
    !(mode === "exclude" && row.excluded && isXPathInSubtree(xpath, row.xpath))
  );
  for (const ancestorXpath of options.unexcludeAncestorXpaths ?? []) {
    rows.push({ xpath: ancestorXpath, excluded: false });
  }
  rows.push(mode === "include" ? { xpath, excluded: false, explicit: true } : { xpath, excluded: true, explicit: true });
  return { rows };
}

function findNodeByXpath(node: EvaluationNode, xpath: string): EvaluationNode | null {
  if (node.xpath === xpath) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNodeByXpath(child, xpath);
    if (found) {
      return found;
    }
  }
  return null;
}

function nearestAncestorMark(markSet: CanonicalMarkSet, xpath: string): MarkRow | undefined {
  return markSet.rows
    .filter((row) =>
      row.xpath !== xpath &&
      isXPathInSubtree(xpath, row.xpath) &&
      (row.excluded || row.explicit === true)
    )
    .sort((left, right) => right.xpath.length - left.xpath.length)[0];
}

function nearestExcludedAncestorMark(markSet: CanonicalMarkSet, xpath: string): MarkRow | undefined {
  return markSet.rows
    .filter((row) => row.excluded && row.xpath !== xpath && isXPathInSubtree(xpath, row.xpath))
    .sort((left, right) => right.xpath.length - left.xpath.length)[0];
}

export function createMarkingStore(domView: DomView, initialMarks: CanonicalMarkSet = { rows: [] }) {
  let marks = initialMarks;
  let result = evaluate(marks, domView);
  return {
    canonicalSet(): CanonicalMarkSet {
      return { rows: [...marks.rows] };
    },
    currentEvaluation(): EvaluationResult {
      return result;
    },
    toggle(branchRoot: EvaluationNode, mode: Exclude<MarkMode, "disabled" | "passthrough">): EvaluationResult {
      const removesExcludedAncestor = mode === "exclude" && marks.rows.some((row) =>
        row.excluded && row.xpath !== branchRoot.xpath && isXPathInSubtree(branchRoot.xpath, row.xpath)
      );
      const unexcludeAncestorXpaths = mode === "exclude"
        ? new Set(
          marks.rows
            .filter((row) => row.excluded && row.explicit !== true && row.xpath !== branchRoot.xpath && isXPathInSubtree(branchRoot.xpath, row.xpath))
            .filter((row) => {
              const ancestor = findNodeByXpath(domView.root, row.xpath);
              return ancestor ? isToggleableDefaultTag(ancestor.tagName) : false;
            })
            .map((row) => row.xpath),
        )
        : new Set<string>();
      marks = applyToggle(marks, branchRoot.xpath, mode, { unexcludeAncestorXpaths });
      if (removesExcludedAncestor) {
        result = evaluate(marks, domView);
        return result;
      }
      const inheritedAncestorMark = nearestAncestorMark(marks, branchRoot.xpath);
      const inheritedExcludedAncestor = nearestExcludedAncestorMark(marks, branchRoot.xpath);
      result = evaluateBranch(result, {
        root: branchRoot,
        canonicalMarks: marks,
        inheritedAncestorMark,
        inheritedSubmittedExcludedAncestor: inheritedExcludedAncestor?.xpath,
      });
      return result;
    },
    rows(): readonly MarkRow[] {
      return result.rows;
    },
  };
}
