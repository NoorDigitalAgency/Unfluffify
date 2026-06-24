import * as config from "../common/config.js";
import type { Config } from "../types/config.ts";
import {
  normalizeSiteIdValue,
  normalizeStageBase
} from "../common/lynx-live-pages.js";
import * as utils from "../common/utilities.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";

const { state } = stateModule;
const FALLBACK_PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS = 120 * 1000;

type StoredPageMarkings = Record<string, Record<string, unknown>>;
type StoredConfigEntry = { pageMarkings?: StoredPageMarkings; [key: string]: unknown };
type StoredConfigs = Record<string, StoredConfigEntry>;

type PropertyPageTypeCandidate = { url?: string; wordsCount?: number; duplicate?: boolean };
type PropertyPageType = { key?: string; candidates?: PropertyPageTypeCandidate[] };

interface EnsurePropertyPageTypesResult {
  ok: boolean;
  pageTypes?: Array<Record<string, unknown>>;
  duplicateUrls?: string[];
  changed?: boolean;
  skipped?: boolean;
  fromCache?: boolean;
  stale?: boolean;
  error?: string;
}

interface EnsureBaseUrlSiteIdResult {
  ok: boolean;
  siteId: number | null;
  baseUrl: string;
  reason?: string;
  configs?: StoredConfigs;
  config?: Config;
  skipped?: boolean;
}

type PropertyPageTypesRequest = { key: string; promise: Promise<EnsurePropertyPageTypesResult> };

interface SiteResolutionDeps {
  PopupText: typeof import("../common/text.js").PopupText;
  ViewText: typeof import("../common/text.js").ViewText;
  showToast(message: string): void;
  propertyPageTypesRefreshIntervalMs: number;
  getPropertyPageTypesRequest(): PropertyPageTypesRequest | null;
  setPropertyPageTypesRequest(nextRequest: PropertyPageTypesRequest | null): void;
}

interface FetchPropertyPageTypesOptions {
  siteId?: number | string | null;
  stageBase?: string;
  tokenValue?: string;
}

interface EnsurePropertyPageTypesOptions extends FetchPropertyPageTypesOptions {
  force?: boolean;
  notifyOnChange?: boolean;
}

interface ResolveSiteIdOptions {
  stageBase?: string;
  lookupUrl?: string;
  tokenValue?: string;
}

interface EnsureBaseUrlSiteIdOptions {
  baseUrl?: string;
  stageBase?: string;
  tokenValue?: string;
  configs?: StoredConfigs | null;
  pageUrl?: string;
  persist?: boolean;
}

