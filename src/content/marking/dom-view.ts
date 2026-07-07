import type { EvaluationNode } from "../../domain/evaluate";
import { isStructuralBoundary as isDomainStructuralBoundary } from "../../domain/boundary";
import { isImmutableTag } from "../../domain/taxonomy";
import { isUserVisible, type VisibilityGeometry } from "../../domain/visibility";
import type { XPathNodeView } from "../../domain/xpath";

export type DomBridgeNode = Readonly<{
  element: Element;
  xpathNode: XPathNodeView;
  evaluationNode: EvaluationNode;
}>;

export type DomBridgeView = Readonly<{
  root: EvaluationNode;
  byElement: ReadonlyMap<Element, DomBridgeNode>;
  byXpath: ReadonlyMap<string, DomBridgeNode>;
}>;

function ownsDirectText(element: Element): boolean {
  return flattenedChildNodes(element).some((node) =>
    node.nodeType === 3 && (node.textContent ?? "").trim().length > 0
  );
}

function flattenedChildNodes(element: Element): Node[] {
  return [
    ...Array.from((element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot?.childNodes ?? []),
    ...Array.from(element.childNodes),
  ];
}

function depthFromBody(xpath: string): number {
  return Math.max(0, xpath.split("/").length - 3);
}

function landmarkCount(element: Element): number {
  const tag = element.tagName.toUpperCase();
  const role = element.getAttribute("role");
  const own = ["HEADER", "MAIN", "FOOTER", "NAV"].includes(tag) ||
    role === "banner" ||
    role === "main" ||
    role === "contentinfo" ||
    role === "navigation"
    ? 1
    : 0;
  return own + elementChildren(element)
    .filter((child) => !isExtensionUi(child) && !isClosedShadowHost(child))
    .reduce((count, child) => count + landmarkCount(child), 0);
}

function structuralRoleFor(element: Element): "section" | "article" | "card-group" | "list" | "table" | "generic" {
  const tag = element.tagName.toUpperCase();
  if (tag === "SECTION") return "section";
  if (tag === "ARTICLE") return "article";
  if (tag === "UL" || tag === "OL" || element.getAttribute("role") === "list") return "list";
  if (tag === "TABLE") return "table";
  return "generic";
}

function isStructuralBoundary(element: Element, xpath: string): boolean {
  const tag = element.tagName.toUpperCase();
  return isDomainStructuralBoundary({
    key: xpath,
    tagName: tag,
    depthFromBody: depthFromBody(xpath),
    visible: true,
    structuralRole: structuralRoleFor(element),
    landmarkCount: landmarkCount(element),
    pageShell: tag === "HTML" || tag === "BODY" || tag === "MAIN" || landmarkCount(element) >= 2,
    broadViewportFootprint: geometryFor(element).rect.width >= (element.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY) * 0.9,
  });
}

function geometryFor(element: Element): VisibilityGeometry {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    viewportWidth: element.ownerDocument.defaultView?.innerWidth,
    pageHeight: element.ownerDocument.documentElement.scrollHeight,
    style: style
      ? {
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        hidden: hasStyleHiddenAncestor(element),
        ariaHidden: hasHiddenAncestor(element, "aria-hidden", "true"),
        srOnly: hasClassInAncestors(element, /\b(?:sr-only|visually-hidden)\b/),
        interactionGated: hasHiddenAncestor(element, "aria-expanded", "false"),
        overflowY: style.overflowY,
        clientHeight: (element as HTMLElement).clientHeight,
        scrollHeight: (element as HTMLElement).scrollHeight,
        textContent: element.textContent ?? "",
      }
      : undefined,
  };
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = typeof element.getRootNode === "function" ? element.getRootNode() : null;
  return root && "host" in root ? root.host as Element : null;
}

function hasHiddenAncestor(element: Element, attribute: string, value: string): boolean {
  let cursor: Element | null = element;
  while (cursor) {
    if (cursor.getAttribute(attribute) === value) {
      return true;
    }
    cursor = composedParent(cursor);
  }
  return false;
}

function hasClassInAncestors(element: Element, pattern: RegExp): boolean {
  let cursor: Element | null = element;
  while (cursor) {
    if (pattern.test(cursor.className)) {
      return true;
    }
    cursor = composedParent(cursor);
  }
  return false;
}

function hasStyleHiddenAncestor(element: Element): boolean {
  let cursor: Element | null = element;
  while (cursor) {
    const style = cursor.ownerDocument.defaultView?.getComputedStyle(cursor);
    if (
      Boolean((cursor as HTMLElement).hidden) ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      Number(style?.opacity ?? 1) === 0
    ) {
      return true;
    }
    cursor = composedParent(cursor);
  }
  return false;
}

function isExtensionUi(element: Element): boolean {
  return element.hasAttribute("data-wxt-shadow-root") ||
    element.getAttribute("data-uf-extension-ui") === "true" ||
  element.tagName.toLowerCase() === "browser-mcp-container" ||
  element.id === "browser-mcp-container" ||
    element.id.startsWith("unfluffify-");
}

