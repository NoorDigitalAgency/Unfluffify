import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// Debug-gated "direct mode" lets marking activate on an unconfigured page (e.g.
// a shadow-DOM test page like cramo) by bypassing the property / render-mode /
// page-type / siteId gates. It must be gated on BOTH a debug build and the
// explicit ?directMode=1 popup query param, so a plain production build can
// never honor it. These source-contract pins guard that wiring.

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const wxtConfigSource = readFileSync(new URL("../wxt.config.ts", import.meta.url), "utf8");
const featureFlagsSource = readFileSync(new URL("../src/common/feature-flags.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("direct mode is gated on BOTH a debug build and the ?directMode=1 query param", () => {
  assert.match(
    popupSource,
    /const DIRECT_MODE_ACTIVE = \(\(\) => \{[\s\S]*?if \(!isDebugBuild\(\)[\s\S]*?getComputed|const DIRECT_MODE_ACTIVE = \(\(\) => \{[\s\S]*?if \(!isDebugBuild\(\)[\s\S]*?return false;[\s\S]*?get\("directMode"\) === "1"/
  );
});

test("the debug-build gate is defined at compile time and defaults off in production", () => {
  // Vite define driven by UNFLUFFIFY_DEBUG — plain `pnpm build` => false.
  assert.match(
    wxtConfigSource,
    /__UF_DEBUG_BUILD__: JSON\.stringify\(process\.env\.UNFLUFFIFY_DEBUG === "1"\)/
  );
  // isDebugBuild honors the dev server OR the compile-time constant, with a
  // typeof guard so an undefined constant can never throw.
  assert.match(
    featureFlagsSource,
    /export function isDebugBuild\(\)[\s\S]*?env\.DEV === true[\s\S]*?typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__ === true/
  );
  assert.equal(packageJson.scripts["build:debug"], "UNFLUFFIFY_DEBUG=1 wxt build");
});

test("direct mode synthesizes an in-scope base URL for an unconfigured page", () => {
  assert.match(
    popupSource,
    /if \(DIRECT_MODE_ACTIVE && tabInScope && !state\.currentBaseUrl\) \{[\s\S]*?utils\.getOriginFromUrl\(pageUrl\)[\s\S]*?state\.currentBaseUrl = synthesizedBaseUrl;[\s\S]*?unsupportedByGraphql = false;/
  );
  // Confirmed render mode forced so the marking editor + toggle are reachable.
  assert.match(
    popupSource,
    /if \(DIRECT_MODE_ACTIVE && state\.currentBaseUrl\) \{[\s\S]*?state\.currentBaseUrlHasConfirmedRenderMode = true;/
  );
  // siteIdReady is satisfied under direct mode.
  assert.match(popupSource, /\) \|\| DIRECT_MODE_ACTIVE;/);
});

test("direct mode bypasses the render-mode, page-type, and siteId enable gates", () => {
  assert.match(
    popupSource,
    /if \(desiredEnabled && !isCurrentRenderModeReady\(\) && !DIRECT_MODE_ACTIVE\) \{/
  );
  assert.match(
    popupSource,
    /if \(desiredEnabled && !state\.currentPageTypeKey && !DIRECT_MODE_ACTIVE\) \{/
  );
  // The backend siteId resolution is skipped in direct mode (no configured property).
  assert.match(
    popupSource,
    /if \(DIRECT_MODE_ACTIVE\) \{[\s\S]*?state\.currentBaseUrl = effectiveBaseUrl;[\s\S]*?\} else \{[\s\S]*?ensureBaseUrlSiteId\(/
  );
});

test("direct mode never bypasses save or AI-run (scope is marking/overlay only)", () => {
  // The bypasses reference only the enable/render-mode/page-type/siteId gates.
  // Guard that no direct-mode conditional touches the save/compute paths.
  assert.doesNotMatch(popupSource, /DIRECT_MODE_ACTIVE[^\n]*\b(handleSave|handleCompute|pageSave|aiRun|runAi)\b/i);
});
