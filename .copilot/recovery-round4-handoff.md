# Recovery — Round 4 handoff (resume here)

Branch: `recovery/clean-rebuild` (base `0a07bcd`, `main` untouched).
Last commit: `7acc003` (item 2). Full source-pattern suite passes (fail = 0; total
count fluctuates 398–444 because `node --test --test-force-exit` cuts async-registered
tests — only **fail = 0** matters).

Companion docs in repo:
- `.copilot/recovery-plan.md` — authoritative plan + B2 spec (marking precedence /
  save / revert flow). The post-save transition spec is summarized below under "Key contract".
- Repo memory: `/memories/repo/marking-rendering.md`, `playwright-debug-harness.md`,
  `testing-config.md` (live-validation harness + conventions).

> IMPORTANT: Source-pattern tests (regex over source) do NOT validate runtime
> behavior. Every round-4 item below needs LIVE re-test (Playwright/MCP harness,
> user JWT). The user manually removed the curtain via DevTools to keep testing —
> i.e. item #2 (stuck spinner) blocks the popup until fixed.

---

## Round-5 Stage 1 (2026-06-04) — implemented and live-validated

Implemented: render-mode entry gating + explicit inspection reveal/capture lifecycle.
Source changes are in `content-main.js`, `popup.js`,
`popup/state.js`, `tests/content-activation-order.test.js`,
`tests/popup-render-mode.test.js`, and new `tests/render-mode-inspection-order.test.js`.

What changed:
- Popup render-mode auto-detection now consumes a cached explicit-inspection snapshot
  instead of calling `collectPageData` / static fetch on initial render-mode view entry.
- `runRenderModeInspectionReload` sends `renderModeInspectionBegin`, awaits reload start,
  awaits `completeRenderModeInspectionReloadFollowUp`, refreshes UI after a successful
  follow-up, and waits for content-main before sending `renderModeInspectionEnd` in `finally`.
- Follow-up order is load complete → content-main ready → `runRenderModeRevealOnce` →
  `captureRenderModeInspectionHtml` → remember snapshot → hide consent → property-lock
  reconcile.
- Content suppresses editor-acquisition reveal while render-mode inspection is active or
  the matching base URL has no confirmed render mode. The inspection flag is also stored
  in page `sessionStorage` so it survives the reload.
- Content capture reuses `createCurrentPageSnapshot()` (sanitized by
  `EXTENSION_SNAPSHOT_STRIP_SELECTORS`) and `fetchCurrentPageRawHtml()` after reveal,
  before highlight refresh.

Automated validation:
- Focused: `node --test tests/content-activation-order.test.js tests/popup-render-mode.test.js tests/render-mode-inspection-order.test.js` → `fail = 0`.
- Full: `npm test` → `tests 455`, `pass 455`, `fail 0`.

Live validation status:
- MCP active page: `https://unitedspaces.com/sv`, popup tab at
  `chrome-extension://bfbljhcodkjihodjlpcnnfkdmejoehgo/popup.html?debugTabId=809898377`.
- Required Chrome setting for this harness: `View > Developer > Allow JavaScript from Apple Events`
  allowed driving the existing popup tab because the MCP page object stayed attached to the web page.
- Initial page load check after extension/page reload: no `#unfluffify-page-inspection-style`,
  no inspection notice, no `#unfluffify-overlay`, and no render-mode inspection session flag.
- First live attempt found a real race: after reload, `runRenderModeRevealOnce` and
  `renderModeInspectionEnd` hit `content-loader` before `content-main` was ready, leaving
  `sessionStorage.unfluffify:render-mode-inspection-active = "1"`. Fixed by adding
  `ensureContentReadyForRenderModeInspection()` before reveal and before final cleanup.
- Final With JavaScript run: console order showed `renderModeInspectionBegin` → content-main
  activation/ready → `runRenderModeRevealOnce` → `captureRenderModeInspectionHtml` →
  `hideConsentForInspection`/refresh → `renderModeInspectionEnd`; final page state had
  `sessionInspection: null`, no inspection style, no inspection notice, no overlay, and
  popup suggested Render Mode = JavaScript (`renderModeValue: "rendered"`).

---

## Round-5 Stage 2 (2026-06-04) — implemented and live-validated

Implemented: render-mode inspection curtain cleanup for stale `navInspect` spinners.

