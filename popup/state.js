import { DEVICE_SCALE_DEFAULTS } from "../common/constants.js";

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const DEVICE_SCALE_LIMITS = {
  min: 0.25,
  max: 1,
  step: 0.01
};

export const state = {
  currentView: "Marking",
  currentTab: null,
  currentBaseUrl: "",
  currentConfig: null,
  toastTimer: 0,
  refreshTimer: 0,
  lastTabId: null,
  baseUrlEditMode: false,
  endpointEditMode: false,
  configEndpointEditMode: false,
  loginEndpointEditMode: false,
  aiRequestInFlight: null,
  configMenuOpen: false,
  currentDeviceMode: "desktop",
  currentDeviceScale: DEVICE_SCALE_DEFAULTS.desktop,
  currentDeviceEmulationEnabled: false,
  deviceControlsDisabled: false,
  currentDraftEntry: null,
  currentSavedEntry: null,
  currentDraftDirty: false,
  currentDraftAvailable: false,
  currentDraftHasEntry: false,
  copySourceBaseUrl: "",
  copySourcePageUrl: "",
  clearDomainCacheDisabled: false,
  lastPopupPageUrl: "",
  lastPopupEnabled: null,
  selectorModifierBaseUrl: "",
  selectorModifierDraft: null,
  selectorModifierSaved: null,
  configViewLocked: false,
  tokenValidationInFlight: false,
  lastTokenValidationAt: 0,
  tokenValidationTimer: 0
};
