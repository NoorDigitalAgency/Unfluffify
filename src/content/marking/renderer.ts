import type { EvaluationResult } from "../../domain/evaluate";
import type { Classification } from "../../domain/schema/marking";
import {
  MARKING_OVERLAY_STYLE_ID,
  MARKING_OVERLAY_STYLES,
  overlayClassFor,
} from "./overlay";
import { isPaintReachableAt } from "./paint-reachability";

export type OverlayRendererOptions = Readonly<{
  document: Document;
  root?: HTMLElement;
}>;

type RectLike = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type ClassificationBox = Readonly<{
  overlay: HTMLElement;
  xpath: string;
  classification: Classification;
}>;

type SilentBox = Readonly<{
  overlay: HTMLElement;
  xpath: string;
}>;

const LAYER_KEYS = [
  "hard",
  "default",
  "saved-explicit-exclude",
  "saved-explicit-include",
  "ai-content",
  "session-explicit-exclude",
  "session-explicit-include",
  "silent",
  "focus",
  "hover",
  "interaction",
] as const;

type LayerKey = typeof LAYER_KEYS[number];

const LAYER_BY_CLASSIFICATION: Readonly<Record<Classification, LayerKey>> = {
  "implicit-include": "default",
  "explicit-include": "session-explicit-include",
  exception: "session-explicit-exclude",
  immutable: "hard",
  "closed-shadow": "hard",
};

const styleLeases = new WeakMap<Document, { element: HTMLStyleElement; count: number }>();

function retainOverlayStyles(document: Document): () => void {
  const retained = styleLeases.get(document);
  if (retained) {
    retained.count += 1;
    return () => releaseOverlayStyles(document);
  }
  const element = document.createElement("style");
  element.id = MARKING_OVERLAY_STYLE_ID;
  element.setAttribute("data-uf-extension-ui", "true");
  element.textContent = MARKING_OVERLAY_STYLES;
  document.documentElement.appendChild(element);
  styleLeases.set(document, { element, count: 1 });
  return () => releaseOverlayStyles(document);
}

function releaseOverlayStyles(document: Document): void {
  const retained = styleLeases.get(document);
  if (!retained) {
    return;
  }
  retained.count -= 1;
  if (retained.count > 0) {
    return;
  }
  retained.element.remove();
  styleLeases.delete(document);
}

function rectInViewport(rect: RectLike, document: Document): boolean {
  const viewportWidth = document.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY;
  const viewportHeight = document.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY;
  return rect.width > 0
    && rect.height > 0
    && rect.left + rect.width >= 0
    && rect.top + rect.height >= 0
    && rect.left <= viewportWidth
    && rect.top <= viewportHeight;
}

function rectIsPaintReachable(element: Element, rect: RectLike, document: Document): boolean {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const insetX = Math.min(1, rect.width / 2);
  const insetY = Math.min(1, rect.height / 2);
  const points: ReadonlyArray<readonly [number, number]> = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + insetX, rect.top + insetY],
    [right - insetX, rect.top + insetY],
    [rect.left + insetX, bottom - insetY],
    [right - insetX, bottom - insetY],
  ];
  return points.some(([x, y]) => isPaintReachableAt(element, x, y, document));
}

function clientRectsFor(element: Element, document: Document): RectLike[] {
  const getClientRects = (element as Element & {
    getClientRects?: () => ArrayLike<RectLike>;
  }).getClientRects;
  const clientRects = typeof getClientRects === "function"
    ? Array.from(getClientRects.call(element))
    : [];
  const visible = clientRects.filter((rect) =>
    rectInViewport(rect, document) && rectIsPaintReachable(element, rect, document)
  );
  if (visible.length > 0) {
    return visible;
  }
  const boundingRect = element.getBoundingClientRect();
  return rectInViewport(boundingRect, document)
    && rectIsPaintReachable(element, boundingRect, document)
    ? [boundingRect]
    : [];
}

