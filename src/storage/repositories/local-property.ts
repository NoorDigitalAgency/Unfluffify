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
  environmentKey: z.string().trim().min(1),
  siteId: z.number().int().positive(),
  backendConfigPresent: z.boolean(),
  renderMode: RenderModeSchema.optional(),
  /** Set when valid backend authority unexpectedly drops pages without exact
   * reconciliation proof. The authoritative snapshot is still adopted, but
   * mutations stay closed until a later clean/proven refresh clears this. */
  integrityWarning: z.object({
    code: z.literal("integrity_shrink"),
    removedPageKeys: z.array(z.string().min(1)),
    message: z.string().min(1),
    detectedAt: z.string().min(1),
  }).optional(),
  updatedAt: z.string().min(1),
});

export type LocalPropertyState = z.infer<typeof LocalPropertyStateSchema>;

const LOCAL_PROPERTY_PREFIX = "local-property:";

export interface LocalPropertyRepo {
  load(environmentKey: string, siteId: number): Promise<StorageReadResult<LocalPropertyState>>;
  save(state: LocalPropertyState): Promise<void>;
  clear(environmentKey: string, siteId: number): Promise<void>;
}

function keyFor(environmentKey: string, siteId: number): string {
  return `${LOCAL_PROPERTY_PREFIX}${environmentKey.trim().toLowerCase()}:${siteId}`;
}

export function createLocalPropertyRepo(store: KeyValueStore): LocalPropertyRepo {
  return {
    async load(environmentKey, siteId) {
      const parsed = parseStoredValue(LocalPropertyStateSchema, await store.get(keyFor(environmentKey, siteId)));
      if (parsed.ok && parsed.value && (
        parsed.value.siteId !== siteId ||
        parsed.value.environmentKey !== environmentKey.trim().toLowerCase()
      )) {
        return invalidStoredValue("Stored local property state does not match requested property scope");
      }
      return parsed;
    },
    async save(state) {
      const parsed = LocalPropertyStateSchema.parse(state);
      await store.set(keyFor(parsed.environmentKey, parsed.siteId), parsed);
    },
    async clear(environmentKey, siteId) {
      await store.remove(keyFor(environmentKey, siteId));
    },
  };
}
