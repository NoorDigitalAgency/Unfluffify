import { browser } from "../common/browser.js";
import * as utils from "../common/utilities.js";

export const TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-";
const DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = 5 * 60_000;

type StorageHost = typeof globalThis & {
  browser?: { storage?: { session?: unknown } };
  chrome?: { storage?: { session?: unknown } };
};

function getSessionStorageArea(): unknown {
  const host = globalThis as StorageHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

function normalizePayloadKey(payloadKey: unknown): string {
  return typeof payloadKey === "string" ? payloadKey.trim() : "";
}

function normalizeScope(scope: unknown): string {
  const normalized = typeof scope === "string" ? scope.trim() : "";
  return normalized || "payload";
}

function normalizeExpectedType(expectedType: unknown): "array" | "object" | "any" {
  if (expectedType === "array") {
    return "array";
  }
  if (expectedType === "object") {
    return "object";
  }
  return "any";
}

function payloadMatchesExpectedType(payload: unknown, expectedType: "array" | "object" | "any"): boolean {
  if (expectedType === "array") {
    return Array.isArray(payload);
  }
  if (expectedType === "object") {
    return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
  }
  return true;
}

export function buildTransferPayloadKey(scope = "payload"): string {
  const normalizedScope = normalizeScope(scope);
  return `${TRANSFER_PAYLOAD_KEY_PREFIX}${normalizedScope}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function parseTransferPayloadKey(key: unknown): {
  key: string;
  scope: string;
  timestamp: number;
  nonce: string;
} | null {
  const normalizedKey = normalizePayloadKey(key);
  if (!normalizedKey.startsWith(TRANSFER_PAYLOAD_KEY_PREFIX)) {
    return null;
  }
  const suffix = normalizedKey.slice(TRANSFER_PAYLOAD_KEY_PREFIX.length);
  const parts = suffix.split(":");
  if (parts.length < 3) {
    return null;
  }
  const scope = normalizeScope(parts[0]);
  const timestamp = Number(parts[1]);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const nonce = parts.slice(2).join(":");
  return {
    key: normalizedKey,
    scope,
    timestamp: Math.trunc(timestamp),
    nonce
  };
}

export async function putTransferPayload(
  scope: unknown,
  payload: unknown,
  options: { payloadKey?: unknown } = {}
): Promise<{ ok: boolean; reason?: string; payloadKey: string }> {
  const scopeForKey = typeof scope === "string" ? scope : "payload";
  const payloadKey = normalizePayloadKey(options.payloadKey) || buildTransferPayloadKey(scopeForKey);
  try {
    await utils.storageSet(getSessionStorageArea(), { [payloadKey]: payload });
    return { ok: true, payloadKey };
  } catch {
    return { ok: false, reason: "storage_failed", payloadKey: "" };
  }
}

export async function getTransferPayload(
  payloadKey: unknown,
  options: { expectedType?: unknown; removeInvalid?: boolean } = {}
): Promise<{ ok: boolean; reason?: string; payloadKey: string; payload?: unknown }> {
  const normalizedPayloadKey = normalizePayloadKey(payloadKey);
  if (!normalizedPayloadKey) {
    return { ok: false, reason: "missing_key", payloadKey: "" };
  }

  let payloadStore = null;
  try {
    payloadStore = await utils.storageGet(getSessionStorageArea(), normalizedPayloadKey);
  } catch {
    return { ok: false, reason: "storage_failed", payloadKey: normalizedPayloadKey };
  }

  const payload = payloadStore && typeof payloadStore === "object"
    ? payloadStore[normalizedPayloadKey]
    : undefined;
  if (typeof payload === "undefined") {
    return { ok: false, reason: "not_found", payloadKey: normalizedPayloadKey };
  }

  const expectedType = normalizeExpectedType(options.expectedType);
  if (!payloadMatchesExpectedType(payload, expectedType)) {
    if (options.removeInvalid) {
      await removeTransferPayload(normalizedPayloadKey);
    }
    return { ok: false, reason: "invalid_payload", payloadKey: normalizedPayloadKey };
  }

  return {
    ok: true,
    payloadKey: normalizedPayloadKey,
    payload
  };
}

export async function consumeTransferPayload(
  payloadKey: unknown,
  options: { expectedType?: unknown; removeInvalid?: boolean } = {}
): Promise<{ ok: boolean; reason?: string; payloadKey: string; payload?: unknown }> {
  const loaded = await getTransferPayload(payloadKey, options);
  if (!loaded.ok) {
    return loaded;
  }

  const removed = await removeTransferPayload(loaded.payloadKey);
  if (!removed.ok) {
    return { ok: false, reason: "storage_failed", payloadKey: loaded.payloadKey };
  }

  return loaded;
}

export async function removeTransferPayload(payloadKey: unknown): Promise<{ ok: boolean; reason?: string; payloadKey: string }> {
  const normalizedPayloadKey = normalizePayloadKey(payloadKey);
  if (!normalizedPayloadKey) {
    return { ok: false, reason: "missing_key", payloadKey: "" };
  }
  try {
    await utils.storageRemove(getSessionStorageArea(), normalizedPayloadKey);
    return { ok: true, payloadKey: normalizedPayloadKey };
  } catch {
    return { ok: false, reason: "storage_failed", payloadKey: normalizedPayloadKey };
  }
}

export async function sweepStaleTransferPayloads(options = {}) {
  const resolvedOptions = options as { maxAgeMs?: unknown; now?: unknown };
  const maxAgeMs = Number(resolvedOptions.maxAgeMs);
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS;
  const nowValue = Number(resolvedOptions.now);
  const now = Number.isFinite(nowValue) ? nowValue : Date.now();

  let allSession = null;
  try {
    allSession = await utils.storageGet(getSessionStorageArea(), null);
  } catch {
    return { ok: false, reason: "storage_failed", removedKeys: [] };
  }

  if (!allSession || typeof allSession !== "object") {
    return { ok: true, removedKeys: [], scanned: 0 };
  }

  const staleKeys = Object.keys(allSession).filter((key) => {
    const parsed = parseTransferPayloadKey(key);
    if (!parsed) {
      return false;
    }
    return now - parsed.timestamp > effectiveMaxAgeMs;
  });

  if (!staleKeys.length) {
    return { ok: true, removedKeys: [], scanned: Object.keys(allSession).length };
  }

  try {
    await utils.storageRemove(getSessionStorageArea(), staleKeys);
    return {
      ok: true,
      removedKeys: staleKeys,
      scanned: Object.keys(allSession).length
    };
  } catch {
    return { ok: false, reason: "storage_failed", removedKeys: [] };
  }
}

export function summarizeTransferPayloadForLog(payload: unknown): {
  type: string;
  keys: string[];
  byteEstimate: number;
} {
  const type = Array.isArray(payload) ? "array" : typeof payload;
  const keys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload)
    : [];
  let byteEstimate = 0;
  try {
    byteEstimate = typeof payload === "undefined"
      ? 0
      : new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    byteEstimate = 0;
  }
  return {
    type,
    keys,
    byteEstimate
  };
}
