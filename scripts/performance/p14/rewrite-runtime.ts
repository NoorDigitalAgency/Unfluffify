import { createMarkingEngine } from "../../../src/content/marking/engine";
import { createDomBridgeView, type DomBridgeView } from "../../../src/content/marking/dom-view";
import { createOverlayRenderer } from "../../../src/content/marking/renderer";
import { createPhysicalActionDeduper } from "../../../src/content/marking/interaction";
import { presentationClockFor } from "../../../src/content/presentation-clock";
import { evaluate, type EvaluationResult } from "../../../src/domain/evaluate";
import type { SelectorSet } from "../../../src/storage/config";
import {
  createOperationClock,
  doubleAnimationFrame,
  elementXpath,
  insertMutationSentinel,
  normalizedFixtureRows,
  normalizedFixtureClasses,
  rectTop,
  startStorefrontMutationPressure,
  targetPoint,
  waitFor,
  type SemanticSignature,
} from "./runtime-common";

type Engine = ReturnType<typeof createMarkingEngine>;
type Mode = "silent" | "marking";

const clock = createOperationClock();
const presentationClock = presentationClockFor(window);
let engine: Engine | null = null;
let mode: Mode | null = null;
let activationFinishedAt = 0;
let removeInputs: (() => void) | null = null;
let scrollStartTop: number | null = null;
let capturedBridge: DomBridgeView | null = null;
let latestEvaluation: EvaluationResult | null = null;
let userToggleCount = 0;
let reportPayloadCount = 0;
let stopMutationPressure: ReturnType<typeof startStorefrontMutationPressure> | null = null;
let pressureWorkSampleStart = 0;
const workSamples: Array<Readonly<{ stage: string; durationMs: number; nodeCount: number }>> = [];
let workStageStartedAt = 0;

function bridgeNodeCount(view: DomBridgeView | null): number {
  if (!view) {
    return 0;
  }
  let count = 0;
  const visit = (node: DomBridgeView["root"]): void => {
    count += 1;
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(view.root);
  return count;
}

function overlayBox(xpath: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-uf-overlay-xpath]"))
    .find((box) => box.dataset.ufOverlayXpath?.toLowerCase() === xpath.toLowerCase()) ?? null;
}

function silentBox(xpath: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-uf-silent-highlight]"))
    .find((box) => box.dataset.ufSilentHighlight?.toLowerCase() === xpath.toLowerCase()) ?? null;
}

function rowForXpath(xpath: string) {
  return engine?.rows().find((row) => row.xpath.toLowerCase() === xpath.toLowerCase());
}

