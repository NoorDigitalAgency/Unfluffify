import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createSuccessEnvelope,
  isReplyEnvelope,
  isRequestEnvelope
} from "../common/message-protocol";
import type { Browser } from "../common/browser";

type ContentCommandContext = {
  message: unknown;
  sender: Browser.runtime.MessageSender | undefined;
  tabId: number;
  frameId: number;
  pageUrl: string;
  mode: string;
  requestId: string;
  replyOk: (result?: Record<string, unknown>) => unknown;
  replyFail: (code: string, error: string, details?: Record<string, unknown>) => unknown;
};

type ContentCommandHandler = (context: ContentCommandContext, payload: unknown) => unknown;

const contentCommandHandlers = new Map<string, ContentCommandHandler>();

function getErrorMessage(error: unknown): string {
  if (!error) {
    return "Content command failed";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Content command failed";
}

function normalizeTabId(message: unknown, sender: Browser.runtime.MessageSender | undefined): number {
  const messageRecord = (message || {}) as Record<string, unknown>;
  const candidates = [
    messageRecord.tabId,
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

function normalizeFrameId(message: unknown, sender: Browser.runtime.MessageSender | undefined): number {
  const messageRecord = (message || {}) as Record<string, unknown>;
  if (Number.isFinite(messageRecord.frameId)) {
    return Math.trunc(messageRecord.frameId as number);
  }
  const senderFrameId = sender?.frameId;
  if (Number.isFinite(senderFrameId)) {
    return Math.trunc(senderFrameId as number);
  }
  return 0;
}

export function registerContentCommand(type: string, handler: ContentCommandHandler): void {
  if (typeof type !== "string" || !type) {
    throw new TypeError("registerContentCommand requires a non-empty command type");
  }
  if (typeof handler !== "function") {
    throw new TypeError("registerContentCommand requires a handler function");
  }
  contentCommandHandlers.set(type, handler);
}

export function dispatchContentCommand(
  message: unknown,
  sender: Browser.runtime.MessageSender | undefined,
  options: { pageUrl?: () => string; mode?: () => string } = {}
): Promise<unknown> {
  if (!isRequestEnvelope(message)) {
    return Promise.resolve(
      createFailureEnvelope(message, MESSAGE_ERROR_CODES.INVALID_MESSAGE, "Invalid command envelope")
    );
  }

  const messageRecord = message as Record<string, unknown>;
  const context: ContentCommandContext = {
    message,
    sender,
    tabId: normalizeTabId(message, sender),
    frameId: normalizeFrameId(message, sender),
    pageUrl: typeof options.pageUrl === "function" ? options.pageUrl() : "",
    mode: typeof options.mode === "function" ? options.mode() : "",
    requestId: typeof messageRecord.id === "string" ? messageRecord.id : "",
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

  const commandType = typeof messageRecord.type === "string" ? messageRecord.type : "";
  const handler = contentCommandHandlers.get(commandType);
  if (!handler) {
    return Promise.resolve(
      context.replyFail(
        MESSAGE_ERROR_CODES.HANDLER_NOT_FOUND,
        `No content handler registered for ${commandType}`
      )
    );
  }

  return Promise.resolve()
    .then(() => handler(context, messageRecord.payload || {}))
    .then((result) => {
      if (isReplyEnvelope(result)) {
        return result;
      }
      return context.replyOk(result && typeof result === "object" ? (result as Record<string, unknown>) : {});
    })
    .catch((error) => {
      const errorCodeCandidate = (error as { code?: unknown } | null | undefined)?.code;
      const errorCode = typeof errorCodeCandidate === "string" && errorCodeCandidate
        ? errorCodeCandidate
        : MESSAGE_ERROR_CODES.HANDLER_FAILED;
      return context.replyFail(errorCode, getErrorMessage(error), {
        type: commandType
      });
    });
}

export function __resetContentCommandRegistryForTests() {
  contentCommandHandlers.clear();
}