import { z } from "zod";

import { RenderModeSchema } from "../../domain/schema/property";
import type { KeyValueStore, StorageReadResult } from "./key-value";
import { invalidStoredValue, parseStoredValue } from "./key-value";

/** The only property data allowed to live on this machine, and only while the
 *  backend has no configuration for the property.
 *
 *  The backend is the single source of truth. A load answer — including a 404,
 *  which is an answer meaning "nothing stored" — removes local property data.
 *  The render mode is the one exemption, and only in the 404 case: until a
 *  configuration exists to carry it, an operator's choice has nowhere else to
 *  live, and re-asking on every popup open would be the alternative.
 *
 *  `backendConfigPresent` is stored rather than held in memory so the gate
 *  survives a service-worker restart: without it a later write could not tell
 *  whether local storage is still permitted. */
export const LocalPropertyStateSchema = z.object({
  siteId: z.number().int().positive(),
  backendConfigPresent: z.boolean(),
  renderMode: RenderModeSchema.optional(),
  updatedAt: z.string().min(1),
});

export type LocalPropertyState = z.infer<typeof LocalPropertyStateSchema>;

const LOCAL_PROPERTY_PREFIX = "local-property:";

export interface LocalPropertyRepo {
  load(siteId: number): Promise<StorageReadResult<LocalPropertyState>>;
  save(state: LocalPropertyState): Promise<void>;
  clear(siteId: number): Promise<void>;
}

function keyFor(siteId: number): string {
  return `${LOCAL_PROPERTY_PREFIX}${siteId}`;
}

export function createLocalPropertyRepo(store: KeyValueStore): LocalPropertyRepo {
  return {
    async load(siteId) {
      const parsed = parseStoredValue(LocalPropertyStateSchema, await store.get(keyFor(siteId)));
      if (parsed.ok && parsed.value && parsed.value.siteId !== siteId) {
        return invalidStoredValue("Stored local property state does not match requested siteId");
      }
      return parsed;
    },
    async save(state) {
      await store.set(keyFor(state.siteId), LocalPropertyStateSchema.parse(state));
    },
    async clear(siteId) {
      await store.remove(keyFor(siteId));
    },
  };
}
