import { describe, expect, it } from "vitest";

import {
  adoptLockIdentity,
  buildClientFrame,
  buildPropertyLockWssUrl,
  isNetworkReachable,
  mirrorBackendTimings,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS,
  parseServerMessage,
  createPropertyLockClient,
  projectPropertyLockView,
} from "../../../src/lock";

function fakeSocket() {
  const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  const sent: string[] = [];
  return {
    sent,
    socket: {
      send(data: string) { sent.push(data); },
      close() {},
      addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    emit(type: string, data?: unknown) {
      for (const listener of listeners.get(type) ?? []) listener({ data });
    },
  };
}

describe("P9 property-lock client", () => {
  it("adopts backend-issued identities and invalidates old identities on rotation", () => {
    const first = {
      tabId: 1,
      siteId: 123,
      identity: "backend-1",
      updatedAt: 1,
    };
    const second = {
      ...first,
      identity: "backend-2",
      updatedAt: 2,
    };

    expect(adoptLockIdentity(null, first)).toMatchObject({
      current: first,
      previousInvalidated: false,
    });
    expect(adoptLockIdentity(first, second)).toMatchObject({
      current: second,
      previousInvalidated: true,
    });
  });

  it("builds lock WebSocket URLs and client frames with backend identity", () => {
    expect(buildPropertyLockWssUrl("https://lock.example.com", "a b")).toBe(
      "wss://lock.example.com/property-lock?token=a%20b",
    );
    expect(buildPropertyLockWssUrl("a.lynxdev.se", "token")).toBe(
      "wss://a.lynxdev.se/property-lock?token=token",
    );
    expect(buildPropertyLockWssUrl("http://localhost:3000", "token")).toBe(
      "ws://localhost:3000/property-lock?token=token",
    );
    expect(buildPropertyLockWssUrl("http://[", "token")).toBe("");
    expect(buildClientFrame({
      type: "heartbeat",
      siteId: 123,
      identity: "backend-1",
      pageUrl: "https://example.com",
      hasUnsavedChanges: false,
      extra: { suggestionId: "s1", accept: true, discardUnsaved: false },
    })).toEqual({
      type: "heartbeat",
      siteId: 123,
      clientId: "backend-1",
      pageUrl: "https://example.com",
      hasUnsavedChanges: false,
      suggestionId: "s1",
      accept: true,
      discardUnsaved: false,
    });
  });

  it("mirrors backend-authoritative timers without computing deadlines", () => {
    expect(PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS).toBe(70_000);
    expect(PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS).toBe(70_000);
    expect(PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS).toBe(30_000);
    expect(PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS).toBe(60_000);
    expect(mirrorBackendTimings({
      expiresAtUtc: "2026-07-07T00:00:00Z",
      secondsRemaining: 42,
    })).toEqual({
      expiresAtUtc: "2026-07-07T00:00:00Z",
      secondsRemaining: 42,
    });
  });

  it("projects unlocked lock state as editable without a blocking banner", () => {
    expect(projectPropertyLockView({
      role: "unknown",
      identity: "",
      editorName: "",
      state: "unlocked",
      timings: {},
      terminal: false,
    })).toEqual({ bannerVisible: false, text: "", canEdit: true });
  });

  it("combines websocket and independent HTTP reachability", () => {
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: true })).toBe(true);
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: false })).toBe(false);
    expect(isNetworkReachable({ websocketOpen: false, httpProbeReachable: true })).toBe(false);
  });

  it("parses target server message vocabulary", () => {
    expect(parseServerMessage({
      type: "subscribed",
      identity: "backend-1",
      name: "Editor",
    })).toMatchObject({ type: "subscribed", identity: "backend-1" });
    expect(() => parseServerMessage({ type: "unknown" })).toThrow();
  });

  it("runs a mocked PropertyLockClient lifecycle and projects its view", async () => {
    const ws = fakeSocket();
    const persisted: unknown[] = [];
    const client = createPropertyLockClient({
      socket: ws.socket,
      tabId: 1,
      siteId: 123,
      pageUrl: "https://example.com",
      identity: null,
      persistIdentity(identity) { persisted.push(identity); },
      hasUnsavedChanges: () => true,
      now: () => 10,
    });

    client.claim();
    expect(ws.sent).toHaveLength(0);
    ws.emit("open");
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: "subscribe", clientId: "pending", hasUnsavedChanges: true });
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    ws.emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: false,
      editorName: "Other",
      secondsRemaining: 60,
    }));

    expect(persisted).toEqual([{ tabId: 1, siteId: 123, identity: "backend-1", updatedAt: 10 }]);
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({ type: "take_lock", clientId: "backend-1" });
    expect(projectPropertyLockView(client.state())).toEqual({
      bannerVisible: true,
      text: "Locked by Other",
      canEdit: false,
      countdownSeconds: 60,
    });
    ws.emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: true, editorName: "Me" }));
    expect(projectPropertyLockView(client.state()).canEdit).toBe(true);
    ws.emit("close");
    expect(projectPropertyLockView(client.state()).canEdit).toBe(false);
    client.heartbeat();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).not.toMatchObject({ type: "heartbeat" });
  });
});
