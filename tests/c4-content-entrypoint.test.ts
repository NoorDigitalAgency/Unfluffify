import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C4 rewrite content entrypoints", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalThis.chrome;
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("registers the rewrite activation bridge without loading legacy content-main", async () => {
    const addListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
      },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      matches: string[];
      runAt: string;
      main: () => void;
    };

    expect(contentScript.matches).toEqual(["<all_urls>"]);
    expect(contentScript.runAt).toBe("document_start");
    contentScript.main();
    expect(addListener).toHaveBeenCalledTimes(1);

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type?: string; pageUrl?: string; realEditorActivation?: boolean },
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const response = vi.fn();
    expect(listener({ type: "activateContentMain" }, {}, response)).toBe(true);
    expect(response).toHaveBeenCalledWith({ ok: true, initialized: true, tree: "rewrite" });
  });

  it("keeps the MAIN-world page-world entrypoint bound to the new program", () => {
    const pageWorldEntrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "page-world.content.ts"),
      "utf8",
    );
    expect(pageWorldEntrypointSource).toContain('import "../page-world/program.js";');
  });

  it("reuses one marking engine while enabled and disposes overlays on deactivate", async () => {
    const addListener = vi.fn();
    const documentListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      resolveAtPoint: vi.fn(() => ({ xpath: "/html[1]/body[1]/p[1]" })),
      toggle: vi.fn(),
      rows: vi.fn(() => [{ xpath: "/html[1]/body[1]/p[1]", excluded: true }]),
    };
    const createMarkingEngine = vi.fn(() => engine);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: { nodeType: 1 },
        documentElement: { nodeType: 1, tagName: "HTML", scrollHeight: 1000 },
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          documentListeners.set(type, listener);
        }),
        removeEventListener: vi.fn((type: string) => {
          documentListeners.delete(type);
        }),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        innerHeight: 500,
        scrollY: 123,
        scrollTo: vi.fn(),
        postMessage: vi.fn(),
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          windowListeners.set(type, listener);
        }),
        removeEventListener: vi.fn((type: string) => {
          windowListeners.delete(type);
        }),
      },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      main: () => void;
    };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type?: string },
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const response = vi.fn();

    expect(listener({ type: "activateContentMain" }, {}, response)).toBe(true);
    expect(listener({ type: "activateContentMain" }, {}, response)).toBe(true);
    expect(listener({ type: "getContentMainStatus" }, {}, response)).toBe(true);
    expect(response).toHaveBeenLastCalledWith({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: "",
      markedCount: 0,
      contentRows: [{ xpath: "/html[1]/body[1]/p[1]", classification: "excluded" }],
      tree: "rewrite",
    });
    expect(createMarkingEngine).toHaveBeenCalledTimes(1);
    expect(createMarkingEngine).toHaveBeenCalledWith(document.documentElement);
    expect(engine.refresh).toHaveBeenCalledTimes(2);
    expect(engine.renderReadOnly).toHaveBeenCalledTimes(2);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "ARM",
      sessionNonce: undefined,
    }), "*");
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "SET_LAZY_LOADING_SUPPRESSED",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "SET_MOTION_PAUSED",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 123);
    documentListeners.get("keydown")?.({ code: "Space" } as unknown as Event);
    documentListeners.get("keyup")?.({ code: "Space" } as unknown as Event);
    expect(engine.refresh).toHaveBeenCalledTimes(3);
    expect(engine.renderReadOnly).toHaveBeenCalledTimes(3);
    const click = {
      clientX: 10,
      clientY: 20,
      altKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    documentListeners.get("click")?.(click as unknown as Event);
    expect(engine.resolveAtPoint).toHaveBeenCalledWith(10, 20, "exclude", true);
    expect(engine.toggle).toHaveBeenCalledWith({ xpath: "/html[1]/body[1]/p[1]" }, "exclude");
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      frameType: "request",
      name: "signals.emit",
      target: "background",
      source: "content",
      payload: {
        tabId: 0,
        signal: {
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          payload: {
            pageUrl: "",
            markedCount: 1,
            contentRows: [{ xpath: "/html[1]/body[1]/p[1]", classification: "excluded" }],
          },
        },
      },
    }));
    engine.resolveAtPoint.mockReturnValueOnce(null);
    const unresolvedClick = {
      clientX: 1,
      clientY: 2,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    documentListeners.get("click")?.(unresolvedClick as unknown as Event);
    expect(unresolvedClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(unresolvedClick.stopPropagation).toHaveBeenCalledTimes(1);
    expect(engine.toggle).toHaveBeenCalledTimes(1);
    expect(listener({ type: "deactivateContentMain" }, {}, response)).toBe(true);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "DESTROY",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(documentListeners.has("click")).toBe(false);
    expect(windowListeners.has("blur")).toBe(false);
    expect(response).toHaveBeenLastCalledWith({ ok: true, initialized: false, tree: "rewrite" });
  });

  it("pauses and resumes marking interactions without clearing dirty state", async () => {
    const addListener = vi.fn();
    const documentListeners = new Map<string, EventListener>();
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      resolveAtPoint: vi.fn(() => ({ xpath: "/html[1]/body[1]/p[1]" })),
      toggle: vi.fn(),
      rows: vi.fn(() => [{ xpath: "/html[1]/body[1]/p[1]", excluded: true }]),
    };
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1, tagName: "HTML", scrollHeight: 1000 },
        addEventListener: vi.fn((type: string, listener: EventListener) => documentListeners.set(type, listener)),
        removeEventListener: vi.fn((type: string) => documentListeners.delete(type)),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerHeight: 500, scrollY: 0, scrollTo: vi.fn(), postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({ defineContentScript: (config: unknown) => config }));
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine: vi.fn(() => engine) }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (message: { type?: string }, sender: unknown, sendResponse: (value: unknown) => void) => unknown;
    const response = vi.fn();

    listener({ type: "activateContentMain" }, {}, response);
    documentListeners.get("click")?.({ clientX: 1, clientY: 1, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    expect(listener({ type: "pauseContentMainInteractions" }, {}, response)).toBe(true);
    expect(documentListeners.has("click")).toBe(false);
    expect(response).toHaveBeenLastCalledWith({ ok: true, active: true, dirty: true, tree: "rewrite" });
    expect(listener({ type: "resumeContentMainInteractions" }, {}, response)).toBe(true);
    expect(documentListeners.has("click")).toBe(true);
  });

  it("rejects stale activation requests whose pageUrl no longer matches the page", async () => {
    const addListener = vi.fn();
    const createMarkingEngine = vi.fn();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://example.com/current" },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type?: string; pageUrl?: string },
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const response = vi.fn();

    expect(listener({ type: "activateContentMain", pageUrl: "https://example.com/old" }, {}, response)).toBe(true);
    expect(createMarkingEngine).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith({ ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" });
  });

  it("deactivates active marking on same-document URL changes without popup polling", async () => {
    const addListener = vi.fn();
    const windowListeners = new Map<string, EventListener>();
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      rows: vi.fn(() => []),
    };
    const createMarkingEngine = vi.fn(() => engine);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const locationValue = { href: "https://example.com/a" };
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: locationValue,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const windowObject = {
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        windowListeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowObject,
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type?: string; pageUrl?: string },
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    windowListeners.get("message")?.({
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);
    listener({ type: "activateContentMain", pageUrl: "https://example.com/a" }, {}, vi.fn());
    locationValue.href = "https://example.com/b";
    windowListeners.get("message")?.({
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);

    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      frameType: "request",
      name: "signals.emit",
      target: "background",
      source: "content",
      payload: {
        tabId: 0,
        signal: {
          name: "session.navigated",
          source: "content",
          cause: "content-url-change",
          payload: {
            fromUrl: "https://example.com/a",
            toUrl: "https://example.com/b",
            pageUrl: "https://example.com/b",
          },
        },
      },
    }));
    expect(windowListeners.has("popstate")).toBe(true);
    expect(windowListeners.has("hashchange")).toBe(true);
  });
});
