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

export type OverlayRenderTarget = Readonly<{
  element: Element;
  visible: boolean;
}>;

type RectLike = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type ClassificationBox = {
  overlay: HTMLElement;
  xpath: string;
  classification: Classification;
  rect: RectLike;
  explicit: boolean;
  paintOrder: number;
};

type SilentBox = {
  overlay: HTMLElement;
  xpath: string;
  presentation: string;
  rect: RectLike;
};

type PaintedOwnerFragment = Readonly<{
  xpath: string;
  rect: RectLike;
  explicit: boolean;
  exclusion: boolean;
  paintOrder: number;
  depth: number;
}>;

const OWNER_INDEX_CELL_SIZE = 64;

function pointInRect(rect: RectLike, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width &&
    y >= rect.top && y <= rect.top + rect.height;
}

function ownerCellKey(x: number, y: number): string {
  return `${Math.floor(x / OWNER_INDEX_CELL_SIZE)}:${Math.floor(y / OWNER_INDEX_CELL_SIZE)}`;
}

const LAYER_KEYS = [
  "hard",
  "default",
  "saved-explicit-exclude",
  "saved-explicit-include",
  "ai-content",
  "session-explicit-exclude",
  "session-explicit-include",
  "silent-immutable",
  "silent-content",
  "silent-excluded",
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

const LIVE_VISIBILITY_EXCLUSION_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  "exception",
  "immutable",
  "closed-shadow",
]);

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
  // `innerWidth`/`innerHeight` include classic scrollbar gutters. Those pixels
  // are not page paint and elements underneath them cannot be hit-tested. Use
  // the document client area first so we never create a conspicuous overlay
  // for a source that is physically hidden behind a forced scrollbar.
  const viewportWidth = document.documentElement?.clientWidth
    || document.defaultView?.innerWidth
    || Number.POSITIVE_INFINITY;
  const viewportHeight = document.documentElement?.clientHeight
    || document.defaultView?.innerHeight
    || Number.POSITIVE_INFINITY;
  return rect.width > 0
    && rect.height > 0
    && rect.left + rect.width > 0
    && rect.top + rect.height > 0
    && rect.left < viewportWidth
    && rect.top < viewportHeight;
}

function rectIsPaintReachable(element: Element, rect: RectLike, document: Document): boolean {
  const viewportWidth = document.documentElement?.clientWidth
    || document.defaultView?.innerWidth
    || Number.POSITIVE_INFINITY;
  const viewportHeight = document.documentElement?.clientHeight
    || document.defaultView?.innerHeight
    || Number.POSITIVE_INFINITY;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.left + rect.width);
  const bottom = Math.min(viewportHeight, rect.top + rect.height);
  // A one-pixel viewport sliver is not a usable marking target, while the
  // overlay border itself is wider and would make otherwise invisible content
  // conspicuous. Require paint area on both axes before hit-testing it.
  if (!(right - left > 1 && bottom - top > 1)) {
    return false;
  }
  const insetX = Math.min(1, (right - left) / 2);
  const insetY = Math.min(1, (bottom - top) / 2);
  const points: ReadonlyArray<readonly [number, number]> = [
    [left + (right - left) / 2, top + (bottom - top) / 2],
    [left + insetX, top + insetY],
    [right - insetX, top + insetY],
    [left + insetX, bottom - insetY],
    [right - insetX, bottom - insetY],
  ];
  return points.some(([x, y]) => isPaintReachableAt(element, x, y, document));
}

function ownMeasurableRects(element: Element): RectLike[] {
  const getClientRects = (element as Element & {
    getClientRects?: () => ArrayLike<RectLike>;
  }).getClientRects;
  const clientRects = typeof getClientRects === "function"
    ? Array.from(getClientRects.call(element))
    : [];
  const measurable = clientRects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (measurable.length > 0) {
    return measurable;
  }
  const boundingRect = element.getBoundingClientRect();
  return boundingRect.width > 0 && boundingRect.height > 0 ? [boundingRect] : [];
}

function composedElementChildren(element: Element): Element[] {
  const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  return [...Array.from(shadowRoot?.children ?? []), ...Array.from(element.children ?? [])]
    .filter((child) => child.getAttribute("data-uf-extension-ui") !== "true");
}

function hasNormalizedText(element: Element): boolean {
  const visit = (node: Node): string => {
    if (node.nodeType === 3) {
      return node.textContent ?? "";
    }
    return Array.from(node.childNodes ?? []).map(visit).join(" ");
  };
  return /\S/.test(visit(element).replace(/\s+/g, " "));
}

/** A display:contents/collapsed textual wrapper owns the semantic XPath, while
 * the first visible painted descendant in breadth-first order owns its
 * geometry. The 200-node ceiling matches the approved legacy safety bound. */
function nearestDescendantRects(
  element: Element,
  accept: (candidate: Element, rect: RectLike) => boolean,
  remember?: (candidate: Element) => void,
): RectLike[] {
  if (!hasNormalizedText(element)) {
    return [];
  }
  const queue = composedElementChildren(element);
  let cursor = 0;
  let inspected = 0;
  while (cursor < queue.length && inspected < 200) {
    const candidate = queue[cursor];
    cursor += 1;
    inspected += 1;
    if (!candidate || !isCurrentlyVisuallyVisible(candidate)) {
      continue;
    }
    const rects = ownMeasurableRects(candidate).filter((rect) => accept(candidate, rect));
    if (rects.length > 0) {
      remember?.(candidate);
      return rects;
    }
    queue.push(...composedElementChildren(candidate));
  }
  return [];
}

