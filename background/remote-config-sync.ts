// @ts-nocheck
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

export function collectStoredPageMarkingItems(pageMarkings, baseUrl = "") {
  const items = [];
  Object.entries(pageMarkings && typeof pageMarkings === "object" ? pageMarkings : {}).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
    const excludedCount = Array.isArray(entry.xpaths)
      ? entry.xpaths.filter((item) => item && item.excluded && item.xpath).length
      : 0;
    const includedCount = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath).length
      : 0;
    items.push({
      url,
      title: entry.title || url,
      pageType: entry.pageType || "",
      count: excludedCount + includedCount
    });
  });
  return items;
}

export function mergeSelectorsIntoConfig(targetConfig, incomingConfig) {
  if (!targetConfig || typeof targetConfig !== "object") {
    return false;
  }
  const merged = configStore.mergeConfigSelectorStateByTimestamp(
    targetConfig.selectors,
    targetConfig.selectorsUpdatedAt,
    targetConfig.submittedSelectorsFingerprint,
    incomingConfig && typeof incomingConfig === "object" ? incomingConfig.selectors : null,
    incomingConfig && typeof incomingConfig === "object"
      ? incomingConfig.selectorsUpdatedAt
      : null,
    incomingConfig && typeof incomingConfig === "object"
      ? incomingConfig.submittedSelectorsFingerprint
      : ""
  );
  const currentSelectorSet = normalizeAiSelectorSet(targetConfig.selectors);
  const currentUpdatedAt = configStore.normalizeEntryTimestamp(targetConfig.selectorsUpdatedAt);
  const currentSubmittedFingerprint =
    typeof targetConfig.submittedSelectorsFingerprint === "string"
      ? targetConfig.submittedSelectorsFingerprint.trim()
      : "";
  const didChange =
    !aiSelectorSetsEqual(currentSelectorSet, merged.selectorSet) ||
    currentUpdatedAt !== merged.updatedAt ||
    currentSubmittedFingerprint !== merged.submittedFingerprint;
  if (didChange) {
    targetConfig.selectors = merged.selectorSet;
    targetConfig.selectorsUpdatedAt = merged.updatedAt;
    targetConfig.submittedSelectorsFingerprint = merged.submittedFingerprint;
  }
  return didChange;
}

export function getRemoteManagedConfigSignature(baseUrl, sourceConfig) {
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

export function getNormalizedPageEntrySignature(pageUrl, entry) {
  if (!pageUrl) {
    return "null";
  }
  const normalizedEntry = configStore.normalizePageMarkings({ [pageUrl]: entry }).normalized[pageUrl] || null;
  return JSON.stringify(normalizedEntry);
}

export async function replaceServerConfigIntoLocalSnapshot(options = {}) {
  const payloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  let rawPayload = options.payload;
  if (payloadKey) {
    const loaded = await consumeTransferPayload(payloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    rawPayload = loaded.ok ? loaded.payload : null;
  }
  const normalizedPayload = configStore.normalizeConfigSyncPayload(rawPayload, "");
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }

  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const existingConfig = configStore.normalizeConfig(baseUrl, existingRaw).config;
  const normalizedIncomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const fallbackSiteId = normalizeSiteIdValue(options.siteId);
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
      getNormalizedPageEntrySignature(currentPageUrl, existingConfig.pageMarkings?.[currentPageUrl]) !==
        getNormalizedPageEntrySignature(currentPageUrl, nextConfig.pageMarkings?.[currentPageUrl])
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
  const payloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  let payload = options && typeof options === "object" ? options.payload : null;
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
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  const confirmedPageMarkings = configStore.normalizePageMarkings(
    options && options.confirmedPageMarkings
  ).normalized;
  const preferConfirmedPageMarkings = Boolean(options && options.preferConfirmedPageMarkings);
  const applyConfirmedToBackendSaved = Boolean(options && options.applyConfirmedToBackendSaved);
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
  const allConfigs = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = configStore.normalizeConfig(baseUrl, existingRaw);
  const localConfig = normalizedLocal.config;
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
        mergedBackendSavedPageMarkings[url] =
          configStore.normalizePageMarkings({ [url]: entry }).normalized[url];
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
      mergedPageMarkings[url] = configStore.normalizePageMarkings({ [url]: entry }).normalized[url];
    });
  }
  const mergedPageMarkingsSignature = JSON.stringify(mergedPageMarkings);
  const pageMarkingsChanged = previousPageMarkingsSignature !== mergedPageMarkingsSignature;
  const confirmedCurrentPageSignature = currentPageUrl && Object.prototype.hasOwnProperty.call(confirmedPageMarkings, currentPageUrl)
    ? getNormalizedPageEntrySignature(currentPageUrl, confirmedPageMarkings[currentPageUrl])
    : "";
  const finalCurrentPageSignature = currentPageUrl
    ? getNormalizedPageEntrySignature(currentPageUrl, mergedPageMarkings[currentPageUrl])
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
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  const normalizedChecklist = normalizePropertyPageTypes(options.checklistPageTypes);
  const checklistPageTypes = normalizedChecklist && Array.isArray(normalizedChecklist.pageTypes)
    ? normalizedChecklist.pageTypes
    : [];
  if (!baseUrl || !checklistPageTypes.length) {
    return { ok: false };
  }
  try {
    const currentConfig = await configStore.ensureConfig(baseUrl);
    const pageMarkings =
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
