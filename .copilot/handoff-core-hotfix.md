# Handoff - Core Hotfix Sprint (Environment Switch Ready)

Date started: 2026-06-07
Current branch: main
Scope: core stability first, then return to two-machine orchestration.

## Sprint Guardrails

1. Keep .copilot/plan-core-hotfix-4h.md and this handoff file updated continuously.
2. Commit and push after every completed fix phase.
3. Do not start new feature work until listed P0/P1 items are stabilized.

## Priority Map

Now:
1. Cluster 1 - lifecycle/spinner consistency
2. Cluster 2 - silent highlight and preview consistency

Next after core stabilization:
3. Property lock completion/hardening
4. Remote support (last priority)

## Work Log

### Phase A - Repro and instrumentation
Status: COMPLETE (mapping/root-cause pass)
Owner: active engineer
Started at: 2026-06-07
Completed at: 2026-06-07

Repro coverage:
- #1 silent highlight blinking
- #2/#3/#5 spinner stuck/missing
- #4 spinner text sync (low)
- #6 delayed apply feedback
- #16 preview item visibility mismatch
- #20 trace cross-world mismatch

Findings (event/state map):

Cluster 1 - spinner/lifecycle authority
- Authoritative store lives in background.js: tabSpinnerQueueByTabId (per-tab Map)
  and tabLifecycleStateByTabId, surfaced via buildBrokerState/broadcastBrokerState
  over ufPopupState:<tabId> ports (common/world-messaging-contract.js).
- popup.js keeps a PARALLEL popupSpinnerQueue and pushes each entry back via
  syncSpinnerEntryToBackground (popup.js:1018 pushSpinner / 1211 popSpinner).
  Two sources of truth that can diverge -> core defect surface.
- #2/#3/#5 stuck/missing: popSpinner only runs inside runWithSpinner's finally
  (popup.js:1248). Popup close mid-op skips the local pop; background entry
  persists (persistent or just never removed) and reopen restores the curtain
  from the spinnerQueue snapshot. scheduleStaleInspectionBusyClear
  (popup.js:1133) is a 12-attempt x 400ms polling reconciler - the timing hack
  the constraints warn against.
- #5 "Applying device emulation...": setSpinnerMessage(spinnerKey,
  applyingDeviceEmulation) at popup.js:6994 keys onto navInspect/spinnerKey; if
  the op settles via a different path the key lingers in the background queue.
- #4 text desync: setSpinnerMessage only repaints UI when the key is
  top-of-queue ([...keys()].at(-1), popup.js:1118). A message update to a
  non-top key updates background state but not the visible text.
- #20 trace cross-world: appendWorldTraceEvent records per-tab spinner/lifecycle
  events; need to confirm UI toggle (setWorldTraceEnabled) round-trips to the
  same tab's traceEnabled flag.

Cluster 2 - silent highlight/preview
- #1 blink ROOT CAUSE: renderSilentHighlightOverlay (content-main.js:3535) calls
  setSilentHighlightOverlayHidden(true) -> redraw rects ->
  scheduleSilentHighlightOverlayReveal() (rAF-deferred, content-main.js:3299).
  repositionSilentHighlightOverlay (content-main.js:3623) repeats that exact
  hide->redraw->reveal cycle, and it is invoked on settle finalize (every
  SILENT_SETTLE_REPOSITION_SAMPLE_MS=120ms while unsettled), on layout-shift
  (PerformanceObserver, content-main.js:4227), and on relevant DOM mutations
  (content-main.js:4204). Each reposition is a visible blink because the reveal
  is deferred a frame and gated behind no-pending-timers.
- #6 delayed apply: marking interactions go through
  scheduleSilentHighlightingsRefresh (debounced) -> async config.getConfigs ->
  double yield (setTimeout 0 then rAF) before the overlay updates
  (refreshSilentHighlightings, content-main.js:5980). Visible lag can read as an
  ignored click.
- #16 preview visibility mismatch: preview list eligibility must be reconciled
  against collectSilentHighlightRenderTargets / renderable collections so list
  rows always map to a visible, highlightable target.

### Phase B - Cluster 1 lifecycle/spinner
Status: B1 DONE (authority shift); B2 no-op (already handled); B3 DEFERRED
Owner: active engineer
Started at: 2026-06-07
Completed at: 2026-06-07 (B1)

Scope decision (owner): full authority refactor, staged so the polling
reconciler is removed LAST, only after the authoritative path is proven on the
silent-restore edge case. Removing it before that would reintroduce the P0
stuck-curtain.

