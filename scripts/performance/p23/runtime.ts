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
      engine.hoverAtPoint(pointer.x, pointer.y, "exclude", false, {
        overlayXpath: pointer.overlayXpath,
      });
    } else {
      engine.hoverAtPoint(pointer.x, pointer.y, "exclude", false);
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
  lastScrollInputAt = performance.now();
  silentLatencyMs = null;
};
document.addEventListener("mousemove", onMouseMove, true);
document.addEventListener("scroll", onScroll, true);

const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-p23-target]"));
const silentTarget = targets.at(-1) ?? null;
const silentXpath = silentTarget ? xpathForElement(silentTarget) : "";
let initialSilentBox: HTMLElement | null = null;
let initialSilentTop = "";
let silentObserver: MutationObserver | null = null;

function enterSilent(): void {
  silentObserver?.disconnect();
  engine.clearOverlays();
  engine.refresh({ render: false });
  engine.renderSilentHighlights();
  initialSilentBox = Array.from(
    document.querySelectorAll<HTMLElement>("[data-uf-silent-highlight]"),
  ).find((box) => box.getAttribute("data-uf-silent-highlight") === silentXpath) ?? null;
  initialSilentTop = initialSilentBox?.style.top ?? "";
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
    const current = Array.from(
      document.querySelectorAll<HTMLElement>("[data-uf-silent-highlight]"),
    ).find((box) => box.getAttribute("data-uf-silent-highlight") === silentXpath) ?? null;
    return {
      xpath: silentXpath,
      initialTop: initialSilentTop,
      currentTop: current?.style.top ?? "",
      retained: current !== null && current === initialSilentBox && current.isConnected,
      latencyMs: silentLatencyMs,
      count: document.querySelectorAll("[data-uf-silent-highlight]").length,
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
