import * as utils from "../common/utilities.js";

export const TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-";
const DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = 5 * 60_000;

function normalizePayloadKey(payloadKey) {
  return typeof payloadKey === "string" ? payloadKey.trim() : "";
}

function normalizeScope(scope) {
  const normalized = typeof scope === "string" ? scope.trim() : "";
  return normalized || "payload";
}

function normalizeExpectedType(expectedType) {
  if (expectedType === "array") {
    return "array";
  }
  if (expectedType === "object") {
    return "object";
  }
  return "any";
}

function payloadMatchesExpectedType(payload, expectedType) {
  if (expectedType === "array") {
    return Array.isArray(payload);
  }
  if (expectedType === "object") {
    return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
  }
  return true;
}

export function buildTransferPayloadKey(scope = "payload") {
  const normalizedScope = normalizeScope(scope);
  return `${TRANSFER_PAYLOAD_KEY_PREFIX}${normalizedScope}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function parseTransferPayloadKey(key) {
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

export async function putTransferPayload(scope, payload, options = {}) {
  const payloadKey = normalizePayloadKey(options.payloadKey) || buildTransferPayloadKey(scope);
  try {
    await utils.storageSet(chrome.storage.session, { [payloadKey]: payload });
    return { ok: true, payloadKey };
  } catch {
    return { ok: false, reason: "storage_failed", payloadKey: "" };
  }
}

export async function getTransferPayload(payloadKey, options = {}) {
  const normalizedPayloadKey = normalizePayloadKey(payloadKey);
  if (!normalizedPayloadKey) {
    return { ok: false, reason: "missing_key", payloadKey: "" };
  }

  let payloadStore = null;
  try {
    payloadStore = await utils.storageGet(chrome.storage.session, normalizedPayloadKey);
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

export async function consumeTransferPayload(payloadKey, options = {}) {
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

export async function removeTransferPayload(payloadKey) {
  const normalizedPayloadKey = normalizePayloadKey(payloadKey);
  if (!normalizedPayloadKey) {
    return { ok: false, reason: "missing_key", payloadKey: "" };
  }
  try {
    await utils.storageRemove(chrome.storage.session, normalizedPayloadKey);
    return { ok: true, payloadKey: normalizedPayloadKey };
  } catch {
    return { ok: false, reason: "storage_failed", payloadKey: normalizedPayloadKey };
  }
}

export async function sweepStaleTransferPayloads(options = {}) {
  const maxAgeMs = Number(options.maxAgeMs);
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS;
  const nowValue = Number(options.now);
  const now = Number.isFinite(nowValue) ? nowValue : Date.now();

  let allSession = null;
  try {
    allSession = await utils.storageGet(chrome.storage.session, null);
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
    await utils.storageRemove(chrome.storage.session, staleKeys);
    return {
      ok: true,
      removedKeys: staleKeys,
      scanned: Object.keys(allSession).length
    };
  } catch {
    return { ok: false, reason: "storage_failed", removedKeys: [] };
  }
}

export function summarizeTransferPayloadForLog(payload) {
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
