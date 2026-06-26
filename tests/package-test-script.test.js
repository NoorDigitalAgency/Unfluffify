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
  assert.equal(existsSync(new URL("../tests/setup-runtime.js", import.meta.url)), true);
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
