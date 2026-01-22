import * as chromeHelpers from "./popup/chromeHelpers.js";
import * as config from "./common/config.js";
import * as constants from "./common/constants.js";
import * as emulation from "./popup/emulation.js";
import * as drafts from "./popup/drafts.js";
import * as patterns from "./common/patterns.js";
import * as render from "./popup/render.js";
import * as uiModule from "./popup/ui.js";
import * as utils from "./common/utilities.js";
import * as messages from "./popup/messages.js";
import * as stateModule from "./popup/state.js";

const { state } = stateModule;
const { ui } = uiModule;

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

async function refreshUi() {
  if (!state.currentTab) {
    return;
  }
  const configs = await config.getConfigs();
  const tabState =
    (await utils.getTabState(state.currentTab.id)) || { enabled: false, baseUrl: "" };
  const pageUrl = state.currentTab.url || "";
  let effectiveTabState = tabState;
  if (tabState.baseUrl && pageUrl && !pageUrl.startsWith(tabState.baseUrl)) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
  }
  const fallbackBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  state.currentBaseUrl = effectiveTabState.baseUrl || fallbackBaseUrl || "";
  if (state.currentBaseUrl) {
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (!configs[state.currentBaseUrl] || normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
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
  const patternDrafts = state.currentTab ? await drafts.getPagePatternDraft(state.currentTab.id) : {};
  let draftPattern =
    patterns.normalizePatternValue(
      (state.currentDraftEntry && state.currentDraftEntry.pagePattern) || ""
    ) || patterns.normalizePatternValue(patternDrafts[pageUrl] || "");
  ui.toggleEnabled.checked = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      pageUrl.startsWith(effectiveTabState.baseUrl)
  );
  const pagePatternOptions = baseUrlReady
    ? patterns.getPatternOptions(pageUrl, state.currentBaseUrl)
    : [];
  if (baseUrlReady && pageUrl) {
    const basePattern = patterns.normalizePatternValue(state.currentBaseUrl);
    const pagePattern = patterns.normalizePatternValue(pageUrl);
    if (basePattern && pagePattern && basePattern === pagePattern && !draftPattern) {
      await drafts.setPagePatternDraft(state.currentTab.id, pageUrl, basePattern);
      draftPattern = basePattern;
    }
  }
  const storedPatterns = patterns.collectPagePatterns(
    state.currentConfig ? state.currentConfig.pageMarkings : null
  );
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = patterns.findBestMatchingPattern(pageUrl, storedPatterns);
  const pagePatternReady = Boolean(matchingPattern);
  if (ui.toggleEnabled.checked && !pagePatternReady && state.currentTab && state.currentTab.id) {
    ui.toggleEnabled.checked = false;
    await utils.setTabState(state.currentTab.id, { enabled: false, baseUrl: state.currentBaseUrl });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  const storedDeviceState = await emulation.getDeviceEmulationState(state.currentTab.id);
  emulation.updateDeviceEmulationUi(storedDeviceState);
  const tokenResult = await utils.storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  const endpointResult = await utils.storageGet(
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
    latestComputed.length > 0 && !utils.arraysEqual(latestComputed, lastSaved);
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = latestComputed.length > 0;

  const isEnabled = ui.toggleEnabled.checked;
  state.currentDraftEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentDraftHasEntry = false;
  if (state.currentBaseUrl && isEnabled) {
    const draftStatus = await messages.sendTabMessage({
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
      !baseUrlReady || !pageUrl || !patterns.isPageWithinBase(pageUrl, state.currentBaseUrl);
    render.renderPatternSelect(
      ui.pagePatternSelect,
      pagePatternOptions,
      draftPattern || matchingPattern || ""
    );
    ui.pagePatternSelect.disabled = patternUiDisabled || !pagePatternOptions.length;
    ui.pagePatternSet.disabled = patternUiDisabled || !pagePatternOptions.length;
    if (!baseUrlReady) {
      ui.pagePatternNotice.textContent = "Set Base Page URL first";
      ui.pagePatternNotice.style.display = "block";
    } else if (!pageUrl || !patterns.isPageWithinBase(pageUrl, state.currentBaseUrl)) {
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
    const response = await messages.sendTabMessage({
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
        !utils.isHeadingXPath(item.xpath)
    )
    .map((item) => item.xpath);
  let pageExplicitExclude = excludedXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (state.currentBaseUrl) {
    const response = await messages.sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: excludedXPaths
    });
    if (response && Array.isArray(response.items)) {
      pageExplicitExclude = response.items;
    }
  }

  render.renderExcludeList(
    ui.explicitExcludes,
    pageExplicitExclude,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (value) => {
      const response = await messages.sendTabMessage({
        type: "focusElement",
        xpath: value
      });
      if (!response || !response.ok) {
        uiModule.showToast("Unable to focus element");
      }
    },
    async (value) => {
      if (!state.currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      const response = await messages.sendTabMessage({
        type: "setExplicitExclude",
        baseUrl: state.currentBaseUrl,
        xpath: value,
        excluded: false
      });
      if (!response || !response.ok) {
        uiModule.showToast("Unable to update exclude");
        return;
      }
      refreshUi();
    }
  );
  render.renderHeadingDefaults(
    ui.headingDefaults,
    headingDefaults,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    async (item, action) => {
      if (action === "view") {
        const response = await messages.sendTabMessage({
          type: "focusElement",
          xpath: item.xpath
        });
        if (!response || !response.ok) {
          uiModule.showToast("Unable to focus element");
        }
        return;
      }
      if (!state.currentBaseUrl) {
        return;
      }
      await clearFocusedElement();
      const response = await messages.sendTabMessage({
        type: "toggleHeadingDefault",
        baseUrl: state.currentBaseUrl,
        xpath: item.xpath
      });
      if (!response || !response.ok) {
        uiModule.showToast("Unable to update heading");
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
        !utils.isHeadingXPath(item.xpath)
    ).length;
    markedPages.push({
      url,
      title: entry.title || url,
      count: excludedCount
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  render.renderMarkedPages(
    ui.markedPages,
    markedPages,
    baseUrlSet ? "None yet" : "Set Base Page URL first",
    pageUrl,
    async (url) => {
      await messages.loadActiveTab();
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
  const response = await messages.sendRuntimeMessage({
    type: "injectContentScript",
    tabId: state.currentTab.id
  });
  return response || { ok: false, error: "Injection failed" };
}

async function handleEnableToggle() {
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL before enabling marking");
    ui.toggleEnabled.checked = false;
    return;
  }
  const enabled = ui.toggleEnabled.checked;
  const baseUrlValue = state.currentBaseUrl;
  if (enabled) {
    const parsed = utils.parseBaseUrl(baseUrlValue);
    if (!parsed) {
      uiModule.showToast("Enter a valid Base Page URL");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    if (!state.currentTab.url.startsWith(baseUrlValue)) {
      uiModule.showToast("Current page is outside the Base Page URL");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    state.currentConfig = await config.ensureConfig(baseUrlValue);
    const patternDrafts = await drafts.getPagePatternDraft(state.currentTab.id);
    const draftPattern = patterns.normalizePatternValue(patternDrafts[state.currentTab.url] || "");
    const storedPatterns = patterns.collectPagePatterns(state.currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = patterns.findBestMatchingPattern(state.currentTab.url, storedPatterns);
    if (!matchingPattern) {
      uiModule.showToast("Choose a URL pattern before enabling");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    // Inject content script first
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      uiModule.showToast(injectResult.error || "Unable to activate on this page");
      ui.toggleEnabled.checked = false;
      await refreshUi();
      return;
    }
    await utils.setTabState(state.currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await utils.setTabState(state.currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleDeviceEmulationEnabledToggle() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const desiredEnabled = Boolean(ui.deviceEmulationEnabled.checked);
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  emulation.setDeviceControlsDisabled(true);
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: desiredEnabled,
    mode: state.currentDeviceMode,
    scale: state.currentDeviceScale
  });
  emulation.setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Device emulation failed");
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  emulation.updateDeviceEmulationUi(response.state);
}

async function handleDeviceModeToggle() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  const desiredMode = emulation.getSelectedDeviceMode();
  if (desiredMode === state.currentDeviceMode) {
    return;
  }
  emulation.setDeviceControlsDisabled(true);
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: true,
    mode: desiredMode,
    scale: state.currentDeviceScale
  });
  emulation.setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Device emulation failed");
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  emulation.updateDeviceEmulationUi(response.state);
}

function handleDeviceScaleInput() {
  const scale = emulation.getSelectedDeviceScale();
  if (ui.deviceScaleValue) {
    ui.deviceScaleValue.textContent = `${Math.round(scale * 100)}%`;
  }
}

async function handleDeviceScaleChange() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  const desiredScale = emulation.getSelectedDeviceScale();
  if (desiredScale === state.currentDeviceScale) {
    return;
  }
  emulation.setDeviceControlsDisabled(true);
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled: true,
    mode: state.currentDeviceMode,
    scale: desiredScale
  });
  emulation.setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Device emulation failed");
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return;
  }
  emulation.updateDeviceEmulationUi(response.state);
}

async function handleClearDomainCache() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    uiModule.showToast("No active tab to clear");
    return;
  }
  const origin = utils.getOriginFromUrl(state.currentTab.url);
  if (!origin) {
    uiModule.showToast("Unsupported page for cache clearing");
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
  uiModule.setUiBusy(true);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = true;
  }
  const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
  if (ui.clearDomainCache) {
    ui.clearDomainCache.disabled = false;
  }
  if (!result.ok) {
    uiModule.setUiBusy(false);
    uiModule.showToast(result.error || "Unable to clear cache");
    return;
  }
  uiModule.showToast("Domain cache cleared");
  const reloadResult = await chromeHelpers.reloadTab(state.currentTab.id);
  uiModule.setUiBusy(false);
  if (!reloadResult.ok) {
    uiModule.showToast(reloadResult.error || "Unable to reload tab");
  }
}

async function handleExportAll() {
  uiModule.setConfigMenuOpen(false);
  const configs = await config.getConfigs();
  const tokenResult = await utils.storageGet(chrome.storage.sync, "globalToken");
  const endpointResult = await utils.storageGet(
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
  chromeHelpers.downloadJsonFile(filename, payload);
}

async function handleExportCurrent() {
  uiModule.setConfigMenuOpen(false);
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const configs = await config.getConfigs();
  const normalizedConfig = config.normalizeImportedConfig(
    state.currentBaseUrl,
    configs[state.currentBaseUrl] || config.createDefaultConfig(state.currentBaseUrl)
  );
  const payload = {
    version: 1,
    scope: "baseUrl",
    baseUrl: state.currentBaseUrl,
    config: normalizedConfig
  };
  const safeBase = utils.makeSafeFilename(state.currentBaseUrl) || "base";
  const filename = `markcontit-${safeBase}.json`;
  chromeHelpers.downloadJsonFile(filename, payload);
}

async function handleImport() {
  uiModule.setConfigMenuOpen(false);
  if (ui.configImportFile) {
    ui.configImportFile.click();
  }
}

async function handleClearCurrent() {
  uiModule.setConfigMenuOpen(false);
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Clear all configuration for this Base Page URL? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const configs = await config.getConfigs();
  delete configs[state.currentBaseUrl];
  await config.saveConfigs(configs);
  await messages.loadActiveTab();
  if (state.currentTab && state.currentTab.id) {
    await utils.setTabState(state.currentTab.id, { enabled: false, baseUrl: "" });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  state.currentBaseUrl = "";
  state.currentConfig = null;
  state.baseUrlEditMode = false;
  uiModule.showToast("Base Page URL cleared");
  await refreshUi();
}

async function handleClearAll() {
  uiModule.setConfigMenuOpen(false);
  const confirmed = window.confirm(
    "Clear all configuration and tokens? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  await config.saveConfigs({});
  await utils.storageSet(chrome.storage.sync, {
    globalToken: "",
    globalEndpoint: ""
  });
  await messages.loadActiveTab();
  if (state.currentTab && state.currentTab.id) {
    await utils.setTabState(state.currentTab.id, { enabled: false, baseUrl: "" });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  state.currentBaseUrl = "";
  state.currentConfig = null;
  state.baseUrlEditMode = false;
  state.endpointEditMode = false;
  uiModule.showToast("All configuration cleared");
  await refreshUi();
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  if (file.size > stateModule.MAX_IMPORT_BYTES) {
    const confirmLarge = window.confirm(
      `File is ${utils.formatBytes(file.size)}. Importing may take a moment. Continue?`
    );
    if (!confirmLarge) {
      return;
    }
  }

  let text = "";
  try {
    text = await file.text();
  } catch (error) {
    uiModule.showToast("Unable to read file");
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    uiModule.showToast("Import file is not valid JSON");
    return;
  } finally {
    text = "";
  }

  const {
    incomingConfigs,
    includeGlobals,
    globalToken,
    globalEndpoint
  } = config.extractIncomingConfigs(parsed);
  const baseUrls = Object.keys(incomingConfigs).filter((value) => value.length > 0);
  if (!baseUrls.length) {
    uiModule.showToast("No configuration found in file");
    return;
  }

  const confirmImport = window.confirm(
    `Import ${baseUrls.length} configuration ${baseUrls.length === 1 ? "entry" : "entries"} and merge with existing data?`
  );
  if (!confirmImport) {
    return;
  }

  const existing = await config.getConfigs();
  baseUrls.forEach((baseUrl) => {
    const normalized = config.normalizeImportedConfig(baseUrl, incomingConfigs[baseUrl]);
    existing[baseUrl] = normalized;
  });
  await config.saveConfigs(existing);

  if (includeGlobals) {
    await utils.storageSet(chrome.storage.sync, {
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
    await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
  }

  uiModule.showToast("Configuration imported");
  await refreshUi();
}

async function handleBaseUrlSet() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    return;
  }
  const baseUrlValue = ui.baseUrlInput.value.trim();
  if (!baseUrlValue) {
    uiModule.showToast("Enter a Base Page URL");
    return;
  }
  const parsed = utils.parseBaseUrl(baseUrlValue);
  if (!parsed) {
    uiModule.showToast("Enter a valid Base Page URL");
    return;
  }
  if (!state.currentTab.url.startsWith(baseUrlValue)) {
    uiModule.showToast("Current page is outside the Base Page URL");
    return;
  }
  // Inject content script first
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    uiModule.showToast(injectResult.error || "Unable to activate on this page");
    return;
  }
  state.currentBaseUrl = baseUrlValue;
  state.currentConfig = await config.ensureConfig(baseUrlValue);
  const basePattern = patterns.normalizePatternValue(baseUrlValue);
  const pagePattern = patterns.normalizePatternValue(state.currentTab.url);
  let draftPattern = "";
  if (basePattern && pagePattern && basePattern === pagePattern) {
    draftPattern = pagePattern;
    await drafts.setPagePatternDraft(state.currentTab.id, state.currentTab.url, draftPattern);
    await messages.sendTabMessage({
      type: "setPagePatternDraft",
      baseUrl: baseUrlValue,
      pagePattern: draftPattern
    });
  }
  const storedPatterns = patterns.collectPagePatterns(state.currentConfig.pageMarkings || {});
  if (draftPattern && !storedPatterns.includes(draftPattern)) {
    storedPatterns.push(draftPattern);
  }
  const matchingPattern = patterns.findBestMatchingPattern(state.currentTab.url, storedPatterns);
  state.baseUrlEditMode = false;
  if (matchingPattern) {
    await utils.setTabState(state.currentTab.id, { enabled: true, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue,
      pagePattern: matchingPattern
    });
    await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await utils.setTabState(state.currentTab.id, { enabled: false, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handlePagePatternSet() {
  await messages.loadActiveTab();
  if (!state.currentTab || !state.currentTab.url) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const selected = ui.pagePatternSelect ? ui.pagePatternSelect.value : "";
  if (!selected) {
    uiModule.showToast("Choose a URL pattern");
    return;
  }
  if (!patterns.isPageWithinBase(selected, state.currentBaseUrl)) {
    uiModule.showToast("Pattern must be within the Base Page URL");
    return;
  }
  await drafts.setPagePatternDraft(state.currentTab.id, state.currentTab.url, selected);
  const injectResult = await injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    uiModule.showToast(injectResult.error || "Unable to reach the page");
    return;
  }
  const response = await messages.sendTabMessageWithRetry({
    type: "setPagePatternDraft",
    baseUrl: state.currentBaseUrl,
    pagePattern: selected
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to set pattern");
    await refreshUi();
    return;
  }
  uiModule.showToast("Pattern saved in draft");
  await refreshUi();
}

async function handleBaseUrlEditToggle() {
  if (!state.currentBaseUrl) {
    return;
  }
  state.baseUrlEditMode = !state.baseUrlEditMode;
  if (state.baseUrlEditMode) {
    await messages.loadActiveTab();
    if (state.currentTab && state.currentTab.id) {
      await utils.setTabState(state.currentTab.id, {
        enabled: false,
        baseUrl: state.currentBaseUrl
      });
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  } else if (state.currentTab && state.currentTab.url.startsWith(state.currentBaseUrl)) {
    // Inject content script first when re-enabling
    const injectResult = await injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      uiModule.showToast(injectResult.error || "Unable to activate on this page");
      state.baseUrlEditMode = true;
      await refreshUi();
      return;
    }
    state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
    const patternDrafts = await drafts.getPagePatternDraft(state.currentTab.id);
    const draftPattern = patterns.normalizePatternValue(patternDrafts[state.currentTab.url] || "");
    const storedPatterns = patterns.collectPagePatterns(state.currentConfig.pageMarkings || {});
    if (draftPattern && !storedPatterns.includes(draftPattern)) {
      storedPatterns.push(draftPattern);
    }
    const matchingPattern = patterns.findBestMatchingPattern(state.currentTab.url, storedPatterns);
    if (matchingPattern) {
      await utils.setTabState(state.currentTab.id, {
        enabled: true,
        baseUrl: state.currentBaseUrl
      });
      await messages.sendTabMessageWithRetry({
        type: "setEnabled",
        enabled: true,
        baseUrl: state.currentBaseUrl,
        pagePattern: matchingPattern
      });
      await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
    } else {
      await utils.setTabState(state.currentTab.id, {
        enabled: false,
        baseUrl: state.currentBaseUrl
      });
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  }
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = ui.endpointUrl.value.trim();
  if (!endpointValue) {
    uiModule.showToast("Enter an Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast("Enter a valid Endpoint URL");
    return;
  }
  await utils.storageSet(chrome.storage.sync, { globalEndpoint: endpointValue });
  state.endpointEditMode = false;
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleTokenBlur() {
  const tokenResult = await utils.storageGet(chrome.storage.sync, "globalToken");
  const existing = tokenResult.globalToken || "";
  const entered = window.prompt("Enter token", existing);
  if (entered === null) {
    return;
  }
  const token = entered.trim();
  await utils.storageSet(chrome.storage.sync, { globalToken: token });
  uiModule.showToast(token ? "Token saved" : "Token cleared");
  await refreshUi();
}

async function handleContextRefresh() {
  await messages.loadActiveTab();
  state.baseUrlEditMode = false;
  state.endpointEditMode = false;
  if (state.currentTab && state.currentTab.id) {
    const tabState = await utils.getTabState(state.currentTab.id);
    if (tabState && tabState.enabled) {
      await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
    }
  }
  await refreshUi();
}

async function handlePageSave() {
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const response = await messages.sendTabMessage({
    type: "savePageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to save page");
    return;
  }
  uiModule.showToast(response.saved ? "Page saved" : "No changes to save");
  if (response.saved) {
    await drafts.clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  }
  await refreshUi();
}

async function handlePageRevert() {
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Revert to the last saved version? Unsaved changes will be lost."
  );
  if (!confirmed) {
    return;
  }
  const response = await messages.sendTabMessage({
    type: "revertPageDraft",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to revert page");
    return;
  }
  uiModule.showToast("Reverted to last saved");
  await drafts.clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  await refreshUi();
}

async function handlePageDelete() {
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const confirmed = window.confirm(
    "Delete saved data for this page? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }
  const response = await messages.sendTabMessage({
    type: "deletePageEntry",
    baseUrl: state.currentBaseUrl
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to delete page data");
    return;
  }
  uiModule.showToast("Page data deleted");
  await drafts.clearPagePatternDraft(state.currentTab.id, state.currentTab.url || "");
  await refreshUi();
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight) {
    return;
  }
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const endpointResult = await utils.storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    uiModule.showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await utils.storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    uiModule.showToast("Set token first");
    return;
  }

  state.currentConfig = await config.ensureConfig(state.currentBaseUrl);

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
    uiModule.showToast("Mark pages before computing selectors");
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
      uiModule.showToast("Endpoint response error");
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      uiModule.showToast("Endpoint response format error");
      return;
    }
    selectors = data
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.latestComputedSelectors = selectors;
      config.domainAiSelectorSet = {
        inclusionSelectors: selectors
      };
    });

    await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
    await messages.sendTabMessage({
      type: "showAiPreview",
      selectors
    });
    uiModule.showToast("Selectors computed");
  } catch (error) {
    uiModule.showToast("Endpoint request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handleSaveExcludes() {
  if (state.aiRequestInFlight) {
    return;
  }
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const endpointResult = await utils.storageGet(
    chrome.storage.sync,
    "globalEndpoint"
  );
  const endpointValue = endpointResult.globalEndpoint || "";
  if (!endpointValue) {
    uiModule.showToast("Set Endpoint URL first");
    return;
  }
  const tokenResult = await utils.storageGet(chrome.storage.sync, "globalToken");
  const tokenValue = tokenResult.globalToken || "";
  if (!tokenValue) {
    uiModule.showToast("Set token first");
    return;
  }
  const selectors = state.currentConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    uiModule.showToast("Compute selectors before saving");
    return;
  }
  if (utils.arraysEqual(selectors, state.currentConfig.lastSavedSelectors || [])) {
    uiModule.showToast("No new selectors to save");
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
      uiModule.showToast("Save response error");
      return;
    }
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.lastSavedSelectors = selectors;
    });
    uiModule.showToast("Excludes saved");
  } catch (error) {
    uiModule.showToast("Save request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handlePreviewLatest() {
  await messages.loadActiveTab();
  if (!state.currentTab) {
    return;
  }
  if (!state.currentBaseUrl || !state.currentConfig) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const selectors = state.currentConfig.latestComputedSelectors || [];
  if (!selectors.length) {
    uiModule.showToast("No stored selectors available");
    return;
  }
  await messages.sendTabMessage({
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
    await messages.loadActiveTab();
    await refreshUi();
  }, 120);
}

async function init() {
  await messages.loadActiveTab();

  ui.toggleEnabled.addEventListener("change", handleEnableToggle);
  ui.deviceEmulationEnabled.addEventListener("change", handleDeviceEmulationEnabledToggle);
  ui.deviceModeDesktop.addEventListener("change", handleDeviceModeToggle);
  ui.deviceModeMobile.addEventListener("change", handleDeviceModeToggle);
  ui.deviceScale.addEventListener("input", handleDeviceScaleInput);
  ui.deviceScale.addEventListener("change", handleDeviceScaleChange);
  ui.configToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    uiModule.setConfigMenuOpen(!state.configMenuOpen);
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

  document.addEventListener("click", () => uiModule.setConfigMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
    }
  });

  chrome.tabs.onActivated.addListener(async () => {
    await messages.loadActiveTab();
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
          changes[`${constants.DEVICE_EMULATION_PREFIX}${state.currentTab.id}`] ||
          changes[`${stateModule.PAGE_PATTERN_DRAFT_PREFIX}${state.currentTab.id}`]))
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
