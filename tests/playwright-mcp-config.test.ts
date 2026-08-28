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
  assert.match(browserConfig, /"--ozone-platform=x11"/);
  assert.match(browserConfig, /"executablePath": "__CHROMIUM_EXECUTABLE_PATH__"/);
  assert.match(browserConfig, /--load-extension=__UNFLUFFIFY_REPO_ROOT__\/\.output\/chrome-mv3/);
  assert.match(browserConfig, /--disable-extensions-except=__UNFLUFFIFY_REPO_ROOT__\/\.output\/chrome-mv3/);
});

test("live browser launcher targets the WXT output and canonical pnpm command", () => {
  const launcher = readFileSync(new URL("../scripts/launch-test-browser.mjs", import.meta.url), "utf8");

  assert.match(launcher, /Usage:\s*\n \* {3}pnpm browser:live <target-url> \[--no-build\] \[--bundle-source <bundle-dir>\]/);
  assert.match(launcher, /const EXT_DIR = join\(repoRoot, "\.output", "chrome-mv3"\);/);
  assert.match(launcher, /await run\("pnpm", \["build"\]\);/);
  assert.match(launcher, /Run \\`pnpm build\\` first/);
  assert.match(launcher, /resolveManagedChromiumExecutable\(\)/);
  assert.match(launcher, /spawnManagedChromium\(managedChromiumExecutable/);
  assert.doesNotMatch(
    launcher,
    /spawnPlaywrightMcp\(/,
    "the live launcher must not keep a Playwright debugger attached to the target tab",
  );
  assert.match(launcher, /arg !== "--remote-debugging-pipe"/);
  assert.match(launcher, /"--disable-field-trial-config"/);
  assert.match(launcher, /await openActualSidePanel\(boundUrl, tabId\)/);
  assert.match(launcher, /await closeCdpTarget\(popupTarget\)/);
  assert.match(launcher, /async function waitForCdpTargetClosed\(targetId/);
  assert.match(launcher, /\/json\/close\/\$\{encodeURIComponent\(targetId\)\}/);
  assert.doesNotMatch(launcher, /const boundPopup = pages\.find/);
  assert.match(launcher, /Could not find the actual Unfluffify side panel/);
  assert.match(launcher, /const XVFB_WRAP_ENV = "UNFLUFFIFY_BROWSER_LIVE_XVFB_WRAPPED";/);
  assert.match(launcher, /const XVFB_RUN_ARGS = \["-a", "--server-args=-screen 0 1280x900x24"\];/);
  assert.match(launcher, /function hasUsableX11Display\(\)/);
  assert.match(launcher, /spawnSync\("xrandr", \["--current"\]/);
  assert.match(launcher, /Number\(dimensions\[1\]\) > 0 && Number\(dimensions\[2\]\) > 0/);
  assert.match(launcher, /spawn\(\s*"xvfb-run"/);
  assert.match(launcher, /headless Linux runs need xvfb-run\. Re-run as:/);
  assert.match(launcher, /process\.exit\(1\);/);
  assert.match(launcher, /const CONTROL_STATE_TIMEOUT_MS = 30_000;/);
  assert.match(launcher, /const CONTROL_OBSERVE_TIMEOUT_MS = 10_000;/);
  assert.match(launcher, /"Runtime\.evaluate"/);
  assert.match(launcher, /awaitPromise: true, returnByValue: true/);
  assert.match(launcher, /buildPopupActionExpression\(action, options\)/);
  assert.match(launcher, /const debugHookAvailable = Boolean\(/);
  assert.match(launcher, /document\.querySelector\('\[data-view\]'\)/);
  assert.doesNotMatch(launcher, /Popup debug hook is unavailable/);
  assert.doesNotMatch(launcher, /browser\.close\(\)/);
  assert.match(launcher, /async function restoreStampedManifest\(\)/);
  assert.match(launcher, /if \(currentManifest !== stamp\.stampedManifest\) return false;/);
  assert.match(launcher, /await writeFile\(stamp\.manifestPath, stamp\.originalManifest, "utf8"\);/);
  assert.match(launcher, /finally \{[\s\S]*?await restoreStampedManifest\(\);[\s\S]*?\}/);
  assert.match(launcher, /async function stageBundleSource\(sourceArgument\)/);
  assert.match(launcher, /async function restoreBundleSwap\(/);
  assert.match(launcher, /browser-live-bundle-swap\.json/);
  assert.match(launcher, /await cp\(sourceRoot, EXT_DIR/);
  assert.doesNotMatch(launcher, /`--load-extension=\$\{[^}]+\}`/);
  assert.doesNotMatch(launcher, /document\.body\?\.innerText/);
  assert.match(launcher, /if \(line === "state"\) \{[\s\S]*?const resumeObserve = observing;[\s\S]*?observing = false;[\s\S]*?runStateAction\("state", CONTROL_STATE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false[\s\S]*?if \(resumeObserve\) \{[\s\S]*?observing = true;[\s\S]*?void observeLoop\(\);/);
  assert.match(launcher, /runStateAction\("state", CONTROL_OBSERVE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false/);
  assert.match(launcher, /runStateAction\("state", CONTROL_STATE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false/);
  assert.match(launcher, /if \(line === "exit-preview"\) \{[\s\S]*?runStateAction\("exit-preview", CONTROL_STATE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false/);
  assert.match(launcher, /runStateAction\("set-inputs", CONTROL_STATE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false/);
  assert.match(launcher, /runStateAction\("eval", CONTROL_STATE_TIMEOUT_MS, \{[\s\S]*?includeTarget: false/);
});
