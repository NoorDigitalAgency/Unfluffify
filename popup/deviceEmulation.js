import { storageGet } from "./storage.js";
import { ui } from "./ui.js";
import { state } from "./state.js";
import { DEVICE_MODE_PREFIX, DEVICE_SCALE_DEFAULTS, DEVICE_SCALE_LIMITS } from "./constants.js";

export function normalizeDeviceMode(mode) {
  return mode === "mobile" ? "mobile" : "desktop";
}

export function normalizeDeviceScale(scale, mode) {
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    return DEVICE_SCALE_DEFAULTS[mode];
  }
  if (scale < DEVICE_SCALE_LIMITS.min) {
    return DEVICE_SCALE_LIMITS.min;
  }
  if (scale > DEVICE_SCALE_LIMITS.max) {
    return DEVICE_SCALE_LIMITS.max;
  }
  return scale;
}

export function normalizeDeviceEmulationState(value) {
  if (!value) {
    return {
      enabled: false,
      mode: "desktop",
      scale: DEVICE_SCALE_DEFAULTS.desktop
    };
  }
  if (typeof value === "string") {
    const mode = normalizeDeviceMode(value);
    return {
      enabled: true,
      mode,
      scale: DEVICE_SCALE_DEFAULTS[mode]
    };
  }
  const mode = normalizeDeviceMode(value.mode);
  return {
    enabled: Boolean(value.enabled),
    mode,
    scale: normalizeDeviceScale(value.scale, mode)
  };
}

export async function getDeviceEmulationState(tabId) {
  const key = `${DEVICE_MODE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return normalizeDeviceEmulationState(result[key]);
}

export function updateDeviceEmulationUi(stateValue) {
  const normalized = normalizeDeviceEmulationState(stateValue);
  state.currentDeviceMode = normalized.mode;
  state.currentDeviceScale = normalized.scale;
  state.currentDeviceEmulationEnabled = normalized.enabled;
  if (ui.deviceEmulationEnabled) {
    ui.deviceEmulationEnabled.checked = normalized.enabled;
  }
  if (ui.deviceModeDesktop) {
    ui.deviceModeDesktop.checked = normalized.mode === "desktop";
  }
  if (ui.deviceModeMobile) {
    ui.deviceModeMobile.checked = normalized.mode === "mobile";
  }
  if (ui.deviceScale) {
    ui.deviceScale.value = normalized.scale.toFixed(2);
  }
  if (ui.deviceScaleValue) {
    ui.deviceScaleValue.textContent = `${Math.round(normalized.scale * 100)}%`;
  }
  setDeviceModeInputsDisabled(!normalized.enabled);
}

export function getSelectedDeviceMode() {
  if (ui.deviceModeMobile && ui.deviceModeMobile.checked) {
    return "mobile";
  }
  return "desktop";
}

export function setDeviceModeInputsDisabled(disabled) {
  if (ui.deviceModeDesktop) {
    ui.deviceModeDesktop.disabled = disabled;
  }
  if (ui.deviceModeMobile) {
    ui.deviceModeMobile.disabled = disabled;
  }
  if (ui.deviceScale) {
    ui.deviceScale.disabled = disabled;
  }
}

export function getSelectedDeviceScale() {
  if (!ui.deviceScale) {
    return state.currentDeviceScale;
  }
  const parsed = Number.parseFloat(ui.deviceScale.value);
  return normalizeDeviceScale(parsed, getSelectedDeviceMode());
}

export function setDeviceControlsDisabled(disabled) {
  if (ui.deviceEmulationEnabled) {
    ui.deviceEmulationEnabled.disabled = disabled;
  }
  setDeviceModeInputsDisabled(disabled || !state.currentDeviceEmulationEnabled);
}
