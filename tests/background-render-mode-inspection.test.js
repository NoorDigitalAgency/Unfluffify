import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../background/render-mode-inspector.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

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
  assert.match(commandBlock, /const scriptEnableResult = await restoreJavaScriptAfterNoJsReload\(\);[\s\S]*?waitForTabLoadCompleteInBackground\(/);
  assert.match(commandBlock, /if \(javaScriptReloadAttempted && !javaScriptRestored\) \{[\s\S]*?restoreJavaScriptAfterNoJsReload\(\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(commandBlock, /runRenderModeRevealFreezeStep\(/);
  assert.match(commandBlock, /runRenderModeHideConsentStep\(normalizedTabId\)/);
  assert.match(commandBlock, /runRenderModeCaptureHtmlStep\(\s*normalizedTabId,\s*baseUrl,\s*operationId\s*\)/);
  assert.match(commandBlock, /sendRenderModeInspectionEndWithRetry\(\s*normalizedTabId,\s*operationId\s*\)/);
  assert.match(
    commandBlock,
    /finally \{[\s\S]*?sendRenderModeInspectionEndWithRetry\([\s\S]*?updateLifecycleState\(normalizedTabId, \{[\s\S]*?kind: LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION,[\s\S]*?phase: commandResult\.ok \? LIFECYCLE_PHASES\.FINISHED : LIFECYCLE_PHASES\.FAILED,[\s\S]*?busy: false/
  );
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
