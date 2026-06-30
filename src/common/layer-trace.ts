/**
 * Observable message tracing for all inter-layer communication.
 *
 * Logs at console.warn level so the CDP observer captures it with stack
 * traces. Gated behind the "layerMessageTrace" debug flag.
 *
 * Three layers are traced:
 * 1. Runtime messages (runtime.sendMessage) — popup ↔ background, content ↔ background
 * 2. Bus envelopes — structured pub/sub over runtime ports
 * 3. Tab messages (tabs.sendMessage) — background → content
 *
 * Usage: enable via debug flag in storage, then watch the CDP observer stream.
 */

import { isDebugFlagEnabled } from "./feature-flags";

const TAG = "[layer-trace]";

function shouldTrace(): boolean {
  return isDebugFlagEnabled("layerMessageTrace");
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    if (value == null) return String(value);
    const str = JSON.stringify(value);
    return str && str.length > 300 ? str.slice(0, 300) + "…" : str || String(value);
  } catch {
    return String(value);
  }
}

function log(layer: string, direction: string, messageType: string, details: Record<string, unknown> = {}) {
  if (!shouldTrace()) {
    return;
  }
  try {
    const parts = [TAG, layer, direction, messageType];
    const hasDetails = Object.keys(details).length > 0;
    if (hasDetails) {
      console.warn(parts.join(" "), safeStringify(details));
    } else {
      console.warn(parts.join(" "));
    }
  } catch {
    // Tracing must never break message delivery.
  }
}

// --- Runtime messages (runtime.sendMessage) ---

export function traceRuntimeSend(messageType: string, details: Record<string, unknown> = {}): void {
  log("runtime", "send", messageType, details);
}

export function traceRuntimeReceive(
  messageType: string,
  sender: { url?: string; tabUrl?: string; tabId?: number | null } = {},
): void {
  log("runtime", "recv", messageType, {
    senderUrl: sender.url || "",
    senderTabUrl: sender.tabUrl || "",
    senderTabId: sender.tabId ?? null,
  });
}

// --- Bus envelopes (structured pub/sub) ---

export function traceBusSend(
  envelopeType: string,
  envelopeKind: string,
  details: Record<string, unknown> = {},
): void {
  log("bus", "send", `${envelopeKind}:${envelopeType}`, details);
}

export function traceBusReceive(
  envelopeType: string,
  envelopeKind: string,
  details: Record<string, unknown> = {},
): void {
  log("bus", "recv", `${envelopeKind}:${envelopeType}`, details);
}

export function traceBusPublish(
  eventType: string,
  target: string,
  tabId: number | null,
): void {
  log("bus", "publish", eventType, { target, tabId });
}

// --- Tab messages (tabs.sendMessage) ---

export function traceTabSend(
  tabId: number | null,
  messageType: string,
  details: Record<string, unknown> = {},
): void {
  log("tab", "send", messageType, { tabId, ...details });
}

export function traceTabReceive(messageType: string, tabId: number | null): void {
  log("tab", "recv", messageType, { tabId });
}

// --- Brain projection (internal state store → bus publish) ---

export function traceBrainProject(tabId: number, version: number, reason: string): void {
  log("brain", "project", "VIEW_UPDATED", { tabId, version, reason });
}

// --- Popup view application (bus subscribe → setViewState) ---

export function tracePopupApplyView(tabId: number, hasTabState: boolean, hasSiteId: boolean): void {
  log("popup", "apply", "VIEW_UPDATED", { tabId, hasTabState, hasSiteId });
}

// --- Page data lifecycle ---

export function tracePageDataResolve(tabId: number, pageUrl: string, status: string): void {
  log("brain", "resolve", "site-context", { tabId, pageUrl, status });
}

export function tracePageDataLoad(tabId: number, navigationKey: string, status: string): void {
  log("brain", "load", "page-data", { tabId, navigationKey, status });
}
