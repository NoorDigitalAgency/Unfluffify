import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createSuccessEnvelope,
  isReplyEnvelope,
  isRequestEnvelope
} from "../common/message-protocol";
import type { Browser } from "../common/browser";

type RegistrationOptions = {
  allowedSources: Set<string> | null;
  tabIdPolicy: string;
  requireTab: boolean;
};

type CommandMessage = Record<string, unknown>;
type CommandSender = Browser.runtime.MessageSender;
type CommandHandler = (context: CommandContext, payload: Record<string, unknown>) => unknown;
type CommandContext = ReturnType<typeof createCommandContext>;

const backgroundCommandHandlers = new Map<string, { handler: CommandHandler; options: RegistrationOptions }>();
const TAB_ID_POLICIES = new Set([
  "message-or-sender",
  "sender-or-message",
  "message",
  "sender",
  "none"
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value);
}

function isExtensionUrl(value: unknown) {
  return isNonEmptyString(value) && /^chrome-extension:\/\//.test(value as string);
}

function normalizeMessageSource(message: CommandMessage) {
  const source = message ? message.source : undefined;
  return isNonEmptyString(source) ? source : "";
}

function resolveSourceFromSender(sender: CommandSender) {
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

function resolveTrustedSource(message: CommandMessage, sender: CommandSender, options: Record<string, unknown> = {}) {
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

function normalizeAllowedSources(value: unknown): Set<string> | null {
  if (!value) {
    return null;
  }
  const input = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : [value];
  const allowedSources = new Set<string>();
  for (const candidate of input) {
    if (isNonEmptyString(candidate)) {
      allowedSources.add(candidate);
    }
  }
  return allowedSources.size ? allowedSources : null;
}

function normalizeRegistrationOptions(options: Record<string, unknown> = {}): RegistrationOptions {
  const tabIdPolicyCandidate = options.tabIdPolicy;
  const tabIdPolicyValue = typeof tabIdPolicyCandidate === "string"
    ? tabIdPolicyCandidate
    : "";
  const allowedSources = normalizeAllowedSources(options.allowedSources);
  const tabIdPolicy = TAB_ID_POLICIES.has(tabIdPolicyValue)
    ? tabIdPolicyValue
    : "message-or-sender";
  const requireTab = options.requireTab === true;
  return {
    allowedSources,
    tabIdPolicy,
    requireTab
  };
}

function getHandlerErrorMessage(error: unknown) {
  if (!error) {
    return "Background command failed";
  }
  if (typeof error === "string") {
    return error;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message) {
    return message;
  }
  return "Background command failed";
}

function normalizeFrameId(message: CommandMessage, sender: CommandSender) {
  const messageFrameId = message ? message.frameId : undefined;
  if (typeof messageFrameId === "number" && Number.isFinite(messageFrameId)) {
    return Math.trunc(messageFrameId);
  }
  const senderFrameId = sender ? sender.frameId : undefined;
  if (typeof senderFrameId === "number" && Number.isFinite(senderFrameId)) {
    return Math.trunc(senderFrameId);
  }
  return 0;
}

function normalizePositiveTabId(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function resolveTabId(message: CommandMessage, sender: CommandSender, tabIdPolicy = "message-or-sender") {
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

function isSenderPolicyTabSpoofAttempt(message: CommandMessage, sender: CommandSender, context: CommandContext) {
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

export function registerBackgroundCommand(
  type: string,
  handler: CommandHandler,
  options: Record<string, unknown> = {}
) {
  if (typeof type !== "string" || !type) {
    throw new TypeError("registerBackgroundCommand requires a non-empty command type");
  }
  if (typeof handler !== "function") {
    throw new TypeError("registerBackgroundCommand requires a handler function");
  }
  backgroundCommandHandlers.set(type, {
    handler,
    options: normalizeRegistrationOptions(options)
  });
}

export function createCommandContext(message: CommandMessage, sender: CommandSender, options: Record<string, unknown> = {}) {
  const tabIdPolicyCandidate = options.tabIdPolicy;
  const tabIdPolicyValue = typeof tabIdPolicyCandidate === "string"
    ? tabIdPolicyCandidate
    : "";
  const policy = TAB_ID_POLICIES.has(tabIdPolicyValue)
    ? tabIdPolicyValue
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
    replyOk(result: Record<string, unknown> = {}) {
      return createSuccessEnvelope(message, result);
    },
    replyFail(code: string, error: unknown, details: Record<string, unknown> = {}) {
      return createFailureEnvelope(
        message,
        code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
        error || "Background command failed",
        details
      );
    }
  };
}

function notifyDispatched(options: Record<string, unknown> | undefined, context: CommandContext | null, reply: unknown) {
  if (options && typeof options.onDispatched === "function") {
    try {
      options.onDispatched(context, reply);
    } catch {
      // Notification callback errors must never alter command routing.
    }
  }
  return reply;
}

export async function dispatchBackgroundCommand(message: unknown, sender: CommandSender, options: Record<string, unknown> = {}) {
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
    return notifyDispatched(options, context, context.replyOk(result && typeof result === "object" ? result as Record<string, unknown> : {}));
  } catch (error: unknown) {
    const errorCode = isNonEmptyString((error as { code?: unknown })?.code)
      ? (error as { code: string }).code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;
    return notifyDispatched(options, context, context.replyFail(errorCode, getHandlerErrorMessage(error), {
      type: message.type
    }));
  }
}

export function __resetBackgroundCommandRegistryForTests() {
  backgroundCommandHandlers.clear();
}