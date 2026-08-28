import type { EvaluationNode } from "../../domain/evaluate";
import type { PreviewShadowProvenance } from "../../domain/schema/preview";
import { isStructuralBoundary as isDomainStructuralBoundary } from "../../domain/boundary";
import { isImmutableTag } from "../../domain/taxonomy";
import { isUserVisible, type VisibilityGeometry } from "../../domain/visibility";
import type { XPathNodeView } from "../../domain/xpath";
import {
  CONSENT_HIDDEN_ATTR,
  LEGACY_CONSENT_BYPASS_STYLE_ID,
  consentStyleForCapture,
} from "../consent";
import {
  restoreInteractionShieldInertForCapture,
  restoreInteractionShieldStyleForCapture,
} from "../interaction-shield-capture";
import {
  MOTION_CAPTURE_LEDGER_ATTR,
  restoreMotionStyleForCapture,
  sanitizeCaptureClassValue,
} from "./capture-hygiene";
import { readElementId } from "./element-identity";
import { isActuallyPaintReachable } from "./paint-reachability";

export type DomBridgeNode = Readonly<{
  element: Element;
  xpathNode: XPathNodeView;
  evaluationNode: EvaluationNode;
}>;

export type DomBridgeView = Readonly<{
  root: EvaluationNode;
  byElement: Pick<WeakMap<Element, DomBridgeNode>, "get" | "has">;
  byKey: ReadonlyMap<string, DomBridgeNode>;
  byXpath: ReadonlyMap<string, DomBridgeNode>;
}>;

export type DomBridgeOptions = Readonly<{
  keyForElement?: (element: Element) => string;
}>;

type DomBridgePass = Readonly<{
  childrenByElement: WeakMap<Element, Element[]>;
  geometryByElement: WeakMap<Element, VisibilityGeometry>;
  landmarkCountByElement: WeakMap<Element, number>;
  styleByElement: WeakMap<Element, CSSStyleDeclaration>;
  styleHiddenByElement: WeakMap<Element, boolean>;
  ariaHiddenByElement: WeakMap<Element, boolean>;
  srOnlyByElement: WeakMap<Element, boolean>;
  interactionGatedByElement: WeakMap<Element, boolean>;
}>;

function ownsDirectText(element: Element): boolean {
  return flattenedChildNodes(element).some((node) =>
    node.nodeType === 3 && (node.textContent ?? "").trim().length > 0
  );
}

const NON_TEXTUAL_CONTENT_TAGS = new Set([
  "IMG",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "PICTURE",
  "OBJECT",
  "EMBED",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
]);

function normalizedFlattenedText(element: Element): string {
  const fragments: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      fragments.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType === 1) {
      for (const child of flattenedChildNodes(node as Element)) {
        visit(child);
      }
    }
  };
  visit(element);
  return fragments.join(" ").replace(/\s+/g, " ").trim();
}

