# Core Hotfix Sprint Plan

Date: 2026-06-07
Branch: main

## Objective

Stabilize core spinner/curtain and silent-highlight behavior reported in the
20-issue bug report. Fix and VERIFY each issue against the real loaded
extension - source reasoning and source-snapshot tests are NOT sufficient for
runtime/visual bugs.

## How to work (mandatory)

Use the live debugging methodology documented in
`.copilot/handoff-core-hotfix.md` ("Live debugging methodology"). In short:
launch the extension headed via Playwright with `--remote-debugging-port=9222`
and a persistent profile, connect over CDP, open an instrumented
`popup.html?debugTabId=<tabId>` page (the Chrome side panel is NOT instrumentable
over CDP), drive it with `popup.click(...)`, and poll a timeline of the popup
`#ui-curtain` + `window.__ufSpinnerDebug()` + broker `getUfBackgroundState` +
content `getInspectionStatus`. Reload code changes with `chrome.runtime.reload()`
via the service worker and re-run the driver. Harness scripts live in
`~/.uf-blink-harness/` (reference copies in `.scratch-blink-test/`).

Key principle proven by this sprint: the bug is usually a DIVERGENCE between
layers (popup-local view state vs background broker vs content status). Always
read all three.

## Rules

1. Fix P0/P1 regressions only; no net-new features.
2. Keep changes minimal, deterministic, and reconciliation-based (avoid
   fixed-time give-ups - issue #2 was exactly a premature give-up).
3. Verify every fix LIVE, capture the before/after timeline, THEN record it.
4. Update this plan and the handoff after every fix. Commit and push per fix.
5. Do not weaken the locked marking contract.

## Issue clusters and status

See `.copilot/handoff-core-hotfix.md` "Issue status" for the authoritative,
per-issue state. ALL 20 reported issues, verbatim intent + status:

Cluster 1 - operation lifecycle / spinner (messaging layers):
- #1  Silent-mode highlighting flashes/blinks every ~1.5s.
      STATUS: FIXED + live-verified (run.mjs 6->0). Commits 62ea6a3, 8747835.
- #2  Spinner on popup gets stuck AFTER the reveal/freeze run (the run itself
      works). "make sure of all messaging layers and events."
      STATUS: FIXED + live-verified. Owner confirms stuck issue solved. The
      "Inspecting page..." curtain is a uiBusy flag; the reconciler now polls
      content until not-pending + fails open. Commit 8eba026.
- #3  Refreshing the page makes the spinner disappear, but it then does NOT
      appear anymore for ANY events; the reveal/freeze run itself works. Owner
      refinement: the reveal/freeze SPINNER DOES NOT APPEAR after
      refresh/navigation. "make sure of all messaging layers and events."
      STATUS: OPEN - NEXT. Likely related to #2/#5 (curtain/messaging layers).
      Hypothesis (to verify live): after a page reload/navigation the broker
      lifecycle resets to none (observed: lc[none]) and the popup's broker port /
      tabs.onUpdated subscription / navInspect-raising path
      (beginNavigationInspectionOverlay, gated on tabState.enabled + inScope) is
      not re-established or no longer fires, so subsequent reveal/freeze events
      never raise the spinner. REPRO PLAN: launch-live + instrumented
      popup.html?debugTabId, settle, then reload the candidate page (or
      sw.evaluate chrome.tabs.reload), and poll broker lifecycle + popup curtain
      + whether beginNavigationInspectionOverlay logs fire on the reload. Then
      trigger a reveal/freeze and confirm the spinner appears.
- #4  Spinner text for different events not in sync (LOW priority).
      STATUS: OPEN (low). setSpinnerMessage repaints only the top-of-queue entry;
      revisit once #3 lands.
- #5  Marking-enable spinner "Applying device emulation..." never disappears
      (reveal/freeze correctly does NOT run on enable). "messaging layers."
      STATUS: FIXED + live-verified (drive3.mjs). Real cause: getBlockingUiCurtainState
      raised the blocking curtain from view.deviceControlsDisabled, which popup.js
      forces true for the whole marking session (|| isEnabled). Now driven by a
      dedicated operation-scoped flag deviceEmulationApplying. Commit d97124c.
      Safety nets also added: 60s spinner watchdog + 12s device-emul timeout
      (commit 50baf18).
