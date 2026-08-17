import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusFrame } from "../../../src/messaging/contract";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../../src/domain/constants";

describe("rewrite background startup", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("opens the rewrite popup side panel from the extension action", async () => {
    const addMessageListener = vi.fn();
    const addActionListener = vi.fn();
    const addAlarmListener = vi.fn();
    let resolveSetOptions: (() => void) | null = null;
    const setOptions = vi.fn(() => new Promise<void>((resolve) => {
      resolveSetOptions = resolve;
    }));
    const open = vi.fn().mockResolvedValue(undefined);
    const createAlarm = vi.fn();
    const clearAlarm = vi.fn();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: addMessageListener },
      },
      action: {
        onClicked: { addListener: addActionListener },
      },
      sidePanel: {
        setOptions,
        open,
      },
      alarms: {
        create: createAlarm,
        clear: clearAlarm,
        onAlarm: { addListener: addAlarmListener },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    expect(addActionListener).toHaveBeenCalledTimes(1);
    expect(addMessageListener).toHaveBeenCalledTimes(1);
    expect(addAlarmListener).toHaveBeenCalledTimes(1);
    expect(createAlarm).toHaveBeenCalledWith("uf-property-lock-heartbeat", { periodInMinutes: 0.5 });

    const listener = addActionListener.mock.calls[0]?.[0] as (tab: chrome.tabs.Tab) => void;
    listener({ id: 42 } as chrome.tabs.Tab);
    await Promise.resolve();

    expect(setOptions).toHaveBeenCalledWith({
      path: "popup.html",
      enabled: true,
    });
    expect(setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: "popup.html",
      enabled: true,
    });
    expect(open).toHaveBeenCalledWith({ tabId: 42 });
    expect(open.mock.invocationCallOrder[0]).toBeGreaterThan(setOptions.mock.invocationCallOrder[0]);
    resolveSetOptions?.();
  });

  it("mounts the rewrite brain runtime on the shipped background path", async () => {
    const addMessageListener = vi.fn();
    const sendMessage = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage,
        onMessage: { addListener: addMessageListener },
      },
      action: {
        onClicked: { addListener: vi.fn() },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown) => unknown;
    runtimeListener({
      kind: "uf-bus/1",
      frameType: "event",
      id: "event-1",
      seq: 1,
      name: "fact.reported",
      source: "content",
      sourceInstance: "content:tab:5:test",
      target: "background",
      payload: {
        kind: "uf-fact/1",
        sensation: {
          tabId: 5,
          source: "content",
          reason: "marking-toggle",
          facts: {
            tabId: 5,
            pageUrl: "https://example.com",
            markingToggleSeq: 1,
          },
        },
      },
    }, {}, () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    let response: unknown;
    const keepOpen = runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "req-1",
      seq: 2,
      name: "signals.pull",
      source: "content",
      sourceInstance: "content:test",
      target: "background",
      payload: {
        tabId: 5,
        afterSeq: 0,
      },
    }, {}, (value: unknown) => {
      response = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeListener).toBeDefined();
    expect(keepOpen).toBe(true);
    expect(response).toMatchObject({
      kind: "uf-bus/1",
      frameType: "reply",
      ok: true,
      payload: [{ name: "markings.changed", source: "brain" }],
    });
  });

  it("submits the authoritative multi-page corpus and holds the keepalive until AI polling finishes", async () => {
    const originalFetch = globalThis.fetch;
    let finishStatus: (() => void) | null = null;
    let aiRequestBody: unknown;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify({
          version: 2,
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          propertyRevision: 4,
          feedRevision: 2,
          membershipFingerprint: "membership-2",
          assignmentFingerprint: "assignment-2",
          renderMode: "rendered",
          renderModeUpdatedAt: "2026-08-17T10:00:00Z",
          selectors: { inclusionSelectors: ["article"], exclusionSelectors: [".promo"] },
          selectorsUpdatedAt: "2026-08-17T10:00:00Z",
          submittedSelectorsFingerprint: "selectors-2",
          pages: {
            "/stored": {
              timestamp: "2026-08-17T09:00:00Z",
              pageType: "detail",
              renderedHtml: "<html><main>Stored sibling</main></html>",
              rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
            },
            "/page": {
              timestamp: "2026-08-17T09:30:00Z",
              pageType: "detail",
              renderedHtml: "<html><main>Stale current page</main></html>",
              rows: [{ xpath: "/html[1]/body[1]/main[2]", excluded: false }],
            },
          },
          reconciliation: {
            revision: 2,
            feedFingerprint: "feed-2",
            removedPageKeys: [],
            relabelledPages: [],
          },
        }), { status: 200 });
      }
      if (url.endsWith("/get_selectors")) {
        aiRequestBody = JSON.parse(String(init?.body ?? "null"));
        return new Response(JSON.stringify({ session_id: "backend-run-1" }), { status: 200 });
      }
      if (url.endsWith("/get_selectors/status/backend-run-1")) {
        return await new Promise<Response>((resolve) => {
          finishStatus = () => resolve(new Response(JSON.stringify({
            session_id: "backend-run-1",
            status: "done",
          }), { status: 200 }));
        });
      }
      if (url.endsWith("/get_selectors/result/backend-run-1")) {
        return new Response(JSON.stringify({
          inclusionSelectors: ["main"],
          exclusionSelectors: [".ad"],
        }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      const addMessageListener = vi.fn();
      const addAlarmListener = vi.fn();
      const createAlarm = vi.fn();
      const clearAlarm = vi.fn();
      globalThis.chrome = {
        runtime: { onMessage: { addListener: addMessageListener } },
        action: { onClicked: { addListener: vi.fn() } },
        alarms: {
          create: createAlarm,
          clear: clearAlarm,
          onAlarm: { addListener: addAlarmListener },
        },
      } as unknown as typeof chrome;

      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const listener = addMessageListener.mock.calls[0]?.[0] as (
        frame: BusFrame,
        sender: unknown,
        sendResponse: (reply: BusFrame) => void,
      ) => boolean;
      let requestSeq = 0;
      const request = (name: string, payload: unknown): Promise<BusFrame> => new Promise((resolve) => {
        requestSeq += 1;
        const keepOpen = listener({
          kind: "uf-bus/1",
          frameType: "request",
          id: `request-${requestSeq}`,
          seq: requestSeq,
          name,
          source: "popup",
          sourceInstance: "popup:test",
          target: "background",
          payload,
        }, {}, resolve);
        expect(keepOpen).toBe(true);
      });
      await request("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://config.example.com",
        aiEndpoint: "https://ai.example.com",
      });
      await expect(request("config.load", { siteId: 42 })).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok", config: { propertyRevision: 4 } },
      });

      const aiReply = request("ai.run", {
        tabId: 77,
        siteId: 42,
        pageKey: "/page",
        clientRunId: "popup-run-1",
        snapshot: {
          baseUrl: "https://example.com",
          renderMode: "rendered",
          defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
          pages: [{
            url: "https://www.example.com/page",
            renderedHtml: "<html><main>Job</main></html>",
            renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
          }],
        },
      });
      for (let tick = 0; tick < 50 && finishStatus === null; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(finishStatus).not.toBeNull();
      expect(createAlarm).toHaveBeenCalledWith("uf-rewrite-brain-keepalive", { periodInMinutes: 0.5 });
      const keepAliveClearsBeforeWake = clearAlarm.mock.calls.filter(
        ([name]) => name === "uf-rewrite-brain-keepalive",
      ).length;

      // An alarm wake while the network request is still pending must see the
      // active long-running lease and leave it intact.
      for (const [alarmListener] of addAlarmListener.mock.calls) {
        alarmListener({ name: "uf-rewrite-brain-keepalive" });
      }
      expect(clearAlarm.mock.calls.filter(
        ([name]) => name === "uf-rewrite-brain-keepalive",
      )).toHaveLength(keepAliveClearsBeforeWake);

      finishStatus?.();
      await expect(aiReply).resolves.toMatchObject({
        frameType: "reply",
        ok: true,
        payload: {
          status: "ok",
          sessionId: "backend-run-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        },
      });
      expect(aiRequestBody).toMatchObject({
        pages: [
          {
            url: "https://example.com/stored",
            renderedHtml: "<html><main>Stored sibling</main></html>",
            renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
          },
          {
            url: "https://www.example.com/page",
            renderedHtml: "<html><main>Job</main></html>",
            renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
          },
        ],
      });
      expect(clearAlarm.mock.calls.filter(
        ([name]) => name === "uf-rewrite-brain-keepalive",
      )).toHaveLength(keepAliveClearsBeforeWake + 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serves property-lock directives through the shipped typed bus", async () => {
    const addMessageListener = vi.fn();
    const sendMessage = vi.fn();
    const tabsSendMessage = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage,
        onMessage: { addListener: addMessageListener },
      },
      tabs: {
        sendMessage: tabsSendMessage,
      },
      action: {
        onClicked: { addListener: vi.fn() },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;
    let response: unknown;
    const keepOpen = runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "lock-1",
      seq: 1,
      name: "lock.directive",
      source: "popup",
      sourceInstance: "popup:test",
      target: "background",
      payload: {
        tabId: 5,
        pageUrl: "https://example.com/page",
        baseUrl: "https://example.com",
        hasUnsavedChanges: false,
      },
    }, {}, (value: unknown) => {
      response = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(keepOpen).toBe(true);
    // This background was just started with an empty store, so no registered
    // environment can be sent to Hub. The point
    // being made here is the wiring: the request reaches the lock runtime and a
    // well-formed reply comes back over the shipped bus. That an authenticated
    // request goes on to resolve a site and hold a lock is covered where the
    // runtime is exercised directly, in services.test.ts.
    expect(response).toMatchObject({
      kind: "uf-bus/1",
      frameType: "reply",
      ok: true,
      payload: {
        status: "not_configured",
        baseUrl: "https://example.com",
        siteId: null,
        lockRole: "unknown",
        configPresent: false,
        canEdit: false,
        blockedReason: "not-configured",
      },
    });
    const lockResponse = (response as { payload?: { lockBanner?: unknown } }).payload;
    expect(lockResponse?.lockBanner).toEqual({ visible: true, reason: "not-configured" });
    expect(lockResponse?.lockBanner).not.toHaveProperty("text");

    let signalsResponse: unknown;
    runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "lock-signals-1",
      seq: 2,
      name: "signals.pull",
      source: "popup",
      sourceInstance: "popup:test",
      target: "background",
      payload: { tabId: 5, afterSeq: 0 },
    }, {}, (value: unknown) => {
      signalsResponse = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signalsResponse).toMatchObject({
      ok: true,
      payload: [{
        name: "lock.blocked",
        source: "brain",
        payload: {
            blockedReason: "not-configured",
            banner: { visible: true, reason: "not-configured" },
        },
      }],
    });
    const lockSignal = (signalsResponse as { payload?: Array<{ payload?: { banner?: unknown } }> }).payload?.[0];
    expect(lockSignal?.payload?.banner).not.toHaveProperty("text");
  });

  it("serves CDP device emulation through the shipped typed bus", async () => {
    const addMessageListener = vi.fn();
    const debuggerCalls: unknown[] = [];
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      debugger: {
        attach(target: unknown, version: string, callback: () => void) {
          debuggerCalls.push({ method: "attach", target, version });
          callback();
        },
        sendCommand(target: unknown, method: string, params: unknown, callback: () => void) {
          debuggerCalls.push({ method, target, params });
          callback();
        },
        detach(target: unknown, callback: () => void) {
          debuggerCalls.push({ method: "detach", target });
          callback();
        },
      },
      tabs: {
        sendMessage: vi.fn(),
      },
      action: {
        onClicked: { addListener: vi.fn() },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;
    let response: unknown;
    runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "emu-1",
      seq: 1,
      name: "emulation.apply",
      source: "popup",
      sourceInstance: "popup:test",
      target: "background",
      payload: { tabId: 5, mode: "mobile", scale: 2 },
    }, {}, (value: unknown) => {
      response = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response).toMatchObject({
      frameType: "reply",
      ok: true,
      payload: { mode: "mobile", width: 412, height: 960, scale: 1, active: true },
    });
    expect(debuggerCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "attach", target: { tabId: 5 } }),
      expect.objectContaining({ method: "Emulation.setDeviceMetricsOverride", params: expect.objectContaining({ width: 412, height: 960 }) }),
    ]));
  });

  it("round-trips connection settings so the popup can configure the endpoints", async () => {
    const addMessageListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    const call = async (name: string, payload: unknown, id: string, seq: number): Promise<unknown> => {
      let response: unknown;
      runtimeListener({
        kind: "uf-bus/1",
        frameType: "request",
        id,
        seq,
        name,
        source: "popup",
        sourceInstance: "popup:test",
        target: "background",
        payload,
      }, {}, (value: unknown) => {
        response = value;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return response;
    };

    expect(await call("settings.load", {}, "settings-load-1", 1)).toMatchObject({
      ok: true,
      payload: { settings: {}, hasToken: false },
    });

    const settings = {
      configEndpoint: "https://config.example.com/",
      aiEndpoint: "https://ai.example.com/",
      stageBase: "stage.example.com",
    };
    expect(await call("settings.save", settings, "settings-save-1", 2)).toMatchObject({
      ok: true,
      payload: { status: "ok", settings, hasToken: false },
    });
    expect(await call("settings.load", {}, "settings-load-2", 3)).toMatchObject({
      ok: true,
      payload: { settings, hasToken: false },
    });
  });

  it("carries the stored JWT through an endpoint save", async () => {
    const addMessageListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ token: "jwt-abc" }), { status: 200 })) as typeof fetch;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

      const call = async (name: string, payload: unknown, id: string, seq: number): Promise<unknown> => {
        let response: unknown;
        runtimeListener({
          kind: "uf-bus/1",
          frameType: "request",
          id,
          seq,
          name,
          source: "popup",
          sourceInstance: "popup:test",
          target: "background",
          payload,
        }, {}, (value: unknown) => {
          response = value;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return response;
      };

      await call("settings.save", { stageBase: "a.example.com" }, "s-1", 1);
      await call("accounts.login", { email: "a@b.c", password: "pw" }, "s-2", 2);
      expect(await call("settings.load", {}, "s-3", 3)).toMatchObject({
        ok: true,
        payload: { hasToken: true },
      });

      // Saving endpoints again must not clear the token the login just stored.
      await call("settings.save", { stageBase: "a.example.com", aiEndpoint: "https://ai.example.com" }, "s-4", 4);
      expect(await call("settings.load", {}, "s-5", 5)).toMatchObject({
        ok: true,
        payload: {
          settings: { stageBase: "a.example.com", aiEndpoint: "https://ai.example.com" },
          hasToken: true,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads a property's stored config back over the bus", async () => {
    const addMessageListener = vi.fn();
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(), onMessage: { addListener: addMessageListener } },
      alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: vi.fn() } },
    } as unknown as typeof chrome;
    const stored = {
      version: 2,
      environmentKey: "a.example.com",
      baseUrl: "https://shop.example.com",
      siteId: 4821,
      propertyRevision: 1,
      feedRevision: 1,
      membershipFingerprint: "membership",
      assignmentFingerprint: "assignment",
      renderMode: "static",
      renderModeUpdatedAt: "2026-08-04T10:00:00Z",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      selectorsUpdatedAt: "2026-08-04T10:00:00Z",
      submittedSelectorsFingerprint: "",
      pages: {},
      reconciliation: {
        revision: 1,
        feedFingerprint: "feed",
        removedPageKeys: [],
        relabelledPages: [],
      },
    };
    const requests: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify(stored), { status: 200 });
    }) as typeof fetch;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;
      const call = async (name: string, payload: unknown, id: string, seq: number): Promise<unknown> => {
        let response: unknown;
        runtimeListener({
          kind: "uf-bus/1", frameType: "request", id, seq, name,
          source: "popup", sourceInstance: "popup:test", target: "background", payload,
        }, {}, (value: unknown) => { response = value; });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return response;
      };

      await call("settings.save", {
        configEndpoint: "https://config.example.com",
        stageBase: "a.example.com",
      }, "c-1", 1);
      expect(await call("config.load", { siteId: 4821 }, "c-2", 2)).toMatchObject({
        ok: true,
        payload: { status: "ok", config: { renderMode: "static", renderModeUpdatedAt: "2026-08-04T10:00:00Z" } },
      });
      expect(requests.at(-1)).toEqual({
        url: "https://config.example.com/load",
        body: { environmentKey: "a.example.com", siteId: 4821 },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a panel's known-stale fence in background without sending a save", async () => {
    const addMessageListener = vi.fn();
    const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    const socketFrames: string[] = [];
    class FakeWebSocket {
      send(data: string): void { socketFrames.push(data); }
      close(): void {}
      addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      }
      emit(type: string, data?: unknown): void {
        for (const listener of listeners.get(type) ?? []) listener({ data });
      }
    }
    const socket = new FakeWebSocket();
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;
    const saveRequests: Array<{ url: string; body: unknown }> = [];
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn(), onMessage: { addListener: addMessageListener } },
      tabs: {
        sendMessage: vi.fn(),
        query: vi.fn().mockResolvedValue([{ id: 5, windowId: 1, active: true }]),
      },
      windows: {
        getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
      },
      idle: {
        setDetectionInterval: vi.fn(),
        queryState: vi.fn().mockResolvedValue("active"),
      },
      action: { onClicked: { addListener: vi.fn() } },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;
    globalThis.WebSocket = (class {
      constructor() { return socket; }
    }) as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt-live" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/page",
          pageTypes: [{ pageType: "detail", pages: [{ pageKey: "/page", wordsCount: 100 }] }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/save")) {
        saveRequests.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (
        message: unknown,
        sender: unknown,
        sendResponse: (value: unknown) => void,
      ) => unknown;
      let sequence = 0;
      const call = async (name: string, payload: unknown): Promise<unknown> => {
        sequence += 1;
        let response: unknown;
        runtimeListener({
          kind: "uf-bus/1",
          frameType: "request",
          id: `fence-${sequence}`,
          seq: sequence,
          name,
          source: "popup",
          sourceInstance: "popup:test",
          target: "background",
          payload,
        }, {}, (value: unknown) => { response = value; });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return response;
      };

      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://config.example.com",
      });
      await call("accounts.login", { email: "editor@example.com", password: "pw" });
      // The content consumer establishes the tab-scoped lock; no side panel
      // lock.directive request is needed to start or own the editor session.
      sequence += 1;
      runtimeListener({
        kind: "uf-bus/1",
        frameType: "event",
        id: "content-started-1",
        seq: sequence,
        name: "fact.reported",
        source: "content",
        sourceInstance: "content:tab:5:test",
        target: "background",
        payload: {
          kind: "uf-fact/1",
          sensation: {
            tabId: 0,
            source: "content",
            reason: "content-started",
            facts: {
              tabId: 0,
              pageUrl: "https://example.com/page",
              baseUrl: "https://example.com",
            },
          },
        },
      }, {}, () => undefined);
      for (let tick = 0; tick < 10 && !listeners.has("open"); tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(listeners.has("open")).toBe(true);

      socket.emit("open");
      const subscribe = JSON.parse(socketFrames[0] ?? "{}");
      expect(subscribe).toMatchObject({
        type: "subscribe",
        environmentKey: "stage.example.com",
        siteId: 42,
        visible: true,
        focusedWindow: true,
        browserIdle: false,
        hasUnsavedWork: false,
      });
      expect(subscribe.editorSessionId).toEqual(expect.any(String));
      socket.emit("message", JSON.stringify({
        type: "subscribed",
        identity: "editor@example.com",
        editorSessionId: subscribe.editorSessionId,
        propertyRevision: 4,
        feedRevision: 2,
      }));
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorName: "Editor",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-current",
        propertyRevision: 4,
        feedRevision: 2,
      }));

      const reply = await call("config.save", {
        operationId: "save-stale-1",
        environmentKey: "stage.example.com",
        siteId: 42,
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-stale",
        expectedPropertyRevision: 4,
        expectedFeedRevision: 2,
        page: {
          pageKey: "/page",
          pageType: "detail",
          renderedHtml: "<html></html>",
          rows: [],
        },
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
        renderMode: "rendered",
      });

      expect(reply).toMatchObject({
        ok: true,
        payload: { status: "stale_fence", httpStatus: 409 },
      });
      expect(saveRequests).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
    }
  });

  it("registers the auth-token alarm and reports the cached verdict over the bus", async () => {
    const addMessageListener = vi.fn();
    const addAlarmListener = vi.fn();
    const createAlarm = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      alarms: {
        create: createAlarm,
        clear: vi.fn(),
        onAlarm: { addListener: addAlarmListener },
      },
    } as unknown as typeof chrome;
    const originalFetch = globalThis.fetch;
    // Login succeeds so a token gets stored; validate then rejects it, which is
    // the only outcome that counts as "signed out".
    globalThis.fetch = (async (url: RequestInfo | URL) => String(url).includes("/api/account/login")
      ? new Response(JSON.stringify({ token: "jwt-abc" }), { status: 200 })
      : new Response("{}", { status: 401 })) as typeof fetch;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();

      expect(createAlarm).toHaveBeenCalledWith("uf-rewrite-auth-token-check", { periodInMinutes: 10 });

      const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;
      const call = async (name: string, payload: unknown, id: string, seq: number): Promise<unknown> => {
        let response: unknown;
        runtimeListener({
          kind: "uf-bus/1",
          frameType: "request",
          id,
          seq,
          name,
          source: "popup",
          sourceInstance: "popup:test",
          target: "background",
          payload,
        }, {}, (value: unknown) => {
          response = value;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return response;
      };

      // Nothing checked yet.
      expect(await call("accounts.status", {}, "a-1", 1)).toMatchObject({
        ok: true,
        payload: { state: "unknown", checkedAt: 0 },
      });

      await call("settings.save", { stageBase: "a.example.com" }, "a-2", 2);
      await call("accounts.login", { email: "a@b.c", password: "pw" }, "a-3", 3);

      // Firing the alarm must drive a real check through the monitor.
      const alarmListener = addAlarmListener.mock.calls.at(-1)?.[0] as (alarm: { name: string }) => void;
      alarmListener({ name: "uf-rewrite-auth-token-check" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await call("accounts.status", {}, "a-4", 4)).toMatchObject({
        ok: true,
        payload: { state: "invalid" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a settings payload whose endpoints are not URLs", async () => {
    const addMessageListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const runtimeListener = addMessageListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    let response: unknown;
    runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "settings-bad-1",
      seq: 1,
      name: "settings.save",
      // An empty string is what a cleared input yields; it must not be stored as
      // an endpoint, or every later request resolves against a broken base.
      source: "popup",
      sourceInstance: "popup:test",
      target: "background",
      payload: { configEndpoint: "" },
    }, {}, (value: unknown) => {
      response = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response).toMatchObject({
      frameType: "reply",
      ok: false,
      failure: { code: "INVALID_PAYLOAD" },
    });
  });
});
