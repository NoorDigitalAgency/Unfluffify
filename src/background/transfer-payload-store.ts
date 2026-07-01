import * as utils from "../common/utilities";
import { AI_RUN_DEFAULT_TIMEOUT_MS } from "../common/bus/contracts/ai-run";

export const TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-";
const DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = 5 * 60_000;
// Margin added on top of the AI run timeout when deciding whether a transfer
// payload is stale enough to sanitize. Keeps the safe window comfortably longer
// than any real in-flight transfer.
export const TRANSFER_PAYLOAD_SANITIZE_MARGIN_MS = 2 * 60_000;

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
    await utils.idbSet({ [payloadKey]: payload });
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

  let payloadStore: Record<string, unknown>;
  try {
    payloadStore = (await utils.idbGet(normalizedPayloadKey)) as Record<string, unknown>;
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
    await utils.idbRemove(normalizedPayloadKey);
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

  let allKeys: string[];
  try {
    allKeys = await utils.idbGetAllKeys();
  } catch {
    return { ok: false, reason: "storage_failed", removedKeys: [] };
  }

  const staleKeys = allKeys.filter((key) => {
    const parsed = parseTransferPayloadKey(key);
    if (!parsed) {
      return false;
    }
    return now - parsed.timestamp > effectiveMaxAgeMs;
  });

  if (!staleKeys.length) {
    return { ok: true, removedKeys: [], scanned: allKeys.length };
  }

  try {
    await utils.idbRemove(staleKeys);
    return {
      ok: true,
      removedKeys: staleKeys,
      scanned: allKeys.length
    };
  } catch {
    return { ok: false, reason: "storage_failed", removedKeys: [] };
  }
}

export async function sanitizeTransferPayloads(
  options: { now?: unknown } = {}
): Promise<{ ok: boolean; removedKeys: string[] }> {
  const nowValue = Number(options.now);
  const now = Number.isFinite(nowValue) ? nowValue : Date.now();
  // A payload can legitimately be "in flight" for at most one AI run timeout
  // (the longest-lived operation). Anything older than that plus a margin is
  // stale from a previous session and safe to evict. Fresh in-flight payloads
  // (ai-run-*, save-*, load, ...) stay untouched because their age is far below
  // this window, and the newest payload of every scope is always kept as an
  // extra safeguard.
  const maxAgeMs = AI_RUN_DEFAULT_TIMEOUT_MS + TRANSFER_PAYLOAD_SANITIZE_MARGIN_MS;

  let allKeys: string[];
  try {
    allKeys = await utils.idbGetAllKeys();
  } catch {
    return { ok: false, removedKeys: [] };
  }

  const parsedTransfers = allKeys
    .map((key) => parseTransferPayloadKey(key))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseTransferPayloadKey>> => entry !== null);

  const latestKeyByScope = new Map<string, { key: string; timestamp: number }>();
  for (const entry of parsedTransfers) {
    const current = latestKeyByScope.get(entry.scope);
    if (!current || entry.timestamp > current.timestamp) {
      latestKeyByScope.set(entry.scope, { key: entry.key, timestamp: entry.timestamp });
    }
  }

  const staleKeys = parsedTransfers
    .filter((entry) => {
      if (now - entry.timestamp <= maxAgeMs) {
        return false;
      }
      if (latestKeyByScope.get(entry.scope)?.key === entry.key) {
        return false;
      }
      return true;
    })
    .map((entry) => entry.key);

  if (!staleKeys.length) {
    return { ok: true, removedKeys: [] };
  }

  try {
    await utils.idbRemove(staleKeys);
    return { ok: true, removedKeys: staleKeys };
  } catch {
    return { ok: false, removedKeys: [] };
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
  const byteEstimate = (() => {
    try {
      return typeof payload === "undefined"
        ? 0
        : new TextEncoder().encode(JSON.stringify(payload)).length;
    } catch {
      return 0;
    }
  })();
  return {
    type,
    keys,
    byteEstimate
  };
}
