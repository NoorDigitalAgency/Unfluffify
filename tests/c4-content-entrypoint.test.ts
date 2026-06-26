import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C4 content entrypoints", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & {
      __unfluffifyContentLoaderInitialized?: boolean;
      __unfluffifyContentMainLoaded?: boolean;
      __unfluffifyContentMainLoading?: Promise<void> | null;
    }).__unfluffifyContentLoaderInitialized;
    delete (globalThis as typeof globalThis & {
      __unfluffifyContentMainLoaded?: boolean;
    }).__unfluffifyContentMainLoaded;
    delete (globalThis as typeof globalThis & {
      __unfluffifyContentMainLoading?: Promise<void> | null;
    }).__unfluffifyContentMainLoading;
  });

  it("registers the activation bridge and loads content-main only once", async () => {
    const addListener = vi.fn();
    const main = vi.fn();
    const exposeDebugSpinnerQueueTabId = vi.fn();

    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/common/browser.js", () => ({
      browser: {
        runtime: {
          onMessage: {
            addListener,
          },
        },
      },
    }));
    vi.doMock("../src/content-main.js", () => ({
      main,
      exposeDebugSpinnerQueueTabId,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      matches: string[];
      runAt: string;
      main: () => void;
    };

    expect(contentScript.matches).toEqual(["<all_urls>"]);
    expect(contentScript.runAt).toBe("document_start");

    contentScript.main();

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(exposeDebugSpinnerQueueTabId).toHaveBeenCalledTimes(1);

    const listener = addListener.mock.calls[0]?.[0] as (
      message: { type?: string },
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    expect(listener({ type: "activateContentMain" }, {}, firstResponse)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(main).toHaveBeenCalledTimes(1);
    expect(firstResponse).toHaveBeenCalledWith({ ok: true });

    expect(listener({ type: "activateContentMain" }, {}, secondResponse)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(main).toHaveBeenCalledTimes(1);
    expect(secondResponse).toHaveBeenCalledWith({ ok: true, alreadyLoaded: true });
  });

  it("keeps the MAIN-world bridge entrypoint bound to the real bridge module", () => {
    const bridgeEntrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "page-motion-freeze-bridge.content.ts"),
      "utf8",
    );

    expect(bridgeEntrypointSource).toContain('import "../common/page-motion-freeze-bridge.js";');
  });
});
