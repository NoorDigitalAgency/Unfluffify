import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { buildPageSaveUiState } from "../src/common/page-save-state.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const pageReconciliationSource = readFileSync(new URL("../src/popup/page-reconciliation.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");

function computeButtonDisabledForState({
  pageScopedUiDisabled = false,
  aiBusy = false,
  previewRestorePending = false,
  aiReady = true,
  pageSaveReconciliationPending = false,
  aiRunUpToDate = false,
  sessionRequiresAiRun = false
} = {}) {
  return (
    pageScopedUiDisabled ||
    aiBusy ||
    previewRestorePending ||
    !aiReady ||
    pageSaveReconciliationPending ||
    (aiRunUpToDate && !sessionRequiresAiRun)
  );
}

function markingPreviewDisabledForState({
  aiBusy = false,
  previewRestorePending = false,
  pageSaveReconciliationPending = false,
  aiRunUpToDate = false,
  sessionRequiresAiRun = false
} = {}) {
  return (
    aiBusy ||
    previewRestorePending ||
    pageSaveReconciliationPending ||
    !aiRunUpToDate ||
    sessionRequiresAiRun
  );
}

test("state tracks the AI-run markings fingerprint", () => {
  assert.match(stateSource, /aiRunMarkingsFingerprint: null/);
});

test("fingerprint only covers exclude and include xpaths", () => {
  const fnBody = popupSource.match(
    /function fingerprintPageMarkingEntry\(entry(?:\s*:\s*[^)]+)?\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(fnBody, /entry\.xpaths/);
  assert.match(fnBody, /entry\.includeXpaths/);
  assert.doesNotMatch(fnBody, /cssSelectors/);
});

test("a successful AI run captures the markings fingerprint", () => {
  const fnBody = popupSource.match(
    /function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  assert.match(fnBody, /captureAiRunMarkingsFingerprint\(\);/);
});

test("an AI run computes selectors locally and does not auto-sync to the server", () => {
  const fnBody = popupSource.match(
    /function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  // Save (handlePageSave) is the explicit server-sync step; the AI run must not push.
  assert.doesNotMatch(fnBody, /syncBaseConfigToServer\(/);
  assert.match(fnBody, /PopupText\.ai\.selectorsComputedLocally/);
});

test("entering marking mode, saving, and discarding reset the fingerprint", () => {
  // Enabling marking: Run AI starts enabled.
  assert.match(
    popupSource,
    /const enableResponse = await messages\.requestTabActivateMarking[\s\S]*?if \(!enableResponse \|\| !enableResponse\.ok\) \{[\s\S]*?return;[\s\S]*?\}\s*\/\/[\s\S]*?resetAiRunMarkingsFingerprint\(\);/
  );
  // Save success.
  assert.match(
    pageReconciliationSource,
    /await deps\.clearCurrentPageSaveReconciliation\(\);\s*deps\.resetAiRunMarkingsFingerprint\(\);\s*await deps\.applyPostSaveSilentTransition\(\);\s*deps\.updateLastConfigSaveStatus\(deps\.PopupText\.page\.savedAndSynced\);/
  );
  // Discard (applyLocalPageDiscard, shared by manual discard + disable/nav confirm).
  assert.match(
    popupSource,
    /state\.aiSelectorsComputedBaseUrl = "";\s*resetAiRunMarkingsFingerprint\(\);\s*\}/
  );
});

test("a successful save transitions the popup from marking to silent mode", () => {
  const fnBody = popupSource.match(
    /async function applyPostSaveSilentTransition\(\) \{([\s\S]*?)\n\}/
  )[1];
  // The post-save content transition is delegated to background command authority.
  assert.match(fnBody, /await messages\.requestTabApplyPostSaveTransition\(tabId, \{ baseUrl \}\);/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "configUpdated",[\s\S]*?forceReloadPageEntry: true/);
  assert.match(backgroundSource, /type: "setEnabled",[\s\S]*?enabled: false/);
  assert.match(fnBody, /state\.currentDraftDirty = false;/);
  // Align popup + tab state to silent via the shared helper.
  assert.match(fnBody, /await alignPopupToSilentMode\(\);/);
});

test("aligning to silent mode clears the popup toggle without touching content", () => {
  const fnBody = popupSource.match(
    /async function alignPopupToSilentMode\(\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(fnBody, /enabled: false/);
  assert.match(fnBody, /clearLastPopupEnabled\(\);/);
  assert.match(fnBody, /toggleEnabled: false/);
  // No enable/disable message is sent to the content script here.
  assert.doesNotMatch(fnBody, /setEnabled/);
});

test("State A fresh marking entry keeps Run AI enabled while Save/Discard/Show Content List stay disabled", () => {
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    reconciliation: null
  });

  assert.equal(
    computeButtonDisabledForState({
      aiRunUpToDate: false,
      sessionRequiresAiRun: false
    }),
    false
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunUpToDate: false,
      sessionRequiresAiRun: false
    }),
    true
  );
  assert.equal(pageSaveUiState.pageSaveDisabled, true);
  assert.equal(pageSaveUiState.pageRevertDisabled, true);
});

test("State B stale post-edit keeps Run AI enabled, disables Show Content List/Save, and keeps Discard enabled", () => {
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
    reconciliation: null
  });

  assert.equal(
    computeButtonDisabledForState({
      aiRunUpToDate: false,
      sessionRequiresAiRun: true
    }),
    false
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunUpToDate: false,
      sessionRequiresAiRun: true
    }),
    true
  );
  assert.equal(pageSaveUiState.pageSaveDisabled, true);
  assert.equal(pageSaveUiState.pageRevertDisabled, false);
});

