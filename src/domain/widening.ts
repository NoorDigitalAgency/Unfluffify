import {
  type BoundaryContext,
  type BoundaryNode,
  isPageShell,
  isSelfMarkable,
  ownsDirectText,
} from "./boundary";

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
  if (isPageShell(node) || ownsDirectText(node, ctx)) {
    return false;
  }
  const eligibleChildren = getChildren(node, ctx).filter((child) =>
    isEligibleWidenTarget(child, ctx),
  );
  return eligibleChildren.length >= 2;
}

export function isEligibleWidenTarget(node: WidenNode, ctx: WideningContext = {}): boolean {
  if (isPageShell(node)) {
    return false;
  }
  if (isSelfMarkable(node, ctx) && holdsMultipleTextualMarkableContent(node, ctx)) {
    return true;
  }
  if (!ownsDirectText(node, ctx) && holdsMultipleTextualMarkableContent(node, ctx)) {
    return true;
  }
  return isGroupingWidenTarget(node, ctx);
}

export function chooseWidenTarget(node: WidenNode, ctx: WideningContext = {}): WidenNode {
  let selected = node;
  let cursor = ctx.getParent?.(node) ?? node.parent;
  while (cursor) {
    if (!isEligibleWidenTarget(cursor, ctx)) {
      break;
    }
    selected = cursor;
    cursor = ctx.getParent?.(cursor) ?? cursor.parent;
  }
  return selected;
}
