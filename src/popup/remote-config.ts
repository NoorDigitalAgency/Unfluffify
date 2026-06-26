import * as config from "../common/config";
import { replaceServerConfigIntoLocalSnapshot } from "../background/remote-config-sync";
import * as messages from "./messages";
import * as stateModule from "./state";

const { state } = stateModule;
const DEFAULT_REMOTE_CONFIG_RETRY_DELAY_MS = 2500;
const remoteMissingClearOwnerByBaseUrl = new Map<string, number>();

type StoredPageMarkings = Record<string, Record<string, unknown>>;
type StoredConfigEntry = { pageMarkings?: StoredPageMarkings; [key: string]: unknown };
type StoredConfigs = Record<string, StoredConfigEntry>;

interface LoadRemoteConfigOptions {
  tabId?: number | null;
  pageUrl?: string;
  baseUrl?: string;
  siteId?: number | null;
  endpointValue?: string;
  tokenValue?: string;
  force?: boolean;
  notifyOnChange?: boolean;
}

interface SyncBaseConfigOptions {
  baseUrl?: string;
  pageUrl?: string;
  endpointValue?: string;
  tokenValue?: string;
  stageBase?: string;
  alertOnCurrentReplacement?: boolean;
  includeCurrentPageMarking?: boolean;
  includeAllLocalPageMarkings?: boolean;
  maxAttempts?: number;
}

interface RemoteConfigLoadStatus {
  status: string;
  baseUrl?: string;
}

interface EnsureBaseUrlSiteIdResult {
  ok?: boolean;
  siteId?: number | string | null;
  reason?: string;
  baseUrl?: string;
  configs?: StoredConfigs;
}

interface EnsurePropertyPageTypesResult {
  ok?: boolean;
  pageTypes?: unknown;
}

interface LynxChecklistViewModel {
  activeMarkedPages: Array<{ url: string; pageType: string }>;
}

interface TransferPayloadStoreResult {
  ok?: boolean;
}

interface RemoteConfigDeps {
  PopupText: Record<string, Record<string, string>>;
  remoteConfigRetryDelayMs: number;
  windowRef: Window;
  ensureActiveTab(): Promise<unknown>;
  refreshUi(options?: unknown): Promise<unknown>;
  resolveRelativeEndpoint(endpointValue: string, path: string): string;
  updateLastConfigLoadStatus(result: RemoteConfigLoadStatus): void;
  invalidateTokenAndLockConfiguration(force?: boolean): Promise<unknown>;
  showToast(message: string): void;
  ensureBaseUrlSiteId(options: {
    baseUrl?: string;
    pageUrl?: string;
    stageBase?: string;
    tokenValue?: string;
    configs?: StoredConfigs;
  }): Promise<EnsureBaseUrlSiteIdResult>;
  getStoredGlobalToken(options?: { trim?: boolean }): Promise<string>;
  ensurePropertyPageTypes(options: {
    siteId?: number | string | null;
    stageBase?: string;
    tokenValue?: string;
    force?: boolean;
    notifyOnChange?: boolean;
  }): Promise<EnsurePropertyPageTypesResult>;
  collectStoredPageMarkingItems(markings: unknown, baseUrl: string): unknown[];
  buildLynxChecklistViewModel(options: {
    aiAnswer: string;
    pageTypes: unknown;
    markedPages: unknown;
  }): LynxChecklistViewModel;
  buildPageMarkingKey(url: unknown, pageType: unknown): string;
  buildTransferPayloadKey(label: string): string;
  putTransferPayload(kind: string, payload: unknown, options: { payloadKey?: string }): Promise<TransferPayloadStoreResult>;
  waitForRetryDelay(delayMs?: number): Promise<unknown>;
  isRetryableHttpStatus(status: number): boolean;
  pruneRemoteInvalidPageMarkings(options: { siteId?: number | string | null; invalidUrls?: string[] | null }): Promise<unknown>;
  clearBackendSavedPageMarkings?: typeof config.clearBackendSavedPageMarkings;
  getConfigs?: typeof config.getConfigs;
  saveConfigs?: typeof config.saveConfigs;
  normalizeConfig?: typeof config.normalizeConfig;
  getBackendSavedPageMarkings?: typeof config.getBackendSavedPageMarkings;
  setBackendSavedPageMarkings?: typeof config.setBackendSavedPageMarkings;
  createConfigSyncPayload?: typeof config.createConfigSyncPayload;
  replaceServerConfigIntoLocalSnapshot?: typeof replaceServerConfigIntoLocalSnapshot;
}

