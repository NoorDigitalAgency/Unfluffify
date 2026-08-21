import type { CanonicalMarkSet, Classification, MarkRow } from "./schema/marking";
import type {
  PreviewClassification,
  PreviewShadowProvenance,
} from "./schema/preview";
import type { StructuralRole } from "./boundary";
import { isImmutableTag } from "./taxonomy";
import { isToggleableBoundary } from "./boundary";
import { compareXpathsInDocumentOrder, isDocumentRootRowXPath, isXPathInSubtree } from "./xpath";

export type EvaluationNode = Readonly<{
  key: string;
  tagName: string;
  xpath: string;
  children?: readonly EvaluationNode[];
  visible: boolean;
  ownsDirectText?: boolean;
  structuralBoundary?: boolean;
  structuralRole?: StructuralRole;
  pageShell?: boolean;
  landmarkCount?: number;
  chrome?: boolean;
  immutable?: boolean;
  closedShadow?: boolean;
  shadow?: PreviewShadowProvenance;
  silentWhitespaceExclusion?: boolean;
}>;

export type DomView = Readonly<{
  root: EvaluationNode;
}>;

export type EvaluationResult = Readonly<{
  overlay: ReadonlyMap<string, Classification>;
  rows: readonly MarkRow[];
}>;

export type BranchEvaluationInput = Readonly<{
  root: EvaluationNode;
  canonicalMarks: CanonicalMarkSet;
  inheritedAncestorMark?: MarkRow;
  inheritedSubmittedExcludedAncestor?: string;
  inheritedUncapturable?: boolean;
}>;

export type PreviewSelectorMatchContext = Readonly<{
  inclusionSelectorByKey: ReadonlyMap<string, string>;
  exclusionSelectorByKey: ReadonlyMap<string, string>;
}>;

export type PreviewEvaluationRow = Readonly<{
  id: string;
  classification: PreviewClassification;
  xpath: string;
  selector?: string;
}>;

function rowKey(row: MarkRow): string {
  return row.xpath;
}

function createMarkMap(markSet: CanonicalMarkSet): ReadonlyMap<string, MarkRow> {
  return new Map(markSet.rows.map((row) => [rowKey(row), row]));
}

function classifyNode(
  node: EvaluationNode,
  nearestMark: MarkRow | undefined,
  ownMark: MarkRow | undefined,
): Classification | null {
  if (node.closedShadow) {
    return "closed-shadow";
  }
  if (node.immutable || isImmutableTag(node.tagName)) {
    return "immutable";
  }
  if (node.chrome) {
    return null;
  }
  if (node.silentWhitespaceExclusion && !nearestMark) {
    return null;
  }
  if (nearestMark?.excluded) {
    return "exception";
  }
  // A non-explicit include row is an exact-boundary unmark, never a subtree
  // include. Keep a textual leaf visible so it can be re-excluded, but let a
  // container whose text lives in descendants step aside for those descendants.
  if (ownMark && !ownMark.excluded && ownMark.explicit !== true) {
    return node.visible && node.ownsDirectText ? "implicit-include" : null;
  }
  if (nearestMark && !nearestMark.excluded) {
    return nearestMark.explicit ? "explicit-include" : "implicit-include";
  }
  if (isToggleableBoundary(node)) {
    return "implicit-include";
  }
  return null;
}

function shouldSubmitImplicitInclude(node: EvaluationNode): boolean {
  return node.visible && node.ownsDirectText === true && !isDocumentRootRowXPath(node.xpath);
}

function shouldSubmitHiddenTextExclusion(node: EvaluationNode): boolean {
  return !node.visible && node.ownsDirectText === true && !isDocumentRootRowXPath(node.xpath);
}

function makeRow(node: EvaluationNode, excluded: boolean, explicit?: boolean): MarkRow {
  return explicit === undefined
    ? { xpath: node.xpath, excluded }
    : { xpath: node.xpath, excluded, explicit };
}

function walk(
  node: EvaluationNode,
  marks: ReadonlyMap<string, MarkRow>,
  overlay: Map<string, Classification>,
  rows: MarkRow[],
  inheritedNearestMark: MarkRow | undefined,
  submittedExcludedAncestor: string | undefined,
  inheritedUncapturable: boolean,
): void {
  if (inheritedUncapturable) {
    return;
  }
  const ownMark = marks.get(node.xpath);
  const nearestMark = ownMark ?? inheritedNearestMark;
  const classification = classifyNode(node, nearestMark, ownMark);
  if (classification) {
    overlay.set(node.xpath, classification);
  }

  const immutable = classification === "immutable" || classification === "closed-shadow" || node.chrome;
  if (immutable) {
    return;
  }
  let nextSubmittedExcludedAncestor = submittedExcludedAncestor;

  if (!isDocumentRootRowXPath(node.xpath)) {
    if (ownMark?.excluded) {
      if (!submittedExcludedAncestor) {
        rows.push(makeRow(node, true, ownMark.explicit));
        nextSubmittedExcludedAncestor = node.xpath;
      }
    } else if (ownMark && !ownMark.excluded) {
      if (ownMark.explicit) {
        rows.push(makeRow(node, false, true));
      } else if (!submittedExcludedAncestor && shouldSubmitImplicitInclude(node)) {
        rows.push(makeRow(node, false));
      }
    } else if (!submittedExcludedAncestor && node.silentWhitespaceExclusion) {
      rows.push(makeRow(node, true, true));
      nextSubmittedExcludedAncestor = node.xpath;
    } else if (!submittedExcludedAncestor && shouldSubmitImplicitInclude(node)) {
      rows.push(makeRow(node, false));
    } else if (!submittedExcludedAncestor && shouldSubmitHiddenTextExclusion(node)) {
      rows.push(makeRow(node, true));
      nextSubmittedExcludedAncestor = node.xpath;
    }
  }

  const nextNearestMark =
    ownMark && (ownMark.excluded || ownMark.explicit === true) ? ownMark : inheritedNearestMark;

  for (const child of node.children ?? []) {
    walk(child, marks, overlay, rows, nextNearestMark, nextSubmittedExcludedAncestor, false);
  }
}

