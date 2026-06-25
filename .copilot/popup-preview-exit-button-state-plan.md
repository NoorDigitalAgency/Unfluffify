# Popup Preview-Exit Button-State Plan

Last updated: 2026-06-25
Status: the v2 snapshot-restore implementation is now present on
`feat/wxt-port-plan`. The approved behavior matrix (States A-E) below is still
the contract. Focused regression tests for the v2 snapshot/restore flow are
green on this branch. Live Bonliva closeout is still pending a configured and
authenticated marking session: an unconfigured launch currently opens with
`mainUiHidden: true`, no marking controls, and `syncLoadStatusText` reporting
`No remote data (404)`, so the real preview round-trip cannot be exercised
autonomously there yet.

## Goal

Fix the AI run -> Show Content List -> Exit Preview -> marking mode flow so the
popup returns to the exact pre-preview marking-session button state after the
preview closes. The preview is read-only. Exiting it must not drift Run AI,
Show Content List, Save, Discard, or the marking toggle into a recomputed or
stale state.

## Current implementation status

Verified on `feat/wxt-port-plan` as of 2026-06-25:

1. `popup/state.ts` now includes `previewMarkingSessionSnapshot`.
2. `popup.ts` now exposes `captureMarkingSessionSnapshot()`,
   `restoreMarkingSessionSnapshot()`, and `clearMarkingSessionSnapshot()`.
3. The snapshot is captured at both preview-open points and restored on
   popup-initiated exit before the payload fallback path.
4. `previewRestoreAppliedToken` is advanced so the later async
   `aiPreviewClosed` message cannot re-derive over the restored snapshot.
5. Focused validation passed with:
   - `pnpm exec vitest run tests/popup-marking-refresh.test.js tests/popup-ai-run-gating.test.js tests/ai-preview-close-handler.test.js tests/page-save-state.test.js`
6. Live Bonliva validation remains pending only because the current environment
   is not configured far enough to expose the marking controls needed to enter
   preview.

## Current facts

Verified facts from the current repository:

1. `popup/ui.ts` renders the marking-mode controls:
   - Run AI (`#compute`)
   - Show Content List (`#marking-preview`)
   - Save (`#page-save`)
   - Discard (`#page-revert`)
   - marking toggle (`#toggle-enabled`)
2. `popup.ts` computes the button states:
   - `computeButtonDisabled` around `4585`
   - `pageSaveDisabled`, `pageRevertDisabled`, and
     `markingPreviewDisabled` around `4879-4901`
3. `common/page-save-state.ts:buildPageSaveUiState()` owns Save/Discard status
   derivation and already distinguishes clean, stale, and dirty-draft cases.
4. `popup.ts:beginPreviewRestorePending()` intentionally enters a temporary
   disabled restore-pending state while preview exit is in flight.
5. `popup.ts:applyPreviewClosedState()` applies the authoritative preview-close
   `draftStatus` payload and then refreshes the popup with
   `preserveCurrentDraftStatus`.
6. `popup.ts:refreshCurrentPageRuntimeStatus()` already supports
   `preserveDraft`, specifically to avoid clobbering the authoritative restored
   draft snapshot with a transient re-derived draft during preview exit.
7. `content/ai-preview-close-handler.ts` now awaits an authoritative close state
   for both close paths:
   - no popover -> await `exitAiPreviewMode()` and return the close state
   - popover present -> await `requestAiPopoverClose(...)` and return the close
     state instead of returning early
8. `content/core.ts:closeAiPopover()` still sends the authoritative
   `aiPreviewClosed` runtime message asynchronously after the close callback
   resolves, but the popup now treats that as a guarded compatibility backup
   rather than the source of truth for popup-initiated restore.
9. `popup.ts:AI_PREVIEW_RESTORE_FALLBACK_MS` is now `1000`, matching the
   approved maximum fallback window.
10. Existing tests already cover large parts of this contract:
    - `tests/popup-ai-run-gating.test.js`
    - `tests/popup-marking-refresh.test.js`
    - `tests/ai-preview-close-handler.test.js`
    - `tests/page-save-state.test.js`

## Decisions already made

User-confirmed behavior matrix:

### State A - fresh marking entry

Before any manual marking edits and before any AI run:

- Run AI: enabled
- Show Content List: disabled
- Save: disabled
- Discard: disabled
- Marking toggle: checked and enabled

### State B - stale after a new mark/unmark change

After a successful AI run, once the user makes any new mark/unmark change:

- Run AI: enabled
- Show Content List: disabled
- Save: disabled
- Discard: enabled
- Marking toggle: checked and enabled

