import type { Realm } from "../realms";

export const DIAGNOSTIC_REQUEST_TYPES = Object.freeze({
  PING: "diag.ping",
} as const);

export const DIAGNOSTIC_EVENT_TYPES = Object.freeze({
  ECHO: "diag.echo",
} as const);

export type DiagnosticPingPayload = Readonly<{
  nonce: string;
}>;

export type DiagnosticPingReply = Readonly<{
  nonce: string;
  realm: Realm;
}>;

export type DiagnosticEchoPayload = Readonly<{
  nonce: string;
}>;

export * from "./activation";
export * from "./render-mode";
export * from "./session-state";
