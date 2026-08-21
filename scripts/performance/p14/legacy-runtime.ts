import * as core from "./content/core";
import {
  __p14DeactivateSilentHighlightings,
  __p14CollectAiSubmissionXpathsForCurrentPage,
  __p14GetSilentSemanticRows,
  __p14GetSilentClassifications,
  __p14LoadAndNormalizeConfigs,
  __p14RefreshSilentHighlightings,
  __p14ScheduleSilentHighlightReposition,
} from "./content-main";
import {
  __p14SetContentDirective,
  getLatestContentDirective,
  isSilentHighlightActiveByDirective,
} from "./content/layers/layer-host";
import * as legacyConfig from "./common/config";
import * as legacyUtilities from "./common/utilities";
import {
  createOperationClock,
  doubleAnimationFrame,
  elementXpath,
  insertMutationSentinel,
  normalizedFixtureRows,
  normalizedFixtureClasses,
  rectTop,
  targetPoint,
  waitFor,
  type NormalizedRow,
  type SemanticSignature,
} from "./p14-runtime-common";

type Mode = "silent" | "marking";
type SelectorSet = Readonly<{
  exclusionSelectors: readonly string[];
  inclusionSelectors: readonly string[];
}>;

const clock = createOperationClock();
let mode: Mode | null = null;
let activationFinishedAt = 0;
let scrollStartTop: number | null = null;
let markingClassificationBaseline: Map<string, string> | null = null;

function draftMarkingRows(): NormalizedRow[] {
  // A clean first activation deliberately does not persist a draft entry.
  // `state.currentPageEntry` is nevertheless the exact synchronized baseline
  // used by the legacy renderer, so the appended read seam keeps it observable.
  const entry = core.getDraftPageEntry(location.href) ?? core.__p14GetCurrentPageEntry();
  const byXpath = new Map<string, NormalizedRow>();
  for (const row of entry?.xpaths ?? []) {
    if (row?.xpath) {
      byXpath.set(row.xpath.toLowerCase(), {
        xpath: row.xpath.toLowerCase(),
        excluded: Boolean(row.excluded),
        explicit: row.explicit === true,
      });
    }
  }
  for (const xpath of entry?.includeXpaths ?? []) {
    if (xpath) {
      byXpath.set(xpath.toLowerCase(), { xpath: xpath.toLowerCase(), excluded: false, explicit: true });
    }
  }
  return [...byXpath.values()];
}

function markingRows(): NormalizedRow[] {
  const entry = core.getDraftPageEntry(location.href) ?? core.__p14GetCurrentPageEntry();
  const explicitByXpath = new Map<string, boolean>();
  for (const row of entry?.xpaths ?? []) {
    if (row?.xpath) {
      explicitByXpath.set(row.xpath.toLowerCase(), row.explicit === true);
    }
  }
  for (const xpath of entry?.includeXpaths ?? []) {
    if (xpath) {
      explicitByXpath.set(xpath.toLowerCase(), true);
    }
  }
  return __p14CollectAiSubmissionXpathsForCurrentPage().map((row) => ({
    xpath: row.xpath.toLowerCase(),
    excluded: Boolean(row.excluded),
    explicit: explicitByXpath.get(row.xpath.toLowerCase()) === true,
  }));
}

function currentRows(): NormalizedRow[] {
  return mode === "silent" ? __p14GetSilentSemanticRows() : markingRows();
}

function currentClassifications(): Array<readonly [string, string]> {
  if (mode === "silent") {
    return __p14GetSilentClassifications();
  }
  const live = core.__p14GetMarkingClassifications();
  if (!markingClassificationBaseline) {
    markingClassificationBaseline = new Map(live);
  }
  const merged = new Map(markingClassificationBaseline);
  for (const [xpath, classification] of live) {
    merged.set(xpath, classification);
  }
  // Incremental explicit paint precedes the next full cached-collection
  // reconcile. This exact helper calls the same element collectors/splitter
  // used by drawExplicitMarkingLayers; no row booleans are reclassified here.
  for (const [xpath, classification] of core.__p14GetExplicitMarkingClassifications()) {
    merged.set(xpath, classification);
  }
  return [...merged.entries()];
}

function markId(element: Element): string {
  return core.__p14GetMarkId(element);
}

