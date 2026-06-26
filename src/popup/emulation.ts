import * as commonEmulation from "../common/emulation";
import * as stateModule from "./state";
import * as uiModule from "./ui";

const { state } = stateModule;

export const getDeviceEmulationState = commonEmulation.getDeviceEmulationState;
export const hasStoredDeviceEmulationState = commonEmulation.hasStoredDeviceEmulationState;
export const reconcileDeviceEmulationState = commonEmulation.reconcileDeviceEmulationState;

export function syncDeviceEmulationState(stateValue: unknown): {
  enabled: boolean;
  mode: string;
  scale: number;
} {
  const normalized = commonEmulation.normalizeDeviceEmulationStateForUi(stateValue);
  state.currentDeviceMode = normalized.mode;
  state.currentDeviceScale = normalized.scale;
  state.currentDeviceEmulationEnabled = normalized.enabled;
  return normalized;
}

export function setDeviceControlsDisabled(disabled: boolean): void {
  state.deviceControlsDisabled = disabled;
  uiModule.setViewState({ deviceControlsDisabled: disabled });
}
