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

function isComposedHitExcluded(element: Element): boolean {
  let cursor: Element | null = element;
  const seen = new Set<Element>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (
      cursor.getAttribute("data-uf-extension-ui") === "true" ||
      cursor.hasAttribute("data-uf-consent-hidden")
    ) return true;
    if (cursor.parentElement) {
      cursor = cursor.parentElement;
      continue;
    }
    const root = cursor.getRootNode?.();
    cursor = root && "host" in root ? (root as ShadowRoot).host : null;
  }
  return false;
}

function elementContainsPoint(element: Element, x: number, y: number): boolean {
  try {
    const rects = typeof element.getClientRects === "function"
      ? element.getClientRects()
      : [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (rect && rect.width > 0 && rect.height > 0 && rectContains(rect, x, y)) {
        return true;
      }
    }
  } catch {
    // A realm-specific element can reject geometry reads. It is not a safe
    // branch to expand for pointer-suppressed hit recovery.
  }
  return false;
}

function collectPointerSuppressedDescendants(element: Element, x: number, y: number): Element[] {
  const matches: Element[] = [];
  const visit = (current: Element): void => {
    // Reject the composed branch before reading geometry, descendants, or
    // computed style. Consent and extension roots can be full-screen and very
    // deep despite being intentionally absent from the capture surface.
    if (isComposedHitExcluded(current) || !elementContainsPoint(current, x, y)) {
      return;
    }
    // Geometry is the branch bound: only a child whose own painted fragments
    // contain the pointer can contain a useful suppressed descendant. This is
    // the legacy hot-path property that keeps work proportional to the visible
    // hit branch rather than to total document size.
    for (const child of composedChildren(current)) {
      visit(child);
    }
    let style: CSSStyleDeclaration | undefined;
    try {
      style = current.ownerDocument.defaultView?.getComputedStyle(current);
    } catch {
      style = undefined;
    }
    if (style?.pointerEvents === "none") {
      matches.push(current);
    }
  };
  for (const child of composedChildren(element)) {
    visit(child);
  }
  return matches;
}

function topPageHit(nativeHits: readonly Element[], document: Document): Element | null {
  for (const hit of nativeHits) {
    if (
      hit === document.documentElement ||
      hit === document.body ||
      isComposedHitExcluded(hit)
    ) {
      continue;
    }
    return hit;
  }
  return null;
}

function composedDescendantOf(element: Element, ancestor: Element): boolean {
  let cursor: Element | null = element;
  const seen = new Set<Element>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestor) {
      return element !== ancestor;
    }
    seen.add(cursor);
    if (cursor.parentElement) {
      cursor = cursor.parentElement;
      continue;
    }
    const root = cursor.getRootNode?.();
    cursor = root && "host" in root ? (root as ShadowRoot).host : null;
  }
  return false;
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
    isComposedHitExcluded(element) ||
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
  const add = (candidate: Element): void => {
    if (!isComposedHitExcluded(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      expanded.push(candidate);
    }
  };
  const pageHit = topPageHit(nativeHits, document);
  const shadowHits: Element[] = [];
  for (const hit of nativeHits) {
    for (const candidate of pierceOpenShadow(hit, x, y)) {
      shadowHits.push(candidate);
    }
  }
  const suppressedHits = pageHit
    ? collectPointerSuppressedDescendants(pageHit, x, y)
    : [];
  const admittedSuppressed = new Set<Element>();
  for (const shadowHit of shadowHits) {
    // A suppressed descendant is the more precise target than its painted
    // ancestor, while a suppressed sibling must not outrank an actual native
    // shadow hit. Preserve both rules without rescanning the subtree.
    for (const suppressed of suppressedHits) {
      if (composedDescendantOf(suppressed, shadowHit)) {
        add(suppressed);
        admittedSuppressed.add(suppressed);
      }
    }
    add(shadowHit);
  }
  for (const suppressed of suppressedHits) {
    if (!admittedSuppressed.has(suppressed)) {
      add(suppressed);
    }
  }
  for (const hit of nativeHits) {
    add(hit);
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
