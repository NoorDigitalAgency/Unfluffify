import { DEVICE_SCALE_DEFAULTS } from "./constants.js";

export const state = {
  currentTab: null,
  currentBaseUrl: "",
  currentConfig: null,
  toastTimer: 0,
  refreshTimer: 0,
  baseUrlEditMode: false,
  endpointEditMode: false,
  aiRequestInFlight: null,
  configMenuOpen: false,
  currentDeviceMode: "desktop",
  currentDeviceScale: DEVICE_SCALE_DEFAULTS.desktop,
  currentDeviceEmulationEnabled: false,
  currentDraftEntry: null,
  currentDraftDirty: false,
  currentDraftAvailable: false,
  currentDraftHasEntry: false
};
