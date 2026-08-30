import { z } from "zod";

export const LockClientMessageTypeSchema = z.enum([
  "authenticate",
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
  "authenticated",
  "authentication_failed",
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
  "token_update",
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

export const PropertyLockPresenceSchema = z.object({
  visible: z.boolean(),
  focusedWindow: z.boolean(),
  browserIdle: z.boolean(),
  suspensionReason: z.string().trim().min(1).optional(),
});

export type PropertyLockPresence = z.infer<typeof PropertyLockPresenceSchema>;

export const LockAuthenticationFrameSchema = z.object({
  type: z.literal("authenticate"),
  protocol: z.literal("bearer-frame-v1"),
  token: z.string().trim().min(1),
});

export function buildLockAuthenticationFrame(token: string): z.infer<typeof LockAuthenticationFrameSchema> {
  return LockAuthenticationFrameSchema.parse({
    type: "authenticate",
    protocol: "bearer-frame-v1",
    token: token.trim(),
  });
}

export function buildPropertyLockWssUrl(
  endpointBase: string,
  token = "",
  options: Readonly<{ allowDebugLoopbackQueryToken?: boolean }> = {},
): string {
  const trimmed = endpointBase.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const base = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]";
    const protocol = loopback ? "ws:" : "wss:";
    const queryToken = options.allowDebugLoopbackQueryToken && loopback ? token.trim() : "";
    return `${protocol}//${base.host}/property-lock${queryToken ? `?token=${encodeURIComponent(queryToken)}` : ""}`;
  } catch {
    return "";
  }
}

export function buildClientFrame(input: Readonly<{
  type: LockClientMessageType;
  environmentKey: string;
  siteId: number;
  editorSessionId: string;
  presence: PropertyLockPresence;
  hasUnsavedWork: boolean;
  lockToken?: string;
  extra?: Readonly<Record<string, string | number | boolean>>;
}>): Readonly<{
  type: LockClientMessageType;
  environmentKey: string;
  siteId: number;
  editorSessionId: string;
  visible: boolean;
  focusedWindow: boolean;
  browserIdle: boolean;
  hasUnsavedWork: boolean;
  suspensionReason?: string;
  lockToken?: string;
} & Record<string, string | number | boolean>> {
  return {
    type: input.type,
    environmentKey: input.environmentKey,
    siteId: input.siteId,
    editorSessionId: input.editorSessionId,
    visible: input.presence.visible,
    focusedWindow: input.presence.focusedWindow,
    browserIdle: input.presence.browserIdle,
    hasUnsavedWork: input.hasUnsavedWork,
    ...(input.presence.suspensionReason ? { suspensionReason: input.presence.suspensionReason } : {}),
    ...(input.lockToken ? { lockToken: input.lockToken } : {}),
    ...(input.extra ?? {}),
  };
}

export function parseServerMessage(value: unknown): LockServerMessage {
  return LockServerMessageSchema.parse(value);
}
