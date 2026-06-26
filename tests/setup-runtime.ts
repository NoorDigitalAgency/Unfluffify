import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");

vi.mock("@webext-core/messaging", () => {
  let nextId = 0;

  function getBrowser() {
    return globalThis.browser ?? globalThis.chrome;
  }

  return {
    defineExtensionMessaging() {
      return {
        sendMessage(type, data, target) {
          const browserApi = getBrowser();
          if (type === "uf-bus/1" || type === "uf-runtime-request/1") {
            const message = {
              id: nextId++,
              type,
              data,
              timestamp: Date.now(),
            };
            const sendPromise = target == null
              ? browserApi.runtime.sendMessage(message)
              : browserApi.tabs.sendMessage(
                typeof target === "number" ? target : target.tabId,
                message,
                typeof target === "number" || typeof target.frameId === "undefined"
                  ? undefined
                  : { frameId: target.frameId },
              );
            return Promise.resolve(sendPromise).then((response) => {
              if (!response) {
                return undefined;
              }
              if (response.err != null) {
                throw response.err;
              }
              return response.res;
            });
          }
          throw new Error(`Unexpected mocked message type: ${String(type)}`);
        },
        onMessage(type, listener) {
          const browserApi = getBrowser();
          const onMessage = (message, sender) => {
            if (!message || typeof message !== "object" || message.type !== type || typeof message.timestamp !== "number") {
              return;
            }
            return Promise.resolve(listener({ ...message, sender }))
              .then((res) => ({ res }))
              .catch((err) => ({ err }));
          };
          browserApi.runtime.onMessage.addListener(onMessage);
          return () => browserApi.runtime.onMessage.removeListener(onMessage);
        },
      };
    },
  };
});

globalThis.WebSocket = WebSocket;
