import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PopupText } from "../common/text.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel,
  resolveRenderModeInspectionReloadOutcome
} from "../popup/render-mode.js";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render mode text copy uses the updated manual comparison wording", () => {
  assert.equal(
    PopupText.renderMode.copyLookAlmostSame,
    "Meaningful content the same in both"
  );
  assert.equal(
    PopupText.renderMode.copyLookVeryDifferent,
    "Meaningful content only with JavaScript"
  );
});

test("render mode editor shows a textual selected-mode summary instead of a visible dropdown", () => {
  const editorBlock = extractSourceBlock(
    uiSource,
    "function renderRenderModeEditor",
    "function getTodoProgress"
  );

  assert.match(editorBlock, /const selectedRenderModeLabel = getRenderModeOptionLabel\(view\.renderModeValue\);/);
  assert.match(editorBlock, /const selectedRenderModeIcon = getRenderModeOptionIcon\(view\.renderModeValue\);/);
  assert.match(editorBlock, /class:\s*"render-mode-selected-value"/);
  assert.match(editorBlock, /icon\(selectedRenderModeIcon, "render-mode-selected-value__icon"\)/);
  assert.match(editorBlock, /selectedRenderModeLabel/);
  assert.match(editorBlock, /id:\s*"render-mode",[\s\S]*class:\s*"u-d-none"/);
});

test("render mode option label maps known modes and falls back to undetermined", () => {
  assert.equal(getRenderModeOptionLabel("static"), PopupText.renderMode.optionStatic);
  assert.equal(getRenderModeOptionLabel("rendered"), PopupText.renderMode.optionRendered);
  assert.equal(getRenderModeOptionLabel("undetermined"), PopupText.renderMode.optionUndetermined);
  assert.equal(getRenderModeOptionLabel("unexpected"), PopupText.renderMode.optionUndetermined);
});

test("render mode option icon maps known modes and falls back to the dashboard glyph", () => {
  assert.equal(getRenderModeOptionIcon("static"), "language-html5");
  assert.equal(getRenderModeOptionIcon("rendered"), "language-javascript");
  assert.equal(getRenderModeOptionIcon("undetermined"), "monitor-dashboard");
  assert.equal(getRenderModeOptionIcon("unexpected"), "monitor-dashboard");
});

test("render mode inspection reload outcome uses the explicit reload error when reload setup fails", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: false, error: "Debugger attach failed" },
      false,
      false
    ),
    {
      ok: false,
      toast: "Debugger attach failed"
    }
  );
});

test("render mode inspection reload outcome fails when navigation never starts", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      false,
      true
    ),
    {
      ok: false,
      toast: PopupText.renderMode.toastInspectReloadFailed
    }
  );
});

test("render mode inspection reload waits for the full explicit inspection follow-up", () => {
  const inspectionBlock = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );
  const followUpBlock = extractSourceBlock(
    popupSource,
    "async function completeRenderModeInspectionReloadFollowUp",
    "async function runRenderModeInspectionReload"
  );

  assert.match(
    inspectionBlock,
    /const loadStartPromise = waitForTabLoadStart\(\s*tabId,\s*RENDER_MODE_INSPECTION_START_TIMEOUT_MS\s*\);/
  );
  assert.match(
    inspectionBlock,
    /const loadStarted = await loadStartPromise;[\s\S]*?resolveRenderModeInspectionReloadOutcome\(result,\s*loadStarted,\s*javaScriptDisabled\)/
  );
  assert.match(
    inspectionBlock,
    /const operationId = `render-mode-inspection:\$\{tabId\}:\$\{Date\.now\(\)\}`;[\s\S]*?type: "renderModeInspectionBegin",[\s\S]*?operationId[\s\S]*?try \{[\s\S]*?const followUpCompleted = await completeRenderModeInspectionReloadFollowUp\(tabId, operationId\);[\s\S]*?if \(followUpCompleted\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false \}\);[\s\S]*?\} finally \{[\s\S]*?type: "renderModeInspectionEnd",[\s\S]*?operationId/
  );
  assert.doesNotMatch(inspectionBlock, /void completeRenderModeInspectionReloadFollowUp/);
  assert.match(
    followUpBlock,
    /waitForTabLoadComplete\(\s*tabId,\s*RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS\s*\)/
  );
  assert.match(followUpBlock, /ensureContentReadyForRenderModeInspection\(tabId\)/);
  assert.match(followUpBlock, /type: "runRenderModeRevealOnce"/);
  assert.match(followUpBlock, /type: "captureRenderModeInspectionHtml"/);
  assert.match(
    followUpBlock,
    /await hideConsentForRenderModeInspection\(tabId\);/
  );
  // After the reload, the popup reconciles the property lock so it stops showing
  // "disconnected" once the content re-claims the lock (#9).
  assert.match(
    followUpBlock,
    /await reconcilePropertyLockAfterRenderModeReload\(\);/
  );
});

test("the property lock is reconciled (polled until reconnected) after a render-mode reload", () => {
  const reconcileBlock = extractSourceBlock(
    popupSource,
    "async function reconcilePropertyLockAfterRenderModeReload",
    "function buildTodoExpansionContextKey"
  );
  assert.match(reconcileBlock, /refreshPropertyLockSnapshot\(siteId\)/);
  assert.match(reconcileBlock, /PROPERTY_LOCK_CONNECTION_CONNECTED/);
  assert.match(reconcileBlock, /PROPERTY_LOCK_CONNECTION_INACTIVE/);
  assert.match(reconcileBlock, /skipPropertyLockFetch: true/);
});

