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
});
