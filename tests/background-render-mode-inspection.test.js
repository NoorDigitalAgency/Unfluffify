import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../background/render-mode-inspector.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../popup/messages.js", import.meta.url), "utf8");

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
    /async function runRenderModeInspectionReload\(javaScriptDisabled\) \{([\s\S]*?)\n\}\n\nasync function normalizeRenderModeDebuggerPage/
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
    /export function requestTabRunRenderModeInspection\(tabId, payload = \{\}, options = \{\}\) \{([\s\S]*?)\n\}\n\nexport function requestTabRunAi/
  )[1];

  assert.match(helperBlock, /const normalizedPayload = payload && typeof payload === "object" \? payload : \{\};/);
  assert.match(helperBlock, /timeoutMs: Number\.isFinite\(options\.timeoutMs\) \? Math\.trunc\(options\.timeoutMs\) : 120000/);
  assert.match(helperBlock, /catch\(async \(error\) => \{[\s\S]*?normalizedPayload\.operationId[\s\S]*?type: TAB_END_RENDER_MODE_INSPECTION_COMMAND,[\s\S]*?operationId: normalizedPayload\.operationId/);
});

test("background TAB_RUN_RENDER_MODE_INSPECTION orchestrates reload, consent hide, capture, and end", () => {
  const commandBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n\nfunction maybeGetCommandPayloadForLedger/
  )[1];

  assert.match(commandBlock, /withBackgroundTabSpinner\([\s\S]*?reason: "tab-render-mode-inspection"/);
  assert.match(backgroundSource, /from "\.\/background\/render-mode-inspector\.js"/);
  assert.match(backgroundSource, /const renderModeInspector = createRenderModeInspector\(\{/);
  assert.match(commandBlock, /if \(!javaScriptDisabled\) \{[\s\S]*?utils\.setPageJavaScriptExecutionDisabled\([\s\S]*?normalizedTabId,[\s\S]*?false/);
  assert.match(commandBlock, /runRenderModeInspectionBeginStep\(normalizedTabId, operationId\)/);
  assert.match(commandBlock, /waitForTabLoadStartInBackground\(/);
  assert.match(commandBlock, /utils\.reloadPageWithJavaScriptControl\(/);
  assert.doesNotMatch(commandBlock, /if \(javaScriptDisabled\) \{\s*const scriptEnableResult = await restoreJavaScriptAfterNoJsReload\(\);/);
  assert.match(commandBlock, /const reloadResult = await utils\.reloadPageWithJavaScriptControl\([\s\S]*?normalizedTabId,[\s\S]*?false[\s\S]*?\);[\s\S]*?waitForTabLoadCompleteInBackground\([\s\S]*?\{ awaitNextLoad: true \}/);
  assert.match(commandBlock, /requireLoadComplete = options\.requireLoadComplete !== false/);
  assert.match(commandBlock, /if \(requireLoadComplete\) \{[\s\S]*?waitForTabLoadCompleteInBackground\([\s\S]*?if \(!loadCompleted\) \{/);
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
  // tab so JavaScript is restored on the next genuine navigation (not its own reload).
  assert.match(commandBlock, /renderModeNoJsInspectionTabIds\.delete\(normalizedTabId\)/);
  assert.match(commandBlock, /if \(javaScriptDisabled && javaScriptReloadAttempted\) \{[\s\S]*?renderModeNoJsInspectionTabIds\.add\(normalizedTabId\)/);
  assert.match(
    commandBlock,
    /finally \{[\s\S]*?sendRenderModeInspectionEndWithRetry\([\s\S]*?updateLifecycleState\(normalizedTabId, \{[\s\S]*?kind: LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION,[\s\S]*?phase: commandResult\.ok \? LIFECYCLE_PHASES\.FINISHED : LIFECYCLE_PHASES\.FAILED,[\s\S]*?busy: false/
  );
});

test("background TAB_END_RENDER_MODE_INSPECTION restores JavaScript and clears the no-JS hold", () => {
  const endBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_END_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);/
  )[1];

  // Ending render-mode inspection is an explicit exit, so JavaScript must be
  // restored and the no-JS hold cleared, detaching only when device emulation
  // does not need the debugger.
  assert.match(endBlock, /if \(renderModeNoJsInspectionTabIds\.has\(normalizedTabId\)\) \{/);
  assert.match(endBlock, /renderModeNoJsInspectionTabIds\.delete\(normalizedTabId\)/);
  assert.match(endBlock, /utils\.setPageJavaScriptExecutionDisabled\(normalizedTabId, false\)/);
  assert.match(endBlock, /getDeviceEmulationState\(normalizedTabId\)/);
  assert.match(endBlock, /utils\.detachDebugger\(normalizedTabId\)/);
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