function markingBox(element: Element, layer?: string): HTMLElement | null {
  const selector = layer
    ? `#unfluffify-overlay [data-layer="${layer}"] .uf-rect`
    : "#unfluffify-overlay .uf-rect";
  const id = markId(element);
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find((box) => {
      if (box.dataset.mcMarkId !== id) {
        return false;
      }
      const layerName = box.closest<HTMLElement>("[data-layer]")?.dataset.layer ?? "";
      return Boolean(layer) || !["interaction", "hover", "focus"].includes(layerName);
    }) ?? null;
}

function geometryMatches(box: HTMLElement, element: Element): boolean {
  const target = element.getBoundingClientRect();
  const candidate = box.getBoundingClientRect();
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  return centerX >= candidate.left - 2
    && centerX <= candidate.right + 2
    && centerY >= candidate.top - 2
    && centerY <= candidate.bottom + 2;
}

function silentBox(element: Element, classification?: string): HTMLElement | null {
  const layer = classification === "exception"
    ? "excluded"
    : classification === "immutable"
      ? "immutable"
      : "content";
  const boxes = Array.from(document.querySelectorAll<HTMLElement>(
    `#unfluffify-silent-highlight-overlay [data-layer="${layer}"] .uf-silent-rect`,
  ));
  // These fixture sentinels are direct render targets. Never accept an
  // unrelated retained box: readiness must prove this target was painted.
  return boxes.find((box) => geometryMatches(box, element)) ?? null;
}

function silentOverlayReady(): boolean {
  const overlay = document.getElementById("unfluffify-silent-highlight-overlay");
  const seed = document.querySelector("[data-p14-id='seed-include']");
  return document.documentElement.dataset.ufSilentHighlightings === "on"
    && Boolean(overlay && !overlay.classList.contains("uf-silent-hidden"))
    && Boolean(seed && silentBox(seed, "explicit-include"));
}

window.addEventListener("scroll", (event) => {
  if (mode === "marking") {
    core.handleScroll(event, { hideDuringScroll: true });
  } else if (mode === "silent") {
    __p14ScheduleSilentHighlightReposition();
  }
}, { capture: true, passive: true });

