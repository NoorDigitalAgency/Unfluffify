import type { ConfigSnapshot } from "../config";
import { ConfigSnapshotSchema } from "../config";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const CONFIG_PREFIX = "config:";

export interface ConfigRepo {
  load(environmentKey: string, siteId: number): Promise<StorageReadResult<ConfigSnapshot>>;
  save(snapshot: ConfigSnapshot): Promise<void>;
  clear(environmentKey: string, siteId: number): Promise<void>;
}

function keyFor(environmentKey: string, siteId: number): string {
  return `${CONFIG_PREFIX}${environmentKey.trim().toLowerCase()}:${siteId}`;
}

export function createConfigRepo(store: KeyValueStore): ConfigRepo {
  return {
    async load(environmentKey, siteId) {
      const parsed = parseStoredValue(ConfigSnapshotSchema, await store.get(keyFor(environmentKey, siteId)));
      if (parsed.ok && parsed.value && (
        parsed.value.siteId !== siteId ||
        parsed.value.environmentKey !== environmentKey.trim().toLowerCase()
      )) {
        return invalidStoredValue("Stored config does not match requested property scope");
      }
      return parsed;
    },
    async save(snapshot) {
      const parsed = ConfigSnapshotSchema.parse(snapshot);
      await store.set(keyFor(parsed.environmentKey, parsed.siteId), parsed);
    },
    async clear(environmentKey, siteId) {
      await store.remove(keyFor(environmentKey, siteId));
    },
  };
}
