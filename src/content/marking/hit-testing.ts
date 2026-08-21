export type ElementLike = Element & {
  shadowRoot?: ShadowRoot | null;
};

function rectContains(rect: DOMRect | ClientRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function composedChildren(element: Element): Element[] {
  const shadowChildren = (element as ElementLike).shadowRoot
    ? Array.from((element as ElementLike).shadowRoot?.children ?? [])
    : [];
  return [...shadowChildren, ...Array.from(element.children)];
}

function collectPointerSuppressedDescendants(element: Element, x: number, y: number): Element[] {
  const matches: Element[] = [];
  const stack = [...composedChildren(element)];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }
    stack.unshift(...composedChildren(current));
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.pointerEvents !== "none") {
      continue;
    }
    const rect = current.getBoundingClientRect();
    if (rectContains(rect, x, y)) {
      matches.unshift(current);
    }
  }
  return matches;
}

type ShadowHitTraversal = Readonly<{
  elements: Set<Element>;
  roots: Set<ShadowRoot>;
}>;

function pierceOpenShadow(
  element: Element,
  x: number,
  y: number,
  traversal: ShadowHitTraversal = {
    elements: new Set([element]),
    roots: new Set(),
  },
): Element[] {
  const root = (element as ElementLike).shadowRoot;
  if (
    !root ||
    typeof root.elementsFromPoint !== "function" ||
    traversal.roots.has(root)
  ) {
    return [];
  }
  traversal.roots.add(root);
  const expanded: Element[] = [];
  for (const hit of root.elementsFromPoint(x, y)) {
    // Chromium can include this ShadowRoot's own host. Identity fencing also
    // protects malformed/cyclic composed stacks without losing later siblings.
    if (traversal.elements.has(hit)) {
      continue;
    }
    traversal.elements.add(hit);
    expanded.push(...pierceOpenShadow(hit, x, y, traversal), hit);
  }
  return expanded;
}

export function getComposedHitElements(document: Document, x: number, y: number): Element[] {
  const nativeHits = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(x, y)
    : [];
  const expanded: Element[] = [];
  const seen = new Set<Element>();
  const isExtensionUi = (element: Element): boolean =>
    element.getAttribute("data-uf-extension-ui") === "true" ||
    Boolean(element.closest?.('[data-uf-extension-ui="true"]'));
  const withSuppressedBefore = (element: Element): Element[] => [
    ...collectPointerSuppressedDescendants(element, x, y),
    element,
  ];
  for (const hit of nativeHits) {
    for (const candidate of [
      ...pierceOpenShadow(hit, x, y).flatMap(withSuppressedBefore),
      ...withSuppressedBefore(hit),
    ]) {
      if (isExtensionUi(candidate)) {
        continue;
      }
      if (!seen.has(candidate)) {
        seen.add(candidate);
        expanded.push(candidate);
      }
    }
  }
  return expanded;
}

export function hasPointerEventsSuppressedPath(element: Element, ancestor: Element): boolean {
  let cursor: Element | null = element;
  while (cursor && cursor !== ancestor) {
    const style = cursor.ownerDocument.defaultView?.getComputedStyle(cursor);
    if (style?.pointerEvents !== "none") {
      return false;
    }
    cursor = cursor.parentElement;
  }
  return cursor === ancestor;
}
