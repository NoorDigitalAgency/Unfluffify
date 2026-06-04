import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render mode reload begins inspection before reload and always clears it", () => {
  const block = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );

  const beginIndex = block.indexOf('type: "renderModeInspectionBegin"');
  const reloadIndex = block.indexOf("utils.reloadPageWithJavaScriptControl(tabId, javaScriptDisabled)");
  const followUpIndex = block.indexOf("const followUpCompleted = await completeRenderModeInspectionReloadFollowUp(tabId)");
  const refreshIndex = block.indexOf("await refreshUi({ useBusyOverlay: false })", followUpIndex);
  const finallyIndex = block.indexOf("} finally {");
  const endIndex = block.indexOf('type: "renderModeInspectionEnd"', finallyIndex);

  assert.ok(beginIndex > -1);
  assert.ok(reloadIndex > beginIndex);
  assert.ok(followUpIndex > reloadIndex);
  assert.ok(refreshIndex > followUpIndex);
  assert.ok(finallyIndex > refreshIndex);
  assert.ok(endIndex > finallyIndex);
  assert.doesNotMatch(block, /void completeRenderModeInspectionReloadFollowUp/);
});

test("render mode follow-up captures clean HTML only after reveal and before hide/reconcile", () => {
  const block = extractSourceBlock(
    popupSource,
    "async function completeRenderModeInspectionReloadFollowUp",
    "async function reconcilePropertyLockAfterRenderModeReload"
  );

  const loadIndex = block.indexOf("waitForTabLoadComplete(");
  const readyIndex = block.indexOf("ensureContentReadyForRenderModeInspection(tabId)");
  const revealIndex = block.indexOf('type: "runRenderModeRevealOnce"');
  const captureIndex = block.indexOf('type: "captureRenderModeInspectionHtml"');
  const rememberIndex = block.indexOf("rememberRenderModeInspectionSnapshot(");
  const hideIndex = block.indexOf("await hideConsentForRenderModeInspection(tabId)");
  const reconcileIndex = block.indexOf("await reconcilePropertyLockAfterRenderModeReload()");
  const staleClearIndex = block.indexOf("scheduleStaleInspectionBusyClear(tabId, state.currentBaseUrl", reconcileIndex);

  assert.ok(loadIndex > -1);
  assert.ok(readyIndex > loadIndex);
  assert.ok(revealIndex > readyIndex);
  assert.ok(captureIndex > revealIndex);
  assert.ok(rememberIndex > captureIndex);
  assert.ok(hideIndex > rememberIndex);
  assert.ok(reconcileIndex > hideIndex);
  assert.ok(staleClearIndex > reconcileIndex);
  assert.match(block, /reconcileRenderModeNavSpinner: true/);
});

test("render mode inspection waits for content-main before lifecycle messages", () => {
  const readyBlock = extractSourceBlock(
    popupSource,
    "async function ensureContentReadyForRenderModeInspection",
    "async function waitForTabLoadStart"
  );
  const reloadBlock = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );

  assert.match(readyBlock, /type: "activateContentForTab", tabId/);
  assert.match(readyBlock, /type: "getInspectionStatus"/);
  assert.match(readyBlock, /if \(status && status\.ok\) \{[\s\S]*?return true;/);
  assert.match(readyBlock, /messages\.delay\(250\)/);
  assert.match(
    reloadBlock,
    /finally \{[\s\S]*?await ensureContentReadyForRenderModeInspection\(tabId\)\.catch\(\(\) => false\);[\s\S]*?type: "renderModeInspectionEnd"/
  );
});

test("render mode auto detection consumes the explicit inspection snapshot", () => {
  const block = extractSourceBlock(
    popupSource,
    "async function maybeAutoDetectRenderMode",
    "function mergeConfigEntriesForResolvedBaseUrl"
  );

  assert.match(block, /const inspectionSnapshot = getCurrentRenderModeInspectionSnapshot\(detectionKey\);/);
  assert.match(block, /if \(!inspectionSnapshot\) \{[\s\S]*?return RENDER_MODE_UNDETERMINED;/);
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