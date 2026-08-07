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
  // Pinned, never floating: @latest broke this harness twice in one day — the
  // bundled Chromium started unloading the unpacked extension, then
  // browser_run_code_unsafe stopped answering and hung the popup binding. Neither
  // was a change to this repo, and neither announced itself.
  assert.equal(launchScript.includes("@playwright/mcp@latest"), false);
  assert.ok(
    /const PLAYWRIGHT_MCP_VERSION = "\d+\.\d+\.\d+";/.test(launchScript),
    "the MCP server version must be pinned to an exact release",
  );
  assert.ok(
    launchScript.includes('spawn("npx", ["-y", PLAYWRIGHT_MCP_PACKAGE'),
    "the server must be started from the pinned package",
  );
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

test("browser launcher makes Chrome re-register the worker by bumping the version", () => {
  // Chrome keeps serving the service worker it registered for this profile until it
  // sees a new VERSION. Without the bump a rebuilt background silently answers with
  // the previous build's code — the failure that cost two misdiagnoses, because
  // every visible surface looks correct while the logic behind it is stale.
  const launchScript = readFileSync(
    new URL("../scripts/launch-test-browser.mjs", import.meta.url),
    "utf8",
  );

  assert.ok(
    launchScript.includes("async function stampBuildVersion()"),
    "the launcher must stamp a fresh manifest version so the worker re-registers",
  );
  // Monotonic, and written where the next run can read it.
  assert.ok(/build-counter/.test(launchScript), "the counter must persist between runs");
  assert.ok(/% 65536/.test(launchScript), "manifest version components are bounded at 65535");
  // Stamped after the build, or the build would overwrite it.
  const build = launchScript.indexOf('await run("pnpm", ["build"])');
  const stamp = launchScript.indexOf("await stampBuildVersion()");
  assert.ok(build > 0 && stamp > build, "the stamp must come after the build that writes the manifest");
  assert.ok(launchScript.includes("refreshed"), "the ready banner must report freshness");
});

test("browser launcher drops the worker registration without dropping the data", () => {
  // The version bump alone was measured not to dislodge an already-registered
  // worker. Dropping `Default/Service Worker/` does, and the extension's own store
  // lives in a different directory — so the operator keeps their endpoints, token
  // and property state instead of re-doing setup for a code change they did not make.
  const launchScript = readFileSync(
    new URL("../scripts/launch-test-browser.mjs", import.meta.url),
    "utf8",
  );

  assert.ok(
    /join\(PROFILE_DIR, "Default", "Service Worker"\)/.test(launchScript),
    "only the service-worker directory may be removed",
  );
  // Every removal in the script must target that one directory — asserted on the
  // calls, not on the words, since the comments explaining this name other paths.
  const removals = [...launchScript.matchAll(/\brm\(([^)]*)\)/g)].map((match) => match[1]);
  assert.ok(removals.length > 0, "the removal must exist to be constrained");
  for (const argument of removals) {
    assert.ok(
      argument.includes("swDir"),
      `rm(${argument}) removes something other than the service-worker directory`,
    );
  }
  // Before Chrome starts, or it will have reused the registration already.
  const drop = launchScript.indexOf("await dropServiceWorkerRegistration()");
  const launch = launchScript.indexOf("spawnPlaywrightMcp([");
  assert.ok(drop > 0 && launch > 0 && drop < launch, "the drop must happen before Chrome is started");
});


