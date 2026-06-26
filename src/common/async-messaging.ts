import {
  MESSAGE_ERROR_CODES,
  createFailureEnvelope,
  createRequestEnvelope,
  isReplyEnvelope
} from "./message-protocol";
import { sendRequestEnvelope } from "./extension-messaging";

type MessageLike = {
  id?: string;
  type?: string;
  payload?: unknown;
};

type RequestOptions = {
  source?: string;
  target?: string;
  tabId?: number | null;
  frameId?: number | null;
  expectsReply?: boolean;
  timeoutMs?: number | null;
  code?: string;
  details?: Record<string, unknown>;
  fullResponse?: boolean;
};

type RequestEnvelopeLike = ReturnType<typeof createRequestEnvelope>;

type RequestContext = {
  tabId: number | null;
  frameId: number | null;
  timeoutMs: number;
};

type MessageRequestErrorOptions = {
  code?: string;
  type?: string;
  tabId?: number | null;
  frameId?: number | null;
  timeoutMs?: number | null;
  details?: Record<string, unknown>;
};

type TimeoutHandle = {
  promise: Promise<never>;
  clear: () => void;
};

type BrowserTimerApi = Pick<WindowOrWorkerGlobalScope, "setTimeout" | "clearTimeout">;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getErrorMessage(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (isObject(value) && typeof value.message === "string") {
    return value.message;
  }
  return "";
}

function normalizeRequest(message: unknown, options: RequestOptions = {}): RequestEnvelopeLike {
  if (isObject(message) && typeof message.type === "string" && message.type) {
    const request = message as MessageLike;
    return createRequestEnvelope(request.type as string, request.payload, {
      id: typeof request.id === "string" ? request.id : undefined,
      source: options.source,
      target: options.target,
      tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId as number) : undefined,
      frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : undefined,
      expectsReply: options.expectsReply
    });
  }
  throw new TypeError("Message request requires an object with a non-empty string type");
}

function toMessageRequestError(
  message: unknown,
  options: RequestOptions,
  envelope: RequestEnvelopeLike
): MessageRequestError {
  const requestType = typeof envelope.type === "string" ? envelope.type : "";
  const normalizedMessage = getErrorMessage(message) || "Message request failed";
  return new MessageRequestError(normalizedMessage, {
    code: options.code || MESSAGE_ERROR_CODES.HANDLER_FAILED,
    type: requestType,
    tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId as number) : null,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : null,
    timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs as number) : null,
    details: isObject(options.details) ? options.details : {}
  });
}

function createTimeoutPromise(
  timeoutMs: number,
  envelope: RequestEnvelopeLike,
  context: RequestContext
): TimeoutHandle | null {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }
  const normalizedTimeoutMs = Math.trunc(timeoutMs);
  const timerApi = globalThis as BrowserTimerApi;
  let timer = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = timerApi.setTimeout(() => {
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
    clear(): void {
      if (timer) {
        timerApi.clearTimeout(timer);
        timer = 0;
      }
    }
  };
}

function normalizeFailureResponse(
  response: unknown,
  envelope: RequestEnvelopeLike,
  context: RequestContext
): unknown {
  if (isObject(response) && response.ok === false) {
    const reply = isReplyEnvelope(response)
      ? response
      : createFailureEnvelope(
        envelope,
        MESSAGE_ERROR_CODES.HANDLER_FAILED,
        getErrorMessage(isObject(response) ? response.error : ""),
        isObject(response) ? response.details : {}
      );

    const replyError = "error" in reply && typeof reply.error === "string"
      ? reply.error
      : "Message request failed";
    const replyCode = "code" in reply && typeof reply.code === "string"
      ? reply.code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;

    throw toMessageRequestError(replyError, {
      code: replyCode,
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

function normalizeSuccessResponse(
  response: unknown,
  envelope: RequestEnvelopeLike,
  context: RequestContext,
  options: RequestOptions
): unknown {
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
  if (isObject(normalized) && Object.prototype.hasOwnProperty.call(normalized, "result")) {
    return normalized.result;
  }
  return normalized;
}

export class MessageRequestError extends Error {
  code: string;
  type: string;
  tabId: number | null;
  frameId: number | null;
  timeoutMs: number | null;
  details: Record<string, unknown>;

  constructor(message: string, options: MessageRequestErrorOptions = {}) {
    super(message || "Message request failed");
    this.name = "MessageRequestError";
    this.code = typeof options.code === "string" && options.code
      ? options.code
      : MESSAGE_ERROR_CODES.HANDLER_FAILED;
    this.type = typeof options.type === "string" ? options.type : "";
    this.tabId = Number.isFinite(options.tabId) ? Math.trunc(options.tabId as number) : null;
    this.frameId = Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : null;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs as number) : null;
    this.details = isObject(options.details) ? options.details : {};
  }
}

export function requestWithChromeCallback(
  startSend: (envelope: RequestEnvelopeLike) => Promise<unknown>,
  message: unknown,
  options: RequestOptions = {}
): Promise<unknown> {
  if (typeof startSend !== "function") {
    return Promise.reject(new TypeError("requestWithChromeCallback requires a startSend callback"));
  }

  const envelope = normalizeRequest(message, options);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs as number) : 0;
  const context: RequestContext = {
    tabId: Number.isFinite(options.tabId) ? Math.trunc(options.tabId as number) : null,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : null,
    timeoutMs
  };

  const sendPromise = Promise.resolve()
    .then(() => startSend(envelope))
    .catch((error) => {
      throw toMessageRequestError(error, {
        code: MESSAGE_ERROR_CODES.RUNTIME_ERROR,
        tabId: context.tabId,
        frameId: context.frameId,
        timeoutMs,
        details: {
          requestId: envelope.id
        }
      }, envelope);
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

export function requestRuntime(message: unknown, options: RequestOptions = {}): Promise<unknown> {
  return requestWithChromeCallback((envelope) => {
    return sendRequestEnvelope(envelope);
  }, message, {
    ...options,
    target: options.target || "background"
  });
}

export function requestTab(tabId: number | null, message: unknown, options: RequestOptions = {}): Promise<unknown> {
  const normalizedTabId = Number.isFinite(tabId) ? Math.trunc(tabId as number) : 0;
  if (!normalizedTabId) {
    const request = isObject(message) ? (message as MessageLike) : null;
    return Promise.reject(new MessageRequestError("Invalid tab id for tab request", {
      code: MESSAGE_ERROR_CODES.INVALID_TAB,
      type: typeof request?.type === "string" ? request.type : "",
      tabId: normalizedTabId,
      frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : 0,
      timeoutMs: Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs as number) : null
    }));
  }
  const frameId = Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : 0;
  return requestWithChromeCallback((envelope) => {
    return sendRequestEnvelope({
      ...envelope,
      tabId: normalizedTabId,
      frameId,
    });
  }, message, {
    ...options,
    tabId: normalizedTabId,
    frameId,
    target: options.target || "content"
  });
}

export function requestContent(tabId: number | null, message: unknown, options: RequestOptions = {}): Promise<unknown> {
  return requestTab(tabId, message, {
    ...options,
    frameId: Number.isFinite(options.frameId) ? Math.trunc(options.frameId as number) : 0,
    target: options.target || "content"
  });
}
