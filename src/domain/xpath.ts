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

function parseXPathIndexes(xpath: string): readonly string[] {
  return xpath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\[(\d+)\]$/, ".$1"));
}

export function isXPathInSubtree(xpath: string, rootXpath: string): boolean {
  return xpath === rootXpath || xpath.startsWith(`${rootXpath}/`);
}

export function compareXpathsInDocumentOrder(left: string, right: string): number {
  const leftParts = parseXPathIndexes(left);
  const rightParts = parseXPathIndexes(right);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = leftParts[index].localeCompare(rightParts[index], undefined, {
      numeric: true,
    });
    if (comparison !== 0) {
      return comparison;
    }
  }
  return leftParts.length - rightParts.length;
}
