import { getComposedHitElements, hasPointerEventsSuppressedPath } from "./hit-testing";

function containsOrIs(ancestor: Element, element: Element): boolean {
  return ancestor === element || ancestor.contains(element);
}

function composedContains(ancestor: Element, element: Element): boolean {
  let cursor: Node | null = element;
  while (cursor) {
    if (cursor === ancestor) {
      return true;
    }
    const parent: Node | null = cursor.parentNode;
    if (parent) {
      cursor = parent;
      continue;
    }
    const rootNode: Node | null = typeof cursor.getRootNode === "function" ? cursor.getRootNode() : null;
    cursor = rootNode && "host" in rootNode ? (rootNode.host as Node) : null;
  }
  return false;
}

export function isPaintReachable(
  element: Element,
  document: Document = element.ownerDocument,
): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return isPaintReachableAt(element, x, y, document);
}

export function isPaintReachableAt(
  element: Element,
  x: number,
  y: number,
  document: Document = element.ownerDocument,
): boolean {
  const hits = getComposedHitElements(document, x, y);
  const top = hits[0];
  if (!top) {
    return true;
  }
  if (top === element || composedContains(element, top)) {
    return true;
  }
  if (containsOrIs(element, top) || containsOrIs(top, element) || composedContains(top, element)) {
    if (composedContains(top, element) && !containsOrIs(top, element)) {
      return true;
    }
    if (top !== element && (containsOrIs(top, element) || composedContains(top, element))) {
      return hasPointerEventsSuppressedPath(element, top);
    }
    return true;
  }
  return false;
}
