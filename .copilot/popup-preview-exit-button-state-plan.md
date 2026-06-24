# Popup Preview-Exit Button-State Plan

Last updated: 2026-06-24
Status: v1 (close-protocol timing fix) IMPLEMENTED and committed (fe89f2b) but
the bug PERSISTS in live testing. This document is now the v2 corrected plan.
The approved behavior matrix (States A-E) below is unchanged and still valid.
Everything from "Root-cause summary (v2 - corrected)" onward supersedes the v1
root cause and v1 implementation phases.

## Goal

Fix the AI run -> Show Content List -> Exit Preview -> marking mode flow so the
popup returns to the exact pre-preview marking-session button state after the
preview closes. The preview is read-only. Exiting it must not drift Run AI,
Show Content List, Save, Discard, or the marking toggle into a recomputed or
stale state.

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
7. `content/ai-preview-close-handler.ts` currently has two close paths:
   - no popover -> await `exitAiPreviewMode()` and return the authoritative
     close state immediately
   - popover present -> call `requestAiPopoverClose(...)` and return early
     without the authoritative close payload
8. `content/core.ts:closeAiPopover()` later sends the authoritative
   `aiPreviewClosed` runtime message asynchronously after the close callback
   resolves.
9. `popup.ts:AI_PREVIEW_RESTORE_FALLBACK_MS` is currently `8000`, which is far
   above the confirmed acceptable fallback window.
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

## Root-cause summary (v2 - corrected)

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

## Open questions (v2)

The implementing agent should proceed with the Recommended option for each unless
the user answers otherwise. None of these change the approved State A-E matrix;
they only decide the restore mechanism.

Q1. What should the popup snapshot and restore on Exit Preview?

1. (Recommended) Snapshot the nine authoritative `state.*` session fields listed
   in Verified fact 4 when preview opens; on exit restore them and run a single
   `refreshUi({ preserveCurrentDraftStatus: true })` so the buttons are derived
   from the restored, stable session state and the content re-probe cannot
   overwrite it.
2. Snapshot the rendered ViewState disabled flags only (`toggleEnabledDisabled`,
   `computeButtonDisabled`, `markingPreviewDisabled`, `pageSaveDisabled`,
   `pageRevertDisabled`, `toggleEnabled`, `pageDraftStatusText/Tone`) and
   re-apply them directly on exit without a refresh. Simpler but leaves the
   underlying `state.*` inconsistent for the next mark/unmark, risking a fresh
   drift on the following action.
3. Keep re-deriving but force `preserveCurrentDraftStatus=true` and
   `preserveDraft=true` on every preview-exit refresh regardless of close
   payload. Smallest change but still trusts whatever `state.*` happens to be
   live at exit rather than a captured snapshot.

Q2. If, on exit, the live content markings differ from the snapshot (should not
happen because preview is read-only), which wins?

1. (Recommended) The snapshot wins. State D/E requires the exact pre-preview
   state; a divergent live probe is the drift we are eliminating.
2. The live probe wins (current behavior) - rejected, this is the bug.

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

## Implementation phases (v2)

Assumes Q1=option 1 and Q2=option 1 (the Recommended answers).

### Phase 1 - Lock the snapshot/restore contract in tests first

Files to edit:

- `tests/popup-marking-refresh.test.js`
- `tests/popup-ai-run-gating.test.js`

Steps:

1. In `tests/popup-marking-refresh.test.js`, update the source-pattern regexes at
   lines ~222-244 to expect the new shape: `handleMarkingPreview` and the AI-run
   `previewOpened` block call a new `captureMarkingSessionSnapshot()`;
   `handleExitPreviewMode` calls a new `restoreMarkingSessionSnapshot()` and then
   `refreshUi({ ... preserveCurrentDraftStatus: true })` when a snapshot exists.
2. Add a new behavioral test `popup restores exact pre-preview marking buttons on
   exit` that: seeds `state.*` to a State C snapshot, simulates open (capture) ->
   a drifting content `getPageDraftStatus` probe -> exit (restore), and asserts
   the five disabled flags + `pageDraftStatusText` equal the State C snapshot, not
   the drifted probe.
3. In `tests/popup-ai-run-gating.test.js`, keep State A/B/C rows; add an assertion
   that a snapshot restore reproduces State C exactly.

Expected intermediate state: new/updated tests fail against current source.

Focused validation:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/popup-marking-refresh.test.js tests/popup-ai-run-gating.test.js
```

Rollback rule: if a new assertion implies behavior outside State A-E, fix the
test before touching runtime code.

### Phase 2 - Add the snapshot state field and helpers

Files to edit:

- `popup/state.ts`
- `popup.ts`

Steps:

1. `popup/state.ts`: add `previewMarkingSessionSnapshot: null,` near line 69
   (next to the `previewRestore*` fields) with a comment that it holds the
   authoritative pre-preview marking session for exact restore.
2. `popup.ts`: add `captureMarkingSessionSnapshot()` that deep-copies the nine
   fields from Verified fact 4 into `state.previewMarkingSessionSnapshot`
   (use `clonePageMarkingEntry` for `currentDraftEntry`/`currentSavedEntry`;
   primitives copied directly; `currentPageSaveReconciliation` cloned via
   `JSON.parse(JSON.stringify(...))` or null).
3. `popup.ts`: add `restoreMarkingSessionSnapshot()` that, if
   `state.previewMarkingSessionSnapshot` is set, writes those fields back onto
   `state` and returns `true`; otherwise returns `false`. It must NOT itself call
   `refreshUi`.
4. `popup.ts`: add `clearMarkingSessionSnapshot()` that sets the field to null.

Expected intermediate state: helpers compile; not yet wired.

Focused validation:

```bash
deno task check
```

Rollback rule: if `deno task check` fails on the new field/typing, keep the field
untyped-compatible with the existing `// @ts-expect-error` popup-state pattern.

