import { z } from "zod";

import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const RUN_RECORD_PREFIX = "aiRun:";

export const RunRecordSchema = z.object({
  sessionId: z.string().min(1),
  tabId: z.number().int().nonnegative(),
  phase: z.enum(["idle", "running", "fresh", "stale-on-edit", "failed"]),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export interface RunRecordRepo {
  load(sessionId: string): Promise<StorageReadResult<RunRecord>>;
  save(record: RunRecord): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

function keyFor(sessionId: string): string {
  return `${RUN_RECORD_PREFIX}${sessionId}`;
}

export function createRunRecordRepo(store: KeyValueStore): RunRecordRepo {
  return {
    async load(sessionId) {
      const parsed = parseStoredValue(RunRecordSchema, await store.get(keyFor(sessionId)));
      if (parsed.ok && parsed.value && parsed.value.sessionId !== sessionId) {
        return invalidStoredValue("Stored run record does not match requested sessionId");
      }
      return parsed;
    },
    async save(record) {
      await store.set(keyFor(record.sessionId), RunRecordSchema.parse(record));
    },
    async clear(sessionId) {
      await store.remove(keyFor(sessionId));
    },
  };
}
