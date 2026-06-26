import { browser } from "../common/browser";
import { SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX } from "../common/constants";
import { storageGet, storageRemove, storageSet } from "../common/storage-core";

type TabSessionState = Record<string, unknown> | null;
type QueueableWork<T> = () => Promise<T> | T;
type TabSessionOptions = {
  normalize?: boolean;
  skipQueue?: boolean;
  includeRestoreScope?: boolean;
  includeScriptInjected?: boolean;
};

type StorageHost = typeof globalThis & {
  browser?: { storage?: { session?: unknown } };
  chrome?: { storage?: { session?: unknown } };
};

const TAB_SESSION_WRITE_QUEUE_BY_TAB_ID = new Map<number, Promise<unknown>>();

function getSessionStorageArea(): unknown {
  const host = globalThis as StorageHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

function normalizeTabId(tabId: unknown): number {
  const normalized = Number(tabId);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const truncated = Math.trunc(normalized);
  return truncated > 0 ? truncated : 0;
}

function normalizePathForMatch(pathname: unknown): string {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function normalizeTabStateBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  const rawHostname = (parsed.hostname || "").toLowerCase();
  const hostname = rawHostname.startsWith("www.") && rawHostname.length > 4
    ? rawHostname.slice(4)
    : rawHostname;
  if (!hostname) {
    return "";
  }
  const pathname = normalizePathForMatch(parsed.pathname);
  return `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
}

export function getTabStateKey(tabId: unknown, scope: string | null = null): string {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return "";
  }
  const normalizedScope = typeof scope === "string" && scope ? `${scope}:` : "";
  return `${TAB_STATE_PREFIX}${normalizedScope}${normalizedTabId}`;
}

export function getScriptInjectedKey(tabId: unknown): string {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return "";
  }
  return `${SCRIPT_INJECTED_PREFIX}${normalizedTabId}`;
}

export function parseTabStateStorageKey(key: unknown): { tabId: number; scope: string | null } | null {
  if (typeof key !== "string" || !key.startsWith(TAB_STATE_PREFIX)) {
    return null;
  }
  const suffix = key.slice(TAB_STATE_PREFIX.length);
  if (!suffix) {
    return null;
  }
  const separatorIndex = suffix.indexOf(":");
  const scope = separatorIndex > -1 ? suffix.slice(0, separatorIndex) : null;
  const tabIdPart = separatorIndex > -1 ? suffix.slice(separatorIndex + 1) : suffix;
  const tabId = normalizeTabId(tabIdPart);
  if (!tabId) {
    return null;
  }
  return {
    tabId,
    scope: scope || null
  };
}

export function normalizeTabSessionState(value: TabSessionState): TabSessionState {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (typeof value.baseUrl !== "string") {
    return value;
  }
  const normalizedBaseUrl = normalizeTabStateBaseUrl(value.baseUrl);
  if (!normalizedBaseUrl && value.baseUrl !== "") {
    return value;
  }
  if (normalizedBaseUrl === value.baseUrl) {
    return value;
  }
  return {
    ...value,
    baseUrl: normalizedBaseUrl
  };
}

export function queueTabSessionWrite<T>(tabId: unknown, work: QueueableWork<T>): Promise<T | null> {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId || typeof work !== "function") {
    return Promise.resolve(null);
  }
  const previous = TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.get(normalizedTabId) || Promise.resolve<unknown>(undefined);
  const queued = previous
    .catch(() => {})
    .then(() => work());
  const settled = queued.finally(() => {
    if (TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.get(normalizedTabId) === settled) {
      TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.delete(normalizedTabId);
    }
  });
  TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.set(normalizedTabId, settled);
  return settled as Promise<T | null>;
}

export async function getTabState(tabId: unknown, scope: string | null = null, options: TabSessionOptions = {}): Promise<TabSessionState> {
  const key = getTabStateKey(tabId, scope);
  if (!key) {
    return null;
  }
  const useNormalization = options && options.normalize !== false;
  const result = await storageGet(getSessionStorageArea(), key);
  const value = (result[key] as TabSessionState) || null;
  return useNormalization ? normalizeTabSessionState(value) : value;
}

export async function setTabState(
  tabId: unknown,
  state: TabSessionState,
  scope: string | null = null,
  options: TabSessionOptions = {}
): Promise<void> {
  const key = getTabStateKey(tabId, scope);
  if (!key) {
    return;
  }
  const normalizedState = normalizeTabSessionState(state);
  if (options && options.skipQueue) {
    await storageSet(getSessionStorageArea(), { [key]: normalizedState });
    return;
  }
  await queueTabSessionWrite(tabId, () => storageSet(getSessionStorageArea(), { [key]: normalizedState }));
}

export async function clearTabState(tabId: unknown, options: TabSessionOptions = {}): Promise<void> {
  const includeRestoreScope = Boolean(options && options.includeRestoreScope);
  const keys = [
    getTabStateKey(tabId),
    getTabStateKey(tabId, "initial")
  ];
  if (includeRestoreScope) {
    keys.push(getTabStateKey(tabId, "restore"));
  }
  const keysToRemove = keys.filter((key) => key);
  if (!keysToRemove.length) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(getSessionStorageArea(), keysToRemove));
}

export async function clearTabStateScope(tabId: unknown, scope: string | null = null): Promise<void> {
  const key = getTabStateKey(tabId, scope);
  if (!key) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(getSessionStorageArea(), key));
}

export async function isScriptInjected(tabId: unknown): Promise<boolean> {
  const key = getScriptInjectedKey(tabId);
  if (!key) {
    return false;
  }
  const result = await storageGet(getSessionStorageArea(), key);
  return Boolean(result[key]);
}

export async function setScriptInjected(tabId: unknown, injected: unknown): Promise<void> {
  const key = getScriptInjectedKey(tabId);
  if (!key) {
    return;
  }
  if (injected) {
    await queueTabSessionWrite(tabId, () => storageSet(getSessionStorageArea(), { [key]: true }));
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(getSessionStorageArea(), key));
}

export async function clearScriptInjected(tabId: unknown): Promise<void> {
  const key = getScriptInjectedKey(tabId);
  if (!key) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(getSessionStorageArea(), key));
}

export async function clearTrackedTabSessionState(tabId: unknown, options: TabSessionOptions = {}): Promise<void> {
  const includeScriptInjected = options.includeScriptInjected !== false;
  const includeRestoreScope = Boolean(options.includeRestoreScope);
  const keys = [
    getTabStateKey(tabId),
    getTabStateKey(tabId, "initial")
  ];
  if (includeRestoreScope) {
    keys.push(getTabStateKey(tabId, "restore"));
  }
  if (includeScriptInjected) {
    keys.push(getScriptInjectedKey(tabId));
  }
  const keysToRemove = keys.filter((key) => key);
  if (!keysToRemove.length) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(getSessionStorageArea(), keysToRemove));
}
