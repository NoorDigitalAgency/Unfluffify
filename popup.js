/**
 * @fileoverview Main popup interface for the Unfluffify extension.
 * 
 * This is the entry point for the popup UI. It handles:
 * - Rendering the popup interface with Preact
 * - Managing tab state (enabled/disabled status, base URLs, etc.)
 * - Sending and receiving messages from the content script
 * - Managing AI selector configuration and computation
 * - Handling device emulation/simulation settings
 * - Syncing page markings and exclusions
 * - Caching and persistence of user preferences
 * - API interactions for remote configuration
 * 
 * The UI is built using Preact and manages view states for:
 * - Marking: Main content exclusion/inclusion interface
 * - Configuration: AI selector and rendering mode settings
 * - Consent: Cookie/consent banner detection settings
 * - Silent Highlight: Visual overlay and highlighting modes
 */

import * as chromeHelpers from "./popup/chrome-helpers.js";
import * as config from "./common/config.js";
import * as constants from "./common/constants.js";
import * as emulation from "./popup/emulation.js";
import * as uiModule from "./popup/ui.js";
import {
  PopupText,
  ViewText,
  formatClearDomainCacheConfirm,
  formatConfigLoadStatusLabel,
  formatLoginFailedStatus,
  formatScalePercent,
  formatSelectorsComputedLocally,
  formatTimestampedStatus
} from "./common/text.js";
import * as utils from "./common/utilities.js";
import * as messages from "./popup/messages.js";
import * as helpers from "./popup/helpers.js";
import * as stateModule from "./popup/state.js";
import {
  refineXPathEntries
} from "./common/xpath-utilities.js";
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
const POPUP_BUSY_OVERLAY_DELAY_MS = 180;
const REMOTE_CONFIG_RETRY_DELAY_MS = 2500;
const RENDER_MODE_DETECTION_MAX_ATTEMPTS = 3;
const RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY = 0.8;
const RENDER_MODE_UNDETERMINED = "undetermined";
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_SEARCH_INFO_QUERY = `
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
`;
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
let popupBusyOverlayDepth = 0;
let popupBusyOverlayVisible = false;
let popupBusyOverlayTimer = 0;
let popupBusyOverlayMessage = PopupText.overlay.loadingPopup;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function beginPopupBusyOverlay(message, options = {}) {
  const delayMs = Number.isFinite(options.delayMs)
    ? Math.max(0, Math.trunc(options.delayMs))
    : 0;
  const suppressIfActive = Boolean(options.suppressIfActive);
  if (
    suppressIfActive &&
    (popupBusyOverlayDepth > 0 || popupBusyOverlayVisible || popupBusyOverlayTimer)
  ) {
    return false;
  }
  popupBusyOverlayDepth += 1;
  if (typeof message === "string" && message.trim()) {
    popupBusyOverlayMessage = message.trim();
  }
  if (popupBusyOverlayVisible) {
    uiModule.setUiBusy(true, popupBusyOverlayMessage);
    return;
  }
  if (delayMs > 0) {
    if (popupBusyOverlayTimer) {
      return;
    }
    popupBusyOverlayTimer = window.setTimeout(() => {
      popupBusyOverlayTimer = 0;
      if (popupBusyOverlayDepth <= 0 || popupBusyOverlayVisible) {
        return;
      }
      popupBusyOverlayVisible = true;
      uiModule.setUiBusy(true, popupBusyOverlayMessage);
    }, delayMs);
    return true;
  }
  if (popupBusyOverlayTimer) {
    window.clearTimeout(popupBusyOverlayTimer);
    popupBusyOverlayTimer = 0;
  }
  popupBusyOverlayVisible = true;
  uiModule.setUiBusy(true, popupBusyOverlayMessage);
  return true;
}

function endPopupBusyOverlay(started = true) {
  if (!started) {
    return;
  }
  popupBusyOverlayDepth = Math.max(0, popupBusyOverlayDepth - 1);
  if (popupBusyOverlayDepth > 0) {
    return;
  }
  if (popupBusyOverlayTimer) {
    window.clearTimeout(popupBusyOverlayTimer);
    popupBusyOverlayTimer = 0;
  }
  if (!popupBusyOverlayVisible) {
    return;
  }
  popupBusyOverlayVisible = false;
  uiModule.setUiBusy(false);
}

