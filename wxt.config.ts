import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const sourceManifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: "Unfluffify",
    version: sourceManifest.version,
    description:
      "Chrome extension to label what's non-meaningful text content to help AI find the meaningful text content.",
    action: {
      default_title: "Unfluffify",
    },
    permissions: [
      "storage",
      "sidePanel",
      "tabs",
      "scripting",
      "debugger",
      "alarms",
      "browsingData",
      "webNavigation",
      "activeTab",
      "offscreen",
    ],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: [
          "assets/materialdesignicons-webfont.woff2",
          "cursors/*.svg"
        ],
        matches: ["<all_urls>"]
      }
    ],
    icons: {
      "16": "icons/default/icon16.png",
      "32": "icons/default/icon32.png",
      "48": "icons/default/icon48.png",
      "128": "icons/default/icon128.png"
    },
  },
});
