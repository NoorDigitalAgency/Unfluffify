import { chooseWidenTarget, type WidenNode } from "../../domain/widening";
import { applySelectorSeed } from "../../domain/selector-seed";
import type { SelectorSet } from "../../storage/config";
import type { CanonicalMarkSet, Classification, MarkMode, MarkRow } from "../../domain/schema/marking";
import {
  evaluatePreview,
  type EvaluationNode,
  type PreviewSelectorMatchContext,
} from "../../domain/evaluate";
import type { PreviewProjection, PreviewRow } from "../../domain/schema/preview";
import {
  captureFlattenedHtml,
  createDomBridgeView,
  type DomBridgeOptions,
  type DomBridgeView,
} from "./dom-view";
import { getComposedHitElements } from "./hit-testing";
import { isPaintReachableWithinHits } from "./paint-reachability";
import { createMarkingStore } from "./store";
import { resolveTarget, type MarkingCandidate } from "./resolve";
import {
  createOverlayRenderer,
  type OverlayRenderTarget,
} from "./renderer";
import { buildSilentHighlights, shallowXpathBoundaries } from "./silent-highlight";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import type { VisibilityGeometry } from "../../domain/visibility";
import { isToggleableBoundary } from "../../domain/boundary";
import { createGeometryStabilizer } from "./stabilizer";
import { readElementId } from "./element-identity";
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

const PREVIEW_TEXT_BLOCKED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

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
  type StoredMetadata = PreviewTextMetadata & Readonly<{ subtreeText: string }>;
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
    }
    const text = subtreeText ||
      normalizePreviewText(element.getAttribute("aria-label") ?? "") ||
      normalizePreviewText(element.getAttribute("alt") ?? "") ||
      normalizePreviewText(element.getAttribute("title") ?? "") ||
      element.tagName.toLowerCase();
    const stored = { text: boundedPreviewText(text), subtreeText, hasExcludedDescendant };
    storedMetadata.set(element, stored);
    metadata.set(element, stored);
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

const DEFERRED_BRANCH_RENDER_TARGET_THRESHOLD = 200;
// Geometry reconciliation is layout- and paint-reachability-heavy on large
// documents. Keep each presentation task below one frame's useful work while
// the retained overlay root is faded, then publish the complete generation in
// one atomic reveal. This is deliberately target-count bounded rather than
// timing based so production and deterministic test clocks follow one path.
const PROGRESSIVE_GEOMETRY_TARGET_THRESHOLD = 96;
const PROGRESSIVE_GEOMETRY_CHUNK_SIZE = 24;
// Newly inserted or removed content needs to become markable on roughly the
// same cadence as the legacy renderer. Presentation attributes are noisier
// (carousels commonly emit them in short trains), so retain the longer quiet
// window for those records without making authoritative child-list changes pay
// that latency on every refresh.
const STRUCTURAL_CHILD_LIST_QUIET_MS = 100;
const STRUCTURAL_PRESENTATION_QUIET_MS = 150;
const STRUCTURAL_MUTATION_IDLE_TIMEOUT_MS = 1_200;

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
 * path for nested scrollers, then synchronously repair only a still-offscreen
 * vertical target through the document's authoritative scrolling element. */
