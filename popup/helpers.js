import * as emulation from "./emulation.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";
import { PopupText, ViewText, formatScalePercent } from "../common/text.js";
import * as uiModule from "./ui.js";
import * as utils from "../common/utilities.js";

const { state } = stateModule;

export async function ensureActiveTab(options = {}) {
  const { requireId = false, requireUrl = false, toastOnMissing = "" } = options;
  await messages.loadActiveTab();
  const tab = state.currentTab;
  if (!tab || (requireId && !tab.id) || (requireUrl && !tab.url)) {
    if (toastOnMissing) {
      uiModule.showToast(toastOnMissing);
    }
    return null;
  }
  return tab;
}

export function ensureBaseUrl(message = ViewText.noMappedBaseUrlOrSiteId) {
  if (!state.currentBaseUrl) {
    uiModule.showToast(message);
    return false;
  }
  return true;
}

export async function injectContentScriptIfNeeded() {
  if (!state.currentTab || !state.currentTab.id) {
    return { ok: false, error: PopupText.helper.injectNoActiveTab };
  }
  const response = await messages.sendRuntimeMessage({
    type: "injectContentScript",
    tabId: state.currentTab.id
  });
  return response || { ok: false, error: PopupText.helper.injectFailed };
}

export async function updateDeviceEmulation({
  enabled,
  mode,
  scale,
  recalculateScale = false
}) {
  if (!state.currentTab || !state.currentTab.id) {
    return null;
  }
  const supportedUrl = utils.getOriginFromUrl(state.currentTab.url || "");
  if (enabled && !supportedUrl) {
    uiModule.showToast(PopupText.device.unsupportedToast);
    const normalized = emulation.syncDeviceEmulationState({
      enabled: false,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    uiModule.setViewState({
      deviceEmulationEnabled: normalized.enabled,
      deviceMode: normalized.mode,
      deviceScale: normalized.scale.toFixed(2),
      deviceScaleValue: formatScalePercent(normalized.scale)
    });
    return null;
  }
  const syncDeviceView = (normalized) => {
    uiModule.setViewState({
      deviceEmulationEnabled: normalized.enabled,
      deviceMode: normalized.mode,
      deviceScale: normalized.scale.toFixed(2),
      deviceScaleValue: formatScalePercent(normalized.scale)
    });
  };
  emulation.setDeviceControlsDisabled(true);
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled,
    mode,
    scale,
    recalculateScale
  });
  emulation.setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || PopupText.device.emulationFailed);
    const reconciledState = state.currentTab && state.currentTab.id
      ? await emulation.reconcileDeviceEmulationState(state.currentTab.id)
      : {
          enabled: state.currentDeviceEmulationEnabled,
          mode: state.currentDeviceMode,
          scale: state.currentDeviceScale
        };
    const normalized = emulation.syncDeviceEmulationState(reconciledState);
    syncDeviceView(normalized);
    return null;
  }
  const normalized = emulation.syncDeviceEmulationState(response.state);
  syncDeviceView(normalized);
  return normalized;
}

export async function loadGlobalAiSettings() {
  const [tokenResult, endpointResult, configEndpointResult, stageBaseResult] =
    await Promise.all([
      utils.storageGet(chrome.storage.sync, "globalToken"),
      utils.storageGet(chrome.storage.sync, "globalEndpoint"),
      utils.storageGet(chrome.storage.sync, "globalConfigEndpoint"),
      utils.storageGet(chrome.storage.sync, "globalStageBase")
    ]);
  return {
    tokenValue: (tokenResult && tokenResult.globalToken) || "",
    endpointValue: (endpointResult && endpointResult.globalEndpoint) || "",
    configEndpointValue:
      (configEndpointResult && configEndpointResult.globalConfigEndpoint) || "",
    stageBaseValue:
      (stageBaseResult && stageBaseResult.globalStageBase) || ""
  };
}

export async function requireAiCredentials() {
  const { tokenValue, endpointValue } = await loadGlobalAiSettings();
  if (!endpointValue) {
    uiModule.showToast(PopupText.helper.setEndpointFirst);
    return null;
  }
  if (!tokenValue) {
    uiModule.showToast(PopupText.helper.loginFirst);
    return null;
  }
  return { tokenValue, endpointValue };
}
