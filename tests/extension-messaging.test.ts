import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRequestEnvelope } from "../common/message-protocol.js";
import { MESSAGE_TARGETS } from "../common/message-protocol.js";

type RuntimeListener = (message: unknown, sender?: chrome.runtime.MessageSender) => unknown;

function createRuntimeEvent() {
  const listeners = new Set<RuntimeListener>();
  return {
    addListener(listener: RuntimeListener) {
      listeners.add(listener);
    },
    removeListener(listener: RuntimeListener) {
      listeners.delete(listener);
    },
    async dispatch(message: unknown, sender?: chrome.runtime.MessageSender) {
      for (const listener of listeners) {
        const result = listener(message, sender);
        if (typeof result !== "undefined") {
          return await result;
        }
      }
      return undefined;
    },
  };
}

function withBrowser(value: unknown, callback: () => Promise<void> | void) {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.browser = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
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
    });
}

async function loadExtensionMessaging() {
  vi.resetModules();
  return await import("../common/extension-messaging.js");
}

describe("extension messaging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps content-targeted request replies in the extension messaging response contract", async () => {
    const onMessage = createRuntimeEvent();
    await withBrowser({
      runtime: {
        id: "test-runtime",
        onMessage,
      },
    }, async () => {
      const { addRequestEnvelopeListener, REQUEST_PROTOCOL } = await loadExtensionMessaging();
      const request = createRequestEnvelope("content:status", { ok: true }, {
        target: MESSAGE_TARGETS.CONTENT,
        tabId: 22,
        frameId: 4,
      });

      addRequestEnvelopeListener((message) => {
        expect(message).toEqual(request);
        return { ok: true, result: { echoed: message.type } };
      });

      await expect(onMessage.dispatch({
        id: 7,
        type: REQUEST_PROTOCOL,
        data: request,
        timestamp: Date.now(),
      })).resolves.toEqual({
        res: { ok: true, result: { echoed: "content:status" } },
      });
    });
  });

  it("sends content-targeted requests through the wrapped extension messaging contract", async () => {
    const tabs = {
      sendMessage: vi.fn((_tabId: number, message: unknown) =>
        Promise.resolve({
          res: {
            ok: true,
            result: { message },
          },
        })),
    };

    await withBrowser({
      runtime: { id: "test-runtime" },
      tabs,
    }, async () => {
      const { sendRequestEnvelope, REQUEST_PROTOCOL } = await loadExtensionMessaging();
      const request = createRequestEnvelope("content:status", { ok: true }, {
        target: MESSAGE_TARGETS.CONTENT,
        tabId: 22,
      });

      await expect(sendRequestEnvelope(request)).resolves.toEqual({
        ok: true,
        result: {
          message: expect.objectContaining({
            type: REQUEST_PROTOCOL,
            data: request,
            timestamp: expect.any(Number),
          }),
        },
      });
    });

    expect(tabs.sendMessage).toHaveBeenCalledTimes(1);
  });
});
