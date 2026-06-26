import { afterEach, describe, expect, it, vi } from "vitest";

describe("C1 offscreen entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("boots the shared offscreen runtime", async () => {
    vi.resetModules();
    const startOffscreen = vi.fn();
    vi.doMock("../src/offscreen/bootstrap.js", () => ({ startOffscreen }));

    await import("../src/entrypoints/offscreen/main.ts");

    expect(startOffscreen).toHaveBeenCalledTimes(1);
  });

  it("keeps the real offscreen refine-xpaths bridge wired through bootstrap", async () => {
    vi.resetModules();
    vi.doUnmock("../src/offscreen/bootstrap.js");
    vi.doUnmock("../src/offscreen/bootstrap.ts");
    const addListener = vi.fn();
    const consumeTransferPayload = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        renderedHtml: "<div>rendered</div>",
        rawHtml: "<div>raw</div>",
      },
    });
    const refineXPathEntries = vi.fn(() => [{ xpath: "//body" }]);

    vi.doMock("../src/common/browser.js", () => ({
      browser: {
        runtime: {
          onMessage: {
            addListener,
          },
        },
      },
    }));
    vi.doMock("../src/background/transfer-payload-store.js", () => ({
      consumeTransferPayload,
    }));
    vi.doMock("../src/common/xpath-utilities.js", () => ({
      refineXPathEntries,
    }));

    const { startOffscreen } = await import("../src/offscreen/bootstrap.ts");
    startOffscreen();

    expect(addListener).toHaveBeenCalledTimes(1);
    const listener = addListener.mock.calls[0]?.[0] as (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "offscreenRefineXPaths",
          target: "offscreen",
          payloadKey: "payload-key",
          items: [{ xpath: "//div" }],
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consumeTransferPayload).toHaveBeenCalledWith("payload-key", { expectedType: "object" });
    expect(refineXPathEntries).toHaveBeenCalledWith("<div>rendered</div>", "<div>raw</div>", [{ xpath: "//div" }]);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, items: [{ xpath: "//body" }] });
  });
});
