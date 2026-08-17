export type RevealRunInput = Readonly<{
  hasVerticalScrollRoom: boolean;
  activationStale: boolean;
  initialScrollHeight: number;
  measureExpandedScrollHeight?: () => number;
  scrollTo: (
    position: "top" | "half" | "bottom" | "restore",
    measuredScrollHeight: number,
  ) => void;
  waitForPaint?: () => Promise<void>;
  suppressLazyLoading: () => void;
  freezeAtBottom: () => void | Promise<void>;
}>;

export type RevealRunResult = Readonly<{
  skipped: boolean;
  lazyExpansions: number;
  frozenAtBottom: boolean;
}>;

export async function runReveal(input: RevealRunInput): Promise<RevealRunResult> {
  if (!input.hasVerticalScrollRoom || input.activationStale) {
    return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
  }
  const waitForPaint = input.waitForPaint ?? (() => Promise.resolve());
  input.scrollTo("top", input.initialScrollHeight);
  await waitForPaint();
  input.scrollTo("half", input.initialScrollHeight);
  await waitForPaint();
  input.suppressLazyLoading();
  await waitForPaint();
  const expandedScrollHeight = input.measureExpandedScrollHeight?.() ?? input.initialScrollHeight;
  const lazyExpansions = expandedScrollHeight > input.initialScrollHeight ? 1 : 0;
  input.scrollTo("bottom", expandedScrollHeight);
  await waitForPaint();
  await input.freezeAtBottom();
  await waitForPaint();
  input.scrollTo("restore", expandedScrollHeight);
  await waitForPaint();
  return { skipped: false, lazyExpansions, frozenAtBottom: true };
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
