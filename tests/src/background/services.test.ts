import { describe, expect, it, vi } from "vitest";

import { createFetchJsonTransport, createRewriteBackgroundServices } from "../../../src/background/services";
import { createPropertyLockRuntime } from "../../../src/background/lock-runtime";
import type { JsonRequest, JsonResponse } from "../../../src/lynx";
import { createMemoryStore } from "../../../src/storage";
import {
  PROPERTY_CONTEXT_RECOVERY_POLL_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS,
} from "../../../src/lock";

function fakeSocket() {
  const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  const sent: string[] = [];
  return {
    sent,
    socket: {
      send(data: string) { sent.push(data); },
      close() {},
      addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    emit(type: string, data?: unknown) {
      for (const listener of listeners.get(type) ?? []) listener({ data });
    },
  };
}

const snapshot = {
  baseUrl: "https://example.com",
  renderMode: "rendered" as const,
  defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
  pages: [{
    url: "https://example.com/page",
    renderedHtml: "<html></html>",
    renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
  }],
};

function hubContext(
  request: JsonRequest,
  options: Readonly<{
    status?: "managed_candidate" | "managed_non_candidate" | "property_not_found" | "authentication_required";
    siteId?: number | null;
  }> = {},
): JsonResponse {
  const body = request.body as { environmentKey?: string; url?: string } | undefined;
  const observedUrl = body?.url ?? "https://example.com/page";
  const pageKey = (() => {
    try {
      const parsed = new URL(observedUrl);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  })();
  const status = options.status ?? "managed_candidate";
  const siteId = options.siteId === undefined ? 5542 : options.siteId;
  return {
    status: status === "property_not_found" ? 404 : status === "authentication_required" ? 401 : 200,
    body: {
      status,
      environmentKey: body?.environmentKey ?? "stage.example.com",
      siteId: status === "property_not_found" || status === "authentication_required" ? null : siteId,
      baseUrl: status === "property_not_found" || status === "authentication_required" ? null : "https://example.com",
      pageKey,
      pageTypes: status === "managed_candidate" && pageKey
        ? [{ pageType: "detail", pages: [{ pageKey, wordsCount: 100 }] }]
        : [],
      membershipFingerprint: status === "managed_candidate" ? "membership" : null,
      assignmentFingerprint: status === "managed_candidate" ? "assignment" : null,
      conflicts: [],
      upstreamCode: null,
    },
  };
}

describe("rewrite background services", () => {
  it("routes fetch transport requests to configured config and AI endpoints", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "x-test": "yes" },
      });
    }) as typeof fetch;
    try {
      const transport = createFetchJsonTransport(() => ({
        configEndpoint: "https://config.example.com/base",
        aiEndpoint: "https://ai.example.com:8443",
        stageBase: "a.example.com",
        token: "token",
      }));

      await transport({ method: "POST", path: "/save", body: { ok: true } });
      await transport({ method: "POST", path: "/get_selectors", body: { ok: true } });
      await transport({ method: "POST", path: "/graphql", body: { ok: true } });

      expect(calls.map((call) => call.url)).toEqual([
        "https://config.example.com/base/save",
        "https://ai.example.com:8443/get_selectors",
        "https://api.a.example.com/graphql",
      ]);
      expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer token" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("routes accounts paths to the stage-derived accounts host", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
    }) as typeof fetch;
    try {
      const transport = createFetchJsonTransport(() => ({
        configEndpoint: "https://config.example.com/base",
        aiEndpoint: "https://ai.example.com:8443",
        stageBase: "a.example.com",
        token: "token",
      }));

      await transport({ method: "POST", path: "/api/account/login", body: { email: "a@b.c", password: "pw" } });
      await transport({ method: "GET", path: "/api/account/validate" });

      expect(calls.map((call) => call.url)).toEqual([
        "https://accounts.a.example.com/api/account/login",
        "https://accounts.a.example.com/api/account/validate",
      ]);
      // Login must go out unauthenticated; validate is the call that proves the token.
      expect(calls[0].init.headers).not.toHaveProperty("authorization");
      expect(calls[1].init.headers).toMatchObject({ authorization: "Bearer token" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports accounts calls as unconfigured when no stage base is stored", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const transport = createFetchJsonTransport(() => ({ configEndpoint: "https://config.example.com" }));

      await expect(transport({ method: "POST", path: "/api/account/login", body: {} }))
        .resolves.toMatchObject({ status: 503, body: { error: "endpoint_unconfigured" } });
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores the JWT on a successful login and drops it on logout", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    globalThis.fetch = (async () => new Response(JSON.stringify({ token: "jwt-from-backend" }), { status: 200 })) as typeof fetch;
    try {
      const services = createRewriteBackgroundServices();
      await services.repos.settingsStore.save({ stageBase: "a.example.com" });

      await expect(services.accounts.login({ email: "a@b.c", password: "pw" }))
        .resolves.toEqual({ status: "ok", token: "jwt-from-backend" });

      const afterLogin = await services.repos.settingsStore.load();
      expect(afterLogin.ok && afterLogin.value).toMatchObject({
        stageBase: "a.example.com",
        token: "jwt-from-backend",
      });

      await services.accounts.logout();
      const afterLogout = await services.repos.settingsStore.load();
      expect(afterLogout.ok && afterLogout.value).toEqual({ stageBase: "a.example.com" });
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("adopts an x-update-token rotation from any authed response", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      const services = createRewriteBackgroundServices({
        transport: async () => ({
          status: 200,
          body: { data: { urlSearchInfo: { domainId: 42 } } },
          headers: { "x-update-token": "rotated-jwt" },
        }),
      });
      await services.repos.settingsStore.save({ stageBase: "a.example.com", token: "original-jwt" });

      await services.lynx.resolvePropertyContext("a.example.com", "https://example.com/page");

      const stored = await services.settings.load();
      expect(stored).toEqual({ stageBase: "a.example.com", token: "rotated-jwt" });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("leaves the stored token alone when a response repeats or omits the header", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      let headers: Record<string, string> = {};
      const services = createRewriteBackgroundServices({
        transport: async () => ({ status: 200, body: { data: { urlSearchInfo: { domainId: 42 } } }, headers }),
      });
      await services.repos.settingsStore.save({ stageBase: "a.example.com", token: "original-jwt" });

      for (headers of [{}, { "x-update-token": "" }, { "x-update-token": "original-jwt" }]) {
        await services.lynx.resolvePropertyContext("a.example.com", "https://example.com/page");
        await expect(services.settings.load()).resolves.toEqual({
          stageBase: "a.example.com",
          token: "original-jwt",
        });
      }
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("serializes concurrent settings writes so neither loses the other's field", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      const services = createRewriteBackgroundServices({
        transport: async () => ({ status: 200, body: {}, headers: {} }),
      });
      await services.repos.settingsStore.save({ token: "original-jwt" });

      // Issued in the same tick, so without a shared queue both read the same
      // baseline and whichever saves last silently drops the other's field.
      await Promise.all([
        services.settings.update((current) => ({ ...current, aiEndpoint: "https://ai.example.com" })),
        services.settings.update((current) => ({ ...current, configEndpoint: "https://config.example.com" })),
      ]);

      await expect(services.settings.load()).resolves.toEqual({
        token: "original-jwt",
        aiEndpoint: "https://ai.example.com",
        configEndpoint: "https://config.example.com",
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("keeps a rotation and an endpoint save from losing each other", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      const services = createRewriteBackgroundServices({
        transport: async () => ({
          status: 200,
          body: { data: { urlSearchInfo: { domainId: 42 } } },
          headers: { "x-update-token": "rotated-jwt" },
        }),
      });
      await services.repos.settingsStore.save({ stageBase: "a.example.com", token: "original-jwt" });

      await Promise.all([
        services.lynx.resolvePropertyContext("a.example.com", "https://example.com/page"),
        services.settings.update((current) => ({ ...current, aiEndpoint: "https://ai.example.com" })),
      ]);

      await expect(services.settings.load()).resolves.toEqual({
        stageBase: "a.example.com",
        aiEndpoint: "https://ai.example.com",
        token: "rotated-jwt",
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("gives the property-lock socket the rotated token on its next connect", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    const urls: string[] = [];
    try {
      const services = createRewriteBackgroundServices({
        transport: async () => ({
          status: 200,
          body: { data: { urlSearchInfo: { domainId: 42 } } },
          headers: { "x-update-token": "rotated-jwt" },
        }),
        socketFactory(url: string) {
          urls.push(url);
          return fakeSocket().socket;
        },
      });
      await services.repos.settingsStore.save({ configEndpoint: "https://lock.example.com", token: "original-jwt" });

      // The WS is exempt from rotation: it has no response headers and carries
      // its token in the connect query string, so it picks up a rotation only
      // by reading settings again on the next connect.
      await services.createLockClient({ environmentKey: "a.example.com", tabId: 1, siteId: 42 });
      await services.lynx.resolvePropertyContext("a.example.com", "https://example.com/a");
      await services.createLockClient({ environmentKey: "a.example.com", tabId: 2, siteId: 42 });

      expect(urls).toEqual([
        "wss://lock.example.com/property-lock?token=original-jwt",
        "wss://lock.example.com/property-lock?token=rotated-jwt",
      ]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("uses a lock-channel token rotation for reconnecting the same editor session", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const urls: string[] = [];
      const services = createRewriteBackgroundServices({
        socketFactory(url) {
          urls.push(url);
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        networkReachability: async () => true,
        editorSessionIdFactory: () => "editor-reconnect-token",
      });
      await services.repos.settingsStore.save({
        configEndpoint: "https://lock.example.com",
        token: "original-jwt",
      });
      const client = await services.createLockClient({
        environmentKey: "a.example.com",
        tabId: 1,
        siteId: 42,
      });
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({
        type: "subscribed",
        editorSessionId: "editor-reconnect-token",
      }));
      sockets[0].emit("message", JSON.stringify({ type: "token_update", token: "rotated-jwt" }));
      await Promise.resolve();
      sockets[0].emit("close");
      await vi.advanceTimersByTimeAsync(2_000);

      expect(urls).toEqual([
        "wss://lock.example.com/property-lock?token=original-jwt",
        "wss://lock.example.com/property-lock?token=rotated-jwt",
      ]);
      expect(client.editorSession().editorSessionId).toBe("editor-reconnect-token");
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists one environment-scoped editor session per tab instead of persisting backend identity", async () => {
    let nextId = 0;
    const services = createRewriteBackgroundServices({
      socketFactory: () => fakeSocket().socket,
      editorSessionIdFactory: () => `editor-${++nextId}`,
    });

    const first = await services.createLockClient({ environmentKey: "a.example.com", tabId: 1, siteId: 42 });
    const reopenedPanel = await services.createLockClient({ environmentKey: "a.example.com", tabId: 1, siteId: 42 });
    const otherTab = await services.createLockClient({ environmentKey: "a.example.com", tabId: 2, siteId: 42 });
    const otherEnvironment = await services.createLockClient({ environmentKey: "b.example.com", tabId: 1, siteId: 42 });

    expect(first.editorSession().editorSessionId).toBe("editor-1");
    expect(reopenedPanel.editorSession().editorSessionId).toBe("editor-1");
    expect(otherTab.editorSession().editorSessionId).toBe("editor-2");
    expect(otherEnvironment.editorSession().editorSessionId).toBe("editor-3");
    expect(first.editorSession()).not.toHaveProperty("identity");
    expect(first.editorSession()).not.toHaveProperty("lockToken");
  });

  it("leaves the stored token untouched when a login is rejected", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Bad credentials" }), { status: 401 })) as typeof fetch;
    try {
      const services = createRewriteBackgroundServices();
      await services.repos.settingsStore.save({ stageBase: "a.example.com", token: "existing-jwt" });

      await expect(services.accounts.login({ email: "a@b.c", password: "wrong" }))
        .resolves.toMatchObject({ status: "rejected", httpStatus: 401, message: "Bad credentials" });

      const stored = await services.repos.settingsStore.load();
      expect(stored.ok && stored.value).toMatchObject({ token: "existing-jwt" });
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("loads default transport settings before each request", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    const calls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url));
      return new Response(String(init?.body ?? "{}"), { status: 200 });
    }) as typeof fetch;
    try {
      const services = createRewriteBackgroundServices();
      await services.repos.settingsStore.save({ configEndpoint: "https://config.example.com", aiEndpoint: "https://ai.example.com:8443" });

      await services.lynx.saveConfigSnapshot({
        operationId: "save-1",
        environmentKey: "a.example.com",
        siteId: 1,
        editorSessionId: "editor-1",
        lockToken: "lock-1",
        expectedPropertyRevision: 0,
        expectedFeedRevision: 0,
        page: {
          pageKey: "/page",
          pageType: "detail",
          renderedHtml: "<html></html>",
          rows: [],
        },
        renderMode: "rendered",
        selectors: { inclusionSelectors: [], exclusionSelectors: [] },
      });

      expect(calls).toEqual(["https://config.example.com/save"]);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("runs AI jobs through start/status/result before returning selectors", async () => {
    const requests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      requests.push(request);
      if (request.path === "/get_selectors") {
        return { status: 200, body: { session_id: "session-1" } };
      }
      if (request.path === "/get_selectors/status/session-1") {
        return { status: 200, body: { session_id: "session-1", status: "done" } };
      }
      if (request.path === "/get_selectors/result/session-1") {
        return { status: 200, body: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] } };
      }
      return { status: 500, body: null };
    };

    const services = createRewriteBackgroundServices({ transport });
    await expect(services.lynx.runAiJob(snapshot, {
      tabId: 77,
      clientRunId: "popup-run-1",
      editorSessionId: "editor-1",
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
    })).resolves.toEqual({
      status: "ok",
      sessionId: "session-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/get_selectors",
      "/get_selectors/status/session-1",
      "/get_selectors/result/session-1",
    ]);
    await expect(services.repos.runRecordRepo.loadLatestForTab(77)).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        sessionId: "session-1",
        clientRunId: "popup-run-1",
        editorSessionId: "editor-1",
        environmentKey: "stage.example.com",
        siteId: 42,
        pageKey: "/page",
        phase: "fresh",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      }),
    });
    await expect(services.lynx.resumeAiJob({
      tabId: 77,
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
      clientRunId: "popup-run-1",
      editorSessionId: "editor-1",
    })).resolves.toMatchObject({
      status: "fresh",
      sessionId: "session-1",
      clientRunId: "popup-run-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
    await expect(services.lynx.resumeAiJob({
      tabId: 77,
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
      clientRunId: "popup-run-1",
      editorSessionId: "new-editor-session",
    })).resolves.toEqual({ status: "not_found" });
  });

  it("resumes a durable running AI record after a service-worker restart", async () => {
    const store = createMemoryStore();
    const beforeRestart = createRewriteBackgroundServices({ store, transport: async () => ({ status: 500, body: null }) });
    const now = Date.now();
    await beforeRestart.repos.runRecordRepo.save({
      sessionId: "backend-run-restart",
      tabId: 77,
      clientRunId: "popup-generation-1",
      editorSessionId: "editor-session-1",
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
      phase: "running",
      startedAt: now,
      updatedAt: now,
      deadlineAt: now + 10_000,
    }, { makeLatest: true });

    const afterRestart = createRewriteBackgroundServices({
      store,
      transport: async (request) => request.path.includes("/status/")
        ? { status: 200, body: { session_id: "backend-run-restart", status: "done" } }
        : request.path.includes("/result/")
          ? { status: 200, body: { inclusionSelectors: ["article"], exclusionSelectors: ["aside"] } }
          : { status: 500, body: null },
    });
    const exactScope = {
      tabId: 77,
      clientRunId: "popup-generation-1",
      editorSessionId: "editor-session-1",
      environmentKey: "stage.example.com",
      siteId: 42,
      pageKey: "/page",
    };

    await expect(afterRestart.lynx.resumeAiJob(exactScope)).resolves.toMatchObject({ status: "running" });
    for (let tick = 0; tick < 20; tick += 1) {
      const record = await afterRestart.repos.runRecordRepo.loadLatestForTab(77);
      if (record.ok && record.value?.phase === "fresh") break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await expect(afterRestart.lynx.resumeAiJob(exactScope)).resolves.toMatchObject({
      status: "fresh",
      clientRunId: "popup-generation-1",
      selectors: { inclusionSelectors: ["article"], exclusionSelectors: ["aside"] },
    });
  });

  it("exposes Hub publication without exposing direct cssInfo or GraphQL mutation calls", async () => {
    const requests: JsonRequest[] = [];
    const services = createRewriteBackgroundServices({
      transport: async (request) => {
        requests.push(request);
        return { status: 503, body: null };
      },
    });

    await expect(services.lynx.publishConfigSnapshot({
      operationId: "publish-1",
      environmentKey: "stage.example.com",
      siteId: 42,
      editorSessionId: "editor-1",
      lockToken: "lock-1",
      expectedPropertyRevision: 4,
      expectedFeedRevision: 2,
      expectedSelectorsFingerprint: "a".repeat(64),
    })).resolves.toEqual({ status: "publication_unknown", httpStatus: 503 });

    expect(requests).toEqual([expect.objectContaining({ method: "POST", path: "/publish" })]);
    expect(services.lynx).not.toHaveProperty("buildCssInfoRequest");
    expect(services.lynx).not.toHaveProperty("buildUpdateScrapingConditionsRequest");
  });

  it("resolves authoritative property context through Hub", async () => {
    const requests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      requests.push(request);
      return hubContext(request);
    };

    await expect(createRewriteBackgroundServices({ transport }).lynx.resolvePropertyContext(
      "stage.example.com",
      "https://example.com/page",
    )).resolves.toMatchObject({
      status: "managed_candidate",
      siteId: 5542,
      pageKey: "/page",
    });
    expect(requests).toMatchObject([{
      method: "POST",
      path: "/context",
      body: { environmentKey: "stage.example.com", url: "https://example.com/page" },
    }]);
  });

  it("does not call a rejected token an unmanaged property", async () => {
    const services = createRewriteBackgroundServices({
      transport: async (request) => {
        const response = hubContext(request, { status: "authentication_required" });
        return { ...response, status: 500 };
      },
    });
    await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "expired" }));

    await expect(services.lynx.resolvePropertyContext("stage.example.com", "https://managed.example.com/page"))
      .resolves.toMatchObject({ status: "authentication_required", siteId: null });

    const directive = await createPropertyLockRuntime({ services }).directive({
      tabId: 9,
      pageUrl: "https://managed.example.com/page",
      baseUrl: "https://managed.example.com",
    });
    expect(directive).toMatchObject({
      status: "signed_out",
      lockBanner: { reason: "signed-out" },
    });
  });

  it("still reports a genuine miss as not found", async () => {
    const services = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request, { status: "property_not_found" }),
    });

    await expect(services.lynx.resolvePropertyContext("stage.example.com", "https://nope.example.com/a"))
      .resolves.toMatchObject({ status: "property_not_found", siteId: null, pageKey: "/a" });
  });

  it("names why there is no lock instead of blaming the connection", async () => {
    // All of these arrive with no lock state to project, and an operator sent
    // looking for a connection fault on a page that is simply out of scope has
    // been misdirected.
    const notCandidate = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request, { status: "property_not_found" }),
    });
    const managedNonCandidate = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request, { status: "managed_non_candidate", siteId: 5542 }),
    });
    const unavailable = createRewriteBackgroundServices({
      transport: async () => { throw new Error("network down"); },
    });
    const request = { tabId: 7, pageUrl: "https://out-of-scope.example.com/page", baseUrl: "https://out-of-scope.example.com" };
    // Both cases are about what the backend said, so both need to get that far.
    await notCandidate.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));
    await managedNonCandidate.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));
    await unavailable.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));

    const outOfScope = await createPropertyLockRuntime({ services: notCandidate }).directive(request);
    expect(outOfScope).toMatchObject({
      status: "not_candidate",
      siteId: null,
      lockBanner: { visible: true, reason: "not-candidate" },
    });

    const managedRoot = await createPropertyLockRuntime({ services: managedNonCandidate }).directive(request);
    expect(managedRoot).toMatchObject({
      status: "not_candidate",
      environmentKey: "stage.example.com",
      siteId: 5542,
      blockedReason: "managed-non-candidate",
      lockBanner: { visible: true, reason: "managed-non-candidate" },
    });

    const offline = await createPropertyLockRuntime({ services: unavailable }).directive(request);
    expect(offline).toMatchObject({
      status: "unavailable",
      lockBanner: { visible: true, reason: "unavailable" },
    });
  });

  it("says signed out rather than unavailable, and asks the backend nothing", async () => {
    // Resolving a site id needs the same token the lock socket connects with.
    // With none stored the answer is already known, so spending a request per
    // page activation to be refused is waste — and "unavailable" reads as a
    // connection fault, sending the operator after a problem that is not there.
    const requests: JsonRequest[] = [];
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const services = createRewriteBackgroundServices({
      transport: async (request) => {
        requests.push(request);
        return hubContext(request);
      },
      socketFactory() {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws.socket;
      },
    });
    const runtime = createPropertyLockRuntime({ services });
    const request = { tabId: 4, pageUrl: "https://managed.example.com/page", baseUrl: "https://managed.example.com" };
    await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com" }));

    const signedOut = await runtime.directive(request);
    expect(signedOut).toMatchObject({
      status: "signed_out",
      siteId: null,
      lockRole: "unknown",
      lockBanner: { visible: true, reason: "signed-out" },
    });
    // Nothing was asked and no socket was opened with an empty token.
    expect(requests).toEqual([]);
    expect(sockets).toEqual([]);
    // Editing stays blocked, and the content side is told which of the two
    // reasons it is, so the curtain does not blame the lock.
    expect(signedOut).toMatchObject({
      configPresent: false,
      canEdit: false,
      blockedReason: "signed-out",
    });

    // Signing in makes it ask, on the same runtime.
    await services.settings.update((current) => ({ ...current, token: "live" }));
    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "ok", siteId: 5542 });
    expect(requests).toHaveLength(1);
  });

  it("blocks but preserves a held lock client through a recoverable auth failure", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const services = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request),
      socketFactory() {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws.socket;
      },
    });
    const runtime = createPropertyLockRuntime({ services });
    const request = { tabId: 6, pageUrl: "https://managed.example.com/page", baseUrl: "https://managed.example.com" };
    await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));

    await Promise.all([runtime.directive(request), runtime.directive(request)]);
    expect(sockets).toHaveLength(1);
    sockets[0].emit("open");
    const subscribedSessionId = JSON.parse(sockets[0].sent[0] ?? "{}").editorSessionId;
    sockets[0].emit("message", JSON.stringify({
      type: "subscribed",
      identity: "backend-1",
      editorSessionId: subscribedSessionId,
    }));
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("take_lock");

    await services.accounts.logout();
    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "signed_out" });
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).not.toContain("release_lock");
  });

  it("keeps lock.directive idempotent and defers a cross-property release", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const tabMessages: unknown[] = [];
    const contextRequests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      contextRequests.push(request);
      const url = (request.body as { url?: string } | undefined)?.url ?? "";
      return hubContext(request, { siteId: url.includes("other.example") ? 777 : 5542 });
    };
    const services = createRewriteBackgroundServices({
      transport,
      socketFactory() {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws.socket;
      },
    });
    const runtime = createPropertyLockRuntime({
      services,
      tabs: {
        sendMessage(_tabId, message) {
          tabMessages.push(message);
          return undefined;
        },
      },
    });
    runtime.presenceChanged(5, {
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });
    const request = { tabId: 5, pageUrl: "https://example.com/page", baseUrl: "https://example.com", hasUnsavedChanges: false };
    await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));

    await runtime.directive(request);
    sockets[0].emit("open");
    sockets[0].emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    await runtime.directive(request);

    const sentTypes = sockets[0].sent.map((frame) => JSON.parse(frame).type);
    expect(sentTypes.filter((type) => type === "take_lock")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "client_status")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "heartbeat")).toHaveLength(1);
    expect(contextRequests).toHaveLength(1);

    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: false, editorName: "Other" }));
    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: true, editorName: "Me" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(tabMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "lock.state.changed",
          payload: expect.objectContaining({
            environmentKey: "stage.example.com",
            siteId: 5542,
            canEdit: true,
            lockRole: "editor",
          }),
        }),
      }),
    ]));

    const beforeReplay = tabMessages.length;
    runtime.republish(5, "https://example.com");
    await Promise.resolve();
    expect(tabMessages).toHaveLength(beforeReplay + 1);
    runtime.republish(5, "https://different.example");
    await Promise.resolve();
    expect(tabMessages).toHaveLength(beforeReplay + 1);

    await runtime.directive({ ...request, pageUrl: "https://example.com/next", hasUnsavedChanges: true });
    const statusFrame = sockets[0].sent.map((frame) => JSON.parse(frame)).findLast((frame) => frame.type === "client_status");
    expect(statusFrame).toMatchObject({
      environmentKey: "stage.example.com",
      siteId: 5542,
      hasUnsavedWork: true,
    });
    expect(statusFrame).not.toHaveProperty("pageUrl");
    expect(statusFrame).not.toHaveProperty("clientId");

    const crossProperty = await runtime.directive({
      ...request,
      pageUrl: "https://other.example/page",
      baseUrl: "https://other.example",
    });
    expect(sockets).toHaveLength(1);
    expect(crossProperty).toMatchObject({
      canEdit: false,
      blockedReason: "cross-property",
      lockBanner: { countdownSeconds: 30 },
    });
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).not.toContain("release_lock");
    await runtime.terminateTab(5);
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
  });

  it("does not publish a deferred lock observation after its tab is terminated", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const tabMessages: unknown[] = [];
    let releaseObservation: (() => void) | null = null;
    let markObservationStarted: (() => void) | null = null;
    const observationStarted = new Promise<void>((resolve) => {
      markObservationStarted = resolve;
    });
    const observationRelease = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    let deferObservation = false;
    const services = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request),
      socketFactory() {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket.socket;
      },
    });
    await services.settings.update((current) => ({
      ...current,
      stageBase: "stage.example.com",
      token: "live",
    }));
    const runtime = createPropertyLockRuntime({
      services,
      tabs: {
        sendMessage(_tabId, message) {
          tabMessages.push(message);
          return undefined;
        },
      },
      observeLockFacts() {
        if (!deferObservation) {
          return;
        }
        markObservationStarted?.();
        return observationRelease;
      },
    });
    runtime.presenceChanged(5, {
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });
    await runtime.directive({
      tabId: 5,
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com",
      hasUnsavedChanges: false,
    });
    sockets[0].emit("open");
    const sessionId = JSON.parse(sockets[0].sent[0] ?? "{}").editorSessionId;
    sockets[0].emit("message", JSON.stringify({
      type: "subscribed",
      identity: "backend-1",
      editorSessionId: sessionId,
    }));
    await Promise.resolve();
    const before = tabMessages.length;

    deferObservation = true;
    sockets[0].emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: true,
      editorSessionId: sessionId,
      lockToken: "fence-current",
      propertyRevision: 1,
      feedRevision: 1,
    }));
    await observationStarted;
    await runtime.terminateTab(5);
    releaseObservation?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(tabMessages).toHaveLength(before);
  });

  it("suppresses an old observation and publishes the current warning after navigation", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const tabMessages: unknown[] = [];
    let releaseObservations: (() => void) | null = null;
    let markOldObservationStarted: (() => void) | null = null;
    const oldObservationStarted = new Promise<void>((resolve) => {
      markOldObservationStarted = resolve;
    });
    const observationsRelease = new Promise<void>((resolve) => {
      releaseObservations = resolve;
    });
    let deferObservation = false;
    let deferredObservations = 0;
    const services = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request),
      socketFactory() {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket.socket;
      },
    });
    await services.settings.update((current) => ({
      ...current,
      stageBase: "stage.example.com",
      token: "live",
    }));
    const runtime = createPropertyLockRuntime({
      services,
      tabs: {
        sendMessage(_tabId, message) {
          tabMessages.push(message);
          return undefined;
        },
      },
      observeLockFacts() {
        if (!deferObservation) {
          return;
        }
        deferredObservations += 1;
        if (deferredObservations === 1) {
          markOldObservationStarted?.();
        }
        return observationsRelease;
      },
    });
    runtime.presenceChanged(5, {
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });
    await runtime.directive({
      tabId: 5,
      pageUrl: "https://example.com/page-a",
      baseUrl: "https://example.com",
      hasUnsavedChanges: false,
    });
    sockets[0].emit("open");
    const sessionId = JSON.parse(sockets[0].sent[0] ?? "{}").editorSessionId;
    sockets[0].emit("message", JSON.stringify({
      type: "subscribed",
      identity: "backend-1",
      editorSessionId: sessionId,
    }));
    await Promise.resolve();
    const before = tabMessages.length;

    deferObservation = true;
    sockets[0].emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: true,
      editorSessionId: sessionId,
      lockToken: "fence-old",
      propertyRevision: 1,
      feedRevision: 1,
    }));
    await oldObservationStarted;
    runtime.navigationCommitted(5);
    releaseObservations?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(deferredObservations).toBe(1);
    expect(tabMessages).toHaveLength(before);

    deferObservation = false;
    await runtime.directive({
      tabId: 5,
      pageUrl: "https://example.com/page-b",
      baseUrl: "https://example.com",
      hasUnsavedChanges: false,
    });
    await Promise.resolve();

    expect(tabMessages.slice(before)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "lock.state.changed",
          payload: expect.objectContaining({
            canEdit: true,
            blockedReason: "editor",
          }),
        }),
      }),
    ]);
    await runtime.terminateTab(5);
  });

  it("keeps the editor lease alive from background after the panel stops issuing directives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const services = createRewriteBackgroundServices({
        transport: async (request) => hubContext(request),
        socketFactory() {
          const ws = fakeSocket();
          sockets.push(ws);
          return ws.socket;
        },
        editorSessionIdFactory: () => "editor-background-1",
      });
      await services.settings.update((current) => ({
        ...current,
        stageBase: "stage.example.com",
        token: "live",
      }));
      const runtime = createPropertyLockRuntime({ services });
      runtime.presenceChanged(5, {
        visible: true,
        focusedWindow: true,
        browserIdle: false,
      });
      const request = {
        tabId: 5,
        pageUrl: "https://example.com/page",
        baseUrl: "https://example.com",
      };

      await runtime.directive(request);
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({
        type: "subscribed",
        identity: "backend-account",
        editorSessionId: "editor-background-1",
        propertyRevision: 4,
        feedRevision: 2,
      }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorName: "Me",
        editorSessionId: "editor-background-1",
        lockToken: "fence-current",
        propertyRevision: 4,
        feedRevision: 2,
      }));
      // The durable brain reports this independently of any popup directive.
      runtime.unsavedChanged(5, true);
      expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
        type: "client_status",
        hasUnsavedWork: true,
      });
      const heartbeatCount = () => sockets[0].sent
        .map((frame) => JSON.parse(frame))
        .filter((frame) => frame.type === "heartbeat").length;
      const beforePanelClose = heartbeatCount();

      // No further lock.directive call represents the side panel going away.
      vi.advanceTimersByTime(30_001);
      runtime.heartbeat();

      expect(heartbeatCount()).toBe(beforePanelClose + 1);
      expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
        type: "heartbeat",
        environmentKey: "stage.example.com",
        siteId: 5542,
        editorSessionId: "editor-background-1",
        lockToken: "fence-current",
        hasUnsavedWork: true,
      });

      const envelope = {
        operationId: "save-1",
        environmentKey: "stage.example.com",
        siteId: 5542,
        editorSessionId: "editor-background-1",
        lockToken: "fence-current",
        expectedPropertyRevision: 4,
        expectedFeedRevision: 2,
      };
      expect(runtime.authorizeMutation(envelope)).toEqual({ ok: true, request: envelope });
      expect(runtime.authorizeMutation({ ...envelope, lockToken: "fence-stale" })).toMatchObject({
        ok: false,
        status: "stale_fence",
        propertyRevision: 4,
        feedRevision: 2,
      });

      const beforeHidden = heartbeatCount();
      runtime.presenceChanged(5, {
        visible: false,
        focusedWindow: true,
        browserIdle: false,
        suspensionReason: "tab-hidden",
      });
      const hiddenStatus = sockets[0].sent
        .map((frame) => JSON.parse(frame))
        .findLast((frame) => frame.type === "client_status");
      expect(hiddenStatus).toMatchObject({
        visible: false,
        focusedWindow: true,
        browserIdle: false,
        suspensionReason: "tab-hidden",
      });
      vi.advanceTimersByTime(30_001);
      runtime.heartbeat();
      expect(heartbeatCount()).toBe(beforeHidden);

      await runtime.terminateTab(5);
      expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
      await expect(services.repos.editorSessionRepo.load("stage.example.com", 5, 5542))
        .resolves.toEqual({ ok: true, value: null });
      expect(runtime.authorizeMutation(envelope)).toMatchObject({ ok: false, status: "stale_fence" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls a suspended candidate in background and resumes the same draft on recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    try {
      let contextRequests = 0;
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const services = createRewriteBackgroundServices({
        transport: async (request) => {
          contextRequests += 1;
          return hubContext(request, {
            status: contextRequests === 2 ? "managed_non_candidate" : "managed_candidate",
          });
        },
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        editorSessionIdFactory: () => "editor-recovery",
      });
      await services.settings.update((current) => ({
        ...current,
        stageBase: "stage.example.com",
        token: "live",
      }));
      const runtime = createPropertyLockRuntime({ services });
      const presence = { visible: true, focusedWindow: true, browserIdle: false };
      runtime.presenceChanged(14, presence);
      const request = {
        tabId: 14,
        pageUrl: "https://example.com/page",
        hasUnsavedChanges: true,
      };
      await runtime.directive(request);
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-recovery" }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-recovery",
        lockToken: "fence-recovery",
        ownershipGeneration: 1,
        propertyRevision: 1,
        feedRevision: 1,
      }));

      await expect(runtime.directive({ ...request, refreshContext: true })).resolves.toMatchObject({
        blockedReason: "candidate-removed",
        canEdit: false,
        lockRole: "editor",
        configPresent: true,
      });
      const mutation = {
        operationId: "save-after-recovery",
        environmentKey: "stage.example.com",
        siteId: 5542,
        editorSessionId: "editor-recovery",
        lockToken: "fence-recovery",
        expectedPropertyRevision: 1,
        expectedFeedRevision: 1,
      };
      expect(runtime.authorizeMutation(mutation)).toMatchObject({ ok: false, status: "stale_fence" });
      expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
        type: "client_status",
        suspensionReason: "candidate_removed",
        hasUnsavedWork: true,
      });
      await vi.advanceTimersByTimeAsync(PROPERTY_CONTEXT_RECOVERY_POLL_MS - 1);
      expect(contextRequests).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(contextRequests).toBe(3);

      const statusFrames = sockets[0].sent
        .map((frame) => JSON.parse(frame))
        .filter((frame) => frame.type === "client_status");
      expect(statusFrames.at(-1)).not.toHaveProperty("suspensionReason");
      expect(statusFrames.at(-1)).toMatchObject({ hasUnsavedWork: true });
      expect(runtime.authorizeMutation(mutation)).toEqual({ ok: true, request: mutation });
      await vi.advanceTimersByTimeAsync(PROPERTY_CONTEXT_RECOVERY_POLL_MS * 2);
      expect(contextRequests).toBe(3);
      await runtime.terminateTab(14);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops suspended recovery after grace and checks immediately on refocus", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    try {
      let contextRequests = 0;
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const services = createRewriteBackgroundServices({
        transport: async (request) => {
          contextRequests += 1;
          return hubContext(request, {
            status: contextRequests === 1 ? "managed_candidate" : "managed_non_candidate",
          });
        },
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        editorSessionIdFactory: () => "editor-grace",
      });
      await services.settings.update((current) => ({
        ...current,
        stageBase: "stage.example.com",
        token: "live",
      }));
      const runtime = createPropertyLockRuntime({ services });
      const request = { tabId: 15, pageUrl: "https://example.com/page", hasUnsavedChanges: true };
      runtime.presenceChanged(15, { visible: true, focusedWindow: true, browserIdle: false });
      await runtime.directive(request);
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-grace" }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-grace",
        lockToken: "fence-grace",
        ownershipGeneration: 1,
      }));
      await runtime.directive({ ...request, refreshContext: true });
      runtime.presenceChanged(15, {
        visible: false,
        focusedWindow: true,
        browserIdle: false,
        suspensionReason: "tab-hidden",
      });
      expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
        type: "client_status",
        visible: false,
        suspensionReason: "candidate_removed",
      });

      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS);
      const requestsAtGrace = contextRequests;
      await vi.advanceTimersByTimeAsync(PROPERTY_CONTEXT_RECOVERY_POLL_MS * 2);
      expect(contextRequests).toBe(requestsAtGrace);

      runtime.presenceChanged(15, { visible: true, focusedWindow: true, browserIdle: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(contextRequests).toBe(requestsAtGrace + 1);
      await runtime.terminateTab(15);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an editor after the off-candidate deadline", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const services = createRewriteBackgroundServices({
        transport: async (request) => hubContext(request, {
          status: String((request.body as { url?: string } | undefined)?.url).includes("off-candidate")
            ? "managed_non_candidate"
            : "managed_candidate",
        }),
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        editorSessionIdFactory: () => "editor-off-candidate",
      });
      await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));
      const runtime = createPropertyLockRuntime({ services });
      runtime.presenceChanged(16, { visible: true, focusedWindow: true, browserIdle: false });
      await runtime.directive({ tabId: 16, pageUrl: "https://example.com/page" });
      sockets[0].emit("open");
      sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-off-candidate" }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: "editor-off-candidate",
        lockToken: "fence-off-candidate",
      }));

      runtime.navigationCommitted(16);
      expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).not.toContain("release_lock");
      const warning = await runtime.directive({
        tabId: 16,
        pageUrl: "https://example.com/off-candidate",
      });
      expect(warning).toMatchObject({
        blockedReason: "off-candidate",
        canEdit: false,
        lockBanner: { countdownSeconds: 70 },
      });
      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS);
      expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the prior property through the cross-property cooldown", async () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const services = createRewriteBackgroundServices({
        transport: async (request) => hubContext(request, {
          siteId: String((request.body as { url?: string } | undefined)?.url).includes("other.example") ? 777 : 5542,
        }),
        socketFactory() {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket.socket;
        },
        editorSessionIdFactory: () => `editor-cross-${sockets.length + 1}`,
      });
      await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));
      const runtime = createPropertyLockRuntime({ services });
      runtime.presenceChanged(17, { visible: true, focusedWindow: true, browserIdle: false });
      await runtime.directive({ tabId: 17, pageUrl: "https://example.com/page" });
      sockets[0].emit("open");
      const sessionId = JSON.parse(sockets[0].sent[0] ?? "{}").editorSessionId;
      sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: sessionId }));
      sockets[0].emit("message", JSON.stringify({
        type: "lock_state",
        state: "locked",
        isEditor: true,
        editorSessionId: sessionId,
        lockToken: "fence-cross",
      }));

      const warning = await runtime.directive({ tabId: 17, pageUrl: "https://other.example/page" });
      expect(warning).toMatchObject({
        blockedReason: "cross-property",
        lockBanner: { countdownSeconds: 30 },
      });
      expect(sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS);
      expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
      expect(sockets).toHaveLength(2);
      await runtime.terminateTab(17);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards draft status only when an authoritative foreign fence takes ownership", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const transfers: unknown[] = [];
    const services = createRewriteBackgroundServices({
      transport: async (request) => hubContext(request),
      socketFactory() {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket.socket;
      },
      editorSessionIdFactory: () => "editor-draft-1",
    });
    await services.settings.update((current) => ({
      ...current,
      stageBase: "stage.example.com",
      token: "live",
    }));
    const runtime = createPropertyLockRuntime({
      services,
      onAuthoritativeTransfer(event) { transfers.push(event); },
    });
    const presence = { visible: true, focusedWindow: true, browserIdle: false };
    runtime.presenceChanged(9, presence);
    await runtime.directive({
      tabId: 9,
      pageUrl: "https://example.com/page",
      hasUnsavedChanges: true,
    });
    sockets[0].emit("open");
    sockets[0].emit("message", JSON.stringify({ type: "subscribed", editorSessionId: "editor-draft-1" }));
    sockets[0].emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: true,
      editorSessionId: "editor-draft-1",
      lockToken: "fence-one",
      ownershipGeneration: 1,
      propertyRevision: 4,
      feedRevision: 2,
    }));

    runtime.presenceChanged(9, presence);
    expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
      type: "client_status",
      hasUnsavedWork: true,
    });
    sockets[0].emit("message", JSON.stringify({
      type: "takeover_suggestion",
      suggestionId: "suggestion-transfer-1",
      fromName: "Other",
    }));
    expect(runtime.action({
      tabId: 9,
      kind: "accept-takeover",
      suggestionId: "suggestion-transfer-1",
      confirmDiscard: true,
    })).toEqual({ status: "ok" });
    const accepted = sockets[0].sent
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.type === "respond_to_suggestion");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      suggestionId: "suggestion-transfer-1",
      accept: true,
      discardUnsaved: true,
      lockToken: "fence-one",
      expectedPropertyRevision: 4,
      expectedFeedRevision: 2,
    });
    expect(accepted[0].operationId).toEqual(expect.any(String));
    sockets[0].emit("message", JSON.stringify({
      type: "lock_state",
      state: "locked",
      isEditor: false,
      editorName: "Other",
      editorSessionId: "editor-other",
      ownershipGeneration: 2,
    }));
    runtime.presenceChanged(9, presence);

    expect(transfers).toEqual([{ tabId: 9, environmentKey: "stage.example.com", siteId: 5542 }]);
    expect(JSON.parse(sockets[0].sent.at(-1) ?? "{}")).toMatchObject({
      type: "client_status",
      hasUnsavedWork: false,
    });
    await expect(runtime.directive({ tabId: 9, pageUrl: "https://example.com/page" })).resolves.toMatchObject({
      lockRole: "passive",
      canEdit: false,
    });
  });

  it("does not resurrect an editor session when navigation wins a context-resolution race", async () => {
    let contextRequest: JsonRequest | null = null;
    let resolveContext: ((response: JsonResponse) => void) | null = null;
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const services = createRewriteBackgroundServices({
      transport: async (request) => {
        if (contextRequest) {
          return hubContext(request);
        }
        return await new Promise<JsonResponse>((resolve) => {
          contextRequest = request;
          resolveContext = resolve;
        });
      },
      socketFactory() {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws.socket;
      },
      editorSessionIdFactory: () => "superseded-editor",
    });
    await services.settings.update((current) => ({
      ...current,
      stageBase: "stage.example.com",
      token: "live",
    }));
    const runtime = createPropertyLockRuntime({ services });
    runtime.presenceChanged(9, {
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });

    const pending = runtime.directive({
      tabId: 9,
      pageUrl: "https://example.com/old",
      baseUrl: "https://example.com",
    });
    await vi.waitFor(() => expect(contextRequest).not.toBeNull());
    await runtime.terminateTab(9, { forgetPresence: false });
    resolveContext?.(hubContext(contextRequest as JsonRequest));

    await expect(pending).rejects.toThrow("superseded by tab navigation");
    expect(sockets).toEqual([]);
    await expect(services.repos.editorSessionRepo.load("stage.example.com", 9, 5542))
      .resolves.toEqual({ ok: true, value: null });

    await runtime.directive({
      tabId: 9,
      pageUrl: "https://example.com/new",
      baseUrl: "https://example.com",
    });
    expect(sockets).toHaveLength(1);
    sockets[0].emit("open");
    expect(JSON.parse(sockets[0].sent[0] ?? "{}")).toMatchObject({
      type: "subscribe",
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });
  });

  it("does not permanently cache transient context failures", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const requests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      requests.push(request);
      return requests.length === 1
        ? { status: 503, body: null }
        : hubContext(request);
    };
    const services = createRewriteBackgroundServices({
      transport,
      socketFactory() {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws.socket;
      },
    });
    const runtime = createPropertyLockRuntime({ services });
    const request = { tabId: 5, pageUrl: "https://example.com/page", baseUrl: "https://example.com", hasUnsavedChanges: false };
    await services.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));

    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "unavailable" });
    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "ok", siteId: 5542 });
    expect(requests).toHaveLength(2);
    expect(sockets).toHaveLength(1);
  });

  it("normalizes context transport exceptions to upstream_unavailable", async () => {
    const services = createRewriteBackgroundServices({
      async transport() {
        throw new Error("network down");
      },
    });

    await expect(services.lynx.resolvePropertyContext("stage.example.com", "https://example.com/page")).resolves.toMatchObject({
      status: "upstream_unavailable",
      siteId: null,
    });
  });
});
