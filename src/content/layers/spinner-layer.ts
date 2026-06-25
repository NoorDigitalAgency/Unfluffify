type SpinnerStateLike = {
  title?: unknown;
  message?: unknown;
};

type ContentSpinnerSurface = "pageCurtain" | "banner";

const latestContentSpinnerStates: Record<ContentSpinnerSurface, SpinnerStateLike | null> = {
  pageCurtain: null,
  banner: null,
};

export function renderContentSpinner(surface: ContentSpinnerSurface, state: unknown): void {
  latestContentSpinnerStates[surface] = state && typeof state === "object" ? state as SpinnerStateLike : null;
}

export function clearContentSpinner(surface: ContentSpinnerSurface): void {
  latestContentSpinnerStates[surface] = null;
}

export function getLatestContentSpinnerState(surface: ContentSpinnerSurface): SpinnerStateLike | null {
  return latestContentSpinnerStates[surface];
}
