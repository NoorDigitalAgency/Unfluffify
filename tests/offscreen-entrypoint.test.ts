import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusFrame } from "../src/messaging/contract";

function frame(): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "request",
    id: "offscreen-1",
    seq: 1,
    name: "offscreen.refineXpaths",
    source: "background",
    sourceInstance: "background:test",
    target: "offscreen",
    payload: {
      renderedHtmlRef: {
        id: "rendered-1",
        scope: "xpath-refinement:test",
        sha256: "a".repeat(64),
        byteLength: 53,
      },
      rawHtmlRef: {
        id: "raw-1",
        scope: "xpath-refinement:test",
        sha256: "b".repeat(64),
        byteLength: 52,
      },
      rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
    },
  };
}

describe("offscreen rewrite entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("serves XPath refinement over the typed offscreen bus", async () => {
    const addListener = vi.fn();
    const refineXPathEntries = vi.fn(() => [{
      xpath: "/html[1]/body[1]/main[1]",
      excluded: false,
    }]);
    vi.doMock("../src/offscreen/xpath-refinement", () => ({ refineXPathEntries }));
    const sendMessage = vi.fn(async (message: BusFrame) => ({
      kind: "uf-bus/1" as const,
      frameType: "reply" as const,
      id: message.id,
      seq: message.seq,
      name: message.name,
      source: "background" as const,
      sourceInstance: "background:test",
      target: "offscreen" as const,
      payload: {
        status: "ok",
        value: (message.payload as { handle: { id: string } }).handle.id === "rendered-1"
          ? "<html><body><main>Browser render</main></body></html>"
          : "<html><body><main>Server source</main></body></html>",
      },
      ok: true,
    }));
    globalThis.chrome = {
      runtime: {
        sendMessage,
        onMessage: { addListener, removeListener: vi.fn() },
      },
    } as unknown as typeof chrome;

    await import("../src/entrypoints/offscreen/main.ts");
    const listener = addListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => unknown) => unknown;
    let response: unknown;
    expect(listener(frame(), {}, (value: unknown) => {
      response = value;
    })).toBe(true);
    for (let index = 0; index < 10 && response === undefined; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(response).toMatchObject({
      frameType: "reply",
      ok: true,
      payload: { rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] },
    });
    expect(refineXPathEntries).toHaveBeenCalledWith(
      "<html><body><main>Browser render</main></body></html>",
      "<html><body><main>Server source</main></body></html>",
      [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
    );
  });
});
