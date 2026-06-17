// @ts-nocheck
import { AI_RUN_PERSIST_KEY, normalizePersistedAiRunRecord } from "../popup/ai-run.js";
import { storageGet, storageRemove, storageSet } from "../common/storage-core.js";

export async function getPersistedAiRunRecord() {
  const stored = await storageGet(chrome.storage.session, AI_RUN_PERSIST_KEY);
  return normalizePersistedAiRunRecord(stored && stored[AI_RUN_PERSIST_KEY]);
}

export async function savePersistedAiRunRecord(record) {
  const normalized = normalizePersistedAiRunRecord(record);
  if (!normalized) {
    await storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
    return null;
  }
  await storageSet(chrome.storage.session, {
    [AI_RUN_PERSIST_KEY]: normalized
  });
  return normalized;
}

export async function clearPersistedAiRunRecord() {
  await storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
}