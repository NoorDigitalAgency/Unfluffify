import { describe, expect, it, vi } from "vitest";

import {
  fetchStaticPageHtml,
  STATIC_HTML_FETCH_TIMEOUT_MS,
} from "../../../src/background/static-html";

describe("F1 background static HTML fetch", () => {
  it("rejects invalid and unsupported targets without network access", async () => {
    const fetch = vi.fn();

    await expect(fetchStaticPageHtml("not a url", { fetch })).resolves.toEqual({
      ok: false,
      error: "Invalid URL",
    });
    await expect(fetchStaticPageHtml("file:///tmp/page.html", { fetch })).resolves.toEqual({
      ok: false,
      error: "Unsupported URL",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches uncached credentialed source HTML with a bounded request", async () => {
    const fetch = vi.fn(async () => new Response("<html>server source</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    await expect(fetchStaticPageHtml(" https://example.com/page ", { fetch })).resolves.toEqual({
      ok: true,
      status: 200,
      url: "https://example.com/page",
      html: "<html>server source</html>",
    });
    expect(fetch).toHaveBeenCalledWith("https://example.com/page", expect.objectContaining({
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }));
    expect(STATIC_HTML_FETCH_TIMEOUT_MS).toBe(30_000);
  });

  it("reports HTTP and transport failures without leaking response bodies", async () => {
    await expect(fetchStaticPageHtml("https://example.com/missing", {
      fetch: vi.fn(async () => new Response("secret body", { status: 404 })),
    })).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Static HTML request failed",
    });
    await expect(fetchStaticPageHtml("https://example.com/stalled", {
      fetch: vi.fn(async () => { throw new DOMException("timed out", "AbortError"); }),
    })).resolves.toEqual({
      ok: false,
      error: "Static HTML request failed",
    });
  });
});
