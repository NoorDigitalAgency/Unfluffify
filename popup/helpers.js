import * as emulation from "./emulation.js";
import * as messages from "./messages.js";
import * as stateModule from "./state.js";
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

export function ensureBaseUrl(message = "Set Base Page URL first") {
  if (!state.currentBaseUrl) {
    uiModule.showToast(message);
    return false;
  }
  return true;
}

export function syncEditableField(options) {
  const {
    input,
    setButton,
    editButton,
    notice,
    value,
    isSet,
    editMode,
    suggestedValue,
    noticeUnset,
    noticeEdit
  } = options;
  const isEditing = !isSet || editMode;

  if (input) {
    if (!isEditing) {
      input.value = value || "";
    } else if (document.activeElement !== input) {
      input.value = isSet ? value || "" : suggestedValue || "";
    }
    input.readOnly = !isEditing;
  }
  if (setButton) {
    setButton.style.display = isEditing ? "inline-flex" : "none";
  }
  if (editButton) {
    editButton.style.display = isSet ? "inline-flex" : "none";
    editButton.textContent = editMode ? "Cancel" : "Change";
  }
  if (notice) {
    if (!isSet) {
      notice.textContent = noticeUnset;
      notice.style.display = "block";
    } else if (editMode) {
      notice.textContent = noticeEdit;
      notice.style.display = "block";
    } else {
      notice.style.display = "none";
    }
  }

  return { isEditing, isReady: isSet && !editMode };
}

export async function injectContentScriptIfNeeded() {
  if (!state.currentTab || !state.currentTab.id) {
    return { ok: false, error: "No active tab" };
  }
  const response = await messages.sendRuntimeMessage({
    type: "injectContentScript",
    tabId: state.currentTab.id
  });
  return response || { ok: false, error: "Injection failed" };
}

export async function updateDeviceEmulation({ enabled, mode, scale }) {
  if (!state.currentTab || !state.currentTab.id) {
    return null;
  }
  emulation.setDeviceControlsDisabled(true);
  const response = await messages.sendRuntimeMessage({
    type: "updateDeviceEmulation",
    tabId: state.currentTab.id,
    enabled,
    mode,
    scale
  });
  emulation.setDeviceControlsDisabled(false);
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Device emulation failed");
    emulation.updateDeviceEmulationUi({
      enabled: state.currentDeviceEmulationEnabled,
      mode: state.currentDeviceMode,
      scale: state.currentDeviceScale
    });
    return null;
  }
  emulation.updateDeviceEmulationUi(response.state);
  return response.state;
}

export async function loadGlobalAiSettings() {
  const [tokenResult, endpointResult] = await Promise.all([
    utils.storageGet(chrome.storage.sync, "globalToken"),
    utils.storageGet(chrome.storage.sync, "globalEndpoint")
  ]);
  return {
    tokenValue: (tokenResult && tokenResult.globalToken) || "",
    endpointValue: (endpointResult && endpointResult.globalEndpoint) || ""
  };
}

export async function requireAiCredentials() {
  const { tokenValue, endpointValue } = await loadGlobalAiSettings();
  if (!endpointValue) {
    uiModule.showToast("Set Endpoint URL first");
    return null;
  }
  if (!tokenValue) {
    uiModule.showToast("Set token first");
    return null;
  }
  return { tokenValue, endpointValue };
}
