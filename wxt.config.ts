import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

const sourceManifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

export function restoreSourceAction(manifest: Record<string, unknown>) {
  if (sourceManifest?.action) {
    manifest.action = structuredClone(sourceManifest.action);
  }
}

const REQUIRED_PUBLIC_ASSETS = [
  {
    absoluteSrc: resolve(import.meta.dirname, "assets", "materialdesignicons-webfont.woff2"),
    relativeDest: "assets/materialdesignicons-webfont.woff2",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "cursors", "exclude.svg"),
    relativeDest: "cursors/exclude.svg",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "cursors", "include.svg"),
    relativeDest: "cursors/include.svg",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "icons", "default", "icon16.png"),
    relativeDest: "icons/default/icon16.png",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "icons", "default", "icon32.png"),
    relativeDest: "icons/default/icon32.png",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "icons", "default", "icon48.png"),
    relativeDest: "icons/default/icon48.png",
  },
  {
    absoluteSrc: resolve(import.meta.dirname, "icons", "default", "icon128.png"),
    relativeDest: "icons/default/icon128.png",
  },
];

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      for (const asset of REQUIRED_PUBLIC_ASSETS) {
        files.unshift(asset);
      }
    },
    "build:manifestGenerated": (_wxt, manifest) => {
      restoreSourceAction(manifest);
    },
  },
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
