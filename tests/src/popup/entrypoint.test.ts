import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusFrame } from "../../../src/messaging/contract";

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

function replyFrame(frame: BusFrame, payload: unknown): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "background",
    target: frame.source,
    ok: true,
    payload,
  };
}

function makeRuntime(handler: (frame: BusFrame) => Promise<unknown> | unknown) {
  return {
    sendMessage: vi.fn((message: unknown) => handler(message as BusFrame)),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };
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
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      if (message.name === "signals.pull" && (message.payload as { afterSeq?: number }).afterSeq === 0) {
        return replyFrame(message, []);
      }
      if (message.name === "signals.pull" && !pulledDirty) {
        const request = message.payload as { tabId: number };
        pulledDirty = true;
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: "markings.changed",
            source: "content",
            cause: "content-click",
            at: signalSeq,
            payload: { pageUrl: "https://example.com", markedCount: 1 },
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
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
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.pull",
      payload: { tabId: 77, afterSeq: 1 },
      target: "background",
    }));
    expect(tabsSendMessage).toHaveBeenNthCalledWith(3, 77, { type: "resetContentMain" });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "session.discarded",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com" },
      },
      },
      target: "background",
    }));
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
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, { type: "getContentMainStatus" });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "marking.enabled",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com", cause: "content-reconciliation" },
      },
      },
      target: "background",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "markings.changed",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com", markedCount: 2 },
      },
      },
      target: "background",
    }));
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
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "marking.enabled",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { baseUrl: "", pageUrl: "https://example.com", cause: "content-reconciliation" },
      },
      },
      target: "background",
    }));
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: expect.objectContaining({
        signal: expect.objectContaining({ name: "markings.changed" }),
      }),
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
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "markings.changed",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com", markedCount: 0 },
      },
      },
      target: "background",
    }));
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
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: 1,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: 1,
            payload: request.signal?.payload ?? {},
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
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
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: {
        tabId: 77,
        signal: {
        name: "session.navigated",
        source: "popup",
        cause: "popup-entrypoint",
        payload: { pageUrl: "https://example.com/b" },
      },
      },
      target: "background",
    }));
  });

  it("keeps debugTabId as an explicit live-browser override", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html?debugTabId=123");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn();
    const tabsSendMessage = vi.fn().mockResolvedValue({ ok: true, initialized: true, tree: "rewrite" });
    const runtime = makeRuntime((message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: {
        ...runtime,
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
