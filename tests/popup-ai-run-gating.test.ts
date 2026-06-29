import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { deriveDictation } from "../src/background/brain/deciders/dictation-decider.js";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES, BUTTON_IDS } from "../src/common/bus/contracts/session-state.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const pageReconciliationSource = readFileSync(new URL("../src/popup/page-reconciliation.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");
const contentCoreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
const viewProjectorSource = readFileSync(new URL("../src/background/brain/view-projector.ts", import.meta.url), "utf8");

function computeButtonDisabledForState({
  pageScopedUiDisabled = false,
  aiBusy = false,
  previewRestorePending = false,
  pageSaveReconciliationPending = false,
  saving = false,
  discarding = false,
  aiRunPhase = AI_RUN_PHASES.PRE_AI
} = {}) {
  return (
    pageScopedUiDisabled ||
    aiBusy ||
    previewRestorePending ||
    pageSaveReconciliationPending ||
    saving ||
    discarding ||
    aiRunPhase === AI_RUN_PHASES.POST_AI
  );
}

function markingPreviewDisabledForState({
  aiBusy = false,
  previewRestorePending = false,
  pageSaveReconciliationPending = false,
  saving = false,
  discarding = false,
  aiRunPhase = AI_RUN_PHASES.PRE_AI
} = {}) {
  return (
    aiBusy ||
    previewRestorePending ||
    pageSaveReconciliationPending ||
    saving ||
    discarding ||
    aiRunPhase !== AI_RUN_PHASES.POST_AI
  );
}

test("state tracks the AI-run markings fingerprint with a null sentinel", () => {
  assert.match(stateSource, /aiRunMarkingsFingerprint: null/);
});

