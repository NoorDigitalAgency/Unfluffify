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

test("browser launcher refreshes both the service worker and the content script", () => {
  // The profile is persistent and the manifest version never changes, so Chrome
  // serves the worker registered on a previous run and every newly added bus
  // command answers NO_HANDLER. Reloading the extension fixes that but orphans
  // content scripts in open tabs, which Chrome will not re-inject — so the page
  // reload is required too, and it has to come after the extension reload.
  const launchScript = readFileSync(
    new URL("../scripts/launch-test-browser.mjs", import.meta.url),
    "utf8",
  );

  const reloadExtension = launchScript.indexOf("chrome.runtime.reload()");
  const reloadPage = launchScript.indexOf("page.reload(");

  assert.ok(reloadExtension > 0, "launcher must reload the extension so the worker re-registers from disk");
  assert.ok(reloadPage > 0, "launcher must reload the target page so the content script is re-injected");
  assert.ok(
    reloadExtension < reloadPage,
    "the page reload must come after the extension reload, or the content script is orphaned again",
  );
  // Waiting for a live worker before using it: the pre-reload handle is dead.
  assert.ok(launchScript.includes("No live extension service worker after reload"));
  assert.ok(launchScript.includes("refreshed"), "the ready banner must report freshness");
});
