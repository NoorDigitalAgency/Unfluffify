import {
  BUS_FRAME_KIND,
  BusFailureSchema,
  PageCommandNameSchema,
  type BusFailure,
  type BusFrame,
  type PageCommandName,
} from "../contract";
import type { Transport, Unsubscribe } from "../bus";

export const PAGE_BUS_PROTOCOL = "uf-page-bus/1" as const;
export const PAGE_COMMANDS = PageCommandNameSchema.options;

export type PageRequestMessage = Readonly<{
  kind: typeof PAGE_BUS_PROTOCOL;
  type: "request";
  nonce: string;
  command: PageCommandName;
  payload: unknown;
}>;

export type PageResponseMessage = Readonly<{
  kind: typeof PAGE_BUS_PROTOCOL;
  type: "response";
  nonce: string;
  command: PageCommandName;
  ok: boolean;
  payload?: unknown;
  failure?: BusFailure;
}>;

export type PageEndpoint = Readonly<{
  postMessage(message: PageRequestMessage): void;
  onMessage(listener: (message: unknown) => void): Unsubscribe;
}>;

function makeFailure(code: string, message: string): BusFailure {
  return { code, message };
}

function normalizeFailure(value: unknown, fallback: BusFailure): BusFailure {
  const parsed = BusFailureSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function makeReply(frame: BusFrame, ok: true, payload: unknown): BusFrame;
function makeReply(frame: BusFrame, ok: false, failure: BusFailure): BusFrame;
function makeReply(frame: BusFrame, ok: boolean, body: unknown): BusFrame {
  return {
    kind: BUS_FRAME_KIND,
    frameType: "reply",
    id: frame.id,
    seq: frame.seq,
    name: frame.name,
    source: "page",
    target: frame.source,
    payload: ok ? body : null,
    ok,
    failure: ok ? undefined : body as BusFailure,
  };
}

function isPageResponse(value: unknown): value is PageResponseMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<PageResponseMessage>;
  return (
    candidate.kind === PAGE_BUS_PROTOCOL &&
    candidate.type === "response" &&
    typeof candidate.nonce === "string" &&
    PageCommandNameSchema.safeParse(candidate.command).success &&
    typeof candidate.ok === "boolean"
  );
}

export function isPageCommandName(value: unknown): value is PageCommandName {
  return PageCommandNameSchema.safeParse(value).success;
}

export function createPageTransport(
  endpoint: PageEndpoint,
  options: Readonly<{ nextNonce?: () => string; responseTimeoutMs?: number }> = {},
): Transport {
  const nextNonce = options.nextNonce ?? (() => crypto.randomUUID());
  const responseTimeoutMs = options.responseTimeoutMs ?? 30_000;

  return {
    async send(frame: BusFrame): Promise<BusFrame | void> {
      if (frame.target !== "page") {
        return makeReply(frame, false, makeFailure("UNREACHABLE_REALM", "Page transport only reaches page"));
      }
      const command = frame.name;
      if (!isPageCommandName(command)) {
        return makeReply(frame, false, makeFailure("PAGE_COMMAND_REJECTED", `Unsupported page command ${frame.name}`));
      }
      if (frame.frameType === "event") {
        endpoint.postMessage({
          kind: PAGE_BUS_PROTOCOL,
          type: "request",
          nonce: nextNonce(),
          command,
          payload: frame.payload,
        });
        return undefined;
      }

      const nonce = nextNonce();
      const response = await new Promise<PageResponseMessage>((resolve) => {
        let settled = false;
        const unsubscribe = endpoint.onMessage((message) => {
          if (!isPageResponse(message)) {
            return;
          }
          if (message.nonce !== nonce || message.command !== frame.name) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          resolve(message);
        });
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          unsubscribe();
          resolve({
            kind: PAGE_BUS_PROTOCOL,
            type: "response",
            nonce,
            command,
            ok: false,
            failure: makeFailure("PAGE_COMMAND_TIMEOUT", `Page command timed out: ${frame.name}`),
          });
        }, responseTimeoutMs);
        endpoint.postMessage({
          kind: PAGE_BUS_PROTOCOL,
          type: "request",
          nonce,
          command,
          payload: frame.payload,
        });
      });

      return response.ok
        ? makeReply(frame, true, response.payload)
        : makeReply(
          frame,
          false,
          normalizeFailure(
            response.failure,
            makeFailure("PAGE_COMMAND_FAILED", `Page command failed: ${frame.name}`),
          ),
        );
    },
    onReceive(): Unsubscribe {
      return () => undefined;
    },
  };
}