test("a successful AI run captures the markings fingerprint", () => {
  const fnBody = popupSource.match(
    /function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  assert.match(fnBody, /captureAiRunMarkingsFingerprint\(\);/);
  assert.match(fnBody, /publishCurrentTabAiRunEvent\(AI_RUN_EVENT_TYPES\.RESULTS_APPLIED\);/);
  assert.doesNotMatch(fnBody, /markSessionAiRunPostAi\(\);/);
});

test("post-AI phase locks content marking edits through the brain directive", () => {
  assert.match(
    viewProjectorSource,
    /markingEditsBlocked: Boolean\([\s\S]*state\.sessionFacts\.aiRunPhase === AI_RUN_PHASES\.POST_AI/
  );
  assert.match(
    contentCoreSource,
    /if \(isMarkingEditsBlockedByDirective\(\)\) \{\s*return "post_ai";\s*\}/
  );
  assert.match(
    contentCoreSource,
    /const temporarilyDisabledReason = getMarkingTemporarilyDisabledReason\(\);[\s\S]*if \(temporarilyDisabledReason\) \{[\s\S]*return;/
  );
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
    /await deps\.clearCurrentPageSaveReconciliation\(\);\s*deps\.clearSelectorsPendingConfigSync\?\.\(\);\s*deps\.resetAiRunMarkingsFingerprint\(\);\s*await deps\.applyPostSaveSilentTransition\(\);\s*deps\.updateLastConfigSaveStatus\(deps\.PopupText\.page\.savedAndSynced\);/
  );
  // Discard (applyLocalPageDiscard, shared by manual discard + disable/nav confirm).
  // PRE_AI reset + reconciliation clear run before the content roundtrip so a
  // failed/slow tab discard cannot leave the popup wedged in POST_AI.
  assert.match(
    popupSource,
    /state\.currentDraftEntry = null;\s*state\.currentSavedEntry = null;\s*state\.currentDraftDirty = false;\s*state\.currentDraftAvailable = false;\s*state\.aiSelectorsComputedSinceLastSubmit = false;\s*state\.aiSelectorsComputedBaseUrl = "";\s*clearSelectorsPendingConfigSync\(\);\s*resetAiRunMarkingsFingerprint\(\);\s*await clearCurrentPageSaveReconciliation\(\);\s*if \(tabId !== null\) \{[\s\S]*?void messages\.requestTabApplyLocalDiscard/
  );
  // Discard reverts unsaved AI-computed selectors to the last submitted baseline
  // so it returns to a true PRE_AI clean state (selectors only reconcile on Save).
  assert.match(
    popupSource,
    /if \(state\.selectorsPendingConfigSync\) \{\s*targetConfig\.selectors = normalizeAiSelectorSet\(submittedSelectorBaseline\);\s*\}/
  );
});

test("a successful save transitions the popup from marking to silent mode", () => {
  const fnBody = popupSource.match(
    /async function applyPostSaveSilentTransition\(\) \{([\s\S]*?)\n\}/
  )[1];
  // The post-save content transition is delegated to background command authority,
  // fired best-effort so a slow/locked tab cannot wedge the save spinner.
  assert.match(fnBody, /void messages\.requestTabApplyPostSaveTransition\(tabId, \{ baseUrl \}\);/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "configUpdated",[\s\S]*?forceReloadPageEntry: true/);
  assert.match(backgroundSource, /type: "setEnabled",[\s\S]*?enabled: false/);
  assert.match(fnBody, /state\.currentDraftDirty = false;/);
  // Align popup + tab state to silent via the shared helper.
  assert.match(fnBody, /await alignPopupToSilentMode\(\);/);
});

test("aligning to silent mode clears popup state without sending a fresh content setEnabled hop", () => {
  const fnBody = popupSource.match(
    /async function alignPopupToSilentMode\(\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(fnBody, /enabled: false/);
  assert.match(fnBody, /clearLastPopupEnabled\(\);/);
  assert.match(fnBody, /toggleEnabled: false/);
  assert.doesNotMatch(fnBody, /setEnabled/);
});

test("State A fresh marking entry keeps Run AI enabled while Save/Discard/Show Content List stay disabled", () => {
  assert.equal(
    computeButtonDisabledForState({
      aiRunPhase: AI_RUN_PHASES.PRE_AI
    }),
    false
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunPhase: AI_RUN_PHASES.PRE_AI
    }),
    true
  );
});

test("State B pre-AI post-edit keeps Run AI enabled and disables Show Content List/Save/Discard", () => {
  assert.equal(
    computeButtonDisabledForState({
      aiRunPhase: AI_RUN_PHASES.PRE_AI
    }),
    false
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunPhase: AI_RUN_PHASES.PRE_AI
    }),
    true
  );
});

test("State C post-AI-run keeps Run AI disabled and enables Show Content List/Save/Discard", () => {
  assert.equal(
    computeButtonDisabledForState({
      aiRunPhase: AI_RUN_PHASES.POST_AI
    }),
    true
  );
  assert.equal(
    markingPreviewDisabledForState({
      aiRunPhase: AI_RUN_PHASES.POST_AI
    }),
    false
  );
});

test("Run AI stays wired to the real popup view-state gating expression", () => {
  const facts = {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: true,
    pageInspectionBusy: false,
    desktopPreviewVisible: false,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    previewActive: false,
    previewBlocked: false,
    previewRestorePending: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: true,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  };
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, !computeButtonDisabledForState({
    aiRunPhase: AI_RUN_PHASES.POST_AI
  }));
});

