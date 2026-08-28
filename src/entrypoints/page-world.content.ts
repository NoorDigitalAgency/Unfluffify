import { defineContentScript } from "wxt/utils/define-content-script";
import "../page-world/program.js";
import { createRealmBus } from "../messaging/realms";
import { createPageTransport } from "../messaging/transports/page";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  // The isolated content owner is top-frame-only. A MAIN runtime in child
  // frames would have no command owner and could retain orphaned posture.
  allFrames: false,
  world: "MAIN",
  main() {
    createRealmBus({
      realm: "page",
      transport: createPageTransport({
        postMessage(message) {
          window.postMessage(message, "*");
        },
        onMessage(listener) {
          const handler = (event: MessageEvent): void => {
            if (event.source === window) {
              listener(event.data);
            }
          };
          window.addEventListener("message", handler);
          return () => window.removeEventListener("message", handler);
        },
      }),
    });
  },
});
