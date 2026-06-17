import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../background/render-mode-inspector.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../popup/messages.ts", import.meta.url), "utf8");
const manifestSource = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");

test("background registers render-mode inspection commands as tab-scoped", () => {
  assert.match(backgroundSource, /TAB_BEGIN_RENDER_MODE_INSPECTION: "TAB_BEGIN_RENDER_MODE_INSPECTION"/);
  assert.match(backgroundSource, /TAB_RUN_REVEAL_FREEZE: "TAB_RUN_REVEAL_FREEZE"/);
  assert.match(backgroundSource, /TAB_CAPTURE_RENDER_MODE_HTML: "TAB_CAPTURE_RENDER_MODE_HTML"/);
  assert.match(backgroundSource, /TAB_END_RENDER_MODE_INSPECTION: "TAB_END_RENDER_MODE_INSPECTION"/);
  assert.match(backgroundSource, /TAB_RUN_RENDER_MODE_INSPECTION: "TAB_RUN_RENDER_MODE_INSPECTION"/);
  assert.match(backgroundSource, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_RUN_RENDER_MODE_INSPECTION/);
});

test("popup render mode inspection delegates to TAB_RUN_RENDER_MODE_INSPECTION", () => {
  const block = popupSource.match(
    /async function runRenderModeInspectionReload\(javaScriptDisabled\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function normalizeRenderModeDebuggerPage/
  )[1];

  assert.match(block, /messages\.requestTabRunRenderModeInspection\(tabId, \{/);
  assert.match(block, /baseUrl: state\.currentBaseUrl/);
  assert.match(block, /javaScriptDisabled/);
  assert.doesNotMatch(block, /type: "renderModeInspectionBegin"/);
  assert.doesNotMatch(block, /type: "runRenderModeRevealOnce"/);
  assert.doesNotMatch(block, /type: "captureRenderModeInspectionHtml"/);
  assert.doesNotMatch(block, /type: "renderModeInspectionEnd"/);
});

test("popup render mode inspection uses long timeout and fail-open end cleanup", () => {
  const helperBlock = popupMessagesSource.match(
    /export function requestTabRunRenderModeInspection\(tabId(?:\s*:\s*[^,]+)?, payload = \{\}, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}\n\nexport function requestTabRunAi/
  )[1];

  assert.match(helperBlock, /const normalizedPayload(?:\s*:\s*[^=]+)? = payload && typeof payload === "object" \? payload : \{\};/);
  assert.match(helperBlock, /timeoutMs: Number\.isFinite\(options\.timeoutMs\) \? Math\.trunc\(options\.timeoutMs\) : 120000/);
  assert.match(helperBlock, /catch\(async \(error\) => \{[\s\S]*?normalizedPayload\.operationId[\s\S]*?type: TAB_END_RENDER_MODE_INSPECTION_COMMAND,[\s\S]*?operationId: normalizedPayload\.operationId/);
});

test("background TAB_RUN_RENDER_MODE_INSPECTION orchestrates reload, consent hide, capture, and end", () => {
  const commandBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?\n*function maybeGetCommandPayloadForLedger\(message(?:\s*:\s*any)?\)/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/tab-operation-runner\.js"/);
  assert.match(backgroundSource, /const tabOperationRunner = createTabOperationRunner\(\{[\s\S]*?updateLifecycleState,[\s\S]*?withTabSpinner: withBackgroundTabSpinner/);
  assert.match(commandBlock, /runBackgroundTabOperation\([\s\S]*?kind: LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION,[\s\S]*?timeoutMs: RENDER_MODE_INSPECTION_OPERATION_TIMEOUT_MS,[\s\S]*?reason: "tab-render-mode-inspection"/);
  assert.match(backgroundSource, /from "\.\/background\/render-mode-inspector\.js"/);
  assert.match(backgroundSource, /const renderModeInspector = createRenderModeInspector\(\{/);
  assert.match(commandBlock, /if \(!javaScriptDisabled\) \{[\s\S]*?utils\.setPageJavaScriptExecutionDisabled\([\s\S]*?normalizedTabId,[\s\S]*?false/);
  assert.match(commandBlock, /runRenderModeInspectionBeginStep\(normalizedTabId, operationId\)/);
  assert.match(commandBlock, /waitForTabLoadStartInBackground\(/);
  assert.match(commandBlock, /utils\.reloadPageWithJavaScriptControl\(/);
  assert.doesNotMatch(commandBlock, /if \(javaScriptDisabled\) \{\s*const scriptEnableResult = await restoreJavaScriptAfterNoJsReload\(\);/);
  // The render-mode recovery reload sets up its load-complete waiter (awaitNextLoad)
  // BEFORE issuing the reload so it observes that reload's loading -> complete
  // cycle; creating it afterwards would wait for a second navigation and time out.
  assert.match(commandBlock, /const loadCompletePromise = requireLoadComplete[\s\S]*?waitForTabLoadCompleteInBackground\([\s\S]*?\{ awaitNextLoad: true \}[\s\S]*?const reloadResult = await utils\.reloadPageWithJavaScriptControl\(\s*normalizedTabId,\s*false[\s\S]*?loadCompleted = await loadCompletePromise;/);
  assert.match(commandBlock, /requireLoadComplete = options\.requireLoadComplete !== false/);
  assert.match(commandBlock, /if \(requireLoadComplete\) \{[\s\S]*?loadCompleted = await loadCompletePromise;[\s\S]*?if \(!loadCompleted\) \{/);
  assert.match(commandBlock, /const detachResult = await detachRenderModeDebuggerIfIdle\(\{[\s\S]*?waitForDetach: requireLoadComplete[\s\S]*?\}\);/);
  assert.match(commandBlock, /if \(!waitForDetach\) \{[\s\S]*?return \{ ok: true, detachPending: true \};/);
  assert.match(commandBlock, /getDeviceEmulationState\(normalizedTabId\)/);
  assert.match(backgroundSource, /async function captureRenderModeHtmlWithDebugger\(tabId\) \{[\s\S]*?"DOM\.getDocument"[\s\S]*?"DOM\.getOuterHTML"[\s\S]*?fetchStaticPageHtmlForBackground\(pageUrl\)/);
  assert.match(
    commandBlock,
    /let beginResult = await runRenderModeInspectionBeginStep\(normalizedTabId, operationId\);[\s\S]*?beginResult\.error === "Content activation failed"[\s\S]*?reloadPageWithJavaScriptForRenderModeRecovery\(\)[\s\S]*?beginResult = await runRenderModeInspectionBeginStep\(normalizedTabId, operationId\);/
  );
  assert.match(commandBlock, /if \(!javaScriptDisabled && javaScriptReloadAttempted && !javaScriptRestored\) \{[\s\S]*?restoreJavaScriptAfterNoJsReload\(\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(commandBlock, /scheduleJavaScriptRestoreAfterNoJsInspection/);
  assert.doesNotMatch(commandBlock, /runRenderModeRevealFreezeStep\(/);
  assert.match(commandBlock, /if \(javaScriptDisabled\) \{[\s\S]*?captureResult = await captureRenderModeHtmlWithDebugger\(normalizedTabId\);[\s\S]*?\} else \{[\s\S]*?runRenderModeHideConsentStep\(normalizedTabId\)[\s\S]*?runRenderModeCaptureHtmlStep\(\s*normalizedTabId,\s*baseUrl,\s*operationId\s*\)/);
  assert.match(commandBlock, /if \(!javaScriptDisabled\) \{[\s\S]*?await detachRenderModeDebuggerIfIdle\(\{ waitForDetach: false \}\);/);
  assert.match(commandBlock, /sendRenderModeInspectionEndWithRetry\(\s*normalizedTabId,\s*operationId\s*\)/);
  // "With JavaScript" clears the no-JS hold; a completed no-JS reload records the
  // tab (in chrome.storage.session) so JavaScript is restored on the next genuine
  // navigation (not its own reload) and the popup can show the current JS mode.
  assert.match(commandBlock, /clearRenderModeNoJsHeld\(normalizedTabId\)/);
  assert.match(commandBlock, /if \(javaScriptDisabled && javaScriptReloadAttempted\) \{[\s\S]*?await setRenderModeNoJsHeld\(normalizedTabId, true\);[\s\S]*?updateRenderModeNoJsInactivityWatch\(normalizedTabId\)\.catch\(\(\) => null\);/);
  // "With JavaScript" on a tab held in no-JS mode reloads with JavaScript first so
  // content scripts are present before the begin handshake (otherwise it retries
  // content readiness for tens of seconds against the stale no-JS page).
  assert.match(commandBlock, /const wasHeldInNoJsMode = await isRenderModeNoJsHeld\(normalizedTabId\);/);
  assert.match(commandBlock, /if \(wasHeldInNoJsMode\) \{[\s\S]*?reloadPageWithJavaScriptForRenderModeRecovery\(\)/);
  assert.match(
    commandBlock,
    /finally \{[\s\S]*?sendRenderModeInspectionEndWithRetry\([\s\S]*?Object\.assign\(commandResult, \{[\s\S]*?runtime: getTabRuntimeSnapshot\(normalizedTabId\)/
  );
  assert.doesNotMatch(commandBlock, /phase: commandResult\.ok \? LIFECYCLE_PHASES\.FINISHED : LIFECYCLE_PHASES\.FAILED/);
});

test("background TAB_END_RENDER_MODE_INSPECTION restores JavaScript and clears the no-JS hold", () => {
  const endBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_END_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);/
  )[1];

  // Ending render-mode inspection is an explicit exit, so JavaScript must be
  // restored and the no-JS hold cleared, detaching only when device emulation
  // does not need the debugger.
  assert.match(endBlock, /if \(await isRenderModeNoJsHeld\(normalizedTabId\)\) \{/);
  assert.match(endBlock, /clearRenderModeNoJsHeld\(normalizedTabId\)/);
  assert.match(endBlock, /tabInactivityObserver\.clearTab\(normalizedTabId,[\s\S]*?scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE/);
  assert.match(endBlock, /utils\.setPageJavaScriptExecutionDisabled\(normalizedTabId, false\)/);
  assert.match(endBlock, /getDeviceEmulationState\(normalizedTabId\)/);
  assert.match(endBlock, /utils\.detachDebugger\(normalizedTabId\)/);
});

test("background restores no-JS render-mode holds after central tab inactivity", () => {
  const manifest = JSON.parse(manifestSource);
  const commandBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?\n*function maybeGetCommandPayloadForLedger\(message(?:\s*:\s*any)?\)/
  )[1];
  const activityMessageBlock = backgroundSource.match(
    /if \(message\.type === "pageActivityObserved"\) \{([\s\S]*?)\n  \}\n\n  if \(PROPERTY_LOCK_MESSAGE_TYPES/
  )[1];

  assert.equal(manifest.permissions.includes("alarms"), true);
  assert.match(backgroundSource, /from "\.\/background\/tab-inactivity-observer\.js"/);
  assert.match(backgroundSource, /const RENDER_MODE_NO_JS_INACTIVITY_SCOPE = "render-mode-no-js";/);
  assert.match(backgroundSource, /const RENDER_MODE_NO_JS_INACTIVITY_TIMEOUT_MS = 30_000;/);
  assert.match(backgroundSource, /const tabInactivityObserver = createTabInactivityObserver\(\{/);
  assert.match(backgroundSource, /chrome\.alarms\.onAlarm\.addListener\(\(alarm\) => \{[\s\S]*?tabInactivityObserver\.handleAlarm\(alarm\)/);
  assert.match(backgroundSource, /async function updateRenderModeNoJsInactivityWatch\(tabId\) \{[\s\S]*?isTabActiveInFocusedWindow\(normalizedTabId\)[\s\S]*?tabInactivityObserver\.scheduleInactive\(normalizedTabId, \{[\s\S]*?scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE/);
  assert.match(backgroundSource, /async function restoreRenderModeJavaScriptAfterNoJsInactivity\(tabId\) \{[\s\S]*?isTabActiveInFocusedWindow\(normalizedTabId\)[\s\S]*?clearRenderModeNoJsHeld\(normalizedTabId\)[\s\S]*?utils\.reloadPageWithJavaScriptControl\(normalizedTabId, false\)[\s\S]*?utils\.detachDebugger\(normalizedTabId\)/);
  assert.match(backgroundSource, /async function restoreRenderModeJavaScriptAfterNoJsInactivity\(tabId\) \{[\s\S]*?setPageJavaScriptExecutionDisabled\(normalizedTabId, false\)[\s\S]*?setRenderModeNoJsHeld\(normalizedTabId, true\)[\s\S]*?updateRenderModeNoJsInactivityWatch\(normalizedTabId\)/);
  assert.match(backgroundSource, /tabInactivityObserver\.subscribe\(async \(event\) => \{[\s\S]*?event\.scope !== RENDER_MODE_NO_JS_INACTIVITY_SCOPE[\s\S]*?restoreRenderModeJavaScriptAfterNoJsInactivity\(event\.tabId\)/);
  assert.match(commandBlock, /setRenderModeNoJsHeld\(normalizedTabId, true\)[\s\S]*?updateRenderModeNoJsInactivityWatch\(normalizedTabId\)/);
  assert.match(activityMessageBlock, /tabInactivityObserver\.recordActivity\(tabId, \{[\s\S]*?source: "content"/);
  assert.match(activityMessageBlock, /updateRenderModeNoJsInactivityWatch\(tabId\)/);
  assert.match(backgroundSource, /chrome\.tabs\.onActivated\.addListener\(async \(\{ windowId \}\) => \{[\s\S]*?updateRenderModeNoJsInactivityWatches\(\);/);
  assert.match(backgroundSource, /chrome\.windows\.onFocusChanged\.addListener\(async \(windowId\) => \{[\s\S]*?updateRenderModeNoJsInactivityWatches\(\);/);
  assert.match(backgroundSource, /updateRenderModeNoJsInactivityWatches\(\)\.catch\(\(\) => \{\}\);/);
});

test("background render-mode consent hide is separate from HTML capture", () => {
  assert.match(
    renderModeInspectorSource,
    /async function runRenderModeHideConsentStep\(tabId\) \{[\s\S]*?type: "hideConsentForInspection"/
  );
  const helperBlock = renderModeInspectorSource.match(
    /async function runRenderModeCaptureHtmlStep\(tabId, baseUrl, operationId\) \{([\s\S]*?)\n  \}/
  )[1];

  assert.match(helperBlock, /type: "captureRenderModeInspectionHtml"/);
  assert.doesNotMatch(helperBlock, /hideConsentForInspection/);
});
