import type { ConfigSnapshot } from "../config";
import { ConfigSnapshotSchema } from "../config";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const CONFIG_PREFIX = "config:";

export interface ConfigRepo {
  load(siteId: number): Promise<StorageReadResult<ConfigSnapshot>>;
  save(snapshot: ConfigSnapshot): Promise<void>;
  clear(siteId: number): Promise<void>;
}

function keyFor(siteId: number): string {
  return `${CONFIG_PREFIX}${siteId}`;
}

export function createConfigRepo(store: KeyValueStore): ConfigRepo {
  return {
    async load(siteId) {
      const parsed = parseStoredValue(ConfigSnapshotSchema, await store.get(keyFor(siteId)));
      if (parsed.ok && parsed.value && parsed.value.siteId !== siteId) {
        return invalidStoredValue("Stored config does not match requested siteId");
      }
      return parsed;
    },
    async save(snapshot) {
      const parsed = ConfigSnapshotSchema.parse(snapshot);
      if (parsed.siteId === null) {
        throw new Error("Config snapshots must have siteId before storage");
      }
      await store.set(keyFor(parsed.siteId), parsed);
    },
    async clear(siteId) {
      await store.remove(keyFor(siteId));
    },
  };
}