function buildRemoteConfigLoadKey(tabId: unknown, siteId: unknown, endpointValue: unknown) {
  return `${tabId || ""}|${siteId || ""}|${endpointValue || ""}`;
}

function buildRemoteConfigPageLoadKey(
  tabId: unknown,
  pageUrl: unknown,
  siteId: unknown,
  endpointValue: unknown
) {
  return `${tabId || ""}|${typeof pageUrl === "string" ? pageUrl : ""}|${siteId || ""}|${endpointValue || ""}`;
}

function buildRemoteConfigSiteCacheKey(siteId: unknown, endpointValue: unknown) {
  return `${siteId || ""}|${endpointValue || ""}`;
}

function clearRemoteConfigPageLoadCacheForSite(siteCacheKey: string) {
  const siteCacheSuffix = `|${siteCacheKey}`;
  for (const key of state.remoteConfigLoadResultByKey.keys()) {
    if (key.endsWith(siteCacheSuffix)) {
      state.remoteConfigLoadResultByKey.delete(key);
    }
  }
  for (const key of state.remoteConfigLatestRequestIdByPageLoadKey.keys()) {
    if (key.endsWith(siteCacheSuffix)) {
      state.remoteConfigLatestRequestIdByPageLoadKey.delete(key);
    }
  }
}

function canApplyRemoteConfigLoadResult(
  tabId: unknown,
  pageUrl: unknown,
  pageLoadKey: string,
  siteCacheKey: string,
  requestId: number
) {
  if (state.remoteConfigGlobalFenceRequestId > requestId) {
    return false;
  }
  const normalizedTabId = Number.isFinite(tabId) ? Math.trunc(tabId as number) : 0;
  if (
    normalizedTabId &&
    (state.remoteConfigTabFenceByTabId.get(normalizedTabId) || 0) > requestId
  ) {
    return false;
  }
  if (siteCacheKey && (state.remoteConfigSiteFenceByKey.get(siteCacheKey) || 0) > requestId) {
    return false;
  }
  if (pageLoadKey && (state.remoteConfigLatestRequestIdByPageLoadKey.get(pageLoadKey) || 0) !== requestId) {
    return false;
  }
  if (normalizedTabId && state.currentTab && state.currentTab.id !== normalizedTabId) {
    return false;
  }
  if (typeof pageUrl === "string" && pageUrl) {
    const currentPageUrl = state.currentTab && typeof state.currentTab.url === "string"
      ? state.currentTab.url
      : "";
    if (currentPageUrl && currentPageUrl !== pageUrl) {
      return false;
    }
  }
  return true;
}

export function scheduleRemoteConfigRetry(deps: RemoteConfigDeps) {
  if (state.remoteConfigConnectionRetryTimer) {
    return;
  }
  const retryDelayMs = Number.isFinite(deps.remoteConfigRetryDelayMs)
    ? Math.trunc(deps.remoteConfigRetryDelayMs)
    : DEFAULT_REMOTE_CONFIG_RETRY_DELAY_MS;
  state.remoteConfigConnectionRetryTimer = deps.windowRef.setTimeout(async () => {
    state.remoteConfigConnectionRetryTimer = 0;
    await deps.ensureActiveTab();
    await deps.refreshUi();
  }, retryDelayMs);
}

