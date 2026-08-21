import { chooseWidenTarget, type WidenNode } from "../../domain/widening";
import { applySelectorSeed } from "../../domain/selector-seed";
import type { SelectorSet } from "../../storage/config";
import type { CanonicalMarkSet, Classification, MarkMode, MarkRow } from "../../domain/schema/marking";
import type { EvaluationNode } from "../../domain/evaluate";
import { captureFlattenedHtml, createDomBridgeView, type DomBridgeView } from "./dom-view";
import { getComposedHitElements } from "./hit-testing";
import { isPaintReachableWithinHits } from "./paint-reachability";
import { createMarkingStore } from "./store";
import { resolveTarget, type MarkingCandidate } from "./resolve";
import { createOverlayRenderer, type OverlayRenderTarget } from "./renderer";
import { buildSilentHighlights } from "./silent-highlight";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import type { VisibilityGeometry } from "../../domain/visibility";
import { isToggleableBoundary } from "../../domain/boundary";
import { createGeometryStabilizer } from "./stabilizer";

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
      top: rect.top,
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
  createBridge?: (rootElement: Element) => DomBridgeView;
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

/**
 * Resolve both selector groups against the already captured composed DOM. This is
 * deliberately bridge-first: document.querySelectorAll cannot enter shadow roots,
 * while an Element can answer whether it matches regardless of how it was reached.
 */
