import { z } from "zod";

import { TAB_STATE_PREFIX } from "../../domain/constants";
import { TabFactsSchema } from "../../domain/schema/facts";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

export const TabStateRecordSchema = z.object({
  tabId: z.number().int().nonnegative(),
  facts: TabFactsSchema,
  updatedAt: z.number().int().nonnegative(),
});

export type TabStateRecord = z.infer<typeof TabStateRecordSchema>;

export interface TabStateRepo {
  load(tabId: number): Promise<StorageReadResult<TabStateRecord>>;
  save(record: TabStateRecord): Promise<void>;
  clear(tabId: number): Promise<void>;
}

function keyFor(tabId: number): string {
  return `${TAB_STATE_PREFIX}${tabId}`;
}

export function createTabStateRepo(store: KeyValueStore): TabStateRepo {
  return {
    async load(tabId) {
      const parsed = parseStoredValue(TabStateRecordSchema, await store.get(keyFor(tabId)));
      if (parsed.ok && parsed.value && parsed.value.tabId !== tabId) {
        return invalidStoredValue("Stored tab state does not match requested tabId");
      }
      return parsed;
    },
    async save(record) {
      await store.set(keyFor(record.tabId), TabStateRecordSchema.parse(record));
    },
    async clear(tabId) {
      await store.remove(keyFor(tabId));
    },
  };
}
