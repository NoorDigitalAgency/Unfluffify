import { createMarkingEngine } from "../../../src/content/marking/engine";
import { presentationClockFor } from "../../../src/content/presentation-clock";

type TargetPoint = Readonly<{
  id: string;
  xpath: string;
  x: number;
  y: number;
}>;

const presentationClock = presentationClockFor(window);
const engine = createMarkingEngine(document.documentElement, { render: true });
const initialRows = JSON.stringify(engine.rows());
let latestPointer: Readonly<{
  x: number;
  y: number;
  overlayXpath: string;
  inputAt: number;
}> | null = null;
let hoverHandle = 0;
let lastHover: Readonly<{ xpath: string; latencyMs: number }> | null = null;
let lastScrollInputAt = 0;
let silentFadeLatencyMs: number | null = null;
let silentLatencyMs: number | null = null;

function xpathForElement(element: Element): string {
  const segments: string[] = [];
  let cursor: Element | null = element;
  while (cursor) {
    const tag = cursor.tagName.toLowerCase();
    const siblings = cursor.parentElement
      ? Array.from(cursor.parentElement.children).filter(
          (sibling) => sibling.tagName.toLowerCase() === tag,
        )
      : [cursor];
    segments.unshift(tag + "[" + String(siblings.indexOf(cursor) + 1) + "]");
    cursor = cursor.parentElement;
  }
  return "/" + segments.join("/");
}

function overlayXpathFromTarget(target: EventTarget | null): string {
  const overlay = (target as Element | null)?.closest?.("[data-uf-overlay-xpath]");
  return overlay?.closest?.(".uf-marking-layer-root")
    ? overlay.getAttribute("data-uf-overlay-xpath") ?? ""
    : "";
}

function hoverXpath(): string {
  return document.querySelector<HTMLElement>("[data-uf-overlay-hover]")
    ?.getAttribute("data-uf-overlay-hover") ?? "";
}

function scheduleHover(): void {
  if (hoverHandle || !latestPointer) {
    return;
  }
  hoverHandle = presentationClock.requestFrame(() => {
    hoverHandle = 0;
    const pointer = latestPointer;
    if (!pointer) {
      return;
    }
    if (pointer.overlayXpath) {
      engine.hoverAtPoint(pointer.x, pointer.y, "exclude", true, {
        overlayXpath: pointer.overlayXpath,
      });
    } else {
      engine.hoverAtPoint(pointer.x, pointer.y, "exclude", true);
    }
    lastHover = {
      xpath: hoverXpath(),
      latencyMs: performance.now() - pointer.inputAt,
    };
  });
}

const onMouseMove = (event: MouseEvent): void => {
  latestPointer = {
    x: event.clientX,
    y: event.clientY,
    overlayXpath: overlayXpathFromTarget(event.target),
    inputAt: performance.now(),
  };
  scheduleHover();
};
const onScroll = (): void => {
  const inputAt = performance.now();
  lastScrollInputAt = inputAt;
  silentFadeLatencyMs = null;
  silentLatencyMs = null;
  queueMicrotask(() => {
    if (lastScrollInputAt !== inputAt || silentFadeLatencyMs !== null) {
      return;
    }
    const root = document.querySelector<HTMLElement>(".uf-marking-layer-root");
    const layers = retainedSilentLayers();
    const rootOpacity = root ? Number(getComputedStyle(root).opacity) : 1;
    if (
      root?.classList.contains("uf-scrolling") &&
      layers.length > 0 &&
      layers.every((layer) => rootOpacity * layer.opacity <= 0.01)
    ) {
      silentFadeLatencyMs = performance.now() - inputAt;
    }
  });
};
document.addEventListener("mousemove", onMouseMove, true);
document.addEventListener("scroll", onScroll, true);

const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-p23-target]"));
const silentTarget = targets.at(-1) ?? null;
const silentXpath = silentTarget ? xpathForElement(silentTarget) : "";
let initialSilentBox: HTMLElement | null = null;
let initialSilentTop = "";
let initialSilentBoxes: HTMLElement[] = [];
let initialSilentGeometry = "";
let silentObserver: MutationObserver | null = null;

function silentBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-uf-silent-highlight]"));
}

