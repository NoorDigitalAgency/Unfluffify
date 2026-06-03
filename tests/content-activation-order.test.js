import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("refreshFromTabState can reveal restored enabled pages before freeze and render", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshStart = source.indexOf("export async function refreshFromTabState(options = {})");
  const refreshEnd = source.indexOf("export function syncPageMarkings", refreshStart);

  assert.ok(refreshStart > -1);
  assert.ok(refreshEnd > refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /const withInitialReveal = Boolean\(options\.withInitialReveal\);/);
  assert.match(refreshSource, /state\.enabled = true;/);
  assert.match(refreshSource, /state\.consentRootElements = new Set\(\);/);
  assert.match(refreshSource, /hideConsentOnEnable\(pageUrl\);[\s\S]*?if \(withInitialReveal\) \{[\s\S]*?await warmupPageRevealBeforeMotionPause\(response\.baseUrl, pageUrl\);/);
  assert.match(refreshSource, /if \(!revealReady\) \{[\s\S]*?disable\(\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(refreshSource, /scheduleRender\(\);[\s\S]*?startObservers\(\);[\s\S]*?startUrlWatcher\(\);/);
});

test("main restores tab state with initial reveal before highlight refresh", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const mainStart = source.indexOf("export function main()");
  const mainEnd = source.indexOf("document.addEventListener(\"keydown\"", mainStart);

  assert.ok(mainStart > -1);
  assert.ok(mainEnd > mainStart);
  const mainSource = source.slice(mainStart, mainEnd);
  assert.match(mainSource, /core\.refreshFromTabState\(\{\s*withInitialReveal:\s*true\s*\}\)\.then\(async \(\) => \{/);
  const refreshIndex = mainSource.indexOf("core.refreshFromTabState({ withInitialReveal: true }).then(async () => {");
  const silentIndex = mainSource.indexOf("refreshSilentHighlightings().then();");
  assert.ok(refreshIndex > -1);
  assert.ok(silentIndex > refreshIndex);
});

test("manual page enable waits for activation reveal before refreshing highlight state", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const toggleStart = source.indexOf("async function toggleEnabledFromPage(options = {})");
  const toggleEnd = source.indexOf("function ensureSilentHighlightingStyles()", toggleStart);

  assert.ok(toggleStart > -1);
  assert.ok(toggleEnd > toggleStart);
  const toggleSource = source.slice(toggleStart, toggleEnd);
  assert.match(toggleSource, /try \{[\s\S]*?await core\.enableForBaseUrl\(baseUrl\);[\s\S]*?\} catch \(error\) \{[\s\S]*?core\.disable\(\);[\s\S]*?PROPERTY_LOCK_CONTENT_RELEASE[\s\S]*?showPageToast\("Unable to activate on this page"\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(toggleSource, /refreshSilentHighlightings\(\)\.then\(\);/);
});
