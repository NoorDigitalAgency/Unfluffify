import { z } from "zod";

import { EnvironmentKeySchema, PageKeySchema, SelectorSetSchema } from "../config";
import { SiteIdSchema } from "../../domain/schema/property";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const RUN_RECORD_PREFIX = "aiRun:";
const RUN_RECORD_BY_TAB_PREFIX = "aiRunByTab:";

export const RunRecordSchema = z.object({
  sessionId: z.string().min(1),
  tabId: z.number().int().nonnegative(),
  phase: z.enum(["idle", "running", "fresh", "stale-on-edit", "failed"]),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  /** Scope fields were added after the first rewrite prototype. They remain
   * optional so an installed extension can read (and safely ignore) its older
   * records instead of corrupting the whole repository on upgrade. */
  clientRunId: z.string().min(1).optional(),
  environmentKey: EnvironmentKeySchema.optional(),
  siteId: SiteIdSchema.optional(),
  pageKey: PageKeySchema.optional(),
  selectors: SelectorSetSchema.optional(),
});

const RunRecordPointerSchema = z.object({
  tabId: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export interface RunRecordRepo {
  load(sessionId: string): Promise<StorageReadResult<RunRecord>>;
  loadLatestForTab(tabId: number): Promise<StorageReadResult<RunRecord>>;
  save(record: RunRecord, options?: Readonly<{ makeLatest?: boolean }>): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

function keyFor(sessionId: string): string {
  return `${RUN_RECORD_PREFIX}${sessionId}`;
}

function tabKeyFor(tabId: number): string {
  return `${RUN_RECORD_BY_TAB_PREFIX}${tabId}`;
}

export function createRunRecordRepo(store: KeyValueStore): RunRecordRepo {
  let writes: Promise<void> = Promise.resolve();
  const enqueueWrite = (run: () => Promise<void>): Promise<void> => {
    const queued = writes.then(run, run);
    writes = queued.catch(() => undefined);
    return queued;
  };

  return {
    async load(sessionId) {
      await writes;
      const parsed = parseStoredValue(RunRecordSchema, await store.get(keyFor(sessionId)));
      if (parsed.ok && parsed.value && parsed.value.sessionId !== sessionId) {
        return invalidStoredValue("Stored run record does not match requested sessionId");
      }
      return parsed;
    },
    async loadLatestForTab(tabId) {
      await writes;
      const pointer = parseStoredValue(RunRecordPointerSchema, await store.get(tabKeyFor(tabId)));
      if (!pointer.ok) {
        return pointer;
      }
      if (!pointer.value) {
        return { ok: true, value: null };
      }
      if (pointer.value.tabId !== tabId) {
        return invalidStoredValue("Stored run pointer does not match requested tabId");
      }
      const record = parseStoredValue(RunRecordSchema, await store.get(keyFor(pointer.value.sessionId)));
      if (!record.ok || !record.value) {
        return record;
      }
      if (record.value.sessionId !== pointer.value.sessionId || record.value.tabId !== tabId) {
        return invalidStoredValue("Stored latest run does not match its tab pointer");
      }
      return record;
    },
    async save(record, options) {
      const parsed = RunRecordSchema.parse(record);
      await enqueueWrite(async () => {
        await store.set(keyFor(parsed.sessionId), parsed);
        const pointerKey = tabKeyFor(parsed.tabId);
        const pointer = parseStoredValue(RunRecordPointerSchema, await store.get(pointerKey));
        if (!pointer.ok || !pointer.value || pointer.value.sessionId === parsed.sessionId || options?.makeLatest === true) {
          await store.set(pointerKey, { tabId: parsed.tabId, sessionId: parsed.sessionId });
        }
      });
    },
    async clear(sessionId) {
      await enqueueWrite(async () => {
        const record = parseStoredValue(RunRecordSchema, await store.get(keyFor(sessionId)));
        await store.remove(keyFor(sessionId));
        if (!record.ok || !record.value) {
          return;
        }
        const pointerKey = tabKeyFor(record.value.tabId);
        const pointer = parseStoredValue(RunRecordPointerSchema, await store.get(pointerKey));
        if (pointer.ok && pointer.value?.sessionId === sessionId) {
          await store.remove(pointerKey);
        }
      });
    },
  };
}
