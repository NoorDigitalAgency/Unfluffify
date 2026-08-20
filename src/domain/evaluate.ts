import type { CanonicalMarkSet, Classification, MarkRow } from "./schema/marking";
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

  const outsideRows = previous.rows.filter((row) => !isXPathInSubtree(row.xpath, branch.root.xpath));
  return {
    overlay,
    rows: [...outsideRows, ...branchRows].sort((left, right) =>
      compareXpathsInDocumentOrder(left.xpath, right.xpath),
    ),
  };
}
