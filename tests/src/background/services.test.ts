import { describe, expect, it } from "vitest";

import { createFetchJsonTransport, createRewriteBackgroundServices } from "../../../src/background/services";
import type { JsonRequest, JsonResponse } from "../../../src/lynx";

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
        token: "token",
      }));

      await transport({ method: "POST", path: "/save", body: { ok: true } });
      await transport({ method: "POST", path: "/get_selectors", body: { ok: true } });

      expect(calls.map((call) => call.url)).toEqual([
        "https://config.example.com/base/save",
        "https://ai.example.com:8443/get_selectors",
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
});