function elementChildren(element: Element): Element[] {
  const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  return [...Array.from(shadowRoot?.children ?? []), ...Array.from(element.children)];
}

function xpathTag(element: Element): string {
  return element.tagName.toLowerCase();
}

function isClosedShadowHost(element: Element): boolean {
  return element.getAttribute("data-uf-closed-shadow-host") === "true";
}

function buildNode(
  element: Element,
  parent: XPathNodeView | null,
  xpath: string,
  byElement: Map<Element, DomBridgeNode>,
  byXpath: Map<string, DomBridgeNode>,
): DomBridgeNode | null {
  if (isExtensionUi(element)) {
    return null;
  }
  const closedShadow = isClosedShadowHost(element);
  const xpathNode = {
    key: xpath,
    tagName: element.tagName,
    parent,
  } as XPathNodeView & { children?: XPathNodeView[]; shadowChildren?: XPathNodeView[] };
  const childNodes: XPathNodeView[] = [];
  const childEvaluations: EvaluationNode[] = [];
  const tagName = element.tagName.toUpperCase();
  const immutable = isImmutableTag(tagName);
  if (!closedShadow && !immutable) {
    const seenTags = new Map<string, number>();
    let closedShadowIndex = 0;
    for (const child of elementChildren(element)) {
      if (isExtensionUi(child)) {
        continue;
      }
      if (isClosedShadowHost(child)) {
        closedShadowIndex += 1;
        const built = buildNode(child, xpathNode, `${xpath}/__closed-shadow[${closedShadowIndex}]`, byElement, byXpath);
        if (built) {
          childEvaluations.push(built.evaluationNode);
        }
        continue;
      }
      const tag = xpathTag(child);
      const nextIndex = (seenTags.get(tag) ?? 0) + 1;
      seenTags.set(tag, nextIndex);
      const built = buildNode(child, xpathNode, `${xpath}/${tag}[${nextIndex}]`, byElement, byXpath);
      if (built) {
        childNodes.push(built.xpathNode);
        childEvaluations.push(built.evaluationNode);
      }
    }
  }
  xpathNode.children = childNodes;
  const evaluationNode: EvaluationNode = {
    key: xpath,
    tagName,
    xpath,
    visible: isUserVisible(element, geometryFor(element)),
    ownsDirectText: ownsDirectText(element),
    structuralBoundary: isStructuralBoundary(element, xpath),
    pageShell: tagName === "HTML" || tagName === "BODY" || tagName === "MAIN" || landmarkCount(element) >= 2,
    landmarkCount: landmarkCount(element),
    broadViewportFootprint: geometryFor(element).rect.width >= (element.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY) * 0.9,
    chrome: isExtensionUi(element),
    immutable,
    closedShadow,
    children: childEvaluations,
  };
  const bridgeNode = { element, xpathNode, evaluationNode };
  byElement.set(element, bridgeNode);
  byXpath.set(xpath, bridgeNode);
  return bridgeNode;
}

export function createDomBridgeView(rootElement: Element): DomBridgeView {
  const byElement = new Map<Element, DomBridgeNode>();
  const byXpath = new Map<string, DomBridgeNode>();
  const root = buildNode(rootElement, null, `/${xpathTag(rootElement)}[1]`, byElement, byXpath);
  if (!root) {
    throw new Error("Unable to build marking DOM bridge view for root element");
  }
  return {
    root: root.evaluationNode,
    byElement,
    byXpath,
  };
}

export function markClosedShadowHost(element: Element): void {
  element.setAttribute("data-uf-closed-shadow-host", "true");
}

export function installClosedShadowHostInstrumentation(win: Window): () => void {
  const host = win as Window & {
    Element?: { prototype: Element & { attachShadow?: (init: ShadowRootInit) => ShadowRoot } };
  };
  const proto = host.Element?.prototype as (Element & {
    attachShadow?: (init: ShadowRootInit) => ShadowRoot;
  }) | undefined;
  const original = proto?.attachShadow;
  if (!proto || !original) {
    return () => undefined;
  }
  proto.attachShadow = function patchedAttachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
    if (init.mode === "closed") {
      markClosedShadowHost(this);
    }
    return original.call(this, init);
  };
  return () => {
    proto.attachShadow = original;
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeAttributes(element: Element): string {
  return element.getAttributeNames()
    .filter((name) => !name.startsWith("data-uf-"))
    .map((name) => ` ${name}="${escapeHtml(element.getAttribute(name) ?? "")}"`)
    .join("");
}

export function captureFlattenedHtml(element: Element): string {
  if (isExtensionUi(element) || isClosedShadowHost(element)) {
    return "";
  }
  const tag = element.tagName.toLowerCase();
  const childHtml = [
    ...flattenedChildNodes(element).map(serializeNode),
  ].join("");
  return `<${tag}${serializeAttributes(element)}>${childHtml}</${tag}>`;
}

function serializeNode(node: Node): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent ?? "");
  }
  return node.nodeType === 1 ? captureFlattenedHtml(node as Element) : "";
}
