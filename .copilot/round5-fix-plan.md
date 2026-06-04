# Round-5 Fix Plan — render-mode entry, curtain, lock, save-gate, mode-sync

> Branch: `recovery/clean-rebuild` (remote `origin`, clean tree at `d8bcb91`).
> Validation: source-pattern tests pass even when runtime regresses — every stage needs a
> LIVE Playwright-MCP re-test (debug harness: `localStorage.ufDebugSpinnerQueue="1"`,
> popup opened with `?debugTabId=<id>`). Only `fail = 0` matters in `npm test` (the total
> count fluctuates due to `--test-force-exit`).
>
> Working rule: **one regression per stage, each stage is its own commit + push + memory/doc
> update**. Do not bundle stages. Do not refactor beyond the named functions. Add only the
> narrow tests listed for that stage.

---

## Regression → root-cause map (verified against current source)

| # | Regression | Primary code site | Root-cause hypothesis |
|---|------------|-------------------|-----------------------|
| A | Reveal/freeze fires on page load into render-mode view, and re-fires on **With JavaScript** | `content-main.js` `runEditorSilentHighlightingActivationOnce` (~2830); reload re-injects content so module-level `silentHighlightEditorRevealKey` resets and the editor warmup re-runs | Editor-acquisition silent-highlight warmup runs whenever the lock is held, including while the render-mode detection view is open and on every inspection reload. It is not gated on "render mode confirmed / not currently inspecting". |
| B | `Inspecting page…` curtain sticks after busy clears | `popup.js` `scheduleStaleInspectionBusyClear` (~945), `reconcileSilentNavSpinner`; `content-main.js` `getInspectionStatus` (~6915); `content/core.js` `finishPageInspectionUiAfterRender` (~5797) | The render-mode reload path shows the curtain via the `navInspect` spinner but the stale-clear gate is only reached on the silent-nav path; the render-mode-inspection branch never pops it once warmup ends. |
| C | `Connection lost` during render-mode inspection | `popup.js` `reconcilePropertyLockAfterRenderModeReload` (~3788), `completeRenderModeInspectionReloadFollowUp` (~3772) | Reload tears down the content port; reconcile polls the snapshot but does not force a re-claim/heartbeat resume, so the popup stays in the 70 s "Connection lost" countdown. |
| D | `Save Session` stays disabled while UI says "Changes ready to save" | `popup.js` `nextViewState.pageSaveDisabled = pageSaveUiState.pageSaveDisabled \|\| !aiRunUpToDate` (~5084); `isAiRunUpToDateForCurrentMarkings` (~1591) | The AI-run fingerprint is captured against an entry that diverges from the live `state.currentDraftEntry` (often because of Regression E), so `aiRunUpToDate` is false even though `sessionHasPendingChanges && !sessionRequiresAiRun`. |
| E | Popup shows marking-enabled while page is silent (and the inverse) | enable toggle path + `setEnabled` message (`content-main.js` ~6890); `runEditorSilentHighlightingActivation`; popup `refreshUiInner` | `view.toggleEnabled`/tab-state and content `state.enabled`/silent-highlighting can diverge after reload/lock churn; nothing reconciles the popup toggle to the **actual** content mode. |

Notes captured during live runs are in `.copilot/recovery-round4-handoff.md`. This plan supersedes
the open items there for A–E.

---

## Stage 1 — Render-mode entry gating (Regression A)

**Outcome:** Reveal/freeze must NOT run when a page loads into the render-mode detection view.
It runs **only** for the explicit inspection action (With/Without JavaScript), and in this exact
order: block popup with spinner → reload (with/without JS) → await full load + render → run
reveal/freeze to completion → fetch the HTML version for AI mode detection → only then load
local/remote data and enable any highlighting.

