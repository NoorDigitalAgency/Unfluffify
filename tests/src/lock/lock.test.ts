import { describe, expect, it, vi } from "vitest";

import {
  adoptEditorSession,
  buildClientFrame,
  buildPropertyLockWssUrl,
  checkNetworkReachability,
  isNetworkReachable,
  mirrorBackendTimings,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_PASSIVE_RELEASE_COUNTDOWN_MS,
  PROPERTY_LOCK_RECONNECT_DELAY_MS,
  PROPERTY_LOCK_RECONNECT_MAX_DELAY_MS,
  parseServerMessage,
  createPropertyLockClient,
  projectPropertyLockView,
} from "../../../src/lock";

function fakeSocket() {
  const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  const sent: string[] = [];
  let closeCount = 0;
  return {
    sent,
    get closeCount() { return closeCount; },
    socket: {
      send(data: string) { sent.push(data); },
      close() { closeCount += 1; },
      addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    emit(type: string, data?: unknown) {
      for (const listener of listeners.get(type) ?? []) listener({ data });
    },
  };
}

function editorSession(overrides: Readonly<Partial<{
  environmentKey: string;
  tabId: number;
  siteId: number;
  editorSessionId: string;
  createdAt: number;
  updatedAt: number;
}>> = {}) {
  return {
    environmentKey: "stage.example.com",
    tabId: 1,
    siteId: 123,
    editorSessionId: "editor-1",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("P9 property-lock client", () => {
  it("keeps client editor sessions distinct from backend identity and detects rotation", () => {
    const first = editorSession({ updatedAt: 1 });
    const second = {
      ...first,
      editorSessionId: "editor-2",
      updatedAt: 2,
    };

    expect(adoptEditorSession(null, first)).toMatchObject({
      current: first,
      previousInvalidated: false,
    });
    expect(adoptEditorSession(first, second)).toMatchObject({
      current: second,
      previousInvalidated: true,
    });
  });

  it("builds environment-scoped lock frames with editor session, presence, and fence", () => {
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
      environmentKey: "stage.example.com",
      siteId: 123,
      editorSessionId: "editor-1",
      presence: { visible: true, focusedWindow: false, browserIdle: false },
      hasUnsavedWork: false,
      lockToken: "lock-1",
      extra: { suggestionId: "s1", accept: true, discardUnsaved: false },
    })).toEqual({
      type: "heartbeat",
      environmentKey: "stage.example.com",
      siteId: 123,
      editorSessionId: "editor-1",
      visible: true,
      focusedWindow: false,
      browserIdle: false,
      hasUnsavedWork: false,
      lockToken: "lock-1",
      suggestionId: "s1",
      accept: true,
      discardUnsaved: false,
    });
  });

  it("mirrors backend-authoritative timers without computing deadlines", () => {
    expect(PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(PROPERTY_LOCK_RECONNECT_DELAY_MS).toBe(2_000);
    expect(PROPERTY_LOCK_RECONNECT_MAX_DELAY_MS).toBe(60_000);
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
      connectivity: "connecting",
      backendIdentity: "",
      editorName: "",
      state: "unlocked",
      timings: {},
      terminal: false,
    })).toEqual({ bannerVisible: true, reason: "connecting", canEdit: false });
  });

  it("combines websocket and independent HTTP reachability", () => {
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: true })).toBe(true);
    expect(isNetworkReachable({ websocketOpen: true, httpProbeReachable: false })).toBe(false);
    expect(isNetworkReachable({ websocketOpen: false, httpProbeReachable: true })).toBe(false);
  });

  it("probes independent HTTP endpoints with a bounded no-cache request", async () => {
    const requests: Array<{ url: string; init: Record<string, unknown> }> = [];
    const reachable = await checkNetworkReachability({
      urls: ["https://probe-one.example", "https://probe-two.example"],
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url.includes("one")) throw new Error("first probe failed");
        return {};
      },
    });

    expect(reachable).toBe(true);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://probe-one.example",
      "https://probe-two.example",
    ]);
    expect(requests[0].init).toMatchObject({ cache: "no-store", mode: "no-cors" });
    expect(requests[0].init.signal).toBeInstanceOf(AbortSignal);
    await expect(checkNetworkReachability({
      urls: ["https://probe-one.example", "https://probe-two.example"],
      fetch: async () => { throw new Error("offline"); },
    })).resolves.toBe(false);
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
      editorSession: editorSession(),
      persistEditorSession(session) { persisted.push(session); },
      hasUnsavedWork: () => true,
      now: () => 10,
    });

    client.claim();
    expect(ws.sent).toHaveLength(0);
    ws.emit("open");
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: "subscribe",
      environmentKey: "stage.example.com",
      siteId: 123,
      editorSessionId: "editor-1",
      visible: true,
      focusedWindow: true,
      browserIdle: false,
      hasUnsavedWork: true,
    });
    ws.emit("message", JSON.stringify({
      type: "subscribed",
      identity: "backend-account-1",
      editorSessionId: "editor-1",
      propertyRevision: 0,
      feedRevision: 0,
    }));
    ws.emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: false,
      editorName: "Other",
      secondsRemaining: 60,
    }));

    expect(persisted).toEqual([editorSession({ updatedAt: 10 })]);
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({
      type: "take_lock",
      environmentKey: "stage.example.com",
      editorSessionId: "editor-1",
    });
    expect(client.state().backendIdentity).toBe("backend-account-1");
    expect(projectPropertyLockView(client.state())).toEqual({
      bannerVisible: true,
      reason: "locked",
      canEdit: false,
      countdownSeconds: 60,
      editorName: "Other",
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
    client.activity();
    expect(JSON.parse(ws.sent.at(-1) ?? "{}")).toMatchObject({
      type: "activity",
      editorSessionId: "editor-1",
      lockToken: "lock-1",
      hasUnsavedWork: true,
    });
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
      editorSession: editorSession(),
      persistEditorSession() {},
      onStateChange(state) { states.push(state); },
    });

    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1", editorSessionId: "editor-1" }));
    ws.emit("message", JSON.stringify({ type: "disconnect_warning", reason: "network", secondsRemaining: 70 }));
    expect(projectPropertyLockView(client.state())).toEqual({
      bannerVisible: true,
      reason: "disconnect-warning",
      canEdit: false,
      countdownSeconds: 70,
    });
    ws.emit("message", JSON.stringify({ type: "takeover_suggestion", suggestionId: "s1", fromName: "Other" }));
    expect(projectPropertyLockView(client.state())).toMatchObject({
      reason: "takeover-suggested",
      fromName: "Other",
    });
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
      reason: "transfer",
      canEdit: false,
      countdownSeconds: 12,
      fromName: "A",
      toName: "B",
    });
    expect(states.length).toBeGreaterThan(5);
  });

  it("suppresses heartbeat after the editor idle window but sends activity and status frames", () => {
    const ws = fakeSocket();
    let now = 0;
    const client = createPropertyLockClient({
      socket: ws.socket,
      editorSession: editorSession(),
      persistEditorSession() {},
      now: () => now,
    });

    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1", editorSessionId: "editor-1" }));
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

  it("deduplicates queued frames until the editor session subscription is acknowledged", () => {
    const ws = fakeSocket();
    const client = createPropertyLockClient({
      socket: ws.socket,
      editorSession: editorSession(),
      persistEditorSession() {},
      now: () => 0,
    });

    client.claim();
    client.claim();
    client.clientStatus();
    client.clientStatus();
    client.heartbeat();
    client.heartbeat();
    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1", editorSessionId: "editor-1" }));

    const sentTypes = ws.sent.map((frame) => JSON.parse(frame).type);
    expect(sentTypes.filter((type) => type === "take_lock")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "client_status")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "heartbeat")).toHaveLength(1);
  });

  it("never adopts a backend response for a different editor session", () => {
    const ws = fakeSocket();
    const client = createPropertyLockClient({
      socket: ws.socket,
      editorSession: editorSession(),
      persistEditorSession() {},
    });

    client.claim();
    ws.emit("open");
    ws.emit("message", JSON.stringify({
      type: "subscribed",
      identity: "backend-account",
      editorSessionId: "different-editor-session",
    }));

    expect(ws.closeCount).toBe(1);
    expect(client.isClosed()).toBe(true);
    expect(ws.sent.map((frame) => JSON.parse(frame).type)).toEqual(["subscribe"]);
    expect(client.editorSession().editorSessionId).toBe("editor-1");
  });

  it("persists a JWT rotation delivered on the lock channel", async () => {
    const ws = fakeSocket();
    const updates: string[] = [];
    createPropertyLockClient({
      socket: ws.socket,
      editorSession: editorSession(),
      persistEditorSession() {},
      onTokenUpdate(token) { updates.push(token); },
    });

    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "token_update", token: "jwt-rotated" }));
    await Promise.resolve();
    expect(updates).toEqual(["jwt-rotated"]);
  });

  it("reconnects with exponential backoff without closing the editor session", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const client = createPropertyLockClient({
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        networkReachable: async () => true,
        editorSession: editorSession(),
        persistEditorSession() {},
      });

      sockets[0].emit("error");
      expect(client.state()).toMatchObject({ role: "unknown", connectivity: "reconnecting" });
      expect(client.isClosed()).toBe(false);
      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_RECONNECT_DELAY_MS - 1);
      expect(sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(2);

      sockets[1].emit("error");
      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_RECONNECT_DELAY_MS * 2 - 1);
      expect(sockets).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(3);
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains an unsaved draft when the same editor session reacquires a stale lease", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const transfers: unknown[] = [];
      const client = createPropertyLockClient({
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        networkReachable: async () => true,
        editorSession: editorSession(),
        persistEditorSession() {},
        hasUnsavedWork: () => true,
        onOwnershipTransferred(event) { transfers.push(event); },
      });
      client.claim();
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({
        type: "subscribed",
        editorSessionId: "editor-1",
      }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-1",
        lockToken: "fence-old",
        ownershipGeneration: 1,
      }));

      sockets[0].emit("close");
      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_RECONNECT_DELAY_MS);
      sockets[1].emit("open");
      sockets[1].emit("message", JSON.stringify({
        type: "subscribed",
        editorSessionId: "editor-1",
      }));
      sockets[1].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-1",
        lockToken: "fence-reacquired",
        ownershipGeneration: 2,
      }));
      client.clientStatus();

      expect(transfers).toEqual([]);
      expect(client.state()).toMatchObject({
        role: "editor",
        connectivity: "connected",
        lockToken: "fence-reacquired",
      });
      expect(JSON.parse(sockets[1].sent.at(-1) ?? "{}")).toMatchObject({
        type: "client_status",
        editorSessionId: "editor-1",
        lockToken: "fence-reacquired",
        hasUnsavedWork: true,
      });
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks prolonged network failure unavailable without declaring an ownership transfer", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const transfers: unknown[] = [];
      const client = createPropertyLockClient({
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        networkReachable: async () => false,
        editorSession: editorSession(),
        persistEditorSession() {},
        hasUnsavedWork: () => true,
        onOwnershipTransferred(event) { transfers.push(event); },
      });
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-1" }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-1",
        lockToken: "fence-old",
        ownershipGeneration: 1,
      }));
      sockets[0].emit("close");

      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS);
      expect(client.state()).toMatchObject({ connectivity: "unavailable", role: "unknown" });
      expect(transfers).toEqual([]);

      sockets[1].emit("open");
      sockets[1].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-1" }));
      sockets[1].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-1",
        lockToken: "fence-restored",
        ownershipGeneration: 1,
      }));
      client.clientStatus();
      expect(JSON.parse(sockets[1].sent.at(-1) ?? "{}")).toMatchObject({
        type: "client_status",
        hasUnsavedWork: true,
      });
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
