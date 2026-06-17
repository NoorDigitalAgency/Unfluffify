import * as config from "../common/config.js";
import {
  normalizeSiteIdValue,
  normalizeStageBase
} from "../common/lynx-live-pages.js";
import * as utils from "../common/utilities.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";

const { state } = stateModule;
const stateAny = state as any;
const FALLBACK_PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS = 120 * 1000;

function buildPropertyPageTypesSignature(pageTypes: any) {
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? pageTypes.map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? pageType.candidates.map((candidate: any) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                Boolean(candidate && candidate.duplicate) ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

function resetPropertyPageTypesState() {
  stateAny.propertyPageTypes = [];
  stateAny.propertyPageTypesDuplicateUrls = [];
  stateAny.propertyPageTypesSiteId = null;
  stateAny.propertyPageTypesStageBase = "";
  stateAny.propertyPageTypesSignature = "";
  stateAny.propertyPageTypesFetchedAt = 0;
  stateAny.propertyPageTypesLastError = "";
  stateAny.propertyPageTypesChangeNoticeVisible = false;
  stateAny.propertyPageTypesInvalidAlertPending = false;
  stateAny.propertyPageTypesChangeForceTodoOpen = false;
}

function getRefreshIntervalMs(deps: any) {
  const candidate = Number(deps && deps.propertyPageTypesRefreshIntervalMs);
  return Number.isFinite(candidate) && candidate > 0
    ? Math.trunc(candidate)
    : FALLBACK_PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS;
}

function getPendingPropertyPageTypesRequest(deps: any) {
  return typeof deps.getPropertyPageTypesRequest === "function"
    ? deps.getPropertyPageTypesRequest()
    : null;
}

function setPendingPropertyPageTypesRequest(deps: any, nextRequest: any) {
  if (typeof deps.setPropertyPageTypesRequest === "function") {
    deps.setPropertyPageTypesRequest(nextRequest);
  }
}

export async function fetchPropertyPageTypesFromGraphql(_deps: any, options: any = {}) {
  const opts = (options || {}) as any;
  const {
    siteId = null,
    stageBase = "",
    tokenValue = ""
  } = opts;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedSiteId || !normalizedStageBase) {
    return { ok: false, pageTypes: [], duplicateUrls: [], error: "" };
  }
  const response = await messages.sendRuntimeMessage({
    type: "fetchLivePagePropertyPageTypes",
    siteId: normalizedSiteId,
    stageBase: normalizedStageBase,
    tokenValue
  });
  if (!response || !response.ok) {
    return {
      ok: false,
      pageTypes: [],
      duplicateUrls: [],
      error: response && typeof response.reason === "string" && response.reason
        ? response.reason
        : _deps.PopupText.pageTypes.refreshFailed
    };
  }
  return {
    ok: true,
    pageTypes: Array.isArray(response.pageTypes) ? response.pageTypes : [],
    duplicateUrls: Array.isArray(response.duplicateUrls) ? response.duplicateUrls : [],
    signature: typeof response.signature === "string"
      ? response.signature
      : buildPropertyPageTypesSignature(response.pageTypes)
  };
}

export async function ensurePropertyPageTypes(deps: any, options: any = {}) {
  const opts = (options || {}) as any;
  const {
    siteId = null,
    stageBase = "",
    tokenValue = "",
    force = false,
    notifyOnChange = false
  } = opts;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedSiteId || !normalizedStageBase || !tokenValue) {
    resetPropertyPageTypesState();
    return { ok: false, skipped: true, pageTypes: [], duplicateUrls: [], changed: false };
  }
  const refreshIntervalMs = getRefreshIntervalMs(deps);
  const cacheKey = `${normalizedStageBase}|${normalizedSiteId}`;
  const cacheFresh =
    !force &&
    stateAny.propertyPageTypesSiteId === normalizedSiteId &&
    stateAny.propertyPageTypesStageBase === normalizedStageBase &&
    stateAny.propertyPageTypesFetchedAt > 0 &&
    Date.now() - stateAny.propertyPageTypesFetchedAt < refreshIntervalMs &&
    !stateAny.propertyPageTypesLastError;
  if (cacheFresh) {
    return {
      ok: true,
      pageTypes: stateAny.propertyPageTypes,
      duplicateUrls: stateAny.propertyPageTypesDuplicateUrls,
      changed: false,
      fromCache: true
    };
  }
  const pendingRequest = getPendingPropertyPageTypesRequest(deps);
  if (pendingRequest && pendingRequest.key === cacheKey) {
    return pendingRequest.promise;
  }
  const request = fetchPropertyPageTypesFromGraphql(deps, {
    siteId: normalizedSiteId,
    stageBase: normalizedStageBase,
    tokenValue
  }).then((result) => {
    if (!result.ok) {
      stateAny.propertyPageTypesLastError = result.error || deps.PopupText.pageTypes.refreshFailed;
      if (
        stateAny.propertyPageTypesSiteId === normalizedSiteId &&
        stateAny.propertyPageTypesStageBase === normalizedStageBase &&
        Array.isArray(stateAny.propertyPageTypes)
      ) {
        return {
          ok: true,
          pageTypes: stateAny.propertyPageTypes,
          duplicateUrls: stateAny.propertyPageTypesDuplicateUrls,
          changed: false,
          stale: true,
          error: stateAny.propertyPageTypesLastError
        };
      }
      return {
        ok: false,
        pageTypes: [],
        duplicateUrls: [],
        changed: false,
            error: stateAny.propertyPageTypesLastError
      };
    }
          const previousSignature = stateAny.propertyPageTypesSignature;
    const nextSignature = result.signature || "";
    const changed = Boolean(previousSignature) && previousSignature !== nextSignature;
          stateAny.propertyPageTypes = result.pageTypes;
          stateAny.propertyPageTypesDuplicateUrls = result.duplicateUrls;
          stateAny.propertyPageTypesSiteId = normalizedSiteId;
          stateAny.propertyPageTypesStageBase = normalizedStageBase;
          stateAny.propertyPageTypesSignature = nextSignature;
          stateAny.propertyPageTypesFetchedAt = Date.now();
          stateAny.propertyPageTypesLastError = "";
    if (changed && notifyOnChange) {
      deps.showToast(deps.PopupText.pageTypes.updatedToast);
    }
    return {
      ok: true,
      pageTypes: stateAny.propertyPageTypes,
      duplicateUrls: stateAny.propertyPageTypesDuplicateUrls,
      changed,
      stale: false
    };
  }).finally(() => {
    const activeRequest = getPendingPropertyPageTypesRequest(deps);
    if (activeRequest && activeRequest.key === cacheKey) {
      setPendingPropertyPageTypesRequest(deps, null);
    }
  });
  setPendingPropertyPageTypesRequest(deps, {
    key: cacheKey,
    promise: request
  });
  return request;
}

