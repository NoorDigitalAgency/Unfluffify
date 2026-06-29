import * as configStore from "../common/config";
import { normalizeSiteIdValue } from "../common/lynx-live-pages";
import * as utils from "../common/utilities";
import type { Config } from "../types/config";

type StoredConfigs = Record<string, Config>;
type NavigationDetails = {
  frameId?: number;
  tabId?: number;
  url?: string;
  timeStamp?: number;
  documentId?: string;
};
type RemoteLoadResponse = {
  ok?: boolean;
  status?: string;
  payloadKey?: string;
};
type ReplaceRemoteResult = {
  ok?: boolean;
  changed?: boolean;
  replacedCurrentPage?: boolean;
  baseUrl?: string;
  skipped?: boolean;
};
type ClearMissingRemoteResult = {
  changed?: boolean;
  baseUrl?: string;
};
type LivePageSiteIdResult = {
  ok?: boolean;
  siteId?: number | string | null;
  baseUrl?: string;
  notFound?: boolean;
};
type TabSnapshot = {
  id?: number;
  url?: string;
};
type TabStateSnapshot = {
  baseUrl?: string;
};
type PageDataLoadInput = {
  tabId?: number | null;
  pageUrl?: string;
  baseUrl?: string;
  siteId?: number | string | null;
  endpointValue?: string;
  tokenValue?: string;
  force?: boolean;
  navigationKey?: string;
};
type PageDataLoadResult = {
  status: "skipped" | "ok" | "not_found" | "auth_error" | "error";
  baseUrl: string;
  changed?: boolean;
  replacedCurrentPage?: boolean;
};
type PageDataLoadContext = {
  tabId: number;
  pageUrl: string;
  baseUrl: string;
  siteId: ReturnType<typeof normalizeSiteIdValue>;
  navigationKey: string;
  endpointValue: string;
  tokenValue: string;
};
type PageDataLifecycleDeps = {
  getConfigs?: typeof configStore.getConfigs;
  saveConfigs?: typeof configStore.saveConfigs;
  normalizeConfig?: typeof configStore.normalizeConfig;
  loadRemoteConfigSnapshot(options: {
    endpointValue?: string;
    tokenValue?: string;
    siteId?: number | string | null;
  }): Promise<RemoteLoadResponse>;
  replaceServerConfigIntoLocalSnapshot(options: {
    payloadKey?: string;
    currentPageUrl?: string;
    siteId?: number | string | null;
    requestId?: number;
    shouldContinue?: () => boolean;
  }): Promise<ReplaceRemoteResult>;
  clearLocalPageDataForMissingRemote(options: {
    baseUrl?: string;
    requestId?: number;
    shouldContinue?: () => boolean;
  }): Promise<ClearMissingRemoteResult>;
  clearPageSaveReconciliation?: typeof configStore.clearPageSaveReconciliation;
  resolveLivePageSiteId(options: { pageUrl?: string }): Promise<LivePageSiteIdResult>;
  getTab(tabId: number): Promise<TabSnapshot | null>;
  getTabState(tabId: number): Promise<TabStateSnapshot | null>;
  sendContentMessageToTab(tabId: number, message: Record<string, unknown>): Promise<{ ok?: boolean }>;
  recordPageDataLoadNeeded?: (
    tabId: number,
    fact: { pageDataLoadNeeded: boolean; pageUrl: string; baseUrl: string; navigationKey: string },
    reason: string
  ) => void;
};

