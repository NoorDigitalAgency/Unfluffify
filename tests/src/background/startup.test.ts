import { afterEach, describe, expect, it, vi } from "vitest";

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
    let response: unknown;
    const keepOpen = runtimeListener({
      kind: "uf-bus/1",
      frameType: "request",
      id: "req-1",
      seq: 1,
      name: "signals.emit",
      source: "content",
      sourceInstance: "content:test",
      target: "background",
      payload: {
        tabId: 5,
        signal: {
        name: "markings.changed",
        source: "content",
        cause: "test",
        payload: { pageUrl: "https://example.com", markedCount: 1 },
      },
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
      payload: [{ name: "markings.changed" }],
    });
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
        siteId: 5542,
        hasUnsavedChanges: false,
      },
    }, {}, (value: unknown) => {
      response = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(keepOpen).toBe(true);
    expect(response).toMatchObject({
      kind: "uf-bus/1",
      frameType: "reply",
      ok: true,
      payload: {
        status: "ok",
        siteId: 5542,
        lockRole: "unknown",
        directive: expect.objectContaining({
          lockRole: "unknown",
          content: expect.objectContaining({ markingEditsBlocked: true }),
        }),
      },
    });
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
      version: 1,
      baseUrl: "https://shop.example.com",
      siteId: 4821,
      renderMode: "static",
      renderModeUpdatedAt: "2026-08-04T10:00:00Z",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      selectorsUpdatedAt: "2026-08-04T10:00:00Z",
      submittedSelectorsFingerprint: "",
      pageMarkings: {},
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

      await call("settings.save", { configEndpoint: "https://config.example.com" }, "c-1", 1);
      expect(await call("config.load", { siteId: 4821 }, "c-2", 2)).toMatchObject({
        ok: true,
        payload: { status: "ok", config: { renderMode: "static", renderModeUpdatedAt: "2026-08-04T10:00:00Z" } },
      });
      expect(requests.at(-1)).toEqual({
        url: "https://config.example.com/load",
        body: { siteId: 4821 },
      });
    } finally {
      globalThis.fetch = originalFetch;
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