### 1.1 Suppress editor silent-highlight warmup while render-mode is unconfirmed / inspecting
- File: `content-main.js`, `runEditorSilentHighlightingActivationOnce` (~2830).
- Add a guard at the top that returns early (without revealing) when the page is in the
  render-mode inspection window. Introduce a single module-level flag
  `renderModeInspectionActive` (default `false`) set/cleared by the inspection message handlers
  (1.3). When `renderModeInspectionActive` is true, skip `warmupSilentHighlightingBeforeMotionPause`
  entirely and do not set `silentHighlightEditorRevealKey`.
- Also gate on "render mode not yet confirmed": if the resolved config for `baseUrl` has no
  confirmed render mode (reuse the existing render-mode-ready signal the popup uses;
  see `nextViewState.renderModeReady` producer in `popup.js`), do not auto-reveal on editor
  acquisition. Expose the render-mode-confirmed check from the content config the same way the
  enable flow reads `state.config`.

### 1.2 Make the inspection action own the reveal/freeze sequence
- File: `popup.js`, `runRenderModeInspectionReload` (~5554) and
  `completeRenderModeInspectionReloadFollowUp` (~3772).
- Keep the popup blocked by the spinner for the **entire** sequence (currently `runWithSpinner`
  wraps only the reload kick-off; extend it to await the follow-up). Change the fire-and-forget
  `void completeRenderModeInspectionReloadFollowUp(tabId).catch(...)` into an awaited call inside
  the same spinner scope so controls stay blocked until load + reveal + HTML fetch finish.
- Sequence inside `completeRenderModeInspectionReloadFollowUp`:
  1. `await waitForTabLoadComplete(tabId, …)` (already present).
  2. Send a new content message `runRenderModeRevealOnce` that triggers exactly one
     reveal/freeze pass (reusing `core.warmupSilentHighlightingBeforeMotionPause` /
     `inspectPageBeforeMotionPause`) and resolves when the reveal+freeze is complete. This is the
     ONLY reveal entry point for inspection.
  3. Capture the HTML used for AI mode detection AFTER reveal completes, in this exact form
     (RESOLVED — see Decisions):
     - STATIC/raw HTML: reuse `fetchCurrentPageRawHtml()` (content-main.js ~2386 →
       `fetchStaticPageHtml` to background). Do NOT add a new static-fetch path.
     - RENDERED HTML: the PUREST rendered DOM — captured right after load+render, with lazy
       content surfaced by reveal, but BEFORE any highlighting is applied and EXCLUDING every
       extension-injected node (overlay, curtain, highlight wrappers, AI popover, injected
       styles). The AI diffs static vs rendered, so the rendered capture must contain zero
       extension-added markup. Reuse the existing `snapshot.renderedHtml` producer; verify it
       already strips extension markup and, if not, make the capture exclude those nodes.
       Do NOT invent a new rendered-capture mechanism if a clean one exists.
  4. `await hideConsentForRenderModeInspection(tabId)` (already present).
  5. `await reconcilePropertyLockAfterRenderModeReload()` (Stage 3 hardens this).

### 1.3 Set/clear `renderModeInspectionActive` around the action
- File: `content-main.js`. Add message handlers:
  - `renderModeInspectionBegin` → set `renderModeInspectionActive = true`, and proactively
    cancel any in-flight `silentHighlightEditorActivationPromise` reveal (bump the activation id
    so `isStillCurrent()` returns false).
  - `runRenderModeRevealOnce` → perform a single reveal/freeze pass; resolve on completion.
  - `renderModeInspectionEnd` → set `renderModeInspectionActive = false`.
- File: `popup.js`, `runRenderModeInspectionReload`: send `renderModeInspectionBegin` before the
  reload and `renderModeInspectionEnd` in a `finally` after the follow-up completes.

### 1.4 Tests (narrow, source-pattern + focused)
- `tests/content-activation-order.test.js`: assert `runEditorSilentHighlightingActivationOnce`
  early-returns when `renderModeInspectionActive` is true and does NOT call
  `warmupSilentHighlightingBeforeMotionPause` in that branch.
