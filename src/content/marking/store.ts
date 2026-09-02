import { evaluate, evaluateBranch, type DomView, type EvaluationNode, type EvaluationResult } from "../../domain/evaluate";
import type { CanonicalMarkSet, MarkMode, MarkRow } from "../../domain/schema/marking";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import { isXPathInSubtree } from "../../domain/xpath";

/** Stable semantic identity for the operator's canonical decisions. Evaluation
 * rows are deliberately excluded: defaults and live DOM growth may change them
 * without an edit. `explicit: false` is normalized to the same meaning as an
 * omitted flag, and row order is irrelevant. */
export function canonicalMarkingFingerprint(markSet: CanonicalMarkSet): string {
  return markSet.rows
    .map((row) => `${row.xpath}\u0000${row.excluded ? "1" : "0"}\u0000${row.explicit === true ? "1" : "0"}`)
    .sort()
    .join("\u0001");
}

export function applyToggle(
  markSet: CanonicalMarkSet,
  xpath: string,
  mode: Exclude<MarkMode, "disabled" | "passthrough">,
  options: Readonly<{ unexcludeAncestorXpaths?: ReadonlySet<string> }> = {},
): CanonicalMarkSet {
  const existing = markSet.rows.find((row) => row.xpath === xpath);
  if (existing && !existing.excluded && existing.explicit === true) {
    return {
      // Clearing an explicit inclusion removes that decision only. Default rows
      // below it remain ordinary mutable state, and an expanded exclusion above
      // it remains the owner of the branch.
      rows: markSet.rows.filter((row) => row.xpath !== xpath),
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
    !(mode === "exclude" && row.excluded && isXPathInSubtree(xpath, row.xpath)) &&
    // Alt inclusion is an individual decision. Moving an explicit inclusion
    // from a parent to a painted descendant removes the ancestor in the same
    // canonical mutation; inherited implicit/default coverage is untouched.
    !(mode === "include" && !row.excluded && row.explicit === true && isXPathInSubtree(xpath, row.xpath))
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

export function collectDefaultExclusionRows(node: EvaluationNode, rows: MarkRow[] = []): MarkRow[] {
  if (
    isToggleableDefaultTag(node.tagName) &&
    node.visible &&
    !node.chrome &&
    !node.immutable &&
    !node.closedShadow
  ) {
    rows.push({ xpath: node.xpath, excluded: true });
  }
  for (const child of node.children ?? []) {
    collectDefaultExclusionRows(child, rows);
  }
  return rows;
}

export function mergeDefaultExclusions(
  root: EvaluationNode,
  markSet: CanonicalMarkSet = { rows: [] },
): CanonicalMarkSet {
  const rows = [...markSet.rows];
  const existing = new Set(rows.map((row) => row.xpath));
  for (const row of collectDefaultExclusionRows(root)) {
    if (!existing.has(row.xpath)) {
      rows.push(row);
      existing.add(row.xpath);
    }
  }
  return { rows };
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
      let outermostExplicitIncludedAncestorRow: MarkRow | null = null;
      if (mode === "exclude") {
        for (const row of marks.rows) {
          if (!row.excluded || row.xpath === branchRoot.xpath || !isXPathInSubtree(branchRoot.xpath, row.xpath)) {
            continue;
          }
          if (!outermostExcludedAncestorRow || row.xpath.length < outermostExcludedAncestorRow.xpath.length) {
            outermostExcludedAncestorRow = row;
          }
        }
      } else {
        for (const row of marks.rows) {
          if (
            row.excluded ||
            row.explicit !== true ||
            row.xpath === branchRoot.xpath ||
            !isXPathInSubtree(branchRoot.xpath, row.xpath)
          ) {
            continue;
          }
          if (
            !outermostExplicitIncludedAncestorRow ||
            row.xpath.length < outermostExplicitIncludedAncestorRow.xpath.length
          ) {
            outermostExplicitIncludedAncestorRow = row;
          }
        }
      }
      const outermostExcludedAncestor = outermostExcludedAncestorRow
        ? nodeByXpath.get(outermostExcludedAncestorRow.xpath) ?? null
        : null;
      const outermostExplicitIncludedAncestor = outermostExplicitIncludedAncestorRow
        ? nodeByXpath.get(outermostExplicitIncludedAncestorRow.xpath) ?? null
        : null;
      const existing = marks.rows.find((row) => row.xpath === branchRoot.xpath);
      // Alt transfer removes every explicit-inclusion owner above the clicked
      // descendant. Re-evaluate and repaint from the shallowest removed owner,
      // while branchRoot remains the exact new canonical decision target.
      let evaluationRoot =
        outermostExcludedAncestor ??
        outermostExplicitIncludedAncestor ??
        branchRoot;
      if (existing && !existing.excluded && existing.explicit === true) {
        // Explicit inclusion is the one exception inside an expanded
        // exclusion: remove only that inclusion and preserve its ancestor.
        marks = applyToggle(marks, branchRoot.xpath, mode);
        if (!outermostExcludedAncestor) {
          marks = mergeDefaultExclusions(branchRoot, marks);
        }
      } else if (mode === "exclude" && outermostExcludedAncestor) {
        // Clicking an ordinary descendant dissolves the complete expanded
        // boundary occurrence. Every decision below it is discarded, defaults
        // are recalculated without selector provenance, and the clicked target
        // becomes the one new explicit exclusion.
        marks = {
          rows: marks.rows.filter((row) => !isXPathInSubtree(row.xpath, outermostExcludedAncestor.xpath)),
        };
        if (isToggleableDefaultTag(outermostExcludedAncestor.tagName)) {
          marks = {
            rows: [...marks.rows, { xpath: outermostExcludedAncestor.xpath, excluded: false }],
          };
        }
        marks = mergeDefaultExclusions(outermostExcludedAncestor, marks);
        marks = {
          rows: [
            ...marks.rows.filter((row) => row.xpath !== branchRoot.xpath),
            { xpath: branchRoot.xpath, excluded: true, explicit: true },
          ],
        };
      } else if (mode === "exclude" && existing?.excluded) {
        // Clicking an exclusion boundary itself toggles that exact boundary to
        // implicit inclusion and rehydrates all descendants from defaults.
        marks = {
          rows: marks.rows.filter((row) => !isXPathInSubtree(row.xpath, branchRoot.xpath)),
        };
        marks = {
          rows: [...marks.rows, { xpath: branchRoot.xpath, excluded: false }],
        };
        marks = mergeDefaultExclusions(branchRoot, marks);
        evaluationRoot = branchRoot;
      } else {
        marks = applyToggle(marks, branchRoot.xpath, mode);
      }
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
