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
        version: 1,
        baseUrl: "https://example.com",
        siteId: 1,
        renderMode: "rendered",
        renderModeUpdatedAt: "now",
        selectors: { inclusionSelectors: [], exclusionSelectors: [] },
        selectorsUpdatedAt: "now",
        submittedSelectorsFingerprint: "",
        pageMarkings: {},
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

    await expect(createRewriteBackgroundServices({ transport }).lynx.runAiJob(snapshot)).resolves.toEqual({
      status: "ok",
      sessionId: "session-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/get_selectors",
      "/get_selectors/status/session-1",
      "/get_selectors/result/session-1",
    ]);
  });

  it("resolves backend siteId through urlSearchInfo GraphQL", async () => {
    const requests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      requests.push(request);
      return { status: 200, body: { data: { urlSearchInfo: { domainId: 5542 } } } };
    };

    await expect(createRewriteBackgroundServices({ transport }).lynx.getSiteIdForUrl("https://example.com/page")).resolves.toEqual({
      status: "ok",
      siteId: 5542,
    });
    expect(requests).toMatchObject([{
      method: "POST",
      path: "/graphql",
      body: { variables: { url: "https://example.com/page", includePageInfo: false } },
    }]);
  });

  it("keeps lock.directive idempotent and recreates clients after socket close", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const tabMessages: unknown[] = [];
    const graphQlRequests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      graphQlRequests.push(request);
      return { status: 200, body: { data: { urlSearchInfo: { domainId: 5542 } } } };
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

    await runtime.directive(request);
    sockets[0].emit("open");
    sockets[0].emit("message", JSON.stringify({ type: "subscribed", identity: "backend-1" }));
    await runtime.directive(request);

    const sentTypes = sockets[0].sent.map((frame) => JSON.parse(frame).type);
    expect(sentTypes.filter((type) => type === "take_lock")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "client_status")).toHaveLength(1);
    expect(sentTypes.filter((type) => type === "heartbeat")).toHaveLength(1);
    expect(graphQlRequests).toHaveLength(1);

    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: false, editorName: "Other" }));
    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: true, editorName: "Me" }));
    expect(tabMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "directive.content",
          payload: expect.objectContaining({
            content: expect.objectContaining({ markingEditsBlocked: true }),
          }),
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          name: "directive.content",
          payload: expect.objectContaining({
            content: expect.objectContaining({ markingEditsBlocked: false }),
          }),
        }),
      }),
    ]));

    await runtime.directive({ ...request, pageUrl: "https://example.com/next", hasUnsavedChanges: true });
    const statusFrame = sockets[0].sent.map((frame) => JSON.parse(frame)).findLast((frame) => frame.type === "client_status");
    expect(statusFrame).toMatchObject({ pageUrl: "https://example.com/next", hasUnsavedChanges: true });

    const tabMessageCount = tabMessages.length;
    await runtime.directive({ ...request, siteId: 777, pageUrl: "https://other.example/page", baseUrl: "https://other.example" });
    expect(sockets).toHaveLength(2);
    expect(sockets[0].sent.map((frame) => JSON.parse(frame).type)).toContain("release_lock");
    sockets[0].emit("message", JSON.stringify({ type: "lock_state", state: "locked", isEditor: true, editorName: "Old" }));
    expect(tabMessages).toHaveLength(tabMessageCount);

    sockets[0].emit("close");
    await runtime.directive(request);
    expect(sockets).toHaveLength(3);
  });

  it("does not permanently cache transient site lookup failures", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const requests: JsonRequest[] = [];
    const transport = async (request: JsonRequest): Promise<JsonResponse> => {
      requests.push(request);
      return requests.length === 1
        ? { status: 503, body: null }
        : { status: 200, body: { data: { urlSearchInfo: { domainId: 5542 } } } };
    };
    const runtime = createPropertyLockRuntime({
      services: createRewriteBackgroundServices({
        transport,
        socketFactory() {
          const ws = fakeSocket();
          sockets.push(ws);
          return ws.socket;
        },
      }),
    });
    const request = { tabId: 5, pageUrl: "https://example.com/page", baseUrl: "https://example.com", hasUnsavedChanges: false };

    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "unavailable" });
    await expect(runtime.directive(request)).resolves.toMatchObject({ status: "ok", siteId: 5542 });
    expect(requests).toHaveLength(2);
    expect(sockets).toHaveLength(1);
  });

  it("normalizes site lookup transport exceptions to network_error", async () => {
    const services = createRewriteBackgroundServices({
      async transport() {
        throw new Error("network down");
      },
    });

    await expect(services.lynx.getSiteIdForUrl("https://example.com/page")).resolves.toEqual({
      status: "network_error",
      siteId: null,
    });
  });
});