- #20 "Trace cross-world messaging" enabled in sync storage but the checkbox is
      unchecked and no logs are collected/shown.
      STATUS: OPEN. Observed live: getUfBackgroundState traceEnabled=false despite
      chrome.storage.sync.globalTraceModeEnabled=true; the popup disables it on
      init. Reconcile the checkbox + the per-tab trace-enable round-trip.

Cluster 2 - silent highlight / preview:
- #6  Markings responsive (UI not frozen) but the new state applies only after a
      few seconds; the click feels unregistered.
      STATUS: OPEN. core.scheduleRender default delay=50ms on user actions;
      candidate fix delay:0 for user-driven renders (verify perceptually).
- #16 Preview list shows content not visible on the page, so clicking a row can't
      scroll-to/highlight it. "marking, visibility, xpath, highlighting and
      content detection must always be correct, solid, robust." (VERY HIGH)
      STATUS: OPEN. Reconcile preview-list eligibility against
      collectSilentHighlightRenderTargets / renderable collections so every row
      maps to a visible, highlightable target. Needs the AI preview list
      populated to repro.

Cluster 3 - mode transitions / temporary state reset:
- #15 A page with previously saved data uses the OLD data on enabling marking,
      making buttons act wrong (e.g. Discard enabled on an un-dirty page).
      STATUS: OPEN.
- #17 After Run AI... -> content list popup -> on exit you land in silent-mode
      and CANNOT save the results. (VERY HIGH)
      STATUS: OPEN.
- #18 After landing in silent-mode from the AI content popup, enabling marking
      leaves only Run AI... + Discard enabled - i.e. temporary changes that
      should be wiped on enable (replaced by defaults + CSS selectors) are NOT
      discarded.
      STATUS: OPEN.
- #19 Re-entering marking after that silent landing shows "Preview in desktop
      mode" (should be silent-mode-only). STATUS: OPEN (see #14).

Cluster 4 - property-lock countdown / lock-loss loop:
- #10 "You left the previous property. Return within XXs..." resets to 30 after
      reaching 0 and keeps showing. STATUS: OPEN.
- #11 Refreshing the extension after the countdown is over (to escape the loop)
      lands on the configuration view with inputs read-only, back button
      disabled, and the countdown banner still looping. STATUS: OPEN.
- #12 Render-mode view options keep resetting while the "return within XXs"
      banner shows, so settings cannot be changed. STATUS: OPEN.

Cluster 5 - confirmations / debugger:
- #7  "Disable marking and discard... This cannot be undone." appears with a long
      delay on unchecking the marking checkbox. STATUS: OPEN.
- #8  Same confirmation appears with a long delay on a navigation attempt.
      STATUS: OPEN.
- #9  Disabling the Chrome debugger fast and repeatedly is not detected.
      STATUS: OPEN.

Cluster 6 - render mode / conditional UI:
- #13 "With JavaScript" runs the reveal/freeze on a fresh site with no prior
      render-mode save (likely because the page is not yet a candidate page), so
      it does NOT run on landing AND does not run when render mode is set+ready.
      STATUS: OPEN.
- #14 "Preview in desktop mode" is sometimes shown on every view and always
      enabled; it should be visible only on the silent-mode view, enabled only
      when CSS selectors are already saved, and when visible-but-disabled it must
      show an explanatory note. STATUS: OPEN.

## Priority order for remaining work

1. #3 reveal/freeze spinner does not appear after refresh/navigation (Cluster 1,
   completes the messaging layer; owner-flagged as next and possibly related to
   #2/#5).
2. Re-evaluate B1.1 background change (premature navInspect clear risk) - see
   handoff CORRECTION.
3. #16 preview list visibility (VERY HIGH) and #17 AI-exit cannot save (VERY HIGH).
4. #20, #4 (finish Cluster 1), then Clusters 3-6 (#15, #18, #19; #10-#12;
   #7-#9; #13, #14), #6.

## Verified-fix log (all live-verified)

- #1  silent blink: 62ea6a3, 8747835 (run.mjs: 6->0 hide/reveal cycles in 8s).
- #2  stuck inspection curtain (uiBusy): 8eba026 (drive2.mjs: clears when content
      settles; reconciler no longer gives up early, fails open).
- #5  "Applying device emulation..." stuck after enable: d97124c (drive3.mjs:
      dedicated deviceEmulationApplying flag instead of deviceControlsDisabled).
      Safety nets: 50baf18 (60s spinner watchdog + 12s device-emul timeout).

## Commit convention
- hotfix(core): <concise description> (live-verified)
