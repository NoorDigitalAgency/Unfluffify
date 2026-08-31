import {
  BUS_FRAME_KIND,
  BusFrameSchema,
  type BusContractDefinition,
  type BusFailure,
  type BusFrame,
  type BusRealm,
  type InferCommandRequest,
  type InferCommandResponse,
  type InferEventPayload,
} from "./contract";

export type BusReply<Data> =
  | Readonly<{ ok: true; data: Data }>
  | Readonly<{ ok: false; failure: BusFailure }>;

export type BusHandlerMeta = Readonly<{
  id: string;
  seq: number;
  source: BusRealm;
  sourceInstance?: string;
}>;

export type CommandHandler<Request, Response> = (
  payload: Request,
  meta: BusHandlerMeta,
) => Response | Promise<Response>;

export type EventHandler<Payload> = (payload: Payload, meta: BusHandlerMeta) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface Transport {
  send(frame: BusFrame): Promise<BusFrame | void>;
  onReceive(handler: (frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void): Unsubscribe;
}

export type DefineBusOptions = Readonly<{
  realm: BusRealm;
  instanceId?: string;
  transport?: Transport;
  nextId?: () => string;
  requestTimeoutMs?: number;
}>;

export type RequestOptions = Readonly<{
  target?: BusRealm;
  seq?: number;
  timeoutMs?: number;
}>;

export type EmitOptions = Readonly<{
  target?: BusRealm | "broadcast";
  seq?: number;
}>;

const NO_HANDLER = "NO_HANDLER";
const INVALID_PAYLOAD = "INVALID_PAYLOAD";
const HANDLER_FAILED = "HANDLER_FAILED";
const INVALID_RESPONSE = "INVALID_RESPONSE";
const TRANSPORT_FAILED = "TRANSPORT_FAILED";
const REQUEST_TIMEOUT = "REQUEST_TIMEOUT";
const BUS_DISPOSED = "BUS_DISPOSED";
const MAX_REPLY_CACHE_ENTRIES = 128;
export const DEFAULT_BUS_REQUEST_TIMEOUT_MS = 120_000;

function positiveTimeoutMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function makeFailure(code: string, message: string, details?: Record<string, unknown>): BusFailure {
  return details ? { code, message, details } : { code, message };
}

function unknownToFailure(error: unknown, fallbackCode: string, fallbackMessage: string): BusFailure {
  if (error && typeof error === "object") {
    const candidate = error as Partial<BusFailure> & { message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return makeFailure(candidate.code, candidate.message, candidate.details);
    }
  }
  return makeFailure(
    fallbackCode,
    error instanceof Error && error.message ? error.message : fallbackMessage,
  );
}

/** Gives every command occurrence one terminal reply even when a browser
 * transport or local handler never settles. Handlers are attached directly to
 * the underlying promise so a late rejection is consumed, while the settled
 * guard prevents a late reply from replacing the typed timeout outcome. */
function withRequestDeadline<T>(
  pending: PromiseLike<T> | T,
  name: string,
  timeoutMs: number,
): Readonly<{ promise: Promise<T>; cancel: (failure: BusFailure) => void }> {
  let cancel = (_failure: BusFailure): void => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    let settled = false;
    const rejectOnce = (failure: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(failure);
    };
    const timer = setTimeout(() => {
      rejectOnce(makeFailure(REQUEST_TIMEOUT, `Request timed out for ${name}`, { timeoutMs }));
    }, timeoutMs);
    cancel = rejectOnce;
    Promise.resolve(pending).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        rejectOnce(error);
      },
    );
  });
  return { promise, cancel };
}

let fallbackIdCounter = 0;

function fallbackId(): string {
  fallbackIdCounter += 1;
  return `uf-bus-${Date.now()}-${fallbackIdCounter}`;
}

function replyTo(request: BusFrame, reply: BusReply<unknown>, responderInstance?: string): BusFrame {
  return {
    kind: BUS_FRAME_KIND,
    frameType: "reply",
    id: request.id,
    seq: request.seq,
    name: request.name,
    source: request.target === "broadcast" ? request.source : request.target,
    sourceInstance: responderInstance,
    target: request.source,
    payload: reply.ok ? reply.data : null,
    ok: reply.ok,
    failure: reply.ok ? undefined : reply.failure,
  };
}

function retargetReply(cachedReply: BusFrame, request: BusFrame): BusFrame {
  return {
    ...cachedReply,
    id: request.id,
    seq: request.seq,
    target: request.source,
  };
}

function parseFrame(frame: unknown): BusFrame | null {
  const parsed = BusFrameSchema.safeParse(frame);
  return parsed.success ? parsed.data : null;
}