B1 - background authoritatively tears down the inspection curtain (DONE, browser-verified)
- Added shared SPINNER_KEYS.NAV_INSPECT + CURTAIN_BEARING_LIFECYCLE_KINDS +
  isCurtainBearingLifecycleKind to common/world-messaging-contract.js.
- background.js updateLifecycleState now clears the persistent navInspect
  spinner for a tab when a curtain-bearing lifecycle (ACTIVATION /
  RENDER_MODE_INSPECTION) reaches a terminal phase (FINISHED/FAILED), gated so
  routine content-ready terminals never drop the curtain. This makes background
  the owner of end-of-operation curtain teardown: a popup that closed
  mid-inspection reopens without a stuck curtain because the snapshot no longer
  carries navInspect.
- BROWSER-VERIFIED (Playwright, extension loaded, verify-b1.mjs) by driving the
  real background message handlers (SPINNER_SET / LIFECYCLE_EVENT /
  GET_BACKGROUND_STATE) per synthetic tab. All 4 checks pass:
  render-mode-inspection FINISHED clears navInspect; activation FINISHED clears
  navInspect; content-ready FINISHED does NOT clear; render-mode STARTED
  (non-terminal) does NOT clear. (Verifies the gate, not the full side-panel
  close/reopen UX; the popup curtain is driven purely from this broker state via
  syncUiBusyFromBrokerState.)

B2 - resolved without code change
- #5 transient "Applying device emulation..." orphan: ALREADY cleared on the
  last popup-port disconnect (background.js port.onDisconnect ->
  clearBackgroundSpinnerQueue transientOnly). Transient spinners are
  popup-session scoped by design; persistent navInspect is the only cross-close
  curtain and B1 now owns its teardown.
- #4 "text desync": not a real bug. The curtain shows currentSpinnerMessage()
  (last/top entry); setSpinnerMessage repainting only the top entry is
  self-consistent. No change, to avoid risk.

B3 - remove scheduleStaleInspectionBusyClear (DEFERRED, see Next Actions)
- Precondition to remove safely: confirm (manual/extension test) that the
  silent-restore edge case (leftover navInspect from a prior marking session in
  silent mode, popup.js:1150) always receives a terminal curtain-bearing
  lifecycle so B1 clears it. Until verified in a real browser, keep the
  reconciler as a rarely-firing fallback behind the authoritative path
  (robust reconciliation + bounded fallback, not a pure timing hack).

Files touched:
- common/world-messaging-contract.js (SPINNER_KEYS, CURTAIN_BEARING_LIFECYCLE_KINDS,
  isCurtainBearingLifecycleKind)
- background.js (import + updateLifecycleState terminal curtain teardown)
- tests/lifecycle-broker.test.js (new assertion for terminal curtain teardown)

Validation:
- node --test full suite green; lifecycle-broker + device-emulation-lifecycle +
  content-activation-order + popup-marking-refresh + popup-mode-sync pass.
- Contract smoke test: isCurtainBearingLifecycleKind(ACTIVATION)=true,
  (CONTENT_READY)=false.

Commit:
- pending (this checkpoint)

Push:
- pending

