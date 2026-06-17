// @ts-nocheck
import { storageGet, storageSet } from "./storage-core.js";
import { normalizeStageBase } from "./lynx-live-pages.js";

const GLOBAL_AI_SETTINGS_SYNC_DEFAULTS = {
  globalToken: "",
  globalEndpoint: "",
  globalConfigEndpoint: "",
  globalStageBase: ""
};
const GLOBAL_THEME_SETTINGS_SYNC_DEFAULTS = {
  globalTheme: "",
  globalThemeMode: ""
};

let cachedGlobalAiSettings = null;
let syncChangeListenerInstalled = false;

function normalizeStringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStoredTokenValue(value) {
  return typeof value === "string" ? value : "";
}

function getEndpointOrigin(value) {
  const normalized = normalizeStringValue(value);
  if (!normalized) {
    return "";
  }
  try {
    return new URL(normalized).origin.toLowerCase();
  } catch {
    return "";
  }
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

function updateCachedGlobalAiSettings(patch = {}) {
  if (!cachedGlobalAiSettings || typeof cachedGlobalAiSettings !== "object") {
    return;
  }
  cachedGlobalAiSettings = {
    ...cachedGlobalAiSettings,
    ...patch
  };
}

async function getGlobalSettingsWriteSnapshot() {
  const stored = await storageGet(chrome.storage.sync, GLOBAL_AI_SETTINGS_SYNC_DEFAULTS);
  return {
    tokenValue: normalizeStoredTokenValue(stored && stored.globalToken),
    endpointValue: normalizeStringValue(stored && stored.globalEndpoint),
    configEndpointValue: normalizeStringValue(stored && stored.globalConfigEndpoint),
    stageBaseValue: normalizeStringValue(stored && stored.globalStageBase)
  };
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

export async function getGlobalToken(options = {}) {
  if (options.trim) {
    const settings = await getGlobalAiSettings(options);
    return settings.tokenValue;
  }
  const stored = await storageGet(chrome.storage.sync, { globalToken: "" });
  return normalizeStoredTokenValue(stored && stored.globalToken);
}

export async function setGlobalToken(tokenValue) {
  const nextToken = normalizeStoredTokenValue(tokenValue);
  await storageSet(chrome.storage.sync, { globalToken: nextToken });
  updateCachedGlobalAiSettings({ tokenValue: nextToken.trim() });
  return nextToken;
}

export async function clearGlobalToken() {
  await setGlobalToken("");
}

export async function saveLoginSettings(options = {}) {
  const stageBaseValue = normalizeStringValue(options.stageBase);
  const tokenValue = normalizeStoredTokenValue(options.token);
  await storageSet(chrome.storage.sync, {
    globalStageBase: stageBaseValue,
    globalToken: tokenValue
  });
  updateCachedGlobalAiSettings({
    stageBaseValue,
    tokenValue: tokenValue.trim()
  });
  return {
    stageBaseValue,
    tokenValue
  };
}

export async function saveGlobalConfigEndpoint(endpointValue) {
  const nextEndpointValue = normalizeStringValue(endpointValue);
  const stored = await getGlobalSettingsWriteSnapshot();
  const previousEndpoint = stored.configEndpointValue;
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(nextEndpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(nextEndpointValue);
  const tokenCleared = Boolean(stored.tokenValue) && endpointOriginChanged;
  const nextTokenValue = tokenCleared ? "" : stored.tokenValue;
  await storageSet(chrome.storage.sync, {
    globalConfigEndpoint: nextEndpointValue,
    globalToken: nextTokenValue
  });
  updateCachedGlobalAiSettings({
    configEndpointValue: nextEndpointValue,
    tokenValue: nextTokenValue.trim()
  });
  return {
    tokenCleared,
    previousEndpoint,
    endpointValue: nextEndpointValue
  };
}

export async function saveGlobalEndpoint(endpointValue) {
  const nextEndpointValue = normalizeStringValue(endpointValue);
  const stored = await getGlobalSettingsWriteSnapshot();
  const previousEndpoint = stored.endpointValue;
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(nextEndpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(nextEndpointValue);
  const tokenCleared = Boolean(stored.tokenValue) && endpointOriginChanged;
  const nextTokenValue = tokenCleared ? "" : stored.tokenValue;
  await storageSet(chrome.storage.sync, {
    globalEndpoint: nextEndpointValue,
    globalToken: nextTokenValue
  });
  updateCachedGlobalAiSettings({
    endpointValue: nextEndpointValue,
    tokenValue: nextTokenValue.trim()
  });
  return {
    tokenCleared,
    previousEndpoint,
    endpointValue: nextEndpointValue
  };
}

export async function saveGlobalStageBase(stageBaseValue) {
  const nextStageBaseValue = normalizeStageBase(stageBaseValue);
  const stored = await getGlobalSettingsWriteSnapshot();
  const previousStageBase = normalizeStageBase(stored.stageBaseValue);
  const tokenCleared = Boolean(stored.tokenValue) && previousStageBase !== nextStageBaseValue;
  const nextTokenValue = tokenCleared ? "" : stored.tokenValue;
  await storageSet(chrome.storage.sync, {
    globalStageBase: nextStageBaseValue,
    globalToken: nextTokenValue
  });
  updateCachedGlobalAiSettings({
    stageBaseValue: nextStageBaseValue,
    tokenValue: nextTokenValue.trim()
  });
  return {
    tokenCleared,
    previousStageBase,
    stageBaseValue: nextStageBaseValue
  };
}

export async function getThemeSettings(options = {}) {
  const normalizeThemeValue =
    typeof options.normalizeThemeValue === "function"
      ? options.normalizeThemeValue
      : (value) => normalizeStringValue(value);
  const normalizeThemeModeValue =
    typeof options.normalizeThemeModeValue === "function"
      ? options.normalizeThemeModeValue
      : (value) => normalizeStringValue(value);
  const stored = await storageGet(chrome.storage.sync, GLOBAL_THEME_SETTINGS_SYNC_DEFAULTS);
  return {
    themeValue: normalizeThemeValue(stored && stored.globalTheme),
    themeModeValue: normalizeThemeModeValue(stored && stored.globalThemeMode)
  };
}

export async function setThemeSettings(themeValue, themeModeValue, options = {}) {
  const normalizeThemeValue =
    typeof options.normalizeThemeValue === "function"
      ? options.normalizeThemeValue
      : (value) => normalizeStringValue(value);
  const normalizeThemeModeValue =
    typeof options.normalizeThemeModeValue === "function"
      ? options.normalizeThemeModeValue
      : (value) => normalizeStringValue(value);
  const nextThemeValue = normalizeThemeValue(themeValue);
  const nextThemeModeValue = normalizeThemeModeValue(themeModeValue);
  await storageSet(chrome.storage.sync, {
    globalTheme: nextThemeValue,
    globalThemeMode: nextThemeModeValue
  });
  return {
    themeValue: nextThemeValue,
    themeModeValue: nextThemeModeValue
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