function buildPropertyPageTypesSignature(pageTypes: unknown) {
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? (pageTypes as PropertyPageType[]).map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? (pageType.candidates as PropertyPageTypeCandidate[]).map((candidate) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                candidate && candidate.duplicate ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

function resetPropertyPageTypesState() {
  state.propertyPageTypes = [];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = null;
  state.propertyPageTypesStageBase = "";
  state.propertyPageTypesSignature = "";
  state.propertyPageTypesFetchedAt = 0;
  state.propertyPageTypesLastError = "";
  state.propertyPageTypesChangeNoticeVisible = false;
  state.propertyPageTypesInvalidAlertPending = false;
  state.propertyPageTypesChangeForceTodoOpen = false;
}

function getRefreshIntervalMs(deps: SiteResolutionDeps) {
  const candidate = Number(deps && deps.propertyPageTypesRefreshIntervalMs);
  return Number.isFinite(candidate) && candidate > 0
    ? Math.trunc(candidate)
    : FALLBACK_PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS;
}

function getPendingPropertyPageTypesRequest(deps: SiteResolutionDeps) {
  return typeof deps.getPropertyPageTypesRequest === "function"
    ? deps.getPropertyPageTypesRequest()
    : null;
}

function setPendingPropertyPageTypesRequest(deps: SiteResolutionDeps, nextRequest: PropertyPageTypesRequest | null) {
  if (typeof deps.setPropertyPageTypesRequest === "function") {
    deps.setPropertyPageTypesRequest(nextRequest);
  }
}

export async function fetchPropertyPageTypesFromGraphql(_deps: SiteResolutionDeps, options: FetchPropertyPageTypesOptions = {}) {
  const opts = options || {};
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

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
export async function ensurePropertyPageTypes(deps: SiteResolutionDeps, options: EnsurePropertyPageTypesOptions = {}): Promise<EnsurePropertyPageTypesResult> {
  const opts = options || {};
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
    state.propertyPageTypesSiteId === normalizedSiteId &&
    state.propertyPageTypesStageBase === normalizedStageBase &&
    state.propertyPageTypesFetchedAt > 0 &&
    Date.now() - state.propertyPageTypesFetchedAt < refreshIntervalMs &&
    !state.propertyPageTypesLastError;
  if (cacheFresh) {
    return {
      ok: true,
      pageTypes: state.propertyPageTypes,
      duplicateUrls: state.propertyPageTypesDuplicateUrls,
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
      state.propertyPageTypesLastError = result.error || deps.PopupText.pageTypes.refreshFailed;
      if (
        state.propertyPageTypesSiteId === normalizedSiteId &&
        state.propertyPageTypesStageBase === normalizedStageBase &&
        Array.isArray(state.propertyPageTypes)
      ) {
        return {
          ok: true,
          pageTypes: state.propertyPageTypes,
          duplicateUrls: state.propertyPageTypesDuplicateUrls,
          changed: false,
          stale: true,
          error: state.propertyPageTypesLastError
        };
      }
      return {
        ok: false,
        pageTypes: [],
        duplicateUrls: [],
        changed: false,
            error: state.propertyPageTypesLastError
      };
    }
          const previousSignature = state.propertyPageTypesSignature;
    const nextSignature = result.signature || "";
    const changed = Boolean(previousSignature) && previousSignature !== nextSignature;
          state.propertyPageTypes = result.pageTypes;
          state.propertyPageTypesDuplicateUrls = result.duplicateUrls;
          state.propertyPageTypesSiteId = normalizedSiteId;
          state.propertyPageTypesStageBase = normalizedStageBase;
          state.propertyPageTypesSignature = nextSignature;
          state.propertyPageTypesFetchedAt = Date.now();
          state.propertyPageTypesLastError = "";
    if (changed && notifyOnChange) {
      deps.showToast(deps.PopupText.pageTypes.updatedToast);
    }
    return {
      ok: true,
      pageTypes: state.propertyPageTypes,
      duplicateUrls: state.propertyPageTypesDuplicateUrls,
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

export async function resolveSiteIdFromGraphql(_deps: SiteResolutionDeps, options: ResolveSiteIdOptions = {}) {
  const opts = options || {};
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
  // deno-lint-ignore no-unused-vars -- retained for existing source-contract compatibility.
  } catch (error) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

export function mergeConfigEntriesForResolvedBaseUrl(
  _deps: SiteResolutionDeps,
  resolvedBaseUrl: string,
  preferredEntry: StoredConfigEntry | undefined,
  existingEntry: StoredConfigEntry | undefined
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

export async function ensureBaseUrlSiteId(deps: SiteResolutionDeps, options: EnsureBaseUrlSiteIdOptions = {}): Promise<EnsureBaseUrlSiteIdResult> {
  const opts = options || {};
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
  const sourceConfigs: StoredConfigs = configs || (await config.getConfigs()) as StoredConfigs;
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
      config: sourceConfigs[requestedBaseUrl] as Config
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
      config: sourceConfigs[requestedBaseUrl] as Config
    };
  }
  if (state.siteIdLookupByBaseUrl.has(requestedBaseUrl)) {
    const cached = normalizeSiteIdValue(state.siteIdLookupByBaseUrl.get(requestedBaseUrl));
    if (cached) {
      if (shouldPersist) {
        sourceConfigs[requestedBaseUrl] = await config.updateConfig(requestedBaseUrl, (target: StoredConfigEntry) => {
          target.siteId = cached;
        });
      } else {
        const normalizedCached = config.normalizeConfig(
          requestedBaseUrl,
          sourceConfigs[requestedBaseUrl]
        ).config;
        (normalizedCached as Record<string, unknown>).siteId = cached;
        sourceConfigs[requestedBaseUrl] = normalizedCached;
      }
      return {
        ok: true,
        siteId: cached,
        baseUrl: requestedBaseUrl,
        configs: sourceConfigs,
        config: sourceConfigs[requestedBaseUrl] as Config
      };
    }
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
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
      config: sourceConfigs[requestedBaseUrl] as Config
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
      config: sourceConfigs[requestedBaseUrl] as Config
    };
  }
  state.siteIdLookupByBaseUrl.set(resolvedBaseUrl, resolvedSiteId);
  if (requestedBaseUrl !== resolvedBaseUrl) {
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
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
    (resolvedConfig as Record<string, unknown>).siteId = resolvedSiteId;
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
    config: sourceConfigs[resolvedBaseUrl] as Config
  };
}
