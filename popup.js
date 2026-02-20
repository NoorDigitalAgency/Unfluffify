import * as chromeHelpers from "./popup/chrome-helpers.js";
import * as config from "./common/config.js";
import * as constants from "./common/constants.js";
import * as emulation from "./popup/emulation.js";
import * as uiModule from "./popup/ui.js";
import * as utils from "./common/utilities.js";
import * as messages from "./popup/messages.js";
import * as helpers from "./popup/helpers.js";
import * as stateModule from "./popup/state.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set.js";
import {
  normalizeSilentHighlightOptions
} from "./common/silent-highlight-options.js";

const { state } = stateModule;
const TOKEN_VALIDATION_INTERVAL_MS = 600 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_SIMULATION_REQUIRED_MESSAGE =
  "Mobile simulation must be enabled, for this to work.";
const URL_SEARCH_INFO_QUERY = `
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
`;
function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

function isMobileSimulationActive(deviceState) {
  if (!deviceState || typeof deviceState !== "object") {
    return false;
  }
  return Boolean(deviceState.enabled) && deviceState.mode === "mobile";
}

function ensureMobileSimulationForActions() {
  if (isMobileSimulationActive({
    enabled: state.currentDeviceEmulationEnabled,
    mode: state.currentDeviceMode
  })) {
    return true;
  }
  uiModule.showToast(MOBILE_SIMULATION_REQUIRED_MESSAGE);
  return false;
}

async function ensureMobileSimulationForSidebar(tabId) {
  if (!tabId) {
    return emulation.syncDeviceEmulationState({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
  }
  const storedDeviceState = await emulation.getDeviceEmulationState(tabId);
  let normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  if (isMobileSimulationActive(normalizedDeviceState)) {
    return normalizedDeviceState;
  }
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId,
    enabled: true,
    mode: "mobile",
    scale: normalizedDeviceState.scale
  });
  if (response && response.ok && response.state) {
    normalizedDeviceState = emulation.syncDeviceEmulationState(response.state);
  }
  return normalizedDeviceState;
}

function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function normalizeStageBase(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  let hostname = "";
  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    hostname = (url.hostname || "").trim().toLowerCase();
  } catch (error) {
    return "";
  }
  const normalized = hostname.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!normalized) {
    return "";
  }
  const domainPattern =
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  if (!domainPattern.test(normalized)) {
    return "";
  }
  return normalized;
}

function buildLoginEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

function buildValidateEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
}

function buildGraphqlEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://api.${normalized}/graphql`;
}

function normalizeSiteIdValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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
  } catch (error) {
    // Use HTTPS default.
  }
  let parsed = null;
  try {
    parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(`${protocol}//${raw.replace(/^\/+/, "")}`);
  } catch (error) {
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
  return `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
}

async function resolveSiteIdFromGraphql(options = {}) {
  const {
    stageBase = "",
    lookupUrl = "",
    tokenValue = ""
  } = options;
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !lookupUrl) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
  const headers = { "Content-Type": "application/json" };
  if (tokenValue) {
    headers.Authorization = `Bearer ${tokenValue}`;
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: URL_SEARCH_INFO_QUERY,
        variables: {
          url: lookupUrl,
          includePageInfo: false
        }
      })
    });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    const hasPayload = Boolean(data && typeof data === "object");
    if (hasPayload && Array.isArray(data.errors) && data.errors.length > 0) {
      const notFound = data.errors.some((item) => {
        const code =
          item &&
          item.extensions &&
          typeof item.extensions.code === "string"
            ? item.extensions.code
            : "";
        return code === "NotFound";
      });
      if (notFound) {
        return {
          ok: true,
          siteId: null,
          baseUrl: "",
          notFound: true
        };
      }
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!response.ok) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!hasPayload) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const candidate = normalizeSiteIdValue(
      data &&
        data.data &&
        data.data.urlSearchInfo &&
        data.data.urlSearchInfo.domainId
    );
    const baseUrl = normalizeBaseUrlFromDomainName(
      data &&
        data.data &&
        data.data.urlSearchInfo &&
        data.data.urlSearchInfo.domainName,
      lookupUrl
    );
    if (!candidate) {
      return {
        ok: true,
        siteId: null,
        baseUrl,
        notFound: true
      };
    }
    if (!baseUrl) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    return {
      ok: true,
      siteId: candidate,
      baseUrl,
      notFound: false
    };
  } catch (error) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

async function ensureBaseUrlSiteId(options = {}) {
  const {
    baseUrl = "",
    stageBase = "",
    tokenValue = "",
    configs = null
  } = options;
  if (!baseUrl) {
    return { ok: false, siteId: null, reason: "No mapped base page URL/siteId for this page" };
  }
  const sourceConfigs = configs || await config.getConfigs();
  const normalizedConfig = config.normalizeConfig(baseUrl, sourceConfigs[baseUrl]);
  if (!sourceConfigs[baseUrl] || normalizedConfig.changed) {
    sourceConfigs[baseUrl] = normalizedConfig.config;
    await config.saveConfigs(sourceConfigs);
  }
  const existingSiteId = normalizeSiteIdValue(sourceConfigs[baseUrl].siteId);
  if (existingSiteId) {
    state.siteIdLookupByBaseUrl.set(baseUrl, existingSiteId);
    return {
      ok: true,
      siteId: existingSiteId,
      configs: sourceConfigs,
      config: sourceConfigs[baseUrl]
    };
  }
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedStageBase) {
    return {
      ok: false,
      siteId: null,
      reason: "Set Stage Base before continuing",
      configs: sourceConfigs,
      config: sourceConfigs[baseUrl]
    };
  }
  if (state.siteIdLookupByBaseUrl.has(baseUrl)) {
    const cached = normalizeSiteIdValue(state.siteIdLookupByBaseUrl.get(baseUrl));
    if (cached) {
      sourceConfigs[baseUrl] = await config.updateConfig(baseUrl, (target) => {
        target.siteId = cached;
      });
      return {
        ok: true,
        siteId: cached,
        configs: sourceConfigs,
        config: sourceConfigs[baseUrl]
      };
    }
    return {
      ok: false,
      siteId: null,
      reason: "No domainId available for this base URL",
      configs: sourceConfigs,
      config: sourceConfigs[baseUrl]
    };
  }
  const lookupResult = await resolveSiteIdFromGraphql({
    stageBase: normalizedStageBase,
    lookupUrl: baseUrl,
    tokenValue
  });
  if (!lookupResult.ok) {
    return {
      ok: false,
      siteId: null,
      reason: "Unable to resolve domainId right now",
      configs: sourceConfigs,
      config: sourceConfigs[baseUrl]
    };
  }
  const resolvedSiteId = normalizeSiteIdValue(lookupResult.siteId);
  if (!resolvedSiteId) {
    state.siteIdLookupByBaseUrl.set(baseUrl, null);
    return {
      ok: false,
      siteId: null,
      reason: "No domainId exists for this base URL",
      configs: sourceConfigs,
      config: sourceConfigs[baseUrl]
    };
  }
  state.siteIdLookupByBaseUrl.set(baseUrl, resolvedSiteId);
  sourceConfigs[baseUrl] = await config.updateConfig(baseUrl, (target) => {
    target.siteId = resolvedSiteId;
  });
  return {
    ok: true,
    siteId: resolvedSiteId,
    configs: sourceConfigs,
    config: sourceConfigs[baseUrl]
  };
}

function createConfigSyncHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function formatSyncStatusTimestamp(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch (error) {
    return "";
  }
}

function updateLastConfigLoadStatus(result) {
  const status = result && typeof result.status === "string" ? result.status : "";
  const baseUrl = result && typeof result.baseUrl === "string" ? result.baseUrl : "";
  let label = "Unknown";
  if (status === "ok") {
    label = baseUrl ? `Synced (${baseUrl})` : "Synced";
  } else if (status === "not_found") {
    label = "No remote data (404)";
  } else if (status === "skipped") {
    label = "Skipped";
  } else if (status === "error") {
    label = "Failed";
  }
  if (status === "skipped") {
    state.lastConfigLoadStatusText = label;
    return;
  }
  const at = formatSyncStatusTimestamp();
  state.lastConfigLoadStatusText = at ? `${label} at ${at}` : label;
}

function updateLastConfigSaveStatus(label) {
  const safeLabel = typeof label === "string" && label ? label : "Unknown";
  const at = formatSyncStatusTimestamp();
  state.lastConfigSaveStatusText = at ? `${safeLabel} at ${at}` : safeLabel;
}

function isSuccessfulConfigSyncResult(syncResult) {
  return Boolean(syncResult && (syncResult.ok || syncResult.skipped));
}

function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function buildRemoteConfigLoadKey(tabId, siteId, endpointValue) {
  return `${tabId || ""}|${siteId || ""}|${endpointValue || ""}`;
}

async function mergeServerConfigIntoLocal(payload, currentPageUrl) {
  const normalizedPayload = config.normalizeConfigSyncPayload(payload, "");
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }
  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = await config.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = config.normalizeConfig(baseUrl, existingRaw);
  const localConfig = normalizedLocal.config;
  const incomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const siteIdChanged =
    Boolean(incomingSiteId) && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId;
  if (incomingSiteId && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId) {
    localConfig.siteId = incomingSiteId;
  }
  const mergeResult = config.mergePageMarkingsByTimestamp(
    localConfig.pageMarkings,
    normalizedPayload.pageMarkings
  );
  localConfig.pageMarkings = mergeResult.pageMarkings;
  const shouldSave =
    !existingRaw ||
    normalizedLocal.changed ||
    siteIdChanged ||
    mergeResult.replacedUrls.length > 0;
  if (shouldSave) {
    allConfigs[baseUrl] = localConfig;
    await config.saveConfigs(allConfigs);
  }
  return {
    ok: true,
    changed: shouldSave,
    replacedCurrentPage: mergeResult.replacedExistingUrls.includes(currentPageUrl),
    baseUrl
  };
}

async function loadRemoteConfigForCurrentPage(options = {}) {
  const {
    tabId = null,
    pageUrl = "",
    siteId = null,
    endpointValue = "",
    tokenValue = "",
    force = false
  } = options;
  if (!tabId || !siteId || !endpointValue) {
    const result = { status: "skipped", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
  const loadKey = buildRemoteConfigLoadKey(tabId, siteId, endpointValue);
  if (
    !force &&
    state.remoteConfigLoadKey === loadKey &&
    state.remoteConfigLoadResult &&
    (
      state.remoteConfigLoadResult.status === "ok" ||
      state.remoteConfigLoadResult.status === "not_found"
    )
  ) {
    return state.remoteConfigLoadResult;
  }
  state.remoteConfigLoadKey = loadKey;
  const loadUrl = resolveRelativeEndpoint(endpointValue, "/load");
  if (!loadUrl) {
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
  try {
    const response = await fetch(loadUrl, {
      method: "POST",
      headers: createConfigSyncHeaders(tokenValue),
      body: JSON.stringify({ siteId })
    });
    if (response.status === 404) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (!response.ok) {
      const result = { status: "error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    const payload = await response.json();
    const mergeResult = await mergeServerConfigIntoLocal(payload, pageUrl);
    if (!mergeResult.ok) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (mergeResult.changed && mergeResult.baseUrl) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: mergeResult.baseUrl,
        forceReloadPageEntry: mergeResult.replacedCurrentPage
      }, 2);
    }
    if (mergeResult.replacedCurrentPage) {
      window.alert("Newer data for this page was found and replaced your local changes.");
    }
    const result = {
      status: "ok",
      baseUrl: mergeResult.baseUrl
    };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  } catch {
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
}

async function syncBaseConfigToServer(options = {}) {
  const {
    baseUrl = "",
    pageUrl = "",
    endpointValue = "",
    tokenValue = "",
    stageBase = "",
    alertOnCurrentReplacement = true,
    maxAttempts = 5
  } = options;
  if (!baseUrl || !pageUrl || !endpointValue) {
    return { ok: false, skipped: true };
  }
  const saveUrl = resolveRelativeEndpoint(endpointValue, "/save");
  if (!saveUrl) {
    return { ok: false, skipped: true };
  }
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let retryDelayMs = 1500;
  let lastStatus = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const allConfigs = await config.getConfigs();
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl,
      stageBase,
      tokenValue,
      configs: allConfigs
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      return { ok: false, skipped: true, reason: siteIdResult.reason || "Missing siteId" };
    }
    const normalized = config.normalizeConfig(baseUrl, allConfigs[baseUrl]);
    const sourceConfig = normalized.config;
    if (!allConfigs[baseUrl] || normalized.changed) {
      allConfigs[baseUrl] = sourceConfig;
      await config.saveConfigs(allConfigs);
    }
    const payload = config.createConfigSyncPayload(baseUrl, sourceConfig);
    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: createConfigSyncHeaders(tokenValue),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        lastStatus = response.status || 0;
        if (attempt + 1 < attempts) {
          await waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false, status: lastStatus };
      }

      let responseData = null;
      try {
        responseData = await response.json();
      } catch (error) {
        responseData = null;
      }
      if (!responseData || typeof responseData !== "object") {
        return { ok: true, replacedCurrentPage: false };
      }

      const mergeResult = await mergeServerConfigIntoLocal(responseData, pageUrl);
      if (!mergeResult.ok) {
        if (attempt + 1 < attempts) {
          await waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false };
      }
      if (mergeResult.changed && mergeResult.baseUrl) {
        await messages.sendTabMessageWithRetry({
          type: "configUpdated",
          baseUrl: mergeResult.baseUrl,
          forceReloadPageEntry: mergeResult.replacedCurrentPage
        }, 2);
      }
      if (mergeResult.replacedCurrentPage && alertOnCurrentReplacement) {
        window.alert("Newer data for this page was found and replaced your local changes.");
      }
      return {
        ok: true,
        replacedCurrentPage: mergeResult.replacedCurrentPage
      };
    } catch (error) {
      if (attempt + 1 < attempts) {
        await waitForRetryDelay(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 10000);
        continue;
      }
      return { ok: false };
    }
  }
  return { ok: false, status: lastStatus };
}

function updateLoginActionState(patch = {}) {
  const view = { ...uiModule.getViewState(), ...patch };
  const emailValue = (view.loginEmailValue || "").trim();
  const passwordValue = view.loginPasswordValue || "";
  const aiBusy = Boolean(view.aiControlsBusy || view.isBusy);
  const loginCredentialsEnabled =
    view.stageBaseReadOnly && Boolean(normalizeStageBase(view.stageBaseValue || ""));

  uiModule.setViewState({
    ...patch,
    loginActionDisabled:
      aiBusy ||
      !loginCredentialsEnabled ||
      !isValidEmail(emailValue) ||
      !passwordValue.trim()
  });
}

async function invalidateTokenAndLockConfiguration(showToast = true) {
  await utils.storageSet(chrome.storage.sync, { globalToken: "" });
  state.currentView = uiModule.View.Configuration;
  state.configViewLocked = true;
  uiModule.setViewState({
    currentView: state.currentView,
    loginStatusText: "Login required"
  });
  if (showToast) {
    uiModule.showToast("Login expired. Please log in again.");
  }
}

async function validateStoredToken(options = {}) {
  const { force = false, showToastOnInvalid = true } = options;
  if (state.tokenValidationInFlight) {
    return true;
  }
  const { tokenValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  const validateUrl = buildValidateEndpointFromStageBase(stageBaseValue);
  if (!tokenValue || !validateUrl) {
    return Boolean(tokenValue);
  }
  const now = Date.now();
  if (!force && now - state.lastTokenValidationAt < TOKEN_VALIDATION_INTERVAL_MS) {
    return true;
  }
  state.lastTokenValidationAt = now;
  state.tokenValidationInFlight = true;
  try {
    const response = await fetch(validateUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenValue}` }
    });
    if (response.status === 401 || response.status === 403) {
      await invalidateTokenAndLockConfiguration(showToastOnInvalid);
      return false;
    }
    return true;
  } catch (error) {
    return true;
  } finally {
    state.tokenValidationInFlight = false;
  }
}

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function getEditableFieldState(options) {
  const {
    inputRef,
    currentValue,
    value,
    isSet,
    editMode,
    suggestedValue,
    noticeUnset,
    noticeEdit
  } = options;
  const isEditing = !isSet || editMode;
  const isFocused = inputRef && document.activeElement === inputRef;
  let nextValue = typeof currentValue === "string" ? currentValue : "";

  if (!isEditing) {
    nextValue = value || "";
  } else if (!isFocused) {
    nextValue = isSet ? value || "" : suggestedValue || "";
  }

  let noticeText = "";
  let noticeVisible = false;
  if (!isSet) {
    noticeText = noticeUnset;
    noticeVisible = true;
  } else if (editMode) {
    noticeText = noticeEdit;
    noticeVisible = true;
  }

  return { isEditing, isReady: isSet && !editMode, value: nextValue, noticeText, noticeVisible };
}

function getLatestComputedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.latestComputedSelectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.lastSavedSelectors);
}

function getXPathDepth(xpath) {
  if (typeof xpath !== "string" || !xpath) {
    return 0;
  }
  return xpath.split("/").filter(Boolean).length;
}

function getNearestAncestorStatus(xpath, statusByXpath) {
  if (!xpath || !statusByXpath || statusByXpath.size === 0) {
    return null;
  }
  const parts = xpath.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const ancestor = `/${parts.slice(0, i).join("/")}`;
    if (statusByXpath.has(ancestor)) {
      return statusByXpath.get(ancestor);
    }
  }
  return null;
}

function normalizePayloadXpaths(items, options = {}) {
  const preserveExcludedXpaths =
    options && options.preserveExcludedXpaths instanceof Set
      ? options.preserveExcludedXpaths
      : new Set();
  const rawItems = Array.isArray(items) ? items : [];
  const deduped = [];
  const seen = new Set();
  for (let i = rawItems.length - 1; i >= 0; i -= 1) {
    const item = rawItems[i];
    const xpath =
      item && typeof item.xpath === "string" ? item.xpath.trim() : "";
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    seen.add(xpath);
    deduped.unshift({ xpath, excluded: Boolean(item.excluded) });
  }

  const sorted = deduped
    .map((item, index) => ({ ...item, index, depth: getXPathDepth(item.xpath) }))
    .sort((left, right) => {
      const depthDiff = left.depth - right.depth;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return left.index - right.index;
    });

  const statusByXpath = new Map();
  const redundantXpaths = new Set();
  sorted.forEach((item) => {
    const nearestAncestorStatus = getNearestAncestorStatus(item.xpath, statusByXpath);
    if (item.excluded && preserveExcludedXpaths.has(item.xpath)) {
      statusByXpath.set(item.xpath, true);
      return;
    }
    // Keep all included descendants, but collapse excluded descendants under excluded ancestors.
    if (item.excluded && nearestAncestorStatus === true) {
      redundantXpaths.add(item.xpath);
      return;
    }
    statusByXpath.set(item.xpath, item.excluded);
  });

  return deduped.filter((item) => !redundantXpaths.has(item.xpath));
}

function isTagSelector(selector) {
  return /^[a-z]+$/i.test(selector);
}

function selectorMatchesElement(el, selector) {
  if (!el || el.nodeType !== 1 || !selector) {
    return false;
  }
  try {
    if (isTagSelector(selector)) {
      return el.tagName === selector.toUpperCase();
    }
    return el.matches(selector);
  } catch {
    return false;
  }
}

function matchesStaticImmutableExcluded(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  for (const selector of constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
    if (selectorMatchesElement(el, selector)) {
      return true;
    }
  }
  return false;
}

function matchesStaticToggleableExcluded(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  for (const selector of constants.DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS) {
    if (selectorMatchesElement(el, selector)) {
      return true;
    }
  }
  return false;
}

function isWithinStaticImmutableExcluded(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (matchesStaticImmutableExcluded(node)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function hasDirectStaticText(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  for (const node of Array.from(el.childNodes || [])) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      return true;
    }
  }
  return false;
}

function getNormalizedStaticTextContent(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  const chunks = [];
  const stack = [el];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) {
        chunks.push(text);
      }
      continue;
    }
    if (node.nodeType !== 1) {
      continue;
    }
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
      continue;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
      stack.push(node.childNodes[i]);
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function isStaticTextualContainer(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (hasDirectStaticText(el)) {
    return true;
  }
  if (matchesStaticToggleableExcluded(el)) {
    if (el.children.length > 0) {
      return true;
    }
    return Boolean((el.textContent || "").replace(/\s+/g, " ").trim());
  }
  return Boolean(getNormalizedStaticTextContent(el));
}

