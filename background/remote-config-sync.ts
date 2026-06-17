import * as configStore from "../common/config.js";
import { buildLynxChecklistAssignments, normalizePropertyPageTypes } from "../common/lynx-checklist.js";
import { normalizeSiteIdValue } from "../common/lynx-live-pages.js";
import { aiSelectorSetsEqual, normalizeAiSelectorSet } from "../common/selector-set.js";
import * as utils from "../common/utilities.js";
import {
  consumeTransferPayload,
  putTransferPayload
} from "./transfer-payload-store.js";
import { fetchStaticPageHtmlForBackground } from "./remote-network.js";

export function collectStoredPageMarkingItems(pageMarkings: unknown, baseUrl = "") {
  const items: any[] = [];
  const pageMarkingsAny = pageMarkings as any;
  Object.entries(pageMarkingsAny && typeof pageMarkingsAny === "object" ? pageMarkingsAny : {}).forEach(([url, entry]) => {
    const entryAny = entry as any;
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
    const excludedCount = Array.isArray(entryAny.xpaths)
      ? entryAny.xpaths.filter((item: any) => item && item.excluded && item.xpath).length
      : 0;
    const includedCount = Array.isArray(entryAny.includeXpaths)
      ? entryAny.includeXpaths.filter((xpath: any) => typeof xpath === "string" && xpath).length
      : 0;
    items.push({
      url,
      title: entryAny.title || url,
      pageType: entryAny.pageType || "",
      count: excludedCount + includedCount
    });
  });
  return items;
}

export function mergeSelectorsIntoConfig(targetConfig: unknown, incomingConfig: unknown) {
  const targetConfigAny = targetConfig as any;
  const incomingConfigAny = incomingConfig as any;
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
  const normalizedEntriesAny = configStore.normalizePageMarkings({ [normalizedPageUrl]: entry }).normalized as any;
  const normalizedEntry = normalizedEntriesAny[normalizedPageUrl] || null;
  return JSON.stringify(normalizedEntry);
}

export async function replaceServerConfigIntoLocalSnapshot(options = {}) {
  const optionsAny = options as any;
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
  const allConfigs: any = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const existingConfig: any = configStore.normalizeConfig(baseUrl, existingRaw).config;
  const normalizedIncomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const fallbackSiteId = normalizeSiteIdValue(optionsAny.siteId);
  const nextConfig = configStore.normalizeConfig(baseUrl, {
    ...existingConfig,
    ...normalizedPayload,
    baseUrl,
    siteId: normalizedIncomingSiteId || normalizeSiteIdValue(existingConfig.siteId) || fallbackSiteId || null,
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
      getNormalizedPageEntrySignature(currentPageUrl, (existingConfig.pageMarkings as any)?.[currentPageUrl]) !==
        getNormalizedPageEntrySignature(currentPageUrl, (nextConfig.pageMarkings as any)?.[currentPageUrl])
  );

  if (!existingRaw || changed) {
    allConfigs[baseUrl] = nextConfig;
    await configStore.saveConfigs(allConfigs);
  }
  await configStore.setBackendSavedPageMarkings(baseUrl, nextConfig.pageMarkings);

  return {
    ok: true,
    changed: Boolean(!existingRaw || changed),
    replacedCurrentPage,
    baseUrl
  };
}

export async function mergeServerConfigIntoLocalSnapshot(options = {}) {
  const optionsAny = options as any;
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
    payload && typeof payload === "object" ? payload.pageMarkings : null
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
  const allConfigs: any = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = configStore.normalizeConfig(baseUrl, existingRaw);
  const localConfig: any = normalizedLocal.config;
  const incomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const siteIdChanged =
    Boolean(incomingSiteId) && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId;
  if (incomingSiteId && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId) {
    localConfig.siteId = incomingSiteId;
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
          const normalizedSingleAny = configStore.normalizePageMarkings({ [url]: entry }).normalized as any;
          (mergedBackendSavedPageMarkings as any)[url] = normalizedSingleAny[url];
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
  let mergedPageMarkings = confirmedPageMarkingsMergeResult.pageMarkings;
  if (preferConfirmedPageMarkings) {
    mergedPageMarkings = { ...mergedPageMarkings };
    Object.entries(confirmedPageMarkings).forEach(([url, entry]) => {
      const normalizedSingleAny = configStore.normalizePageMarkings({ [url]: entry }).normalized as any;
      (mergedPageMarkings as any)[url] = normalizedSingleAny[url];
    });
  }
  const mergedPageMarkingsSignature = JSON.stringify(mergedPageMarkings);
  const pageMarkingsChanged = previousPageMarkingsSignature !== mergedPageMarkingsSignature;
  const confirmedCurrentPageSignature = currentPageUrl && Object.prototype.hasOwnProperty.call(confirmedPageMarkings, currentPageUrl)
    ? getNormalizedPageEntrySignature(currentPageUrl, (confirmedPageMarkings as any)[currentPageUrl])
    : "";
  const finalCurrentPageSignature = currentPageUrl
    ? getNormalizedPageEntrySignature(currentPageUrl, (mergedPageMarkings as any)[currentPageUrl])
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
  const optionsAny = options as any;
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
      const pageMarkings: any =
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
        await configStore.updateConfig(baseUrl, (targetConfig: any) => {
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
