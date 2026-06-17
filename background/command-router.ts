// @ts-nocheck
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
  "sender-or-message",
  "message",
  "sender",
  "none"
]);

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value);
}

function isExtensionUrl(value) {
  return isNonEmptyString(value) && /^chrome-extension:\/\//.test(value);
}

function normalizeMessageSource(message) {
  return isNonEmptyString(message && message.source)
    ? message.source
    : "";
}

function resolveSourceFromSender(sender) {
  if (
    isExtensionUrl(sender && sender.url) ||
    isExtensionUrl(sender && sender.origin) ||
    isExtensionUrl(sender && sender.tab && sender.tab.url)
  ) {
    return "popup";
  }

  if (Number.isFinite(sender && sender.tab && sender.tab.id)) {
    return "content";
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

function normalizePositiveTabId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function resolveTabId(message, sender, tabIdPolicy = "message-or-sender") {
  if (tabIdPolicy === "none") {
    return { tabId: 0, tabIdSource: "none" };
  }
  const messageTabId = normalizePositiveTabId(message && message.tabId);
  const senderTabId = normalizePositiveTabId(sender && sender.tab && sender.tab.id);
  const candidates = tabIdPolicy === "sender-or-message"
    ? [
        { tabId: senderTabId, tabIdSource: "sender" },
        { tabId: messageTabId, tabIdSource: "message" }
      ]
    : tabIdPolicy === "sender"
      ? [{ tabId: senderTabId, tabIdSource: "sender" }]
      : tabIdPolicy === "message"
        ? [{ tabId: messageTabId, tabIdSource: "message" }]
        : [
            { tabId: messageTabId, tabIdSource: "message" },
            { tabId: senderTabId, tabIdSource: "sender" }
          ];
  for (const candidate of candidates) {
    if (candidate.tabId) {
      return candidate;
    }
  }
  return { tabId: 0, tabIdSource: "none" };
}

function isSenderPolicyTabSpoofAttempt(message, sender, context) {
  if (!context || context.policy !== "sender") {
    return false;
  }
  if (context.source !== "content" && context.source !== "page") {
    return false;
  }
  const messageTabId = normalizePositiveTabId(message && message.tabId);
  if (!messageTabId) {
    return false;
  }
  const senderTabId = normalizePositiveTabId(sender && sender.tab && sender.tab.id);
  return !senderTabId || messageTabId !== senderTabId;
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
  const policy = TAB_ID_POLICIES.has(options.tabIdPolicy)
    ? options.tabIdPolicy
    : "message-or-sender";
  const { tabId, tabIdSource } = resolveTabId(message, sender, policy);
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
    tabIdSource,
    policy,
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

  if (isSenderPolicyTabSpoofAttempt(message, sender, context)) {
    return notifyDispatched(options, context, context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_MESSAGE,
      "Sender-scoped command cannot use message tab id",
      {
        type: message.type,
        source: context.source,
        tabIdSource: context.tabIdSource
      }
    ));
  }

  const requiresTab = context.policy !== "none" && (commandOptions.requireTab || requireTabForTypes.has(message.type));
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