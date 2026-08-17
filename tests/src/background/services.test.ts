import { describe, expect, it } from "vitest";

import { createFetchJsonTransport, createRewriteBackgroundServices } from "../../../src/background/services";
import { createPropertyLockRuntime } from "../../../src/background/lock-runtime";
import type { JsonRequest, JsonResponse } from "../../../src/lynx";

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
      await services.createLockClient({ tabId: 1, siteId: 42, pageUrl: "https://example.com/a" });
      await services.lynx.resolvePropertyContext("a.example.com", "https://example.com/a");
      await services.createLockClient({ tabId: 2, siteId: 42, pageUrl: "https://example.com/b" });

      expect(urls).toEqual([
        "wss://lock.example.com/property-lock?token=original-jwt",
        "wss://lock.example.com/property-lock?token=rotated-jwt",
      ]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
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
    })).resolves.toMatchObject({
      status: "fresh",
      sessionId: "session-1",
      clientRunId: "popup-run-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
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
    const unavailable = createRewriteBackgroundServices({
      transport: async () => { throw new Error("network down"); },
    });
    const request = { tabId: 7, pageUrl: "https://out-of-scope.example.com/page", baseUrl: "https://out-of-scope.example.com" };
    // Both cases are about what the backend said, so both need to get that far.
    await notCandidate.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));
    await unavailable.settings.update((current) => ({ ...current, stageBase: "stage.example.com", token: "live" }));

    const outOfScope = await createPropertyLockRuntime({ services: notCandidate }).directive(request);
    expect(outOfScope).toMatchObject({
      status: "not_candidate",
      siteId: null,
      lockBanner: { visible: true, reason: "not-candidate" },
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

    await runtime.directive(request);
    sockets[0].emit("open");
    sockets[0].emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("take_lock");

    await services.accounts.logout();
    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "signed_out" });
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).not.toContain("release_lock");
  });

  it("keeps lock.directive idempotent and recreates clients after socket close", async () => {
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
    expect(tabMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "lock.state.changed",
          payload: expect.objectContaining({
            canEdit: false,
          }),
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "lock.state.changed",
          payload: expect.objectContaining({
            canEdit: true,
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
    expect(statusFrame).toMatchObject({ pageUrl: "https://example.com/next", hasUnsavedChanges: true });

    await runtime.directive({ ...request, pageUrl: "https://other.example/page", baseUrl: "https://other.example" });
    expect(sockets).toHaveLength(2);
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
    const tabMessageCount = tabMessages.length;
    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: true, editorName: "Old" }));
    expect(tabMessages).toHaveLength(tabMessageCount);

    sockets[0].emit("close");
    await runtime.directive(request);
    expect(sockets).toHaveLength(3);
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