test("render mode inspection reload outcome returns the started toast for the chosen javascript mode", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      true,
      false
    ),
    {
      ok: true,
      toast: PopupText.renderMode.toastInspectWithJavaScriptStarted
    }
  );

  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      true,
      true
    ),
    {
      ok: true,
      toast: PopupText.renderMode.toastInspectWithoutJavaScriptStarted
    }
  );
});

test("render mode set always normalizes page execution state after persisting the mode", () => {
  const setBlock = extractSourceBlock(
    popupSource,
    "async function handleRenderModeSet",
    "async function handleRenderModeEditToggle"
  );

  assert.match(
    setBlock,
    /const tabId = state\.currentTab && state\.currentTab\.id;/
  );
  assert.match(
    setBlock,
    /await messages\.sendTabMessage\(\{[\s\S]*?type:\s*"configUpdated",[\s\S]*?baseUrl:\s*state\.currentBaseUrl[\s\S]*?\}\);[\s\S]*?if \(tabId\) \{[\s\S]*?await normalizeRenderModeDebuggerPage\(tabId\);[\s\S]*?\}/
  );
  assert.match(
    setBlock,
    /if \(state\.renderModeDebuggerTabId === tabId\) \{[\s\S]*?state\.renderModeDebuggerTabId = null;[\s\S]*?\}/
  );
});

test("render mode set keeps popup blocked with nav inspection spinner during enabled-tab reload settle", () => {
  const setBlock = extractSourceBlock(
    popupSource,
    "async function handleRenderModeSet",
    "async function handleRenderModeEditToggle"
  );

  assert.match(setBlock, /const tabState = await messages\.getTabState\(tabId\);/);
  // Silent-mode editor reveal/freeze runs after Set even when the tab is not
  // marking-enabled, so the overlay must be gated on in-scope, not on enabled.
  assert.match(
    setBlock,
    /const inspectionExpected = Boolean\([\s\S]*?settleBaseUrl[\s\S]*?utils\.isPageWithinBaseUrl\(candidateUrl, settleBaseUrl\)[\s\S]*?\);/
  );
  assert.doesNotMatch(
    setBlock,
    /const inspectionExpected = Boolean\([\s\S]*?tabState\.enabled[\s\S]*?\);/
  );
  assert.match(
    setBlock,
    /if \(inspectionExpected\) \{[\s\S]*?startRenderModeSetNavGuard\(tabId\);[\s\S]*?beginNavigationInspectionOverlay\(tabId\);[\s\S]*?\}/
  );
  assert.doesNotMatch(setBlock, /waitForTabLoadComplete\(/);
  assert.doesNotMatch(setBlock, /waitForEnableMarkingInspectionToSettle\(/);
});

test("nav settle and stale clear paths hold navInspect until post-set inspection is first observed", () => {
  const settlePollBlock = extractSourceBlock(
    popupSource,
    "function scheduleNavigationInspectionSettlePoll",
    "function beginNavigationInspectionOverlay"
  );
  const staleClearBlock = extractSourceBlock(
    popupSource,
    "function scheduleStaleInspectionBusyClear",
    "function popSpinner"
  );
  const onUpdatedBlock = extractSourceBlock(
    popupSource,
    "chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {",
    "window.addEventListener(\"beforeunload\""
  );

  assert.match(settlePollBlock, /noteRenderModeSetNavGuardInspection\(tabId\);/);
  assert.match(settlePollBlock, /shouldHoldNavInspectUntilRenderModeInspectionSeen\(tabId\)/);
  assert.match(
    staleClearBlock,
    /const holdForRenderModeSet = shouldHoldNavInspectUntilRenderModeInspectionSeen\(tabId\);[\s\S]*?if \(!inspectionPending && !holdForRenderModeSet\)/
  );
  assert.match(
    onUpdatedBlock,
    /if \(shouldHoldNavInspectUntilRenderModeInspectionSeen\(tabId\)\) \{[\s\S]*?scheduleNavigationInspectionSettlePoll\(tabId, settleBaseUrl\);/
  );
  assert.match(
    onUpdatedBlock,
    /const renderModeSetGuardActive = isRenderModeSetNavGuardActive\(tabId\);/
  );
});

test("render mode open/edit flows refresh without showing the generic popup busy curtain", () => {
  const editToggleBlock = extractSourceBlock(
    popupSource,
    "async function handleRenderModeEditToggle",
    "async function handleOpenRenderModeSection"
  );
  const openSectionBlock = extractSourceBlock(
    popupSource,
    "async function handleOpenRenderModeSection",
    "function handleRenderModeSummaryToggle"
  );

  assert.match(editToggleBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(openSectionBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
});

test("popup init performs its first refresh without the generic busy curtain", () => {
  const initBlock = extractSourceBlock(
    popupSource,
    "async function init()",
    "init();"
  );

  assert.match(
    initBlock,
    /state\.tokenValidationTimer = window\.setInterval\([\s\S]*?TOKEN_VALIDATION_INTERVAL_MS\);[\s\S]*?await refreshUi\(\{ useBusyOverlay: false \}\);/
  );
});
