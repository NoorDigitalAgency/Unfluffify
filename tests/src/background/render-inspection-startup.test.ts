import { afterEach, describe, expect, it, vi } from "vitest";

import type { BusFrame } from "../../../src/messaging/contract";

type MessageListener = (
  frame: BusFrame,
  sender: { tab?: { id?: number }; frameId?: number; documentId?: string },
  sendResponse: (reply: BusFrame) => void,
) => boolean;

type PropertyScope = Readonly<{
  environmentKey: string;
  siteId: number;
  baseUrl: string;
  pageUrl: string;
}>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function installLockRuntime(scope: PropertyScope | null, options: Readonly<{
  contextStatus?: "managed_candidate" | "managed_non_candidate";
  draftDisposition?: "preserve" | "terminate";
  exposeLockScope?: boolean;
  lockScope?: PropertyScope | null;
  contextResolveGate?: Promise<void>;
  onContextResolveStarted?: () => void;
  navigationCleanupGate?: Promise<void>;
}> = {}) {
  vi.doMock("../../../src/background/page-context-runtime", () => ({
    createPageContextRuntime: vi.fn(() => ({
      resolve: vi.fn(async () => {
        options.onContextResolveStarted?.();
        await options.contextResolveGate;
        return {
          status: scope ? options.contextStatus ?? "managed_candidate" : "unmanaged",
          generation: 1,
          observedUrl: scope?.pageUrl ?? "https://example.com/",
          draftDisposition: scope ? options.draftDisposition ?? "preserve" : "terminate",
          environmentKey: scope?.environmentKey ?? null,
          siteId: scope?.siteId ?? null,
          baseUrl: scope?.baseUrl ?? null,
          pageKey: null,
          pageTypes: [],
          membershipFingerprint: null,
          assignmentFingerprint: null,
          conflicts: [],
          upstreamCode: null,
        };
      }),
    })),
  }));
  const navigationCommitted = vi.fn();
  const terminateTab = vi.fn().mockResolvedValue(undefined);
  const inspectionScopeForTab = vi.fn(() => options.exposeLockScope === false
    ? null
    : Object.prototype.hasOwnProperty.call(options, "lockScope")
      ? options.lockScope ?? null
      : scope);
  vi.doMock("../../../src/background/lock-runtime", () => ({
    PROPERTY_LOCK_HEARTBEAT_ALARM: "uf-property-lock-heartbeat",
    createPropertyLockRuntime: vi.fn(() => ({
      inspectionScopeForTab,
      navigationCommitted,
      terminateTab,
      presenceChanged: vi.fn(),
      heartbeat: vi.fn(),
      directive: vi.fn().mockResolvedValue({
        status: "unavailable",
        baseUrl: "https://example.com",
        siteId: null,
        lockRole: "unknown",
        configPresent: false,
        canEdit: false,
        blockedReason: "unavailable",
        lockBanner: { visible: true, reason: "unavailable" },
      }),
      action: vi.fn(() => ({ status: "unavailable" })),
      unsavedChanged: vi.fn(),
      activity: vi.fn(),
      republish: vi.fn(),
      authorizeMutation: vi.fn(() => ({
        ok: false,
        status: "stale_fence",
        propertyRevision: 0,
        feedRevision: 0,
        reason: "test",
      })),
    })),
  }));
  const shieldNavigationCommitted = vi.fn(async () => {
    await options.navigationCleanupGate;
  });
  vi.doMock("../../../src/background/shield-posture-runtime", () => ({
    createShieldPostureRuntime: vi.fn(() => ({
      adoptedDocumentKey: vi.fn().mockResolvedValue(null),
      retainedSilentProperty: vi.fn().mockResolvedValue(null),
      adoptRetainedDocument: vi.fn().mockResolvedValue({
        status: "unavailable",
        reason: "no-retained-silent-posture",
      }),
      bindDocument: vi.fn().mockResolvedValue({ status: "inactive", revision: 0 }),
      current: vi.fn().mockResolvedValue({ status: "inactive", revision: 0 }),
      set: vi.fn().mockResolvedValue({ status: "unbound", reason: "document-unbound" }),
      clear: vi.fn().mockResolvedValue({ status: "unbound", reason: "document-unbound" }),
      navigationCommitted: shieldNavigationCommitted,
      clearDocumentPosture: vi.fn().mockResolvedValue(undefined),
      clearTab: vi.fn().mockResolvedValue(undefined),
      clearProperty: vi.fn().mockResolvedValue(0),
      removeProperty: vi.fn().mockResolvedValue(0),
      authorizeProperty: vi.fn().mockResolvedValue(0),
    })),
  }));
  return {
    inspectionScopeForTab,
    navigationCommitted,
    shieldNavigationCommitted,
    terminateTab,
  };
}

