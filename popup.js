import { clearBrowsingDataForOrigin, downloadJsonFile, reloadTab } from "./popup/chromeHelpers.js";
import {
  createDefaultConfig,
  ensureConfig,
  extractIncomingConfigs,
  getConfigs,
  normalizeConfig,
  normalizeImportedConfig,
  saveConfigs,
  updateConfig
} from "./popup/config.js";
import {
  DEVICE_MODE_PREFIX,
  MAX_IMPORT_BYTES,
  PAGE_PATTERN_DRAFT_PREFIX,
  state
} from "./popup/state.js";
import {
  getDeviceEmulationState,
  getSelectedDeviceMode,
  getSelectedDeviceScale,
  setDeviceControlsDisabled,
  updateDeviceEmulationUi
} from "./popup/deviceEmulation.js";
import { clearPagePatternDraft, getPagePatternDraft, setPagePatternDraft } from "./popup/drafts.js";
import {
  collectPagePatterns,
  findBestMatchingPattern,
  getPatternOptions,
  isPageWithinBase,
  normalizePatternValue
} from "./popup/patterns.js";
import { renderExcludeList, renderHeadingDefaults, renderMarkedPages, renderPatternSelect } from "./popup/render.js";
import { getTabState, setTabState, storageGet, storageSet } from "./popup/storage.js";
import { setConfigMenuOpen, setUiBusy, showToast, ui } from "./popup/ui.js";
import {
  arraysEqual,
  findMatchingBaseUrl,
  formatBytes,
  getOriginFromUrl,
  isHeadingXPath,
  makeSafeFilename,
  parseBaseUrl
} from "./popup/utils.js";
import { loadActiveTab, sendRuntimeMessage, sendTabMessage, sendTabMessageWithRetry } from "./popup/messages.js";

async function clearFocusedElement() {
  await sendTabMessage({ type: "clearFocus" });
}

