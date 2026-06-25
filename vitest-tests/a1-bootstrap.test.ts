import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import wxtConfig from "../wxt.config";
import { restoreSourceAction } from "../wxt.config";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
);
const EXPECTED_ACTION = {
  default_title: "Unfluffify",
};
const EXPECTED_PERMISSIONS = [
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
];
const EXPECTED_HOST_PERMISSIONS = ["<all_urls>"];
const EXPECTED_WAR = [
  {
    resources: [
      "assets/materialdesignicons-webfont.woff2",
      "cursors/*.svg",
    ],
    matches: ["<all_urls>"],
  },
];
const EXPECTED_ICONS = {
  "16": "icons/default/icon16.png",
  "32": "icons/default/icon32.png",
  "48": "icons/default/icon48.png",
  "128": "icons/default/icon128.png",
};

describe("WXT Part A bridge", () => {
  it("defines the expected bootstrap scripts", () => {
    expect(packageJson.scripts.check).toContain("tsconfig.json");
    expect(packageJson.scripts.check).toContain("tsconfig.wxt.json");
    expect(packageJson.scripts.dev).toBe("wxt");
    expect(packageJson.scripts["wxt:dev"]).toBeUndefined();
    expect(packageJson.scripts.build).toBe("wxt build");
    expect(packageJson.scripts.zip).toContain("pnpm build");
    expect(packageJson.scripts.zip).toContain("create-output-zip.mjs");
    expect(packageJson.scripts.lint).toBe("eslint .");
    expect(packageJson.scripts.verify).toContain("pnpm build");
    expect(packageJson.scripts.verify).toContain("remove-path.mjs");
    expect(packageJson.scripts.verify).toContain("UF_MANIFEST_SOURCE=generated");
    expect(packageJson.scripts.verify).toContain("manifest-permissions.test.js");
    expect(packageJson.scripts.browser).toBeUndefined();
    expect(packageJson.scripts["browser:live"]).toBe("node ./scripts/launch-test-browser.mjs");
    expect(packageJson.scripts["legacy:build:dev"]).toBeUndefined();
  });

  it("disables WXT auto-imports and targets MV3", () => {
    expect(wxtConfig.imports).toBe(false);
    expect(wxtConfig.manifestVersion).toBe(3);
  });

  it("keeps the manifest contract in wxt.config as the single source of truth", () => {
    expect(wxtConfig.manifest?.name).toBe("Unfluffify");
    expect(wxtConfig.manifest?.version).toBe(packageJson.version);
    expect(wxtConfig.manifest?.description).toBe(
      "Chrome extension to label what's non-meaningful text content to help AI find the meaningful text content.",
    );
    expect(wxtConfig.manifest?.action).toEqual(EXPECTED_ACTION);
    expect(wxtConfig.manifest?.permissions).toEqual(EXPECTED_PERMISSIONS);
    expect(wxtConfig.manifest?.host_permissions).toEqual(
      EXPECTED_HOST_PERMISSIONS,
    );
    expect(wxtConfig.manifest).not.toHaveProperty("background");
    expect(wxtConfig.manifest).not.toHaveProperty("content_scripts");
    expect(wxtConfig.manifest?.web_accessible_resources).toEqual(EXPECTED_WAR);
    expect(wxtConfig.manifest?.icons).toEqual(EXPECTED_ICONS);
  });

  it("restores the source-owned action after WXT generation", () => {
    const generatedManifest = {
      action: {
        default_title: "Unfluffify",
        default_popup: "popup.html",
      },
    };
    restoreSourceAction(generatedManifest);
    expect(generatedManifest).toEqual({
      action: {
        default_title: "Unfluffify",
      },
    });
  });
});
