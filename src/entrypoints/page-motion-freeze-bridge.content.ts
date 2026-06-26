import { defineContentScript } from "wxt/utils/define-content-script";
import "../common/page-motion-freeze-bridge.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  main() {},
});
