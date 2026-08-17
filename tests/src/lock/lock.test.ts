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

  it("does not treat unknown initial lock state as editable", () => {
    expect(projectPropertyLockView({
      role: "unknown",
      identity: "",
      editorName: "",
      state: "unlocked",
      timings: {},
      terminal: false,
    })).toEqual({ bannerVisible: true, text: "Property lock connecting", canEdit: false });
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
    ws.emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: true,
      editorName: "Me",
      environmentKey: "a.example.com",
      editorSessionId: "editor-1",
      lockToken: "lock-1",
      propertyRevision: 4,
      feedRevision: 2,
    }));
    expect(projectPropertyLockView(client.state()).canEdit).toBe(true);
    expect(client.state()).toMatchObject({ lockToken: "lock-1", propertyRevision: 4, feedRevision: 2 });
    ws.emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: false,
      editorName: "Other",
    }));
    expect(client.state()).toMatchObject({ role: "passive" });
    expect(client.state().lockToken).toBeUndefined();
    ws.emit("close");
    expect(projectPropertyLockView(client.state()).canEdit).toBe(false);
    client.heartbeat();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).not.toMatchObject({ type: "heartbeat" });
  });

  it("mirrors lock server handoff warnings and suggestion states", () => {
    const ws = fakeSocket();
    const states: unknown[] = [];
    const client = createPropertyLockClient({
      socket: ws.socket,
      tabId: 1,
      siteId: 123,
      pageUrl: "https://example.com",
      identity: null,
      persistIdentity() {},
      onStateChange(state) { states.push(state); },
    });

    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    ws.emit("message", JSON.stringify({ type: "disconnect_warning", reason: "network", secondsRemaining: 70 }));
    expect(projectPropertyLockView(client.state())).toEqual({
      bannerVisible: true,
      text: "Connection lost; editor role may be released",
      canEdit: false,
      countdownSeconds: 70,
    });
    ws.emit("message", JSON.stringify({ type: "takeover_suggestion", suggestionId: "s1", fromName: "Other" }));
    expect(projectPropertyLockView(client.state()).text).toBe("Other wants to take over editing");
    ws.emit("message", JSON.stringify({ type: "suggestion_pending", suggestionId: "s1" }));
    expect(client.state().suggestionPending).toBe(true);
    ws.emit("message", JSON.stringify({ type: "suggestion_response", suggestionId: "s1" }));
    expect(client.state().suggestionPending).toBe(false);
    expect(client.state().suggestionResponseId).toBe("s1");
    ws.emit("message", JSON.stringify({ type: "suggestion_accepted", suggestionId: "s1" }));
    expect(client.state().acceptedSuggestionId).toBe("s1");
    ws.emit("message", JSON.stringify({ type: "transfer_countdown", fromName: "A", toName: "B", secondsRemaining: 12 }));
    expect(projectPropertyLockView(client.state())).toEqual({
      bannerVisible: true,
      text: "Editing is being transferred from A to B",
      canEdit: false,
      countdownSeconds: 12,
    });
    expect(states.length).toBeGreaterThan(5);
  });

  it("suppresses heartbeat after the editor idle window but sends activity and status frames", () => {
    const ws = fakeSocket();
    let now = 0;
    const client = createPropertyLockClient({
      socket: ws.socket,
      tabId: 1,
      siteId: 123,
      pageUrl: "https://example.com",
      identity: { tabId: 1, siteId: 123, identity: "backend-1", updatedAt: 0 },
      persistIdentity() {},
      now: () => now,
    });

    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    client.clientStatus();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({ type: "client_status" });
    now = 31 * 60_000;
    client.heartbeat();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({ type: "client_status" });
    client.activity();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({ type: "activity" });
    client.heartbeat();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({ type: "heartbeat" });
    client.heartbeat();
    expect(ws.sent.filter((frame) => JSON.parse(frame).type === "heartbeat")).toHaveLength(1);
  });

  it("deduplicates queued pre-subscribe frames before identity arrives", () => {
    const ws = fakeSocket();
    const client = createPropertyLockClient({
      socket: ws.socket,
      tabId: 1,
      siteId: 123,
      pageUrl: "https://example.com",
      identity: null,
      persistIdentity() {},
      now: () => 0,
    });

    client.claim();
    client.claim();
    client.clientStatus();
    client.clientStatus();
    client.heartbeat();
    client.heartbeat();
    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));

    const sentTypes = ws.sent.map((frame) => JSON.parse(frame).type);
    expect(sentTypes.filter((type) => type === "take_lock")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "client_status")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "heartbeat")).toHaveLength(1);
  });
});