test("State C clean post-AI-run keeps Run AI disabled and enables Show Content List/Save/Discard", () => {
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    reconciliation: null
  });

  assert.equal(
    computeButtonDisabledForState({
      aiRunUpToDate: true,
      sessionRequiresAiRun: false
    }),
    true
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunUpToDate: true,
      sessionRequiresAiRun: false
    }),
    false
  );
  assert.equal(pageSaveUiState.pageSaveDisabled, false);
  assert.equal(pageSaveUiState.pageRevertDisabled, false);
});

test("Run AI stays enabled when the session needs a rerun elsewhere", () => {
  assert.match(
    popupSource,
    /nextViewState\.computeButtonDisabled =\s*pageScopedUiDisabled \|\|\s*aiBusy \|\|\s*previewRestorePending \|\|\s*!aiReady \|\|\s*pageSaveReconciliationPending \|\|\s*\(aiRunUpToDate && !sessionRequiresAiRun\);/
  );
});

test("Save uses the page-save state instead of the redundant AI-run fingerprint gate", () => {
  assert.match(
    popupSource,
    /nextViewState\.pageSaveDisabled =\s*pageSaveUiState\.pageSaveDisabled \|\| previewRestorePending;/
  );
  assert.doesNotMatch(
    popupSource,
    /nextViewState\.pageSaveDisabled = pageSaveUiState\.pageSaveDisabled \|\| !aiRunUpToDate;/
  );
  assert.match(
    popupSource,
    /sessionRequiresAiRun,[\s\S]*?reconciliation: state\.currentPageSaveReconciliation/
  );
});

test("marking-mode preview stays gated on AI-run freshness and session freshness", () => {
  assert.match(
    popupSource,
    /nextViewState\.markingPreviewVisible = pageControlsVisible && Boolean\(isEnabled\);/
  );
  assert.match(
    popupSource,
    /nextViewState\.markingPreviewDisabled =\s*aiBusy \|\|\s*previewRestorePending \|\|\s*pageSaveReconciliationPending \|\|\s*!aiRunUpToDate \|\|\s*sessionRequiresAiRun;/
  );
  assert.match(popupSource, /onMarkingPreview: handleMarkingPreview,/);
  assert.match(popupSource, /async function handleMarkingPreview\(\) \{/);
  assert.match(uiSource, /id: "marking-preview"/);
  assert.match(uiSource, /onClick: handlers\.onMarkingPreview/);
  // The preview button renders full-width (not inside the half-width button-row grid).
  const previewBlock = uiSource.match(
    /markingMode && view\.markingPreviewVisible\) \{([\s\S]*?)\n {2}\}/
  )[1];
  assert.match(previewBlock, /class: "u-btn-secondary u-full-width"/);
  assert.doesNotMatch(previewBlock, /button-row/);
});

