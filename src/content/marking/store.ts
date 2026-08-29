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
    const rows = markSet.rows.filter((row) =>
      row.xpath !== xpath &&
      !(isXPathInSubtree(row.xpath, xpath) && !row.excluded && row.explicit === true)
    );
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

export function applyClear(markSet: CanonicalMarkSet, xpath: string): CanonicalMarkSet {
  return {
    rows: markSet.rows.filter((row) => row.xpath !== xpath),
  };
}

function indexNodesByXpath(root: EvaluationNode): ReadonlyMap<string, EvaluationNode> {
  const result = new Map<string, EvaluationNode>();
  const visit = (node: EvaluationNode): void => {
    result.set(node.xpath, node);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return result;
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
  const nodeByXpath = indexNodesByXpath(domView.root);
  let marks = initialMarks;
  let result = evaluate(marks, domView);
  return {
    canonicalSet(): CanonicalMarkSet {
      return { rows: [...marks.rows] };
    },
    currentEvaluation(): EvaluationResult {
      return result;
    },
    toggle(
      branchRoot: EvaluationNode,
      mode: Exclude<MarkMode, "disabled" | "passthrough">,
    ): EvaluationResult & Readonly<{ branchRoot: EvaluationNode }> {
      let outermostExcludedAncestorRow: MarkRow | null = null;
      const unexcludeAncestorXpaths = new Set<string>();
      if (mode === "exclude") {
        for (const row of marks.rows) {
          if (!row.excluded || row.xpath === branchRoot.xpath || !isXPathInSubtree(branchRoot.xpath, row.xpath)) {
            continue;
          }
          if (!outermostExcludedAncestorRow || row.xpath.length < outermostExcludedAncestorRow.xpath.length) {
            outermostExcludedAncestorRow = row;
          }
          if (row.explicit !== true) {
            const ancestor = nodeByXpath.get(row.xpath);
            if (ancestor && isToggleableDefaultTag(ancestor.tagName)) {
              unexcludeAncestorXpaths.add(row.xpath);
            }
          }
        }
      }
      const outermostExcludedAncestor = outermostExcludedAncestorRow
        ? nodeByXpath.get(outermostExcludedAncestorRow.xpath) ?? null
        : null;
      const evaluationRoot = outermostExcludedAncestor ?? branchRoot;
      marks = applyToggle(marks, branchRoot.xpath, mode, { unexcludeAncestorXpaths });
      const inheritedAncestorMark = nearestAncestorMark(marks, evaluationRoot.xpath);
      const inheritedExcludedAncestor = nearestExcludedAncestorMark(marks, evaluationRoot.xpath);
      const nextResult = evaluateBranch(result, {
        root: evaluationRoot,
        canonicalMarks: marks,
        inheritedAncestorMark,
        inheritedSubmittedExcludedAncestor: inheritedExcludedAncestor?.xpath,
      });
      result = nextResult;
      return { ...result, branchRoot: evaluationRoot };
    },
    clear(branchRoot: EvaluationNode): (EvaluationResult & Readonly<{ branchRoot: EvaluationNode }>) | null {
      const existing = marks.rows.find((row) => row.xpath === branchRoot.xpath && row.explicit === true);
      if (!existing) {
        return null;
      }
      marks = applyClear(marks, branchRoot.xpath);
      const inheritedAncestorMark = nearestAncestorMark(marks, branchRoot.xpath);
      const inheritedExcludedAncestor = nearestExcludedAncestorMark(marks, branchRoot.xpath);
      const nextResult = evaluateBranch(result, {
        root: branchRoot,
        canonicalMarks: marks,
        inheritedAncestorMark,
        inheritedSubmittedExcludedAncestor: inheritedExcludedAncestor?.xpath,
      });
      result = nextResult;
      return { ...result, branchRoot };
    },
    rows(): readonly MarkRow[] {
      return result.rows;
    },
  };
}