async function runWithPopupBusyOverlay(message, task, options = {}) {
  const started = beginPopupBusyOverlay(message, options);
  try {
    return await task();
  } finally {
    endPopupBusyOverlay(started);
  }
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

function isMobileSimulationActive(deviceState) {
  if (!deviceState || typeof deviceState !== "object") {
    return false;
  }
  return Boolean(deviceState.enabled) && deviceState.mode === "mobile";
}

function ensureMobileSimulationForSave() {
  if (isMobileSimulationActive({
    enabled: state.currentDeviceEmulationEnabled,
    mode: state.currentDeviceMode
  })) {
    return true;
  }
  uiModule.showToast(PopupText.page.mobileSimulationRequired);
  return false;
}

function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function getEndpointOrigin(value) {
  if (typeof value !== "string") {
    return "";
  }
  try {
    return new URL(value).origin.toLowerCase();
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
  const normalized = `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
  return utils.normalizeCanonicalBaseUrl(normalized) || normalized;
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
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
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

function mergeSelectorSetForBaseUrlMigration(
  preferredSelectorSet,
  preferredUpdatedAt,
  existingSelectorSet,
  existingUpdatedAt
) {
  return config.mergeSelectorSetsByTimestamp(
    existingSelectorSet,
    existingUpdatedAt,
    preferredSelectorSet,
    preferredUpdatedAt
  );
}

function buildSelectorSetForGraphqlSubmit(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return normalizeAiSelectorSet({
    exclusionSelectors: [
      ...normalized.exclusionSelectors,
      ...constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS
    ],
    inclusionSelectors: normalized.inclusionSelectors
  });
}

function buildGraphqlRenderModeValue(renderMode) {
  return config.normalizeRenderMode(renderMode) === config.RENDER_MODE_RENDERED
    ? "RENDERED"
    : "STATIC";
}

function isUndeterminedRenderMode(value) {
  return typeof value === "string" && value.trim().toLowerCase() === RENDER_MODE_UNDETERMINED;
}

function normalizeUiRenderModeValue(value, fallback = config.DEFAULT_RENDER_MODE) {
  if (isUndeterminedRenderMode(value)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.normalizeRenderMode(typeof value === "string" ? value : fallback);
}

function markRenderModeUndetermined(detectionKey) {
  state.renderModeSuggestedValue = RENDER_MODE_UNDETERMINED;
  state.renderModeDetectionUnsure = true;
  if (state.renderModeUndeterminedNoticeKey === detectionKey) {
    return;
  }
  state.renderModeUndeterminedNoticeKey = detectionKey;
  uiModule.showToast(PopupText.renderMode.toastUndeterminedManual);
}

function hasConfirmedRenderModeForBaseUrl(configs, baseUrl) {
  const normalizedBaseUrl =
    utils.normalizeCanonicalBaseUrl(baseUrl) ||
    utils.normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  if (
    !normalizedBaseUrl ||
    !configs ||
    !Object.prototype.hasOwnProperty.call(configs, normalizedBaseUrl)
  ) {
    return false;
  }
  const normalizedConfig = config.normalizeConfig(
    normalizedBaseUrl,
    configs[normalizedBaseUrl]
  ).config;
  return config.isRenderModeConfirmed(normalizedConfig);
}

function getSuggestedRenderModeForPage(pageUrl, sourceConfig = state.currentConfig) {
  const suggestionKey = `${state.currentBaseUrl || ""}|${pageUrl || ""}`;
  if (
    state.renderModeSuggestedKey === suggestionKey &&
    state.renderModeSuggestedValue
  ) {
    return normalizeUiRenderModeValue(state.renderModeSuggestedValue);
  }
  if (shouldAutoDetectRenderMode(sourceConfig)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.getConfigRenderMode(sourceConfig);
}

function shouldAutoDetectRenderMode(sourceConfig) {
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return false;
  }
  if (state.currentBaseUrlHasConfirmedRenderMode) {
    return false;
  }
  return (
    config.getConfigRenderMode(sourceConfig) === config.DEFAULT_RENDER_MODE &&
    config.normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt) === config.PAGE_TIMESTAMP_FALLBACK
  );
}

async function maybeAutoDetectRenderMode(pageUrl) {
  if (
    !pageUrl ||
    !state.currentBaseUrl ||
    !state.currentConfig ||
    !shouldAutoDetectRenderMode(state.currentConfig)
  ) {
    const fallbackRenderMode = config.getConfigRenderMode(state.currentConfig);
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = fallbackRenderMode;
    state.renderModeDetectionUnsure = false;
    return fallbackRenderMode;
  }

  const detectionKey = `${state.currentBaseUrl}|${pageUrl}`;
  if (state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return getSuggestedRenderModeForPage(pageUrl);
  }
  if (!state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return getSuggestedRenderModeForPage(pageUrl);
  }

  state.renderModeDetectionInFlight = true;
  state.renderModeDetectionKey = detectionKey;
  state.renderModeSuggestedKey = detectionKey;
  state.renderModeDetectionUnsure = false;
  state.renderModeUndeterminedNoticeKey = "";
  try {
    const { tokenValue, endpointValue } = await helpers.loadGlobalAiSettings();
    const renderedSnapshot = await messages.sendTabMessage({
      type: "collectPageData",
      baseUrl: state.currentBaseUrl
    });
    if (
      !renderedSnapshot ||
      typeof renderedSnapshot.renderedHtml !== "string" ||
      !renderedSnapshot.renderedHtml
    ) {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }

    const staticResponse = await messages.sendRuntimeMessage({
      type: "fetchStaticPageHtml",
      url: pageUrl
    });
    if (!staticResponse || !staticResponse.ok || typeof staticResponse.html !== "string") {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }

    const detectionResult = await runWithPopupBusyOverlay(
      PopupText.overlay.detectingRenderMode,
      () => detectRenderModeViaEndpoint({
        endpointValue,
        tokenValue,
        rawHtml: staticResponse.html,
        renderedHtml: renderedSnapshot.renderedHtml
      }),
      { delayMs: 0 }
    );
    if (!detectionResult.ok) {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }
    if (detectionResult.result === "unsure") {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }
    state.renderModeDetectionUnsure = false;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeSuggestedValue = config.normalizeRenderMode(detectionResult.result);
    return state.renderModeSuggestedValue;
  } catch {
    markRenderModeUndetermined(detectionKey);
    return RENDER_MODE_UNDETERMINED;
  } finally {
    state.renderModeDetectionInFlight = false;
  }
}

function mergeConfigEntriesForResolvedBaseUrl(resolvedBaseUrl, preferredEntry, existingEntry) {
  const preferred = config.normalizeConfig(resolvedBaseUrl, preferredEntry).config;
  const existing = config.normalizeConfig(resolvedBaseUrl, existingEntry).config;
  const mergedPageMarkings = config.mergePageMarkingsByTimestamp(
    existing.pageMarkings,
    preferred.pageMarkings
  ).pageMarkings;
  const latestComputedSelectors = mergeSelectorSetForBaseUrlMigration(
    preferred.latestComputedSelectors,
    preferred.latestComputedSelectorsUpdatedAt,
    existing.latestComputedSelectors,
    existing.latestComputedSelectorsUpdatedAt
  );
  const lastSavedSelectors = mergeSelectorSetForBaseUrlMigration(
    preferred.lastSavedSelectors,
    preferred.lastSavedSelectorsUpdatedAt,
    existing.lastSavedSelectors,
    existing.lastSavedSelectorsUpdatedAt
  );
  const domainAiSelectorSet = mergeSelectorSetForBaseUrlMigration(
    preferred.domainAiSelectorSet,
    preferred.domainAiSelectorSetUpdatedAt,
    existing.domainAiSelectorSet,
    existing.domainAiSelectorSetUpdatedAt
  );
  const renderMode = config.mergeRenderModeByTimestamp(
    preferred.renderMode,
    preferred.renderModeUpdatedAt,
    existing.renderMode,
    existing.renderModeUpdatedAt
  );
  const merged = {
    ...existing,
    ...preferred,
    siteId:
      normalizeSiteIdValue(preferred.siteId) ||
      normalizeSiteIdValue(existing.siteId) ||
      null,
    renderMode: renderMode.renderMode,
    renderModeUpdatedAt: renderMode.updatedAt,
    pageMarkings: mergedPageMarkings,
    latestComputedSelectors: latestComputedSelectors.selectorSet,
    latestComputedSelectorsUpdatedAt: latestComputedSelectors.updatedAt,
    lastSavedSelectors: lastSavedSelectors.selectorSet,
    lastSavedSelectorsUpdatedAt: lastSavedSelectors.updatedAt,
    domainAiSelectorSet: domainAiSelectorSet.selectorSet,
    domainAiSelectorSetUpdatedAt: domainAiSelectorSet.updatedAt
  };
  return config.normalizeConfig(resolvedBaseUrl, merged).config;
}

async function ensureBaseUrlSiteId(options = {}) {
  const {
    baseUrl = "",
    stageBase = "",
    tokenValue = "",
    configs = null,
    persist = true
  } = options;
  const shouldPersist = persist !== false;
  const requestedBaseUrl =
    utils.normalizeCanonicalBaseUrl(baseUrl) ||
    utils.normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  if (!requestedBaseUrl) {
    return {
      ok: false,
      siteId: null,
      baseUrl: "",
      reason: ViewText.noMappedBaseUrlOrSiteId
    };
  }
  const sourceConfigs = configs || await config.getConfigs();
  const normalizedConfig = config.normalizeConfig(
    requestedBaseUrl,
    sourceConfigs[requestedBaseUrl]
  );
  if (!sourceConfigs[requestedBaseUrl] || normalizedConfig.changed) {
    sourceConfigs[requestedBaseUrl] = normalizedConfig.config;
    if (shouldPersist) {
      await config.saveConfigs(sourceConfigs);
    }
  }
  const existingSiteId = normalizeSiteIdValue(sourceConfigs[requestedBaseUrl].siteId);
  if (existingSiteId) {
    state.siteIdLookupByBaseUrl.set(requestedBaseUrl, existingSiteId);
    return {
      ok: true,
      siteId: existingSiteId,
      baseUrl: requestedBaseUrl,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedStageBase) {
    return {
      ok: false,
      siteId: null,
      baseUrl: requestedBaseUrl,
      reason: PopupText.configuration.stageBaseRequiredBeforeContinuing,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  if (state.siteIdLookupByBaseUrl.has(requestedBaseUrl)) {
    const cached = normalizeSiteIdValue(state.siteIdLookupByBaseUrl.get(requestedBaseUrl));
    if (cached) {
      if (shouldPersist) {
        sourceConfigs[requestedBaseUrl] = await config.updateConfig(requestedBaseUrl, (target) => {
          target.siteId = cached;
        });
      } else {
        const normalizedCached = config.normalizeConfig(
          requestedBaseUrl,
          sourceConfigs[requestedBaseUrl]
        ).config;
        normalizedCached.siteId = cached;
        sourceConfigs[requestedBaseUrl] = normalizedCached;
      }
      return {
        ok: true,
        siteId: cached,
        baseUrl: requestedBaseUrl,
        configs: sourceConfigs,
        config: sourceConfigs[requestedBaseUrl]
      };
    }
    // Cached null values should not permanently block retries.
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  const lookupResult = await resolveSiteIdFromGraphql({
    stageBase: normalizedStageBase,
    lookupUrl: requestedBaseUrl,
    tokenValue
  });
  if (!lookupResult.ok) {
    return {
      ok: false,
      siteId: null,
      baseUrl: requestedBaseUrl,
      reason: PopupText.status.unableToResolveDomainId,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  const resolvedBaseUrl =
    utils.normalizeCanonicalBaseUrl(lookupResult.baseUrl) ||
    utils.normalizeBaseUrl(lookupResult.baseUrl) ||
    requestedBaseUrl;
  const resolvedSiteId = normalizeSiteIdValue(lookupResult.siteId);
  if (!resolvedSiteId) {
    return {
      ok: false,
      siteId: null,
      baseUrl: resolvedBaseUrl,
      reason: ViewText.noDomainIdForBaseUrl,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  state.siteIdLookupByBaseUrl.set(resolvedBaseUrl, resolvedSiteId);
  if (requestedBaseUrl !== resolvedBaseUrl) {
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  let didChangeConfigs = false;
  if (requestedBaseUrl !== resolvedBaseUrl) {
    const mergedConfig = mergeConfigEntriesForResolvedBaseUrl(
      resolvedBaseUrl,
      sourceConfigs[requestedBaseUrl],
      sourceConfigs[resolvedBaseUrl]
    );
    sourceConfigs[resolvedBaseUrl] = mergedConfig;
    if (Object.prototype.hasOwnProperty.call(sourceConfigs, requestedBaseUrl)) {
      delete sourceConfigs[requestedBaseUrl];
    }
    didChangeConfigs = true;
  } else {
    const normalizedCurrent = config.normalizeConfig(
      resolvedBaseUrl,
      sourceConfigs[resolvedBaseUrl]
    );
    if (
      !sourceConfigs[resolvedBaseUrl] ||
      normalizedCurrent.changed ||
      normalizeSiteIdValue(normalizedCurrent.config.siteId) !== resolvedSiteId
    ) {
      sourceConfigs[resolvedBaseUrl] = normalizedCurrent.config;
      didChangeConfigs = true;
    }
  }
  const resolvedConfig = config.normalizeConfig(
    resolvedBaseUrl,
    sourceConfigs[resolvedBaseUrl]
  ).config;
  if (normalizeSiteIdValue(resolvedConfig.siteId) !== resolvedSiteId) {
    resolvedConfig.siteId = resolvedSiteId;
    sourceConfigs[resolvedBaseUrl] = resolvedConfig;
    didChangeConfigs = true;
  }
  if (shouldPersist && didChangeConfigs) {
    await config.saveConfigs(sourceConfigs);
  }
  return {
    ok: true,
    siteId: resolvedSiteId,
    baseUrl: resolvedBaseUrl,
    configs: sourceConfigs,
    config: sourceConfigs[resolvedBaseUrl]
  };
}

function createConfigSyncHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function maybeUpdateStoredTokenFromResponse(response, currentToken = "") {
  if (!response || !response.headers || typeof response.headers.get !== "function") {
    return currentToken || "";
  }
  const updatedToken = (response.headers.get("x-update-token") || "").trim();
  if (!updatedToken) {
    return currentToken || "";
  }
  if (updatedToken === (currentToken || "")) {
    return updatedToken;
  }
  try {
    await utils.storageSet(chrome.storage.sync, { globalToken: updatedToken });
  } catch {
    // Ignore storage update errors so the calling request flow continues.
  }
  return updatedToken;
}

function formatSyncStatusTimestamp(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch (error) {
    return "";
  }
}

function getConfigLoadStatusTone(status) {
  switch (status) {
    case "ok":
      return "success";
    case "not_found":
    case "auth_error":
      return "warning";
    case "error":
      return "danger";
    case "skipped":
    default:
      return "muted";
  }
}

function getConfigSaveStatusTone(label) {
  switch (label) {
    case PopupText.page.savedAndSynced:
    case PopupText.page.revertedAndSynced:
    case PopupText.ai.selectorsUpdatedAndSynced:
    case PopupText.ai.submittedSelectors:
    case PopupText.ai.submittedSelectorsAndSynced:
      return "success";
    case PopupText.page.savedLocallySyncSkipped:
    case PopupText.page.revertedLocallySyncSkipped:
    case PopupText.ai.selectorsUpdatedLocallySyncSkipped:
    case PopupText.ai.submittedSelectorsSyncSkipped:
      return "warning";
    case PopupText.page.saveFailed:
    case PopupText.page.revertFailed:
    case PopupText.page.savedLocallySyncFailed:
    case PopupText.page.revertedLocallySyncFailed:
    case PopupText.ai.selectorsUpdatedLocallySyncFailed:
    case PopupText.ai.submittedSelectorsSyncFailed:
      return "danger";
    case PopupText.page.noLocalChangesToSave:
    case PopupText.sync.unknown:
    default:
      return "muted";
  }
}

function updateLastConfigLoadStatus(result) {
  const status = result && typeof result.status === "string" ? result.status : "";
  const baseUrl = result && typeof result.baseUrl === "string" ? result.baseUrl : "";
  const label = formatConfigLoadStatusLabel(status, baseUrl);
  state.lastConfigLoadStatusTone = getConfigLoadStatusTone(status);
  if (status === "skipped") {
    state.lastConfigLoadStatusText = label;
    return;
  }
  const at = formatSyncStatusTimestamp();
  state.lastConfigLoadStatusText = formatTimestampedStatus(label, at);
}

function updateLastConfigSaveStatus(label) {
  const safeLabel = typeof label === "string" && label ? label : PopupText.sync.unknown;
  state.lastConfigSaveStatusTone = getConfigSaveStatusTone(safeLabel);
  const at = formatSyncStatusTimestamp();
  state.lastConfigSaveStatusText = formatTimestampedStatus(safeLabel, at);
}

function isSuccessfulConfigSyncResult(syncResult) {
  return Boolean(syncResult && (syncResult.ok || syncResult.skipped));
}

function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isRetryableHttpStatus(status) {
  if (!Number.isFinite(status) || status <= 0) {
    return true;
  }
  return RETRYABLE_HTTP_STATUSES.has(status);
}

function getRetryDelayMs(attempt, baseDelayMs = 450, maxDelayMs = 10000) {
  const boundedAttempt = Math.max(0, Number(attempt) || 0);
  const exponentialDelay = Math.min(baseDelayMs * (2 ** boundedAttempt), maxDelayMs);
  const jitter = Math.round(exponentialDelay * (0.1 + (Math.random() * 0.2)));
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function clearRemoteConfigRetryTimer() {
  if (!state.remoteConfigConnectionRetryTimer) {
    return;
  }
  window.clearTimeout(state.remoteConfigConnectionRetryTimer);
  state.remoteConfigConnectionRetryTimer = 0;
}

function setRemoteConfigConnectionIssue(active) {
  const nextActive = Boolean(active);
  state.remoteConfigConnectionIssue = nextActive;
  if (!nextActive) {
    clearRemoteConfigRetryTimer();
  }
}

function setPreviewBlocked(active, message = ViewText.previewBlockedDefault) {
  uiModule.setPreviewBlocked(active, message);
}

function scheduleRemoteConfigRetry() {
  if (state.remoteConfigConnectionRetryTimer) {
    return;
  }
  state.remoteConfigConnectionRetryTimer = window.setTimeout(async () => {
    state.remoteConfigConnectionRetryTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi();
  }, REMOTE_CONFIG_RETRY_DELAY_MS);
}

function normalizeRenderModeDetectionResult(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const accuracy = Number(payload.accuracy);
  if (!Number.isFinite(accuracy)) {
    return "";
  }
  if (accuracy < RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY) {
    return "unsure";
  }
  if (typeof payload.rendered !== "boolean") {
    return "";
  }
  return payload.rendered ? "rendered" : "static";
}

async function detectRenderModeViaEndpoint(options = {}) {
  const {
    endpointValue = "",
    tokenValue = "",
    rawHtml = "",
    renderedHtml = ""
  } = options;
  if (!endpointValue || !rawHtml || !renderedHtml) {
    return { ok: false, result: "" };
  }
  const detectUrl = resolveRelativeEndpoint(endpointValue, "/is_js_rendered");
  if (!detectUrl) {
    return { ok: false, result: "" };
  }
  for (let attempt = 0; attempt < RENDER_MODE_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(detectUrl, {
        method: "POST",
        headers: createConfigSyncHeaders(tokenValue),
        body: JSON.stringify({
          rawHtml,
          renderedHtml
        })
      });
      await maybeUpdateStoredTokenFromResponse(response, tokenValue);
      if (!response.ok) {
        if (
          attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS &&
          isRetryableHttpStatus(response.status)
        ) {
          await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "" };
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      const result = normalizeRenderModeDetectionResult(payload);
      if (!result) {
        return { ok: false, result: "" };
      }
      return { ok: true, result };
    } catch (error) {
      if (attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS) {
        await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
        continue;
      }
      return { ok: false, result: "" };
    }
  }
  return { ok: false, result: "" };
}

function buildRemoteConfigLoadKey(tabId, siteId, endpointValue) {
  return `${tabId || ""}|${siteId || ""}|${endpointValue || ""}`;
}

function mergeSelectorFieldIntoConfig(targetConfig, incomingConfig, selectorField) {
  if (!targetConfig || typeof targetConfig !== "object") {
    return false;
  }
  const timestampField = config.getSelectorSetTimestampFieldName(selectorField);
  if (!timestampField) {
    return false;
  }
  const merged = config.mergeSelectorSetsByTimestamp(
    targetConfig[selectorField],
    targetConfig[timestampField],
    incomingConfig && typeof incomingConfig === "object" ? incomingConfig[selectorField] : null,
    incomingConfig && typeof incomingConfig === "object" ? incomingConfig[timestampField] : null
  );
  const currentSelectorSet = normalizeAiSelectorSet(targetConfig[selectorField]);
  const currentUpdatedAt = config.normalizeEntryTimestamp(targetConfig[timestampField]);
  const didChange =
    !aiSelectorSetsEqual(currentSelectorSet, merged.selectorSet) ||
    currentUpdatedAt !== merged.updatedAt;
  if (didChange) {
    targetConfig[selectorField] = merged.selectorSet;
    targetConfig[timestampField] = merged.updatedAt;
  }
  return didChange;
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
  const mergedRenderMode = config.mergeRenderModeByTimestamp(
    localConfig.renderMode,
    localConfig.renderModeUpdatedAt,
    normalizedPayload.renderMode,
    normalizedPayload.renderModeUpdatedAt
  );
  const renderModeChanged =
    config.getConfigRenderMode(localConfig) !== mergedRenderMode.renderMode ||
    config.normalizeEntryTimestamp(localConfig.renderModeUpdatedAt) !== mergedRenderMode.updatedAt;
  if (renderModeChanged) {
    localConfig.renderMode = mergedRenderMode.renderMode;
    localConfig.renderModeUpdatedAt = mergedRenderMode.updatedAt;
  }
  const mergeResult = config.mergePageMarkingsByTimestamp(
    localConfig.pageMarkings,
    normalizedPayload.pageMarkings
  );
  localConfig.pageMarkings = mergeResult.pageMarkings;
  let selectorStateChanged = false;
  selectorStateChanged =
    mergeSelectorFieldIntoConfig(localConfig, normalizedPayload, "latestComputedSelectors") ||
    selectorStateChanged;
  selectorStateChanged =
    mergeSelectorFieldIntoConfig(localConfig, normalizedPayload, "lastSavedSelectors") ||
    selectorStateChanged;
  selectorStateChanged =
    mergeSelectorFieldIntoConfig(localConfig, normalizedPayload, "domainAiSelectorSet") ||
    selectorStateChanged;
  const shouldSave =
    !existingRaw ||
    normalizedLocal.changed ||
    siteIdChanged ||
    renderModeChanged ||
    selectorStateChanged ||
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
  if (!tabId || !siteId || !endpointValue || !tokenValue) {
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
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      await invalidateTokenAndLockConfiguration(true);
      const result = { status: "auth_error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
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
      window.alert(PopupText.alerts.newerRemoteDataReplacedLocal);
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
  let currentTokenValue = tokenValue || "";
  let currentBaseUrl = baseUrl;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const allConfigs = await config.getConfigs();
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: currentBaseUrl,
      stageBase,
      tokenValue: currentTokenValue,
      configs: allConfigs
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      return { ok: false, skipped: true, reason: siteIdResult.reason || PopupText.status.missingSiteId };
    }
    const resolvedBaseUrl = siteIdResult.baseUrl || baseUrl;
    currentBaseUrl = resolvedBaseUrl;
    const workingConfigs = siteIdResult.configs || allConfigs;
    try {
      const latestStoredToken = await utils.storageGet(chrome.storage.sync, "globalToken");
      const refreshedToken =
        latestStoredToken && typeof latestStoredToken.globalToken === "string"
          ? latestStoredToken.globalToken.trim()
          : "";
      if (refreshedToken) {
        currentTokenValue = refreshedToken;
      }
    } catch {
      // Ignore token refresh read errors; continue with the current in-memory token.
    }
    const normalized = config.normalizeConfig(resolvedBaseUrl, workingConfigs[resolvedBaseUrl]);
    const sourceConfig = normalized.config;
    if (!workingConfigs[resolvedBaseUrl] || normalized.changed) {
      workingConfigs[resolvedBaseUrl] = sourceConfig;
      await config.saveConfigs(workingConfigs);
    }
    const payload = config.createConfigSyncPayload(resolvedBaseUrl, sourceConfig);
    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: createConfigSyncHeaders(currentTokenValue),
        body: JSON.stringify(payload)
      });
      currentTokenValue = await maybeUpdateStoredTokenFromResponse(
        response,
        currentTokenValue
      );
      if (!response.ok) {
        lastStatus = response.status || 0;
        if (attempt + 1 < attempts && isRetryableHttpStatus(lastStatus)) {
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
        window.alert(PopupText.alerts.newerRemoteDataReplacedLocal);
      }
      return {
        ok: true,
        replacedCurrentPage: mergeResult.replacedCurrentPage,
        baseUrl: resolvedBaseUrl
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
    loginStatusText: PopupText.authentication.statusLoginRequired,
    loginStatusTone: "warning"
  });
  if (showToast) {
    uiModule.showToast(PopupText.authentication.toastExpired);
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
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
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

function getEditableFieldState(options) {
  const {
    inputRef,
    currentValue,
    value,
    isSet,
    editMode,
    suggestedValue,
    preserveCurrentValueWhileEditing = false,
    noticeUnset,
    noticeEdit
  } = options;
  const isEditing = !isSet || editMode;
  const isFocused = inputRef && document.activeElement === inputRef;
  let nextValue = typeof currentValue === "string" ? currentValue : "";

  if (!isEditing) {
    nextValue = value || "";
  } else if (!preserveCurrentValueWhileEditing && !isFocused) {
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

function isCurrentRenderModeReady() {
  return Boolean(
    state.currentBaseUrl &&
    state.currentBaseUrlHasConfirmedRenderMode &&
    !state.renderModeEditMode
  );
}

function getLatestComputedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "latestComputedSelectors")) {
    return normalizeAiSelectorSet(null);
  }
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.latestComputedSelectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "lastSavedSelectors")) {
    return normalizeAiSelectorSet(null);
  }
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.lastSavedSelectors);
}

function getLatestAvailableSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return config.getNewestConfigSelectorSet(sourceConfig).selectorSet;
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

async function loadGlobalSilentHighlightOptions() {
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalSilentHighlightOptions"
  ]);
  return normalizeSilentHighlightOptions(
    stored && stored.globalSilentHighlightOptions
  );
}

function getSilentHighlightVisibilityKey(visibility) {
  return `${visibility.markedPages ? "1" : "0"}${visibility.includedContent ? "1" : "0"}${visibility.excludedContent ? "1" : "0"}${visibility.visibleConsent ? "1" : "0"}${visibility.hideDuringScrollRedraw ? "1" : "0"}`;
}

async function persistSilentHighlightVisibility() {
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const visibility = getSilentHighlightVisibility();
  await utils.storageSet(chrome.storage.sync, {
    globalSilentHighlightOptions: visibility
  });
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
  const pageUrl = (state.currentTab && state.currentTab.url) || "";
  if (
    !force &&
    state.lastAppliedSilentHighlightTabId === tabId &&
    state.lastAppliedSilentHighlightKey === key &&
    state.lastAppliedSilentHighlightPageUrl === pageUrl
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
    state.lastAppliedSilentHighlightPageUrl = pageUrl;
  }
}

function readCheckboxValue(event, fallbackValue) {
  const target = event && (event.currentTarget || event.target);
  if (!target || typeof target.checked !== "boolean") {
    return fallbackValue;
  }
  return Boolean(target.checked);
}

async function refreshUiInner() {
  if (!state.currentTab) {
    return;
  }
  const previousBaseUrl = state.currentBaseUrl;
  await validateStoredToken({ force: false, showToastOnInvalid: true });
  const currentTabId = state.currentTab.id || null;
  const tabChanged = Boolean(currentTabId && state.lastTabId !== currentTabId);
  if (tabChanged) {
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
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
  }
  state.lastPopupPageUrl = pageUrl;
  if (state.lastAppliedSilentHighlightTabId !== currentTabId) {
    state.lastAppliedSilentHighlightTabId = currentTabId;
    state.lastAppliedSilentHighlightKey = "";
    state.lastAppliedSilentHighlightPageUrl = "";
  }
  state.lastTabId = currentTabId;
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const globalSilentHighlightOptions = await loadGlobalSilentHighlightOptions();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
  const tabState =
    (await utils.getTabState(state.currentTab.id)) || { enabled: false, baseUrl: "" };
  let initialTabState = currentTabId
    ? (await utils.getTabState(currentTabId, "initial")) || { active: false }
    : { active: false };
  if (
    currentTabId &&
    !(initialTabState && initialTabState.active) &&
    utils.getOriginFromUrl(pageUrl)
  ) {
    await utils.setTabState(currentTabId, { active: true }, "initial");
    initialTabState = { active: true };
  }
  const tabInScope = Boolean(
    (initialTabState && initialTabState.active) ||
      utils.getOriginFromUrl(pageUrl)
  );
  const previewState = tabInScope
    ? await messages.sendTabMessage({ type: "getAiPreviewState" })
    : null;
  const previewActive = Boolean(previewState && previewState.active);
  const previewCollapsed = Boolean(previewState && previewState.collapsed);
  let localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  let hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
  let discoveredBaseUrlFromGraphql = "";
  let currentSiteId = null;
  let siteIdBlockedReason = "";
  let unsupportedByGraphql = false;
  let remoteLoadResult = { status: "skipped", baseUrl: "" };
  let effectiveTabState = tabState;
  if (
    tabInScope &&
    tabState.baseUrl &&
    pageUrl &&
    !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl)
  ) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
  }
  const silentHighlightOptions = normalizeSilentHighlightOptions({
    ...globalSilentHighlightOptions,
    ...(
      tabState &&
      tabState.silentHighlightOptions &&
      typeof tabState.silentHighlightOptions === "object"
        ? tabState.silentHighlightOptions
        : {}
    )
  });
  state.silentHighlightShowMarkedPages = silentHighlightOptions.markedPages;
  state.silentHighlightShowIncludedContent = silentHighlightOptions.includedContent;
  state.silentHighlightShowExcludedContent = silentHighlightOptions.excludedContent;
  state.silentHighlightShowVisibleConsent = silentHighlightOptions.visibleConsent;
  state.silentHighlightHideDuringScrollRedraw = silentHighlightOptions.hideDuringScrollRedraw;
  if (
    tabInScope &&
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
        discoveredBaseUrlFromGraphql = discoveredBaseUrl;
        localMatchingBaseUrl = discoveredBaseUrl;
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
          const persistedMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
          localMatchingBaseUrl =
            persistedMatchingBaseUrl || discoveredBaseUrlFromGraphql || localMatchingBaseUrl;
          hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
        }
      }
    } else if (discoveryResult && discoveryResult.ok && discoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  const fallbackBaseUrl = tabInScope ? localMatchingBaseUrl : "";
  state.currentBaseUrl = tabInScope
    ? (effectiveTabState.baseUrl || fallbackBaseUrl || "")
    : "";
  if (state.currentBaseUrl) {
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (configs[state.currentBaseUrl] && normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
    }
    state.currentConfig = configs[state.currentBaseUrl] || normalized.config;
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: state.currentBaseUrl,
      stageBase: normalizedStageBaseValue,
      tokenValue,
      configs,
      persist: false
    });
    if (siteIdResult.ok && siteIdResult.siteId) {
      const resolvedBaseUrl = siteIdResult.baseUrl || state.currentBaseUrl;
      configs = siteIdResult.configs || configs;
      if (resolvedBaseUrl && resolvedBaseUrl !== state.currentBaseUrl) {
        state.currentBaseUrl = resolvedBaseUrl;
        if (currentTabId) {
          effectiveTabState = { ...effectiveTabState, baseUrl: resolvedBaseUrl };
          await utils.setTabState(currentTabId, effectiveTabState);
          if (effectiveTabState.enabled) {
            await messages.sendTabMessageWithRetry({
              type: "setEnabled",
              enabled: true,
              baseUrl: resolvedBaseUrl
            });
          }
        }
      }
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
  const remoteConfigConnectionIssue = Boolean(
    configEndpointValue &&
      state.currentBaseUrl &&
      remoteLoadResult &&
      remoteLoadResult.status === "error"
  );
  setRemoteConfigConnectionIssue(remoteConfigConnectionIssue);
  if (remoteConfigConnectionIssue) {
    scheduleRemoteConfigRetry();
  }
  if (
    remoteLoadResult &&
    remoteLoadResult.status === "not_found" &&
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite &&
    !currentSiteId
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
  if (
    !unsupportedByGraphql &&
    !state.currentBaseUrl &&
    tabInScope &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const fallbackDiscoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      fallbackDiscoveryResult &&
      fallbackDiscoveryResult.ok &&
      fallbackDiscoveryResult.siteId &&
      fallbackDiscoveryResult.baseUrl
    ) {
      const fallbackBaseUrl =
        utils.normalizeCanonicalBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        utils.normalizeBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        fallbackDiscoveryResult.baseUrl;
      const fallbackSiteId = normalizeSiteIdValue(fallbackDiscoveryResult.siteId);
      if (fallbackBaseUrl && fallbackSiteId) {
        state.siteIdLookupByBaseUrl.set(fallbackBaseUrl, fallbackSiteId);
        state.currentBaseUrl = fallbackBaseUrl;
        currentSiteId = fallbackSiteId;
        state.currentConfig = config.normalizeConfig(
          fallbackBaseUrl,
          configs[fallbackBaseUrl]
        ).config;
      }
    } else if (fallbackDiscoveryResult && fallbackDiscoveryResult.ok && fallbackDiscoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  if (state.currentBaseUrl !== previousBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
    state.basePageMenuOpen = false;
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
  }
  const persistedConfigs = await config.getConfigs();
  state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
    persistedConfigs,
    state.currentBaseUrl
  );
  let suggestedRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (tabInScope && state.currentBaseUrl && state.currentConfig && pageUrl) {
    suggestedRenderMode = await maybeAutoDetectRenderMode(pageUrl);
    configs = await config.getConfigs();
    state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
      configs,
      state.currentBaseUrl
    );
  } else {
    state.currentBaseUrlHasConfirmedRenderMode = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
  }

  const view = uiModule.getViewState();
  const refs = uiModule.getRefs();
  const nextViewState = {
    currentPageUrl: pageUrl || ViewText.unavailable,
    currentBaseUrl: state.currentBaseUrl,
    configMenuOpen: state.configMenuOpen,
    basePageMenuOpen: state.basePageMenuOpen,
    previewBlocked: previewActive,
    previewBlockedMessage: previewActive
      ? previewCollapsed
        ? PopupText.preview.blockedHidden
        : PopupText.preview.blockedActive
      : ViewText.previewBlockedDefault
  };
  const baseUrlReady = Boolean(state.currentBaseUrl);
  const baseField = {
    value: state.currentBaseUrl || "",
    isEditing: false,
    noticeText: baseUrlReady
      ? ""
      : ViewText.baseUrlAutoResolvedNotice,
    noticeVisible: !baseUrlReady
  };
  if (!tabInScope) {
    baseField.noticeText = ViewText.openOnCurrentTabNotice;
    baseField.noticeVisible = true;
  }
  const extensionEnabledForTab = Boolean(
    tabInScope &&
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      utils.isPageWithinBaseUrl(pageUrl, effectiveTabState.baseUrl)
  );
  let toggleEnabled = extensionEnabledForTab;
  if (state.lastPopupEnabled !== null) {
    toggleEnabled = state.lastPopupEnabled;
    if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
      state.lastPopupEnabled = null;
    }
  }
  let isEnabled = toggleEnabled;
  const storedDeviceState = currentTabId
    ? await emulation.reconcileDeviceEmulationState(currentTabId)
    : {
        enabled: state.currentDeviceEmulationEnabled,
        mode: state.currentDeviceMode,
        scale: state.currentDeviceScale
      };
  const normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
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
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.endpointNoticeUnset,
    noticeEdit: PopupText.configuration.endpointNoticeEdit
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
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.aiEndpointNoticeUnset,
    noticeEdit: PopupText.configuration.aiEndpointNoticeEdit
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
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.stageBaseNoticeUnset,
    noticeEdit: PopupText.configuration.stageBaseNoticeEdit
  });
  const stageBaseReady = stageBaseField.isReady;
  const loginCredentialsEnabled = stageBaseReady;
  const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (!state.currentBaseUrlHasConfirmedRenderMode) {
    state.renderModeEditMode = false;
  }
  const siteIdReady = Boolean(
    currentSiteId || normalizeSiteIdValue(state.currentConfig && state.currentConfig.siteId)
  );
  const effectiveSiteIdBlockedReason = unsupportedByGraphql
    ? siteIdBlockedReason || PopupText.status.noMappedBaseUrlFound
    : !tabInScope
      ? ViewText.openOnCurrentTabNotice
    : baseUrlReady && !siteIdReady
      ? siteIdBlockedReason || ViewText.noDomainIdForBaseUrl
      : "";
  const renderModeSet = state.currentBaseUrlHasConfirmedRenderMode;
  const renderModeField = getEditableFieldState({
    inputRef: refs.renderModeSelect,
    currentValue: view.renderModeValue,
    value: currentRenderMode,
    isSet: renderModeSet,
    editMode: state.renderModeEditMode,
    suggestedValue: suggestedRenderMode,
    noticeUnset: PopupText.renderMode.noticeUnset,
    noticeEdit: PopupText.renderMode.noticeEdit
  });
  const renderModeRequired =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady;
  const renderModeWarningKey = `${state.currentBaseUrl || ""}|${pageUrl || ""}`;
  const renderModeWarningVisible =
    renderModeRequired &&
    !state.currentBaseUrlHasConfirmedRenderMode &&
    state.renderModeDetectionUnsure &&
    state.renderModeWarningDismissedKey !== renderModeWarningKey;
  const renderModeValueUndetermined = isUndeterminedRenderMode(renderModeField.value);
  const renderModeReady = !renderModeRequired || renderModeField.isReady;
  let renderModeNoticeText = renderModeField.noticeText;
  let renderModeNoticeVisible = renderModeField.noticeVisible;
  if (!renderModeRequired) {
    renderModeNoticeText = !tabInScope
      ? PopupText.renderMode.noticeOpenOnCurrentTab
      : unsupportedByGraphql
        ? PopupText.renderMode.noticeUnmappedPage
        : !baseUrlReady || !siteIdReady
          ? PopupText.renderMode.noticeRequiresSiteMapping
          : "";
    renderModeNoticeVisible = Boolean(renderModeNoticeText);
  } else if (state.renderModeDetectionInFlight) {
    renderModeNoticeText = PopupText.renderMode.noticeDetecting;
    renderModeNoticeVisible = true;
  } else if (state.renderModeDetectionUnsure) {
    renderModeNoticeText = PopupText.renderMode.noticeAutoDetectFailed;
    renderModeNoticeVisible = true;
  }

  const configurationComplete =
    configEndpointReady &&
    endpointReady &&
    stageBaseReady &&
    Boolean(tokenValue);
  const aiReady =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady &&
    endpointReady &&
    Boolean(tokenValue) &&
    renderModeReady;
  isEnabled = toggleEnabled && siteIdReady && renderModeReady;
  if (tabInScope && toggleEnabled && (!siteIdReady || !renderModeReady) && currentTabId) {
    toggleEnabled = false;
    isEnabled = false;
    state.lastPopupEnabled = null;
    effectiveTabState = { ...effectiveTabState, enabled: false };
    await utils.setTabState(currentTabId, {
      enabled: false,
      baseUrl: state.currentBaseUrl || effectiveTabState.baseUrl || "",
      silentHighlightOptions: silentHighlightOptions
    });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  const latestComputed = getLatestComputedSelectorsFromConfig();
  const latestAvailableSelectors = getLatestAvailableSelectorsFromConfig();
  const lastSaved = getLastSubmittedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(latestComputed).length;
  const hasNewSelectors =
    selectorCount > 0 &&
    !aiSelectorSetsEqual(latestComputed, lastSaved);
  if (!hasNewSelectors && state.aiSelectorsComputedBaseUrl === state.currentBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
  }
  const selectorsReadyForSubmit = hasNewSelectors;
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = combineAiSelectorSet(latestAvailableSelectors).length > 0;

  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
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
        (typeof savedEntry.renderedHtml === "string" &&
          savedEntry.renderedHtml.length > 0))
  );
  const hasSavedAiSubmissionSnapshot = Boolean(
    savedEntry &&
      typeof savedEntry.renderedHtml === "string" &&
      savedEntry.renderedHtml.length > 0 &&
      Array.isArray(savedEntry.submissionXpaths) &&
      savedEntry.submissionXpaths.length > 0
  );
  const needsAiSnapshotBackfill =
    hasSavedPageData && !hasSavedAiSubmissionSnapshot;
  const aiBlockedByDraft = state.currentDraftDirty;
  const aiBlockedByMissingSavedSnapshot =
    isEnabled &&
    baseUrlReady &&
    siteIdReady &&
    state.currentDraftAvailable &&
    !state.currentDraftDirty &&
    !hasSavedAiSubmissionSnapshot;

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
  nextViewState.configurationContinueDisabled = !configurationComplete;
  nextViewState.configurationNoticeVisible =
    !configurationComplete ||
    state.remoteConfigConnectionIssue;
  nextViewState.configurationNoticeText = state.remoteConfigConnectionIssue
    ? PopupText.configuration.remoteConfigRetryNotice
    : configurationComplete
      ? ""
      : PopupText.configuration.continueSetupNotice;

  const pageScopedUiDisabled =
    unsupportedByGraphql ||
    !tabInScope ||
    state.remoteConfigConnectionIssue;
  const configurationUiDisabled = aiBusy || state.remoteConfigConnectionIssue;
  nextViewState.toggleEnabled = pageScopedUiDisabled ? false : isEnabled;
  nextViewState.toggleEnabledDisabled =
    pageScopedUiDisabled || !baseUrlReady || !siteIdReady || !renderModeReady;
  nextViewState.mainUiHidden =
    pageScopedUiDisabled || !isEnabled || !siteIdReady || !renderModeReady;
  nextViewState.computeButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    aiBlockedByDraft ||
    aiBlockedByMissingSavedSnapshot;
  nextViewState.saveExcludesButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    !selectorsReadyForSubmit ||
    aiBlockedByDraft;
  nextViewState.previewLatestButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady ||
    !hasStoredSelectors ||
    aiBlockedByDraft;
  nextViewState.renderModeReady = renderModeRequired && renderModeField.isReady;
  nextViewState.renderModeValue = renderModeField.value;
  nextViewState.renderModeReadOnly = !renderModeField.isEditing;
  nextViewState.renderModeSetVisible = renderModeRequired && renderModeField.isEditing;
  nextViewState.renderModeEditVisible = renderModeSet && renderModeRequired;
  nextViewState.renderModeEditText = state.renderModeEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.renderModeNoticeText = renderModeNoticeText;
  nextViewState.renderModeNoticeVisible = renderModeNoticeVisible;
  nextViewState.renderModeUndeterminedVisible =
    renderModeValueUndetermined || state.renderModeDetectionUnsure;
  nextViewState.renderModeWarningVisible = renderModeWarningVisible;
  nextViewState.renderModeWarningAcknowledgeChecked =
    renderModeWarningVisible ? Boolean(view.renderModeWarningAcknowledgeChecked) : false;
  nextViewState.renderModeWarningOkDisabled =
    !nextViewState.renderModeWarningAcknowledgeChecked;
  nextViewState.renderModeInputDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeSetDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    renderModeValueUndetermined ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeEditDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeSummaryTitle =
    renderModeSet
      ? currentRenderMode === config.RENDER_MODE_RENDERED
        ? PopupText.renderMode.summaryTitleRendered
        : PopupText.renderMode.summaryTitleStatic
      : PopupText.renderMode.title;
  nextViewState.renderModeSummaryOpen =
    !renderModeSet || state.renderModeEditMode || state.renderModeSummaryOpen;
  nextViewState.stageBaseValue = stageBaseField.value;
  nextViewState.stageBaseReadOnly = !stageBaseField.isEditing;
  nextViewState.stageBaseSetVisible = stageBaseField.isEditing;
  nextViewState.stageBaseEditVisible = stageBaseSet;
  nextViewState.stageBaseEditText = state.stageBaseEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.stageBaseNoticeText = stageBaseField.noticeText;
  nextViewState.stageBaseNoticeVisible = stageBaseField.noticeVisible;
  nextViewState.stageBaseInputDisabled = configurationUiDisabled;
  nextViewState.stageBaseSetDisabled = configurationUiDisabled;
  nextViewState.stageBaseEditDisabled = configurationUiDisabled;
  nextViewState.loginEmailValue = loginEmailValue;
  nextViewState.loginPasswordValue = loginPasswordValue;
  nextViewState.loginCredentialsDisabled =
    configurationUiDisabled || !loginCredentialsEnabled;
  nextViewState.loginStatusText = tokenValue
    ? PopupText.authentication.statusTokenSaved
    : PopupText.authentication.statusLoginRequired;
  nextViewState.loginStatusTone = tokenValue ? "success" : "warning";
  nextViewState.loginActionDisabled =
    configurationUiDisabled ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
  nextViewState.configEndpointUrlValue = configEndpointField.value;
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
  nextViewState.configEndpointEditVisible = configEndpointSet;
  nextViewState.configEndpointEditText = state.configEndpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
  nextViewState.configEndpointInputDisabled = configurationUiDisabled;
  nextViewState.configEndpointSetDisabled = configurationUiDisabled;
  nextViewState.configEndpointEditDisabled = configurationUiDisabled;

  nextViewState.endpointUrlValue = endpointField.value;
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
  nextViewState.endpointSetVisible = endpointField.isEditing;
  nextViewState.endpointEditVisible = endpointSet;
  nextViewState.endpointEditText = state.endpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.endpointNoticeText = endpointField.noticeText;
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
  nextViewState.endpointInputDisabled = configurationUiDisabled;
  nextViewState.endpointSetDisabled = configurationUiDisabled;
  nextViewState.endpointEditDisabled = configurationUiDisabled;
  nextViewState.clearDomainCacheDisabled = state.clearDomainCacheDisabled;
  nextViewState.unregisterCurrentTabDisabled =
    state.unregisterCurrentTabDisabled || !state.currentTab || !state.currentTab.id;
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute"
      ? ViewText.computeButtonBusy
      : ViewText.computeButtonIdle;
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save"
      ? ViewText.saveExcludesBusy
      : ViewText.saveExcludesIdle;
  nextViewState.computeButtonLoading = state.aiRequestInFlight === "compute";
  nextViewState.saveExcludesButtonLoading = state.aiRequestInFlight === "save";
  nextViewState.aiControlsBusy = aiBusy;
  nextViewState.aiDirtyNoticeVisible = aiBlockedByDraft || aiBlockedByMissingSavedSnapshot;
  nextViewState.cssSelectorsVisible =
    !pageScopedUiDisabled &&
    resolvedView === uiModule.View.Marking &&
    renderModeReady;
  const highlightingMode =
    resolvedView === uiModule.View.Marking && !isEnabled;
  nextViewState.highlightingOptionsVisible =
    !pageScopedUiDisabled && highlightingMode && renderModeReady;
  nextViewState.highlightMarkedPagesChecked = state.silentHighlightShowMarkedPages;
  nextViewState.highlightIncludedContentChecked = state.silentHighlightShowIncludedContent;
  nextViewState.highlightExcludedContentChecked = state.silentHighlightShowExcludedContent;
  nextViewState.highlightVisibleConsentChecked = state.silentHighlightShowVisibleConsent;
  nextViewState.highlightHideDuringScrollRedrawChecked =
    state.silentHighlightHideDuringScrollRedraw;
  nextViewState.baseUrlInputValue = baseField.value;
  nextViewState.baseUrlNoticeText =
    state.remoteConfigConnectionIssue
      ? PopupText.status.remoteConfigRetryNotice
      : effectiveSiteIdBlockedReason || baseField.noticeText;
  nextViewState.baseUrlNoticeVisible =
    state.remoteConfigConnectionIssue ||
    Boolean(effectiveSiteIdBlockedReason) ||
    baseField.noticeVisible;
  const pageControlsVisible = !nextViewState.mainUiHidden && nextViewState.renderModeReady;
  const canInitialPageSave = !hasSavedPageData;
  const pageSaveDisabled =
    !pageControlsVisible ||
    !state.currentDraftAvailable ||
    mobileSimulationBlocked ||
    (!state.currentDraftDirty && !canInitialPageSave && !needsAiSnapshotBackfill);
  nextViewState.pageSaveDisabled = pageSaveDisabled;
  nextViewState.pageSaveMobileSimulationRequiredVisible =
    pageControlsVisible &&
    mobileSimulationBlocked &&
    state.currentDraftAvailable &&
    (state.currentDraftDirty || canInitialPageSave || needsAiSnapshotBackfill);
  nextViewState.pageSaveMobileSimulationRequiredText =
    PopupText.page.mobileSimulationRequired;
  nextViewState.pageRevertDisabled =
    !pageControlsVisible ||
    !state.currentDraftAvailable ||
    !hasSavedPageData ||
    !state.currentDraftDirty;
  let pageDraftStatusTone = "muted";
  if (!pageControlsVisible) {
    nextViewState.pageDraftStatusText = "";
  } else if (!state.currentDraftAvailable) {
    nextViewState.pageDraftStatusText = PopupText.page.statusDraftUnavailable;
    pageDraftStatusTone = "warning";
  } else if (!hasSavedPageData) {
    nextViewState.pageDraftStatusText = PopupText.page.statusNoSavedData;
    pageDraftStatusTone = "muted";
  } else if (state.currentDraftDirty) {
    nextViewState.pageDraftStatusText = PopupText.page.statusUnsavedChanges;
    pageDraftStatusTone = "warning";
  } else if (needsAiSnapshotBackfill) {
    nextViewState.pageDraftStatusText = PopupText.page.statusNeedsAiSnapshot;
    pageDraftStatusTone = "warning";
  } else {
    nextViewState.pageDraftStatusText = PopupText.page.statusAllChangesSaved;
    pageDraftStatusTone = "success";
  }
  nextViewState.pageDraftStatusTone = pageDraftStatusTone;
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || ViewText.syncLoadIdle;
  nextViewState.syncLoadStatusTone = state.lastConfigLoadStatusTone || "muted";
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || ViewText.syncSaveIdle;
  nextViewState.syncSaveStatusTone = state.lastConfigSaveStatusTone || "muted";
  nextViewState.isBusy = state.remoteConfigConnectionIssue;
  nextViewState.busyMessage = state.remoteConfigConnectionIssue
    ? PopupText.status.remoteServerRetryNotice
    : "";
  nextViewState.pageDataNewNoticeHidden =
    !pageControlsVisible ||
    !state.currentDraftAvailable ||
    hasSavedPageData;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = formatScalePercent(normalizedDeviceState.scale);
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled);

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
    ? ViewText.markedPagesEmpty
    : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;

  const basePageUrlSet = new Set(
    Object.keys(configs).filter((url) => {
      if (typeof url !== "string" || !url) {
        return false;
      }
      const normalized = config.normalizeConfig(url, configs[url]).config;
      return Boolean(normalizeSiteIdValue(normalized.siteId));
    })
  );
  const liveSiteId = normalizeSiteIdValue(
    currentSiteId ||
      (state.currentConfig && state.currentConfig.siteId) ||
      (state.currentBaseUrl ? state.siteIdLookupByBaseUrl.get(state.currentBaseUrl) : null)
  );
  if (state.currentBaseUrl && liveSiteId) {
    basePageUrlSet.add(state.currentBaseUrl);
  }
  const basePageUrls = Array.from(basePageUrlSet)
    .sort((left, right) => left.localeCompare(right))
    .map((url) => ({ url }));
  nextViewState.basePageUrls = basePageUrls;
  nextViewState.basePageUrlsEmptyText = ViewText.basePageUrlsEmpty;

  uiModule.setViewState(nextViewState);
  if (tabInScope && resolvedView === uiModule.View.Marking && !previewActive) {
    await applySilentHighlightVisibility();
  }
}

async function refreshUi() {
  return runWithPopupBusyOverlay(
    PopupText.overlay.loadingPopupAndPreparing,
    () => refreshUiInner(),
    {
      delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
      suppressIfActive: true
    }
  );
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

function handleRenderModeInput(event) {
  const nextRenderMode = normalizeUiRenderModeValue(
    event && event.target ? event.target.value : uiModule.getViewState().renderModeValue
  );
  const view = uiModule.getViewState();
  const renderModeSetDisabled = Boolean(
    view.renderModeInputDisabled ||
      !view.renderModeSetVisible ||
      isUndeterminedRenderMode(nextRenderMode)
  );
  uiModule.setViewState({
    renderModeValue: nextRenderMode,
    renderModeSetDisabled
  });
}

function handleRenderModeWarningAcknowledgeChange(event) {
  const checked = Boolean(
    event &&
      (event.currentTarget || event.target) &&
      (event.currentTarget || event.target).checked
  );
  uiModule.setViewState({
    renderModeWarningAcknowledgeChecked: checked,
    renderModeWarningOkDisabled: !checked
  });
}

async function handleRenderModeWarningConfirm() {
  const view = uiModule.getViewState();
  if (!view.renderModeWarningAcknowledgeChecked) {
    uiModule.showToast(PopupText.renderMode.warningConfirmToast);
    return;
  }
  const warningKey = `${state.currentBaseUrl || ""}|${(state.currentTab && state.currentTab.url) || ""}`;
  state.renderModeWarningDismissedKey = warningKey;
  uiModule.setViewState({
    renderModeWarningVisible: false,
    renderModeWarningAcknowledgeChecked: false,
    renderModeWarningOkDisabled: true
  });
}

async function handleRenderModeSet() {
  await runWithPopupBusyOverlay(PopupText.overlay.savingRenderMode, async () => {
    const nextRenderMode = normalizeUiRenderModeValue(uiModule.getViewState().renderModeValue);
    if (isUndeterminedRenderMode(nextRenderMode)) {
      uiModule.showToast(PopupText.renderMode.toastUndeterminedCannotSet);
      return;
    }
    if (!state.currentBaseUrl) {
      uiModule.showToast(PopupText.renderMode.toastUnavailable);
      return;
    }
    const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
    if (
      state.currentBaseUrlHasConfirmedRenderMode &&
      nextRenderMode === currentRenderMode
    ) {
      state.renderModeEditMode = false;
      state.renderModeDetectionUnsure = false;
      await refreshUi();
      return;
    }
    const renderModeUpdatedAt = config.createTimestampNow();
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
      targetConfig.renderMode = nextRenderMode;
      targetConfig.renderModeUpdatedAt = renderModeUpdatedAt;
    });
    state.currentBaseUrlHasConfirmedRenderMode = true;
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = nextRenderMode;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    await messages.sendTabMessage({
      type: "configUpdated",
      baseUrl: state.currentBaseUrl
    });
    await maybeSwitchToMarkingView();
    await refreshUi();
    uiModule.showToast(
      nextRenderMode === config.RENDER_MODE_RENDERED
        ? PopupText.renderMode.toastSetRendered
        : PopupText.renderMode.toastSetStatic
    );
  });
}

async function handleRenderModeEditToggle() {
  state.renderModeEditMode = !state.renderModeEditMode;
  if (state.renderModeEditMode) {
    state.renderModeSummaryOpen = true;
  }
  await refreshUi();
}

function handleRenderModeSummaryToggle(event) {
  const target = event && event.currentTarget;
  const nextOpen = Boolean(target && target.open);
  const resolvedOpen =
    !state.currentBaseUrlHasConfirmedRenderMode || state.renderModeEditMode
      ? true
      : nextOpen;
  state.renderModeSummaryOpen = resolvedOpen;
  uiModule.setViewState({ renderModeSummaryOpen: resolvedOpen });
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
  uiModule.setBasePageMenuOpen(false);
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event) {
  event.stopPropagation();
}

function handleBasePageMenuToggle(event) {
  event.stopPropagation();
  uiModule.setConfigMenuOpen(false);
  uiModule.setBasePageMenuOpen(!state.basePageMenuOpen);
}

function handleBasePageMenuClick(event) {
  event.stopPropagation();
}

async function handleOpenConfigurationView() {
  uiModule.setConfigMenuOpen(false);
  uiModule.setBasePageMenuOpen(false);
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
  await runWithPopupBusyOverlay(PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

async function handleExplicitExcludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.updatingExclusion, async () => {
    await clearFocusedElement();
    const response = await messages.sendTabMessage({
      type: "setExplicitExclude",
      baseUrl: state.currentBaseUrl,
      xpath,
      excluded: false
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.excludeUpdateFailed);
      return;
    }
    await refreshUi();
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

async function handleExplicitIncludeView(xpath) {
  await runWithPopupBusyOverlay(PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

async function handleExplicitIncludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.updatingInclusion, async () => {
    await clearFocusedElement();
    const response = await messages.sendTabMessage({
      type: "setExplicitInclude",
      baseUrl: state.currentBaseUrl,
      xpath,
      included: false
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.includeUpdateFailed);
      return;
    }
    await refreshUi();
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
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
  uiModule.setBasePageMenuOpen(false);
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
  if (!helpers.ensureBaseUrl(ViewText.noMappedBaseUrlOrSiteId)) {
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    return;
  }
  if (desiredEnabled && !isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeEnabling);
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    await refreshUi();
    return;
  }
  state.lastPopupEnabled = desiredEnabled;
  const baseUrlValue = state.currentBaseUrl;
  await runWithPopupBusyOverlay(
    desiredEnabled ? PopupText.overlay.enablingMarking : PopupText.overlay.disablingMarking,
    async () => {
      if (desiredEnabled) {
        const parsed = utils.parseBaseUrl(baseUrlValue);
        if (!parsed) {
          uiModule.showToast(PopupText.baseUrl.toastInvalid);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
          uiModule.showToast(PopupText.baseUrl.toastOutsideCurrentPage);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        {
          const currentConfigs = await config.getConfigs();
          const normalizedCurrent = config.normalizeConfig(baseUrlValue, currentConfigs[baseUrlValue]);
          state.currentConfig = normalizedCurrent.config;
        }
        const { stageBaseValue, tokenValue } = await helpers.loadGlobalAiSettings();
        const siteIdResult = await ensureBaseUrlSiteId({
          baseUrl: baseUrlValue,
          stageBase: stageBaseValue,
          tokenValue,
          persist: false
        });
        if (!siteIdResult.ok || !siteIdResult.siteId) {
          uiModule.showToast(siteIdResult.reason || ViewText.noDomainIdForBaseUrl);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        const effectiveBaseUrl = siteIdResult.baseUrl || baseUrlValue;
        state.currentBaseUrl = effectiveBaseUrl;
        state.currentConfig = siteIdResult.config || state.currentConfig;
        const injectResult = await helpers.injectContentScriptIfNeeded();
        if (!injectResult.ok) {
          uiModule.showToast(injectResult.error || PopupText.helper.activateFailedOnPage);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId: tab.id });
        await utils.setTabState(tab.id, {
          enabled: true,
          baseUrl: effectiveBaseUrl,
          silentHighlightOptions: getSilentHighlightVisibility()
        });
        await messages.sendTabMessageWithRetry({
          type: "setEnabled",
          enabled: true,
          baseUrl: effectiveBaseUrl
        });
        await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
      } else {
        await utils.setTabState(tab.id, {
          enabled: false,
          baseUrl: baseUrlValue,
          silentHighlightOptions: getSilentHighlightVisibility()
        });
        await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
      }
      await refreshUi();
    },
    { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS }
  );
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
    mode: "mobile",
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
    deviceScaleValue: formatScalePercent(scale)
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
      deviceScaleValue: formatScalePercent(state.currentDeviceScale)
    });
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: formatScalePercent(scale)
  });
  if (scale === state.currentDeviceScale) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: "mobile",
    scale
  });
}

async function handleClearDomainCache() {
  uiModule.setConfigMenuOpen(false);
  const tab = await helpers.ensureActiveTab({
    requireUrl: true,
    toastOnMissing: PopupText.cache.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const origin = utils.getOriginFromUrl(tab.url);
  if (!origin) {
    uiModule.showToast(PopupText.cache.toastUnsupportedPage);
    return;
  }
  let hostname = origin;
  try {
    hostname = new URL(tab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(formatClearDomainCacheConfirm(hostname));
  if (!confirmed) {
    return;
  }
  beginPopupBusyOverlay(PopupText.overlay.clearingCacheAndReloading);
  state.clearDomainCacheDisabled = true;
  uiModule.setViewState({ clearDomainCacheDisabled: true });
  try {
    const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
    if (!result.ok) {
      uiModule.showToast(result.error || PopupText.cache.toastClearFailed);
      return;
    }
    uiModule.showToast(PopupText.cache.toastCleared);
    const reloadResult = await chromeHelpers.reloadTab(tab.id);
    if (!reloadResult.ok) {
      uiModule.showToast(reloadResult.error || PopupText.cache.toastReloadFailed);
    }
  } catch (error) {
    uiModule.showToast(
      (error && error.message) || PopupText.cache.toastClearFailed
    );
  } finally {
    state.clearDomainCacheDisabled = false;
    uiModule.setViewState({ clearDomainCacheDisabled: false });
    endPopupBusyOverlay();
  }
}

async function handleUnregisterCurrentTab() {
  uiModule.setConfigMenuOpen(false);
  const tab = await helpers.ensureActiveTab({
    requireId: true,
    toastOnMissing: PopupText.unregister.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const confirmed = window.confirm(PopupText.unregister.confirm);
  if (!confirmed) {
    return;
  }
  beginPopupBusyOverlay(PopupText.overlay.unregisteringTabAndReloading);
  state.unregisterCurrentTabDisabled = true;
  uiModule.setViewState({ unregisterCurrentTabDisabled: true });
  try {
    const result = await messages.sendRuntimeMessage({
      type: "unregisterTabAndReload",
      tabId: tab.id
    });
    if (!result || !result.ok) {
      uiModule.showToast(
        (result && result.error) || PopupText.unregister.toastFailed
      );
      return;
    }
    window.close();
  } finally {
    state.unregisterCurrentTabDisabled = false;
    uiModule.setViewState({ unregisterCurrentTabDisabled: false });
    endPopupBusyOverlay();
  }
}

async function handleConfigEndpointSet() {
  const endpointValue = uiModule.getViewState().configEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast(PopupText.configuration.endpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast(PopupText.configuration.endpointEnterValid);
    return;
  }
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalConfigEndpoint",
    "globalToken"
  ]);
  const previousEndpoint =
    stored && typeof stored.globalConfigEndpoint === "string"
      ? stored.globalConfigEndpoint.trim()
      : "";
  const hadToken = Boolean(stored && stored.globalToken);
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(endpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(endpointValue);
  const shouldResetToken = hadToken && endpointOriginChanged;
  await utils.storageSet(chrome.storage.sync, {
    globalConfigEndpoint: endpointValue,
    globalToken: shouldResetToken ? "" : (stored.globalToken || "")
  });
  if (shouldResetToken) {
    state.lastTokenValidationAt = 0;
    state.siteIdLookupByBaseUrl.clear();
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.endpointChangedLoginRequired);
  }
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
    uiModule.showToast(PopupText.configuration.aiEndpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast(PopupText.configuration.aiEndpointEnterValid);
    return;
  }
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalEndpoint",
    "globalToken"
  ]);
  const previousEndpoint =
    stored && typeof stored.globalEndpoint === "string"
      ? stored.globalEndpoint.trim()
      : "";
  const hadToken = Boolean(stored && stored.globalToken);
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(endpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(endpointValue);
  const shouldResetToken = hadToken && endpointOriginChanged;
  await utils.storageSet(chrome.storage.sync, {
    globalEndpoint: endpointValue,
    globalToken: shouldResetToken ? "" : (stored.globalToken || "")
  });
  if (shouldResetToken) {
    state.lastTokenValidationAt = 0;
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.aiEndpointChangedLoginRequired);
  }
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
    uiModule.showToast(PopupText.configuration.stageBaseEnterValid);
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
    uiModule.showToast(PopupText.configuration.stageBaseChangedLoginRequired);
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
    uiModule.showToast(PopupText.authentication.toastSetStageBaseFirst);
    return;
  }
  if (!isValidEmail(email)) {
    uiModule.showToast(PopupText.authentication.toastEnterValidEmail);
    return;
  }
  if (!password.trim()) {
    uiModule.showToast(PopupText.authentication.toastEnterPassword);
    return;
  }

  state.aiRequestInFlight = "login";
  await refreshUi();
  let loginSucceeded = false;
  let loginFailureMessage = "";
  try {
    const loginUrl = buildLoginEndpointFromStageBase(stageBase);
    if (!loginUrl) {
      loginFailureMessage = PopupText.authentication.toastSetValidStageBaseFirst;
    } else {
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      await maybeUpdateStoredTokenFromResponse(response, "");
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok) {
        loginFailureMessage =
          (payload && typeof payload.error === "string" && payload.error) ||
          (payload && typeof payload.message === "string" && payload.message) ||
          formatLoginFailedStatus(response.status);
      } else {
        const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
        if (!token) {
          loginFailureMessage = PopupText.authentication.toastResponseMissingToken;
        } else {
          await utils.storageSet(chrome.storage.sync, {
            globalStageBase: stageBase,
            globalToken: token
          });
          uiModule.setViewState({ loginPasswordValue: "" });
          loginSucceeded = true;
        }
      }
    }
  } catch (error) {
    loginFailureMessage = PopupText.authentication.toastRequestFailed;
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
  if (!loginSucceeded) {
    uiModule.showToast(loginFailureMessage || PopupText.authentication.toastFailed);
    return;
  }
  uiModule.showToast(PopupText.authentication.toastSuccess);
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handlePageSave() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!ensureMobileSimulationForSave()) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.savingPage, async () => {
    const response = await messages.sendTabMessage({
      type: "savePageDraft",
      baseUrl: state.currentBaseUrl
    });
    if (!response || !response.ok) {
      updateLastConfigSaveStatus(PopupText.page.saveFailed);
      uiModule.showToast(PopupText.page.saveFailedToast);
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
          ? PopupText.page.savedLocallySyncSkipped
          : syncFailed
          ? PopupText.page.savedLocallySyncFailed
          : PopupText.page.savedAndSynced
      );
      uiModule.showToast(
        syncSkipped
          ? PopupText.page.pageSavedLocallySyncSkipped
          : syncFailed
          ? PopupText.page.pageSavedLocallySyncFailed
          : PopupText.page.pageSaved
      );
    } else {
      updateLastConfigSaveStatus(PopupText.page.noLocalChangesToSave);
      uiModule.showToast(PopupText.page.noChangesToSave);
    }
    await refreshUi();
  });
}

async function handlePageRevert() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  const confirmed = window.confirm(PopupText.page.revertConfirm);
  if (!confirmed) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.revertingPage, async () => {
    const response = await messages.sendTabMessage({
      type: "revertPageDraft",
      baseUrl: state.currentBaseUrl
    });
    if (!response || !response.ok) {
      updateLastConfigSaveStatus(PopupText.page.revertFailed);
      uiModule.showToast(PopupText.page.revertFailedToast);
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
        ? PopupText.page.revertedLocallySyncSkipped
        : syncFailed
        ? PopupText.page.revertedLocallySyncFailed
        : PopupText.page.revertedAndSynced
    );
    uiModule.showToast(
      syncSkipped
        ? PopupText.page.revertedLocallyServerSyncSkipped
        : syncFailed
        ? PopupText.page.revertedLocallyServerSyncFailed
        : PopupText.page.revertedToLastSaved
    );
    await refreshUi();
  });
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
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeUsingAi);
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast(PopupText.ai.dirtyNotice);
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;

  state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
  const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
  if (!currentPageUrl) {
    uiModule.showToast(PopupText.ai.currentPageUnavailable);
    return;
  }
  const pageMarkings = state.currentConfig.pageMarkings || {};
  const currentPageEntry = pageMarkings[currentPageUrl];
  if (!currentPageEntry || typeof currentPageEntry !== "object") {
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }
  const currentPageHtml =
    typeof currentPageEntry.renderedHtml === "string" ? currentPageEntry.renderedHtml : "";
  const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (!currentPageHtml) {
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }
  const hasCurrentSubmissionXpaths =
    Array.isArray(currentPageEntry.submissionXpaths) &&
    currentPageEntry.submissionXpaths.length > 0;
  if (!hasCurrentSubmissionXpaths) {
    // AI compute no longer rebuilds xpaths from stored HTML. The live DOM decides
    // visibility/hidden/excluded state when the page is saved, and that snapshot
    // (`submissionXpaths`) becomes the source of truth for later AI requests.
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }

  // Build the AI payload from stored page snapshots only. We intentionally avoid
  // any compute-time DOM/HTML reclassification here to keep AI input consistent
  // with the last saved page state.
  const toAiPayloadXpaths = (entry) => {
    const explicitIncludeXpaths = new Set(
      Array.isArray(entry && entry.includeXpaths)
        ? entry.includeXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => xpath.trim())
          .filter(Boolean)
        : []
    );
    return (Array.isArray(entry && entry.submissionXpaths) ? entry.submissionXpaths : [])
      .filter((item) => item && typeof item.xpath === "string" && item.xpath)
      .map((item) => {
        const xpath = item.xpath.trim();
        const excluded = Boolean(item.excluded);
        if (excluded) {
          return { xpath, excluded: true };
        }
        return {
          xpath,
          excluded: false,
          explicit: explicitIncludeXpaths.has(xpath)
        };
      });
  };
  const storedPageEntries = Object.entries(pageMarkings)
    .filter(([url, entry]) => {
      if (!url || !entry || typeof entry !== "object") {
        return false;
      }
      if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(url, state.currentBaseUrl)) {
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
    // Guard against stale state where the current tab exists in `pageMarkings`
    // but does not yet have the required saved snapshot fields.
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }

  if (!storedPageEntries.length) {
    uiModule.showToast(PopupText.ai.savePagesBeforeComputing);
    return;
  }

  const missingRawHtmlPages = storedPageEntries.filter(([, entry]) => {
    const rawHtml = typeof entry.rawHtml === "string" ? entry.rawHtml : "";
    return !rawHtml;
  });
  const rawHtmlBackfills = new Map();
  if (missingRawHtmlPages.length) {
    const backfillResults = await Promise.all(
      missingRawHtmlPages.map(async ([url]) => {
        const response = await messages.sendRuntimeMessage({
          type: "fetchStaticPageHtml",
          url
        });
        if (!response || !response.ok || typeof response.html !== "string" || !response.html) {
          return null;
        }
        return {
          url,
          rawHtml: response.html
        };
      })
    );
    const successfulBackfills = backfillResults.filter(Boolean);
    successfulBackfills.forEach((item) => {
      rawHtmlBackfills.set(item.url, item.rawHtml);
    });
    if (successfulBackfills.length) {
      state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
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
  }

  const storedPages = storedPageEntries.map(([url, entry]) => {
    const renderedHtml =
      typeof entry.renderedHtml === "string" ? entry.renderedHtml : "";
    const rawHtml =
      typeof entry.rawHtml === "string" && entry.rawHtml
        ? entry.rawHtml
        : rawHtmlBackfills.get(url) || "";
    const isStatic = currentRenderMode === "static";
    const renderedXPaths = toAiPayloadXpaths(entry);
    return {
      url,
      renderedHtml,
      rawHtml: isStatic ? rawHtml : undefined,
      renderedXpaths: renderedXPaths,
      rawXPaths: isStatic ? refineXPathEntries(renderedHtml, rawHtml, renderedXPaths) : undefined
    };
  });

  const payload = {
    baseUrl: state.currentBaseUrl,
    renderMode: currentRenderMode,
    defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
    pages: storedPages
  };

  let selectorSet = {
    exclusionSelectors: [],
    inclusionSelectors: []
  };
  const computeSelectorsUrl = resolveRelativeEndpoint(endpointValue, "/get_selectors");
  if (!computeSelectorsUrl) {
    uiModule.showToast(PopupText.ai.endpointRequestFailed);
    return;
  }
  state.aiRequestInFlight = "compute";
  await refreshUi();
  try {
    const response = await fetch(computeSelectorsUrl, {
      method: "POST",
      headers: createConfigSyncHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      uiModule.showToast(PopupText.ai.endpointResponseError);
      return;
    }
    const data = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.exclusionSelectors) ||
      !Array.isArray(data.inclusionSelectors)
    ) {
      uiModule.showToast(PopupText.ai.endpointResponseFormatError);
      return;
    }
    selectorSet = normalizeAiSelectorSet(data);
    const selectorSetUpdatedAt = config.createTimestampNow();
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.latestComputedSelectors = normalizeAiSelectorSet(selectorSet);
      config.latestComputedSelectorsUpdatedAt = selectorSetUpdatedAt;
      config.domainAiSelectorSet = normalizeAiSelectorSet(selectorSet);
      config.domainAiSelectorSetUpdatedAt = selectorSetUpdatedAt;
    });
    const hasComputedNewSelectors =
      !aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig(state.currentConfig));
    state.aiSelectorsComputedSinceLastSubmit = hasComputedNewSelectors;
    state.aiSelectorsComputedBaseUrl = hasComputedNewSelectors ? state.currentBaseUrl : "";

    await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
    await messages.sendTabMessage({
      type: "showAiPreview",
      selectorSet
    });
    const { configEndpointValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
    const syncResult = await syncBaseConfigToServer({
      baseUrl: state.currentBaseUrl,
      pageUrl: currentPageUrl,
      endpointValue: configEndpointValue,
      tokenValue,
      stageBase: stageBaseValue,
      alertOnCurrentReplacement: false
    });
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncFailed = !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
    updateLastConfigSaveStatus(
      syncSkipped
        ? PopupText.ai.selectorsUpdatedLocallySyncSkipped
        : syncFailed
          ? PopupText.ai.selectorsUpdatedLocallySyncFailed
          : PopupText.ai.selectorsUpdatedAndSynced
    );
    if (syncSkipped && syncResult.reason) {
      uiModule.showToast(formatSelectorsComputedLocally(syncResult.reason));
    } else if (syncSkipped) {
      uiModule.showToast(PopupText.ai.selectorsComputedLocallySyncSkipped);
    } else if (syncFailed) {
      uiModule.showToast(PopupText.ai.selectorsComputedLocallySyncFailed);
    } else {
      uiModule.showToast(PopupText.ai.selectorsComputedAndSaved);
    }
  } catch (error) {
    uiModule.showToast(PopupText.ai.endpointRequestFailed);
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function submitSelectorSetToServer(options = {}) {
  const {
    baseUrl = state.currentBaseUrl,
    selectorSet = getLatestComputedSelectorsFromConfig(),
    tokenValue = "",
    confirm = true
  } = options;

  if (state.currentDraftDirty) {
    return { ok: false, skipped: true, reason: PopupText.ai.dirtyNotice };
  }

  const normalizedSelectorSet = normalizeAiSelectorSet(selectorSet);
  if (!combineAiSelectorSet(normalizedSelectorSet).length) {
    return { ok: false, skipped: true, reason: PopupText.ai.noSelectorsToSubmit };
  }

  const { stageBaseValue, configEndpointValue } = await helpers.loadGlobalAiSettings();
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBaseValue);
  if (!graphqlEndpoint) {
    return { ok: false, skipped: true, reason: PopupText.authentication.toastSetStageBaseFirst };
  }

  const siteIdResult = await ensureBaseUrlSiteId({
    baseUrl,
    stageBase: stageBaseValue,
    tokenValue
  });
  if (!siteIdResult.ok || !siteIdResult.siteId) {
    return {
      ok: false,
      skipped: true,
      reason: siteIdResult.reason || ViewText.noDomainIdForBaseUrl
    };
  }

  const effectiveBaseUrl = siteIdResult.baseUrl || baseUrl;
  state.currentBaseUrl = effectiveBaseUrl;
  state.currentConfig = siteIdResult.config || state.currentConfig;

  if (aiSelectorSetsEqual(normalizedSelectorSet, getLastSubmittedSelectorsFromConfig())) {
    return { ok: false, skipped: true, reason: PopupText.ai.noNewSelectorsToSubmit };
  }

  if (confirm) {
    const confirmed = window.confirm(PopupText.ai.submitConfirm);
    if (!confirmed) {
      return { ok: false, skipped: true, cancelled: true };
    }
  }

  const includeCss = normalizedSelectorSet.inclusionSelectors.join(", ");
  const selectorSetForSubmit = buildSelectorSetForGraphqlSubmit(normalizedSelectorSet);
  const excludeCss = selectorSetForSubmit.exclusionSelectors.join(", ");
  const renderMode = buildGraphqlRenderModeValue(
    config.getConfigRenderMode(state.currentConfig)
  );
  const latestTokenStored = await utils.storageGet(chrome.storage.sync, "globalToken");
  const submitTokenValue =
    (latestTokenStored && typeof latestTokenStored.globalToken === "string"
      ? latestTokenStored.globalToken
      : "") || tokenValue;

  state.aiRequestInFlight = "save";
  await refreshUi();
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: createConfigSyncHeaders(submitTokenValue),
      body: JSON.stringify({
        query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
        variables: {
          domainId: siteIdResult.siteId,
          includeCss,
          excludeCss,
          renderingMode: renderMode
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, submitTokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      return { ok: false, reason: PopupText.ai.submitResponseError };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: PopupText.ai.submitResponseFormatError };
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      return {
        ok: false,
        reason:
          payload.errors[0] && typeof payload.errors[0].message === "string"
            ? payload.errors[0].message
            : PopupText.ai.submitResponseError
      };
    }
    const mutationResult =
      payload.data && Object.prototype.hasOwnProperty.call(payload.data, "updateScrapingConditions")
        ? payload.data.updateScrapingConditions
        : undefined;
    if (
      mutationResult === undefined ||
      mutationResult === null ||
      mutationResult === false
    ) {
      return { ok: false, reason: PopupText.ai.submitResponseError };
    }

    const selectorSetUpdatedAt = config.createTimestampNow();
    state.currentConfig = await config.updateConfig(effectiveBaseUrl, (config) => {
      config.lastSavedSelectors = normalizeAiSelectorSet(normalizedSelectorSet);
      config.lastSavedSelectorsUpdatedAt = selectorSetUpdatedAt;
      config.domainAiSelectorSet = normalizeAiSelectorSet(normalizedSelectorSet);
      config.domainAiSelectorSetUpdatedAt = selectorSetUpdatedAt;
    });
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
    const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
    const configSyncResult = await syncBaseConfigToServer({
      baseUrl: effectiveBaseUrl,
      pageUrl: currentPageUrl,
      endpointValue: configEndpointValue,
      tokenValue: submitTokenValue,
      stageBase: stageBaseValue,
      alertOnCurrentReplacement: false
    });
    return { ok: true, baseUrl: effectiveBaseUrl, configSyncResult };
  } catch (error) {
    return { ok: false, reason: PopupText.ai.submitRequestFailed };
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
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeSubmitting);
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const submitResult = await submitSelectorSetToServer({
    baseUrl: state.currentBaseUrl,
    selectorSet: getLatestComputedSelectorsFromConfig(),
    tokenValue: credentials.tokenValue,
    confirm: true
  });
  if (submitResult.ok) {
    const syncResult = submitResult.configSyncResult || null;
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncFailed = Boolean(syncResult) && !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
    updateLastConfigSaveStatus(
      !syncResult
        ? PopupText.ai.submittedSelectors
        : syncSkipped
          ? PopupText.ai.submittedSelectorsSyncSkipped
          : syncFailed
            ? PopupText.ai.submittedSelectorsSyncFailed
            : PopupText.ai.submittedSelectorsAndSynced
    );
    uiModule.showToast(PopupText.ai.submittedToServer);
    return;
  }
  if (submitResult.cancelled) {
    return;
  }
  uiModule.showToast(submitResult.reason || PopupText.ai.submitRequestFailed);
}

async function handlePreviewLatest() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast(ViewText.noMappedBaseUrlOrSiteId);
    return;
  }
  const selectorSet = getLatestAvailableSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  const view = uiModule.getViewState();
  if (view.previewBlocked) {
    return;
  }
  state.lastPopupEnabled = null;
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
    const response = await messages.sendTabMessage({
      type: "showAiPreview",
      selectorSet
    });
    if (!response || !response.ok) {
      throw new Error(PopupText.preview.openFailed);
    }
    await refreshUi();
  } catch (error) {
    setPreviewBlocked(false);
    uiModule.showToast((error && error.message) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleExitPreviewMode() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const response = await messages.sendTabMessage({ type: "closeAiPreview" });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.preview.exitFailed);
  }
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
    onDeviceScaleInput: handleDeviceScaleInput,
    onDeviceScaleChange: handleDeviceScaleChange,
    onConfigToggle: handleConfigToggle,
    onConfigMenuClick: handleConfigMenuClick,
    onBasePageMenuToggle: handleBasePageMenuToggle,
    onBasePageMenuClick: handleBasePageMenuClick,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onClearDomainCache: handleClearDomainCache,
    onUnregisterCurrentTab: handleUnregisterCurrentTab,
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
    onRenderModeInput: handleRenderModeInput,
    onRenderModeSummaryToggle: handleRenderModeSummaryToggle,
    onRenderModeWarningAcknowledgeChange: handleRenderModeWarningAcknowledgeChange,
    onRenderModeWarningConfirm: handleRenderModeWarningConfirm,
    onRenderModeSet: handleRenderModeSet,
    onRenderModeEditToggle: handleRenderModeEditToggle,
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
    onExitPreviewMode: handleExitPreviewMode,
    onExplicitExcludeView: handleExplicitExcludeView,
    onExplicitExcludeRemove: handleExplicitExcludeRemove,
    onExplicitIncludeView: handleExplicitIncludeView,
    onExplicitIncludeRemove: handleExplicitIncludeRemove,
    onMarkedPageNavigate: handleMarkedPageNavigate,
    onBasePageNavigate: handleBasePageNavigate
  });

  document.addEventListener("click", () => {
    uiModule.setConfigMenuOpen(false);
    uiModule.setBasePageMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
      uiModule.setBasePageMenuOpen(false);
    }
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (!primaryModifier || event.altKey || event.shiftKey || event.repeat) {
      return;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "e" && key !== "s" && key !== "m") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isEditableTarget(event.target)) {
      return;
    }
    const view = uiModule.getViewState();
    if (key === "e") {
      handleEnableToggle({ target: { checked: !view.toggleEnabled } }).then();
      return;
    }
    if (key === "m") {
      if (!view.deviceControlsDisabled) {
        const nextEnabled = !view.deviceEmulationEnabled;
        if (nextEnabled) {
          helpers.updateDeviceEmulation({
            enabled: true,
            mode: "mobile",
            scale: state.currentDeviceScale
          }).then();
        } else {
          handleDeviceEmulationEnabledToggle({
            currentTarget: { checked: false }
          }).then();
        }
      }
      return;
    }
    if (!view.toggleEnabled || view.pageSaveDisabled) {
      return;
    }
    handlePageSave().then();
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
    if (message && message.type === "aiPreviewClosed") {
      (async () => {
        try {
          setPreviewBlocked(false);
          await refreshUi();
        } catch {
          setPreviewBlocked(false);
        }
      })();
      return;
    }
    if (!message || message.type !== "pageDraftChanged") {
      if (message && message.type === "consentXpathsChanged") {
        if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
          const hasSavedData = Boolean(
            state.currentSavedEntry &&
              ((Array.isArray(state.currentSavedEntry.xpaths) &&
                state.currentSavedEntry.xpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.includeXpaths) &&
                  state.currentSavedEntry.includeXpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.consentXpaths) &&
                  state.currentSavedEntry.consentXpaths.length > 0) ||
                (typeof state.currentSavedEntry.renderedHtml === "string" &&
                  state.currentSavedEntry.renderedHtml.length > 0))
          );
          if (hasSavedData) {
            window.alert(PopupText.consent.changedAlert);
          }
          scheduleRefresh();
        }
      }
      return;
    }
    if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
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