### Phase C - Cluster 2 highlight/preview
Status: IN PROGRESS (#1 blink DONE + browser-verified; #6/#16 pending)
Owner: active engineer
Started at: 2026-06-07
Completed at: -

Sequencing note: owner chose to land the isolated blink fix (#1) before the
Cluster 1 authority refactor. Remaining Cluster 2 items (#6 immediate feedback,
#16 preview/visible-target alignment) still pending.

#1 silent-highlight blink - DONE (two-part fix, browser-verified)

CORRECTION: the first commit (62ea6a3) fixed only the reposition path and was
declared "done" on source reasoning + snapshot tests WITHOUT running the
extension. Owner confirmed the blink was still present. A real-browser repro
(Playwright, extension loaded) showed the DOMINANT source was a different path.
Lesson recorded: do not claim a runtime/visual fix without observing it in the
actual extension. See [[verify-visual-fixes-in-real-browser]].

Two distinct blink sources:
1. Reposition path (commit 62ea6a3): scheduleSilentHighlightReposition hid the
   overlay up front for ALL repositions; repositionSilentHighlightOverlay ran
   setSilentHighlightOverlayHidden(true) -> rAF reveal on every settle/
   layout-shift/mutation. Fixed via keepVisible on settle/layout-shift/mutation
   repositions; scroll/resize keep hide->reveal (viewport-fixed rects go stale
   mid-gesture).
2. Full-refresh path (DOMINANT, this commit): shouldRenderSilentHighlightOverlay
   returns true whenever isFullRefresh, so refreshSilentHighlightings ->
   applyOverlayUpdate ALWAYS ran renderSilentHighlightOverlay with the hide->
   reveal cycle - even when the recomputed highlight set was identical. A DOM
   class mutation on a tracked node re-runs the full pipeline (debounced to the
   ~1200ms mutation min-interval), so the overlay blinked ~once/1.2s on any
   dynamic page. Fix: pass keepVisible when the overlay is already live
   (lastSilentHighlightingsActive && shouldBeActive && overlay exists), so live
   updates repaint rects in place; only the initial inactive->active paint uses
   hide->reveal so the first reveal is scheduled.

Browser verification (Playwright harness, extension loaded, seeded silent config,
page mutating a tracked node's class every 500ms):
- BEFORE fix #2 (HEAD with only the reposition fix): 6 hide/reveal cycles in 8s.
- AFTER fix #2: 0 cycles across two 14s runs (34 mutations each), 16 rects intact.
- Scroll regression check: overlay legitimately hides on scroll, then reveals AND
  repositions (rect top 40px -> 5.9px), visibleAfterScroll=true, no page errors.

Files touched:
- content-main.js (renderSilentHighlightOverlay + repositionSilentHighlightOverlay
  keepVisible plumbing; scheduleSilentHighlightReposition scroll-only hide;
  applyOverlayUpdate keepVisible for live overlays)
- tests/silent-highlight-annotations.test.js (snapshot regexes for new signatures)

Test harness (gitignored, .scratch-blink-test/): Playwright loads the unpacked
extension via the Mac chromium-1223 cache, seeds the extension-origin IDB
(unfluffify/kv/configs) directly in the service worker, activates content via
activateContentMain, and counts overlay uf-silent-hidden toggles. NOTE: the
repo's playwright-local MCP (.mcp.json) is hardcoded to LINUX paths
(/home/rojan/...) and cannot launch on this Mac - that is why its tools never
connect here. normalizeBaseUrl strips ports, so the harness must use a
default-port host (route-intercepted) not localhost:PORT.

Validation:
- node --test full suite green.
- Playwright blink counts above.

Commit:
- 62ea6a3 (reposition path) + this commit (full-refresh path)

Push:
- pending

## Environment Switch Checklist

Before stopping work:
1. Update this handoff with exact status and next command.
2. Update .copilot/plan-core-hotfix-4h.md with completed phase details.
3. Commit and push current phase.
4. Ensure git status is clean or intentionally includes only active-phase changes.

When resuming in a new environment:
1. git fetch --all --prune
2. git checkout main
3. git pull --ff-only
4. Read this file from top to bottom.
5. Run first command in Next Actions.

## Next Actions (Always Keep Current)

1. Phase A complete - event/state map recorded above.
2. Phase C #1 blink - DONE (committed/pushed).
3. Phase B B1 authority shift - DONE (committed/pushed). B2 resolved no-op.
4. B3 reconciler removal - BLOCKED on manual verification:
   - Load the unpacked extension; reproduce the silent-restore stuck curtain
     (open marking session -> trigger navInspect -> close popup mid-inspection
     -> switch to silent mode -> reopen popup).
   - Confirm via world-trace (ufDebugSpinnerQueue=1) that a terminal
     curtain-bearing lifecycle clears navInspect (B1) WITHOUT the reconciler.
   - Only if confirmed for every curtain path: delete scheduleStaleInspectionBusyClear
     and its call sites in popup.js, update popup-marking-refresh tests.
5. Phase C remaining (Cluster 2):
   - #6 immediate marking feedback: render an instant local highlight/echo on
     marking interaction before the debounced refreshSilentHighlightings settles.
   - #16 preview list/visible-target alignment: reconcile preview list eligibility
     against collectSilentHighlightRenderTargets so every row maps to a visible,
     highlightable target.
   - Validate: tests/silent-highlight-annotations.test.js,
     tests/content-main*.test.js, tests/popup-render-mode.test.js.

## Immediate Commands

- git status --short
- rg -n "spinner|runWithSpinner|ufLifecycleEvent|ufSpinner|navInspect|getInspectionStatus" popup.js background.js content-main.js common
- rg -n "highlight|silent|refreshSilent|preview|visibility|xpath|scroll" content-main.js content popup.js common
- npm test -- tests/popup-marking-refresh.test.js tests/device-emulation-lifecycle.test.js tests/content-activation-order.test.js

## Known Constraints

- Do not weaken the locked marking contract.
- Keep fix scope minimal and deterministic.
- Prefer robust state reconciliation over timing-based hacks.
