/**
 * @fileoverview Background service worker for the Unfluffify extension.
 * 
 * This service worker manages:
 * - Tab state persistence and retrieval
 * - Device emulation configuration and updates
 * - Content script injection
 * - IndexedDB operations for data storage
 * - Tab lifecycle events and cleanup
 * - Extension action icon updates
 * 
 * Messages handled:
 * - getTabState: Retrieve extension state for a tab
 * - setTabState: Save extension state for a tab
 * - setDeviceEmulation: Enable/disable device emulation for a tab
 * - updateDeviceEmulation: Modify device emulation parameters
 * - getDeviceEmulationState: Get current device emulation state
 * - clearTabState: Clear all state for a tab
 * - unregisterTabAndReload: Disable extension and reload tab
 * - injectContentScript: Inject content script into a tab
 * - isScriptInjected: Check if content script is loaded
 * - idbGet/idbSet/idbRemove: IndexedDB operations
 * - fetchStaticPageHtml: Fetch HTML from external URLs
 */

import * as utils from "./common/utilities.js";
import * as configStore from "./common/config.js";
import {
  clearDeviceEmulationAfterNavigation,
  ensureDefaultMobileDeviceEmulation,
  getDeviceEmulationState,
  reconcileDeviceEmulationState,
  updateDeviceEmulation
} from "./common/emulation.js";
import {DEVICE_EMULATION_PREFIX, SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX} from "./common/constants.js";
import * as constants from "./common/constants.js";
import { normalizePropertyPageTypes } from "./common/lynx-checklist.js";
import {
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  maybeUpdateStoredTokenFromResponse,
  normalizeStageBase,
  normalizeSiteIdValue
} from "./common/lynx-live-pages.js";
import {
  handleRemoteSupportBackgroundMessage,
  handleRemoteSupportTabRemoved,
  initRemoteSupportBackground
} from "./common/remote-support-background.js";
import { installExtensionTelemetry } from "./common/extension-telemetry.js";
import {
  handlePropertyLockBackgroundMessage,
  initPropertyLockBackground
} from "./common/property-lock-background.js";
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_OWNERS,
  WORLD_MESSAGE_TYPES,
  WORLD_PORTS,
  isLifecycleTerminalPhase
} from "./common/world-messaging-contract.js";
import {
  AI_RUN_PERSIST_KEY,
  buildAiSubmissionXpaths,
  getAiRunResumeExpiresAt,
  normalizePersistedAiRunRecord,
  parseAiRunStartResponse,
  parseAiRunStatusResponse
} from "./popup/ai-run.js";

const REMOTE_SUPPORT_MESSAGE_TYPES = new Set([
  "getRemoteSupportState",
  "remoteSupportRequestCode",
  "remoteSupportJoin",
  "remoteSupportEnd",
  "remoteSupportSetDockState",
  "remoteSupportContinueSession",
  "remoteSupportSetLocalMediaEnabled",
  "remoteSupportSetControlOwner",
  "remoteSupportSendCommand",
  "remoteSupportDismissError",
  "remoteSupportExtensionTelemetry",
  "remoteSupportTransportEvent"
]);

const PROPERTY_LOCK_MESSAGE_TYPES = new Set([
  "getPropertyLockState",
  "propertyLockTakeLock",
  "propertyLockRelease",
  "propertyLockSuggest",
  "propertyLockRespondToSuggestion",
  "propertyLockContinueEditing",
  "propertyLockDraftStatus",
  "pageDraftChanged"
]);

const tabLifecycleStateByTabId = new Map();
const tabSpinnerQueueByTabId = new Map();
const popupStatePortsByTabId = new Map();
const tabWorldTraceStateByTabId = new Map();
const WORLD_TRACE_EVENT_LIMIT = 160;
const UPDATE_SCRAPING_CONDITIONS_MUTATION = `
mutation updateScrapingConditions(
  $domainId: Int!,
  $includeCss: String,
  $excludeCss: String,
  $renderingMode: DomainRenderMode
) {
  updateScrapingConditions(
    domainId: $domainId,
    includeCss: $includeCss,
    excludeCss: $excludeCss,
    renderingMode: $renderingMode
  )
}
`;

function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    if (!origin || typeof origin !== "string") {
      resolve({ ok: false, error: "Missing origin" });
      return;
    }
    try {
      chrome.browsingData.remove(
        { origins: [origin] },
        {
          cookies: true,
          cacheStorage: true,
          localStorage: true,
          indexedDB: true,
          serviceWorkers: true
        },
        () => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || "Unable to clear cache"
            });
            return;
          }
          resolve({ ok: true });
        }
      );
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to clear cache"
      });
    }
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    if (!normalizedTabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    try {
      chrome.tabs.reload(normalizedTabId, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to reload tab"
          });
          return;
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to reload tab"
      });
    }
  });
}

function navigateTabToUrl(tabId, url) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    const targetUrl = typeof url === "string" ? url.trim() : "";
    if (!normalizedTabId || !targetUrl) {
      resolve({ ok: false, error: "Missing tab or URL" });
      return;
    }
    try {
      chrome.tabs.update(normalizedTabId, { url: targetUrl }, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to navigate tab"
          });
          return;
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to navigate tab"
      });
    }
  });
}

async function getPersistedAiRunRecord() {
  const stored = await utils.storageGet(chrome.storage.session, AI_RUN_PERSIST_KEY);
  return normalizePersistedAiRunRecord(stored && stored[AI_RUN_PERSIST_KEY]);
}

async function savePersistedAiRunRecord(record) {
  const normalized = normalizePersistedAiRunRecord(record);
  if (!normalized) {
    await utils.storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
    return null;
  }
  await utils.storageSet(chrome.storage.session, {
    [AI_RUN_PERSIST_KEY]: normalized
  });
  return normalized;
}

async function clearPersistedAiRunRecord() {
  await utils.storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
}

function sendContentMessageToTab(tabId, message, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    if (!normalizedTabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      finish({ ok: false, error: "Content message timed out" });
    }, Math.max(1, Number(timeoutMs) || 3000));
    try {
      chrome.tabs.sendMessage(normalizedTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          finish({
            ok: false,
            error: chrome.runtime.lastError.message || "Content message failed"
          });
          return;
        }
        finish(response && typeof response === "object" ? response : { ok: false });
      });
    } catch (error) {
      finish({
        ok: false,
        error: (error && error.message) || "Content message failed"
      });
    }
  });
}

function waitForBackgroundRetryDelay(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function ensureContentMainForTab(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, error: "Missing tab" };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await sendContentMessageToTab(normalizedTabId, {
      type: "activateContentMain"
    });
    if (response && response.ok) {
      return { ok: true, tabId: normalizedTabId };
    }
    if (attempt < 4) {
      await waitForBackgroundRetryDelay(150 * (attempt + 1));
    }
  }
  return { ok: false, tabId: normalizedTabId, error: "Content activation failed" };
}

