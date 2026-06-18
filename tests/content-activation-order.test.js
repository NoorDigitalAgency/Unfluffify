import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const runtimeMessageHandlerSource = readFileSync(
  new URL("../content/runtime-message-handler.ts", import.meta.url),
  "utf8"
);

function getMessageBranch(source, messageType) {
  const start = source.indexOf(`if (message.type === "${messageType}") {`);
  assert.ok(start > -1, `missing ${messageType} branch`);
  const blockStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated ${messageType} branch`);
}

function assertAsyncBranchHasFailureResponse(source, messageType, delegatePattern) {
  const branch = getMessageBranch(source, messageType);
  assert.match(branch, delegatePattern);
  assert.match(
    branch,
    /\.catch\(\(\) => \{\s*sendResponse\(\{ ok: false \}\);\s*\}\);/,
    `${messageType} should answer ok false when delegated async work rejects`
  );
}

test("refreshFromTabState restores enabled pages without re-running reveal/freeze", () => {
  const source = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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

test("content loader and consent scroll restore avoid production page-console logs", () => {
  const loaderSource = readFileSync(new URL("../content-loader.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const restoreStart = coreSource.indexOf("function restorePageScrolling() {");
  const restoreEnd = coreSource.indexOf("function hideConsentOnEnable(pageUrl)", restoreStart);

  assert.ok(restoreStart > -1);
  assert.ok(restoreEnd > restoreStart);
  assert.doesNotMatch(loaderSource, /console\.(log|info|warn|error|debug)\(/);
  assert.doesNotMatch(coreSource.slice(restoreStart, restoreEnd), /console\.(log|info|warn|error|debug)\(/);
});

test("mutation observer rescans consent widgets when late DOM insertions arrive", () => {
  const source = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const start = source.indexOf("function startObservers() {");
  const end = source.indexOf("function stopObservers()", start);

  assert.ok(start > -1);
  assert.ok(end > start);
  const observerSource = source.slice(start, end);
  assert.match(observerSource, /mutation\.type === "childList"/);
  assert.match(observerSource, /hideConsentElements\(\);/);
});

test("content-main warn/error diagnostics are trace-gated", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const saveHandlerSource = readFileSync(
    new URL("../content/page-draft-save-handler.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /function logContentDiagnostic\(level, \.\.\.args\) \{/);
  assert.match(source, /if \(!isWorldTraceEnabled\(\)\) \{\s*return;\s*\}/);
  assert.match(source, /const logger = level === "error" \? console\.error : console\.warn;/);
  assert.match(source, /logContentDiagnostic,/);
  assert.match(saveHandlerSource, /deps\.logContentDiagnostic\(\s*"warn",\s*"Failed to clear page-save reconciliation after save failure"/);
  assert.match(source, /logContentDiagnostic\("error", "Failed to enable marking from page:", error\);/);
  assert.match(source, /logContentDiagnostic\("warn", "\[Unfluffify\] Property lock sync failed; retrying\.", error\);/);
});

test("manual page enable waits for activation reveal before refreshing highlight state", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const toggleStart = source.indexOf("async function toggleEnabledFromPage(options = {})");
  const toggleEnd = source.indexOf("function ensureSilentHighlightingStyles()", toggleStart);

  assert.ok(toggleStart > -1);
  assert.ok(toggleEnd > toggleStart);
  const toggleSource = source.slice(toggleStart, toggleEnd);
  assert.match(toggleSource, /try \{[\s\S]*?await core\.enableForBaseUrl\(baseUrl, \{\s*skipInitialReveal:\s*true\s*\}\);[\s\S]*?\} catch \(error\) \{[\s\S]*?core\.disable\(\);[\s\S]*?PROPERTY_LOCK_CONTENT_RELEASE[\s\S]*?showPageToast\("Unable to activate on this page"\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(toggleSource, /refreshSilentHighlightings\(\)\.then\(\);/);
});

test("reveal activation starts on becameEditor transition and not on marking enable", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const stateMachineSource = readFileSync(new URL("../content/property-lock-state-machine.ts", import.meta.url), "utf8");

  const messageStart = runtimeMessageHandlerSource.indexOf("if (message.type === \"setEnabled\") {");
  const messageEnd = runtimeMessageHandlerSource.indexOf("if (message.type === \"getInspectionStatus\") {", messageStart);
  const messageSource = runtimeMessageHandlerSource.slice(messageStart, messageEnd);
  const handlerStart = source.indexOf("async function handleSetEnabledCommand(message = {}) {");
  const handlerEnd = source.indexOf("function handleGetInspectionStatusCommand() {", handlerStart);
  const handlerSource = source.slice(handlerStart, handlerEnd);
  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  assert.ok(handlerStart > -1);
  assert.ok(handlerEnd > handlerStart);
  assert.match(messageSource, /deps\.handleSetEnabledCommand\(message\)/);
  assert.match(handlerSource, /const shouldPerformInitialReveal = Boolean\([\s\S]*?message\.performInitialReveal &&[\s\S]*?consumePageVisitRevealFreezeAttempt\(message\.baseUrl, location\.href\)[\s\S]*?\);/);
  assert.match(handlerSource, /const skipInitialReveal = !shouldPerformInitialReveal;/);
  assert.match(handlerSource, /await core\.enableForBaseUrl\(message\.baseUrl, \{ skipInitialReveal \}\);[\s\S]*?if \(shouldPerformInitialReveal\) \{[\s\S]*?markSilentHighlightEditorRevealPrepared\(message\.baseUrl, location\.href\);/);
  assert.doesNotMatch(messageSource, /warmupPageRevealBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /warmupSilentHighlightingBeforeMotionPause\(/);
  assert.doesNotMatch(messageSource, /runEditorSilentHighlightingActivation\(/);

  const lockStateStart = stateMachineSource.indexOf("if (type === deps.PROPERTY_LOCK_WS_LOCK_STATE) {");
  const lockStateEnd = stateMachineSource.indexOf("if (type === deps.PROPERTY_LOCK_WS_DISCONNECT_WARNING) {", lockStateStart);
  const lockStateSource = stateMachineSource.slice(lockStateStart, lockStateEnd);
  assert.ok(lockStateStart > -1);
  assert.ok(lockStateEnd > lockStateStart);
  assert.match(lockStateSource, /const becameEditor = \(!previousState \|\| !previousState\.isEditor\) && serverMessage\.isEditor;/);
  assert.match(lockStateSource, /if \(!serverMessage\.isEditor && !serverMessage\.isSameUserEditor\) \{/);
  assert.match(lockStateSource, /if \(becameEditor\) \{[\s\S]*?deps\.runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
  assert.match(lockStateSource, /\} else if \(serverMessage\.isEditor\) \{[\s\S]*?deps\.runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/);
  assert.doesNotMatch(lockStateSource, /\} else if \(serverMessage\.isEditor\) \{[\s\S]*?silentHighlightEditorRevealKey = "";/);

  const urlWatcherStart = source.indexOf("function startSilentHighlightingUrlWatcher() {");
  const urlWatcherEnd = source.indexOf("function resetAiPreviewState()", urlWatcherStart);
  const urlWatcherSource = source.slice(urlWatcherStart, urlWatcherEnd);
  assert.ok(urlWatcherStart > -1);
  assert.ok(urlWatcherEnd > urlWatcherStart);
  assert.match(urlWatcherSource, /resetPageVisitRevealFreezeKeys\(\);[\s\S]*?runPropertyLockSync\(\{\s*pageUrl:\s*lastUrl,\s*forceSiteIdRefresh:\s*true\s*\}\);/);
  assert.doesNotMatch(urlWatcherSource, /const shouldRunEditorActivation/);
  assert.doesNotMatch(urlWatcherSource, /runEditorSilentHighlightingActivation\(/);

  const urlEventStart = source.indexOf("window.addEventListener(URL_CHANGED_EVENT, () => {");
  const urlEventEnd = source.indexOf("refreshSilentHighlightings().then();", urlEventStart);
  const urlEventSource = source.slice(urlEventStart, urlEventEnd);
  assert.ok(urlEventStart > -1);
  assert.ok(urlEventEnd > urlEventStart);
  assert.match(urlEventSource, /resetPageVisitRevealFreezeKeys\(\);/);
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
      /const runActivationLoop = async \(\) => \{[\s\S]*?do \{[\s\S]*?silentHighlightEditorActivationQueued = false;[\s\S]*?await runEditorSilentHighlightingActivationOnce\(\);[\s\S]*?\} while \([\s\S]*?silentHighlightEditorActivationQueued &&[\s\S]*?shouldRunSilentHighlightEditorActivation\(\)[\s\S]*?\);/
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
  const mainSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const inspectionStatusSource = readFileSync(new URL("../content/inspection-status.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(coreSource, /export function isPageInspectionUiActive\(\) \{/);
  assert.match(coreSource, /state\.pageInspectionNotice && !state\.pageInspectionNotice\.hidden/);
  assert.match(coreSource, /state\.inspectionBlocker/);

  const messageStart = runtimeMessageHandlerSource.indexOf('if (message.type === "getInspectionStatus") {');
  const messageEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "hideConsentForInspection") {', messageStart);
  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  const messageSource = runtimeMessageHandlerSource.slice(messageStart, messageEnd);
  assert.match(messageSource, /sendResponse\(deps\.handleGetInspectionStatusCommand\(\)\);/);

  const handlerStart = mainSource.indexOf("function handleGetInspectionStatusCommand() {");
  const handlerEnd = mainSource.indexOf("function handleRenderModeInspectionBeginCommand", handlerStart);
  assert.ok(handlerStart > -1);
  assert.ok(handlerEnd > handlerStart);
  const handlerSource = mainSource.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /return getInspectionStatusResolver\(\)\.resolve\(\);/);

  assert.match(inspectionStatusSource, /const pageUrl = deps\.getPageUrl\(\);/);
  assert.match(inspectionStatusSource, /const reconciliation = deps\.getPageSaveReconciliationState\(pageUrl\);/);
  assert.match(inspectionStatusSource, /const reconciliationPending = deps\.isPageSaveReconciliationPending\(pageUrl\);/);
  assert.match(inspectionStatusSource, /const inspectionActive = deps\.isPageInspectionUiActive\(\);/);
  assert.match(inspectionStatusSource, /const silentHighlightPreparationActive = Boolean\([\s\S]*?reconciliation\.reason === deps\.SILENT_HIGHLIGHTING_PREPARATION_REASON/);
  const editorPreparationBlock = inspectionStatusSource.match(/const editorPreparationPending = Boolean\([\s\S]*?\);/);
  assert.ok(editorPreparationBlock);
  assert.match(editorPreparationBlock[0], /silentHighlightPreparationActive \|\|[\s\S]*?getSilentHighlightEditorActivationPromise/);
  assert.doesNotMatch(editorPreparationBlock[0], /propertyLockEditorClaimPending/);
  assert.match(inspectionStatusSource, /const lockClaimPending = Boolean\(deps\.getPropertyLockEditorClaimPending\(\)\);/);
  assert.match(inspectionStatusSource, /const inspectionPending = inspectionActive \|\| editorPreparationPending \|\| reconciliationPending;/);
  assert.match(inspectionStatusSource, /deps\.getSilentHighlightEditorActivationPromise\(\)/);
  assert.match(inspectionStatusSource, /lockClaimPending,/);
  assert.match(inspectionStatusSource, /active: inspectionActive,/);
  assert.match(inspectionStatusSource, /pendingReason: reconciliation && \(reconciliationPending \|\| editorPreparationPending\)/);
});

test("editor reveal is gated during render-mode inspection or before render mode is confirmed", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const activationStart = source.indexOf("async function runEditorSilentHighlightingActivationOnce() {");
  const activationEnd = source.indexOf("function ensureSilentHighlightOverlay()", activationStart);

  assert.ok(activationStart > -1);
  assert.ok(activationEnd > activationStart);
  const activationSource = source.slice(activationStart, activationEnd);
  assert.match(source, /function isRenderModeInspectionActive\(\) \{[\s\S]*?renderModeInspectionActive \|\| readRenderModeInspectionActive\(\)/);
  assert.match(source, /function shouldRunSilentHighlightEditorActivation\(\) \{[\s\S]*?!isPropertyLockCollaborationEnabled\(\)[\s\S]*?return true;[\s\S]*?propertyLockState && propertyLockState\.isEditor/);
  assert.match(
    activationSource,
    /if \(!shouldRunSilentHighlightEditorActivation\(\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.doesNotMatch(
    activationSource,
    /if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?setRenderModeInspectionActive\(true\);/
  );
  assert.match(
    activationSource,
    /if \(!isRenderModeConfirmedForBaseUrl\(baseUrl, configs\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    activationSource,
    /const pageTypeResult = await resolveCurrentPageTypeForMarking\(baseUrl, pageUrl\);[\s\S]*?if \(!pageTypeResult\.ok \|\| !pageTypeResult\.pageType\) \{[\s\S]*?resetPageVisitRevealFreezeKeys\(\);[\s\S]*?shouldRefreshAfterActivation = true;[\s\S]*?return;[\s\S]*?\}/
  );
  const inspectionGuardIndex = activationSource.indexOf("isRenderModeInspectionActive()");
  const confirmedGuardIndex = activationSource.indexOf("!isRenderModeConfirmedForBaseUrl(baseUrl, configs)");
  const candidateGuardIndex = activationSource.indexOf("resolveCurrentPageTypeForMarking(baseUrl, pageUrl)");
  const warmupIndex = activationSource.indexOf("warmupSilentHighlightingBeforeMotionPause");
  const activationAllowedIndex = activationSource.indexOf("!shouldRunSilentHighlightEditorActivation()");
  assert.ok(activationAllowedIndex > -1);
  assert.ok(inspectionGuardIndex > -1);
  assert.ok(inspectionGuardIndex > activationAllowedIndex);
  assert.ok(confirmedGuardIndex > inspectionGuardIndex);
  assert.ok(candidateGuardIndex > confirmedGuardIndex);
  assert.ok(warmupIndex > candidateGuardIndex);
});

test("runtime setEnabled can request an initial reveal when reload restoration re-enables marking", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const messageStart = runtimeMessageHandlerSource.indexOf('if (message.type === "setEnabled") {');
  const messageEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "getInspectionStatus") {', messageStart);
  const handlerStart = source.indexOf("async function handleSetEnabledCommand(message = {}) {");
  const handlerEnd = source.indexOf("function handleGetInspectionStatusCommand() {", handlerStart);

  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  assert.ok(handlerStart > -1);
  assert.ok(handlerEnd > handlerStart);
  const messageSource = runtimeMessageHandlerSource.slice(messageStart, messageEnd);
  const handlerSource = source.slice(handlerStart, handlerEnd);
  assert.match(messageSource, /deps\.handleSetEnabledCommand\(message\)/);
  assert.match(handlerSource, /const shouldPerformInitialReveal = Boolean\([\s\S]*?message\.performInitialReveal &&[\s\S]*?consumePageVisitRevealFreezeAttempt\(message\.baseUrl, location\.href\)[\s\S]*?\);/);
  assert.match(handlerSource, /const skipInitialReveal = !shouldPerformInitialReveal;/);
  assert.match(handlerSource, /await core\.enableForBaseUrl\(message\.baseUrl, \{ skipInitialReveal \}\);[\s\S]*?if \(shouldPerformInitialReveal\) \{[\s\S]*?markSilentHighlightEditorRevealPrepared\(message\.baseUrl, location\.href\);/);
});

test("capturePageSnapshot collects AI submission rows from the target config", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const captureHandlerSource = readFileSync(
    new URL("../content/capture-page-snapshot-handler.ts", import.meta.url),
    "utf8"
  );
  const collectorStart = source.indexOf("function collectAiSubmissionXpathsForCurrentPage");
  const collectorEnd = source.indexOf("function refreshEnabledAiHighlights", collectorStart);
  const captureStart = runtimeMessageHandlerSource.indexOf('if (message.type === "capturePageSnapshot") {');
  const captureEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "getPageDraftStatus") {', captureStart);

  assert.ok(collectorStart > -1);
  assert.ok(collectorEnd > collectorStart);
  assert.ok(captureStart > -1);
  assert.ok(captureEnd > captureStart);
  const collectorSource = source.slice(collectorStart, collectorEnd);
  const captureSource = runtimeMessageHandlerSource.slice(captureStart, captureEnd);

  assert.match(collectorSource, /function collectAiSubmissionXpathsForCurrentPage\(sourceConfig = state\.config\) \{/);
  assert.match(collectorSource, /const configValue = sourceConfig \|\| state\.config;/);
  assert.match(collectorSource, /core\.getPageMarkingEntry\(configValue, pageUrl, \{/);
  assert.match(collectorSource, /core\.isMarkableElement\(node, configValue, \{/);
  assert.match(captureSource, /deps\.getCapturePageSnapshotHandler\(\)\.capture\(/);
  assert.match(captureHandlerSource, /entry\.submissionXpaths = deps\.collectAiSubmissionXpathsForCurrentPage\(config\);/);
});

test("AI submission collector guards implicit excluded ancestors with a visible markable descendant", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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
  const captureHandlerSource = readFileSync(
    new URL("../content/capture-page-snapshot-handler.ts", import.meta.url),
    "utf8"
  );
  const captureStart = runtimeMessageHandlerSource.indexOf('if (message.type === "capturePageSnapshot") {');
  const captureEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "getPageDraftStatus") {', captureStart);

  assert.ok(captureStart > -1);
  assert.ok(captureEnd > captureStart);
  const captureSource = runtimeMessageHandlerSource.slice(captureStart, captureEnd);
  assert.match(captureSource, /deps\.getCapturePageSnapshotHandler\(\)\.capture\(/);
  assert.match(captureHandlerSource, /entry\.renderedHtml = snapshot\.renderedHtml;/);
  assert.match(captureHandlerSource, /entry\.rawHtml = typeof rawHtml === "string"/);
  assert.match(captureHandlerSource, /entry\.submissionXpaths = deps\.collectAiSubmissionXpathsForCurrentPage\(config\);/);
  assert.match(captureHandlerSource, /await deps\.saveConfig\(targetBaseUrl, config\);/);
  assert.match(captureSource, /sendResponse\(response && typeof response === "object" \? response : \{ ok: false \}\);/);
  const successResponseStart = captureSource.lastIndexOf("sendResponse(response && typeof response === \"object\" ? response : { ok: false });");
  const successResponse = captureSource.slice(successResponseStart);
  assert.doesNotMatch(successResponse, /renderedHtml|rawHtml|submissionXpaths|pageMarkings|xpaths/);
});

test("async content message branches answer ok false when delegated work rejects", () => {
  const source = runtimeMessageHandlerSource;

  assertAsyncBranchHasFailureResponse(
    source,
    "forceRefresh",
    /deps\.getForceRefreshHandler\(\)\.handleMessage\(\)/
  );
  assertAsyncBranchHasFailureResponse(
    source,
    "collectPageData",
    /deps\.getCollectPageDataHandler\(\)\.handleMessage\(message\)/
  );
  assertAsyncBranchHasFailureResponse(
    source,
    "capturePageSnapshot",
    /deps\.getCapturePageSnapshotHandler\(\)\.capture\(\{/
  );
  assertAsyncBranchHasFailureResponse(
    source,
    "savePageDraft",
    /deps\.getPageDraftSaveHandler\(\)\.saveCurrentPageDraft\(\{/
  );
});

test("silent-highlight mutation observer uses an O(1) tracked-node index instead of a per-call scan", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function refreshSilentHighlightings() {");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}\n", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  // The source-set collection runs inside the shared element-computation cache
  // (memoizes visibility/text/immutable lookups across the deep helper graph),
  // and between it and the renderable-collections build there is a
  // setTimeout(0) task break that re-checks the generation token so a newer
  // refresh that started during source collection wins.
  const collectIdx = fnSource.indexOf("const contentMarking = core.withElementComputationCache(() =>");
  assert.ok(collectIdx > -1);
  const between0 = fnSource.slice(collectIdx);
  assert.match(between0, /collectIncludedNodesFromSelectorSet\(effectiveSelectorSet\)/);
  const buildIdx = fnSource.indexOf("renderCollections = buildSilentHighlightRenderableCollections({", collectIdx);
  assert.ok(buildIdx > collectIdx);
  const between = fnSource.slice(collectIdx, buildIdx);
  assert.match(between, /await new Promise\(\(resolve\) => \{[\s\S]*?window\.setTimeout\(resolve, 0\);[\s\S]*?\}\);/);
  assert.match(between, /if \(refreshGeneration !== silentHighlightingRefreshGeneration\) \{\s*return;\s*\}/);
});

test("collectIncludedNodesFromSelectorSet memoizes core.isVisible per call", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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

test("silent-highlight collection runs inside the shared element-computation cache (sub-6)", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  // Both full-page collection call sites (refresh + preview) wrap the
  // synchronous collector in core.withElementComputationCache so the deep
  // helper graph memoizes visibility/text/immutable lookups per pass.
  const wrappedCalls = source.match(
    /core\.withElementComputationCache\(\(\) =>\s*\n?\s*collectIncludedNodesFromSelectorSet\(/g
  ) || [];
  assert.ok(
    wrappedCalls.length >= 2,
    `expected both collector call sites wrapped in the computation cache; saw ${wrappedCalls.length}`
  );

  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  assert.match(coreSource, /export function withElementComputationCache\(callback\) \{/);
});

test("silent-highlight observer demotes class mutations on non-tracked targets to reposition", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
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

test("URL watcher disables marking on navigation without preserving a draft cache", () => {
  const source = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const watcherStart = source.indexOf("function startUrlWatcher() {");
  const watcherEnd = source.indexOf("function stopUrlWatcher()", watcherStart);

  assert.ok(watcherStart > -1);
  assert.ok(watcherEnd > watcherStart);
  const watcherSource = source.slice(watcherStart, watcherEnd);
  // The cross-navigation unsaved-draft cache was removed: each marking enable
  // starts fresh, so the watcher must not consult any preservation predicate.
  assert.doesNotMatch(source, /function shouldPreserveDraftCacheForUrlChange/);
  assert.doesNotMatch(source, /preserveUnsavedDraftCache/);
  assert.match(
    source,
    /export function handleUrlWatcherTransition\(previousUrl, nextUrl\) \{[\s\S]*?disable\(\{ pageUrl: previousUrl \}\);[\s\S]*?\}/
  );
  assert.match(watcherSource, /const previousUrl = lastUrl;/);
  assert.match(watcherSource, /const nextUrl = location\.href;/);
  assert.match(watcherSource, /handleUrlWatcherTransition\(previousUrl, nextUrl\);/);
  assert.match(watcherSource, /window\.dispatchEvent\(new Event\("unfluffify:url-changed"\)\);/);
});