- New `tests/render-mode-inspection-order.test.js`:
  - `runRenderModeInspectionReload` sends `renderModeInspectionBegin` before reload and
    `renderModeInspectionEnd` in a `finally`.
  - `completeRenderModeInspectionReloadFollowUp` awaits load → `runRenderModeRevealOnce` →
    HTML capture → `hideConsentForRenderModeInspection` → `reconcilePropertyLockAfterRenderModeReload`
    in that order.
  - The reveal-once handler is the only inspection reveal entry (no editor-acquisition reveal
    while `renderModeInspectionActive`).
  - The rendered-HTML capture for AI mode detection happens AFTER reveal/freeze and BEFORE any
    highlighting, and the captured DOM excludes all extension-injected nodes (overlay, curtain,
    highlight wrappers, AI popover, injected `<style>`).
- Keep existing `tests/core-motion-pause.test.js` / `tests/content-activation-order.test.js`
  green; update only assertions that legitimately change.

### 1.5 Live validation
- Land on a render-mode page (e.g. `https://unitedspaces.com/`): confirm NO reveal/freeze and
  NO `Inspecting page…` on load.
- Click With JavaScript: spinner blocks; exactly one reveal/freeze; curtain present only during
  the action and cleared at the end; no second reveal.

### 1.6 Commit / push / docs
- Commit: `Round-5 #A: gate render-mode reveal/freeze to the explicit inspection action`.
- Push to `origin/recovery/clean-rebuild`.
- Update `/memories/repo/notes.md`: record that editor-acquisition reveal must be suppressed
  while `renderModeInspectionActive` or render mode is unconfirmed; reveal-once is owned by the
  inspection action.
- Update `MARKING_AND_HIGHLIGHTING_LOGIC.md` render-mode section + `.copilot/recovery-round4-handoff.md`.

---

## Stage 2 — Curtain clear (Regression B)

**Outcome:** `Inspecting page…` (the `navInspect` spinner / `pageInspection` busy curtain) is
dropped as soon as the inspection warmup completes, including the render-mode reload path.

### 2.1 Reach the stale-clear from the render-mode path
- File: `popup.js`, `scheduleStaleInspectionBusyClear` (~945). It currently only clears the
  silent-nav case. Extend its empty-queue/no-pending gate so a render-mode-inspection curtain is
  also eligible: when runtime `getInspectionStatus` reports `pending=false` and the queue holds
  only `navInspect`, pop it.
- Ensure `completeRenderModeInspectionReloadFollowUp` (Stage 1) calls
  `popSpinner("navInspect")` (or `scheduleStaleInspectionBusyClear(tabId, baseUrl, {…})`) after
  the reveal-once + reconcile finish.

### 2.2 Content side: report not-pending promptly after reveal-once
- File: `content-main.js`, `getInspectionStatus` (~6915). Confirm `inspectionActive` flips false
  after `runRenderModeRevealOnce` resolves (it calls `finishPageInspectionUi*`). The
  render-mode reveal must not leave a lingering `editor_preparing` reconciliation that keeps
  `pending` true (mirror the round-4 note in `/memories/repo/spinner-on-tab-reload.md`).

### 2.3 Tests
- `tests/popup-marking-refresh.test.js` or `tests/popup-ai-run-gating.test.js`: assert the
  stale-clear gate also covers the render-mode-inspection curtain (source-pattern for the new
  condition).
- Extend `tests/render-mode-inspection-order.test.js`: follow-up pops `navInspect` after reveal.

### 2.4 Live validation
- After With/Without JavaScript completes, the curtain disappears within ≤2 s; poll 15 s to
  confirm it does not reappear; confirm `busy=false` and curtain hidden together.

### 2.5 Commit / push / docs
- Commit: `Round-5 #B: clear the inspection curtain after render-mode reveal completes`.
- Push. Update `/memories/repo/spinner-on-tab-reload.md` with the render-mode-path clear.

---

## Stage 3 — Connection / lock recovery (Regression C)

**Outcome:** Render-mode inspection reloads do not leave the popup in `Connection lost`; the
editor lock re-claims and the heartbeat resumes after re-injection.

