import { afterEach, describe, expect, it, vi } from "vitest";

import type { BusFrame } from "../../../src/messaging/contract";
import {
  createMemoryStore,
  type KeyValueStore,
} from "../../../src/storage";

const CONFIG = {
  version: 2,
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
  propertyRevision: 1,
  feedRevision: 1,
  membershipFingerprint: "membership",
  assignmentFingerprint: "assignment",
  renderMode: "rendered",
  renderModeUpdatedAt: "2026-08-21T10:00:00Z",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
  selectorsUpdatedAt: "2026-08-21T10:00:00Z",
  submittedSelectorsFingerprint: "selectors",
  pages: {},
  reconciliation: {
    revision: 1,
    feedFingerprint: "feed",
    removedPageKeys: [],
    relabelledPages: [],
  },
};

type MessageListener = (
  frame: BusFrame,
  sender: { tab?: { id?: number }; frameId?: number; documentId?: string },
  sendResponse: (reply: BusFrame) => void,
) => boolean;

type BrowserHarness = Readonly<{
  listener: () => MessageListener;
  commit: (tabId: number, documentId?: string, pageUrl?: string) => void;
  fragment: (tabId: number, documentId: string, pageUrl: string) => void;
  close: (tabId: number) => void;
}>;

function installBrowserHarness(options: Readonly<{
  session?: Readonly<{
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
  }>;
  getFrame?: (
    details: { tabId: number; frameId: number },
    callback: (details: { documentId?: string } | null) => void,
  ) => void;
  action?: Readonly<{
    setIcon?(details: unknown): Promise<void> | void;
    setBadgeText?(details: { tabId: number; text: string }): Promise<void> | void;
    setBadgeBackgroundColor?(details: unknown): Promise<void> | void;
    setTitle?(details: { tabId: number; title: string }): Promise<void> | void;
  }>;
  tabs?: Readonly<{
    sendMessage?(tabId: number, message: unknown): Promise<unknown> | unknown;
  }>;
}> = {}): BrowserHarness {
  const addMessageListener = vi.fn();
  let navigationCommitted: ((details: {
    tabId: number;
    frameId: number;
    documentId?: string;
    url?: string;
  }) => void) | undefined;
  let referenceFragmentUpdated: ((details: {
    tabId: number;
    frameId: number;
    documentId?: string;
    url?: string;
  }) => void) | undefined;
  let tabRemoved: ((tabId: number) => void) | undefined;
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: addMessageListener },
    },
    action: { onClicked: { addListener: vi.fn() }, ...options.action },
    tabs: {
      ...options.tabs,
      onRemoved: {
        addListener(listener: (tabId: number) => void) {
          tabRemoved = listener;
        },
      },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    ...(options.session ? { storage: { session: options.session } } : {}),
    webNavigation: {
      ...(options.getFrame ? { getFrame: options.getFrame } : {}),
      onCommitted: {
        addListener(listener: (details: {
          tabId: number;
          frameId: number;
          documentId?: string;
          url?: string;
        }) => void) {
          navigationCommitted = listener;
        },
      },
      onReferenceFragmentUpdated: {
        addListener(listener: (details: {
          tabId: number;
          frameId: number;
          documentId?: string;
          url?: string;
        }) => void) {
          referenceFragmentUpdated = listener;
        },
      },
    },
  } as unknown as typeof chrome;
  return {
    listener() {
      const listener = addMessageListener.mock.calls[0]?.[0] as MessageListener | undefined;
      if (!listener) throw new Error("Background runtime listener was not installed");
      return listener;
    },
    commit(tabId, documentId, pageUrl) {
      if (!navigationCommitted) throw new Error("Navigation listener was not installed");
      navigationCommitted({
        tabId,
        frameId: 0,
        ...(documentId ? { documentId } : {}),
        ...(pageUrl ? { url: pageUrl } : {}),
      });
    },
    fragment(tabId, documentId, pageUrl) {
      if (!referenceFragmentUpdated) throw new Error("Fragment listener was not installed");
      referenceFragmentUpdated({ tabId, frameId: 0, documentId, url: pageUrl });
    },
    close(tabId) {
      if (!tabRemoved) throw new Error("Tab removal listener was not installed");
      tabRemoved(tabId);
    },
  };
}

