import { describe, expect, it, vi } from "vitest";

import {
  replacementContentStatusReady,
  waitForReloadTransition,
} from "../../../src/popup/emulation-reload-transition";

describe("popup emulation reload transition", () => {
  it("waits for the replacement realm to adopt matching property authority", () => {
    const pageUrl = "https://example.com/category#products";
    const expectedProperty = { environmentKey: "stage.example", siteId: 42 };
    expect(replacementContentStatusReady({
      ok: true,
      pageUrl: "https://example.com/category#top",
      authority: {
        baseUrl: "https://example.com",
        environmentKey: "stage.example",
        siteId: 42,
        lockBlocked: true,
      },
    }, pageUrl, expectedProperty)).toBe(false);
    expect(replacementContentStatusReady({
      ok: true,
      pageUrl: "https://example.com/category#top",
      authority: {
        // The property can be canonically apex while the observed page uses www.
        baseUrl: "https://canonical.example",
        environmentKey: "stage.example",
        siteId: 42,
        lockBlocked: false,
      },
    }, pageUrl, expectedProperty)).toBe(true);
    expect(replacementContentStatusReady({
      ok: true,
      pageUrl: "https://example.com/category#top",
      authority: {
        environmentKey: "stage.example",
        siteId: 43,
        lockBlocked: false,
      },
    }, pageUrl, expectedProperty)).toBe(false);
  });

  it("continues when the same normalized page gets a new content realm", async () => {
    let now = 0;
    const contentReady = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(waitForReloadTransition({
      original: { tabId: 7, url: "https://example.com/category?sort=price#top" },
      resolveContext: async () => ({
        tabId: 7,
        url: "https://example.com/category?sort=price#products",
      }),
      contentReady,
      now: () => now,
      wait: async (delay) => { now += delay; },
      timeoutMs: 500,
      intervalMs: 50,
    })).resolves.toEqual({
      status: "ready",
      context: { tabId: 7, url: "https://example.com/category?sort=price#products" },
    });
    expect(contentReady).toHaveBeenCalledTimes(2);
  });

  it("fails closed on a path, query, origin, or tab change", async () => {
    for (const changed of [
      { tabId: 7, url: "https://example.com/other?sort=price" },
      { tabId: 7, url: "https://example.com/category?sort=name" },
      { tabId: 7, url: "https://other.example/category?sort=price" },
      { tabId: 8, url: "https://example.com/category?sort=price" },
    ]) {
      await expect(waitForReloadTransition({
        original: { tabId: 7, url: "https://example.com/category?sort=price" },
        resolveContext: async () => changed,
        contentReady: async () => true,
        wait: async () => undefined,
      })).resolves.toMatchObject({ status: "identity_changed", context: changed });
    }
  });

  it("times out when the replacement content realm never becomes ready", async () => {
    let now = 0;
    await expect(waitForReloadTransition({
      original: { tabId: 7, url: "https://example.com/category" },
      resolveContext: async () => ({ tabId: 7, url: "https://example.com/category" }),
      contentReady: async () => false,
      now: () => now,
      wait: async (delay) => { now += delay; },
      timeoutMs: 100,
      intervalMs: 50,
    })).resolves.toMatchObject({ status: "timed_out" });
  });
});
