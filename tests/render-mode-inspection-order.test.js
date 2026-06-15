import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../background/render-mode-inspector.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const renderModeHandlersSource = readFileSync(new URL("../content/render-mode-inspection-handlers.js", import.meta.url), "utf8");
const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render mode reload delegates inspection orchestration to background", () => {
  const block = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );

  assert.match(block, /const operationId = `render-mode-inspection:\$\{tabId\}:\$\{Date\.now\(\)\}`;/);
  assert.match(block, /messages\.requestTabRunRenderModeInspection\(tabId, \{[\s\S]*?baseUrl: state\.currentBaseUrl,[\s\S]*?javaScriptDisabled,[\s\S]*?operationId/);
  assert.match(block, /const outcome = resolveRenderModeInspectionReloadOutcome\(reloadResult, loadStarted, javaScriptDisabled\);/);
  assert.match(block, /if \(followUpCompleted\) \{[\s\S]*?rememberRenderModeInspectionSnapshot\([\s\S]*?await reconcilePropertyLockAfterRenderModeReload\(\);/);
  assert.doesNotMatch(block, /completeRenderModeInspectionReloadFollowUp\(/);
  assert.doesNotMatch(block, /type: "renderModeInspectionBegin"/);
  assert.doesNotMatch(block, /type: "renderModeInspectionEnd"/);
});

test("background render mode command skips reveal and hides consent before capture", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION",
    "function maybeGetCommandPayloadForLedger"
  );

  const beginIndex = block.indexOf("runRenderModeInspectionBeginStep(");
  const enableJavaScriptIndex = block.indexOf("utils.setPageJavaScriptExecutionDisabled(");
  const reloadIndex = block.indexOf("utils.reloadPageWithJavaScriptControl(");
  const loadCompleteIndex = block.indexOf("waitForTabLoadCompleteInBackground(");
  const postLoadEnableJavaScriptIndex = block.indexOf("utils.setPageJavaScriptExecutionDisabled(", enableJavaScriptIndex + 1);
  const hideConsentIndex = block.indexOf("runRenderModeHideConsentStep(");
  const captureIndex = block.indexOf("runRenderModeCaptureHtmlStep(");
  const endIndex = block.indexOf("sendRenderModeInspectionEndWithRetry(");

  assert.ok(beginIndex > -1);
  assert.ok(enableJavaScriptIndex > -1);
  assert.ok(enableJavaScriptIndex < beginIndex);
  assert.ok(reloadIndex > beginIndex);
  assert.ok(loadCompleteIndex > reloadIndex);
  assert.ok(postLoadEnableJavaScriptIndex > loadCompleteIndex);
  assert.ok(hideConsentIndex > loadCompleteIndex);
  assert.ok(hideConsentIndex < captureIndex);
  assert.ok(endIndex > captureIndex);
  assert.doesNotMatch(block, /runRenderModeRevealFreezeStep\(/);
  assert.match(
    renderModeInspectorSource,
    /async function runRenderModeHideConsentStep\(tabId\) \{[\s\S]*?hideConsentForInspection/
  );
});

test("background render mode orchestration waits for content readiness", () => {
  const readyBlock = extractSourceBlock(
    renderModeInspectorSource,
    "async function ensureContentReadyForRenderModeInspectionInBackground",
    "async function sendRenderModeInspectionEndWithRetry"
  );

  assert.match(readyBlock, /const bootstrap = await ensureContentMainForTab\(tabId\);/);
  assert.match(readyBlock, /type: "getInspectionStatus"/);
  assert.match(readyBlock, /if \(status && status\.ok\) \{[\s\S]*?return true;/);
  assert.match(readyBlock, /await waitForBackgroundRetryDelay\(250\);/);
});

test("render mode auto detection consumes the explicit inspection snapshot", () => {
  const renderModePopupSource = readFileSync(new URL("../popup/render-mode-inspection.js", import.meta.url), "utf8");
  const block = extractSourceBlock(
    renderModePopupSource,
    "export async function maybeAutoDetectRenderMode",
    "export async function waitForTabLoadStart"
  );

  assert.match(block, /const inspectionSnapshot = deps\.getCurrentRenderModeInspectionSnapshot\(detectionKey\);/);
  assert.match(block, /if \(!inspectionSnapshot\) \{[\s\S]*?return deps\.RENDER_MODE_UNDETERMINED;/);
  assert.match(block, /rawHtml: inspectionSnapshot\.rawHtml/);
  assert.match(block, /renderedHtml: inspectionSnapshot\.renderedHtml/);
  assert.doesNotMatch(block, /type: "collectPageData"/);
  assert.doesNotMatch(block, /type: "fetchStaticPageHtml"/);
});

test("content reveal and capture handlers preserve pre-highlight clean snapshot ordering", () => {
  assert.match(contentSource, /handleRunRenderModeRevealOnceCommand\(message = \{\}\) \{[\s\S]*?getRenderModeInspectionHandlers\(\)\.revealOnce\(message\)/);
  assert.match(contentSource, /handleCaptureRenderModeInspectionHtmlCommand\(message = \{\}\) \{[\s\S]*?getRenderModeInspectionHandlers\(\)\.captureHtml\(message\)/);

  const revealStart = renderModeHandlersSource.indexOf("async function revealOnce(message = {}) {");
  const revealEnd = renderModeHandlersSource.indexOf("async function captureHtml(message = {}) {", revealStart);
  assert.ok(revealStart > -1);
  assert.ok(revealEnd > revealStart);
  const revealBlock = renderModeHandlersSource.slice(revealStart, revealEnd);

  const captureStart = revealEnd;
  const captureEnd = renderModeHandlersSource.indexOf("function end(message = {}) {", captureStart);
  assert.ok(captureEnd > captureStart);
  const captureBlock = renderModeHandlersSource.slice(captureStart, captureEnd);

  const revealIndex = revealBlock.indexOf("warmupSilentHighlightingBeforeMotionPause(");
  const snapshotIndex = captureBlock.indexOf("const snapshot = deps.createCurrentPageSnapshot();");
  const rawIndex = captureBlock.indexOf("const rawHtml = await deps.fetchCurrentPageRawHtml(pageUrl);", snapshotIndex);
  const finishIndex = captureBlock.indexOf("deps.finishPageInspectionUi();", rawIndex);

  assert.ok(revealIndex > -1);
  assert.ok(snapshotIndex > -1);
  assert.ok(rawIndex > snapshotIndex);
  assert.ok(finishIndex > rawIndex);
  assert.doesNotMatch(revealBlock, /refreshEnabledAiHighlights\(/);
  assert.doesNotMatch(revealBlock, /refreshSilentHighlightings\(\)/);
  assert.doesNotMatch(captureBlock, /refreshEnabledAiHighlights\(/);
  assert.doesNotMatch(captureBlock, /refreshSilentHighlightings\(\)/);

  assert.match(coreSource, /const EXTENSION_SNAPSHOT_STRIP_SELECTORS = \[[\s\S]*?"\[data-uf-extension-ui=\\"true\\"\]"/);
  assert.match(coreSource, /"\[id\^=\\"unfluffify-\\"\]"/);
  assert.match(coreSource, /"#unfluffify-overlay"/);
  assert.match(coreSource, /"#unfluffify-ai-popover-style"/);
  assert.match(captureBlock, /renderedHtml: snapshot && typeof snapshot\.renderedHtml === "string" \? snapshot\.renderedHtml : ""/);
});
