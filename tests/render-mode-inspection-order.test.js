import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../background/render-mode-inspector.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
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

test("background render mode command preserves reveal -> capture -> consent-hide ordering", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION",
    "function maybeGetCommandPayloadForLedger"
  );

  const beginIndex = block.indexOf("runRenderModeInspectionBeginStep(");
  const reloadIndex = block.indexOf("utils.reloadPageWithJavaScriptControl(");
  const loadCompleteIndex = block.indexOf("waitForTabLoadCompleteInBackground(");
  const revealIndex = block.indexOf("runRenderModeRevealFreezeStep(");
  const captureIndex = block.indexOf("runRenderModeCaptureHtmlStep(");
  const endIndex = block.indexOf("sendRenderModeInspectionEndWithRetry(");

  assert.ok(beginIndex > -1);
  assert.ok(reloadIndex > beginIndex);
  assert.ok(loadCompleteIndex > reloadIndex);
  assert.ok(revealIndex > loadCompleteIndex);
  assert.ok(captureIndex > revealIndex);
  assert.ok(endIndex > captureIndex);
  assert.match(
    renderModeInspectorSource,
    /async function runRenderModeCaptureHtmlStep\(tabId, baseUrl, operationId\) \{[\s\S]*?captureRenderModeInspectionHtml[\s\S]*?hideConsentForInspection/
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
  const messageStart = contentSource.indexOf('if (message.type === "runRenderModeRevealOnce") {');
  const messageEnd = contentSource.indexOf('if (message.type === "hideConsentForInspection") {', messageStart);
  assert.ok(messageStart > -1);
  assert.ok(messageEnd > messageStart);
  const messageBlock = contentSource.slice(messageStart, messageEnd);

  const revealIndex = messageBlock.indexOf("warmupSilentHighlightingBeforeMotionPause(");
  const captureIndex = messageBlock.indexOf('if (message.type === "captureRenderModeInspectionHtml") {');
  const snapshotIndex = messageBlock.indexOf("const snapshot = createCurrentPageSnapshot();", captureIndex);
  const rawIndex = messageBlock.indexOf("const rawHtml = await fetchCurrentPageRawHtml(location.href);", snapshotIndex);
  const finishIndex = messageBlock.indexOf("core.finishPageInspectionUi();", rawIndex);

  assert.ok(revealIndex > -1);
  assert.ok(captureIndex > revealIndex);
  assert.ok(snapshotIndex > captureIndex);
  assert.ok(rawIndex > snapshotIndex);
  assert.ok(finishIndex > rawIndex);
  assert.doesNotMatch(messageBlock, /refreshEnabledAiHighlights\(/);
  assert.doesNotMatch(messageBlock, /refreshSilentHighlightings\(\)/);

  assert.match(coreSource, /const EXTENSION_SNAPSHOT_STRIP_SELECTORS = \[[\s\S]*?"\[data-uf-extension-ui=\\"true\\"\]"/);
  assert.match(coreSource, /"\[id\^=\\"unfluffify-\\"\]"/);
  assert.match(coreSource, /"#unfluffify-overlay"/);
  assert.match(coreSource, /"#unfluffify-ai-popover-style"/);
  assert.match(messageBlock, /renderedHtml: snapshot && typeof snapshot\.renderedHtml === "string" \? snapshot\.renderedHtml : ""/);
});