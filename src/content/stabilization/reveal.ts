export type RevealRunInput = Readonly<{
  hasVerticalScrollRoom: boolean;
  activationStale: boolean | (() => boolean);
  initialScrollHeight: number;
  measureExpandedScrollHeight?: () => number;
  scrollTo: (
    position: "top" | "lazy-threshold" | "bottom" | "restore",
    measuredScrollHeight: number,
  ) => RevealScrollOutcome | Promise<RevealScrollOutcome>;
  waitForSettle?: (phase: "step" | "post-freeze") => Promise<boolean | void>;
  suppressLazyLoading: () => void | Promise<void>;
  restoreLazyLoading?: () => void | Promise<void>;
  freezeAtBottom: () => void | Promise<void>;
  maximumBottomPasses?: number;
}>;

export type RevealScrollOutcome = boolean | void | Readonly<{
  reached: boolean;
  progressed: boolean;
}>;

export type RevealRunResult = Readonly<{
  skipped: boolean;
  lazyExpansions: number;
  frozenAtBottom: boolean;
}>;

export type RevealVisitControllerOptions = Readonly<{
  isVisible?: () => boolean;
  waitUntilVisible?: () => Promise<void>;
}>;

export type RevealVisitRequest = Readonly<{
  scopeStrength?: number;
}>;

const SKIPPED_REVEAL: RevealRunResult = {
  skipped: true,
  lazyExpansions: 0,
  frozenAtBottom: false,
};

export async function runReveal(input: RevealRunInput): Promise<RevealRunResult> {
  const activationStale = (): boolean => typeof input.activationStale === "function"
    ? input.activationStale()
    : input.activationStale;
  if (activationStale()) {
    return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
  }
  const waitForSettle = input.waitForSettle ?? (() => Promise.resolve());
  const settled = async (phase: "step" | "post-freeze"): Promise<boolean> =>
    await waitForSettle(phase) !== false;
  const measure = input.measureExpandedScrollHeight ?? (() => input.initialScrollHeight);
  const maximumBottomPasses = Math.max(2, Math.trunc(input.maximumBottomPasses ?? 10));
  let lazyLoadingSuppressed = false;
  let frozenAtBottom = false;
  let lazyExpansions = 0;
  let hasVerticalScrollRoom = input.hasVerticalScrollRoom;
  let restoreRequired = false;
  let restoredPosition = false;
  const reached = (outcome: RevealScrollOutcome): boolean =>
    typeof outcome === "object" ? outcome.reached : outcome !== false;
  const progressed = (outcome: RevealScrollOutcome): boolean =>
    typeof outcome !== "object" || outcome.progressed;
  const restorePosition = async (): Promise<boolean> => {
    if (!restoreRequired || restoredPosition || activationStale()) {
      return restoredPosition;
    }
    const outcome = await input.scrollTo(
      "restore",
      Math.max(input.initialScrollHeight, measure()),
    );
    const restoreReached = reached(outcome);
    // Legacy uses this dwell to let the restored position paint; a page with a
    // continuously changing clock/carousel is still restored. Only physical
    // reach and the caller's stale fence decide whether restoration succeeded.
    await settled("step");
    restoredPosition = restoreReached;
    return restoredPosition;
  };
  try {
    if (!hasVerticalScrollRoom) {
      // Short documents can still own observers and deferred media. Retain the
      // same finite-growth fence as the scrollable path before freezing.
      await input.suppressLazyLoading();
      lazyLoadingSuppressed = true;
      await settled("step");
      hasVerticalScrollRoom = measure() > input.initialScrollHeight + 2;
      if (!hasVerticalScrollRoom) {
        await input.freezeAtBottom();
        if (activationStale()) {
          return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
        }
        if (!await settled("post-freeze")) {
          return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
        }
        frozenAtBottom = true;
        return { skipped: true, lazyExpansions: 0, frozenAtBottom: true };
      }
      lazyExpansions = 1;
      await input.restoreLazyLoading?.();
      lazyLoadingSuppressed = false;
    }

    restoreRequired = true;
    const top = await input.scrollTo("top", input.initialScrollHeight);
    const topReached = reached(top);
    await settled("step");
    if (!topReached) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }
    if (activationStale()) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }

    const midpoint = await input.scrollTo("lazy-threshold", input.initialScrollHeight);
    const midpointReached = reached(midpoint);
    await settled("step");
    if (!midpointReached) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }
    if (activationStale()) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }

    // Latest legacy engages the lazy-loading lock at the midpoint. This lets
    // existing observers/materialization run during the visible first half,
    // then prevents an infinite feed from racing the growth-aware bottom walk.
    await input.suppressLazyLoading();
    lazyLoadingSuppressed = true;
    // Match legacy's bounded per-step dwell. Pre-freeze quiet is useful paint
    // evidence, but it is not a correctness gate: live clocks, carousels, and
    // mutation-driven widgets may never become DOM-quiet. True-bottom reach,
    // post-freeze quiet, and origin restoration remain mandatory below.
    await settled("step");

    let measuredScrollHeight = Math.max(input.initialScrollHeight, measure());
    if (measuredScrollHeight > input.initialScrollHeight + 1) {
      lazyExpansions = 1;
    }
    let bottomConfirmed = false;
    let consecutiveNoProgress = 0;
    for (let pass = 0; pass < maximumBottomPasses && !activationStale(); pass += 1) {
      const bottomOutcome = await input.scrollTo("bottom", measuredScrollHeight);
      await settled("step");
      const expandedScrollHeight = Math.max(measuredScrollHeight, measure());
      const expanded = expandedScrollHeight > measuredScrollHeight + 1;
      if (expanded) {
        lazyExpansions += 1;
        measuredScrollHeight = expandedScrollHeight;
      }
      bottomConfirmed = reached(bottomOutcome) && !expanded;
      consecutiveNoProgress = !expanded && !progressed(bottomOutcome)
        ? consecutiveNoProgress + 1
        : 0;
      // Always perform the visible bottom -> wait -> bottom confirmation pass.
      // A scroll timeout is not a bottom acknowledgement: long pages continue
      // the smooth walk from their current position, exactly as legacy did.
      if (pass >= 1 && bottomConfirmed) {
        break;
      }
      if (consecutiveNoProgress >= 2) {
        break;
      }
    }
    if (activationStale()) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }
    if (!bottomConfirmed) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }

    await input.freezeAtBottom();
    if (activationStale()) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }
    if (!await settled("post-freeze")) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }
    if (!await restorePosition() || activationStale()) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }
    frozenAtBottom = true;
    return { skipped: false, lazyExpansions, frozenAtBottom: true };
  } finally {
    if (restoreRequired && !restoredPosition && !activationStale()) {
      try {
        await restorePosition();
      } catch {
        // Cleanup remains best-effort and smooth; the caller will destroy the
        // exact page-world session and surface a visible failed ritual.
      }
    }
    if (lazyLoadingSuppressed && !frozenAtBottom) {
      await input.restoreLazyLoading?.();
    }
  }
}

