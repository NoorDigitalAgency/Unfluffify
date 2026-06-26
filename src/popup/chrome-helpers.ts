import * as utils from "../common/utilities";

const CLEAR_BROWSING_DATA_TIMEOUT_MS = 20000;
const RELOAD_TAB_TIMEOUT_MS = 10000;

type RuntimeMessage = {
  type: string;
  origin?: string;
  tabId?: number;
};

type RuntimeResponse = {
  ok: boolean;
  error?: string;
};

function sendRuntimeMessageWithTimeout(
  message: RuntimeMessage,
  timeoutMs: number,
  timeoutError: string
): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: RuntimeResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, error: timeoutError });
    }, timeoutMs);
    utils.sendRuntimeMessage(message)
      .then((response) => {
        finish(response || { ok: false });
      })
      .catch((error) => {
        finish({
          ok: false,
          error: (error && error.message) || timeoutError
        });
      });
  });
}

export function clearBrowsingDataForOrigin(origin: unknown): Promise<RuntimeResponse> {
  if (!origin || typeof origin !== "string") {
    return Promise.resolve({ ok: false, error: "Missing origin" });
  }
  return sendRuntimeMessageWithTimeout(
    { type: "clearBrowsingDataForOrigin", origin },
    CLEAR_BROWSING_DATA_TIMEOUT_MS,
    "Timed out while clearing cache"
  );
}

export function reloadTab(tabId: unknown): Promise<RuntimeResponse> {
  const normalizedTabId = Number.isFinite(tabId) ? Math.trunc(tabId as number) : 0;
  if (!normalizedTabId) {
    return Promise.resolve({ ok: false, error: "Missing tab" });
  }
  return sendRuntimeMessageWithTimeout(
    { type: "reloadTab", tabId: normalizedTabId },
    RELOAD_TAB_TIMEOUT_MS,
    "Timed out while reloading tab"
  );
}