function silentGeometry(boxes = silentBoxes()): string {
  return JSON.stringify(boxes.map((box) => ({
    xpath: box.getAttribute("data-uf-silent-highlight") ?? "",
    left: box.style.left,
    top: box.style.top,
    width: box.style.width,
    height: box.style.height,
  })));
}

function retainedSilentLayers(): Array<Readonly<{
  layer: string;
  opacity: number;
  children: number;
}>> {
  const root = document.querySelector<HTMLElement>(".uf-marking-layer-root");
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('.uf-layer[data-layer^="silent-"]'))
    .filter((layer) => layer.childElementCount > 0)
    .map((layer) => ({
      layer: layer.getAttribute("data-layer") ?? "",
      opacity: Number(getComputedStyle(layer).opacity),
      children: layer.childElementCount,
    }));
}

function enterSilent(): void {
  silentObserver?.disconnect();
  engine.clearOverlays();
  engine.refresh({ render: false });
  engine.renderSilentHighlights();
  initialSilentBoxes = silentBoxes();
  initialSilentGeometry = silentGeometry(initialSilentBoxes);
  initialSilentBox = initialSilentBoxes
    .find((box) => box.getAttribute("data-uf-silent-highlight") === silentXpath) ?? null;
  initialSilentTop = initialSilentBox?.style.top ?? "";
  silentFadeLatencyMs = null;
  silentLatencyMs = null;
  silentObserver = initialSilentBox && typeof MutationObserver === "function"
    ? new MutationObserver(() => {
      if (
        lastScrollInputAt > 0 &&
        initialSilentBox?.style.top !== initialSilentTop &&
        silentLatencyMs === null
      ) {
        silentLatencyMs = performance.now() - lastScrollInputAt;
      }
    })
    : null;
  if (initialSilentBox) {
    silentObserver?.observe(initialSilentBox, { attributes: true, attributeFilter: ["style"] });
  }
}

const runtime = {
  targetPoints(): TargetPoint[] {
    return targets.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.p23Target ?? "",
        xpath: xpathForElement(element),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
  },
  hoverState() {
    return {
      ...lastHover,
      pending: hoverHandle !== 0,
      currentXpath: hoverXpath(),
    };
  },
  enterSilent,
  silentState() {
    const currentBoxes = silentBoxes();
    const current = currentBoxes
      .find((box) => box.getAttribute("data-uf-silent-highlight") === silentXpath) ?? null;
    const layers = retainedSilentLayers();
    const root = document.querySelector<HTMLElement>(".uf-marking-layer-root");
    const rootOpacity = root ? Number(getComputedStyle(root).opacity) : 1;
    return {
      xpath: silentXpath,
      initialTop: initialSilentTop,
      currentTop: current?.style.top ?? "",
      retained: current !== null && current === initialSilentBox && current.isConnected,
      allBoxesRetained: currentBoxes.length === initialSilentBoxes.length &&
        currentBoxes.every((box, index) => box === initialSilentBoxes[index] && box.isConnected),
      geometryChanged: silentGeometry(currentBoxes) !== initialSilentGeometry,
      fadeLatencyMs: silentFadeLatencyMs,
      latencyMs: silentLatencyMs,
      count: currentBoxes.length,
      rootScrolling: root?.classList.contains("uf-scrolling") ?? false,
      rootOpacity,
      layers,
      allRetainedPresentationTransparent: layers.length > 0 &&
        layers.every((layer) => rootOpacity * layer.opacity <= 0.01),
      allRetainedPresentationVisible: layers.length > 0 && rootOpacity >= 0.99 &&
        layers.every((layer) => layer.opacity >= 0.99),
    };
  },
  semanticState() {
    return {
      unchanged: JSON.stringify(engine.rows()) === initialRows,
      rows: engine.rows(),
    };
  },
  schedulingState() {
    return {
      pendingClockWork: presentationClock.pendingCount(),
      starvedRafRequests: Number(
        (window as Window & { __p23StarvedRafRequests?: number }).__p23StarvedRafRequests ?? 0,
      ),
    };
  },
  dispose(): void {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("scroll", onScroll, true);
    silentObserver?.disconnect();
    if (hoverHandle) {
      presentationClock.cancelFrame(hoverHandle);
      hoverHandle = 0;
    }
    engine.dispose();
  },
};

(window as Window & { __p23Runtime?: typeof runtime }).__p23Runtime = runtime;
