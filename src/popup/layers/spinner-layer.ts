// P4 step 4.2: the brain ships surface vocabulary only ({kind, phase} +
// timing); presentation resolves locally from machine memory / the shared
// phase-definition table at the consumption sites.
type SpinnerStateLike = {
  kind?: unknown;
  phase?: unknown;
  deadlineAt?: unknown;
  startedAt?: unknown;
  operationId?: unknown;
  reason?: unknown;
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
