import { browser } from "../../common/browser";
import { storageGet, storageSet } from "../../common/storage-core";

const STORAGE_KEY = "brain:signal-log";

type StorageHost = typeof globalThis & {
  browser?: { storage?: { session?: unknown } };
  chrome?: { storage?: { session?: unknown } };
};

function getSessionStorageArea(): unknown {
  const host = globalThis as StorageHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

export async function persistSignalLog(serialized: unknown): Promise<void> {
  try {
    await storageSet(getSessionStorageArea(), { [STORAGE_KEY]: JSON.stringify(serialized) });
  } catch {
    // Persistence failures must never break signal admission.
  }
}

export async function loadPersistedSignalLog(): Promise<unknown> {
  try {
    const result = await storageGet(getSessionStorageArea(), STORAGE_KEY);
    const raw = result && result[STORAGE_KEY];
    return typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const BRAIN_SIGNAL_LOG_STORAGE_KEY = STORAGE_KEY;
