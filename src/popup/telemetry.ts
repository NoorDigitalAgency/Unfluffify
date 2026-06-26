export const POPUP_READY_LOG_MESSAGE = "Unfluffify popup ready";

type PopupStateLike = {
  currentTab?: { id?: unknown } | null;
};

type ConsoleLike = {
  info?: (message: string) => void;
};

export function getPopupTelemetryTabId(stateLike: PopupStateLike | null | undefined): number | null {
  const tabId = stateLike?.currentTab?.id;
  return Number.isFinite(tabId)
    ? (tabId as number)
    : null;
}

export function logPopupReady(
  consoleLike: ConsoleLike | null | undefined,
  stateLike: PopupStateLike | null | undefined
): boolean {
  if (!consoleLike || typeof consoleLike.info !== "function") {
    return false;
  }

  if (getPopupTelemetryTabId(stateLike) === null) {
    return false;
  }

  consoleLike.info(POPUP_READY_LOG_MESSAGE);
  return true;
}