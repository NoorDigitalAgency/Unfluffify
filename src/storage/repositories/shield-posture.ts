import { z } from "zod";

import {
  ShieldDocumentPostureSchema,
  ShieldPropertyScopeSchema,
} from "../../messaging/shield-posture";
import { SelectorSetSchema } from "../config";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const SHIELD_POSTURE_PREFIX = "shieldPosture:";
const SHIELD_POSTURE_PROPERTY_PREFIX = "shieldPostureProperty:";

const ShieldPosturePropertyIndexSchema = z.object({
  version: z.literal(1),
  environmentKey: z.string().trim().min(1),
  siteId: z.number().int().positive(),
  tabIds: z.array(z.number().int().positive()),
});

export const ShieldAdoptedDocumentSchema = ShieldPropertyScopeSchema.extend({
  contextGeneration: z.number().int().positive(),
  pageUrl: z.string().url(),
  documentId: z.string().min(1),
});

export const ShieldPostureRecordSchema = z.object({
  version: z.literal(1),
  tabId: z.number().int().positive(),
  property: ShieldPropertyScopeSchema,
  adoptedDocument: ShieldAdoptedDocumentSchema.nullable(),
  revision: z.number().int().positive(),
  /** Defaults true only to migrate posture records written before P15 stored
   * config authority explicitly. A confirmed removal writes false and keeps
   * the monotonic fence alive across same-document reconfiguration. */
  configPresent: z.boolean().default(true),
  silentSelectors: SelectorSetSchema.nullable(),
  documentPosture: ShieldDocumentPostureSchema.nullable(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((record, context) => {
  if (!record.configPresent && (record.silentSelectors || record.documentPosture)) {
    context.addIssue({
      code: "custom",
      path: ["configPresent"],
      message: "A removed config cannot retain shield directives",
    });
  }
  if (record.documentPosture && !record.adoptedDocument) {
    context.addIssue({
      code: "custom",
      path: ["documentPosture"],
      message: "A document posture requires an adopted document",
    });
  }
  const adopted = record.adoptedDocument;
  if (adopted && (
    adopted.environmentKey !== record.property.environmentKey ||
    adopted.siteId !== record.property.siteId ||
    adopted.baseUrl !== record.property.baseUrl
  )) {
    context.addIssue({
      code: "custom",
      path: ["adoptedDocument"],
      message: "The adopted document must belong to the stored property",
    });
  }
});

export type ShieldAdoptedDocument = z.infer<typeof ShieldAdoptedDocumentSchema>;
export type ShieldPostureRecord = z.infer<typeof ShieldPostureRecordSchema>;

export interface ShieldPostureRepo {
  load(tabId: number): Promise<StorageReadResult<ShieldPostureRecord>>;
  save(record: ShieldPostureRecord): Promise<void>;
  clear(tabId: number): Promise<void>;
  clearPropertyPostures(environmentKey: string, siteId: number, updatedAt: number): Promise<number>;
  removePropertyPostures(environmentKey: string, siteId: number, updatedAt: number): Promise<number>;
  authorizePropertyPostures(environmentKey: string, siteId: number, updatedAt: number): Promise<number>;
}

function keyFor(tabId: number): string {
  return `${SHIELD_POSTURE_PREFIX}${tabId}`;
}

function normalizedEnvironmentKey(environmentKey: string): string {
  return environmentKey.trim().toLowerCase();
}

function propertyKeyFor(environmentKey: string, siteId: number): string {
  return `${SHIELD_POSTURE_PROPERTY_PREFIX}${encodeURIComponent(normalizedEnvironmentKey(environmentKey))}:${siteId}`;
}

export function createShieldPostureRepo(store: KeyValueStore): ShieldPostureRepo {
  let writes: Promise<unknown> = Promise.resolve();
  const withWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = writes.then(operation, operation);
    writes = queued.catch(() => undefined);
    return queued;
  };
  const updatePropertyIndex = async (
    environmentKey: string,
    siteId: number,
    update: (tabIds: Set<number>) => void,
  ): Promise<void> => {
    const key = propertyKeyFor(environmentKey, siteId);
    const parsed = parseStoredValue(ShieldPosturePropertyIndexSchema, await store.get(key));
    const tabIds = new Set(parsed.ok && parsed.value ? parsed.value.tabIds : []);
    update(tabIds);
    if (tabIds.size === 0) {
      await store.remove(key);
      return;
    }
    await store.set(key, ShieldPosturePropertyIndexSchema.parse({
      version: 1,
      environmentKey: normalizedEnvironmentKey(environmentKey),
      siteId,
      tabIds: [...tabIds].sort((left, right) => left - right),
    }));
  };
  return {
    async load(tabId) {
      const parsed = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(tabId)));
      if (parsed.ok && parsed.value && parsed.value.tabId !== tabId) {
        return invalidStoredValue("Stored shield posture does not match requested tabId");
      }
      return parsed;
    },
    async save(record) {
      const parsed = ShieldPostureRecordSchema.parse(record);
      await withWrite(async () => {
        const previous = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(parsed.tabId)));
        if (previous.ok && previous.value && (
          previous.value.property.environmentKey !== parsed.property.environmentKey ||
          previous.value.property.siteId !== parsed.property.siteId
        )) {
          await updatePropertyIndex(
            previous.value.property.environmentKey,
            previous.value.property.siteId,
            (tabIds) => tabIds.delete(parsed.tabId),
          );
        }
        await store.set(keyFor(parsed.tabId), parsed);
        await updatePropertyIndex(parsed.property.environmentKey, parsed.property.siteId, (tabIds) => {
          tabIds.add(parsed.tabId);
        });
      });
    },
    async clear(tabId) {
      await withWrite(async () => {
        const previous = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(tabId)));
        await store.remove(keyFor(tabId));
        if (previous.ok && previous.value) {
          await updatePropertyIndex(
            previous.value.property.environmentKey,
            previous.value.property.siteId,
            (tabIds) => tabIds.delete(tabId),
          );
        }
      });
    },
    async clearPropertyPostures(environmentKey, siteId, updatedAt) {
      return withWrite(async () => {
        const key = propertyKeyFor(environmentKey, siteId);
        const parsed = parseStoredValue(ShieldPosturePropertyIndexSchema, await store.get(key));
        const tabIds = parsed.ok && parsed.value ? parsed.value.tabIds : [];
        let cleared = 0;
        for (const tabId of tabIds) {
          const record = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(tabId)));
          if (!record.ok || !record.value) {
            await store.remove(keyFor(tabId));
            continue;
          }
          if (
            normalizedEnvironmentKey(record.value.property.environmentKey) === normalizedEnvironmentKey(environmentKey) &&
            record.value.property.siteId === siteId
          ) {
            await store.set(keyFor(tabId), ShieldPostureRecordSchema.parse({
              ...record.value,
              revision: record.value.revision + 1,
              configPresent: true,
              silentSelectors: null,
              documentPosture: null,
              updatedAt,
            }));
            cleared += 1;
          }
        }
        return cleared;
      });
    },
    async removePropertyPostures(environmentKey, siteId, updatedAt) {
      return withWrite(async () => {
        const key = propertyKeyFor(environmentKey, siteId);
        const parsed = parseStoredValue(ShieldPosturePropertyIndexSchema, await store.get(key));
        const tabIds = parsed.ok && parsed.value ? parsed.value.tabIds : [];
        let removed = 0;
        for (const tabId of tabIds) {
          const record = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(tabId)));
          if (
            record.ok &&
            record.value &&
            normalizedEnvironmentKey(record.value.property.environmentKey) === normalizedEnvironmentKey(environmentKey) &&
            record.value.property.siteId === siteId
          ) {
            await store.set(keyFor(tabId), ShieldPostureRecordSchema.parse({
              ...record.value,
              revision: record.value.revision + 1,
              configPresent: false,
              silentSelectors: null,
              documentPosture: null,
              updatedAt,
            }));
            removed += 1;
          }
        }
        return removed;
      });
    },
    async authorizePropertyPostures(environmentKey, siteId, updatedAt) {
      return withWrite(async () => {
        const key = propertyKeyFor(environmentKey, siteId);
        const parsed = parseStoredValue(ShieldPosturePropertyIndexSchema, await store.get(key));
        const tabIds = parsed.ok && parsed.value ? parsed.value.tabIds : [];
        let authorized = 0;
        for (const tabId of tabIds) {
          const record = parseStoredValue(ShieldPostureRecordSchema, await store.get(keyFor(tabId)));
          if (
            record.ok &&
            record.value &&
            !record.value.configPresent &&
            normalizedEnvironmentKey(record.value.property.environmentKey) === normalizedEnvironmentKey(environmentKey) &&
            record.value.property.siteId === siteId
          ) {
            await store.set(keyFor(tabId), ShieldPostureRecordSchema.parse({
              ...record.value,
              revision: record.value.revision + 1,
              configPresent: true,
              updatedAt,
            }));
            authorized += 1;
          }
        }
        return authorized;
      });
    },
  };
}
