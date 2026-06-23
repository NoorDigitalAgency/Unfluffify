import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { PopupText } from "../common/text.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel,
  resolveRenderModeInspectionReloadOutcome
} from "../popup/render-mode.js";

const popupSource = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
const popupSpinnerSource = readFileSync(new URL("../popup/spinner.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../popup/ui.ts", import.meta.url), "utf8");

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

test("popup startup hides configuration view until destination view is known", () => {
  assert.match(uiSource, /Loading:\s*'Loading'/);
  assert.match(uiSource, /currentView:\s*View\.Loading/);
  assert.match(uiSource, /function renderPopupLoadingView\(view\) \{/);

  const appBlock = extractSourceBlock(
    uiSource,
    "function App({ state: view, actions: handlers })",
    "function renderAiControlsContent"
  );

  assert.match(appBlock, /const loadingView = view\.currentView === View\.Loading;/);
  assert.match(appBlock, /hidden: previewVisible \|\| configurationView \|\| loadingView/);
  assert.match(appBlock, /: loadingView\s*\? renderPopupLoadingView\(view\)/);
  assert.match(appBlock, /: view\.currentView === View\.Configuration\s*\? renderConfigurationView/);
});

test("render mode inspect buttons alternate by the tab's current JavaScript mode", () => {
  // The popup derives the per-button disabled flags from the persisted no-JS-held
  // state so the same JavaScript mode cannot be triggered twice in a row.
  assert.match(
    popupSource,
    /import \{[\s\S]*?isRenderModeNoJsHeld,[\s\S]*?renderModeNoJsHeldStorageKey[\s\S]*?\} from "\.\/common\/render-mode-js-state\.js";/
  );
  assert.match(
    popupSource,
    /state\.renderModeTabJsDisabled = currentTabId[\s\S]*?await isRenderModeNoJsHeld\(currentTabId\)/
  );
  assert.match(
    popupSource,
    /nextViewState\.renderModeInspectWithoutJavaScriptDisabled =[\s\S]*?Boolean\(state\.renderModeTabJsDisabled\)/
  );
  assert.match(
    popupSource,
    /nextViewState\.renderModeInspectWithJavaScriptDisabled =[\s\S]*?!Boolean\(state\.renderModeTabJsDisabled\)/
  );
  // The popup refreshes when the persisted no-JS-held key changes for the current tab.
  assert.match(popupSource, /changes\[renderModeNoJsHeldStorageKey\(state\.currentTab\.id\)\]/);

  // Each button is wired to its own disabled flag.
  const editorBlock = extractSourceBlock(
    uiSource,
    "function renderRenderModeEditor",
    "function getTodoProgress"
  );
  assert.match(
    editorBlock,
    /id: "render-mode-inspect-without-javascript",[\s\S]*?disabled: view\.renderModeInspectWithoutJavaScriptDisabled/
  );
  assert.match(
    editorBlock,
    /id: "render-mode-inspect-with-javascript",[\s\S]*?disabled: view\.renderModeInspectWithJavaScriptDisabled/
  );
});

test("popup page-busy mirror skips render detection spinners", () => {
  assert.match(
    popupSource,
    /function isRenderDetectionPopupSpinner\(snapshot\) \{[\s\S]*?PopupText\.overlay\.detectingRenderMode[\s\S]*?\}/
  );
  assert.match(
    popupSource,
    /function syncPageBusyFromPopupSpinner\(\) \{[\s\S]*?const snapshot = getActiveSpinnerSnapshotForSurface\("page"\);[\s\S]*?!isRenderDetectionPopupSpinner\(snapshot\)[\s\S]*?sendPopupBusyMirrorMessage\(tabId, true, message, leaseDetails\)/
  );
  assert.match(popupSource, /const POPUP_PAGE_BUSY_MIRROR_DELAY_MS = 3500;/);
  assert.match(popupSource, /const POPUP_PAGE_BUSY_MIRROR_FAIL_OPEN_MS = 65000;/);
  assert.match(popupSource, /popupPageBusyMirrorShowTimer = window\.setTimeout\(\(\) => \{[\s\S]*?const currentSnapshot = getActiveSpinnerSnapshotForSurface\("page"\);[\s\S]*?const currentLeaseDetails = getPopupBusyMirrorLeaseDetails\(currentSnapshot\);[\s\S]*?sendPopupBusyMirrorMessage\(tabId, true, message, currentLeaseDetails\);[\s\S]*?\}, POPUP_PAGE_BUSY_MIRROR_DELAY_MS\);/);
  assert.match(popupSource, /function clearPopupPageBusyMirrorShowTimer\(\) \{[\s\S]*?popupPageBusyMirrorPendingSignature = "";/);
  assert.match(popupSource, /type: "setPopupBusyOnPage"/);
  assert.match(popupSource, /syncPageBusyFromPopupSpinner/);
  assert.match(popupSpinnerSource, /function syncPageBusyFromPopupSpinner\(deps\)/);
  assert.match(popupSpinnerSource, /deps\.setUiBusyFromCurrentSpinner\(\);[\s\S]*?syncPageBusyFromPopupSpinner\(deps\);/);
  assert.match(popupSpinnerSource, /deps\.uiModule\.setUiBusy\(false\);[\s\S]*?syncPageBusyFromPopupSpinner\(deps\);/);
});

test("popup selects active blocking spinner instead of the queue tail", () => {
  assert.match(
    popupSource,
    /function getActiveSpinnerSnapshotForSurface\(surface\) \{[\s\S]*?const entries = \[\.\.\.popupSpinnerQueue\.entries\(\)\];[\s\S]*?for \(let index = entries\.length - 1; index >= 0; index -= 1\)[\s\S]*?spinnerSnapshotBlocksSurface\(snapshot, surface\)/
  );
  assert.match(
    popupSource,
    /function setUiBusyFromCurrentSpinner\(\) \{[\s\S]*?const snapshot = getActiveSpinnerSnapshotForSurface\("popup"\);/
  );
  assert.match(
    popupSource,
    /const popupSpinnerSnapshot = getActiveSpinnerSnapshotForSurface\("popup"\);[\s\S]*?const popupBusyActive = Boolean\(popupSpinnerVisible && popupSpinnerSnapshot\);/
  );
});

test("popup preserves broker lease metadata when rebuilding spinner snapshots", () => {
  const snapshotBlock = extractSourceBlock(
    popupSource,
    "function applyBackgroundStateSnapshot(snapshot) {",
    "function connectBackgroundStatePort"
  );

  assert.match(snapshotBlock, /blockSurfaces: entry\.blockSurfaces && typeof entry\.blockSurfaces === "object"[\s\S]*?page: entry\.blockSurfaces\.page === true,[\s\S]*?popup: entry\.blockSurfaces\.popup === true/);
  assert.match(snapshotBlock, /operationId: typeof entry\.operationId === "string" \? entry\.operationId : ""/);
  assert.match(snapshotBlock, /maxDurationMs: Number\.isFinite\(entry\.maxDurationMs\) \? Number\(entry\.maxDurationMs\) : undefined/);
  assert.match(snapshotBlock, /updatedAt: Number\.isFinite\(entry\.updatedAt\) \? Number\(entry\.updatedAt\) : 0/);
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

test("popup render mode inspection surfaces follow-up errors before reload", () => {
  const inspectionBlock = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );

  assert.match(inspectionBlock, /const inspectionFailureError = inspectionResult && typeof inspectionResult\.followUpError === "string"/);
  assert.match(inspectionBlock, /const operationResult = inspectionResponse && inspectionResponse\.ok && inspectionResponse\.result/);
  assert.match(inspectionBlock, /const inspectionResult = operationResult && operationResult\.result && typeof operationResult\.result === "object"/);
  assert.match(inspectionBlock, /operationResult && typeof operationResult\.error === "string" && operationResult\.error/);
  assert.match(inspectionBlock, /error: inspectionFailureError \|\| PopupText\.renderMode\.toastInspectReloadFailed/);
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

  assert.match(
    inspectionBlock,
    /messages\.requestTabRunRenderModeInspection\(tabId, \{[\s\S]*?baseUrl: state\.currentBaseUrl,[\s\S]*?javaScriptDisabled,[\s\S]*?operationId/
  );
  assert.match(
    inspectionBlock,
    /const loadStarted = Boolean\(inspectionResult && inspectionResult\.loadStarted\);[\s\S]*?resolveRenderModeInspectionReloadOutcome\(reloadResult,\s*loadStarted,\s*javaScriptDisabled\)/
  );
  assert.match(
    inspectionBlock,
    /const followUpCompleted = Boolean\(inspectionResult && inspectionResult\.followUpCompleted\);[\s\S]*?if \(followUpCompleted\) \{[\s\S]*?rememberRenderModeInspectionSnapshot\([\s\S]*?await reconcilePropertyLockAfterRenderModeReload\(\);[\s\S]*?await refreshUi\(\{ useBusyOverlay: false \}\);/
  );
  assert.match(
    inspectionBlock,
    /\} finally \{[\s\S]*?scheduleStaleInspectionBusyClear\(tabId, state\.currentBaseUrl, \{[\s\S]*?reconcileRenderModeNavSpinner: true[\s\S]*?\}\);[\s\S]*?\}/
  );
  assert.doesNotMatch(inspectionBlock, /type: "renderModeInspectionBegin"/);
  assert.doesNotMatch(inspectionBlock, /type: "runRenderModeRevealOnce"/);
  assert.doesNotMatch(inspectionBlock, /type: "captureRenderModeInspectionHtml"/);
  assert.doesNotMatch(inspectionBlock, /type: "renderModeInspectionEnd"/);
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
    /const wasNoJsHeld = tabId \? await isRenderModeNoJsHeld\(tabId\) : false;/
  );
  assert.match(
    setBlock,
    /if \(tabId && wasNoJsHeld\) \{[\s\S]*?await normalizeRenderModeDebuggerPage\(tabId\);[\s\S]*?\}/
  );
  assert.match(
    setBlock,
    /await messages\.requestTabEndRenderModeInspection\(tabId,\s*\{[\s\S]*?operationId:\s*`render-mode-set-exit:\$\{tabId\}:\$\{Date\.now\(\)\}`/
  );
  assert.match(
    setBlock,
    /if \(tabId && wasNoJsHeld\) \{[\s\S]*?await messages\.sendTabMessageWithRetry\(\{[\s\S]*?type:\s*"configUpdated",[\s\S]*?baseUrl:\s*state\.currentBaseUrl[\s\S]*?\},\s*8\);[\s\S]*?\} else \{[\s\S]*?await messages\.sendTabMessage\(\{[\s\S]*?type:\s*"configUpdated",[\s\S]*?baseUrl:\s*state\.currentBaseUrl[\s\S]*?\}\);[\s\S]*?\}/
  );
  assert.match(
    setBlock,
    /if \(tabId && !wasNoJsHeld\) \{[\s\S]*?await normalizeRenderModeDebuggerPage\(tabId\);[\s\S]*?\}/
  );
  assert.match(
    setBlock,
    /if \(tabId\) \{[\s\S]*?if \(wasNoJsHeld\) \{[\s\S]*?await normalizeRenderModeDebuggerPage\(tabId\);[\s\S]*?state\.renderModeEditMode = false;/
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
    "function isValidEmail"
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
    /state\.tokenValidationTimer = popupTimers\.setInterval\("token-validation",[\s\S]*?TOKEN_VALIDATION_INTERVAL_MS\);[\s\S]*?await refreshUi\(\{ useBusyOverlay: false \}\);/
  );
});
