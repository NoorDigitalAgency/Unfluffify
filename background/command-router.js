import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createSuccessEnvelope,
  isReplyEnvelope,
  isRequestEnvelope
} from "../common/message-protocol.js";

const backgroundCommandHandlers = new Map();

function getHandlerErrorMessage(error) {
  if (!error) {
    return "Background command failed";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "Background command failed";
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

export function registerBackgroundCommand(type, handler) {
  if (typeof type !== "string" || !type) {
    throw new TypeError("registerBackgroundCommand requires a non-empty command type");
  }
  if (typeof handler !== "function") {
    throw new TypeError("registerBackgroundCommand requires a handler function");
  }
  backgroundCommandHandlers.set(type, handler);
}

export function createCommandContext(message, sender) {
  const tabId = normalizeTabId(message, sender);
  const frameId = normalizeFrameId(message, sender);
  const requestId = typeof message.id === "string" ? message.id : "";
  return {
    message,
    sender,
    tabId,
    frameId,
    requestId,
    replyOk(result = {}) {
      return createSuccessEnvelope(message, result);
    },
    replyFail(code, error, details = {}) {
      return createFailureEnvelope(
        message,
        code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
        error || "Background command failed",
        details
      );
    }
  };
}

export async function dispatchBackgroundCommand(message, sender, options = {}) {
  if (!isRequestEnvelope(message)) {
    return createFailureEnvelope(
      message,
      MESSAGE_ERROR_CODES.INVALID_MESSAGE,
      "Invalid command envelope"
    );
  }

  const context = createCommandContext(message, sender);
  const requireTabForTypes = options.requireTabForTypes instanceof Set
    ? options.requireTabForTypes
    : new Set();

  if (requireTabForTypes.has(message.type) && !context.tabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for tab-scoped command",
      { type: message.type }
    );
  }

  const handler = backgroundCommandHandlers.get(message.type);
  if (!handler) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_NOT_FOUND,
      `No background handler registered for ${message.type}`
    );
  }

  try {
    const result = await handler(context, message.payload || {});
    if (isReplyEnvelope(result)) {
      return result;
    }
    return context.replyOk(result && typeof result === "object" ? result : {});
  } catch (error) {
    const errorCode = typeof error.code === "string" && error.code
      ? error.code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;
    return context.replyFail(errorCode, getHandlerErrorMessage(error), {
      type: message.type
    });
  }
}

export function __resetBackgroundCommandRegistryForTests() {
  backgroundCommandHandlers.clear();
}