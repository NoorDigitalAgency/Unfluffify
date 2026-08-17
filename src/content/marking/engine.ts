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
import { createOverlayRenderer } from "./renderer";
import { buildSilentHighlights } from "./silent-highlight";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";
import { isToggleableDefaultTag } from "../../domain/taxonomy";
import type { VisibilityGeometry } from "../../domain/visibility";

function toCandidate(
  node: EvaluationNode,
  evaluation: ReadonlyMap<string, Classification> = new Map<string, Classification>(),
  rows: readonly MarkRow[] = [],
): MarkingCandidate {
  const classification = evaluation.get(node.xpath);
  const ownRow = rows.find((row) => row.xpath === node.xpath);
  return {
    key: node.key,
    xpath: node.xpath,
    selfMarkable: Boolean(node.visible && !node.closedShadow && !node.immutable && !node.chrome && (node.ownsDirectText || node.structuralBoundary)),
    excluded: classification === "exception",
    explicitInclude: ownRow?.excluded === false && ownRow.explicit === true,
    closedShadow: node.closedShadow,
    children: (node.children ?? []).map((child) => toCandidate(child, evaluation, rows)),
  };
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

function toWidenNode(node: EvaluationNode, parent?: WidenNode | null): WidenNode {
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
  widenNode.children = (node.children ?? []).map((child) => toWidenNode(child, widenNode));
  return widenNode;
}

function findEvaluationNode(root: EvaluationNode, xpath: string): EvaluationNode | null {
  if (root.xpath === xpath) {
    return root;
  }
  for (const child of root.children ?? []) {
    const found = findEvaluationNode(child, xpath);
    if (found) {
      return found;
    }
  }
  return null;
}

function findWidenNode(root: WidenNode, key: string): WidenNode | null {
  if (root.key === key) {
    return root;
  }
  for (const child of root.children ?? []) {
    const found = findWidenNode(child, key);
    if (found) {
      return found;
    }
  }
  return null;
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
  let scheduledWork: "geometry" | "structural" | null = null;
  let silentHighlightsArmed = false;

  const refreshBridge = (): void => {
    bridge = createDomBridgeView(rootElement);
    store = createMarkingStore({ root: bridge.root }, mergeDefaultExclusions(bridge.root, store.canonicalSet()));
  };
  const byXpathElements = (): Map<string, Element> => new Map([...bridge.byXpath].map(([xpath, value]) => [xpath, value.element]));
  const byXpathElementsForBranch = (branchRoot: EvaluationNode): Map<string, Element> => {
    const elements = new Map<string, Element>();
    const collect = (node: EvaluationNode): void => {
      const element = bridge.byXpath.get(node.xpath)?.element;
      if (element) {
        elements.set(node.xpath, element);
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
    const geometryByXpath = new Map([...byXpath].map(([xpath, element]) => [xpath, geometryForElement(element)]));
    const xpaths = buildSilentHighlights(store.currentEvaluation(), geometryByXpath);
    renderer.renderSilentHighlights(xpaths, byXpath);
    return xpaths;
  };
  const renderCurrent = (): void => {
    renderer.render(store.currentEvaluation(), byXpathElements());
    if (silentHighlightsArmed) {
      renderSilent();
    }
  };
  const scheduleRender = (work: "geometry" | "structural"): void => {
    if (work === "structural" || scheduledWork === null) {
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
      renderer.reposition(byXpath);
      if (silentHighlightsArmed) {
        renderSilent();
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
        scheduleRender("structural");
      });
      observer.observe(rootElement, { childList: true, subtree: true, attributes: true, characterData: true });
      cleanups.push(() => observer.disconnect());
    }
    if (view?.ResizeObserver) {
      const observer = new view.ResizeObserver(() => scheduleRender("geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    if (view?.IntersectionObserver) {
      const observer = new view.IntersectionObserver(() => scheduleRender("geometry"));
      observer.observe(rootElement);
      cleanups.push(() => observer.disconnect());
    }
    const scheduleGeometryRender = (): void => scheduleRender("geometry");
    view?.addEventListener?.("scroll", scheduleGeometryRender, true);
    view?.addEventListener?.("resize", scheduleGeometryRender);
    cleanups.push(() => {
      view?.removeEventListener?.("scroll", scheduleGeometryRender, true);
      view?.removeEventListener?.("resize", scheduleGeometryRender);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  };
  observerCleanup = installObservers();

  /** Resolves a CSS selector to the xpaths the evaluation actually knows about.
   *  Matches outside the evaluated tree (invisible, chrome, closed shadow) have
   *  no row to seed and are skipped. */
  const xpathsMatching = (selectors: readonly string[]): string[] => {
    const found: string[] = [];
    for (const selector of selectors) {
      let matches: ArrayLike<Element>;
      try {
        matches = rootElement.ownerDocument.querySelectorAll(selector);
      } catch {
        // A backend selector the browser rejects must not abort the whole seed.
        continue;
      }
      for (const element of Array.from(matches)) {
        const xpath = bridge.byElement.get(element)?.evaluationNode.xpath;
        if (xpath) {
          found.push(xpath);
        }
      }
    }
    return found;
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
      renderCurrent();
      return true;
    },
    resolveAtPoint(x: number, y: number, mode: MarkMode, shiftActive = false): EvaluationNode | null {
      const hits = getComposedHitElements(rootElement.ownerDocument, x, y)
        .filter((element) => composedContains(rootElement, element))
        .filter((element) => isPaintReachableAt(element, x, y, rootElement.ownerDocument));
      const evaluation = store.currentEvaluation();
      const candidates = hits
        .map((element) => bridge.byElement.get(element)?.evaluationNode)
        .filter((node): node is EvaluationNode => Boolean(node))
        .map((node) => toCandidate(node, evaluation.overlay, store.canonicalSet().rows));
      const resolved = resolveTarget(candidates, mode);
      if (!resolved) {
        return null;
      }
      if (shiftActive && mode === "exclude") {
        const widenRoot = toWidenNode(bridge.root);
        const widenNode = findWidenNode(widenRoot, resolved.xpath);
        const widened = widenNode ? chooseWidenTarget(widenNode) : null;
        return widened ? findEvaluationNode(bridge.root, widened.key) : findEvaluationNode(bridge.root, resolved.xpath);
      }
      return findEvaluationNode(bridge.root, resolved.xpath);
    },
    toggle(node: EvaluationNode, mode: Exclude<MarkMode, "disabled" | "passthrough">): void {
      const toggled = store.toggle(node, mode);
      renderer.renderBranch(toggled, byXpathElementsForBranch(toggled.branchRoot));
      if (silentHighlightsArmed) {
        renderSilent();
      }
    },
    renderReadOnly(): void {
      renderCurrent();
    },
    hoverAtPoint(x: number, y: number): void {
      const node = this.resolveAtPoint(x, y, "exclude");
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
      silentHighlightsArmed = false;
      renderer.clear();
    },
    dispose(): void {
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
