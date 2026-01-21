export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const DEVICE_MODE_PREFIX = "deviceEmulation:";
export const PAGE_PATTERN_DRAFT_PREFIX = "pagePatternDraft:";
export const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85
};
export const DEVICE_SCALE_LIMITS = {
  min: 0.25,
  max: 1,
  step: 0.01
};

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
