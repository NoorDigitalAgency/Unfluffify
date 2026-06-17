// @ts-nocheck
const FALLBACK_REQUEST_PREFIX = "uf-msg";
let fallbackRequestCounter = 0;

export const MESSAGE_SOURCES = Object.freeze({
  POPUP: "popup",
  BACKGROUND: "background",
  CONTENT: "content",
  PAGE: "page"
});

export const MESSAGE_TARGETS = Object.freeze({
  POPUP: "popup",
  BACKGROUND: "background",
  CONTENT: "content",
  PAGE: "page"
});

export const MESSAGE_ERROR_CODES = Object.freeze({
  TIMEOUT: "timeout",
  RUNTIME_ERROR: "runtime_error",
  FEATURE_DISABLED: "feature_disabled",
  INVALID_TAB: "invalid_tab",
  CONTENT_UNAVAILABLE: "content_unavailable",
  HANDLER_FAILED: "handler_failed",
  MISSING_RESPONSE: "missing_response",
  INVALID_MESSAGE: "invalid_message",
  HANDLER_NOT_FOUND: "handler_not_found"
});

function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

function isFiniteInteger(value) {
  return Number.isFinite(value) && Number.isInteger(value);
}

function nextRequestId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  fallbackRequestCounter += 1;
  return `${FALLBACK_REQUEST_PREFIX}-${Date.now()}-${fallbackRequestCounter}`;
}

function normalizePayload(payload) {
  return isObject(payload) ? payload : {};
}

function normalizeReplyCode(value) {
  return typeof value === "string" && value ? value : MESSAGE_ERROR_CODES.HANDLER_FAILED;
}

export function createRequestEnvelope(type, payload, options = {}) {
  if (typeof type !== "string" || !type) {
    throw new TypeError("createRequestEnvelope requires a non-empty string type");
  }
  const expectsReply = options.expectsReply !== false;
  const id = typeof options.id === "string" && options.id
    ? options.id
    : expectsReply
      ? nextRequestId()
      : "";
  const envelope = {
    id,
    type,
    source: typeof options.source === "string" && options.source ? options.source : MESSAGE_SOURCES.POPUP,
    target: typeof options.target === "string" && options.target ? options.target : MESSAGE_TARGETS.BACKGROUND,
    tabId: isFiniteInteger(options.tabId) ? options.tabId : null,
    frameId: isFiniteInteger(options.frameId) ? options.frameId : 0,
    expectsReply,
    payload: normalizePayload(payload)
  };
  if (!expectsReply) {
    envelope.id = id;
  }
  return envelope;
}

export function createSuccessEnvelope(request, result = {}) {
  return {
    id: isObject(request) && typeof request.id === "string" ? request.id : "",
    ok: true,
    result
  };
}

export function createFailureEnvelope(request, code, error, details = {}) {
  return {
    id: isObject(request) && typeof request.id === "string" ? request.id : "",
    ok: false,
    code: normalizeReplyCode(code),
    error: typeof error === "string" && error ? error : "Request failed",
    details: isObject(details) ? details : {}
  };
}

export function isRequestEnvelope(value) {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.type !== "string" || !value.type) {
    return false;
  }
  if (typeof value.source !== "string" || !value.source) {
    return false;
  }
  if (typeof value.target !== "string" || !value.target) {
    return false;
  }
  if (typeof value.expectsReply !== "boolean") {
    return false;
  }
  if (!isObject(value.payload)) {
    return false;
  }
  if (value.tabId !== null && !isFiniteInteger(value.tabId)) {
    return false;
  }
  if (!isFiniteInteger(value.frameId)) {
    return false;
  }
  if (value.expectsReply && (typeof value.id !== "string" || !value.id)) {
    return false;
  }
  return true;
}

export function isReplyEnvelope(value) {
  if (!isObject(value) || typeof value.ok !== "boolean") {
    return false;
  }
  if (typeof value.id !== "string") {
    return false;
  }
  if (value.ok) {
    return Object.prototype.hasOwnProperty.call(value, "result");
  }
  return typeof value.code === "string" && value.code && typeof value.error === "string";
}