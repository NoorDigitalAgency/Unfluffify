type SpinnerStateLike = {
  title?: unknown;
  message?: unknown;
};

type ContentSpinnerSurface = "pageCurtain" | "banner";

type PageCurtainRenderer = (visible: boolean, state: SpinnerStateLike | null) => void;

const latestContentSpinnerStates: Record<ContentSpinnerSurface, SpinnerStateLike | null> = {
  pageCurtain: null,
  banner: null,
};

let pageCurtainRenderer: PageCurtainRenderer | null = null;

export function setPageCurtainRenderer(renderer: PageCurtainRenderer | null): void {
  pageCurtainRenderer = renderer;
}

export function renderContentSpinner(surface: ContentSpinnerSurface, state: unknown): void {
  const normalized = state && typeof state === "object" ? state as SpinnerStateLike : null;
  latestContentSpinnerStates[surface] = normalized;
  if (surface === "pageCurtain") {
    pageCurtainRenderer?.(true, normalized);
  }
}

export function clearContentSpinner(surface: ContentSpinnerSurface): void {
  latestContentSpinnerStates[surface] = null;
  if (surface === "pageCurtain") {
    pageCurtainRenderer?.(false, null);
  }
}

export function getLatestContentSpinnerState(surface: ContentSpinnerSurface): SpinnerStateLike | null {
  return latestContentSpinnerStates[surface];
}
