import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES } from "../src/common/bus/contracts/session-state.js";
import { resolveMarkingSessionSurfaceMemory } from "../src/popup/marking-session-machine.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupStateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");

function extractFunctionSource(source: string, name: string): string {
  const functionStart = source.lastIndexOf(`function ${name}(`);
  assert.ok(functionStart > -1, `missing function ${name}`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === "async "
    ? functionStart - 6
    : functionStart;
  const signatureStart = source.indexOf("(", functionStart);
  let parenDepth = 0;
  let signatureEnd = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") { parenDepth += 1; continue; }
    if (char === ")") { parenDepth -= 1; if (parenDepth === 0) { signatureEnd = index; break; } }
  }
  const blockStart = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") { depth += 1; continue; }
    if (char === "}") { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

function compilePopupFns(names: string[]): string {
  const moduleSource = `${names.map((n) => extractFunctionSource(popupSource, n)).join("\n\n")}
module.exports = { ${names.join(", ")} };
`;
  return ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
}

// #5/#14 post-exit collapse: refreshUi is a long async pipeline whose passes
// interleave, so a pass reading pre-exit tab state can publish isEnabled:false
// AFTER the exit restore landed; the brain folds it, dictates SILENT, and the
// dictation tears down the successfully restored session for real. The fix is
// exact (no tunable time windows): a marking-session EPOCH invalidates stale
// passes at the moment of effect, and a restore-confirmation LATCH holds the
// popup's enabled authority until content is first observed re-enabled.

function makeSettleContext(withSnapshot: boolean) {
  const published: Array<Record<string, unknown>> = [];
  const context = {
    module: { exports: {} as { settlePreviewRestoreClosed?: (token?: number | null, markApplied?: boolean) => void } },
    exports: {},
    state: {
      previewRestorePending: true,
      previewRestoreFallbackTimer: 0,
      previewRestoreAppliedToken: 0,
      previewOpenIntent: true,
      previewSuppressReopen: false,
      previewCloseMarkingRestoreUnconfirmed: false,
      markingSessionEpoch: 0,
      previewMarkingSessionSnapshot: withSnapshot ? { sessionAiRunPhase: "post_ai" } : null
    },
    clearPreviewRestorePending: function (this: void) { context.state.previewRestorePending = false; },
    signalMarkingSession: () => undefined,
    resetPreviewItemsLatch: () => undefined,
    clearMarkingSessionSnapshot: () => { context.state.previewMarkingSessionSnapshot = null; },
    publishCurrentTabSessionFacts: (facts: Record<string, unknown>) => { published.push({ ...facts }); },
    buildPreviewViewState: () => ({}),
    stabilizePreviewViewState: (view: Record<string, unknown>) => view,
    uiModule: { setViewState: () => undefined },
    Math, Boolean
  };
  runInNewContext(compilePopupFns(["bumpMarkingSessionEpoch", "settlePreviewRestoreClosed"]), context);
  return { settle: context.module.exports.settlePreviewRestoreClosed!, state: context.state, published };
}

test("exit settle arms the restore-confirmation latch from the snapshot and bumps the epoch", () => {
  const ctx = makeSettleContext(true);
  ctx.settle(5);
  assert.equal(ctx.state.previewOpenIntent, false);
  assert.equal(ctx.state.previewSuppressReopen, true);
  assert.equal(
    ctx.state.previewCloseMarkingRestoreUnconfirmed,
    true,
    "a marking-restored exit must await content's re-enable confirmation"
  );
  assert.equal(ctx.state.markingSessionEpoch, 1, "the settle is a marking-session transition");
  assert.equal(ctx.state.previewMarkingSessionSnapshot, null, "snapshot read happens BEFORE the clear");
  assert.equal(ctx.published.length, 1);
  assert.equal(ctx.published[0].previewActive, false);
  assert.equal(ctx.published[0].previewRestorePending, false);
});

test("a close without a marking snapshot does not arm the latch but still bumps the epoch", () => {
  const ctx = makeSettleContext(false);
  ctx.settle(5);
  assert.equal(
    ctx.state.previewCloseMarkingRestoreUnconfirmed,
    false,
    "a silent-preview exit restores nothing; content staying disabled is genuine"
  );
  assert.equal(ctx.state.markingSessionEpoch, 1);
});

// The same close settles twice: the popup's runtime settle first (snapshot
// present -> latch armed + snapshot cleared), then content's token-less
// aiPreviewClosed push a few seconds later. The duplicate settle sees no
// snapshot and must NOT disarm the latch — that disarm left the unconfirmed
// restore unprotected and re-exposed the #5/#14 collapse (round-4 live trace,
// epoch bump 11).
test("a duplicate settle for the same close cannot disarm an armed restore latch", () => {
  const ctx = makeSettleContext(true);
  ctx.settle(5);
  assert.equal(ctx.state.previewCloseMarkingRestoreUnconfirmed, true);
  assert.equal(ctx.state.previewMarkingSessionSnapshot, null);
  ctx.settle(null);
  assert.equal(
    ctx.state.previewCloseMarkingRestoreUnconfirmed,
    true,
    "the token-less duplicate settle must keep the latch armed"
  );
  assert.equal(ctx.state.markingSessionEpoch, 2, "each settle is still a transition (bump)");
});

function makeOverrideContext(stateFields: Record<string, unknown>) {
  const context = {
    module: { exports: {} as { overrideDictatedPreviewVisibility?: (patch: Record<string, unknown>) => void } },
    exports: {},
    state: {
      previewRestorePending: false,
      previewOpenIntent: false,
      previewSuppressReopen: false,
      ...stateFields
    },
    PopupText: { preview: { blockedActive: "blocked-active" } },
    ViewText: { previewBlockedDefault: "blocked-default" },
    Object, Boolean
  };
  runInNewContext(compilePopupFns(["overrideDictatedPreviewVisibility"]), context);
  return context.module.exports.overrideDictatedPreviewVisibility!;
}

test("the reopen guard holds the dictated preview visibility closed after a popup-initiated close", () => {
  const override = makeOverrideContext({ previewSuppressReopen: true });
  // The brain's folded projection still carries a stale previewActive:true
  // (content's async exit + heartbeat refolds lag on heavy pages).
  const patch: Record<string, unknown> = { previewActive: true, previewBlocked: true };
  override(patch);
  assert.equal(patch.previewActive, false, "stale dictation must not reopen the closed sidebar");
  assert.equal(patch.previewBlocked, false);
});

test("open intent wins over dictated visibility; without a standing opinion the brain value is kept", () => {
  const intent = makeOverrideContext({ previewOpenIntent: true });
  const intentPatch: Record<string, unknown> = { previewActive: false, previewBlocked: false };
  intent(intentPatch);
  assert.equal(intentPatch.previewActive, true);

  const neutral = makeOverrideContext({});
  const neutralPatch: Record<string, unknown> = { previewActive: true, previewBlocked: true };
  neutral(neutralPatch);
  assert.equal(neutralPatch.previewActive, true, "no standing opinion: defer to the brain projection");
});

// Source contract for the epoch/latch wiring inside the refreshUi pipeline —
// the pass pipeline cannot be executed standalone, so the wiring is locked
// against regression at the source level.
test("refreshUi passes are epoch-gated at every marking-state effect site", () => {
  // The state fields exist with their defaults.
  assert.match(popupStateSource, /markingSessionEpoch: 0,/);
  assert.match(popupStateSource, /previewCloseMarkingRestoreUnconfirmed: false,/);

  // Each pass captures the epoch at start and derives staleness from it.
  assert.match(
    popupSource,
    /async function refreshUiInner\(options: PopupRefreshOptions = \{\}\) \{[\s\S]{0,1400}let markingEpochAtPassStart = state\.markingSessionEpoch;\s*const markingPassIsStale = \(\) => state\.markingSessionEpoch !== markingEpochAtPassStart;/
  );

  // A stale pass publishes NO marking facts (isEnabled/silentModeActive are
  // omitted from the patch; the sticky popup facts keep serving the last good
  // values, and the transition's own fresh pass republishes).
  assert.match(popupSource, /const skipMarkingFactsFromStalePass = markingPassIsStale\(\);/);
  assert.match(
    popupSource,
    /\.\.\.\(skipMarkingFactsFromStalePass\s*\?\s*\{\}\s*:\s*\{ isEnabled: publishedIsEnabled, silentModeActive: publishedSilentModeActive \}\),/
  );

  // The publish clamp is observation-based (unconfirmed restore), not a timer.
  assert.match(
    popupSource,
    /const clampMarkingFactsToRestoreTarget = Boolean\(\s*!isEnabled &&\s*state\.previewCloseMarkingRestoreUnconfirmed &&\s*!state\.previewRestorePending\s*\);/
  );

  // First post-exit observation of content marking enabled clears the latch
  // and bumps the epoch (the observing pass adopts it).
  assert.match(
    popupSource,
    /if \(state\.previewCloseMarkingRestoreUnconfirmed && contentMarkingEnabled\) \{[\s\S]{0,900}state\.previewCloseMarkingRestoreUnconfirmed = false;\s*markingEpochAtPassStart = bumpMarkingSessionEpoch\(\);/
  );

  // The "content wins" toggle sync ignores content's transient post-exit
  // markingEnabled:false while the restore is unconfirmed, never syncs from a
  // stale pass, and bumps the epoch when it does sync.
  assert.match(
    popupSource,
    /!preserveEnabledDuringUnconfirmedRestore &&\s*!markingPassIsStale\(\)/
  );
  assert.match(
    popupSource,
    /await messages\.setTabState\(currentTabId, effectiveTabState\);\s*clearLastPopupEnabled\(\);[\s\S]{0,300}markingEpochAtPassStart = bumpMarkingSessionEpoch\(\);/
  );

  // The readiness force-disable holds during the unconfirmed restore and is
  // skipped in stale passes; when it runs it is itself a transition.
  assert.match(
    popupSource,
    /!state\.previewCloseMarkingRestoreUnconfirmed &&\s*!navigationInspectionPending &&\s*\(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\) &&\s*currentTabId &&\s*!markingPassIsStale\(\)/
  );

  // Every popup-initiated marking transition bumps the epoch: exit settle,
  // AI-run start, enable toggle, disable toggle, the restore confirmation, the
  // content-wins sync, the four force-disable branches, the silent-mode align
  // (navigate-away/post-save), and the local page discard.
  const bumps = popupSource.match(/bumpMarkingSessionEpoch\(\);/g) || [];
  assert.ok(bumps.length >= 12, `expected >=12 marking-session epoch bumps, found ${bumps.length}`);
  assert.match(
    popupSource,
    /async function alignPopupToSilentMode[\s\S]{0,1400}bumpMarkingSessionEpoch\(\);/
  );
  assert.match(
    popupSource,
    /async function applyLocalPageDiscard[\s\S]{0,4000}bumpMarkingSessionEpoch\(\);\s*signalMarkingSession\("discarded"\);/
  );

  // The toggle force-true and the enabled-preserve guard apply only to
  // marking-backed previews (a snapshot to restore). The Silent Preview keeps
  // the session silent: forcing toggleEnabled true there published
  // isEnabled:true over a silent session and wedged a popup/page split.
  assert.match(
    popupSource,
    /const aiPreviewMarkingSessionActive = Boolean\(\s*previewActive && state\.previewMarkingSessionSnapshot\s*\);/
  );
  assert.match(
    popupSource,
    /\(aiComputeRunActive \|\| aiPreviewMarkingSessionActive\) &&\s*tabInScope &&\s*Boolean\(state\.currentBaseUrl \|\| effectiveTabState\.baseUrl\)/
  );
  assert.match(
    popupSource,
    /\(previewRestorePending \|\| aiComputeRunActive \|\| aiPreviewMarkingSessionActive\) &&\s*\(!contentModeKnown \|\| !toggleEnabled\)/
  );

  // The popup never echoes the brain-dictated previewBlocked back as its own
  // fact without a standing preview session (fact<->dictation loop: a stale
  // blocked:true self-sustained across popup restarts and navigations).
  assert.match(
    popupSource,
    /previewBlocked: Boolean\(\s*\(state\.previewOpenIntent \|\| state\.previewRestorePending\) &&\s*nextViewState\.previewBlocked\s*\),/
  );
  assert.doesNotMatch(popupSource, /previewBlocked: nextViewState\.previewBlocked,/);

  // No time-based post-close grace remains anywhere in the popup.
  assert.doesNotMatch(popupSource, /AI_PREVIEW_POST_CLOSE_GRACE_MS|isWithinPreviewCloseGrace|previewClosedAtMs|previewClosedMarkingRestore\b/);
  assert.doesNotMatch(popupStateSource, /previewClosedAtMs|previewClosedMarkingRestore\b/);

  // A real navigation (URL change beyond the hash) abandons the page-scoped
  // marking session: the popup drops its AI-run mirror to PRE_AI so sticky
  // published aiRunPhase:post_ai cannot keep the brain locking the toggle for
  // a page the run never belonged to.
  assert.match(
    popupSource,
    /if \(!tabChanged && pageUrl !== state\.lastPopupPageUrl\) \{[\s\S]{0,900}pageUrl\.split\("#"\)\[0\] !== state\.lastPopupPageUrl\.split\("#"\)\[0\]\s*\) \{\s*resetAiRunMarkingsFingerprint\(\);/
  );
});

function buildDictationFacts(overrides: Record<string, unknown>) {
  return {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: false,
    pageInspectionBusy: false,
    desktopPreviewVisible: false,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
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
    busyTimerText: "",
    ...overrides
  };
}

// Criterion: no unrecoverable state. A stale post-AI phase over a SILENT
// session (abandoned or collapsed session; the popup's sticky facts keep
// re-serving aiRunPhase:post_ai) must not lock the enable toggle — Save and
// Discard are hidden in silent mode, so a locked toggle has no resolution
// affordance at all.
test("a silent session with a stale post-AI phase keeps the enable toggle usable", () => {
  const staleSilent = buildDictationFacts({
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    isEnabled: false,
    silentModeActive: true
  });
  // The phase decides silent (isEnabled false precedes the post-AI check)
  // and the machine's silent memory keeps the toggle usable (P4 4.2:
  // machine memory is the button authority).
  assert.equal(decideSessionPhase(staleSilent), "silent");
  const memory = resolveMarkingSessionSurfaceMemory("silent");
  assert.ok(memory.buttons);
  assert.equal(
    memory.buttons.toggleEnabledDisabled,
    false,
    "silent + post-AI must keep the toggle usable (re-enabling starts PRE_AI)"
  );
});

test("an active post-AI marking session still locks the toggle until Save/Discard", () => {
  const activePostAi = buildDictationFacts({
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    isEnabled: true
  });
  // The session is ACTIVE: the phase decides a post-AI-family state (never
  // silent), and the machine's post_ai_clean memory locks the toggle.
  assert.notEqual(decideSessionPhase(activePostAi), "silent");
  const memory = resolveMarkingSessionSurfaceMemory("post_ai_clean");
  assert.ok(memory.buttons);
  assert.equal(
    memory.buttons.toggleEnabledDisabled,
    true,
    "post-AI with the session active resolves via Save/Discard first"
  );
});
