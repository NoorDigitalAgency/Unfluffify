import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const runtimeMessageHandlerSource = readFileSync(
  new URL("../src/content/runtime-message-handler.ts", import.meta.url),
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
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
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
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
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

test("content-main warn/error diagnostics are trace-gated", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const saveHandlerSource = readFileSync(
    new URL("../src/content/page-draft-save-handler.ts", import.meta.url),
    "utf8"
  );
  const draftSaveDepsStart = source.indexOf("function createPageDraftSaveHandlerDeps()");
  const draftSaveDepsEnd = source.indexOf("function createPageDraftStatusHandlerDeps()", draftSaveDepsStart);

  assert.match(source, /function logContentDiagnostic\(level(?:\s*:\s*[^,]+)?, \.\.\.args(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(source, /if \(!isWorldTraceEnabled\(\)\) \{\s*return;\s*\}/);
  assert.match(source, /const logger = level === "error" \? console\.error : console\.warn;/);
  assert.ok(draftSaveDepsStart > -1);
  assert.ok(draftSaveDepsEnd > draftSaveDepsStart);
  assert.match(source.slice(draftSaveDepsStart, draftSaveDepsEnd), /logContentDiagnostic:\s*\(/);
  assert.match(saveHandlerSource, /deps\.logContentDiagnostic\(\s*"warn",\s*"Failed to clear page-save reconciliation after save failure"/);
  assert.match(source, /logContentDiagnostic\("error", "Failed to enable marking from page:", error\);/);
  assert.match(source, /logContentDiagnostic\("warn", "\[Unfluffify\] Property lock sync failed; retrying\.", error\);/);
});

test("mutation observer rescans consent widgets when late DOM insertions arrive", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const start = source.indexOf("function startObservers() {");
  const end = source.indexOf("function stopObservers()", start);

  assert.ok(start > -1);
  assert.ok(end > start);
  const observerSource = source.slice(start, end);
  assert.match(observerSource, /mutation\.type === "childList"/);
  assert.match(observerSource, /hideConsentElements\(\);/);
});

test("activateContentMain keeps a legacy raw runtime reply for background bootstrap", () => {
  const branch = getMessageBranch(runtimeMessageHandlerSource, "activateContentMain");

  assert.match(branch, /sendResponse\(\{\s*ok: true,\s*initialized: true\s*\}\);/);
});

test("manual page enable waits for activation reveal before refreshing highlight state", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const toggleStart = source.search(
    /async function toggleEnabledFromPage\(options(?:\s*:\s*[^=]+)? = \{\}\)/
  );
  const toggleEnd = source.indexOf("function ensureSilentHighlightingStyles()", toggleStart);

  assert.ok(toggleStart > -1);
  assert.ok(toggleEnd > toggleStart);
  const toggleSource = source.slice(toggleStart, toggleEnd);
  assert.match(toggleSource, /try \{[\s\S]*?await core\.enableForBaseUrl\(baseUrl, \{\s*skipInitialReveal:\s*true\s*\}\);[\s\S]*?\} catch \(error\) \{[\s\S]*?core\.disable\(\);[\s\S]*?PROPERTY_LOCK_CONTENT_RELEASE[\s\S]*?showPageToast\("Unable to activate on this page"\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(toggleSource, /catch \(error\) \{[\s\S]*?await utils\.sendRuntimeMessage\(\{[\s\S]*?type:\s*"setTabState",[\s\S]*?enabled:\s*false,[\s\S]*?pageType:\s*""[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(toggleSource, /await core\.enableForBaseUrl\(baseUrl, \{\s*skipInitialReveal:\s*true\s*\}\);/);
  assert.match(toggleSource, /refreshSilentHighlightings\(\)\.then\(\);/);
  const enableIndex = toggleSource.indexOf("await core.enableForBaseUrl(baseUrl, { skipInitialReveal: true });");
  const refreshIndex = toggleSource.indexOf("refreshSilentHighlightings().then();", enableIndex);
  assert.ok(
    enableIndex > -1 && refreshIndex > enableIndex
  );
});

test("editor reveal waits for render-mode inspection to clear and confirmed mode before running", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const activationStart = source.indexOf("async function runEditorSilentHighlightingActivationOnce() {");
  const activationEnd = source.indexOf("function ensureSilentHighlightOverlay()", activationStart);

  assert.ok(activationStart > -1);
  assert.ok(activationEnd > activationStart);
  const activationSource = source.slice(activationStart, activationEnd);
  assert.match(
    activationSource,
    /if \(!shouldRunSilentHighlightEditorActivation\(\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    activationSource,
    /if \(!isRenderModeConfirmedForBaseUrl\(baseUrl, configs\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
});

test("runtime setEnabled can request an initial reveal when reload restoration re-enables marking", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const messageStart = runtimeMessageHandlerSource.indexOf('if (message.type === "setEnabled") {');
  const messageEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "getInspectionStatus") {', messageStart);
  const handlerStart = source.search(/async function handleSetEnabledCommand\(message(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const handlerEnd = source.indexOf("function handleGetInspectionStatusCommand() {", handlerStart);

  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  assert.ok(handlerStart > -1);
  assert.ok(handlerEnd > handlerStart);
  const messageSource = runtimeMessageHandlerSource.slice(messageStart, messageEnd);
  const handlerSource = source.slice(handlerStart, handlerEnd);
  assert.match(messageSource, /deps\.handleSetEnabledCommand\(message\)/);
  assert.match(handlerSource, /const shouldPerformInitialReveal = Boolean\([\s\S]*?message\.performInitialReveal &&[\s\S]*?consumePageVisitRevealFreezeAttempt\((?:message\.baseUrl|baseUrl), location\.href\)[\s\S]*?\);/);
  assert.match(handlerSource, /const skipInitialReveal = !shouldPerformInitialReveal;/);
  assert.match(handlerSource, /await core\.enableForBaseUrl\((?:message\.baseUrl|baseUrl), \{ skipInitialReveal \}\);[\s\S]*?if \(shouldPerformInitialReveal\) \{[\s\S]*?markSilentHighlightEditorRevealPrepared\((?:message\.baseUrl|baseUrl), location\.href\);/);
});

test("AI submission collector guards implicit excluded ancestors with a visible markable descendant", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
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
    new URL("../src/content/capture-page-snapshot-handler.ts", import.meta.url),
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
