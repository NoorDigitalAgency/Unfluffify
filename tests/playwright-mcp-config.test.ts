import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("repo MCP specs stay placeholdered (non-launchable) and keep no-sandbox launch args", () => {
  const vscodeMcp = readFileSync(new URL("../.vscode/mcp.json", import.meta.url), "utf8");
  const rootMcp = readFileSync(new URL("../.mcp.json", import.meta.url), "utf8");
  const browserConfig = readFileSync(new URL("../.vscode/browser-mcp.config.json", import.meta.url), "utf8");

  // The committed playwright-local MCP specs must carry the repo-root placeholder
  // so they are intentionally non-launchable as-is. The launcher
  // (scripts/launch-test-browser.mjs) substitutes them into .temp/ per environment.
  for (const spec of [vscodeMcp, rootMcp]) {
    assert.match(spec, /--user-data-dir=__UNFLUFFIFY_REPO_ROOT__\/\.wxt\/browser-profile/);
    assert.match(spec, /--config=__UNFLUFFIFY_REPO_ROOT__\/\.vscode\/browser-mcp\.config\.json/);
    // No hardcoded machine-specific absolute paths may leak back in.
    assert.doesNotMatch(spec, /\/home\/[^"\s]+\/\.wxt\/browser-profile/);
    assert.doesNotMatch(spec, /\/Users\/[^"\s]+\/\.wxt\/browser-profile/);
  }
  assert.match(vscodeMcp, /"command": "npx"/);
  assert.match(rootMcp, /"command": "npx"/);

  // The browser config keeps the no-sandbox launch contract and stays placeholdered
  // for both the repo root and the (launcher-dropped) Chromium executable path.
  assert.match(browserConfig, /"chromiumSandbox": false/);
  assert.match(browserConfig, /"--no-sandbox"/);
  assert.match(browserConfig, /"executablePath": "__CHROMIUM_EXECUTABLE_PATH__"/);
  assert.match(browserConfig, /--load-extension=__UNFLUFFIFY_REPO_ROOT__\/\.output\/chrome-mv3/);
  assert.match(browserConfig, /--disable-extensions-except=__UNFLUFFIFY_REPO_ROOT__\/\.output\/chrome-mv3/);
});

test("live browser launcher targets the WXT output and canonical pnpm command", () => {
  const launcher = readFileSync(new URL("../scripts/launch-test-browser.mjs", import.meta.url), "utf8");

  assert.match(launcher, /Usage:\s*\n \* {3}pnpm browser:live <target-url> \[--no-build\]/);
  assert.match(launcher, /const EXT_DIR = join\(repoRoot, "\.output", "chrome-mv3"\);/);
  assert.match(launcher, /await run\("pnpm", \["build"\]\);/);
  assert.match(launcher, /Run \\`pnpm build\\` first/);
  assert.match(launcher, /spawn\("npx", \["-y", "@playwright\/mcp@latest"/);
  assert.match(launcher, /const XVFB_WRAP_ENV = "UNFLUFFIFY_BROWSER_LIVE_XVFB_WRAPPED";/);
  assert.match(launcher, /const XVFB_RUN_ARGS = \["-a", "--server-args=-screen 0 1280x900x24"\];/);
  assert.match(launcher, /spawn\(\s*"xvfb-run"/);
  assert.match(launcher, /headless Linux runs need xvfb-run\. Re-run as:/);
});
