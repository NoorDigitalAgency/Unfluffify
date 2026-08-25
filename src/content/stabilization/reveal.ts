export type RevealRunInput = Readonly<{
  hasVerticalScrollRoom: boolean;
  activationStale: boolean | (() => boolean);
  initialScrollHeight: number;
  measureExpandedScrollHeight?: () => number;
  scrollTo: (
    position: "top" | "lazy-threshold" | "bottom" | "restore",
    measuredScrollHeight: number,
  ) => void | Promise<void>;
  waitForSettle?: () => Promise<void>;
  suppressLazyLoading: () => void | Promise<void>;
  restoreLazyLoading?: () => void | Promise<void>;
  freezeAtBottom: () => void | Promise<void>;
  maximumBottomPasses?: number;
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
  const measure = input.measureExpandedScrollHeight ?? (() => input.initialScrollHeight);
  const maximumBottomPasses = Math.max(2, Math.trunc(input.maximumBottomPasses ?? 10));
  let lazyLoadingSuppressed = false;
  let frozenAtBottom = false;
  let lazyExpansions = 0;
  try {
    if (!input.hasVerticalScrollRoom) {
      await input.freezeAtBottom();
      frozenAtBottom = true;
      await waitForSettle();
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: true };
    }

    await input.scrollTo("top", input.initialScrollHeight);
    await waitForSettle();
    if (activationStale()) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }

    await input.scrollTo("lazy-threshold", input.initialScrollHeight);
    await waitForSettle();
    if (activationStale()) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }

    // Give strict IntersectionObserver/data-src loaders one bounded visit to
    // the actual bottom while their page handlers are still live. A midpoint
    // is enough for Chrome's native lazy margin on many pages, but not for
    // site loaders with a small rootMargin (for example Bricks footer media).
    // Suppression immediately after this pass still fences infinite feeds.
    await input.scrollTo("bottom", input.initialScrollHeight);
    await waitForSettle();
    if (activationStale()) {
      return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
    }

    await input.suppressLazyLoading();
    lazyLoadingSuppressed = true;
    await waitForSettle();

    let measuredScrollHeight = Math.max(input.initialScrollHeight, measure());
    if (measuredScrollHeight > input.initialScrollHeight + 1) {
      lazyExpansions = 1;
    }
    for (let pass = 0; pass < maximumBottomPasses && !activationStale(); pass += 1) {
      await input.scrollTo("bottom", measuredScrollHeight);
      await waitForSettle();
      const expandedScrollHeight = Math.max(measuredScrollHeight, measure());
      const expanded = expandedScrollHeight > measuredScrollHeight + 1;
      if (expanded) {
        lazyExpansions += 1;
        measuredScrollHeight = expandedScrollHeight;
      }
      // Always perform the visible bottom -> wait -> bottom confirmation pass.
      // Additional passes are reserved for pages that continue growing.
      if (pass >= 1 && !expanded) {
        break;
      }
    }
    if (activationStale()) {
      return { skipped: true, lazyExpansions, frozenAtBottom: false };
    }

    await input.freezeAtBottom();
    frozenAtBottom = true;
    await waitForSettle();
    await input.scrollTo("restore", Math.max(input.initialScrollHeight, measure()));
    await waitForSettle();
    return { skipped: false, lazyExpansions, frozenAtBottom: true };
  } finally {
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
