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

function assertBranchSpliceInvariant(
  previous: EvaluationResult,
  next: EvaluationResult,
  branchRootXpath: string,
): void {
  const previousOutside = new Map([...previous.overlay]
    .filter(([xpath]) => !isXPathInSubtree(xpath, branchRootXpath)));
  const nextOutside = new Map([...next.overlay]
    .filter(([xpath]) => !isXPathInSubtree(xpath, branchRootXpath)));
  if (
    previousOutside.size !== nextOutside.size ||
    [...previousOutside].some(([xpath, classification]) => nextOutside.get(xpath) !== classification)
  ) {
    throw new Error(`Branch evaluation changed overlay state outside ${branchRootXpath}`);
  }
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
    toggle(
      branchRoot: EvaluationNode,
      mode: Exclude<MarkMode, "disabled" | "passthrough">,
    ): EvaluationResult & Readonly<{ branchRoot: EvaluationNode }> {
      const excludedAncestorRows = mode === "exclude"
        ? marks.rows
          .filter((row) => row.excluded && row.xpath !== branchRoot.xpath && isXPathInSubtree(branchRoot.xpath, row.xpath))
          .sort((left, right) => left.xpath.length - right.xpath.length)
        : [];
      const outermostExcludedAncestor = excludedAncestorRows[0]
        ? findNodeByXpath(domView.root, excludedAncestorRows[0].xpath)
        : null;
      const evaluationRoot = outermostExcludedAncestor ?? branchRoot;
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
      const inheritedAncestorMark = nearestAncestorMark(marks, evaluationRoot.xpath);
      const inheritedExcludedAncestor = nearestExcludedAncestorMark(marks, evaluationRoot.xpath);
      const nextResult = evaluateBranch(result, {
        root: evaluationRoot,
        canonicalMarks: marks,
        inheritedAncestorMark,
        inheritedSubmittedExcludedAncestor: inheritedExcludedAncestor?.xpath,
      });
      assertBranchSpliceInvariant(result, nextResult, evaluationRoot.xpath);
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
      assertBranchSpliceInvariant(result, nextResult, branchRoot.xpath);
      result = nextResult;
      return { ...result, branchRoot };
    },
    rows(): readonly MarkRow[] {
      return result.rows;
    },
  };
}
