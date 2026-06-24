type SpinnerStateLike = {
  title?: unknown;
  message?: unknown;
  timerMode?: unknown;
  deadlineAt?: unknown;
  startedAt?: unknown;
  blockSurfaces?: unknown;
};

let latestPopupSpinnerState: SpinnerStateLike | null = null;

function isSpinnerStateLike(value: unknown): value is SpinnerStateLike {
  return Boolean(value) && typeof value === "object";
}

export function renderPopupSpinner(state: unknown): void {
  latestPopupSpinnerState = isSpinnerStateLike(state) ? state : null;
}

export function clearPopupSpinner(): void {
  latestPopupSpinnerState = null;
}

export function getLatestPopupSpinnerState(): SpinnerStateLike | null {
  return latestPopupSpinnerState;
}
