import { z } from "zod";

import type { KeyValueStore, StorageReadResult } from "./key-value";
import { parseStoredValue } from "./key-value";

const EMULATION_POSTURES_KEY = "uf:emulation-postures:v1";

export const EmulationPostureRecordSchema = z.object({
  tabId: z.number().int().positive(),
  mode: z.enum(["mobile", "desktop"]),
  maximumScale: z.number().finite().positive(),
  revision: z.number().int().nonnegative(),
});

const EmulationPostureEnvelopeSchema = z.object({
  version: z.literal(1),
  records: z.array(EmulationPostureRecordSchema),
});

export type EmulationPostureRecord = z.infer<typeof EmulationPostureRecordSchema>;

export interface EmulationPostureRepo {
  load(tabId: number): Promise<StorageReadResult<EmulationPostureRecord>>;
  list(): Promise<StorageReadResult<readonly EmulationPostureRecord[]>>;
  save(record: EmulationPostureRecord): Promise<void>;
  clear(tabId: number): Promise<void>;
}

/**
 * Session storage keeps one small envelope rather than one opaque key per tab.
 * That makes cold-worker startup able to discover every held posture without
 * asking for broad extension storage or depending on a popup being open.
 */
export function createEmulationPostureRepo(store: KeyValueStore): EmulationPostureRepo {
  let mutationQueue = Promise.resolve();

  const readEnvelope = async (): Promise<StorageReadResult<z.infer<typeof EmulationPostureEnvelopeSchema>>> =>
    parseStoredValue(EmulationPostureEnvelopeSchema, await store.get(EMULATION_POSTURES_KEY));

  const mutate = (operation: (records: EmulationPostureRecord[]) => void): Promise<void> => {
    const pending = mutationQueue.then(async () => {
      const stored = await readEnvelope();
      const records = stored.ok && stored.value ? [...stored.value.records] : [];
      operation(records);
      await store.set(EMULATION_POSTURES_KEY, {
        version: 1,
        records: records
          .map((record) => EmulationPostureRecordSchema.parse(record))
          .sort((left, right) => left.tabId - right.tabId),
      });
    });
    mutationQueue = pending.catch(() => undefined);
    return pending;
  };

  return {
    async load(tabId) {
      await mutationQueue;
      const stored = await readEnvelope();
      if (!stored.ok) return stored;
      return {
        ok: true,
        value: stored.value?.records.find((record) => record.tabId === tabId) ?? null,
      };
    },
    async list() {
      await mutationQueue;
      const stored = await readEnvelope();
      if (!stored.ok) return stored;
      return { ok: true, value: stored.value?.records ?? [] };
    },
    async save(record) {
      const parsed = EmulationPostureRecordSchema.parse(record);
      await mutate((records) => {
        const index = records.findIndex((candidate) => candidate.tabId === parsed.tabId);
        if (index < 0) {
          records.push(parsed);
          return;
        }
        // A delayed older write may never replace a newer desired target.
        if ((records[index]?.revision ?? -1) <= parsed.revision) {
          records[index] = parsed;
        }
      });
    },
    async clear(tabId) {
      await mutate((records) => {
        const index = records.findIndex((candidate) => candidate.tabId === tabId);
        if (index >= 0) records.splice(index, 1);
      });
    },
  };
}