What changed:
- `scheduleStaleInspectionBusyClear()` now accepts `reconcileRenderModeNavSpinner` and
  treats a lone `navInspect` spinner as eligible for stale-clear once content reports no
  inspection/reconciliation pending.
- The render-mode branch logs `render-mode-nav-curtain-clear`, ends the navigation
  inspection overlay, and explicitly pops `navInspect` so an inherited reload spinner
  cannot keep the blocking curtain visible after reveal/capture completes.
- `completeRenderModeInspectionReloadFollowUp()` schedules that render-mode stale-clear
  after load → content-main ready → reveal → clean HTML capture → hide consent → property
  lock reconcile.

Automated validation:
- Focused: `node --test tests/popup-marking-refresh.test.js tests/render-mode-inspection-order.test.js tests/popup-render-mode.test.js` → `fail = 0`.
- Full: `npm test` → `tests 455`, `pass 455`, `fail 0`.

Live validation status:
- With JavaScript on `https://unitedspaces.com/sv` showed the expected in-progress state
  (`sessionInspection: "1"`, page overlay true, popup busy text present) during the action.
- Final page state after settle: `sessionInspection: null`, no inspection style, no
  inspection notice, no overlay, motion pause restored for silent/editor posture.
- Final popup state: no `Working... controls are temporarily blocked`, no `Please wait`,
  no `Inspecting page`; Render Mode suggested JavaScript and controls were enabled.
- 15-second browser-side sample: 16 samples, `anyCurtain: false`,
  `anySessionInspection: false`.

---

## Round-5 Stage 3 (2026-06-04) — implemented and live-validated

Implemented: property-lock re-claim and connection-loss countdown suppression during
expected render-mode inspection reloads.

What changed:
- `reconcilePropertyLockAfterRenderModeReload()` sends
  `PROPERTY_LOCK_CONTENT_TAKE_LOCK` with a render-mode reconnect marker before polling
  lock snapshots, then keeps the existing connected/inactive polling bound.
- Popup state tracks `renderModeInspectionActive`; while active, popup lock UI shows
  `Reconnecting after inspection...` instead of the editor disconnect countdown.
- Content-side property-lock banner suppresses both explicit disconnect warnings and
  unavailable connection-status countdowns while `renderModeInspectionActive`/session flag
  is set, then restores the ordinary banner mode after `renderModeInspectionEnd`.

Automated validation:
- Focused: `node --test tests/property-lock-render-mode.test.js tests/property-lock.test.js tests/popup-render-mode.test.js` → `fail = 0`.
- Full: `npm test` → `tests 458`, `pass 458`, `fail 0`.

Live validation status:
- With JavaScript on `https://unitedspaces.com/sv`: during action, popup had no
  `Connection lost`, page banner text was empty, and only the expected inspection overlay
  was visible.
- Final popup state: no `Connection lost`, no `Edit lock unavailable`, editor lock text
  still active (`You are editing this property`), Render Mode suggested JavaScript.
- Final page state: `sessionInspection: null`, lock banner empty, no `Connection lost`,
  no reconnect banner, no overlay.

---

## Round-5 Stage 4 (2026-06-04) — implemented and live-validated

Implemented: Save Session now follows the page-save UI state / `sessionRequiresAiRun`
source of truth instead of also requiring `aiRunUpToDate`.

What changed:
- Removed the redundant `|| !aiRunUpToDate` term from `nextViewState.pageSaveDisabled`.
- Kept `aiRunUpToDate` for Run AI freshness and marking-preview freshness; Save is now
  enabled when `buildPageSaveUiState()` says the session has pending changes and does not
  require AI.
- Focused tests document that `sessionRequiresAiRun` is the Save gate source and that the
  AI-run fingerprint still covers only exclude/include XPaths, not CSS selector edits.

Automated validation:
- Focused: `node --test tests/page-save-state.test.js tests/popup-ai-run-gating.test.js` → `fail = 0`.
- Full: `npm test` → `tests 458`, `pass 458`, `fail 0`.

Live validation status:
- Confirmed Render Mode = JavaScript, enabled marking, enabled mobile simulation, and ran AI
  content detection on `https://unitedspaces.com/sv`.
- AI completed into Detected Content preview. After exiting preview, popup showed
  `Changes ready to save`, `Save Session` enabled, `Discard` enabled, preview enabled, and
  Run AI disabled.
