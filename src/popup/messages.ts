import * as utils from "../common/utilities";
import { requestRuntime } from "../common/async-messaging";
import { browser, type Browser } from "../common/browser";
import * as stateModule from "./state";
import { isDebugFlagEnabled } from "../common/feature-flags";

const { state } = stateModule;
const TAB_BOOTSTRAP_CONTENT_COMMAND = "TAB_BOOTSTRAP_CONTENT";
const TAB_CONTENT_REQUEST_COMMAND = "TAB_CONTENT_REQUEST";
const TAB_ACTIVATE_MARKING_COMMAND = "TAB_ACTIVATE_MARKING";
const TAB_DEACTIVATE_MARKING_COMMAND = "TAB_DEACTIVATE_MARKING";
const TAB_APPLY_POST_SAVE_TRANSITION_COMMAND = "TAB_APPLY_POST_SAVE_TRANSITION";
const TAB_APPLY_LOCAL_DISCARD_COMMAND = "TAB_APPLY_LOCAL_DISCARD";
const TAB_SHOW_AI_PREVIEW_COMMAND = "TAB_SHOW_AI_PREVIEW";
const TAB_CLOSE_AI_PREVIEW_COMMAND = "TAB_CLOSE_AI_PREVIEW";
const TAB_SET_AI_PREVIEW_EXPANDED_MODE_COMMAND = "TAB_SET_AI_PREVIEW_EXPANDED_MODE";
const TAB_FOCUS_PREVIEW_ELEMENT_COMMAND = "TAB_FOCUS_PREVIEW_ELEMENT";
const TAB_RUN_AI_COMMAND = "TAB_RUN_AI";
const TAB_RESUME_AI_COMMAND = "TAB_RESUME_AI";

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TabRequestOptions {
  timeoutMs?: number;
}

type TabRequestPayload = Record<string, unknown>;
type TabCommandReply = Record<string, unknown> & {
  ok: boolean;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
};

type TabId = number | null | undefined;

function resolveTimeoutMs(options: TabRequestOptions, fallback: number): number {
  const value = options.timeoutMs;
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function shouldTraceWorldMessaging() {
  return isDebugFlagEnabled("fullWorldMessagingLogging") || Boolean(state.traceModeEnabled);
}

function logPopupMessageTrace(direction: string, details: Record<string, unknown> = {}) {
  if (!shouldTraceWorldMessaging()) {
    return;
  }
  try {
    console.debug("[world-trace][popup:messages]", direction, details);
  } catch {
    // Trace logging must never break popup message flow.
  }
}

export function sendRuntimeMessage(message: Record<string, unknown>) {
  logPopupMessageTrace("runtime:send", {
    type: message && message.type ? message.type : "",
    tabId: message && Number.isFinite(message.tabId) ? Math.trunc(message.tabId as number) : null
  });
  return utils.sendRuntimeMessage(message).then((response) => {
    const responseRecord = response as Record<string, unknown> | null | undefined;
    logPopupMessageTrace("runtime:response", {
      type: message && message.type ? message.type : "",
      ok: Boolean(responseRecord && responseRecord.ok),
      responseType: responseRecord && responseRecord.type ? responseRecord.type : ""
    });
    return response;
  });
}

export function requestTabBootstrapContent(tabId: TabId, options: TabRequestOptions = {}): Promise<TabCommandReply> {
  const opts = options;
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_BOOTSTRAP_CONTENT_COMMAND,
    payload: {}
  }, {
    tabId,
    timeoutMs: resolveTimeoutMs(opts, 15000)
  }).then((result) => {
    if (result && typeof result === "object") {
      const reply = result as Record<string, unknown>;
      return {
        ...reply,
        ok: Boolean(reply.ok)
      } as TabCommandReply;
    }
    return {
      ok: false,
      error: "Unable to prepare tab content"
    };
  }).catch((error) => {
    const reply = error && error.details && error.details.reply && typeof error.details.reply === "object"
      ? error.details.reply
      : null;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : (reply && reply.code) || "handler_failed",
      error: (error && error.message) || (reply && reply.error) || "Unable to prepare tab content",
      details: reply && reply.details && typeof reply.details === "object" ? reply.details : {}
    };
  });
}

export function requestTabApplyPostSaveTransition(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 15000)
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

export function requestTabApplyLocalDiscard(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 10000)
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

