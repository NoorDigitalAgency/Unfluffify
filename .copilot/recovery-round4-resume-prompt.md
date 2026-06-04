# Round-4 resume prompt (read this, then resume)

You are resuming the Unfluffify Chrome MV3 extension recovery on branch
`recovery/clean-rebuild` (base `0a07bcd`; `main` is untouched). **Start by reading
`.copilot/recovery-round4-handoff.md`** — it is the authoritative resume doc — and
`.copilot/recovery-plan.md` for the marking precedence / save / revert contract. Also
consult repo memory: `/memories/repo/marking-rendering.md`, `playwright-debug-harness.md`,
`testing-config.md`.

Round-3 items (1, 2, A, B, C/D/E, F) are committed, but a user live test surfaced 9
regressions/findings (documented in the handoff). Implement the fixes in this order, one
unit at a time:

1. **#4 (save):** Remove the automatic `syncBaseConfigToServer` push from
   `applyComputedSelectorSet` (popup.js ~7375). AI run must compute selectors LOCALLY +
   open preview only; Save (`handlePageSave`) is the explicit server-sync step. Update
   related "…AndSynced" status/toast to local-only and fix any test asserting the post-run
   sync.
2. **#4a + #8 + #3 (post-save transition):** In `handlePageSave` success branch
   (popup.js ~7169), after the backend payload updates local data: switch the popup
   marking → silent (clear toggle/tab-enabled state without discarding saved data), reset
   the in-memory current-page entry to the defaults→AI baseline (drop session deltas) so
   `hasSessionPendingChanges` is false (Discard disabled), and keep Run AI disabled on a
   clean saved page.
3. **#6 + #7 (post-navigation reset):** When `confirmNavigationAwayFromMarking` proceeds
   (OK-discard), reset popup + tab state to silent so the new page's popup shows silent
   controls; verify re-enabling marking then properly runs the content enable/reveal path.
4. **#5:** Fix the half-width marking-preview button (popup/ui.js:2149 uses
   `class: "button-row"`) — use a full-width row container.
5. **#2:** Fix the fresh-load "Inspecting page…" curtain that never clears in silent mode
   (trace whether it's shown via the spinner queue vs. `nextViewState.isBusy`; ensure the
   silent reveal/freeze completion re-runs `refreshUiInner` and drops the curtain even when
   `popupSpinnerVisible` is true).
6. **#9:** Re-claim/reconcile the property lock after each render-mode inspection reload
   (`runRenderModeInspectionReload`, popup.js ~5478) so the popup stops showing
   "disconnected".

Constraints: prefer root-cause fixes; do NOT regress the contract reminders in the handoff
(render precedence, fingerprint = exclude+include xpaths only, local-only discard,
reveal/freeze only via silent-highlight activation). After each unit run `npm test` (the
total count fluctuates due to `--test-force-exit`; only **fail = 0** matters), update the
affected source-pattern tests, commit per unit, and tell the user a LIVE re-test is required
(runtime behavior is not covered by the test suite). Keep
`.copilot/recovery-round4-handoff.md` updated with progress as you go.