function caller(listener: MessageListener) {
  let seq = 0;
  return (
    name: string,
    payload: unknown,
    source: "content" | "popup",
    documentId?: string,
  ): Promise<BusFrame> => new Promise((resolve) => {
    seq += 1;
    const keepOpen = listener({
      kind: "uf-bus/1",
      frameType: "request",
      id: `request-${seq}`,
      seq,
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

let factSequence = 10_000;
function reportContentFact(
  listener: MessageListener,
  documentId: string,
  reason: "content-started" | "marking-toggle" = "content-started",
): void {
  factSequence += 1;
  listener({
    kind: "uf-bus/1",
    frameType: "event",
    id: `fact-${factSequence}`,
    seq: factSequence,
    name: "fact.reported",
    source: "content",
    sourceInstance: "content:test",
    target: "background",
    payload: {
      kind: "uf-fact/1",
      sensation: {
        tabId: 7,
        source: "content",
        reason,
        facts: {
          tabId: 7,
          pageUrl: "https://example.com/jobs/1",
          baseUrl: "https://example.com",
          ...(reason === "marking-toggle" ? { markingToggleSeq: factSequence } : {}),
        },
      },
    },
  }, { tab: { id: 7 }, frameId: 0, documentId }, () => undefined);
}

function reportPopupFact(listener: MessageListener): void {
  factSequence += 1;
  listener({
    kind: "uf-bus/1",
    frameType: "event",
    id: `popup-fact-${factSequence}`,
    seq: factSequence,
    name: "fact.reported",
    source: "popup",
    sourceInstance: "popup:test",
    target: "background",
    payload: {
      kind: "uf-fact/1",
      sensation: {
        tabId: 7,
        source: "popup",
        reason: "marking-toggle",
        facts: {
          tabId: 7,
          pageUrl: "https://example.com/jobs/1",
          markingToggleSeq: factSequence,
        },
      },
    },
  }, {}, () => undefined);
}

function installServicesWithStore(store: KeyValueStore): void {
  vi.doMock("../../../src/background/services", async () => {
    const actual = await vi.importActual<typeof import("../../../src/background/services")>(
      "../../../src/background/services",
    );
    return {
      ...actual,
      createRewriteBackgroundServices: () => actual.createRewriteBackgroundServices({ store }),
    };
  });
}

async function configureAndAdopt(
  call: ReturnType<typeof caller>,
  documentId = "doc-a",
): Promise<void> {
  await call("settings.save", {
    stageBase: "stage.example.com",
    configEndpoint: "https://hub.example.com",
  }, "popup");
  await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");
  const context = await call("page.context", {
    pageUrl: "https://example.com/jobs/1",
  }, "content", documentId);
  const posture = (context.payload as {
    shieldPosture: { revision: number; scope: Record<string, unknown> };
  }).shieldPosture;
  await expect(call("shield.posture.set", {
    expected: { ...posture.scope, revision: posture.revision },
    posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
  }, "content", documentId)).resolves.toMatchObject({
    ok: true,
    payload: { status: "ok", posture: { status: "active" } },
  });
}

describe("P15 shield navigation/startup ordering", () => {
  afterEach(() => {
    vi.doUnmock("../../../src/background/services");
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("waits for deferred old-document cleanup before page.context adopts the replacement document", async () => {
    const base = createMemoryStore();
    let holdTabFacts = false;
    let releaseTabFacts: (() => void) | null = null;
    let tabFactsReadStarted: (() => void) | null = null;
    const readStarted = new Promise<void>((resolve) => {
      tabFactsReadStarted = resolve;
    });
    const readRelease = new Promise<void>((resolve) => {
      releaseTabFacts = resolve;
    });
    const store: KeyValueStore = {
      async get(key) {
        if (holdTabFacts && key === "tabState:7") {
          tabFactsReadStarted?.();
          await readRelease;
        }
        return base.get(key);
      },
      set: (key, value) => base.set(key, value),
      remove: (key) => base.remove(key),
      clear: () => base.clear(),
    };
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await configureAndAdopt(call);

      holdTabFacts = true;
      const pendingPull = call("signals.pull", { tabId: 7, afterSeq: 0 }, "popup");
      await readStarted;
      browser.commit(7, "doc-b");
      const replacementContext = call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-b");
      let replacementSettled = false;
      void replacementContext.finally(() => {
        replacementSettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(replacementSettled).toBe(false);

      releaseTabFacts?.();
      await pendingPull;
      await expect(replacementContext).resolves.toMatchObject({
        ok: true,
        payload: {
          shieldPosture: {
            status: "active",
            scope: { documentKey: "doc-b" },
            directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
          },
        },
      });
      await expect(call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "active", scope: { documentKey: "doc-b" } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("cold-starts after navigation and rebinds retained silent selectors through a transient context", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let contextFailure = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify(contextFailure ? {
          status: "upstream_unavailable",
          environmentKey: "stage.example.com",
          siteId: null,
          baseUrl: null,
          pageKey: null,
          pageTypes: [],
          membershipFingerprint: null,
          assignmentFingerprint: null,
          conflicts: [],
          upstreamCode: null,
        } : {
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: contextFailure ? 503 : 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const firstBrowser = installBrowserHarness();
      const firstModule = await import("../../../src/background/index");
      firstModule.startRewriteBackground();
      const firstCall = caller(firstBrowser.listener());
      await configureAndAdopt(firstCall);
      firstBrowser.commit(7);
      await firstCall("signals.pull", { tabId: 7, afterSeq: 0 }, "popup");

      contextFailure = true;
      vi.resetModules();
      installServicesWithStore(store);
      const secondBrowser = installBrowserHarness();
      const secondModule = await import("../../../src/background/index");
      secondModule.startRewriteBackground();
      const secondCall = caller(secondBrowser.listener());

      await expect(secondCall("page.context", {
        pageUrl: "https://example.com/jobs/2",
        refresh: true,
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: {
          status: "unavailable",
          environmentKey: "stage.example.com",
          siteId: null,
          draftDisposition: "preserve",
          shieldPosture: {
            status: "active",
            scope: {
              documentKey: "doc-b",
              siteId: 42,
              pageUrl: "https://example.com/jobs/2",
            },
            directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not recreate a revision-one fence when same-document page.context confirms config removal", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let configExists = true;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return configExists
          ? new Response(JSON.stringify(CONFIG), { status: 200 })
          : new Response("{}", { status: 404 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");
      const first = await call("page.context", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-a");
      expect(first).toMatchObject({
        ok: true,
        payload: {
          shieldPosture: {
            status: "inactive",
            revision: 1,
            scope: { documentKey: "doc-a", contextGeneration: 1 },
          },
        },
      });
      const oldFence = (first.payload as {
        shieldPosture: { revision: number; scope: Record<string, unknown> };
      }).shieldPosture;

      configExists = false;
      await expect(call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { shieldPosture: { status: "inactive", revision: 0 } },
      });
      await expect(call("shield.posture.set", {
        expected: { ...oldFence.scope, revision: oldFence.revision },
        posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unbound", reason: "config-removed" },
      });
      await expect(call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "config-removed" },
      });

      configExists = true;
      await expect(call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { consentSuppressionAllowed: true },
      });
      await expect(call("config.load", { siteId: 42 }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok", config: { siteId: 42 } },
      });
      const reauthorized = await call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-a");
      expect(reauthorized).toMatchObject({
        ok: true,
        payload: {
          status: "inactive",
          revision: 3,
          scope: { documentKey: "doc-a", contextGeneration: 1 },
        },
      });
      await expect(call("shield.posture.set", {
        expected: { ...oldFence.scope, revision: oldFence.revision },
        posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "stale" },
      });
      const freshFence = reauthorized.payload as {
        revision: number;
        scope: Record<string, unknown>;
      };
      await expect(call("shield.posture.set", {
        expected: { ...freshFence.scope, revision: freshFence.revision },
        posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok", posture: { status: "active" } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serializes a deferred old context before a fast new context so the new property owns final scope", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let releaseOldLoad: (() => void) | null = null;
    let markOldLoadStarted: (() => void) | null = null;
    const oldLoadStarted = new Promise<void>((resolve) => {
      markOldLoadStarted = resolve;
    });
    const oldLoadRelease = new Promise<void>((resolve) => {
      releaseOldLoad = resolve;
    });
    const newConfig = {
      ...CONFIG,
      siteId: 99,
      baseUrl: "https://other.example.com",
      membershipFingerprint: "membership-other",
      assignmentFingerprint: "assignment-other",
      submittedSelectorsFingerprint: "selectors-other",
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url.endsWith("/context")) {
        const isNew = String(body.url).startsWith("https://other.example.com/");
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: isNew ? 99 : 42,
          baseUrl: isNew ? "https://other.example.com" : "https://example.com",
          pageKey: isNew ? "/new" : "/old",
          pageTypes: [],
          membershipFingerprint: isNew ? "membership-other" : "membership",
          assignmentFingerprint: isNew ? "assignment-other" : "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        if (body.siteId === 42) {
          markOldLoadStarted?.();
          await oldLoadRelease;
          return new Response(JSON.stringify(CONFIG), { status: 200 });
        }
        return new Response(JSON.stringify(newConfig), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");

      const oldContext = call("page.context", {
        pageUrl: "https://example.com/old",
        refresh: true,
      }, "content", "doc-a");
      await oldLoadStarted;
      const newContext = call("page.context", {
        pageUrl: "https://other.example.com/new",
        refresh: true,
      }, "content", "doc-a");
      let newSettled = false;
      void newContext.finally(() => {
        newSettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(newSettled).toBe(false);

      releaseOldLoad?.();
      await expect(oldContext).resolves.toMatchObject({
        ok: true,
        payload: {
          generation: 1,
          observedUrl: "https://example.com/old",
          shieldPosture: {
            scope: { siteId: 42, pageUrl: "https://example.com/old", contextGeneration: 1 },
          },
        },
      });
      await expect(newContext).resolves.toMatchObject({
        ok: true,
        payload: {
          generation: 2,
          observedUrl: "https://other.example.com/new",
          shieldPosture: {
            scope: {
              environmentKey: "stage.example.com",
              siteId: 99,
              baseUrl: "https://other.example.com",
              pageUrl: "https://other.example.com/new",
              contextGeneration: 2,
              documentKey: "doc-a",
            },
          },
        },
      });
      await expect(call("shield.posture.current", {
        pageUrl: "https://other.example.com/new",
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: {
          status: "inactive",
          scope: {
            siteId: 99,
            pageUrl: "https://other.example.com/new",
            contextGeneration: 2,
            documentKey: "doc-a",
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("adopts retained silent posture before a deferred remote context and rejects missing local config", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let deferContext = false;
    let releaseContext: (() => void) | null = null;
    let markContextStarted: (() => void) | null = null;
    const contextStarted = new Promise<void>((resolve) => {
      markContextStarted = resolve;
    });
    const contextRelease = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    let contextCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        contextCalls += 1;
        if (deferContext) {
          markContextStarted?.();
          await contextRelease;
        }
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await configureAndAdopt(call);
      expect(contextCalls).toBe(1);
      browser.commit(7, "doc-b");
      await call("signals.pull", { tabId: 7, afterSeq: 0 }, "popup");

      deferContext = true;
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://example.com/jobs/2",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: {
          status: "active",
          scope: { documentKey: "doc-b", pageUrl: "https://example.com/jobs/2" },
          directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
        },
      });
      expect(contextCalls).toBe(1);

      const remoteContext = call("page.context", {
        pageUrl: "https://example.com/jobs/2",
        refresh: true,
      }, "content", "doc-b");
      await contextStarted;
      let remoteSettled = false;
      void remoteContext.finally(() => {
        remoteSettled = true;
      });
      await Promise.resolve();
      expect(remoteSettled).toBe(false);
      releaseContext?.();
      deferContext = false;
      await expect(remoteContext).resolves.toMatchObject({
        ok: true,
        payload: {
          generation: 2,
          shieldPosture: {
            status: "active",
            scope: { documentKey: "doc-b", contextGeneration: 2 },
          },
        },
      });

      browser.commit(7, "doc-c");
      await call("signals.pull", { tabId: 7, afterSeq: 0 }, "popup");
      await store.remove("config:stage.example.com:42");
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://example.com/jobs/3",
      }, "content", "doc-c")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "local-config-unavailable" },
      });
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://example.com/jobs/3",
      }, "content", "doc-c")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "no-retained-silent-posture" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects stale document messages after a committed replacement and after its Unregister", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let contextCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        contextCalls += 1;
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const listener = browser.listener();
      const call = caller(listener);
      await configureAndAdopt(call, "doc-a");
      expect(contextCalls).toBe(1);

      browser.commit(7, "doc-b");
      await expect(call("page.context", {
        pageUrl: "https://different.example/jobs/old",
        refresh: true,
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "stale", shieldPosture: { status: "inactive" } },
      });
      expect(contextCalls).toBe(1);
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://different.example/jobs/old",
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "stale-main-document" },
      });
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "active", scope: { documentKey: "doc-b" } },
      });
      await expect(call("lock.action", {
        tabId: 7,
        kind: "suggest-takeover",
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable" },
      });

      await expect(call("session.unregister", { tabId: 7 }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
      reportContentFact(listener, "doc-a", "marking-toggle");
      reportContentFact(listener, "doc-b", "content-started");
      reportPopupFact(listener);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(call("emulation.apply", {
        tabId: 7,
        mode: "mobile",
        scale: 1,
      }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: { mode: "mobile", active: false },
      });
      await expect(call("lock.directive", {
        tabId: 7,
        pageUrl: "https://example.com/jobs/1",
        baseUrl: "https://example.com",
      }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", canEdit: false },
      });
      await expect(call("signals.pull", { tabId: 7, afterSeq: 0 }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: [],
      });
      for (const documentId of ["doc-a", "doc-b"]) {
        await expect(call("consent.suppression.register", {
          tabId: 7,
        }, "content", documentId)).resolves.toMatchObject({
          ok: true,
          payload: { status: "stale" },
        });
      }
      browser.commit(7, "doc-c");
      await expect(call("consent.suppression.register", {
        tabId: 7,
      }, "content", "doc-c")).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restores the Unregister veto when a replacement commits during consent registration", async () => {
    const values: Record<string, unknown> = {};
    let releaseSuppressionRemove: (() => void) | null = null;
    let markSuppressionRemoveStarted: (() => void) | null = null;
    const suppressionRemoveStarted = new Promise<void>((resolve) => {
      markSuppressionRemoveStarted = resolve;
    });
    const suppressionRemoveRelease = new Promise<void>((resolve) => {
      releaseSuppressionRemove = resolve;
    });
    let deferSuppressionRemove = false;
    const session = {
      async get(key: string) {
        return key in values ? { [key]: values[key] } : {};
      },
      async set(next: Record<string, unknown>) {
        Object.assign(values, next);
      },
      async remove(key: string) {
        if (deferSuppressionRemove && key.includes("consent-suppression-disabled")) {
          markSuppressionRemoveStarted?.();
          await suppressionRemoveRelease;
        }
        delete values[key];
      },
    };
    const browser = installBrowserHarness({ session });
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());

    browser.commit(7, "doc-b");
    await expect(call("session.unregister", { tabId: 7 }, "popup")).resolves.toMatchObject({
      ok: true,
      payload: { status: "ok" },
    });
    browser.commit(7, "doc-c");
    deferSuppressionRemove = true;
    const registering = call("consent.suppression.register", { tabId: 7 }, "content", "doc-c");
    await suppressionRemoveStarted;
    browser.commit(7, "doc-d");
    releaseSuppressionRemove?.();
    await expect(registering).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale" },
    });
    expect(values["uf:consent-suppression-disabled:7"]).toEqual({
      disabled: true,
      blockedDocumentKey: "doc-b",
    });
    deferSuppressionRemove = false;
    await expect(call("consent.suppression.register", { tabId: 7 }, "content", "doc-d"))
      .resolves.toMatchObject({ ok: true, payload: { status: "ok" } });
  });

  it("serializes rapid committed-document writes and cold-starts from the newest document", async () => {
    const values: Record<string, unknown> = {
      "uf:consent-suppression-disabled:7": {
        disabled: true,
        blockedDocumentKey: "doc-b",
      },
    };
    let releaseFirstWrite: (() => void) | null = null;
    let markFirstWriteStarted: (() => void) | null = null;
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteRelease = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let deferFirstWrite = true;
    const session = {
      async get(key: string) {
        return key in values ? { [key]: values[key] } : {};
      },
      async set(next: Record<string, unknown>) {
        const mainDocument = next["uf:main-document:7"] as { documentId?: string } | undefined;
        if (deferFirstWrite && mainDocument?.documentId === "doc-c") {
          markFirstWriteStarted?.();
          await firstWriteRelease;
        }
        Object.assign(values, next);
      },
      async remove(key: string) {
        delete values[key];
      },
    };
    const firstBrowser = installBrowserHarness({ session });
    const first = await import("../../../src/background/index");
    first.startRewriteBackground();
    firstBrowser.commit(7, "doc-c");
    await firstWriteStarted;
    firstBrowser.commit(7, "doc-d");
    releaseFirstWrite?.();
    deferFirstWrite = false;
    for (let tick = 0; tick < 10; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if ((values["uf:main-document:7"] as { documentId?: string } | undefined)?.documentId === "doc-d") {
        break;
      }
    }
    expect(values["uf:main-document:7"]).toEqual({ documentId: "doc-d" });

    vi.resetModules();
    const restartedBrowser = installBrowserHarness({ session });
    const restarted = await import("../../../src/background/index");
    restarted.startRewriteBackground();
    const call = caller(restartedBrowser.listener());
    await expect(call("consent.suppression.register", { tabId: 7 }, "content", "doc-c"))
      .resolves.toMatchObject({ ok: true, payload: { status: "stale" } });
    await expect(call("consent.suppression.register", { tabId: 7 }, "content", "doc-d"))
      .resolves.toMatchObject({ ok: true, payload: { status: "ok" } });
  });

  it("preserves a retained shield posture across the first cold-worker hash without inspection", async () => {
    const base = createMemoryStore();
    installServicesWithStore(base);
    const values: Record<string, unknown> = {};
    const session = {
      async get(key: string) {
        return key in values ? { [key]: values[key] } : {};
      },
      async set(next: Record<string, unknown>) {
        Object.assign(values, next);
      },
      async remove(key: string) {
        delete values[key];
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const firstBrowser = installBrowserHarness({ session });
      const first = await import("../../../src/background/index");
      first.startRewriteBackground();
      firstBrowser.commit(7, "doc-a", "https://example.com/jobs/1");
      const firstCall = caller(firstBrowser.listener());
      await configureAndAdopt(firstCall, "doc-a");
      const retained = await base.get("shieldPosture:7");
      expect(retained).toMatchObject({
        adoptedDocument: { documentId: "doc-a" },
        silentSelectors: CONFIG.selectors,
      });
      await vi.waitFor(() => expect(values["uf:main-document-authority:7"]).toEqual({
        documentId: "doc-a",
        pageUrl: "https://example.com/jobs/1",
      }));

      vi.resetModules();
      installServicesWithStore(base);
      const restartedBrowser = installBrowserHarness({ session });
      const restarted = await import("../../../src/background/index");
      restarted.startRewriteBackground();
      restartedBrowser.fragment(7, "doc-a", "https://example.com/jobs/1#details");

      // The async durable classifier must complete without invoking the broad
      // navigation cleanup that clears the adopted document posture.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await base.get("shieldPosture:7")).toEqual(retained);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("prefers an in-memory commit over an older deferred session document read", async () => {
    const values: Record<string, unknown> = {
      "uf:main-document:7": { documentId: "doc-c" },
      "uf:consent-suppression-disabled:7": {
        disabled: true,
        blockedDocumentKey: "doc-b",
      },
    };
    let releaseDocumentRead: (() => void) | null = null;
    let markDocumentReadStarted: (() => void) | null = null;
    const documentReadStarted = new Promise<void>((resolve) => {
      markDocumentReadStarted = resolve;
    });
    const documentReadRelease = new Promise<void>((resolve) => {
      releaseDocumentRead = resolve;
    });
    const session = {
      async get(key: string) {
        const captured = key in values ? { [key]: values[key] } : {};
        if (key === "uf:main-document:7") {
          markDocumentReadStarted?.();
          await documentReadRelease;
        }
        return captured;
      },
      async set(next: Record<string, unknown>) {
        Object.assign(values, next);
      },
      async remove(key: string) {
        delete values[key];
      },
    };
    const browser = installBrowserHarness({ session });
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const call = caller(browser.listener());
    const staleRegister = call("consent.suppression.register", { tabId: 7 }, "content", "doc-c");
    await documentReadStarted;
    browser.commit(7, "doc-d");
    releaseDocumentRead?.();
    await expect(staleRegister).resolves.toMatchObject({
      ok: true,
      payload: { status: "stale" },
    });
    expect(values["uf:consent-suppression-disabled:7"]).toEqual({
      disabled: true,
      blockedDocumentKey: "doc-b",
    });
  });

  it("drops a lock callback emitted during deferred Unregister cleanup", async () => {
    const base = createMemoryStore();
    type WriteGate = Readonly<{
      started: Promise<void>;
      release: () => void;
      markStarted: () => void;
      waitForRelease: Promise<void>;
    }>;
    const createWriteGate = (): WriteGate => {
      let markStarted = () => undefined;
      let release = () => undefined;
      return {
        started: new Promise<void>((resolve) => { markStarted = resolve; }),
        release: () => release(),
        markStarted: () => markStarted(),
        waitForRelease: new Promise<void>((resolve) => { release = resolve; }),
      };
    };
    let nextLockFactWriteGate: WriteGate | null = null;
    const store: KeyValueStore = {
      get: (key) => base.get(key),
      async set(key, value) {
        if (nextLockFactWriteGate && key === "tabState:7") {
          const gate = nextLockFactWriteGate;
          nextLockFactWriteGate = null;
          gate.markStarted();
          await gate.waitForRelease;
        }
        await base.set(key, value);
      },
      remove: (key) => base.remove(key),
      clear: () => base.clear(),
    };
    installServicesWithStore(store);
    const sessionValues: Record<string, unknown> = {};
    let releaseTombstoneWrite: (() => void) | null = null;
    let markTombstoneWriteStarted: (() => void) | null = null;
    const tombstoneWriteStarted = new Promise<void>((resolve) => {
      markTombstoneWriteStarted = resolve;
    });
    const tombstoneWriteRelease = new Promise<void>((resolve) => {
      releaseTombstoneWrite = resolve;
    });
    const session = {
      async get(key: string) {
        return key in sessionValues ? { [key]: sessionValues[key] } : {};
      },
      async set(next: Record<string, unknown>) {
        if ("uf:consent-suppression-disabled:7" in next) {
          markTombstoneWriteStarted?.();
          await tombstoneWriteRelease;
        }
        Object.assign(sessionValues, next);
      },
      async remove(key: string) {
        delete sessionValues[key];
      },
    };
    const titles: Array<{ tabId: number; title: string }> = [];
    const tabMessages: unknown[] = [];
    const browser = installBrowserHarness({
      session,
      action: {
        setTitle(details) {
          titles.push(details);
        },
      },
      tabs: {
        sendMessage(_tabId, message) {
          tabMessages.push(message);
          return undefined;
        },
      },
    });
    const socketListeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    const socketFrames: string[] = [];
    class FakeWebSocket {
      send(data: string): void {
        socketFrames.push(data);
      }
      close(): void {}
      addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
        socketListeners.set(type, [...(socketListeners.get(type) ?? []), listener]);
      }
      emit(type: string, data?: unknown): void {
        for (const listener of socketListeners.get(type) ?? []) listener({ data });
      }
    }
    const socket = new FakeWebSocket();
    const originalWebSocket = globalThis.WebSocket;
    const originalFetch = globalThis.fetch;
    globalThis.WebSocket = (class {
      constructor() {
        return socket;
      }
    }) as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [{ pageType: "detail", pages: [{ pageKey: "/jobs/1", wordsCount: 10 }] }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const listener = browser.listener();
      const call = caller(listener);
      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");
      browser.commit(7, "doc-a");
      reportContentFact(listener, "doc-a", "content-started");
      for (let tick = 0; tick < 20 && !socketListeners.has("open"); tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(socketListeners.has("open")).toBe(true);
      socket.emit("open");
      expect(JSON.parse(socketFrames[0] ?? "{}")).toMatchObject({
        type: "authenticate",
        protocol: "bearer-frame-v1",
        token: "jwt",
      });
      socket.emit("message", JSON.stringify({
        type: "authenticated",
        protocol: "bearer-frame-v1",
      }));
      const subscribe = JSON.parse(socketFrames[1] ?? "{}");
      expect(subscribe).toMatchObject({ type: "subscribe" });
      socket.emit("message", JSON.stringify({
        type: "subscribed",
        identity: "user@example.com",
        editorSessionId: subscribe.editorSessionId,
      }));
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        environmentKey: "stage.example.com",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-a",
        propertyRevision: 1,
        feedRevision: 1,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      let messagesBeforeTermination = tabMessages.length;

      const oldWrite = createWriteGate();
      nextLockFactWriteGate = oldWrite;
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: false,
        editorName: "Deferred editor",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-deferred",
        propertyRevision: 2,
        feedRevision: 1,
      }));
      await oldWrite.started;
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorName: "Current editor",
        environmentKey: "stage.example.com",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-current",
        propertyRevision: 3,
        feedRevision: 1,
      }));
      oldWrite.release();
      await vi.waitFor(async () => {
        expect(await base.get("tabState:7")).toMatchObject({
          facts: { lockRole: "editor", lockCanEdit: true },
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      messagesBeforeTermination = tabMessages.length;

      const terminalWrite = createWriteGate();
      nextLockFactWriteGate = terminalWrite;
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: false,
        editorName: "Deferred terminal editor",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-terminal",
        propertyRevision: 4,
        feedRevision: 1,
      }));
      await terminalWrite.started;
      const unregister = call("session.unregister", { tabId: 7 }, "popup");
      await tombstoneWriteStarted;
      socket.emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: false,
        editorName: "Stale editor",
        editorSessionId: subscribe.editorSessionId,
        lockToken: "fence-stale",
        propertyRevision: 2,
        feedRevision: 1,
      }));
      releaseTombstoneWrite?.();
      let unregisterSettled = false;
      void unregister.finally(() => {
        unregisterSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unregisterSettled).toBe(false);
      terminalWrite.release();
      await expect(unregister).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(tabMessages).toHaveLength(messagesBeforeTermination);
      expect(await base.get("tabState:7")).toMatchObject({
        facts: {
          lockRole: "unknown",
          configPresent: false,
          hasUnsavedWork: false,
        },
      });
      expect(titles.at(-1)).toEqual({
        tabId: 7,
        title: "Unfluffify — not registered on this tab",
      });
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
    }
  });

  it("orders a deferred popup fact before Unregister and drops every later popup fact", async () => {
    const base = createMemoryStore();
    let releaseTabFacts: (() => void) | null = null;
    let markTabFactsReadStarted: (() => void) | null = null;
    const tabFactsReadStarted = new Promise<void>((resolve) => {
      markTabFactsReadStarted = resolve;
    });
    const tabFactsReadRelease = new Promise<void>((resolve) => {
      releaseTabFacts = resolve;
    });
    let deferTabFacts = true;
    const store: KeyValueStore = {
      async get(key) {
        if (deferTabFacts && key === "tabState:7") {
          markTabFactsReadStarted?.();
          await tabFactsReadRelease;
        }
        return base.get(key);
      },
      set: (key, value) => base.set(key, value),
      remove: (key) => base.remove(key),
      clear: () => base.clear(),
    };
    installServicesWithStore(store);
    const browser = installBrowserHarness();
    const { startRewriteBackground } = await import("../../../src/background/index");
    startRewriteBackground();
    const listener = browser.listener();
    const call = caller(listener);

    reportPopupFact(listener);
    await tabFactsReadStarted;
    const unregister = call("session.unregister", { tabId: 7 }, "popup");
    releaseTabFacts?.();
    deferTabFacts = false;
    await expect(unregister).resolves.toMatchObject({
      ok: true,
      payload: { status: "ok" },
    });
    const terminalFacts = await base.get("tabState:7");
    expect(terminalFacts).toMatchObject({
      tabId: 7,
      facts: { markingEnabled: false, hasUnsavedWork: false },
    });

    reportPopupFact(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await base.get("tabState:7")).toEqual(terminalFacts);
    await expect(call("signals.pull", { tabId: 7, afterSeq: 0 }, "popup"))
      .resolves.toMatchObject({ ok: true, payload: [] });
  });

  it("orders Unregister after a deferred context and refuses every post-Unregister adoption", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let releaseLoad: (() => void) | null = null;
    let markLoadStarted: (() => void) | null = null;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const loadRelease = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let deferLoad = true;
    let loadCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        loadCalls += 1;
        if (deferLoad) {
          markLoadStarted?.();
          await loadRelease;
        }
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");

      const oldContext = call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-a");
      await loadStarted;
      const preTerminalRegister = call(
        "consent.suppression.register",
        { tabId: 7 },
        "content",
        "doc-a",
      );
      const unregister = call("session.unregister", { tabId: 7 }, "popup");
      const staleRegister = call(
        "consent.suppression.register",
        { tabId: 7 },
        "content",
        "doc-a",
      );
      releaseLoad?.();
      deferLoad = false;

      await expect(oldContext).resolves.toMatchObject({
        ok: true,
        payload: {
          consentSuppressionAllowed: true,
          shieldPosture: { scope: { documentKey: "doc-a" } },
        },
      });
      await expect(preTerminalRegister).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
      await expect(unregister).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
      await expect(staleRegister).resolves.toMatchObject({
        ok: true,
        payload: { status: "stale" },
      });
      await expect(call("shield.posture.adoptRetained", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "suppression-disabled" },
      });
      await expect(call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: {
          consentSuppressionAllowed: false,
          shieldPosture: { status: "inactive", revision: 0 },
        },
      });
      expect(loadCalls).toBe(1);
      await expect(call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "document-unbound" },
      });
      browser.commit(7, "doc-b");
      await expect(call(
        "consent.suppression.register",
        { tabId: 7 },
        "content",
        "doc-b",
      )).resolves.toMatchObject({
        ok: true,
        payload: { status: "ok" },
      });
      await expect(call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: {
          consentSuppressionAllowed: true,
          shieldPosture: { scope: { documentKey: "doc-b" } },
        },
      });
      expect(loadCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("orders tab-close cleanup after a deferred context so no late binding survives", async () => {
    const store = createMemoryStore();
    installServicesWithStore(store);
    const originalFetch = globalThis.fetch;
    let releaseLoad: (() => void) | null = null;
    let markLoadStarted: (() => void) | null = null;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const loadRelease = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        markLoadStarted?.();
        await loadRelease;
        return new Response(JSON.stringify(CONFIG), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    try {
      const browser = installBrowserHarness();
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const call = caller(browser.listener());
      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");

      const oldContext = call("page.context", {
        pageUrl: "https://example.com/jobs/1",
        refresh: true,
      }, "content", "doc-a");
      await loadStarted;
      browser.close(7);
      releaseLoad?.();
      await expect(oldContext).resolves.toMatchObject({
        ok: true,
        payload: { shieldPosture: { scope: { documentKey: "doc-a" } } },
      });
      await expect(call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-a")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "document-unbound" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