function clientRectsFor(element: Element, document: Document): RectLike[] {
  const visible = ownPaintReachableClientRectsFor(element, document);
  if (visible.length > 0) {
    return visible;
  }
  return nearestDescendantRects(element, (candidate, rect) =>
    rectInViewport(rect, document) && rectIsPaintReachable(candidate, rect, document)
  );
}

/** Uses the same geometry promise as focus/hover painting. This is intentionally
 * viewport-scoped: callers use it only when a Preview target is already inside
 * the current viewport and can therefore prove (or disprove) an immediate
 * focus paint without scrolling the page. */
export function hasPaintReachableTargetGeometry(element: Element): boolean {
  return clientRectsFor(element, element.ownerDocument).length > 0;
}

function ownPaintReachableClientRectsFor(element: Element, document: Document): RectLike[] {
  return ownMeasurableRects(element).filter((rect) =>
    rectInViewport(rect, document) && rectIsPaintReachable(element, rect, document)
  );
}

/** Raw geometry is deliberately separate from paint-reachable geometry. It is
 *  used only for retained explicit marks: a visible include must survive a
 *  transient cover, while a genuinely hidden include becomes a ghost. */
function rawClientRectsFor(element: Element): RectLike[] {
  const measurable = ownMeasurableRects(element);
  if (measurable.length > 0) {
    return measurable;
  }
  return nearestDescendantRects(element, () => true);
}

/** Preview retains technical extraction rows, including rows that have no page
 * box. Keep that taxonomy separate from whether an occurrence can truthfully
 * receive a visible focus treatment. */
export function hasRenderableTargetGeometry(element: Element): boolean {
  return rawClientRectsFor(element).length > 0;
}

function composedParentElement(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = element.getRootNode?.();
  return root && "host" in root ? (root as ShadowRoot).host : null;
}

function isComposedDescendantOf(candidate: Element, ancestor: Element): boolean {
  let current: Element | null = candidate;
  let depth = 0;
  while (current && depth < 200) {
    if (current === ancestor) {
      return true;
    }
    current = composedParentElement(current);
    depth += 1;
  }
  return false;
}

function cssRectClipHasNoPaint(value: string): boolean {
  const match = /^rect\((.*)\)$/iu.exec(value.trim());
  if (!match) {
    return false;
  }
  const authored = match[1] ?? "";
  const parts = (authored.includes(",") ? authored.split(",") : authored.split(/\s+/u))
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 4) {
    return false;
  }
  const coordinate = (part: string): number | null => {
    if (part.toLowerCase() === "auto") return null;
    const parsed = Number.parseFloat(part);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const [top, right, bottom, left] = parts.map(coordinate);
  return (right !== null && left !== null && right <= left) ||
    (bottom !== null && top !== null && bottom <= top);
}

/** Paint hit-testing alone is insufficient for opacity-zero UI: browsers keep
 * such elements pointer-addressable. Recheck the live composed ancestor chain
 * before drawing an exclusion while leaving the evaluator's extraction state
 * untouched. */
export function isCurrentlyVisuallyVisible(
  element: Element,
  measuredSourceRect?: RectLike,
): boolean {
  const view = element.ownerDocument.defaultView;
  const connection = element as Element & { isConnected?: boolean };
  if (!view || connection.isConnected === false) {
    return false;
  }
  // Gesture resolution may already have measured the candidate to reject
  // offscreen siblings. Reuse that same-task rectangle so a live visibility
  // proof never forces a duplicate layout read.
  const sourceRect = measuredSourceRect ?? element.getBoundingClientRect();
  if (!(sourceRect.width > 0 && sourceRect.height > 0)) {
    return false;
  }
  let paintLeft = sourceRect.left;
  let paintTop = sourceRect.top;
  let paintRight = sourceRect.left + sourceRect.width;
  let paintBottom = sourceRect.top + sourceRect.height;
  let current: Element | null = element;
  while (current) {
    const html = current as HTMLElement;
    const style = view.getComputedStyle(current);
    const clipPath = String(style.clipPath ?? "").replaceAll(" ", "").toLowerCase();
    const clip = String(style.clip ?? "").replaceAll(" ", "").toLowerCase();
    const zeroClipPath = /^(?:circle\(0(?:px|%)?(?:at[^)]*)?\)|ellipse\(0(?:px|%)?0(?:px|%)?(?:at[^)]*)?\)|inset\((?:50%){1,4}\))$/u.test(clipPath);
    const zeroRectClip = cssRectClipHasNoPaint(clip);
    if (
      html.hidden === true ||
      current.hasAttribute("hidden") ||
      current.hasAttribute("data-uf-consent-hidden") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number(style.opacity) <= 0.01 ||
      zeroClipPath ||
      zeroRectClip
    ) {
      return false;
    }
    if (current !== element) {
      const ancestorRect = current.getBoundingClientRect();
      const overflowX = style.overflowX || style.overflow || "visible";
      const overflowY = style.overflowY || style.overflow || "visible";
      if (/^(?:hidden|clip|scroll|auto)$/u.test(overflowX)) {
        paintLeft = Math.max(paintLeft, ancestorRect.left);
        paintRight = Math.min(paintRight, ancestorRect.right);
      }
      if (/^(?:hidden|clip|scroll|auto)$/u.test(overflowY)) {
        paintTop = Math.max(paintTop, ancestorRect.top);
        paintBottom = Math.min(paintBottom, ancestorRect.bottom);
      }
      if (!(paintRight - paintLeft > 1 && paintBottom - paintTop > 1)) {
        return false;
      }
    }
    current = composedParentElement(current);
  }
  return true;
}