async function clearLocalPageMarkingsWhenRemoteIsMissing(
  deps: RemoteConfigDeps,
  baseUrl: string,
  options: { shouldContinue?: () => boolean; requestId?: number } = {}
) {
  const resolvedBaseUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!resolvedBaseUrl) {
    return { changed: false, baseUrl: "" };
  }
  const getConfigs = typeof deps.getConfigs === "function" ? deps.getConfigs : config.getConfigs;
  const saveConfigs = typeof deps.saveConfigs === "function" ? deps.saveConfigs : config.saveConfigs;
  const normalizeConfig = typeof deps.normalizeConfig === "function"
    ? deps.normalizeConfig
    : config.normalizeConfig;
  const clearBackendSavedPageMarkings =
    typeof deps.clearBackendSavedPageMarkings === "function"
      ? deps.clearBackendSavedPageMarkings
      : config.clearBackendSavedPageMarkings;
  const getBackendSavedPageMarkings =
    typeof deps.getBackendSavedPageMarkings === "function"
      ? deps.getBackendSavedPageMarkings
      : config.getBackendSavedPageMarkings;
  const setBackendSavedPageMarkings =
    typeof deps.setBackendSavedPageMarkings === "function"
      ? deps.setBackendSavedPageMarkings
      : config.setBackendSavedPageMarkings;
  const shouldContinue =
    typeof options.shouldContinue === "function"
      ? options.shouldContinue
      : () => true;
  const requestId = Number.isFinite(options.requestId) ? Math.trunc(options.requestId as number) : 0;

  const configs = await getConfigs() as StoredConfigs;
  if (!shouldContinue()) {
    return { changed: false, baseUrl: "" };
  }
  const normalizedCurrent = configs[resolvedBaseUrl]
    ? normalizeConfig(resolvedBaseUrl, configs[resolvedBaseUrl]).config
    : null;
  const hadLocalPageMarkings = Boolean(
    normalizedCurrent &&
      normalizedCurrent.pageMarkings &&
      typeof normalizedCurrent.pageMarkings === "object" &&
      Object.keys(normalizedCurrent.pageMarkings).length > 0
  );
  const hadLocalSelectorState = Boolean(
    normalizedCurrent &&
      (
        (normalizedCurrent.selectors &&
          typeof normalizedCurrent.selectors === "object" &&
          (
            (Array.isArray(normalizedCurrent.selectors.exclusionSelectors) &&
              normalizedCurrent.selectors.exclusionSelectors.length > 0) ||
            (Array.isArray(normalizedCurrent.selectors.inclusionSelectors) &&
              normalizedCurrent.selectors.inclusionSelectors.length > 0)
          )) ||
        config.normalizeEntryTimestamp(normalizedCurrent.selectorsUpdatedAt) !==
          config.PAGE_TIMESTAMP_FALLBACK ||
        (
          typeof normalizedCurrent.submittedSelectorsFingerprint === "string" &&
          normalizedCurrent.submittedSelectorsFingerprint.trim().length > 0
        )
      )
  );
  const previousConfigEntry = normalizedCurrent ? { ...normalizedCurrent } : null;
  const backendSavedPageMarkings = await getBackendSavedPageMarkings(resolvedBaseUrl);
  if (!shouldContinue()) {
    return { changed: false, baseUrl: "" };
  }
  const clearedConfigEntry = normalizedCurrent
    ? {
      ...normalizedCurrent,
      pageMarkings: {},
      selectors: config.createEmptyAiSelectorSet(),
      selectorsUpdatedAt: config.PAGE_TIMESTAMP_FALLBACK,
      submittedSelectorsFingerprint: ""
    }
    : null;
  const restoreLocalState = async (options: { expectBackendCleared: boolean }) => {
    if ((remoteMissingClearOwnerByBaseUrl.get(resolvedBaseUrl) || 0) !== requestId) {
      return;
    }
    const restoreConfigs = await getConfigs() as StoredConfigs;
    if (clearedConfigEntry) {
      const currentEntry = restoreConfigs[resolvedBaseUrl]
        ? normalizeConfig(resolvedBaseUrl, restoreConfigs[resolvedBaseUrl]).config
        : null;
      if (JSON.stringify(currentEntry) !== JSON.stringify(clearedConfigEntry)) {
        return;
      }
    }
    if (options.expectBackendCleared) {
      const currentBackendSavedPageMarkings = await getBackendSavedPageMarkings(resolvedBaseUrl);
      if (JSON.stringify(currentBackendSavedPageMarkings || {}) !== JSON.stringify({})) {
        return;
      }
    }
    if (previousConfigEntry) {
      restoreConfigs[resolvedBaseUrl] = previousConfigEntry;
    } else {
      delete restoreConfigs[resolvedBaseUrl];
    }
    await saveConfigs(restoreConfigs);
    await setBackendSavedPageMarkings(resolvedBaseUrl, backendSavedPageMarkings);
  };
  if (requestId) {
    remoteMissingClearOwnerByBaseUrl.set(resolvedBaseUrl, requestId);
  }
  if ((hadLocalPageMarkings || hadLocalSelectorState) && normalizedCurrent && clearedConfigEntry) {
    configs[resolvedBaseUrl] = clearedConfigEntry;
    await saveConfigs(configs);
    if (!shouldContinue()) {
      await restoreLocalState({ expectBackendCleared: false });
      return { changed: false, baseUrl: "" };
    }
  }

  const hadBackendSavedPageMarkings = Boolean(
    backendSavedPageMarkings &&
      typeof backendSavedPageMarkings === "object" &&
      Object.keys(backendSavedPageMarkings).length > 0
  );
  await clearBackendSavedPageMarkings(resolvedBaseUrl);
  if (!shouldContinue()) {
    await restoreLocalState({ expectBackendCleared: true });
    return { changed: false, baseUrl: "" };
  }
  if ((remoteMissingClearOwnerByBaseUrl.get(resolvedBaseUrl) || 0) === requestId) {
    remoteMissingClearOwnerByBaseUrl.delete(resolvedBaseUrl);
  }

  return {
    changed: hadLocalPageMarkings || hadLocalSelectorState || hadBackendSavedPageMarkings,
    baseUrl: resolvedBaseUrl
  };
}

