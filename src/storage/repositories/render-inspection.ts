import { z } from "zod";

import { RenderInspectionSessionObjectSchema } from "../../messaging/render-inspection";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const RENDER_INSPECTION_STATE_KEY = "renderInspection:state";
const RENDER_INSPECTION_CLEANUP_DISMISSALS_KEY = "renderInspection:cleanup-dismissals";

const RenderInspectionEnvelopeSchema = z.object({
  version: z.literal(1),
  // Records are parsed independently so a malformed record still contributes
  // its salvageable tab id to the fail-open recovery sweep.
  records: z.array(z.unknown()),
});

const CleanupDismissalsSchema = z.object({
  version: z.literal(1),
  alarmNames: z.array(z.string().min(1)),
});

export const RenderInspectionRecordSchema = RenderInspectionSessionObjectSchema.extend({
  version: z.literal(1),
  tabId: z.number().int().positive(),
  /** Terminal restores are CDP side effects and can fail after the durable
   * tombstone is written. Keep the retry obligation durable as well. */
  restorePending: z.boolean().default(false),
  /** Restoring the CDP bit is not enough for a document which already loaded
   * while script execution was disabled. Retain the one required healing
   * reload until Chrome has accepted it. */
  reloadPending: z.boolean().default(false),
  /** A successful static observation may remain visible briefly, but it is not
   * permission to leave the tab JavaScript-disabled forever after the panel is
   * gone. */
  restoreAt: z.number().int().nonnegative().nullable().default(null),
  /** A terminal write can fail after the record is already authoritative. This
   * bit prevents a recreated worker from replaying that active posture before
   * it has retired the same generation fail-open. */
  failOpenPending: z.boolean().default(false),
  /** The authoritative main document that asked for the reload. It can never
   * adopt the replacement-document session while the commit is still pending. */
  sourceDocumentId: z.string().min(1).nullable(),
}).superRefine((record, context) => {
  if (record.phase === "terminal" && record.terminalReason === null) {
    context.addIssue({
      code: "custom",
      path: ["terminalReason"],
      message: "A terminal inspection requires a terminal reason",
    });
  }
  if (record.phase !== "terminal" && record.terminalReason !== null) {
    context.addIssue({
      code: "custom",
      path: ["terminalReason"],
      message: "An active inspection cannot have a terminal reason",
    });
  }
  if (record.phase === "adopted" && (!record.documentId || !record.documentNonce)) {
    context.addIssue({
      code: "custom",
      path: ["documentNonce"],
      message: "An adopted inspection requires a document identity and nonce",
    });
  }
  if ((record.phase === "arming" || record.documentId === null) && record.documentNonce !== null) {
    context.addIssue({
      code: "custom",
      path: ["documentNonce"],
      message: "A document nonce requires a committed replacement document",
    });
  }
  if (record.phase === "arming" && record.documentId !== null) {
    context.addIssue({
      code: "custom",
      path: ["documentId"],
      message: "An arming inspection cannot bind a replacement document",
    });
  }
  if (record.phase !== "terminal" && (
    record.restorePending || record.reloadPending || record.restoreAt !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["restorePending"],
      message: "Only a terminal inspection may retain restore or reload work",
    });
  }
  if (record.restoreAt !== null && (
    record.phase !== "terminal" ||
    record.terminalReason !== "paint-acknowledged" ||
    record.javascriptEnabled
  )) {
    context.addIssue({
      code: "custom",
      path: ["restoreAt"],
      message: "Only a successful static inspection may retain a restore deadline",
    });
  }
});

export type RenderInspectionRecord = z.infer<typeof RenderInspectionRecordSchema>;

export interface RenderInspectionRepo {
  load(tabId: number): Promise<StorageReadResult<RenderInspectionRecord>>;
  /** Reads a structurally valid record from a damaged envelope without
   * treating that envelope as authoritative. Runtime recovery uses this only
   * to preserve the generation watermark while replacing it with a
   * non-success terminal tombstone. */
  salvage?(tabId: number): Promise<RenderInspectionRecord | null>;
  listTabIds(): Promise<number[]>;
  list(): Promise<StorageReadResult<RenderInspectionRecord[]>>;
  save(record: RenderInspectionRecord): Promise<void>;
  clear(tabId: number): Promise<void>;
  isCleanupAlarmDismissed?(alarmName: string): Promise<boolean>;
  dismissCleanupAlarm?(alarmName: string): Promise<void>;
}

