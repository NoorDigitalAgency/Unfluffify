import * as chromeHelpers from "./popup/chrome-helpers.js";
import * as config from "./common/config.js";
import * as constants from "./common/constants.js";
import * as emulation from "./popup/emulation.js";
import * as uiModule from "./popup/ui.js";
import * as utils from "./common/utilities.js";
import * as messages from "./popup/messages.js";
import * as helpers from "./popup/helpers.js";
import * as stateModule from "./popup/state.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set.js";
import {
  normalizeSilentHighlightOptions
} from "./common/silent-highlight-options.js";

const { state } = stateModule;
const TOKEN_VALIDATION_INTERVAL_MS = 600 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function updateLoginActionState(patch = {}) {
  const view = { ...uiModule.getViewState(), ...patch };
  const emailValue = (view.loginEmailValue || "").trim();
  const passwordValue = view.loginPasswordValue || "";
  const aiBusy = Boolean(view.aiControlsBusy || view.isBusy);
  const loginCredentialsEnabled =
    view.loginEndpointUrlReadOnly && Boolean((view.loginEndpointUrlValue || "").trim());

  uiModule.setViewState({
    ...patch,
    loginActionDisabled:
      aiBusy ||
      !loginCredentialsEnabled ||
      !isValidEmail(emailValue) ||
      !passwordValue.trim()
  });
}

async function invalidateTokenAndLockConfiguration(showToast = true) {
  await utils.storageSet(chrome.storage.sync, { globalToken: "" });
  state.currentView = uiModule.View.Configuration;
  state.configViewLocked = true;
  uiModule.setViewState({
    currentView: state.currentView,
    loginStatusText: "Login required"
  });
  if (showToast) {
    uiModule.showToast("Token expired. Login required");
  }
}