function hasNonTextualContent(element: Element): boolean {
  if (NON_TEXTUAL_CONTENT_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  return elementChildren(element).some((child) => hasNonTextualContent(child));
}

function isSilentWhitespaceExclusion(
  element: Element,
  visible: boolean,
  style: CSSStyleDeclaration | undefined,
): boolean {
  const document = element.ownerDocument;
  if (
    !visible ||
    element === document.documentElement ||
    element === document.body
  ) {
    return false;
  }
  const display = style?.display ?? "";
  if (
    !display ||
    display === "none" ||
    display === "contents" ||
    ["inline", "inline-block", "inline-flex", "inline-grid", "inline-table"].includes(display)
  ) {
    return false;
  }
  return normalizedFlattenedText(element) === "" && !hasNonTextualContent(element);
}

function flattenedChildNodes(element: Element): Node[] {
  const isSlot = (node: Node): node is HTMLSlotElement =>
    node.nodeType === 1 && (node as Element).tagName.toUpperCase() === "SLOT";
  const slotReplacements = (slot: HTMLSlotElement, assigned?: Set<Node>): Node[] => {
    const assignedNodes = (() => {
      try {
        return typeof slot.assignedNodes === "function"
          ? slot.assignedNodes({ flatten: true })
          : [];
      } catch {
        return [];
      }
    })();
    if (assignedNodes.length > 0) {
      for (const node of assignedNodes) {
        assigned?.add(node);
      }
      return assignedNodes;
    }
    return Array.from(slot.childNodes);
  };
  const expandDirectSlot = (node: Node, assigned?: Set<Node>): Node[] =>
    isSlot(node) ? slotReplacements(node, assigned) : [node];
  const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (!shadowRoot) {
    // A slot may sit under an arbitrary wrapper inside a shadow root. Expanding
    // direct slot children at every level preserves that wrapper while replacing
    // the slot itself with the actual composed children.
    return Array.from(element.childNodes).flatMap((node) => expandDirectSlot(node));
  }
  const assigned = new Set<Node>();
  const collectAssigned = (node: Node): void => {
    if (isSlot(node)) {
      slotReplacements(node, assigned);
      return;
    }
    if (node.nodeType === 1) {
      for (const child of Array.from(node.childNodes)) {
        collectAssigned(child);
      }
    }
  };
  for (const node of Array.from(shadowRoot.childNodes)) {
    collectAssigned(node);
  }
  const shadowNodes = Array.from(shadowRoot.childNodes)
    .flatMap((node) => expandDirectSlot(node, assigned));
  const remainingLightNodes = Array.from(element.childNodes).filter((node) => !assigned.has(node));
  return [...shadowNodes, ...remainingLightNodes];
}

function depthFromBody(xpath: string): number {
  return Math.max(0, xpath.split("/").length - 3);
}

function landmarkCount(element: Element, pass: DomBridgePass): number {
  const cached = pass.landmarkCountByElement.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const tag = element.tagName.toUpperCase();
  const role = element.getAttribute("role");
  const own = ["HEADER", "MAIN", "FOOTER", "NAV"].includes(tag) ||
    role === "banner" ||
    role === "main" ||
    role === "contentinfo" ||
    role === "navigation"
    ? 1
    : 0;
  const count = own + elementChildren(element, pass)
    .filter((child) => !isExtensionUi(child))
    .reduce((total, child) => total + landmarkCount(child, pass), 0);
  pass.landmarkCountByElement.set(element, count);
  return count;
}

function structuralRoleFor(element: Element): "section" | "article" | "card-group" | "list" | "table" | "generic" {
  const tag = element.tagName.toUpperCase();
  if (tag === "SECTION") return "section";
  if (tag === "ARTICLE") return "article";
  if (tag === "UL" || tag === "OL" || element.getAttribute("role") === "list") return "list";
  if (tag === "TABLE") return "table";
  return "generic";
}

function isStructuralBoundary(
  element: Element,
  xpath: string,
  landmarks: number,
  structuralRole: ReturnType<typeof structuralRoleFor>,
): boolean {
  const tag = element.tagName.toUpperCase();
  return isDomainStructuralBoundary({
    key: xpath,
    tagName: tag,
    depthFromBody: depthFromBody(xpath),
    visible: true,
    structuralRole,
    landmarkCount: landmarks,
    pageShell: tag === "HTML" || tag === "BODY" || tag === "MAIN" || landmarks >= 2,
  });
}

function styleFor(element: Element, pass: DomBridgePass): CSSStyleDeclaration | undefined {
  const cached = pass.styleByElement.get(element);
  if (cached) {
    return cached;
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style) {
    pass.styleByElement.set(element, style);
  }
  return style;
}

function geometryFor(element: Element, pass: DomBridgePass): VisibilityGeometry {
  const cached = pass.geometryByElement.get(element);
  if (cached) {
    return cached;
  }
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  const style = styleFor(element, pass);
  const ariaHidden = hasHiddenAncestor(element, "aria-hidden", "true", pass.ariaHiddenByElement);
  const srOnly = hasClassInAncestors(element, /\b(?:sr-only|visually-hidden)\b/, pass.srOnlyByElement);
  const geometry: VisibilityGeometry = {
    rect: {
      left: rect.left,
      // Vertical visibility is page-height based, so use document coordinates.
      // Horizontal clipping intentionally remains viewport-relative for the
      // fixed mobile emulation width contract.
      top: rect.top + (view?.scrollY ?? view?.pageYOffset ?? 0),
      width: rect.width,
      height: rect.height,
    },
    viewportWidth: view?.innerWidth,
    pageHeight: element.ownerDocument.documentElement.scrollHeight,
    style: style
      ? {
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        hidden: hasStyleHiddenAncestor(element, pass),
        ariaHidden,
        srOnly,
        paintReachable: ariaHidden || srOnly ? isActuallyPaintReachable(element) : undefined,
        interactionGated: hasHiddenAncestor(element, "aria-expanded", "false", pass.interactionGatedByElement),
        overflowY: style.overflowY,
        clientHeight: (element as HTMLElement).clientHeight,
        scrollHeight: (element as HTMLElement).scrollHeight,
        textContent: element.textContent ?? "",
      }
      : undefined,
  };
  pass.geometryByElement.set(element, geometry);
  return geometry;
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = typeof element.getRootNode === "function" ? element.getRootNode() : null;
  return root && "host" in root ? root.host as Element : null;
}

function hasHiddenAncestor(
  element: Element,
  attribute: string,
  value: string,
  cache: WeakMap<Element, boolean>,
): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const hidden = element.getAttribute(attribute) === value || Boolean(
    composedParent(element) && hasHiddenAncestor(composedParent(element)!, attribute, value, cache),
  );
  cache.set(element, hidden);
  return hidden;
}

