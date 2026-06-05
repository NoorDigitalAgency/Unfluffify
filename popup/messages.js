import * as utils from "../common/utilities.js";
import * as stateModule from "./state.js";
import { WORLD_MESSAGE_TYPES } from "../common/world-messaging-contract.js";

const { state } = stateModule;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldTraceWorldMessaging() {
  return Boolean(state.traceModeEnabled);
}

function logPopupMessageTrace(direction, details = {}) {
  if (!shouldTraceWorldMessaging()) {
    return;
  }
  try {
    console.debug("[world-trace][popup:messages]", direction, details);
  } catch {
    // Trace logging must never break popup message flow.
  }
}

export function sendRuntimeMessage(message) {
  logPopupMessageTrace("runtime:send", {
    type: message && message.type ? message.type : "",
    tabId: message && Number.isFinite(message.tabId) ? Math.trunc(message.tabId) : null
  });
  return utils.sendRuntimeMessage(message).then((response) => {
    logPopupMessageTrace("runtime:response", {
      type: message && message.type ? message.type : "",
      ok: Boolean(response && response.ok),
      responseType: response && response.type ? response.type : ""
    });
    if (
      message &&
      message.type === WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE &&
      response &&
      response.ok &&
      Array.isArray(response.traceEvents)
    ) {
      const tail = response.traceEvents.slice(-5);
      logPopupMessageTrace("runtime:trace-tail", { count: tail.length, tail });
    }
    return response;
  });
}

export function getTabState(tabId, scope = null) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  return sendRuntimeMessage({
    type: "getTabState",
    tabId,
    scope,
    nullIfMissing: true
  }).then((response) => (response && typeof response === "object" ? response : null));
}

export function setTabState(tabId, tabState, scope = null) {
  if (!tabId) {
    return Promise.resolve({ ok: false });
  }
  return sendRuntimeMessage({
    type: "setTabState",
    tabId,
    scope,
    state: tabState && typeof tabState === "object" ? tabState : {}
  });
}

export function sendTabMessage(message) {
  return new Promise((resolve) => {
    if (!state.currentTab || !state.currentTab.id) {
      resolve(null);
      return;
    }
    chrome.tabs.sendMessage(state.currentTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        logPopupMessageTrace("tab:error", {
          tabId: state.currentTab.id,
          type: message && message.type ? message.type : "",
          error: chrome.runtime.lastError.message || ""
        });
        resolve(null);
        return;
      }
      logPopupMessageTrace("tab:response", {
        tabId: state.currentTab.id,
        type: message && message.type ? message.type : "",
        ok: Boolean(response && response.ok)
      });
      resolve(response);
    });
  });
}

export function sendTabMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve(null);
      return;
    }
    logPopupMessageTrace("tab:send", {
      tabId,
      type: message && message.type ? message.type : ""
    });
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        logPopupMessageTrace("tab:error", {
          tabId,
          type: message && message.type ? message.type : "",
          error: chrome.runtime.lastError.message || ""
        });
        resolve(null);
        return;
      }
      logPopupMessageTrace("tab:response", {
        tabId,
        type: message && message.type ? message.type : "",
        ok: Boolean(response && response.ok)
      });
      resolve(response);
    });
  });
}

export async function sendTabMessageWithRetry(message, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await sendTabMessage(message);
    if (response) {
      return response;
    }
    await delay(250);
  }
  return null;
}

export async function loadActiveTab() {
  try {
    const debugTabIdParam = typeof location !== "undefined"
      ? Number(new URLSearchParams(location.search).get("debugTabId") || "")
      : 0;
    const response = await sendRuntimeMessage({
      type: "resolvePopupTabContext",
      debugTabId: Number.isFinite(debugTabIdParam) && debugTabIdParam > 0
        ? Math.trunc(debugTabIdParam)
        : null
    });
    state.currentTab = response && response.ok && response.tab ? response.tab : null;
  } catch (error) {
    state.currentTab = null;
  }
}
