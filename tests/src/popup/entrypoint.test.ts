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

function contentReplyFrame(frame: BusFrame, data: unknown): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "content",
    target: frame.source,
    ok: true,
    payload: { ok: true, data },
  };
}

function contentCommand(name: string, payload?: unknown) {
  return expect.objectContaining({
    kind: "uf-bus/1",
    frameType: "request",
    name: "command.dispatch",
    target: "content",
    payload: expect.objectContaining({
      kind: "uf-command/1",
      name,
      ...(payload === undefined ? {} : { payload }),
    }),
  });
}

function makeTabsSendMessage(
  handler: (tabId: number, message: { type?: string } & Record<string, unknown>) => Promise<unknown> | unknown,
) {
  return vi.fn(async (tabId: number, message: unknown) => {
    const frame = message as BusFrame;
    if (frame?.kind === "uf-bus/1" && frame.name === "command.dispatch") {
      const command = frame.payload as { name: string; payload?: Record<string, unknown> };
      const data = await handler(tabId, { type: command.name, ...(command.payload ?? {}) });
      return contentReplyFrame(frame, data);
    }
    return await handler(tabId, message as { type?: string } & Record<string, unknown>);
  });
}

function makeRuntime(handler: (frame: BusFrame) => Promise<unknown> | unknown) {
  return {
    sendMessage: vi.fn((message: unknown) => {
      const frame = message as BusFrame;
      if (frame.name === "lock.directive") {
        return replyFrame(frame, {
          status: "ok",
          siteId: 1,
          lockRole: "editor",
          directive: {
            baseUrl: "https://example.com",
            configPresent: true,
            lockRole: "editor",
            reconciliationPending: false,
            content: {
              markingEditsBlocked: false,
              blockedReason: "",
              curtain: { visible: false, text: "" },
              banner: { visible: false, text: "" },
            },
          },
          lockBanner: { visible: false, text: "" },
        });
      }
      if (frame.name === "emulation.apply") {
        return replyFrame(frame, {
          mode: "mobile",
          width: 412,
          height: 960,
          scale: 1,
          active: true,
        });
      }
      if (frame.name === "emulation.clear") {
        return replyFrame(frame, { status: "ok" });
      }
      if (frame.name === "offscreen.refineXpaths") {
        const payload = frame.payload as { rows?: unknown };
        return replyFrame(frame, { rows: Array.isArray(payload.rows) ? payload.rows : [] });
      }
      return handler(frame);
    }),
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
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
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
      disabled: false,
      blockedReason: "",
    });
    render.mock.calls.at(-1)?.[0].props.onDiscard();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(true);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(tabsSendMessage).toHaveBeenNthCalledWith(1, 77, contentCommand("getContentMainStatus", {}));
    expect(tabsSendMessage).toHaveBeenNthCalledWith(2, 77, contentCommand("directive.content", expect.objectContaining({
      baseUrl: "https://example.com",
      configPresent: true,
      lockRole: "editor",
    })));
    expect(tabsSendMessage).toHaveBeenNthCalledWith(3, 77, contentCommand("activateContentMain", {
      pageUrl: "https://example.com",
      realEditorActivation: true,
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.pull",
      payload: { tabId: 77, afterSeq: 1 },
      target: "background",
    }));
    expect(tabsSendMessage).toHaveBeenNthCalledWith(4, 77, contentCommand("resetContentMain", {}));
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
    expect(tabsSendMessage).toHaveBeenNthCalledWith(5, 77, contentCommand("deactivateContentMain", {}));
  });

  it("runs AI, opens preview, and saves through typed commands", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"],
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" }] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
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
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "config.save") {
        return replyFrame(message, { status: "ok" });
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
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("captureSubmissionSnapshot", {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.run",
      payload: snapshot,
      target: "background",
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });

    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.temporarilyDisabledOverlay).toBe(true);

    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "lock.directive",
      payload: expect.objectContaining({ hasUnsavedChanges: true }),
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "config.save",
      target: "background",
      payload: expect.objectContaining({
        baseUrl: "https://example.com",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      }),
    }));
  });

  it("does not reuse a captured AI snapshot after rebinding to another page", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    const snapshotA = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/a", renderedHtml: "<html>a</html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const snapshotB = {
      ...snapshotA,
      pages: [{ url: "https://example.com/b", renderedHtml: "<html>b</html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[2]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot: query.mock.calls.length > 1 ? snapshotB : snapshotA, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let activeUrl = "https://example.com/a";
    let rehydratedB = false;
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
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "config.save") {
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "signals.pull" && activeUrl === "https://example.com/b" && !rehydratedB) {
        rehydratedB = true;
        signalSeq += 3;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq - 2,
          name: "marking.enabled",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq - 2,
          payload: { pageUrl: "https://example.com/b" },
        }, {
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq - 1,
          name: "run.started",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq - 1,
          payload: { pageUrl: "https://example.com/b", sessionId: "ai-b-local" },
        }, {
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "run.completed",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq,
          payload: {
            pageUrl: "https://example.com/b",
            sessionId: "ai-b-local",
            aiSessionId: "ai-b",
            selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
          },
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
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    query.mockResolvedValue([{ id: 77, url: "https://example.com/b" }]);
    activeUrl = "https://example.com/b";
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "config.save",
      payload: expect.objectContaining({
        pageMarkings: expect.objectContaining({
          "https://example.com/b": expect.objectContaining({ renderedHtml: "<html>b</html>" }),
        }),
      }),
    }));
  });

  it("drains pending dirty signals and aborts stale Save", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyReady = false;
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
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
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
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    dirtyReady = true;
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "config.save" }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("does not let session.saved skip an intervening dirty signal", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyOnSaveTail = false;
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
      if (message.name === "ai.run") {
        return replyFrame(message, { status: "ok", sessionId: "ai-1", selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] } });
      }
      if (message.name === "config.save") {
        dirtyOnSaveTail = true;
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "signals.pull" && dirtyOnSaveTail) {
        dirtyOnSaveTail = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(tabsSendMessage).not.toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
  });

  it("does not enable Save when markings change during AI snapshot capture", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    let dirtyReady = false;
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        dirtyReady = true;
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
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
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
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
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("does not treat already-pending dirty signals as edits during the AI run", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyReady = false;
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
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1, contentRows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "excluded" }] },
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    dirtyReady = true;
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });
  });

  it("does not let an older AI run clear a newer active run", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) =>
      message.type === "captureSubmissionSnapshot"
        ? { ok: true, snapshot, rows: [] }
        : { ok: true, initialized: true, tree: "rewrite" }
    );
    let signalSeq = 0;
    const aiResolvers: Array<(frame: BusFrame) => void> = [];
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
      if (message.name === "ai.run") {
        return await new Promise<BusFrame>((resolve) => aiResolvers.push(resolve));
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(runtime.sendMessage.mock.calls.filter(([frame]) => (frame as BusFrame).name === "ai.run")).toHaveLength(1);
    aiResolvers[0]?.(replyFrame(runtime.sendMessage.mock.calls.find(([frame]) => (frame as BusFrame).name === "ai.run")?.[0] as BusFrame, {
      status: "ok",
      sessionId: "ai-1",
      selectors: { inclusionSelectors: ["only"], exclusionSelectors: [] },
    }));
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors.inclusionSelectors).toEqual(["only"]);
  });

  it("opens silent preview with silent origin", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
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
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false, pageUrl: "https://example.com/page" })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: expect.objectContaining({
        signal: expect.objectContaining({
          name: "preview.opened",
          payload: { pageUrl: "https://example.com/page", origin: "silent" },
        }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.enableToggleChecked).toBe(false);
  });

  it("drains pending dirty signals and aborts stale Preview", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let dirtyReady = false;
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
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
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
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false, pageUrl: "https://example.com/page" })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    await (runtime.sendMessage as ReturnType<typeof vi.fn>)({
      kind: "uf-bus/1",
      frameType: "request",
      id: "seed",
      seq: 0,
      name: "signals.emit",
      source: "test" as never,
      target: "background",
      payload: {
        tabId: 77,
        signal: {
          name: "marking.enabled",
          source: "popup",
          cause: "test",
          payload: { pageUrl: "https://example.com/page" },
        },
      },
    });
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi?.();
    await flushEntrypointWork();
    dirtyReady = true;
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();

    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: expect.objectContaining({
        signal: expect.objectContaining({ name: "preview.opened" }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.showPreviewDisabled).toBe(true);
  });

  it("does not enable Save when markings change while an AI run is in flight", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let releaseAi: ((value: BusFrame) => void) | null = null;
    let dirtyReady = false;
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
      if (message.name === "signals.pull") {
        if (!dirtyReady) {
          return replyFrame(message, []);
        }
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 2 },
        }]);
      }
      if (message.name === "ai.run") {
        dirtyReady = true;
        return await new Promise<BusFrame>((resolve) => {
          releaseAi = resolve;
        });
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
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    releaseAi?.(replyFrame(runtime.sendMessage.mock.calls.find(([frame]) => (frame as BusFrame).name === "ai.run")?.[0] as BusFrame, {
      status: "ok",
      sessionId: "ai-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("reconciles startup state from active content when the signal log is empty", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: true,
      pageUrl: "https://example.com",
      markedCount: 2,
      tree: "rewrite",
    }));
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

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("getContentMainStatus", {}));
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
        payload: { pageUrl: "https://example.com", markedCount: 2, contentRows: [] },
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
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: "https://example.com",
      markedCount: 25,
      tree: "rewrite",
    }));
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
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: true,
      pageUrl: "https://example.com",
      markedCount: 0,
      tree: "rewrite",
    }));
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
        payload: { pageUrl: "https://example.com", markedCount: 0, contentRows: [] },
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
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: false, tree: "rewrite" }));
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

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
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
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
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
    expect(tabsSendMessage).toHaveBeenCalledWith(123, contentCommand("activateContentMain", {
      pageUrl: "",
      realEditorActivation: true,
    }));
  });
});