async function setAiComputeLockForTab(tabId, active, expiresAt = 0) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, active: Boolean(active), error: "Missing tab" };
  }
  if (active) {
    const activationResult = await ensureContentMainForTab(normalizedTabId);
    if (!activationResult.ok) {
      return {
        ok: false,
        active: true,
        tabId: normalizedTabId,
        error: activationResult.error || "Content activation failed"
      };
    }
  }
  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "setAiComputeLock",
    active: Boolean(active),
    expiresAt: Number(expiresAt) || 0
  });
  if (!active && (!response || !response.ok)) {
    return { ok: true, active: false, tabId: normalizedTabId };
  }
  return response && response.ok
    ? { ok: true, active: Boolean(active), tabId: normalizedTabId }
    : {
      ok: false,
      active: Boolean(active),
      tabId: normalizedTabId,
      error: (response && response.error) || "AI compute lock failed"
    };
}

async function refreshAiRunHeartbeat(options = {}) {
  const tabId = normalizeBrokerTabId(options.tabId);
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const siteId = normalizeSiteIdValue(options.siteId);
  const deadlineAt = Number(options.deadlineAt);
  if (!tabId || !sessionId || !siteId || !Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return { ok: false, record: null, expiresAt: 0, lockApplied: false };
  }
  const expiresAt = getAiRunResumeExpiresAt();
  const record = await savePersistedAiRunRecord({
    sessionId,
    siteId,
    expiresAt,
    deadlineAt
  });
  if (!record) {
    return { ok: false, record: null, expiresAt: 0, lockApplied: false };
  }
  const lockResult = await setAiComputeLockForTab(tabId, true, expiresAt);
  if (!lockResult.ok) {
    await clearPersistedAiRunRecord();
    return {
      ok: false,
      record: null,
      expiresAt: 0,
      lockApplied: false,
      error: lockResult.error || "AI compute lock failed"
    };
  }
  return { ok: true, record, expiresAt, lockApplied: true };
}

function resolveBackgroundEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function createBackgroundJsonHeaders(tokenValue = "") {
  const headers = { "Content-Type": "application/json" };
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildValidateEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
}

function buildLoginEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

