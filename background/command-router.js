import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createSuccessEnvelope,
  isReplyEnvelope,
  isRequestEnvelope
} from "../common/message-protocol.js";

const backgroundCommandHandlers = new Map();
const TAB_ID_POLICIES = new Set([
  "message-or-sender",
  "message",
  "sender"
]);

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value);
}

function normalizeMessageSource(message) {
  return isNonEmptyString(message && message.source)
    ? message.source
    : "";
}

function resolveSourceFromSender(sender) {
  if (Number.isFinite(sender && sender.tab && sender.tab.id)) {
    return "content";
  }

  const senderUrl = isNonEmptyString(sender && sender.url)
    ? sender.url
    : "";
  if (!senderUrl) {
    return "";
  }

  if (/\/popup\.html(?:[?#]|$)/.test(senderUrl)) {
    return "popup";
  }

  if (/^chrome-extension:\/\//.test(senderUrl)) {
    return "popup";
  }

  return "";
}

function resolveTrustedSource(message, sender, options = {}) {
  if (options && typeof options.resolveTrustedSource === "function") {
    const resolved = options.resolveTrustedSource(message, sender);
    if (isNonEmptyString(resolved)) {
      return resolved;
    }
  }
  const trustedFromSender = resolveSourceFromSender(sender);
  if (trustedFromSender) {
    return trustedFromSender;
  }
  return normalizeMessageSource(message);
}

function normalizeAllowedSources(value) {
  if (!value) {
    return null;
  }
  const input = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : [value];
  const allowedSources = new Set();
  for (const candidate of input) {
    if (isNonEmptyString(candidate)) {
      allowedSources.add(candidate);
    }
  }
  return allowedSources.size ? allowedSources : null;
}

function normalizeRegistrationOptions(options = {}) {
  const allowedSources = normalizeAllowedSources(options.allowedSources);
  const tabIdPolicy = TAB_ID_POLICIES.has(options.tabIdPolicy)
    ? options.tabIdPolicy
    : "message-or-sender";
  const requireTab = options.requireTab === true;
  return {
    allowedSources,
    tabIdPolicy,
    requireTab
  };
}

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

function normalizeTabId(message, sender, tabIdPolicy = "message-or-sender") {
  const candidates = [];
  if (tabIdPolicy === "message" || tabIdPolicy === "message-or-sender") {
    candidates.push(message && message.tabId);
  }
  if (tabIdPolicy === "sender" || tabIdPolicy === "message-or-sender") {
    candidates.push(sender && sender.tab && sender.tab.id);
  }
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
  const options = arguments.length >= 3 ? arguments[2] : {};
  backgroundCommandHandlers.set(type, {
    handler,
    options: normalizeRegistrationOptions(options)
  });
}

export function createCommandContext(message, sender, options = {}) {
  const tabId = normalizeTabId(message, sender, options.tabIdPolicy);
  const frameId = normalizeFrameId(message, sender);
  const requestId = typeof message.id === "string" ? message.id : "";
  const source = isNonEmptyString(options.source)
    ? options.source
    : normalizeMessageSource(message);
  return {
    message,
    sender,
    source,
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

function notifyDispatched(options, context, reply) {
  if (options && typeof options.onDispatched === "function") {
    try {
      options.onDispatched(context, reply);
    } catch {
      // Notification callback errors must never alter command routing.
    }
  }
  return reply;
}

export async function dispatchBackgroundCommand(message, sender, options = {}) {
  if (!isRequestEnvelope(message)) {
    return notifyDispatched(options, null, createFailureEnvelope(
      message,
      MESSAGE_ERROR_CODES.INVALID_MESSAGE,
      "Invalid command envelope"
    ));
  }
  const requireTabForTypes = options.requireTabForTypes instanceof Set
    ? options.requireTabForTypes
    : new Set();

  const registration = backgroundCommandHandlers.get(message.type);
  const handler = registration && typeof registration.handler === "function"
    ? registration.handler
    : typeof registration === "function"
      ? registration
      : null;
  const commandOptions = registration && registration.options && typeof registration.options === "object"
    ? registration.options
    : normalizeRegistrationOptions();
  const trustedSource = resolveTrustedSource(message, sender, options);

  const context = createCommandContext(message, sender, {
    tabIdPolicy: commandOptions.tabIdPolicy,
    source: trustedSource
  });

  if (commandOptions.allowedSources && !commandOptions.allowedSources.has(context.source)) {
    return notifyDispatched(options, context, context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_MESSAGE,
      "Disallowed source for background command",
      {
        type: message.type,
        source: context.source,
        requestedSource: normalizeMessageSource(message)
      }
    ));
  }

  const requiresTab = commandOptions.requireTab || requireTabForTypes.has(message.type);
  if (requiresTab && !context.tabId) {
    return notifyDispatched(options, context, context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for tab-scoped command",
      { type: message.type }
    ));
  }

  if (!handler) {
    return notifyDispatched(options, context, context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_NOT_FOUND,
      `No background handler registered for ${message.type}`
    ));
  }

  try {
    const result = await handler(context, message.payload || {});
    if (isReplyEnvelope(result)) {
      return notifyDispatched(options, context, result);
    }
    return notifyDispatched(options, context, context.replyOk(result && typeof result === "object" ? result : {}));
  } catch (error) {
    const errorCode = typeof error.code === "string" && error.code
      ? error.code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;
    return notifyDispatched(options, context, context.replyFail(errorCode, getHandlerErrorMessage(error), {
      type: message.type
    }));
  }
}

export function __resetBackgroundCommandRegistryForTests() {
  backgroundCommandHandlers.clear();
}