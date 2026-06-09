import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
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

test("background TAB_RUN_RENDER_MODE_INSPECTION orchestrates reload, reveal, capture, and end", () => {
  const commandBlock = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_RENDER_MODE_INSPECTION, async \(context, payload\) => \{([\s\S]*?)\n\}\);\n\nfunction maybeGetCommandPayloadForLedger/
  )[1];

  assert.match(commandBlock, /withBackgroundTabSpinner\([\s\S]*?reason: "tab-render-mode-inspection"/);
  assert.match(commandBlock, /runRenderModeInspectionBeginStep\(normalizedTabId, operationId\)/);
  assert.match(commandBlock, /waitForTabLoadStartInBackground\(/);
  assert.match(commandBlock, /utils\.reloadPageWithJavaScriptControl\(/);
  assert.match(commandBlock, /waitForTabLoadCompleteInBackground\(/);
  assert.match(commandBlock, /runRenderModeRevealFreezeStep\(\s*normalizedTabId,\s*baseUrl,\s*operationId\s*\)/);
  assert.match(commandBlock, /runRenderModeCaptureHtmlStep\(\s*normalizedTabId,\s*baseUrl,\s*operationId\s*\)/);
  assert.match(commandBlock, /sendRenderModeInspectionEndWithRetry\(\s*normalizedTabId,\s*operationId\s*\)/);
});

test("background render-mode capture hides consent after HTML capture", () => {
  const helperBlock = backgroundSource.match(
    /async function runRenderModeCaptureHtmlStep\(tabId, baseUrl, operationId\) \{([\s\S]*?)\n\}/
  )[1];

  const captureIndex = helperBlock.indexOf('type: "captureRenderModeInspectionHtml"');
  const hideIndex = helperBlock.indexOf('type: "hideConsentForInspection"');

  assert.ok(captureIndex > -1);
  assert.ok(hideIndex > captureIndex);
});
