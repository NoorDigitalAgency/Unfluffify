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
      html: "<html><body><main>Hi</main></body></html>",
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
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
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
  });
});
