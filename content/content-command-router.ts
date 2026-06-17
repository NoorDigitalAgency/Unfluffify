// @ts-nocheck
import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createSuccessEnvelope,
  isReplyEnvelope,
  isRequestEnvelope
} from "../common/message-protocol.js";

const contentCommandHandlers = new Map();

function getErrorMessage(error) {
  if (!error) {
    return "Content command failed";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "Content command failed";
}

function normalizeTabId(message, sender) {
  const candidates = [
    message && message.tabId,
    sender && sender.tab && sender.tab.id
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      const normalized = Math.trunc(numeric);
      if (normalized > 0) {
        return normalized;
      }
    }
  }
  return 0;
}

function normalizeFrameId(message, sender) {
  if (Number.isFinite(message && message.frameId)) {
    return Math.trunc(message.frameId);
  }
  if (Number.isFinite(sender && sender.frameId)) {
    return Math.trunc(sender.frameId);
  }
  return 0;
}

export function registerContentCommand(type, handler) {
  if (typeof type !== "string" || !type) {
    throw new TypeError("registerContentCommand requires a non-empty command type");
  }
  if (typeof handler !== "function") {
    throw new TypeError("registerContentCommand requires a handler function");
  }
  contentCommandHandlers.set(type, handler);
}

export function dispatchContentCommand(message, sender, options = {}) {
  if (!isRequestEnvelope(message)) {
    return Promise.resolve(
      createFailureEnvelope(message, MESSAGE_ERROR_CODES.INVALID_MESSAGE, "Invalid command envelope")
    );
  }

  const context = {
    message,
    sender,
    tabId: normalizeTabId(message, sender),
    frameId: normalizeFrameId(message, sender),
    pageUrl: typeof options.pageUrl === "function" ? options.pageUrl() : "",
    mode: typeof options.mode === "function" ? options.mode() : "",
    requestId: typeof message.id === "string" ? message.id : "",
    replyOk(result = {}) {
      return createSuccessEnvelope(message, result);
    },
    replyFail(code, error, details = {}) {
      return createFailureEnvelope(
        message,
        code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
        error || "Content command failed",
        details
      );
    }
  };

  const handler = contentCommandHandlers.get(message.type);
  if (!handler) {
    return Promise.resolve(
      context.replyFail(
        MESSAGE_ERROR_CODES.HANDLER_NOT_FOUND,
        `No content handler registered for ${message.type}`
      )
    );
  }

  return Promise.resolve()
    .then(() => handler(context, message.payload || {}))
    .then((result) => {
      if (isReplyEnvelope(result)) {
        return result;
      }
      return context.replyOk(result && typeof result === "object" ? result : {});
    })
    .catch((error) => {
      const errorCode = typeof error.code === "string" && error.code
        ? error.code
        : MESSAGE_ERROR_CODES.HANDLER_FAILED;
      return context.replyFail(errorCode, getErrorMessage(error), {
        type: message.type
      });
    });
}

export function __resetContentCommandRegistryForTests() {
  contentCommandHandlers.clear();
}