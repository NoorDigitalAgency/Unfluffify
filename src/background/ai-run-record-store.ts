import { browser } from "../common/browser";
import { AI_RUN_PERSIST_KEY, normalizePersistedAiRunRecord } from "../popup/ai-run";
import { storageGet, storageRemove, storageSet } from "../common/storage-core";

type StorageHost = typeof globalThis & {
  browser?: { storage?: { session?: unknown } };
  chrome?: { storage?: { session?: unknown } };
};

function getSessionStorageArea(): unknown {
  const host = globalThis as StorageHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

export async function getPersistedAiRunRecord(): Promise<unknown> {
  const stored = await storageGet(getSessionStorageArea(), AI_RUN_PERSIST_KEY);
  return normalizePersistedAiRunRecord(stored && stored[AI_RUN_PERSIST_KEY]);
}

export async function savePersistedAiRunRecord(record: unknown): Promise<unknown | null> {
  const normalized = normalizePersistedAiRunRecord(record);
  if (!normalized) {
    await storageRemove(getSessionStorageArea(), AI_RUN_PERSIST_KEY);
    return null;
  }
  await storageSet(getSessionStorageArea(), {
    [AI_RUN_PERSIST_KEY]: normalized
  });
  return normalized;
}

export async function clearPersistedAiRunRecord() {
  await storageRemove(getSessionStorageArea(), AI_RUN_PERSIST_KEY);
}