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

test("entering marking mode, saving, and discarding reset the fingerprint", () => {
  // Enabling marking: Run AI starts enabled.
  assert.match(
    popupSource,
    /await waitForEnableMarkingInspectionToSettle\(tab\.id, effectiveBaseUrl\);\s*\/\/[\s\S]*?resetAiRunMarkingsFingerprint\(\);/
  );
  // Save success.
  assert.match(
    popupSource,
    /await clearCurrentPageSaveReconciliation\(\);\s*resetAiRunMarkingsFingerprint\(\);\s*updateLastConfigSaveStatus\(PopupText\.page\.savedAndSynced\);/
  );
  // Discard success.
  assert.match(
    popupSource,
    /state\.aiSelectorsComputedBaseUrl = "";\s*resetAiRunMarkingsFingerprint\(\);\s*updateLastConfigSaveStatus\(PopupText\.page\.revertedToLastSaved\);/
  );
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
});
