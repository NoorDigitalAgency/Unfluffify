import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const SOURCE_ACTION = {
  default_title: "Unfluffify",
};

export function restoreSourceAction(manifest: Record<string, unknown>) {
  manifest.action = structuredClone(SOURCE_ACTION);
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  manifestVersion: 3,
  publicDir: "src/public",
  srcDir: "src",
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      restoreSourceAction(manifest);
    },
  },
  manifest: {
    name: "Unfluffify",
    version: packageJson.version,
    description:
      "Chrome extension to label what's non-meaningful text content to help AI find the meaningful text content.",
    action: SOURCE_ACTION,
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