### State C - clean post-AI-run marking state

Marking active, with no changes since the last successful AI run:

- Run AI: disabled
- Show Content List: enabled
- Save: enabled
- Discard: enabled
- Marking toggle: checked and enabled

### State D - preview open

- The preview UI replaces the marking controls
- Exiting preview must restore the exact pre-preview marking state

### State E - restore-pending transition

- A brief restore-pending state is acceptable
- Normal path target: effectively immediate, around 250 ms
- Fallback must not exceed 1 second
- The end state must be the exact pre-preview state, not a recomputed drifted
  state

## Open questions

None. Do not invent alternate button semantics.

## Non-goals

Do not change:

1. marking/highlighting taxonomy, target resolution, sync semantics, or overlay
   projection
2. AI selector generation or submission behavior
3. silent preview behavior outside this preview-exit bug
4. Save/Discard semantics outside this preview-exit contract
5. popup layout or copy beyond the restore-pending lifecycle needed for this fix

## Root-cause summary (historical v2 context)

This section records the pre-fix diagnosis that led to the v2 implementation.
Do not treat it as the current live codepath description.

The v1 plan assumed the bug was the split preview-close protocol (async
`aiPreviewClosed` vs synchronous close payload) and timing. That fix shipped
(commit `fe89f2b`: synchronous close payload, token dedupe, 1000 ms fallback)
but live CDP testing on `https://bonliva.se` shows the buttons are STILL wrong
after Exit Preview. So the timing hypothesis was not the real cause.

Verified live evidence (CDP inspection of the running popup):

1. While the content list (preview) was OPEN, the stored popup view state
   DRIFTED between two observer samples with no user action:
   - sample 1: `computeButtonDisabled:true, sessionRequiresAiRun:true,
     sessionHasPendingChanges:true, pageDraftStatusText:"Run AI before saving"`
   - sample 2: `computeButtonDisabled:false, sessionRequiresAiRun:false,
     sessionHasPendingChanges:false, pageDraftStatusText:"No unsaved session
     changes"`
2. After clicking Exit Preview the state settled (stable >2.5 s) to ALL marking
   controls disabled: `previewActive:false, toggleEnabledDisabled:true,
   computeButtonDisabled:true, markingPreviewDisabled:true, pageSaveDisabled:true,
   pageRevertDisabled:true`.
3. Deep state after exit: `previewRestorePending:false, previewRestoreToken:1,
   previewRestoreAppliedToken:0` (so the authoritative close payload was NOT
   applied through the token path - `applyPreviewClosedState` either ran with a
   tokenless payload or the 1000 ms fallback `finalizePreviewRestoreFromRuntime`
   won), content side `markingEnabled:true, mode:"marking"`,
   `currentDraftDirty:false`, `currentDraftEntry`/`currentSavedEntry` populated
   with equal keys, `aiRunMarkingsFingerprint` populated,
   `aiSelectorsComputedSinceLastSubmit:true`.

Root cause: **preview exit re-derives the entire marking button state from
scratch via `refreshUi()` instead of restoring the exact pre-preview state.**
Re-derivation is racy and depends on three fragile inputs that the read-only
preview should never have disturbed:

- `popup.ts:applyPreviewClosedState()` (line ~2570) sets
  `preserveCurrentDraftStatus = markingEnabled && applyDraftStatusToPopupState(
  closeState.draftStatus)`. When the close payload lacks a usable `draftStatus`
  (the observed case - `previewRestoreAppliedToken` never advanced), this is
  `false`.
- With `preserveCurrentDraftStatus=false`, `refreshUiInner()` (line ~4426) WIPES
  `state.currentDraftEntry`, `currentSavedEntry`, `currentDraftDirty`,
  `currentPageSaveReconciliation` to null/false, then re-probes the content
  script via `refreshCurrentPageRuntimeStatus({ preserveDraft:false })`
  (line ~4441 / ~2641) which `applyDraftStatusToPopupState(draftStatus)` from a
  live `getPageDraftStatus`. While the content script is still rebuilding the
  marking overlay after preview close, that probe transiently returns a
  different/empty entry whose fingerprint differs from
  `state.aiRunMarkingsFingerprint`.
- `isAiRunUpToDateForCurrentMarkings()` (line ~1712) then flips between true and
  false depending on which transient entry won the probe. That single boolean
  gates `computeButtonDisabled`, `markingPreviewDisabled`, and (via
  `sessionRequiresAiRun`) `pageSaveDisabled`. The "drift while open" (evidence 1)
  and "all disabled after exit" (evidence 2) are the same race resolving to the
  wrong side.

