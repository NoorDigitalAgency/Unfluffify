import { isImmutableTag, isToggleableDefaultTag } from "./taxonomy";

export type StructuralRole =
  | "section"
  | "article"
  | "card-group"
  | "list"
  | "table"
  | "generic";

export type BoundaryNode = Readonly<{
  key: string;
  tagName: string;
  depthFromBody?: number;
  visible: boolean;
  ownsDirectText?: boolean;
  chrome?: boolean;
  interactionSuppressed?: boolean;
  structuralRole?: StructuralRole;
  landmarkCount?: number;
  pageShell?: boolean;
  closedShadow?: boolean;
  silentWhitespaceExclusion?: boolean;
}>;

export type BoundaryContext = Readonly<{
  isVisible?: (node: BoundaryNode) => boolean;
  isChrome?: (node: BoundaryNode) => boolean;
  ownsDirectText?: (node: BoundaryNode) => boolean;
  hasOwnMark?: (node: BoundaryNode) => boolean;
}>;

export function isPageShell(node: BoundaryNode): boolean {
  const tagName = node.tagName.trim().toUpperCase();
  if (tagName === "HTML" || tagName === "BODY") {
    return true;
  }
  if (node.pageShell) {
    return true;
  }
  if ((node.landmarkCount ?? 0) >= 2) {
    return true;
  }
  return false;
}

export function isShallowGenericShell(node: BoundaryNode): boolean {
  return node.structuralRole === "generic" &&
    (node.depthFromBody ?? Number.POSITIVE_INFINITY) <= 2;
}

export function ownsDirectText(node: BoundaryNode, ctx: BoundaryContext = {}): boolean {
  return ctx.ownsDirectText?.(node) ?? node.ownsDirectText === true;
}

export function isStructuralBoundary(node: BoundaryNode, _ctx: BoundaryContext = {}): boolean {
  if (node.chrome || isImmutableTag(node.tagName) || isPageShell(node) || isShallowGenericShell(node)) {
    return false;
  }
  if (isToggleableDefaultTag(node.tagName)) {
    return true;
  }
  return (
    node.structuralRole === "section" ||
    node.structuralRole === "article" ||
    node.structuralRole === "card-group" ||
    node.structuralRole === "list" ||
    node.structuralRole === "table"
  );
}

export function isSelfMarkable(node: BoundaryNode, ctx: BoundaryContext = {}): boolean {
  const visible = ctx.isVisible?.(node) ?? node.visible;
  const chrome = ctx.isChrome?.(node) ?? node.chrome === true;
  return (
    visible &&
    !chrome &&
    !node.interactionSuppressed &&
    !isImmutableTag(node.tagName) &&
    ownsDirectText(node, ctx)
  );
}

/** The one target/evaluation boundary predicate. A silent-whitespace surface
 * becomes toggleable only after an ordinary explicit/default row exists. */
export function isToggleableBoundary(node: BoundaryNode, ctx: BoundaryContext = {}): boolean {
  return !node.closedShadow &&
    (!node.silentWhitespaceExclusion || ctx.hasOwnMark?.(node) === true) &&
    isSelfMarkable(node, ctx);
}