const runtime = {
  kind: "legacy" as const,
  async activate(nextMode: Mode, selectors: SelectorSet) {
    mode = nextMode;
    markingClassificationBaseline = null;
    const baseUrl = legacyUtilities.normalizeBaseUrl(location.href) || location.origin;
    const stored = await core.loadConfig(baseUrl);
    // Stable sampling starts from an untimed clean page entry. This invokes the
    // pinned helper used by enableForBaseUrl, including loose-key cache eviction;
    // the public enable seam repeats the now-empty cleanup inside its real path.
    core.__p14RemovePageMarkingEntriesForPage(stored, location.href, baseUrl);
    stored.selectors = {
      exclusionSelectors: [...selectors.exclusionSelectors],
      inclusionSelectors: [...selectors.inclusionSelectors],
    };
    stored.selectorsUpdatedAt = "2026-08-21T00:00:00.000Z";
    await core.saveConfig(baseUrl, stored);
    const startedAt = performance.now();
    if (nextMode === "silent") {
      core.state.enabled = false;
      __p14SetContentDirective({
        silentHighlightActive: true,
        pageRevealFreezeActive: false,
        markingEditsBlocked: false,
      });
      await __p14RefreshSilentHighlightings();
      try {
        await waitFor(silentOverlayReady, "legacy silent activation overlay");
      } catch (error) {
        const overlay = document.getElementById("unfluffify-silent-highlight-overlay");
        const reread = await core.loadConfig(baseUrl);
        const configs = await legacyConfig.getConfigs();
        const loadDiagnostic = await __p14LoadAndNormalizeConfigs(location.href);
        throw new Error(`Legacy silent diagnostic ${JSON.stringify({
          active: document.documentElement.dataset.ufSilentHighlightings ?? null,
          overlay: Boolean(overlay),
          hidden: overlay?.classList.contains("uf-silent-hidden") ?? null,
          contentBoxes: overlay?.querySelectorAll(".uf-silent-content").length ?? 0,
          excludedBoxes: overlay?.querySelectorAll(".uf-silent-excluded").length ?? 0,
          rows: __p14GetSilentSemanticRows().slice(0, 10),
          classes: __p14GetSilentClassifications().slice(0, 10),
          selectors: reread.selectors,
          configKeys: Object.keys(configs),
          configSelectors: Object.fromEntries(Object.entries(configs).map(([key, value]) => [
            key,
            value && typeof value === "object" ? (value as { selectors?: unknown }).selectors : null,
          ])),
          directive: getLatestContentDirective(),
          directiveActive: isSilentHighlightActiveByDirective(),
          newestSelectors: legacyConfig.getNewestConfigSelectorSet(reread),
          selectorsUpdatedAt: reread.selectorsUpdatedAt,
          renderModeUpdatedAt: reread.renderModeUpdatedAt,
          loadDiagnostic,
        })}`, { cause: error });
      }
    } else {
      await core.enableForBaseUrl(baseUrl, { skipInitialReveal: true });
      const seed = document.querySelector("[data-p14-id='seed-exclude']");
      await waitFor(
        () => Boolean(seed && markingBox(seed)),
        "legacy marking activation overlay",
      );
    }
    await doubleAnimationFrame();
    activationFinishedAt = performance.now();
    return {
      durationMs: activationFinishedAt - startedAt,
      stages: nextMode === "silent" ? ["exact-silent-refresh"] : ["exact-enable-for-base-url"],
      seededSelectors: selectors.exclusionSelectors.length > 0 || selectors.inclusionSelectors.length > 0,
    };
  },
  point(id: string) {
    return targetPoint(id);
  },
  semantics(): SemanticSignature {
    const rows = normalizedFixtureRows(currentRows());
    const projected = normalizedFixtureClasses(currentClassifications(), rows);
    return { rows, classes: projected.classes, classificationCoverage: projected.coverage };
  },
  armHover(): void {
    clock.arm("mousemove");
  },
  async finishHover(): Promise<number> {
    const target = document.querySelector("[data-p14-id='click-target']")!;
    await waitFor(
      () => Boolean(markingBox(target, "hover")?.classList.contains("uf-hover")),
      "legacy hover paint",
    );
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  armClick(): void {
    clock.arm("click");
  },
  async finishClick() {
    const target = document.querySelector("[data-p14-id='click-target']")!;
    const xpath = elementXpath(target);
    await waitFor(() => {
      const box = markingBox(target, "session-explicit-exclude");
      const draftRow = draftMarkingRows().find((candidate) => candidate.xpath === xpath);
      const internalClass = currentClassifications()
        .find(([candidate]) => candidate === xpath)?.[1];
      return draftRow?.excluded === true
        && draftRow.explicit === true
        && internalClass === "exception"
        && Boolean(box?.classList.contains("uf-explicit-exclude"));
    }, "legacy committed and painted physical click");
    await doubleAnimationFrame();
    return {
      durationMs: clock.elapsed(),
    };
  },
  prepareScroll(): void {
    const target = document.querySelector("[data-p14-id='scroll-anchor']")!;
    const box = mode === "silent" ? silentBox(target) : markingBox(target);
    scrollStartTop = rectTop(box);
    if (scrollStartTop === null) {
      throw new Error("Legacy scroll anchor has no painted overlay");
    }
    clock.arm("wheel");
  },
  async finishScroll(): Promise<number> {
    const target = document.querySelector("[data-p14-id='scroll-anchor']")!;
    await waitFor(() => {
      const overlay = mode === "silent"
        ? document.getElementById("unfluffify-silent-highlight-overlay")
        : document.getElementById("unfluffify-overlay");
      const box = mode === "silent" ? silentBox(target) : markingBox(target);
      const top = rectTop(box);
      return top !== null
        && scrollStartTop !== null
        && Math.abs(top - scrollStartTop) > 20
        && !overlay?.classList.contains("uf-scrolling")
        && !overlay?.classList.contains("uf-silent-hidden");
    }, "legacy scroll reposition");
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  async resetScrollForMutation(): Promise<void> {
    window.scrollTo(0, 0);
    await waitFor(() => {
      const overlay = mode === "silent"
        ? document.getElementById("unfluffify-silent-highlight-overlay")
        : document.getElementById("unfluffify-overlay");
      return window.scrollY === 0
        && !overlay?.classList.contains("uf-scrolling")
        && !overlay?.classList.contains("uf-silent-hidden");
    }, "legacy scroll reset before mutation");
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
    const target = insertMutationSentinel();
    await waitFor(() => {
      const box = mode === "silent" ? silentBox(target) : markingBox(target);
      return Boolean(box);
    }, "legacy structural mutation stabilization");
    await doubleAnimationFrame();
    return clock.elapsed();
  },
  dispose(): void {
    if (mode === "silent") {
      __p14DeactivateSilentHighlightings();
      __p14SetContentDirective(null);
    } else {
      core.disable();
    }
    clock.dispose();
    markingClassificationBaseline = null;
  },
};

Object.assign(window, { __p14Runtime: runtime });

declare global {
  interface Window {
    __p14Runtime: typeof runtime;
  }
}
