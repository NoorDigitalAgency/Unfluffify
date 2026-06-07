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
Status: NOT STARTED
Owner: TBD
Started at: -
Completed at: -

Files touched:
- Pending

Validation:
- Pending

Commit:
- Pending

Push:
- Pending

### Phase C - Cluster 2 highlight/preview
Status: NOT STARTED
Owner: TBD
Started at: -
Completed at: -

Files touched:
- Pending

Validation:
- Pending

Commit:
- Pending

Push:
- Pending

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
2. Phase B (Cluster 1) - make background the single spinner/lifecycle authority:
   - Reconcile popup popupSpinnerQueue from broker snapshot on (re)connect so a
     closed-popup operation that already settled does not restore a stale
     curtain; drop the scheduleStaleInspectionBusyClear polling hack in favor of
     authoritative state.
   - Ensure navInspect/device-emulation keys are removed on terminal lifecycle
     phase (FINISHED/FAILED) regardless of which path settles the op.
   - Fix setSpinnerMessage to repaint whenever the keyed entry drives the
     current message, not only when it is top-of-queue.
   - Validate: tests/device-emulation-lifecycle.test.js,
     tests/lifecycle-broker.test.js, tests/popup-marking-refresh.test.js.
3. Validate and commit/push Phase B.
4. Phase C (Cluster 2):
   - Eliminate the hide->reveal blink: only repaint changed rects in place and
     keep the overlay visible across reposition; reserve hide/reveal for genuine
     full rebuilds (renderKey change), not for settle/reposition resamples.
   - Tighten immediate marking feedback (#6) and preview list/visible-target
     alignment (#16).
   - Validate: tests/silent-highlight-annotations.test.js,
     tests/content-main*.test.js, tests/popup-render-mode.test.js.
5. Validate and commit/push Phase C.

## Immediate Commands

- git status --short
- rg -n "spinner|runWithSpinner|ufLifecycleEvent|ufSpinner|navInspect|getInspectionStatus" popup.js background.js content-main.js common
- rg -n "highlight|silent|refreshSilent|preview|visibility|xpath|scroll" content-main.js content popup.js common
- npm test -- tests/popup-marking-refresh.test.js tests/device-emulation-lifecycle.test.js tests/content-activation-order.test.js

## Known Constraints

- Do not weaken the locked marking contract.
- Keep fix scope minimal and deterministic.
- Prefer robust state reconciliation over timing-based hacks.
