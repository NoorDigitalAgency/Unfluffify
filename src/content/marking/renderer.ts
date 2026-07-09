import type { EvaluationResult } from "../../domain/evaluate";
import type { Classification } from "../../domain/schema/marking";
import { overlayClassFor } from "./overlay";
import { isPaintReachable } from "./paint-reachability";

export type OverlayRendererOptions = Readonly<{
  document: Document;
  root?: HTMLElement;
}>;

const OVERLAY_STYLE_BY_CLASSIFICATION: Readonly<Record<Classification, { backgroundColor: string; border: string }>> = {
  "implicit-include": {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
    border: "1px solid rgba(22, 163, 74, 0.85)",
  },
  "explicit-include": {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    border: "1px solid rgba(37, 99, 235, 0.9)",
  },
  exception: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    border: "1px solid rgba(220, 38, 38, 0.9)",
  },
  immutable: {
    backgroundColor: "rgba(107, 114, 128, 0.18)",
    border: "1px solid rgba(75, 85, 99, 0.85)",
  },
  "closed-shadow": {
    backgroundColor: "rgba(168, 85, 247, 0.2)",
    border: "1px dashed rgba(147, 51, 234, 0.9)",
  },
};
const OVERLAY_LAYER_COUNT = 11;
const LAYER_BY_CLASSIFICATION: Readonly<Record<Classification, number>> = {
  "implicit-include": 2,
  "explicit-include": 3,
  exception: 4,
  immutable: 5,
  "closed-shadow": 6,
};

function applyOverlayStyle(overlay: HTMLElement, classification: Classification): void {
  const visual = OVERLAY_STYLE_BY_CLASSIFICATION[classification];
  overlay.style.boxSizing = "border-box";
  overlay.style.borderRadius = "2px";
  overlay.style.backgroundColor = visual.backgroundColor;
  overlay.style.border = visual.border;
  overlay.style.boxShadow = "0 0 0 1px rgba(15, 23, 42, 0.16)";
}

export function createOverlayRenderer(options: OverlayRendererOptions) {
  const root = options.root ?? options.document.createElement("div");
  let hoverOverlay: HTMLElement | null = null;
  root.setAttribute("data-uf-extension-ui", "true");
  root.className = "uf-marking-layer-root";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  root.style.zIndex = "2147483647";
  if (!root.parentElement) {
    options.document.documentElement.appendChild(root);
  }
  const createLayer = (index: number): HTMLElement => {
    const layer = options.document.createElement("div");
    layer.setAttribute("data-uf-extension-ui", "true");
    layer.setAttribute("data-uf-overlay-layer", String(index));
    layer.style.position = "fixed";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
    layer.style.zIndex = String(2147483600 + index);
    return layer;
  };
  const layers = Array.from({ length: OVERLAY_LAYER_COUNT }, (_value, index) => createLayer(index));
  const mountLayers = (): void => {
    root.replaceChildren();
    for (const layer of layers) {
      layer.replaceChildren();
      root.appendChild(layer);
    }
    hoverOverlay = null;
  };
  const placeOverlay = (overlay: HTMLElement, rect: DOMRect | { left: number; top: number; width: number; height: number }): void => {
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };
  return {
    root,
    render(evaluation: EvaluationResult, byXpath: ReadonlyMap<string, Element>): void {
      mountLayers();
      for (const [xpath, classification] of evaluation.overlay) {
        const element = byXpath.get(xpath);
        if (!element || !isPaintReachable(element, options.document)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const overlay = options.document.createElement("div");
        overlay.setAttribute("data-uf-extension-ui", "true");
        overlay.className = overlayClassFor(classification);
        overlay.setAttribute("data-uf-overlay-xpath", xpath);
        overlay.style.position = "absolute";
        overlay.style.pointerEvents = "none";
        applyOverlayStyle(overlay, classification);
        placeOverlay(overlay, rect);
        layers[LAYER_BY_CLASSIFICATION[classification]]?.appendChild(overlay);
      }
    },
    setHover(element: Element | null, xpath = ""): void {
      hoverOverlay?.remove();
      hoverOverlay = null;
      if (!element || !isPaintReachable(element, options.document)) {
        return;
      }
      const overlay = options.document.createElement("div");
      overlay.setAttribute("data-uf-extension-ui", "true");
      overlay.className = "uf-overlay-hover";
      overlay.setAttribute("data-uf-overlay-hover", xpath);
      overlay.style.position = "absolute";
      overlay.style.pointerEvents = "none";
      overlay.style.border = "2px solid rgba(14, 165, 233, 0.95)";
      overlay.style.backgroundColor = "rgba(14, 165, 233, 0.12)";
      overlay.style.boxSizing = "border-box";
      placeOverlay(overlay, element.getBoundingClientRect());
      hoverOverlay = overlay;
      layers[10]?.appendChild(overlay);
    },
    renderSilentHighlights(xpaths: readonly string[], byXpath: ReadonlyMap<string, Element>): void {
      for (const xpath of xpaths) {
        const element = byXpath.get(xpath);
        if (!element || !isPaintReachable(element, options.document)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const overlay = options.document.createElement("div");
        overlay.setAttribute("data-uf-extension-ui", "true");
        overlay.className = "uf-silent-highlight";
        overlay.setAttribute("data-uf-silent-highlight", xpath);
        overlay.style.position = "absolute";
        overlay.style.pointerEvents = "none";
        overlay.style.boxSizing = "border-box";
        overlay.style.border = "1px solid rgba(59, 130, 246, 0.8)";
        overlay.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
        placeOverlay(overlay, rect);
        layers[7]?.appendChild(overlay);
      }
    },
    clear(): void {
      mountLayers();
    },
    dispose(): void {
      root.remove();
    },
  };
}
