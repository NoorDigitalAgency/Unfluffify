import * as config from "../common/config.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";

const { state } = stateModule;
const DEFAULT_REMOTE_CONFIG_RETRY_DELAY_MS = 2500;

type StoredPageMarkings = Record<string, Record<string, unknown>>;
type StoredConfigEntry = { pageMarkings?: StoredPageMarkings; [key: string]: unknown };
type StoredConfigs = Record<string, StoredConfigEntry>;

interface LoadRemoteConfigOptions {
  tabId?: number | null;
  pageUrl?: string;
  baseUrl?: string;
  siteId?: number | null;
  endpointValue?: string;
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
  baseUrl?: unknown;
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
  activeMarkedPages: Array<{ url: unknown; pageType: unknown }>;
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
    configs?: unknown;
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
  pruneRemoteInvalidPageMarkings(options: { siteId?: number | string | null; invalidUrls?: unknown }): Promise<unknown>;
  clearBackendSavedPageMarkings?: typeof config.clearBackendSavedPageMarkings;
  getConfigs?: typeof config.getConfigs;
  saveConfigs?: typeof config.saveConfigs;
  normalizeConfig?: typeof config.normalizeConfig;
  getBackendSavedPageMarkings?: typeof config.getBackendSavedPageMarkings;
  createConfigSyncPayload?: typeof config.createConfigSyncPayload;
}

function buildRemoteConfigLoadKey(tabId: unknown, siteId: unknown, endpointValue: unknown) {
  return `${tabId || ""}|${siteId || ""}|${endpointValue || ""}`;
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
    if (response && response.status === "auth_error") {
      await deps.invalidateTokenAndLockConfiguration(true);
      const result = { status: "auth_error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
      return result;
    }
    if (response && response.status === "not_found") {
      const clearBackendSavedPageMarkings =
        typeof deps.clearBackendSavedPageMarkings === "function"
          ? deps.clearBackendSavedPageMarkings
          : config.clearBackendSavedPageMarkings;
      await clearBackendSavedPageMarkings(baseUrl || state.currentBaseUrl);
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
      return result;
    }
    if (!response || response.ok !== true || response.status !== "ok") {
      const result = { status: "error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
      return result;
    }
    const replaceResult = await messages.sendRuntimeMessage({
      type: "replaceServerConfigIntoLocalSnapshot",
      payloadKey: typeof response.payloadKey === "string" ? response.payloadKey : "",
      currentPageUrl: pageUrl,
      siteId
    });
    if (!replaceResult.ok) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      deps.updateLastConfigLoadStatus(result);
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
    state.remoteConfigLoadResult = result;
    deps.updateLastConfigLoadStatus(result);
    return result;
  } catch {
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
