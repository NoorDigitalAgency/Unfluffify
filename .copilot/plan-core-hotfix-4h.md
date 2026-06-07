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

## Execution protocol (read before touching code)

This sprint is being continued by a cost-constrained agent. Follow this
mechanically; do not improvise scope.

STEP 0 - capability gate. Confirm you actually have the live-debug capabilities
listed in `.copilot/handoff-core-hotfix.md` -> "REQUIRED CAPABILITIES" (headed
Chrome on :9222, the owner's authenticated property, the `~/.uf-blink-harness/`
scripts, owner available for side-effectful steps). If ANY is missing, you may
ONLY do: doc/analysis edits, root-cause narrowing recorded as UNVERIFIED, or a
pure-logic change covered by a new `node --test` unit test. You may NOT mark any
runtime/visual issue FIXED. Stop and hand back if the assigned issue needs the
browser and you don't have it.

STEP 1 - one issue at a time, in the priority order below. Do NOT batch issues.
Re-read that issue's full entry in the handoff "Issue status" section first.

STEP 2 - reproduce FIRST. Capture the before timeline/state. If you cannot
reproduce, do not change code - record why and stop. (Several OPEN issues here
have never been cleanly reproduced even by the planning model; reproduction is
the real work, not an afterthought.)
Render-mode precondition: if you need to enter render-mode flow on a property
that is not yet saved on the backend, clear that property's IndexedDB entries
first (extension origin `unfluffify` DB, `kv/configs` data), otherwise stale
local config can bypass/hide render-mode and invalidate the repro.

STEP 3 - find the divergence. The recurring bug shape is a DIVERGENCE between
the three layers: popup-local view state (popup.js / popup/ui.js), the
background broker (background.js lifecycle/spinnerQueue), and content status
(content-main.js getInspectionStatus). Read all three before forming a fix.

STEP 4 - smallest reconciliation-based fix. Prefer reconciling against
authoritative state over fixed-time give-ups (issue #2 was exactly a premature
give-up; do not reintroduce that pattern). Touch only the file(s) the diagnosis
points to. No net-new features, no refactors, no drive-by changes.

STEP 5 - verify. Live-verify with the before/after timeline if you have the
browser; otherwise add/keep a deterministic `node --test` that fails before and
passes after. Run `npm test` and confirm green. Never close an issue on source
reasoning alone.

STEP 6 - record + commit. Update this plan's "Verified-fix log" and the handoff
"Issue status" for that one issue (mark VERIFIED or UNVERIFIED honestly), then
commit per the convention below. One issue per commit.

HARD STOP CONDITIONS - stop and hand back rather than guess if: the repro needs
a render-mode "Set" or any other write to live property data and the owner has
not OK'd it; the fix would weaken the locked marking contract; the diagnosis is
ambiguous across layers; or "verify live" is required and unavailable.

## Next single task (decision tree for the implementing agent)

SESSION 3 root-cause lead is complete and superseded by live fix data:
- `activateContentMain` was not the blocker in the verified repro path
      (`alreadyLoaded` after reload).
- #3 was fixed by preserving enabled state on same-base top-level navigation,
      allowing navInspect spinner flow to run and settle after reload.

Next single task: #R1 reveal/freeze runs incompletely (no spinner / no scroll) -
owner-reported after c66782a. TRIAGE FIRST (reproduce + pin the early-return);
source analysis says the B1.1 revert is an unlikely cause. Then #16 preview list
visibility and #17 AI-exit cannot save.

## Difficulty / effort rating (tuned for Copilot Local "Auto")

