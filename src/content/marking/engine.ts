import { chooseWidenTarget, type WidenNode } from "../../domain/widening";
import { applySelectorSeed } from "../../domain/selector-seed";
import type { SelectorSet } from "../../storage/config";
import type { CanonicalMarkSet, Classification, MarkMode, MarkRow } from "../../domain/schema/marking";
import {
  evaluatePreview,
  type EvaluationNode,
  type PreviewSelectorMatchContext,
} from "../../domain/evaluate";
import type {
  PreviewProjection,
  PreviewRow,
  PreviewTargetStatus,
} from "../../domain/schema/preview";
import {
  captureFlattenedHtml,
  createDomBridgePresentationRefreshCursor,
  createDomBridgeView,
  type DomBridgeOptions,
  type DomBridgePresentationRefresh,
  type DomBridgeView,
} from "./dom-view";
import { getComposedHitElements } from "./hit-testing";
import { isPaintReachableWithinHits } from "./paint-reachability";
import { createMarkingStore } from "./store";
import { resolveTarget, type MarkingCandidate } from "./resolve";
import {
  createOverlayRenderer,
  hasPaintReachableTargetGeometry,
  hasRenderableTargetGeometry,
  isCurrentlyVisuallyVisible,
  type OverlayRenderTarget,
} from "./renderer";
import { buildSilentHighlights, shallowXpathBoundaries } from "./silent-highlight";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import type { VisibilityGeometry } from "../../domain/visibility";
import { isToggleableBoundary } from "../../domain/boundary";
import { readElementId } from "./element-identity";
import { restoreMotionStyleForCapture } from "./capture-hygiene";
import { presentationClockFor } from "../presentation-clock";

function evaluationNodeFingerprint(node: EvaluationNode): string {
  return [
    node.xpath,
    node.tagName,
    node.visible ? "1" : "0",
    node.ownsDirectText ? "1" : "0",
    node.structuralBoundary ? "1" : "0",
    node.closedShadow ? "1" : "0",
    ...(node.children ?? []).map((child) => child.xpath),
  ].join("\u0000");
}

function createPreviewProjectionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `preview-${uuid}` : `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A rendered box can still be permanently unreachable. Responsive menus often
 * retain a non-zero, nominally visible child while translating the whole branch
 * above or beside the scrollable document. Such a row is useful diagnostic
 * evidence, but advertising it as an interactive Preview target makes keyboard
 * activation promise a focus paint that the renderer can never place.
 *
 * Keep ordinary below-the-fold content available by comparing viewport rects in
 * document coordinates. Viewport-bound fixed descendants are the exception:
 * scrolling cannot move those, so they must intersect the current viewport.
 */
function hasScrollReachablePreviewGeometry(element: Element): boolean {
  const ownerDocument = element.ownerDocument;
  const view = ownerDocument?.defaultView;
  if (!view) {
    return false;
  }
  const scrollingElement = ownerDocument.scrollingElement ?? ownerDocument.documentElement;
  const scrollX = Number(view.scrollX ?? view.pageXOffset ?? scrollingElement?.scrollLeft ?? 0);
  const scrollY = Number(view.scrollY ?? view.pageYOffset ?? scrollingElement?.scrollTop ?? 0);
  const viewportWidth = Number(view.visualViewport?.width ?? view.innerWidth ?? ownerDocument.documentElement?.clientWidth ?? 0);
  const viewportHeight = Number(view.visualViewport?.height ?? view.innerHeight ?? ownerDocument.documentElement?.clientHeight ?? 0);
  const scrollWidth = Number(scrollingElement?.scrollWidth ?? 0);
  const scrollHeight = Number(scrollingElement?.scrollHeight ?? 0);
  let viewportBound = false;
  let current: Element | null = element;
  while (current) {
    if (view.getComputedStyle(current).position === "fixed") {
      viewportBound = true;
      break;
    }
    const rootNode: Node = current.getRootNode();
    const shadowHost: Element | null = "host" in rootNode ? (rootNode as ShadowRoot).host : null;
    current = current.parentElement ?? shadowHost;
  }
  return Array.from(element.getClientRects()).some((rect) => {
    if (viewportBound) {
      return rect.right > 0 && rect.bottom > 0 &&
        (viewportWidth <= 0 || rect.left < viewportWidth) &&
        (viewportHeight <= 0 || rect.top < viewportHeight);
    }
    const documentLeft = rect.left + scrollX;
    const documentTop = rect.top + scrollY;
    const documentRight = rect.right + scrollX;
    const documentBottom = rect.bottom + scrollY;
    return documentRight > 0 && documentBottom > 0 &&
      (scrollWidth <= 0 || documentLeft < scrollWidth) &&
      (scrollHeight <= 0 || documentTop < scrollHeight);
  });
}

function previewTargetStatus(element: Element): PreviewTargetStatus {
  if ((element as Element & { isConnected?: boolean }).isConnected === false) {
    return { state: "unavailable", reason: "detached" };
  }
  if (!hasRenderableTargetGeometry(element)) {
    return { state: "unavailable", reason: "no-rendered-box" };
  }
  if (!isCurrentlyVisuallyVisible(element)) {
    return { state: "unavailable", reason: "not-visible" };
  }
  if (!hasScrollReachablePreviewGeometry(element)) {
    return { state: "unavailable", reason: "not-visible" };
  }
  const view = element.ownerDocument.defaultView;
  const viewportWidth = view?.visualViewport?.width ?? view?.innerWidth ?? 0;
  const viewportHeight = view?.visualViewport?.height ?? view?.innerHeight ?? 0;
  const currentlyInViewport = Array.from(element.getClientRects()).some((rect) =>
    rect.right > 0 && rect.bottom > 0 &&
    (viewportWidth <= 0 || rect.left < viewportWidth) &&
    (viewportHeight <= 0 || rect.top < viewportHeight)
  );
  if (currentlyInViewport && !hasPaintReachableTargetGeometry(element)) {
    return { state: "unavailable", reason: "not-visible" };
  }
  return { state: "available" };
}

const PREVIEW_TEXT_BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const PREVIEW_TEXT_CONTEXTUAL_TAGS = new Set([
  "AUDIO",
  "CANVAS",
  "EMBED",
  "IFRAME",
  "IMG",
  "OBJECT",
  "PATH",
  "PICTURE",
  "SOURCE",
  "SVG",
  "USE",
  "VIDEO",
]);
const PREVIEW_TEXT_LABEL_BOUNDARIES = new Set([
  "A",
  "BUTTON",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LABEL",
  "SUMMARY",
]);
const PREVIEW_TEXT_LABEL_ROLES = new Set([
  "button",
  "heading",
  "img",
  "link",
  "menuitem",
  "option",
  "tab",
]);

function previewTextElementExcluded(element: Element, root: Element): boolean {
  if (PREVIEW_TEXT_BLOCKED_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  const elementId = readElementId(element);
  if (element !== root && (
    element.hasAttribute("data-uf-consent-hidden") ||
    Boolean(element.closest?.("[data-uf-consent-hidden]")) ||
    element.hasAttribute("data-wxt-shadow-root") ||
    element.getAttribute("data-uf-extension-ui") === "true" ||
    element.tagName.toLowerCase() === "browser-mcp-container" ||
    elementId === "browser-mcp-container" ||
    elementId.startsWith("unfluffify-")
  )) {
    return true;
  }
  return element.getAttribute("aria-hidden") === "true" ||
    element.hasAttribute("hidden") ||
    (element as HTMLElement).hidden === true;
}

function normalizePreviewText(value: string): string {
  const withoutControls = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? " "
      : character;
  }).join("");
  return withoutControls
    .replace(/\s+/gu, " ")
    .trim();
}

function previewLinkDestinationLabel(element: Element): string {
  if (element.tagName.toUpperCase() !== "A") {
    return "";
  }
  const href = normalizePreviewText(element.getAttribute("href") ?? "");
  if (!href || href === "#" || /^(?:javascript|mailto|tel):/iu.test(href)) {
    return "";
  }
  let pathname = href;
  try {
    pathname = new URL(
      href,
      element.ownerDocument.baseURI || "https://preview.invalid/",
    ).pathname;
  } catch {
    // A malformed authored URL can still expose a useful final path segment.
  }
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Preserve the authored segment when percent decoding fails.
  }
  return normalizePreviewText(decoded.replace(/[-_]+/gu, " "));
}

type PreviewTextMetadata = Readonly<{
  text: string;
  hasExcludedDescendant: boolean;
}>;

function boundedPreviewText(value: string): string {
  const codePoints = Array.from(normalizePreviewText(value));
  return codePoints.length > 80 ? `${codePoints.slice(0, 77).join("")}...` : codePoints.join("");
}

/** Builds all readable row labels bottom-up in one bounded composed-tree pass.
 * Subtree text is capped because row labels never expose more than 80 code
 * points; retaining every ancestor's full descendant text would recreate an
 * O(N²) allocation pattern on deeply nested pages. */
export function buildPreviewTextMetadata(root: Element): WeakMap<Element, PreviewTextMetadata> {
  const metadata = new WeakMap<Element, PreviewTextMetadata>();
  type StoredMetadata = PreviewTextMetadata & Readonly<{
    subtreeText: string;
    semanticText: string;
  }>;
  const storedMetadata = new WeakMap<Element, StoredMetadata>();
  const branchExclusion = new WeakMap<Element, boolean>();
  const composedParent = (element: Element): Element | null => {
    if (element.parentElement) return element.parentElement;
    const nodeRoot = element.getRootNode?.();
    return nodeRoot && "host" in nodeRoot ? (nodeRoot as ShadowRoot).host : null;
  };
  const excludedOwnedBranch = (element: Element): boolean => {
    const cached = branchExclusion.get(element);
    if (cached !== undefined) return cached;
    const path: Element[] = [];
    let cursor: Element | null = element;
    let excluded = false;
    while (cursor) {
      const known = branchExclusion.get(cursor);
      if (known !== undefined) {
        excluded = known;
        break;
      }
      path.push(cursor);
      if (
        cursor.hasAttribute("data-uf-consent-hidden") ||
        cursor.getAttribute("data-uf-extension-ui") === "true"
      ) {
        excluded = true;
        break;
      }
      cursor = composedParent(cursor);
    }
    for (const visited of path) branchExclusion.set(visited, excluded);
    return excluded;
  };
  const excludedChild = (element: Element): boolean => {
    const elementId = readElementId(element);
    return PREVIEW_TEXT_BLOCKED_TAGS.has(element.tagName.toUpperCase()) ||
      excludedOwnedBranch(element) ||
      element.hasAttribute("data-wxt-shadow-root") ||
      element.tagName.toLowerCase() === "browser-mcp-container" ||
      elementId === "browser-mcp-container" ||
      elementId.startsWith("unfluffify-") ||
      element.getAttribute("aria-hidden") === "true" ||
      element.hasAttribute("hidden") ||
      (element as HTMLElement).hidden === true;
  };
  const composedNodes = (element: Element): Node[] => {
    const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    const children = shadowRoot ? Array.from(shadowRoot.childNodes) : Array.from(element.childNodes);
    return children.flatMap((child) => {
      if (
        child.nodeType !== 1 ||
        (child as Element).tagName.toUpperCase() !== "SLOT" ||
        typeof (child as HTMLSlotElement).assignedNodes !== "function"
      ) return [child];
      let assigned: Node[] = [];
      try {
        assigned = (child as HTMLSlotElement).assignedNodes({ flatten: true });
      } catch {
        // A realm-specific slot implementation can reject flattening.
      }
      return assigned.length > 0 ? assigned : Array.from(child.childNodes);
    });
  };
  const nodesByElement = new WeakMap<Element, readonly Node[]>();
  const seen = new Set<Element>();
  const stack: Array<Readonly<{ element: Element; exit: boolean }>> = [{ element: root, exit: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const element = frame.element;
    if (!frame.exit) {
      if (seen.has(element)) continue;
      seen.add(element);
      const nodes = previewTextElementExcluded(element, element) ? [] : composedNodes(element);
      nodesByElement.set(element, nodes);
      stack.push({ element, exit: true });
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (
          node?.nodeType === 1 &&
          !excludedChild(node as Element)
        ) stack.push({ element: node as Element, exit: false });
      }
      continue;
    }
    let subtreeText = "";
    let hasExcludedDescendant = false;
    const descendantSemanticTexts = new Set<string>();
    const append = (value: string): void => {
      if (!value || subtreeText.endsWith("...")) return;
      subtreeText = boundedPreviewText(`${subtreeText}${subtreeText ? " " : ""}${value}`);
    };
    for (const node of nodesByElement.get(element) ?? []) {
      if (node.nodeType === 3) {
        append(node.textContent ?? "");
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (excludedChild(child)) {
        hasExcludedDescendant = true;
        continue;
      }
      const childMetadata = storedMetadata.get(child);
      if (!childMetadata) continue;
      hasExcludedDescendant ||= childMetadata.hasExcludedDescendant;
      append(childMetadata.subtreeText);
      if (childMetadata.semanticText) descendantSemanticTexts.add(childMetadata.semanticText);
    }
    const explicitText = normalizePreviewText(element.getAttribute("aria-label") ?? "") ||
      normalizePreviewText(element.getAttribute("alt") ?? "") ||
      normalizePreviewText(element.getAttribute("title") ?? "") ||
      // A placeholder is frequently the only human-readable name exposed by
      // search and filter controls. Keep it behind the stronger accessible
      // labels above and never fall back to the live value, which may contain
      // operator-entered or otherwise sensitive content.
      normalizePreviewText(element.getAttribute("placeholder") ?? "");
    const inheritedSemanticText = descendantSemanticTexts.size === 1
      ? descendantSemanticTexts.values().next().value ?? ""
      : "";
    const semanticText = subtreeText || explicitText ||
      previewLinkDestinationLabel(element) || inheritedSemanticText;
    const text = semanticText || element.tagName.toLowerCase();
    const stored = {
      text: boundedPreviewText(text),
      subtreeText,
      semanticText: boundedPreviewText(semanticText),
      hasExcludedDescendant,
    };
    storedMetadata.set(element, stored);
    metadata.set(element, stored);
  }
  // A visual primitive often owns the selector/marking row while its human
  // name belongs to the surrounding link or button (for example an unlabeled
  // SVG next to "Contact us"). Preserve the exact target identity, but inherit
  // the nearest semantic control label instead of exposing "svg"/"path" in
  // the production Content List. The completed post-order metadata makes this
  // a bounded ancestor walk with no layout reads or descendant rescans.
  for (const element of seen) {
    const stored = storedMetadata.get(element);
    const tagName = element.tagName.toUpperCase();
    if (
      !stored ||
      stored.subtreeText ||
      !PREVIEW_TEXT_CONTEXTUAL_TAGS.has(tagName) ||
      stored.text !== tagName.toLowerCase()
    ) continue;
    let cursor = composedParent(element);
    while (cursor) {
      const cursorTagName = cursor.tagName.toUpperCase();
      if (cursorTagName === "BODY" || cursorTagName === "HTML") break;
      const explicitLabel = normalizePreviewText(cursor.getAttribute("aria-label") ?? "") ||
        normalizePreviewText(cursor.getAttribute("title") ?? "");
      const contextual = storedMetadata.get(cursor)?.semanticText ?? "";
      const semanticBoundary = PREVIEW_TEXT_LABEL_BOUNDARIES.has(cursorTagName) ||
        PREVIEW_TEXT_LABEL_ROLES.has((cursor.getAttribute("role") ?? "").trim().toLowerCase());
      const label = explicitLabel || (semanticBoundary ? contextual : "");
      if (label) {
        const updated = { ...stored, text: boundedPreviewText(label) };
        storedMetadata.set(element, updated);
        metadata.set(element, updated);
        break;
      }
      cursor = composedParent(cursor);
    }
  }
  return metadata;
}

export function previewTextForElement(element: Element): string {
  return buildPreviewTextMetadata(element).get(element)?.text ?? element.tagName.toLowerCase();
}

function buildCandidateIndex(
  root: EvaluationNode,
  evaluation: ReadonlyMap<string, Classification>,
  rows: readonly MarkRow[],
): Map<string, MarkingCandidate> {
  const byXpath = new Map<string, MarkingCandidate>();
  const rowsByXpath = new Map(rows.map((row) => [row.xpath, row]));
  const visit = (node: EvaluationNode, parent: MarkingCandidate | null): MarkingCandidate => {
  const classification = evaluation.get(node.xpath);
    const ownRow = rowsByXpath.get(node.xpath);
    const candidate = {
    key: node.key,
    xpath: node.xpath,
    selfMarkable: isToggleableBoundary(node, { hasOwnMark: () => Boolean(ownRow) }),
    excluded: classification === "exception",
    explicitInclude: ownRow?.excluded === false && ownRow.explicit === true,
    explicitExclude: ownRow?.excluded === true && ownRow.explicit === true,
    closedShadow: node.closedShadow,
      ownsDirectText: node.ownsDirectText,
      parent,
      children: [] as MarkingCandidate[],
    } satisfies MarkingCandidate;
    byXpath.set(node.xpath, candidate);
    candidate.children.push(...(node.children ?? []).map((child) => visit(child, candidate)));
    return candidate;
  };
  visit(root, null);
  return byXpath;
}

function composedContains(root: Element, element: Element): boolean {
  let cursor: Node | null = element;
  while (cursor) {
    if (cursor === root) {
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

function toWidenNode(
  node: EvaluationNode,
  parent: WidenNode | null,
  byKey: Map<string, WidenNode>,
): WidenNode {
  const widenNode = {
    key: node.key,
    tagName: node.tagName,
    depthFromBody: node.xpath.split("/").length - 3,
    visible: node.visible,
    ownsDirectText: node.ownsDirectText,
    structuralRole: node.structuralRole ?? (node.structuralBoundary ? "card-group" as const : "generic" as const),
    pageShell: node.pageShell,
    landmarkCount: node.landmarkCount,
    textualMarkableContentCount: node.ownsDirectText ? 1 : undefined,
    parent,
    children: [] as WidenNode[],
  };
  byKey.set(node.key, widenNode);
  byKey.set(node.xpath, widenNode);
  widenNode.children = (node.children ?? []).map((child) => toWidenNode(child, widenNode, byKey));
  return widenNode;
}

function collectDefaultExclusionRows(node: EvaluationNode, rows: MarkRow[] = []): MarkRow[] {
  if (
    isToggleableDefaultTag(node.tagName) &&
    node.visible &&
    !node.chrome &&
    !node.immutable &&
    !node.closedShadow
  ) {
    rows.push({ xpath: node.xpath, excluded: true });
  }
  for (const child of node.children ?? []) {
    collectDefaultExclusionRows(child, rows);
  }
  return rows;
}

function geometryForElement(element: Element): VisibilityGeometry {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  const htmlElement = element as HTMLElement;
  const lineClamp = style?.webkitLineClamp ? Number.parseInt(style.webkitLineClamp, 10) : 0;
  return {
    rect: {
      left: rect.left,
      top: rect.top + (view?.scrollY ?? view?.pageYOffset ?? 0),
      width: rect.width,
      height: rect.height,
    },
    style: {
      display: style?.display,
      visibility: style?.visibility,
      opacity: style?.opacity === undefined ? undefined : Number(style.opacity),
      hidden: htmlElement.hidden === true,
      ariaHidden: element.getAttribute("aria-hidden") === "true",
      overflowY: style?.overflowY,
      clientHeight: htmlElement.clientHeight,
      scrollHeight: htmlElement.scrollHeight,
      webkitLineClamp: Number.isFinite(lineClamp) ? lineClamp : 0,
      textContent: element.textContent ?? "",
    },
    viewportWidth: view?.innerWidth,
    pageHeight: element.ownerDocument.documentElement.scrollHeight,
  };
}

function mergeDefaultExclusions(root: EvaluationNode, markSet: CanonicalMarkSet = { rows: [] }): CanonicalMarkSet {
  const rows = [...markSet.rows];
  const existing = new Set(rows.map((row) => row.xpath));
  for (const row of collectDefaultExclusionRows(root)) {
    if (!existing.has(row.xpath)) {
      rows.push(row);
      existing.add(row.xpath);
    }
  }
  return { rows };
}

export type MarkingEngineWorkStage =
  | "bridge"
  | "store-evaluate"
  | "candidate-index"
  | "marking-render"
  | "silent-render";

export type MarkingEngineInstrumentation = Readonly<{
  /** Test seam: the returned bridge is the bridge the engine actually uses. */
  createBridge?: (rootElement: Element, options?: DomBridgeOptions) => DomBridgeView;
  /** Test seam: the returned renderer receives every engine render operation. */
  createRenderer?: typeof createOverlayRenderer;
  onWorkStage?: (stage: MarkingEngineWorkStage) => void;
}>;

export type MarkingEngineInitializationOptions = Readonly<{
  selectors?: SelectorSet | null;
  render?: boolean;
  instrumentation?: MarkingEngineInstrumentation;
}>;

export type MarkingEngineRefreshOptions = Readonly<{
  selectors?: SelectorSet | null;
  render?: boolean;
}>;

export type MarkingPointResolutionHint = Readonly<{
  /** Current extension-owned classification rectangle under the pointer. */
  overlayXpath: string;
}>;

// Presentation adoption already performs immutable-tree/store/index work. Keep
// any geometry-bearing branch repaint larger than a modest viewport corpus on
// its own frame; combining a 100-200 target repaint with adoption crossed the
// 50 ms input-task budget on responsive commerce pages even though each half
// was independently bounded.
const DEFERRED_BRANCH_RENDER_TARGET_THRESHOLD = 48;
// Geometry reconciliation is layout- and paint-reachability-heavy on large
// documents. Keep each presentation task below one frame's useful work while
// the retained overlay root is faded, then publish the complete generation in
// one atomic reveal. This is deliberately target-count bounded rather than
// timing based so production and deterministic test clocks follow one path.
// Native paint reachability (`elementsFromPoint`) and layout can dominate the
// JavaScript around a geometry pass. Keep both the single-frame fast path and
// every progressive chunk below the measured 50 ms input-frame budget even on
// a layout-heavy responsive page.
const PROGRESSIVE_GEOMETRY_TARGET_THRESHOLD = 6;
const PROGRESSIVE_GEOMETRY_CHUNK_SIZE = 2;
// Newly inserted or removed content needs to become markable on roughly the
// same cadence as the legacy renderer. Presentation attributes are noisier
// (carousels commonly emit them in short trains), so retain the longer quiet
// window for those records without making authoritative child-list changes pay
// that latency on every refresh.
const STRUCTURAL_CHILD_LIST_QUIET_MS = 100;
// Responsive scripts commonly publish the probe posture and restore it within
// the legacy 250 ms marking quiet window. Keep the first oldValue across that
// whole train so A -> B -> A class/style churn terminalizes as net-zero instead
// of evaluating the complete marking tree twice during one resize gesture.
const STRUCTURAL_PRESENTATION_QUIET_MS = 250;
const STRUCTURAL_MUTATION_IDLE_TIMEOUT_MS = 1_200;
const PROGRESSIVE_PRESENTATION_TARGET_THRESHOLD = 96;
const PROGRESSIVE_PRESENTATION_CHUNK_SIZE = 48;
// Pinned legacy restores interactive marking at roughly 250 ms. Begin the
// rewrite's frame-fenced repaint at 230 ms so its paint frame lands in that
// same visual window instead of adding a frame after it. Silent preview keeps
// the legacy 120 ms quiet transaction. A resize does not need the marking
// scroll dwell, but it still needs one shared trailing transaction because
// Chromium can report the same physical change through Window,
// VisualViewport, and ResizeObserver.
const SILENT_VIEWPORT_GEOMETRY_QUIET_MS = 120;
const MARKING_VIEWPORT_SCROLL_QUIET_MS = 230;
const MARKING_VIEWPORT_RESIZE_QUIET_MS = 50;
const PRESENTATION_MUTATION_ATTRIBUTES = new Set([
  "class",
  "style",
  "hidden",
  "open",
  "aria-hidden",
  "aria-expanded",
]);

/**
 * Resolve both selector groups against the already captured composed DOM. This is
 * deliberately bridge-first: document.querySelectorAll cannot enter shadow roots,
 * while an Element can answer whether it matches regardless of how it was reached.
 */
type BridgeSelectorSeed = Readonly<{
  excludeXpaths: readonly string[];
  includeXpaths: readonly string[];
  seeded: boolean;
  matches: PreviewSelectorMatchContext;
}>;

function selectorSeedForBridge(
  bridge: DomBridgeView,
  selectors: SelectorSet | null | undefined,
): BridgeSelectorSeed {
  if (!selectors) {
    return {
      excludeXpaths: [],
      includeXpaths: [],
      seeded: false,
      matches: {
        inclusionSelectorByKey: new Map(),
        exclusionSelectorByKey: new Map(),
      },
    };
  }
  const excludeXpaths: string[] = [];
  const includeXpaths: string[] = [];
  const inclusionSelectorByKey = new Map<string, string>();
  const exclusionSelectorByKey = new Map<string, string>();
  const documentMatches = (candidates: readonly string[]): Map<Element, string> => {
    const matches = new Map<Element, string>();
    const ownerDocument = bridge.byXpath.values().next().value?.element.ownerDocument;
    if (!ownerDocument?.querySelectorAll) {
      return matches;
    }
    for (const selector of candidates) {
      // `:scope` is relative to the query receiver. The former implementation
      // queried the owner document before checking each bridge element, so a
      // document-scoped selector such as `:scope > body > main` cannot be
      // represented by Element.matches alone (where every element is its own
      // scope). Retain that narrow compatibility path without restoring a
      // whole-document query for ordinary selectors.
      if (!/:scope\b/i.test(selector)) {
        continue;
      }
      try {
        for (const element of ownerDocument.querySelectorAll(selector)) {
          if (!matches.has(element)) {
            matches.set(element, selector);
          }
        }
      } catch {
        // Invalid selectors remain isolated from the rest of the seed set.
      }
    }
    return matches;
  };
  const documentExcludeMatches = documentMatches(selectors.exclusionSelectors);
  const documentIncludeMatches = documentMatches(selectors.inclusionSelectors);
  const matchesAny = (
    element: Element,
    candidates: readonly string[],
    scopedDocumentMatches: ReadonlyMap<Element, string>,
  ): string | undefined => {
    const scopedSelector = scopedDocumentMatches.get(element);
    if (scopedSelector) {
      return scopedSelector;
    }
    for (const selector of candidates) {
      try {
        if (element.matches?.(selector)) {
          return selector;
        }
      } catch {
        // One invalid or realm-specific selector must not block the remaining
        // selector set or the initialization transaction.
      }
    }
    return undefined;
  };
  for (const [xpath, entry] of bridge.byXpath) {
    const exclusionSelector = matchesAny(entry.element, selectors.exclusionSelectors, documentExcludeMatches);
    if (exclusionSelector) {
      excludeXpaths.push(xpath);
      exclusionSelectorByKey.set(entry.evaluationNode.key, exclusionSelector);
    }
    const inclusionSelector = matchesAny(entry.element, selectors.inclusionSelectors, documentIncludeMatches);
    if (inclusionSelector) {
      includeXpaths.push(xpath);
      inclusionSelectorByKey.set(entry.evaluationNode.key, inclusionSelector);
    }
  }
  return {
    excludeXpaths,
    includeXpaths,
    seeded: excludeXpaths.length > 0 || includeXpaths.length > 0,
    matches: {
      inclusionSelectorByKey,
      exclusionSelectorByKey,
    },
  };
}

function initialMarksForBridge(
  bridge: DomBridgeView,
  previousMarks: CanonicalMarkSet,
  selectors: SelectorSet | null | undefined,
): Readonly<{ marks: CanonicalMarkSet; selectorsSeeded: boolean }> {
  const defaults = mergeDefaultExclusions(bridge.root, previousMarks);
  const seed = selectorSeedForBridge(bridge, selectors);
  return {
    // applySelectorSeed applies exclusions first and inclusions second, preserving
    // the established include-wins rule when both groups match one element.
    marks: seed.seeded ? applySelectorSeed(defaults, seed) : defaults,
    selectorsSeeded: seed.seeded,
  };
}

/** Some storefront layouts put preview targets below an overflow-clipped
 * responsive wrapper. Chromium then reports a successful native
 * `scrollIntoView()` call without moving the root document. Keep the native
 * path for nested scrollers, then repair only a still-offscreen vertical
 * target on the next captured frame when native smooth scrolling truly did
 * not begin. */
function scrollPreviewTargetIntoView(element: Element): () => void {
  const initialRect = element.getBoundingClientRect?.();
  const ownerDocument = element.ownerDocument;
  const scrollingElement = ownerDocument?.scrollingElement ?? ownerDocument?.documentElement;
  const initialScrollTop = scrollingElement?.scrollTop ?? 0;
  element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
  return () => {
    const rect = element.getBoundingClientRect?.();
    const view = ownerDocument?.defaultView;
    const viewportHeight = view?.visualViewport?.height ??
      view?.innerHeight ??
      ownerDocument?.documentElement?.clientHeight ??
      0;
    if (
      !rect ||
      rect.height <= 0 ||
      viewportHeight <= 0 ||
      (rect.top >= 0 && rect.bottom <= viewportHeight) ||
      !scrollingElement
    ) {
      return;
    }
    const nativeScrollStarted = scrollingElement.scrollTop !== initialScrollTop ||
      (initialRect ? Math.abs(rect.top - initialRect.top) > 1 : false);
    if (nativeScrollStarted) {
      return;
    }
    const currentTop = scrollingElement.scrollTop;
    const centeredOffset = Math.max(0, (viewportHeight - rect.height) / 2);
    scrollingElement.scrollTop = Math.max(0, currentTop + rect.top - centeredOffset);
  };
}

export function createMarkingEngine(
  rootElement: Element,
  options: MarkingEngineInitializationOptions = {},
) {
  const presentationClock = presentationClockFor(rootElement.ownerDocument.defaultView);
  const instrumentation = options.instrumentation;
  const debugWorkTiming = typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__;
  let workStageStartedAt = globalThis.performance?.now?.() ?? Date.now();
  const beginWorkCycle = (): void => {
    workStageStartedAt = globalThis.performance?.now?.() ?? Date.now();
  };
  const reportWorkStage = (stage: MarkingEngineWorkStage): void => {
    instrumentation?.onWorkStage?.(stage);
    if (!debugWorkTiming) {
      return;
    }
    const now = globalThis.performance?.now?.() ?? Date.now();
    const debugGlobal = globalThis as typeof globalThis & {
      __UF_MARKING_WORK_STAGES__?: Array<Readonly<{ stage: MarkingEngineWorkStage; durationMs: number }>>;
    };
    const durationMs = Math.round((now - workStageStartedAt) * 10) / 10;
    const stages = debugGlobal.__UF_MARKING_WORK_STAGES__ ?? [];
    stages.push({ stage, durationMs });
    debugGlobal.__UF_MARKING_WORK_STAGES__ = stages.slice(-40);
    console.debug("[Unfluffify][marking-work]", {
      stage,
      durationMs,
    });
    workStageStartedAt = now;
  };
  const previewIdentityNamespace = createPreviewProjectionId();
  let previewOccurrence = 0;
  let activePreviewProjectionId: string | null = null;
  const previewIdByElement = new WeakMap<Element, string>();
  let nextPreviewId = 0;
  const keyForElement = (element: Element): string => {
    const existing = previewIdByElement.get(element);
    if (existing) {
      return existing;
    }
    nextPreviewId += 1;
    const id = `${previewIdentityNamespace}-row-${nextPreviewId}`;
    previewIdByElement.set(element, id);
    return id;
  };
  const bridgeOptions: DomBridgeOptions = { keyForElement };
  const buildBridge = (): DomBridgeView => {
    const nextBridge = instrumentation?.createBridge
      ? instrumentation.createBridge(rootElement, bridgeOptions)
      : createDomBridgeView(rootElement, bridgeOptions);
    reportWorkStage("bridge");
    return nextBridge;
  };
  beginWorkCycle();
  let bridge: DomBridgeView = buildBridge();
  const initial = initialMarksForBridge(bridge, { rows: [] }, options.selectors);
  let lastInitializationSeededSelectors = initial.selectorsSeeded;
  let store = createMarkingStore({ root: bridge.root }, initial.marks);
  reportWorkStage("store-evaluate");
  const renderer = (instrumentation?.createRenderer ?? createOverlayRenderer)({
    document: rootElement.ownerDocument,
  });
  let observerCleanup: (() => void) | null = null;
  let renderScheduled = false;
  let renderFrameHandle = 0;
  let disposed = false;
  let revealMarkingAfterRender = false;
  type RenderWork = "geometry" | "silent-geometry" | "structural";
  let scheduledWork: RenderWork | null = null;
  let structuralRenderSettled: (() => void) | null = null;
  let silentHighlightsArmed = false;
  // Silent borders can also be armed on top of the interactive marking UI, so
  // they cannot identify which scroll debounce the engine should use.
  let interactiveMarkingRendered = options.render === true;
  let hoverResolution: Readonly<{
    x: number;
    y: number;
    mode: MarkMode;
    shiftActive: boolean;
    overlayXpath: string;
    generation: number;
    node: EvaluationNode | null;
    probeElements: readonly Element[];
  }> | null = null;
  let prefetchedPointHits: Readonly<{
    x: number;
    y: number;
    elements: readonly Element[];
  }> | null = null;
  let candidateByXpath: Map<string, MarkingCandidate> | null = null;
  let overlayTargets = new Map<string, OverlayRenderTarget>();
  let widenByKey = new Map<string, WidenNode>();
  let bridgeGeneration = 0;
  let deferredBranchRenderHandle: number | null = null;
  let deferredBranchRenderGeneration = 0;
  let deferredBranchTargets = new Map<string, OverlayRenderTarget>();
  const deferredBranchAffectedXpaths = new Set<string>();
  let progressiveGeometryRenderHandle: number | null = null;
  let progressiveGeometryCycle = 0;
  let progressiveGeometryActive = false;
  let progressiveGeometryFollowup: Exclude<RenderWork, "structural"> | null = null;
  let targetIntersectionObserver: IntersectionObserver | null = null;
  let intersectionSnapshotReady = false;
  let incompleteIntersectionFallbackUsed = false;
  let intersectionByElement = new WeakMap<Element, boolean>();
  const pendingIntersectionElements = new Set<Element>();
  const intersectingXpaths = new Set<string>();
  const intersectionDirtyXpaths = new Set<string>();
  let previewRevision = 0;
  let previewTextMetadata = new WeakMap<Element, PreviewTextMetadata>();
  let toggleInProgress = false;
  let previewEmphasizedRowId: string | null = null;
  let previewFocusRefreshHandle: number | null = null;
  let previewFocusRefreshCycle = 0;
  let lastPreviewRequest: Readonly<{ pageUrl: string; selectors: SelectorSet }> | null = null;
  let currentPreviewProjection: PreviewProjection | null = null;
  const generationByNode = new WeakMap<EvaluationNode, number>();
  const fingerprintByNode = new WeakMap<EvaluationNode, string>();
  const elementByNode = new WeakMap<EvaluationNode, Element>();

  const cancelProgressiveGeometryRender = (): boolean => {
    progressiveGeometryCycle += 1;
    const wasActive = progressiveGeometryActive || progressiveGeometryRenderHandle !== null;
    progressiveGeometryActive = false;
    progressiveGeometryFollowup = null;
    if (progressiveGeometryRenderHandle !== null) {
      presentationClock.cancelFrame(progressiveGeometryRenderHandle);
      progressiveGeometryRenderHandle = null;
    }
    return wasActive;
  };

  const rebindIntersectionTargets = (): void => {
    if (!targetIntersectionObserver) {
      return;
    }
    targetIntersectionObserver.disconnect();
    intersectionSnapshotReady = false;
    incompleteIntersectionFallbackUsed = false;
    intersectionByElement = new WeakMap<Element, boolean>();
    pendingIntersectionElements.clear();
    intersectingXpaths.clear();
    intersectionDirtyXpaths.clear();
    for (const target of overlayTargets.values()) {
      pendingIntersectionElements.add(target.element);
      targetIntersectionObserver.observe(target.element);
    }
  };

  const viewportGeometryTargets = (): ReadonlyMap<string, OverlayRenderTarget> => {
    if (!targetIntersectionObserver) {
      return byXpathElements();
    }
    const targets = new Map<string, OverlayRenderTarget>();
    const presentationXpaths = renderer.viewportPresentationXpaths();
    const retainTarget = (xpath: string): void => {
      if (!presentationXpaths.has(xpath)) return;
      const target = overlayTargets.get(xpath);
      if (target) {
        targets.set(xpath, target);
      }
    };
    // A viewport transaction only has to move or retire presentation that is
    // already painted. IntersectionObserver boundary changes below admit the
    // newly entering targets. Reprocessing every stable intersecting source is
    // both redundant and pathological on dense commerce pages: hundreds of
    // transparent/nested sources can be intersecting while only a few dozen
    // boxes are paint-reachable, keeping the whole layer faded for seconds.
    for (const xpath of renderer.retainedViewportXpaths()) {
      retainTarget(xpath);
    }
    if (!intersectionSnapshotReady) {
      // IntersectionObserver is allowed to deliver a large observed corpus in
      // several tasks. Falling back to every bridge target while that snapshot
      // is incomplete turns one viewport scroll into document-scale geometry
      // work and can keep the retained layer faded for seconds. The currently
      // painted corpus is the exact safe fallback: it covers every stale box
      // that must move or disappear, while partial positive observations admit
      // newly entering targets. Once the initial snapshot closes, the observer
      // schedules one bounded authoritative follow-up below.
      incompleteIntersectionFallbackUsed = true;
      for (const xpath of intersectingXpaths) {
        retainTarget(xpath);
      }
    } else {
      incompleteIntersectionFallbackUsed = false;
    }
    for (const xpath of intersectionDirtyXpaths) {
      retainTarget(xpath);
    }
    intersectionDirtyXpaths.clear();
    return targets;
  };

  const rebuildBridgeIndexes = (indexOptions: Readonly<{
    refreshPreviewTextMetadata?: boolean;
    rebindIntersections?: boolean;
  }> = {}): void => {
    bridgeGeneration += 1;
    if (indexOptions.refreshPreviewTextMetadata !== false) {
      previewTextMetadata = buildPreviewTextMetadata(rootElement);
    }
    overlayTargets = new Map([...bridge.byXpath].map(([xpath, value]) => [xpath, {
      element: value.element,
      visible: value.evaluationNode.visible,
    }]));
    widenByKey = new Map<string, WidenNode>();
    toWidenNode(bridge.root, null, widenByKey);
    for (const { evaluationNode, element } of bridge.byXpath.values()) {
      generationByNode.set(evaluationNode, bridgeGeneration);
      fingerprintByNode.set(evaluationNode, evaluationNodeFingerprint(evaluationNode));
      elementByNode.set(evaluationNode, element);
    }
    const evaluation = store.currentEvaluation();
    candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
    if (indexOptions.rebindIntersections !== false) {
      rebindIntersectionTargets();
    }
    reportWorkStage("candidate-index");
  };

  const currentCandidateIndex = (): Map<string, MarkingCandidate> => {
    if (!candidateByXpath) {
      const evaluation = store.currentEvaluation();
      candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
      reportWorkStage("candidate-index");
    }
    return candidateByXpath;
  };

  const currentNodeForHint = (xpath: string): EvaluationNode | null => {
    const entry = bridge.byXpath.get(xpath);
    const node = entry?.evaluationNode;
    const element = entry?.element as (Element & { isConnected?: boolean }) | undefined;
    return node &&
      generationByNode.get(node) === bridgeGeneration &&
      fingerprintByNode.get(node) === evaluationNodeFingerprint(node) &&
      element?.isConnected !== false
      ? node
      : null;
  };

  const currentInteractionEntry = (
    hint: EvaluationNode,
    stage: "acknowledge" | "toggle" | "clear" | "has-explicit",
  ): Readonly<{
    node: EvaluationNode;
    element: Element;
  }> | null => {
    const originalElement = elementByNode.get(hint);
    const current = bridge.byKey.get(hint.key);
    const node = current?.evaluationNode;
    const element = current?.element as (Element & { isConnected?: boolean }) | undefined;
    // A bridge refresh creates new EvaluationNode objects even when the same
    // physical Element survives. Rebind that identity-preserving case across
    // the frame/task acknowledgement boundary, but never let a recycled XPath
    // or instrumentation key transfer a gesture to a replacement element.
    const rebound = originalElement &&
      element === originalElement &&
      node &&
      generationByNode.get(node) === bridgeGeneration &&
      fingerprintByNode.get(node) === evaluationNodeFingerprint(node) &&
      element.isConnected !== false
      ? { node, element }
      : null;
    if (!rebound && debugWorkTiming) {
      console.debug("[Unfluffify][marking-interaction]", JSON.stringify({
        stage,
        outcome: "rejected",
        hintKey: hint.key,
        hintXpath: hint.xpath,
        currentKey: node?.key ?? null,
        currentXpath: node?.xpath ?? null,
        originalElementKnown: Boolean(originalElement),
        currentEntryKnown: Boolean(current),
        sameElement: Boolean(originalElement && element === originalElement),
        currentGeneration: node ? generationByNode.get(node) ?? null : null,
        bridgeGeneration,
        fingerprintCurrent: Boolean(node && fingerprintByNode.get(node) === evaluationNodeFingerprint(node)),
        connected: element?.isConnected !== false,
      }));
    }
    return rebound;
  };

  const sameElements = (left: readonly Element[], right: readonly Element[]): boolean =>
    left.length === right.length && left.every((element, index) => element === right[index]);

  const buildPreviewProjection = (pageUrl: string, selectors: SelectorSet): PreviewProjection => {
    if (!activePreviewProjectionId) {
      previewOccurrence += 1;
      activePreviewProjectionId = `${previewIdentityNamespace}-occurrence-${previewOccurrence}`;
    }
    const seed = selectorSeedForBridge(bridge, selectors);
    const defaults = mergeDefaultExclusions(bridge.root, { rows: [] });
    const marks = seed.seeded ? applySelectorSeed(defaults, seed) : defaults;
    const evaluated = evaluatePreview(marks, { root: bridge.root }, seed.matches);
    const rows: PreviewRow[] = evaluated.flatMap((row) => {
      const entry = bridge.byKey.get(row.id);
      if (!entry) {
        return [];
      }
      return [{
        id: row.id,
        classification: row.classification,
        text: previewTextMetadata.get(entry.element)?.text ?? previewTextForElement(entry.element),
        xpath: row.xpath,
        ...(row.selector ? { selector: row.selector } : {}),
        shadow: entry.evaluationNode.shadow ?? "light",
        target: previewTargetStatus(entry.element),
      }];
    });
    return {
      projectionId: activePreviewProjectionId,
      // A selector-only reprojection is just as material as a DOM rebase. Keep
      // one monotonic projection clock so consumers can adopt either change
      // without relying on XPath or selector equality heuristics.
      revision: ++previewRevision,
      pageUrl,
      rows,
    };
  };

  const refreshCurrentPreviewProjection = (): void => {
    if (!lastPreviewRequest) {
      return;
    }
    currentPreviewProjection = buildPreviewProjection(
      lastPreviewRequest.pageUrl,
      lastPreviewRequest.selectors,
    );
  };

  const reconcilePreviewEmphasis = (): void => {
    const rowId = previewEmphasizedRowId;
    if (!rowId) {
      return;
    }
    const rowStillProjected = currentPreviewProjection?.rows.some((row) => row.id === rowId) === true;
    const target = rowStillProjected ? bridge.byKey.get(rowId) : undefined;
    if (!target || (target.element as Element & { isConnected?: boolean }).isConnected === false) {
      previewEmphasizedRowId = null;
      renderer.setFocus(null);
      return;
    }
    // The Element identity can survive while its positional XPath changes. Move
    // the physical emphasis to the freshly bridged element/current diagnostic.
    renderer.setFocus(target.element, target.evaluationNode.xpath);
  };

  const cancelPreviewFocusRefresh = (): void => {
    previewFocusRefreshCycle += 1;
    if (previewFocusRefreshHandle !== null) {
      presentationClock.cancelFrame(previewFocusRefreshHandle);
      previewFocusRefreshHandle = null;
    }
  };

  const focusAfterPreviewScroll = (
    element: Element,
    xpath: string,
    rowFence: Readonly<{ projectionId: string; rowId: string }> | null = null,
  ): void => {
    cancelPreviewFocusRefresh();
    const cycle = previewFocusRefreshCycle;
    const generation = bridgeGeneration;
    const repairIgnoredNativeScroll = scrollPreviewTargetIntoView(element);
    let focusCommitted = false;
    let remainingFrames = 2;
    const refresh = (): void => {
      previewFocusRefreshHandle = null;
      const exactTargetStillCurrent =
        !disposed &&
        cycle === previewFocusRefreshCycle &&
        generation === bridgeGeneration &&
        bridge.byXpath.get(xpath)?.element === element &&
        (element as Element & { isConnected?: boolean }).isConnected !== false;
      const exactRowStillCurrent = !rowFence || (
        previewEmphasizedRowId === rowFence.rowId &&
        currentPreviewProjection?.projectionId === rowFence.projectionId &&
        currentPreviewProjection.rows.some((row) => row.id === rowFence.rowId)
      );
      if (!exactTargetStillCurrent || !exactRowStillCurrent) {
        return;
      }
      if (!focusCommitted) {
        // Give native smooth scrolling one captured frame to begin. Only then
        // repair storefronts that ignored scrollIntoView, and paint focus from
        // the resulting geometry rather than the stale pre-scroll box.
        repairIgnoredNativeScroll();
        renderer.setFocus(element, xpath);
        focusCommitted = true;
      }
      // A row can already own focus because pointer hover precedes click. Force
      // a fresh measurement after the scroll even when setFocus therefore
      // no-ops.
      renderer.refreshFocus();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        const handle = presentationClock.requestFrame(refresh);
        previewFocusRefreshHandle = handle || null;
      }
    };
    const handle = presentationClock.requestFrame(refresh);
    previewFocusRefreshHandle = handle || null;
  };

  const refreshBridge = (refreshOptions: MarkingEngineRefreshOptions = {}): boolean => {
    const progressiveGeometryCancelled = cancelProgressiveGeometryRender();
    if (deferredBranchRenderHandle !== null) {
      presentationClock.cancelFrame(deferredBranchRenderHandle);
      deferredBranchRenderHandle = null;
      deferredBranchTargets.clear();
      deferredBranchAffectedXpaths.clear();
    }
    beginWorkCycle();
    hoverResolution = null;
    const previousMarks = store.canonicalSet();
    bridge = buildBridge();
    const next = initialMarksForBridge(bridge, previousMarks, refreshOptions.selectors);
    lastInitializationSeededSelectors = next.selectorsSeeded;
    store = createMarkingStore({ root: bridge.root }, next.marks);
    reportWorkStage("store-evaluate");
    rebuildBridgeIndexes();
    refreshCurrentPreviewProjection();
    reconcilePreviewEmphasis();
    if (refreshOptions.render) {
      renderCurrent();
    }
    if (progressiveGeometryCancelled) {
      revealMarkingAfterRender = false;
      renderer.setScrolling(false);
    }
    return next.selectorsSeeded;
  };

  const replaceSelectorMarks = (selectors: SelectorSet | null): boolean => {
    const progressiveGeometryCancelled = cancelProgressiveGeometryRender();
    if (deferredBranchRenderHandle !== null) {
      presentationClock.cancelFrame(deferredBranchRenderHandle);
      deferredBranchRenderHandle = null;
      deferredBranchTargets.clear();
      deferredBranchAffectedXpaths.clear();
    }
    beginWorkCycle();
    hoverResolution = null;
    // A silent authoritative projection replaces the prior session's marks; it
    // must not inherit user edits. The DOM bridge, element identities, preview
    // metadata, widening topology and intersection subscriptions are still
    // current, however, so rebuilding all of them only adds latency and GC.
    const next = initialMarksForBridge(bridge, { rows: [] }, selectors);
    lastInitializationSeededSelectors = next.selectorsSeeded;
    store = createMarkingStore({ root: bridge.root }, next.marks);
    reportWorkStage("store-evaluate");
    const evaluation = store.currentEvaluation();
    candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
    reportWorkStage("candidate-index");
    refreshCurrentPreviewProjection();
    reconcilePreviewEmphasis();
    if (progressiveGeometryCancelled) {
      revealMarkingAfterRender = false;
      renderer.setScrolling(false);
    }
    return next.selectorsSeeded;
  };
  const byXpathElements = (): ReadonlyMap<string, OverlayRenderTarget> => overlayTargets;
  const byXpathElementsForBranch = (
    branchRoot: EvaluationNode,
    evaluation: ReturnType<typeof store.currentEvaluation>,
  ): Readonly<{
    affectedXpaths: ReadonlySet<string>;
    targets: Map<string, OverlayRenderTarget>;
  }> => {
    const elements = new Map<string, OverlayRenderTarget>();
    const affectedXpaths = new Set<string>();
    const rowXpaths = new Set(evaluation.rows.map((row) => row.xpath));
    const retainedXpaths = renderer.retainedViewportXpaths();
    const collect = (node: EvaluationNode): void => {
      affectedXpaths.add(node.xpath);
      const element = bridge.byXpath.get(node.xpath)?.element;
      const classification = evaluation.overlay.get(node.xpath);
      const viewportClassification = intersectingXpaths.has(node.xpath)
        && classification !== undefined
        && classification !== "implicit-include";
      if (element && (
        retainedXpaths.has(node.xpath)
        || rowXpaths.has(node.xpath)
        || viewportClassification
      )) {
        elements.set(node.xpath, { element, visible: node.visible });
      }
      for (const child of node.children ?? []) {
        collect(child);
      }
    };
    collect(branchRoot);
    return { affectedXpaths, targets: elements };
  };
  const renderSilent = (): readonly string[] => {
    const byXpath = byXpathElements();
    const evaluation = store.currentEvaluation();
    const geometryCache = new Map<string, VisibilityGeometry>();
    const geometryByXpath = {
      get(xpath: string): VisibilityGeometry | undefined {
        const cached = geometryCache.get(xpath);
        if (cached) {
          return cached;
        }
        const target = byXpath.get(xpath);
        if (!target) {
          return undefined;
        }
        const geometry = geometryForElement(target.element);
        geometryCache.set(xpath, geometry);
        return geometry;
      },
    };
    const xpaths = buildSilentHighlights(evaluation, geometryByXpath);
    const immutableCandidates: string[] = [];
    const excludedCandidates: string[] = [];
    for (const [xpath, classification] of evaluation.overlay) {
      if (classification === "immutable" || classification === "closed-shadow") {
        immutableCandidates.push(xpath);
      } else if (classification === "exception") {
        excludedCandidates.push(xpath);
      }
    }
    const immutableXpaths = shallowXpathBoundaries(immutableCandidates);
    const excludedXpaths = shallowXpathBoundaries(excludedCandidates);
    renderer.renderSilentHighlights(xpaths, byXpath, { immutableXpaths, excludedXpaths });
    reportWorkStage("silent-render");
    return xpaths;
  };
  const renderSilentBranch = (
    evaluation: ReturnType<typeof store.currentEvaluation>,
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
  ): readonly string[] => {
    const affectedXpaths = new Set(byXpath.keys());
    const branchRows = evaluation.rows.filter((row) => affectedXpaths.has(row.xpath));
    const geometryCache = new Map<string, VisibilityGeometry>();
    const geometryByXpath = {
      get(xpath: string): VisibilityGeometry | undefined {
        const cached = geometryCache.get(xpath);
        if (cached) {
          return cached;
        }
        const target = byXpath.get(xpath);
        if (!target) {
          return undefined;
        }
        const geometry = geometryForElement(target.element);
        geometryCache.set(xpath, geometry);
        return geometry;
      },
    };
    const xpaths = buildSilentHighlights({
      rows: branchRows,
      overlay: evaluation.overlay,
    }, geometryByXpath);
    const immutableCandidates: string[] = [];
    const excludedCandidates: string[] = [];
    for (const [xpath, classification] of evaluation.overlay) {
      if (classification === "immutable" || classification === "closed-shadow") {
        immutableCandidates.push(xpath);
      } else if (classification === "exception") {
        excludedCandidates.push(xpath);
      }
    }
    const immutableXpaths = shallowXpathBoundaries(immutableCandidates)
      .filter((xpath) => affectedXpaths.has(xpath));
    const excludedXpaths = shallowXpathBoundaries(excludedCandidates)
      .filter((xpath) => affectedXpaths.has(xpath));
    renderer.renderSilentHighlightsBranch(xpaths, byXpath, { immutableXpaths, excludedXpaths });
    reportWorkStage("silent-render");
    return xpaths;
  };
  const renderCurrent = (): void => {
    renderer.render(store.currentEvaluation(), byXpathElements(), bridgeGeneration);
    reportWorkStage("marking-render");
    if (silentHighlightsArmed) {
      renderSilent();
    }
  };
  const renderChangedBranch = (
    evaluation: ReturnType<typeof store.currentEvaluation>,
    branchRoot: EvaluationNode,
  ): void => {
    const branch = byXpathElementsForBranch(branchRoot, evaluation);
    const branchTargets = branch.targets;
    if (branch.affectedXpaths.size <= DEFERRED_BRANCH_RENDER_TARGET_THRESHOLD) {
      renderer.renderBranch(evaluation, branchTargets, bridgeGeneration, branch.affectedXpaths);
      if (silentHighlightsArmed) {
        renderSilentBranch(evaluation, branchTargets);
      }
      return;
    }
    for (const [xpath, target] of branchTargets) {
      deferredBranchTargets.set(xpath, target);
    }
    for (const xpath of branch.affectedXpaths) {
      deferredBranchAffectedXpaths.add(xpath);
    }
    deferredBranchRenderGeneration = bridgeGeneration;
    if (deferredBranchRenderHandle !== null) {
      return;
    }
    // The interaction acknowledgement is already mounted and the canonical
    // marking state is already committed. Yield once so the browser can paint
    // that acknowledgement and the signal path can invalidate popup controls
    // before a very large branch performs its geometry-heavy overlay repaint.
    const deferredHandle = presentationClock.requestFrame(() => {
      deferredBranchRenderHandle = null;
      const targets = deferredBranchTargets;
      deferredBranchTargets = new Map<string, OverlayRenderTarget>();
      const affectedXpaths = new Set(deferredBranchAffectedXpaths);
      deferredBranchAffectedXpaths.clear();
      if (deferredBranchRenderGeneration !== bridgeGeneration) {
        return;
      }
      const current = store.currentEvaluation();
      renderer.renderBranch(current, targets, bridgeGeneration, affectedXpaths);
      if (silentHighlightsArmed) {
        renderSilentBranch(current, targets);
      }
    });
    deferredBranchRenderHandle = deferredHandle || null;
  };
  type PresentationRefreshAdoption = Readonly<{
    bridgeChanged: boolean;
    progressiveGeometryCancelled: boolean;
    refreshed: DomBridgePresentationRefresh;
  }>;
  const adoptPresentationRefresh = (
    refreshed: DomBridgePresentationRefresh,
  ): PresentationRefreshAdoption | null => {
    if (refreshed.branchRoots.length === 0) {
      return null;
    }
    const progressiveGeometryCancelled = cancelProgressiveGeometryRender();
    if (deferredBranchRenderHandle !== null) {
      presentationClock.cancelFrame(deferredBranchRenderHandle);
      deferredBranchRenderHandle = null;
      deferredBranchTargets.clear();
      deferredBranchAffectedXpaths.clear();
    }
    const bridgeChanged = refreshed.view !== bridge;
    if (bridgeChanged) {
      const previousMarks = store.canonicalSet();
      bridge = refreshed.view;
      const next = initialMarksForBridge(bridge, previousMarks, undefined);
      store = createMarkingStore({ root: bridge.root }, next.marks);
      reportWorkStage("store-evaluate");
    }
    return { bridgeChanged, progressiveGeometryCancelled, refreshed };
  };
  const indexPresentationRefresh = (adoption: PresentationRefreshAdoption): void => {
    if (!adoption.bridgeChanged) return;
    // Attribute-only presentation changes retain element/XPath topology and
    // text. Keep the existing IntersectionObserver snapshot and preview text
    // cache instead of disconnecting and walking the complete document.
    rebuildBridgeIndexes({
      refreshPreviewTextMetadata: false,
      rebindIntersections: false,
    });
  };
  const projectPresentationRefresh = (adoption: PresentationRefreshAdoption): void => {
    if (!adoption.bridgeChanged) return;
    refreshCurrentPreviewProjection();
    reconcilePreviewEmphasis();
  };
  const paintPresentationRefresh = (adoption: PresentationRefreshAdoption): void => {
    try {
      const evaluation = store.currentEvaluation();
      for (const branchRoot of adoption.refreshed.branchRoots) {
        renderChangedBranch(evaluation, branchRoot);
      }
    } finally {
      if (adoption.progressiveGeometryCancelled) {
        revealMarkingAfterRender = false;
        renderer.setScrolling(false);
      }
    }
  };
  const applyPresentationRefresh = (refreshed: DomBridgePresentationRefresh): void => {
    const adoption = adoptPresentationRefresh(refreshed);
    if (!adoption) return;
    try {
      indexPresentationRefresh(adoption);
      projectPresentationRefresh(adoption);
      paintPresentationRefresh(adoption);
    } catch (error) {
      if (adoption.progressiveGeometryCancelled) {
        revealMarkingAfterRender = false;
        renderer.setScrolling(false);
      }
      throw error;
    }
  };
  const renderGeometryProgressively = (
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
    includeSilent: boolean,
  ): void => {
    cancelProgressiveGeometryRender();
    const cycle = progressiveGeometryCycle;
    const generation = bridgeGeneration;
    // Reconcile already-painted boxes before newly intersecting entrants. Only
    // the retained corpus can display stale fixed coordinates after viewport
    // movement; keeping the entire layer hidden while an unrelated entrant
    // backlog is measured made dense pages stay blank for well over a second.
    const retainedAtStart = renderer.retainedViewportXpaths();
    const retainedEntries: Array<readonly [string, OverlayRenderTarget]> = [];
    const enteringEntries: Array<readonly [string, OverlayRenderTarget]> = [];
    for (const entry of byXpath) {
      (retainedAtStart.has(entry[0]) ? retainedEntries : enteringEntries).push(entry);
    }
    const entries = [...retainedEntries, ...enteringEntries];
    const canRevealAfterRetained = [...retainedAtStart].every((xpath) => byXpath.has(xpath));
    const completeXpaths = new Set(byXpath.keys());
    let offset = 0;
    progressiveGeometryActive = true;
    // Intersection-only follow-ups add or retire presentation after an already
    // settled viewport transaction. They must never fade the correct retained
    // layer a second time.
    if (revealMarkingAfterRender) {
      renderer.setScrolling(true);
    }

    const renderNextChunk = (): void => {
      progressiveGeometryRenderHandle = null;
      if (
        disposed ||
        cycle !== progressiveGeometryCycle ||
        generation !== bridgeGeneration
      ) {
        if (cycle === progressiveGeometryCycle) {
          progressiveGeometryActive = false;
        }
        return;
      }
      const end = Math.min(offset + PROGRESSIVE_GEOMETRY_CHUNK_SIZE, entries.length);
      const chunk = new Map(entries.slice(offset, end));
      offset = end;
      const final = offset >= entries.length;
      renderer.repositionBranch(chunk, {
        completeXpaths: final ? completeXpaths : undefined,
        final,
        includeSilent,
        generation,
      });
      if (
        revealMarkingAfterRender
        && canRevealAfterRetained
        && offset >= retainedEntries.length
      ) {
        // Every box that could have stale viewport coordinates is now current.
        // Entrants have no old paint to leak, so finish them progressively with
        // the correct retained presentation already visible.
        revealMarkingAfterRender = false;
        renderer.setScrolling(false);
      }
      if (final) {
        progressiveGeometryActive = false;
        const followup = progressiveGeometryFollowup;
        progressiveGeometryFollowup = null;
        if (followup) {
          scheduleRender(followup);
          return;
        }
        revealMarkingAfterRender = false;
        renderer.setScrolling(false);
        return;
      }
      const handle = presentationClock.requestFrame(renderNextChunk);
      progressiveGeometryRenderHandle = handle || null;
    };

    renderNextChunk();
  };
  const scheduleRender = (work: RenderWork): void => {
    hoverResolution = null;
    const priority: Readonly<Record<RenderWork, number>> = {
      geometry: 0,
      "silent-geometry": 1,
      structural: 2,
    };
    if (progressiveGeometryActive && work !== "structural") {
      if (
        progressiveGeometryFollowup === null
        || priority[work] > priority[progressiveGeometryFollowup]
      ) {
        progressiveGeometryFollowup = work;
      }
      return;
    }
    if (scheduledWork === null || priority[work] > priority[scheduledWork]) {
      scheduledWork = work;
    }
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    const run = (): void => {
      renderFrameHandle = 0;
      renderScheduled = false;
      const nextWork = scheduledWork;
      scheduledWork = null;
      if (nextWork === "structural") {
        try {
          refreshBridge({ render: true });
        } finally {
          const settle = structuralRenderSettled;
          structuralRenderSettled = null;
          settle?.();
          if (revealMarkingAfterRender) {
            revealMarkingAfterRender = false;
            renderer.setScrolling(false);
          }
        }
        return;
      }
      // Viewport motion measures only sources that currently intersect or just
      // crossed the viewport. The renderer retains missing silent projections
      // as hidden keyed nodes, so bounded geometry no longer trades node
      // identity for document-scale layout reads.
      const byXpath = viewportGeometryTargets();
      // Silent highlights use the same native geometry and paint hit tests as
      // marking overlays. Keeping their resize pass monolithic recreated the
      // exact long task progressive marking was designed to remove.
      const progressive = byXpath.size > PROGRESSIVE_GEOMETRY_TARGET_THRESHOLD;
      if (nextWork === "silent-geometry" && silentHighlightsArmed) {
        renderSilent();
        if (progressive) {
          renderGeometryProgressively(byXpath, false);
        } else {
          renderer.reposition(byXpath, { includeSilent: false, generation: bridgeGeneration });
        }
      } else if (progressive) {
        renderGeometryProgressively(byXpath, true);
      } else {
        renderer.reposition(byXpath, { generation: bridgeGeneration });
      }
      if (!progressive && revealMarkingAfterRender) {
        revealMarkingAfterRender = false;
        renderer.setScrolling(false);
      }
    };
    renderFrameHandle = presentationClock.requestFrame(run);
  };
  const installObservers = (): (() => void) => {
    const view = rootElement.ownerDocument.defaultView;
    const cleanups: Array<() => void> = [];
    type IdleCapableView = Window & Readonly<{
      requestIdleCallback?: (callback: () => void, options?: Readonly<{ timeout: number }>) => number;
      cancelIdleCallback?: (handle: number) => void;
    }>;
    const idleView = view as IdleCapableView | null;
    let structuralIdleHandle: number | null = null;
    let structuralQuietHandle: ReturnType<typeof setTimeout> | null = null;
    let structuralFallbackHandle: ReturnType<typeof setTimeout> | null = null;
    let structuralRenderInFlight = false;
    let structuralTrailingQuietMs: number | null = null;
    let progressivePresentationHandle: number | null = null;
    let progressivePresentationCycle = 0;
    let pendingStructuralNonAttributeMutation = false;
    const pendingStructuralAttributeOldValues = new Map<Element, Map<string, string | null>>();
    const styleCanonicalCache = new Map<string, string>();
    const styleProbe = rootElement.ownerDocument.createElement("span") as HTMLElement;
    const canonicalStyleAttribute = (value: string | null): string => {
      if (!value?.trim()) {
        return "";
      }
      const cached = styleCanonicalCache.get(value);
      if (cached !== undefined) {
        return cached;
      }
      const declaration = styleProbe.style;
      let canonical: string;
      if (
        typeof declaration?.getPropertyValue === "function"
        && typeof declaration?.getPropertyPriority === "function"
      ) {
        declaration.cssText = value;
        canonical = [...declaration]
          .sort()
          .map((property) => [
            property,
            declaration.getPropertyValue(property).trim(),
            declaration.getPropertyPriority(property),
          ].join(":"))
          .join(";");
        declaration.cssText = "";
      } else {
        // Lightweight DOM test doubles do not expose CSSStyleDeclaration. The
        // browser path above remains the authority; this fallback only gives
        // those doubles the same declaration-order-insensitive semantics.
        canonical = value
          .split(";")
          .map((part) => part.trim().replace(/\s*:\s*/u, ":"))
          .filter(Boolean)
          .sort()
          .join(";");
      }
      if (styleCanonicalCache.size >= 256) {
        styleCanonicalCache.clear();
      }
      styleCanonicalCache.set(value, canonical);
      return canonical;
    };
    const canonicalStructuralAttributeValue = (
      element: Element,
      attributeName: string,
      value: string | null,
    ): string | null => attributeName === "style"
      ? canonicalStyleAttribute(restoreMotionStyleForCapture(element, value))
      : value;
    const cancelStructuralDispatch = (): void => {
      if (structuralIdleHandle !== null) {
        idleView?.cancelIdleCallback?.(structuralIdleHandle);
        structuralIdleHandle = null;
      }
      if (structuralQuietHandle !== null) {
        clearTimeout(structuralQuietHandle);
        structuralQuietHandle = null;
      }
      if (structuralFallbackHandle !== null) {
        clearTimeout(structuralFallbackHandle);
        structuralFallbackHandle = null;
      }
    };
    const dispatchStructuralRefresh = (): void => {
      cancelStructuralDispatch();
      let fullBridgeChange = pendingStructuralNonAttributeMutation;
      const presentationTargets = new Set<Element>();
      pendingStructuralNonAttributeMutation = false;
      for (const [element, byAttribute] of pendingStructuralAttributeOldValues) {
        for (const [attributeName, oldValue] of byAttribute) {
          const currentValue = canonicalStructuralAttributeValue(
            element,
            attributeName,
            element.getAttribute(attributeName),
          );
          if (oldValue !== currentValue) {
            if (PRESENTATION_MUTATION_ATTRIBUTES.has(attributeName)) {
              presentationTargets.add(element);
            } else {
              fullBridgeChange = true;
            }
          }
        }
      }
      pendingStructuralAttributeOldValues.clear();
      if (!fullBridgeChange && presentationTargets.size === 0) {
        return;
      }
      structuralRenderInFlight = true;
      const settleMutationRefresh = (): void => {
        structuralRenderInFlight = false;
        const trailingQuietMs = structuralTrailingQuietMs;
        structuralTrailingQuietMs = null;
        if (trailingQuietMs !== null) {
          scheduleStructuralRefresh(trailingQuietMs);
        }
      };
      if (fullBridgeChange) {
        structuralRenderSettled = settleMutationRefresh;
        scheduleRender("structural");
        return;
      }
      const cursor = createDomBridgePresentationRefreshCursor(bridge, [...presentationTargets]);
      if (cursor.totalNodes > PROGRESSIVE_PRESENTATION_TARGET_THRESHOLD) {
        beginWorkCycle();
        hoverResolution = null;
        const cycle = ++progressivePresentationCycle;
        let adoption: PresentationRefreshAdoption | null = null;
        let settled = false;
        const settleOnce = (): void => {
          if (settled) return;
          settled = true;
          settleMutationRefresh();
        };
        const scheduleFrame = (work: () => void): void => {
          progressivePresentationHandle = presentationClock.requestFrame(() => {
            progressivePresentationHandle = null;
            if (disposed || cycle !== progressivePresentationCycle) {
              settleOnce();
              return;
            }
            try {
              work();
            } catch (error) {
              if (adoption?.progressiveGeometryCancelled) {
                revealMarkingAfterRender = false;
                renderer.setScrolling(false);
              }
              settleOnce();
              throw error;
            }
          }) || null;
        };
        const runChunk = (): void => {
          progressivePresentationHandle = null;
          if (disposed || cycle !== progressivePresentationCycle) {
            settleOnce();
            return;
          }
          const complete = cursor.step(PROGRESSIVE_PRESENTATION_CHUNK_SIZE);
          if (complete) {
            // Keep immutable bridge materialization/store adoption, index
            // rebuilding, preview projection, and paint on separate frames.
            // Each phase is independently below the input-task budget even on
            // a 6k-node responsive document.
            scheduleFrame(() => {
              adoption = adoptPresentationRefresh(cursor.finish());
              if (!adoption) {
                settleOnce();
                return;
              }
              scheduleFrame(() => {
                indexPresentationRefresh(adoption!);
                scheduleFrame(() => {
                  projectPresentationRefresh(adoption!);
                  scheduleFrame(() => {
                    paintPresentationRefresh(adoption!);
                    settleOnce();
                  });
                });
              });
            });
            return;
          }
          scheduleFrame(runChunk);
        };
        scheduleFrame(runChunk);
        return;
      }
      try {
        while (!cursor.step(PROGRESSIVE_PRESENTATION_CHUNK_SIZE)) {
          // Small branches retain the synchronous legacy-compatible cadence.
        }
        applyPresentationRefresh(cursor.finish());
      } finally {
        settleMutationRefresh();
      }
    };
    const scheduleStructuralRefresh = (quietMs: number): void => {
      if (structuralRenderInFlight) {
        structuralTrailingQuietMs = Math.min(structuralTrailingQuietMs ?? quietMs, quietMs);
        return;
      }
      // A carousel or reactive shell can emit a long train of attribute and DOM
      // records. Restart the quiet window from the latest structural mutation so
      // a full bridge walk never races the page's own burst or a queued click.
      cancelStructuralDispatch();
      structuralQuietHandle = setTimeout(() => {
        structuralQuietHandle = null;
        if (idleView?.requestIdleCallback) {
          structuralIdleHandle = idleView.requestIdleCallback(dispatchStructuralRefresh, {
            timeout: STRUCTURAL_MUTATION_IDLE_TIMEOUT_MS,
          });
          structuralFallbackHandle = setTimeout(
            dispatchStructuralRefresh,
            STRUCTURAL_MUTATION_IDLE_TIMEOUT_MS,
          );
          return;
        }
        dispatchStructuralRefresh();
      }, quietMs);
    };
    const rememberStructuralMutations = (records: MutationRecord[]): void => {
      for (const record of records) {
        if (
          record.type !== "attributes"
          || record.attributeName === null
          || record.target.nodeType !== 1
        ) {
          pendingStructuralNonAttributeMutation = true;
          continue;
        }
        const element = record.target as Element;
        const byAttribute = pendingStructuralAttributeOldValues.get(element)
          ?? new Map<string, string | null>();
        if (!byAttribute.has(record.attributeName)) {
          // Preserve the value from before the entire quiet window, not merely
          // before this MutationObserver delivery. Responsive scripts often
          // publish A→B and B→A in separate microtasks; rebuilding at B even
          // though the terminal DOM is A caused a 500–600 ms cold resize stall.
          byAttribute.set(
            record.attributeName,
            canonicalStructuralAttributeValue(element, record.attributeName, record.oldValue),
          );
          pendingStructuralAttributeOldValues.set(element, byAttribute);
        }
      }
    };
    const isExtractionIrrelevantNode = (node: Node): boolean => {
      const element = node.nodeType === 1 ? node as Element : node.parentElement;
      return Boolean(
        element?.closest?.('[data-uf-extension-ui="true"]')
        || element?.closest?.("[data-uf-consent-hidden]"),
      );
    };
    const isConsentSuppressionBoundaryMutation = (record: MutationRecord): boolean => {
      if (
        record.type !== "attributes"
        || record.attributeName !== "data-uf-consent-hidden"
        || record.target.nodeType !== 1
      ) {
        return false;
      }
      const element = record.target as Element;
      // Adding or removing the suppression attribute changes whether this
      // element participates in the flattened bridge. That can renumber every
      // same-tag sibling after it, so it is structural even though the element
      // is already suppressed by the time MutationObserver delivers the
      // record. Descendant churn inside an existing suppressed/extension root
      // remains extraction-irrelevant.
      return !element.closest?.('[data-uf-extension-ui="true"]')
        && !element.parentElement?.closest?.("[data-uf-consent-hidden]");
    };
    const isExtractionIrrelevantMutation = (record: MutationRecord): boolean => {
      if (isConsentSuppressionBoundaryMutation(record)) {
        return false;
      }
      // Mutations inside extension or consent-suppressed roots cannot affect
      // extraction, even when a removed child is already detached.
      if (isExtractionIrrelevantNode(record.target)) {
        return true;
      }
      if (record.type !== "childList") {
        return false;
      }
      // Mounting or removing the root itself targets the page parent, so inspect
      // the changed nodes in that one boundary case.
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => isExtractionIrrelevantNode(node));
    };
    const bridgeContainsNode = (node: Node): boolean => {
      const element = node.nodeType === 1 ? node as Element : node.parentElement;
      if (!element) {
        return false;
      }
      // The DOM bridge indexes every traversed element, not only toggleable
      // rows. A suppression root that can own a stale descendant overlay is
      // therefore itself enough to prove this lifecycle touches the bridge.
      return bridge.byElement.has(element);
    };
    const suppressedMutationTouchesBridge = (record: MutationRecord): boolean => {
      if (!isExtractionIrrelevantMutation(record)) {
        return false;
      }
      if (record.type === "attributes") {
        return isExtractionIrrelevantNode(record.target) && bridgeContainsNode(record.target);
      }
      return record.type === "childList" && [...record.removedNodes].some((node) =>
        isExtractionIrrelevantNode(node) && bridgeContainsNode(node)
      );
    };
    const isExtensionCursorClassMutation = (record: MutationRecord): boolean => {
      if (
        record.type !== "attributes"
        || record.attributeName !== "class"
        || record.target !== rootElement.ownerDocument.documentElement
      ) {
        return false;
      }
      const withoutCursorClasses = (value: string | null): string => (value ?? "")
        .split(/\s+/u)
        .filter((className) => className && !className.startsWith("uf-cursor-"))
        .sort()
        .join(" ");
      const current = (record.target as Element).getAttribute("class");
      return withoutCursorClasses(record.oldValue) === withoutCursorClasses(current);
    };
    const coalesceNetMutationRecords = (records: MutationRecord[]): MutationRecord[] => {
      const firstAttributeRecordByElement = new Map<Element, Map<string, MutationRecord>>();
      for (const record of records) {
        if (
          record.type !== "attributes"
          || record.attributeName === null
          || record.target.nodeType !== 1
        ) {
          continue;
        }
        const element = record.target as Element;
        const byAttribute = firstAttributeRecordByElement.get(element) ?? new Map<string, MutationRecord>();
        if (!byAttribute.has(record.attributeName)) {
          byAttribute.set(record.attributeName, record);
          firstAttributeRecordByElement.set(element, byAttribute);
        }
      }
      const netAttributeRecords = new Set<MutationRecord>();
      for (const [element, byAttribute] of firstAttributeRecordByElement) {
        for (const [attributeName, firstRecord] of byAttribute) {
          // MutationObserver batches can contain A→B→A attribute churn. The
          // first record's old value is the pre-batch value and the live
          // attribute is the terminal value, so equal endpoints cannot change
          // extraction, identity, visibility, or paint. Keeping only one net
          // record also prevents responsive page scripts from rebuilding the
          // complete bridge for every intermediate class/style write.
          const oldValue = canonicalStructuralAttributeValue(
            element,
            attributeName,
            firstRecord.oldValue,
          );
          const currentValue = canonicalStructuralAttributeValue(
            element,
            attributeName,
            element.getAttribute(attributeName),
          );
          if (oldValue !== currentValue) {
            netAttributeRecords.add(firstRecord);
          }
        }
      }
      return records.filter((record) =>
        record.type !== "attributes"
        || record.attributeName === null
        || record.target.nodeType !== 1
        || netAttributeRecords.has(record)
      );
    };
    if (view?.MutationObserver) {
      const observer = new view.MutationObserver((records) => {
        const netRecords = coalesceNetMutationRecords(records);
        if (netRecords.some((record) =>
          record.type !== "characterData" &&
          !isExtensionCursorClassMutation(record) &&
          (
            !isExtractionIrrelevantMutation(record) ||
            suppressedMutationTouchesBridge(record)
          )
        )) {
          // Paint truth is latency-sensitive and bounded by the rectangles that
          // are actually mounted. Prune a newly hidden/covered exclusion in the
          // observer delivery itself; retain the quiet/idle structural refresh
          // for topology, selectors, and canonical extraction state.
          renderer.pruneInvisibleExclusions();
        }
        if (netRecords.some(suppressedMutationTouchesBridge)) {
          // Consent suppression is intentionally extraction-irrelevant, but it
          // can hide or remove elements that already own marking rectangles.
          // Reconcile their presentation on the next paint without rebuilding
          // the extraction bridge or admitting the suppressed subtree.
          scheduleRender("geometry");
        }
        const relevantRecords = netRecords.filter((record) =>
          !isExtractionIrrelevantMutation(record) && !isExtensionCursorClassMutation(record)
        );
        if (relevantRecords.length === 0) {
          return;
        }
        rememberStructuralMutations(relevantRecords);
        scheduleStructuralRefresh(relevantRecords.some((record) => record.type === "childList")
          ? STRUCTURAL_CHILD_LIST_QUIET_MS
          : STRUCTURAL_PRESENTATION_QUIET_MS);
      });
      observer.observe(rootElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeOldValue: true,
        attributeFilter: [
          "class",
          "style",
          "hidden",
          "open",
          "role",
          "aria-hidden",
          "aria-expanded",
          "data-uf-consent-hidden",
        ],
      });
      cleanups.push(() => observer.disconnect());
    }
    if (view?.IntersectionObserver) {
      targetIntersectionObserver = new view.IntersectionObserver((entries) => {
        let changed = false;
        const snapshotWasReady = intersectionSnapshotReady;
        for (const entry of entries) {
          const bridgeEntry = bridge.byElement.get(entry.target);
          if (!bridgeEntry) {
            continue;
          }
          pendingIntersectionElements.delete(entry.target);
          const xpath = bridgeEntry.evaluationNode.xpath;
          const intersects = entry.isIntersecting && entry.intersectionRatio > 0;
          const previous = intersectionByElement.get(entry.target);
          intersectionByElement.set(entry.target, intersects);
          if (intersects) {
            intersectingXpaths.add(xpath);
          } else {
            intersectingXpaths.delete(xpath);
          }
          if (previous !== undefined && previous !== intersects) {
            intersectionDirtyXpaths.add(xpath);
            changed = true;
          }
        }
        if (pendingIntersectionElements.size === 0) {
          intersectionSnapshotReady = true;
        }
        if (
          !snapshotWasReady
          && intersectionSnapshotReady
          && incompleteIntersectionFallbackUsed
        ) {
          // The bounded fallback deliberately used only retained/known-positive
          // targets. Close it with one current-snapshot pass; geometry requests
          // arriving during a progressive pass are coalesced into its trailing
          // generation instead of repeatedly restarting the corpus.
          incompleteIntersectionFallbackUsed = false;
          changed = true;
        }
        if (changed && viewportGeometryHandle === null) {
          scheduleRender("geometry");
        }
      });
      rebindIntersectionTargets();
      cleanups.push(() => {
        targetIntersectionObserver?.disconnect();
        targetIntersectionObserver = null;
        intersectionSnapshotReady = false;
        incompleteIntersectionFallbackUsed = false;
        intersectionByElement = new WeakMap<Element, boolean>();
        pendingIntersectionElements.clear();
        intersectingXpaths.clear();
        intersectionDirtyXpaths.clear();
      });
    }
    const visualViewport = view?.visualViewport;
    type ViewportGeometryKind = "scroll" | "resize";
    type ResizeGeometrySource = "viewport" | "root";
    let viewportGeometryHandle: ReturnType<typeof setTimeout> | null = null;
    let viewportGeometryKind: ViewportGeometryKind | null = null;
    let pendingResizeSource: ResizeGeometrySource | null = null;
    let pendingResizeSignature = "";
    const committedResizeSignatures: Record<ResizeGeometrySource, string> = {
      viewport: "",
      root: "",
    };
    const currentViewportResizeSignature = (): string => {
      const documentElement = rootElement.ownerDocument.documentElement;
      return [
        view?.innerWidth ?? documentElement.clientWidth,
        view?.innerHeight ?? documentElement.clientHeight,
        visualViewport?.width ?? "",
        visualViewport?.height ?? "",
        visualViewport?.scale ?? "",
        documentElement.clientWidth,
        documentElement.clientHeight,
      ].join(":");
    };
    const finishViewportGeometry = (): void => {
      if (viewportGeometryKind === "resize" && pendingResizeSource) {
        committedResizeSignatures[pendingResizeSource] = pendingResizeSignature;
      }
      viewportGeometryHandle = null;
      viewportGeometryKind = null;
      pendingResizeSource = null;
      pendingResizeSignature = "";
      // The event train has already been quiet for the mode-specific debounce.
      // Commit once on the next captured presentation frame and reveal only
      // after that exact geometry/classification transaction completes.
      revealMarkingAfterRender = true;
      scheduleRender("geometry");
    };
    const scheduleTrailingGeometry = (
      kind: ViewportGeometryKind,
      quietMs: number,
      hideStaleGeometry: boolean,
      resize: Readonly<{ source: ResizeGeometrySource; signature: string }> | null = null,
    ): void => {
      if (
        kind === "scroll"
        && viewportGeometryHandle !== null
        && viewportGeometryKind === "resize"
      ) {
        // Chromium can adjust scrollY while applying device metrics. That
        // induced scroll belongs to the already-owned resize transaction and
        // must not upgrade its 50 ms deadline to the 250 ms marking-scroll one.
        return;
      }
      if (
        kind === "resize"
        && resize
        && (
          (viewportGeometryHandle !== null
            && viewportGeometryKind === "resize"
            && (
              // Root layout observation is still valuable when it occurs on
              // its own, but it cannot extend an authoritative viewport resize
              // already headed for its 50/120 ms paint deadline.
              (pendingResizeSource === "viewport" && resize.source === "root")
              || (pendingResizeSource === resize.source
                && pendingResizeSignature === resize.signature)
            ))
          || (viewportGeometryHandle === null
            && committedResizeSignatures[resize.source] === resize.signature)
        )
      ) {
        // Window, VisualViewport, and root ResizeObserver can all describe the
        // same physical viewport. The normalized signature, not callback count,
        // owns whether this is new geometry.
        return;
      }
      revealMarkingAfterRender = false;
      cancelProgressiveGeometryRender();
      if (hideStaleGeometry) {
        renderer.setScrolling(true);
      }
      if (viewportGeometryHandle !== null) {
        clearTimeout(viewportGeometryHandle);
      }
      viewportGeometryKind = kind;
      pendingResizeSource = resize?.source ?? null;
      pendingResizeSignature = resize?.signature ?? "";
      viewportGeometryHandle = setTimeout(finishViewportGeometry, quietMs);
    };
    const scheduleGeometryRender = (event?: Event): void => {
      const target = event?.target;
      const document = rootElement.ownerDocument;
      const viewportScroll = !target
        || target === view
        || target === document
        || target === document.documentElement
        || target === document.body;
      if (viewportScroll) {
        scheduleTrailingGeometry(
          "scroll",
          interactiveMarkingRendered
            ? MARKING_VIEWPORT_SCROLL_QUIET_MS
            : SILENT_VIEWPORT_GEOMETRY_QUIET_MS,
          true,
        );
        return;
      }
      // A nested scroller changes the same fixed overlay coordinates, but it
      // must not blank unrelated page borders. Coalesce its event storm into
      // the same one-commit path while leaving the retained layer visible.
      scheduleTrailingGeometry(
        "scroll",
        interactiveMarkingRendered
          ? MARKING_VIEWPORT_SCROLL_QUIET_MS
          : SILENT_VIEWPORT_GEOMETRY_QUIET_MS,
        false,
      );
    };
    const scheduleViewportResizeRender = (): void => scheduleTrailingGeometry(
      "resize",
      interactiveMarkingRendered
        ? MARKING_VIEWPORT_RESIZE_QUIET_MS
        : SILENT_VIEWPORT_GEOMETRY_QUIET_MS,
      true,
      { source: "viewport", signature: currentViewportResizeSignature() },
    );
    const scheduleRootResizeRender = (entries?: readonly ResizeObserverEntry[]): void => {
      const observed = entries?.find((entry) => entry.target === rootElement)?.contentRect
        ?? rootElement.getBoundingClientRect();
      scheduleTrailingGeometry(
        "resize",
        interactiveMarkingRendered
          ? MARKING_VIEWPORT_RESIZE_QUIET_MS
          : SILENT_VIEWPORT_GEOMETRY_QUIET_MS,
        true,
        { source: "root", signature: `${observed.width}:${observed.height}` },
      );
    };
    if (view?.ResizeObserver) {
      const observer = new view.ResizeObserver(scheduleRootResizeRender);
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    view?.addEventListener?.("scroll", scheduleGeometryRender, true);
    view?.addEventListener?.("resize", scheduleViewportResizeRender);
    visualViewport?.addEventListener?.("scroll", scheduleViewportResizeRender);
    visualViewport?.addEventListener?.("resize", scheduleViewportResizeRender);
    cleanups.push(() => {
      progressivePresentationCycle += 1;
      if (progressivePresentationHandle !== null) {
        presentationClock.cancelFrame(progressivePresentationHandle);
        progressivePresentationHandle = null;
      }
      cancelStructuralDispatch();
      structuralTrailingQuietMs = null;
      structuralRenderInFlight = false;
      structuralRenderSettled = null;
      pendingStructuralNonAttributeMutation = false;
      pendingStructuralAttributeOldValues.clear();
      if (viewportGeometryHandle !== null) {
        clearTimeout(viewportGeometryHandle);
        viewportGeometryHandle = null;
      }
      viewportGeometryKind = null;
      pendingResizeSource = null;
      pendingResizeSignature = "";
      committedResizeSignatures.viewport = "";
      committedResizeSignatures.root = "";
      renderer.setScrolling(false);
      revealMarkingAfterRender = false;
      view?.removeEventListener?.("scroll", scheduleGeometryRender, true);
      view?.removeEventListener?.("resize", scheduleViewportResizeRender);
      visualViewport?.removeEventListener?.("scroll", scheduleViewportResizeRender);
      visualViewport?.removeEventListener?.("resize", scheduleViewportResizeRender);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  };
  rebuildBridgeIndexes();
  if (options.render) {
    renderCurrent();
  }
  observerCleanup = installObservers();

  return {
    refresh(refreshOptions: MarkingEngineRefreshOptions = {}): boolean {
      if (refreshOptions.render !== undefined) {
        interactiveMarkingRendered = refreshOptions.render;
      }
      return refreshBridge(refreshOptions);
    },
    replaceSelectors(selectors: SelectorSet | null): boolean {
      return replaceSelectorMarks(selectors);
    },
    lastInitializationSeededSelectors(): boolean {
      return lastInitializationSeededSelectors;
    },
    renderMarking(): void {
      beginWorkCycle();
      silentHighlightsArmed = false;
      interactiveMarkingRendered = true;
      renderer.attach();
      renderer.clearSilentHighlights();
      renderCurrent();
    },
    settlePresentation(): Promise<void> {
      return new Promise((resolve) => {
        // Activation follows a long reveal/restore walk. Page-owned sticky
        // headers commonly commit their restored-scroll posture in the next
        // animation frame, after the synchronous marking paint has sampled the
        // old hit stack. Reconcile geometry in that frame, then acknowledge on
        // the following frame so callers cannot expose a transient stale box.
        presentationClock.requestFrame(() => {
          if (disposed) {
            resolve();
            return;
          }
          hoverResolution = null;
          renderer.reposition(byXpathElements(), { generation: bridgeGeneration });
          presentationClock.requestFrame(() => resolve());
        });
      });
    },
    resolveAtPoint(
      x: number,
      y: number,
      mode: MarkMode,
      shiftActive = false,
      hint?: MarkingPointResolutionHint,
    ): EvaluationNode | null {
      const prefetched = prefetchedPointHits?.x === x && prefetchedPointHits.y === y
        ? prefetchedPointHits.elements
        : null;
      prefetchedPointHits = null;
      if (mode === "exclude" && !shiftActive) {
        // Plain input is unmark-only. Prefer any exact explicit mark (including
        // an Alt-created inclusion), then fall back to the painted exclusion
        // owner. Both lookups use the renderer's generation-fenced fragments,
        // so clearing never relies on a stale bounding-box approximation.
        const paintedOwnerXpath = renderer.paintedExplicitOwnerAtPoint(
          x,
          y,
          bridgeGeneration,
          hint?.overlayXpath,
        ) ?? renderer.paintedExclusionOwnerAtPoint(
          x,
          y,
          bridgeGeneration,
          hint?.overlayXpath,
        );
        // Every indexed exception is a current painted classification owned by
        // this bridge generation. The shallow exception painter guarantees the
        // indexed XPath is the canonical exclusion boundary, so the direct
        // bridge lookup avoids rebuilding or scanning an all-owner map.
        const paintedOwner = paintedOwnerXpath
          ? bridge.byXpath.get(paintedOwnerXpath)?.evaluationNode
          : undefined;
        if (paintedOwner && currentNodeForHint(paintedOwner.xpath) === paintedOwner) {
          return paintedOwner;
        }
      }
      const pointHits = prefetched ?? getComposedHitElements(rootElement.ownerDocument, x, y);
      const hits = pointHits
        .filter((element) => composedContains(rootElement, element))
        .filter((element) => isPaintReachableWithinHits(element, pointHits));
      const candidatesByXpath = currentCandidateIndex();
      const candidates: MarkingCandidate[] = [];
      const candidateXpaths = new Set<string>();
      const pointCandidateKeys = new Set<string>();
      const canonicalRowsByXpath = new Map(
        store.canonicalSet().rows.map((row) => [row.xpath, row]),
      );
      const currentOverlayEvaluation = store.currentEvaluation().overlay;
      for (const element of hits) {
        const xpath = bridge.byElement.get(element)?.evaluationNode.xpath;
        let candidate = xpath ? candidatesByXpath.get(xpath) : undefined;
        // elementsFromPoint returns painted stack entries, not their ordinary
        // DOM ancestors. A widened explicit mark commonly owns the painted
        // descendant under the pointer, so restore the composed candidate path
        // before resolving. Without this path the store contains the correct
        // owner but a plain click can only see/create a nested child mark.
        while (candidate) {
          if (!candidateXpaths.has(candidate.xpath)) {
            candidateXpaths.add(candidate.xpath);
            pointCandidateKeys.add(candidate.key);
            const entry = bridge.byXpath.get(candidate.xpath);
            const liveNode = entry?.evaluationNode;
            // Bridge visibility is a capture/presentation snapshot. CSS-only
            // carousel transforms can move an initially off-screen occurrence
            // under the pointer without emitting a DOM mutation. The current
            // paint-reachable hit path is stronger interaction authority than
            // that old horizontal snapshot, so restore only this path's live
            // markability without rebuilding or rescanning the document.
            const candidateXpath = candidate.xpath;
            const ownRow = canonicalRowsByXpath.get(candidateXpath);
            const selfMarkable = liveNode
              ? isToggleableBoundary(
                liveNode.visible ? liveNode : { ...liveNode, visible: true },
                { hasOwnMark: () => canonicalRowsByXpath.has(candidateXpath) },
              )
              : candidate.selfMarkable;
            const excluded = currentOverlayEvaluation.get(candidateXpath) === "exception";
            const explicitInclude = ownRow?.excluded === false && ownRow.explicit === true;
            const explicitExclude = ownRow?.excluded === true && ownRow.explicit === true;
            const current = selfMarkable === candidate.selfMarkable &&
              excluded === Boolean(candidate.excluded) &&
              explicitInclude === Boolean(candidate.explicitInclude) &&
              explicitExclude === Boolean(candidate.explicitExclude)
              ? candidate
              : { ...candidate, selfMarkable, excluded, explicitInclude, explicitExclude };
            candidates.push(current);
          }
          candidate = candidate.parent ?? undefined;
        }
      }
      const resolved = resolveTarget(candidates, mode);
      if (!resolved) {
        return null;
      }
      // Plain exclusion input may only remove an existing decision. An
      // explicit inclusion is such a decision even though its evaluated
      // classification is content rather than exception; keep it clearable
      // while the renderer's generation-fenced owner fast path catches up.
      if (
        mode === "exclude" &&
        !shiftActive &&
        resolved.excluded !== true &&
        resolved.explicitInclude !== true &&
        resolved.explicitExclude !== true
      ) {
        return null;
      }
      if (shiftActive && mode === "exclude") {
        const widenNode = widenByKey.get(resolved.key) ?? widenByKey.get(resolved.xpath);
        if (!widenNode) {
          return null;
        }
        const liveVisibility = new Map<string, boolean>();
        const visibleNow = (node: WidenNode): boolean => {
          const cached = liveVisibility.get(node.key);
          if (cached !== undefined) {
            return cached;
          }
          if (pointCandidateKeys.has(node.key)) {
            liveVisibility.set(node.key, true);
            return true;
          }
          const element = bridge.byKey.get(node.key)?.element;
          const view = element?.ownerDocument.defaultView;
          if (!element || !view) {
            liveVisibility.set(node.key, false);
            return false;
          }
          const rect = element.getBoundingClientRect();
          const viewportWidth = Number.isFinite(view.innerWidth) ? view.innerWidth : Number.POSITIVE_INFINITY;
          const viewportHeight = Number.isFinite(view.innerHeight) ? view.innerHeight : Number.POSITIVE_INFINITY;
          const intersectsViewport = rect.width > 0 && rect.height > 0 &&
            rect.right > 0 && rect.left < viewportWidth &&
            rect.bottom > 0 && rect.top < viewportHeight;
          // A sibling outside the physical viewport cannot influence this
          // Shift expansion. Reject it before the composed ancestor style walk;
          // visible candidates still receive the complete live proof.
          const visible = intersectsViewport && isCurrentlyVisuallyVisible(element, rect);
          liveVisibility.set(node.key, visible);
          return visible;
        };
        const widened = chooseWidenTarget(widenNode, {
          isVisible: visibleNow,
          getChildren: (node) => (node.children ?? []).map((child) => {
            const visible = visibleNow(child);
            return visible === child.visible ? child : { ...child, visible };
          }),
        });
        // Never silently degrade a Shift decision to the exact node when the
        // chosen live owner cannot be rebound to this bridge generation.
        return bridge.byKey.get(widened.key)?.evaluationNode ?? null;
      }
      return bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null;
    },
    resolveContextAtPoint(
      x: number,
      y: number,
      hint?: MarkingPointResolutionHint,
    ): Readonly<{
      include: EvaluationNode | null;
      existingExclude: EvaluationNode | null;
      shiftedExclude: EvaluationNode | null;
    }> {
      // A context menu is one physical observation. Reuse its exact composed
      // hit stack for all capabilities so page motion or a concurrent paint
      // cannot make Include, Exclude, Widen, and Clear disagree about which
      // element the operator right-clicked.
      const elements = getComposedHitElements(rootElement.ownerDocument, x, y);
      const resolveCached = (mode: "include" | "exclude", shiftActive: boolean) => {
        prefetchedPointHits = { x, y, elements };
        return this.resolveAtPoint(x, y, mode, shiftActive, hint);
      };
      return {
        include: resolveCached("include", false),
        existingExclude: resolveCached("exclude", false),
        shiftedExclude: resolveCached("exclude", true),
      };
    },
    acknowledge(
      node: EvaluationNode,
      mode: "include" | "exclude" | "clear",
    ): boolean {
      const current = currentInteractionEntry(node, "acknowledge");
      if (!current) {
        return false;
      }
      if (mode === "clear") {
        const existing = store.canonicalSet().rows.find((row) =>
          row.xpath === current.node.xpath && row.explicit === true
        );
        if (!existing) {
          return false;
        }
        renderer.acknowledge(
          current.element,
          current.node.xpath,
          existing.excluded ? "exclude" : "include",
        );
        return true;
      }
      renderer.acknowledge(current.element, current.node.xpath, mode);
      return true;
    },
    toggle(node: EvaluationNode, mode: Exclude<MarkMode, "disabled" | "passthrough">): boolean {
      const current = currentInteractionEntry(node, "toggle");
      if (toggleInProgress || !current) {
        return false;
      }
      toggleInProgress = true;
      hoverResolution = null;
      try {
        renderer.acknowledge(current.element, current.node.xpath, mode);
        const toggled = store.toggle(current.node, mode);
        // Mark-only changes do not alter the bridge topology. Retain the
        // document-scale candidate index; resolveAtPoint hydrates the tiny
        // composed hit path from the current canonical/evaluation state.
        interactiveMarkingRendered = true;
        renderChangedBranch(toggled, toggled.branchRoot);
        return true;
      } finally {
        toggleInProgress = false;
      }
    },
    clear(node: EvaluationNode): boolean {
      const current = currentInteractionEntry(node, "clear");
      if (toggleInProgress || !current) {
        return false;
      }
      const existing = store.canonicalSet().rows.find((row) =>
        row.xpath === current.node.xpath && row.explicit === true
      );
      if (!existing) {
        return false;
      }
      toggleInProgress = true;
      hoverResolution = null;
      try {
        renderer.acknowledge(
          current.element,
          current.node.xpath,
          existing.excluded ? "exclude" : "include",
        );
        const cleared = store.clear(current.node);
        if (!cleared) {
          return false;
        }
        // Clearing a row changes dynamic classification only, not candidate
        // ancestry or markability topology. See the path hydration above.
        interactiveMarkingRendered = true;
        renderChangedBranch(cleared, cleared.branchRoot);
        return true;
      } finally {
        toggleInProgress = false;
      }
    },
    hasExplicitMark(node: EvaluationNode): boolean {
      const current = currentInteractionEntry(node, "has-explicit");
      return current !== null && store.canonicalSet().rows.some((row) =>
        row.xpath === current.node.xpath && row.explicit === true
      );
    },
    rejectAtPoint(x: number, y: number): void {
      renderer.rejectAtPoint(x, y);
    },
    setPassthrough(active: boolean): void {
      renderer.setPassthrough(active);
      if (!active) {
        scheduleRender(silentHighlightsArmed ? "silent-geometry" : "geometry");
      }
    },
    setInputTransparent(active: boolean): void {
      renderer.setInputTransparent(active);
    },
    setSuspended(active: boolean): void {
      renderer.setSuspended(active);
    },
    setSilentDebugAnnotations(active: boolean): void {
      renderer.setSilentDebugAnnotations(active);
    },
    inspectAtPoint(x: number, y: number): Readonly<{ xpath: string; annotation: string }> | null {
      for (const element of getComposedHitElements(rootElement.ownerDocument, x, y)) {
        const entry = bridge.byElement.get(element);
        if (entry) {
          const xpath = entry.evaluationNode.xpath;
          return { xpath, annotation: `XPath: ${xpath}` };
        }
      }
      return null;
    },
    renderReadOnly(): void {
      interactiveMarkingRendered = true;
      renderCurrent();
    },
    hoverAtPoint(
      x: number,
      y: number,
      mode: MarkMode = "exclude",
      shiftActive = false,
      hint?: MarkingPointResolutionHint,
    ): void {
      const overlayXpath = hint?.overlayXpath ?? "";
      if (
        hoverResolution?.x === x &&
        hoverResolution.y === y &&
        hoverResolution.mode === mode &&
        hoverResolution.shiftActive === shiftActive
      ) {
        return;
      }
      const cachedResolution = hoverResolution;
      const reusable = cachedResolution !== null &&
        cachedResolution.mode === mode &&
        cachedResolution.shiftActive === shiftActive &&
        cachedResolution.generation === bridgeGeneration &&
        (!cachedResolution.node || currentNodeForHint(cachedResolution.node.xpath) === cachedResolution.node);
      if (reusable && mode === "exclude" && !shiftActive && cachedResolution.node) {
        const ownerXpath = renderer.paintedExplicitOwnerAtPoint(
          x,
          y,
          bridgeGeneration,
          overlayXpath,
        ) ?? renderer.paintedExclusionOwnerAtPoint(x, y, bridgeGeneration, overlayXpath);
        if (ownerXpath === cachedResolution.node.xpath) {
          hoverResolution = { ...cachedResolution, x, y, overlayXpath };
          return;
        }
      }
      const probeElements = getComposedHitElements(rootElement.ownerDocument, x, y);
      if (reusable && sameElements(cachedResolution.probeElements, probeElements)) {
        hoverResolution = { ...cachedResolution, x, y, overlayXpath, probeElements };
        return;
      }
      prefetchedPointHits = { x, y, elements: probeElements };
      const node = this.resolveAtPoint(x, y, mode, shiftActive, hint);
      hoverResolution = {
        x,
        y,
        mode,
        shiftActive,
        overlayXpath,
        generation: bridgeGeneration,
        node,
        probeElements,
      };
      const element = node ? bridge.byXpath.get(node.xpath)?.element ?? null : null;
      renderer.setHover(element, node?.xpath ?? "");
    },
    clearHover(): void {
      cancelPreviewFocusRefresh();
      previewEmphasizedRowId = null;
      renderer.setHover(null);
      renderer.setFocus(null);
    },
    projectPreview(pageUrl: string, selectors: SelectorSet): PreviewProjection {
      if (
        currentPreviewProjection &&
        lastPreviewRequest?.pageUrl === pageUrl &&
        lastPreviewRequest.selectors.inclusionSelectors.length === selectors.inclusionSelectors.length &&
        lastPreviewRequest.selectors.exclusionSelectors.length === selectors.exclusionSelectors.length &&
        lastPreviewRequest.selectors.inclusionSelectors.every((value, index) => value === selectors.inclusionSelectors[index]) &&
        lastPreviewRequest.selectors.exclusionSelectors.every((value, index) => value === selectors.exclusionSelectors[index])
      ) {
        return currentPreviewProjection;
      }
      lastPreviewRequest = {
        pageUrl,
        selectors: {
          inclusionSelectors: [...selectors.inclusionSelectors],
          exclusionSelectors: [...selectors.exclusionSelectors],
        },
      };
      currentPreviewProjection = buildPreviewProjection(pageUrl, lastPreviewRequest.selectors);
      reconcilePreviewEmphasis();
      return currentPreviewProjection;
    },
    currentPreviewProjection(): PreviewProjection | null {
      return currentPreviewProjection;
    },
    retirePreviewProjection(): void {
      cancelPreviewFocusRefresh();
      previewEmphasizedRowId = null;
      lastPreviewRequest = null;
      currentPreviewProjection = null;
      activePreviewProjectionId = null;
      renderer.setFocus(null);
    },
    emphasizePreviewRow(targetProjectionId: string, rowId: string, active: boolean): boolean {
      const row = currentPreviewProjection?.projectionId === targetProjectionId
        ? currentPreviewProjection.rows.find((candidate) => candidate.id === rowId)
        : undefined;
      if (!row || row.target?.state === "unavailable") {
        return false;
      }
      if (!active) {
        if (previewEmphasizedRowId === rowId) {
          cancelPreviewFocusRefresh();
          previewEmphasizedRowId = null;
          renderer.setFocus(null);
        }
        return true;
      }
      const target = bridge.byKey.get(rowId);
      if (!target || previewTargetStatus(target.element).state === "unavailable") {
        return false;
      }
      previewEmphasizedRowId = rowId;
      cancelPreviewFocusRefresh();
      renderer.setFocus(target.element, target.evaluationNode.xpath);
      return true;
    },
    activatePreviewRow(targetProjectionId: string, rowId: string): boolean {
      const row = currentPreviewProjection?.projectionId === targetProjectionId
        ? currentPreviewProjection.rows.find((candidate) => candidate.id === rowId)
        : undefined;
      if (!row || row.target?.state === "unavailable") {
        return false;
      }
      const target = bridge.byKey.get(rowId);
      if (!target || previewTargetStatus(target.element).state === "unavailable") {
        return false;
      }
      previewEmphasizedRowId = rowId;
      focusAfterPreviewScroll(target.element, target.evaluationNode.xpath, {
        projectionId: targetProjectionId,
        rowId,
      });
      return true;
    },
    previewRowAtPoint(x: number, y: number): Readonly<{ projectionId: string; rowId: string }> | null {
      const projection = currentPreviewProjection;
      if (!projection) {
        return null;
      }
      const projectedIds = new Set(projection.rows.map((row) => row.id));
      for (const element of getComposedHitElements(rootElement.ownerDocument, x, y)) {
        const rowId = bridge.byElement.get(element)?.evaluationNode.key;
        if (rowId && projectedIds.has(rowId)) {
          return { projectionId: projection.projectionId, rowId };
        }
      }
      return null;
    },
    emphasizeXpath(xpath: string): boolean {
      cancelPreviewFocusRefresh();
      const target = byXpathElements().get(xpath);
      if (!target) {
        renderer.setFocus(null);
        return false;
      }
      renderer.setFocus(target.element, xpath);
      return true;
    },
    scrollXpathIntoView(xpath: string): boolean {
      const target = byXpathElements().get(xpath);
      if (!target) {
        return false;
      }
      focusAfterPreviewScroll(target.element, xpath);
      return true;
    },
    renderSilentHighlights(): readonly string[] {
      silentHighlightsArmed = true;
      return renderSilent();
    },
    clearOverlays(): void {
      cancelPreviewFocusRefresh();
      if (cancelProgressiveGeometryRender()) {
        renderer.setScrolling(false);
      }
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
        deferredBranchAffectedXpaths.clear();
      }
      hoverResolution = null;
      silentHighlightsArmed = false;
      interactiveMarkingRendered = false;
      renderer.clear();
    },
    parkPresentation(): void {
      cancelPreviewFocusRefresh();
      if (cancelProgressiveGeometryRender()) {
        renderer.setScrolling(false);
      }
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
        deferredBranchAffectedXpaths.clear();
      }
      hoverResolution = null;
      silentHighlightsArmed = false;
      interactiveMarkingRendered = false;
      renderer.clear();
      renderer.detach();
    },
    dispose(): void {
      disposed = true;
      cancelPreviewFocusRefresh();
      cancelProgressiveGeometryRender();
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
        deferredBranchAffectedXpaths.clear();
      }
      hoverResolution = null;
      previewEmphasizedRowId = null;
      lastPreviewRequest = null;
      currentPreviewProjection = null;
      activePreviewProjectionId = null;
      observerCleanup?.();
      observerCleanup = null;
      if (renderFrameHandle !== 0) {
        presentationClock.cancelFrame(renderFrameHandle);
        renderFrameHandle = 0;
        renderScheduled = false;
        scheduledWork = null;
        structuralRenderSettled = null;
      }
      renderer.dispose();
    },
    captureRenderedHtml(): string {
      return captureFlattenedHtml(rootElement);
    },
    buildSubmission(input: Readonly<{ baseUrl: string; renderMode: RenderMode; pageUrl: string; rawHtml?: string }>) {
      return buildSubmissionSnapshot({
        ...input,
        renderedHtml: captureFlattenedHtml(rootElement),
        evaluation: store.currentEvaluation(),
      });
    },
    rows() {
      return store.rows();
    },
    overlayRoot(): HTMLElement {
      return renderer.root;
    },
  };
}
