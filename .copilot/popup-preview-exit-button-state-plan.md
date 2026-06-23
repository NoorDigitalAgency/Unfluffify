# Popup Preview-Exit Button-State Plan

Last updated: 2026-06-23
Status: approved behavior matrix confirmed with user; implementation not started

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

## Root-cause summary

The highest-confidence root cause is the split preview-close protocol:

1. popup-initiated preview exit starts `previewRestorePending` in the popup
2. the background close command returns immediately
3. if a popover exists, `content/ai-preview-close-handler.ts` returns before it
   has the authoritative restored draft/runtime state
4. the authoritative state arrives later through the async `aiPreviewClosed`
   runtime message from `content/core.ts:closeAiPopover()`
5. the popup therefore spends time in a temporary disabled state and can race
   into a wrong post-exit state if the later notification is delayed or a
   fallback path wins

This means the primary fix target is the close protocol and restore timing, not
the already-confirmed button formulas.

## Implementation phases

### Phase 1 - Lock the matrix and close protocol in tests first

Files to edit:

- `tests/popup-ai-run-gating.test.js`
- `tests/popup-marking-refresh.test.js`
- `tests/ai-preview-close-handler.test.js`
- `tests/page-save-state.test.js`

Steps:

1. Extend the popup gating tests so State A, State B, and State C are explicit
   contract rows.
2. Extend preview-exit tests so popup-initiated exit is asserted to be
   state-neutral.
3. Change the close-handler test so the popover-close path is expected to return
   the authoritative close payload, not token-only success.
4. Keep `tests/page-save-state.test.js` focused on Save/Discard semantics only.

Expected intermediate state:

- Focused tests fail on the current split close protocol.

Focused validation:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/ai-preview-close-handler.test.js tests/popup-ai-run-gating.test.js tests/popup-marking-refresh.test.js tests/page-save-state.test.js
```

Rollback rule:

- If a new test implies behavior outside the approved matrix, fix the test
  before touching runtime code.

### Phase 2 - Return the authoritative close state synchronously for popup-initiated exits

Files to edit:

- `content/core.ts`
- `content/ai-preview-close-handler.ts`
- `content-main.ts`

Steps:

1. Change the popover-close path in `content/core.ts` so popup-initiated close
   can await the `onClose()` result instead of fire-and-forget only.
2. Keep the async `aiPreviewClosed` runtime notification for spontaneous closes
   and compatibility, but do not make popup-initiated restore depend on it.
3. Update `requestAiPopoverClose()` to return the resolved close payload.
4. Update `content/ai-preview-close-handler.ts` so the `hasAiPopover()` branch
   awaits `requestAiPopoverClose()` and returns the authoritative close payload
   merged into the normal response shape.
5. Update `content-main.ts` dependency wiring to match the new return type.

Expected intermediate state:

- `TAB_CLOSE_AI_PREVIEW` returns `markingEnabled`, `draftStatus`, `baseUrl`,
  `pageUrl`, and related fields immediately for popup-initiated exits.

Focused validation:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/ai-preview-close-handler.test.js tests/popup-marking-refresh.test.js
```

Rollback rule:

- If spontaneous/non-popup closes regress, preserve the async notification path
  and scope the new synchronous payload return to popup-initiated exits only.

### Phase 3 - Make popup restore immediate, bounded, and idempotent

Files to edit:

- `popup.ts`

Steps:

1. Keep `beginPreviewRestorePending()` as the short bridge state.
2. In `handleExitPreviewMode()`, when the close response already contains the
   authoritative close payload, call `applyPreviewClosedState(closeResult)`
   immediately.
3. Reduce `AI_PREVIEW_RESTORE_FALLBACK_MS` from `8000` to no more than `1000`.
4. Keep the existing `preserveCurrentDraftStatus` / `preserveDraft` logic
   intact.
5. Add a token-based duplicate-application guard so the later async
   `aiPreviewClosed` message cannot re-apply an already-restored popup state for
   the same popup-initiated exit.
6. Do not rewrite the button gating formulas unless focused tests still prove a
   mismatch after the close-protocol fix.

Expected intermediate state:

- Popup-initiated preview exit restores the exact pre-preview state from the
  close response.
- The async runtime message becomes a compatibility backup, not the primary
  restore path.

Focused validation:

```bash
deno task check
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/popup-ai-run-gating.test.js tests/popup-marking-refresh.test.js tests/ai-preview-close-handler.test.js
```

Rollback rule:

- If the token guard suppresses valid spontaneous close events, restrict the
  dedupe to popup-initiated restore tokens only.

### Phase 4 - Full validation and live confirmation

Focused validation first, then full validation:

```bash
deno task check
deno task test
deno task build:release
```

If live/manual validation is required, first ask the user for a target URL and
then use:

```bash
deno task build:dev
deno task browser:live <target-url>
```

Manual acceptance flow:

1. Enter marking mode fresh -> verify State A
2. Run AI -> preview opens
3. Exit preview -> verify State C
4. Make a new mark/unmark -> verify State B
5. Reopen preview -> exit again -> verify exact return to State B
6. Save -> verify the existing silent-mode transition still works

## Test matrix

### Unit / source-contract

- `tests/ai-preview-close-handler.test.js`
- `tests/page-save-state.test.js`

### Popup state-contract

- `tests/popup-ai-run-gating.test.js`
- `tests/popup-marking-refresh.test.js`

### Full repository validation

```bash
deno task check
deno task test
deno task build:release
```

### Live/manual

- `deno task build:dev`
- `deno task browser:live <target-url>` only after the user provides the URL

## Regression risks

1. Spontaneous preview closes could regress if the async notification path is
   removed instead of demoted to backup behavior.
2. The popup could double-apply restored state if both the synchronous close
   response and the later async notification are processed for the same exit.
3. The restored draft could be clobbered by a transient re-derived draft if the
   `preserveDraft` / `preserveCurrentDraftStatus` path is weakened.
4. Save/Discard semantics could drift if fix work is moved out of
   `common/page-save-state.ts` and re-implemented ad hoc in the popup.

## Acceptance criteria

1. Exiting preview returns to the exact pre-preview marking state.
2. Fresh marking state matches State A.
3. Clean post-AI-run state matches State C.
4. Post-edit stale state matches State B.
5. Popup-initiated preview exit does not leave buttons wrong or disabled beyond
   the short restore-pending bridge.
6. The fallback restore path cannot remain visible longer than 1 second.
7. Save, Discard, silent preview, and post-save silent transition behavior do
   not regress.

## Todo chain

1. Lock the matrix in focused tests.
2. Make popup-initiated popover close return the authoritative close payload
   synchronously.
3. Apply the close payload immediately in the popup and dedupe the later async
   notification.
4. Reduce the restore fallback window to no more than 1 second.
5. Run focused tests.
6. Run full validation.
7. Perform live validation if needed and if the user provides a target URL.