async function refreshUi() {
  if (!state.currentTab) {
    return;
  }
  const configs = await getConfigs();
  const tabState = await getTabState(state.currentTab.id);
  const pageUrl = state.currentTab.url || "";
  let effectiveTabState = tabState;
  if (tabState.baseUrl && pageUrl && !pageUrl.startsWith(tabState.baseUrl)) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await setTabState(state.currentTab.id, effectiveTabState);
  }
  const fallbackBaseUrl = findMatchingBaseUrl(pageUrl, configs);
  state.currentBaseUrl = effectiveTabState.baseUrl || fallbackBaseUrl || "";
  if (state.currentBaseUrl) {
    const normalized = normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (!configs[state.currentBaseUrl] || normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await saveConfigs(configs);
    }
    state.currentConfig = configs[state.currentBaseUrl];
  } else {
    state.currentConfig = null;
  }
  if (!state.currentBaseUrl) {
    state.baseUrlEditMode = false;
  }

  ui.currentPageUrl.textContent = pageUrl || "Unavailable";
  ui.currentPageUrl.title = pageUrl || "Unavailable";
  let suggestedBaseUrl = "";
  if (pageUrl) {
    try {
      suggestedBaseUrl = new URL(pageUrl).origin;
    } catch (error) {
      suggestedBaseUrl = "";
    }
  }
  const baseUrlSet = Boolean(state.currentBaseUrl);
  const baseUrlReady = baseUrlSet && !state.baseUrlEditMode;
  const isEditing = !baseUrlSet || state.baseUrlEditMode;
  if (!isEditing) {
    ui.baseUrlInput.value = state.currentBaseUrl;
  } else if (document.activeElement !== ui.baseUrlInput) {
    ui.baseUrlInput.value = baseUrlSet ? state.currentBaseUrl : suggestedBaseUrl;
  }
  ui.baseUrlInput.readOnly = !isEditing;
  ui.baseUrlSet.style.display = isEditing ? "inline-flex" : "none";
  ui.baseUrlEdit.style.display = baseUrlSet ? "inline-flex" : "none";
  ui.baseUrlEdit.textContent = state.baseUrlEditMode ? "Cancel" : "Change";
  if (!baseUrlSet) {
    ui.baseUrlNotice.textContent =
      "Set Base Page URL before enabling marking";
    ui.baseUrlNotice.style.display = "block";
  } else if (state.baseUrlEditMode) {
    ui.baseUrlNotice.textContent = "Set Base Page URL to continue";
    ui.baseUrlNotice.style.display = "block";
  } else {
    ui.baseUrlNotice.style.display = "none";
  }
  const patternDrafts = state.currentTab ? await getPagePatternDraft(state.currentTab.id) : {};
  let draftPattern =
    normalizePatternValue(
      (state.currentDraftEntry && state.currentDraftEntry.pagePattern) || ""
    ) || normalizePatternValue(patternDrafts[pageUrl] || "");
  ui.toggleEnabled.checked = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      pageUrl.startsWith(effectiveTabState.baseUrl)
  );
  const pagePatternOptions = baseUrlReady
    ? getPatternOptions(pageUrl, state.currentBaseUrl)
    : [];
  if (baseUrlReady && pageUrl) {
    const basePattern = normalizePatternValue(state.currentBaseUrl);
    const pagePattern = normalizePatternValue(pageUrl);
    if (basePattern && pagePattern && basePattern === pagePattern && !draftPattern) {
      await setPagePatternDraft(state.currentTab.id, pageUrl, basePattern);
      draftPattern = basePattern;
    }
  }
  const storedPatterns = collectPagePatterns(
    state.currentConfig ? state.currentConfig.pageMarkings : null
  );
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = findBestMatchingPattern(pageUrl, storedPatterns);
  const pagePatternReady = Boolean(matchingPattern);
  if (ui.toggleEnabled.checked && !pagePatternReady && state.currentTab && state.currentTab.id) {
    ui.toggleEnabled.checked = false;
    await setTabState(state.currentTab.id, { enabled: false, baseUrl: state.currentBaseUrl });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  const storedDeviceState = await getDeviceEmulationState(state.currentTab.id);
  updateDeviceEmulationUi(storedDeviceState);
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    state.endpointEditMode = false;
  }
  const endpointSet = Boolean(endpointValue);
  const endpointReady = endpointSet && !state.endpointEditMode;
  const endpointEditing = !endpointSet || state.endpointEditMode;
  if (!endpointEditing) {
    ui.endpointUrl.value = endpointValue;
  } else if (document.activeElement !== ui.endpointUrl) {
    ui.endpointUrl.value = endpointValue;
  }
  ui.endpointUrl.readOnly = !endpointEditing;
  ui.endpointSet.style.display = endpointEditing ? "inline-flex" : "none";
  ui.endpointEdit.style.display = endpointSet ? "inline-flex" : "none";
  ui.endpointEdit.textContent = state.endpointEditMode ? "Cancel" : "Change";
  if (!endpointSet) {
    ui.endpointNotice.textContent = "Set Endpoint URL before using AI";
    ui.endpointNotice.style.display = "block";
  } else if (state.endpointEditMode) {
    ui.endpointNotice.textContent = "Set Endpoint URL to continue";
    ui.endpointNotice.style.display = "block";
  } else {
    ui.endpointNotice.style.display = "none";
  }

  const aiReady = baseUrlReady && endpointReady && Boolean(tokenValue);
  const latestComputed =
    (state.currentConfig && state.currentConfig.latestComputedSelectors) || [];
  const lastSaved = (state.currentConfig && state.currentConfig.lastSavedSelectors) || [];
  const hasNewSelectors =
    latestComputed.length > 0 && !arraysEqual(latestComputed, lastSaved);
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = latestComputed.length > 0;

  const isEnabled = ui.toggleEnabled.checked;
  state.currentDraftEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentDraftHasEntry = false;
  if (state.currentBaseUrl && isEnabled) {
    const draftStatus = await sendTabMessage({
      type: "getPageDraftStatus",
      baseUrl: state.currentBaseUrl
    });
    if (draftStatus && draftStatus.ok) {
      state.currentDraftEntry = draftStatus.entry || null;
      state.currentDraftDirty = Boolean(draftStatus.dirty);
      state.currentDraftAvailable = true;
      state.currentDraftHasEntry = Boolean(state.currentDraftEntry);
    }
  }
  const aiBlockedByDraft = state.currentDraftDirty;
  ui.toggleEnabled.disabled = !baseUrlReady || !pagePatternReady;
  ui.computeButton.disabled = aiBusy || !aiReady || aiBlockedByDraft;
  ui.saveExcludesButton.disabled =
    aiBusy || !aiReady || !hasNewSelectors || aiBlockedByDraft;
  ui.previewLatestButton.disabled =
    aiBusy || !baseUrlReady || !hasStoredSelectors || aiBlockedByDraft;
  ui.mainUi.hidden = !isEnabled;
  ui.tokenStatus.textContent = tokenValue ? "Token saved" : "Token required";
  ui.tokenAction.textContent = tokenValue ? "Change token" : "Set token";
  ui.aiToken.hidden = !endpointReady;
  ui.aiControls.hidden = !endpointReady || !tokenValue;
  ui.tokenAction.disabled = aiBusy;
  ui.endpointUrl.disabled = aiBusy;
  ui.endpointSet.disabled = aiBusy;
  ui.endpointEdit.disabled = aiBusy;
  ui.configExportAll.disabled = aiBusy;
  ui.configExportCurrent.disabled = aiBusy || !baseUrlReady;
  ui.configImport.disabled = aiBusy;
  ui.configClearCurrent.disabled = aiBusy || !state.currentBaseUrl;
  ui.configClearAll.disabled = aiBusy;
  ui.computeButton.textContent =
    state.aiRequestInFlight === "compute" ? "Computing..." : "Decide Content";
  ui.saveExcludesButton.textContent =
    state.aiRequestInFlight === "save" ? "Saving..." : "Save Excludes";
  ui.computeButton.classList.toggle(
    "loading",
    state.aiRequestInFlight === "compute"
  );
  ui.saveExcludesButton.classList.toggle(
    "loading",
    state.aiRequestInFlight === "save"
  );
  ui.aiControls.setAttribute("aria-busy", aiBusy ? "true" : "false");
  if (ui.aiDirtyNotice) {
    ui.aiDirtyNotice.style.display = aiBlockedByDraft ? "block" : "none";
  }
  if (ui.pagePatternSelect && ui.pagePatternSet && ui.pagePatternNotice) {
    const patternUiDisabled =
      !baseUrlReady || !pageUrl || !isPageWithinBase(pageUrl, state.currentBaseUrl);
    renderPatternSelect(
      ui.pagePatternSelect,
      pagePatternOptions,
      draftPattern || matchingPattern || ""
    );
    ui.pagePatternSelect.disabled = patternUiDisabled || !pagePatternOptions.length;
    ui.pagePatternSet.disabled = patternUiDisabled || !pagePatternOptions.length;
    if (!baseUrlReady) {
      ui.pagePatternNotice.textContent = "Set Base Page URL first";
      ui.pagePatternNotice.style.display = "block";
    } else if (!pageUrl || !isPageWithinBase(pageUrl, state.currentBaseUrl)) {
      ui.pagePatternNotice.textContent = "Current page is outside the Base Page URL";
      ui.pagePatternNotice.style.display = "block";
    } else if (!pagePatternReady) {
      ui.pagePatternNotice.textContent =
        "Choose a URL pattern before enabling";
      ui.pagePatternNotice.style.display = "block";
    } else {
      ui.pagePatternNotice.style.display = "none";
    }
  }
  if (ui.pageSave && ui.pageRevert) {
    const draftButtonsDisabled =
      !baseUrlReady || !isEnabled || !state.currentDraftAvailable || !state.currentDraftDirty;
    ui.pageSave.disabled = draftButtonsDisabled;
    ui.pageRevert.disabled = draftButtonsDisabled;
  }
  if (ui.pageDelete) {
    ui.pageDelete.disabled =
      !baseUrlReady || !isEnabled || !state.currentDraftAvailable || !state.currentDraftHasEntry;
  }
  if (ui.pageDraftStatus) {
    if (!baseUrlReady) {
      ui.pageDraftStatus.textContent = "Set Base Page URL first";
    } else if (!isEnabled) {
      ui.pageDraftStatus.textContent = "Enable marking to edit this page";
    } else if (!state.currentDraftAvailable) {
      ui.pageDraftStatus.textContent = "Draft unavailable";
    } else if (state.currentDraftDirty) {
      ui.pageDraftStatus.textContent = "Unsaved changes";
    } else {
      ui.pageDraftStatus.textContent = "All changes saved";
    }
  }

  let headingDefaults = [];
  let headingXPathSet = new Set();
  if (state.currentBaseUrl) {
    const response = await sendTabMessage({
      type: "getHeadingDefaultStatus",
      baseUrl: state.currentBaseUrl
    });
    if (response && Array.isArray(response.items)) {
      headingDefaults = response.items;
      headingXPathSet = new Set(
        headingDefaults.map((item) => item.xpath).filter(Boolean)
      );
    }
  }

  const pageEntry =
    state.currentDraftEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const explicitExclude = (pageEntry && pageEntry.xpaths) || [];
  const excludedXPaths = explicitExclude
    .filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !headingXPathSet.has(item.xpath) &&
        !isHeadingXPath(item.xpath)
    )
    .map((item) => item.xpath);
  let pageExplicitExclude = excludedXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (state.currentBaseUrl) {
    const response = await sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: excludedXPaths
    });
    if (response && Array.isArray(response.items)) {
      pageExplicitExclude = response.items;
    }
  }

  renderExcludeList(
    ui.explicitExcludes,
    pageExplicitExclude,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (value) => {
      const response = await sendTabMessage({
        type: "focusElement",
        xpath: value
      });
      if (!response || !response.ok) {
        showToast("Unable to focus element");
      }
    },
    async (value) => {
      if (!state.currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      const response = await sendTabMessage({
        type: "setExplicitExclude",
        baseUrl: state.currentBaseUrl,
        xpath: value,
        excluded: false
      });
      if (!response || !response.ok) {
        showToast("Unable to update exclude");
        return;
      }
      refreshUi();
    }
  );
  renderHeadingDefaults(
    ui.headingDefaults,
    headingDefaults,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (item, action) => {
      if (action === "view") {
        const response = await sendTabMessage({
          type: "focusElement",
          xpath: item.xpath
        });
        if (!response || !response.ok) {
          showToast("Unable to focus element");
        }
        return;
      }
      if (!state.currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      const response = await sendTabMessage({
        type: "toggleHeadingDefault",
        baseUrl: state.currentBaseUrl,
        xpath: item.xpath
      });
      if (!response || !response.ok) {
        showToast("Unable to update heading");
        return;
      }
      await refreshUi();
    }
  );

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
    if (state.currentBaseUrl && !url.startsWith(state.currentBaseUrl)) {
      return;
    }
    const excludedCount = entry.xpaths.filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !isHeadingXPath(item.xpath)
    ).length;
    markedPages.push({
      url,
      title: entry.title || url,
      count: excludedCount
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  renderMarkedPages(
    ui.markedPages,
    markedPages,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    pageUrl,
    async (url) => {
      await loadActiveTab();
      if (!state.currentTab || !state.currentTab.id) {
        return;
      }
      chrome.tabs.update(state.currentTab.id, { url }, () => {
        void chrome.runtime.lastError;
      });
    }
  );
}

async function injectContentScriptIfNeeded() {
  if (!state.currentTab || !state.currentTab.id) {
    return { ok: false, error: "No active tab" };
  }
  const response = await sendRuntimeMessage({
    type: "injectContentScript",
    tabId: state.currentTab.id
  });
  return response || { ok: false, error: "Injection failed" };
}

async function handleEnableToggle() {
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL before enabling marking");
    ui.toggleEnabled.checked = false;
    return;
  }
  const enabled = ui.toggleEnabled.checked;
  const baseUrlValue = state.currentBaseUrl;
  if (enabled) {
    const parsed = parseBaseUrl(baseUrlValue);
    if (!parsed) {
      showToast("Enter a valid Base Page URL");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    if (!state.currentTab.url.startsWith(baseUrlValue)) {
      showToast("Current page is outside the Base Page URL");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    state.currentConfig = await ensureConfig(baseUrlValue);
    const patternDrafts = await getPagePatternDraft(state.currentTab.id);
    const draftPattern = normalizePatternValue(patternDrafts[state.currentTab.url] || "");
    const storedPatterns = collectPagePatterns(state.currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = findBestMatchingPattern(state.currentTab.url, storedPatterns);
    if (!matchingPattern) {
      showToast("Choose a URL pattern before enabling");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    // Inject content script first
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      showToast(injectResult.error || "Unable to activate on this page");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    await setTabState(state.currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await setTabState(state.currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleDeviceEmulationEnabledToggle() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const desiredEnabled = Boolean(ui.deviceEmulationEnabled.checked);
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: desiredEnabled,
    mode: state.currentDeviceMode,
    scale: state.currentDeviceScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

async function handleDeviceModeToggle() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  const desiredMode = getSelectedDeviceMode();
  if (desiredMode === state.currentDeviceMode) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: true,
    mode: desiredMode,
    scale: state.currentDeviceScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

function handleDeviceScaleInput() {
  const scale = getSelectedDeviceScale();
  if (ui.deviceScaleValue) {
    ui.deviceScaleValue.textContent = `${Math.round(scale * 100)}%`;
  }
}

async function handleDeviceScaleChange() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  const desiredScale = getSelectedDeviceScale();
  if (desiredScale === state.currentDeviceScale) {
    return;
  }
  setDeviceControlsDisabled(true);
  const response = await sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: true,
    mode: state.currentDeviceMode,
    scale: desiredScale
  });
  setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    showToast((response && response.error) || "Device emulation failed");
    updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  updateDeviceEmulationUi(response.state);
}

function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    chrome.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        cache: true,
        cacheStorage: true,
        localStorage: true
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to clear cache"
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Unable to reload tab"
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

async function handleClearDomainCache() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    showToast("No active tab to clear");
    return;
  }
  const origin = getOriginFromUrl(state.currentTab.url);
  if (!origin) {
    showToast("Unsupported page for cache clearing");
    return;
  }
  let hostname = origin;
  try {
    hostname = new URL(state.currentTab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(
    `Clear cookies, local storage, and cached files for ${hostname}?`
  );
  if (!confirmed) {
    return;
  }
  setUiBusy(true);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = true;
  }
  const result = await clearBrowsingDataForOrigin(origin);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = false;
  }
  if (!result.ok) {
    setUiBusy(false);
    showToast(result.error || "Unable to clear cache");
    return;
  }
  showToast("Domain cache cleared");
  const reloadResult = await reloadTab(state.currentTab.id);
  setUiBusy(false);
  if (!reloadResult.ok) {
    showToast(reloadResult.error || "Unable to reload tab");
  }
}

function normalizeImportedConfig(baseUrl, incoming) {
  if (!incoming) {
    return createDefaultConfig(baseUrl);
  }
  const { config } = normalizeConfig(baseUrl, incoming);
  config.baseUrl = baseUrl;
  if (!config.domain) {
    try {
      config.domain = new URL(baseUrl).hostname;
    } catch (error) {
      config.domain = "";
    }
  }
  return config;
}

function looksLikeBaseUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function makeSafeFilename(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true
    },
    () => {
      const error = chrome.runtime.lastError;
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      if (error) {
        showToast("Unable to save configuration");
      }
    }
  );
}

async function handleExportAll() {
  setConfigMenuOpen(false);
  const configs = await getConfigs();
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const payload = {
    version: 1,
    scope: "all",
    configs,
    globalToken: tokenResult.globalToken || "",
    globalEndpoint: endpointResult.globalEndpoint || ""
  };
  const filename = `markcontit-all-${new Date().toISOString().slice(0, 10)}.json`;
  downloadJsonFile(filename, payload);
}

async function handleExportCurrent() {
  setConfigMenuOpen(false);
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const configs = await getConfigs();
  const config = normalizeImportedConfig(
    state.currentBaseUrl,
    configs[state.currentBaseUrl] || createDefaultConfig(state.currentBaseUrl)
  );
  const payload = {
    version: 1,
    scope: "baseUrl",
    baseUrl: state.currentBaseUrl,
    config
  };
  const safeBase = makeSafeFilename(state.currentBaseUrl) || "base";
  const filename = `markcontit-${safeBase}.json`;
  downloadJsonFile(filename, payload);
}

function extractIncomingConfigs(parsed) {
  const incomingConfigs = {};
  let includeGlobals = false;
  let globalToken = "";
  let globalEndpoint = "";

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  if (parsed.configs && typeof parsed.configs === "object") {
    Object.assign(incomingConfigs, parsed.configs);
    includeGlobals = parsed.scope === "all";
    globalToken = parsed.globalToken || "";
    globalEndpoint = parsed.globalEndpoint || "";
    if (!includeGlobals && ("globalToken" in parsed || "globalEndpoint" in parsed)) {
      includeGlobals = true;
    }
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  if (parsed.baseUrl && looksLikeBaseUrl(parsed.baseUrl)) {
    const config =
      parsed.config && typeof parsed.config === "object" ? parsed.config : parsed;
    incomingConfigs[parsed.baseUrl] = config;
    return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
  }

  Object.entries(parsed).forEach(([key, value]) => {
    if (!looksLikeBaseUrl(key)) {
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    incomingConfigs[key] = value;
  });

  return { incomingConfigs, includeGlobals, globalToken, globalEndpoint };
}

async function handleImport() {
  setConfigMenuOpen(false);
  if (ui.configImportFile) {
    ui.configImportFile.click();
  }
}

async function handleClearCurrent() {
  setConfigMenuOpen(false);
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Clear all configuration for this Base Page URL? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const configs = await getConfigs();
  delete configs[state.currentBaseUrl];
  await saveConfigs(configs);
  await loadActiveTab();
  if (state.currentTab && state.currentTab.id) {
    await setTabState(state.currentTab.id, { enabled: false, baseUrl: "" });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  state.currentBaseUrl = "";
  state.currentConfig = null;
  state.baseUrlEditMode = false;
  showToast("Base Page URL cleared");
  await refreshUi();
}

async function handleClearAll() {
  setConfigMenuOpen(false);
  const confirmed = window.confirm(
    "Clear all configuration and tokens? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  await saveConfigs({});
  await storageSet(chrome.storage.sync, {
    globalToken: "",
    globalEndpoint: ""
  });
  await loadActiveTab();
  if (state.currentTab && state.currentTab.id) {
    await setTabState(state.currentTab.id, { enabled: false, baseUrl: "" });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  state.currentBaseUrl = "";
  state.currentConfig = null;
  state.baseUrlEditMode = false;
  state.endpointEditMode = false;
  showToast("All configuration cleared");
  await refreshUi();
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    const confirmLarge = window.confirm(
      `File is ${formatBytes(file.size)}. Importing may take a moment. Continue?`
    );
    if (!confirmLarge) {
      return;
    }
  }

  let text = "";
  try {
    text = await file.text();
  } catch (error) {
    showToast("Unable to read file");
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    showToast("Import file is not valid JSON");
    return;
  } finally {
    text = "";
  }

  const {
    incomingConfigs,
    includeGlobals,
    globalToken,
    globalEndpoint
  } = extractIncomingConfigs(parsed);
  const baseUrls = Object.keys(incomingConfigs).filter((value) => value.length > 0);
  if (!baseUrls.length) {
    showToast("No configuration found in file");
    return;
  }

  const confirmImport = window.confirm(
    `Import ${baseUrls.length} configuration ${baseUrls.length === 1 ? "entry" : "entries"} and merge with existing data?`
  );
  if (!confirmImport) {
    return;
  }

  const existing = await getConfigs();
  baseUrls.forEach((baseUrl) => {
    const normalized = normalizeImportedConfig(baseUrl, incomingConfigs[baseUrl]);
    existing[baseUrl] = normalized;
  });
  await saveConfigs(existing);

  if (includeGlobals) {
    await storageSet(chrome.storage.sync, {
      globalToken: globalToken || "",
      globalEndpoint: globalEndpoint || ""
    });
  }

  if (
    state.currentBaseUrl &&
    baseUrls.includes(state.currentBaseUrl) &&
    state.currentTab &&
    state.currentTab.id
  ) {
    await sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
  }

  showToast("Configuration imported");
  await refreshUi();
}

async function handleBaseUrlSet() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    return;
  }
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (!baseUrlValue) {
    showToast("Enter a Base Page URL");
    return;
  }
  const parsed = parseBaseUrl(baseUrlValue);
  if (!parsed) {
    showToast("Enter a valid Base Page URL");
    return;
  }
  if (!state.currentTab.url.startsWith(baseUrlValue)) {
    showToast("Current page is outside the Base Page URL");
    return;
  }
  // Inject content script first
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    showToast(injectResult.error || "Unable to activate on this page");
    return;
  }
  state.currentBaseUrl = baseUrlValue;
  state.currentConfig = await ensureConfig(baseUrlValue);
  const basePattern = normalizePatternValue(baseUrlValue);
  const pagePattern = normalizePatternValue(state.currentTab.url);
  let draftPattern = "";
  if (basePattern && pagePattern && basePattern === pagePattern) {
    draftPattern = pagePattern;
    await setPagePatternDraft(state.currentTab.id, state.currentTab.url, draftPattern);
    await sendTabMessage({
      type: "setPagePatternDraft",
      baseUrl: baseUrlValue,
      pagePattern: draftPattern
    });
  }
  const storedPatterns = collectPagePatterns(state.currentConfig.pageMarkings || {});
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = findBestMatchingPattern(state.currentTab.url, storedPatterns);
  state.baseUrlEditMode = false;
  if (matchingPattern) {
    await setTabState(state.currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await setTabState(state.currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handlePagePatternSet() {
  await loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const selected = ui.pagePatternSelect ? ui.pagePatternSelect.value : "";
  if (!selected) {
    showToast("Choose a URL pattern");
    return;
  }
  if (!isPageWithinBase(selected, state.currentBaseUrl)) {
    showToast("Pattern must be within the Base Page URL");
    return;
  }
  await setPagePatternDraft(state.currentTab.id, state.currentTab.url, selected);
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    showToast(injectResult.error || "Unable to reach the page");
    return;
  }
  const response = await sendTabMessageWithRetry({
    type: "setPagePatternDraft",
    baseUrl: state.currentBaseUrl,
    pagePattern: selected
  });
  if (!response || !response.ok) {
    showToast("Unable to set pattern");
    await refreshUi();
    return;
  }
  showToast("Pattern saved in draft");
  await refreshUi();
}

async function handleBaseUrlEditToggle() {
  if (!state.currentBaseUrl) {
    return;
  }
  state.baseUrlEditMode = !state.baseUrlEditMode;
  if (state.baseUrlEditMode) {
    await loadActiveTab();
    if (state.currentTab && state.currentTab.id) {
      await setTabState(state.currentTab.id, {
        enabled: false,
        baseUrl: state.currentBaseUrl
      });
      await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  } else if (state.currentTab && state.currentTab.url.startsWith(state.currentBaseUrl)) {
    // Inject content script first when re-enabling
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      showToast(injectResult.error || "Unable to activate on this page");
      state.baseUrlEditMode = true;
      await refreshUi();
      return;
    }
    state.currentConfig = await ensureConfig(state.currentBaseUrl);
    const patternDrafts = await getPagePatternDraft(state.currentTab.id);
    const draftPattern = normalizePatternValue(patternDrafts[state.currentTab.url] || "");
    const storedPatterns = collectPagePatterns(state.currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = findBestMatchingPattern(state.currentTab.url, storedPatterns);
    if (matchingPattern) {
      await setTabState(state.currentTab.id, {
        enabled: true,
        baseUrl: state.currentBaseUrl
      });
      await sendTabMessageWithRetry({
        type: "setEnabled",
        enabled: true,
        baseUrl: state.currentBaseUrl,
        pagePattern: matchingPattern
      });
      await sendTabMessageWithRetry({ type: "forceRefresh" });
    } else {
      await setTabState(state.currentTab.id, {
        enabled: false,
        baseUrl: state.currentBaseUrl
      });
      await sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  }
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = ui.endpointUrl.value.trim();
  if (!endpointValue) {
    showToast("Enter an Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    showToast("Enter a valid Endpoint URL");
    return;
  }
  await storageSet(chrome.storage.sync, { globalEndpoint: endpointValue });
  state.endpointEditMode = false;
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleTokenBlur() {
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const existing = tokenResult.globalToken || "";
  const entered = window.prompt("Enter token", existing);
  if (entered === null) {
    return;
  }
  const token = entered.trim();
  await storageSet(chrome.storage.sync, { globalToken: token });
  showToast(token ? "Token saved" : "Token cleared");
  await refreshUi();
}

async function handleContextRefresh() {
  await loadActiveTab();
  state.baseUrlEditMode = false;
  state.endpointEditMode = false;
  if (state.currentTab && state.currentTab.id) {
    const tabState = await getTabState(state.currentTab.id);
    if (tabState && tabState.enabled) {
      await sendTabMessageWithRetry({ type: "forceRefresh" });
    }
  }
  await refreshUi();
}

async function handlePageSave() {
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const response = await sendTabMessage({
    type: "savePageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to save page");
    return;
  }
  showToast(response.saved ? "Page saved" : "No changes to save");
  if (response.saved) {
    await clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  }
  await refreshUi();
}

async function handlePageRevert() {
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Revert to the last saved version? Unsaved changes will be lost."
  );
  if (!confirmed) {
    return;
  }
  const response = await sendTabMessage({
    type: "revertPageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to revert page");
    return;
  }
  showToast("Reverted to last saved");
  await clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  await refreshUi();
}

async function handlePageDelete() {
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Delete saved data for this page? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const response = await sendTabMessage({
    type: "deletePageEntry",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    showToast("Unable to delete page data");
    return;
  }
  showToast("Page data deleted");
  await clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  await refreshUi();
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight) {
    return;
  }
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  if (state.currentDraftDirty) {
    showToast("Save the current page before using AI controls");
    return;
  }
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    showToast("Set token first");
    return;
  }

  state.currentConfig = await ensureConfig(state.currentBaseUrl);

  const pageMarkings = state.currentConfig.pageMarkings || {};
  const pages = Object.entries(pageMarkings)
    .map(([url, entry]) => {
      if (!url || !entry) {
        return null;
      }
      const fullHTML = entry.fullHTML || entry.fullHtml || entry.html || "";
      const xpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      const pattern = typeof entry.pagePattern === "string" ? entry.pagePattern : "";
      return {
        url,
        fullHTML,
        xpaths,
        pattern
      };
    })
    .filter((entry) => {
      if (!entry || !entry.url) {
        return false;
      }
      if (state.currentBaseUrl && !entry.url.startsWith(state.currentBaseUrl)) {
        return false;
      }
      return (
        Array.isArray(entry.xpaths) &&
        entry.xpaths.length > 0 &&
        entry.fullHTML
      );
    });

  if (!pages.length) {
    showToast("Mark pages before computing selectors");
    return;
  }

  const payload = {
    baseUrl: state.currentBaseUrl,
    pages
  };

  let selectors = [];
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
      showToast("Endpoint response error");
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      showToast("Endpoint response format error");
      return;
    }
    selectors = data
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    state.currentConfig = await updateConfig(state.currentBaseUrl, (config) => {
      config.latestComputedSelectors = selectors;
      config.domainAiSelectorSet = {
        inclusionSelectors: selectors
      };
    });

    await sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
    await sendTabMessage({
      type: "showAiPreview",
      selectors
    });
    showToast("Selectors computed");
  } catch (error) {
    showToast("Endpoint request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handleSaveExcludes() {
  if (state.aiRequestInFlight) {
    return;
  }
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    showToast("Set Base Page URL first");
    return;
  }
  if (state.currentDraftDirty) {
    showToast("Save the current page before using AI controls");
    return;
  }
  const endpointResult = await storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    showToast("Set token first");
    return;
  }
  const selectors = state.currentConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    showToast("Compute selectors before saving");
    return;
  }
  if (arraysEqual(selectors, state.currentConfig.lastSavedSelectors || [])) {
    showToast("No new selectors to save");
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
        selectors
      })
    });
    if (!response.ok) {
      showToast("Save response error");
      return;
    }
    state.currentConfig = await updateConfig(state.currentBaseUrl, (config) => {
      config.lastSavedSelectors = selectors;
    });
    showToast("Excludes saved");
  } catch (error) {
    showToast("Save request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handlePreviewLatest() {
  await loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl || !state.currentConfig) {
    showToast("Set Base Page URL first");
    return;
  }
  const selectors = state.currentConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    showToast("No stored selectors available");
    return;
  }
  await sendTabMessage({
    type: "showAiPreview",
    selectors
  });
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    return;
  }
  state.refreshTimer = window.setTimeout(async () => {
    state.refreshTimer = 0;
    await loadActiveTab();
    await refreshUi();
  }, 120);
}

