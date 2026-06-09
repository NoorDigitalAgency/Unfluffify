export const FEATURE_DISABLED_REASON = "feature_disabled";

export const FEATURE_FLAGS = Object.freeze({
  remoteSupport: false,
  desktopPreview: false,
  deviceEmulationToggle: false,
  traceDiagnostics: false,
  renderModeAutoDetection: false,
  appearanceCustomization: false,
  cacheAndUnregisterTools: false,
  propertyLockCollaboration: false,
  previewExpandedStates: false
});

export function isFeatureEnabled(flagName) {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, flagName) &&
    FEATURE_FLAGS[flagName] === true;
}

export function getFeatureFlags() {
  return Object.freeze({ ...FEATURE_FLAGS });
}
