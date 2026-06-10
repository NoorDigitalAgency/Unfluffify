import { storageGet } from "./storage-core.js";

const GLOBAL_AI_SETTINGS_SYNC_DEFAULTS = {
  globalToken: "",
  globalEndpoint: "",
  globalConfigEndpoint: "",
  globalStageBase: ""
};

let cachedGlobalAiSettings = null;
let syncChangeListenerInstalled = false;

function normalizeStringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeGlobalAiSettings(stored) {
  const normalized = stored && typeof stored === "object" ? stored : {};
  return {
    tokenValue: normalizeStringValue(normalized.globalToken),
    endpointValue: normalizeStringValue(normalized.globalEndpoint),
    configEndpointValue: normalizeStringValue(normalized.globalConfigEndpoint),
    stageBaseValue: normalizeStringValue(normalized.globalStageBase)
  };
}

function hasRelevantSyncSettingsChange(changes) {
  if (!changes || typeof changes !== "object") {
    return false;
  }
  return [
    "globalToken",
    "globalEndpoint",
    "globalConfigEndpoint",
    "globalStageBase"
  ].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}

function installSyncSettingsCacheInvalidationListener() {
  if (syncChangeListenerInstalled) {
    return;
  }
  if (!globalThis.chrome || !chrome.storage || !chrome.storage.onChanged) {
    return;
  }
  if (typeof chrome.storage.onChanged.addListener !== "function") {
    return;
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    if (!hasRelevantSyncSettingsChange(changes)) {
      return;
    }
    cachedGlobalAiSettings = null;
  });
  syncChangeListenerInstalled = true;
}

export function invalidateSettingsCache() {
  cachedGlobalAiSettings = null;
}

export async function getGlobalAiSettings(options = {}) {
  const useCache = Boolean(options.useCache);
  if (useCache) {
    installSyncSettingsCacheInvalidationListener();
    if (cachedGlobalAiSettings) {
      return { ...cachedGlobalAiSettings };
    }
  }

  const stored = await storageGet(chrome.storage.sync, GLOBAL_AI_SETTINGS_SYNC_DEFAULTS);
  const normalized = normalizeGlobalAiSettings(stored);
  if (useCache) {
    cachedGlobalAiSettings = { ...normalized };
  }
  return normalized;
}

export async function getPropertyLockConnectionSettings(options = {}) {
  const settings = await getGlobalAiSettings(options);
  return {
    endpointBase: settings.configEndpointValue || settings.stageBaseValue || "",
    tokenValue: settings.tokenValue
  };
}

export function summarizeGlobalAiSettingsForLog(settings) {
  const normalized = settings && typeof settings === "object" ? settings : {};
  return {
    tokenValue: normalizeStringValue(normalized.tokenValue) ? "[redacted]" : "",
    endpointValue: normalizeStringValue(normalized.endpointValue),
    configEndpointValue: normalizeStringValue(normalized.configEndpointValue),
    stageBaseValue: normalizeStringValue(normalized.stageBaseValue)
  };
}
