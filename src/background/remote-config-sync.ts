import * as configStore from "../common/config";
import { buildLynxChecklistAssignments, normalizePropertyPageTypes } from "../common/lynx-checklist";
import { normalizeSiteIdValue } from "../common/lynx-live-pages";
import { aiSelectorSetsEqual, normalizeAiSelectorSet } from "../common/selector-set";
import * as utils from "../common/utilities";
import {
  consumeTransferPayload,
  putTransferPayload
} from "./transfer-payload-store";
import { fetchStaticPageHtmlForBackground } from "./remote-network";
import type { Config, PageMarkings } from "../types/config.ts";

type StoredConfigs = Record<string, unknown>;
type StoredPageMarkingItem = {
  url: string;
  title: string;
  pageType: string;
  count: number;
};
type RemoteConfigSyncOptions = Record<string, unknown>;
type StoredConfigEntry = Record<string, unknown>;

interface SelectorMergeableConfig {
  selectors?: object | null;
  selectorsUpdatedAt?: string | null;
  submittedSelectorsFingerprint?: string | null;
  [key: string]: unknown;
}

type RuntimeConfig = {
  baseUrl?: string;
  stageBase?: string;
  siteId?: string | null;
  token?: string;
  renderMode?: string;
  renderModeUpdatedAt?: string;
  pageMarkings: PageMarkings;
  selectors?: object | null;
  selectorsUpdatedAt?: string | null;
  submittedSelectorsFingerprint?: string | null;
  [key: string]: unknown;
};

type NormalizedConfigResult = {
  config: RuntimeConfig;
  changed: boolean;
};

const replaceOwnerByBaseUrl = new Map<string, number>();
const remoteMissingClearOwnerByBaseUrl = new Map<string, number>();

function normalizeConfigResult(baseUrl: string, incoming: unknown): NormalizedConfigResult {
  return configStore.normalizeConfig(baseUrl, incoming) as unknown as NormalizedConfigResult;
}

export function collectStoredPageMarkingItems(pageMarkings: unknown, baseUrl = "") {
  const items: StoredPageMarkingItem[] = [];
  const pageMarkingsRecord =
    pageMarkings && typeof pageMarkings === "object"
      ? (pageMarkings as Record<string, unknown>)
      : {};
  Object.entries(pageMarkingsRecord).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    const entryRecord = entry as Record<string, unknown>;
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
    const excludedCount = Array.isArray(entryRecord.xpaths)
      ? entryRecord.xpaths.filter((item) => item && item.excluded && item.xpath).length
      : 0;
    const includedCount = Array.isArray(entryRecord.includeXpaths)
      ? entryRecord.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath).length
      : 0;
    const title = typeof entryRecord.title === "string" && entryRecord.title ? entryRecord.title : url;
    const pageType = typeof entryRecord.pageType === "string" ? entryRecord.pageType : "";
    items.push({
      url,
      title,
      pageType,
      count: excludedCount + includedCount
    });
  });
  return items;
}

export function mergeSelectorsIntoConfig(targetConfig: unknown, incomingConfig: unknown) {
  const targetConfigAny = targetConfig as SelectorMergeableConfig;
  const incomingConfigAny = incomingConfig as SelectorMergeableConfig;
  if (!targetConfigAny || typeof targetConfigAny !== "object") {
    return false;
  }
  const merged = configStore.mergeConfigSelectorStateByTimestamp(
    targetConfigAny.selectors,
    targetConfigAny.selectorsUpdatedAt,
    targetConfigAny.submittedSelectorsFingerprint,
    incomingConfigAny && typeof incomingConfigAny === "object" ? incomingConfigAny.selectors : null,
    incomingConfigAny && typeof incomingConfigAny === "object"
      ? incomingConfigAny.selectorsUpdatedAt
      : null,
    incomingConfigAny && typeof incomingConfigAny === "object"
      ? incomingConfigAny.submittedSelectorsFingerprint
      : ""
  );
  const currentSelectorSet = normalizeAiSelectorSet(targetConfigAny.selectors);
  const currentUpdatedAt = configStore.normalizeEntryTimestamp(targetConfigAny.selectorsUpdatedAt);
  const currentSubmittedFingerprint =
    typeof targetConfigAny.submittedSelectorsFingerprint === "string"
      ? targetConfigAny.submittedSelectorsFingerprint.trim()
      : "";
  const didChange =
    !aiSelectorSetsEqual(currentSelectorSet, merged.selectorSet) ||
    currentUpdatedAt !== merged.updatedAt ||
    currentSubmittedFingerprint !== merged.submittedFingerprint;
  if (didChange) {
    targetConfigAny.selectors = merged.selectorSet;
    targetConfigAny.selectorsUpdatedAt = merged.updatedAt;
    targetConfigAny.submittedSelectorsFingerprint = merged.submittedFingerprint;
  }
  return didChange;
}