This directly violates the approved State D/E requirement: "Exiting preview must
restore the exact pre-preview marking state, not a recomputed drifted state."
The correct fix is therefore to STOP re-deriving on exit and instead restore an
authoritative pre-preview snapshot captured by the popup itself, which does not
depend on close-payload completeness or content-side re-probe timing.

## Verified current facts (v2)

1. Two popup entry points open the preview and must both capture the snapshot:
   - after an AI run: `popup.ts:applyComputedSelectorSet()` sets the preview view
     state at lines ~7089-7110 (`previewOpened` block, right after
     `captureAiRunMarkingsFingerprint()` at line 7040 and `resetAiRunState()` at
     7089).
   - from marking mode "Show Content List": `popup.ts:handleMarkingPreview()`
     (line 7651) calls `refreshCurrentPageRuntimeStatus()` (line 7666) then
     `requestTabShowAiPreview()` (line 7686).
2. Preview exit: `popup.ts:handleExitPreviewMode()` (line 7702) calls
   `beginPreviewRestorePending()` (line 2548, forces every control disabled as a
   bridge) then `requestTabCloseAiPreview()` and, if the response carries a close
   payload, `applyPreviewClosedState(closeResult)` (line 7733).
3. The async backup path `popup.ts` message handler at line ~8241 also calls
   `applyPreviewClosedState(message)`.
4. The button-state derivation reads ONLY these `state.*` fields plus
   `state.currentConfig` (stable during read-only preview):
   `currentDraftEntry`, `currentSavedEntry`, `currentDraftDirty`,
   `currentDraftAvailable`, `currentPageSaveReconciliation`,
   `currentPageSaveReconciliationPending`, `aiRunMarkingsFingerprint`,
   `aiSelectorsComputedSinceLastSubmit`, `aiSelectorsComputedBaseUrl`.
   (`popup.ts` lines ~4412-4509, `common/page-save-state.ts:buildPageSaveUiState`.)
5. `refreshUiInner()` already honors `preserveCurrentDraftStatus` (skip the wipe
   at line ~4426) and threads `preserveDraft` into
   `refreshCurrentPageRuntimeStatus()` (line ~4441) which then skips the
   re-probe overwrite (line ~2641). The mechanism to avoid drift already exists;
   it is just gated on the unreliable close payload instead of a popup snapshot.
6. `popup/state.ts` holds the popup session state object (snapshot fields would
   be added near lines 53-69).
7. Tests in `tests/popup-marking-refresh.test.js` (lines ~222-244) assert the
   EXACT current source text of `handleExitPreviewMode`, `applyPreviewClosedState`,
   `buildPreviewViewState`, and the `aiPreviewClosed` handler via regex. Editing
   those functions WILL break these source-pattern assertions; they must be
   updated in the same change.

## Decisions already made (v2)

1. The approved State A-E behavior matrix above is the contract. Do not invent
   new button semantics.
2. The fix must restore the EXACT pre-preview marking state on exit
   (State D/E), not a re-derived state.
3. The preview is read-only: the element markings, draft, saved entry, AI-run
   fingerprint, and locally-computed-selector flags do not legitimately change
   while the preview is open. The snapshot is therefore authoritative on exit.
4. The synchronous close payload and the async `aiPreviewClosed` message remain
   in place as a compatibility/backup path but must no longer be the source of
   truth for popup-initiated restore.

## Resolved design decisions (v2)

These questions are no longer open on `feat/wxt-port-plan`:

1. The popup snapshots and restores the nine authoritative `state.*` fields
   listed in Verified fact 4, then runs a single
   `refreshUi({ preserveCurrentDraftStatus: true })`.
2. On exit, the snapshot wins over any divergent live probe because the preview
   is read-only and State D/E requires restoring the exact pre-preview state.

## Non-goals (v2)

Unchanged from the v1 Non-goals section above, plus:

6. Do not remove or weaken `beginPreviewRestorePending()` as the brief disabled
   bridge during exit.
7. Do not remove the async `aiPreviewClosed` handler or the synchronous close
   payload; only demote them below the snapshot restore.
8. Do not change `common/page-save-state.ts:buildPageSaveUiState` formulas. The
   fix is about WHICH `state.*` inputs are present at exit, not the formulas.
9. Do not change AI selector generation/submission or
   `aiSelectorsComputedSinceLastSubmit` semantics; only preserve their value
   across the preview round-trip.

## Implementation record (v2)

The implementation phases below are historical record only. They were executed
on `feat/wxt-port-plan` and are no longer pending work items for this branch.