function placeOverlay(overlay: HTMLElement, rect: RectLike): void {
  overlay.style.visibility = "";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function classificationKey(xpath: string, classification: Classification, presentation: string, index: number): string {
  return `${xpath}\u0000${classification}\u0000${presentation}\u0000${index}`;
}

function silentKey(xpath: string, presentation: string, index: number): string {
  return `${xpath}\u0000${presentation}\u0000${index}`;
}

function hasProjectedExceptionAncestor(
  xpath: string,
  classifications: ReadonlyMap<string, Classification>,
): boolean {
  let cursor = xpath;
  while (cursor.lastIndexOf("/") > 0) {
    cursor = cursor.slice(0, cursor.lastIndexOf("/"));
    if (classifications.get(cursor) === "exception") {
      return true;
    }
  }
  return false;
}

export function createOverlayRenderer(options: OverlayRendererOptions) {
  const releaseStyles = retainOverlayStyles(options.document);
  const root = options.root ?? options.document.createElement("div");
  const classificationByXpath = new Map<string, Classification>();
  const classificationBoxes = new Map<string, ClassificationBox>();
  const silentPresentationByXpath = new Map<string, string>();
  const silentBoxes = new Map<string, SilentBox>();
  const hoverBoxes = new Map<string, HTMLElement>();
  const focusBoxes = new Map<string, HTMLElement>();
  const latestTargetByXpath = new Map<string, OverlayRenderTarget>();
  let hoverElement: Element | null = null;
  let hoverXpath = "";
  let focusElement: Element | null = null;
  let focusXpath = "";
  let acknowledgementClearHandle: ReturnType<typeof setTimeout> | null = null;
  let silentDebugAnnotations = false;
  let passthroughActive = false;
  let inputTransparent = false;
  let scrolling = false;
  let renderGeneration = 0;
  let paintOrder = 0;
  let explicitExclusionXpaths = new Set<string>();
  let explicitMarkXpaths = new Set<string>();
  let ownerIndexGeneration = -1;
  let ownerFragmentsByCell = new Map<string, PaintedOwnerFragment[]>();
  // Marking and silent layers are rendered synchronously from the same DOM
  // generation. Retain paint-reachable rects only until the next microtask so
  // that the immediately following silent pass can reuse the expensive native
  // hit tests without carrying geometry across page work or viewport changes.
  let geometryBatch: Map<Element, RectLike[]> | null = null;
  let ownPaintGeometryBatch: Map<Element, RectLike[]> | null = null;
  let visibilityBatch: Map<Element, boolean> | null = null;
  let descendantGeometryAnchorByElement = new WeakMap<Element, Element>();
  let geometryBatchGeneration = 0;

  const beginRetainedGeometryBatch = (): void => {
    geometryBatch = new Map<Element, RectLike[]>();
    ownPaintGeometryBatch = new Map<Element, RectLike[]>();
    visibilityBatch = new Map<Element, boolean>();
    geometryBatchGeneration += 1;
    const generation = geometryBatchGeneration;
    queueMicrotask(() => {
      if (geometryBatchGeneration === generation) {
        geometryBatch = null;
        ownPaintGeometryBatch = null;
        visibilityBatch = null;
      }
    });
  };

  const beginGeometryBatch = (): void => {
    geometryBatchGeneration += 1;
    geometryBatch = new Map<Element, RectLike[]>();
    ownPaintGeometryBatch = new Map<Element, RectLike[]>();
    visibilityBatch = new Map<Element, boolean>();
  };

  const endGeometryBatch = (): void => {
    geometryBatchGeneration += 1;
    geometryBatch = null;
    ownPaintGeometryBatch = null;
    visibilityBatch = null;
  };

  const measuredOwnPaintRectsFor = (element: Element): RectLike[] => {
    const retained = ownPaintGeometryBatch?.get(element);
    if (retained) {
      return retained;
    }
    const measured = ownPaintReachableClientRectsFor(element, options.document);
    ownPaintGeometryBatch?.set(element, measured);
    return measured;
  };

  const measuredVisibilityFor = (element: Element): boolean => {
    const retained = visibilityBatch?.get(element);
    if (retained !== undefined) {
      return retained;
    }
    const measured = isCurrentlyVisuallyVisible(element);
    visibilityBatch?.set(element, measured);
    return measured;
  };

  const measuredClientRectsFor = (element: Element): RectLike[] => {
    const retained = geometryBatch?.get(element);
    if (retained) {
      return retained;
    }
    const own = measuredOwnPaintRectsFor(element);
    const accept = (candidate: Element, rect: RectLike): boolean =>
      rectInViewport(rect, options.document)
      && rectIsPaintReachable(candidate, rect, options.document);
    let measured = own;
    if (measured.length === 0) {
      const retainedAnchor = descendantGeometryAnchorByElement.get(element);
      if (
        retainedAnchor
        && retainedAnchor.isConnected !== false
        && isComposedDescendantOf(retainedAnchor, element)
        && isCurrentlyVisuallyVisible(retainedAnchor)
      ) {
        measured = ownMeasurableRects(retainedAnchor).filter((rect) =>
          accept(retainedAnchor, rect)
        );
      }
      if (measured.length === 0) {
        descendantGeometryAnchorByElement.delete(element);
        measured = nearestDescendantRects(element, accept, (candidate) => {
          descendantGeometryAnchorByElement.set(element, candidate);
        });
      }
    }
    geometryBatch?.set(element, measured);
    return measured;
  };

  /** Read every target's computed visibility and native geometry before the
   * first overlay style write. Without this phase, each following
   * getClientRects()/elementsFromPoint() can synchronously flush the style
   * written for the previous box, producing page-size resize tasks. */
  const primeGeometryBatch = (byXpath: ReadonlyMap<string, OverlayRenderTarget>): void => {
    const seen = new Set<Element>();
    for (const target of byXpath.values()) {
      if (seen.has(target.element)) continue;
      seen.add(target.element);
      measuredVisibilityFor(target.element);
      measuredClientRectsFor(target.element);
    }
  };

  const adoptTargets = (
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
    replace = false,
  ): void => {
    if (replace) {
      latestTargetByXpath.clear();
    }
    for (const [xpath, target] of byXpath) {
      latestTargetByXpath.set(xpath, target);
    }
  };

  const exclusionPresentationIsPaintable = (xpath: string): boolean => {
    const target = latestTargetByXpath.get(xpath);
    return Boolean(
      target &&
      measuredVisibilityFor(target.element) &&
      measuredOwnPaintRectsFor(target.element).length > 0,
    );
  };

  const pruneInvisibleExclusions = (): number => {
    beginGeometryBatch();
    let removed = 0;
    const paintableByXpath = new Map<string, boolean>();
    const paintable = (xpath: string): boolean => {
      const retained = paintableByXpath.get(xpath);
      if (retained !== undefined) {
        return retained;
      }
      const next = exclusionPresentationIsPaintable(xpath);
      paintableByXpath.set(xpath, next);
      return next;
    };
    try {
      for (const [key, record] of classificationBoxes) {
        if (
          LIVE_VISIBILITY_EXCLUSION_CLASSIFICATIONS.has(record.classification) &&
          !paintable(record.xpath)
        ) {
          record.overlay.remove();
          classificationBoxes.delete(key);
          removed += 1;
        }
      }
      for (const [key, record] of silentBoxes) {
        const exclusion = record.presentation.includes("uf-silent-immutable") ||
          record.presentation.includes("uf-silent-excluded");
        if (exclusion && !paintable(record.xpath)) {
          record.overlay.remove();
          silentBoxes.delete(key);
          removed += 1;
        }
      }
    } finally {
      endGeometryBatch();
    }
    if (removed > 0) {
      rebuildPaintedOwnerIndex(renderGeneration);
    }
    return removed;
  };

  const rebuildPaintedOwnerIndex = (generation: number): void => {
    const next = new Map<string, PaintedOwnerFragment[]>();
    for (const record of classificationBoxes.values()) {
      const exclusion = record.classification === "exception";
      const explicit = explicitMarkXpaths.has(record.xpath);
      if (!exclusion && !explicit) {
        continue;
      }
      const fragment: PaintedOwnerFragment = {
        xpath: record.xpath,
        rect: record.rect,
        explicit,
        exclusion,
        paintOrder: record.paintOrder,
        depth: record.xpath.split("/").length,
      };
      const minColumn = Math.floor(record.rect.left / OWNER_INDEX_CELL_SIZE);
      const maxColumn = Math.floor((record.rect.left + record.rect.width) / OWNER_INDEX_CELL_SIZE);
      const minRow = Math.floor(record.rect.top / OWNER_INDEX_CELL_SIZE);
      const maxRow = Math.floor((record.rect.top + record.rect.height) / OWNER_INDEX_CELL_SIZE);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const key = `${column}:${row}`;
          const bucket = next.get(key) ?? [];
          bucket.push(fragment);
          next.set(key, bucket);
        }
      }
    }
    ownerFragmentsByCell = next;
    ownerIndexGeneration = generation;
    renderGeneration = generation;
  };

  const adoptEvaluationMetadata = (evaluation: EvaluationResult): void => {
    explicitMarkXpaths = new Set(evaluation.rows
      .filter((row) => row.explicit === true)
      .map((row) => row.xpath));
    explicitExclusionXpaths = new Set(evaluation.rows
      .filter((row) => row.excluded === true && row.explicit === true)
      .map((row) => row.xpath));
  };

  const updateClientArea = (): void => {
    const view = options.document.defaultView;
    const documentElement = options.document.documentElement;
    const viewportWidth = view?.innerWidth ?? documentElement.clientWidth;
    const viewportHeight = view?.innerHeight ?? documentElement.clientHeight;
    const clientWidth = documentElement.clientWidth || viewportWidth;
    const clientHeight = documentElement.clientHeight || viewportHeight;
    const direction = view?.getComputedStyle?.(documentElement).direction ?? documentElement.dir;
    const leftGutter = direction === "rtl" ? Math.max(0, viewportWidth - clientWidth) : 0;
    root.style.inset = "auto";
    root.style.left = `${leftGutter}px`;
    root.style.top = "0";
    root.style.width = `${clientWidth}px`;
    root.style.height = `${clientHeight}px`;
  };

  root.setAttribute("data-uf-extension-ui", "true");
  root.className = "uf-marking-layer-root";
  // These structural declarations intentionally stay inline as a fail-safe:
  // page CSP and hostile author styles must never move or activate the chrome.
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.pointerEvents = "auto";
  root.style.zIndex = "2147483647";
  const syncRootPointerEvents = (): void => {
    root.style.pointerEvents = passthroughActive || inputTransparent ? "none" : "auto";
  };
  updateClientArea();
  const attach = (): void => {
    if (!root.parentElement) {
      options.document.documentElement.appendChild(root);
    }
  };
  attach();

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
    target: OverlayRenderTarget | undefined,
    used: Set<string>,
  ): void => {
    if (!target) {
      return;
    }
    // Chromium can retain opacity-zero carousel content in elementsFromPoint().
    // Hit reachability is therefore necessary but not sufficient for ordinary
    // marking paint. Only an explicit inclusion owns the legacy ghost contract;
    // implicit content and every exclusion class disappear with live visual
    // invisibility.
    const visuallyHiddenClassification = classification !== "explicit-include"
      && !measuredVisibilityFor(target.element);
    const unpaintedException = classification === "exception" && !target.visible;
    if (visuallyHiddenClassification || unpaintedException) {
      return;
    }
    const layerKey = LAYER_BY_CLASSIFICATION[classification];
    let presentation = overlayClassFor(classification);
    let rects = LIVE_VISIBILITY_EXCLUSION_CLASSIFICATIONS.has(classification)
      ? measuredOwnPaintRectsFor(target.element)
      : measuredClientRectsFor(target.element);
    if (rects.length === 0 && classification === "explicit-include") {
      rects = rawClientRectsFor(target.element).filter((rect) => rectInViewport(rect, options.document));
      if (!target.visible) {
        presentation = "uf-explicit-include-ghost";
      }
    }
    const layer = layers.get(layerKey);
    if (!layer) {
      return;
    }
    for (let index = 0; index < rects.length; index += 1) {
      const key = classificationKey(xpath, classification, presentation, index);
      let record = classificationBoxes.get(key);
      if (!record) {
        const overlay = options.document.createElement("div");
        overlay.setAttribute("data-uf-extension-ui", "true");
        overlay.setAttribute("data-uf-overlay-xpath", xpath);
        overlay.setAttribute("data-uf-overlay-classification", classification);
        overlay.setAttribute("data-uf-overlay-rect", String(index));
        overlay.className = `uf-rect ${presentation}`;
        record = {
          overlay,
          xpath,
          classification,
          rect: rects[index]!,
          explicit: explicitExclusionXpaths.has(xpath),
          paintOrder: 0,
        };
        classificationBoxes.set(key, record);
        layer.appendChild(overlay);
      }
      record.rect = rects[index]!;
      record.explicit = explicitExclusionXpaths.has(xpath);
      record.paintOrder = ++paintOrder;
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

  const drawCurrentClassifications = (byXpath: ReadonlyMap<string, OverlayRenderTarget>): void => {
    if (classificationByXpath.size === 0) {
      // Silent-only preview has no marking presentation to reconcile. Avoid
      // scanning its document-scale target corpus merely to miss every lookup;
      // stale marking boxes are still retired if a prior marking transaction
      // cleared the authoritative classification map.
      finalizeClassification(new Set());
      return;
    }
    const used = new Set<string>();
    // Geometry-only work owns an intersection-bounded target corpus. Iterate
    // that corpus directly: walking every classification just to discover that
    // almost all have no measured target made a small resize pay O(document)
    // ancestor checks before drawing the few visible rectangles.
    for (const [xpath, target] of byXpath) {
      const classification = classificationByXpath.get(xpath);
      if (!classification) {
        continue;
      }
      if (classification === "exception" && hasProjectedExceptionAncestor(xpath, classificationByXpath)) {
        continue;
      }
      drawClassification(xpath, classification, target, used);
    }
    finalizeClassification(used);
  };

  const drawCurrentClassificationBranch = (
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
  ): void => {
    const affected = new Set(byXpath.keys());
    const used = new Set<string>();
    for (const [xpath, target] of byXpath) {
      const classification = classificationByXpath.get(xpath);
      if (!classification || (
        classification === "exception" &&
        hasProjectedExceptionAncestor(xpath, classificationByXpath)
      )) {
        continue;
      }
      drawClassification(xpath, classification, target, used);
    }
    finalizeClassification(used, affected);
  };

  const drawSilent = (
    byXpath: ReadonlyMap<string, OverlayRenderTarget>,
    affected?: ReadonlySet<string>,
    preserveUnmeasured = false,
  ): void => {
    const used = new Set<string>();
    const unmeasured = new Set<string>();
    const drawPresentation = (xpath: string, requestedPresentation: string): void => {
      const target = byXpath.get(xpath);
      if (!target) {
        if (preserveUnmeasured) {
          // A bounded viewport corpus deliberately omits offscreen sources.
          // Retain their keyed nodes hidden so scrolling never destroys and
          // recreates presentation identity.
          unmeasured.add(xpath);
        }
        return;
      }
      const isExcludedPresentation = requestedPresentation.includes("uf-silent-immutable")
        || requestedPresentation.includes("uf-silent-excluded");
      if (isExcludedPresentation && !measuredVisibilityFor(target.element)) {
        return;
      }
      const presentation = requestedPresentation === "uf-silent-content" && !target.visible
        ? "uf-silent-content uf-silent-content-ghost"
        : requestedPresentation;
      const layerKey: LayerKey = presentation.includes("uf-silent-immutable")
        ? "silent-immutable"
        : presentation.includes("uf-silent-excluded")
          ? "silent-excluded"
          : "silent-content";
      const layer = layers.get(layerKey);
      if (!layer) {
        return;
      }
      let rects = isExcludedPresentation
        ? measuredOwnPaintRectsFor(target.element)
        : measuredClientRectsFor(target.element);
      if (rects.length === 0 && presentation.includes("uf-silent-content-ghost")) {
        rects = rawClientRectsFor(target.element);
      }
      if (preserveUnmeasured && rects.length === 0) {
        // Viewport movement can make a still-canonical source temporarily
        // ineligible for strict paint hit-testing. Keep its keyed projection
        // mounted until it is measurable again; structural/silent renders do
        // not use this exception and remain authoritative for removals.
        unmeasured.add(xpath);
      }
      for (let index = 0; index < rects.length; index += 1) {
        const key = silentKey(xpath, presentation, index);
        let record = silentBoxes.get(key);
        if (!record) {
          const overlay = options.document.createElement("div");
          overlay.setAttribute("data-uf-extension-ui", "true");
          overlay.setAttribute("data-uf-silent-highlight", xpath);
          overlay.setAttribute("data-uf-overlay-rect", String(index));
          overlay.className = `uf-silent-rect ${presentation}`;
          record = { overlay, xpath, presentation, rect: rects[index]! };
          silentBoxes.set(key, record);
          layer.appendChild(overlay);
        }
        if (silentDebugAnnotations) {
          record.overlay.setAttribute("data-uf-silent-copy", "true");
          record.overlay.setAttribute("title", `XPath: ${xpath}`);
        } else {
          record.overlay.removeAttribute?.("data-uf-silent-copy");
          record.overlay.removeAttribute?.("title");
        }
        record.rect = rects[index]!;
        placeOverlay(record.overlay, record.rect);
        used.add(key);
      }
    };
    if (affected) {
      for (const xpath of affected) {
        const presentation = silentPresentationByXpath.get(xpath);
        if (presentation) {
          drawPresentation(xpath, presentation);
        }
      }
    } else {
      for (const [xpath, presentation] of silentPresentationByXpath) {
        drawPresentation(xpath, presentation);
      }
    }
    for (const [key, record] of silentBoxes) {
      if (unmeasured.has(record.xpath)) {
        record.overlay.style.visibility = "hidden";
        continue;
      }
      if (
        (!affected || affected.has(record.xpath))
        && !used.has(key)
      ) {
        record.overlay.remove();
        silentBoxes.delete(key);
      }
    }
  };

  const drawHover = (): void => {
    const used = new Set<string>();
    const layer = layers.get("hover");
    if (layer && hoverElement) {
      const rects = measuredClientRectsFor(hoverElement);
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

  const drawFocus = (): void => {
    const used = new Set<string>();
    const layer = layers.get("focus");
    if (layer && focusElement) {
      const rects = measuredClientRectsFor(focusElement);
      for (let index = 0; index < rects.length; index += 1) {
        const key = `${focusXpath}\u0000${index}`;
        let overlay = focusBoxes.get(key);
        if (!overlay) {
          overlay = options.document.createElement("div");
          overlay.setAttribute("data-uf-extension-ui", "true");
          overlay.setAttribute("data-uf-overlay-focus", focusXpath);
          overlay.setAttribute("data-uf-overlay-rect", String(index));
          overlay.className = "uf-rect uf-focus";
          focusBoxes.set(key, overlay);
          layer.appendChild(overlay);
        }
        placeOverlay(overlay, rects[index]!);
        used.add(key);
      }
    }
    for (const [key, overlay] of focusBoxes) {
      if (!used.has(key)) {
        overlay.remove();
        focusBoxes.delete(key);
      }
    }
  };

  const clearAcknowledgement = (): void => {
    if (acknowledgementClearHandle !== null) {
      clearTimeout(acknowledgementClearHandle);
      acknowledgementClearHandle = null;
    }
    layers.get("interaction")?.replaceChildren();
  };

  const setRootState = (
    className: "uf-scrolling" | "uf-marking-temporarily-disabled",
    active: boolean,
  ): void => {
    const classes = new Set(root.className.split(/\s+/).filter(Boolean));
    if (active) {
      classes.add(className);
    } else {
      classes.delete(className);
    }
    root.className = [...classes].join(" ");
  };

  const clearBoxes = (): void => {
    endGeometryBatch();
    clearAcknowledgement();
    for (const layer of layers.values()) {
      layer.replaceChildren();
    }
    classificationByXpath.clear();
    classificationBoxes.clear();
    silentPresentationByXpath.clear();
    silentBoxes.clear();
    hoverBoxes.clear();
    focusBoxes.clear();
    hoverElement = null;
    hoverXpath = "";
    focusElement = null;
    focusXpath = "";
    ownerFragmentsByCell.clear();
    ownerIndexGeneration = -1;
  };

  mountLayers();
  return {
    root,
    attach,
    detach(): void {
      root.remove();
    },
    retainedViewportXpaths(): ReadonlySet<string> {
      const xpaths = new Set<string>();
      for (const record of classificationBoxes.values()) {
        xpaths.add(record.xpath);
      }
      for (const record of silentBoxes.values()) {
        if (record.overlay.style.visibility !== "hidden") {
          xpaths.add(record.xpath);
        }
      }
      return xpaths;
    },
    viewportPresentationXpaths(): ReadonlySet<string> {
      // IntersectionObserver tracks the complete bridge so structural and
      // focus contracts retain their source authority. Viewport geometry must
      // only admit nodes that can actually own marking/silent paint; allowing
      // every intersecting wrapper turns a product-grid scroll into hundreds
      // of empty geometry chunks and leaves the real borders faded for seconds.
      return new Set([
        ...classificationByXpath.keys(),
        ...silentPresentationByXpath.keys(),
      ]);
    },
    previewXpathAtPoint(x: number, y: number): string | null {
      if (scrolling) {
        return null;
      }
      let winner: SilentBox | null = null;
      let winnerRank = -1;
      // Silent boxes are keyed and identity-stable. Their retained geometry is
      // therefore stronger page-to-row authority than a page Element identity:
      // reactive sites can replace a visible node after projection without
      // changing the row or the rectangle the operator actually clicked.
      for (const record of silentBoxes.values()) {
        if (
          record.overlay.style.visibility === "hidden"
          || !pointInRect(record.rect, x, y)
        ) {
          continue;
        }
        const rank = record.presentation.includes("uf-silent-excluded")
          ? 2
          : record.presentation.includes("uf-silent-content")
            ? 1
            : 0;
        // Later siblings paint above earlier siblings inside one layer; the
        // excluded/content/immutable ranks mirror their layer order.
        if (rank >= winnerRank) {
          winner = record;
          winnerRank = rank;
        }
      }
      return winner?.xpath ?? null;
    },
    render(
      evaluation: EvaluationResult,
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      generation = renderGeneration + 1,
    ): void {
      descendantGeometryAnchorByElement = new WeakMap<Element, Element>();
      beginRetainedGeometryBatch();
      adoptTargets(byXpath, true);
      adoptEvaluationMetadata(evaluation);
      const submittedXpaths = new Set(evaluation.rows.map((row) => row.xpath));
      classificationByXpath.clear();
      for (const [xpath, classification] of evaluation.overlay) {
        // The evaluator intentionally classifies structural wrappers so they
        // remain valid hover/widen candidates, but legacy marking paint only
        // draws implicit content that is part of the canonical row corpus.
        // Keep richer evaluator state out of this presentation-only filter.
        if (classification !== "implicit-include" || submittedXpaths.has(xpath)) {
          classificationByXpath.set(xpath, classification);
        }
      }
      drawCurrentClassifications(byXpath);
      rebuildPaintedOwnerIndex(generation);
    },
    renderBranch(
      evaluation: EvaluationResult,
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      generation = renderGeneration,
      affectedXpaths: ReadonlySet<string> = new Set(byXpath.keys()),
    ): void {
      for (const target of byXpath.values()) {
        descendantGeometryAnchorByElement.delete(target.element);
      }
      beginRetainedGeometryBatch();
      adoptTargets(byXpath);
      adoptEvaluationMetadata(evaluation);
      const affected = affectedXpaths;
      const submittedXpaths = new Set(evaluation.rows.map((row) => row.xpath));
      const used = new Set<string>();
      for (const xpath of affected) {
        const classification = evaluation.overlay.get(xpath);
        if (!classification || (
          classification === "implicit-include" && !submittedXpaths.has(xpath)
        )) {
          classificationByXpath.delete(xpath);
          continue;
        }
        classificationByXpath.set(xpath, classification);
      }
      for (const [xpath, target] of byXpath) {
        const classification = classificationByXpath.get(xpath);
        if (!classification || (
          classification === "exception" &&
          hasProjectedExceptionAncestor(xpath, classificationByXpath)
        )) {
          continue;
        }
        drawClassification(xpath, classification, target, used);
      }
      finalizeClassification(used, affected);
      rebuildPaintedOwnerIndex(generation);
    },
    reposition(
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      renderOptions: Readonly<{ includeSilent?: boolean; generation?: number }> = {},
    ): void {
      beginGeometryBatch();
      try {
        updateClientArea();
        primeGeometryBatch(byXpath);
        drawCurrentClassifications(byXpath);
        if (renderOptions.includeSilent !== false) {
          drawSilent(byXpath, undefined, true);
        }
        drawHover();
        drawFocus();
        rebuildPaintedOwnerIndex(renderOptions.generation ?? renderGeneration);
      } finally {
        endGeometryBatch();
      }
    },
    repositionBranch(
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      renderOptions: Readonly<{
        completeXpaths?: ReadonlySet<string>;
        final?: boolean;
        includeSilent?: boolean;
        generation?: number;
      }> = {},
    ): void {
      beginGeometryBatch();
      try {
        updateClientArea();
        primeGeometryBatch(byXpath);
        drawCurrentClassificationBranch(byXpath);
        if (renderOptions.includeSilent !== false) {
          drawSilent(byXpath, new Set(byXpath.keys()), true);
        }
        if (renderOptions.final === true) {
          if (renderOptions.completeXpaths) {
            for (const [key, record] of classificationBoxes) {
              if (!renderOptions.completeXpaths.has(record.xpath)) {
                record.overlay.remove();
                classificationBoxes.delete(key);
              }
            }
            for (const [key, record] of silentBoxes) {
              if (!renderOptions.completeXpaths.has(record.xpath)) {
                record.overlay.remove();
                silentBoxes.delete(key);
              }
            }
          }
          drawHover();
          drawFocus();
          rebuildPaintedOwnerIndex(renderOptions.generation ?? renderGeneration);
        }
      } finally {
        endGeometryBatch();
      }
    },
    setHover(element: Element | null, xpath = ""): void {
      const nextXpath = element ? xpath : "";
      if (hoverElement === element && hoverXpath === nextXpath) {
        return;
      }
      hoverElement = element;
      hoverXpath = nextXpath;
      beginGeometryBatch();
      try {
        drawHover();
      } finally {
        endGeometryBatch();
      }
    },
    setFocus(element: Element | null, xpath = ""): void {
      const nextXpath = element ? xpath : "";
      if (focusElement === element && focusXpath === nextXpath) {
        return;
      }
      focusElement = element;
      focusXpath = nextXpath;
      beginGeometryBatch();
      try {
        drawFocus();
      } finally {
        endGeometryBatch();
      }
    },
    refreshFocus(): void {
      beginGeometryBatch();
      try {
        drawFocus();
      } finally {
        endGeometryBatch();
      }
    },
    pruneInvisibleExclusions,
    paintedExclusionOwnerAtPoint(
      x: number,
      y: number,
      generation: number,
      preferredXpath = "",
    ): string | null {
      if (scrolling || generation !== ownerIndexGeneration) {
        return null;
      }
      const matches = (ownerFragmentsByCell.get(ownerCellKey(x, y)) ?? [])
        .filter((fragment) => fragment.exclusion && pointInRect(fragment.rect, x, y));
      const preferred = preferredXpath
        ? matches.find((fragment) => fragment.xpath === preferredXpath)
        : undefined;
      if (preferred) {
        return preferred.xpath;
      }
      matches.sort((left, right) =>
        Number(right.explicit) - Number(left.explicit) ||
        right.paintOrder - left.paintOrder ||
        right.depth - left.depth
      );
      return matches[0]?.xpath ?? null;
    },
    paintedExplicitOwnerAtPoint(
      x: number,
      y: number,
      generation: number,
      preferredXpath = "",
    ): string | null {
      if (scrolling || generation !== ownerIndexGeneration) {
        return null;
      }
      const matches = (ownerFragmentsByCell.get(ownerCellKey(x, y)) ?? [])
        .filter((fragment) => fragment.explicit && pointInRect(fragment.rect, x, y));
      const preferred = preferredXpath
        ? matches.find((fragment) => fragment.xpath === preferredXpath)
        : undefined;
      if (preferred) {
        return preferred.xpath;
      }
      matches.sort((left, right) =>
        right.paintOrder - left.paintOrder || right.depth - left.depth
      );
      return matches[0]?.xpath ?? null;
    },
    renderSilentHighlights(
      xpaths: readonly string[],
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      categories: Readonly<{
        immutableXpaths?: readonly string[];
        excludedXpaths?: readonly string[];
      }> = {},
    ): void {
      adoptTargets(byXpath, true);
      silentPresentationByXpath.clear();
      for (const xpath of categories.immutableXpaths ?? []) {
        silentPresentationByXpath.set(xpath, "uf-silent-immutable");
      }
      for (const xpath of xpaths) {
        silentPresentationByXpath.set(xpath, "uf-silent-content");
      }
      for (const xpath of categories.excludedXpaths ?? []) {
        silentPresentationByXpath.set(xpath, "uf-silent-excluded");
      }
      if (!geometryBatch) {
        beginGeometryBatch();
      }
      try {
        drawSilent(byXpath);
      } finally {
        endGeometryBatch();
      }
    },
    renderSilentHighlightsBranch(
      xpaths: readonly string[],
      byXpath: ReadonlyMap<string, OverlayRenderTarget>,
      categories: Readonly<{
        immutableXpaths?: readonly string[];
        excludedXpaths?: readonly string[];
      }> = {},
    ): void {
      adoptTargets(byXpath);
      const affected = new Set(byXpath.keys());
      for (const xpath of affected) {
        silentPresentationByXpath.delete(xpath);
      }
      for (const xpath of categories.immutableXpaths ?? []) {
        silentPresentationByXpath.set(xpath, "uf-silent-immutable");
      }
      for (const xpath of xpaths) {
        silentPresentationByXpath.set(xpath, "uf-silent-content");
      }
      for (const xpath of categories.excludedXpaths ?? []) {
        silentPresentationByXpath.set(xpath, "uf-silent-excluded");
      }
      if (!geometryBatch) {
        beginGeometryBatch();
      }
      try {
        drawSilent(byXpath, affected);
      } finally {
        endGeometryBatch();
      }
    },
    clearSilentHighlights(): void {
      silentPresentationByXpath.clear();
      for (const record of silentBoxes.values()) {
        record.overlay.remove();
      }
      silentBoxes.clear();
    },
    acknowledge(element: Element, xpath: string, mode: "include" | "exclude"): void {
      clearAcknowledgement();
      const layer = layers.get("interaction");
      if (!layer) {
        return;
      }
      beginGeometryBatch();
      let rects: RectLike[];
      try {
        rects = measuredClientRectsFor(element);
      } finally {
        endGeometryBatch();
      }
      const presentation = mode === "include" ? "uf-explicit-include" : "uf-explicit-exclude";
      for (let index = 0; index < rects.length; index += 1) {
        const overlay = options.document.createElement("div");
        overlay.setAttribute("data-uf-extension-ui", "true");
        overlay.setAttribute("data-uf-interaction-ack", xpath);
        overlay.setAttribute("data-uf-overlay-rect", String(index));
        overlay.className = `uf-rect ${presentation} uf-interaction-ack`;
        placeOverlay(overlay, rects[index]!);
        layer.appendChild(overlay);
      }
      if (rects.length > 0) {
        acknowledgementClearHandle = setTimeout(clearAcknowledgement, 180);
      }
    },
    rejectAtPoint(x: number, y: number): void {
      clearAcknowledgement();
      const layer = layers.get("interaction");
      if (!layer) {
        return;
      }
      const overlay = options.document.createElement("div");
      overlay.setAttribute("data-uf-extension-ui", "true");
      overlay.setAttribute("data-uf-interaction-invalid", "true");
      overlay.className = "uf-rect uf-interaction-invalid";
      placeOverlay(overlay, { left: x - 9, top: y - 9, width: 18, height: 18 });
      layer.appendChild(overlay);
      acknowledgementClearHandle = setTimeout(clearAcknowledgement, 240);
    },
    setPassthrough(active: boolean): void {
      passthroughActive = active;
      syncRootPointerEvents();
      setRootState("uf-marking-temporarily-disabled", active);
      if (active) {
        hoverElement = null;
        hoverXpath = "";
        drawHover();
      }
    },
    setInputTransparent(active: boolean): void {
      // Silent and preview modes use the independent interaction shield as the
      // physical hit target. Keep the marking presentation unchanged while
      // allowing explicitly interactive extension children (debug builds) to
      // opt back in with their own pointer-events declaration.
      inputTransparent = active;
      syncRootPointerEvents();
    },
    setSuspended(active: boolean): void {
      setRootState("uf-marking-temporarily-disabled", active);
    },
    setSilentDebugAnnotations(active: boolean): void {
      silentDebugAnnotations = active;
      for (const record of silentBoxes.values()) {
        if (active) {
          record.overlay.setAttribute("data-uf-silent-copy", "true");
          record.overlay.setAttribute("title", `XPath: ${record.xpath}`);
        } else {
          record.overlay.removeAttribute?.("data-uf-silent-copy");
          record.overlay.removeAttribute?.("title");
        }
      }
    },
    setScrolling(active: boolean): void {
      scrolling = active;
      setRootState("uf-scrolling", active);
    },
    clear(): void {
      clearBoxes();
    },
    dispose(): void {
      clearBoxes();
      latestTargetByXpath.clear();
      root.remove();
      releaseStyles();
    },
  };
}