export function defineBus<const Contract extends BusContractDefinition>(
  contract: Contract,
  options: DefineBusOptions,
) {
  const handlers = new Map<string, CommandHandler<unknown, unknown>>();
  const eventHandlers = new Map<string, Set<EventHandler<unknown>>>();
  const replyCache = new Map<string, Promise<BusFrame>>();
  const replyCacheOrder: string[] = [];
  const pendingRequestCancels = new Set<(failure: BusFailure) => void>();
  const nextId = options.nextId ?? fallbackId;
  const transport = options.transport;
  const instanceId = options.instanceId ?? `${options.realm}:${nextId()}`;
  const defaultRequestTimeoutMs = positiveTimeoutMs(
    options.requestTimeoutMs,
    DEFAULT_BUS_REQUEST_TIMEOUT_MS,
  );
  let nextSeq = 0;
  let disposed = false;

  const nextSequence = (override?: number): number => {
    if (override !== undefined) {
      nextSeq = Math.max(nextSeq, override);
      return override;
    }
    nextSeq += 1;
    return nextSeq;
  };

  async function handleRequest(frame: BusFrame): Promise<BusFrame> {
    const cacheKey = `${frame.source}:${frame.sourceInstance ?? `${frame.source}:default`}:${frame.seq}`;
    const cached = replyCache.get(cacheKey);
    if (cached) {
      return retargetReply(await cached, frame);
    }
    const pendingReply = (async (): Promise<BusFrame> => {
      const command = contract.commands[frame.name];
      if (!command) {
        return replyTo(frame, {
          ok: false,
          failure: makeFailure(NO_HANDLER, `No command registered for ${frame.name}`),
        }, instanceId);
      }

      const parsedPayload = command.request.safeParse(frame.payload);
      if (!parsedPayload.success) {
        return replyTo(frame, {
          ok: false,
          failure: makeFailure(INVALID_PAYLOAD, `Invalid payload for ${frame.name}`, {
            issues: parsedPayload.error.issues,
          }),
        }, instanceId);
      }

      const handler = handlers.get(frame.name);
      if (!handler) {
        return replyTo(frame, {
          ok: false,
          failure: makeFailure(NO_HANDLER, `No handler registered for ${frame.name}`),
        }, instanceId);
      }

      try {
        const rawResponse = await handler(parsedPayload.data, {
          id: frame.id,
          seq: frame.seq,
          source: frame.source,
          sourceInstance: frame.sourceInstance,
        });
        const parsedResponse = command.response.safeParse(rawResponse);
        return parsedResponse.success
          ? replyTo(frame, { ok: true, data: parsedResponse.data }, instanceId)
          : replyTo(frame, {
            ok: false,
            failure: makeFailure(INVALID_RESPONSE, `Invalid response for ${frame.name}`, {
              issues: parsedResponse.error.issues,
            }),
          }, instanceId);
      } catch (error) {
        return replyTo(frame, {
          ok: false,
          failure: unknownToFailure(error, HANDLER_FAILED, `Handler failed for ${frame.name}`),
        }, instanceId);
      }
    })();
    replyCache.set(cacheKey, pendingReply);
    replyCacheOrder.push(cacheKey);
    while (replyCacheOrder.length > MAX_REPLY_CACHE_ENTRIES) {
      const expired = replyCacheOrder.shift();
      if (expired) {
        replyCache.delete(expired);
      }
    }
    return retargetReply(await pendingReply, frame);
  }

  async function handleEvent(frame: BusFrame): Promise<void> {
    const event = contract.events[frame.name];
    if (!event) {
      return;
    }
    const parsedPayload = event.safeParse(frame.payload);
    if (!parsedPayload.success) {
      return;
    }
    const listeners = eventHandlers.get(frame.name);
    if (!listeners) {
      return;
    }
    await Promise.all(
      Array.from(listeners, (listener) =>
        Promise.resolve(listener(parsedPayload.data, {
          id: frame.id,
          seq: frame.seq,
          source: frame.source,
          sourceInstance: frame.sourceInstance,
        })),
      ),
    );
  }

  function receive(frame: BusFrame): Promise<BusFrame | void> | BusFrame | void {
    const parsed = parseFrame(frame);
    if (!parsed) {
      return undefined;
    }
    if (parsed.target !== options.realm && parsed.target !== "broadcast") {
      return undefined;
    }
    if (parsed.frameType === "request" && parsed.target === "broadcast") {
      return undefined;
    }
    if (parsed.frameType === "request") {
      return handleRequest(parsed);
    }
    if (parsed.frameType === "event") {
      return handleEvent(parsed);
    }
    return undefined;
  }

  const unsubscribeTransport = transport?.onReceive(receive);

  return {
    request<Name extends keyof Contract["commands"] & string>(
      name: Name,
      payload: InferCommandRequest<Contract, Name>,
      requestOptions: RequestOptions = {},
    ): Promise<BusReply<InferCommandResponse<Contract, Name>>> {
      if (disposed) {
        return Promise.resolve({
          ok: false,
          failure: makeFailure(BUS_DISPOSED, `Bus is disposed for ${name}`),
        });
      }
      const command = contract.commands[name];
      const parsedPayload = command.request.safeParse(payload);
      if (!parsedPayload.success) {
        return Promise.resolve({
          ok: false,
          failure: makeFailure(INVALID_PAYLOAD, `Invalid payload for ${name}`, {
            issues: parsedPayload.error.issues,
          }),
        });
      }

      const frame: BusFrame = {
        kind: BUS_FRAME_KIND,
        frameType: "request",
        id: nextId(),
        seq: nextSequence(requestOptions.seq),
        name,
        source: options.realm,
        sourceInstance: instanceId,
        target: requestOptions.target ?? options.realm,
        payload: parsedPayload.data,
      };

      const replyPromise = frame.target === options.realm
        ? handleRequest(frame)
        : transport
          ? transport.send(frame)
          : Promise.resolve(replyTo(frame, {
            ok: false,
            failure: makeFailure(TRANSPORT_FAILED, `No transport for ${name}`),
          }));

      const timeoutMs = positiveTimeoutMs(requestOptions.timeoutMs, defaultRequestTimeoutMs);
      const deadline = withRequestDeadline(replyPromise, name, timeoutMs);
      pendingRequestCancels.add(deadline.cancel);
      return deadline.promise
        .then((replyFrame): BusReply<InferCommandResponse<Contract, Name>> => {
          const reply = parseFrame(replyFrame);
          if (!reply || reply.frameType !== "reply" || reply.id !== frame.id) {
            return {
              ok: false,
              failure: makeFailure(TRANSPORT_FAILED, `Transport did not return one reply for ${name}`),
            } satisfies BusReply<InferCommandResponse<Contract, Name>>;
          }
          if (!reply.ok) {
            return {
              ok: false,
              failure: reply.failure ?? makeFailure(HANDLER_FAILED, `Command failed for ${name}`),
            } satisfies BusReply<InferCommandResponse<Contract, Name>>;
          }
          const parsedResponse = command.response.safeParse(reply.payload);
          if (!parsedResponse.success) {
            return {
              ok: false,
              failure: makeFailure(INVALID_RESPONSE, `Invalid response for ${name}`, {
                issues: parsedResponse.error.issues,
              }),
            } satisfies BusReply<InferCommandResponse<Contract, Name>>;
          }
          return {
            ok: true,
            data: parsedResponse.data as InferCommandResponse<Contract, Name>,
          } satisfies BusReply<InferCommandResponse<Contract, Name>>;
        })
        .catch((error: unknown): BusReply<InferCommandResponse<Contract, Name>> => ({
          ok: false,
          failure: unknownToFailure(error, TRANSPORT_FAILED, `Transport failed for ${name}`),
        }))
        .finally(() => {
          pendingRequestCancels.delete(deadline.cancel);
        });
    },

    onCommand<Name extends keyof Contract["commands"] & string>(
      name: Name,
      handler: CommandHandler<
        InferCommandRequest<Contract, Name>,
        InferCommandResponse<Contract, Name>
      >,
    ): Unsubscribe {
      if (handlers.has(name)) {
        throw new Error(`Command handler already registered for ${name}`);
      }
      handlers.set(name, handler as CommandHandler<unknown, unknown>);
      return () => {
        handlers.delete(name);
      };
    },

    async emit<Name extends keyof Contract["events"] & string>(
      name: Name,
      payload: InferEventPayload<Contract, Name>,
      emitOptions: EmitOptions = {},
    ): Promise<void> {
      const event = contract.events[name];
      const parsedPayload = event.safeParse(payload);
      if (!parsedPayload.success) {
        throw new Error(`Invalid event payload for ${name}`);
      }
      const frame: BusFrame = {
        kind: BUS_FRAME_KIND,
        frameType: "event",
        id: nextId(),
        seq: nextSequence(emitOptions.seq),
        name,
        source: options.realm,
        sourceInstance: instanceId,
        target: emitOptions.target ?? "broadcast",
        payload: parsedPayload.data,
      };
      await handleEvent(frame);
      if (frame.target !== options.realm) {
        await transport?.send(frame);
      }
    },

    on<Name extends keyof Contract["events"] & string>(
      name: Name,
      handler: EventHandler<InferEventPayload<Contract, Name>>,
    ): Unsubscribe {
      if (!eventHandlers.has(name)) {
        eventHandlers.set(name, new Set());
      }
      const listeners = eventHandlers.get(name);
      if (!listeners) {
        throw new Error(`Unable to register event listener for ${name}`);
      }
      listeners.add(handler as EventHandler<unknown>);
      return () => {
        listeners.delete(handler as EventHandler<unknown>);
        if (listeners.size === 0) {
          eventHandlers.delete(name);
        }
      };
    },

    receive,

    dispose(): void {
      disposed = true;
      const failure = makeFailure(BUS_DISPOSED, "Bus disposed before the request completed");
      for (const cancel of pendingRequestCancels) {
        cancel(failure);
      }
      pendingRequestCancels.clear();
      unsubscribeTransport?.();
      handlers.clear();
      eventHandlers.clear();
      replyCache.clear();
      replyCacheOrder.splice(0);
    },
  };
}