function installBrowser(options: Readonly<{
  frameUnavailable?: boolean;
  runtimeEvaluateValue?: unknown;
  createAlarm?: (name: string, info: unknown) => Promise<void> | void;
  clearAlarm?: (name: string) => Promise<boolean> | boolean | void;
}> = {}) {
  const addMessageListener = vi.fn();
  const reload = vi.fn((_tabId: number, _options: unknown, callback?: () => void) => callback?.());
  const commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let beforeNavigate: ((details: {
    tabId: number;
    frameId: number;
    url?: string;
  }) => void) | null = null;
  let committed: ((details: {
    tabId: number;
    frameId: number;
    documentId?: string;
    url?: string;
  }) => void) | null = null;
  let navigationError: ((details: {
    tabId: number;
    frameId: number;
    url?: string;
    error?: string;
  }) => void) | null = null;
  let debuggerDetached: ((source: { tabId?: number }, reason?: string) => void) | null = null;
  let alarmListener: ((alarm: { name: string }) => void) | null = null;
  let removed: ((tabId: number) => void) | null = null;
  let currentDocumentId = "document-a";
  let currentUrl = "https://example.com/jobs/1";
  let frameUnavailable = options.frameUnavailable === true;
  let tabPresent = true;
  let tabQueryError: string | null = null;
  const createAlarm = vi.fn(options.createAlarm ?? (() => undefined));
  const clearAlarm = vi.fn(options.clearAlarm ?? (() => undefined));
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: addMessageListener },
    },
    debugger: {
      attach(_target: unknown, _version: string, callback?: () => void) {
        callback?.();
      },
      detach(_target: unknown, callback?: () => void) {
        callback?.();
      },
      sendCommand(
        _target: unknown,
        method: string,
        params?: Record<string, unknown>,
        callback?: (result?: unknown) => void,
      ) {
        commands.push({ method, ...(params ? { params } : {}) });
        callback?.(method === "Runtime.evaluate" && "runtimeEvaluateValue" in options
          ? { result: { value: options.runtimeEvaluateValue } }
          : {});
      },
      onDetach: {
        addListener(listener: typeof debuggerDetached) {
          debuggerDetached = listener;
        },
      },
    },
    tabs: {
      async get(
        tabId: number,
        callback?: (tab: { id: number }) => void,
      ) {
        if (tabQueryError) {
          throw new Error(tabQueryError);
        }
        if (!tabPresent) {
          throw new Error(`No tab with id: ${tabId}.`);
        }
        const tab = { id: tabId };
        callback?.(tab);
        return tab;
      },
      reload,
      sendMessage: vi.fn(),
      onUpdated: { addListener: vi.fn() },
      onRemoved: {
        addListener(listener: (tabId: number) => void) {
          removed = listener;
        },
      },
    },
    action: { onClicked: { addListener: vi.fn() } },
    alarms: {
      create: createAlarm,
      clear: clearAlarm,
      getAll(callback?: (alarms: readonly { name: string }[]) => void) {
        const alarms: readonly { name: string }[] = [];
        callback?.(alarms);
        return Promise.resolve(alarms);
      },
      onAlarm: {
        addListener(listener: typeof alarmListener) {
          alarmListener = listener;
        },
      },
    },
    webNavigation: {
      async getFrame(
        _details: unknown,
        callback?: (details: { documentId: string; url: string }) => void,
      ) {
        if (frameUnavailable) {
          throw new Error("main frame unavailable");
        }
        const frame = { documentId: currentDocumentId, url: currentUrl };
        callback?.(frame);
        return frame;
      },
      onBeforeNavigate: {
        addListener(listener: typeof beforeNavigate) {
          beforeNavigate = listener;
        },
      },
      onCommitted: {
        addListener(listener: typeof committed) {
          committed = listener;
        },
      },
      onErrorOccurred: {
        addListener(listener: typeof navigationError) {
          navigationError = listener;
        },
      },
    },
  } as unknown as typeof chrome;
  return {
    clearAlarm,
    commands,
    createAlarm,
    reload,
    listener(): MessageListener {
      const listener = addMessageListener.mock.calls[0]?.[0] as MessageListener | undefined;
      if (!listener) throw new Error("background listener missing");
      return listener;
    },
    commit(documentId: string, url: string) {
      if (!committed) throw new Error("navigation listener missing");
      currentDocumentId = documentId;
      currentUrl = url;
      committed({ tabId: 7, frameId: 0, documentId, url });
    },
    before(url: string) {
      if (!beforeNavigate) throw new Error("navigation-start listener missing");
      beforeNavigate({ tabId: 7, frameId: 0, url });
    },
    failNavigation(url: string) {
      if (!navigationError) throw new Error("navigation-error listener missing");
      navigationError({ tabId: 7, frameId: 0, url, error: "net::ERR_ABORTED" });
    },
    replaceFrameSilently(documentId: string, url: string) {
      currentDocumentId = documentId;
      currentUrl = url;
    },
    setFrameUnavailable(unavailable: boolean) {
      frameUnavailable = unavailable;
    },
    setTabPresent(present: boolean) {
      tabPresent = present;
    },
    setTabQueryError(message: string | null) {
      tabQueryError = message;
    },
    detachDebugger(reason = "canceled_by_user") {
      if (!debuggerDetached) throw new Error("debugger detach listener missing");
      debuggerDetached({ tabId: 7 }, reason);
    },
    alarm(name: string) {
      if (!alarmListener) throw new Error("alarm listener missing");
      alarmListener({ name });
    },
    close() {
      if (!removed) throw new Error("tab removal listener missing");
      tabPresent = false;
      removed(7);
    },
  };
}

