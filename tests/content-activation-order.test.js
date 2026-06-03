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
  assert.match(refreshSource, /hideConsentOnEnable\(pageUrl\);[\s\S]*?if \(withInitialReveal\) \{[\s\S]*?await warmupPageRevealBeforeMotionPause\(response\.baseUrl, pageUrl, \{[\s\S]*?keepUiActive:\s*true[\s\S]*?\}\);/);
  assert.match(refreshSource, /if \(!revealReady\) \{[\s\S]*?disable\(\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(refreshSource, /scheduleRender\(\);[\s\S]*?startObservers\(\);[\s\S]*?startUrlWatcher\(\);/);
  assert.match(refreshSource, /if \(withInitialReveal\) \{[\s\S]*?await finishPageInspectionUiAfterRender\(\);[\s\S]*?\}/);
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
  assert.match(messageSource, /const skipInitialReveal = !Boolean\(message\.performInitialReveal\);/);
  assert.match(messageSource, /await core\.enableForBaseUrl\(message\.baseUrl, \{ skipInitialReveal \}\);/);
  assert.doesNotMatch(messageSource, /warmupPageRevealBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /warmupSilentHighlightingBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /runEditorSilentHighlightingActivation\(/);

  const lockStateStart = source.indexOf("if (type === PROPERTY_LOCK_WS_LOCK_STATE) {");
  const lockStateEnd = source.indexOf("if (type === PROPERTY_LOCK_WS_DISCONNECT_WARNING) {", lockStateStart);
  const lockStateSource = source.slice(lockStateStart, lockStateEnd);
  assert.ok(lockStateStart > -1);
  assert.ok(lockStateEnd > lockStateStart);
  assert.match(lockStateSource, /const becameEditor = \(!previousState \|\| !previousState\.isEditor\) && serverMessage\.isEditor;/);
  assert.match(lockStateSource, /if \(!serverMessage\.isEditor && !serverMessage\.isSameUserEditor\) \{/);
  assert.match(lockStateSource, /if \(becameEditor\) \{[\s\S]*?runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
  assert.match(lockStateSource, /\} else if \(serverMessage\.isEditor\) \{[\s\S]*?runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
  assert.doesNotMatch(lockStateSource, /\} else if \(serverMessage\.isEditor\) \{[\s\S]*?silentHighlightEditorRevealKey = "";/);

  const urlWatcherStart = source.indexOf("function startSilentHighlightingUrlWatcher() {");
  const urlWatcherEnd = source.indexOf("function resetAiPreviewState()", urlWatcherStart);
  const urlWatcherSource = source.slice(urlWatcherStart, urlWatcherEnd);
  assert.ok(urlWatcherStart > -1);
  assert.ok(urlWatcherEnd > urlWatcherStart);
  assert.match(urlWatcherSource, /runPropertyLockSync\(\{\s*pageUrl:\s*lastUrl,\s*forceSiteIdRefresh:\s*true\s*\}\);/);
  assert.doesNotMatch(urlWatcherSource, /const shouldRunEditorActivation/);
  assert.doesNotMatch(urlWatcherSource, /runEditorSilentHighlightingActivation\(/);

  const urlEventStart = source.indexOf("window.addEventListener(URL_CHANGED_EVENT, () => {");
  const urlEventEnd = source.indexOf("refreshSilentHighlightings().then();", urlEventStart);
  const urlEventSource = source.slice(urlEventStart, urlEventEnd);
  assert.ok(urlEventStart > -1);
  assert.ok(urlEventEnd > urlEventStart);
  assert.match(urlEventSource, /silentHighlightEditorRevealKey = "";/);
  assert.match(urlEventSource, /runPropertyLockSync\(\{\s*forceSiteIdRefresh:\s*true\s*\}\);/);
  assert.doesNotMatch(urlEventSource, /const shouldRunEditorActivation/);
  assert.doesNotMatch(urlEventSource, /runEditorSilentHighlightingActivation\(/);

    assert.match(source, /let silentHighlightEditorActivationPromise = null;/);
    assert.match(source, /let silentHighlightEditorActivationQueued = false;/);
    assert.match(
      source,
      /async function runEditorSilentHighlightingActivation\(\) \{[\s\S]*?if \(silentHighlightEditorActivationPromise\) \{[\s\S]*?silentHighlightEditorActivationQueued = true;[\s\S]*?return silentHighlightEditorActivationPromise;[\s\S]*?\}/
    );
    assert.match(
      source,
      /const runActivationLoop = async \(\) => \{[\s\S]*?do \{[\s\S]*?silentHighlightEditorActivationQueued = false;[\s\S]*?await runEditorSilentHighlightingActivationOnce\(\);[\s\S]*?\} while \([\s\S]*?silentHighlightEditorActivationQueued[\s\S]*?\);/
    );

  const syncStart = source.indexOf("async function syncPropertyLockConnection(options = {}) {");
  const syncEnd = source.indexOf("function handlePropertyLockPortMessage(message) {", syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  assert.ok(syncStart > -1);
  assert.ok(syncEnd > syncStart);
  assert.match(syncSource, /sendPropertyLockActivity\(\);[\s\S]*?let shouldRunEditorActivation = Boolean\(propertyLockState && propertyLockState\.isEditor\);/);
  assert.match(syncSource, /if \(!shouldRunEditorActivation\) \{[\s\S]*?fetchPropertyLockStateSnapshot\(siteId\);/);
  assert.match(syncSource, /if \(shouldRunEditorActivation\) \{[\s\S]*?runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
  assert.match(syncSource, /refreshSilentHighlightings\(\)\.then\(\);/);
});

test("content exposes inspection status while reveal or reconciliation is pending", () => {
  const mainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(coreSource, /export function isPageInspectionUiActive\(\) \{/);
  assert.match(coreSource, /state\.pageInspectionNotice && !state\.pageInspectionNotice\.hidden/);
  assert.match(coreSource, /state\.inspectionBlocker/);

  const messageStart = mainSource.indexOf('if (message.type === "getInspectionStatus") {');
  const messageEnd = mainSource.indexOf('if (message.type === "hideConsentForInspection") {', messageStart);
  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  const messageSource = mainSource.slice(messageStart, messageEnd);
  assert.match(messageSource, /const pageUrl = location\.href;/);
  assert.match(messageSource, /const reconciliation = core\.getPageSaveReconciliationState\(pageUrl\);/);
  assert.match(messageSource, /const reconciliationPending = core\.isPageSaveReconciliationPending\(pageUrl\);/);
  assert.match(messageSource, /const inspectionActive = core\.isPageInspectionUiActive\(\);/);
  assert.match(messageSource, /const silentHighlightPreparationActive = Boolean\([\s\S]*?reconciliation\.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON/);
  assert.match(messageSource, /const reportedInspectionActive =[\s\S]*?inspectionActive &&[\s\S]*?!silentHighlightPreparationActive;/);
  assert.match(messageSource, /Boolean\(silentHighlightEditorActivationPromise\)/);
  assert.match(messageSource, /Boolean\(propertyLockEditorClaimPending\)/);
  assert.match(messageSource, /active: reportedInspectionActive,/);
});

test("runtime setEnabled can request an initial reveal when reload restoration re-enables marking", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const messageStart = source.indexOf('if (message.type === "setEnabled") {');
  const messageEnd = source.indexOf('if (message.type === "getInspectionStatus") {', messageStart);

  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  const messageSource = source.slice(messageStart, messageEnd);
  assert.match(messageSource, /const skipInitialReveal = !Boolean\(message\.performInitialReveal\);/);
  assert.match(messageSource, /await core\.enableForBaseUrl\(message\.baseUrl, \{ skipInitialReveal \}\);/);
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
