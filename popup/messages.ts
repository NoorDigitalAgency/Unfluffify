// @ts-nocheck
import * as utils from "../common/utilities.js";
import { requestRuntime } from "../common/async-messaging.js";
import * as stateModule from "./state.js";
import { isDebugFlagEnabled } from "../common/feature-flags.js";

const { state } = stateModule;
const POPUP_GET_TAB_VIEW_STATE_COMMAND = "POPUP_GET_TAB_VIEW_STATE";
const TAB_CONTENT_REQUEST_COMMAND = "TAB_CONTENT_REQUEST";
const TAB_ACTIVATE_MARKING_COMMAND = "TAB_ACTIVATE_MARKING";
const TAB_DEACTIVATE_MARKING_COMMAND = "TAB_DEACTIVATE_MARKING";
const TAB_APPLY_POST_SAVE_TRANSITION_COMMAND = "TAB_APPLY_POST_SAVE_TRANSITION";
const TAB_APPLY_LOCAL_DISCARD_COMMAND = "TAB_APPLY_LOCAL_DISCARD";
const TAB_SHOW_AI_PREVIEW_COMMAND = "TAB_SHOW_AI_PREVIEW";
const TAB_CLOSE_AI_PREVIEW_COMMAND = "TAB_CLOSE_AI_PREVIEW";
const TAB_SET_AI_PREVIEW_EXPANDED_MODE_COMMAND = "TAB_SET_AI_PREVIEW_EXPANDED_MODE";
const TAB_FOCUS_PREVIEW_ELEMENT_COMMAND = "TAB_FOCUS_PREVIEW_ELEMENT";
const TAB_RUN_RENDER_MODE_INSPECTION_COMMAND = "TAB_RUN_RENDER_MODE_INSPECTION";
const TAB_END_RENDER_MODE_INSPECTION_COMMAND = "TAB_END_RENDER_MODE_INSPECTION";
const TAB_RUN_AI_COMMAND = "TAB_RUN_AI";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldTraceWorldMessaging() {
  return isDebugFlagEnabled("fullWorldMessagingLogging") || Boolean(state.traceModeEnabled);
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
    return response;
  });
}

export function requestTabApplyPostSaveTransition(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_APPLY_POST_SAVE_TRANSITION_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 15000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to apply save transition",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabApplyLocalDiscard(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_APPLY_LOCAL_DISCARD_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to discard page changes",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabShowAiPreview(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_SHOW_AI_PREVIEW_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to open preview",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabCloseAiPreview(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_CLOSE_AI_PREVIEW_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to close preview",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabSetAiPreviewExpandedMode(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_SET_AI_PREVIEW_EXPANDED_MODE_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to update preview mode",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabFocusPreviewElement(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_FOCUS_PREVIEW_ELEMENT_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to focus preview item",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
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

export function requestPopupTabViewState(tabId, options = {}) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  return requestRuntime({
    type: POPUP_GET_TAB_VIEW_STATE_COMMAND,
    payload: {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 3000
  }).then((result) => (
    result && typeof result === "object" ? result : null
  )).catch(() => null);
}

export function requestTabActivateMarking(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_ACTIVATE_MARKING_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 15000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to activate marking",
      locked: Boolean(reply && reply.details && reply.details.locked),
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabDeactivateMarking(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_DEACTIVATE_MARKING_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 10000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to deactivate marking",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabRunRenderModeInspection(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};
  return requestRuntime({
    type: TAB_RUN_RENDER_MODE_INSPECTION_COMMAND,
    payload: normalizedPayload
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 120000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch(async (error) => {
    if (typeof normalizedPayload.operationId === "string" && normalizedPayload.operationId) {
      await requestRuntime({
        type: TAB_END_RENDER_MODE_INSPECTION_COMMAND,
        payload: {
          operationId: normalizedPayload.operationId
        }
      }, {
        tabId,
        timeoutMs: 5000
      }).catch(() => null);
    }
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to inspect render mode",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabRunAi(tabId, payload = {}, options = {}) {
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_RUN_AI_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 540000
  }).then((result) => ({
    ok: true,
    result: result && typeof result === "object" ? result : {}
  })).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to run AI",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function sendTabMessage(message) {
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    return Promise.resolve(null);
  }
  return sendTabMessageToTab(tabId, message);
}

export function sendTabMessageToTab(tabId, message) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  logPopupMessageTrace("tab:send", {
    tabId,
    type: message && message.type ? message.type : ""
  });
  return requestRuntime({
    type: TAB_CONTENT_REQUEST_COMMAND,
    payload: {
      message: message && typeof message === "object" ? message : {},
      timeoutMs: 3000
    }
  }, {
    tabId,
    timeoutMs: 5000
  }).then((result) => {
    const response = result && typeof result === "object" && result.response && typeof result.response === "object"
      ? result.response
      : null;
    logPopupMessageTrace("tab:response", {
      tabId,
      type: message && message.type ? message.type : "",
      ok: Boolean(response && response.ok)
    });
    return response;
  }).catch((error) => {
    logPopupMessageTrace("tab:error", {
      tabId,
      type: message && message.type ? message.type : "",
      error: (error && error.message) || ""
    });
    return null;
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

function getPopupChromeTabsApi() {
  try {
    return typeof chrome !== "undefined" && chrome.tabs ? chrome.tabs : null;
  } catch {
    return null;
  }
}

function getTabById(tabId) {
  const tabsApi = getPopupChromeTabsApi();
  if (!tabsApi || typeof tabsApi.get !== "function" || !tabId) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      tabsApi.get(tabId, (tab) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab && tab.id ? tab : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function queryActiveTabFallback() {
  const tabsApi = getPopupChromeTabsApi();
  if (!tabsApi || typeof tabsApi.query !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const finish = (tabs) => {
      resolve(Array.isArray(tabs) && tabs[0] && tabs[0].id ? tabs[0] : null);
    };
    try {
      tabsApi.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          finish([]);
          return;
        }
        if (Array.isArray(tabs) && tabs.length) {
          finish(tabs);
          return;
        }
        tabsApi.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            finish([]);
            return;
          }
          finish(fallbackTabs);
        });
      });
    } catch {
      finish([]);
    }
  });
}

async function loadActiveTabFallback(debugTabId) {
  const debugTab = await getTabById(debugTabId);
  if (debugTab) {
    return debugTab;
  }
  return queryActiveTabFallback();
}

export async function loadActiveTab() {
  let debugTabIdParam = 0;
  try {
    debugTabIdParam = typeof location !== "undefined"
      ? Number(new URLSearchParams(location.search).get("debugTabId") || "")
      : 0;
    const response = await sendRuntimeMessage({
      type: "resolvePopupTabContext",
      debugTabId: Number.isFinite(debugTabIdParam) && debugTabIdParam > 0
        ? Math.trunc(debugTabIdParam)
        : null
    });
    state.currentTab = response && response.ok && response.tab
      ? response.tab
      : await loadActiveTabFallback(debugTabIdParam);
  } catch (error) {
    state.currentTab = await loadActiveTabFallback(debugTabIdParam);
  }
}
