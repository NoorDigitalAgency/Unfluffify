import { afterEach, describe, expect, it, vi } from "vitest";

function installEntrypointDom(href: string): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: vi.fn(() => ({ id: "root" })),
      body: {
        appendChild: vi.fn(() => ({ id: "root" })),
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    },
  });
}

async function flushEntrypointWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("rewrite popup entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("binds production popup toggles to the active tab and clears content on disable", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = vi.fn().mockResolvedValue({ ok: true, initialized: true, tree: "rewrite" });
    let signalSeq = 0;
    let pulledDirty = false;
    const runtimeSendMessage = vi.fn(async (message: { type?: string; tabId?: number; afterSeq?: number; signal?: { name?: string; payload?: unknown } }) => {
      if (message.type === "uf.rewriteBrain.emit") {
        signalSeq += 1;
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: signalSeq,
            name: message.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: message.signal?.payload ?? {},
          }],
        };
      }
      if (message.type === "uf.rewriteBrain.pull" && message.afterSeq === 0) {
        return { ok: true, signals: [] };
      }
      if (message.type === "uf.rewriteBrain.pull" && !pulledDirty) {
        pulledDirty = true;
        signalSeq += 1;
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: signalSeq,
            name: "markings.changed",
            source: "content",
            cause: "content-click",
            at: signalSeq,
            payload: { pageUrl: "https://example.com", markedCount: 1 },
          }],
        };
      }
      return { ok: true, signals: [] };
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().buttons.compute).toEqual({
      disabled: true,
      blockedReason: "not-implemented",
    });
    render.mock.calls.at(-1)?.[0].props.onDiscard();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(true);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(tabsSendMessage).toHaveBeenNthCalledWith(1, 77, { type: "getContentMainStatus" });
    expect(tabsSendMessage).toHaveBeenNthCalledWith(2, 77, {
      type: "activateContentMain",
      pageUrl: "https://example.com",
      realEditorActivation: true,
    });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.pull",
      tabId: 77,
      afterSeq: 1,
    });
    expect(tabsSendMessage).toHaveBeenNthCalledWith(3, 77, { type: "resetContentMain" });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "session.discarded",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com" },
      },
    });
    expect(tabsSendMessage).toHaveBeenNthCalledWith(4, 77, { type: "deactivateContentMain" });
  });

  it("reconciles startup state from active content when the signal log is empty", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = vi.fn().mockResolvedValue({
      ok: true,
      active: true,
      dirty: true,
      pageUrl: "https://example.com",
      markedCount: 2,
      tree: "rewrite",
    });
    let signalSeq = 0;
    const runtimeSendMessage = vi.fn(async (message: { type?: string; tabId?: number; signal?: { name?: string; payload?: unknown } }) => {
      if (message.type === "uf.rewriteBrain.emit") {
        signalSeq += 1;
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: signalSeq,
            name: message.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: message.signal?.payload ?? {},
          }],
        };
      }
      return { ok: true, signals: [] };
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, { type: "getContentMainStatus" });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "marking.enabled",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com", cause: "content-reconciliation" },
      },
    });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "markings.changed",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com", markedCount: 2 },
      },
    });
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("reconciles clean active content without marking it dirty", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = vi.fn().mockResolvedValue({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: "https://example.com",
      markedCount: 25,
      tree: "rewrite",
    });
    let signalSeq = 0;
    const runtimeSendMessage = vi.fn(async (message: { type?: string; tabId?: number; signal?: { name?: string; payload?: unknown } }) => {
      if (message.type === "uf.rewriteBrain.emit") {
        signalSeq += 1;
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: signalSeq,
            name: message.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: message.signal?.payload ?? {},
          }],
        };
      }
      return { ok: true, signals: [] };
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "marking.enabled",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com", cause: "content-reconciliation" },
      },
    });
    expect(runtimeSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.objectContaining({ name: "markings.changed" }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(true);
  });

  it("treats dirty active content as dirty even when submitted row count is zero", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = vi.fn().mockResolvedValue({
      ok: true,
      active: true,
      dirty: true,
      pageUrl: "https://example.com",
      markedCount: 0,
      tree: "rewrite",
    });
    let signalSeq = 0;
    const runtimeSendMessage = vi.fn(async (message: { type?: string; tabId?: number; signal?: { name?: string; payload?: unknown } }) => {
      if (message.type === "uf.rewriteBrain.emit") {
        signalSeq += 1;
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: signalSeq,
            name: message.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: message.signal?.payload ?? {},
          }],
        };
      }
      return { ok: true, signals: [] };
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "markings.changed",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com", markedCount: 0 },
      },
    });
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("deactivates content and emits navigation when the bound tab URL changes", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    const tabsSendMessage = vi.fn().mockResolvedValue({ ok: true, initialized: false, tree: "rewrite" });
    const runtimeSendMessage = vi.fn(async (message: { type?: string; tabId?: number; signal?: { name?: string; payload?: unknown } }) => {
      if (message.type === "uf.rewriteBrain.emit") {
        return {
          ok: true,
          signals: [{
            kind: "uf-signal/1",
            tabId: message.tabId,
            seq: 1,
            name: message.signal?.name,
            source: "brain",
            cause: "test",
            at: 1,
            payload: message.signal?.payload ?? {},
          }],
        };
      }
      return { ok: true, signals: [] };
    });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    query.mockResolvedValue([{ id: 77, url: "https://example.com/b" }]);
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, { type: "deactivateContentMain" });
    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "uf.rewriteBrain.emit",
      tabId: 77,
      signal: {
        name: "session.navigated",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com/b" },
      },
    });
  });

  it("keeps debugTabId as an explicit live-browser override", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html?debugTabId=123");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn();
    const tabsSendMessage = vi.fn().mockResolvedValue({ ok: true, initialized: true, tree: "rewrite" });
    const runtimeSendMessage = vi.fn().mockResolvedValue({ ok: true, signals: [] });
    globalThis.chrome = {
      runtime: {
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    expect(query).not.toHaveBeenCalled();
    expect(tabsSendMessage).toHaveBeenCalledWith(123, {
      type: "activateContentMain",
      pageUrl: "",
      realEditorActivation: true,
    });
  });
});