1. **Phase 1 - contract tests**
   - `tests/popup-marking-refresh.test.js` and
     `tests/popup-ai-run-gating.test.js` were updated to lock the
     snapshot/restore contract.
2. **Phase 2 - snapshot state + helpers**
   - `popup/state.ts` gained `previewMarkingSessionSnapshot`.
   - `popup.ts` gained `captureMarkingSessionSnapshot()`,
     `restoreMarkingSessionSnapshot()`, and `clearMarkingSessionSnapshot()`.
3. **Phase 3 - preview-open capture**
   - the snapshot is captured at both preview-open points.
4. **Phase 4 - preview-exit restore**
   - popup-initiated exit restores the snapshot before the payload fallback,
     clears the snapshot on finalized exit paths, and advances
     `previewRestoreAppliedToken` to guard the async backup notification.
5. **Phase 5 - focused validation**
   - focused regression coverage is green on this branch.

## Remaining live closeout

The only remaining open item for this plan is live confirmation on a configured
and authenticated marking session where the real Show Content List -> Exit
Preview round-trip can be exercised. On an unconfigured Bonliva launch, the
popup opens with `mainUiHidden: true`, no marking controls, and `No remote data
(404)`, which blocks that live round-trip independently of the shipped code.

```bash
pnpm test
pnpm build
```

Live confirmation (the bug only reproduces in a real page round-trip):

```bash
pnpm build
pnpm browser:live https://bonliva.se
```

Then connect over CDP per `.github/skills/launch-test-browser/SKILL.md`
(`connectOverCDP("http://127.0.0.1:9222")`) and run the manual acceptance flow.

## Test matrix (v2)

### Popup state-contract

- `tests/popup-ai-run-gating.test.js` - States A/B/C rows + snapshot restore = C
- `tests/popup-marking-refresh.test.js` - capture-on-open, restore-on-exit,
  drift-probe-ignored, source-pattern updates

### Source-contract / unit

- `tests/ai-preview-close-handler.test.js` - close payload still returned
- `tests/page-save-state.test.js` - Save/Discard formulas unchanged

### Full repository validation

```bash
pnpm check
pnpm test
pnpm build
```

### Live/manual (against `.output/chrome-mv3` on https://bonliva.se)

1. Enter marking mode fresh -> State A.
2. Run AI -> preview opens.
3. Exit preview -> State C exactly (Run AI disabled; Show Content List, Save,
   Discard, toggle enabled; status "No unsaved session changes").
4. Make a new mark/unmark -> State B.
5. Reopen preview -> exit -> exact return to State B.
6. Save -> existing silent-mode transition still works.

## Regression risks (v2)

1. Stale snapshot leaking into a later preview if `clearMarkingSessionSnapshot()`
   is missed on any exit path -> always clear after restore and in the error
   branch; covered by a test that opens/exits twice.
2. Spontaneous (non-popup) preview closes regressing if the snapshot path
   swallows them -> snapshot restore must return `false` when no snapshot exists
   and fall through to `applyPreviewClosedState`.
3. Double application (snapshot restore + async `aiPreviewClosed`) ->
   `previewRestoreAppliedToken` must be advanced by the snapshot restore so
   `isPreviewRestoreMessageCurrent()` rejects the late message.
4. Source-pattern tests in `tests/popup-marking-refresh.test.js` were updated
   together with the implementation and remain a guard for the shipped
   function bodies.
5. `currentConfig`/`pageMarkings` are still fetched during the restore refresh;
   if a real navigation happened during preview the snapshot could be wrong - but
   preview exit on a navigated page already drops marking via existing pageUrl
   guards, so restore only applies when `pageUrl` still matches.

## Acceptance criteria (v2)

1. After popup-initiated Exit Preview, the five marking controls and
   `pageDraftStatusText` equal the exact pre-preview snapshot (State C in the live
   flow), verified by CDP and by `tests/popup-marking-refresh.test.js`.
2. No stored-view-state drift occurs while the preview is open or in the 2.5 s
   after exit (the re-probe can no longer overwrite restored session state).
3. State A, B, and C still match the approved matrix.
4. Spontaneous/non-marking preview closes still restore via the existing payload
   path (no snapshot present).
5. `pnpm check`, `pnpm test`, and `pnpm build` pass.

## Historical todo chain (v2)

The v2 implementation todo chain is complete on `feat/wxt-port-plan`. The only
remaining open item is live confirmation on a configured/authenticated marking
session where the real Show Content List -> Exit Preview round-trip can be
performed.