function selectorSeedForBridge(
  bridge: DomBridgeView,
  selectors: SelectorSet | null | undefined,
): Readonly<{ excludeXpaths: readonly string[]; includeXpaths: readonly string[]; seeded: boolean }> {
  if (!selectors) {
    return { excludeXpaths: [], includeXpaths: [], seeded: false };
  }
  const excludeXpaths: string[] = [];
  const includeXpaths: string[] = [];
  const documentMatches = (candidates: readonly string[]): Set<Element> => {
    const matches = new Set<Element>();
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
          matches.add(element);
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
    scopedDocumentMatches: ReadonlySet<Element>,
  ): boolean => {
    if (scopedDocumentMatches.has(element)) {
      return true;
    }
    for (const selector of candidates) {
      try {
        if (element.matches?.(selector)) {
          return true;
        }
      } catch {
        // One invalid or realm-specific selector must not block the remaining
        // selector set or the initialization transaction.
      }
    }
    return false;
  };
  for (const [xpath, entry] of bridge.byXpath) {
    if (matchesAny(entry.element, selectors.exclusionSelectors, documentExcludeMatches)) {
      excludeXpaths.push(xpath);
    }
    if (matchesAny(entry.element, selectors.inclusionSelectors, documentIncludeMatches)) {
      includeXpaths.push(xpath);
    }
  }
  return {
    excludeXpaths,
    includeXpaths,
    seeded: excludeXpaths.length > 0 || includeXpaths.length > 0,
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

export function createMarkingEngine(
  rootElement: Element,
  options: MarkingEngineInitializationOptions = {},
) {
  const instrumentation = options.instrumentation;
  const buildBridge = (): DomBridgeView => {
    const nextBridge = (instrumentation?.createBridge ?? createDomBridgeView)(rootElement);
    instrumentation?.onWorkStage?.("bridge");
    return nextBridge;
  };
  let bridge: DomBridgeView = buildBridge();
  const initial = initialMarksForBridge(bridge, { rows: [] }, options.selectors);
  let lastInitializationSeededSelectors = initial.selectorsSeeded;
  let store = createMarkingStore({ root: bridge.root }, initial.marks);
  instrumentation?.onWorkStage?.("store-evaluate");
  const renderer = (instrumentation?.createRenderer ?? createOverlayRenderer)({
    document: rootElement.ownerDocument,
  });
  let observerCleanup: (() => void) | null = null;
  let renderScheduled = false;
  type RenderWork = "geometry" | "silent-geometry" | "structural";
  let scheduledWork: RenderWork | null = null;
  let silentHighlightsArmed = false;
  // Silent borders can also be armed on top of the interactive marking UI, so
  // they cannot identify which scroll debounce the engine should use.
  let interactiveMarkingRendered = options.render === true;
  let hoverResolution: Readonly<{
    x: number;
    y: number;
    mode: MarkMode;
    shiftActive: boolean;
    node: EvaluationNode | null;
  }> | null = null;
  let candidateByXpath: Map<string, MarkingCandidate> | null = null;
  let overlayTargets = new Map<string, OverlayRenderTarget>();
  let widenByKey = new Map<string, WidenNode>();
  let bridgeGeneration = 0;
  let toggleInProgress = false;
  const generationByNode = new WeakMap<EvaluationNode, number>();
  const fingerprintByNode = new WeakMap<EvaluationNode, string>();

  const rebuildBridgeIndexes = (): void => {
    bridgeGeneration += 1;
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
    instrumentation?.onWorkStage?.("candidate-index");
  };

  const currentCandidateIndex = (): Map<string, MarkingCandidate> => {
    if (!candidateByXpath) {
      const evaluation = store.currentEvaluation();
      candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
    }
    return candidateByXpath;
  };

  const refreshBridge = (refreshOptions: MarkingEngineRefreshOptions = {}): boolean => {
    hoverResolution = null;
    const previousMarks = store.canonicalSet();
    bridge = buildBridge();
    const next = initialMarksForBridge(bridge, previousMarks, refreshOptions.selectors);
    lastInitializationSeededSelectors = next.selectorsSeeded;
    store = createMarkingStore({ root: bridge.root }, next.marks);
    instrumentation?.onWorkStage?.("store-evaluate");
    rebuildBridgeIndexes();
    if (refreshOptions.render) {
      renderCurrent();
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
    const immutableXpaths: string[] = [];
    const excludedXpaths: string[] = [];
    for (const [xpath, classification] of evaluation.overlay) {
      if (classification === "immutable" || classification === "closed-shadow") {
        immutableXpaths.push(xpath);
      } else if (classification === "exception") {
        excludedXpaths.push(xpath);
      }
    }
    renderer.renderSilentHighlights(xpaths, byXpath, { immutableXpaths, excludedXpaths });
    instrumentation?.onWorkStage?.("silent-render");
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
    const immutableXpaths: string[] = [];
    const excludedXpaths: string[] = [];
    for (const xpath of affectedXpaths) {
      const classification = evaluation.overlay.get(xpath);
      if (classification === "immutable" || classification === "closed-shadow") {
        immutableXpaths.push(xpath);
      } else if (classification === "exception") {
        excludedXpaths.push(xpath);
      }
    }
    renderer.renderSilentHighlightsBranch(xpaths, byXpath, { immutableXpaths, excludedXpaths });
    instrumentation?.onWorkStage?.("silent-render");
    return xpaths;
  };
  const renderCurrent = (): void => {
    renderer.render(store.currentEvaluation(), byXpathElements());
    instrumentation?.onWorkStage?.("marking-render");
    if (silentHighlightsArmed) {
      renderSilent();
    }
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
    const view = rootElement.ownerDocument.defaultView;
    const run = (): void => {
      renderScheduled = false;
      const nextWork = scheduledWork;
      scheduledWork = null;
      if (nextWork === "structural") {
        refreshBridge({ render: true });
        return;
      }
      const byXpath = byXpathElements();
      if (nextWork === "silent-geometry" && silentHighlightsArmed) {
        renderSilent();
        renderer.reposition(byXpath, { includeSilent: false });
      } else {
        renderer.reposition(byXpath);
      }
    };
    if (view?.requestAnimationFrame) {
      view.requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
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
      requestFrame: (callback) => view?.requestAnimationFrame
        ? view.requestAnimationFrame(callback)
        : (setTimeout(() => callback(Date.now()), 0) as unknown as number),
      cancelFrame: (handle) => view?.cancelAnimationFrame
        ? view.cancelAnimationFrame(handle)
        : clearTimeout(handle),
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
    let structuralRefreshHandle: ReturnType<typeof setTimeout> | null = null;
    let lastStructuralRefreshAt = 0;
    const scheduleStructuralRefresh = (): void => {
      if (structuralRefreshHandle !== null) {
        return;
      }
      const sinceLastRefresh = Date.now() - lastStructuralRefreshAt;
      const delay = Math.max(300, 1_200 - sinceLastRefresh);
      structuralRefreshHandle = setTimeout(() => {
        structuralRefreshHandle = null;
        lastStructuralRefreshAt = Date.now();
        scheduleRender("structural");
      }, delay);
    };
    const isExtensionNode = (node: Node): boolean => {
      const element = node.nodeType === 1 ? node as Element : node.parentElement;
      return Boolean(element?.closest?.('[data-uf-extension-ui="true"]'));
    };
    const isExtensionOnlyMutation = (record: MutationRecord): boolean => {
      // Mutations inside an extension root are ours even when a removed child is
      // already detached and can no longer find that root through `closest`.
      if (isExtensionNode(record.target)) {
        return true;
      }
      if (record.type !== "childList") {
        return false;
      }
      // Mounting or removing the root itself targets the page parent, so inspect
      // the changed nodes in that one boundary case.
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => isExtensionNode(node));
    };
    if (view?.MutationObserver) {
      const observer = new view.MutationObserver((records) => {
        if (records.every(isExtensionOnlyMutation)) {
          return;
        }
        scheduleStructuralRefresh();
      });
      observer.observe(rootElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ["class", "style", "hidden", "open", "role", "aria-hidden", "aria-expanded"],
      });
      cleanups.push(() => observer.disconnect());
    }
    if (view?.ResizeObserver) {
      const observer = new view.ResizeObserver(() => stabilizeGeometry("silent-geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    if (view?.IntersectionObserver) {
      const observer = new view.IntersectionObserver(() => stabilizeGeometry("geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    let viewportScrollHandle: ReturnType<typeof setTimeout> | null = null;
    const finishViewportScroll = (): void => {
      viewportScrollHandle = null;
      renderer.setScrolling(false);
      // Viewport scrolling has already been quiet for the mode-specific
      // debounce below. Re-entering the general geometry stabilizer here adds
      // two sampling frames before the actual repaint even though scrolling
      // cannot change the viewport or root dimensions that it samples.
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
        renderer.setScrolling(true);
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
    const scheduleResizeRender = (): void => stabilizeGeometry("silent-geometry");
    const visualViewport = view?.visualViewport;
    view?.addEventListener?.("scroll", scheduleGeometryRender, true);
    view?.addEventListener?.("resize", scheduleResizeRender);
    visualViewport?.addEventListener?.("scroll", scheduleResizeRender);
    visualViewport?.addEventListener?.("resize", scheduleResizeRender);
    cleanups.push(() => {
      if (structuralRefreshHandle !== null) {
        clearTimeout(structuralRefreshHandle);
        structuralRefreshHandle = null;
      }
      if (viewportScrollHandle !== null) {
        clearTimeout(viewportScrollHandle);
        viewportScrollHandle = null;
      }
      renderer.setScrolling(false);
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
    resolveAtPoint(x: number, y: number, mode: MarkMode, shiftActive = false): EvaluationNode | null {
      const pointHits = getComposedHitElements(rootElement.ownerDocument, x, y);
      const hits = pointHits
        .filter((element) => composedContains(rootElement, element))
        .filter((element) => isPaintReachableWithinHits(element, pointHits));
      const candidatesByXpath = currentCandidateIndex();
      const candidates = hits
        .map((element) => bridge.byElement.get(element)?.evaluationNode.xpath)
        .map((xpath) => xpath ? candidatesByXpath.get(xpath) : undefined)
        .filter((candidate): candidate is MarkingCandidate => Boolean(candidate));
      const resolved = resolveTarget(candidates, mode);
      if (!resolved) {
        return null;
      }
      if (shiftActive && mode === "exclude") {
        const widenNode = widenByKey.get(resolved.key) ?? widenByKey.get(resolved.xpath);
        const widened = widenNode ? chooseWidenTarget(widenNode) : null;
        return widened
          ? bridge.byXpath.get(widened.key)?.evaluationNode ?? bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null
          : bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null;
      }
      return bridge.byXpath.get(resolved.xpath)?.evaluationNode ?? null;
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
        const branchTargets = byXpathElementsForBranch(toggled.branchRoot);
        renderer.renderBranch(toggled, branchTargets);
        if (silentHighlightsArmed) {
          renderSilentBranch(toggled, branchTargets);
        }
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
        const branchTargets = byXpathElementsForBranch(cleared.branchRoot);
        renderer.renderBranch(cleared, branchTargets);
        if (silentHighlightsArmed) {
          renderSilentBranch(cleared, branchTargets);
        }
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
    hoverAtPoint(x: number, y: number, mode: MarkMode = "exclude", shiftActive = false): void {
      if (
        hoverResolution?.x === x &&
        hoverResolution.y === y &&
        hoverResolution.mode === mode &&
        hoverResolution.shiftActive === shiftActive
      ) {
        return;
      }
      const node = this.resolveAtPoint(x, y, mode, shiftActive);
      hoverResolution = { x, y, mode, shiftActive, node };
      const element = node ? bridge.byXpath.get(node.xpath)?.element ?? null : null;
      renderer.setHover(element, node?.xpath ?? "");
    },
    clearHover(): void {
      renderer.setHover(null);
    },
    emphasizeXpath(xpath: string): boolean {
      const target = byXpathElements().get(xpath);
      if (!target) {
        renderer.setHover(null);
        return false;
      }
      renderer.setHover(target.element, xpath);
      return true;
    },
    scrollXpathIntoView(xpath: string): boolean {
      const target = byXpathElements().get(xpath);
      if (!target) {
        return false;
      }
      renderer.setHover(target.element, xpath);
      target.element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
      return true;
    },
    renderSilentHighlights(): readonly string[] {
      silentHighlightsArmed = true;
      return renderSilent();
    },
    clearOverlays(): void {
      hoverResolution = null;
      silentHighlightsArmed = false;
      interactiveMarkingRendered = false;
      renderer.clear();
    },
    dispose(): void {
      hoverResolution = null;
      observerCleanup?.();
      observerCleanup = null;
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