function scrollPreviewTargetIntoView(element: Element): void {
  element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
  const rect = element.getBoundingClientRect?.();
  const ownerDocument = element.ownerDocument;
  const view = ownerDocument?.defaultView;
  const viewportHeight = view?.visualViewport?.height ??
    view?.innerHeight ??
    ownerDocument?.documentElement?.clientHeight ??
    0;
  if (
    !rect ||
    rect.height <= 0 ||
    viewportHeight <= 0 ||
    (rect.top >= 0 && rect.bottom <= viewportHeight)
  ) {
    return;
  }
  const scrollingElement = ownerDocument?.scrollingElement ?? ownerDocument?.documentElement;
  if (!scrollingElement) {
    return;
  }
  const currentTop = scrollingElement.scrollTop;
  const centeredOffset = Math.max(0, (viewportHeight - rect.height) / 2);
  scrollingElement.scrollTop = Math.max(0, currentTop + rect.top - centeredOffset);
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
  let progressiveGeometryRenderHandle: number | null = null;
  let progressiveGeometryCycle = 0;
  let targetIntersectionObserver: IntersectionObserver | null = null;
  let intersectionSnapshotReady = false;
  let intersectionByElement = new WeakMap<Element, boolean>();
  const pendingIntersectionElements = new Set<Element>();
  const intersectingXpaths = new Set<string>();
  const intersectionDirtyXpaths = new Set<string>();
  let previewRevision = 0;
  let previewTextMetadata = new WeakMap<Element, PreviewTextMetadata>();
  let toggleInProgress = false;
  let previewEmphasizedRowId: string | null = null;
  let lastPreviewRequest: Readonly<{ pageUrl: string; selectors: SelectorSet }> | null = null;
  let currentPreviewProjection: PreviewProjection | null = null;
  const generationByNode = new WeakMap<EvaluationNode, number>();
  const fingerprintByNode = new WeakMap<EvaluationNode, string>();

  const cancelProgressiveGeometryRender = (): boolean => {
    progressiveGeometryCycle += 1;
    if (progressiveGeometryRenderHandle === null) {
      return false;
    }
    presentationClock.cancelFrame(progressiveGeometryRenderHandle);
    progressiveGeometryRenderHandle = null;
    return true;
  };

  const rebindIntersectionTargets = (): void => {
    if (!targetIntersectionObserver) {
      return;
    }
    targetIntersectionObserver.disconnect();
    intersectionSnapshotReady = false;
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
    if (!intersectionSnapshotReady) {
      return byXpathElements();
    }
    const targets = new Map<string, OverlayRenderTarget>();
    for (const xpath of intersectingXpaths) {
      const target = overlayTargets.get(xpath);
      if (target) {
        targets.set(xpath, target);
      }
    }
    for (const xpath of intersectionDirtyXpaths) {
      const target = overlayTargets.get(xpath);
      if (target) {
        targets.set(xpath, target);
      }
    }
    intersectionDirtyXpaths.clear();
    return targets;
  };

  const rebuildBridgeIndexes = (): void => {
    bridgeGeneration += 1;
    previewTextMetadata = buildPreviewTextMetadata(rootElement);
    overlayTargets = new Map([...bridge.byXpath].map(([xpath, value]) => [xpath, {
      element: value.element,
      visible: value.evaluationNode.visible,
    }]));
    widenByKey = new Map<string, WidenNode>();
    toWidenNode(bridge.root, null, widenByKey);
    for (const { evaluationNode } of bridge.byXpath.values()) {
      generationByNode.set(evaluationNode, bridgeGeneration);
      fingerprintByNode.set(evaluationNode, evaluationNodeFingerprint(evaluationNode));
    }
    const evaluation = store.currentEvaluation();
    candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
    rebindIntersectionTargets();
    reportWorkStage("candidate-index");
  };

  const currentCandidateIndex = (): Map<string, MarkingCandidate> => {
    if (!candidateByXpath) {
      const evaluation = store.currentEvaluation();
      candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
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

  const refreshBridge = (refreshOptions: MarkingEngineRefreshOptions = {}): boolean => {
    const progressiveGeometryCancelled = cancelProgressiveGeometryRender();
    if (deferredBranchRenderHandle !== null) {
      presentationClock.cancelFrame(deferredBranchRenderHandle);
      deferredBranchRenderHandle = null;
      deferredBranchTargets.clear();
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
  const byXpathElements = (): ReadonlyMap<string, OverlayRenderTarget> => overlayTargets;
  const byXpathElementsForBranch = (branchRoot: EvaluationNode): Map<string, OverlayRenderTarget> => {
    const elements = new Map<string, OverlayRenderTarget>();
    const collect = (node: EvaluationNode): void => {
      const element = bridge.byXpath.get(node.xpath)?.element;
      if (element) {
        elements.set(node.xpath, { element, visible: node.visible });
      }
      for (const child of node.children ?? []) {
        collect(child);
      }
    };
    collect(branchRoot);
    return elements;
  };
  const renderSilent = (): readonly string[] => {
    const byXpath = byXpathElements();
    const evaluation = store.currentEvaluation();
    const geometryByXpath = new Map<string, VisibilityGeometry>();
    for (const row of evaluation.rows) {
      if (row.excluded || row.explicit === true) {
        continue;
      }
      const target = byXpath.get(row.xpath);
      if (target) {
        geometryByXpath.set(row.xpath, geometryForElement(target.element));
      }
    }
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
    const geometryByXpath = new Map<string, VisibilityGeometry>();
    for (const row of branchRows) {
      if (row.excluded || row.explicit === true) {
        continue;
      }
      const target = byXpath.get(row.xpath);
      if (target) {
        geometryByXpath.set(row.xpath, geometryForElement(target.element));
      }
    }
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
    const branchTargets = byXpathElementsForBranch(branchRoot);
    if (branchTargets.size <= DEFERRED_BRANCH_RENDER_TARGET_THRESHOLD) {
      renderer.renderBranch(evaluation, branchTargets, bridgeGeneration);
      if (silentHighlightsArmed) {
        renderSilentBranch(evaluation, branchTargets);
      }
      return;
    }
    for (const [xpath, target] of branchTargets) {
      deferredBranchTargets.set(xpath, target);
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
      if (deferredBranchRenderGeneration !== bridgeGeneration) {
        return;
      }
      const current = store.currentEvaluation();
      renderer.renderBranch(current, targets, bridgeGeneration);
      if (silentHighlightsArmed) {
        renderSilentBranch(current, targets);
      }
    });
    deferredBranchRenderHandle = deferredHandle || null;
  };
  const renderGeometryProgressively = (
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
    includeSilent: boolean,
  ): void => {
    cancelProgressiveGeometryRender();
    const cycle = progressiveGeometryCycle;
    const generation = bridgeGeneration;
    const entries = [...byXpath];
    const completeXpaths = new Set(byXpath.keys());
    let offset = 0;
    renderer.setScrolling(true);

    const renderNextChunk = (): void => {
      progressiveGeometryRenderHandle = null;
      if (
        disposed ||
        cycle !== progressiveGeometryCycle ||
        generation !== bridgeGeneration
      ) {
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
      if (final) {
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
      const byXpath = viewportGeometryTargets();
      const progressive = interactiveMarkingRendered &&
        byXpath.size > PROGRESSIVE_GEOMETRY_TARGET_THRESHOLD;
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
    let observerGeometryWork: RenderWork = "geometry";
    const geometryStabilizer = createGeometryStabilizer({
      sample: () => {
        const documentElement = rootElement.ownerDocument.documentElement;
        const rect = rootElement.getBoundingClientRect();
        return [
          documentElement.clientWidth,
          documentElement.clientHeight,
          view?.devicePixelRatio ?? 1,
          rect.width,
          rect.height,
        ].join(":");
      },
      onSample: () => scheduleRender(observerGeometryWork),
      onSettled: () => {
        observerGeometryWork = "geometry";
      },
      requestFrame: (callback) => presentationClock.requestFrame(callback),
      cancelFrame: (handle) => presentationClock.cancelFrame(handle),
      maxSamples: 4,
      requiredStableSamples: 2,
    });
    const stabilizeGeometry = (work: Exclude<RenderWork, "structural">): void => {
      if (work === "silent-geometry") {
        observerGeometryWork = work;
      }
      geometryStabilizer.request();
    };
    cleanups.push(() => geometryStabilizer.cancel());
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
      structuralRenderInFlight = true;
      structuralRenderSettled = () => {
        structuralRenderInFlight = false;
        const trailingQuietMs = structuralTrailingQuietMs;
        structuralTrailingQuietMs = null;
        if (trailingQuietMs !== null) {
          scheduleStructuralRefresh(trailingQuietMs);
        }
      };
      scheduleRender("structural");
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
    if (view?.MutationObserver) {
      const observer = new view.MutationObserver((records) => {
        if (records.some(suppressedMutationTouchesBridge)) {
          // Consent suppression is intentionally extraction-irrelevant, but it
          // can hide or remove elements that already own marking rectangles.
          // Reconcile their presentation on the next paint without rebuilding
          // the extraction bridge or admitting the suppressed subtree.
          scheduleRender("geometry");
        }
        const relevantRecords = records.filter((record) =>
          !isExtractionIrrelevantMutation(record) && !isExtensionCursorClassMutation(record)
        );
        if (relevantRecords.length === 0) {
          return;
        }
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
    if (view?.ResizeObserver) {
      const observer = new view.ResizeObserver(() => stabilizeGeometry("silent-geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    if (view?.IntersectionObserver) {
      targetIntersectionObserver = new view.IntersectionObserver((entries) => {
        let changed = false;
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
        if (changed) {
          scheduleRender("geometry");
        }
      });
      rebindIntersectionTargets();
      cleanups.push(() => {
        targetIntersectionObserver?.disconnect();
        targetIntersectionObserver = null;
        intersectionSnapshotReady = false;
        intersectionByElement = new WeakMap<Element, boolean>();
        pendingIntersectionElements.clear();
        intersectingXpaths.clear();
        intersectionDirtyXpaths.clear();
      });
    }
    let viewportScrollHandle: ReturnType<typeof setTimeout> | null = null;
    const finishViewportScroll = (): void => {
      viewportScrollHandle = null;
      // Viewport scrolling has already been quiet for the mode-specific
      // debounce below. Re-entering the general geometry stabilizer here adds
      // two sampling frames before the actual repaint even though scrolling
      // cannot change the viewport or root dimensions that it samples.
      revealMarkingAfterRender = true;
      scheduleRender("geometry");
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
        if (!interactiveMarkingRendered) {
          // Silent preview is read-only and its retained rectangles are cheap to
          // reposition. Fade the stale geometry synchronously, keep it hidden
          // through the next render commit, then reveal the retained nodes.
          revealMarkingAfterRender = true;
          renderer.setScrolling(true);
          scheduleRender("geometry");
          return;
        }
        revealMarkingAfterRender = false;
        renderer.setScrolling(true);
        cancelProgressiveGeometryRender();
        if (viewportScrollHandle !== null) {
          clearTimeout(viewportScrollHandle);
        }
        // Match the legacy paths: silent highlights settle sooner, while the
        // interactive marking UI retains its more conservative scroll pause.
        const settleDelay = interactiveMarkingRendered ? 250 : 120;
        viewportScrollHandle = setTimeout(finishViewportScroll, settleDelay);
        return;
      }
      stabilizeGeometry("geometry");
    };
    const scheduleResizeRender = (): void => silentHighlightsArmed
      ? scheduleRender("geometry")
      : stabilizeGeometry("geometry");
    const visualViewport = view?.visualViewport;
    view?.addEventListener?.("scroll", scheduleGeometryRender, true);
    view?.addEventListener?.("resize", scheduleResizeRender);
    visualViewport?.addEventListener?.("scroll", scheduleResizeRender);
    visualViewport?.addEventListener?.("resize", scheduleResizeRender);
    cleanups.push(() => {
      cancelStructuralDispatch();
      structuralTrailingQuietMs = null;
      structuralRenderInFlight = false;
      structuralRenderSettled = null;
      if (viewportScrollHandle !== null) {
        clearTimeout(viewportScrollHandle);
        viewportScrollHandle = null;
      }
      renderer.setScrolling(false);
      revealMarkingAfterRender = false;
      view?.removeEventListener?.("scroll", scheduleGeometryRender, true);
      view?.removeEventListener?.("resize", scheduleResizeRender);
      visualViewport?.removeEventListener?.("scroll", scheduleResizeRender);
      visualViewport?.removeEventListener?.("resize", scheduleResizeRender);
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
            candidates.push(candidate);
          }
          candidate = candidate.parent ?? undefined;
        }
      }
      const resolved = resolveTarget(candidates, mode);
      if (!resolved) {
        return null;
      }
      if (mode === "exclude" && !shiftActive && resolved.excluded !== true) {
        return null;
      }
      if (shiftActive && mode === "exclude") {
        const widenNode = widenByKey.get(resolved.key) ?? widenByKey.get(resolved.xpath);
        const widened = widenNode ? chooseWidenTarget(widenNode) : null;
        return widened
          ? bridge.byKey.get(widened.key)?.evaluationNode ?? bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null
          : bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null;
      }
      return bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null;
    },
    acknowledge(
      node: EvaluationNode,
      mode: "include" | "exclude" | "clear",
    ): boolean {
      const current = bridge.byXpath.get(node.xpath);
      const element = current?.element as (Element & { isConnected?: boolean }) | undefined;
      if (
        current?.evaluationNode !== node ||
        generationByNode.get(node) !== bridgeGeneration ||
        fingerprintByNode.get(node) !== evaluationNodeFingerprint(node) ||
        element?.isConnected === false ||
        !element
      ) {
        return false;
      }
      if (mode === "clear") {
        const existing = store.canonicalSet().rows.find((row) =>
          row.xpath === node.xpath && row.explicit === true
        );
        if (!existing) {
          return false;
        }
        renderer.acknowledge(element, node.xpath, existing.excluded ? "exclude" : "include");
        return true;
      }
      renderer.acknowledge(element, node.xpath, mode);
      return true;
    },
    toggle(node: EvaluationNode, mode: Exclude<MarkMode, "disabled" | "passthrough">): boolean {
      const current = bridge.byXpath.get(node.xpath);
      const element = current?.element as (Element & { isConnected?: boolean }) | undefined;
      if (
        toggleInProgress ||
        current?.evaluationNode !== node ||
        generationByNode.get(node) !== bridgeGeneration ||
        fingerprintByNode.get(node) !== evaluationNodeFingerprint(node) ||
        element?.isConnected === false
      ) {
        return false;
      }
      toggleInProgress = true;
      hoverResolution = null;
      try {
        if (element) {
          renderer.acknowledge(element, node.xpath, mode);
        }
        const toggled = store.toggle(node, mode);
        candidateByXpath = null;
        interactiveMarkingRendered = true;
        renderChangedBranch(toggled, toggled.branchRoot);
        return true;
      } finally {
        toggleInProgress = false;
      }
    },
    clear(node: EvaluationNode): boolean {
      const current = bridge.byXpath.get(node.xpath);
      const element = current?.element as (Element & { isConnected?: boolean }) | undefined;
      if (
        toggleInProgress ||
        current?.evaluationNode !== node ||
        generationByNode.get(node) !== bridgeGeneration ||
        fingerprintByNode.get(node) !== evaluationNodeFingerprint(node) ||
        element?.isConnected === false
      ) {
        return false;
      }
      const existing = store.canonicalSet().rows.find((row) => row.xpath === node.xpath && row.explicit === true);
      if (!existing) {
        return false;
      }
      toggleInProgress = true;
      hoverResolution = null;
      try {
        if (element) {
          renderer.acknowledge(element, node.xpath, existing.excluded ? "exclude" : "include");
        }
        const cleared = store.clear(node);
        if (!cleared) {
          return false;
        }
        candidateByXpath = null;
        interactiveMarkingRendered = true;
        renderChangedBranch(cleared, cleared.branchRoot);
        return true;
      } finally {
        toggleInProgress = false;
      }
    },
    hasExplicitMark(node: EvaluationNode): boolean {
      return store.canonicalSet().rows.some((row) => row.xpath === node.xpath && row.explicit === true);
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
      previewEmphasizedRowId = null;
      lastPreviewRequest = null;
      currentPreviewProjection = null;
      activePreviewProjectionId = null;
      renderer.setFocus(null);
    },
    emphasizePreviewRow(targetProjectionId: string, rowId: string, active: boolean): boolean {
      if (
        currentPreviewProjection?.projectionId !== targetProjectionId ||
        !currentPreviewProjection.rows.some((row) => row.id === rowId)
      ) {
        return false;
      }
      if (!active) {
        if (previewEmphasizedRowId === rowId) {
          previewEmphasizedRowId = null;
          renderer.setFocus(null);
        }
        return true;
      }
      const target = bridge.byKey.get(rowId);
      if (!target || (target.element as Element & { isConnected?: boolean }).isConnected === false) {
        return false;
      }
      previewEmphasizedRowId = rowId;
      renderer.setFocus(target.element, target.evaluationNode.xpath);
      return true;
    },
    activatePreviewRow(targetProjectionId: string, rowId: string): boolean {
      if (
        currentPreviewProjection?.projectionId !== targetProjectionId ||
        !currentPreviewProjection.rows.some((row) => row.id === rowId)
      ) {
        return false;
      }
      const target = bridge.byKey.get(rowId);
      if (!target || (target.element as Element & { isConnected?: boolean }).isConnected === false) {
        return false;
      }
      previewEmphasizedRowId = rowId;
      renderer.setFocus(target.element, target.evaluationNode.xpath);
      scrollPreviewTargetIntoView(target.element);
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
      renderer.setFocus(target.element, xpath);
      scrollPreviewTargetIntoView(target.element);
      return true;
    },
    renderSilentHighlights(): readonly string[] {
      silentHighlightsArmed = true;
      return renderSilent();
    },
    clearOverlays(): void {
      if (cancelProgressiveGeometryRender()) {
        renderer.setScrolling(false);
      }
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
      }
      hoverResolution = null;
      silentHighlightsArmed = false;
      interactiveMarkingRendered = false;
      renderer.clear();
    },
    parkPresentation(): void {
      if (cancelProgressiveGeometryRender()) {
        renderer.setScrolling(false);
      }
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
      }
      hoverResolution = null;
      silentHighlightsArmed = false;
      interactiveMarkingRendered = false;
      renderer.clear();
      renderer.detach();
    },
    dispose(): void {
      disposed = true;
      cancelProgressiveGeometryRender();
      if (deferredBranchRenderHandle !== null) {
        presentationClock.cancelFrame(deferredBranchRenderHandle);
        deferredBranchRenderHandle = null;
        deferredBranchTargets.clear();
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
