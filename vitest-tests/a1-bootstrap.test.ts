import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import wxtConfig from "../wxt.config";
import { bridgeManifest, syncBootstrapOutput } from "../scripts/sync-wxt-bootstrap.mjs";

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
    expect(packageJson.scripts.dev).toContain("scripts/build-extension.ts --dev --watch");
    expect(packageJson.scripts["wxt:dev"]).toBeUndefined();
    expect(packageJson.scripts.build).toContain("run-deno.mjs run");
    expect(packageJson.scripts.build).toContain("scripts/build-extension.ts --release");
    expect(packageJson.scripts.build).toContain("wxt build");
    expect(packageJson.scripts.build).toContain("sync-wxt-bootstrap.mjs");
    expect(packageJson.scripts.zip).toContain("pnpm build");
    expect(packageJson.scripts.zip).toContain("create-output-zip.mjs");
    expect(packageJson.scripts.lint).toContain("tests/**/*.test.js");
    expect(packageJson.scripts.lint).toContain("tests/**/*.ts");
    expect(packageJson.scripts.lint).toContain("tests/shims/*.js");
    expect(packageJson.scripts.lint).toContain("scripts/create-output-zip.mjs");
    expect(packageJson.scripts.lint).toContain("scripts/remove-path.mjs");
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

  it("restores source-owned manifest fields after WXT generation", () => {
    const outputManifest = {
      action: {
        default_title: "Unfluffify",
        default_popup: "popup.html",
      },
      background: {
        service_worker: "background.js",
      },
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content-scripts/content-loader.js"],
          run_at: "document_start",
        },
      ],
    };
    const sourceManifestLike = {
      action: {
        default_title: "Unfluffify",
      },
      background: {
        service_worker: "background.js",
        type: "module",
      },
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content-loader.js"],
          run_at: "document_start",
        },
      ],
    };

    expect(bridgeManifest(outputManifest, sourceManifestLike)).toEqual({
      action: {
        default_title: "Unfluffify",
      },
      background: {
        service_worker: "background.js",
        type: "module",
      },
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content-loader.js"],
          run_at: "document_start",
        },
      ],
    });
  });

  it("keeps the intended WXT runtime roots while mirroring legacy support files", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "unfluffify-wxt-bridge-"));
    try {
      const sourceRoot = resolve(tempRoot, "dist-extension");
      const outputRoot = resolve(tempRoot, "output");
      mkdirSync(resolve(sourceRoot, "common"), { recursive: true });
      mkdirSync(resolve(sourceRoot, "popup"), { recursive: true });
      mkdirSync(resolve(outputRoot, "content-scripts"), { recursive: true });

      writeFileSync(resolve(sourceRoot, "background.js"), 'console.log("legacy-background");\n');
      writeFileSync(resolve(sourceRoot, "content-loader.js"), 'console.log("legacy-loader");\n');
      writeFileSync(
        resolve(sourceRoot, "common", "page-motion-freeze-bridge.js"),
        'console.log("legacy-bridge");\n',
      );
      writeFileSync(resolve(sourceRoot, "popup.html"), "<!doctype html><title>legacy popup</title>\n");
      writeFileSync(resolve(sourceRoot, "offscreen.html"), "<!doctype html><title>legacy offscreen</title>\n");
      writeFileSync(resolve(sourceRoot, "popup", "ui.js"), "export const popupView = true;\n");
      writeFileSync(resolve(sourceRoot, "manifest.json"), JSON.stringify({
        action: {
          default_title: "Unfluffify",
        },
        background: {
          service_worker: "background.js",
          type: "module",
        },
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["common/page-motion-freeze-bridge.js"],
            run_at: "document_start",
            all_frames: true,
            world: "MAIN",
          },
          {
            matches: ["<all_urls>"],
            js: ["content-loader.js"],
            run_at: "document_start",
          },
        ],
      }));

      writeFileSync(resolve(outputRoot, "popup.html"), "<!doctype html><title>wxt popup</title>\n");
      writeFileSync(resolve(outputRoot, "offscreen.html"), "<!doctype html><title>wxt offscreen</title>\n");
      writeFileSync(
        resolve(outputRoot, "content-scripts", "content-loader.js"),
        'console.log("wxt-loader");\n',
      );
      writeFileSync(resolve(outputRoot, "manifest.json"), JSON.stringify({
        action: {
          default_title: "Unfluffify",
          default_popup: "popup.html",
        },
        background: {
          service_worker: "background.js",
        },
        content_scripts: [
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
        ],
      }));

      syncBootstrapOutput({
        sourceRoot,
        outputRoot,
        sourceManifestPath: resolve(sourceRoot, "manifest.json"),
        outputManifestPath: resolve(outputRoot, "manifest.json"),
      });

      expect(readFileSync(resolve(outputRoot, "background.js"), "utf8")).toContain("legacy-background");
      expect(readFileSync(resolve(outputRoot, "content-loader.js"), "utf8")).toContain("wxt-loader");
      expect(
        readFileSync(resolve(outputRoot, "common", "page-motion-freeze-bridge.js"), "utf8"),
      ).toContain("legacy-bridge");
      expect(readFileSync(resolve(outputRoot, "legacy", "background.js"), "utf8")).toContain("legacy-background");
      expect(readFileSync(resolve(outputRoot, "legacy", "content-loader.js"), "utf8")).toContain("legacy-loader");
      expect(
        readFileSync(resolve(outputRoot, "legacy", "common", "page-motion-freeze-bridge.js"), "utf8"),
      ).toContain("legacy-bridge");
      expect(readFileSync(resolve(outputRoot, "popup.html"), "utf8")).toContain("wxt popup");
      expect(readFileSync(resolve(outputRoot, "offscreen.html"), "utf8")).toContain("wxt offscreen");
      expect(readFileSync(resolve(outputRoot, "popup", "ui.js"), "utf8")).toContain("popupView = true");
      expect(JSON.parse(readFileSync(resolve(outputRoot, "manifest.json"), "utf8"))).toEqual({
        action: {
          default_title: "Unfluffify",
        },
        background: {
          service_worker: "background.js",
          type: "module",
        },
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["common/page-motion-freeze-bridge.js"],
            run_at: "document_start",
            all_frames: true,
            world: "MAIN",
          },
          {
            matches: ["<all_urls>"],
            js: ["content-loader.js"],
            run_at: "document_start",
          },
        ],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
