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
  assert.match(toggleSource, /try \{[\s\S]*?await core\.enableForBaseUrl\(baseUrl, \{\s*skipInitialReveal:\s*true\s*\}\);[\s\S]*?\} catch \(error\) \{[\s\S]*?core\.disable\(\);[\s\S]*?PROPERTY_LOCK_CONTENT_RELEASE[\s\S]*?showPageToast\("Unable to activate on this page"\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(toggleSource, /refreshSilentHighlightings\(\)\.then\(\);/);
});

test("reveal activation starts on becameEditor transition and not on marking enable", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  const messageStart = source.indexOf("if (message.type === \"setEnabled\") {");
  const messageEnd = source.indexOf("if (message.type === \"hideConsentForInspection\") {", messageStart);
  const messageSource = source.slice(messageStart, messageEnd);
  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  assert.match(messageSource, /await core\.enableForBaseUrl\(message\.baseUrl, \{\s*skipInitialReveal:\s*true\s*\}\);/);
  assert.doesNotMatch(messageSource, /warmupPageRevealBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /warmupSilentHighlightingBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /runEditorSilentHighlightingActivation\(/);

  const lockStateStart = source.indexOf("if (type === PROPERTY_LOCK_WS_LOCK_STATE) {");
  const lockStateEnd = source.indexOf("if (type === PROPERTY_LOCK_WS_DISCONNECT_WARNING) {", lockStateStart);
  const lockStateSource = source.slice(lockStateStart, lockStateEnd);
  assert.ok(lockStateStart > -1);
  assert.ok(lockStateEnd > lockStateStart);
  assert.match(lockStateSource, /const becameEditor = \(!previousState \|\| !previousState\.isEditor\) && serverMessage\.isEditor;/);
  assert.match(lockStateSource, /if \(becameEditor\) \{[\s\S]*?runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
});

test("URL watcher disable discards temporary unsaved draft cache on navigation", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const watcherStart = source.indexOf("function startUrlWatcher() {");
  const watcherEnd = source.indexOf("function stopUrlWatcher()", watcherStart);

  assert.ok(watcherStart > -1);
  assert.ok(watcherEnd > watcherStart);
  const watcherSource = source.slice(watcherStart, watcherEnd);
  assert.match(watcherSource, /disable\(\{ preserveUnsavedDraftCache: false \}\);/);
  assert.match(watcherSource, /window\.dispatchEvent\(new Event\("unfluffify:url-changed"\)\);/);
});
