import type { BusTarget, Realm } from "./realms.js";
import { normalizeTarget, isRealm } from "./realms.js";

export const BUS_PROTOCOL = "uf-bus/1" as const;

export const BUS_KINDS = Object.freeze({
  REQUEST: "request",
  REPLY: "reply",
  EVENT: "event",
} as const);

export type BusKind = typeof BUS_KINDS[keyof typeof BUS_KINDS];

type BusEnvelopeBase = {
  p: typeof BUS_PROTOCOL;
  id: string;
  t: string;
  src: Realm;
  dst: BusTarget;
  tab: number | null;
  frame: number;
  payload: unknown;
};

export type BusRequestEnvelope = BusEnvelopeBase & {
  k: typeof BUS_KINDS.REQUEST;
};

export type BusEventEnvelope = BusEnvelopeBase & {
  k: typeof BUS_KINDS.EVENT;
};

export type BusReplyEnvelope = BusEnvelopeBase & {
  k: typeof BUS_KINDS.REPLY;
  ok: boolean;
  code?: string;
  error?: string;
};

export type BusEnvelope = BusRequestEnvelope | BusEventEnvelope | BusReplyEnvelope;

type EnvelopeRoute = Readonly<{
  src: Realm;
  dst: BusTarget;
  tab?: number | null;
  frame?: number | null;
  id?: string;
}>;

type ReplyFailure = Readonly<{
  code: string;
  error: string;
  details?: Record<string, unknown>;
}>;

let fallbackEnvelopeCounter = 0;

function isInteger(value: unknown): value is number {
  return Number.isFinite(value) && Number.isInteger(value);
}

function normalizeTab(value: unknown): number | null {
  return isInteger(value) ? value : null;
}

function normalizeFrame(value: unknown): number {
  return isInteger(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value: unknown): string {
  return typeof value === "string" && value ? value : newId();
}

function makeBaseEnvelope<K extends typeof BUS_KINDS.REQUEST | typeof BUS_KINDS.EVENT>(
  kind: K,
  type: string,
  payload: unknown,
  route: EnvelopeRoute,
): K extends typeof BUS_KINDS.REQUEST ? BusRequestEnvelope : BusEventEnvelope {
  return {
    p: BUS_PROTOCOL,
    k: kind,
    id: normalizeId(route.id),
    t: type,
    src: route.src,
    dst: route.dst,
    tab: normalizeTab(route.tab),
    frame: normalizeFrame(route.frame),
    payload,
  } as K extends typeof BUS_KINDS.REQUEST ? BusRequestEnvelope : BusEventEnvelope;
}

export function newId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackEnvelopeCounter += 1;
  return `uf-bus-${Date.now()}-${fallbackEnvelopeCounter}`;
}

export function makeRequestEnvelope(
  type: string,
  payload: unknown,
  route: EnvelopeRoute,
): BusRequestEnvelope {
  return makeBaseEnvelope(BUS_KINDS.REQUEST, type, payload, route);
}

export function makeEventEnvelope(
  type: string,
  payload: unknown,
  route: EnvelopeRoute,
): BusEventEnvelope {
  return makeBaseEnvelope(BUS_KINDS.EVENT, type, payload, route);
}

export function makeReplyEnvelope(
  request: BusRequestEnvelope,
  ok: true,
  body: unknown,
): BusReplyEnvelope;
export function makeReplyEnvelope(
  request: BusRequestEnvelope,
  ok: false,
  body: ReplyFailure,
): BusReplyEnvelope;
export function makeReplyEnvelope(
  request: BusRequestEnvelope,
  ok: boolean,
  body: unknown,
): BusReplyEnvelope {
  const failure = !ok && isRecord(body) ? body as ReplyFailure : null;
  return {
    p: BUS_PROTOCOL,
    k: BUS_KINDS.REPLY,
    id: request.id,
    t: request.t,
    src: request.dst === "broadcast" ? request.src : request.dst,
    dst: request.src,
    tab: request.tab,
    frame: request.frame,
    payload: ok
      ? body
      : failure?.details && isRecord(failure.details)
        ? failure.details
        : {},
    ok,
    code: ok ? undefined : failure?.code,
    error: ok ? undefined : failure?.error,
  };
}

export function isBusEnvelope(value: unknown): value is BusEnvelope {
  if (!isRecord(value) || value.p !== BUS_PROTOCOL) {
    return false;
  }
  if (
    (value.k !== BUS_KINDS.REQUEST && value.k !== BUS_KINDS.REPLY && value.k !== BUS_KINDS.EVENT)
    || typeof value.id !== "string"
    || typeof value.t !== "string"
    || !isRealm(value.src)
    || !normalizeTarget(value.dst)
    || !(value.tab === null || isInteger(value.tab))
    || !isInteger(value.frame)
  ) {
    return false;
  }
  if (value.k === BUS_KINDS.REPLY) {
    return typeof value.ok === "boolean";
  }
  return true;
}

export function isBusRequest(value: unknown): value is BusRequestEnvelope {
  return isBusEnvelope(value) && value.k === BUS_KINDS.REQUEST;
}

export function isBusReply(value: unknown): value is BusReplyEnvelope {
  return isBusEnvelope(value) && value.k === BUS_KINDS.REPLY;
}

export function isBusEvent(value: unknown): value is BusEventEnvelope {
  return isBusEnvelope(value) && value.k === BUS_KINDS.EVENT;
}
