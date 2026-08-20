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

export function createRevealVisitController() {
  let startedForVisit = false;
  return {
    async run(input: RevealRunInput): Promise<RevealRunResult> {
      if (startedForVisit) {
        return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
      }
      startedForVisit = true;
      const result = await runReveal(input);
      if (!result.skipped) {
        return result;
      }
      startedForVisit = false;
      return result;
    },
    resetForNavigation(): void {
      startedForVisit = false;
    },
  };
}
