import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFileSync } from "./file-kit.ts";

test("legacy Deno task artifacts are removed from the repo", () => {
  assert.equal(existsSync(new URL("../deno.json", import.meta.url)), false);
  assert.equal(existsSync(new URL("../deno.lock", import.meta.url)), false);
});

test("legacy Deno test shims are removed from the repo", () => {
  assert.equal(existsSync(new URL("../tests/shims/deno-runtime.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../tests/shims/std-path.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../vitest-tests", import.meta.url)), false);
  assert.equal(existsSync(new URL("../tests/setup-runtime.ts", import.meta.url)), true);
});

test("non-Copilot agent and editor workspace artifacts are removed from the repo", () => {
  assert.equal(existsSync(new URL("../.codex/config.toml", import.meta.url)), false);
  assert.equal(existsSync(new URL("../.vscode/unfluffify-stack.code-workspace", import.meta.url)), false);
});

test("public pnpm scripts are node-native after the Deno bridge removal", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const scriptEntries = Object.entries(packageJson.scripts || {});

  for (const [, command] of scriptEntries) {
    assert.equal(/\bdeno\b/i.test(String(command)), false);
  }

  assert.equal(packageJson.scripts.lint, "eslint .");
  assert.equal(packageJson.scripts["orchestrate:bus"], "node ./orchestration/bus-server.mjs");
  assert.equal(packageJson.scripts["orchestrate:runner"], "node ./orchestration/runner.mjs");
});

test("public pnpm browser launcher is node-native", () => {
  const launchScript = readFileSync(new URL("../scripts/launch-test-browser.mjs", import.meta.url));
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const legacyRuntimeToken = ["De", "no."].join("");

  assert.equal(packageJson.scripts["browser:live"], "node ./scripts/launch-test-browser.mjs");
  assert.equal(launchScript.includes("resolveDenoExecutable"), false);
  assert.equal(launchScript.includes(legacyRuntimeToken), false);
  assert.equal(launchScript.includes('spawn("npx", ["-y", "@playwright/mcp@latest"'), true);
});

test("browser launcher never reloads the extension, and reloads the page", () => {
  // chrome.runtime.reload() began UNLOADING the unpacked extension outright in the
  // MCP-managed Chromium (2026-08-05, 1.62.0-alpha): no worker returns, extension
  // targets vanish, popup.html answers ERR_BLOCKED_BY_CLIENT. A browser with no
  // extension tests nothing, so freshness comes from starting Chrome anew against
  // the build this script just produced. The page reload stays — the tab was
  // navigated before binding and a missed injection window leaves every content
  // command failing with "Receiving end does not exist".
  const launchScript = readFileSync(
    new URL("../scripts/launch-test-browser.mjs", import.meta.url),
    "utf8",
  );

  // Match the call form, not the words: the comment above the removal names the
  // API deliberately, and a guard that a comment can trip teaches nothing.
  assert.equal(
    /(await|void|;|\{)\s*worker\.evaluate\(\(\)\s*=>\s*chrome\.runtime\.reload/.test(launchScript),
    false,
    "the extension reload unloads the extension in this Chromium; freshness must come from the fresh process",
  );
  assert.ok(launchScript.indexOf("page.reload(") > 0, "the target page must still be reloaded");
  // Whatever the reason, a launch must still refuse to proceed without a worker.
  assert.ok(launchScript.includes("No live extension service worker"));
});

test("browser launcher does not claim freshness a reused profile cannot give", () => {
  // A reused profile can still serve a worker from a previous registration. The
  // banner is evidence of what is running, so it has to say which case this is.
  const launchScript = readFileSync(
    new URL("../scripts/launch-test-browser.mjs", import.meta.url),
    "utf8",
  );

  assert.ok(
    /PROFILE_EXISTED\s*=\s*await stat\(PROFILE_DIR\)/.test(launchScript),
    "freshness must be decided from the profile on disk at start, not after Chrome creates it",
  );
  assert.ok(launchScript.includes("refreshed"), "the ready banner must report freshness");
  assert.ok(
    launchScript.includes("profile REUSED"),
    "a reused profile must be named in the banner, not silently treated as fresh",
  );
});


