import { defineContentScript } from "wxt/utils/define-content-script";
import "../page-world/program.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  main() {},
});