export async function resolveSiteIdFromGraphql(_deps: any, options: any = {}) {
  const opts = (options || {}) as any;
  const {
    stageBase = "",
    lookupUrl = ""
  } = opts;
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedStageBase || !lookupUrl) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
  try {
    const response = await messages.sendRuntimeMessage({
      type: "resolveLivePageSiteId",
      stageBase: normalizedStageBase,
      pageUrl: lookupUrl
    });
    if (!response || !response.ok) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const candidate = normalizeSiteIdValue(response.siteId);
    const baseUrl = typeof response.baseUrl === "string" ? response.baseUrl : "";
    if (!candidate) {
      return {
        ok: true,
        siteId: null,
        baseUrl,
        notFound: Boolean(response.notFound)
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

export function mergeConfigEntriesForResolvedBaseUrl(
  _deps: any,
  resolvedBaseUrl: string,
  preferredEntry: any,
  existingEntry: any
) {
  const preferred = config.normalizeConfig(resolvedBaseUrl, preferredEntry).config;
  const existing = config.normalizeConfig(resolvedBaseUrl, existingEntry).config;
  const mergedPageMarkings = config.mergePageMarkingsByTimestamp(
    existing.pageMarkings,
    preferred.pageMarkings
  ).pageMarkings;
  const selectors = config.mergeConfigSelectorStateByTimestamp(
    existing.selectors,
    existing.selectorsUpdatedAt,
    existing.submittedSelectorsFingerprint,
    preferred.selectors,
    preferred.selectorsUpdatedAt,
    preferred.submittedSelectorsFingerprint
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
    selectors: selectors.selectorSet,
    selectorsUpdatedAt: selectors.updatedAt,
    submittedSelectorsFingerprint: selectors.submittedFingerprint
  };
  return config.normalizeConfig(resolvedBaseUrl, merged).config;
}

export async function ensureBaseUrlSiteId(deps: any, options: any = {}) {
  const opts = (options || {}) as any;
  const {
    baseUrl = "",
    stageBase = "",
    tokenValue = "",
    configs = null,
    pageUrl = "",
    persist = true
  } = opts;
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
      reason: deps.ViewText.noMappedBaseUrlOrSiteId
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
    stateAny.siteIdLookupByBaseUrl.set(requestedBaseUrl, existingSiteId);
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
      reason: deps.PopupText.configuration.stageBaseRequiredBeforeContinuing,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  if (stateAny.siteIdLookupByBaseUrl.has(requestedBaseUrl)) {
    const cached = normalizeSiteIdValue(stateAny.siteIdLookupByBaseUrl.get(requestedBaseUrl));
    if (cached) {
      if (shouldPersist) {
        sourceConfigs[requestedBaseUrl] = await config.updateConfig(requestedBaseUrl, (target: any) => {
          target.siteId = cached;
        });
      } else {
        const normalizedCached = config.normalizeConfig(
          requestedBaseUrl,
          sourceConfigs[requestedBaseUrl]
        ).config;
        normalizedCached.siteId = cached as any;
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
    stateAny.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  const queryUrl = pageUrl && typeof pageUrl === "string" ? pageUrl : requestedBaseUrl;
  const lookupResult = await resolveSiteIdFromGraphql(deps, {
    stageBase: normalizedStageBase,
    lookupUrl: queryUrl,
    tokenValue
  });
  if (!lookupResult.ok) {
    return {
      ok: false,
      siteId: null,
      baseUrl: requestedBaseUrl,
      reason: deps.PopupText.status.unableToResolveDomainId,
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
      reason: deps.ViewText.noDomainIdForBaseUrl,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  stateAny.siteIdLookupByBaseUrl.set(resolvedBaseUrl, resolvedSiteId);
  if (requestedBaseUrl !== resolvedBaseUrl) {
    stateAny.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  let didChangeConfigs = false;
  if (requestedBaseUrl !== resolvedBaseUrl) {
    const mergedConfig = mergeConfigEntriesForResolvedBaseUrl(
      deps,
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
    resolvedConfig.siteId = resolvedSiteId as any;
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