test("post-AI phase enables Save/Discard even when legacy freshness facts drift", () => {
  assert.match(
    popupSource,
    /sessionRequiresAiRun,[\s\S]*?reconciliation: state\.currentPageSaveReconciliation/
  );
  const facts = {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: true,
    pageInspectionBusy: false,
    desktopPreviewVisible: false,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    previewRestorePending: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: false,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  };
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(
    dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled,
    true
  );
  assert.equal(
    dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled,
    true
  );
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
  // including a popup-origin navigation-inspection lease.
  assert.match(
    popupSource,
    /const silentNavSpinnerStuck = Boolean\(\s*silentInspectionInScope &&\s*currentTabId &&\s*popupSpinnerEntriesByKey\.has\("navInspect"\)\s*\);/
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
  assert.match(fnBody, /entry\.includeXpaths/);
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

test("#21 post-AI phase bypasses legacy session-requires-AI-run fingerprint checks", () => {
  assert.match(
    popupSource,
    /const aiRunUpToDate = isAiRunUpToDateForCurrentMarkings\(\);\s*const sessionRequiresAiRun = aiRunUpToDate\s*\?\s*false\s*:\s*doesSessionRequireAiRun\([\s\S]*?\{[\s\S]*?currentDraftDirty: state\.currentDraftDirty,[\s\S]*?aiRunUpToDate[\s\S]*?\}\s*\);/
  );
});

test("#21 locally computed selectors keep session save pending until config sync clears them", () => {
  const applyComputedSelectorSetBody = popupSource.match(
    /async function applyComputedSelectorSet\([\s\S]*?\n\}\n\n/
  )[0];
  assert.match(
    applyComputedSelectorSetBody,
    /state\.aiSelectorsComputedSinceLastSubmit = hasComputedNewSelectors;\s*state\.aiSelectorsComputedBaseUrl = hasComputedNewSelectors \? state\.currentBaseUrl : "";\s*state\.selectorsPendingConfigSync = hasComputedNewSelectors;\s*state\.selectorsPendingConfigSyncBaseUrl = hasComputedNewSelectors \? state\.currentBaseUrl : "";\s*\/\/[\s\S]*?captureAiRunMarkingsFingerprint\(\);/
  );
  assert.match(
    popupSource,
    /function hasSessionPendingChanges\([\s\S]*?options\.currentDraftDirty \|\|[\s\S]*?options\.reconciliationPending \|\|[\s\S]*?options\.selectorsPendingConfigSync \|\|[\s\S]*?hasSessionPageMarkingChanges/
  );
  assert.match(
    popupSource,
    /const selectorsPendingConfigSync =\s*state\.selectorsPendingConfigSync &&\s*utils\.sameBaseUrl\(state\.selectorsPendingConfigSyncBaseUrl, state\.currentBaseUrl\);[\s\S]*?const sessionHasPendingChanges = hasSessionPendingChanges\([\s\S]*?selectorsPendingConfigSync[\s\S]*?\);/
  );
});

test("#21 base-url change and Lynx submit clear pending config sync state", () => {
  assert.match(
    popupSource,
    /function clearSelectorsPendingConfigSync\(\) \{\s*state\.selectorsPendingConfigSync = false;\s*state\.selectorsPendingConfigSyncBaseUrl = "";\s*\}/
  );
  assert.match(
    popupSource,
    /if \(state\.currentBaseUrl !== previousBaseUrl\) \{[\s\S]*?state\.aiSelectorsComputedSinceLastSubmit = false;[\s\S]*?state\.aiSelectorsComputedBaseUrl = "";[\s\S]*?clearSelectorsPendingConfigSync\(\);[\s\S]*?\}/
  );
  assert.match(
    popupSource,
    /state\.aiSelectorsComputedSinceLastSubmit = false;\s*state\.aiSelectorsComputedBaseUrl = "";\s*clearSelectorsPendingConfigSync\(\);\s*const currentPageUrl =/
  );
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
    /async function stopAiRun\(options(?:\s*:\s*[^)]+)? = \{\}\) \{[\s\S]*?const currentView = uiModule\.getViewState\(\);[\s\S]*?const previewShowing = Boolean\(currentView\.previewBlocked \|\| currentView\.previewActive\);[\s\S]*?const preserveCurrentDraftStatus = Boolean\(previewShowing\);[\s\S]*?await refreshUi\(\{\s*useBusyOverlay: false,\s*preserveCurrentDraftStatus\s*\}\);/
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