- Clicking Save completed successfully and returned the popup to silent mode:
  `toggleChecked: false`, `page-save` absent, silent controls visible, and `Session saved`.

---

## Round-5 Stage 5 (2026-06-04) — implemented and live-validated

Implemented: popup marking toggle reconciles to the content script's authoritative mode.

What changed:
- `getInspectionStatus` now returns `markingEnabled` and `mode` (`"marking"`/`"silent"`).
- `refreshUiInner()` asks content for mode when the current page/base URL is in scope and,
  when content mode is known, updates `effectiveTabState`, clears optimistic popup toggle
  state, and sets `toggleEnabled` from content truth.
- The reconciliation path writes tab state only; it does not send a redundant `setEnabled`
  message, so it cannot re-trigger reveal/inspection lifecycle.

Automated validation:
- Focused: `node --test tests/popup-mode-sync.test.js tests/content-activation-order.test.js tests/popup-marking-refresh.test.js` → `fail = 0`.
- Full: `npm test` → `tests 461`, `pass 461`, `fail 0`.

Live validation status:
- Forced divergence by writing persisted tab state as `enabled:true` for
  `https://unitedspaces.com` while leaving content in silent mode.
- After popup reload, toggle reconciled to false, marking Save controls were absent,
  silent controls were visible, and page-side markers showed no marking overlay with motion
  pause still active for silent/editor posture.

---

## Round-5 follow-up (2026-06-05) — intermittent popup spinner persistence

Observed report: the spinner disappeared in the agent-controlled popup sessions but persisted
intermittently in the user's session. The live popup I could inspect had a hidden `#ui-curtain`
(`display:none`) and no visible page inspection markers, which suggested an orphaned popup
task spinner rather than the deterministic `navInspect` path.

Root cause/fix:
- `persistSpinnerQueueToStorage()` stores the in-flight queue during normal operation,
  including non-persistent random task spinner keys from `runWithSpinner(null, ...)`.
- If the popup disappears before that task's `finally { popSpinner(...) }` or before the
  `beforeunload` persistent-only cleanup wins, the next popup can restore an ownerless
  non-persistent spinner and keep the blocking curtain visible.
- `restoreSpinnerQueueFromStorage()` now restores only entries explicitly marked
  `persistent:true` (for example `navInspect`) and immediately rewrites/removes storage to
  drop non-persistent orphan task spinners.

Validation:
- Focused: `node --test tests/popup-marking-refresh.test.js` → `fail = 0`.
- Full: `npm test` → `tests 462`, `pass 462`, `fail 0`.
- Live simulation: manually wrote `spinnerQueue:<tabId>` with a fake non-persistent
  `staleTaskSpinner`, reloaded the popup, and confirmed `#ui-curtain` stayed hidden
  (`display:none`) with no `Working... controls are temporarily blocked` text.

---

## Round-3 status (committed, but several regressed in live test)