### Phase 3 - Capture the snapshot at both preview-open points

Files to edit:

- `popup.ts`

Steps:

1. In `applyComputedSelectorSet()`, inside the `if (previewOpened)` block
   (line ~7072), call `captureMarkingSessionSnapshot()` AFTER
   `captureAiRunMarkingsFingerprint()` / `resetAiRunState()` and BEFORE the
   `uiModule.setViewState({ previewActive:true, ... })` call, so the snapshot
   reflects the settled post-run State C session.
2. In `handleMarkingPreview()` (line 7651), call
   `captureMarkingSessionSnapshot()` immediately AFTER the successful
   `refreshCurrentPageRuntimeStatus()` (line 7666) and the reconciliation guard,
   and BEFORE `setPreviewBlocked(true, ...)`, so the snapshot reflects the live
   marking-mode session being previewed.

Expected intermediate state: opening preview records a snapshot; exit does not yet
use it.

Focused validation:

```bash
deno task check
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/popup-marking-refresh.test.js
```

Rollback rule: if either capture point runs when markings are not the source of
truth (e.g., reconciliation pending), guard the capture with the same condition
that already gates that open path.

### Phase 4 - Restore the snapshot on exit instead of re-deriving

Files to edit:

- `popup.ts`

Steps:

1. In `handleExitPreviewMode()` (line 7702), after a successful close response,
   replace the current `applyPreviewClosedState(closeResult)` branch with:
   - if `restoreMarkingSessionSnapshot()` returns `true`: call
     `clearPreviewRestorePending()` then
     `await refreshUi({ useBusyOverlay:false, skipPropertyLockFetch:true,
     preserveCurrentDraftStatus:true })`, then `clearMarkingSessionSnapshot()`,
     then advance `state.previewRestoreAppliedToken` to the current
     `previewRestoreToken` so the later async `aiPreviewClosed` cannot re-derive.
   - else (no snapshot, e.g. spontaneous/non-marking preview): keep the existing
     `applyPreviewClosedState(closeResult)` fallback.
2. In the error branch of `handleExitPreviewMode` (line 7718) and in
   `applyPreviewClosedState`/`finalizePreviewRestoreFromRuntime`, call
   `clearMarkingSessionSnapshot()` once restore is finalized so a stale snapshot
   never leaks into the next preview.
3. In the async `aiPreviewClosed` handler (line ~8241), if a snapshot restore has
   already advanced `previewRestoreAppliedToken` for this token, the existing
   `isPreviewRestoreMessageCurrent()` guard (line 2479) must short-circuit; verify
   it does and, if the close message is tokenless, additionally skip when
   `state.previewMarkingSessionSnapshot` is null AND pending is already cleared.

Expected intermediate state: popup-initiated exit restores the exact snapshot;
the drift and all-disabled end state are gone; close payload/async message are
backup only.

Focused validation:

```bash
deno task check
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/popup-marking-refresh.test.js tests/popup-ai-run-gating.test.js tests/ai-preview-close-handler.test.js tests/page-save-state.test.js
```

Rollback rule: if the snapshot restore suppresses a legitimate spontaneous close
(no prior snapshot), confirm `restoreMarkingSessionSnapshot()` returned `false`
and fell through to `applyPreviewClosedState`.

### Phase 5 - Full validation and live confirmation

```bash
deno task check
deno task test
deno task build:release
```

Live confirmation (the bug only reproduces in a real page round-trip):

```bash
deno task build:dev
deno task browser:live https://bonliva.se
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
deno task check
deno task test
deno task build:release
```

### Live/manual (against dist/extension-dev on https://bonliva.se)

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
4. Source-pattern tests in `tests/popup-marking-refresh.test.js` will fail until
   their regexes are updated for the new function bodies.
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
5. `deno task check`, `deno task test`, and `deno task build:release` pass.

## Todo chain (v2)

1. Lock the snapshot/restore contract in `tests/popup-marking-refresh.test.js` and
   `tests/popup-ai-run-gating.test.js` (Phase 1).
2. Add `previewMarkingSessionSnapshot` to `popup/state.ts` and the
   capture/restore/clear helpers in `popup.ts` (Phase 2).
3. Capture the snapshot at both preview-open points (Phase 3).
4. Restore the snapshot on exit and demote the close payload/async message to
   backup, advancing `previewRestoreAppliedToken` (Phase 4).
5. Run focused tests, then `deno task check && deno task test &&
   deno task build:release` (Phase 5).
6. `deno task build:dev` + live CDP confirmation on https://bonliva.se (Phase 5).
7. Commit the still-uncommitted launcher + docs changes (`scripts/
   launch-test-browser.ts`, `.github/instructions/browser-launch.instructions.md`,
   `.github/skills/launch-test-browser/SKILL.md`, `.copilot/knowledge.md`)
   together with this fix via review-fix-commit-push.