async function init() {
  await loadActiveTab();

  ui.toggleEnabled.addEventListener("change", handleEnableToggle);
  ui.deviceEmulationEnabled.addEventListener("change", handleDeviceEmulationEnabledToggle);
  ui.deviceModeDesktop.addEventListener("change", handleDeviceModeToggle);
  ui.deviceModeMobile.addEventListener("change", handleDeviceModeToggle);
  ui.deviceScale.addEventListener("input", handleDeviceScaleInput);
  ui.deviceScale.addEventListener("change", handleDeviceScaleChange);
  ui.configToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setConfigMenuOpen(!state.configMenuOpen);
  });
  ui.configMenu.addEventListener("click", (event) => event.stopPropagation());
  ui.configExportAll.addEventListener("click", handleExportAll);
  ui.configExportCurrent.addEventListener("click", handleExportCurrent);
  ui.configImport.addEventListener("click", handleImport);
  ui.configClearCurrent.addEventListener("click", handleClearCurrent);
  ui.configClearAll.addEventListener("click", handleClearAll);
  ui.configImportFile.addEventListener("change", handleImportFile);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.addEventListener("click", handleClearDomainCache);
  }
  ui.baseUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (!ui.baseUrlInput.readOnly) {
        handleBaseUrlSet();
      }
    }
  });
  ui.endpointUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (!ui.endpointUrl.readOnly) {
        handleEndpointSet();
      }
    }
  });
  ui.refreshContext.addEventListener("click", handleContextRefresh);
  ui.baseUrlSet.addEventListener("click", handleBaseUrlSet);
  ui.baseUrlEdit.addEventListener("click", handleBaseUrlEditToggle);
  if (ui.pagePatternSet) {
    ui.pagePatternSet.addEventListener("click", handlePagePatternSet);
  }
  if (ui.pageSave) {
    ui.pageSave.addEventListener("click", handlePageSave);
  }
  if (ui.pageRevert) {
    ui.pageRevert.addEventListener("click", handlePageRevert);
  }
  if (ui.pageDelete) {
    ui.pageDelete.addEventListener("click", handlePageDelete);
  }
  ui.endpointSet.addEventListener("click", handleEndpointSet);
  ui.endpointEdit.addEventListener("click", handleEndpointEditToggle);
  ui.tokenAction.addEventListener("click", handleTokenBlur);
  ui.computeButton.addEventListener("click", handleComputeSelectors);
  ui.saveExcludesButton.addEventListener("click", handleSaveExcludes);
  ui.previewLatestButton.addEventListener("click", handlePreviewLatest);

  document.addEventListener("click", () => setConfigMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setConfigMenuOpen(false);
    }
  });

  chrome.tabs.onActivated.addListener(async () => {
    await loadActiveTab();
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
        (changes[`tabState:${state.currentTab.id}`] ||
          changes[`${DEVICE_MODE_PREFIX}${state.currentTab.id}`] ||
          changes[`${PAGE_PATTERN_DRAFT_PREFIX}${state.currentTab.id}`]))
    ) {
      scheduleRefresh();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pageDraftChanged") {
      return;
    }
    if (state.currentBaseUrl && message.baseUrl === state.currentBaseUrl) {
      scheduleRefresh();
    }
  });

  await refreshUi();
}

init();
