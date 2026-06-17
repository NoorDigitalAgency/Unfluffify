// @ts-nocheck
import * as commonEmulation from "../common/emulation.js";
import * as stateModule from "./state.js";
import * as uiModule from "./ui.js";

const { state } = stateModule;

export const getDeviceEmulationState = commonEmulation.getDeviceEmulationState;
export const hasStoredDeviceEmulationState = commonEmulation.hasStoredDeviceEmulationState;
export const reconcileDeviceEmulationState = commonEmulation.reconcileDeviceEmulationState;

export function syncDeviceEmulationState(stateValue) {
  const normalized = commonEmulation.normalizeDeviceEmulationStateForUi(stateValue);
  state.currentDeviceMode = normalized.mode;
  state.currentDeviceScale = normalized.scale;
  state.currentDeviceEmulationEnabled = normalized.enabled;
  return normalized;
}

export function setDeviceControlsDisabled(disabled) {
  state.deviceControlsDisabled = disabled;
  uiModule.setViewState({ deviceControlsDisabled: disabled });
}