function hasClassInAncestors(
  element: Element,
  pattern: RegExp,
  cache: WeakMap<Element, boolean>,
): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const parent = composedParent(element);
  const matched = pattern.test(element.className) || Boolean(parent && hasClassInAncestors(parent, pattern, cache));
  cache.set(element, matched);
  return matched;
}

function hasStyleHiddenAncestor(element: Element, pass: DomBridgePass): boolean {
  const cached = pass.styleHiddenByElement.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const style = styleFor(element, pass);
  const parent = composedParent(element);
  const hidden = Boolean((element as HTMLElement).hidden) ||
    style?.display === "none" ||
    style?.visibility === "hidden" ||
    style?.visibility === "collapse" ||
    Number(style?.opacity ?? 1) === 0 ||
    Boolean(parent && hasStyleHiddenAncestor(parent, pass));
  pass.styleHiddenByElement.set(element, hidden);
  return hidden;
}

function isExtensionUi(element: Element): boolean {
  const elementId = readElementId(element);
  return element.hasAttribute(CONSENT_HIDDEN_ATTR) ||
    element.hasAttribute("data-wxt-shadow-root") ||
    element.getAttribute("data-uf-extension-ui") === "true" ||
    element.tagName.toLowerCase() === "browser-mcp-container" ||
    elementId === "browser-mcp-container" ||
    elementId === LEGACY_CONSENT_BYPASS_STYLE_ID ||
    elementId.startsWith("unfluffify-");
}

function elementChildren(element: Element, pass?: DomBridgePass): Element[] {
  const cached = pass?.childrenByElement.get(element);
  if (cached) {
    return cached;
  }
  const children = flattenedChildNodes(element)
    .filter((node): node is Element => node.nodeType === 1);
  pass?.childrenByElement.set(element, children);
  return children;
}

function xpathTag(element: Element): string {
  return element.tagName.toLowerCase();
}

function shadowProvenanceFor(element: Element): PreviewShadowProvenance {
  const closedHost = element.getAttribute("data-uf-closed-shadow-host") === "true";
  const ownShadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (closedHost) {
    return ownShadowRoot ? "force-open-closed" : "inaccessible-closed";
  }

  let cursor: Element | null = element;
  let enteredShadow = false;
  const visited = new Set<Element>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const root: Node | null = typeof cursor.getRootNode === "function" ? cursor.getRootNode() : null;
    const host: Element | null = root && typeof root === "object" && "host" in root
      ? (root as ShadowRoot).host
      : null;
    if (!host) {
      break;
    }
    enteredShadow = true;
    if (host.getAttribute("data-uf-closed-shadow-host") === "true") {
      return "force-open-closed";
    }
    cursor = host;
  }
  return enteredShadow ? "open" : "light";
}

