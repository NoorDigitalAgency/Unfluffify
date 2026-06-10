import { MESSAGE_ERROR_CODES } from "../common/message-protocol.js";
import {
  PAGE_WORLD_COMMANDS,
  PAGE_WORLD_RELAY_CHANNEL,
  PAGE_WORLD_RELAY_MESSAGE_KINDS,
  isPageWorldRelayCommand
} from "../common/page-world-protocol.js";

const DEFAULT_RELAY_TIMEOUT_MS = 1200;
const FALLBACK_REQUEST_PREFIX = "uf-page-world";

let relaySession = null;
let relayRequestCounter = 0;
let relayListenerInstalled = false;
let initializationInFlight = null;
const pendingRelayRequests = new Map();

function createRelayError(code, message, details = {}) {
  const error = new Error(typeof message === "string" && message ? message : "Page-world relay failed");
  error.code = typeof code === "string" && code ? code : MESSAGE_ERROR_CODES.HANDLER_FAILED;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function getPageWindow() {
  if (typeof window === "undefined" || typeof window.postMessage !== "function") {
    return null;
  }
  return window;
}

function createRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  relayRequestCounter += 1;
  return `${FALLBACK_REQUEST_PREFIX}-${Date.now()}-${relayRequestCounter}`;
}

function normalizeTimeoutMs(value, fallback = DEFAULT_RELAY_TIMEOUT_MS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.trunc(numeric));
}

function clearPendingRelayRequest(id) {
  const pending = pendingRelayRequests.get(id);
  if (!pending) {
    return null;
  }
  pendingRelayRequests.delete(id);
  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  return pending;
}

function handleRelayMessage(event) {
  const pageWindow = getPageWindow();
  if (!pageWindow || !event || event.source !== pageWindow) {
    return;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.channel !== PAGE_WORLD_RELAY_CHANNEL || data.kind !== PAGE_WORLD_RELAY_MESSAGE_KINDS.RESPONSE) {
    return;
  }
  if (typeof data.id !== "string" || !data.id) {
    return;
  }

  const pending = clearPendingRelayRequest(data.id);
  if (!pending) {
    return;
  }

  if (pending.nonce && data.nonce !== pending.nonce) {
    pending.reject(createRelayError(
      MESSAGE_ERROR_CODES.INVALID_MESSAGE,
      "Page-world relay response nonce mismatch",
      { expectedNonce: pending.nonce }
    ));
    return;
  }

  if (data.ok) {
    pending.resolve(data.result && typeof data.result === "object" ? data.result : {});
    return;
  }

  pending.reject(createRelayError(
    data.code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
    data.error || "Page-world relay request failed",
    data.details && typeof data.details === "object" ? data.details : {}
  ));
}

function ensureRelayListener() {
  if (relayListenerInstalled) {
    return;
  }
  const pageWindow = getPageWindow();
  if (!pageWindow || typeof pageWindow.addEventListener !== "function") {
    return;
  }
  pageWindow.addEventListener("message", handleRelayMessage);
  relayListenerInstalled = true;
}

function sendRelayRequest(command, payload = {}, options = {}) {
  const pageWindow = getPageWindow();
  if (!pageWindow) {
    return Promise.reject(createRelayError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Page-world relay is unavailable"
    ));
  }
  if (!relaySession || typeof relaySession.nonce !== "string" || !relaySession.nonce) {
    return Promise.reject(createRelayError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Page-world relay session is not initialized"
    ));
  }

  const timeoutMs = normalizeTimeoutMs(options.timeoutMs, relaySession.timeoutMs || DEFAULT_RELAY_TIMEOUT_MS);
  const requestId = createRequestId();
  const request = {
    channel: PAGE_WORLD_RELAY_CHANNEL,
    kind: PAGE_WORLD_RELAY_MESSAGE_KINDS.REQUEST,
    id: requestId,
    nonce: relaySession.nonce,
    command,
    payload: payload && typeof payload === "object" ? payload : {}
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRelayRequests.delete(requestId);
      reject(createRelayError(
        MESSAGE_ERROR_CODES.TIMEOUT,
        `Page-world relay timed out for ${command}`,
        { command, timeoutMs }
      ));
    }, timeoutMs);

    pendingRelayRequests.set(requestId, {
      resolve,
      reject,
      timer,
      nonce: relaySession.nonce
    });

    try {
      pageWindow.postMessage(request, "*");
    } catch (error) {
      clearPendingRelayRequest(requestId);
      reject(createRelayError(
        MESSAGE_ERROR_CODES.RUNTIME_ERROR,
        (error && error.message) || "Failed to post page-world relay request",
        { command }
      ));
    }
  });
}

export async function initializePageWorldRelay(options = {}) {
  const pageWindow = getPageWindow();
  if (!pageWindow) {
    throw createRelayError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Page-world relay is unavailable"
    );
  }
  ensureRelayListener();
  if (!relayListenerInstalled) {
    throw createRelayError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Page-world relay listener is unavailable"
    );
  }

  if (relaySession && relaySession.ready) {
    return {
      ok: true,
      nonce: relaySession.nonce
    };
  }

  // If initialization is already in flight, return the same promise to avoid
  // overwriting relaySession/nonce before the first ARM handshake completes
  if (initializationInFlight) {
    return initializationInFlight;
  }

  const timeoutMs = normalizeTimeoutMs(options.timeoutMs, DEFAULT_RELAY_TIMEOUT_MS);
  
  // Store the initialization promise so concurrent callers get the same promise
  initializationInFlight = (async () => {
    relaySession = {
      nonce: createRequestId(),
      timeoutMs,
      ready: false
    };

    try {
      await sendRelayRequest(PAGE_WORLD_COMMANDS.ARM, {}, { timeoutMs });
      relaySession.ready = true;
      return {
        ok: true,
        nonce: relaySession.nonce
      };
    } catch (error) {
      relaySession = null;
      throw error;
    } finally {
      initializationInFlight = null;
    }
  })();

  return initializationInFlight;
}

export function isPageWorldRelayReady() {
  return Boolean(relaySession && relaySession.ready);
}

export async function requestPageWorldCommand(command, payload = {}, options = {}) {
  if (!isPageWorldRelayCommand(command)) {
    throw createRelayError(
      MESSAGE_ERROR_CODES.HANDLER_NOT_FOUND,
      `Unsupported page-world relay command: ${command}`,
      { command }
    );
  }
  if (!relaySession || !relaySession.ready) {
    throw createRelayError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Page-world relay session is not ready",
      { command }
    );
  }
  return sendRelayRequest(command, payload, options);
}

export function __resetPageWorldRelayForTests() {
  for (const id of Array.from(pendingRelayRequests.keys())) {
    const pending = clearPendingRelayRequest(id);
    if (pending) {
      pending.reject(createRelayError(
        MESSAGE_ERROR_CODES.RUNTIME_ERROR,
        "Relay reset while request was pending"
      ));
    }
  }
  relaySession = null;
  initializationInFlight = null;
  relayRequestCounter = 0;
  if (relayListenerInstalled && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
    window.removeEventListener("message", handleRelayMessage);
  }
  relayListenerInstalled = false;
}