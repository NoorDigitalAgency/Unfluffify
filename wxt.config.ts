import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const SOURCE_ACTION = {
  default_title: "Unfluffify",
};

function resolveSourcemap(): boolean | "inline" | "hidden" | undefined {
  const value = process.env.UNFLUFFIFY_SOURCEMAP;
  if (value === "inline" || value === "hidden") {
    return value;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return undefined;
}

export function restoreSourceAction(manifest: Record<string, unknown>) {
  manifest.action = structuredClone(SOURCE_ACTION);
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  manifestVersion: 3,
  publicDir: "src/public",
  srcDir: "src",
  vite: () => ({
    define: {
      // Debug-only build gate. Plain `pnpm build` => false (production safe);
      // `UNFLUFFIFY_DEBUG=1 pnpm build` (or `pnpm build:debug`) => true, which
      // is what lets test scenarios honor the `?directMode=1` popup query param.
      // Replaced literally at build time, so it never ships as a live toggle.
      __UF_DEBUG_BUILD__: JSON.stringify(process.env.UNFLUFFIFY_DEBUG === "1"),
    },
    build: {
      sourcemap: resolveSourcemap(),
      target: "chrome116",
    },
  }),
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
    minimum_chrome_version: "116",
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
      "idle",
      "activeTab",
      "offscreen",
    ],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: [
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