test("navigating away from a pending marking session prompts to discard first", () => {
  const fnBody = popupSource.match(
    /async function confirmNavigationAwayFromMarking\(\) \{([\s\S]*?)\n\}/
  )[1];
  // Clean session / silent mode navigates freely.
  assert.match(fnBody, /if \(!view\.toggleEnabled\) \{\s*return true;\s*\}/);
  assert.match(
    fnBody,
    /if \(!view\.sessionHasPendingChanges\) \{[\s\S]*?await alignPopupToSilentMode\(\);\s*return true;\s*\}/
  );
  assert.match(fnBody, /const pendingKnownFromCurrentView = Boolean\(view\.sessionHasPendingChanges\);/);
  assert.match(
    fnBody,
    /if \([\s\S]*?helpers\.ensureActiveTab\(\{ requireId: true \}\)[\s\S]*?state\.currentBaseUrl[\s\S]*?!pendingKnownFromCurrentView[\s\S]*?\) \{[\s\S]*?await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);/
  );
  // Pending session shows toast + confirm gated on the same discard flow.
  assert.match(fnBody, /window\.confirm\(PopupText\.page\.navigateDiscardConfirm\)/);
  // Cancel stops navigation; OK discards locally before navigating.
  assert.match(fnBody, /if \(!confirmedDiscard\) \{[\s\S]*?return false;\s*\}/);
  // OK discards locally and resets the popup + tab state to silent (#6/#7).
  assert.match(fnBody, /await applyLocalPageDiscard\(\);\s*await alignPopupToSilentMode\(\);\s*return true;/);
  // All user-initiated navigation funnels through the guard.
  assert.match(
    popupSource,
    /async function navigateActiveTabToUrlWithTodoCollapse\(url(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{\s*if \(!\(await confirmNavigationAwayFromMarking\(\)\)\) \{/
  );
  assert.match(popupSource, /type: "navigateTabToUrl"/);
  assert.doesNotMatch(popupSource, /chrome\.tabs\.update/);
});

test("silent-mode reveal/freeze surfaces the inspecting curtain", () => {
  // The popup polls inspection status in silent mode (in-scope page), not only marking.
  assert.match(
    popupSource,
    /const silentInspectionInScope = Boolean\(\s*currentTabId &&\s*!markingInspectionInScope &&\s*tabInScope &&\s*baseUrlReady\s*\);/
  );
  assert.match(
    popupSource,
    /markingInspectionInScope \|\| silentInspectionInScope\s*\?\s*await messages\.sendTabMessageToTab\(currentTabId, \{ type: "getInspectionStatus" \}\)/
  );
  // Runtime status refresh also runs in silent mode so the curtain can clear.
  assert.match(
    popupSource,
    /isEnabled \|\| toggleEnabled \|\| effectiveTabState\.enabled \|\| navigationInspectionPending \|\| silentInspectionInScope/
  );
  // Silent mode keeps polling until the reveal/freeze warmup clears the curtain,
  // including a leftover navigation-inspection spinner restored from a prior
  // marking session.
  assert.match(
    popupSource,
    /const silentNavSpinnerStuck = Boolean\(\s*silentInspectionInScope &&\s*currentTabId &&\s*popupSpinnerQueue\.has\("navInspect"\)\s*\);/
  );
  assert.match(
    popupSource,
    /scheduleStaleInspectionBusyClear\(currentTabId, runtimeStatusBaseUrl, \{\s*reconcileSilentNavSpinner: silentNavSpinnerStuck\s*\}\);/
  );
  // The stale-clear reconciles a stuck silent-mode navigation spinner by ending
  // the leftover overlay once inspection is no longer pending.
  assert.match(
    popupSource,
    /silentNavSpinnerStuck \|\| renderModeNavSpinnerStuck\) \{[\s\S]*?renderModeNavSpinnerStuck \? "render-mode-nav-curtain-clear" : "silent-nav-curtain-clear"[\s\S]*?endNavigationInspectionOverlay\(tabId\);/
  );
});

// --- #21: marking-mode button states after a clean AI run + preview exit ---
// After a clean AI run that returns to marking mode (per the #17 fix), the four
// controls must render State C: Run AI DISABLED (already ran), Show Content List
// ENABLED, Save ENABLED, Discard ENABLED. The two signals that drive this are
// aiRunUpToDate (fingerprint freshness) and sessionRequiresAiRun.

test("#21 fingerprint normalizes markings to xpath identity strings", () => {
  const fnBody = popupSource.match(
    /function fingerprintPageMarkingEntry\(entry(?:\s*:\s*[^)]+)?\) \{([\s\S]*?)\n\}/
  )[1];
  // Exclude markings are reduced to `${xpath}|${excluded?1:0}` so incidental
  // entry-object shape/order differences across the run+exit cycle do not
  // spuriously invalidate the fingerprint.
  assert.match(fnBody, /\$\{item\.xpath\}\|\$\{item\.excluded \? "1" : "0"\}/);
  // Both lists are sorted for a stable, order-independent signature.
  assert.match(fnBody, /excludeXpaths\.sort\(\);/);
  assert.match(fnBody, /includeXpaths\.sort\(\);/);
  // Still scoped to element markings only (no CSS selectors).
  assert.doesNotMatch(fnBody, /cssSelectors/);
});

test("#21 a clean AI run opens preview before config sync can hydrate content state", () => {
  const fnBody = popupSource.match(
    /async function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  // Capture the current markings before preview-open so the popup does not need
  // a blocking draft probe, then queue configUpdated until the async item
  // hydration reports that the preview list is no longer pending.
  assert.match(
    fnBody,
    /captureAiRunMarkingsFingerprint\(\);[\s\S]*?requestTabShowAiPreview[\s\S]*?if \(previewResult\) \{[\s\S]*?queueAiPreviewConfigSync\(tabId, state\.currentBaseUrl\);[\s\S]*?if \(!\(previewStatePayload && previewStatePayload\.itemsPending\)\) \{[\s\S]*?flushPendingAiPreviewConfigSync\(\);[\s\S]*?\}[\s\S]*?\} else \{[\s\S]*?await messages\.sendTabMessageToTab\(tabId, \{\s*type: "configUpdated",\s*baseUrl: state\.currentBaseUrl\s*\}, \{\s*timeoutMs: 30000\s*\}\);[\s\S]*?await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?captureAiRunMarkingsFingerprint\(\);/
  );
  assert.doesNotMatch(
    fnBody,
    /sendTabMessageToTab\(tabId, \{\s*type: "configUpdated",\s*baseUrl: state\.currentBaseUrl\s*\}, \{\s*timeoutMs: 30000\s*\}\);[\s\S]*?requestTabShowAiPreview/
  );
  const captureIndex = fnBody.indexOf("captureAiRunMarkingsFingerprint();");
  const previewIndex = fnBody.indexOf("requestTabShowAiPreview");
  assert.ok(captureIndex > -1 && previewIndex > -1 && captureIndex < previewIndex);
});

test("#21 config sync flushes after async preview item hydration", () => {
  assert.match(
    popupSource,
    /function applyAiPreviewStateUpdate\(message(?:\s*:\s*[^)]*)?\) \{[\s\S]*?const nextPreviewState = buildPreviewViewState\(message\);[\s\S]*?uiModule\.setViewState\(\{[\s\S]*?\}\);[\s\S]*?if \(!nextPreviewState\.previewItemsPending\) \{[\s\S]*?flushPendingAiPreviewConfigSync\(\);/
  );
  assert.match(
    popupSource,
    /function buildPreviewViewState\(previewState(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?previewItemsPending: Boolean\([\s\S]*?previewState\.itemsPending[\s\S]*?\),/
  );
});

test("#21 an up-to-date AI run no longer forces another run for Save", () => {
  const fnBody = popupSource.match(
    /function doesSessionRequireAiRun\([\s\S]*?\n\}/
  )[0];
  // The dirty-draft early return is skipped once the run matches live markings,
  // so State C (clean run) can Save while State B (post-change) still requires a run.
  assert.match(
    fnBody,
    /if \(options\.currentDraftDirty && !options\.aiRunUpToDate\) \{\s*return true;\s*\}/
  );
});

test("#21 refresh feeds aiRunUpToDate into the session-requires-AI-run check", () => {
  // aiRunUpToDate is computed before doesSessionRequireAiRun and passed in.
  assert.match(
    popupSource,
    /const aiRunUpToDate = isAiRunUpToDateForCurrentMarkings\(\);\s*const sessionRequiresAiRun = doesSessionRequireAiRun\([\s\S]*?\{ currentDraftDirty: state\.currentDraftDirty, aiRunUpToDate \}\s*\);/
  );
});

test("#21 preview-exit restore prioritizes popup snapshot restore with payload fallback", () => {
  assert.match(
    popupSource,
    /function beginPreviewRestorePending\(\) \{[\s\S]*?state\.previewRestoreToken \+= 1;[\s\S]*?state\.previewRestorePending = true;[\s\S]*?schedulePreviewRestoreFallback\(state\.previewRestoreToken\);/
  );
  assert.match(popupSource, /function captureMarkingSessionSnapshot\(\) \{/);
  assert.match(popupSource, /function restoreMarkingSessionSnapshot\(\) \{/);
  assert.match(popupSource, /function clearMarkingSessionSnapshot\(\) \{/);
  assert.match(
    popupSource,
    /if \(previewOpened\) \{[\s\S]*?resetAiRunState\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?uiModule\.setViewState\(\{/
  );
  assert.match(
    popupSource,
    /async function handleMarkingPreview\(\) \{[\s\S]*?await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?setPreviewBlocked\(true, PopupText\.preview\.blockedActive\);/
  );
  assert.match(
    popupSource,
    /const preserveEnabledDuringPreviewCloseRestore = Boolean\(\s*previewRestorePending &&\s*tabInScope &&\s*!contentMarkingEnabled\s*\);/
  );
  assert.match(
    popupSource,
    /async function handleExitPreviewMode\(\) \{[\s\S]*?if \(shouldRestoreMarking && restoreMarkingSessionSnapshot\(\)\) \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?await refreshUi\(\{[\s\S]*?preserveCurrentDraftStatus: true[\s\S]*?\}\)(?:\.catch\(\(\) => null\))?;[\s\S]*?if \(previewRestoreToken !== null\) \{[\s\S]*?state\.previewRestoreAppliedToken = Math\.max\(\s*state\.previewRestoreAppliedToken,\s*previewRestoreToken\s*\);[\s\S]*?\}[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(closeResult && \(typeof closeResult\.markingEnabled === "boolean" \|\| closeResult\.draftStatus\)\) \{[\s\S]*?await applyPreviewClosedState\(closeResult\);/
  );
  assert.match(
    popupSource,
    /async function applyPreviewClosedState\(closeState = \{\}\) \{[\s\S]*?const draftStatus = normalizedCloseState\.draftStatus[\s\S]*?applyDraftStatusToPopupState\(draftStatus\)[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?clearMarkingSessionSnapshot\(\);/
  );
  assert.match(
    popupSource,
    /nextViewState\.toggleEnabledDisabled =[\s\S]*?previewRestorePending[\s\S]*?pageSaveReconciliationPending/
  );
  assert.match(
    popupSource,
    /nextViewState\.pageSaveDisabled =\s*pageSaveUiState\.pageSaveDisabled \|\| previewRestorePending;/
  );
  assert.match(
    popupSource,
    /nextViewState\.pageRevertDisabled =\s*pageSaveUiState\.pageRevertDisabled \|\| previewRestorePending;/
  );
  assert.match(
    popupSource,
    /function schedulePreviewRestoreFallback\(token: number, delayMs = AI_PREVIEW_RESTORE_FALLBACK_MS\) \{[\s\S]*?finalizePreviewRestoreFromRuntime\(\{ token \}\)/
  );
  assert.match(popupSource, /const AI_PREVIEW_RESTORE_FALLBACK_MS = 1000;/);
});

// --- #22: exiting the content list must be state-neutral (S4 == S3) ---
// Show Content List is read-only. After exit, the caller applies the
// authoritative preview-close draft snapshot; the marking refresh must NOT
// re-probe getPageDraftStatus and clobber state.currentDraftEntry with a
// transient re-derived entry, which would flip aiRunUpToDate false and
// blanket-disable Run AI / Show Content List / Save / Discard with the
// "Run AI content detection before saving or exiting marking." notice.

test("#22 runtime-status refresh can preserve the authoritative draft across preview exit", () => {
  // The probe gains a preserveDraft switch that skips the draft overwrite while
  // still refreshing inspection/reconciliation signals.
  assert.match(
    popupSource,
    /const preserveDraft = Boolean\(options\.preserveDraft\);/
  );
  assert.match(
    popupSource,
    /if \(!preserveDraft\) \{\s*applyDraftStatusToPopupState\(draftStatus\);\s*\}/
  );
});

test("#22 the marking refresh threads preserveCurrentDraftStatus into the runtime probe", () => {
  // When refreshUi runs with preserveCurrentDraftStatus (the preview-close path),
  // the runtime probe must preserve the just-applied authoritative draft so the
  // AI-run fingerprint still matches and the buttons stay in State C.
  assert.match(
    popupSource,
    /latestRuntimeStatus = await refreshCurrentPageRuntimeStatus\(\{\s*tabId: currentTabId,\s*baseUrl: runtimeStatusBaseUrl,\s*preserveDraft: preserveCurrentDraftStatus\s*\}\);/
  );
});

test("#23 the post-AI cleanup refresh stays quiet and preserves draft only for preview mode", () => {
  // Right after a successful AI run, stopAiRun must not raise the generic
  // "Refreshing popup data..." curtain. When preview is showing, that same quiet
  // refresh still needs to preserve the just-captured draft snapshot so the popup
  // keeps State C instead of recomputing from preview-mode content state.
  assert.match(
    popupSource,
    /async function stopAiRun\(options(?:\s*:\s*[^)]+)? = \{\}\) \{[\s\S]*?const currentView = uiModule\.getViewState\(\);[\s\S]*?const previewShowing = Boolean\(currentView\.previewBlocked \|\| currentView\.previewActive\);[\s\S]*?const preserveCurrentDraftStatus = Boolean\(\s*previewShowing && currentView\.previewWillRestoreMarking\s*\);[\s\S]*?await refreshUi\(\{\s*useBusyOverlay: false,\s*preserveCurrentDraftStatus\s*\}\);/
  );
});

test("#24 the immediate AI-result path does not trigger a second blocking refresh", () => {
  const fnBody = popupSource.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(fnBody, /await applyComputedSelectorSet\(normalizeAiSelectorSet\(runResult\.selectorSet\), \{/);
  assert.match(fnBody, /await stopAiRun\(\{ unlockPage: false \}\);/);
  assert.doesNotMatch(fnBody, /if \(!previewOpened\) \{\s*await refreshUi\(\);\s*\}/);
});