export function requestTabShowAiPreview(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 45000)
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

export function requestTabCloseAiPreview(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 10000)
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

export function requestTabSetAiPreviewExpandedMode(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 10000)
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

export function requestTabFocusPreviewElement(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 10000)
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

export function getTabState(tabId: TabId, scope: string | null = null) {
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

export function setTabState(tabId: TabId, tabState: Record<string, unknown>, scope: string | null = null) {
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

export function requestTabActivateMarking(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 15000)
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

export function requestTabDeactivateMarking(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 10000)
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

export function requestTabRunAi(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
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
    timeoutMs: resolveTimeoutMs(opts, 540000)
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

export function requestTabResumeAi(tabId: TabId, payload: TabRequestPayload = {}, options: TabRequestOptions = {}) {
  const opts = options;
  if (!tabId) {
    return Promise.resolve({
      ok: false,
      error: "Missing tab"
    });
  }
  return requestRuntime({
    type: TAB_RESUME_AI_COMMAND,
    payload: payload && typeof payload === "object" ? payload : {}
  }, {
    tabId,
    timeoutMs: resolveTimeoutMs(opts, 540000)
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

export function sendTabMessage(message: Record<string, unknown>, options: TabRequestOptions = {}) {
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    return Promise.resolve(null);
  }
  return sendTabMessageToTab(tabId, message, options);
}

export function sendTabMessageToTab(tabId: TabId, message: Record<string, unknown>, options: TabRequestOptions = {}) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  const contentTimeoutMs = resolveTimeoutMs(options, 3000);
  const requestTimeoutMs = Math.max(resolveTimeoutMs(options, 5000), contentTimeoutMs + 2000);
  logPopupMessageTrace("tab:send", {
    tabId,
    type: message && message.type ? message.type : ""
  });
  return requestRuntime({
    type: TAB_CONTENT_REQUEST_COMMAND,
    payload: {
      message: message && typeof message === "object" ? message : {},
      timeoutMs: contentTimeoutMs
    }
  }, {
    tabId,
    timeoutMs: requestTimeoutMs
  }).then((result) => {
    const resultRecord = result as Record<string, unknown> | null | undefined;
    const response = resultRecord && typeof resultRecord === "object" && resultRecord.response && typeof resultRecord.response === "object"
      ? resultRecord.response as Record<string, unknown>
      : null;
    logPopupMessageTrace("tab:response", {
      tabId,
      type: message && message.type ? message.type : "",
      ok: Boolean(response && response.ok)
    });
    return response;
  }).catch((error) => {
    const errorRecord = error as { message?: unknown } | null | undefined;
    logPopupMessageTrace("tab:error", {
      tabId,
      type: message && message.type ? message.type : "",
      error: (errorRecord && errorRecord.message) || ""
    });
    return null;
  });
}

export async function sendTabMessageWithRetry(message: Record<string, unknown>, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await sendTabMessage(message);
    if (response) {
      return response;
    }
    await delay(250);
  }
  return null;
}

function getPopupTabsApi() {
  try {
    return browser.tabs;
  } catch {
    return null;
  }
}

async function getTabById(tabId: TabId) {
  const tabsApi = getPopupTabsApi();
  if (!tabsApi || !tabId) {
    return Promise.resolve(null);
  }
  try {
    const tab = await tabsApi.get(tabId);
    return tab && tab.id ? tab : null;
  } catch {
    return null;
  }
}

function resolveActiveTab(tabs: Browser.tabs.Tab[]) {
  return Array.isArray(tabs) && tabs[0] && tabs[0].id ? tabs[0] : null;
}

async function queryActiveTabFallback() {
  const tabsApi = getPopupTabsApi();
  if (!tabsApi) {
    return Promise.resolve(null);
  }
  try {
    const currentWindowTabs = await tabsApi.query({ active: true, currentWindow: true });
    const activeCurrentWindowTab = resolveActiveTab(currentWindowTabs);
    if (activeCurrentWindowTab) {
      return activeCurrentWindowTab;
    }
    const lastFocusedTabs = await tabsApi.query({ active: true, lastFocusedWindow: true });
    return resolveActiveTab(lastFocusedTabs);
  } catch {
    return null;
  }
}

async function loadActiveTabFallback(debugTabId: TabId) {
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
  } catch (_error) {
    state.currentTab = await loadActiveTabFallback(debugTabIdParam);
  }
}
