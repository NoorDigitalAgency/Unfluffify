import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  async main() {
    await import(chrome.runtime.getURL("legacy/common/page-motion-freeze-bridge.js"));
  },
});