export function evaluate(canonicalMarks: CanonicalMarkSet, domView: DomView): EvaluationResult {
  const overlay = new Map<string, Classification>();
  const rows: MarkRow[] = [];
  walk(domView.root, createMarkMap(canonicalMarks), overlay, rows, undefined, undefined, false);
  return {
    overlay,
    rows: [...rows].sort((left, right) => compareXpathsInDocumentOrder(left.xpath, right.xpath)),
  };
}

/**
 * Produces the complete selector-preview classification in the canonical domain
 * pass. Submission rows and overlay classes deliberately remain unchanged: they
 * answer marking/capture questions, while these rows answer which selector rule
 * detected a visible markable boundary.
 */
export function evaluatePreview(
  canonicalMarks: CanonicalMarkSet,
  domView: DomView,
  matches: PreviewSelectorMatchContext,
): readonly PreviewEvaluationRow[] {
  const evaluation = evaluate(canonicalMarks, domView);
  const submissionByXpath = new Map(evaluation.rows.map((row) => [row.xpath, row]));
  const rows = new Map<string, PreviewEvaluationRow>();

  type Coverage = Readonly<{ kind: "include" | "exclude"; selector: string }>;
  const visit = (node: EvaluationNode, inheritedCoverage: Coverage | undefined): void => {
    // Inclusion wins an exact selector conflict, matching applySelectorSeed.
    const inclusionSelector = matches.inclusionSelectorByKey.get(node.key);
    const exclusionSelector = matches.exclusionSelectorByKey.get(node.key);
    const ownCoverage: Coverage | undefined = inclusionSelector
      ? { kind: "include", selector: inclusionSelector }
      : exclusionSelector
        ? { kind: "exclude", selector: exclusionSelector }
        : undefined;
    const coverage = ownCoverage ?? inheritedCoverage;
    const selector = inclusionSelector ?? exclusionSelector ?? coverage?.selector;

    if (node.closedShadow || node.shadow === "inaccessible-closed") {
      rows.set(node.key, {
        id: node.key,
        classification: "closed-shadow",
        xpath: node.xpath,
        ...(selector ? { selector } : {}),
      });
      // A synthetic `closedShadow` node represents a wholly uncapturable branch.
      // A known inaccessible root can still have accessible light children, which
      // remain part of the composed page and must continue through the preview.
      if (node.closedShadow) {
        return;
      }
    } else if (node.immutable || isImmutableTag(node.tagName)) {
      rows.set(node.key, {
        id: node.key,
        classification: "immutable",
        xpath: node.xpath,
        ...(selector ? { selector } : {}),
      });
      return;
    } else {
      const submission = submissionByXpath.get(node.xpath);
      if (submission) {
        const classification: PreviewClassification = submission.excluded || coverage?.kind === "exclude"
          ? "excluded"
          : inclusionSelector
            ? "explicit-included"
            : coverage?.kind === "include"
              ? "implicit-included"
              : "undetected";
        rows.set(node.key, {
          id: node.key,
          classification,
          xpath: node.xpath,
          ...(selector ? { selector } : {}),
        });
      }
    }

    for (const child of node.children ?? []) {
      visit(child, coverage);
    }
  };

  visit(domView.root, undefined);
  return [...rows.values()].sort((left, right) =>
    compareXpathsInDocumentOrder(left.xpath, right.xpath)
  );
}

export function evaluateBranch(
  previous: EvaluationResult,
  branch: BranchEvaluationInput,
): EvaluationResult {
  const branchOverlay = new Map<string, Classification>();
  const branchRows: MarkRow[] = [];
  walk(
    branch.root,
    createMarkMap(branch.canonicalMarks),
    branchOverlay,
    branchRows,
    branch.inheritedAncestorMark,
    branch.inheritedSubmittedExcludedAncestor ??
      (branch.inheritedAncestorMark?.excluded ? branch.inheritedAncestorMark.xpath : undefined),
    branch.inheritedUncapturable === true,
  );

  const overlay = new Map(previous.overlay);
  for (const key of overlay.keys()) {
    if (isXPathInSubtree(key, branch.root.xpath)) {
      overlay.delete(key);
    }
  }
  for (const [key, value] of branchOverlay) {
    overlay.set(key, value);
  }

  // `previous.rows` is already in document order and a DOM subtree occupies one
  // contiguous range. Preserve that order and splice the freshly walked branch
  // once instead of sorting the full page after every physical click.
  const rows: MarkRow[] = [];
  let branchInserted = false;
  for (const row of previous.rows) {
    if (isXPathInSubtree(row.xpath, branch.root.xpath)) {
      continue;
    }
    if (!branchInserted && compareXpathsInDocumentOrder(row.xpath, branch.root.xpath) > 0) {
      rows.push(...branchRows);
      branchInserted = true;
    }
    rows.push(row);
  }
  if (!branchInserted) {
    rows.push(...branchRows);
  }
  return {
    overlay,
    rows,
  };
}