function hasStaticTextualDescendant(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (matchesStaticImmutableExcluded(node)) {
      continue;
    }
    if (isStaticTextualContainer(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function hasStaticTextualImmutableDescendant(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (matchesStaticImmutableExcluded(node) && isStaticTextualContainer(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function isStaticSelfMarkableWithoutParentMode(el) {
  if (!isStaticTextualContainer(el)) {
    return false;
  }
  const hasDirectOwnText = hasDirectStaticText(el);
  const hasTextualDescendant = hasStaticTextualDescendant(el);
  if (!hasDirectOwnText && hasTextualDescendant) {
    return false;
  }
  if (!matchesStaticToggleableExcluded(el)) {
    if (!hasDirectOwnText && !hasTextualDescendant) {
      return false;
    }
    if (!hasDirectOwnText && hasStaticTextualImmutableDescendant(el)) {
      return false;
    }
    return true;
  }
  return !hasTextualDescendant;
}

function parseInlineStyle(styleText) {
  const styles = new Map();
  if (typeof styleText !== "string" || !styleText) {
    return styles;
  }
  styleText.split(";").forEach((chunk) => {
    const [rawKey, ...rest] = chunk.split(":");
    if (!rawKey || rest.length === 0) {
      return;
    }
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").replace(/!important/gi, "").trim().toLowerCase();
    if (!key) {
      return;
    }
    styles.set(key, value);
  });
  return styles;
}

function parseStyleNumber(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function isHiddenByStyleMap(styles) {
  if (!styles || styles.size === 0) {
    return false;
  }
  const display = styles.get("display") || "";
  if (display.includes("none")) {
    return true;
  }
  const visibility = styles.get("visibility");
  if (visibility === "hidden" || visibility === "collapse") {
    return true;
  }
  const opacity = parseStyleNumber(styles.get("opacity") || "");
  if (opacity !== null && opacity <= 0) {
    return true;
  }
  const contentVisibility = styles.get("content-visibility") || "";
  if (contentVisibility.includes("hidden")) {
    return true;
  }
  const clip = (styles.get("clip") || "").replace(/\s+/g, "");
  if (clip && clip !== "auto" && clip.includes("rect(")) {
    const numbers = clip.match(/-?\d*\.?\d+/g);
    if (numbers && numbers.length >= 4 && numbers.every((value) => Number(value) === 0)) {
      return true;
    }
  }
  const clipPath = (styles.get("clip-path") || "").replace(/\s+/g, "");
  if (
    clipPath &&
    (clipPath.includes("inset(50%") ||
      clipPath.includes("inset(100%") ||
      clipPath.includes("circle(0") ||
      clipPath.includes("ellipse(0"))
  ) {
    return true;
  }
  const transform = (styles.get("transform") || "").replace(/\s+/g, "");
  if (transform && (transform.includes("scale(0") || transform.includes("scaleX(0") || transform.includes("scaleY(0"))) {
    return true;
  }
  const overflow = styles.get("overflow") || "";
  if (overflow.includes("hidden")) {
    const width = parseStyleNumber(styles.get("width") || "");
    const height = parseStyleNumber(styles.get("height") || "");
    const maxWidth = parseStyleNumber(styles.get("max-width") || "");
    const maxHeight = parseStyleNumber(styles.get("max-height") || "");
    if (
      (width !== null && width <= 1) ||
      (height !== null && height <= 1) ||
      (maxWidth !== null && maxWidth <= 1) ||
      (maxHeight !== null && maxHeight <= 1)
    ) {
      return true;
    }
  }
  return false;
}

function hasVisuallyHiddenClass(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const className = (node.getAttribute("class") || "").toLowerCase();
  if (!className) {
    return false;
  }
  return (
    className.includes("sr-only") ||
    className.includes("visually-hidden") ||
    className.includes("screen-reader")
  );
}

function isStaticHiddenNode(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (node.hasAttribute("hidden")) {
    return true;
  }
  if ((node.getAttribute("aria-hidden") || "").toLowerCase() === "true") {
    return true;
  }
  if (node.tagName === "INPUT" && (node.getAttribute("type") || "").toLowerCase() === "hidden") {
    return true;
  }
  if (hasVisuallyHiddenClass(node)) {
    return true;
  }
  return isHiddenByStyleMap(parseInlineStyle(node.getAttribute("style") || ""));
}

function isStaticNodeOrAncestorHidden(node) {
  let current = node;
  while (current && current.nodeType === 1) {
    if (isStaticHiddenNode(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function getStaticXPath(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  const parts = [];
  let node = el;
  const root = node.ownerDocument && node.ownerDocument.documentElement;
  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}[${index}]`);
    if (root && node === root) {
      break;
    }
    node = node.parentElement;
  }
  return `/${parts.join("/")}`;
}

function isXPathDescendant(parentXpath, childXpath) {
  if (!parentXpath || !childXpath || parentXpath === childXpath) {
    return false;
  }
  return childXpath.startsWith(`${parentXpath}/`);
}

function collectExplicitXPathSetsFromEntry(entry) {
  const explicitExcluded = new Set();
  const explicitIncluded = new Set();
  const consentExcluded = new Set();
  if (!entry || typeof entry !== "object") {
    return { explicitExcluded, explicitIncluded, consentExcluded };
  }
  const normalizeXPath = (value) =>
    typeof value === "string" ? value.trim() : "";
  const rows = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  rows.forEach((item) => {
    if (!item || typeof item.xpath !== "string") {
      return;
    }
    const xpath = normalizeXPath(item.xpath);
    if (!xpath) {
      return;
    }
    if (item.excluded) {
      explicitExcluded.add(xpath);
    } else {
      explicitIncluded.add(xpath);
    }
  });
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  includeXpaths.forEach((xpath) => {
    const normalized = normalizeXPath(xpath);
    if (normalized) {
      explicitIncluded.add(normalized);
    }
  });
  const consentXpaths = Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [];
  consentXpaths.forEach((xpath) => {
    const normalized = normalizeXPath(xpath);
    if (!normalized) {
      return;
    }
    consentExcluded.add(normalized);
    explicitExcluded.add(normalized);
  });
  return { explicitExcluded, explicitIncluded, consentExcluded };
}

function hasExplicitExcludedAncestor(xpath, explicitExcludedSet) {
  if (!xpath || !explicitExcludedSet || explicitExcludedSet.size === 0) {
    return false;
  }
  for (const excludedXpath of explicitExcludedSet) {
    if (
      excludedXpath &&
      excludedXpath !== xpath &&
      isXPathDescendant(excludedXpath, xpath)
    ) {
      return true;
    }
  }
  return false;
}

function collectAiSubmissionXpathsFromHtmlEntry(fullHTML, entry) {
  const { explicitExcluded, explicitIncluded, consentExcluded } =
    collectExplicitXPathSetsFromEntry(entry);
  const rowsByXpath = new Map();
  const upsert = (xpath, excluded) => {
    if (typeof xpath !== "string" || !xpath) {
      return;
    }
    const existing = rowsByXpath.get(xpath);
    if (existing) {
      if (excluded) {
        existing.excluded = true;
      }
      return;
    }
    rowsByXpath.set(xpath, { xpath, excluded: Boolean(excluded) });
  };
  explicitExcluded.forEach((xpath) => upsert(xpath, true));
  consentExcluded.forEach((xpath) => upsert(xpath, true));

  if (typeof fullHTML !== "string" || !fullHTML.trim()) {
    return normalizePayloadXpaths(Array.from(rowsByXpath.values()), {
      preserveExcludedXpaths: explicitExcluded
    });
  }
  let doc = null;
  try {
    doc = new DOMParser().parseFromString(fullHTML, "text/html");
  } catch {
    doc = null;
  }
  if (!doc || !doc.body) {
    return normalizePayloadXpaths(Array.from(rowsByXpath.values()), {
      preserveExcludedXpaths: explicitExcluded
    });
  }

  const stack = [doc.body];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) {
      continue;
    }
    for (let i = el.children.length - 1; i >= 0; i -= 1) {
      stack.push(el.children[i]);
    }
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NOSCRIPT") {
      continue;
    }
    if (isWithinStaticImmutableExcluded(el)) {
      continue;
    }
    const xpath = getStaticXPath(el);
    if (!xpath) {
      continue;
    }
    if (explicitExcluded.has(xpath)) {
      upsert(xpath, true);
      continue;
    }
    const explicitlyIncluded = explicitIncluded.has(xpath);
    if (hasExplicitExcludedAncestor(xpath, explicitExcluded) && !explicitlyIncluded) {
      continue;
    }
    if (!isStaticSelfMarkableWithoutParentMode(el)) {
      continue;
    }
    const hidden = isStaticNodeOrAncestorHidden(el);
    if (explicitlyIncluded) {
      upsert(xpath, hidden);
      continue;
    }
    upsert(xpath, hidden);
  }
  return normalizePayloadXpaths(Array.from(rowsByXpath.values()), {
    preserveExcludedXpaths: explicitExcluded
  });
}

function areXPathRowsEqual(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const aItem = a[i];
    const bItem = b[i];
    if (!aItem || !bItem) {
      return false;
    }
    if (aItem.xpath !== bItem.xpath || Boolean(aItem.excluded) !== Boolean(bItem.excluded)) {
      return false;
    }
  }
  return true;
}

function getSilentHighlightVisibility() {
  return {
    markedPages: state.silentHighlightShowMarkedPages !== false,
    includedContent: state.silentHighlightShowIncludedContent !== false,
    excludedContent: Boolean(state.silentHighlightShowExcludedContent),
    visibleConsent: Boolean(state.silentHighlightShowVisibleConsent),
    hideDuringScrollRedraw: Boolean(state.silentHighlightHideDuringScrollRedraw)
  };
}

function getSilentHighlightVisibilityKey(visibility) {
  return `${visibility.markedPages ? "1" : "0"}${visibility.includedContent ? "1" : "0"}${visibility.excludedContent ? "1" : "0"}${visibility.visibleConsent ? "1" : "0"}${visibility.hideDuringScrollRedraw ? "1" : "0"}`;
}

async function persistSilentHighlightVisibility() {
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const visibility = getSilentHighlightVisibility();
  await messages.sendRuntimeMessage({
    type: "setSilentHighlightOptions",
    tabId: state.currentTab.id,
    silentHighlightOptions: visibility
  });
}

async function applySilentHighlightVisibility(options = {}) {
  const { force = false } = options;
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const visibility = getSilentHighlightVisibility();
  const key = getSilentHighlightVisibilityKey(visibility);
  const tabId = state.currentTab.id;
  if (
    !force &&
    state.lastAppliedSilentHighlightTabId === tabId &&
    state.lastAppliedSilentHighlightKey === key
  ) {
    return;
  }
  const response = await messages.sendTabMessageWithRetry({
    type: "setSilentHighlightVisibility",
    ...visibility
  }, 2);
  let finalResponse = response;
  if ((!finalResponse || !finalResponse.ok) && tabId) {
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId });
    finalResponse = await messages.sendTabMessageWithRetry({
      type: "setSilentHighlightVisibility",
      ...visibility
    }, 3);
  }
  if (finalResponse && finalResponse.ok) {
    state.lastAppliedSilentHighlightTabId = tabId;
    state.lastAppliedSilentHighlightKey = key;
  }
}

function readCheckboxValue(event, fallbackValue) {
  const target = event && (event.currentTarget || event.target);
  if (!target || typeof target.checked !== "boolean") {
    return fallbackValue;
  }
  return Boolean(target.checked);
}

async function refreshUi() {
  if (!state.currentTab) {
    return;
  }
  await validateStoredToken({ force: false, showToastOnInvalid: true });
  const currentTabId = state.currentTab.id || null;
  const tabChanged = Boolean(currentTabId && state.lastTabId !== currentTabId);
  if (tabChanged) {
    state.baseUrlEditMode = false;
    state.stageBaseEditMode = false;
    state.endpointEditMode = false;
    state.configEndpointEditMode = false;
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
  }
  const pageUrl = state.currentTab.url || "";
  if (pageUrl !== state.lastPopupPageUrl) {
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
  }
  state.lastPopupPageUrl = pageUrl;
  if (state.lastAppliedSilentHighlightTabId !== currentTabId) {
    state.lastAppliedSilentHighlightTabId = currentTabId;
    state.lastAppliedSilentHighlightKey = "";
  }
  state.lastTabId = currentTabId;
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
  const tabState =
    (await utils.getTabState(state.currentTab.id)) || { enabled: false, baseUrl: "" };
  const initialTabState = currentTabId
    ? (await utils.getTabState(currentTabId, "initial")) || { active: false }
    : { active: false };
  const sidebarOpenedOnTab = Boolean(initialTabState && initialTabState.active);
  let localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  let hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
  let currentSiteId = null;
  let siteIdBlockedReason = "";
  let unsupportedByGraphql = false;
  let remoteLoadResult = { status: "skipped", baseUrl: "" };
  let effectiveTabState = tabState;
  if (tabState.baseUrl && pageUrl && !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl)) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
  }
  const silentHighlightOptions = normalizeSilentHighlightOptions(
    tabState && tabState.silentHighlightOptions
  );
  state.silentHighlightShowMarkedPages = silentHighlightOptions.markedPages;
  state.silentHighlightShowIncludedContent = silentHighlightOptions.includedContent;
  state.silentHighlightShowExcludedContent = silentHighlightOptions.excludedContent;
  state.silentHighlightShowVisibleConsent = silentHighlightOptions.visibleConsent;
  state.silentHighlightHideDuringScrollRedraw = silentHighlightOptions.hideDuringScrollRedraw;
  if (
    !localMatchingBaseUrl &&
    !effectiveTabState.baseUrl &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const discoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      discoveryResult &&
      discoveryResult.ok &&
      discoveryResult.siteId &&
      discoveryResult.baseUrl
    ) {
      const discoveredBaseUrl = discoveryResult.baseUrl;
      const discoveredSiteId = normalizeSiteIdValue(discoveryResult.siteId);
      if (discoveredSiteId) {
        state.siteIdLookupByBaseUrl.set(discoveredBaseUrl, discoveredSiteId);
        await config.updateConfig(discoveredBaseUrl, (entry) => {
          entry.siteId = discoveredSiteId;
        });
        configs = await config.getConfigs();
        localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
        hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
      }
      if (configEndpointValue) {
        remoteLoadResult = await loadRemoteConfigForCurrentPage({
          tabId: currentTabId,
          pageUrl,
          siteId: discoveryResult.siteId,
          endpointValue: configEndpointValue,
          tokenValue,
          force: false
        });
        if (
          remoteLoadResult &&
          (remoteLoadResult.status === "ok" || remoteLoadResult.status === "not_found")
        ) {
          configs = await config.getConfigs();
          localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
          hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
        }
      }
    } else if (discoveryResult && discoveryResult.ok && discoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = "No mapped base page URL/siteId was found for this page.";
    }
  }
  const fallbackBaseUrl = localMatchingBaseUrl;
  state.currentBaseUrl = effectiveTabState.baseUrl || fallbackBaseUrl || "";
  if (state.currentBaseUrl) {
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (!configs[state.currentBaseUrl] || normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
    }
    state.currentConfig = configs[state.currentBaseUrl];
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: state.currentBaseUrl,
      stageBase: normalizedStageBaseValue,
      tokenValue,
      configs
    });
    if (siteIdResult.ok && siteIdResult.siteId) {
      currentSiteId = siteIdResult.siteId;
      state.currentConfig = siteIdResult.config || state.currentConfig;
      remoteLoadResult = await loadRemoteConfigForCurrentPage({
        tabId: currentTabId,
        pageUrl,
        siteId: currentSiteId,
        endpointValue: configEndpointValue,
        tokenValue,
        force: false
      });
      if (remoteLoadResult && remoteLoadResult.status === "ok") {
        configs = await config.getConfigs();
        if (state.currentBaseUrl && configs[state.currentBaseUrl]) {
          const normalizedCurrent = config.normalizeConfig(
            state.currentBaseUrl,
            configs[state.currentBaseUrl]
          );
          if (normalizedCurrent.changed) {
            configs[state.currentBaseUrl] = normalizedCurrent.config;
            await config.saveConfigs(configs);
          }
          state.currentConfig = configs[state.currentBaseUrl];
        }
      }
    } else {
      siteIdBlockedReason = siteIdResult.reason || "";
      remoteLoadResult = { status: "skipped", baseUrl: "" };
      updateLastConfigLoadStatus(remoteLoadResult);
    }
  } else {
    state.currentConfig = null;
  }
  if (
    remoteLoadResult &&
    remoteLoadResult.status === "not_found" &&
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite
  ) {
    const wasEnabled = Boolean(effectiveTabState.enabled);
    effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
    if (wasEnabled) {
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
    siteIdBlockedReason = "";
  }
  if (unsupportedByGraphql) {
    if (effectiveTabState.enabled) {
      effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
      await utils.setTabState(state.currentTab.id, effectiveTabState);
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
  }
  if (!state.currentBaseUrl) {
    state.baseUrlEditMode = false;
  }

  const view = uiModule.getViewState();
  const refs = uiModule.getRefs();
  const nextViewState = {
    currentPageUrl: pageUrl || "Unavailable",
    currentPageUrlTitle: pageUrl || "Unavailable",
    currentBaseUrl: state.currentBaseUrl,
    configMenuOpen: state.configMenuOpen
  };
  const baseUrlReady = Boolean(state.currentBaseUrl);
  const baseField = {
    value: state.currentBaseUrl || "",
    isEditing: false,
    noticeText: baseUrlReady
      ? ""
      : "Base Page URL is resolved automatically from GraphQL.",
    noticeVisible: !baseUrlReady
  };
  let toggleEnabled = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      utils.isPageWithinBaseUrl(pageUrl, effectiveTabState.baseUrl)
  );
  if (state.lastPopupEnabled !== null) {
    toggleEnabled = state.lastPopupEnabled;
    if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
      state.lastPopupEnabled = null;
    }
  }
  let isEnabled = toggleEnabled;
  const shouldAutoEnableMobile =
    Boolean(currentTabId) &&
    tabChanged &&
    sidebarOpenedOnTab &&
    !state.mobileAutoAppliedTabIds.has(currentTabId);
  let normalizedDeviceState = null;
  if (shouldAutoEnableMobile) {
    normalizedDeviceState = await ensureMobileSimulationForSidebar(currentTabId);
    state.mobileAutoAppliedTabIds.add(currentTabId);
  }
  if (!normalizedDeviceState) {
    const storedDeviceState = currentTabId
      ? await emulation.getDeviceEmulationState(currentTabId)
      : {
          enabled: state.currentDeviceEmulationEnabled,
          mode: state.currentDeviceMode,
          scale: state.currentDeviceScale
        };
    normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  }
  const mobileSimulationReady = isMobileSimulationActive(normalizedDeviceState);
  const mobileSimulationBlocked = !mobileSimulationReady;
  const loginEmailValue = view.loginEmailValue || "";
  const loginPasswordValue = view.loginPasswordValue || "";
  if (!configEndpointValue) {
    state.configEndpointEditMode = false;
  }
  if (!endpointValue) {
    state.endpointEditMode = false;
  }
  if (!normalizedStageBaseValue) {
    state.stageBaseEditMode = false;
  }
  const configEndpointSet = Boolean(configEndpointValue);
  const configEndpointField = getEditableFieldState({
    inputRef: refs.configEndpointUrlInput,
    currentValue: view.configEndpointUrlValue,
    value: configEndpointValue,
    isSet: configEndpointSet,
    editMode: state.configEndpointEditMode,
    suggestedValue: configEndpointValue,
    noticeUnset: "Set Configuration Endpoint before continuing",
    noticeEdit: "Set Configuration Endpoint to continue"
  });
  const configEndpointReady = configEndpointField.isReady;
  const endpointSet = Boolean(endpointValue);
  const endpointField = getEditableFieldState({
    inputRef: refs.endpointUrlInput,
    currentValue: view.endpointUrlValue,
    value: endpointValue,
    isSet: endpointSet,
    editMode: state.endpointEditMode,
    suggestedValue: endpointValue,
    noticeUnset: "Set Endpoint URL before using AI",
    noticeEdit: "Set Endpoint URL to continue"
  });
  const endpointReady = endpointField.isReady;
  const stageBaseSet = Boolean(normalizedStageBaseValue);
  const stageBaseField = getEditableFieldState({
    inputRef: refs.stageBaseInput,
    currentValue: view.stageBaseValue,
    value: normalizedStageBaseValue,
    isSet: stageBaseSet,
    editMode: state.stageBaseEditMode,
    suggestedValue: normalizedStageBaseValue,
    noticeUnset: "Set Stage Base before signing in",
    noticeEdit: "Set Stage Base to continue"
  });
  const stageBaseReady = stageBaseField.isReady;
  const loginCredentialsEnabled = stageBaseReady;
  const siteIdReady = Boolean(
    currentSiteId || normalizeSiteIdValue(state.currentConfig && state.currentConfig.siteId)
  );
  const effectiveSiteIdBlockedReason = unsupportedByGraphql
    ? siteIdBlockedReason || "No mapped base page URL/siteId was found for this page."
    : baseUrlReady && !siteIdReady
      ? siteIdBlockedReason || "No domainId exists for this base URL"
      : "";

  const configurationComplete =
    configEndpointReady && endpointReady && stageBaseReady && Boolean(tokenValue);
  const aiReady =
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady &&
    endpointReady &&
    Boolean(tokenValue);
  isEnabled = toggleEnabled && siteIdReady;
  if (toggleEnabled && !siteIdReady && currentTabId) {
    toggleEnabled = false;
    isEnabled = false;
    state.lastPopupEnabled = null;
    effectiveTabState = { ...effectiveTabState, enabled: false };
    await utils.setTabState(currentTabId, {
      enabled: false,
      baseUrl: state.currentBaseUrl || effectiveTabState.baseUrl || ""
    });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  const latestComputed = getLatestComputedSelectorsFromConfig();
  const lastSaved = getLastSubmittedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(latestComputed).length;
  const hasNewSelectors =
    selectorCount > 0 &&
    !aiSelectorSetsEqual(latestComputed, lastSaved);
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = selectorCount > 0;
  const aiControlsVisible = endpointReady && Boolean(tokenValue);

  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentDraftHasEntry = false;
  if (state.currentBaseUrl && isEnabled) {
    const draftStatus = await messages.sendTabMessage({
      type: "getPageDraftStatus",
      baseUrl: state.currentBaseUrl
    });
    if (draftStatus && draftStatus.ok) {
      state.currentDraftEntry = draftStatus.entry || null;
      state.currentSavedEntry = draftStatus.savedEntry || null;
      state.currentDraftDirty = Boolean(draftStatus.dirty);
      state.currentDraftAvailable = true;
      state.currentDraftHasEntry = Boolean(state.currentDraftEntry);
    }
  }
  const savedEntry =
    state.currentSavedEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const hasSavedPageData = Boolean(
    savedEntry &&
      ((Array.isArray(savedEntry.xpaths) && savedEntry.xpaths.length > 0) ||
        (Array.isArray(savedEntry.includeXpaths) &&
          savedEntry.includeXpaths.length > 0) ||
        (Array.isArray(savedEntry.consentXpaths) &&
          savedEntry.consentXpaths.length > 0) ||
        (typeof savedEntry.fullHTML === "string" && savedEntry.fullHTML.length > 0))
  );
  const aiBlockedByDraft = state.currentDraftDirty;

  let resolvedView =
    state.currentView ||
    uiModule.getViewState().currentView ||
    uiModule.View.Marking;
  if (!configurationComplete) {
    resolvedView = uiModule.View.Configuration;
    state.configViewLocked = true;
  } else if (state.configViewLocked) {
    resolvedView = uiModule.View.Marking;
    state.configViewLocked = false;
  }
  state.currentView = resolvedView;

  nextViewState.currentView = resolvedView;
  nextViewState.configurationComplete = configurationComplete;
  nextViewState.configurationContinueDisabled = !configurationComplete || unsupportedByGraphql;
  nextViewState.configurationNoticeVisible = !configurationComplete || unsupportedByGraphql;
  nextViewState.configurationNoticeText = unsupportedByGraphql
    ? "This page is not mapped to any siteId/base page URL. Extension UI is disabled."
    : configurationComplete
      ? ""
      : "Provide Configuration Endpoint, AI Endpoint, Stage Base, then login to continue.";

  const uiDisabledForUnsupportedPage = unsupportedByGraphql;
  nextViewState.toggleEnabled = uiDisabledForUnsupportedPage ? false : isEnabled;
  nextViewState.toggleEnabledDisabled =
    uiDisabledForUnsupportedPage || !baseUrlReady || !siteIdReady;
  nextViewState.mainUiHidden =
    uiDisabledForUnsupportedPage || !isEnabled || !siteIdReady;
  nextViewState.computeButtonDisabled =
    uiDisabledForUnsupportedPage ||
    aiBusy ||
    !aiReady ||
    aiBlockedByDraft ||
    mobileSimulationBlocked;
  nextViewState.saveExcludesButtonDisabled =
    uiDisabledForUnsupportedPage ||
    aiBusy ||
    !aiReady ||
    !hasNewSelectors ||
    aiBlockedByDraft ||
    mobileSimulationBlocked;
  nextViewState.previewLatestButtonDisabled =
    uiDisabledForUnsupportedPage ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady ||
    !hasStoredSelectors ||
    aiBlockedByDraft ||
    mobileSimulationBlocked;
  nextViewState.aiControlsHidden = uiDisabledForUnsupportedPage || !aiControlsVisible;
  nextViewState.mobileSimulationRequiredVisible = mobileSimulationBlocked;
  nextViewState.mobileSimulationRequiredText = MOBILE_SIMULATION_REQUIRED_MESSAGE;
  nextViewState.stageBaseValue = stageBaseField.value;
  nextViewState.stageBaseReadOnly = !stageBaseField.isEditing;
  nextViewState.stageBaseSetVisible = stageBaseField.isEditing;
  nextViewState.stageBaseEditVisible = stageBaseSet;
  nextViewState.stageBaseEditText = state.stageBaseEditMode ? "Cancel" : "Change";
  nextViewState.stageBaseNoticeText = stageBaseField.noticeText;
  nextViewState.stageBaseNoticeVisible = stageBaseField.noticeVisible;
  nextViewState.stageBaseInputDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.stageBaseSetDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.stageBaseEditDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.loginEmailValue = loginEmailValue;
  nextViewState.loginPasswordValue = loginPasswordValue;
  nextViewState.loginCredentialsDisabled =
    aiBusy || uiDisabledForUnsupportedPage || !loginCredentialsEnabled;
  nextViewState.loginStatusText = tokenValue ? "Token saved" : "Login required";
  nextViewState.loginActionDisabled =
    uiDisabledForUnsupportedPage ||
    aiBusy ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
  nextViewState.configEndpointUrlValue = configEndpointField.value;
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
  nextViewState.configEndpointEditVisible = configEndpointSet;
  nextViewState.configEndpointEditText = state.configEndpointEditMode ? "Cancel" : "Change";
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
  nextViewState.configEndpointInputDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.configEndpointSetDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.configEndpointEditDisabled = aiBusy || uiDisabledForUnsupportedPage;

  nextViewState.endpointUrlValue = endpointField.value;
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
  nextViewState.endpointSetVisible = endpointField.isEditing;
  nextViewState.endpointEditVisible = endpointSet;
  nextViewState.endpointEditText = state.endpointEditMode ? "Cancel" : "Change";
  nextViewState.endpointNoticeText = endpointField.noticeText;
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
  nextViewState.endpointInputDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.endpointSetDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.endpointEditDisabled = aiBusy || uiDisabledForUnsupportedPage;
  nextViewState.clearDomainCacheDisabled = state.clearDomainCacheDisabled;
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute" ? "Computing..." : "Decide Content";
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save" ? "Submitting..." : "Submit to the server";
  nextViewState.computeButtonLoading = state.aiRequestInFlight === "compute";
  nextViewState.saveExcludesButtonLoading = state.aiRequestInFlight === "save";
  nextViewState.aiControlsBusy = aiBusy;
  nextViewState.aiDirtyNoticeVisible = aiBlockedByDraft;
  nextViewState.cssSelectorsVisible =
    !uiDisabledForUnsupportedPage && resolvedView === uiModule.View.Marking;
  const highlightingMode =
    resolvedView === uiModule.View.Marking && !isEnabled;
  nextViewState.highlightingOptionsVisible =
    !uiDisabledForUnsupportedPage && highlightingMode;
  nextViewState.highlightMarkedPagesChecked = state.silentHighlightShowMarkedPages;
  nextViewState.highlightIncludedContentChecked = state.silentHighlightShowIncludedContent;
  nextViewState.highlightExcludedContentChecked = state.silentHighlightShowExcludedContent;
  nextViewState.highlightVisibleConsentChecked = state.silentHighlightShowVisibleConsent;
  nextViewState.highlightHideDuringScrollRedrawChecked =
    state.silentHighlightHideDuringScrollRedraw;
  nextViewState.baseUrlInputValue = baseField.value;
  nextViewState.baseUrlInputReadOnly = true;
  nextViewState.baseUrlSetVisible = false;
  nextViewState.baseUrlEditVisible = false;
  nextViewState.baseUrlEditText = "Change";
  nextViewState.baseUrlNoticeText =
    effectiveSiteIdBlockedReason || baseField.noticeText;
  nextViewState.baseUrlNoticeVisible =
    Boolean(effectiveSiteIdBlockedReason) || baseField.noticeVisible;
  const canInitialPageSave = !hasSavedPageData;
  const pageSaveDisabled =
    uiDisabledForUnsupportedPage ||
    !baseUrlReady ||
    !siteIdReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    mobileSimulationBlocked ||
    (!state.currentDraftDirty && !canInitialPageSave);
  nextViewState.pageSaveDisabled = pageSaveDisabled;
  nextViewState.pageRevertDisabled =
    uiDisabledForUnsupportedPage ||
    !baseUrlReady ||
    !siteIdReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    mobileSimulationBlocked ||
    !hasSavedPageData ||
    !state.currentDraftDirty;
  if (!baseUrlReady) {
    nextViewState.pageDraftStatusText = "Base Page URL is resolved automatically.";
  } else if (uiDisabledForUnsupportedPage) {
    nextViewState.pageDraftStatusText =
      "This page has no mapped siteId/base page URL.";
  } else if (!siteIdReady) {
    nextViewState.pageDraftStatusText =
      effectiveSiteIdBlockedReason || "No domainId exists for this base URL";
  } else if (!isEnabled) {
    nextViewState.pageDraftStatusText = "Enable marking to edit this page";
  } else if (mobileSimulationBlocked) {
    nextViewState.pageDraftStatusText = MOBILE_SIMULATION_REQUIRED_MESSAGE;
  } else if (!state.currentDraftAvailable) {
    nextViewState.pageDraftStatusText = "Draft unavailable";
  } else if (!hasSavedPageData) {
    nextViewState.pageDraftStatusText = "No saved data yet";
  } else if (state.currentDraftDirty) {
    nextViewState.pageDraftStatusText = "Unsaved changes";
  } else {
    nextViewState.pageDraftStatusText = "All changes saved";
  }
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || "Not loaded yet";
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || "No save sent yet";
  nextViewState.pageDataNewNoticeHidden =
    uiDisabledForUnsupportedPage ||
    !baseUrlReady ||
    !siteIdReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    hasSavedPageData;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = `${Math.round(normalizedDeviceState.scale * 100)}%`;
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled);

  const pageEntry =
    state.currentDraftEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const explicitExclude = (pageEntry && pageEntry.xpaths) || [];
  const explicitIncludeXPaths =
    pageEntry && Array.isArray(pageEntry.includeXpaths) ? pageEntry.includeXpaths : [];
  const excludedXPaths = explicitExclude
    .filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath
    )
    .map((item) => item.xpath);
  let pageExplicitExclude = excludedXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (state.currentBaseUrl) {
    const response = await messages.sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: excludedXPaths
    });
    if (response && Array.isArray(response.items)) {
      pageExplicitExclude = response.items;
    }
  }

  const filteredExplicitIncludeXPaths = explicitIncludeXPaths.filter((xpath) => xpath);
  let pageExplicitInclude = filteredExplicitIncludeXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (state.currentBaseUrl && filteredExplicitIncludeXPaths.length) {
    const response = await messages.sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: filteredExplicitIncludeXPaths
    });
    if (response && Array.isArray(response.items)) {
      const labelMap = new Map(
        response.items.map((item) => [item.xpath, item.text || item.xpath])
      );
      pageExplicitInclude = filteredExplicitIncludeXPaths.map((xpath) => ({
        xpath,
        text: labelMap.get(xpath) || xpath
      }));
    }
  }

  nextViewState.explicitExcludes = pageExplicitExclude;
  nextViewState.explicitExcludesEmptyText = baseUrlReady
    ? "None yet"
    : effectiveSiteIdBlockedReason || "No mapped base page URL/siteId for this page";
  nextViewState.explicitIncludes = pageExplicitInclude;
  nextViewState.explicitIncludesEmptyText = baseUrlReady
    ? "None yet"
    : effectiveSiteIdBlockedReason || "No mapped base page URL/siteId for this page";

  const markedPages = [];
  const pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
  const mergedPageMarkings = { ...pageMarkings };
  if (state.currentDraftEntry && pageUrl) {
    mergedPageMarkings[pageUrl] = state.currentDraftEntry;
  }
  Object.entries(mergedPageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || !Array.isArray(entry.xpaths)) {
      return;
    }
    if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(url, state.currentBaseUrl)) {
      return;
    }
    const excludedCount = entry.xpaths.filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath
    ).length;
    const includedCount = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths.filter(
          (xpath) =>
            typeof xpath === "string" &&
            xpath
        ).length
      : 0;
    markedPages.push({
      url,
      title: entry.title || url,
      count: excludedCount + includedCount
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  nextViewState.markedPages = markedPages;
  nextViewState.markedPagesEmptyText = baseUrlReady
    ? "None yet"
    : effectiveSiteIdBlockedReason || "No mapped base page URL/siteId for this page";

  const basePageUrls = Object.keys(configs)
    .filter((url) => {
      if (typeof url !== "string" || !url) {
        return false;
      }
      const normalized = config.normalizeConfig(url, configs[url]).config;
      return Boolean(normalizeSiteIdValue(normalized.siteId));
    })
    .sort((left, right) => left.localeCompare(right))
    .map((url) => ({ url }));
  nextViewState.basePageUrls = basePageUrls;
  nextViewState.basePageUrlsEmptyText = "No base URLs with domainId";

  uiModule.setViewState(nextViewState);
  if (resolvedView === uiModule.View.Marking) {
    await applySilentHighlightVisibility();
  }
}

function handleBaseUrlInput(event) {
  uiModule.setViewState({ baseUrlInputValue: (event && event.target && event.target.value) || "" });
}

function handleConfigEndpointInput(event) {
  uiModule.setViewState({ configEndpointUrlValue: event.target.value });
}

function handleEndpointInput(event) {
  uiModule.setViewState({ endpointUrlValue: event.target.value });
}

function handleStageBaseInput(event) {
  uiModule.setViewState({ stageBaseValue: event.target.value });
}

function handleLoginEmailInput(event) {
  updateLoginActionState({ loginEmailValue: event.target.value });
}

function handleLoginPasswordInput(event) {
  updateLoginActionState({ loginPasswordValue: event.target.value });
}

function handleEnterKeyDown(event, shouldHandle, handler) {
  if (event.key !== "Enter") {
    return;
  }
  if (!shouldHandle()) {
    return;
  }
  handler();
}

function handleBaseUrlKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().baseUrlInputReadOnly,
    handleBaseUrlSet
  );
}

function handleConfigEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().configEndpointUrlReadOnly,
    handleConfigEndpointSet
  );
}

function handleEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().endpointUrlReadOnly,
    handleEndpointSet
  );
}

function handleStageBaseKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().stageBaseReadOnly,
    handleStageBaseSet
  );
}

function handleLoginPasswordKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginActionDisabled,
    handleLoginAction
  );
}

function handleConfigToggle(event) {
  event.stopPropagation();
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event) {
  event.stopPropagation();
}

async function handleOpenConfigurationView() {
  uiModule.setConfigMenuOpen(false);
  state.currentView = uiModule.View.Configuration;
  uiModule.setViewState({ currentView: state.currentView });
  await refreshUi();
}

async function maybeSwitchToMarkingView() {
  const tokenIsValid = await validateStoredToken({
    force: true,
    showToastOnInvalid: false
  });
  const { tokenValue, endpointValue, configEndpointValue, stageBaseValue } =
    await helpers.loadGlobalAiSettings();
  if (
    tokenIsValid &&
    tokenValue &&
    endpointValue &&
    configEndpointValue &&
    normalizeStageBase(stageBaseValue)
  ) {
    state.currentView = uiModule.View.Marking;
    state.configViewLocked = false;
    uiModule.setViewState({ currentView: state.currentView });
  }
}

async function handleConfigurationContinue() {
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleExplicitExcludeView(xpath) {
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to focus element");
  }
}

async function handleExplicitExcludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitExclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    excluded: false
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to update exclude");
    return;
  }
  refreshUi();
}

async function handleExplicitIncludeView(xpath) {
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to focus element");
  }
}

async function handleExplicitIncludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitInclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    included: false
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to update include");
    return;
  }
  refreshUi();
}

async function handleMarkedPageNavigate(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return;
  }
  chrome.tabs.update(tab.id, { url }, () => {
    void chrome.runtime.lastError;
  });
}

async function handleBasePageNavigate(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return;
  }
  chrome.tabs.update(tab.id, { url }, () => {
    void chrome.runtime.lastError;
  });
}
async function handleEnableToggle(event) {
  const source = event && (event.currentTarget || event.target);
  const desiredEnabled = source
    ? Boolean(source.checked)
    : uiModule.getViewState().toggleEnabled;
  const tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  if (!tab) {
    return;
  }
  uiModule.setViewState({ toggleEnabled: desiredEnabled });
  if (!helpers.ensureBaseUrl("No mapped base page URL/siteId for this page")) {
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    return;
  }
  state.lastPopupEnabled = desiredEnabled;
  const baseUrlValue = state.currentBaseUrl;
  if (desiredEnabled) {
    const parsed = utils.parseBaseUrl(baseUrlValue);
    if (!parsed) {
      uiModule.showToast("Enter a valid Base Page URL");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
      uiModule.showToast("Current page is outside the Base Page URL");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    state.currentConfig = await config.ensureConfig(baseUrlValue);
    const { stageBaseValue, tokenValue } = await helpers.loadGlobalAiSettings();
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: baseUrlValue,
      stageBase: stageBaseValue,
      tokenValue
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      uiModule.showToast(siteIdResult.reason || "No domainId exists for this base URL");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    state.currentConfig = siteIdResult.config || state.currentConfig;
    // Inject content script first
    const injectResult = await helpers.injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      uiModule.showToast(injectResult.error || "Unable to activate on this page");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId: tab.id });
    await utils.setTabState(tab.id, { enabled: true, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue
    });
    await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await utils.setTabState(tab.id, { enabled: false, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleHighlightMarkedPagesChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowMarkedPages",
    "highlightMarkedPagesChecked"
  );
}

async function handleHighlightIncludedContentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowIncludedContent",
    "highlightIncludedContentChecked"
  );
}

async function handleHighlightExcludedContentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowExcludedContent",
    "highlightExcludedContentChecked"
  );
}

async function handleHighlightVisibleConsentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowVisibleConsent",
    "highlightVisibleConsentChecked"
  );
}

async function handleHighlightHideDuringScrollRedrawChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightHideDuringScrollRedraw",
    "highlightHideDuringScrollRedrawChecked"
  );
}

async function updateHighlightVisibilityOption(event, stateKey, viewKey) {
  const checked = readCheckboxValue(event, state[stateKey]);
  state[stateKey] = checked;
  uiModule.setViewState({ [viewKey]: checked });
  await persistSilentHighlightVisibility();
  await applySilentHighlightVisibility({ force: true });
}

async function handleDeviceEmulationEnabledToggle(event) {
  const desiredEnabled = event && event.currentTarget
    ? Boolean(event.currentTarget.checked)
    : uiModule.getViewState().deviceEmulationEnabled;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ deviceEmulationEnabled: desiredEnabled });
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: desiredEnabled,
    mode: state.currentDeviceMode,
    scale: state.currentDeviceScale
  });
}

async function handleDeviceModeToggle(event) {
  const desiredMode = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceMode;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: `${Math.round(state.currentDeviceScale * 100)}%`
    });
    return;
  }
  uiModule.setViewState({ deviceMode: desiredMode });
  if (desiredMode === state.currentDeviceMode) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: desiredMode,
    scale: state.currentDeviceScale
  });
}

function handleDeviceScaleInput(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: `${Math.round(scale * 100)}%`
  });
}

async function handleDeviceScaleChange(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: `${Math.round(state.currentDeviceScale * 100)}%`
    });
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: `${Math.round(scale * 100)}%`
  });
  if (scale === state.currentDeviceScale) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: state.currentDeviceMode,
    scale
  });
}

async function handleClearDomainCache() {
  const tab = await helpers.ensureActiveTab({
    requireUrl: true,
    toastOnMissing: "No active tab to clear"
  });
  if (!tab) {
    return;
  }
  const origin = utils.getOriginFromUrl(tab.url);
  if (!origin) {
    uiModule.showToast("Unsupported page for cache clearing");
    return;
  }
  let hostname = origin;
  try {
    hostname = new URL(tab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(
    `Clear cookies, local storage, and cached files for ${hostname}?`
  );
  if (!confirmed) {
    return;
  }
  uiModule.setUiBusy(true);
  state.clearDomainCacheDisabled = true;
  uiModule.setViewState({ clearDomainCacheDisabled: true });
  const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
  state.clearDomainCacheDisabled = false;
  uiModule.setViewState({ clearDomainCacheDisabled: false });
  if (!result.ok) {
    uiModule.setUiBusy(false);
    uiModule.showToast(result.error || "Unable to clear cache");
    return;
  }
  uiModule.showToast("Domain cache cleared");
  const reloadResult = await chromeHelpers.reloadTab(tab.id);
  uiModule.setUiBusy(false);
  if (!reloadResult.ok) {
    uiModule.showToast(reloadResult.error || "Unable to reload tab");
  }
}

async function handleBaseUrlSet() {
  uiModule.showToast("Base Page URL is resolved automatically from GraphQL");
}

async function handleBaseUrlEditToggle() {
  uiModule.showToast("Base Page URL is resolved automatically from GraphQL");
}

async function handleConfigEndpointSet() {
  const endpointValue = uiModule.getViewState().configEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast("Enter a Configuration Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast("Enter a valid Configuration Endpoint URL");
    return;
  }
  await utils.storageSet(chrome.storage.sync, {
    globalConfigEndpoint: endpointValue
  });
  state.configEndpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleConfigEndpointEditToggle() {
  state.configEndpointEditMode = !state.configEndpointEditMode;
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = uiModule.getViewState().endpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast("Enter an Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast("Enter a valid Endpoint URL");
    return;
  }
  await utils.storageSet(chrome.storage.sync, { globalEndpoint: endpointValue });
  state.endpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleStageBaseSet() {
  const inputValue = uiModule.getViewState().stageBaseValue.trim();
  const normalized = normalizeStageBase(inputValue);
  if (!normalized) {
    uiModule.showToast("Enter a valid Stage Base");
    return;
  }
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalStageBase",
    "globalToken"
  ]);
  const previousStageBase = normalizeStageBase((stored && stored.globalStageBase) || "");
  const hasToken = Boolean(stored && stored.globalToken);
  await utils.storageSet(chrome.storage.sync, {
    globalStageBase: normalized,
    globalToken:
      previousStageBase !== normalized && hasToken ? "" : stored.globalToken || ""
  });
  state.stageBaseEditMode = false;
  state.siteIdLookupByBaseUrl.clear();
  if (previousStageBase !== normalized && hasToken) {
    uiModule.showToast("Stage Base changed. Login required");
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleStageBaseEditToggle() {
  state.stageBaseEditMode = !state.stageBaseEditMode;
  await refreshUi();
}

async function handleLoginAction() {
  const view = uiModule.getViewState();
  const stageBase = normalizeStageBase(view.stageBaseValue || "");
  const email = view.loginEmailValue.trim();
  const password = view.loginPasswordValue;

  if (!stageBase) {
    uiModule.showToast("Set Stage Base first");
    return;
  }
  if (!isValidEmail(email)) {
    uiModule.showToast("Enter a valid email");
    return;
  }
  if (!password.trim()) {
    uiModule.showToast("Enter password");
    return;
  }

  state.aiRequestInFlight = "login";
  await refreshUi();
  try {
    const loginUrl = buildLoginEndpointFromStageBase(stageBase);
    if (!loginUrl) {
      uiModule.showToast("Set a valid Stage Base first");
      return;
    }
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const errorText =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        `Login failed (${response.status})`;
      uiModule.showToast(errorText);
      return;
    }
    const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
    if (!token) {
      uiModule.showToast("Login response did not include token");
      return;
    }

    await utils.storageSet(chrome.storage.sync, {
      globalStageBase: stageBase,
      globalToken: token
    });
    uiModule.setViewState({ loginPasswordValue: "" });
    uiModule.showToast("Login successful");
  } catch (error) {
    uiModule.showToast("Login request failed");
  } finally {
    state.aiRequestInFlight = null;
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleContextRefresh() {
  const tab = await helpers.ensureActiveTab();
  state.baseUrlEditMode = false;
  state.stageBaseEditMode = false;
  state.endpointEditMode = false;
  state.configEndpointEditMode = false;
  if (tab && tab.id) {
    const tabState = await utils.getTabState(tab.id);
    if (tabState && tabState.enabled) {
      await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
    }
  }
  await refreshUi();
}

async function handlePageSave() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForActions()) {
    return;
  }
  const response = await messages.sendTabMessage({
    type: "savePageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    updateLastConfigSaveStatus("Save failed");
    uiModule.showToast("Unable to save page");
    return;
  }
  if (response.saved) {
    const pageUrl = (state.currentTab && state.currentTab.url) || "";
    const { tokenValue, configEndpointValue, stageBaseValue } =
      await helpers.loadGlobalAiSettings();
    const syncResult = await syncBaseConfigToServer({
      baseUrl: state.currentBaseUrl,
      pageUrl,
      endpointValue: configEndpointValue,
      tokenValue,
      stageBase: stageBaseValue,
      alertOnCurrentReplacement: true
    });
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncFailed = !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
    updateLastConfigSaveStatus(
      syncSkipped
        ? "Saved locally (sync skipped)"
        : syncFailed
        ? "Saved locally (sync failed)"
        : "Saved and synced"
    );
    uiModule.showToast(
      syncSkipped
        ? "Page saved locally (server sync skipped)"
        : syncFailed
        ? "Page saved locally (server sync failed)"
        : "Page saved"
    );
  } else {
    updateLastConfigSaveStatus("No local changes to save");
    uiModule.showToast("No changes to save");
  }
  await refreshUi();
}

async function handlePageRevert() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForActions()) {
    return;
  }
  const confirmed = window.confirm(
    "Revert to the last saved version? Unsaved changes will be lost."
  );
  if (!confirmed) {
    return;
  }
  const response = await messages.sendTabMessage({
    type: "revertPageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    updateLastConfigSaveStatus("Revert failed");
    uiModule.showToast("Unable to revert page");
    return;
  }
  const pageUrl = (state.currentTab && state.currentTab.url) || "";
  const { tokenValue, configEndpointValue, stageBaseValue } =
    await helpers.loadGlobalAiSettings();
  const syncResult = await syncBaseConfigToServer({
    baseUrl: state.currentBaseUrl,
    pageUrl,
    endpointValue: configEndpointValue,
    tokenValue,
    stageBase: stageBaseValue,
    alertOnCurrentReplacement: true
  });
  const syncSkipped = Boolean(syncResult && syncResult.skipped);
  const syncFailed = !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
  updateLastConfigSaveStatus(
    syncSkipped
      ? "Reverted locally (sync skipped)"
      : syncFailed
      ? "Reverted locally (sync failed)"
      : "Reverted and synced"
  );
  uiModule.showToast(
    syncSkipped
      ? "Reverted locally (server sync skipped)"
      : syncFailed
      ? "Reverted locally (server sync failed)"
      : "Reverted to last saved"
  );
  await refreshUi();
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForActions()) {
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;

  state.currentConfig = await config.ensureConfig(state.currentBaseUrl);

  const pageMarkings = state.currentConfig.pageMarkings || {};
  const pages = Object.entries(pageMarkings)
    .map(([url, entry]) => {
      if (!url || !entry) {
        return null;
      }
      const fullHTML = typeof entry.fullHTML === "string" ? entry.fullHTML : "";
      const { explicitExcluded } = collectExplicitXPathSetsFromEntry(entry);
      const normalizedPayloadXpaths = collectAiSubmissionXpathsFromHtmlEntry(fullHTML, entry);
      return {
        url,
        fullHTML,
        xpaths: normalizedPayloadXpaths,
        explicitExcludedXpaths: explicitExcluded
      };
    });

  const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
  if (currentPageUrl) {
    const currentPageEntry = pages.find(
      (entry) => entry && entry.url === currentPageUrl && Array.isArray(entry.xpaths)
    );
    if (currentPageEntry) {
      const liveResponse = await messages.sendTabMessage({
        type: "collectAiSubmissionXpaths"
      });
      if (liveResponse && Array.isArray(liveResponse.xpaths)) {
        const liveXpaths = liveResponse.xpaths
          .map((item) => {
            if (!item || typeof item.xpath !== "string") {
              return null;
            }
            const xpath = item.xpath.trim();
            if (!xpath) {
              return null;
            }
            return { xpath, excluded: Boolean(item.excluded) };
          })
          .filter(Boolean);
        currentPageEntry.xpaths = normalizePayloadXpaths(liveXpaths, {
          preserveExcludedXpaths: currentPageEntry.explicitExcludedXpaths
        });
      }
    }
  }

  const persistedPages = pages.filter((entry) => {
    if (!entry || !entry.url) {
      return false;
    }
    if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(entry.url, state.currentBaseUrl)) {
      return false;
    }
    return Array.isArray(entry.xpaths);
  });

  const filteredPages = pages.filter((entry) => {
    if (!entry || !entry.url) {
      return false;
    }
    if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(entry.url, state.currentBaseUrl)) {
      return false;
    }
    return (
      Array.isArray(entry.xpaths) &&
      entry.xpaths.length > 0 &&
      entry.fullHTML
    );
  });

  const pageSubmissionXpathsByUrl = new Map(
    persistedPages.map((entry) => [
      entry.url,
      normalizePayloadXpaths(entry.xpaths, {
        preserveExcludedXpaths: entry.explicitExcludedXpaths
      })
    ])
  );
  const preserveExcludedXpathsByUrl = new Map(
    persistedPages.map((entry) => [entry.url, entry.explicitExcludedXpaths])
  );
  state.currentConfig = await config.updateConfig(state.currentBaseUrl, (configValue) => {
    if (!configValue.pageMarkings || typeof configValue.pageMarkings !== "object") {
      configValue.pageMarkings = {};
    }
    pageSubmissionXpathsByUrl.forEach((nextXpaths, url) => {
      if (!url || !Array.isArray(nextXpaths) || !configValue.pageMarkings[url]) {
        return;
      }
      const pageEntry = configValue.pageMarkings[url];
      const preserveExcludedXpaths = preserveExcludedXpathsByUrl.get(url) || new Set();
      const currentSubmissionXpaths = normalizePayloadXpaths(
        Array.isArray(pageEntry.submissionXpaths) ? pageEntry.submissionXpaths : [],
        { preserveExcludedXpaths }
      );
      if (areXPathRowsEqual(currentSubmissionXpaths, nextXpaths)) {
        return;
      }
      pageEntry.submissionXpaths = nextXpaths;
      configValue.pageMarkings[url] = pageEntry;
    });
  });

  if (!filteredPages.length) {
    uiModule.showToast("Mark pages before computing selectors");
    return;
  }

  const payload = {
    baseUrl: state.currentBaseUrl,
    defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
    pages: filteredPages.map((entry) => ({
      url: entry.url,
      fullHTML: entry.fullHTML,
      xpaths: entry.xpaths
    }))
  };

  let selectorSet = {
    exclusionSelectors: [],
    inclusionSelectors: []
  };
  state.aiRequestInFlight = "compute";
  await refreshUi();
  try {
    const response = await fetch(endpointValue, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenValue}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      uiModule.showToast("Endpoint response error");
      return;
    }
    const data = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.exclusionSelectors) ||
      !Array.isArray(data.inclusionSelectors)
    ) {
      uiModule.showToast("Endpoint response format error");
      return;
    }
    selectorSet = normalizeAiSelectorSet(data);
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.latestComputedSelectors = normalizeAiSelectorSet(selectorSet);
      config.domainAiSelectorSet = normalizeAiSelectorSet(selectorSet);
    });

    await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
    await messages.sendTabMessage({
      type: "showAiPreview",
      selectorSet
    });
    uiModule.showToast("Selectors computed");
  } catch (error) {
    uiModule.showToast("Endpoint request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handleSaveExcludes() {
  if (state.aiRequestInFlight) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForActions()) {
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;
  const selectorSet = getLatestComputedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(selectorSet).length;
  if (!selectorCount) {
    uiModule.showToast("No selectors available to submit");
    return;
  }
  if (aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig())) {
    uiModule.showToast("No new selectors to submit");
    return;
  }
  const confirmed = window.confirm(
    "Are these the final settings to this property for extractin the contents?"
  );
  if (!confirmed) {
    return;
  }
  state.aiRequestInFlight = "save";
  await refreshUi();
  try {
    const response = await fetch(endpointValue, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenValue}`
      },
      body: JSON.stringify({
        baseUrl: state.currentBaseUrl,
        defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
        exclusionSelectors: selectorSet.exclusionSelectors,
        inclusionSelectors: selectorSet.inclusionSelectors
      })
    });
    if (!response.ok) {
      uiModule.showToast("Submit response error");
      return;
    }
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.lastSavedSelectors = normalizeAiSelectorSet(selectorSet);
    });
    uiModule.showToast("Submitted to server");
  } catch (error) {
    uiModule.showToast("Submit request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handlePreviewLatest() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForActions()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast("No mapped base page URL/siteId for this page");
    return;
  }
  const selectorSet = getLatestComputedSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast("No stored selectors available");
    return;
  }
  await messages.sendTabMessage({
    type: "showAiPreview",
    selectorSet
  });
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    return;
  }
  state.refreshTimer = window.setTimeout(async () => {
    state.refreshTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi();
  }, 120);
}

async function init() {
  await helpers.ensureActiveTab();

  uiModule.initUi({
    onToggleEnabled: handleEnableToggle,
    onHighlightMarkedPagesChange: handleHighlightMarkedPagesChange,
    onHighlightIncludedContentChange: handleHighlightIncludedContentChange,
    onHighlightExcludedContentChange: handleHighlightExcludedContentChange,
    onHighlightVisibleConsentChange: handleHighlightVisibleConsentChange,
    onHighlightHideDuringScrollRedrawChange: handleHighlightHideDuringScrollRedrawChange,
    onDeviceEmulationEnabledChange: handleDeviceEmulationEnabledToggle,
    onDeviceModeChange: handleDeviceModeToggle,
    onDeviceScaleInput: handleDeviceScaleInput,
    onDeviceScaleChange: handleDeviceScaleChange,
    onConfigToggle: handleConfigToggle,
    onConfigMenuClick: handleConfigMenuClick,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onClearDomainCache: handleClearDomainCache,
    onBaseUrlInput: handleBaseUrlInput,
    onBaseUrlKeyDown: handleBaseUrlKeyDown,
    onRefreshContext: handleContextRefresh,
    onBaseUrlSet: handleBaseUrlSet,
    onBaseUrlEditToggle: handleBaseUrlEditToggle,
    onPageSave: handlePageSave,
    onPageRevert: handlePageRevert,
    onConfigEndpointInput: handleConfigEndpointInput,
    onConfigEndpointKeyDown: handleConfigEndpointKeyDown,
    onConfigEndpointSet: handleConfigEndpointSet,
    onConfigEndpointEditToggle: handleConfigEndpointEditToggle,
    onEndpointInput: handleEndpointInput,
    onEndpointKeyDown: handleEndpointKeyDown,
    onEndpointSet: handleEndpointSet,
    onEndpointEditToggle: handleEndpointEditToggle,
    onStageBaseInput: handleStageBaseInput,
    onStageBaseKeyDown: handleStageBaseKeyDown,
    onStageBaseSet: handleStageBaseSet,
    onStageBaseEditToggle: handleStageBaseEditToggle,
    onLoginEmailInput: handleLoginEmailInput,
    onLoginPasswordInput: handleLoginPasswordInput,
    onLoginPasswordKeyDown: handleLoginPasswordKeyDown,
    onLoginAction: handleLoginAction,
    onCompute: handleComputeSelectors,
    onSaveExcludes: handleSaveExcludes,
    onPreviewLatest: handlePreviewLatest,
    onExplicitExcludeView: handleExplicitExcludeView,
    onExplicitExcludeRemove: handleExplicitExcludeRemove,
    onExplicitIncludeView: handleExplicitIncludeView,
    onExplicitIncludeRemove: handleExplicitIncludeRemove,
    onMarkedPageNavigate: handleMarkedPageNavigate,
    onBasePageNavigate: handleBasePageNavigate
  });

  document.addEventListener("click", () => uiModule.setConfigMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
    }
    if (
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.repeat
    ) {
      if (isEditableTarget(event.target)) {
        return;
      }
      const view = uiModule.getViewState();
      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        event.stopPropagation();
        handleEnableToggle({ target: { checked: !view.toggleEnabled } }).then();
        return;
      }
      if (event.key === "s" || event.key === "S") {
        if (!view.toggleEnabled || view.pageSaveDisabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        handlePageSave().then();
      }
    }
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!tabId) {
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    await helpers.ensureActiveTab();
    await refreshUi();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!state.currentTab || tabId !== state.currentTab.id) {
      return;
    }
    if (changeInfo.url || changeInfo.status === "complete") {
      state.currentTab = tab;
      await refreshUi();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" && areaName !== "session") {
      return;
    }
    if (
      (areaName === "local" && changes.configs) ||
      (areaName === "session" &&
        state.currentTab &&
        (changes[`${constants.TAB_STATE_PREFIX}${state.currentTab.id}`] ||
          changes[`${constants.DEVICE_EMULATION_PREFIX}${state.currentTab.id}`]))
    ) {
      scheduleRefresh();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pageDraftChanged") {
      if (message && message.type === "consentXpathsChanged") {
        if (state.currentBaseUrl && message.baseUrl === state.currentBaseUrl) {
          const hasSavedData = Boolean(
            state.currentSavedEntry &&
              ((Array.isArray(state.currentSavedEntry.xpaths) &&
                state.currentSavedEntry.xpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.includeXpaths) &&
                  state.currentSavedEntry.includeXpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.consentXpaths) &&
                  state.currentSavedEntry.consentXpaths.length > 0) ||
                (typeof state.currentSavedEntry.fullHTML === "string" &&
                  state.currentSavedEntry.fullHTML.length > 0))
          );
          if (hasSavedData) {
            window.alert("Consent elements changed on this page. Save to keep the updates.");
          }
          scheduleRefresh();
        }
      }
      return;
    }
    if (state.currentBaseUrl && message.baseUrl === state.currentBaseUrl) {
      scheduleRefresh();
    }
  });

  if (state.tokenValidationTimer) {
    window.clearInterval(state.tokenValidationTimer);
  }
  state.tokenValidationTimer = window.setInterval(async () => {
    const isValid = await validateStoredToken({ force: true, showToastOnInvalid: true });
    if (!isValid) {
      await refreshUi();
    }
  }, TOKEN_VALIDATION_INTERVAL_MS);

  await refreshUi();
}

init();
