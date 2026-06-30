import { browser } from "../../common/browser";
import { storageGet, storageSet } from "../../common/storage-core";
import type { TabLayerState } from "./state-store";

const STORAGE_KEY = "brain:state-store";

type StorageHost = typeof globalThis & {
  browser?: { storage?: { session?: unknown } };
  chrome?: { storage?: { session?: unknown } };
};

function getSessionStorageArea(): unknown {
  const host = globalThis as StorageHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

export function serializeTabStates(states: Map<number, TabLayerState>): string {
  const obj: Record<string, TabLayerState> = {};
  for (const [tabId, state] of states) {
    obj[String(tabId)] = state;
  }
  return JSON.stringify(obj);
}

export function deserializeTabStates(serialized: unknown): Map<number, TabLayerState> {
  if (!serialized || typeof serialized !== "string") {
    return new Map();
  }
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") {
      return new Map();
    }
    const map = new Map<number, TabLayerState>();
    for (const [key, value] of Object.entries(parsed)) {
      const tabId = Number(key);
      if (Number.isFinite(tabId) && tabId > 0 && value && typeof value === "object") {
        map.set(tabId, value as TabLayerState);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function persistTabStates(states: Map<number, TabLayerState>): Promise<void> {
  try {
    const serialized = serializeTabStates(states);
    await storageSet(getSessionStorageArea(), { [STORAGE_KEY]: serialized });
  } catch {
    // Persistence failures must never break the brain.
  }
}

export async function loadPersistedTabStates(): Promise<Map<number, TabLayerState>> {
  try {
    const result = await storageGet(getSessionStorageArea(), STORAGE_KEY);
    return deserializeTabStates(result && result[STORAGE_KEY]);
  } catch {
    return new Map();
  }
}

export const BRAIN_STATE_STORAGE_KEY = STORAGE_KEY;
