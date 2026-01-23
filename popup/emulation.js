import * as commonEmulation from "../common/emulation.js";
import * as uiModule from "./ui.js";
import * as stateModule from "./state.js";

const { ui } = uiModule;
const { state } = stateModule;

export const getDeviceEmulationState = commonEmulation.getDeviceEmulationState;

export function updateDeviceEmulationUi(stateValue) {
  const normalized = commonEmulation.normalizeDeviceEmulationStateForUi(stateValue);
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
  return commonEmulation.normalizeDeviceEmulationStateForUi({
    enabled: true,
    mode: getSelectedDeviceMode(),
    scale: parsed
  }).scale;
}

export function setDeviceControlsDisabled(disabled) {
  if (ui.deviceEmulationEnabled) {
    ui.deviceEmulationEnabled.disabled = disabled;
  }
  setDeviceModeInputsDisabled(disabled || !state.currentDeviceEmulationEnabled);
}
