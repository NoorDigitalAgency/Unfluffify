import { z } from "zod";

export const LockClientMessageTypeSchema = z.enum([
  "subscribe",
  "heartbeat",
  "activity",
  "take_lock",
  "release_lock",
  "suggest_takeover",
  "respond_to_suggestion",
  "continue_editing",
  "client_status",
]);

export const LockServerMessageTypeSchema = z.enum([
  "subscribed",
  "lock_state",
  "disconnect_warning",
  "inactivity_warning",
  "takeover_suggestion",
  "suggestion_pending",
  "suggestion_response",
  "suggestion_accepted",
  "transfer_countdown",
  "error",
]);

export const LockStateSchema = z.enum([
  "unlocked",
  "locked",
  "expiry_warning",
  "takeover_available",
  "transfer",
]);

export const LockServerMessageSchema = z.object({
  type: LockServerMessageTypeSchema,
}).passthrough();

export type LockClientMessageType = z.infer<typeof LockClientMessageTypeSchema>;
export type LockServerMessage = z.infer<typeof LockServerMessageSchema>;

export function buildPropertyLockWssUrl(endpointBase: string, token: string): string {
  const trimmed = endpointBase.trim();
  if (!trimmed || !token.trim()) {
    return "";
  }
  const base = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  const protocol = base.hostname === "localhost" || base.hostname === "127.0.0.1" ? "ws:" : "wss:";
  return `${protocol}//${base.host}/property-lock?token=${encodeURIComponent(token)}`;
}

export function buildClientFrame(input: Readonly<{
  type: LockClientMessageType;
  siteId: number;
  identity: string;
  pageUrl: string;
  hasUnsavedChanges: boolean;
  extra?: Readonly<Record<string, string | number | boolean>>;
}>): Readonly<{
  type: LockClientMessageType;
  siteId: number;
  clientId: string;
  pageUrl: string;
  hasUnsavedChanges: boolean;
} & Record<string, string | number | boolean>> {
  return {
    type: input.type,
    siteId: input.siteId,
    clientId: input.identity,
    pageUrl: input.pageUrl,
    hasUnsavedChanges: input.hasUnsavedChanges,
    ...(input.extra ?? {}),
  };
}

export function parseServerMessage(value: unknown): LockServerMessage {
  return LockServerMessageSchema.parse(value);
}