function normalizeTabId(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function normalizePageUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function normalizeBaseUrl(value: unknown): string {
  return (
    utils.normalizeCanonicalBaseUrl(value) ||
    utils.normalizeBaseUrl(value) ||
    (typeof value === "string" ? value.trim() : "")
  );
}

function buildNavigationKey(tabId: number, pageUrl: string, source: unknown): string {
  if (typeof source === "string" && source.trim()) {
    return `${tabId}|${pageUrl}|${source.trim()}`;
  }
  if (Number.isFinite(source)) {
    return `${tabId}|${pageUrl}|${Math.trunc(Number(source))}`;
  }
  return `${tabId}|${pageUrl}|manual`;
}

function canUseCachedResult(result: PageDataLoadResult | null, force: boolean): result is PageDataLoadResult {
  return Boolean(
    !force &&
      result &&
      (result.status === "ok" || result.status === "not_found")
  );
}

function normalizeConfigs(value: Awaited<ReturnType<typeof configStore.getConfigs>>): StoredConfigs {
  return value && typeof value === "object" ? value as StoredConfigs : {};
}

export function createPageDataLifecycleLoader(deps: PageDataLifecycleDeps) {
  const getConfigs = typeof deps.getConfigs === "function" ? deps.getConfigs : configStore.getConfigs;
  const saveConfigs = typeof deps.saveConfigs === "function" ? deps.saveConfigs : configStore.saveConfigs;
  const normalizeConfig = typeof deps.normalizeConfig === "function" ? deps.normalizeConfig : configStore.normalizeConfig;
  const clearPageSaveReconciliation =
    typeof deps.clearPageSaveReconciliation === "function"
      ? deps.clearPageSaveReconciliation
      : configStore.clearPageSaveReconciliation;
  const latestNavigationKeyByTabId = new Map<number, string>();
  const latestNavigationUrlByTabId = new Map<number, string>();
  const loadResultByNavigationKey = new Map<string, PageDataLoadResult>();
  const latestRequestIdByNavigationKey = new Map<string, number>();
  const siteFenceRequestIdByKey = new Map<string, number>();
  let requestCounter = 0;

  function canApplyLoadResult(context: PageDataLoadContext, requestId: number): boolean {
    if ((latestRequestIdByNavigationKey.get(context.navigationKey) || 0) !== requestId) {
      return false;
    }
    const siteKey = `${context.siteId}|${context.endpointValue}`;
    if ((siteFenceRequestIdByKey.get(siteKey) || 0) > requestId) {
      return false;
    }
    return true;
  }

  async function persistResolvedSiteContext(
    configs: StoredConfigs,
    baseUrl: string,
    siteId: ReturnType<typeof normalizeSiteIdValue>
  ): Promise<void> {
    if (!baseUrl || !siteId) {
      return;
    }
    const normalized = normalizeConfig(baseUrl, configs[baseUrl]).config;
    if (normalizeSiteIdValue(normalized.siteId) === siteId && configs[baseUrl]) {
      return;
    }
    configs[baseUrl] = {
      ...normalized,
      siteId
    };
    await saveConfigs(configs);
  }

  async function resolveContext(input: PageDataLoadInput): Promise<PageDataLoadContext | null> {
    const tabId = normalizeTabId(input.tabId);
    if (!tabId) {
      return null;
    }
    const tab = await deps.getTab(tabId).catch(() => null);
    const pageUrl = normalizePageUrl(input.pageUrl) || normalizePageUrl(tab?.url);
    if (!pageUrl) {
      return null;
    }
    const configs = normalizeConfigs(await getConfigs());
    const tabState = await deps.getTabState(tabId).catch(() => null);
    const requestedBaseUrl = normalizeBaseUrl(input.baseUrl);
    const tabStateBaseUrl = normalizeBaseUrl(tabState?.baseUrl);
    const matchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
    let baseUrl = requestedBaseUrl && utils.isPageWithinBaseUrl(pageUrl, requestedBaseUrl)
      ? requestedBaseUrl
      : tabStateBaseUrl && utils.isPageWithinBaseUrl(pageUrl, tabStateBaseUrl)
        ? tabStateBaseUrl
        : matchingBaseUrl;
    let siteId = normalizeSiteIdValue(input.siteId);
    if (baseUrl && !siteId) {
      const normalized = normalizeConfig(baseUrl, configs[baseUrl]).config;
      siteId = normalizeSiteIdValue(normalized.siteId);
    }
    if (!baseUrl || !siteId) {
      const resolved = await deps.resolveLivePageSiteId({ pageUrl });
      if (!resolved || !resolved.ok || !resolved.siteId || !resolved.baseUrl) {
        return null;
      }
      baseUrl = normalizeBaseUrl(resolved.baseUrl);
      siteId = normalizeSiteIdValue(resolved.siteId);
      if (!baseUrl || !siteId || !utils.isPageWithinBaseUrl(pageUrl, baseUrl)) {
        return null;
      }
      await persistResolvedSiteContext(configs, baseUrl, siteId);
    }
    const endpointValue = typeof input.endpointValue === "string" ? input.endpointValue.trim() : "";
    const tokenValue = typeof input.tokenValue === "string" ? input.tokenValue : "";
    const navigationKey =
      input.navigationKey ||
      (
        latestNavigationUrlByTabId.get(tabId) === pageUrl
          ? latestNavigationKeyByTabId.get(tabId)
          : ""
      ) ||
      buildNavigationKey(tabId, pageUrl, "manual");
    return {
      tabId,
      pageUrl,
      baseUrl,
      siteId,
      navigationKey,
      endpointValue,
      tokenValue
    };
  }

  async function loadPageDataForNavigation(input: PageDataLoadInput = {}): Promise<PageDataLoadResult> {
    const context = await resolveContext(input);
    if (!context) {
      return { status: "skipped", baseUrl: "" };
    }
    const force = input.force === true;
    const cachedResult = loadResultByNavigationKey.get(context.navigationKey) || null;
    if (canUseCachedResult(cachedResult, force)) {
      return cachedResult;
    }
    deps.recordPageDataLoadNeeded?.(
      context.tabId,
      {
        pageDataLoadNeeded: true,
        pageUrl: context.pageUrl,
        baseUrl: context.baseUrl,
        navigationKey: context.navigationKey
      },
      "page-data:navigation-load-needed"
    );
    const requestId = requestCounter + 1;
    requestCounter = requestId;
    latestRequestIdByNavigationKey.set(context.navigationKey, requestId);
    const response = await deps.loadRemoteConfigSnapshot({
      endpointValue: context.endpointValue,
      tokenValue: context.tokenValue,
      siteId: context.siteId
    });
    if (!canApplyLoadResult(context, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    if (response && response.status === "auth_error") {
      return { status: "auth_error", baseUrl: "" };
    }
    if (response && response.status === "not_found") {
      siteFenceRequestIdByKey.set(`${context.siteId}|${context.endpointValue}`, requestId);
      const clearResult = await deps.clearLocalPageDataForMissingRemote({
        baseUrl: context.baseUrl,
        requestId,
        shouldContinue: () => canApplyLoadResult(context, requestId)
      });
      if (!canApplyLoadResult(context, requestId)) {
        return { status: "skipped", baseUrl: "" };
      }
      await clearPageSaveReconciliation(context.baseUrl, context.pageUrl);
      await deps.sendContentMessageToTab(context.tabId, {
        type: "clearPageSaveReconciliation",
        baseUrl: context.baseUrl,
        pageUrl: context.pageUrl
      });
      if (!canApplyLoadResult(context, requestId)) {
        return { status: "skipped", baseUrl: "" };
      }
      await deps.sendContentMessageToTab(context.tabId, {
        type: "configUpdated",
        baseUrl: context.baseUrl,
        forceReloadPageEntry: true
      });
      if (!canApplyLoadResult(context, requestId)) {
        return { status: "skipped", baseUrl: "" };
      }
      const result: PageDataLoadResult = {
        status: "not_found",
        baseUrl: clearResult.baseUrl || context.baseUrl,
        changed: Boolean(clearResult.changed)
      };
      loadResultByNavigationKey.set(context.navigationKey, result);
      return result;
    }
    if (!response || response.ok !== true || response.status !== "ok") {
      return { status: "error", baseUrl: "" };
    }
    const replaceResult = await deps.replaceServerConfigIntoLocalSnapshot({
      payloadKey: typeof response.payloadKey === "string" ? response.payloadKey : "",
      currentPageUrl: context.pageUrl,
      siteId: context.siteId,
      requestId,
      shouldContinue: () => canApplyLoadResult(context, requestId)
    });
    if (!canApplyLoadResult(context, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    if (!replaceResult.ok) {
      return { status: "not_found", baseUrl: "" };
    }
    const result: PageDataLoadResult = {
      status: "ok",
      baseUrl: typeof replaceResult.baseUrl === "string" ? replaceResult.baseUrl : context.baseUrl,
      changed: Boolean(replaceResult.changed),
      replacedCurrentPage: Boolean(replaceResult.replacedCurrentPage)
    };
    if (result.changed && result.baseUrl) {
      await deps.sendContentMessageToTab(context.tabId, {
        type: "configUpdated",
        baseUrl: result.baseUrl,
        forceReloadPageEntry: result.replacedCurrentPage
      });
    }
    if (!canApplyLoadResult(context, requestId)) {
      return { status: "skipped", baseUrl: "" };
    }
    loadResultByNavigationKey.set(context.navigationKey, result);
    return result;
  }

  async function handleTopLevelNavigationCommitted(details: NavigationDetails = {}): Promise<PageDataLoadResult> {
    if (details.frameId !== 0) {
      return { status: "skipped", baseUrl: "" };
    }
    const tabId = normalizeTabId(details.tabId);
    if (!tabId) {
      return { status: "skipped", baseUrl: "" };
    }
    const pageUrl = normalizePageUrl(details.url) || normalizePageUrl((await deps.getTab(tabId).catch(() => null))?.url);
    if (!pageUrl) {
      return { status: "skipped", baseUrl: "" };
    }
    const navigationSource = details.documentId || details.timeStamp || Date.now();
    const navigationKey = buildNavigationKey(tabId, pageUrl, navigationSource);
    latestNavigationKeyByTabId.set(tabId, navigationKey);
    latestNavigationUrlByTabId.set(tabId, pageUrl);
    return loadPageDataForNavigation({
      tabId,
      pageUrl,
      navigationKey
    });
  }

  return {
    handleTopLevelNavigationCommitted,
    loadPageDataForNavigation
  };
}
