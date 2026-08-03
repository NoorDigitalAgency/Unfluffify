import { describe, expect, it } from "vitest";

import {
  getAiRunResult,
  getAiRunStatus,
  parseAiRunStatusResponse,
  parseAiRunStartResponse,
  startAiRun,
} from "../../../src/lynx/ai";
import {
  buildCssInfoRequest,
  buildPropertyPageTypesRequest,
  buildUpdateScrapingConditionsRequest,
  buildUrlSearchInfoRequest,
  parseUrlSearchInfo,
  readGraphqlErrorCode,
  toDomainRenderMode,
  URL_SEARCH_INFO_QUERY,
} from "../../../src/lynx/graphql";
import type { JsonTransport } from "../../../src/lynx/transport";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../../src/domain/constants";
import { okJson, type JsonRequest } from "../../../src/lynx/transport";

describe("P4 locked AI and GraphQL shapes", () => {
  it("uses the current strict AI start/status/result response shapes", async () => {
    expect(parseAiRunStartResponse({ session_id: "abc" })).toBe("abc");
    expect(parseAiRunStartResponse({ sessionId: "abc" })).toBe("");
    expect(parseAiRunStatusResponse({ session_id: " abc ", status: "DONE" })).toEqual({
      sessionId: "abc",
      status: "done",
    });

    const calls: JsonRequest[] = [];
    const transport = async (request: JsonRequest) => {
      calls.push(request);
      if (request.path === "/get_selectors") {
        return okJson({ session_id: "abc" });
      }
      if (request.path.includes("/status/")) {
        return okJson({ session_id: "abc", status: "running" });
      }
      return okJson({ exclusionSelectors: [".ad"], inclusionSelectors: ["main"] });
    };

    await expect(startAiRun(transport, {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
      pages: [{ url: "https://example.com/a", renderedHtml: "<html></html>", renderedXPaths: [] }],
    })).resolves.toEqual({ status: "ok", sessionId: "abc" });
    await expect(getAiRunStatus(transport, "abc")).resolves.toEqual({ status: "ok", sessionId: "abc", runStatus: "running" });
    await expect(getAiRunResult(transport, "abc")).resolves.toEqual({
      status: "ok",
      selectors: { exclusionSelectors: [".ad"], inclusionSelectors: ["main"] },
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/get_selectors",
      "/get_selectors/status/abc",
      "/get_selectors/result/abc",
    ]);
  });

  it("returns AI status discriminants", async () => {
    await expect(startAiRun(async () => okJson({}, 401), {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
      pages: [{ url: "https://example.com/a", renderedHtml: "<html></html>", renderedXPaths: [] }],
    })).resolves.toEqual({ status: "auth_error", httpStatus: 401 });
    await expect(getAiRunStatus(async () => okJson({}, 404), "abc")).resolves.toEqual({ status: "not_found", httpStatus: 404 });
    await expect(getAiRunResult(async () => okJson({}, 404), "abc")).resolves.toEqual({ status: "not_found", httpStatus: 404 });
  });

  it("builds locked GraphQL requests without deriving baseUrl from urlSearchInfo", () => {
    expect(buildUrlSearchInfoRequest("https://example.com/a")).toEqual({
      query: URL_SEARCH_INFO_QUERY,
      variables: { url: "https://example.com/a", includePageInfo: false },
    });
    expect(parseUrlSearchInfo({ data: { urlSearchInfo: { domainId: 123, domainName: "example.com" } } }))
      .toEqual({ siteId: 123, notFound: false });
    expect(parseUrlSearchInfo({ errors: [{ extensions: { code: "NotFound" } }] }))
      .toEqual({ siteId: null, notFound: true });
    // Read alongside the locked parse, so a non-NotFound error is separable from
    // a genuine miss rather than collapsing into "no site id".
    expect(readGraphqlErrorCode({ errors: [{ extensions: { code: "UNAUTHENTICATED" } }] })).toBe("UNAUTHENTICATED");
    expect(readGraphqlErrorCode({ errors: [{ message: "Token expired" }] })).toBe("Token expired");
    expect(readGraphqlErrorCode({ errors: [{}] })).toBe("graphql_error");
    expect(readGraphqlErrorCode({ data: { urlSearchInfo: null } })).toBe("");
    expect(readGraphqlErrorCode({ errors: [] })).toBe("");
    expect(readGraphqlErrorCode(null)).toBe("");
    expect(buildPropertyPageTypesRequest(123).variables).toEqual({ domainId: 123 });
    expect(buildCssInfoRequest("https://example.com/a").variables).toEqual({ url: "https://example.com/a" });
    expect(toDomainRenderMode("static")).toBe("STATIC");
    expect(toDomainRenderMode("rendered")).toBe("RENDERED");
    expect(buildUpdateScrapingConditionsRequest({
      domainId: 123,
      includeCss: "main",
      excludeCss: ".ad",
      renderMode: "other",
    }).variables.renderingMode).toBeNull();
  });

  it("accepts HTTP 202 AI run starts from the live selector endpoint", async () => {
    const transport: JsonTransport = async () => ({ status: 202, body: { session_id: "session-202" } });

    await expect(startAiRun(transport, {
      baseUrl: "https://example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"],
      pages: [{
        url: "https://example.com",
        renderedHtml: "<html></html>",
        renderedXPaths: [],
      }],
    })).resolves.toEqual({ status: "ok", sessionId: "session-202" });
  });
});
