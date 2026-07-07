export type RevealRunInput = Readonly<{
  hasVerticalScrollRoom: boolean;
  activationStale: boolean;
  initialScrollHeight: number;
  expandedScrollHeight?: number;
  scrollTo: (position: "top" | "half" | "bottom" | "restore") => void;
  suppressLazyLoading: () => void;
  freezeAtBottom: () => void;
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
  input.scrollTo("top");
  input.scrollTo("half");
  input.suppressLazyLoading();
  const lazyExpansions =
    input.expandedScrollHeight !== undefined && input.expandedScrollHeight > input.initialScrollHeight
      ? 1
      : 0;
  input.scrollTo("bottom");
  input.freezeAtBottom();
  input.scrollTo("restore");
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
