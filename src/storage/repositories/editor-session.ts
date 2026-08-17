import { z } from "zod";

import { SiteIdSchema } from "../../domain/schema/property";
import { EnvironmentKeySchema } from "../config";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

const EDITOR_SESSION_PREFIX = "editorSession:";
const EDITOR_SESSION_BY_TAB_PREFIX = "editorSessionByTab:";

export const EditorSessionRecordSchema = z.object({
  environmentKey: EnvironmentKeySchema,
  tabId: z.number().int().nonnegative(),
  siteId: SiteIdSchema,
  editorSessionId: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type EditorSessionRecord = z.infer<typeof EditorSessionRecordSchema>;

const EditorSessionPointerSchema = z.object({
  environmentKey: EnvironmentKeySchema,
  tabId: z.number().int().nonnegative(),
  siteId: SiteIdSchema,
});

export interface EditorSessionRepo {
  load(environmentKey: string, tabId: number, siteId: number): Promise<StorageReadResult<EditorSessionRecord>>;
  save(record: EditorSessionRecord): Promise<void>;
  clear(environmentKey: string, tabId: number, siteId: number): Promise<void>;
  clearForTab(tabId: number): Promise<void>;
}

function keyFor(environmentKey: string, tabId: number, siteId: number): string {
  return `${EDITOR_SESSION_PREFIX}${encodeURIComponent(environmentKey)}:${tabId}:${siteId}`;
}

function tabKeyFor(tabId: number): string {
  return `${EDITOR_SESSION_BY_TAB_PREFIX}${tabId}`;
}

export function createEditorSessionRepo(store: KeyValueStore): EditorSessionRepo {
  return {
    async load(environmentKey, tabId, siteId) {
      const parsed = parseStoredValue(
        EditorSessionRecordSchema,
        await store.get(keyFor(environmentKey, tabId, siteId)),
      );
      if (
        parsed.ok &&
        parsed.value &&
        (parsed.value.environmentKey !== environmentKey ||
          parsed.value.tabId !== tabId ||
          parsed.value.siteId !== siteId)
      ) {
        return invalidStoredValue("Stored editor session does not match the requested property scope");
      }
      return parsed;
    },
    async save(record) {
      const parsed = EditorSessionRecordSchema.parse(record);
      await store.set(keyFor(parsed.environmentKey, parsed.tabId, parsed.siteId), parsed);
      await store.set(tabKeyFor(parsed.tabId), {
        environmentKey: parsed.environmentKey,
        tabId: parsed.tabId,
        siteId: parsed.siteId,
      });
    },
    async clear(environmentKey, tabId, siteId) {
      await store.remove(keyFor(environmentKey, tabId, siteId));
      const pointer = parseStoredValue(EditorSessionPointerSchema, await store.get(tabKeyFor(tabId)));
      if (
        pointer.ok &&
        pointer.value?.environmentKey === environmentKey &&
        pointer.value.siteId === siteId
      ) {
        await store.remove(tabKeyFor(tabId));
      }
    },
    async clearForTab(tabId) {
      const pointerKey = tabKeyFor(tabId);
      const pointer = parseStoredValue(EditorSessionPointerSchema, await store.get(pointerKey));
      if (pointer.ok && pointer.value?.tabId === tabId) {
        await store.remove(keyFor(pointer.value.environmentKey, tabId, pointer.value.siteId));
      }
      await store.remove(pointerKey);
    },
  };
}