export function createRevealVisitController(options: RevealVisitControllerOptions = {}) {
  type Request = Readonly<{
    generation: number;
    scopeStrength: number;
    task: () => Promise<RevealRunResult>;
  }>;
  let generation = 0;
  let completedGeneration = -1;
  let completedScopeStrength = -1;
  let activeRequest: Request | null = null;
  let activePromise: Promise<RevealRunResult> | null = null;
  let consolidatedFollowup: Request | null = null;
  let acceptingFollowup = false;

  const visible = (): boolean => options.isVisible?.() ?? true;
  const waitForVisibility = async (): Promise<boolean> => {
    if (visible()) {
      return true;
    }
    if (!options.waitUntilVisible) {
      return false;
    }
    await options.waitUntilVisible();
    return visible();
  };
  const completed = (request: Request): boolean =>
    request.generation < completedGeneration ||
    (request.generation === completedGeneration && request.scopeStrength <= completedScopeStrength);
  const strongerThanActive = (request: Request): boolean => Boolean(
    activeRequest && (
      request.generation > activeRequest.generation ||
      (request.generation === activeRequest.generation && request.scopeStrength > activeRequest.scopeStrength)
    )
  );
  const mergeFollowup = (request: Request): void => {
    if (!consolidatedFollowup) {
      consolidatedFollowup = request;
      return;
    }
    if (
      request.generation > consolidatedFollowup.generation ||
      (request.generation === consolidatedFollowup.generation && request.scopeStrength > consolidatedFollowup.scopeStrength)
    ) {
      consolidatedFollowup = request;
    }
  };
  const execute = async (request: Request): Promise<RevealRunResult> => {
    if (request.generation < generation || completed(request) || !await waitForVisibility()) {
      return SKIPPED_REVEAL;
    }
    if (request.generation < generation) {
      return SKIPPED_REVEAL;
    }
    const result = await request.task();
    if (!result.skipped) {
      completedGeneration = request.generation;
      completedScopeStrength = request.scopeStrength;
    }
    return result;
  };
  const start = (request: Request): Promise<RevealRunResult> => {
    activeRequest = request;
    acceptingFollowup = true;
    activePromise = (async () => {
      let result = await execute(request);
      const followup = consolidatedFollowup;
      consolidatedFollowup = null;
      acceptingFollowup = false;
      if (followup && !completed(followup)) {
        activeRequest = followup;
        result = await execute(followup);
      }
      return result;
    })().finally(() => {
      activeRequest = null;
      activePromise = null;
      consolidatedFollowup = null;
      acceptingFollowup = false;
    });
    return activePromise;
  };

  const runTask = (
    task: () => Promise<RevealRunResult>,
    request: RevealVisitRequest = {},
  ): Promise<RevealRunResult> => {
    const next: Request = {
      generation,
      scopeStrength: request.scopeStrength ?? 0,
      task,
    };
    if (completed(next) && !activePromise) {
      return Promise.resolve(SKIPPED_REVEAL);
    }
    if (activePromise) {
      if (acceptingFollowup && strongerThanActive(next)) {
        mergeFollowup(next);
      }
      return activePromise;
    }
    return start(next);
  };

  return {
    run(input: RevealRunInput, request: RevealVisitRequest = {}): Promise<RevealRunResult> {
      return runTask(() => runReveal(input), request);
    },
    runTask,
    resetForNavigation(): void {
      generation += 1;
      completedScopeStrength = -1;
    },
  };
}
