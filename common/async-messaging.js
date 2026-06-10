import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createRequestEnvelope,
  isReplyEnvelope
} from "./message-protocol.js";

function getErrorMessage(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  return "";
}

function getRuntimeLastError() {
  if (!globalThis.chrome || !chrome.runtime) {
    return null;
  }
  return chrome.runtime.lastError || null;
}

function normalizeRequest(message, options = {}) {
  if (message && typeof message === "object" && typeof message.type === "string" && message.type) {
    return createRequestEnvelope(message.type, message.payload, {
      id: typeof message.id === "string" ? message.id : undefined,
      source: options.source,
      target: options.target,
      tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId) : undefined,
      frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : undefined,
      expectsReply: options.expectsReply
    });
  }
  throw new TypeError("Message request requires an object with a non-empty string type");
}

function toMessageRequestError(message, options, envelope) {
  const requestType = envelope && typeof envelope.type === "string" ? envelope.type : "";
  const normalizedMessage = getErrorMessage(message) || "Message request failed";
  return new MessageRequestError(normalizedMessage, {
    code: options.code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
    type: requestType,
    tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId) : null,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : null,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : null,
    details: options.details && typeof options.details === "object" ? options.details : {}
  });
}

function createTimeoutPromise(timeoutMs, envelope, context) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }
  const normalizedTimeoutMs = Math.trunc(timeoutMs);
  let timer = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(toMessageRequestError("Message request timed out", {
        code: MESSAGE_ERROR_CODES.TIMEOUT,
        tabId: context.tabId,
        frameId: context.frameId,
        timeoutMs: normalizedTimeoutMs,
        details: {
          requestId: envelope.id
        }
      }, envelope));
    }, normalizedTimeoutMs);
  });
  return {
    promise: timeoutPromise,
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    }
  };
}

function normalizeFailureResponse(response, envelope, context) {
  if (response && typeof response === "object" && response.ok === false) {
    const reply = isReplyEnvelope(response)
      ? response
      : createFailureEnvelope(envelope, MESSAGE_ERROR_CODES.HANDLER_FAILED, getErrorMessage(response.error), response.details);
    throw toMessageRequestError(reply.error || "Message request failed", {
      code: reply.code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
      tabId: context.tabId,
      frameId: context.frameId,
      timeoutMs: context.timeoutMs,
      details: {
        requestId: envelope.id,
        reply
      }
    }, envelope);
  }
  return response;
}

function normalizeSuccessResponse(response, envelope, context, options) {
  const normalized = normalizeFailureResponse(response, envelope, context);
  if (envelope.expectsReply !== false && typeof normalized === "undefined") {
    throw toMessageRequestError("Missing response for acknowledged request", {
      code: MESSAGE_ERROR_CODES.MISSING_RESPONSE,
      tabId: context.tabId,
      frameId: context.frameId,
      timeoutMs: context.timeoutMs,
      details: {
        requestId: envelope.id
      }
    }, envelope);
  }
  if (options.fullResponse) {
    return normalized;
  }
  if (normalized && typeof normalized === "object" && Object.prototype.hasOwnProperty.call(normalized, "result")) {
    return normalized.result;
  }
  return normalized;
}

export class MessageRequestError extends Error {
  constructor(message, options = {}) {
    super(message || "Message request failed");
    this.name = "MessageRequestError";
    this.code = typeof options.code === "string" && options.code
      ? options.code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;
    this.type = typeof options.type === "string" ? options.type : "";
    this.tabId = Number.isFinite(options.tabId) ? Math.trunc(options.tabId) : null;
    this.frameId = Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : null;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : null;
    this.details = options.details && typeof options.details === "object" ? options.details : {};
  }
}

export function requestWithChromeCallback(startSend, message, options = {}) {
  if (typeof startSend !== "function") {
    return Promise.reject(new TypeError("requestWithChromeCallback requires a startSend callback"));
  }

  const envelope = normalizeRequest(message, options);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : 0;
  const context = {
    tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId) : null,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : null,
    timeoutMs
  };

  const sendPromise = new Promise((resolve, reject) => {
    let settled = false;
    function settleReject(error) {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }
    function settleResolve(response) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(response);
    }
    try {
      const maybePromise = startSend(envelope, (response) => {
        const lastError = getRuntimeLastError();
        if (lastError) {
          settleReject(toMessageRequestError(getErrorMessage(lastError) || "Chrome runtime error", {
            code: MESSAGE_ERROR_CODES.RUNTIME_ERROR,
            tabId: context.tabId,
            frameId: context.frameId,
            timeoutMs,
            details: {
              requestId: envelope.id,
              lastError: getErrorMessage(lastError)
            }
          }, envelope));
          return;
        }
        settleResolve(response);
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise
          .then((response) => {
            settleResolve(response);
          })
          .catch((error) => {
            settleReject(toMessageRequestError(error, {
              code: MESSAGE_ERROR_CODES.RUNTIME_ERROR,
              tabId: context.tabId,
              frameId: context.frameId,
              timeoutMs,
              details: {
                requestId: envelope.id
              }
            }, envelope));
          });
      }
    } catch (error) {
      settleReject(toMessageRequestError(error, {
        code: MESSAGE_ERROR_CODES.RUNTIME_ERROR,
        tabId: context.tabId,
        frameId: context.frameId,
        timeoutMs,
        details: {
          requestId: envelope.id
        }
      }, envelope));
    }
  });

  const timeoutHandle = createTimeoutPromise(timeoutMs, envelope, context);

  const racedPromise = timeoutHandle
    ? Promise.race([sendPromise, timeoutHandle.promise])
    : sendPromise;

  return racedPromise
    .then((response) => normalizeSuccessResponse(response, envelope, context, options))
    .finally(() => {
      if (timeoutHandle) {
        timeoutHandle.clear();
      }
    });
}

export function requestRuntime(message, options = {}) {
  return requestWithChromeCallback((envelope, callback) => {
    return chrome.runtime.sendMessage(envelope, callback);
  }, message, {
    ...options,
    target: options.target || "background"
  });
}

export function requestTab(tabId, message, options = {}) {
  const normalizedTabId = Number.isFinite(tabId) ? Math.trunc(tabId) : 0;
  if (!normalizedTabId) {
    return Promise.reject(new MessageRequestError("Invalid tab id for tab request", {
      code: MESSAGE_ERROR_CODES.INVALID_TAB,
      type: message && typeof message.type === "string" ? message.type : "",
      tabId: normalizedTabId,
      frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : 0,
      timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs) : null
    }));
  }
  const frameId = Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : 0;
  return requestWithChromeCallback((envelope, callback) => {
    return chrome.tabs.sendMessage(normalizedTabId, envelope, { frameId }, callback);
  }, message, {
    ...options,
    tabId: normalizedTabId,
    frameId,
    target: options.target || "content"
  });
}

export function requestContent(tabId, message, options = {}) {
  return requestTab(tabId, message, {
    ...options,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId) : 0,
    target: options.target || "content"
  });
}