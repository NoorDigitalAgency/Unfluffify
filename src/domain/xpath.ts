export type XPathNodeView = Readonly<{
  key: string;
  tagName: string;
  parent?: XPathNodeView | null;
  children?: readonly XPathNodeView[];
  shadowChildren?: readonly XPathNodeView[];
  closedShadow?: boolean;
  extensionUi?: boolean;
}>;

export function normalizeXPathTag(tagName: string): string {
  return tagName.trim().toLowerCase();
}

export function getFlattenedChildren(node: XPathNodeView): readonly XPathNodeView[] {
  if (node.closedShadow || node.extensionUi) {
    return node.children ?? [];
  }
  return [...(node.shadowChildren ?? []), ...(node.children ?? [])].filter(
    (child) => !child.extensionUi && !child.closedShadow,
  );
}

export function getXPath(node: XPathNodeView): string | null {
  if (node.closedShadow || node.extensionUi) {
    return null;
  }
  const segments: string[] = [];
  let cursor: XPathNodeView | null | undefined = node;
  while (cursor) {
    if (cursor.closedShadow || cursor.extensionUi) {
      return null;
    }
    const parent: XPathNodeView | null | undefined = cursor.parent;
    const tag = normalizeXPathTag(cursor.tagName);
    const siblings = parent ? getFlattenedChildren(parent) : [cursor];
    const sameTagBefore = siblings
      .slice(0, siblings.indexOf(cursor))
      .filter((sibling) => normalizeXPathTag(sibling.tagName) === tag).length;
    segments.unshift(`${tag}[${sameTagBefore + 1}]`);
    cursor = parent;
  }
  return `/${segments.join("/")}`;
}

export function isDocumentRootRowXPath(xpath: string): boolean {
  return xpath === "/html[1]" || xpath === "/html[1]/body[1]";
}

type XPathOrderSegment = Readonly<{ tag: string; index: number }>;

// Evaluation sorts the same retained XPaths repeatedly as presentation-only
// refreshes adopt a new immutable tree. Parsing every path and constructing a
// numeric localeCompare options object for every comparator call made that
// otherwise-linear adoption dominate resize frames on large storefronts.
const XPATH_ORDER_CACHE_LIMIT = 16_384;
const xpathOrderSegments = new Map<string, readonly XPathOrderSegment[]>();
const xpathTagCollator = new Intl.Collator(undefined, { numeric: true });

function parseXPathOrderSegments(xpath: string): readonly XPathOrderSegment[] {
  const cached = xpathOrderSegments.get(xpath);
  if (cached) {
    return cached;
  }
  const parsed = xpath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const match = /^(.*)\[(\d+)\]$/u.exec(segment);
      return match
        ? { tag: match[1]!, index: Number(match[2]) }
        : { tag: segment, index: 0 };
    });
  if (xpathOrderSegments.size >= XPATH_ORDER_CACHE_LIMIT) {
    xpathOrderSegments.clear();
  }
  xpathOrderSegments.set(xpath, parsed);
  return parsed;
}

export function isXPathInSubtree(xpath: string, rootXpath: string): boolean {
  return xpath === rootXpath || xpath.startsWith(`${rootXpath}/`);
}

export function compareXpathsInDocumentOrder(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftParts = parseXPathOrderSegments(left);
  const rightParts = parseXPathOrderSegments(right);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const tagComparison = xpathTagCollator.compare(leftParts[index]!.tag, rightParts[index]!.tag);
    if (tagComparison !== 0) {
      return tagComparison;
    }
    const positionComparison = leftParts[index]!.index - rightParts[index]!.index;
    if (positionComparison !== 0) {
      return positionComparison;
    }
  }
  return leftParts.length - rightParts.length;
}
