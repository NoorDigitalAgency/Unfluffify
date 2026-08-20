import { chooseWidenTarget, type WidenNode } from "../../domain/widening";
import { applySelectorSeed } from "../../domain/selector-seed";
import type { SelectorSet } from "../../storage/config";
import type { CanonicalMarkSet, Classification, MarkMode, MarkRow } from "../../domain/schema/marking";
import type { EvaluationNode } from "../../domain/evaluate";
import { captureFlattenedHtml, createDomBridgeView, type DomBridgeView } from "./dom-view";
import { getComposedHitElements } from "./hit-testing";
import { isPaintReachableAt } from "./paint-reachability";
import { createMarkingStore } from "./store";
import { resolveTarget, type MarkingCandidate } from "./resolve";
import { createOverlayRenderer, type OverlayRenderTarget } from "./renderer";
import { buildSilentHighlights } from "./silent-highlight";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import type { VisibilityGeometry } from "../../domain/visibility";
import { isToggleableBoundary } from "../../domain/boundary";

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

export function createMarkingEngine(rootElement: Element) {
  let bridge: DomBridgeView = createDomBridgeView(rootElement);
  let store = createMarkingStore({ root: bridge.root }, mergeDefaultExclusions(bridge.root));
  const renderer = createOverlayRenderer({ document: rootElement.ownerDocument });
  let observerCleanup: (() => void) | null = null;
  let renderScheduled = false;
  type RenderWork = "geometry" | "silent-geometry" | "structural";
  let scheduledWork: RenderWork | null = null;
  let silentHighlightsArmed = false;
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
    candidateByXpath = null;
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
  };
  rebuildBridgeIndexes();

  const currentCandidateIndex = (): Map<string, MarkingCandidate> => {
    if (!candidateByXpath) {
      const evaluation = store.currentEvaluation();
      candidateByXpath = buildCandidateIndex(bridge.root, evaluation.overlay, store.canonicalSet().rows);
    }
    return candidateByXpath;
  };

  const refreshBridge = (): void => {
    hoverResolution = null;
    bridge = createDomBridgeView(rootElement);
    store = createMarkingStore({ root: bridge.root }, mergeDefaultExclusions(bridge.root, store.canonicalSet()));
    rebuildBridgeIndexes();
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
    return xpaths;
  };
  const renderCurrent = (): void => {
    renderer.render(store.currentEvaluation(), byXpathElements());
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
        refreshBridge();
        renderCurrent();
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
      const observer = new view.ResizeObserver(() => scheduleRender("silent-geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    if (view?.IntersectionObserver) {
      const observer = new view.IntersectionObserver(() => scheduleRender("geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    let viewportScrollHandle: ReturnType<typeof setTimeout> | null = null;
    const finishViewportScroll = (): void => {
      viewportScrollHandle = null;
      renderer.setScrolling(false);
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
        viewportScrollHandle = setTimeout(finishViewportScroll, 250);
        return;
      }
      scheduleRender("geometry");
    };
    const scheduleResizeRender = (): void => scheduleRender("silent-geometry");
    view?.addEventListener?.("scroll", scheduleGeometryRender, true);
    view?.addEventListener?.("resize", scheduleResizeRender);
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
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  };
  observerCleanup = installObservers();

  /** Resolves a CSS selector to the xpaths the evaluation actually knows about.
   *  Matches outside the evaluated tree (invisible, chrome, closed shadow) have
   *  no row to seed and are skipped. */
  const xpathsMatching = (selectors: readonly string[]): string[] => {
    const found = new Set<string>();
    for (const selector of selectors) {
      let matches: ArrayLike<Element>;
      try {
        matches = rootElement.ownerDocument.querySelectorAll(selector);
      } catch {
        // A minimal/non-document realm may lack querySelectorAll; captured
        // shadow elements are still matched individually below.
        matches = [];
      }
      for (const element of Array.from(matches)) {
        const xpath = bridge.byElement.get(element)?.evaluationNode.xpath;
        if (xpath) {
          found.add(xpath);
        }
      }
      // querySelectorAll does not enter shadow roots. Captured closed roots are
      // intentionally exposed and flattened, so match every canonical bridge
      // element during this one-time simulated-user phase as well.
      for (const [xpath, entry] of bridge.byXpath) {
        try {
          if (entry.element.matches?.(selector)) {
            found.add(xpath);
          }
        } catch {
          // The document query above already validated most selectors; a
          // realm-specific/custom-element matcher may still reject one.
        }
      }
    }
    return [...found];
  };

  return {
    refresh(): void {
      refreshBridge();
    },
    /** One-time: seeds a clean session from the defaults plus the AI selectors.
     *  Returns false when there is nothing to seed from. */
    seedFromSelectors(selectors: SelectorSet): boolean {
      refreshBridge();
      const excludeXpaths = xpathsMatching(selectors.exclusionSelectors);
      const includeXpaths = xpathsMatching(selectors.inclusionSelectors);
      if (excludeXpaths.length === 0 && includeXpaths.length === 0) {
        return false;
      }
      store = createMarkingStore(
        { root: bridge.root },
        applySelectorSeed(store.canonicalSet(), { excludeXpaths, includeXpaths }),
      );
      candidateByXpath = null;
      renderCurrent();
      return true;
    },
    resolveAtPoint(x: number, y: number, mode: MarkMode, shiftActive = false): EvaluationNode | null {
      const hits = getComposedHitElements(rootElement.ownerDocument, x, y)
        .filter((element) => composedContains(rootElement, element))
        .filter((element) => isPaintReachableAt(element, x, y, rootElement.ownerDocument));
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
        renderer.renderBranch(toggled, byXpathElementsForBranch(toggled.branchRoot));
        if (silentHighlightsArmed) {
          renderSilent();
        }
        return true;
      } finally {
        toggleInProgress = false;
      }
    },
    renderReadOnly(): void {
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
    renderSilentHighlights(): readonly string[] {
      silentHighlightsArmed = true;
      return renderSilent();
    },
    clearOverlays(): void {
      hoverResolution = null;
      silentHighlightsArmed = false;
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
