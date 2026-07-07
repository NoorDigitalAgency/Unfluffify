import { chooseWidenTarget, type WidenNode } from "../../domain/widening";
import type { MarkMode } from "../../domain/schema/marking";
import type { Classification } from "../../domain/schema/marking";
import type { MarkRow } from "../../domain/schema/marking";
import type { EvaluationNode } from "../../domain/evaluate";
import { captureFlattenedHtml, createDomBridgeView, type DomBridgeView } from "./dom-view";
import { getComposedHitElements } from "./hit-testing";
import { isPaintReachableAt } from "./paint-reachability";
import { createMarkingStore } from "./store";
import { resolveTarget, type MarkingCandidate } from "./resolve";
import { createOverlayRenderer } from "./renderer";
import { buildSubmissionSnapshot } from "./submit";
import type { RenderMode } from "../../domain/schema/property";

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
    structuralRole: node.structuralBoundary ? "card-group" as const : "generic" as const,
    pageShell: node.pageShell,
    landmarkCount: node.landmarkCount,
    broadViewportFootprint: node.broadViewportFootprint,
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

export function createMarkingEngine(rootElement: Element) {
  let bridge: DomBridgeView = createDomBridgeView(rootElement);
  let store = createMarkingStore({ root: bridge.root });
  const renderer = createOverlayRenderer({ document: rootElement.ownerDocument });

  const refreshBridge = (): void => {
    bridge = createDomBridgeView(rootElement);
    store = createMarkingStore({ root: bridge.root }, store.canonicalSet());
  };

  return {
    refresh(): void {
      refreshBridge();
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
      store.toggle(node, mode);
      renderer.render(store.currentEvaluation(), new Map([...bridge.byXpath].map(([xpath, value]) => [xpath, value.element])));
    },
    renderReadOnly(): void {
      renderer.render(store.currentEvaluation(), new Map([...bridge.byXpath].map(([xpath, value]) => [xpath, value.element])));
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
