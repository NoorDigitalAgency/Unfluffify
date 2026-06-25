type SpinnerStateLike = {
  title?: unknown;
  message?: unknown;
  timerMode?: unknown;
  deadlineAt?: unknown;
  startedAt?: unknown;
  blockSurfaces?: unknown;
  maxDurationMs?: unknown;
  operationKind?: unknown;
  operationPhase?: unknown;
  operationId?: unknown;
  reason?: unknown;
  source?: unknown;
  spinnerKey?: unknown;
};

export type PopupSpinnerSurface = "popup" | "pageCurtain" | "banner";

const latestPopupSpinnerStates: Record<PopupSpinnerSurface, SpinnerStateLike | null> = {
  popup: null,
  pageCurtain: null,
  banner: null,
};

function isSpinnerStateLike(value: unknown): value is SpinnerStateLike {
  return Boolean(value) && typeof value === "object";
}

export function renderPopupSpinnerSurface(surface: PopupSpinnerSurface, state: unknown): void {
  latestPopupSpinnerStates[surface] = isSpinnerStateLike(state) ? state : null;
}

export function renderPopupSpinner(state: unknown): void {
  renderPopupSpinnerSurface("popup", state);
}

export function clearPopupSpinnerSurface(surface: PopupSpinnerSurface): void {
  latestPopupSpinnerStates[surface] = null;
}

export function clearPopupSpinner(): void {
  clearPopupSpinnerSurface("popup");
}

export function getLatestPopupSpinnerState(surface: PopupSpinnerSurface = "popup"): SpinnerStateLike | null {
  return latestPopupSpinnerStates[surface];
}
