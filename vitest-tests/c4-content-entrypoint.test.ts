import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C4 content entrypoints", () => {
  it("bundles the content and MAIN-world runtimes from native WXT entrypoints", () => {
    const contentEntrypointSource = readFileSync(
      resolve(REPO_ROOT, "entrypoints", "content-loader.content.ts"),
      "utf8",
    );
    const bridgeEntrypointSource = readFileSync(
      resolve(REPO_ROOT, "entrypoints", "page-motion-freeze-bridge.content.ts"),
      "utf8",
    );
    const contentMainSource = readFileSync(resolve(REPO_ROOT, "content-main.ts"), "utf8");
    const syncScriptSource = readFileSync(
      resolve(REPO_ROOT, "scripts", "sync-wxt-bootstrap.mjs"),
      "utf8",
    );

    expect(contentEntrypointSource).toContain('import { exposeDebugSpinnerQueueTabId, main } from "../content-main.js";');
    expect(contentEntrypointSource).not.toContain("legacy/content-loader.js");
    expect(contentEntrypointSource).toContain('message.type !== "activateContentMain"');
    expect(contentEntrypointSource).toContain("ensureContentMainLoaded()");
    expect(contentEntrypointSource).toContain("exposeDebugSpinnerQueueTabId();");
    expect(bridgeEntrypointSource).toContain('import "../common/page-motion-freeze-bridge.js";');
    expect(bridgeEntrypointSource).not.toContain("legacy/common/page-motion-freeze-bridge.js");
    expect(contentMainSource).toContain("export function main()");
    expect(contentMainSource).toContain("if (state.initialized) {");
    expect(contentMainSource).toContain("export function exposeDebugSpinnerQueueTabId()");
    expect(syncScriptSource).toContain('destination: join("common", "page-motion-freeze-bridge.js")');
    expect(syncScriptSource).toContain('return relPath === "content-main.js";');
  });
});