function buildNode(
  element: Element,
  parent: XPathNodeView | null,
  xpath: string,
  byElement: WeakMap<Element, DomBridgeNode>,
  byKey: Map<string, DomBridgeNode>,
  byXpath: Map<string, DomBridgeNode>,
  pass: DomBridgePass,
  options: DomBridgeOptions,
): DomBridgeNode | null {
  if (isExtensionUi(element)) {
    return null;
  }
  const key = options.keyForElement?.(element) ?? xpath;
  const xpathNode = {
    key,
    tagName: element.tagName,
    parent,
  } as XPathNodeView & { children?: XPathNodeView[]; shadowChildren?: XPathNodeView[] };
  const childNodes: XPathNodeView[] = [];
  const childEvaluations: EvaluationNode[] = [];
  const tagName = element.tagName.toUpperCase();
  const immutable = isImmutableTag(tagName);
  if (!immutable) {
    const seenTags = new Map<string, number>();
    for (const child of elementChildren(element, pass)) {
      if (isExtensionUi(child)) {
        continue;
      }
      const tag = xpathTag(child);
      const nextIndex = (seenTags.get(tag) ?? 0) + 1;
      seenTags.set(tag, nextIndex);
      const built = buildNode(
        child,
        xpathNode,
        `${xpath}/${tag}[${nextIndex}]`,
        byElement,
        byKey,
        byXpath,
        pass,
        options,
      );
      if (built) {
        childNodes.push(built.xpathNode);
        childEvaluations.push(built.evaluationNode);
      }
    }
  }
  xpathNode.children = childNodes;
  const landmarks = landmarkCount(element, pass);
  const structuralRole = structuralRoleFor(element);
  const geometry = geometryFor(element, pass);
  const visible = isUserVisible(element, geometry);
  const shadow = shadowProvenanceFor(element);
  const evaluationNode: EvaluationNode = {
    key,
    tagName,
    xpath,
    visible,
    ownsDirectText: ownsDirectText(element),
    structuralBoundary: isStructuralBoundary(element, xpath, landmarks, structuralRole),
    structuralRole,
    pageShell: tagName === "HTML" || tagName === "BODY" || tagName === "MAIN" || landmarks >= 2,
    landmarkCount: landmarks,
    chrome: isExtensionUi(element),
    immutable,
    shadow,
    // An inaccessible authored root does not make the host's accessible light
    // children uncapturable. Preview classification uses `shadow`; the marking
    // evaluator's terminal flag remains reserved for wholly synthetic branches.
    closedShadow: false,
    silentWhitespaceExclusion: !immutable && isSilentWhitespaceExclusion(
      element,
      visible,
      styleFor(element, pass),
    ),
    children: childEvaluations,
  };
  const bridgeNode = { element, xpathNode, evaluationNode };
  byElement.set(element, bridgeNode);
  byKey.set(key, bridgeNode);
  byXpath.set(xpath, bridgeNode);
  return bridgeNode;
}

export function createDomBridgeView(rootElement: Element, options: DomBridgeOptions = {}): DomBridgeView {
  const byElement = new WeakMap<Element, DomBridgeNode>();
  const byKey = new Map<string, DomBridgeNode>();
  const byXpath = new Map<string, DomBridgeNode>();
  const pass: DomBridgePass = {
    childrenByElement: new WeakMap(),
    geometryByElement: new WeakMap(),
    landmarkCountByElement: new WeakMap(),
    styleByElement: new WeakMap(),
    styleHiddenByElement: new WeakMap(),
    ariaHiddenByElement: new WeakMap(),
    srOnlyByElement: new WeakMap(),
    interactionGatedByElement: new WeakMap(),
  };
  const root = buildNode(
    rootElement,
    null,
    `/${xpathTag(rootElement)}[1]`,
    byElement,
    byKey,
    byXpath,
    pass,
    options,
  );
  if (!root) {
    throw new Error("Unable to build marking DOM bridge view for root element");
  }
  return {
    root: root.evaluationNode,
    byElement,
    byKey,
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
      return original.call(this, { ...init, mode: "open" });
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

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function serializeAttributes(element: Element): string {
  const consentHidden = element.hasAttribute(CONSENT_HIDDEN_ATTR);
  const currentStyle = element.getAttribute("style");
  const safeConsentStyle = consentHidden ? consentStyleForCapture(element) : currentStyle;
  const hasMotionLedger = element.hasAttribute(MOTION_CAPTURE_LEDGER_ATTR);
  const safeMotionStyle = hasMotionLedger
    ? restoreMotionStyleForCapture(element, safeConsentStyle)
    : safeConsentStyle;
  const safeStyle = restoreInteractionShieldStyleForCapture(element, safeMotionStyle);
  const safeInert = restoreInteractionShieldInertForCapture(element);
  const names = element.getAttributeNames()
    .filter((name) => !name.startsWith("data-uf-"));
  if (safeStyle !== null && !names.includes("style")) {
    names.push("style");
  }
  if (safeInert !== null && !names.includes("inert")) {
    names.push("inert");
  }
  return names
    .filter((name) => {
      if (name === "style") return safeStyle !== null;
      if (name === "inert") return safeInert !== null;
      return true;
    })
    .flatMap((name) => {
      let value = name === "style" ? safeStyle ?? ""
        : name === "inert" ? safeInert ?? ""
          : element.getAttribute(name) ?? "";
      if (name === "class") {
        value = sanitizeCaptureClassValue(value, element.tagName);
        if (!value) {
          return [];
        }
      }
      return [` ${name}="${escapeHtmlAttribute(value)}"`];
    })
    .join("");
}

export function captureFlattenedHtml(element: Element): string {
  if (isExtensionUi(element)) {
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
