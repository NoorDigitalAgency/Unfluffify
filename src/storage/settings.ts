import { z } from "zod";
import type { KeyValueStore, StorageReadResult } from "./repositories/key-value";
import { parseStoredValue } from "./repositories/key-value";

export const SettingsSchema = z.object({
  configEndpoint: z.string().url().optional(),
  aiEndpoint: z.string().url().optional(),
  stageBase: z.string().min(1).optional(),
  token: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

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