async function requestAiRunStatus(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const statusUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/status/${encodeURIComponent(sessionId)}`)
    : "";
  if (!statusUrl) {
    return { ok: false };
  }
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: createBackgroundJsonHeaders(tokenValue)
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  if (response.status === 404) {
    return { ok: false, notFound: true };
  }
  if (!response.ok) {
    return { ok: false };
  }
  const parsed = parseAiRunStatusResponse(await response.json());
  if (!parsed || parsed.sessionId !== sessionId) {
    return { ok: false };
  }
  return { ok: true, status: parsed.status };
}

async function removeRemotePageMarking(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const pageUrl = typeof options.url === "string" ? options.url.trim() : "";
  const removeUrl = resolveBackgroundEndpoint(endpointValue, "/remove");
  if (!removeUrl || !normalizedSiteId || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await fetch(removeUrl, {
    method: "POST",
    headers: createBackgroundJsonHeaders(tokenValue),
    body: JSON.stringify({
      siteId: normalizedSiteId,
      url: pageUrl
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  return { ok: response.ok, status: response.status || 0 };
}

async function validateAuthToken(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const validateUrl = buildValidateEndpointFromStageBase(stageBase);
  if (!validateUrl || !tokenValue.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(validateUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, valid: false, status: response.status || 0 };
    }
    return { ok: true, valid: true, status: response.status || 0 };
  } catch {
    return { ok: false };
  }
}

async function requestAuthLogin(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const email = typeof options.email === "string" ? options.email.trim() : "";
  const password = typeof options.password === "string" ? options.password : "";
  const loginUrl = buildLoginEndpointFromStageBase(stageBase);
  if (!loginUrl || !email || !password.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(""),
      body: JSON.stringify({ email, password })
    });
    await maybeUpdateStoredTokenFromResponse(response, "");
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status || 0,
      payload: payload && typeof payload === "object" ? payload : null
    };
  } catch {
    return { ok: false };
  }
}

async function submitSelectorSetGraphqlUpdate(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const includeCss = typeof options.includeCss === "string" ? options.includeCss : "";
  const excludeCss = typeof options.excludeCss === "string" ? options.excludeCss : "";
  const renderMode = typeof options.renderMode === "string" ? options.renderMode : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({
        query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
        variables: {
          domainId: normalizedSiteId,
          includeCss,
          excludeCss,
          renderingMode: renderMode || null
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status || 0,
      payload: payload && typeof payload === "object" ? payload : null
    };
  } catch {
    return { ok: false };
  }
}

function buildRemoteConfigPayloadKey(scope = "load") {
  const normalizedScope = typeof scope === "string" && scope.trim()
    ? scope.trim()
    : "payload";
  return `remote-config-${normalizedScope}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

async function loadRemoteConfigSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const loadUrl = resolveBackgroundEndpoint(endpointValue, "/load");
  if (!loadUrl || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loadUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({ siteId: normalizedSiteId })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (response.status === 404) {
      return { ok: true, status: "not_found", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const payloadKey = buildRemoteConfigPayloadKey();
    await utils.storageSet(chrome.storage.session, { [payloadKey]: payload });
    return { ok: true, status: "ok", payloadKey };
  } catch {
    return { ok: false };
  }
}

async function saveRemoteConfigSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const saveUrl = resolveBackgroundEndpoint(endpointValue, "/save");
  if (!saveUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  let requestPayload = null;
  try {
    const payloadStore = await utils.storageGet(chrome.storage.session, requestPayloadKey).catch(() => ({}));
    requestPayload = payloadStore && typeof payloadStore === "object"
      ? payloadStore[requestPayloadKey]
      : null;
    if (!requestPayload || typeof requestPayload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(requestPayload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object") {
      return { ok: true, status: "empty", payloadKey: "" };
    }
    const responsePayloadKey = buildRemoteConfigPayloadKey("save-response");
    await utils.storageSet(chrome.storage.session, { [responsePayloadKey]: payload });
    return { ok: true, status: "ok", payloadKey: responsePayloadKey };
  } catch {
    return { ok: false };
  } finally {
    await utils.storageRemove(chrome.storage.session, requestPayloadKey).catch(() => null);
  }
}

async function requestRenderModeDetection(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const detectUrl = resolveBackgroundEndpoint(endpointValue, "/is_js_rendered");
  if (!detectUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const payloadStore = await utils.storageGet(chrome.storage.session, requestPayloadKey).catch(() => ({}));
    const payload = payloadStore && typeof payloadStore === "object"
      ? payloadStore[requestPayloadKey]
      : null;
    if (!payload || typeof payload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(detectUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payload: null };
    }
    let payloadResponse = null;
    try {
      payloadResponse = await response.json();
    } catch {
      payloadResponse = null;
    }
    return { ok: true, status: "ok", payload: payloadResponse };
  } catch {
    return { ok: false };
  } finally {
    await utils.storageRemove(chrome.storage.session, requestPayloadKey).catch(() => null);
  }
}

async function submitPageTypeAssignments(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const assignPageTypesUrl = resolveBackgroundEndpoint(endpointValue, "/assign_page_types");
  if (!assignPageTypesUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const payloadStore = await utils.storageGet(chrome.storage.session, requestPayloadKey).catch(() => ({}));
    const payload = payloadStore && typeof payloadStore === "object"
      ? payloadStore[requestPayloadKey]
      : null;
    if (!Array.isArray(payload) || !payload.length) {
      return { ok: false, skipped: true };
    }
    const response = await fetch(assignPageTypesUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false };
  } finally {
    await utils.storageRemove(chrome.storage.session, requestPayloadKey).catch(() => null);
  }
}

async function requestAiRunStartSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const computeSelectorsUrl = resolveBackgroundEndpoint(endpointValue, "/get_selectors");
  if (!computeSelectorsUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const payloadStore = await utils.storageGet(chrome.storage.session, requestPayloadKey).catch(() => ({}));
    const payload = payloadStore && typeof payloadStore === "object"
      ? payloadStore[requestPayloadKey]
      : null;
    const response = await fetch(computeSelectorsUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload || {})
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    const sessionId = parseAiRunStartResponse(await response.json());
    if (!sessionId) {
      return { ok: false };
    }
    return { ok: true, status: "ok", sessionId };
  } catch {
    return { ok: false };
  } finally {
    await utils.storageRemove(chrome.storage.session, requestPayloadKey).catch(() => null);
  }
}

async function requestAiRunResultSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const resultUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/result/${encodeURIComponent(sessionId)}`)
    : "";
  if (!resultUrl) {
    return { ok: false };
  }
  try {
    const response = await fetch(resultUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 404) {
      return { ok: false, notFound: true };
    }
    if (!response.ok) {
      return { ok: false };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray(payload.exclusionSelectors) ||
      !Array.isArray(payload.inclusionSelectors)
    ) {
      return { ok: false };
    }
    const payloadKey = buildRemoteConfigPayloadKey("ai-run-result");
    await utils.storageSet(chrome.storage.session, { [payloadKey]: payload });
    return { ok: true, payloadKey };
  } catch {
    return { ok: false };
  }
}

async function fetchStaticPageHtmlForBackground(url) {
  const targetUrl = typeof url === "string" ? url.trim() : "";
  let parsedUrl = null;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "Unsupported URL" };
  }
  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 0,
        error: "Static HTML request failed"
      };
    }
    return {
      ok: true,
      status: response.status || 200,
      url: response.url || parsedUrl.toString(),
      html: await response.text()
    };
  } catch {
    return { ok: false, error: "Static HTML request failed" };
  }
}

async function prepareAiRunPayloadSnapshot(options = {}) {
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  const currentRenderMode = typeof options.currentRenderMode === "string" ? options.currentRenderMode.trim() : "";
  if (!baseUrl || !currentPageUrl) {
    return { ok: false };
  }
  try {
    const currentConfig = await configStore.ensureConfig(baseUrl);
    const pageMarkings =
      currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
        ? currentConfig.pageMarkings
        : {};
    const storedPageEntries = Object.entries(pageMarkings)
      .filter(([url, entry]) => {
        if (!url || !entry || typeof entry !== "object") {
          return false;
        }
        if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
          return false;
        }
        if (typeof entry.renderedHtml !== "string" || !entry.renderedHtml) {
          return false;
        }
        if (!Array.isArray(entry.submissionXpaths) || entry.submissionXpaths.length === 0) {
          return false;
        }
        return true;
      });
    if (!storedPageEntries.some(([url]) => url === currentPageUrl)) {
      return { ok: false, reason: "missing_current_page" };
    }
    if (!storedPageEntries.length) {
      return { ok: false, reason: "missing_saved_pages" };
    }
    const urlsMissingRawHtml = storedPageEntries
      .map(([url, entry]) => ({ url, entry }))
      .filter(({ entry }) => typeof entry.rawHtml !== "string" || !entry.rawHtml);
    const backfillResults = await Promise.all(
      urlsMissingRawHtml.map(async ({ url }) => {
        const response = await fetchStaticPageHtmlForBackground(url);
        if (!response.ok || typeof response.html !== "string" || !response.html) {
          return null;
        }
        return { url, rawHtml: response.html };
      })
    );
    const successfulBackfills = backfillResults.filter(Boolean);
    if (successfulBackfills.length) {
      await configStore.updateConfig(baseUrl, (targetConfig) => {
        if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
          return;
        }
        successfulBackfills.forEach((item) => {
          const targetEntry = targetConfig.pageMarkings[item.url];
          if (!targetEntry || typeof targetEntry !== "object") {
            return;
          }
          targetEntry.rawHtml = item.rawHtml;
        });
      });
    }
    const rawHtmlBackfills = new Map();
    successfulBackfills.forEach((item) => {
      rawHtmlBackfills.set(item.url, item.rawHtml);
    });
    const pages = storedPageEntries.map(([url, entry]) => {
      const rawHtml =
        entry && typeof entry.rawHtml === "string" && entry.rawHtml
          ? entry.rawHtml
          : rawHtmlBackfills.get(url) || "";
      return {
        url,
        renderedHtml: typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
        rawHtml: currentRenderMode === "static" ? rawHtml : undefined,
        renderedXPaths: buildAiSubmissionXpaths(entry)
      };
    });
    const payloadKey = buildRemoteConfigPayloadKey("ai-run-prepare");
    await utils.storageSet(chrome.storage.session, {
      [payloadKey]: {
        baseUrl,
        renderMode: currentRenderMode,
        defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
        pages
      }
    });
    return {
      ok: true,
      payloadKey,
      requiresRawXPathRefinement: currentRenderMode === "static"
    };
  } catch {
    return { ok: false };
  }
}

function ensureTraceState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { enabled: false, events: [] };
  }
  if (!tabWorldTraceStateByTabId.has(normalizedTabId)) {
    tabWorldTraceStateByTabId.set(normalizedTabId, {
      enabled: false,
      events: []
    });
  }
  return tabWorldTraceStateByTabId.get(normalizedTabId);
}

function isWorldTraceEnabled(tabId) {
  const traceState = ensureTraceState(tabId);
  return Boolean(traceState && traceState.enabled);
}

function appendWorldTraceEvent(tabId, channel, event, payload = null) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !isWorldTraceEnabled(normalizedTabId)) {
    return;
  }
  const traceState = ensureTraceState(normalizedTabId);
  const traceEvent = {
    at: Date.now(),
    channel: typeof channel === "string" ? channel : "broker",
    event: typeof event === "string" ? event : "event",
    payload: payload && typeof payload === "object"
      ? {
        type: payload.type || "",
        kind: payload.kind || "",
        phase: payload.phase || "",
        operationId: payload.operationId || "",
        busy: Object.prototype.hasOwnProperty.call(payload, "busy") ? Boolean(payload.busy) : undefined,
        message: typeof payload.message === "string" ? payload.message : ""
      }
      : null
  };
  traceState.events.push(traceEvent);
  if (traceState.events.length > WORLD_TRACE_EVENT_LIMIT) {
    traceState.events.splice(0, traceState.events.length - WORLD_TRACE_EVENT_LIMIT);
  }
  try {
    console.debug("[world-trace][background]", normalizedTabId, traceEvent.channel, traceEvent.event, traceEvent.payload || {});
  } catch {
    // Trace logging must never break runtime behavior.
  }
}

function setWorldTraceEnabled(tabId, enabled) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return buildBrokerState(normalizedTabId);
  }
  const traceState = ensureTraceState(normalizedTabId);
  traceState.enabled = Boolean(enabled);
  traceState.events = [];
  const recordTraceEvent = (channel, event, payload) => {
    traceState.events.push({
      at: Date.now(),
      channel,
      event,
      payload: payload && typeof payload === "object" ? payload : null
    });
    if (traceState.events.length > WORLD_TRACE_EVENT_LIMIT) {
      traceState.events.splice(0, traceState.events.length - WORLD_TRACE_EVENT_LIMIT);
    }
  };
  if (!traceState.enabled) {
    recordTraceEvent("trace", "disabled", {
      type: WORLD_MESSAGE_TYPES.TRACE_SET,
      message: "Trace Mode disabled"
    });
  } else {
    recordTraceEvent("trace", "enabled", {
      type: WORLD_MESSAGE_TYPES.TRACE_SET,
      message: "Trace Mode enabled"
    });
    appendWorldTraceEvent(normalizedTabId, "trace", "enabled", {
      type: WORLD_MESSAGE_TYPES.TRACE_SET,
      message: "Trace Mode enabled"
    });
  }
  chrome.tabs.sendMessage(
    normalizedTabId,
    {
      type: WORLD_MESSAGE_TYPES.CONTENT_TRACE_SET,
      enabled: traceState.enabled
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

function normalizeBrokerTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function getMessageTabId(message, sender) {
  return normalizeBrokerTabId(message && message.tabId) ||
    normalizeBrokerTabId(sender && sender.tab && sender.tab.id);
}

function getExtensionContextWindowId(context) {
  return Number.isFinite(context && context.windowId) ? Math.trunc(context.windowId) : null;
}

async function resolvePopupSidePanelBoundTab(sender = {}) {
  if (
    !chrome.runtime ||
    typeof chrome.runtime.getContexts !== "function" ||
    !chrome.tabs ||
    typeof chrome.tabs.get !== "function"
  ) {
    return null;
  }
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["SIDE_PANEL"],
      documentUrls: [chrome.runtime.getURL("popup.html")]
    });
    if (!Array.isArray(contexts)) {
      return null;
    }
    const senderDocumentId = typeof sender.documentId === "string" ? sender.documentId : "";
    const senderContext = senderDocumentId
      ? contexts.find((context) => context && context.documentId === senderDocumentId)
      : null;
    const senderWindowId = getExtensionContextWindowId(senderContext);
    const boundContext = contexts.find((context) => (
      Number.isFinite(context && context.tabId) &&
      (!senderWindowId || getExtensionContextWindowId(context) === senderWindowId)
    ));
    if (!boundContext) {
      return null;
    }
    return await chrome.tabs.get(Math.trunc(boundContext.tabId));
  } catch {
    return null;
  }
}

async function resolvePopupTabContext(message = {}, sender = {}) {
  const debugTabId = normalizeBrokerTabId(message.debugTabId);
  if (debugTabId) {
    try {
      const tab = await chrome.tabs.get(debugTabId);
      if (tab && tab.id) {
        return { ok: true, tab, source: "debug" };
      }
    } catch {
      // Fall through to normal tab resolution if the debug tab is gone.
    }
  }

  const sidePanelBoundTab = await resolvePopupSidePanelBoundTab(sender);
  if (sidePanelBoundTab && sidePanelBoundTab.id) {
    return { ok: true, tab: sidePanelBoundTab, source: "sidePanel" };
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
  } catch {
    tabs = [];
  }
  return { ok: Boolean(tabs[0] && tabs[0].id), tab: tabs[0] || null, source: tabs[0] ? "activeTab" : "none" };
}

function getSpinnerQueueForTab(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return null;
  }
  if (!tabSpinnerQueueByTabId.has(normalizedTabId)) {
    tabSpinnerQueueByTabId.set(normalizedTabId, new Map());
  }
  return tabSpinnerQueueByTabId.get(normalizedTabId);
}

function serializeSpinnerQueue(tabId) {
  const queue = tabSpinnerQueueByTabId.get(tabId);
  if (!queue || queue.size === 0) {
    return [];
  }
  return [...queue.entries()].map(([key, entry]) => ({
    key,
    message: entry && typeof entry.message === "string" ? entry.message : "",
    persistent: Boolean(entry && entry.persistent),
    owner: entry && typeof entry.owner === "string" ? entry.owner : ""
  }));
}

function buildBrokerState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  const traceState = ensureTraceState(normalizedTabId);
  return {
    ok: Boolean(normalizedTabId),
    tabId: normalizedTabId,
    lifecycle: normalizedTabId ? (tabLifecycleStateByTabId.get(normalizedTabId) || null) : null,
    spinnerQueue: normalizedTabId ? serializeSpinnerQueue(normalizedTabId) : [],
    traceEnabled: Boolean(traceState && traceState.enabled),
    traceEvents: traceState && Array.isArray(traceState.events) ? [...traceState.events] : []
  };
}

function broadcastBrokerState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  const ports = popupStatePortsByTabId.get(normalizedTabId);
  if (!ports || ports.size === 0) {
    return;
  }
  const state = buildBrokerState(normalizedTabId);
  ports.forEach((port) => {
    try {
      port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state });
    } catch {
      ports.delete(port);
    }
  });
}

function updateLifecycleState(tabId, event = {}) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !event || typeof event !== "object") {
    return buildBrokerState(normalizedTabId);
  }
  const previous = tabLifecycleStateByTabId.get(normalizedTabId) || {};
  const eventOperationId = typeof event.operationId === "string" && event.operationId
    ? event.operationId
    : "";
  const eventPhase = typeof event.phase === "string" && event.phase ? event.phase : "";
  const isTerminalEvent = isLifecycleTerminalPhase(eventPhase);
  if (
    eventOperationId &&
    previous.operationId &&
    eventOperationId !== previous.operationId &&
    isTerminalEvent
  ) {
    return buildBrokerState(normalizedTabId);
  }
  const operationId = eventOperationId
    ? event.operationId
    : previous.operationId || `lifecycle:${normalizedTabId}:${Date.now()}`;
  const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
  const next = {
    ...previous,
    ...event,
    operationId,
    kind: typeof event.kind === "string" && event.kind ? event.kind : previous.kind || LIFECYCLE_KINDS.UNKNOWN,
    phase: eventPhase || previous.phase || LIFECYCLE_PHASES.UNKNOWN,
    message: typeof event.message === "string" ? event.message : previous.message || "",
    busy: hasBusy ? Boolean(event.busy) : Boolean(previous.busy),
    updatedAt: Date.now()
  };
  tabLifecycleStateByTabId.set(normalizedTabId, next);
  appendWorldTraceEvent(normalizedTabId, "lifecycle", "state-update", next);
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

function setBackgroundSpinnerEntry(tabId, key, entry = {}) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !key) {
    return buildBrokerState(normalizedTabId);
  }
  const queue = getSpinnerQueueForTab(normalizedTabId);
  queue.set(String(key), {
    message: typeof entry.message === "string" ? entry.message : "",
    persistent: Boolean(entry.persistent),
    owner: typeof entry.owner === "string" ? entry.owner : SPINNER_OWNERS.POPUP
  });
  appendWorldTraceEvent(normalizedTabId, "spinner", "set", {
    type: WORLD_MESSAGE_TYPES.SPINNER_SET,
    message: typeof entry.message === "string" ? entry.message : ""
  });
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

function removeBackgroundSpinnerEntry(tabId, key) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !key) {
    return buildBrokerState(normalizedTabId);
  }
  const queue = getSpinnerQueueForTab(normalizedTabId);
  queue.delete(String(key));
  if (queue.size === 0) {
    tabSpinnerQueueByTabId.delete(normalizedTabId);
  }
  appendWorldTraceEvent(normalizedTabId, "spinner", "remove", {
    type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
    message: String(key)
  });
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

function clearBackgroundSpinnerQueue(tabId, options = {}) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return buildBrokerState(normalizedTabId);
  }
  const queue = tabSpinnerQueueByTabId.get(normalizedTabId);
  if (!queue) {
    return buildBrokerState(normalizedTabId);
  }
  const transientOnly = Boolean(options.transientOnly);
  if (transientOnly) {
    [...queue.entries()].forEach(([key, entry]) => {
      if (!entry || !entry.persistent) {
        queue.delete(key);
      }
    });
    if (queue.size === 0) {
      tabSpinnerQueueByTabId.delete(normalizedTabId);
    }
  } else {
    tabSpinnerQueueByTabId.delete(normalizedTabId);
  }
  appendWorldTraceEvent(normalizedTabId, "spinner", "clear", {
    type: WORLD_MESSAGE_TYPES.SPINNER_CLEAR,
    message: transientOnly ? "transient-only" : "all"
  });
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || typeof port.name !== "string" || !port.name.startsWith(WORLD_PORTS.POPUP_STATE_PREFIX)) {
    return;
  }
  const tabId = normalizeBrokerTabId(port.name.slice(WORLD_PORTS.POPUP_STATE_PREFIX.length));
  if (!tabId) {
    try {
      port.disconnect();
    } catch {
      // Ignore invalid popup state ports.
    }
    return;
  }
  if (!popupStatePortsByTabId.has(tabId)) {
    popupStatePortsByTabId.set(tabId, new Set());
  }
  const ports = popupStatePortsByTabId.get(tabId);
  ports.add(port);
  try {
    port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state: buildBrokerState(tabId) });
  } catch {
    ports.delete(port);
  }
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (ports.size === 0) {
      popupStatePortsByTabId.delete(tabId);
      clearBackgroundSpinnerQueue(tabId, { transientOnly: true });
    }
  });
});

initRemoteSupportBackground();
initPropertyLockBackground();
installExtensionTelemetry({
  source: "worker",
  sendTelemetry(message) {
    return handleRemoteSupportBackgroundMessage(message, {});
  }
});
console.info("Unfluffify background worker ready");

async function resolveLivePageSiteId(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const pageUrl = typeof options.pageUrl === "string" ? options.pageUrl.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue.trim() : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !pageUrl) {
    return { ok: false, siteId: null };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: URL_SEARCH_INFO_QUERY,
        variables: {
          url: pageUrl,
          includePageInfo: false
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const notFound = payload.errors.some((item) => {
        const code =
          item &&
          item.extensions &&
          typeof item.extensions.code === "string"
            ? item.extensions.code
            : "";
        return code === "NotFound";
      });
      if (notFound) {
        return { ok: true, siteId: null, baseUrl: "", notFound: true };
      }
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!response.ok || !payload) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const urlSearchInfo = payload && payload.data ? payload.data.urlSearchInfo : null;
    const siteId = normalizeSiteIdValue(urlSearchInfo && urlSearchInfo.domainId);
    const baseUrl = normalizeBaseUrlFromDomainName(
      urlSearchInfo && urlSearchInfo.domainName,
      pageUrl
    );
    if (!siteId) {
      return { ok: true, siteId: null, baseUrl, notFound: true };
    }
    if (!baseUrl) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    return {
      ok: true,
      siteId,
      baseUrl,
      notFound: false
    };
  } catch {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

function normalizeBaseUrlFromDomainName(domainName, pageUrl = "") {
  if (typeof domainName !== "string") {
    return "";
  }
  const raw = domainName.trim();
  if (!raw) {
    return "";
  }
  let protocol = "https:";
  try {
    const page = new URL(pageUrl);
    if (page.protocol === "http:" || page.protocol === "https:") {
      protocol = page.protocol;
    }
  } catch {
    // Use HTTPS default.
  }
  let parsed = null;
  try {
    parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(`${protocol}//${raw.replace(/^\/+/, "")}`);
  } catch {
    return "";
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return "";
  }
  const hostname = (parsed.hostname || "").trim().toLowerCase();
  if (!hostname) {
    return "";
  }
  let pathname = parsed.pathname || "/";
  pathname = pathname.replace(/\/+$/, "");
  if (!pathname) {
    pathname = "/";
  }
  const normalized = `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
  return utils.normalizeCanonicalBaseUrl(normalized) || normalized;
}

function buildPropertyPageTypesSignature(pageTypes) {
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? pageTypes.map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? pageType.candidates.map((candidate) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                Boolean(candidate && candidate.duplicate) ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

async function fetchLivePagePropertyPageTypes(options = {}) {
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue.trim() : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!normalizedSiteId || !graphqlEndpoint) {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: PROPERTY_PAGE_TYPES_QUERY,
        variables: {
          domainId: normalizedSiteId
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload || Array.isArray(payload.errors)) {
      return {
        ok: false,
        pageTypes: [],
        reason: "Unable to verify Live Page candidates."
      };
    }
    const normalized = normalizePropertyPageTypes(
      payload && payload.data
        ? payload.data.propertyPageTypes
        : null
    );
    return {
      ok: true,
      pageTypes: normalized.pageTypes || [],
      duplicateUrls: normalized.duplicateUrls || [],
      signature: buildPropertyPageTypesSignature(normalized.pageTypes)
    };
  } catch {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (REMOTE_SUPPORT_MESSAGE_TYPES.has(message.type)) {
    handleRemoteSupportBackgroundMessage(message, sender)
      .then((result) => {
        sendResponse(result || { ok: false, error: "Remote support request failed" });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Remote support request failed" });
      });
    return true;
  }

  if (PROPERTY_LOCK_MESSAGE_TYPES.has(message.type)) {
    handlePropertyLockBackgroundMessage(message, sender)
      .then((result) => {
        sendResponse(result || { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "resolvePopupTabContext") {
    resolvePopupTabContext(message, sender)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, tab: null, source: "error" }));
    return true;
  }

  if (message.type === "clearBrowsingDataForOrigin") {
    clearBrowsingDataForOrigin(message.origin)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to clear cache" }));
    return true;
  }

  if (message.type === "reloadTab") {
    reloadTab(message.tabId || (sender.tab && sender.tab.id))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to reload tab" }));
    return true;
  }

  if (message.type === "navigateTabToUrl") {
    navigateTabToUrl(message.tabId || (sender.tab && sender.tab.id), message.url)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to navigate tab" }));
    return true;
  }

  if (message.type === "getPersistedAiRunRecord") {
    getPersistedAiRunRecord()
      .then((record) => sendResponse({ ok: true, record }))
      .catch(() => sendResponse({ ok: false, record: null }));
    return true;
  }

  if (message.type === "savePersistedAiRunRecord") {
    savePersistedAiRunRecord(message.record)
      .then((record) => sendResponse({ ok: true, record }))
      .catch(() => sendResponse({ ok: false, record: null }));
    return true;
  }

  if (message.type === "clearPersistedAiRunRecord") {
    clearPersistedAiRunRecord()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "setAiComputeLockForTab") {
    setAiComputeLockForTab(
      message.tabId || (sender.tab && sender.tab.id),
      message.active,
      message.expiresAt
    )
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "AI compute lock failed" }));
    return true;
  }

  if (message.type === "refreshAiRunHeartbeat") {
    refreshAiRunHeartbeat({
      tabId: message.tabId || (sender.tab && sender.tab.id),
      sessionId: message.sessionId,
      siteId: message.siteId,
      deadlineAt: message.deadlineAt
    })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, record: null, expiresAt: 0, lockApplied: false }));
    return true;
  }

  if (message.type === "requestAiRunStatus") {
    requestAiRunStatus({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      sessionId: message.sessionId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "removeRemotePageMarking") {
    removeRemotePageMarking({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      siteId: message.siteId,
      url: message.url
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "validateAuthToken") {
    validateAuthToken({
      stageBase: message.stageBase,
      tokenValue: message.tokenValue
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAuthLogin") {
    requestAuthLogin({
      stageBase: message.stageBase,
      email: message.email,
      password: message.password
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "submitSelectorSetGraphqlUpdate") {
    submitSelectorSetGraphqlUpdate({
      stageBase: message.stageBase,
      tokenValue: message.tokenValue,
      siteId: message.siteId,
      includeCss: message.includeCss,
      excludeCss: message.excludeCss,
      renderMode: message.renderMode
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "loadRemoteConfigSnapshot") {
    loadRemoteConfigSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      siteId: message.siteId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "saveRemoteConfigSnapshot") {
    saveRemoteConfigSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestRenderModeDetection") {
    requestRenderModeDetection({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "submitPageTypeAssignments") {
    submitPageTypeAssignments({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAiRunStartSnapshot") {
    requestAiRunStartSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAiRunResultSnapshot") {
    requestAiRunResultSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      sessionId: message.sessionId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "prepareAiRunPayloadSnapshot") {
    prepareAiRunPayloadSnapshot({
      baseUrl: message.baseUrl,
      currentPageUrl: message.currentPageUrl,
      currentRenderMode: message.currentRenderMode
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT) {
    const tabId = getMessageTabId(message, sender);
    const state = updateLifecycleState(tabId, message.event || {});
    sendResponse(state);
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE) {
    const tabId = getMessageTabId(message, sender);
    appendWorldTraceEvent(tabId, "broker", "snapshot-requested", {
      type: WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE,
      message: "Popup requested background state"
    });
    sendResponse(buildBrokerState(tabId));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_SET) {
    sendResponse(setBackgroundSpinnerEntry(
      getMessageTabId(message, sender),
      message.key,
      {
        message: message.message,
        persistent: message.persistent,
        owner: message.owner
      }
    ));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_REMOVE) {
    sendResponse(removeBackgroundSpinnerEntry(getMessageTabId(message, sender), message.key));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_CLEAR) {
    sendResponse(clearBackgroundSpinnerQueue(getMessageTabId(message, sender), {
      transientOnly: Boolean(message.transientOnly)
    }));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.TRACE_SET) {
    const tabId = getMessageTabId(message, sender);
    appendWorldTraceEvent(tabId, "trace", "set-requested", {
      type: WORLD_MESSAGE_TYPES.TRACE_SET,
      message: Boolean(message.enabled) ? "enable" : "disable"
    });
    sendResponse(setWorldTraceEnabled(tabId, Boolean(message.enabled)));
    return;
  }

  if (message.type === "getTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ enabled: false, baseUrl: "" });
      return;
    }
    const scope = typeof message.scope === "string" && message.scope ? message.scope : null;
    utils.getTabState(tabId, scope)
      .then((state) => {
        if (!state && message.nullIfMissing) {
          sendResponse(null);
          return;
        }
        sendResponse(state ? { ...state, tabId } : { enabled: false, baseUrl: "", tabId });
      })
      .catch(() => {
        sendResponse({ enabled: false, baseUrl: "", tabId });
      });
    return true;
  }

  if (message.type === "setTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    const scope = typeof message.scope === "string" && message.scope ? message.scope : null;
    utils.getTabState(tabId, scope)
      .then((existingState) => {
        const existing = existingState && typeof existingState === "object"
          ? existingState
          : {};
        let nextState;
        if (message.state && typeof message.state === "object") {
          nextState = { ...existing };
          if (Object.prototype.hasOwnProperty.call(message.state, "active")) {
            nextState.active = Boolean(message.state.active);
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "enabled")) {
            nextState.enabled = Boolean(message.state.enabled);
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "baseUrl")) {
            nextState.baseUrl = typeof message.state.baseUrl === "string" ? message.state.baseUrl : "";
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "pageType")) {
            nextState.pageType = typeof message.state.pageType === "string" ? message.state.pageType : "";
          }
        } else {
          nextState = {
            ...existing,
            enabled: Boolean(message.enabled),
            baseUrl: message.baseUrl || ""
          };
          if (Object.prototype.hasOwnProperty.call(message, "pageType")) {
            nextState.pageType = typeof message.pageType === "string" ? message.pageType : "";
          }
        }
        return utils.setTabState(tabId, nextState, scope)
          .then(() => {
            if (scope) {
              return;
            }
            if (nextState.enabled && nextState.baseUrl) {
              return setReloadRestoreTabState(tabId, nextState);
            }
            return clearReloadRestoreTabState(tabId);
          });
      })
      .then(() => {
        utils.updateActionForTab(tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    const mode = message.mode === "mobile" ? "mobile" : "desktop";
    updateDeviceEmulation(tabId, {
      enabled: true,
      mode
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "updateDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    updateDeviceEmulation(tabId, {
      enabled: typeof message.enabled === "boolean" ? message.enabled : undefined,
      mode: message.mode,
      scale: message.scale,
      recalculateScale: Boolean(message.recalculateScale)
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "getDeviceEmulationState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    reconcileDeviceEmulationState(tabId)
      .then((deviceState) => {
        sendResponse({ ok: true, state: deviceState });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation state unavailable" });
      });
    return true;
  }

  if (message.type === "clearTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    utils.clearTabState(message.tabId)
      .then(() => clearReloadRestoreTabState(message.tabId))
      .then(() => {
        utils.updateActionForTab(message.tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "unregisterTabAndReload") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    (async () => {
      const tabKey = `${TAB_STATE_PREFIX}${tabId}`;
      const initialKey = `${TAB_STATE_PREFIX}initial:${tabId}`;
      const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;

      try {
        await utils.disableExtensionForTab(tabId);
      } catch (error) {
        // Continue with hard state cleanup below.
      }
      await clearReloadRestoreTabState(tabId);
      await utils.storageRemove(chrome.storage.session, [
        tabKey,
        initialKey,
        scriptKey
      ]);
      await utils.updateActionForTab(tabId);
      try {
        await chrome.sidePanel.setOptions({
          tabId,
          path: "popup.html",
          enabled: false
        });
      } catch (error) {
        // Side panel may already be disabled for this tab.
      }
      await new Promise((resolve, reject) => {
        chrome.tabs.reload(tabId, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Unable to reload tab"));
            return;
          }
          resolve();
        });
      });
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: (error && error.message) || "Unable to unregister current tab"
      });
    });
    return true;
  }

  if (message.type === "injectContentScript") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    utils.injectContentScript(message.tabId)
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Script injection failed" });
      });
    return true;
  }

  if (message.type === "isScriptInjected") {
    if (!message.tabId) {
      sendResponse({ injected: false });
      return;
    }
    utils.isScriptInjected(message.tabId)
      .then((injected) => {
        sendResponse({ injected });
      })
      .catch(() => {
        sendResponse({ injected: false });
      });
    return true;
  }

  if (message.type === "idbGet") {
    utils.idbGet(message.keys)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB get failed" });
      });
    return true;
  }

  if (message.type === "idbSet") {
    utils.idbSet(message.items)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB set failed" });
      });
    return true;
  }

  if (message.type === "idbRemove") {
    utils.idbRemove(message.keys)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB remove failed" });
      });
    return true;
  }

  if (message.type === "resolveLivePageSiteId") {
    resolveLivePageSiteId({
      stageBase: message.stageBase,
      pageUrl: message.pageUrl,
      tokenValue: message.tokenValue
    })
      .then((result) => {
        sendResponse(result || { ok: false, siteId: null });
      })
      .catch(() => {
        sendResponse({ ok: false, siteId: null });
      });
    return true;
  }

  if (message.type === "fetchLivePagePropertyPageTypes") {
    fetchLivePagePropertyPageTypes({
      siteId: message.siteId,
      stageBase: message.stageBase,
      tokenValue: message.tokenValue
    })
      .then((result) => {
        sendResponse(result || {
          ok: false,
          pageTypes: [],
          reason: "Unable to verify Live Page candidates."
        });
      })
      .catch(() => {
        sendResponse({
          ok: false,
          pageTypes: [],
          reason: "Unable to verify Live Page candidates."
        });
      });
    return true;
  }

  if (message.type === "fetchStaticPageHtml") {
    const targetUrl = typeof message.url === "string" ? message.url.trim() : "";
    let parsedUrl = null;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (error) {
      sendResponse({ ok: false, error: "Invalid URL" });
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      sendResponse({ ok: false, error: "Unsupported URL" });
      return;
    }
    (async () => {
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          cache: "no-store"
        });
        if (!response.ok) {
          sendResponse({
            ok: false,
            status: response.status || 0,
            error: "Static HTML request failed"
          });
          return;
        }
        const html = await response.text();
        sendResponse({
          ok: true,
          status: response.status || 200,
          url: response.url || parsedUrl.toString(),
          html
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: (error && error.message) || "Static HTML request failed"
        });
      }
    })();
    return true;
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const initialKey = `${TAB_STATE_PREFIX}initial:${tabId}`;
  const restoreKey = getReloadRestoreTabStateKey(tabId);
  const deviceKey = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  utils.storageRemove(chrome.storage.session, [key, initialKey, restoreKey, deviceKey, scriptKey]).then();
  handleRemoteSupportTabRemoved(tabId).then();
  tabLifecycleStateByTabId.delete(tabId);
  tabSpinnerQueueByTabId.delete(tabId);
  tabWorldTraceStateByTabId.delete(tabId);
});

async function disableExtensionOnTopLevelNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  const state = await utils.getTabState(tabId);
  if (!state || !state.enabled) {
    return;
  }
  await setReloadRestoreTabState(tabId, state);
  const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  await utils.storageRemove(chrome.storage.session, [scriptKey]);
  await utils.updateActionForTab(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "setEnabled", enabled: false });
  } catch (error) {
    // Content script may not be loaded during navigation.
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(disableExtensionOnTopLevelNavigation);

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  try {
    await clearDeviceEmulationAfterNavigation(tabId);
  } catch (error) {
    // Ignore — the tab may have already navigated away or been closed.
  }
});
chrome.webNavigation.onHistoryStateUpdated.addListener(disableExtensionOnTopLevelNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(disableExtensionOnTopLevelNavigation);

chrome.debugger.onDetach.addListener(async (source) => {
  if (!source || !source.tabId) {
    return;
  }
  const state = await getDeviceEmulationState(source.tabId);
  if (!state.enabled) {
    return;
  }
  await chrome.storage.session.set({
    [`${DEVICE_EMULATION_PREFIX}${source.tabId}`]: { ...state, enabled: false }
  });
});

async function refreshActionIconsForWindow(windowId) {
  if (!windowId || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch (error) {
    tabs = [];
  }
  await Promise.all(
    tabs
      .map((tab) => (tab && tab.id ? utils.updateActionForTab(tab.id) : null))
      .filter(Boolean)
  );
}

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  await refreshActionIconsForWindow(windowId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await refreshActionIconsForWindow(windowId);
});

const TAB_RESTORE_SCOPE = "restore";

function getReloadRestoreTabStateKey(tabId) {
  return `${TAB_STATE_PREFIX}${TAB_RESTORE_SCOPE}:${tabId}`;
}

async function getReloadRestoreTabState(tabId) {
  const state = await utils.getTabState(tabId, TAB_RESTORE_SCOPE);
  if (!state || !state.enabled || !state.baseUrl) {
    return null;
  }
  return state;
}

async function clearReloadRestoreTabState(tabId) {
  if (!tabId) {
    return;
  }
  await utils.storageRemove(chrome.storage.session, [getReloadRestoreTabStateKey(tabId)]);
}

async function setReloadRestoreTabState(tabId, state) {
  if (!tabId) {
    return;
  }
  if (!state || !state.enabled || !state.baseUrl) {
    await clearReloadRestoreTabState(tabId);
    return;
  }
  await utils.setTabState(tabId, {
    enabled: true,
    baseUrl: state.baseUrl,
    pageType: typeof state.pageType === "string" ? state.pageType : ""
  }, TAB_RESTORE_SCOPE);
}

async function clearReloadRestoreTabStateAfterActivation(tabId, tabState) {
  if (!tabId || !tabState || !tabState.enabled || !tabState.baseUrl) {
    return;
  }
  const restoreState = await getReloadRestoreTabState(tabId);
  if (!restoreState || restoreState.baseUrl !== tabState.baseUrl) {
    return;
  }
  const tabUrl = await getTabUrl(tabId);
  if (tabUrl && !utils.isPageWithinBaseUrl(tabUrl, tabState.baseUrl)) {
    return;
  }
  await clearReloadRestoreTabState(tabId);
}

function requestContentActivation(tabId, attempt = 0) {
  if (!tabId) {
    return;
  }
  chrome.tabs.sendMessage(tabId, { type: "activateContentMain" }, () => {
    if (chrome.runtime.lastError && attempt < 3) {
      setTimeout(() => requestContentActivation(tabId, attempt + 1), 200);
      return;
    }
    void chrome.runtime.lastError;
  });
}

function restoreEnabledStateForTab(tabId, tabState, attempt = 0) {
  if (!tabId || !tabState || !tabState.enabled || !tabState.baseUrl) {
    return;
  }
  const operationId = `activation:${tabId}:${Date.now()}:${attempt}`;
  updateLifecycleState(tabId, {
    operationId,
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "Inspecting page..."
  });
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "setEnabled",
      enabled: true,
      baseUrl: tabState.baseUrl,
      pageType: typeof tabState.pageType === "string" ? tabState.pageType : "",
      performInitialReveal: true,
      operationId
    },
    (response) => {
      if (chrome.runtime.lastError || !response || response.ok === false) {
        if (attempt < 4 && !(response && response.locked)) {
          setTimeout(() => restoreEnabledStateForTab(tabId, tabState, attempt + 1), 200);
        } else {
          updateLifecycleState(tabId, {
            operationId,
            kind: LIFECYCLE_KINDS.ACTIVATION,
            phase: LIFECYCLE_PHASES.FAILED,
            busy: false,
            message: ""
          });
        }
        return;
      }
      void chrome.runtime.lastError;
      clearReloadRestoreTabStateAfterActivation(tabId, tabState).catch(() => {});
    }
  );
}

async function getTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && typeof tab.url === "string") ? tab.url : "";
  } catch (error) {
    return "";
  }
}

async function ensureDefaultMobileEmulationForTab(tabId, tabUrl = "") {
  if (!tabId) {
    return null;
  }
  const resolvedUrl = typeof tabUrl === "string" && tabUrl
    ? tabUrl
    : await getTabUrl(tabId);
  if (!utils.getOriginFromUrl(resolvedUrl)) {
    return null;
  }
  try {
    const result = await ensureDefaultMobileDeviceEmulation(tabId);
    if (!result || !result.ok) {
      if (result && result.error) {
        console.warn("Default mobile emulation failed:", result.error);
      }
      return null;
    }
    return result.state;
  } catch (error) {
    console.warn("Default mobile emulation failed:", error);
    return null;
  }
}

async function activateExtensionForTab(tabId, tabUrl = "") {
  if (!tabId) {
    return { ok: false };
  }
  await utils.setTabState(tabId, { active: true }, "initial");
  await utils.updateActionForTab(tabId);
  await ensureDefaultMobileEmulationForTab(tabId, tabUrl);
  requestContentActivation(tabId);
  return { ok: true };
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tabId || !tab) {
    return;
  }
  if (changeInfo.status !== "complete") {
    return;
  }
  if (!((await utils.getTabState(tabId, 'initial')) || {active: false}).active)
  {
    return;
  }
  const tabState = (await utils.getTabState(tabId)) || (await getReloadRestoreTabState(tabId));
  if (
    tabState &&
    tabState.enabled &&
    tabState.baseUrl &&
    !utils.isPageWithinBaseUrl(tab.url || "", tabState.baseUrl)
  ) {
    await clearReloadRestoreTabState(tabId);
    await utils.disableExtensionForTab(tabId);
    return;
  }
  if (tabState && tabState.enabled && tabState.baseUrl) {
    await utils.setTabState(tabId, tabState);
  }
  requestContentActivation(tabId);
  restoreEnabledStateForTab(tabId, tabState);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  Object.keys(changes).forEach((key) => {
    if (!key.startsWith(TAB_STATE_PREFIX)) {
      return;
    }
    const tabId = Number(key.slice(TAB_STATE_PREFIX.length));
    if (!Number.isNaN(tabId)) {
      utils.updateActionForTab(tabId).then();
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "popup.html",
      enabled: true
    }).then();
    chrome.sidePanel.open({ tabId: tab.id }).then();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "activateContentForTab") {
    return;
  }
  const tabId = message.tabId || (sender.tab && sender.tab.id);
  if (!tabId) {
    sendResponse({ ok: false });
    return;
  }
  (async () => {
    await activateExtensionForTab(
      tabId,
      (sender.tab && sender.tab.url) || message.url || ""
    );
    sendResponse({ ok: true });
  })().catch(() => {
    requestContentActivation(tabId);
    sendResponse({ ok: true });
  });
  return true;
});
