import {
  type BoundaryContext,
  type BoundaryNode,
  isPageShell,
  isSelfMarkable,
  isShallowGenericShell,
  ownsDirectText,
} from "./boundary";
import { isImmutableTag, isToggleableDefaultTag } from "./taxonomy";

export type WidenNode = BoundaryNode & Readonly<{
  parent?: WidenNode | null;
  children?: readonly WidenNode[];
  textualMarkableContentCount?: number;
  fullWidth?: boolean;
}>;

export type WideningContext = BoundaryContext & Readonly<{
  getParent?: (node: WidenNode) => WidenNode | null | undefined;
  getChildren?: (node: WidenNode) => readonly WidenNode[];
  getTextualMarkableContentCount?: (node: WidenNode) => number;
}>;

function getChildren(node: WidenNode, ctx: WideningContext): readonly WidenNode[] {
  return ctx.getChildren?.(node) ?? node.children ?? [];
}

function getTextualMarkableContentCount(node: WidenNode, ctx: WideningContext): number {
  const explicitCount = ctx.getTextualMarkableContentCount?.(node) ?? node.textualMarkableContentCount;
  if (explicitCount !== undefined) {
    return explicitCount;
  }
  return getChildren(node, ctx).reduce(
    (count, child) => count + (isSelfMarkable(child, ctx) ? 1 : getTextualMarkableContentCount(child, ctx)),
    0,
  );
}

export function holdsMultipleTextualMarkableContent(
  node: WidenNode,
  ctx: WideningContext = {},
): boolean {
  return getTextualMarkableContentCount(node, ctx) >= 2;
}

export function isGroupingWidenTarget(node: WidenNode, ctx: WideningContext = {}): boolean {
  if (isPageShell(node) || isShallowGenericShell(node) || ownsDirectText(node, ctx)) {
    return false;
  }
  const textualChildren = getChildren(node, ctx).filter((child) =>
    child.visible &&
    !child.chrome &&
    !isImmutableTag(child.tagName) &&
    getTextualMarkableContentCount(child, ctx) > 0
  );
  // Textless spacers are structural noise. Every remaining textual direct
  // child must itself be a tight markable piece; silently dropping an
  // ineligible textual sibling turns mixed page wrappers into false groups.
  return textualChildren.length >= 2 && textualChildren.every((child) => isSelfMarkable(child, ctx));
}

export function isEligibleWidenTarget(node: WidenNode, ctx: WideningContext = {}): boolean {
  if (isPageShell(node)) {
    return false;
  }
  return isSelfMarkable(node, ctx) || isGroupingWidenTarget(node, ctx);
}

export function chooseWidenTarget(node: WidenNode, ctx: WideningContext = {}): WidenNode {
  const isStructuredGroup = (candidate: WidenNode) => isGroupingWidenTarget(candidate, ctx);
  const isToggleableBoundary = (candidate: WidenNode) =>
    isToggleableDefaultTag(candidate.tagName) && isSelfMarkable(candidate, ctx);

  // C-TGT-4 step 1: Shift on an already meaningful boundary stays there.
  if (isStructuredGroup(node) || isToggleableBoundary(node)) {
    return node;
  }

  const ancestors: WidenNode[] = [];
  let cursor = ctx.getParent?.(node) ?? node.parent;
  const seen = new Set<WidenNode>();
  while (cursor && !seen.has(cursor)) {
    const tagName = cursor.tagName.trim().toUpperCase();
    if (tagName === "BODY" || tagName === "HTML") {
      break;
    }
    seen.add(cursor);
    ancestors.push(cursor);
    cursor = ctx.getParent?.(cursor) ?? cursor.parent;
  }

  // Steps 2 and 3 are nearest-first and outrank every ordinary markable
  // ancestor, even when an ineligible wrapper separates the chain.
  const structuredGroup = ancestors.find(isStructuredGroup);
  if (structuredGroup) {
    return structuredGroup;
  }
  const toggleable = ancestors.find(isToggleableBoundary);
  if (toggleable) {
    return toggleable;
  }

  // Step 4: only now select the broadest ordinary eligible ancestor.
  let broadest: WidenNode | null = null;
  for (const ancestor of ancestors) {
    if (!isPageShell(ancestor) && isSelfMarkable(ancestor, ctx)) {
      broadest = ancestor;
    }
  }
  return broadest ?? node;
}
