import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
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

describe("A1 WXT bootstrap", () => {
  it("defines the expected bootstrap scripts", () => {
    expect(packageJson.scripts.check).toContain("tsconfig.json");
    expect(packageJson.scripts.check).toContain("tsconfig.wxt.json");
    expect(packageJson.scripts.dev).toBeUndefined();
    expect(packageJson.scripts["wxt:dev"]).toBeUndefined();
    expect(packageJson.scripts.build).toContain("wxt build");
    expect(packageJson.scripts.build).toContain("sync-wxt-bootstrap.mjs");
    expect(packageJson.scripts.zip).toContain("pnpm build");
    expect(packageJson.scripts.verify).toContain("deno task verify");
    expect(packageJson.scripts.browser).toBeUndefined();
    expect(packageJson.scripts["browser:live"]).toBeUndefined();
    expect(packageJson.scripts["legacy:build:dev"]).toBe("deno task build:dev");
  });

  it("disables WXT auto-imports and targets MV3", () => {
    expect(wxtConfig.imports).toBe(false);
    expect(wxtConfig.manifestVersion).toBe(3);
  });

  it("carries forward the current manifest baseline fields before A2/A3 parity", () => {
    expect(wxtConfig.manifest?.name).toBe(sourceManifest.name);
    expect(wxtConfig.manifest?.version).toBe(sourceManifest.version);
    expect(wxtConfig.manifest?.description).toBe(sourceManifest.description);
    expect(wxtConfig.manifest?.action).toEqual(sourceManifest.action);
    expect(wxtConfig.manifest?.permissions).toEqual(sourceManifest.permissions);
    expect(wxtConfig.manifest?.host_permissions).toEqual(
      sourceManifest.host_permissions,
    );
    expect(wxtConfig.manifest?.background).toEqual(sourceManifest.background);
    expect(wxtConfig.manifest?.content_scripts).toEqual(
      sourceManifest.content_scripts,
    );
    expect(wxtConfig.manifest?.web_accessible_resources).toEqual(
      sourceManifest.web_accessible_resources,
    );
    expect(wxtConfig.manifest?.icons).toEqual(sourceManifest.icons);
  });

  it("bridges background module typing into the final manifest", () => {
    const outputManifest = {
      background: {
        service_worker: "background.js",
      },
    };
    const sourceManifestLike = {
      background: {
        service_worker: "background.js",
        type: "module",
      },
    };

    expect(bridgeManifest(outputManifest, sourceManifestLike)).toEqual({
      background: {
        service_worker: "background.js",
        type: "module",
      },
    });
  });

  it("copies the bridged runtime tree without overwriting the manifest body", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "unfluffify-wxt-bridge-"));
    try {
      const sourceRoot = resolve(tempRoot, "dist-extension");
      const outputRoot = resolve(tempRoot, "output");
      mkdirSync(resolve(sourceRoot, "common"), { recursive: true });
      mkdirSync(outputRoot, { recursive: true });

      writeFileSync(resolve(sourceRoot, "background.js"), 'import "./dep.js";\n');
      writeFileSync(resolve(sourceRoot, "common", "page-motion-freeze-bridge.js"), "export const bridge = true;\n");
      writeFileSync(resolve(sourceRoot, "manifest.json"), JSON.stringify({
        background: {
          service_worker: "background.js",
          type: "module",
        },
      }));

      writeFileSync(resolve(outputRoot, "manifest.json"), JSON.stringify({
        background: {
          service_worker: "background.js",
        },
      }));

      syncBootstrapOutput({
        sourceRoot,
        outputRoot,
        sourceManifestPath: resolve(sourceRoot, "manifest.json"),
        outputManifestPath: resolve(outputRoot, "manifest.json"),
      });

      expect(readFileSync(resolve(outputRoot, "background.js"), "utf8")).toContain('import "./dep.js";');
      expect(readFileSync(resolve(outputRoot, "common", "page-motion-freeze-bridge.js"), "utf8")).toContain("bridge = true");
      expect(JSON.parse(readFileSync(resolve(outputRoot, "manifest.json"), "utf8"))).toEqual({
        background: {
          service_worker: "background.js",
          type: "module",
        },
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
