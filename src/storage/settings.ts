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

function normalizeUrlIdentity(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

function normalizeStageIdentity(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate).hostname.replace(/\.$/, "").toLowerCase() || null;
  } catch {
    return trimmed.replace(/\.$/, "").toLowerCase();
  }
}

/** Stable identity of every service that may receive the delegated JWT.
 * Formatting-only edits do not sign the operator out, while changing the Hub,
 * AI service, environment/GraphQL host, protocol, port, or path does. */
export function connectionProfileIdentity(settings: ConnectionSettings): string {
  return JSON.stringify({
    configEndpoint: normalizeUrlIdentity(settings.configEndpoint),
    aiEndpoint: normalizeUrlIdentity(settings.aiEndpoint),
    environmentKey: normalizeStageIdentity(settings.stageBase),
  });
}

/** Builds the one atomic settings value for a complete profile commit. */
export function replaceConnectionProfile(current: Settings, next: ConnectionSettings): Settings {
  const sameBackend = connectionProfileIdentity(connectionSettingsOf(current)) ===
    connectionProfileIdentity(next);
  return {
    ...ConnectionSettingsSchema.parse(next),
    ...(sameBackend && current.token?.trim() ? { token: current.token } : {}),
  };
}

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
