import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("refreshFromTabState restores enabled pages without re-running reveal/freeze", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshStart = source.indexOf("export async function refreshFromTabState(options = {})");
  const refreshEnd = source.indexOf("export function syncPageMarkings", refreshStart);

  assert.ok(refreshStart > -1);
  assert.ok(refreshEnd > refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /state\.enabled = true;/);
  assert.match(refreshSource, /state\.consentRootElements = new Set\(\);/);
  assert.match(refreshSource, /hideConsentOnEnable\(pageUrl\);/);
  assert.match(refreshSource, /scheduleRender\(\);[\s\S]*?startObservers\(\);[\s\S]*?startUrlWatcher\(\);/);
  // Reveal/freeze is bound to the silent-highlight activation gate (and manual
  // enable) only; the marking-restore path must not run it.
  assert.doesNotMatch(refreshSource, /warmupPageRevealBeforeMotionPause\(/);
  assert.doesNotMatch(refreshSource, /finishPageInspectionUiAfterRender\(/);
  assert.doesNotMatch(refreshSource, /withInitialReveal/);
});

test("main restores tab state then refreshes highlight state without an initial reveal", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const mainStart = source.indexOf("export function main()");
  const mainEnd = source.indexOf("document.addEventListener(\"keydown\"", mainStart);

  assert.ok(mainStart > -1);
  assert.ok(mainEnd > mainStart);
  const mainSource = source.slice(mainStart, mainEnd);
  assert.match(mainSource, /core\.refreshFromTabState\(\)\.then\(async \(\) => \{/);
  assert.doesNotMatch(mainSource, /withInitialReveal/);
  const refreshIndex = mainSource.indexOf("core.refreshFromTabState().then(async () => {");
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
  const messageEnd = source.indexOf("if (message.type === \"getInspectionStatus\") {", messageStart);
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
  const editorPreparationBlock = messageSource.match(
    /const editorPreparationPending = Boolean\([\s\S]*?\n      \);/
  );
  assert.ok(editorPreparationBlock);
  assert.match(editorPreparationBlock[0], /silentHighlightPreparationActive \|\|[\s\S]*?silentHighlightEditorActivationPromise/);
  assert.doesNotMatch(editorPreparationBlock[0], /propertyLockEditorClaimPending/);
  assert.match(messageSource, /const lockClaimPending = Boolean\(propertyLockEditorClaimPending\);/);
  assert.match(messageSource, /const inspectionPending =[\s\S]*?inspectionActive \|\|[\s\S]*?editorPreparationPending \|\|[\s\S]*?reconciliationPending;/);
  assert.match(messageSource, /silentHighlightEditorActivationPromise/);
  assert.match(messageSource, /lockClaimPending,/);
  assert.match(messageSource, /active: inspectionActive,/);
  assert.match(messageSource, /pendingReason: reconciliation && \(reconciliationPending \|\| editorPreparationPending\)/);
});

test("editor reveal is gated during render-mode inspection or before render mode is confirmed", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const activationStart = source.indexOf("async function runEditorSilentHighlightingActivationOnce() {");
  const activationEnd = source.indexOf("function ensureSilentHighlightOverlay()", activationStart);

  assert.ok(activationStart > -1);
  assert.ok(activationEnd > activationStart);
  const activationSource = source.slice(activationStart, activationEnd);
  assert.match(source, /function isRenderModeInspectionActive\(\) \{[\s\S]*?renderModeInspectionActive \|\| readRenderModeInspectionActive\(\)/);
  assert.match(
    activationSource,
    /if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?setRenderModeInspectionActive\(true\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    activationSource,
    /if \(!isRenderModeConfirmedForBaseUrl\(baseUrl, configs\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  const inspectionGuardIndex = activationSource.indexOf("isRenderModeInspectionActive()");
  const confirmedGuardIndex = activationSource.indexOf("!isRenderModeConfirmedForBaseUrl(baseUrl, configs)");
  const warmupIndex = activationSource.indexOf("warmupSilentHighlightingBeforeMotionPause");
  assert.ok(inspectionGuardIndex > -1);
  assert.ok(confirmedGuardIndex > inspectionGuardIndex);
  assert.ok(warmupIndex > confirmedGuardIndex);
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

test("capturePageSnapshot collects AI submission rows from the target config", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const collectorStart = source.indexOf("function collectAiSubmissionXpathsForCurrentPage");
  const collectorEnd = source.indexOf("function refreshEnabledAiHighlights", collectorStart);
  const captureStart = source.indexOf('if (message.type === "capturePageSnapshot") {');
  const captureEnd = source.indexOf('if (message.type === "getPageDraftStatus") {', captureStart);

  assert.ok(collectorStart > -1);
  assert.ok(collectorEnd > collectorStart);
  assert.ok(captureStart > -1);
  assert.ok(captureEnd > captureStart);
  const collectorSource = source.slice(collectorStart, collectorEnd);
  const captureSource = source.slice(captureStart, captureEnd);

  assert.match(collectorSource, /function collectAiSubmissionXpathsForCurrentPage\(sourceConfig = state\.config\) \{/);
  assert.match(collectorSource, /const configValue = sourceConfig \|\| state\.config;/);
  assert.match(collectorSource, /core\.getPageMarkingEntry\(configValue, pageUrl, \{/);
  assert.match(collectorSource, /core\.isMarkableElement\(node, configValue, \{/);
  assert.match(captureSource, /entry\.submissionXpaths = collectAiSubmissionXpathsForCurrentPage\(config\);/);
});

test("AI submission collector guards implicit excluded ancestors with a visible markable descendant", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const collectorStart = source.indexOf("function collectAiSubmissionXpathsForCurrentPage");
  const collectorEnd = source.indexOf("function refreshEnabledAiHighlights", collectorStart);
  assert.ok(collectorStart > -1 && collectorEnd > collectorStart);
  const collectorSource = source.slice(collectorStart, collectorEnd);
  assert.match(
    collectorSource,
    /hasVisibleMarkableTextualSubmissionDescendant\(node, configValue\)/
  );
  assert.match(
    collectorSource,
    /submissionRow\.excluded &&\s*!explicitlyExcluded &&\s*!insideExcludedAncestorRow &&\s*hasVisibleMarkableTextualSubmissionDescendant/
  );
  const helperStart = source.indexOf("function hasVisibleMarkableTextualSubmissionDescendant");
  assert.ok(helperStart > -1);
  const helperEnd = source.indexOf("\n}\n", helperStart);
  assert.ok(helperEnd > helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /core\.isVisibleForSubmission\(node\)/);
  assert.match(helperSource, /core\.isMarkableElement\(node, configValue, \{/);
  assert.match(helperSource, /core\.isImmutableExcludedElement\(node\)/);
});

test("capturePageSnapshot persists heavy snapshot evidence without returning it", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const captureStart = source.indexOf('if (message.type === "capturePageSnapshot") {');
  const captureEnd = source.indexOf('if (message.type === "getPageDraftStatus") {', captureStart);

  assert.ok(captureStart > -1);
  assert.ok(captureEnd > captureStart);
  const captureSource = source.slice(captureStart, captureEnd);
  assert.match(captureSource, /entry\.renderedHtml = snapshot\.renderedHtml;/);
  assert.match(captureSource, /entry\.rawHtml = typeof rawHtml === "string"/);
  assert.match(captureSource, /entry\.submissionXpaths = collectAiSubmissionXpathsForCurrentPage\(config\);/);
  assert.match(captureSource, /await core\.saveConfig\(targetBaseUrl, config\);/);
  assert.match(captureSource, /sendResponse\(\{ ok: true \}\);/);
  const successResponseStart = captureSource.lastIndexOf("sendResponse({ ok: true });");
  const successResponse = captureSource.slice(successResponseStart);
  assert.doesNotMatch(successResponse, /renderedHtml|rawHtml|submissionXpaths|pageMarkings|xpaths/);
});

test("silent-highlight mutation observer uses an O(1) tracked-node index instead of a per-call scan", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  // Module-scope index, reset alongside the render-target cache.
  assert.match(source, /let silentHighlightTrackedNodeIndex = null;/);
  const indexResetMatches = source.match(/silentHighlightTrackedNodeIndex = null;/g) || [];
  assert.ok(
    indexResetMatches.length >= 3, // declaration + 2 collection-rebuild reset sites
    `expected the tracked-node index to be cleared at every collections-rebuild site; saw ${indexResetMatches.length}`
  );

  // The mutation predicate uses Set.has lookups (tracked + ancestors) and walks
  // the target's ancestor chain at most once — no spread reconstruction of all
  // tracked arrays per call.
  const fnStart = source.indexOf("function mutationTargetTouchesSilentCollections");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}\n", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);
  assert.match(fnSource, /tracked\.has\(target\)/);
  assert.match(fnSource, /ancestors\.has\(target\)/);
  assert.match(fnSource, /tracked\.has\(cursor\)/);
  assert.doesNotMatch(fnSource, /\.\.\.\(silentHighlightCollections\./);
  assert.doesNotMatch(fnSource, /\.contains\(target\)/);
});

test("silent-highlight reposition reuses cached render targets between settle samples", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  // Cache state exists at module scope.
  assert.match(source, /let silentHighlightRenderTargetCache = new Map\(\);/);

  // Signature builder reads from the cache on hit, populates it on miss.
  const sigStart = source.indexOf("function buildSilentHighlightPositionSignature");
  assert.ok(sigStart > -1);
  const sigEnd = source.indexOf("\n}\n", sigStart);
  const sigSource = source.slice(sigStart, sigEnd);
  assert.match(sigSource, /silentHighlightRenderTargetCache\.get\(node\)/);
  assert.match(sigSource, /silentHighlightRenderTargetCache\.set\(node, targets\)/);

  // Cache is reset at both lifecycle points that replace silentHighlightCollections:
  // the overlay tear-down path and the overlay render path.
  const resetMatches = source.match(/silentHighlightRenderTargetCache = new Map\(\);/g) || [];
  assert.ok(
    resetMatches.length >= 2,
    `expected cache to be reset on both collections rebuild sites; saw ${resetMatches.length}`
  );
});

test("refreshSilentHighlightings yields between source-set collection and renderable expansion", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function refreshSilentHighlightings() {");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}\n", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  // Between collectIncludedNodesFromSelectorSet and the renderable-collections
  // build there is a setTimeout(0) task break that re-checks the generation
  // token so a newer refresh that started during source collection wins.
  const collectIdx = fnSource.indexOf("const contentMarking = collectIncludedNodesFromSelectorSet(");
  assert.ok(collectIdx > -1);
  const buildIdx = fnSource.indexOf("renderCollections = buildSilentHighlightRenderableCollections({", collectIdx);
  assert.ok(buildIdx > collectIdx);
  const between = fnSource.slice(collectIdx, buildIdx);
  assert.match(between, /await new Promise\(\(resolve\) => \{[\s\S]*?window\.setTimeout\(resolve, 0\);[\s\S]*?\}\);/);
  assert.match(between, /if \(refreshGeneration !== silentHighlightingRefreshGeneration\) \{\s*return;\s*\}/);
});

test("collectIncludedNodesFromSelectorSet memoizes core.isVisible per call", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const fnStart = source.indexOf("function collectIncludedNodesFromSelectorSet(");
  assert.ok(fnStart > -1);
  // Use the next top-level `let` declaration (silentRenderNodeIdCounter) as the
  // function end boundary — it sits immediately after the function.
  const fnEnd = source.indexOf("let silentRenderNodeIdCounter", fnStart);
  assert.ok(fnEnd > fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  // Local WeakMap + memoized wrapper for repeated visibility lookups inside the
  // explicit-include and final-include filters.
  assert.match(fnSource, /const visibilityMemo = new WeakMap\(\);/);
  assert.match(fnSource, /const memoIsVisible = \(node\) => \{/);
  assert.match(fnSource, /isIncludedNodeAvailableForUser = \(node\) =>\s*memoIsVisible\(node\)/);
});

test("silent-highlight observer demotes class mutations on non-tracked targets to reposition", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const obsStart = source.indexOf("silentHighlightingObserver = new MutationObserver(");
  assert.ok(obsStart > -1);
  const obsEnd = source.indexOf("silentHighlightingObserver.observe(", obsStart);
  const obsBody = source.slice(obsStart, obsEnd);

  // Class mutation on a tracked-touching target → full refresh.
  assert.match(
    obsBody,
    /if \(attributeName === "class"\) \{\s*if \(mutationTargetTouchesSilentCollections\(mutation\.target\)\) \{\s*needsFullRefresh = true;\s*break;\s*\}\s*needsPositionRefresh = true;/
  );
});

test("silent-highlight observer routes inline style mutations through the reposition path", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  // Inline style mutations are in the position-refresh attribute set so a
  // transform/visibility tweak on a tracked-touching node reposition-refreshes
  // instead of triggering a full-refresh stampede.
  const positionSetMatch = source.match(
    /const SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(positionSetMatch);
  const positionSetBody = positionSetMatch[1];
  assert.match(positionSetBody, /"hidden"/);
  assert.match(positionSetBody, /"aria-hidden"/);
  assert.match(positionSetBody, /"open"/);
  assert.match(positionSetBody, /"style"/);

  // The relevant-mutation set still includes "style" so the observer still
  // receives the mutation in the first place.
  const relevantSetMatch = source.match(
    /const SILENT_HIGHLIGHTING_RELEVANT_MUTATION_ATTRS = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(relevantSetMatch);
  assert.match(relevantSetMatch[1], /"style"/);
});

test("refreshSilentHighlightings yields to a paint frame before the overlay DOM write", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function refreshSilentHighlightings() {");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}\n", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  // The function packages the overlay write into an applyOverlayUpdate closure
  // and yields to requestAnimationFrame before invoking it, so paint work that
  // queued up during source collection can flush before the next DOM mutation.
  assert.match(fnSource, /const applyOverlayUpdate = \(\) => \{/);
  assert.match(fnSource, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?applyOverlayUpdate\(\);[\s\S]*?resolve\(\);[\s\S]*?\}\);/);

  // The applyOverlayUpdate closure checks the generation token before mutating
  // overlay DOM, so a stale older refresh that was waiting in the rAF queue
  // when a newer refresh started bails out instead of stomping new state.
  const closureStart = fnSource.indexOf("const applyOverlayUpdate = () => {");
  const closureEnd = fnSource.indexOf("};", closureStart);
  const closureSource = fnSource.slice(closureStart, closureEnd);
  assert.match(closureSource, /if \(refreshGeneration !== silentHighlightingRefreshGeneration\) \{\s*return;\s*\}/);

  // The no-op fast path (no render, no change) skips the rAF round trip.
  assert.match(fnSource, /if \(!shouldRenderOverlay && !renderChanged\) \{\s*applyOverlayUpdate\(\);\s*return;\s*\}/);
});

test("refreshSilentHighlightings bails out after each await when superseded by a newer call", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function refreshSilentHighlightings() {");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}\n", fnStart);
  assert.ok(fnEnd > fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  // Generation token is captured at entry, bumped on every call.
  assert.match(fnSource, /const refreshGeneration = \+\+silentHighlightingRefreshGeneration;/);

  // Each await is followed by a generation check that returns early if a newer
  // refresh has started, so the older call cannot stomp observer/overlay state.
  const awaitMatches = fnSource.match(/await /g) || [];
  assert.ok(awaitMatches.length >= 2, `expected at least 2 awaits, saw ${awaitMatches.length}`);
  const guardCount = (fnSource.match(/if \(refreshGeneration !== silentHighlightingRefreshGeneration\) \{\s*return;\s*\}/g) || []).length;
  assert.ok(
    guardCount >= awaitMatches.length,
    `expected a generation guard after every await; awaits=${awaitMatches.length} guards=${guardCount}`
  );
});

test("URL watcher preserves only dirty same-base temporary draft cache on navigation", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const watcherStart = source.indexOf("function startUrlWatcher() {");
  const watcherEnd = source.indexOf("function stopUrlWatcher()", watcherStart);

  assert.ok(watcherStart > -1);
  assert.ok(watcherEnd > watcherStart);
  const watcherSource = source.slice(watcherStart, watcherEnd);
  assert.match(source, /function shouldPreserveDraftCacheForUrlChange\(previousUrl, nextUrl\) \{/);
  assert.match(source, /utils\.isPageWithinBaseUrl\(previousUrl, state\.baseUrl\)/);
  assert.match(source, /utils\.isPageWithinBaseUrl\(nextUrl, state\.baseUrl\)/);
  assert.match(source, /return isPageDraftDirty\(previousUrl\);/);
  assert.match(
    source,
    /disable\(\{[\s\S]*?preserveUnsavedDraftCache,[\s\S]*?pageUrl: previousUrl[\s\S]*?\}\);/
  );
  assert.match(watcherSource, /const previousUrl = lastUrl;/);
  assert.match(watcherSource, /const nextUrl = location\.href;/);
  assert.match(watcherSource, /handleUrlWatcherTransition\(previousUrl, nextUrl\);/);
  assert.match(watcherSource, /window\.dispatchEvent\(new Event\("unfluffify:url-changed"\)\);/);
});
