// @ts-nocheck
import * as utils from "../common/utilities.js";

const CLEAR_BROWSING_DATA_TIMEOUT_MS = 20000;
const RELOAD_TAB_TIMEOUT_MS = 10000;

function sendRuntimeMessageWithTimeout(message, timeoutMs, timeoutError) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
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

export function clearBrowsingDataForOrigin(origin) {
  if (!origin || typeof origin !== "string") {
    return Promise.resolve({ ok: false, error: "Missing origin" });
  }
  return sendRuntimeMessageWithTimeout(
    { type: "clearBrowsingDataForOrigin", origin },
    CLEAR_BROWSING_DATA_TIMEOUT_MS,
    "Timed out while clearing cache"
  );
}

export function reloadTab(tabId) {
  if (!tabId) {
    return Promise.resolve({ ok: false, error: "Missing tab" });
  }
  return sendRuntimeMessageWithTimeout(
    { type: "reloadTab", tabId },
    RELOAD_TAB_TIMEOUT_MS,
    "Timed out while reloading tab"
  );
}