function caller(listener: MessageListener) {
  let sequence = 0;
  return (
    name: string,
    payload: unknown,
    source: "popup" | "content",
    documentId?: string,
  ): Promise<BusFrame> => new Promise((resolve) => {
    sequence += 1;
    const keepOpen = listener({
      kind: "uf-bus/1",
      frameType: "request",
      id: `request-${sequence}`,
      seq: sequence,
      name,
      source,
      sourceInstance: `${source}:test`,
      target: "background",
      payload,
    }, source === "content"
      ? { tab: { id: 7 }, frameId: 0, documentId }
      : {}, resolve);
    expect(keepOpen).toBe(true);
  });
}

const SCOPE = {
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
  pageUrl: "https://example.com/jobs/1",
} as const;

describe("background render inspection integration", () => {
  afterEach(() => {
    vi.doUnmock("../../../src/background/render-inspection-runtime");
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("orders the expected reload commit before replacement-document adoption", async () => {
    const lock = installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    browser.commit("document-a", SCOPE.pageUrl);
    await Promise.resolve();
    const start = await call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    expect(start).toMatchObject({
      ok: true,
      payload: { status: "started", session: { phase: "awaiting_document" } },
    });
    expect(browser.reload).toHaveBeenCalledTimes(1);

    await expect(call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: "source-nonce",
    }, "content", "document-a")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale" },
    });

    browser.commit("document-b", SCOPE.pageUrl);
    const adopted = await call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: "replacement-nonce",
    }, "content", "document-b");
    expect(adopted).toMatchObject({
      ok: true,
      payload: {
        status: "adopt",
        session: { phase: "adopted", documentId: "document-b" },
      },
    });
    expect(lock.navigationCommitted).toHaveBeenCalledTimes(2);

    const session = (adopted.payload as {
      session: { token: string; generation: number };
    }).session;
    await expect(call("renderInspection.ackPaint", {
      token: session.token,
      generation: session.generation,
      pageUrl: SCOPE.pageUrl,
      documentNonce: "replacement-nonce",
    }, "content", "document-b")).resolves.toMatchObject({
      ok: true,
      payload: {
        status: "ok",
        session: { phase: "terminal", terminalReason: "paint-acknowledged" },
      },
    });

    browser.commit("document-c", SCOPE.pageUrl);
    await expect(call("renderInspection.current", { tabId: 7 }, "popup")).resolves.toMatchObject({
      ok: true,
      payload: {
        status: "terminal",
        session: { terminalReason: "unexpected-navigation" },
      },
    });
    expect(browser.commands).toContainEqual({
      method: "Emulation.setScriptExecutionDisabled",
      params: { value: false },
    });
  });

  it("acknowledges a JavaScript-off curtain from the debugger-owned starvation fallback", async () => {
    vi.useFakeTimers();
    try {
      installLockRuntime(SCOPE);
      const browser = installBrowser({ runtimeEvaluateValue: true });
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());

      browser.commit("document-a", SCOPE.pageUrl);
      const started = await call("renderInspection.start", {
        tabId: 7,
        property: {
          environmentKey: SCOPE.environmentKey,
          siteId: SCOPE.siteId,
          baseUrl: SCOPE.baseUrl,
        },
        pageUrl: SCOPE.pageUrl,
        javascriptEnabled: false,
      }, "popup");
      browser.commit("document-b", SCOPE.pageUrl);
      const adopted = await call("renderInspection.adopt", {
        pageUrl: SCOPE.pageUrl,
        documentNonce: "replacement-nonce",
      }, "content", "document-b");
      const session = (adopted.payload as {
        session: { token: string; generation: number };
      }).session;
      expect(started).toMatchObject({ ok: true, payload: { status: "started" } });

      const fallback = call("renderInspection.paintFallbackTick", {
        token: session.token,
        generation: session.generation,
        pageUrl: SCOPE.pageUrl,
        documentNonce: "replacement-nonce",
      }, "content", "document-b");
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(fallback).resolves.toMatchObject({
        ok: true,
        payload: { status: "acknowledged" },
      });
      await expect(call("renderInspection.current", { tabId: 7 }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: {
          status: "terminal",
          session: { terminalReason: "paint-acknowledged" },
        },
      });
      expect(browser.commands).toContainEqual(expect.objectContaining({
        method: "Runtime.evaluate",
        params: expect.objectContaining({
          expression: expect.stringContaining("data-uf-render-inspection-curtain"),
          returnByValue: true,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a popup scope that differs from the canonical lock property or page", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    const response = await call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: 999,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: "https://example.com/jobs/other",
      javascriptEnabled: false,
    }, "popup");

    expect(response).toMatchObject({
      ok: false,
      failure: { code: "HANDLER_FAILED" },
    });
    expect(browser.reload).not.toHaveBeenCalled();
    expect(browser.commands).not.toContainEqual(expect.objectContaining({
      method: "Emulation.setScriptExecutionDisabled",
    }));
  });

  it("hydrates a cold current document and starts on a managed non-candidate property", async () => {
    installLockRuntime(SCOPE, {
      contextStatus: "managed_non_candidate",
      exposeLockScope: false,
    });
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    await expect(call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup")).resolves.toMatchObject({
      ok: true,
      payload: {
        status: "started",
        session: { phase: "awaiting_document", javascriptEnabled: false },
      },
    });
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("uses fresh managed B authority even when the old edit scope is A and Hub says terminate", async () => {
    const oldScope = {
      environmentKey: "old.example.com",
      siteId: 11,
      baseUrl: "https://old.example.com",
      pageUrl: "https://old.example.com/jobs/1",
    } as const;
    const lock = installLockRuntime(SCOPE, {
      draftDisposition: "terminate",
      lockScope: oldScope,
    });
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    await expect(call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup")).resolves.toMatchObject({
      ok: true,
      payload: { status: "started" },
    });
    expect(lock.inspectionScopeForTab).not.toHaveBeenCalled();
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("rechecks the admitted navigation epoch before any inspection CDP write", async () => {
    const contextGate = deferred();
    const contextStarted = deferred();
    installLockRuntime(SCOPE, {
      contextResolveGate: contextGate.promise,
      onContextResolveStarted: () => contextStarted.resolve(),
    });
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    const response = call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    await contextStarted.promise;
    browser.before("https://example.com/jobs/2");
    contextGate.resolve();

    await expect(response).resolves.toMatchObject({
      ok: false,
      failure: { code: "HANDLER_FAILED" },
    });
    expect(browser.commands).not.toContainEqual(expect.objectContaining({
      method: "Emulation.setScriptExecutionDisabled",
    }));
    expect(browser.reload).not.toHaveBeenCalled();
  });

  it("keeps inspection commit/adoption independent from blocked Hub navigation cleanup", async () => {
    const cleanupGate = deferred();
    const lock = installLockRuntime(SCOPE, { navigationCleanupGate: cleanupGate.promise });
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    await call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    browser.before(SCOPE.pageUrl);
    browser.commit("document-b", SCOPE.pageUrl);
    await vi.waitFor(() => {
      expect(lock.shieldNavigationCommitted).toHaveBeenCalledTimes(1);
    });

    const adoption = call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: "replacement-nonce",
    }, "content", "document-b");
    let blockedTimer!: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      adoption,
      new Promise<"blocked">((resolve) => {
        blockedTimer = setTimeout(() => resolve("blocked"), 100);
      }),
    ]).finally(() => {
      clearTimeout(blockedTimer);
      cleanupGate.resolve();
    });

    expect(result).not.toBe("blocked");
    expect(result).toMatchObject({
      ok: true,
      payload: { status: "adopt", session: { documentId: "document-b" } },
    });
  });

  it("does not let a stale navigation error for A release the pending B fence", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    browser.commit("document-a", SCOPE.pageUrl);
    browser.before("https://example.com/jobs/2");
    browser.failNavigation(SCOPE.pageUrl);
    await Promise.resolve();
    await Promise.resolve();

    await expect(call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup")).resolves.toMatchObject({
      ok: false,
      failure: { code: "HANDLER_FAILED" },
    });
    expect(browser.reload).not.toHaveBeenCalled();
  });

  it("awaits durable inspection alarm creation before touching script execution", async () => {
    const alarmGate = deferred();
    const alarmStarted = deferred();
    installLockRuntime(SCOPE);
    const browser = installBrowser({
      createAlarm(name) {
        if (name === "rewrite-render-inspection-deadline") {
          alarmStarted.resolve();
          return alarmGate.promise;
        }
      },
    });
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    const response = call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    await alarmStarted.promise;
    expect(browser.commands).not.toContainEqual(expect.objectContaining({
      method: "Emulation.setScriptExecutionDisabled",
    }));
    alarmGate.resolve();

    await expect(response).resolves.toMatchObject({
      ok: true,
      payload: { status: "started" },
    });
  });

  it("routes debugger detach into same-generation fail-open inspection terminalization", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    await call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    browser.detachDebugger();

    await expect(call("renderInspection.current", { tabId: 7 }, "popup"))
      .resolves.toMatchObject({
        ok: true,
        payload: {
          status: "terminal",
          session: { terminalReason: "content-failed", javascriptEnabled: false },
        },
      });
    expect(browser.commands).toContainEqual({
      method: "Emulation.setScriptExecutionDisabled",
      params: { value: false },
    });
  });

  it("rejects same-document adopt, acknowledgement, and failure after Unregister", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    const started = await call("renderInspection.start", {
      tabId: 7,
      property: {
        environmentKey: SCOPE.environmentKey,
        siteId: SCOPE.siteId,
        baseUrl: SCOPE.baseUrl,
      },
      pageUrl: SCOPE.pageUrl,
      javascriptEnabled: false,
    }, "popup");
    browser.before(SCOPE.pageUrl);
    browser.commit("document-b", SCOPE.pageUrl);
    const adopted = await call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: "replacement-nonce",
    }, "content", "document-b");
    const session = (adopted.payload as {
      session: { token: string; generation: number };
    }).session;
    expect(started).toMatchObject({ ok: true, payload: { status: "started" } });
    expect(adopted).toMatchObject({ ok: true, payload: { status: "adopt" } });

    await expect(call("session.unregister", { tabId: 7 }, "popup")).resolves.toMatchObject({
      ok: true,
      payload: { status: "ok" },
    });
    const exactFence = {
      token: session.token,
      generation: session.generation,
      pageUrl: SCOPE.pageUrl,
      documentNonce: "replacement-nonce",
    };
    await expect(call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: exactFence.documentNonce,
    }, "content", "document-b")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
    await expect(call("renderInspection.ackPaint", exactFence, "content", "document-b"))
      .resolves.toMatchObject({
        ok: true,
        payload: { status: "stale", reason: "stale-main-document" },
      });
    await expect(call("renderInspection.fail", {
      ...exactFence,
      reason: "late-post-unregister-failure",
    }, "content", "document-b")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
  });

  it("fails closed for inspection mutations when current document authority is unknown", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser({ frameUnavailable: true });
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());
    const fence = {
      token: "obsolete-token",
      generation: 1,
      pageUrl: SCOPE.pageUrl,
      documentNonce: "obsolete-nonce",
    };

    await expect(call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: fence.documentNonce,
    }, "content", "document-obsolete")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
    await expect(call("renderInspection.ackPaint", fence, "content", "document-obsolete"))
      .resolves.toMatchObject({
        ok: true,
        payload: { status: "stale", reason: "stale-main-document" },
      });
    await expect(call("renderInspection.fail", {
      ...fence,
      reason: "late-old-document-failure",
    }, "content", "document-obsolete")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
  });

  it("rejects cached A mutations when a fresh main-frame read already reports B", async () => {
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());
    const fence = {
      token: "obsolete-token",
      generation: 1,
      pageUrl: SCOPE.pageUrl,
      documentNonce: "obsolete-nonce",
    };

    browser.commit("document-a", SCOPE.pageUrl);
    browser.replaceFrameSilently("document-b", SCOPE.pageUrl);

    await expect(call("renderInspection.adopt", {
      pageUrl: SCOPE.pageUrl,
      documentNonce: fence.documentNonce,
    }, "content", "document-a")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
    await expect(call("renderInspection.ackPaint", fence, "content", "document-a"))
      .resolves.toMatchObject({
        ok: true,
        payload: { status: "stale", reason: "stale-main-document" },
      });
    await expect(call("renderInspection.fail", {
      ...fence,
      reason: "late-old-document-failure",
    }, "content", "document-a")).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale", reason: "stale-main-document" },
    });
  });

  it("classifies identity-less cleanup solely by authoritative tab presence", async () => {
    type CleanupRecord = Readonly<{
      tabId: number;
      documentId: string | null;
      sourceDocumentId: string | null;
      pageUrl: string;
    }>;
    type Classification = "current" | "stale" | "unknown";
    let classifyCleanupOccurrence:
      | ((record: CleanupRecord) => Promise<Classification>)
      | undefined;
    vi.doMock("../../../src/background/render-inspection-runtime", () => ({
      createRenderInspectionRuntime: vi.fn((input: Readonly<{
        classifyTabCleanupOccurrence?: (
          record: CleanupRecord,
        ) => Classification | Promise<Classification>;
      }>) => {
        classifyCleanupOccurrence = async (record) =>
          await input.classifyTabCleanupOccurrence?.(record) ?? "unknown";
        return {
          initialize: vi.fn().mockResolvedValue(undefined),
          observeNavigationStart: vi.fn(() => false),
          navigationStarted: vi.fn().mockResolvedValue(undefined),
          navigationFailed: vi.fn().mockResolvedValue(undefined),
          observeNavigationCommit: vi.fn(),
          navigationCommitted: vi.fn().mockResolvedValue(undefined),
          debuggerDetached: vi.fn().mockResolvedValue(undefined),
          terminateTab: vi.fn().mockResolvedValue(undefined),
          terminateProperty: vi.fn().mockResolvedValue(undefined),
          handleAlarm: vi.fn().mockResolvedValue(undefined),
          start: vi.fn(),
          current: vi.fn(),
          cancel: vi.fn(),
          adopt: vi.fn(),
          acknowledgePaint: vi.fn(),
          fail: vi.fn(),
        };
      }),
    }));
    installLockRuntime(SCOPE);
    const browser = installBrowser();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    await vi.waitFor(() => expect(classifyCleanupOccurrence).toBeTypeOf("function"));
    const classify = classifyCleanupOccurrence;
    if (!classify) throw new Error("cleanup classifier was not wired");
    const record: CleanupRecord = {
      tabId: 7,
      documentId: "document-a",
      sourceDocumentId: "document-a",
      pageUrl: SCOPE.pageUrl,
    };

    await expect(classify(record)).resolves.toBe("current");
    browser.replaceFrameSilently("document-b", SCOPE.pageUrl);
    await expect(classify(record)).resolves.toBe("current");

    browser.setFrameUnavailable(true);
    browser.before("https://example.com/jobs/2");
    await expect(classify(record)).resolves.toBe("current");

    browser.setTabPresent(false);
    await expect(classify(record)).resolves.toBe("stale");
    browser.setTabQueryError("temporary tabs query failure");
    await expect(classify(record)).resolves.toBe("unknown");
  });
});
