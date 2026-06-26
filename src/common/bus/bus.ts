import { BUS_ERROR_CODES, BusError } from "./bus-errors";
import type { BusEnvelope, BusReplyEnvelope } from "./envelope";
import {
  BUS_KINDS,
  makeEventEnvelope,
  makeReplyEnvelope,
  makeRequestEnvelope,
  newId,
} from "./envelope";
import type { BusTarget, Realm } from "./realms";
import type { Transport } from "./transport/transport-types";

export type BusReplyOk<R> = { ok: true; result: R };
export type BusReplyErr = { ok: false; code: string; error: string; details: Record<string, unknown> };
export type BusReply<R> = BusReplyOk<R> | BusReplyErr;

export type RequestMeta = { type: string; src: Realm; tab: number | null; frame: number; id: string };
export type EventMeta = RequestMeta;

export type RequestHandler<P, R> = (payload: P, meta: RequestMeta) => Promise<R> | R;
export type EventListener<P> = (payload: P, meta: EventMeta) => Promise<void> | void;
export type Unsubscribe = () => void;

export type RequestOptions = { target?: BusTarget; tab?: number | null; frame?: number; timeoutMs?: number };
export type PublishOptions = { target?: BusTarget; tab?: number | null; frame?: number };

type BusLogger = {
  error?: (message: string, details?: Record<string, unknown>) => void;
};

export interface Bus {
  request<P, R>(type: string, payload: P, opts?: RequestOptions): Promise<R>;
  tryRequest<P, R>(type: string, payload: P, opts?: RequestOptions): Promise<BusReply<R>>;
  registerHandler<P, R>(type: string, handler: RequestHandler<P, R>): Unsubscribe;
  publish<P>(type: string, payload: P, opts?: PublishOptions): Promise<void>;
  subscribe<P>(type: string, listener: EventListener<P>): Unsubscribe;
}

type CreateBusOptions = Readonly<{
  realm: Realm;
  transport: Transport;
  logger?: BusLogger;
}>;

function normalizeDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function toBusError(error: unknown, fallbackCode: string, fallbackMessage: string): BusError {
  if (error instanceof BusError) {
    return error;
  }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof candidate.code === "string" && candidate.code) {
      return new BusError(
        candidate.code,
        typeof candidate.message === "string" && candidate.message ? candidate.message : fallbackMessage,
        normalizeDetails(candidate.details),
      );
    }
  }
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return new BusError(fallbackCode, message, error instanceof Error ? { cause: error.name } : {});
}

function replyEnvelopeToError(reply: BusReplyEnvelope): BusError {
  return new BusError(
    typeof reply.code === "string" && reply.code ? reply.code : BUS_ERROR_CODES.HANDLER_FAILED,
    typeof reply.error === "string" && reply.error ? reply.error : "Bus request failed",
    normalizeDetails(reply.payload),
  );
}