| Item | What | Commit | Live result |
|------|------|--------|-------------|
| 1 | reveal/freeze bound to silent-highlight activation only | a84d2be | ✅ GOOD (finding #1) |
| 2 | "Inspecting page…" curtain tracks silent reveal/freeze | 7acc003 | ❌ curtain never clears (finding #2) |
| C/D/E | Run AI / Save / Preview gated on AI-run markings fingerprint | dee6ea8 | ❌ regressions #3, #4(save), #5 |
| A | confirm-to-discard on disable | a6d5c39 | (retest after #4a/#8) |
| B | confirm-to-discard on navigate | 4013f07 | ❌ state not reset #6/#7 |
| F | local-only discard speed | cc543b1 | (retest) |

---

## Round-4 live findings (2026-06-04) — TODO

### ✅ 1. Render-mode With/Without JavaScript no longer fires reveal/freeze
Confirmed fixed by item 1. No action.

### ✅ 2. Fresh-load "Inspecting page…" spinner never disappears
FIXED: root cause was a leftover `navInspect` spinner restored from a prior marking
session (popup.js init ~8281). In silent mode it keeps `popupSpinnerVisible` true, so the
queue-empty gate in `scheduleStaleInspectionBusyClear` never fired. Added a
`reconcileSilentNavSpinner` path: `refreshUiInner` now detects a stuck silent-mode
`navInspect` spinner (`silentNavSpinnerStuck`) and schedules the stale-clear with that
flag; the poller ends the leftover overlay (`endNavigationInspectionOverlay`) once the
silent reveal/freeze warmup is no longer pending, dropping the curtain. LIVE re-test
required.

Prior analysis:
Reveal/freeze runs correctly, but the initial curtain stays up after warmup completes.
- Item-2 added silent-mode polling in `refreshUiInner` (popup.js): `silentInspectionInScope`,
  the `getInspectionStatus` query gate, and a `scheduleStaleInspectionBusyClear` call when
  `pageInspectionBusy && silentInspectionInScope`.
- HYPOTHESIS: `scheduleStaleInspectionBusyClear` (popup.js ~945) only clears when
  `popupSpinnerQueue.size === 0 && !popupSpinnerVisible && view.isBusy &&
  view.busyMessage === PopupText.overlay.pageInspection`. The fresh-load curtain is likely
  shown via the spinner QUEUE (`popupSpinnerVisible = true`) or via a navigation/restore
  overlay, so the silent stale-clear branch is gated out and nothing ever calls `popSpinner`
  for it. Net: `nextViewState.isBusy = pageInspectionBusy` stays true and never re-clears.
- NEXT: trace which mechanism shows the fresh-load curtain (spinner queue vs.
  `nextViewState.isBusy`). Ensure that once the content reports `editor_preparing` →
  cleared (silent reveal/freeze done), the popup re-runs `refreshUiInner` and drops the
  curtain even when the spinner came from the queue. Likely need a dedicated silent-mode
  clear path independent of `!popupSpinnerVisible`, OR have the content push a
  `pageDraftChanged`/reconciliation-cleared message that triggers a popup refresh.
- Check: `getInspectionStatus` handler (content-main.js ~6915) reports
  `pending`/`pendingReason`; confirm it flips to not-pending after
  `runEditorSilentHighlightingActivationOnce` finishes (it sets then clears the
  `SILENT_HIGHLIGHTING_PREPARATION_REASON` reconciliation).

### ✅ 3. Run AI re-enables after a successful Save with no changes
FIXED via the post-save silent switch (see #4a): after save the popup drops to silent
mode where Run AI (compute) is not shown, and re-entering marking resets the fingerprint
from scratch. `computeButtonDisabled` already gates on `aiRunUpToDate`.

Prior analysis:
After save the fingerprint is reset to `null` → `aiRunUpToDate` false → Run AI enabled.
Root cause is shared with #4a: the popup does not switch to silent after save, and Run AI
is not additionally gated on "session has pending changes". After fixing #4a (popup → silent
on save) Run AI should be hidden/irrelevant; ALSO consider gating `computeButtonDisabled`
on `!sessionRequiresAiRun` (or `!sessionHasPendingChanges`) so a clean, just-saved page
keeps Run AI disabled.

### ✅ 4 (save). `/save` is auto-called after a successful AI run (can persist stale changes)
FIXED: removed the `syncBaseConfigToServer` push (and the dependent
`updateLastConfigSaveStatus`/toast "…AndSynced" branch) from `applyComputedSelectorSet`
(popup.js ~7400). AI run now computes selectors LOCALLY (`config.updateConfig`,
`configUpdated` message, `showAiPreview`, `captureAiRunMarkingsFingerprint`) and shows a
local-only status/toast (`PopupText.ai.selectorsComputedLocally` /
`selectorsComputedLocallyToast`). Save (`handlePageSave`) remains the explicit server-sync
step. New source-pattern test in tests/popup-ai-run-gating.test.js asserts no
`syncBaseConfigToServer` in the function. LIVE re-test still required.
ROOT CAUSE was: `applyComputedSelectorSet` (popup.js ~7375) called
`syncBaseConfigToServer({...})` immediately after computing selectors (around line 7404).
That is an automatic server push on every AI run.
- Per contract, AI run computes selectors LOCALLY + opens preview; **Save is the explicit,
  separate step** (`handlePageSave`). Auto-sync here can upload stale/unintended state.
- NEXT: remove the `syncBaseConfigToServer` call (and the dependent
  `updateLastConfigSaveStatus`/toast "…AndSynced" branch) from `applyComputedSelectorSet`.
  Keep: local `config.updateConfig` of selectors, `configUpdated` message, `showAiPreview`,
  `captureAiRunMarkingsFingerprint`, and a LOCAL-only status/toast ("selectors computed
  locally"). Update tests that assert the post-run sync (search tests for
  `selectorsComputedAndSaved` / `syncBaseConfigToServer`).

### ✅ 4a. Saving in marking mode does not switch the popup to silent mode
FIXED: new `applyPostSaveSilentTransition()` (popup.js, before `handlePageSave`) runs in
the `handlePageSave` success branch. It resets the content page entry to the saved
baseline (`configUpdated` + `forceReloadPageEntry: true`), clears `state.currentDraftDirty`,
sets tab state `enabled:false`, `clearLastPopupEnabled()`, and `toggleEnabled:false` so the
popup renders silent controls WITHOUT re-issuing an enable message to content (page is
already silent). LIVE re-test required.

Prior analysis:
Page UI goes silent but the popup still renders marking controls.
- Per `.copilot/recovery-plan.md` + round-2 spec: after a successful Save the mode must
  switch marking → silent (highlighting), and the content preview popup shows. The user
  stays in silent until clicking Enable Marking again (which re-enters marking from scratch
  defaults→AI).
- NEXT: in `handlePageSave` success branch (popup.js ~7169) after sync + reconciliation
  clear, flip the popup to silent: set tab state `enabled:false`, `setEnabled false` to
  content is NOT wanted (page already silent) — instead clear the popup toggle
  (`clearLastPopupEnabled()` / `setLastPopupEnabled(false,...)`), update `effectiveTabState`,
  and `refreshUi()` so `toggleEnabled` is false and silent controls render. Mirror how
  `handleEnableToggle` disable path updates popup state, but WITHOUT discarding saved data.

### ✅ 5. Marking-mode "Show content / Preview" button is half width
FIXED: popup/ui.js no longer wraps `#marking-preview` in the 2-column `.button-row` grid;
the button renders directly as a full-width `u-btn-secondary u-full-width` button (matching
the silent-mode preview/save-excludes buttons). LIVE re-test recommended.

Prior analysis:
`popup/ui.js:2149` wraps `#marking-preview` in `{ class: "button-row" }`, which lays out
at 50% width. The button itself is `u-btn-secondary u-full-width`.
- NEXT: use a full-width row container instead of `button-row` (e.g. a plain row class /
  the same wrapper used by other single full-width buttons). Confirm CSS — find the
  full-width row class in `popup/popup.css` (or wherever styles live) and apply it. Update
  the ui test that asserts the row class if present.

### ✅ 6. Navigating from marking leaves the popup marking-toggle active on the new (silent) page
FIXED: `confirmNavigationAwayFromMarking` now calls the shared `alignPopupToSilentMode()`
(clears popup toggle + sets tab state `enabled:false` + `toggleEnabled:false`) on BOTH
navigate-away paths (clean session and after OK-discard) so the destination page's popup
shows silent controls. LIVE re-test required.

Prior analysis:
After OK-discard + navigate, the page lands silent but the popup still shows marking
controls (toggle still "on").
- `confirmNavigationAwayFromMarking` (popup.js) discards locally and allows navigation but
  does NOT reset the popup enabled/toggle + tab state. The new page loads silent (content
  URL watcher disables), yet the popup's persisted `lastPopupEnabled` / tab state still says
  enabled.
- NEXT: when navigation proceeds (OK), reset popup-side state to silent BEFORE/just after
  navigating: `clearLastPopupEnabled()`, set tab state `enabled:false` for the target,
  and ensure the post-navigation `refreshUi` reads `toggleEnabled=false`. Same fix pattern
  as #4a.

### ✅ 7. Re-enabling marking after a navigation shows controls but does not enter marking on the page
FIXED via #6: with popup + tab state reset to silent, `handleEnableToggle` sees
`toggleEnabled=false` and runs the full enable path again. LIVE re-test required.

Prior analysis:
Caused by the stale enabled/tab state from #6 — the popup thinks marking is already
enabled, so `handleEnableToggle` no-ops the content `setEnabled`/`enableForBaseUrl` while
still showing controls (and Run AI is clickable).
- Should be resolved once #6 properly resets popup + tab state to silent on navigation.
  After that, re-enabling runs the full `handleEnableToggle` enable path
  (`waitForEnableMarkingInspectionToSettle` + content `enableForBaseUrl` reveal/freeze).
- Verify `handleEnableToggle` enable branch isn't short-circuiting on a stale
  `latestViewState.toggleEnabled` / persisted state.

### ✅ 8. After save→silent, Discard is immediately enabled (should detect no changes)
FIXED as part of `applyPostSaveSilentTransition()` (see #4a): the content draft is reset
to the saved baseline and `state.currentDraftDirty` is cleared, so `hasSessionPendingChanges`
is false and Discard is disabled. LIVE re-test required.

Prior analysis:
Post-save, in-memory current-page state still carries session deltas / `currentDraftDirty`,
so `hasSessionPendingChanges` returns true and Discard lights up.
- Per contract (recovery-plan B2): after save the current page rendering RESETS to
  defaults→AI baseline and session explicit deltas are DROPPED from the overlay. So the
  in-memory page entry must be recomputed from selectors (no pending changes).
- NEXT: in `handlePageSave` success branch, after server returns the current payload and
  local data is updated, reset the in-memory current-page entry from the AI/CSS selector
  baseline (similar to `applyLocalPageDiscard` minus the "restore backend entry" — here the
  backend entry IS the just-saved state), clear `currentDraftDirty`/draft, so
  `hasSessionPendingChanges` is false → Discard disabled. Coordinate with #4a (this is part
  of the same post-save transition).

### ✅ 9. Property lock shows "disconnected" after each render-mode detection
FIXED: `completeRenderModeInspectionReloadFollowUp` now calls
`reconcilePropertyLockAfterRenderModeReload()` after the reload load completes. It polls
`refreshPropertyLockSnapshot` (up to 6×400ms) until the content re-claims the lock
(`CONNECTED`, or `INACTIVE` = nothing to reconnect), updates the lock view, then refreshes
the UI (skipping a redundant fetch). LIVE re-test required.

Prior analysis:
Render-mode inspection reload (`runRenderModeInspectionReload`, popup.js ~5478) reloads the
page; the content script re-injects and the property-lock claim/heartbeat is lost, so the
popup shows disconnected until (if ever) it reconciles.
- NEXT: after a render-mode inspection reload completes, re-establish / reconcile the
  property lock (re-claim or `reconcilePropertyLockAfterCommand`-style refresh) so the popup
  shows connected. Investigate the property-lock claim lifecycle across reloads
  (`handlePropertyLock*`, `reconcilePropertyLockAfterCommand`, `sendPropertyLockCommand`,
  lock-claim in content-main.js). Ensure the heartbeat resumes after the reload settles.

---

## Key contract reminders (do not regress)
- Marking render precedence: defaults → CSS/AI selectors → current-session explicit deltas
  ONLY. `savedPageEntry` kept only for AI payload + reconciliation; saved marks must NOT
  render as a separate layer.
- Discard/revert = drop current-page session deltas LOCALLY, save NOTHING (no backend
  upload, no `forceReloadPageEntry`).
- AI-run fingerprint = sorted exclude `xpaths` + include `includeXpaths` ONLY (CSS selector
  edits and render-mode changes must NOT re-enable Run AI).
- Post-save flow: backend returns payload → update local from it → current page resets to
  defaults→AI baseline (session deltas dropped) → mode switches marking → silent → content
  preview shows → user stays silent until Enable Marking re-enters fresh.
- reveal/freeze runs ONLY inside the silent-highlight activation gate
  (`runEditorSilentHighlightingActivationOnce`) and on manual `enableForBaseUrl`.

## Suggested fix order
1. **#4 (save) auto-sync removal** — isolated, unblocks correct AI-run semantics.
2. **#4a + #8 + #3 post-save transition** — one coherent change in `handlePageSave`
   (switch popup → silent, reset in-memory page to AI baseline, clear pending → Discard off,
   Run AI off).
3. **#6 + #7 post-navigation state reset** — reset popup/tab state to silent on
   discard-navigate; verify re-enable works.
4. **#5 button width** — quick CSS/row-class fix.
5. **#2 stuck spinner** — silent-mode curtain clear (needs live trace).
6. **#9 property-lock reconnect after render-mode reload**.

After EACH item: `npm test` (fail must be 0), update the affected source-pattern tests,
commit per item, and ask the user for a LIVE re-test (runtime behavior is uncovered by the
test suite).