### 3.1 Force a re-claim, not just a snapshot poll
- File: `popup.js`, `reconcilePropertyLockAfterRenderModeReload` (~3788). Today it only polls
  `refreshPropertyLockSnapshot` and updates the view. Add an explicit re-claim: after the tab is
  `complete` and content is re-injected, send the property-lock claim/heartbeat-resume command
  (reuse the existing claim path — find `sendPropertyLockCommand` / `PROPERTY_LOCK_CONTENT_TAKE_LOCK`
  usage and the popup's reconcile-after-command helper). Then poll the snapshot until
  `CONNECTED`/`INACTIVE` (keep the 6×400 ms bound).
- Ensure content re-injection happened before claiming: `completeRenderModeInspectionReloadFollowUp`
  already calls `hideConsentForRenderModeInspection` which does `activateContentForTab` on
  failure; make sure the claim runs after content is confirmed active.

### 3.2 Don't start the 70 s countdown for an expected reload
- File: wherever the popup renders `Connection lost. You will lose the editor role in 70s…`.
  During `renderModeInspectionActive` (Stage 1 flag, surfaced to popup state), suppress the
  countdown banner and show an inspection-in-progress status instead, so a normal reload does
  not look like a lost connection.
- RESOLVED (Decisions): suppress the 70 s countdown while `renderModeInspectionActive` and show
  a "reconnecting after inspection" status; the lock must re-claim and the heartbeat resume
  after re-injection.

### 3.3 Tests
- New/extended `tests/property-lock-render-mode.test.js` (source-pattern): reconcile sends the
  re-claim command before polling; countdown banner suppressed while inspecting.

### 3.4 Live validation
- Reproduce: reload → With JavaScript → observe connection status. Expect: no `Connection lost`;
  lock returns to connected after the reload settles.

### 3.5 Commit / push / docs
- Commit: `Round-5 #C: re-claim the property lock after render-mode reload to avoid Connection lost`.
- Push. Update `PROPERTY_LOCK.md` + memory.

---

## Stage 4 — Save-gate unlock (Regression D)

**Outcome:** `Save Session` is enabled exactly when `sessionHasPendingChanges &&
!sessionRequiresAiRun && !reconciliationPending`; the `aiRunUpToDate` fingerprint no longer
spuriously blocks it.

### 4.1 Make the fingerprint compare the same entry the user sees
- File: `popup.js`, `isAiRunUpToDateForCurrentMarkings` (~1591),
  `getCurrentPageMarkingsFingerprint`, `captureAiRunMarkingsFingerprint`.
- Verify `state.currentDraftEntry` is the live entry at BOTH capture-time (end of AI run /
  `applyComputedSelectorSet`) and compare-time (`refreshUiInner`). If they can diverge (e.g. the
  draft entry is replaced by a reconcile/silent transition), capture the fingerprint from the
  same source the save gate reads, or recompute after the draft settles.
- If `sessionRequiresAiRun` already encodes "markings changed since last AI run" via the same
  exclude/include xpaths, the extra `|| !aiRunUpToDate` term is redundant and is the actual
  bug source. Decision rule: keep a SINGLE source of truth. Prefer `sessionRequiresAiRun`
  (computed by `doesSessionRequireAiRun`) and drop the redundant `|| !aiRunUpToDate` from
  `nextViewState.pageSaveDisabled` **iff** Stage-4 tests prove `sessionRequiresAiRun` already
  covers the fingerprint case. Otherwise, fix the fingerprint capture source instead. Do not do
  both blindly.
- RESOLVED (Decisions): prove with tests first; prefer the single `sessionRequiresAiRun`
  source and remove `|| !aiRunUpToDate` if tests show it is covered. If not covered, fix the
  fingerprint capture to read the live `state.currentDraftEntry`. Do exactly one; record the
  test evidence in the commit message.

### 4.2 Tests
- Extend `tests/page-save-state.test.js` / `tests/popup-ai-run-gating.test.js`:
  - After an AI run with unchanged markings, `pageSaveDisabled` is false when
    `sessionHasPendingChanges` and `!sessionRequiresAiRun`.
  - Editing markings after AI run sets `sessionRequiresAiRun` true and disables save.
  - CSS-selector-only edits do NOT flip the gate (fingerprint = exclude+include xpaths only).

### 4.3 Live validation
- Clean enable → Run AI → exit preview: `Save Session` becomes enabled with "Changes ready to
  save". Click Save → silent transition (this re-confirms round-4 #4a/#8/#3 under a stable run).

### 4.4 Commit / push / docs
- Commit: `Round-5 #D: unblock Save when the session is ready (single AI-run gate source)`.
- Push. Update memory + `MARKING_AND_HIGHLIGHTING_LOGIC.md` save section.

---

## Stage 5 — Marking vs silent-mode sync (Regression E)

**Outcome:** The popup toggle (marking) and the content mode (silent vs marking) cannot diverge.
The popup reflects the actual content mode after any reload/lock churn; no "marking enabled but
page silent" or "silent shown but page marking".

### 5.1 Reconcile popup toggle to actual content mode
- File: `popup.js`, `refreshUiInner` and the enable-toggle path. Use the existing runtime status
  (`getInspectionStatus` plus a mode field) as the source of truth: add/confirm a content status
  field that reports whether content `state.enabled` (marking) is active vs silent-highlighting.
  In `refreshUiInner`, set `nextViewState.toggleEnabled` from the CONTENT-reported mode when a
  reliable runtime response exists, instead of only from persisted popup/tab state.
- File: `content-main.js`: ensure the status response carries the authoritative mode
  (`enabled`/silent) so the popup can align.

### 5.2 Heal divergence on detection
- When the popup detects a mismatch (toggle says marking but content is silent, or vice versa),
  align to the content truth and refresh, without issuing a redundant `setEnabled` that would
  re-trigger reveal (respect Stage 1's reveal ownership).

### 5.3 Tests
- New `tests/popup-mode-sync.test.js` (source-pattern): `refreshUiInner` prefers the
  content-reported mode for `toggleEnabled` when a runtime response is present; mismatch path
  aligns to content without sending `setEnabled`.

### 5.4 Live validation
- Force the divergence (enable marking, navigate/reload, render-mode cycle) and confirm the
  popup toggle always matches the page mode afterward; Save/Discard/Run AI reflect the true mode.

### 5.5 Commit / push / docs
- Commit: `Round-5 #E: reconcile popup marking toggle to the content mode of record`.
- Push. Update memory + `.copilot/recovery-round4-handoff.md` (close A–E).

---

## Cross-stage guardrails
- After each stage: `npm test` (fail must be 0), commit, push, update memory + the named docs.
- Never bundle two stages in one commit. Never add tests outside the named files except the new
  ones listed. Never refactor unrelated code.
- Do not reintroduce: backend-saved explicit rendering layer; supporter remote-control; an
  auto-`/save` after AI run (round-4 #4). Keep AI-run fingerprint = sorted exclude `xpaths` +
  include `includeXpaths` only.
- If a stage's live test fails, STOP and record findings in `.copilot/recovery-round4-handoff.md`
  before changing approach; do not brute-force.

## Decisions (RESOLVED — binding)
1. Stage 1 HTML capture: reuse `fetchCurrentPageRawHtml` for static HTML; rendered HTML must be
   the purest post-load/post-render DOM, free of all extension-injected nodes and captured
   before any highlighting. Reuse `snapshot.renderedHtml` (verify it strips extension markup).
2. Stage 4 Save gate: prove with tests; prefer the single `sessionRequiresAiRun` source and drop
   `|| !aiRunUpToDate` if covered, else fix fingerprint capture. Exactly one; cite evidence.
3. Stage 3 connection UX: suppress the 70 s role-loss countdown during inspection and show a
   "reconnecting after inspection" status; re-claim the lock + resume heartbeat after reload.