export function createBus(options: CreateBusOptions): Bus {
  const { realm, transport, logger } = options;
  const handlers = new Map<string, RequestHandler<unknown, unknown>>();
  const listeners = new Map<string, Set<EventListener<unknown>>>();

  transport.onInbound(async (env: BusEnvelope) => {
    if (env.k === BUS_KINDS.REQUEST) {
      const handler = handlers.get(env.t);
      if (!handler) {
        return makeReplyEnvelope(env, false, {
          code: BUS_ERROR_CODES.NO_HANDLER,
          error: `No bus handler registered for ${env.t}`,
          details: { type: env.t, realm },
        });
      }
      try {
        const result = await handler(env.payload, {
          type: env.t,
          src: env.src,
          tab: env.tab,
          frame: env.frame,
          id: env.id,
        });
        return makeReplyEnvelope(env, true, result);
      } catch (error) {
        const details = error instanceof BusError ? error.details : {};
        return makeReplyEnvelope(env, false, {
          code: BUS_ERROR_CODES.HANDLER_FAILED,
          error: error instanceof Error && error.message ? error.message : `Bus handler failed for ${env.t}`,
          details,
        });
      }
    }

    if (env.k === BUS_KINDS.EVENT) {
      const typeListeners = listeners.get(env.t);
      if (!typeListeners || typeListeners.size === 0) {
        return;
      }
      const results = await Promise.allSettled(
        Array.from(typeListeners, (listener) =>
          Promise.resolve().then(() => listener(env.payload, {
            type: env.t,
            src: env.src,
            tab: env.tab,
            frame: env.frame,
            id: env.id,
          }))
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logger?.error?.("Bus event listener rejected", { type: env.t, realm });
        }
      }
    }
  });

  function runLocalRequest<P, R>(type: string, payload: P, meta: RequestMeta): Promise<R> {
    const handler = handlers.get(type);
    if (!handler) {
      return Promise.reject(new BusError(
        BUS_ERROR_CODES.NO_HANDLER,
        `No bus handler registered for ${type}`,
        { type, realm },
      ));
    }
    try {
      return Promise.resolve(handler(payload, meta) as R).catch((error: unknown) => {
        throw new BusError(
          BUS_ERROR_CODES.HANDLER_FAILED,
          error instanceof Error && error.message ? error.message : `Bus handler failed for ${type}`,
          error instanceof BusError ? error.details : {},
        );
      });
    } catch (error) {
      return Promise.reject(new BusError(
        BUS_ERROR_CODES.HANDLER_FAILED,
        error instanceof Error && error.message ? error.message : `Bus handler failed for ${type}`,
        error instanceof BusError ? error.details : {},
      ));
    }
  }

  function withTimeout<T>(promise: Promise<T>, type: string, timeoutMs?: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        reject(new BusError(BUS_ERROR_CODES.TIMEOUT, `Bus request timed out for ${type}`, {
          type,
          realm,
          timeoutMs,
        }));
      }, Math.trunc(timeoutMs));
      promise.then(
        (value) => {
          globalThis.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          globalThis.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  return {
    registerHandler(type, handler) {
      if (handlers.has(type)) {
        throw new BusError(
          BUS_ERROR_CODES.DUPLICATE_HANDLER,
          `Bus handler already registered for ${type}`,
          { type, realm },
        );
      }
      handlers.set(type, handler as RequestHandler<unknown, unknown>);
      return () => {
        handlers.delete(type);
      };
    },

    subscribe(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      const typeListeners = listeners.get(type) as Set<EventListener<unknown>>;
      typeListeners.add(listener as EventListener<unknown>);
      return () => {
        typeListeners.delete(listener as EventListener<unknown>);
        if (typeListeners.size === 0) {
          listeners.delete(type);
        }
      };
    },

    async request<P, R>(type: string, payload: P, opts: RequestOptions = {}) {
      const requestId = newId();
      const tab = opts.tab ?? null;
      const frame = Number.isFinite(opts.frame) ? Math.trunc(opts.frame as number) : 0;
      const meta: RequestMeta = { type, src: realm, tab, frame, id: requestId };
      const target = opts.target ?? (handlers.has(type) ? realm : null);

      if (!target) {
        throw new BusError(BUS_ERROR_CODES.NO_HANDLER, `No bus target resolved for ${type}`, {
          type,
          realm,
        });
      }

      if (target === realm) {
        return await withTimeout(runLocalRequest<P, R>(type, payload, meta), type, opts.timeoutMs);
      }

      const requestEnvelope = makeRequestEnvelope(type, payload, {
        src: realm,
        dst: target,
        tab,
        frame,
        id: requestId,
      });
      const replyPromise = transport.send(requestEnvelope)
        .then((reply) => {
          if (!reply || reply.k !== BUS_KINDS.REPLY) {
            throw new BusError(
              BUS_ERROR_CODES.TRANSPORT_FAILED,
              `Bus transport did not return a reply for ${type}`,
              { type, realm, target },
            );
          }
          if (!reply.ok) {
            throw replyEnvelopeToError(reply);
          }
          return reply.payload as R;
        })
        .catch((error: unknown) => {
          throw toBusError(
            error,
            BUS_ERROR_CODES.TRANSPORT_FAILED,
            `Bus transport failed for ${type}`,
          );
        });
      return await withTimeout(replyPromise, type, opts.timeoutMs);
    },

    async tryRequest<P, R>(type: string, payload: P, opts: RequestOptions = {}) {
      try {
        const result = await this.request<P, R>(type, payload, opts);
        return { ok: true, result };
      } catch (error) {
        const busError = toBusError(error, BUS_ERROR_CODES.HANDLER_FAILED, `Bus request failed for ${type}`);
        return {
          ok: false,
          code: busError.code,
          error: busError.message,
          details: { ...busError.details },
        };
      }
    },

    async publish<P>(type: string, payload: P, opts: PublishOptions = {}) {
      const tab = opts.tab ?? null;
      const frame = Number.isFinite(opts.frame) ? Math.trunc(opts.frame as number) : 0;
      const eventId = newId();
      const typeListeners = listeners.get(type);
      const listenerPromises = typeListeners
        ? Array.from(typeListeners, (listener) =>
          Promise.resolve().then(() => listener(payload, {
            type,
            src: realm,
            tab,
            frame,
            id: eventId,
          }))
        )
        : [];

      const target = opts.target;
      const transportPromise = target === realm
        ? Promise.resolve<void>(undefined)
        : transport.send(makeEventEnvelope(type, payload, {
          src: realm,
          dst: target ?? "broadcast",
          tab,
          frame,
          id: eventId,
        }))
          .then(() => undefined)
          .catch((error: unknown) => {
            throw toBusError(
              error,
              BUS_ERROR_CODES.TRANSPORT_FAILED,
              `Bus publish transport failed for ${type}`,
            );
          });

      const settled = await Promise.allSettled([...listenerPromises, transportPromise]);
      for (const result of settled) {
        if (result.status === "rejected") {
          logger?.error?.("Bus publish listener rejected", { type, realm });
        }
      }
    },
  };
}
