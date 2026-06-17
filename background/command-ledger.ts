// @ts-nocheck
export const LEDGER_SENSITIVE_KEY_PATTERN = /(token|password|secret|authorization|cookie|jwt|api[_-]?key|bearer|credential)/i;
export const LEDGER_BODY_KEY_PATTERN = /(html|body|payload|content|config|raw|rendered)/i;
export const LEDGER_MAX_STRING_LENGTH = 160;
export const LEDGER_MAX_ARRAY_PREVIEW = 5;
export const LEDGER_MAX_OBJECT_KEYS = 20;

function looksLikeJwtToken(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function summarizeLargeString(value) {
  const normalized = typeof value === "string" ? value : "";
  if (normalized.length <= LEDGER_MAX_STRING_LENGTH) {
    return normalized;
  }
  return `[truncated:${normalized.length}] ${normalized.slice(0, LEDGER_MAX_STRING_LENGTH)}`;
}

function redactCommandPayloadValueForLedger(key, value, depth = 0) {
  const normalizedKey = typeof key === "string" ? key : "";
  if (LEDGER_SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
    return "[redacted]";
  }
  if (normalizedKey === "payloadKey") {
    return "[redacted:payload-key]";
  }
  if (typeof value === "string") {
    if (looksLikeJwtToken(value)) {
      return "[redacted:jwt]";
    }
    if (LEDGER_BODY_KEY_PATTERN.test(normalizedKey) && value.length > 64) {
      return `[redacted:${normalizedKey}:${value.length}]`;
    }
    return summarizeLargeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 1) {
      return `[array:${value.length}]`;
    }
    return {
      summary: `[array:${value.length}]`,
      preview: value.slice(0, LEDGER_MAX_ARRAY_PREVIEW).map((entry) => redactCommandPayloadValueForLedger(normalizedKey, entry, depth + 1))
    };
  }
  if (!value || typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (depth >= 1) {
    return `[object:${Object.keys(value).length}]`;
  }
  return redactCommandPayloadForLedger(value, depth + 1);
}

export function redactCommandPayloadForLedger(payload, depth = 0) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const entries = Object.entries(payload).slice(0, LEDGER_MAX_OBJECT_KEYS);
  const redacted = {};
  for (const [key, value] of entries) {
    redacted[key] = redactCommandPayloadValueForLedger(key, value, depth);
  }
  const totalKeys = Object.keys(payload).length;
  if (totalKeys > entries.length) {
    redacted.__truncatedKeys = totalKeys - entries.length;
  }
  return redacted;
}