async function validateStoredToken(options = {}) {
  const { force = false, showToastOnInvalid = true } = options;
  if (state.tokenValidationInFlight) {
    return true;
  }
  const { tokenValue, loginEndpointValue } = await helpers.loadGlobalAiSettings();
  if (!tokenValue || !loginEndpointValue) {
    return Boolean(tokenValue);
  }
  const now = Date.now();
  if (!force && now - state.lastTokenValidationAt < TOKEN_VALIDATION_INTERVAL_MS) {
    return true;
  }
  const claimsUrl = resolveRelativeEndpoint(loginEndpointValue, "/api/account/validate");
  if (!claimsUrl) {
    return true;
  }
  state.lastTokenValidationAt = now;
  state.tokenValidationInFlight = true;
  try {
    const response = await fetch(claimsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenValue}` }
    });
    if (response.status === 401 || response.status === 403) {
      await invalidateTokenAndLockConfiguration(showToastOnInvalid);
      return false;
    }
    return true;
  } catch (error) {
    return true;
  } finally {
    state.tokenValidationInFlight = false;
  }
}

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function getEditableFieldState(options) {
  const {
    inputRef,
    currentValue,
    value,
    isSet,
    editMode,
    suggestedValue,
    noticeUnset,
    noticeEdit
  } = options;
  const isEditing = !isSet || editMode;
  const isFocused = inputRef && document.activeElement === inputRef;
  let nextValue = typeof currentValue === "string" ? currentValue : "";

  if (!isEditing) {
    nextValue = value || "";
  } else if (!isFocused) {
    nextValue = isSet ? value || "" : suggestedValue || "";
  }

  let noticeText = "";
  let noticeVisible = false;
  if (!isSet) {
    noticeText = noticeUnset;
    noticeVisible = true;
  } else if (editMode) {
    noticeText = noticeEdit;
    noticeVisible = true;
  }

  return { isEditing, isReady: isSet && !editMode, value: nextValue, noticeText, noticeVisible };
}

function getLatestComputedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.latestComputedSelectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.lastSavedSelectors);
}

const DEFAULT_TOGGLEABLE_TAG_XPATH_LOOKUP = new Set(
  constants.DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS.map((selector) => selector.toLowerCase())
);

function isDefaultToggleableTagXPath(xpath) {
  if (typeof xpath !== "string" || !xpath) {
    return false;
  }
  const match = xpath.match(/\/([a-z0-9_-]+)\[\d+\]\s*$/i);
  if (!match || !match[1]) {
    return false;
  }
  return DEFAULT_TOGGLEABLE_TAG_XPATH_LOOKUP.has(match[1].toLowerCase());
}

function getXPathDepth(xpath) {
  if (typeof xpath !== "string" || !xpath) {
    return 0;
  }
  return xpath.split("/").filter(Boolean).length;
}

function getNearestAncestorStatus(xpath, statusByXpath) {
  if (!xpath || !statusByXpath || statusByXpath.size === 0) {
    return null;
  }
  const parts = xpath.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const ancestor = `/${parts.slice(0, i).join("/")}`;
    if (statusByXpath.has(ancestor)) {
      return statusByXpath.get(ancestor);
    }
  }
  return null;
}

function normalizePayloadXpaths(items) {
  const rawItems = Array.isArray(items) ? items : [];
  const deduped = [];
  const seen = new Set();
  for (let i = rawItems.length - 1; i >= 0; i -= 1) {
    const item = rawItems[i];
    const xpath =
      item && typeof item.xpath === "string" ? item.xpath.trim() : "";
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    seen.add(xpath);
    deduped.unshift({ xpath, excluded: Boolean(item.excluded) });
  }

  const sorted = deduped
    .map((item, index) => ({ ...item, index, depth: getXPathDepth(item.xpath) }))
    .sort((left, right) => {
      const depthDiff = left.depth - right.depth;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return left.index - right.index;
    });

  const statusByXpath = new Map();
  const redundantXpaths = new Set();
  sorted.forEach((item) => {
    const nearestAncestorStatus = getNearestAncestorStatus(item.xpath, statusByXpath);
    if (nearestAncestorStatus !== null && nearestAncestorStatus === item.excluded) {
      redundantXpaths.add(item.xpath);
      return;
    }
    statusByXpath.set(item.xpath, item.excluded);
  });

  return deduped.filter((item) => !redundantXpaths.has(item.xpath));
}

function getSilentHighlightVisibility() {
  return {
    markedPages: state.silentHighlightShowMarkedPages !== false,
    includedContent: state.silentHighlightShowIncludedContent !== false,
    excludedContent: Boolean(state.silentHighlightShowExcludedContent),
    visibleConsent: Boolean(state.silentHighlightShowVisibleConsent)
  };
}

function getSilentHighlightVisibilityKey(visibility) {
  return `${visibility.markedPages ? "1" : "0"}${visibility.includedContent ? "1" : "0"}${visibility.excludedContent ? "1" : "0"}${visibility.visibleConsent ? "1" : "0"}`;
}

async function persistSilentHighlightVisibility() {
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const visibility = getSilentHighlightVisibility();
  await messages.sendRuntimeMessage({
    type: "setSilentHighlightOptions",
    tabId: state.currentTab.id,
    silentHighlightOptions: visibility
  });
}

async function applySilentHighlightVisibility(options = {}) {
  const { force = false } = options;
  if (!state.currentTab || !state.currentTab.id) {
    return;
  }
  const visibility = getSilentHighlightVisibility();
  const key = getSilentHighlightVisibilityKey(visibility);
  const tabId = state.currentTab.id;
  if (
    !force &&
    state.lastAppliedSilentHighlightTabId === tabId &&
    state.lastAppliedSilentHighlightKey === key
  ) {
    return;
  }
  const response = await messages.sendTabMessageWithRetry({
    type: "setSilentHighlightVisibility",
    ...visibility
  }, 2);
  let finalResponse = response;
  if ((!finalResponse || !finalResponse.ok) && tabId) {
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId });
    finalResponse = await messages.sendTabMessageWithRetry({
      type: "setSilentHighlightVisibility",
      ...visibility
    }, 3);
  }
  if (finalResponse && finalResponse.ok) {
    state.lastAppliedSilentHighlightTabId = tabId;
    state.lastAppliedSilentHighlightKey = key;
  }
}

function readCheckboxValue(event, fallbackValue) {
  const target = event && (event.currentTarget || event.target);
  if (!target || typeof target.checked !== "boolean") {
    return fallbackValue;
  }
  return Boolean(target.checked);
}

async function refreshUi() {
  if (!state.currentTab) {
    return;
  }
  await validateStoredToken({ force: false, showToastOnInvalid: true });
  const currentTabId = state.currentTab.id || null;
  if (currentTabId && state.lastTabId !== currentTabId) {
    state.baseUrlEditMode = false;
    state.endpointEditMode = false;
    state.configEndpointEditMode = false;
    state.loginEndpointEditMode = false;
    state.copySourceBaseUrl = "";
    state.copySourcePageUrl = "";
  }
  if (state.lastAppliedSilentHighlightTabId !== currentTabId) {
    state.lastAppliedSilentHighlightTabId = currentTabId;
    state.lastAppliedSilentHighlightKey = "";
  }
  state.lastTabId = currentTabId;
  const configs = await config.getConfigs();
  const tabState =
    (await utils.getTabState(state.currentTab.id)) || { enabled: false, baseUrl: "" };
  const pageUrl = state.currentTab.url || "";
  let effectiveTabState = tabState;
  if (tabState.baseUrl && pageUrl && !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl)) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
  }
  const silentHighlightOptions = normalizeSilentHighlightOptions(
    tabState && tabState.silentHighlightOptions
  );
  state.silentHighlightShowMarkedPages = silentHighlightOptions.markedPages;
  state.silentHighlightShowIncludedContent = silentHighlightOptions.includedContent;
  state.silentHighlightShowExcludedContent = silentHighlightOptions.excludedContent;
  state.silentHighlightShowVisibleConsent = silentHighlightOptions.visibleConsent;
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

  const view = uiModule.getViewState();
  const refs = uiModule.getRefs();
  const nextViewState = {
    currentPageUrl: pageUrl || "Unavailable",
    currentPageUrlTitle: pageUrl || "Unavailable",
    currentBaseUrl: state.currentBaseUrl,
    configMenuOpen: state.configMenuOpen
  };
  let suggestedBaseUrl = "";
  if (pageUrl) {
    try {
      suggestedBaseUrl = new URL(pageUrl).origin;
    } catch (error) {
      suggestedBaseUrl = "";
    }
  }
  const baseUrlSet = Boolean(state.currentBaseUrl);
  const baseField = getEditableFieldState({
    inputRef: refs.baseUrlInput,
    currentValue: view.baseUrlInputValue,
    value: state.currentBaseUrl,
    isSet: baseUrlSet,
    editMode: state.baseUrlEditMode,
    suggestedValue: suggestedBaseUrl,
    noticeUnset: "Set Base Page URL before enabling marking",
    noticeEdit: "Set Base Page URL to continue"
  });
  const baseUrlReady = baseField.isReady;
  let toggleEnabled = Boolean(
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      utils.isPageWithinBaseUrl(pageUrl, effectiveTabState.baseUrl)
  );
  if (state.lastPopupEnabled !== null) {
    toggleEnabled = state.lastPopupEnabled;
    if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
      state.lastPopupEnabled = null;
    }
  }
  const isEnabled = toggleEnabled;
  const storedDeviceState = await emulation.getDeviceEmulationState(state.currentTab.id);
  const normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    loginEndpointValue
  } =
    await helpers.loadGlobalAiSettings();
  const loginEmailValue = view.loginEmailValue || "";
  const loginPasswordValue = view.loginPasswordValue || "";
  if (!configEndpointValue) {
    state.configEndpointEditMode = false;
  }
  if (!endpointValue) {
    state.endpointEditMode = false;
  }
  if (!loginEndpointValue) {
    state.loginEndpointEditMode = false;
  }
  const configEndpointSet = Boolean(configEndpointValue);
  const configEndpointField = getEditableFieldState({
    inputRef: refs.configEndpointUrlInput,
    currentValue: view.configEndpointUrlValue,
    value: configEndpointValue,
    isSet: configEndpointSet,
    editMode: state.configEndpointEditMode,
    suggestedValue: configEndpointValue,
    noticeUnset: "Set Configuration Endpoint before continuing",
    noticeEdit: "Set Configuration Endpoint to continue"
  });
  const configEndpointReady = configEndpointField.isReady;
  const endpointSet = Boolean(endpointValue);
  const endpointField = getEditableFieldState({
    inputRef: refs.endpointUrlInput,
    currentValue: view.endpointUrlValue,
    value: endpointValue,
    isSet: endpointSet,
    editMode: state.endpointEditMode,
    suggestedValue: endpointValue,
    noticeUnset: "Set Endpoint URL before using AI",
    noticeEdit: "Set Endpoint URL to continue"
  });
  const endpointReady = endpointField.isReady;
  const loginEndpointSet = Boolean(loginEndpointValue);
  const loginEndpointField = getEditableFieldState({
    inputRef: refs.loginEndpointUrlInput,
    currentValue: view.loginEndpointUrlValue,
    value: loginEndpointValue,
    isSet: loginEndpointSet,
    editMode: state.loginEndpointEditMode,
    suggestedValue: loginEndpointValue,
    noticeUnset: "Set Login Endpoint before signing in",
    noticeEdit: "Set Login Endpoint to continue"
  });
  const loginEndpointReady = loginEndpointField.isReady;
  const loginCredentialsEnabled = loginEndpointReady;

  const configurationComplete =
    configEndpointReady && endpointReady && loginEndpointReady && Boolean(tokenValue);
  const aiReady = baseUrlReady && endpointReady && Boolean(tokenValue);
  const latestComputed = getLatestComputedSelectorsFromConfig();
  const lastSaved = getLastSubmittedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(latestComputed).length;
  const hasNewSelectors =
    selectorCount > 0 &&
    !aiSelectorSetsEqual(latestComputed, lastSaved);
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = selectorCount > 0;
  const aiControlsVisible = endpointReady && Boolean(tokenValue);

  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
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
      state.currentSavedEntry = draftStatus.savedEntry || null;
      state.currentDraftDirty = Boolean(draftStatus.dirty);
      state.currentDraftAvailable = true;
      state.currentDraftHasEntry = Boolean(state.currentDraftEntry);
    }
  }
  const savedEntry =
    state.currentSavedEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const hasSavedPageData = Boolean(
    savedEntry &&
      ((Array.isArray(savedEntry.xpaths) && savedEntry.xpaths.length > 0) ||
        (Array.isArray(savedEntry.includeXpaths) &&
          savedEntry.includeXpaths.length > 0) ||
        (Array.isArray(savedEntry.consentXpaths) &&
          savedEntry.consentXpaths.length > 0) ||
        (typeof savedEntry.fullHTML === "string" && savedEntry.fullHTML.length > 0))
  );
  const aiBlockedByDraft = state.currentDraftDirty;

  let resolvedView =
    state.currentView ||
    uiModule.getViewState().currentView ||
    uiModule.View.Marking;
  if (!configurationComplete) {
    resolvedView = uiModule.View.Configuration;
    state.configViewLocked = true;
  } else if (state.configViewLocked) {
    resolvedView = uiModule.View.Marking;
    state.configViewLocked = false;
  }
  state.currentView = resolvedView;

  nextViewState.currentView = resolvedView;
  nextViewState.configurationComplete = configurationComplete;
  nextViewState.configurationContinueDisabled = !configurationComplete;
  nextViewState.configurationNoticeVisible = !configurationComplete;
  nextViewState.configurationNoticeText = configurationComplete
    ? ""
    : "Provide Configuration Endpoint, AI Endpoint, Login Endpoint, then login to continue.";

  nextViewState.toggleEnabled = toggleEnabled;
  nextViewState.toggleEnabledDisabled = !baseUrlReady;
  nextViewState.mainUiHidden = !isEnabled;
  nextViewState.computeButtonDisabled = aiBusy || !aiReady || aiBlockedByDraft;
  nextViewState.saveExcludesButtonDisabled =
    aiBusy ||
    !aiReady ||
    !hasNewSelectors ||
    aiBlockedByDraft;
  nextViewState.previewLatestButtonDisabled =
    aiBusy || !baseUrlReady || !hasStoredSelectors || aiBlockedByDraft;
  nextViewState.aiControlsHidden = !aiControlsVisible;
  nextViewState.loginEndpointUrlValue = loginEndpointField.value;
  nextViewState.loginEndpointUrlReadOnly = !loginEndpointField.isEditing;
  nextViewState.loginEndpointSetVisible = loginEndpointField.isEditing;
  nextViewState.loginEndpointEditVisible = loginEndpointSet;
  nextViewState.loginEndpointEditText = state.loginEndpointEditMode ? "Cancel" : "Change";
  nextViewState.loginEndpointNoticeText = loginEndpointField.noticeText;
  nextViewState.loginEndpointNoticeVisible = loginEndpointField.noticeVisible;
  nextViewState.loginEndpointInputDisabled = aiBusy;
  nextViewState.loginEndpointSetDisabled = aiBusy;
  nextViewState.loginEndpointEditDisabled = aiBusy;
  nextViewState.loginEmailValue = loginEmailValue;
  nextViewState.loginPasswordValue = loginPasswordValue;
  nextViewState.loginCredentialsDisabled = aiBusy || !loginCredentialsEnabled;
  nextViewState.loginStatusText = tokenValue ? "Token saved" : "Login required";
  nextViewState.loginActionDisabled =
    aiBusy ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
  nextViewState.configEndpointUrlValue = configEndpointField.value;
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
  nextViewState.configEndpointEditVisible = configEndpointSet;
  nextViewState.configEndpointEditText = state.configEndpointEditMode ? "Cancel" : "Change";
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
  nextViewState.configEndpointInputDisabled = aiBusy;
  nextViewState.configEndpointSetDisabled = aiBusy;
  nextViewState.configEndpointEditDisabled = aiBusy;

  nextViewState.endpointUrlValue = endpointField.value;
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
  nextViewState.endpointSetVisible = endpointField.isEditing;
  nextViewState.endpointEditVisible = endpointSet;
  nextViewState.endpointEditText = state.endpointEditMode ? "Cancel" : "Change";
  nextViewState.endpointNoticeText = endpointField.noticeText;
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
  nextViewState.endpointInputDisabled = aiBusy;
  nextViewState.endpointSetDisabled = aiBusy;
  nextViewState.endpointEditDisabled = aiBusy;
  nextViewState.configExportAllDisabled = aiBusy;
  nextViewState.configExportCurrentDisabled = aiBusy || !baseUrlReady;
  nextViewState.configImportDisabled = aiBusy;
  nextViewState.configClearCurrentDisabled = aiBusy || !state.currentBaseUrl;
  nextViewState.configClearAllDisabled = aiBusy;
  nextViewState.clearDomainCacheDisabled = state.clearDomainCacheDisabled;
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute" ? "Computing..." : "Decide Content";
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save" ? "Submitting..." : "Submit to the server";
  nextViewState.computeButtonLoading = state.aiRequestInFlight === "compute";
  nextViewState.saveExcludesButtonLoading = state.aiRequestInFlight === "save";
  nextViewState.aiControlsBusy = aiBusy;
  nextViewState.aiDirtyNoticeVisible = aiBlockedByDraft;
  nextViewState.cssSelectorsVisible =
    resolvedView === uiModule.View.Marking;
  const highlightingMode =
    resolvedView === uiModule.View.Marking && !isEnabled;
  nextViewState.highlightingOptionsVisible = highlightingMode;
  nextViewState.highlightMarkedPagesChecked = state.silentHighlightShowMarkedPages;
  nextViewState.highlightIncludedContentChecked = state.silentHighlightShowIncludedContent;
  nextViewState.highlightExcludedContentChecked = state.silentHighlightShowExcludedContent;
  nextViewState.highlightVisibleConsentChecked = state.silentHighlightShowVisibleConsent;
  nextViewState.baseUrlInputValue = baseField.value;
  nextViewState.baseUrlInputReadOnly = !baseField.isEditing;
  nextViewState.baseUrlSetVisible = baseField.isEditing;
  nextViewState.baseUrlEditVisible = baseUrlSet;
  nextViewState.baseUrlEditText = state.baseUrlEditMode ? "Cancel" : "Change";
  nextViewState.baseUrlNoticeText = baseField.noticeText;
  nextViewState.baseUrlNoticeVisible = baseField.noticeVisible;
  const draftButtonsDisabled =
    !baseUrlReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    !state.currentDraftDirty;
  nextViewState.pageSaveDisabled = draftButtonsDisabled;
  nextViewState.pageRevertDisabled =
    !baseUrlReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    !hasSavedPageData ||
    !state.currentDraftDirty;
  nextViewState.pageDeleteDisabled = !baseUrlReady || !isEnabled || !hasSavedPageData;
  if (!baseUrlReady) {
    nextViewState.pageDraftStatusText = "Set Base Page URL first";
  } else if (!isEnabled) {
    nextViewState.pageDraftStatusText = "Enable marking to edit this page";
  } else if (!state.currentDraftAvailable) {
    nextViewState.pageDraftStatusText = "Draft unavailable";
  } else if (state.currentDraftDirty) {
    nextViewState.pageDraftStatusText = "Unsaved changes";
  } else {
    nextViewState.pageDraftStatusText = "All changes saved";
  }
  nextViewState.pageDataNewNoticeHidden =
    !baseUrlReady ||
    !isEnabled ||
    !state.currentDraftAvailable ||
    hasSavedPageData;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = `${Math.round(normalizedDeviceState.scale * 100)}%`;
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled);
  const baseOptions = Object.keys(configs)
    .filter((baseUrl) => {
      const entries = configs[baseUrl] && configs[baseUrl].pageMarkings;
      return entries && Object.keys(entries).length > 0;
    })
    .sort()
    .map((baseUrl) => ({ value: baseUrl, label: baseUrl }));
  if (!baseOptions.some((option) => option.value === state.copySourceBaseUrl)) {
    state.copySourceBaseUrl = "";
    state.copySourcePageUrl = "";
  }
  let pageOptions = [];
  if (state.copySourceBaseUrl && configs[state.copySourceBaseUrl]) {
    const pageMarkings = configs[state.copySourceBaseUrl].pageMarkings || {};
    pageOptions = Object.entries(pageMarkings)
      .filter(([url, entry]) => {
        return (
          url &&
          entry &&
          Array.isArray(entry.xpaths) &&
          entry.xpaths.length > 0
        );
      })
      .map(([url, entry]) => ({
        value: url,
        label: url,
        title: entry.title || url
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  if (!pageOptions.some((option) => option.value === state.copySourcePageUrl)) {
    state.copySourcePageUrl = "";
  }
  const pagePlaceholder = state.copySourceBaseUrl
    ? pageOptions.length
      ? "Select a Page URL"
      : "No saved pages under this Base Page URL"
    : "Select a Base Page URL first";
  nextViewState.copySourceBaseOptions = baseOptions;
  nextViewState.copySourceBaseValue = state.copySourceBaseUrl;
  nextViewState.copySourceBasePlaceholder = baseOptions.length
    ? "Select a Base Page URL"
    : "No base URLs saved";
  nextViewState.copySourcePageOptions = pageOptions;
  nextViewState.copySourcePageValue = state.copySourcePageUrl;
  nextViewState.copySourcePagePlaceholder = pagePlaceholder;
  nextViewState.copySourcePageDisabled = !state.copySourceBaseUrl || !pageOptions.length;
  nextViewState.copyFromPageDisabled = !state.copySourceBaseUrl || !state.copySourcePageUrl;

  let defaultTagExclusions = [];
  let defaultTagXPathSet = new Set();
  if (state.currentBaseUrl) {
    const response = await messages.sendTabMessage({
      type: "getDefaultTagExclusionStatus",
      baseUrl: state.currentBaseUrl
    });
    if (response && Array.isArray(response.items)) {
      defaultTagExclusions = response.items;
      defaultTagXPathSet = new Set(
        defaultTagExclusions.map((item) => item.xpath).filter(Boolean)
      );
    }
  }

  const pageEntry =
    state.currentDraftEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const explicitExclude = (pageEntry && pageEntry.xpaths) || [];
  const explicitIncludeXPaths =
    pageEntry && Array.isArray(pageEntry.includeXpaths) ? pageEntry.includeXpaths : [];
  const excludedXPaths = explicitExclude
    .filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !defaultTagXPathSet.has(item.xpath) &&
        !isDefaultToggleableTagXPath(item.xpath)
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

  const filteredExplicitIncludeXPaths = explicitIncludeXPaths.filter(
    (xpath) =>
      xpath &&
      !defaultTagXPathSet.has(xpath) &&
      !isDefaultToggleableTagXPath(xpath)
  );
  let pageExplicitInclude = filteredExplicitIncludeXPaths.map((xpath) => ({
    xpath,
    text: xpath
  }));
  if (state.currentBaseUrl && filteredExplicitIncludeXPaths.length) {
    const response = await messages.sendTabMessage({
      type: "describeXPathsOnPage",
      xpaths: filteredExplicitIncludeXPaths
    });
    if (response && Array.isArray(response.items)) {
      const labelMap = new Map(
        response.items.map((item) => [item.xpath, item.text || item.xpath])
      );
      pageExplicitInclude = filteredExplicitIncludeXPaths.map((xpath) => ({
        xpath,
        text: labelMap.get(xpath) || xpath
      }));
    }
  }

  nextViewState.explicitExcludes = pageExplicitExclude;
  nextViewState.explicitExcludesEmptyText = baseUrlSet
    ? "None yet"
    : "Set Base Page URL first";
  nextViewState.explicitIncludes = pageExplicitInclude;
  nextViewState.explicitIncludesEmptyText = baseUrlSet
    ? "None yet"
    : "Set Base Page URL first";
  nextViewState.defaultTagExclusions = defaultTagExclusions;
  nextViewState.defaultTagExclusionsEmptyText = baseUrlSet
    ? "None yet"
    : "Set Base Page URL first";

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
    if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(url, state.currentBaseUrl)) {
      return;
    }
    const excludedCount = entry.xpaths.filter(
      (item) =>
        item &&
        item.excluded &&
        item.xpath &&
        !defaultTagXPathSet.has(item.xpath) &&
        !isDefaultToggleableTagXPath(item.xpath)
    ).length;
    const includedCount = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths.filter(
          (xpath) =>
            typeof xpath === "string" &&
            xpath &&
            !defaultTagXPathSet.has(xpath) &&
            !isDefaultToggleableTagXPath(xpath)
        ).length
      : 0;
    markedPages.push({
      url,
      title: entry.title || url,
      count: excludedCount + includedCount
    });
  });
  markedPages.sort((a, b) => a.title.localeCompare(b.title));
  nextViewState.markedPages = markedPages;
  nextViewState.markedPagesEmptyText = baseUrlSet
    ? "None yet"
    : "Set Base Page URL first";

  const basePageUrls = Object.keys(configs)
    .filter((url) => typeof url === "string" && url)
    .sort((left, right) => left.localeCompare(right))
    .map((url) => ({ url }));
  nextViewState.basePageUrls = basePageUrls;
  nextViewState.basePageUrlsEmptyText = "No base URLs saved";

  uiModule.setViewState(nextViewState);
  if (resolvedView === uiModule.View.Marking) {
    await applySilentHighlightVisibility();
  }
}

function handleBaseUrlInput(event) {
  uiModule.setViewState({ baseUrlInputValue: event.target.value });
}

function handleConfigEndpointInput(event) {
  uiModule.setViewState({ configEndpointUrlValue: event.target.value });
}

function handleEndpointInput(event) {
  uiModule.setViewState({ endpointUrlValue: event.target.value });
}

function handleLoginEndpointInput(event) {
  uiModule.setViewState({ loginEndpointUrlValue: event.target.value });
}

function handleLoginEmailInput(event) {
  updateLoginActionState({ loginEmailValue: event.target.value });
}

function handleLoginPasswordInput(event) {
  updateLoginActionState({ loginPasswordValue: event.target.value });
}

function handleEnterKeyDown(event, shouldHandle, handler) {
  if (event.key !== "Enter") {
    return;
  }
  if (!shouldHandle()) {
    return;
  }
  handler();
}

function handleBaseUrlKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().baseUrlInputReadOnly,
    handleBaseUrlSet
  );
}

function handleConfigEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().configEndpointUrlReadOnly,
    handleConfigEndpointSet
  );
}

function handleEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().endpointUrlReadOnly,
    handleEndpointSet
  );
}

function handleLoginEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginEndpointUrlReadOnly,
    handleLoginEndpointSet
  );
}

function handleLoginPasswordKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginActionDisabled,
    handleLoginAction
  );
}

function handleConfigToggle(event) {
  event.stopPropagation();
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event) {
  event.stopPropagation();
}

async function handleOpenConfigurationView() {
  uiModule.setConfigMenuOpen(false);
  state.currentView = uiModule.View.Configuration;
  uiModule.setViewState({ currentView: state.currentView });
  await refreshUi();
}

async function maybeSwitchToMarkingView() {
  const tokenIsValid = await validateStoredToken({
    force: true,
    showToastOnInvalid: false
  });
  const { tokenValue, endpointValue, configEndpointValue, loginEndpointValue } =
    await helpers.loadGlobalAiSettings();
  if (tokenIsValid && tokenValue && endpointValue && configEndpointValue && loginEndpointValue) {
    state.currentView = uiModule.View.Marking;
    state.configViewLocked = false;
    uiModule.setViewState({ currentView: state.currentView });
  }
}

async function handleConfigurationContinue() {
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleExplicitExcludeView(xpath) {
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to focus element");
  }
}

async function handleExplicitExcludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitExclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    excluded: false
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to update exclude");
    return;
  }
  refreshUi();
}

async function handleExplicitIncludeView(xpath) {
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to focus element");
  }
}

async function handleExplicitIncludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitInclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    included: false
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to update include");
    return;
  }
  refreshUi();
}

async function handleDefaultTagExclusionView(item) {
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath: item.xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to focus element");
  }
}

async function handleDefaultTagExclusionToggle(item) {
  if (!state.currentBaseUrl) {
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "toggleDefaultTagExclusion",
    baseUrl: state.currentBaseUrl,
    xpath: item.xpath
  });
  if (!response || !response.ok) {
    uiModule.showToast("Unable to update default tag exclusion");
    return;
  }
  await refreshUi();
}

async function handleMarkedPageNavigate(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return;
  }
  chrome.tabs.update(tab.id, { url }, () => {
    void chrome.runtime.lastError;
  });
}

async function handleBasePageNavigate(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return;
  }
  chrome.tabs.update(tab.id, { url }, () => {
    void chrome.runtime.lastError;
  });
}
async function handleEnableToggle(event) {
  const source = event && (event.currentTarget || event.target);
  const desiredEnabled = source
    ? Boolean(source.checked)
    : uiModule.getViewState().toggleEnabled;
  const tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  if (!tab) {
    return;
  }
  uiModule.setViewState({ toggleEnabled: desiredEnabled });
  if (!helpers.ensureBaseUrl("Set Base Page URL before enabling marking")) {
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    return;
  }
  state.lastPopupEnabled = desiredEnabled;
  const baseUrlValue = state.currentBaseUrl;
  if (desiredEnabled) {
    const parsed = utils.parseBaseUrl(baseUrlValue);
    if (!parsed) {
      uiModule.showToast("Enter a valid Base Page URL");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
      uiModule.showToast("Current page is outside the Base Page URL");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    state.currentConfig = await config.ensureConfig(baseUrlValue);
    // Inject content script first
    const injectResult = await helpers.injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      uiModule.showToast(injectResult.error || "Unable to activate on this page");
      uiModule.setViewState({ toggleEnabled: false });
      state.lastPopupEnabled = null;
      await refreshUi();
      return;
    }
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId: tab.id });
    await utils.setTabState(tab.id, { enabled: true, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: baseUrlValue
    });
    await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  } else {
    await utils.setTabState(tab.id, { enabled: false, baseUrl: baseUrlValue });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  await refreshUi();
}

async function handleHighlightMarkedPagesChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowMarkedPages",
    "highlightMarkedPagesChecked"
  );
}

async function handleHighlightIncludedContentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowIncludedContent",
    "highlightIncludedContentChecked"
  );
}

async function handleHighlightExcludedContentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowExcludedContent",
    "highlightExcludedContentChecked"
  );
}

async function handleHighlightVisibleConsentChange(event) {
  await updateHighlightVisibilityOption(
    event,
    "silentHighlightShowVisibleConsent",
    "highlightVisibleConsentChecked"
  );
}

async function updateHighlightVisibilityOption(event, stateKey, viewKey) {
  const checked = readCheckboxValue(event, state[stateKey]);
  state[stateKey] = checked;
  uiModule.setViewState({ [viewKey]: checked });
  await persistSilentHighlightVisibility();
  await applySilentHighlightVisibility({ force: true });
}

async function handleDeviceEmulationEnabledToggle(event) {
  const desiredEnabled = event && event.currentTarget
    ? Boolean(event.currentTarget.checked)
    : uiModule.getViewState().deviceEmulationEnabled;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ deviceEmulationEnabled: desiredEnabled });
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: desiredEnabled,
    mode: state.currentDeviceMode,
    scale: state.currentDeviceScale
  });
}

async function handleDeviceModeToggle(event) {
  const desiredMode = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceMode;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: `${Math.round(state.currentDeviceScale * 100)}%`
    });
    return;
  }
  uiModule.setViewState({ deviceMode: desiredMode });
  if (desiredMode === state.currentDeviceMode) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: desiredMode,
    scale: state.currentDeviceScale
  });
}

function handleDeviceScaleInput(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: `${Math.round(scale * 100)}%`
  });
}

async function handleDeviceScaleChange(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: `${Math.round(state.currentDeviceScale * 100)}%`
    });
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: `${Math.round(scale * 100)}%`
  });
  if (scale === state.currentDeviceScale) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: state.currentDeviceMode,
    scale
  });
}

async function handleClearDomainCache() {
  const tab = await helpers.ensureActiveTab({
    requireUrl: true,
    toastOnMissing: "No active tab to clear"
  });
  if (!tab) {
    return;
  }
  const origin = utils.getOriginFromUrl(tab.url);
  if (!origin) {
    uiModule.showToast("Unsupported page for cache clearing");
    return;
  }
  let hostname = origin;
  try {
    hostname = new URL(tab.url).hostname;
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
  state.clearDomainCacheDisabled = true;
  uiModule.setViewState({ clearDomainCacheDisabled: true });
  const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
  state.clearDomainCacheDisabled = false;
  uiModule.setViewState({ clearDomainCacheDisabled: false });
  if (!result.ok) {
    uiModule.setUiBusy(false);
    uiModule.showToast(result.error || "Unable to clear cache");
    return;
  }
  uiModule.showToast("Domain cache cleared");
  const reloadResult = await chromeHelpers.reloadTab(tab.id);
  uiModule.setUiBusy(false);
  if (!reloadResult.ok) {
    uiModule.showToast(reloadResult.error || "Unable to reload tab");
  }
}

async function handleExportAll() {
  uiModule.setConfigMenuOpen(false);
  const configs = await config.getConfigs();
  const normalizedConfigs = {};
  Object.entries(configs).forEach(([baseUrl, entry]) => {
    normalizedConfigs[baseUrl] = config.normalizeImportedConfig(baseUrl, entry);
  });
  if (state.currentBaseUrl && state.currentConfig) {
    normalizedConfigs[state.currentBaseUrl] = config.normalizeImportedConfig(
      state.currentBaseUrl,
      state.currentConfig
    );
  }
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    loginEndpointValue
  } =
    await helpers.loadGlobalAiSettings();
  const payload = {
    version: 1,
    scope: "all",
    configs: normalizedConfigs,
    globalToken: tokenValue,
    globalEndpoint: endpointValue,
    globalConfigEndpoint: configEndpointValue,
    globalLoginEndpoint: loginEndpointValue
  };
  const filename = `unfluffify-all-${new Date().toISOString().slice(0, 10)}.json`;
  chromeHelpers.downloadJsonFile(filename, payload);
}

async function handleExportCurrent() {
  uiModule.setConfigMenuOpen(false);
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  const configs = await config.getConfigs();
  const sourceConfig =
    state.currentConfig ||
    configs[state.currentBaseUrl] ||
    config.createDefaultConfig(state.currentBaseUrl);
  const normalizedConfig = config.normalizeImportedConfig(
    state.currentBaseUrl,
    sourceConfig
  );
  const payload = {
    version: 1,
    scope: "baseUrl",
    baseUrl: state.currentBaseUrl,
    config: normalizedConfig
  };
  const safeBase = utils.makeSafeFilename(state.currentBaseUrl) || "base";
  const filename = `unfluffify-${safeBase}.json`;
  chromeHelpers.downloadJsonFile(filename, payload);
}

async function handleImport() {
  uiModule.setConfigMenuOpen(false);
  const { configImportFile } = uiModule.getRefs();
  if (configImportFile) {
    configImportFile.click();
  }
}

async function handleClearCurrent() {
  uiModule.setConfigMenuOpen(false);
  if (!helpers.ensureBaseUrl()) {
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
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (tab) {
    await utils.setTabState(tab.id, { enabled: false, baseUrl: "" });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  state.currentBaseUrl = "";
  state.currentConfig = null;
  state.baseUrlEditMode = false;
  uiModule.showToast("Base Page URL cleared");
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
    globalEndpoint,
    globalConfigEndpoint,
    globalLoginEndpoint
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
      globalEndpoint: globalEndpoint || "",
      globalConfigEndpoint: globalConfigEndpoint || "",
      globalLoginEndpoint: globalLoginEndpoint || ""
    });
    await maybeSwitchToMarkingView();
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
  const tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  if (!tab) {
    return;
  }
  const baseUrlValue = uiModule.getViewState().baseUrlInputValue.trim();
  if (!baseUrlValue) {
    uiModule.showToast("Enter a Base Page URL");
    return;
  }
  const parsed = utils.parseBaseUrl(baseUrlValue);
  if (!parsed) {
    uiModule.showToast("Enter a valid Base Page URL");
    return;
  }
  if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
    uiModule.showToast("Current page is outside the Base Page URL");
    return;
  }
  // Inject content script first
  const injectResult = await helpers.injectContentScriptIfNeeded();
  if (!injectResult.ok) {
    uiModule.showToast(injectResult.error || "Unable to activate on this page");
    return;
  }
  state.currentBaseUrl = baseUrlValue;
  state.currentConfig = await config.ensureConfig(baseUrlValue);
  state.baseUrlEditMode = false;
  await utils.setTabState(tab.id, { enabled: true, baseUrl: baseUrlValue });
  await messages.sendTabMessageWithRetry({
    type: "setEnabled",
    enabled: true,
    baseUrl: baseUrlValue
  });
  await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  await refreshUi();
}

async function handleBaseUrlEditToggle() {
  if (!state.currentBaseUrl) {
    return;
  }
  state.baseUrlEditMode = !state.baseUrlEditMode;
  const tab = await helpers.ensureActiveTab();
  if (state.baseUrlEditMode) {
    if (tab && tab.id) {
      await utils.setTabState(tab.id, {
        enabled: false,
        baseUrl: state.currentBaseUrl
      });
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
  } else if (tab && utils.isPageWithinBaseUrl(tab.url, state.currentBaseUrl)) {
    // Inject content script first when re-enabling
    const injectResult = await helpers.injectContentScriptIfNeeded();
    if (!injectResult.ok) {
      uiModule.showToast(injectResult.error || "Unable to activate on this page");
      state.baseUrlEditMode = true;
      await refreshUi();
      return;
    }
    state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
    await utils.setTabState(tab.id, {
      enabled: true,
      baseUrl: state.currentBaseUrl
    });
    await messages.sendTabMessageWithRetry({
      type: "setEnabled",
      enabled: true,
      baseUrl: state.currentBaseUrl
    });
    await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
  }
  await refreshUi();
}

async function handleConfigEndpointSet() {
  const endpointValue = uiModule.getViewState().configEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast("Enter a Configuration Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast("Enter a valid Configuration Endpoint URL");
    return;
  }
  await utils.storageSet(chrome.storage.sync, {
    globalConfigEndpoint: endpointValue
  });
  state.configEndpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleConfigEndpointEditToggle() {
  state.configEndpointEditMode = !state.configEndpointEditMode;
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = uiModule.getViewState().endpointUrlValue.trim();
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
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleLoginEndpointSet() {
  const endpointValue = uiModule.getViewState().loginEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast("Enter a Login Endpoint URL");
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast("Enter a valid Login Endpoint URL");
    return;
  }
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalLoginEndpoint",
    "globalToken"
  ]);
  const previousEndpoint = (stored && stored.globalLoginEndpoint) || "";
  const hasToken = Boolean(stored && stored.globalToken);
  await utils.storageSet(chrome.storage.sync, {
    globalLoginEndpoint: endpointValue,
    globalToken: previousEndpoint !== endpointValue && hasToken ? "" : stored.globalToken || ""
  });
  state.loginEndpointEditMode = false;
  if (previousEndpoint !== endpointValue && hasToken) {
    uiModule.showToast("Login endpoint changed. Login required");
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleLoginEndpointEditToggle() {
  state.loginEndpointEditMode = !state.loginEndpointEditMode;
  await refreshUi();
}

async function handleLoginAction() {
  const view = uiModule.getViewState();
  const endpointValue = view.loginEndpointUrlValue.trim();
  const email = view.loginEmailValue.trim();
  const password = view.loginPasswordValue;

  if (!endpointValue) {
    uiModule.showToast("Set Login Endpoint URL first");
    return;
  }
  if (!isValidEmail(email)) {
    uiModule.showToast("Enter a valid email");
    return;
  }
  if (!password.trim()) {
    uiModule.showToast("Enter password");
    return;
  }

  state.aiRequestInFlight = "login";
  await refreshUi();
  try {
    const loginUrl = resolveRelativeEndpoint(endpointValue, "/api/account/login");
    if (!loginUrl) {
      uiModule.showToast("Enter a valid Login Endpoint URL");
      return;
    }
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const errorText =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        `Login failed (${response.status})`;
      uiModule.showToast(errorText);
      return;
    }
    const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
    if (!token) {
      uiModule.showToast("Login response did not include token");
      return;
    }

    await utils.storageSet(chrome.storage.sync, {
      globalLoginEndpoint: endpointValue,
      globalToken: token
    });
    uiModule.setViewState({ loginPasswordValue: "" });
    uiModule.showToast("Login successful");
  } catch (error) {
    uiModule.showToast("Login request failed");
  } finally {
    state.aiRequestInFlight = null;
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleContextRefresh() {
  const tab = await helpers.ensureActiveTab();
  state.baseUrlEditMode = false;
  state.endpointEditMode = false;
  state.configEndpointEditMode = false;
  state.loginEndpointEditMode = false;
  if (tab && tab.id) {
    const tabState = await utils.getTabState(tab.id);
    if (tabState && tabState.enabled) {
      await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
    }
  }
  await refreshUi();
}

async function handlePageSave() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
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
  await refreshUi();
}

async function handlePageRevert() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
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
  await refreshUi();
}

async function handlePageDelete() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
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
  await refreshUi();
}

async function handleCopySourceBaseChange(event) {
  const value = event && event.target ? event.target.value : "";
  state.copySourceBaseUrl = value;
  state.copySourcePageUrl = "";
  uiModule.setViewState({
    copySourceBaseValue: value,
    copySourcePageValue: ""
  });
  await refreshUi();
}

async function handleCopySourcePageChange(event) {
  const value = event && event.target ? event.target.value : "";
  state.copySourcePageUrl = value;
  uiModule.setViewState({ copySourcePageValue: value });
  await refreshUi();
}

async function handleCopyFromPage() {
  const tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  if (!tab) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!uiModule.getViewState().toggleEnabled) {
    uiModule.showToast("Enable marking to copy page data");
    return;
  }
  const sourceBaseUrl = state.copySourceBaseUrl;
  const sourcePageUrl = state.copySourcePageUrl;
  if (!sourceBaseUrl || !sourcePageUrl) {
    uiModule.showToast("Choose a Base Page URL and Page URL first");
    return;
  }
  const confirmed = window.confirm(
    `Copy stored page data from ${sourcePageUrl} into the current page draft? This will overwrite existing draft marks.`
  );
  if (!confirmed) {
    return;
  }
  const response = await messages.sendTabMessage({
    type: "copyPageDataFromStored",
    baseUrl: state.currentBaseUrl,
    sourceBaseUrl,
    sourcePageUrl
  });
  if (!response || !response.ok) {
    uiModule.showToast(response && response.error ? response.error : "Unable to copy page data");
    return;
  }
  const copied = Number.isFinite(response.copied) ? response.copied : 0;
  const total = Number.isFinite(response.total) ? response.total : 0;
  uiModule.showToast(
    total
      ? `Copied ${copied} of ${total} matched elements`
      : copied
        ? `Copied ${copied} matched elements`
        : "No matching elements found"
  );
  await refreshUi();
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;

  state.currentConfig = await config.ensureConfig(state.currentBaseUrl);

  const pageMarkings = state.currentConfig.pageMarkings || {};
  const pages = Object.entries(pageMarkings)
    .map(([url, entry]) => {
      if (!url || !entry) {
        return null;
      }
      const fullHTML = typeof entry.fullHTML === "string" ? entry.fullHTML : "";
      const xpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      const consentXpaths = Array.isArray(entry.consentXpaths)
        ? entry.consentXpaths.filter((xpath) => typeof xpath === "string" && xpath)
        : [];
      const inclusionXpaths = Array.isArray(entry.includeXpaths)
        ? entry.includeXpaths
        : [];
      const combined = new Map();
      const normalizeXpath = (value) =>
        typeof value === "string" ? value.trim() : "";
      xpaths.forEach((item) => {
        const xpath = normalizeXpath(item && item.xpath);
        if (!xpath) {
          return;
        }
        combined.set(xpath, { xpath, excluded: Boolean(item.excluded) });
      });
      inclusionXpaths.forEach((xpath) => {
        const normalizedXpath = normalizeXpath(xpath);
        if (!normalizedXpath) {
          return;
        }
        const existing = combined.get(normalizedXpath);
        if (existing) {
          existing.excluded = false;
        } else {
          combined.set(normalizedXpath, { xpath: normalizedXpath, excluded: false });
        }
      });
      // Consent-hidden xpaths must always be sent as excluded.
      consentXpaths.forEach((xpath) => {
        const normalizedXpath = normalizeXpath(xpath);
        if (!normalizedXpath) {
          return;
        }
        const existing = combined.get(normalizedXpath);
        if (existing) {
          existing.excluded = true;
        } else {
          combined.set(normalizedXpath, { xpath: normalizedXpath, excluded: true });
        }
      });
      const combinedXpaths = Array.from(combined.values());
      const normalizedPayloadXpaths = normalizePayloadXpaths(combinedXpaths);
      return {
        url,
        fullHTML,
        xpaths: normalizedPayloadXpaths
      };
    })
    .filter((entry) => {
      if (!entry || !entry.url) {
        return false;
      }
      if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(entry.url, state.currentBaseUrl)) {
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
    defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
    pages
  };

  let selectorSet = {
    exclusionSelectors: [],
    inclusionSelectors: []
  };
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
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.exclusionSelectors) ||
      !Array.isArray(data.inclusionSelectors)
    ) {
      uiModule.showToast("Endpoint response format error");
      return;
    }
    selectorSet = normalizeAiSelectorSet(data);
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.latestComputedSelectors = normalizeAiSelectorSet(selectorSet);
      config.domainAiSelectorSet = normalizeAiSelectorSet(selectorSet);
    });

    await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
    await messages.sendTabMessage({
      type: "showAiPreview",
      selectorSet
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
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast("Save the current page before using AI controls");
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;
  const selectorSet = getLatestComputedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(selectorSet).length;
  if (!selectorCount) {
    uiModule.showToast("No selectors available to submit");
    return;
  }
  if (aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig())) {
    uiModule.showToast("No new selectors to submit");
    return;
  }
  const confirmed = window.confirm(
    "Are these the final settings to this property for extractin the contents?"
  );
  if (!confirmed) {
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
        defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
        exclusionSelectors: selectorSet.exclusionSelectors,
        inclusionSelectors: selectorSet.inclusionSelectors
      })
    });
    if (!response.ok) {
      uiModule.showToast("Submit response error");
      return;
    }
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (config) => {
      config.lastSavedSelectors = normalizeAiSelectorSet(selectorSet);
    });
    uiModule.showToast("Submitted to server");
  } catch (error) {
    uiModule.showToast("Submit request failed");
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handlePreviewLatest() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast("Set Base Page URL first");
    return;
  }
  const selectorSet = getLatestComputedSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast("No stored selectors available");
    return;
  }
  await messages.sendTabMessage({
    type: "showAiPreview",
    selectorSet
  });
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    return;
  }
  state.refreshTimer = window.setTimeout(async () => {
    state.refreshTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi();
  }, 120);
}

async function init() {
  await helpers.ensureActiveTab();

  uiModule.initUi({
    onToggleEnabled: handleEnableToggle,
    onHighlightMarkedPagesChange: handleHighlightMarkedPagesChange,
    onHighlightIncludedContentChange: handleHighlightIncludedContentChange,
    onHighlightExcludedContentChange: handleHighlightExcludedContentChange,
    onHighlightVisibleConsentChange: handleHighlightVisibleConsentChange,
    onDeviceEmulationEnabledChange: handleDeviceEmulationEnabledToggle,
    onDeviceModeChange: handleDeviceModeToggle,
    onDeviceScaleInput: handleDeviceScaleInput,
    onDeviceScaleChange: handleDeviceScaleChange,
    onConfigToggle: handleConfigToggle,
    onConfigMenuClick: handleConfigMenuClick,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onExportAll: handleExportAll,
    onExportCurrent: handleExportCurrent,
    onImport: handleImport,
    onClearDomainCache: handleClearDomainCache,
    onClearCurrent: handleClearCurrent,
    onImportFile: handleImportFile,
    onBaseUrlInput: handleBaseUrlInput,
    onBaseUrlKeyDown: handleBaseUrlKeyDown,
    onRefreshContext: handleContextRefresh,
    onBaseUrlSet: handleBaseUrlSet,
    onBaseUrlEditToggle: handleBaseUrlEditToggle,
    onPageSave: handlePageSave,
    onPageRevert: handlePageRevert,
    onPageDelete: handlePageDelete,
    onCopySourceBaseChange: handleCopySourceBaseChange,
    onCopySourcePageChange: handleCopySourcePageChange,
    onCopyFromPage: handleCopyFromPage,
    onConfigEndpointInput: handleConfigEndpointInput,
    onConfigEndpointKeyDown: handleConfigEndpointKeyDown,
    onConfigEndpointSet: handleConfigEndpointSet,
    onConfigEndpointEditToggle: handleConfigEndpointEditToggle,
    onEndpointInput: handleEndpointInput,
    onEndpointKeyDown: handleEndpointKeyDown,
    onEndpointSet: handleEndpointSet,
    onEndpointEditToggle: handleEndpointEditToggle,
    onLoginEndpointInput: handleLoginEndpointInput,
    onLoginEndpointKeyDown: handleLoginEndpointKeyDown,
    onLoginEndpointSet: handleLoginEndpointSet,
    onLoginEndpointEditToggle: handleLoginEndpointEditToggle,
    onLoginEmailInput: handleLoginEmailInput,
    onLoginPasswordInput: handleLoginPasswordInput,
    onLoginPasswordKeyDown: handleLoginPasswordKeyDown,
    onLoginAction: handleLoginAction,
    onCompute: handleComputeSelectors,
    onSaveExcludes: handleSaveExcludes,
    onPreviewLatest: handlePreviewLatest,
    onExplicitExcludeView: handleExplicitExcludeView,
    onExplicitExcludeRemove: handleExplicitExcludeRemove,
    onExplicitIncludeView: handleExplicitIncludeView,
    onExplicitIncludeRemove: handleExplicitIncludeRemove,
    onDefaultTagExclusionView: handleDefaultTagExclusionView,
    onDefaultTagExclusionToggle: handleDefaultTagExclusionToggle,
    onMarkedPageNavigate: handleMarkedPageNavigate,
    onBasePageNavigate: handleBasePageNavigate
  });

  document.addEventListener("click", () => uiModule.setConfigMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
    }
    if (
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.repeat
    ) {
      if (isEditableTarget(event.target)) {
        return;
      }
      const view = uiModule.getViewState();
      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        event.stopPropagation();
        handleEnableToggle({ target: { checked: !view.toggleEnabled } }).then();
        return;
      }
      if (event.key === "s" || event.key === "S") {
        if (!view.toggleEnabled || view.pageSaveDisabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        handlePageSave().then();
      }
    }
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!tabId) {
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    await helpers.ensureActiveTab();
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
          changes[`${constants.DEVICE_EMULATION_PREFIX}${state.currentTab.id}`]))
    ) {
      scheduleRefresh();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pageDraftChanged") {
      if (message && message.type === "consentXpathsChanged") {
        if (state.currentBaseUrl && message.baseUrl === state.currentBaseUrl) {
          const hasSavedData = Boolean(
            state.currentSavedEntry &&
              ((Array.isArray(state.currentSavedEntry.xpaths) &&
                state.currentSavedEntry.xpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.includeXpaths) &&
                  state.currentSavedEntry.includeXpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.consentXpaths) &&
                  state.currentSavedEntry.consentXpaths.length > 0) ||
                (typeof state.currentSavedEntry.fullHTML === "string" &&
                  state.currentSavedEntry.fullHTML.length > 0))
          );
          if (hasSavedData) {
            window.alert("Consent elements changed on this page. Save to keep the updates.");
          }
          scheduleRefresh();
        }
      }
      return;
    }
    if (state.currentBaseUrl && message.baseUrl === state.currentBaseUrl) {
      scheduleRefresh();
    }
  });

  if (state.tokenValidationTimer) {
    window.clearInterval(state.tokenValidationTimer);
  }
  state.tokenValidationTimer = window.setInterval(async () => {
    const isValid = await validateStoredToken({ force: true, showToastOnInvalid: true });
    if (!isValid) {
      await refreshUi();
    }
  }, TOKEN_VALIDATION_INTERVAL_MS);

  await refreshUi();
}

init();
