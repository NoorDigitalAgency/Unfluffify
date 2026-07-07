import type { EvaluationResult } from "../../domain/evaluate";
import { overlayClassFor } from "./overlay";

export type OverlayRendererOptions = Readonly<{
  document: Document;
  root?: HTMLElement;
}>;

export function createOverlayRenderer(options: OverlayRendererOptions) {
  const root = options.root ?? options.document.createElement("div");
  root.setAttribute("data-uf-extension-ui", "true");
  root.className = "uf-marking-layer-root";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  root.style.zIndex = "2147483647";
  if (!root.parentElement) {
    options.document.documentElement.appendChild(root);
  }
  return {
    root,
    render(evaluation: EvaluationResult, byXpath: ReadonlyMap<string, Element>): void {
      root.replaceChildren();
      for (const [xpath, classification] of evaluation.overlay) {
        const element = byXpath.get(xpath);
        if (!element) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const overlay = options.document.createElement("div");
        overlay.className = overlayClassFor(classification);
        overlay.setAttribute("data-uf-overlay-xpath", xpath);
        overlay.style.position = "absolute";
        overlay.style.pointerEvents = "none";
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        root.appendChild(overlay);
      }
    },
    clear(): void {
      root.replaceChildren();
    },
  };
}
