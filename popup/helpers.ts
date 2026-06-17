// @ts-nocheck
import * as emulation from "./emulation.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";
import { PopupText, ViewText, formatScalePercent } from "../common/text.js";
import * as uiModule from "./ui.js";
import * as utils from "../common/utilities.js";
import { getGlobalAiSettings } from "../common/settings-store.js";

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
  // Raise the blocking "Applying device emulation..." curtain only for the
  // duration of THIS operation. (deviceControlsDisabled also stays true for the
  // whole marking session, so it must not drive the curtain.)
  uiModule.setViewState({ deviceEmulationApplying: true });
  // The background mobile-emulation update attaches the Chrome debugger, which
  // can hang (e.g. a slow/again-attaching target). Bound it so a hang cannot
  // wedge the caller's spinner ("Applying device emulation...") indefinitely;
  // on timeout we fall through to the failure path which reconciles + toasts.
  let response;
  try {
    response = await Promise.race([
      messages.sendRuntimeMessage({
        type: "updateDeviceEmulation",
        tabId: state.currentTab.id,
        enabled,
        mode,
        scale,
        recalculateScale
      }),
      new Promise((resolve) => {
        setTimeout(() => resolve({ ok: false, error: "Device emulation timed out", timedOut: true }), 12000);
      })
    ]);
  } finally {
    // Always drop the operation curtain, even if the message rejects - unlike
    // deviceControlsDisabled, deviceEmulationApplying is not recomputed by
    // refreshUi, so a leak here would stick the curtain permanently.
    emulation.setDeviceControlsDisabled(false);
    uiModule.setViewState({ deviceEmulationApplying: false });
  }
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
  return getGlobalAiSettings();
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
