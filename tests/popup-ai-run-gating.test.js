import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../popup/state.js", import.meta.url), "utf8");

test("state tracks the AI-run markings fingerprint", () => {
  assert.match(stateSource, /aiRunMarkingsFingerprint: null/);
});

test("fingerprint only covers exclude and include xpaths", () => {
  const fnBody = popupSource.match(
    /function fingerprintPageMarkingEntry\(entry\) \{([\s\S]*?)\n\}/
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
    /await waitForEnableMarkingInspectionToSettle\(tab\.id, effectiveBaseUrl\);\s*\/\/[\s\S]*?resetAiRunMarkingsFingerprint\(\);/
  );
  // Save success.
  assert.match(
    popupSource,
    /await clearCurrentPageSaveReconciliation\(\);\s*resetAiRunMarkingsFingerprint\(\);\s*\/\/[\s\S]*?await applyPostSaveSilentTransition\(\);\s*updateLastConfigSaveStatus\(PopupText\.page\.savedAndSynced\);/
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
  // Reset the content page entry to the saved baseline (drop session deltas).
  assert.match(fnBody, /forceReloadPageEntry: true/);
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

test("Run AI is disabled while the run is up to date for current markings", () => {
  assert.match(
    popupSource,
    /nextViewState\.computeButtonDisabled =\s*pageScopedUiDisabled \|\|\s*aiBusy \|\|\s*!aiReady \|\|\s*pageSaveReconciliationPending \|\|\s*aiRunUpToDate;/
  );
});

test("Save is enabled only when the AI run is up to date", () => {
  assert.match(
    popupSource,
    /nextViewState\.pageSaveDisabled = pageSaveUiState\.pageSaveDisabled \|\| !aiRunUpToDate;/
  );
});

test("marking-mode preview mirrors Save gating and is wired to a handler", () => {
  assert.match(
    popupSource,
    /nextViewState\.markingPreviewVisible = pageControlsVisible && Boolean\(isEnabled\);/
  );
  assert.match(
    popupSource,
    /nextViewState\.markingPreviewDisabled =\s*aiBusy \|\|\s*pageSaveReconciliationPending \|\|\s*!aiRunUpToDate;/
  );
  assert.match(popupSource, /onMarkingPreview: handleMarkingPreview,/);
  assert.match(popupSource, /async function handleMarkingPreview\(\) \{/);
  assert.match(uiSource, /id: "marking-preview"/);
  assert.match(uiSource, /onClick: handlers\.onMarkingPreview/);
  // The preview button renders full-width (not inside the half-width button-row grid).
  const previewBlock = uiSource.match(
    /markingMode && view\.markingPreviewVisible\) \{([\s\S]*?)\n  \}/
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
  // Pending session shows toast + confirm gated on the same discard flow.
  assert.match(fnBody, /window\.confirm\(PopupText\.page\.navigateDiscardConfirm\)/);
  // Cancel stops navigation; OK discards locally before navigating.
  assert.match(fnBody, /if \(!confirmedDiscard\) \{[\s\S]*?return false;\s*\}/);
  // OK discards locally and resets the popup + tab state to silent (#6/#7).
  assert.match(fnBody, /await applyLocalPageDiscard\(\);\s*await alignPopupToSilentMode\(\);\s*return true;/);
  // All user-initiated navigation funnels through the guard.
  assert.match(
    popupSource,
    /async function navigateActiveTabToUrlWithTodoCollapse\(url\) \{\s*if \(!\(await confirmNavigationAwayFromMarking\(\)\)\) \{/
  );
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