Copilot Local's "Auto" model selector reads the task PROMPT to pick a model, but
it cannot see these markdown labels and does not infer "this needs a smart
model" from a doc. So each task below carries an explicit difficulty/effort tag
that you USE in two ways:

  1. As the human dispatching the task: paste the task's difficulty cue into the
     chat prompt so Auto has the signal (e.g. start hard tasks with
     "This is a hard, multi-layer runtime debugging task that needs deep
     reasoning:"). Auto routes on prompt wording, so say it out loud.
  2. As the working agent: treat the tag as a budget/depth contract - spend
     proportional reasoning, and HAND BACK (don't guess) if a task tagged HARD
     lands on you while you're clearly a small/fast model with no live-debug
     capability.

Scale (difficulty = inherent problem hardness; effort = reasoning depth to ask
for; live? = needs the browser/owner per the capability gate):

  - TRIVIAL  : single-file, mechanical, unit-testable. Effort: low. Any model.
  - EASY     : bounded logic, one layer, clear repro or pure unit test.
               Effort: low-medium.
  - MEDIUM   : spans 2 layers or needs a careful reconcile; deterministic test
               possible. Effort: medium.
  - HARD     : open-ended live diagnosis across popup/broker/content, no clean
               repro yet, or root-cause hunting. Effort: high. Needs a strong
               model AND live capability.

Per-task ratings (OPEN issues only; FIXED ones need no rating):

| Task | Difficulty | Effort | Live? | Note |
|------|-----------|--------|-------|------|
| #R1 reveal/freeze runs incompletely (no spinner / no scroll) | HARD | high | yes | Owner-reported regression after c66782a. Triage first: reproduce, log whether runRenderModeRevealOnce fires + revealPageContentBeforeMotionPause enters scroll loop. B1.1 revert is an UNLIKELY cause (did not touch reveal/freeze path). |
| ROOT-CAUSE LEAD: content not re-activated after render-mode/debugger reload (handoff SESSION 3) | HARD | high | yes | Completed investigation; not the blocker for #3 in latest live run. |
| #3  navInspect spinner absent after refresh/navigation | HARD | high | yes | FIXED+verified live; same-base navigation now preserves marking and spinner flow. |
| B1.1 re-evaluation (premature navInspect clear) | MEDIUM | medium | yes | DONE: reverted superseded-terminal clear behavior; live-verified with supersede check + session3 flow. |
| #16 preview list rows not visible/highlightable (VERY HIGH) | HARD | high | yes | Needs AI preview list populated; reconcile vs collectSilentHighlightRenderTargets. |
| #17 AI-exit lands in silent mode, cannot save (VERY HIGH) | HARD | high | yes | State-transition bug across modes. |
| #18 temp changes not discarded on enable after silent landing | MEDIUM | medium | yes | Tied to #17/#15. |
| #15 saved data used on enable -> wrong dirty/discard state | MEDIUM | medium | yes | |
| #19 "Preview in desktop mode" shown after silent landing | EASY | low-medium | yes | Conditional-UI; overlaps #14. |
| #14 "Preview in desktop mode" visibility/enable/note rules | EASY | low-medium | partial | Mostly view-flag logic; can unit-test the gating. |
| #10 lock countdown resets to 30 and loops | MEDIUM | medium | yes | Cluster 4 timer/state loop. |
| #11 refresh during countdown -> read-only config, back disabled | MEDIUM | medium | yes | |
| #12 render-mode options reset while countdown banner shows | MEDIUM | medium | yes | |
| #7  discard-confirm delayed on uncheck | EASY | low-medium | yes | |
| #8  discard-confirm delayed on navigation | EASY | low-medium | yes | |
| #9  fast repeated debugger disable not detected | MEDIUM | medium | yes | Timing/race detection. |
| #13 "With JavaScript" runs reveal/freeze on fresh non-candidate page | HARD | high | yes | Linked to root-cause lead. |
| #6  marking applies after a few seconds (scheduleRender delay) | TRIVIAL | low | perceptual | candidate: delay 50ms->0 for user-driven renders; verify perceptually. |
| #20 trace enabled in sync but checkbox off / no logs | EASY | low-medium | partial | Reconcile checkbox + per-tab trace round-trip; unit-testable in part. |
| #4  spinner text out of sync (LOW) | EASY | low | yes | Cosmetic; revisit after #3. |

If you are on Auto and the task is HARD, prompt Auto explicitly toward its
strongest reasoning model and confirm live capability before starting; if it is
TRIVIAL/EASY, a fast model is the credit-efficient choice.

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
      STATUS: FIXED + live-verified. Root cause: background disabled marking on
      every top-level navigation commit, including same-base reloads, so
      navInspect never had enabled state to run against. Fix preserves enabled
      marking for same-base navigations/reloads and only disables outside baseUrl.
      Live verification: nav spinner appears (`push:show` + set-message) and
      settles (`nav-complete-settle`, `nav-overlay-end`) after reload; content
      remains in marking mode post-reload.
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
      STATUS: OPEN - partially observed live (drive-seo4.mjs): clicking "With
      JavaScript" on a fresh seo.se property RELOADS the page (reveal/freeze runs)
      = the "shouldn't happen here" part confirmed. Note: the page reload after
      Set (Static) is GENUINE/expected (JS must be enabled before exiting the
      render-mode detection view) - not a bug. See handoff SESSION 3.
      LIKELY LINKED ROOT (with #3 + marking-not-enabling): after a
      reveal/freeze/debugger reload, content-main is not re-activated
      (getInspectionStatus undefined, lc[none]); investigate background
      re-activation of content after render-mode/debugger reloads.
- #14 "Preview in desktop mode" is sometimes shown on every view and always
      enabled; it should be visible only on the silent-mode view, enabled only
      when CSS selectors are already saved, and when visible-but-disabled it must
      show an explanatory note. STATUS: OPEN.

Regressions reported during this sprint:
- #R1 Reveal/freeze phase runs incompletely: the freeze ICONS show, but there is
      NO spinner and NO scroll-to-bottom-then-back-up during reveal/freeze.
      STATUS: OPEN (UNCONFIRMED cause; reported 2026-06-07 after the B1.1 revert
      c66782a). Source analysis: c66782a only relocated navInspect curtain
      teardown in updateLifecycleState (background.js) and did NOT touch the
      reveal/freeze path - revealPageContentBeforeMotionPause /
      scrollPageInspectionTo (content/core.js), warmupSilentHighlighting...
      (content/core.js), runRenderModeRevealOnce (content-main.js), or
      pageMotionFreezeControl (common/page-motion-freeze-control.js). So the
      revert is an unlikely cause. Triage live before editing: confirm whether
      runRenderModeRevealOnce fires, whether the scroll loop runs (window.scrollTo),
      whether REVEAL_STARTED/REVEAL_FINISHED lifecycle events emit, and whether the
      popup navInspect spinner is pushed; check for an early isStillCurrent() /
      visibilityState / scrollHeight<=viewport return. Bisect c66782a vs 76cae0f
      if the live repro implicates a recent commit. See handoff "#R1" for the full
      repro plan and candidate causes.

## Priority order for remaining work

1. #R1 reveal/freeze incomplete (TRIAGE FIRST - owner-reported regression;
   reproduce + pin the early-return; B1.1 revert is an unlikely cause).
2. #16 preview list visibility (VERY HIGH) and #17 AI-exit cannot save (VERY HIGH).
3. #20, #4 (finish Cluster 1), then Clusters 3-6 (#15, #18, #19; #10-#12;
   #7-#9; #13, #14), #6.

## Verified-fix log (all live-verified)

- #1  silent blink: 62ea6a3, 8747835 (run.mjs: 6->0 hide/reveal cycles in 8s).
- #2  stuck inspection curtain (uiBusy): 8eba026 (drive2.mjs: clears when content
      settles; reconciler no longer gives up early, fails open).
- #5  "Applying device emulation..." stuck after enable: d97124c (drive3.mjs:
      dedicated deviceEmulationApplying flag instead of deviceControlsDisabled).
      Safety nets: 50baf18 (60s spinner watchdog + 12s device-emul timeout).
- #3  nav spinner absent after refresh/navigation: live-verified in
      session3-root-cause.mjs after preserving enabled state on same-base
      top-level navigation (background.js) and preventing transient popup
      down-reconcile during lock-claim/pending windows (popup.js).
- B1.1 re-evaluation: reverted superseded-terminal navInspect clear behavior in
      `updateLifecycleState` (background.js); live-verified with synthetic
      supersede check (`supersededTerminalKeepsNav:true`,
      `currentTerminalClearsNav:true`) and full `session3-root-cause.mjs` flow.

## Commit convention
- hotfix(core): <concise description> (live-verified)
