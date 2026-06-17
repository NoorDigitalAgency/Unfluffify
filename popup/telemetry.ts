// @ts-nocheck
export const POPUP_READY_LOG_MESSAGE = "Unfluffify popup ready";

export function getPopupTelemetryTabId(stateLike) {
  return stateLike && stateLike.currentTab && Number.isFinite(stateLike.currentTab.id)
    ? stateLike.currentTab.id
    : null;
}

export function logPopupReady(consoleLike, stateLike) {
  if (!consoleLike || typeof consoleLike.info !== "function") {
    return false;
  }

  if (getPopupTelemetryTabId(stateLike) === null) {
    return false;
  }

  consoleLike.info(POPUP_READY_LOG_MESSAGE);
  return true;
}