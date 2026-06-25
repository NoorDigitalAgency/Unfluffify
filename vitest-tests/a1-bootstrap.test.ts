import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import wxtConfig from "../wxt.config";
import { restoreSourceAction } from "../wxt.config";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
);
const sourceManifest = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "manifest.json"), "utf8"),
);

describe("WXT Part A bridge", () => {
  it("defines the expected bootstrap scripts", () => {
    expect(packageJson.scripts.check).toContain("tsconfig.json");
    expect(packageJson.scripts.check).toContain("tsconfig.wxt.json");
    expect(packageJson.scripts.dev).toBe("wxt");
    expect(packageJson.scripts["wxt:dev"]).toBeUndefined();
    expect(packageJson.scripts.build).toBe("wxt build");
    expect(packageJson.scripts.zip).toContain("pnpm build");
    expect(packageJson.scripts.zip).toContain("create-output-zip.mjs");
    expect(packageJson.scripts.lint).toContain("tests/**/*.test.js");
    expect(packageJson.scripts.lint).toContain("tests/**/*.ts");
    expect(packageJson.scripts.lint).toContain("tests/shims/*.js");
    expect(packageJson.scripts.lint).toContain("scripts/create-output-zip.mjs");
    expect(packageJson.scripts.lint).toContain("scripts/remove-path.mjs");
    expect(packageJson.scripts.lint).not.toContain("sync-wxt-bootstrap.mjs");
    expect(packageJson.scripts.verify).toContain("pnpm build");
    expect(packageJson.scripts.verify).toContain("remove-path.mjs");
    expect(packageJson.scripts.verify).toContain("UF_MANIFEST_SOURCE=generated");
    expect(packageJson.scripts.verify).toContain("manifest-permissions.test.js");
    expect(packageJson.scripts.browser).toBeUndefined();
    expect(packageJson.scripts["browser:live"]).toContain("run-deno.mjs run");
    expect(packageJson.scripts["browser:live"]).toContain("./scripts/launch-test-browser.ts");
    expect(packageJson.scripts["legacy:build:dev"]).toBeUndefined();
  });

  it("disables WXT auto-imports and targets MV3", () => {
    expect(wxtConfig.imports).toBe(false);
    expect(wxtConfig.manifestVersion).toBe(3);
  });

  it("keeps the baseline manifest fields that still belong in wxt.config during A2", () => {
    expect(wxtConfig.manifest?.name).toBe(sourceManifest.name);
    expect(wxtConfig.manifest?.version).toBe(sourceManifest.version);
    expect(wxtConfig.manifest?.description).toBe(sourceManifest.description);
    expect(wxtConfig.manifest?.action).toEqual(sourceManifest.action);
    expect(wxtConfig.manifest?.permissions).toEqual(sourceManifest.permissions);
    expect(wxtConfig.manifest?.host_permissions).toEqual(
      sourceManifest.host_permissions,
    );
    expect(wxtConfig.manifest).not.toHaveProperty("background");
    expect(wxtConfig.manifest).not.toHaveProperty("content_scripts");
    expect(wxtConfig.manifest?.web_accessible_resources).toEqual(
      sourceManifest.web_accessible_resources,
    );
    expect(wxtConfig.manifest?.icons).toEqual(sourceManifest.icons);
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

  it("keeps WXT-native content-script paths in the source manifest", () => {
    expect(sourceManifest.background).toEqual({
      service_worker: "background.js",
      type: "module",
    });
    expect(sourceManifest.content_scripts).toEqual([
      {
        matches: ["<all_urls>"],
        js: ["content-scripts/page-motion-freeze-bridge.js"],
        run_at: "document_start",
        all_frames: true,
        world: "MAIN",
      },
      {
        matches: ["<all_urls>"],
        js: ["content-scripts/content-loader.js"],
        run_at: "document_start",
      },
    ]);
  });
});
