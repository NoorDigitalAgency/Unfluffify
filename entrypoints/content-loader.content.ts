import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  async main() {
    await import(chrome.runtime.getURL("legacy/content-loader.js"));
  },
});