function placeOverlay(overlay: HTMLElement, rect: RectLike): void {
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function classificationKey(xpath: string, classification: Classification, index: number): string {
  return `${xpath}\u0000${classification}\u0000${index}`;
}

function silentKey(xpath: string, index: number): string {
  return `${xpath}\u0000${index}`;
}

export function createOverlayRenderer(options: OverlayRendererOptions) {
  const releaseStyles = retainOverlayStyles(options.document);
  const root = options.root ?? options.document.createElement("div");
  const classificationByXpath = new Map<string, Classification>();
  const classificationBoxes = new Map<string, ClassificationBox>();
  const silentXpaths = new Set<string>();
  const silentBoxes = new Map<string, SilentBox>();
  const hoverBoxes = new Map<string, HTMLElement>();
  let hoverElement: Element | null = null;
  let hoverXpath = "";

  root.setAttribute("data-uf-extension-ui", "true");
  root.className = "uf-marking-layer-root";
  // These structural declarations intentionally stay inline as a fail-safe:
  // page CSP and hostile author styles must never move or activate the chrome.
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  root.style.zIndex = "2147483647";
  if (!root.parentElement) {
    options.document.documentElement.appendChild(root);
  }

  const layers = new Map<LayerKey, HTMLElement>();
  for (const key of LAYER_KEYS) {
    const layer = options.document.createElement("div");
    layer.setAttribute("data-uf-extension-ui", "true");
    layer.setAttribute("data-uf-overlay-layer", key);
    layer.setAttribute("data-layer", key);
    layer.className = "uf-layer";
    layers.set(key, layer);
  }

  const mountLayers = (): void => {
    root.replaceChildren();
    for (const key of LAYER_KEYS) {
      const layer = layers.get(key);
      if (layer) {
        root.appendChild(layer);
      }
    }
  };

  const drawClassification = (
    xpath: string,
    classification: Classification,
    element: Element | undefined,
    used: Set<string>,
  ): void => {
    if (!element) {
      return;
    }
    const layer = layers.get(LAYER_BY_CLASSIFICATION[classification]);
    if (!layer) {
      return;
    }
    const rects = clientRectsFor(element, options.document);
    for (let index = 0; index < rects.length; index += 1) {
      const key = classificationKey(xpath, classification, index);
      let record = classificationBoxes.get(key);
      if (!record) {
        const overlay = options.document.createElement("div");
        overlay.setAttribute("data-uf-extension-ui", "true");
        overlay.setAttribute("data-uf-overlay-xpath", xpath);
        overlay.setAttribute("data-uf-overlay-classification", classification);
        overlay.setAttribute("data-uf-overlay-rect", String(index));
        overlay.className = `uf-rect ${overlayClassFor(classification)}`;
        record = { overlay, xpath, classification };
        classificationBoxes.set(key, record);
        layer.appendChild(overlay);
      }
      placeOverlay(record.overlay, rects[index]!);
      used.add(key);
    }
  };

  const finalizeClassification = (used: ReadonlySet<string>, affected?: ReadonlySet<string>): void => {
    for (const [key, record] of classificationBoxes) {
      if ((!affected || affected.has(record.xpath)) && !used.has(key)) {
        record.overlay.remove();
        classificationBoxes.delete(key);
      }
    }
  };

  const drawCurrentClassifications = (byXpath: ReadonlyMap<string, Element>): void => {
    const used = new Set<string>();
    for (const [xpath, classification] of classificationByXpath) {
      drawClassification(xpath, classification, byXpath.get(xpath), used);
    }
    finalizeClassification(used);
  };

  const drawSilent = (byXpath: ReadonlyMap<string, Element>): void => {
    const used = new Set<string>();
    const layer = layers.get("silent");
    if (!layer) {
      return;
    }
    for (const xpath of silentXpaths) {
      const element = byXpath.get(xpath);
      if (!element) {
        continue;
      }
      const rects = clientRectsFor(element, options.document);
      for (let index = 0; index < rects.length; index += 1) {
        const key = silentKey(xpath, index);
        let record = silentBoxes.get(key);
        if (!record) {
          const overlay = options.document.createElement("div");
          overlay.setAttribute("data-uf-extension-ui", "true");
          overlay.setAttribute("data-uf-silent-highlight", xpath);
          overlay.setAttribute("data-uf-overlay-rect", String(index));
          overlay.className = "uf-silent-rect uf-silent-content";
          record = { overlay, xpath };
          silentBoxes.set(key, record);
          layer.appendChild(overlay);
        }
        placeOverlay(record.overlay, rects[index]!);
        used.add(key);
      }
    }
    for (const [key, record] of silentBoxes) {
      if (!used.has(key)) {
        record.overlay.remove();
        silentBoxes.delete(key);
      }
    }
  };

  const drawHover = (): void => {
    const used = new Set<string>();
    const layer = layers.get("hover");
    if (layer && hoverElement) {
      const rects = clientRectsFor(hoverElement, options.document);
      for (let index = 0; index < rects.length; index += 1) {
        const key = `${hoverXpath}\u0000${index}`;
        let overlay = hoverBoxes.get(key);
        if (!overlay) {
          overlay = options.document.createElement("div");
          overlay.setAttribute("data-uf-extension-ui", "true");
          overlay.setAttribute("data-uf-overlay-hover", hoverXpath);
          overlay.setAttribute("data-uf-overlay-rect", String(index));
          overlay.className = "uf-rect uf-hover";
          hoverBoxes.set(key, overlay);
          layer.appendChild(overlay);
        }
        placeOverlay(overlay, rects[index]!);
        used.add(key);
      }
    }
    for (const [key, overlay] of hoverBoxes) {
      if (!used.has(key)) {
        overlay.remove();
        hoverBoxes.delete(key);
      }
    }
  };

  const clearBoxes = (): void => {
    for (const layer of layers.values()) {
      layer.replaceChildren();
    }
    classificationByXpath.clear();
    classificationBoxes.clear();
    silentXpaths.clear();
    silentBoxes.clear();
    hoverBoxes.clear();
    hoverElement = null;
    hoverXpath = "";
  };

  mountLayers();
  return {
    root,
    render(evaluation: EvaluationResult, byXpath: ReadonlyMap<string, Element>): void {
      classificationByXpath.clear();
      for (const [xpath, classification] of evaluation.overlay) {
        classificationByXpath.set(xpath, classification);
      }
      drawCurrentClassifications(byXpath);
    },
    renderBranch(evaluation: EvaluationResult, byXpath: ReadonlyMap<string, Element>): void {
      const affected = new Set(byXpath.keys());
      const used = new Set<string>();
      for (const [xpath, element] of byXpath) {
        const classification = evaluation.overlay.get(xpath);
        if (!classification) {
          classificationByXpath.delete(xpath);
          continue;
        }
        classificationByXpath.set(xpath, classification);
        drawClassification(xpath, classification, element, used);
      }
      finalizeClassification(used, affected);
    },
    reposition(byXpath: ReadonlyMap<string, Element>): void {
      drawCurrentClassifications(byXpath);
      drawSilent(byXpath);
      drawHover();
    },
    setHover(element: Element | null, xpath = ""): void {
      hoverElement = element;
      hoverXpath = element ? xpath : "";
      drawHover();
    },
    renderSilentHighlights(xpaths: readonly string[], byXpath: ReadonlyMap<string, Element>): void {
      silentXpaths.clear();
      for (const xpath of xpaths) {
        silentXpaths.add(xpath);
      }
      drawSilent(byXpath);
    },
    clear(): void {
      clearBoxes();
    },
    dispose(): void {
      clearBoxes();
      root.remove();
      releaseStyles();
    },
  };
}