export function getRemoteManagedConfigSignature(baseUrl: unknown, sourceConfig: unknown) {
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl) {
    return "";
  }
  const normalizedConfig = configStore.normalizeConfig(
    normalizedBaseUrl,
    sourceConfig || configStore.createDefaultConfig(normalizedBaseUrl)
  ).config;
  return JSON.stringify(configStore.createConfigSyncPayload(normalizedBaseUrl, normalizedConfig));
}

export function getNormalizedPageEntrySignature(pageUrl: unknown, entry: unknown) {
  const normalizedPageUrl = typeof pageUrl === "string" ? pageUrl : "";
  if (!normalizedPageUrl) {
    return "null";
  }
  const normalizedEntriesAny = configStore.normalizePageMarkings({ [normalizedPageUrl]: entry }).normalized as PageMarkings;
  const normalizedEntry = normalizedEntriesAny[normalizedPageUrl] || null;
  return JSON.stringify(normalizedEntry);
}

export async function clearLocalPageDataForMissingRemote(options = {}) {
  const optionsAny = options as RemoteConfigSyncOptions;
  const resolvedBaseUrl =
    utils.normalizeCanonicalBaseUrl(optionsAny.baseUrl) ||
    utils.normalizeBaseUrl(optionsAny.baseUrl) ||
    (typeof optionsAny.baseUrl === "string" ? optionsAny.baseUrl.trim() : "");
  if (!resolvedBaseUrl) {
    return { changed: false, baseUrl: "" };
  }
  const shouldContinue =
    typeof optionsAny.shouldContinue === "function"
      ? optionsAny.shouldContinue as () => boolean
      : () => true;
  const requestId = Number.isFinite(optionsAny.requestId) ? Math.trunc(optionsAny.requestId as number) : 0;

  const configs = (await configStore.getConfigs()) as Record<string, StoredConfigEntry>;
  if (!shouldContinue()) {
    return { changed: false, baseUrl: "" };
  }
  const normalizedCurrent = configs[resolvedBaseUrl]
    ? normalizeConfigResult(resolvedBaseUrl, configs[resolvedBaseUrl]).config
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
            (Array.isArray((normalizedCurrent.selectors as { exclusionSelectors?: unknown }).exclusionSelectors) &&
              (normalizedCurrent.selectors as { exclusionSelectors: unknown[] }).exclusionSelectors.length > 0) ||
            (Array.isArray((normalizedCurrent.selectors as { inclusionSelectors?: unknown }).inclusionSelectors) &&
              (normalizedCurrent.selectors as { inclusionSelectors: unknown[] }).inclusionSelectors.length > 0)
          )) ||
        configStore.normalizeEntryTimestamp(normalizedCurrent.selectorsUpdatedAt) !==
          configStore.PAGE_TIMESTAMP_FALLBACK ||
        (
          typeof normalizedCurrent.submittedSelectorsFingerprint === "string" &&
          normalizedCurrent.submittedSelectorsFingerprint.trim().length > 0
        )
      )
  );
  const previousConfigEntry = normalizedCurrent ? { ...normalizedCurrent } : null;
  const backendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(resolvedBaseUrl);
  if (!shouldContinue()) {
    return { changed: false, baseUrl: "" };
  }
  const clearedConfigEntry = normalizedCurrent
    ? {
      ...normalizedCurrent,
      pageMarkings: {},
      selectors: configStore.createEmptyAiSelectorSet(),
      selectorsUpdatedAt: configStore.PAGE_TIMESTAMP_FALLBACK,
      submittedSelectorsFingerprint: ""
    }
    : null;
  const restoreLocalState = async (restoreOptions: { expectBackendCleared: boolean }) => {
    if ((remoteMissingClearOwnerByBaseUrl.get(resolvedBaseUrl) || 0) !== requestId) {
      return;
    }
    const restoreConfigs = (await configStore.getConfigs()) as Record<string, StoredConfigEntry>;
    if (clearedConfigEntry) {
      const currentEntry = restoreConfigs[resolvedBaseUrl]
        ? normalizeConfigResult(resolvedBaseUrl, restoreConfigs[resolvedBaseUrl]).config
        : null;
      if (JSON.stringify(currentEntry) !== JSON.stringify(clearedConfigEntry)) {
        return;
      }
    }
    if (restoreOptions.expectBackendCleared) {
      const currentBackendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(resolvedBaseUrl);
      if (JSON.stringify(currentBackendSavedPageMarkings || {}) !== JSON.stringify({})) {
        return;
      }
    }
    if (previousConfigEntry) {
      restoreConfigs[resolvedBaseUrl] = previousConfigEntry;
    } else {
      delete restoreConfigs[resolvedBaseUrl];
    }
    await configStore.saveConfigs(restoreConfigs);
    await configStore.setBackendSavedPageMarkings(resolvedBaseUrl, backendSavedPageMarkings);
  };
  if (requestId) {
    remoteMissingClearOwnerByBaseUrl.set(resolvedBaseUrl, requestId);
  }
  if ((hadLocalPageMarkings || hadLocalSelectorState) && normalizedCurrent && clearedConfigEntry) {
    configs[resolvedBaseUrl] = clearedConfigEntry;
    await configStore.saveConfigs(configs);
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
  await configStore.clearBackendSavedPageMarkings(resolvedBaseUrl);
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

export async function replaceServerConfigIntoLocalSnapshot(options = {}) {
  const optionsAny = options as RemoteConfigSyncOptions;
  const shouldContinue =
    typeof optionsAny.shouldContinue === "function"
      ? optionsAny.shouldContinue as () => boolean
      : () => true;
  const requestId = Number.isFinite(optionsAny.requestId) ? Math.trunc(optionsAny.requestId as number) : 0;
  const payloadKey = typeof optionsAny.payloadKey === "string" ? optionsAny.payloadKey.trim() : "";
  let rawPayload = optionsAny.payload;
  if (payloadKey) {
    const loaded = await consumeTransferPayload(payloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    rawPayload = loaded.ok ? loaded.payload : null;
  }
  const normalizedPayload = configStore.normalizeConfigSyncPayload(rawPayload, "");
  const currentPageUrl = typeof optionsAny.currentPageUrl === "string" ? optionsAny.currentPageUrl.trim() : "";
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }

  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = (await configStore.getConfigs()) as StoredConfigs;
  if (!shouldContinue()) {
    return {
      ok: false,
      skipped: true,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }
  const existingRaw = allConfigs[baseUrl];
  const existingBackendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(baseUrl);
  if (!shouldContinue()) {
    return {
      ok: false,
      skipped: true,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }
  const existingConfig = normalizeConfigResult(baseUrl, existingRaw).config;
  const normalizedIncomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const fallbackSiteId = normalizeSiteIdValue(optionsAny.siteId);
  // #load-once step 3: a 200 load COMPLETELY replaces the property config with the
  // server payload — existingConfig is NOT spread in, so no stale local field
  // (siteId, render mode, markings) survives. Render mode comes from the payload
  // (it round-trips via normalizeConfigSyncPayload). This is what kills stale
  // cross-property siteId contamination: the config is session-scoped and fully
  // re-sourced from the backend on each page-session load.
  const nextConfig = normalizeConfigResult(baseUrl, {
    ...normalizedPayload,
    baseUrl,
    siteId: normalizedIncomingSiteId || fallbackSiteId || null,
    pageMarkings: configStore.normalizePageMarkings(normalizedPayload.pageMarkings).normalized,
    selectors: normalizeAiSelectorSet(normalizedPayload.selectors),
    selectorsUpdatedAt: configStore.normalizeEntryTimestamp(normalizedPayload.selectorsUpdatedAt),
    submittedSelectorsFingerprint:
      typeof normalizedPayload.submittedSelectorsFingerprint === "string"
        ? normalizedPayload.submittedSelectorsFingerprint
        : ""
  }).config;

  const previousSignature = getRemoteManagedConfigSignature(baseUrl, existingConfig);
  const nextSignature = getRemoteManagedConfigSignature(baseUrl, nextConfig);
  const changed = previousSignature !== nextSignature;
  const replacedCurrentPage = Boolean(
    currentPageUrl &&
      getNormalizedPageEntrySignature(currentPageUrl, existingConfig.pageMarkings?.[currentPageUrl]) !==
        getNormalizedPageEntrySignature(currentPageUrl, nextConfig.pageMarkings?.[currentPageUrl])
  );
  const restorePreviousSnapshot = async (options: { expectBackendSavedApplied: boolean }) => {
    if ((replaceOwnerByBaseUrl.get(baseUrl) || 0) !== requestId) {
      return;
    }
    const restoreConfigs = (await configStore.getConfigs()) as StoredConfigs;
    const currentConfig = restoreConfigs[baseUrl]
      ? normalizeConfigResult(baseUrl, restoreConfigs[baseUrl]).config
      : null;
    if (JSON.stringify(currentConfig) !== JSON.stringify(nextConfig)) {
      return;
    }
    if (options.expectBackendSavedApplied) {
      const currentBackendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(baseUrl);
      if (JSON.stringify(currentBackendSavedPageMarkings || {}) !== JSON.stringify(nextConfig.pageMarkings || {})) {
        return;
      }
    }
    if (existingRaw === undefined) {
      delete restoreConfigs[baseUrl];
    } else {
      restoreConfigs[baseUrl] = existingRaw;
    }
    await configStore.saveConfigs(restoreConfigs);
    await configStore.setBackendSavedPageMarkings(baseUrl, existingBackendSavedPageMarkings);
  };

  if (!existingRaw || changed) {
    if (requestId) {
      replaceOwnerByBaseUrl.set(baseUrl, requestId);
    }
    allConfigs[baseUrl] = nextConfig;
    await configStore.saveConfigs(allConfigs);
    if (!shouldContinue()) {
      await restorePreviousSnapshot({ expectBackendSavedApplied: false });
      return {
        ok: false,
        skipped: true,
        changed: false,
        replacedCurrentPage: false,
        baseUrl: ""
      };
    }
  }
  await configStore.setBackendSavedPageMarkings(baseUrl, nextConfig.pageMarkings);
  if (!shouldContinue()) {
    await restorePreviousSnapshot({ expectBackendSavedApplied: true });
    return {
      ok: false,
      skipped: true,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }
  if ((replaceOwnerByBaseUrl.get(baseUrl) || 0) === requestId) {
    replaceOwnerByBaseUrl.delete(baseUrl);
  }

  return {
    ok: true,
    changed: Boolean(!existingRaw || changed),
    replacedCurrentPage,
    baseUrl
  };
}

export async function mergeServerConfigIntoLocalSnapshot(options = {}) {
  const optionsAny = options as RemoteConfigSyncOptions;
  const payloadKey = typeof optionsAny.payloadKey === "string" ? optionsAny.payloadKey.trim() : "";
  let payload = optionsAny && typeof optionsAny === "object" ? optionsAny.payload : null;
  if (payloadKey) {
    const loaded = await consumeTransferPayload(payloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    payload = loaded.ok ? loaded.payload : null;
  }
  const invalidLoadedUrls = configStore.collectInvalidPageMarkingUrls(
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).pageMarkings : null
  );
  const currentPageUrl = typeof optionsAny.currentPageUrl === "string" ? optionsAny.currentPageUrl.trim() : "";
  const confirmedPageMarkings = configStore.normalizePageMarkings(
    optionsAny && optionsAny.confirmedPageMarkings
  ).normalized;
  const preferConfirmedPageMarkings = Boolean(optionsAny.preferConfirmedPageMarkings);
  const applyConfirmedToBackendSaved = Boolean(optionsAny.applyConfirmedToBackendSaved);
  const normalizedPayload = configStore.normalizeConfigSyncPayload(payload, "");
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: "",
      invalidLoadedUrls: []
    };
  }
  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = (await configStore.getConfigs()) as StoredConfigs;
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = normalizeConfigResult(baseUrl, existingRaw);
  const localConfig = normalizedLocal.config;
  const incomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const siteIdChanged =
    Boolean(incomingSiteId) && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId;
  if (incomingSiteId && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId) {
    (localConfig as { siteId?: unknown }).siteId = incomingSiteId;
  }
  const mergedRenderMode = configStore.mergeRenderModeByTimestamp(
    localConfig.renderMode,
    localConfig.renderModeUpdatedAt,
    normalizedPayload.renderMode,
    normalizedPayload.renderModeUpdatedAt
  );
  const renderModeChanged =
    configStore.getConfigRenderMode(localConfig) !== mergedRenderMode.renderMode ||
    configStore.normalizeEntryTimestamp(localConfig.renderModeUpdatedAt) !== mergedRenderMode.updatedAt;
  if (renderModeChanged) {
    localConfig.renderMode = mergedRenderMode.renderMode;
    localConfig.renderModeUpdatedAt = mergedRenderMode.updatedAt;
  }
  const incomingPageMarkings = configStore.normalizePageMarkings(normalizedPayload.pageMarkings).normalized;
  const existingBackendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(baseUrl);
  let mergedBackendSavedPageMarkings = configStore.mergePageMarkingsByTimestamp(
    existingBackendSavedPageMarkings,
    incomingPageMarkings
  ).pageMarkings;
  if (applyConfirmedToBackendSaved) {
    mergedBackendSavedPageMarkings = configStore.mergePageMarkingsByTimestamp(
      mergedBackendSavedPageMarkings,
      confirmedPageMarkings,
      { preferIncomingOnTimestampTie: true }
    ).pageMarkings;
    if (preferConfirmedPageMarkings) {
      Object.entries(confirmedPageMarkings).forEach(([url, entry]) => {
          const normalizedSingleAny = configStore.normalizePageMarkings({ [url]: entry }).normalized as unknown as PageMarkings;
          (mergedBackendSavedPageMarkings as unknown as PageMarkings)[url] = normalizedSingleAny[url];
      });
    }
  }
  if (
    Object.keys(incomingPageMarkings).length > 0 ||
    (applyConfirmedToBackendSaved && Object.keys(confirmedPageMarkings).length > 0)
  ) {
    await configStore.setBackendSavedPageMarkings(baseUrl, mergedBackendSavedPageMarkings);
  }
  const previousPageMarkingsSignature = JSON.stringify(
    configStore.normalizePageMarkings(localConfig.pageMarkings).normalized
  );
  const incomingPageMarkingsMergeResult = configStore.mergePageMarkingsByTimestamp(
    localConfig.pageMarkings,
    incomingPageMarkings
  );
  const confirmedPageMarkingsMergeResult = configStore.mergePageMarkingsByTimestamp(
    incomingPageMarkingsMergeResult.pageMarkings,
    confirmedPageMarkings,
    { preferIncomingOnTimestampTie: true }
  );
  let mergedPageMarkings = confirmedPageMarkingsMergeResult.pageMarkings as unknown as PageMarkings;
  if (preferConfirmedPageMarkings) {
    mergedPageMarkings = { ...mergedPageMarkings };
    Object.entries(confirmedPageMarkings).forEach(([url, entry]) => {
      const normalizedSingleAny = configStore.normalizePageMarkings({ [url]: entry }).normalized as PageMarkings;
      (mergedPageMarkings as unknown as PageMarkings)[url] = normalizedSingleAny[url];
    });
  }
  const mergedPageMarkingsSignature = JSON.stringify(mergedPageMarkings);
  const pageMarkingsChanged = previousPageMarkingsSignature !== mergedPageMarkingsSignature;
  const confirmedCurrentPageSignature = currentPageUrl && Object.prototype.hasOwnProperty.call(confirmedPageMarkings, currentPageUrl)
    ? getNormalizedPageEntrySignature(currentPageUrl, (confirmedPageMarkings as PageMarkings)[currentPageUrl])
    : "";
  const finalCurrentPageSignature = currentPageUrl
    ? getNormalizedPageEntrySignature(currentPageUrl, (mergedPageMarkings as PageMarkings)[currentPageUrl])
    : "";
  const replacedCurrentPage = Boolean(
    currentPageUrl &&
      (
        confirmedCurrentPageSignature
          ? finalCurrentPageSignature !== confirmedCurrentPageSignature
          :
        incomingPageMarkingsMergeResult.replacedExistingUrls.includes(currentPageUrl) ||
        confirmedPageMarkingsMergeResult.replacedExistingUrls.includes(currentPageUrl)
      )
  );
  localConfig.pageMarkings = mergedPageMarkings;
  const selectorStateChanged = mergeSelectorsIntoConfig(localConfig, normalizedPayload);
  const shouldSave =
    !existingRaw ||
    normalizedLocal.changed ||
    siteIdChanged ||
    renderModeChanged ||
    selectorStateChanged ||
    pageMarkingsChanged;
  if (shouldSave) {
    allConfigs[baseUrl] = localConfig;
    await configStore.saveConfigs(allConfigs);
  }
  return {
    ok: true,
    changed: shouldSave,
    replacedCurrentPage,
    baseUrl,
    invalidLoadedUrls
  };
}

export async function preparePageTypeAssignmentsSnapshot(options = {}) {
  const optionsAny = options as RemoteConfigSyncOptions;
  const baseUrl = typeof optionsAny.baseUrl === "string" ? optionsAny.baseUrl.trim() : "";
  const normalizedChecklist = normalizePropertyPageTypes(optionsAny.checklistPageTypes);
  const checklistPageTypes = normalizedChecklist && Array.isArray(normalizedChecklist.pageTypes)
    ? normalizedChecklist.pageTypes
    : [];
  if (!baseUrl || !checklistPageTypes.length) {
    return { ok: false };
  }
  try {
    const currentConfig = await configStore.ensureConfig(baseUrl);
      const pageMarkings: Record<string, Record<string, unknown>> =
      currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
        ? currentConfig.pageMarkings
        : {};
    const storedPageMarkingItems = collectStoredPageMarkingItems(pageMarkings, baseUrl);
    const assignments = buildLynxChecklistAssignments({
      pageTypes: checklistPageTypes,
      markedPages: storedPageMarkingItems
    });
    if (!assignments.length) {
      return { ok: true, skipped: true, payloadKey: "" };
    }
    const urlsMissingRawHtml = assignments
      .map((item) => item.url)
      .filter((url) => {
        const entry = pageMarkings[url];
        return !entry || typeof entry.rawHtml !== "string" || !entry.rawHtml;
      });
    const backfillResults = await Promise.all(
      urlsMissingRawHtml.map(async (url) => {
        const response = await fetchStaticPageHtmlForBackground(url);
        if (!response.ok || typeof response.html !== "string" || !response.html) {
          return null;
        }
        return {
          url,
          rawHtml: response.html
        };
      })
    );
      const successfulBackfills = backfillResults.filter(Boolean) as Array<{ url: string; rawHtml: string }>;
    if (successfulBackfills.length) {
        await configStore.updateConfig(baseUrl, (targetConfig: Config) => {
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
    const payload = assignments.map((item) => {
      const entry = pageMarkings[item.url];
      return {
        url: item.url,
        rawHtml:
          entry && typeof entry.rawHtml === "string" && entry.rawHtml
            ? entry.rawHtml
            : rawHtmlBackfills.get(item.url) || "",
        renderedHtml: entry && typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
        pageType: item.pageType
      };
    });
    const stored = await putTransferPayload("assign-page-types-prepare", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}
