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
    expect(addMessageListener).toHaveBeenCalledTimes(2);
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
    globalThis.chrome = {
      runtime: {
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
    const runtimeListener = addMessageListener.mock.calls
      .map((call) => call[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown)
      .find((listener) => {
        let response: unknown;
        listener({ type: "uf.rewriteBrain.snapshot", tabId: 5 }, {}, (value) => {
          response = value;
        });
        return Boolean(response && typeof response === "object" && "ok" in response);
      });
    let response: unknown;

    const keepOpen = runtimeListener?.({
      type: "uf.rewriteBrain.emit",
      tabId: 5,
      signal: {
        name: "markings.changed",
        source: "content",
        cause: "test",
        payload: { pageUrl: "https://example.com", markedCount: 1 },
      },
    }, {}, (value) => {
      response = value;
    });

    expect(runtimeListener).toBeDefined();
    expect(keepOpen).toBe(true);
    expect(response).toMatchObject({
      ok: true,
      signals: [{ name: "markings.changed" }],
    });
  });
});