export async function loadRemoteConfigForCurrentPage(deps: RemoteConfigDeps, options: LoadRemoteConfigOptions = {}) {
  const opts = options;
  const {
    tabId = null,
    pageUrl = "",
    baseUrl = "",
    siteId = null,
    endpointValue = "",
    force = false,
    notifyOnChange = false
  } = opts;
  if (!tabId || !siteId || !endpointValue) {
    const result = { status: "skipped", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    deps.updateLastConfigLoadStatus(result);
    return result;
  }
  const loadKey = buildRemoteConfigLoadKey(tabId, siteId, endpointValue);
  const pageLoadKey = buildRemoteConfigPageLoadKey(tabId, pageUrl, siteId, endpointValue);
  const siteCacheKey = buildRemoteConfigSiteCacheKey(siteId, endpointValue);
  const requestId = state.remoteConfigLoadRequestCounter + 1;
  state.remoteConfigLoadRequestCounter = requestId;
  if (pageLoadKey) {
    state.remoteConfigLatestRequestIdByPageLoadKey.set(pageLoadKey, requestId);
  }
  const cachedPageLoadResult = state.remoteConfigLoadResultByKey.get(pageLoadKey) || null;
  if (
    !force &&
    cachedPageLoadResult &&
    (
      cachedPageLoadResult.status === "ok" ||
      cachedPageLoadResult.status === "not_found"
    )
  ) {
    state.remoteConfigLoadKey = loadKey;
    state.remoteConfigLoadResult = cachedPageLoadResult;
    deps.updateLastConfigLoadStatus(cachedPageLoadResult);
    return cachedPageLoadResult;
  }
  state.remoteConfigLoadKey = loadKey;
  const loadUrl = deps.resolveRelativeEndpoint(endpointValue, "/load");
  if (!loadUrl) {
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    deps.updateLastConfigLoadStatus(result);
    return result;
  }
  try {
    const response = await messages.sendRuntimeMessage({
      type: "loadRemoteConfigSnapshot",
      siteId
    });
    if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    if (response && response.status === "auth_error") {
      await deps.invalidateTokenAndLockConfiguration(true);
      const result = { status: "auth_error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
      return result;
    }
    if (response && response.status === "not_found") {
      state.remoteConfigSiteFenceByKey.set(
        siteCacheKey,
        Math.max(state.remoteConfigSiteFenceByKey.get(siteCacheKey) || 0, requestId)
      );
      clearRemoteConfigPageLoadCacheForSite(siteCacheKey);
      if (pageLoadKey) {
        state.remoteConfigLatestRequestIdByPageLoadKey.set(pageLoadKey, requestId);
      }
      if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
        return { status: "skipped", baseUrl: "" };
      }
      const clearResult = await clearLocalPageMarkingsWhenRemoteIsMissing(
        deps,
        baseUrl || state.currentBaseUrl,
        {
          requestId,
          shouldContinue: () => canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)
        }
      );
      if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
        return { status: "skipped", baseUrl: "" };
      }
      if (clearResult.baseUrl && pageUrl) {
        await messages.sendTabMessageWithRetry({
          type: "clearPageSaveReconciliation",
          baseUrl: clearResult.baseUrl,
          pageUrl
        }, 2);
        if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
          return { status: "skipped", baseUrl: "" };
        }
      }
      if (clearResult.baseUrl) {
        await messages.sendTabMessageWithRetry({
          type: "configUpdated",
          baseUrl: clearResult.baseUrl,
          forceReloadPageEntry: true
        }, 2);
        if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
          return { status: "skipped", baseUrl: "" };
        }
      }
      const result = {
        status: "not_found",
        baseUrl: clearResult.baseUrl || (baseUrl || state.currentBaseUrl || ""),
        changed: clearResult.changed
      };
      if (pageLoadKey && canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
        state.remoteConfigLoadResultByKey.set(pageLoadKey, result);
      }
      if (canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
        state.remoteConfigLoadResult = result;
        deps.updateLastConfigLoadStatus(result);
      }
      return result;
    }
    if (!response || response.ok !== true || response.status !== "ok") {
      const result = { status: "error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
      return result;
    }
    if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    const replaceServerConfigIntoLocal =
      typeof deps.replaceServerConfigIntoLocalSnapshot === "function"
        ? deps.replaceServerConfigIntoLocalSnapshot
        : replaceServerConfigIntoLocalSnapshot;
    const replaceResult = await replaceServerConfigIntoLocal({
      payloadKey: typeof response.payloadKey === "string" ? response.payloadKey : "",
      currentPageUrl: pageUrl,
      siteId,
      requestId,
      shouldContinue: () => canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)
    });
    if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    if (!replaceResult.ok) {
      const result = { status: "not_found", baseUrl: "" };
      if (canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
        state.remoteConfigLoadResult = result;
        deps.updateLastConfigLoadStatus(result);
      }
      return result;
    }
    if (replaceResult.changed && replaceResult.baseUrl) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: replaceResult.baseUrl,
        forceReloadPageEntry: replaceResult.replacedCurrentPage
      }, 2);
    }
    if (replaceResult.changed && notifyOnChange) {
      deps.showToast(deps.PopupText.page.remoteDataUpdated);
    }
    const result = {
      status: "ok",
      baseUrl: replaceResult.baseUrl
    };
    if (pageLoadKey && canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      state.remoteConfigLoadResultByKey.set(pageLoadKey, result);
    }
    if (canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
    }
    return result;
  } catch {
    if (!canApplyRemoteConfigLoadResult(tabId, pageUrl, pageLoadKey, siteCacheKey, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    deps.updateLastConfigLoadStatus(result);
    return result;
  }
}

export async function syncBaseConfigToServer(deps: RemoteConfigDeps, options: SyncBaseConfigOptions = {}) {
  const opts = options;
  const {
    baseUrl = "",
    pageUrl = "",
    endpointValue = "",
    tokenValue = "",
    stageBase = "",
    alertOnCurrentReplacement = true,
    includeCurrentPageMarking = false,
    includeAllLocalPageMarkings = false,
    maxAttempts = 5
  } = opts;
  if (!baseUrl || !pageUrl || !endpointValue) {
    return { ok: false, skipped: true };
  }
  if (!deps.resolveRelativeEndpoint(endpointValue, "/save")) {
    return { ok: false, skipped: true };
  }
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let retryDelayMs = 1500;
  let lastStatus = 0;
  let currentTokenValue = tokenValue || "";
  let currentBaseUrl = baseUrl;
  const getConfigs = typeof deps.getConfigs === "function" ? deps.getConfigs : config.getConfigs;
  const saveConfigs = typeof deps.saveConfigs === "function" ? deps.saveConfigs : config.saveConfigs;
  const normalizeConfig = typeof deps.normalizeConfig === "function" ? deps.normalizeConfig : config.normalizeConfig;
  const getBackendSavedPageMarkings =
    typeof deps.getBackendSavedPageMarkings === "function"
      ? deps.getBackendSavedPageMarkings
      : config.getBackendSavedPageMarkings;
  const createConfigSyncPayload =
    typeof deps.createConfigSyncPayload === "function"
      ? deps.createConfigSyncPayload
      : config.createConfigSyncPayload;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const allConfigs: StoredConfigs = await getConfigs();
    const siteIdResult = await deps.ensureBaseUrlSiteId({
      baseUrl: currentBaseUrl,
      pageUrl,
      stageBase,
      tokenValue: currentTokenValue,
      configs: allConfigs
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      return { ok: false, skipped: true, reason: siteIdResult.reason || deps.PopupText.status.missingSiteId };
    }
    const resolvedBaseUrl = siteIdResult.baseUrl || baseUrl;
    currentBaseUrl = resolvedBaseUrl;
    const workingConfigs = siteIdResult.configs || allConfigs;
    try {
      const refreshedToken = await deps.getStoredGlobalToken({ trim: true });
      if (refreshedToken) {
        currentTokenValue = refreshedToken;
      }
    } catch {
      // Ignore token refresh read errors; continue with the current in-memory token.
    }
    const normalized = normalizeConfig(resolvedBaseUrl, workingConfigs[resolvedBaseUrl]);
    const sourceConfig: StoredConfigEntry = normalized.config;
    if (!workingConfigs[resolvedBaseUrl] || normalized.changed) {
      workingConfigs[resolvedBaseUrl] = sourceConfig;
      await saveConfigs(workingConfigs);
    }
    const propertyPageTypesResult = await deps.ensurePropertyPageTypes({
      siteId: siteIdResult.siteId,
      stageBase,
      tokenValue: currentTokenValue,
      force: false,
      notifyOnChange: false
    });
    const backendSavedPageMarkings = await getBackendSavedPageMarkings(resolvedBaseUrl);
    const backendSavedPageMarkingItems = deps.collectStoredPageMarkingItems(
      backendSavedPageMarkings,
      resolvedBaseUrl
    );
    const localPageMarkingItems = deps.collectStoredPageMarkingItems(
      sourceConfig.pageMarkings,
      resolvedBaseUrl
    );
    const backendSavedPageUrls = new Set(
      Object.keys(backendSavedPageMarkings || {}).filter(Boolean)
    );
    const currentPageEntry =
      typeof pageUrl === "string" &&
      pageUrl &&
      sourceConfig.pageMarkings &&
      typeof sourceConfig.pageMarkings === "object"
        ? sourceConfig.pageMarkings[pageUrl]
        : null;
    let filterPageMarking = (url: string, entry?: { pageType?: unknown }) =>
      includeAllLocalPageMarkings ||
      backendSavedPageUrls.has(url) ||
      (includeCurrentPageMarking && url === pageUrl);
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      const coverageModel = deps.buildLynxChecklistViewModel({
        aiAnswer: "yes",
        pageTypes: propertyPageTypesResult.pageTypes,
        markedPages: includeAllLocalPageMarkings
          ? localPageMarkingItems
          : backendSavedPageMarkingItems
      });
      const activePageMarkingKeys = new Set(
        coverageModel.activeMarkedPages
          .map((item) => deps.buildPageMarkingKey(item.url, item.pageType))
          .filter(Boolean)
      );
      if (includeCurrentPageMarking && currentPageEntry) {
        activePageMarkingKeys.add(deps.buildPageMarkingKey(pageUrl, currentPageEntry.pageType));
      }
      filterPageMarking = (url: string, entry?: { pageType?: unknown }) =>
        activePageMarkingKeys.has(deps.buildPageMarkingKey(url, entry && entry.pageType));
    }
    const payload = createConfigSyncPayload(resolvedBaseUrl, sourceConfig, {
      filterPageMarking
    });
    try {
      const requestPayloadKey = deps.buildTransferPayloadKey("save-request");
      const stored = await deps.putTransferPayload("save-request", payload, {
        payloadKey: requestPayloadKey
      });
      if (!stored.ok) {
        throw new Error("Unable to persist remote-config save payload");
      }
      const response = await messages.sendRuntimeMessage({
        type: "saveRemoteConfigSnapshot",
        payloadKey: requestPayloadKey
      });
      try {
        const refreshedToken = await deps.getStoredGlobalToken({ trim: true });
        if (refreshedToken) {
          currentTokenValue = refreshedToken;
        }
      } catch {
        // Ignore token refresh read errors; continue with the current in-memory token.
      }
      if (response && response.status === "auth_error") {
        await deps.invalidateTokenAndLockConfiguration(true);
        return { ok: false, status: 401, authExpired: true };
      }
      if (!response || response.ok !== true) {
        if (attempt + 1 < attempts) {
          await deps.waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false };
      }
      if (response.status === "error") {
        lastStatus = Number(response.httpStatus) || 0;
        if (attempt + 1 < attempts && deps.isRetryableHttpStatus(lastStatus)) {
          await deps.waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false, status: lastStatus };
      }
      const responsePayloadKey = typeof response.payloadKey === "string" ? response.payloadKey : "";
      if (response.status !== "ok" || !responsePayloadKey) {
        const mergeResult = await messages.sendRuntimeMessage({
          type: "mergeServerConfigIntoLocalSnapshot",
          payload: {
            ...payload,
            pageMarkings: {}
          },
          currentPageUrl: pageUrl,
          confirmedPageMarkings: payload.pageMarkings,
          preferConfirmedPageMarkings: includeCurrentPageMarking || includeAllLocalPageMarkings
        });
        return { ok: mergeResult.ok, replacedCurrentPage: false };
      }

      const mergeResult = await messages.sendRuntimeMessage({
        type: "mergeServerConfigIntoLocalSnapshot",
        payloadKey: responsePayloadKey,
        currentPageUrl: pageUrl,
        confirmedPageMarkings: payload.pageMarkings,
        preferConfirmedPageMarkings: includeCurrentPageMarking || includeAllLocalPageMarkings
      });
      if (!mergeResult.ok) {
        return { ok: false };
      }
      await deps.pruneRemoteInvalidPageMarkings({
        siteId: siteIdResult.siteId,
        invalidUrls: mergeResult.invalidLoadedUrls || []
      });
      if (mergeResult.changed && mergeResult.baseUrl) {
        await messages.sendTabMessageWithRetry({
          type: "configUpdated",
          baseUrl: mergeResult.baseUrl,
          forceReloadPageEntry: mergeResult.replacedCurrentPage
        }, 2);
      }
      if (mergeResult.replacedCurrentPage && alertOnCurrentReplacement) {
        deps.windowRef.alert(deps.PopupText.alerts.newerRemoteDataReplacedLocal);
      }
      return {
        ok: true,
        replacedCurrentPage: mergeResult.replacedCurrentPage,
        baseUrl: resolvedBaseUrl
      };
    } catch (error) {
      if (attempt + 1 < attempts) {
        await deps.waitForRetryDelay(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 10000);
        continue;
      }
      return { ok: false };
    }
  }
  return { ok: false, status: lastStatus };
}
