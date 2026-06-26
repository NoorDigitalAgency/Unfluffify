import { afterEach, describe, expect, it, vi } from "vitest";

async function withBrowserHost<T>(
  value: unknown,
  callback: () => Promise<T> | T,
): Promise<T> {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.browser = value;
  try {
    return await callback();
  } finally {
    if (typeof originalBrowser === "undefined") {
      delete globalThis.browser;
    } else {
      globalThis.browser = originalBrowser;
    }
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
}

describe("browser runtime seam", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the promise branch for promise-only browser hosts", async () => {
    const get = vi.fn(async (tabId: number) => ({ id: tabId }));

    await withBrowserHost({
      runtime: { id: "test-runtime" },
      tabs: { get },
    }, async () => {
      const { callBrowserApi } = await import("../src/common/browser.js");

      await expect(
        callBrowserApi(
          (api, callback) => api.tabs.get(7, callback),
          (api) => api.tabs.get(7),
        ),
      ).resolves.toEqual({ id: 7 });
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(7);
  });
});
