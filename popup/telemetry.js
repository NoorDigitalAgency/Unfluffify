import { scopeRemoteSupportStateToTab } from "../common/remote-support.js";

export const POPUP_READY_LOG_MESSAGE = "Unfluffify popup ready";

export function getPopupTelemetryTabId(stateLike) {
  return stateLike && stateLike.currentTab && Number.isFinite(stateLike.currentTab.id)
    ? stateLike.currentTab.id
    : null;
}

export function getPopupTelemetryIncludePayloads(stateLike) {
  const currentTabId = getPopupTelemetryTabId(stateLike);
  const scopedState = scopeRemoteSupportStateToTab(stateLike && stateLike.remoteSupportState, currentTabId);
  return Boolean(scopedState.active && scopedState.includePayloads);
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