function installMarkingInputs(): () => void {
  let lastPointer: Readonly<{ x: number; y: number; altKey: boolean; shiftKey: boolean }> | null = null;
  let hoverFrame = 0;
  let physicalSequence = 0;
  let lastPointerDown: Readonly<{
    id: number;
    x: number;
    y: number;
    button: number;
    at: number;
  }> | null = null;
  const deduper = createPhysicalActionDeduper();
  const cursorStyle = document.createElement("style");
  cursorStyle.id = "unfluffify-marking-cursor-style";
  cursorStyle.dataset.ufExtensionUi = "true";
  cursorStyle.textContent = "html.uf-cursor-exclude,html.uf-cursor-exclude *{cursor:crosshair!important}";
  document.documentElement.appendChild(cursorStyle);
  document.documentElement.classList.add("uf-cursor-exclude");
  const physicalIdFor = (event: MouseEvent): number => {
    const down = lastPointerDown;
    if (
      down
      && down.button === event.button
      && Math.abs(down.x - event.clientX) <= 2
      && Math.abs(down.y - event.clientY) <= 2
      && Math.abs(down.at - event.timeStamp) <= 1_000
    ) {
      return down.id;
    }
    physicalSequence += 1;
    return physicalSequence;
  };
  const reportMarkingToggle = (): void => {
    // The asynchronous cross-realm transport is intentionally outside the
    // paint critical path. Construct and count its production-shaped payload
    // synchronously so only that external boundary is stubbed.
    const payload = {
      kind: "uf-fact/1",
      sensation: {
        tabId: 0,
        source: "content",
        reason: "marking-toggle",
        facts: { tabId: 0, pageUrl: location.href, markingToggleSeq: userToggleCount },
      },
    };
    reportPayloadCount += payload.sensation.facts.markingToggleSeq > 0 ? 1 : 0;
  };
  const mousemove = (event: MouseEvent): void => {
    lastPointer = {
      x: event.clientX,
      y: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    if (hoverFrame) {
      return;
    }
    hoverFrame = presentationClock.requestFrame(() => {
      hoverFrame = 0;
      if (lastPointer) {
        engine?.hoverAtPoint(
          lastPointer.x,
          lastPointer.y,
          lastPointer.altKey ? "include" : "exclude",
          lastPointer.shiftKey,
        );
      }
    });
  };
  const pointerdown = (event: PointerEvent): void => {
    physicalSequence += 1;
    lastPointerDown = {
      id: physicalSequence,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      at: event.timeStamp,
    };
  };
  const click = (event: MouseEvent): void => {
    const eventTarget = event.target as Element | null;
    if (
      eventTarget?.closest?.('[data-uf-extension-ui="true"]')
      && !eventTarget.closest?.(".uf-marking-layer-root")
    ) {
      return;
    }
    const markMode = event.altKey ? "include" : "exclude";
    event.preventDefault();
    event.stopPropagation();
    const target = engine?.resolveAtPoint(event.clientX, event.clientY, markMode, event.shiftKey);
    if (target) {
      const physicalId = physicalIdFor(event);
      if (deduper.accept(physicalId, target.xpath, markMode)) {
        const changed = engine?.toggle(target, markMode);
        if (changed !== false) {
          userToggleCount += 1;
          reportMarkingToggle();
        } else {
          engine?.rejectAtPoint(event.clientX, event.clientY);
        }
      }
    } else {
      engine?.rejectAtPoint(event.clientX, event.clientY);
    }
  };
  document.addEventListener("pointerdown", pointerdown, true);
  document.addEventListener("mousemove", mousemove, true);
  document.addEventListener("click", click, true);
  return () => {
    document.removeEventListener("pointerdown", pointerdown, true);
    document.removeEventListener("mousemove", mousemove, true);
    document.removeEventListener("click", click, true);
    document.documentElement.classList.remove("uf-cursor-exclude");
    cursorStyle.remove();
    if (hoverFrame) {
      presentationClock.cancelFrame(hoverFrame);
    }
  };
}

function canonicalClassifications(rows: SemanticSignature["rows"]): Readonly<{
  classes: SemanticSignature["classes"];
  coverage: SemanticSignature["classificationCoverage"];
}> {
  if (!engine || !capturedBridge) {
    throw new Error("Rewrite canonical classification state is unavailable");
  }
  const evaluation = mode === "marking" && latestEvaluation
    ? latestEvaluation
    : evaluate({ rows: [...engine.rows()] }, { root: capturedBridge.root });
  return normalizedFixtureClasses(evaluation.overlay, rows);
}

const runtime = {
  kind: "rewrite" as const,
  async activate(nextMode: Mode, selectors: SelectorSet) {
    mode = nextMode;
    userToggleCount = 0;
    reportPayloadCount = 0;
    workSamples.splice(0);
    workStageStartedAt = performance.now();
    const stages: string[] = [];
    const startedAt = performance.now();
    engine = createMarkingEngine(document.documentElement, {
      selectors,
      render: nextMode === "marking",
      instrumentation: {
        onWorkStage: (stage) => {
          stages.push(stage);
          const now = performance.now();
          workSamples.push({
            stage,
            durationMs: now - workStageStartedAt,
            nodeCount: bridgeNodeCount(capturedBridge),
          });
          workStageStartedAt = now;
        },
        createBridge: (root) => {
          capturedBridge = createDomBridgeView(root);
          return capturedBridge;
        },
        createRenderer: (options) => {
          const delegate = createOverlayRenderer(options);
          return {
            ...delegate,
            render(evaluation, byXpath) {
              latestEvaluation = evaluation;
              delegate.render(evaluation, byXpath);
            },
            renderBranch(evaluation, byXpath) {
              latestEvaluation = evaluation;
              delegate.renderBranch(evaluation, byXpath);
            },
          };
        },
      },
    });
    // Production activation always arms and renders the silent overlay, even
    // while the marking UI is active. Keep the shared bridge/evaluation/index
    // transaction and include the actual second renderer in activation timing.
    engine.renderSilentHighlights();
    if (nextMode === "marking") {
      removeInputs = installMarkingInputs();
    }
    const seedExcludeXpath = elementXpath(document.querySelector("[data-p14-id='seed-exclude']")!);
    const seedIncludeXpath = elementXpath(document.querySelector("[data-p14-id='seed-include']")!);
    await waitFor(
      () => nextMode === "silent"
        ? Boolean(silentBox(seedIncludeXpath))
        : Boolean(overlayBox(seedExcludeXpath) && silentBox(seedIncludeXpath)),
      `rewrite ${nextMode} activation overlay`,
    );
    await doubleAnimationFrame();
    activationFinishedAt = performance.now();
    return {
      durationMs: activationFinishedAt - startedAt,
      stages,
      workSamples: [...workSamples],
      seededSelectors: engine.lastInitializationSeededSelectors(),
    };
  },
  startMutationPressure(): void {
    stopMutationPressure?.();
    pressureWorkSampleStart = workSamples.length;
    stopMutationPressure = startStorefrontMutationPressure();
  },
  stopMutationPressure() {
    const pressure = stopMutationPressure?.() ?? {
      ticks: 0,
      lateConsentInsertions: 0,
      consentRootHidden: false,
    };
    stopMutationPressure = null;
    const samples = workSamples.slice(pressureWorkSampleStart);
    return {
      ...pressure,
      structuralRefreshCount: samples.filter((sample) => sample.stage === "bridge").length,
      workSamples: samples,
    };
  },
  point(id: string) {
    return targetPoint(id);
  },
  semantics(): SemanticSignature {
    if (!engine) {
      throw new Error("Rewrite engine is not active");
    }
    const rows = normalizedFixtureRows(engine.rows());
    const projected = canonicalClassifications(rows);
    return { rows, classes: projected.classes, classificationCoverage: projected.coverage };
  },
  armHover(): void {
    clock.arm("mousemove");
  },
  async finishHover(): Promise<number> {
    // Shift hover intentionally previews the widened exclusion boundary, whose
    // XPath can be an ancestor of the physical click target.
    await waitFor(
      () => Boolean(document.querySelector("[data-uf-overlay-hover]")),
      "rewrite hover paint",
    );
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  armClick(): void {
    clock.arm("click");
  },
  async finishClick() {
    await waitFor(() => {
      const box = document.querySelector<HTMLElement>(
        "[data-layer='session-explicit-exclude'] [data-uf-overlay-classification='exception']",
      );
      const xpath = box?.dataset.ufOverlayXpath ?? "";
      const row = rowForXpath(xpath);
      return row?.excluded === true
        && row.explicit === true
        && userToggleCount === 1
        && reportPayloadCount === 1
        && box?.dataset.ufOverlayClassification === "exception";
    }, "rewrite committed and painted physical click");
    await doubleAnimationFrame();
    return {
      durationMs: clock.elapsed(),
    };
  },
  prepareScroll(): void {
    const xpath = elementXpath(document.querySelector("[data-p14-id='scroll-anchor']")!);
    scrollStartTop = rectTop(mode === "silent" ? silentBox(xpath) : overlayBox(xpath));
    if (scrollStartTop === null) {
      throw new Error("Rewrite scroll anchor has no painted overlay");
    }
    clock.arm("wheel");
  },
  async finishScroll(): Promise<number> {
    const xpath = elementXpath(document.querySelector("[data-p14-id='scroll-anchor']")!);
    await waitFor(() => {
      const root = engine?.overlayRoot();
      const box = mode === "silent" ? silentBox(xpath) : overlayBox(xpath);
      const top = rectTop(box);
      return top !== null
        && scrollStartTop !== null
        && Math.abs(top - scrollStartTop) > 20
        && !root?.classList.contains("uf-scrolling");
    }, "rewrite scroll reposition");
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  async resetScrollForMutation(): Promise<void> {
    window.scrollTo(0, 0);
    await waitFor(() => {
      const root = engine?.overlayRoot();
      return window.scrollY === 0 && !root?.classList.contains("uf-scrolling");
    }, "rewrite scroll reset before mutation");
    await doubleAnimationFrame();
  },
  async quiesceBeforeMutation(): Promise<void> {
    const required = mode === "marking" ? 1_850 : 1_250;
    const remaining = activationFinishedAt + required - performance.now();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  },
  async mutateAndWait(): Promise<number> {
    clock.startProgrammatic();
    const element = insertMutationSentinel();
    const xpath = elementXpath(element);
    await waitFor(() => {
      const row = rowForXpath(xpath);
      const box = mode === "silent" ? silentBox(xpath) : overlayBox(xpath);
      return row?.excluded === false && Boolean(box);
    }, "rewrite structural mutation stabilization");
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  dispose(): void {
    stopMutationPressure?.();
    stopMutationPressure = null;
    removeInputs?.();
    removeInputs = null;
    engine?.dispose();
    engine = null;
    capturedBridge = null;
    latestEvaluation = null;
    userToggleCount = 0;
    reportPayloadCount = 0;
    clock.dispose();
  },
};

Object.assign(window, { __p14Runtime: runtime });

declare global {
  interface Window {
    __p14Runtime: typeof runtime;
  }
}
