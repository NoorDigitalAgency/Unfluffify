import { z } from "zod";

import { SiteIdSchema } from "../../domain/schema/property";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const LOCK_IDENTITY_PREFIX = "lockIdentity:";

export const LockIdentityRecordSchema = z.object({
  tabId: z.number().int().nonnegative(),
  siteId: SiteIdSchema,
  identity: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type LockIdentityRecord = z.infer<typeof LockIdentityRecordSchema>;

export interface LockIdentityRepo {
  load(tabId: number, siteId: number): Promise<StorageReadResult<LockIdentityRecord>>;
  save(record: LockIdentityRecord): Promise<void>;
  clear(tabId: number, siteId: number): Promise<void>;
}

function keyFor(tabId: number, siteId: number): string {
  return `${LOCK_IDENTITY_PREFIX}${tabId}:${siteId}`;
}

export function createLockIdentityRepo(store: KeyValueStore): LockIdentityRepo {
  return {
    async load(tabId, siteId) {
      const parsed = parseStoredValue(LockIdentityRecordSchema, await store.get(keyFor(tabId, siteId)));
      if (
        parsed.ok &&
        parsed.value &&
        (parsed.value.tabId !== tabId || parsed.value.siteId !== siteId)
      ) {
        return invalidStoredValue("Stored lock identity does not match requested tabId/siteId");
      }
      return parsed;
    },
    async save(record) {
      await store.set(keyFor(record.tabId, record.siteId), LockIdentityRecordSchema.parse(record));
    },
    async clear(tabId, siteId) {
      await store.remove(keyFor(tabId, siteId));
    },
  };
}