export function createRenderInspectionRepo(store: KeyValueStore): RenderInspectionRepo {
  let writes: Promise<unknown> = Promise.resolve();
  /** Once a malformed envelope has exposed salvageable tab ids, keep each one
   * quarantined until its fail-open clear completes. The first clear repairs
   * the envelope metadata; without this set a later record in the same corrupt
   * envelope could otherwise become valid and be replayed. */
  const quarantinedTabIds = new Set<number>();
  const withWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = writes.then(operation, operation);
    writes = queued.catch(() => undefined);
    return queued;
  };
  const rawRecords = (value: unknown): unknown[] | null => {
    if (!value || typeof value !== "object" || !("records" in value)) {
      return null;
    }
    const records = (value as { records?: unknown }).records;
    return Array.isArray(records) ? records : null;
  };
  const loadRecords = async (): Promise<unknown[]> => {
    const value = await store.get(RENDER_INSPECTION_STATE_KEY);
    const parsed = parseStoredValue(RenderInspectionEnvelopeSchema, value);
    if (parsed.ok) {
      return parsed.value?.records ?? [];
    }
    const records = rawRecords(value);
    if (records === null) {
      throw parsed.error;
    }
    for (const record of records) {
      const tabId = tabIdOf(record);
      if (tabId !== null) {
        quarantinedTabIds.add(tabId);
      }
    }
    return records;
  };
  const saveRecords = async (records: unknown[]): Promise<void> => {
    if (records.length === 0) {
      await store.remove(RENDER_INSPECTION_STATE_KEY);
      return;
    }
    await store.set(RENDER_INSPECTION_STATE_KEY, {
      version: 1,
      records,
    });
  };
  const loadCleanupDismissals = async (): Promise<string[]> => {
    const parsed = parseStoredValue(
      CleanupDismissalsSchema,
      await store.get(RENDER_INSPECTION_CLEANUP_DISMISSALS_KEY),
    );
    if (!parsed.ok) {
      throw parsed.error;
    }
    return parsed.value?.alarmNames ?? [];
  };
  const tabIdOf = (value: unknown): number | null => {
    if (!value || typeof value !== "object" || !("tabId" in value)) {
      return null;
    }
    const tabId = (value as { tabId?: unknown }).tabId;
    return typeof tabId === "number" && Number.isInteger(tabId) && tabId > 0
      ? tabId
      : null;
  };
  const recordsForTab = (records: unknown[], tabId: number): unknown[] =>
    records.filter((record) => tabIdOf(record) === tabId);

  return {
    async load(tabId) {
      await writes;
      const matches = recordsForTab(await loadRecords(), tabId);
      if (quarantinedTabIds.has(tabId)) {
        return invalidStoredValue("Stored render inspection envelope is invalid");
      }
      if (matches.length > 1) {
        return invalidStoredValue("Stored render inspection contains duplicate tab records");
      }
      return parseStoredValue(RenderInspectionRecordSchema, matches[0] ?? null);
    },
    async salvage(tabId) {
      await writes;
      const value = await store.get(RENDER_INSPECTION_STATE_KEY);
      const records = rawRecords(value);
      if (records === null) {
        return null;
      }
      const matches = recordsForTab(records, tabId);
      if (matches.length !== 1) {
        return null;
      }
      const parsed = RenderInspectionRecordSchema.safeParse(matches[0]);
      return parsed.success ? parsed.data : null;
    },
    async listTabIds() {
      await writes;
      return [...new Set((await loadRecords())
        .map(tabIdOf)
        .filter((tabId): tabId is number => tabId !== null))]
        .sort((left, right) => left - right);
    },
    async list() {
      await writes;
      const records: RenderInspectionRecord[] = [];
      const seen = new Set<number>();
      for (const value of await loadRecords()) {
        const parsed = parseStoredValue(RenderInspectionRecordSchema, value);
        if (!parsed.ok) {
          return parsed;
        }
        if (parsed.value) {
          if (seen.has(parsed.value.tabId)) {
            return invalidStoredValue("Stored render inspection contains duplicate tab records");
          }
          seen.add(parsed.value.tabId);
          records.push(parsed.value);
        }
      }
      records.sort((left, right) => left.tabId - right.tabId);
      return { ok: true, value: records };
    },
    async save(record) {
      const parsed = RenderInspectionRecordSchema.parse(record);
      await withWrite(async () => {
        const records = await loadRecords();
        const others = records.filter((value) => tabIdOf(value) !== parsed.tabId);
        others.push(parsed);
        others.sort((left, right) => (tabIdOf(left) ?? 0) - (tabIdOf(right) ?? 0));
        await saveRecords(others);
        quarantinedTabIds.delete(parsed.tabId);
      });
    },
    async clear(tabId) {
      await withWrite(async () => {
        await saveRecords((await loadRecords()).filter((value) => tabIdOf(value) !== tabId));
        quarantinedTabIds.delete(tabId);
      });
    },
    async isCleanupAlarmDismissed(alarmName) {
      await writes;
      return (await loadCleanupDismissals()).includes(alarmName);
    },
    async dismissCleanupAlarm(alarmName) {
      await withWrite(async () => {
        const alarmNames = await loadCleanupDismissals();
        if (alarmNames.includes(alarmName)) {
          return;
        }
        await store.set(RENDER_INSPECTION_CLEANUP_DISMISSALS_KEY, {
          version: 1,
          alarmNames: [...alarmNames, alarmName].sort(),
        });
      });
    },
  };
}
