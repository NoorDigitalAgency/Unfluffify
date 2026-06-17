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

let cachedGlobalAiSettings: GlobalAiSettings | null = null;
let syncChangeListenerInstalled = false;

type GlobalAiSettings = {
  tokenValue: string;
  endpointValue: string;
  configEndpointValue: string;
  stageBaseValue: string;
};

type GlobalSettingsWriteSnapshot = {
  tokenValue: string;
  endpointValue: string;
  configEndpointValue: string;
  stageBaseValue: string;
};

type GlobalAiSettingsOptions = {
  useCache?: boolean;
};

type ThemeSettingsOptions = {
  normalizeThemeValue?: (value: unknown) => string;
  normalizeThemeModeValue?: (value: unknown) => string;
};

type SaveLoginSettingsOptions = {
  stageBase?: unknown;
  token?: unknown;
};

type SyncAiStoredValues = {
  globalToken?: unknown;
  globalEndpoint?: unknown;
  globalConfigEndpoint?: unknown;
  globalStageBase?: unknown;
};

type SyncThemeStoredValues = {
  globalTheme?: unknown;
  globalThemeMode?: unknown;
};

function normalizeStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStoredTokenValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getEndpointOrigin(value: unknown): string {
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

function normalizeGlobalAiSettings(stored: unknown): GlobalAiSettings {
  const normalized = stored && typeof stored === "object" ? stored : {};
  return {
    tokenValue: normalizeStringValue((normalized as Record<string, unknown>).globalToken),
    endpointValue: normalizeStringValue((normalized as Record<string, unknown>).globalEndpoint),
    configEndpointValue: normalizeStringValue((normalized as Record<string, unknown>).globalConfigEndpoint),
    stageBaseValue: normalizeStringValue((normalized as Record<string, unknown>).globalStageBase)
  };
}

function hasRelevantSyncSettingsChange(changes: unknown): boolean {
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

function updateCachedGlobalAiSettings(patch: Partial<GlobalAiSettings> = {}): void {
  if (!cachedGlobalAiSettings || typeof cachedGlobalAiSettings !== "object") {
    return;
  }
  cachedGlobalAiSettings = {
    ...cachedGlobalAiSettings,
    ...patch
  };
}

async function getGlobalSettingsWriteSnapshot(): Promise<GlobalSettingsWriteSnapshot> {
  const stored = (await storageGet(
    chrome.storage.sync,
    GLOBAL_AI_SETTINGS_SYNC_DEFAULTS as unknown as Record<string, unknown>
  )) as SyncAiStoredValues;
  return {
    tokenValue: normalizeStoredTokenValue(stored.globalToken),
    endpointValue: normalizeStringValue(stored.globalEndpoint),
    configEndpointValue: normalizeStringValue(stored.globalConfigEndpoint),
    stageBaseValue: normalizeStringValue(stored.globalStageBase)
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

export function invalidateSettingsCache(): void {
  cachedGlobalAiSettings = null;
}

export async function getGlobalAiSettings(options: GlobalAiSettingsOptions = {}): Promise<GlobalAiSettings> {
  const useCache = Boolean(options.useCache);
  if (useCache) {
    installSyncSettingsCacheInvalidationListener();
    if (cachedGlobalAiSettings) {
      return { ...cachedGlobalAiSettings };
    }
  }

  const stored = (await storageGet(
    chrome.storage.sync,
    GLOBAL_AI_SETTINGS_SYNC_DEFAULTS as unknown as Record<string, unknown>
  )) as SyncAiStoredValues;
  const normalized = normalizeGlobalAiSettings(stored);
  if (useCache) {
    cachedGlobalAiSettings = { ...normalized };
  }
  return normalized;
}

export async function getPropertyLockConnectionSettings(
  options: GlobalAiSettingsOptions = {}
): Promise<{ endpointBase: string; tokenValue: string }> {
  const settings = await getGlobalAiSettings(options);
  return {
    endpointBase: settings.configEndpointValue || settings.stageBaseValue || "",
    tokenValue: settings.tokenValue
  };
}

export async function getGlobalToken(options: { trim?: boolean } = {}): Promise<string> {
  if (options.trim) {
    const settings = await getGlobalAiSettings({ useCache: false });
    return settings.tokenValue;
  }
  const stored = (await storageGet(
    chrome.storage.sync,
    { globalToken: "" } as unknown as Record<string, unknown>
  )) as SyncAiStoredValues;
  return normalizeStoredTokenValue(stored.globalToken);
}

export async function setGlobalToken(tokenValue: unknown): Promise<string> {
  const nextToken = normalizeStoredTokenValue(tokenValue);
  await storageSet(chrome.storage.sync, { globalToken: nextToken });
  updateCachedGlobalAiSettings({ tokenValue: nextToken.trim() });
  return nextToken;
}

export async function clearGlobalToken(): Promise<void> {
  await setGlobalToken("");
}

export async function saveLoginSettings(
  options: SaveLoginSettingsOptions = {}
): Promise<{ stageBaseValue: string; tokenValue: string }> {
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

export async function saveGlobalConfigEndpoint(endpointValue: unknown): Promise<{
  tokenCleared: boolean;
  previousEndpoint: string;
  endpointValue: string;
}> {
  const nextEndpointValue = normalizeStringValue(endpointValue);
  const stored = await getGlobalSettingsWriteSnapshot();
  const previousEndpoint = stored.configEndpointValue;
  const endpointOriginChanged =
    Boolean(getEndpointOrigin(previousEndpoint)) &&
    Boolean(getEndpointOrigin(nextEndpointValue)) &&
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

export async function saveGlobalEndpoint(endpointValue: unknown): Promise<{
  tokenCleared: boolean;
  previousEndpoint: string;
  endpointValue: string;
}> {
  const nextEndpointValue = normalizeStringValue(endpointValue);
  const stored = await getGlobalSettingsWriteSnapshot();
  const previousEndpoint = stored.endpointValue;
  const endpointOriginChanged =
    Boolean(getEndpointOrigin(previousEndpoint)) &&
    Boolean(getEndpointOrigin(nextEndpointValue)) &&
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

export async function saveGlobalStageBase(stageBaseValue: unknown): Promise<{
  tokenCleared: boolean;
  previousStageBase: string;
  stageBaseValue: string;
}> {
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

export async function getThemeSettings(
  options: ThemeSettingsOptions = {}
): Promise<{ themeValue: string; themeModeValue: string }> {
  const normalizeThemeValue =
    typeof options.normalizeThemeValue === "function"
      ? options.normalizeThemeValue
      : (value: unknown) => normalizeStringValue(value);
  const normalizeThemeModeValue =
    typeof options.normalizeThemeModeValue === "function"
      ? options.normalizeThemeModeValue
      : (value: unknown) => normalizeStringValue(value);
  const stored = (await storageGet(
    chrome.storage.sync,
    GLOBAL_THEME_SETTINGS_SYNC_DEFAULTS as unknown as Record<string, unknown>
  )) as SyncThemeStoredValues;
  return {
    themeValue: normalizeThemeValue(stored.globalTheme),
    themeModeValue: normalizeThemeModeValue(stored.globalThemeMode)
  };
}

export async function setThemeSettings(
  themeValue: unknown,
  themeModeValue: unknown,
  options: ThemeSettingsOptions = {}
): Promise<{ themeValue: string; themeModeValue: string }> {
  const normalizeThemeValue =
    typeof options.normalizeThemeValue === "function"
      ? options.normalizeThemeValue
      : (value: unknown) => normalizeStringValue(value);
  const normalizeThemeModeValue =
    typeof options.normalizeThemeModeValue === "function"
      ? options.normalizeThemeModeValue
      : (value: unknown) => normalizeStringValue(value);
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

export function summarizeGlobalAiSettingsForLog(settings: unknown): {
  tokenValue: string;
  endpointValue: string;
  configEndpointValue: string;
  stageBaseValue: string;
} {
  const normalized = (settings && typeof settings === "object"
    ? settings
    : {}) as Partial<GlobalAiSettings>;
  return {
    tokenValue: normalizeStringValue(normalized.tokenValue) ? "[redacted]" : "",
    endpointValue: normalizeStringValue(normalized.endpointValue),
    configEndpointValue: normalizeStringValue(normalized.configEndpointValue),
    stageBaseValue: normalizeStringValue(normalized.stageBaseValue)
  };
}
