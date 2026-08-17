import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusFrame } from "../src/messaging/contract";

const REPO_ROOT = resolve(import.meta.dirname, "..");
let commandSeq = 0;

function commandFrame(name: string, payload: Record<string, unknown> = {}, tabId = 77): BusFrame {
  commandSeq += 1;
  return {
    kind: "uf-bus/1",
    frameType: "request",
    id: `test-${name}-${Math.random()}`,
    seq: commandSeq,
    name: "command.dispatch",
    source: "popup",
    sourceInstance: "popup:test",
    target: "content",
    payload: {
      kind: "uf-command/1",
      name,
      tabId,
      payload,
    },
  };
}

async function dispatchContentCommand(
  listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown,
  name: string,
  payload: Record<string, unknown> = {},
) {
  const response = vi.fn();
  expect(listener(commandFrame(name, payload), {}, response)).toBe(true);
  for (let index = 0; index < 20 && response.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const reply = response.mock.calls.at(-1)?.[0] as BusFrame;
  expect(reply).toMatchObject({ frameType: "reply", ok: true });
  return reply.payload as { ok: boolean; data?: unknown; failure?: unknown };
}

async function applyLockState(
  listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown,
  patch: Record<string, unknown> = {},
) {
  const banner = patch.banner && typeof patch.banner === "object" ? patch.banner : {};
  return await dispatchContentCommand(listener, "lock.state.changed", {
    baseUrl: "https://example.com",
    configPresent: true,
    lockRole: "editor",
    canEdit: true,
    blockedReason: "",
    ...patch,
    banner: { visible: false, text: "", ...banner },
  });
}

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
        sendMessage: vi.fn().mockResolvedValue(undefined),
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
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    await applyLockState(listener);
    const response = await dispatchContentCommand(listener, "activateContentMain");
    expect(response).toEqual({ ok: true, data: { ok: true, initialized: true, tree: "rewrite" } });
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
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      main: () => void;
    };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;

    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain");
    await dispatchContentCommand(listener, "activateContentMain");
    const status = await dispatchContentCommand(listener, "getContentMainStatus");
    expect(status.data).toMatchObject({
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
    // bus.emit defers its transport send by a microtask, unlike bus.request which
    // sends synchronously, so the fact needs a flush before it is observable.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The toggle reports a fact and nothing else. markings.changed has exactly one
    // producer — the brain — so an organ emitting it too would be a second source
    // of truth for one decision.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      name: "fact.reported",
      target: "background",
      source: "content",
      payload: expect.objectContaining({
        kind: "uf-fact/1",
        sensation: expect.objectContaining({
          source: "content",
          reason: "marking-toggle",
          facts: expect.objectContaining({ markingToggleSeq: 1 }),
        }),
      }),
    }));
    const emittedSignalNames = sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { signal?: { name?: string } } })
      .filter((frame) => frame.name === "signals.emit")
      .map((frame) => frame.payload?.signal?.name);
    expect(emittedSignalNames).not.toContain("markings.changed");
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
    const deactivate = await dispatchContentCommand(listener, "deactivateContentMain");
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "DESTROY",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(documentListeners.has("click")).toBe(false);
    expect(windowListeners.has("blur")).toBe(false);
    expect(deactivate).toEqual({ ok: true, data: { ok: true, initialized: false, tree: "rewrite" } });
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
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine: vi.fn(() => engine), installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()) }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain");
    documentListeners.get("click")?.({ clientX: 1, clientY: 1, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    const paused = await dispatchContentCommand(listener, "pauseContentMainInteractions");
    expect(documentListeners.has("click")).toBe(false);
    expect(paused).toEqual({ ok: true, data: { ok: true, active: true, dirty: true, tree: "rewrite" } });
    const clean = await dispatchContentCommand(listener, "markContentMainClean");
    expect(clean).toEqual({ ok: true, data: { ok: true, active: true, dirty: false, tree: "rewrite" } });
    await applyLockState(listener, {
      canEdit: false,
      blockedReason: "post_ai",
      banner: { visible: false, text: "Post AI" },
    });
    await expect(dispatchContentCommand(listener, "resetContentMain")).resolves.toMatchObject({
      ok: true,
      data: { ok: true, initialized: true, tree: "rewrite" },
    });
    await applyLockState(listener);
    await dispatchContentCommand(listener, "resumeContentMainInteractions");
    expect(documentListeners.has("click")).toBe(true);
  });

  it("rejects stale activation requests whose pageUrl no longer matches the page", async () => {
    const addListener = vi.fn();
    const createMarkingEngine = vi.fn();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn().mockResolvedValue(undefined),
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
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;

    await applyLockState(listener);
    const response = await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/old" });
    expect(createMarkingEngine).not.toHaveBeenCalled();
    expect(response).toEqual({ ok: true, data: { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" } });
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
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    windowListeners.get("message")?.({
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);
    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/a" });
    locationValue.href = "https://example.com/b";
    windowListeners.get("message")?.({
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      frameType: "event",
      name: "fact.reported",
      target: "background",
      source: "content",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          source: "content",
          reason: "content-url-change",
          facts: expect.objectContaining({
            pageUrl: "https://example.com/b",
            markingEnabled: false,
          }),
        }),
      }),
    }));
    expect(windowListeners.has("popstate")).toBe(true);
    expect(windowListeners.has("hashchange")).toBe(true);
  });

  it("consumes brain signals into local surface memory and gates commands with lock authority", async () => {
    const addListener = vi.fn();
    const elements: Array<{
      tag: string;
      attributes: Record<string, string>;
      style: Record<string, string>;
      children: unknown[];
      textContent: string;
      isConnected: boolean;
      setAttribute: (name: string, value: string) => void;
      appendChild: (child: unknown) => unknown;
      replaceChildren: (...children: unknown[]) => void;
      remove: () => void;
    }> = [];
    const createElement = vi.fn((tag: string) => {
      const element = {
        tag,
        attributes: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children: [] as unknown[],
        textContent: "",
        isConnected: true,
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        appendChild(child: unknown) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...children: unknown[]) {
          this.children = children;
        },
        remove() {
          this.isConnected = false;
        },
      };
      elements.push(element);
      return element;
    });
    const createMarkingEngine = vi.fn();
    let signalSeq = 0;
    let pendingSignals: Array<Record<string, unknown>> = [];
    const queueSignal = (name: string, payload: Record<string, unknown> = {}): void => {
      signalSeq += 1;
      pendingSignals.push({
        kind: "uf-signal/1",
        tabId: 77,
        seq: signalSeq,
        name,
        source: "brain",
        cause: "test",
        at: signalSeq,
        payload,
      });
    };
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name !== "signals.pull") {
        return undefined;
      }
      const signals = pendingSignals;
      pendingSignals = [];
      return {
        ...message,
        frameType: "reply",
        source: "background",
        sourceInstance: "background:test",
        target: "content",
        ok: true,
        payload: signals,
      } satisfies BusFrame;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "https://example.com/page" },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          nodeType: 1,
          tagName: "HTML",
          scrollHeight: 1000,
          appendChild: vi.fn((child: unknown) => child),
        },
        createElement,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerHeight: 500, scrollY: 0, scrollTo: vi.fn(), postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({ defineContentScript: (config: unknown) => config }));
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine, installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()) }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    const configBlocked = await applyLockState(listener, {
      configPresent: false,
      canEdit: false,
      blockedReason: "config-missing",
      banner: { visible: true, text: "Config missing" },
    });
    expect(configBlocked).toMatchObject({ ok: true, data: { ok: true } });
    expect(elements.some((element) => element.attributes["data-uf-content-curtain"] === "true")).toBe(true);
    expect(elements.some((element) => element.attributes["data-uf-content-banner"] === "true")).toBe(true);
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "config-missing" },
    });

    await applyLockState(listener, { lockRole: "passive", canEdit: false, blockedReason: "property-lock" });
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "property-lock" },
    });

    queueSignal("reconciliation.started", { reason: "saving" });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "reconciliation-pending" },
    });

    queueSignal("reconciliation.ended", { reason: "saved" });
    queueSignal("marking.enabled");
    queueSignal("run.started", { sessionId: "run-1" });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "post_ai" },
    });
    expect(elements.some((element) => element.attributes["data-uf-content-curtain"] === "true" && element.textContent === "Computing selectors")).toBe(true);

    await applyLockState(listener, {
      baseUrl: "https://other.example",
    });
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "base-url-mismatch" },
    });
    expect(createMarkingEngine).not.toHaveBeenCalled();

    const status = await dispatchContentCommand(listener, "getContentMainStatus");
    expect(status.data).toMatchObject({
      sessionState: { name: "running", lastConsumedSeq: signalSeq },
      presentation: {
        markingEditsBlocked: true,
        blockedReason: "post_ai",
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.pull",
      payload: expect.objectContaining({ tabId: 0 }),
    }));
    const startupFrame = sendMessage.mock.calls
      .map(([frame]) => frame)
      .find((frame) => frame.name === "fact.reported" && (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "content-started");
    const startupFacts = (startupFrame?.payload as { sensation?: { facts?: Record<string, unknown> } }).sensation?.facts;
    expect(startupFacts).toBeDefined();
    expect(startupFacts).not.toHaveProperty("lockRole");
    expect(startupFacts).not.toHaveProperty("configPresent");
  });
});
