import { describe, expect, it, vi } from "vitest";

import {
  DOMAIN_CACHE_DATA,
  clearDomainCache,
  normalizeCacheOrigin,
} from "../../../src/storage/domain-cache";

describe("current-domain cache clearing", () => {
  it("normalizes to one HTTP origin and clears only that origin", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await expect(clearDomainCache({ remove }, "https://jobs.example.com/a?b=1")).resolves.toEqual({
      status: "ok",
      origin: "https://jobs.example.com",
    });
    expect(remove).toHaveBeenCalledWith(
      { origins: ["https://jobs.example.com"] },
      DOMAIN_CACHE_DATA,
    );
  });

  it("rejects extension and malformed URLs and returns structured API failures", async () => {
    expect(normalizeCacheOrigin("chrome-extension://abc/popup.html")).toBeNull();
    expect(normalizeCacheOrigin("not a url")).toBeNull();
    await expect(clearDomainCache(undefined, "https://example.com")).resolves.toEqual({
      status: "error",
      message: "Chrome cache controls are unavailable.",
    });
    await expect(clearDomainCache({ remove: vi.fn().mockRejectedValue(new Error("denied")) }, "https://example.com"))
      .resolves.toEqual({
        status: "error",
        message: "Chrome could not clear this domain's cache.",
      });
  });
});
