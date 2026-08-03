import { z } from "zod";
import type { KeyValueStore, StorageReadResult } from "./repositories/key-value";
import { parseStoredValue } from "./repositories/key-value";

/** The endpoint half of the settings — everything an operator types. Kept
 *  separate from the token so a settings write can never carry, and therefore
 *  never drop, the JWT: that credential is owned solely by the login flow. */
export const ConnectionSettingsSchema = z.object({
  configEndpoint: z.string().url().optional(),
  aiEndpoint: z.string().url().optional(),
  stageBase: z.string().min(1).optional(),
});

export const SettingsSchema = ConnectionSettingsSchema.extend({
  token: z.string().optional(),
});

export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

/** Drops the token and any unset key, so the result round-trips through
 *  storage and equality checks without phantom `undefined` entries. */
export function connectionSettingsOf(settings: Settings): ConnectionSettings {
  const { configEndpoint, aiEndpoint, stageBase } = settings;
  return ConnectionSettingsSchema.parse(Object.fromEntries(
    Object.entries({ configEndpoint, aiEndpoint, stageBase })
      .filter(([, value]) => value !== undefined),
  ));
}

export function parseSettings(value: unknown): Settings {
  return SettingsSchema.parse(value);
}

const SETTINGS_KEY = "settings";

export interface SettingsRepo {
  load(): Promise<StorageReadResult<Settings>>;
  save(settings: Settings): Promise<void>;
}

export function createSettingsRepo(store: KeyValueStore): SettingsRepo {
  return {
    async load() {
      return parseStoredValue(SettingsSchema, await store.get(SETTINGS_KEY));
    },
    async save(settings) {
      await store.set(SETTINGS_KEY, SettingsSchema.parse(settings));
    },
  };
}
