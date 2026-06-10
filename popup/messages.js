import * as utils from "../common/utilities.js";
import { requestRuntime } from "../common/async-messaging.js";
import * as stateModule from "./state.js";
import { WORLD_MESSAGE_TYPES } from "../common/world-messaging-contract.js";
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
    if (
      message &&
      message.type === WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE &&
      response &&
      response.ok &&
      Array.isArray(response.traceEvents)
    ) {
      const tail = response.traceEvents.slice(-5);
      logPopupMessageTrace("runtime:trace-tail", { count: tail.length, tail });

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
  return requestRuntime({
    type: TAB_RUN_RENDER_MODE_INSPECTION_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 30000
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
