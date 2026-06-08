# Handoff - Core Hotfix Sprint

Last updated: 2026-06-08
Branch: main
Scope: stabilize core user-facing spinner/curtain + silent-highlight behavior.

This handoff is written so that you OR a fresh agent can reproduce, diagnose,
fix, and VERIFY each issue independently using a real loaded extension. Read the
"Live debugging methodology" section first - it is the single most important
part. Do NOT declare a runtime/visual fix done from source reasoning or
source-snapshot tests alone; verify it live.

--------------------------------------------------------------------------------
## REQUIRED CAPABILITIES - read this before you accept any OPEN issue

Every OPEN issue in this sprint (#6-#20, #13, #14, the content-reactivation
root-cause lead) is a RUNTIME/VISUAL bug. The rules below say each fix MUST be
verified live. That live loop needs ALL of the following, and they are NOT
present in a headless cloud / CI sandbox:

  1. A headed (non-headless) Chrome you can launch with the unpacked extension
     and `--remote-debugging-port=9222`, plus a persistent profile.
  2. The owner's real login + property config (seo.se / bonliva.se etc.). Several
     repros (marking-enable, navInspect spinner, property lock) cannot be reached
     without a real authenticated property.
  3. The out-of-repo Playwright harness at `~/.uf-blink-harness/` (and the owner
     available to perform side-effectful steps such as "Set render mode", which
     writes to live property data and must NOT be done unprompted).

If you are running WITHOUT these (e.g. a Copilot cloud agent on the default
runner), you CANNOT complete any OPEN issue to this sprint's bar. Do NOT fake it
with source-only reasoning and do NOT mark anything FIXED. Your allowed scope in
that case is strictly:
  - Documentation/analysis edits (this file + the plan).
  - Source-level investigation that NARROWS a root cause and writes the finding
    + exact file/function/line into the handoff, explicitly labelled UNVERIFIED.
  - Pure-logic changes that already have, or you add, a deterministic
    `node --test` unit test that fails before and passes after (no browser).
Anything that can only be confirmed in the browser must be left OPEN with a
written repro plan, not closed.

--------------------------------------------------------------------------------
## Live debugging methodology (USE THIS - it is how every real bug here was found)

The repo's `playwright-local` MCP is hardcoded to LINUX paths (`/home/rojan/...`)
and cannot launch on this Mac, so its tools never connect. Drive Playwright
directly instead. A runnable harness lives OUTSIDE the repo at
`~/.uf-blink-harness/` (has its own node_modules; install with
`PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright npm i playwright@1.60.0`).
Gitignored REFERENCE copies are in `.scratch-blink-test/` (no node_modules).
Logs are written to `~/.uf-live/`.

Core loop:

1. LAUNCH (headed, persistent profile, remote debugging) - `launch-live.mjs`:
   `chromium.launchPersistentContext("~/.uf-live-profile", { headless:false,
     args:["--disable-extensions-except=<REPO>","--load-extension=<REPO>",
           "--no-sandbox","--remote-debugging-port=9222"] })`.
   The persistent profile keeps the user's config/endpoints/token/login across
   runs. Keep the process alive (`await new Promise(()=>{})`).

2. CONNECT for inspection/driving from separate short scripts:
   `chromium.connectOverCDP("http://localhost:9222")` ->
   `browser.contexts()[0]`. The service worker is `ctx.serviceWorkers()[0]`;
   `extId = new URL(sw.url()).host`.

3. Find the candidate tab id via the SW:
   `sw.evaluate(async () => (await chrome.tabs.query({})).find(t=>t.url?.startsWith("http"))?.id)`.

4. Open an INSTRUMENTED popup bound to that tab as a NORMAL Playwright page:
   `ctx.newPage()` then `goto("chrome-extension://<extId>/popup.html?debugTabId=<tabId>")`.
   popup/messages.js loadActiveTab reads `debugTabId` from the query string, so
   the popup binds to the real candidate tab and behaves like the side panel.
   CRITICAL: the real Chrome SIDE PANEL is NOT instrumentable over connectOverCDP
   (no `page`/`console` events, addInitScript/exposeBinding do not apply). Always
   use `popup.html?debugTabId=` in a controllable tab for instrumentation.

5. INSTRUMENT:
   - `page.addInitScript(() => localStorage.setItem("ufDebugSpinnerQueue","1"))`
     makes the popup emit `[popup-spinner]` push/pop/show/hide logs (read per call
     from localStorage, so it also works if set after load).
   - Capture `page.on("console", ...)` and filter for
     /popup-spinner|world-trace|nav|spinner|curtain|busy|reveal|freeze|device/.
   - For popup-LOCAL state that is not otherwise observable, temporarily add a
     read-only debug hook to popup.js exposing `window.__ufSpinnerDebug()` ->
     { localQueue, popupSpinnerVisible, getViewState().isBusy (uiBusy), navInspect
     flags, popupStaleInspectionBusyClearTimer }. REMOVE it before committing.

6. READ BOTH layers - they diverge, and the divergence IS the bug:
   - Popup-local: `window.__ufSpinnerDebug()` + `#ui-curtain` DOM
     (`document.getElementById("ui-curtain")`, visible via
     offsetWidth||offsetHeight||getClientRects().length, title from
     `.ui-curtain__title`).
   - Broker (background authority): from the popup page,
     `chrome.runtime.sendMessage({type:"getUfBackgroundState", tabId})` ->
     { spinnerQueue, lifecycle{kind,phase,busy}, traceEnabled, traceEvents }.
   - Content: `chrome.tabs.sendMessage(tabId,{type:"getInspectionStatus"})` ->
     { active, pending, pendingReason, markingEnabled, mode }.

7. DRIVE the flow: `popup.click("#toggle-enabled")` (enable marking), click
   render-mode / "With JavaScript", etc. Poll a timeline every ~200ms and log
   only on change (see `drive2.mjs`).

8. APPLY a code change, then RELOAD the extension from disk WITHOUT relaunching:
   `sw.evaluate(() => chrome.runtime.reload())` (`reload-ext.mjs`). Re-run the
   driver and compare the timeline before/after.

Harness file inventory (in ~/.uf-blink-harness/, reference copies in .scratch-blink-test/):
- launch-live.mjs  : launch headed browser + enable world trace + console log.
- reload-ext.mjs   : chrome.runtime.reload() via the SW (pick up disk changes).
- drive2.mjs       : open instrumented popup, click Enable Marking, timeline of
                     curtain + __ufSpinnerDebug + broker (THE main repro driver).
- inspect2.mjs     : one-shot read of #ui-curtain + broker spinnerQueue/lifecycle/trace.
- inspect3.mjs     : push+remove navInspect in broker to test popup reconciliation.
- probe-insp.mjs   : read content getInspectionStatus for the candidate tab.
- run.mjs          : silent-highlight blink counter (overlay uf-silent-hidden toggles).
- verify-b1.mjs    : background curtain-teardown gate (synthetic - see caveat below).
- verify-curtain.mjs: real popup #ui-curtain show/hide via broker (synthetic - caveat).

Other gotchas learned:
- `normalizeBaseUrl` strips ports -> a localhost:PORT page can never match a
  stored base URL; use a default-port host (route-intercepted) for synthetic pages.
- content-main.js only loads after the background sends `activateContentMain`;
  it does not auto-run. Drive it via `chrome.tabs.sendMessage(tabId,
  {type:"activateContentMain"})` or by opening the popup which activates it.
- Config lives in EXTENSION-ORIGIN IndexedDB `unfluffify`/store `kv`/key `configs`;
  seed it in the SW directly (`import()` is disallowed in service workers).
- If you need to reach render-mode flow on a property that is not yet saved on
  the backend, clear that property's IndexedDB entries first; stale local config
  can bypass/hide the render-mode path and confound repro.
- World trace: set `chrome.storage.sync.globalTraceModeEnabled=true`, but the
  popup may re-disable it (issue #20) - force it per tab with a
  `{type:"ufTraceSet", tabId, enabled:true}` runtime message if needed.

--------------------------------------------------------------------------------
## Verified fixes (live-confirmed)

V1. Silent-highlight blink (#1) - FIXED, verified with run.mjs (6 hide/reveal
    cycles in 8s BEFORE -> 0 after). Two parts:
    - content-main.js renderSilentHighlightOverlay/repositionSilentHighlightOverlay
      gained a keepVisible flag; settle/layout-shift/mutation repositions update
      rects in place instead of hide->reveal.
    - applyOverlayUpdate keeps an already-live overlay visible on full refresh.
    Commits: 62ea6a3, 8747835.

V2. Stuck "Inspecting page..." curtain on marking-enable (#2 / #5) - FIXED,
    verified live with drive2.mjs (curtain VIS ~20s -> HIDDEN ~30s when content
    settles, instead of sticking forever).
    ROOT CAUSE (popup-side, NOT background): the "Inspecting page..." curtain
    after Enable Marking is a uiBusy flag set by refreshUi when
    getInspectionStatus reports pending (editor reveal/freeze warmup). It is NOT
    a spinner-queue entry, so the broker spinnerQueue is empty.
    scheduleStaleInspectionBusyClear (popup.js) polled to clear it but gave up
    after 12 attempts (~5s) while content was still pending, and nothing
    re-triggered the clear once content settled (~9s) -> permanently blocked UI.
    FIX (popup.js scheduleStaleInspectionBusyClear): reconcile against the
    authoritative content status until actually not-pending (cap 12 -> 75 as a
    safety net only) and fail-open on exhaustion so a blocking curtain can never
    persist. Commit: 8eba026.

V3. Comprehensive spinner stuck-prevention (#5 "Applying device emulation..."
    never disappears, + ALL queued-spinner hangs) - FIXED, verified live.
    There are TWO curtain systems: (A) the spinner queue (popupSpinnerQueue,
    cleared by popSpinner) and (B) the uiBusy flag (V2). "Applying device
    emulation..." is system A: a runWithSpinner UUID spinner. runWithSpinner pops
    in its finally, but if the awaited op never settles (e.g. the background
    mobile-emulation debugger attach hangs, a tab reload never completes), the
    finally never runs and the spinner sticks forever. There are 11
    runWithSpinner sites + manual pushSpinner sites (navInspect, clear-cache,
    unregister) all with the same exposure.
    FIX (two layers):
    - WATCHDOG (covers ALL queued spinners): pushSpinner/setSpinnerMessage arm a
      per-key fail-open timer (popup.js SPINNER_WATCHDOG_MS=60s), reset on each
      message change (progress), cleared by popSpinner. On fire it force-pops the
      key so no spinner can stay up indefinitely. Verified live: a never-popped
      spinner is force-cleared (test with watchdog temporarily at 5s -> curtain
      VIS:STUCK TEST -> hidden after 5s).
    - TARGETED TIMEOUT (device emulation, the reported case): helpers.js
      updateDeviceEmulation races the background updateDeviceEmulation message
      against a 12s timeout, falling through to the existing reconcile+toast
      failure path so the enable flow reverts gracefully instead of hanging.
    Normal enable flow still clears correctly (verified live, drive2.mjs).
    Commit: 50baf18.

V4. "Applying device emulation..." curtain stuck AFTER marking enables (#5, the
    REAL root cause) - FIXED, verified live (drive3.mjs).
    Found only by driving the EXACT sequence: wait for the initial reveal/freeze
    curtain to settle, THEN click Enable Marking. The curtain then stuck on
    "Applying device emulation..." forever. Live state showed
    `#ui-curtain` VISIBLE but popupSpinnerQueue empty, popupSpinnerVisible false,
    AND viewState.isBusy false - i.e. the curtain was NOT a spinner and NOT
    uiBusy. getBlockingUiCurtainState (popup/ui.js) raises the blocking curtain
    for SEVERAL view flags, including `view.deviceControlsDisabled`, whose
    message is "Applying device emulation...". But popup.js sets
    `deviceControlsDisabled = state.deviceControlsDisabled || isEnabled` - so once
    marking is ENABLED (isEnabled true) deviceControlsDisabled is forced true for
    the whole session, and the curtain shows forever. (That is why it only stuck
    when enable SUCCEEDED, after the initial settle - earlier races reverted
    enable so isEnabled stayed false.)
    FIX: introduced a dedicated operation-scoped viewState flag
    `deviceEmulationApplying` (popup/ui.js default + getBlockingUiCurtainState now
    checks it instead of deviceControlsDisabled). helpers.updateDeviceEmulation
    sets it true around the operation and false in a finally. deviceControlsDisabled
    keeps its job of greying the device toggle during marking, but no longer
    raises a blocking curtain. Verified live: Enable Marking -> brief "Applying
    device emulation..." during the op -> "Inspecting page..." -> curtain CLEARS
    (~13-19s), final hidden, across repeated runs. Commit: (this change).
    NOTE: V3 watchdog + device-emul timeout remain as safety nets but did not fix
    this - the curtain here was a view-flag curtain, not a queued spinner.

--------------------------------------------------------------------------------
## CORRECTION / caveat on the earlier background "curtain" work

Commits f7b4d82 (B1) and 33da9b1 (B1.1) added background-side navInspect teardown
in updateLifecycleState (clear navInspect on a terminal curtain-bearing lifecycle;
B1.1 made it run independently of the supersede guard). These were based on a
SYNTHETIC repro (verify-curtain.mjs pokes the broker directly). LIVE debugging
later showed the user's actual stuck curtain is the popup-side reconciler issue
above, where navInspect is NOT even in the broker. So B1/B1.1 do not address the
real bug.

RISK (confirmed): B1.1 (clear navInspect even when the lifecycle is superseded)
can clear a legitimate navInspect curtain mid-operation.
SESSION 5 RESULT (2026-06-07): B1.1 was reverted. `updateLifecycleState` now
ignores superseded terminal lifecycle events and only clears navInspect for the
current operation's terminal curtain-bearing lifecycle. Live verification:
- synthetic supersede check keeps navInspect for stale terminal event and clears
  for current terminal event,
- full `session3-root-cause.mjs` run still shows nav spinner
  push/set-message -> `nav-complete-settle` -> `nav-overlay-end` after reload,
  with post-reload `markingEnabled:true`.
Keep V2 (popup reconciler fix) unchanged.

--------------------------------------------------------------------------------
## Issue status (full original 20-issue report)

Cluster 1 - operation lifecycle / spinner (messaging layers):
- #1  silent blink ........................ FIXED+verified (V1)
- #2  spinner stuck after reveal/freeze ... FIXED+verified (V2); owner confirms
       the spinner-stuck issue is solved.
- #3  refresh/navigation -> reveal/freeze SPINNER DOES NOT APPEAR for any later
  events (the run itself works) ....... FIXED+verified (V5).
  ROOT CAUSE: background.js disabled marking on EVERY top-level committed
  navigation (`chrome.webNavigation.onCommitted` ->
  disableExtensionOnTopLevelNavigation), including same-base reloads. That
  cleared enabled state before popup navInspect reconciliation could run,
  so no navigation spinner appeared and mode dropped back to silent.
  FIX: preserve enabled state for same-base navigations/reloads and only
  disable when navigating outside baseUrl.
  LIVE VERIFICATION (session3-root-cause.mjs): after enable, reloading the
  same-base seo.se page now shows `[popup-spinner] push:show` and
  nav-overlay set-message events, then `nav-complete-settle` +
  `nav-overlay-end`; post-reload inspection status remains
  `markingEnabled:true`.
- #4  spinner text out of sync (low) ...... OPEN (low)
- #5  "Applying device emulation..." stuck . FIXED+verified (V4: dedicated
       deviceEmulationApplying flag; root cause was deviceControlsDisabled
       raising the curtain for the whole marking session). V3 watchdog + 12s
       device-emul timeout added as safety nets. Owner confirms solved.
- #20 trace enabled in sync but checkbox off/no logs . OPEN (observed live:
       getUfBackgroundState traceEnabled=false despite sync flag; popup disables it)

Cluster 2 - silent highlight / preview:
- #6  marking apply delayed a few seconds .. FIXED + live-verified (2026-06-08).
       Root cause: user-toggle drain used `deferMarkingRefresh:true` -> async
       overlay reconcile (`refreshExplicitMarkingOverlayAsync`) which took
       ~2020ms on seo.se, so the explicit layer only drew ~+2232ms (after the
       180ms ack faded). Fix: drain passes `immediateFullRender:true`;
       `completeExplicitToggle` async branch gated by `&& !immediateFullRender`
       so user clicks draw via the SYNC `scheduleExplicitOverlayRefresh` (~85ms);
       `getExplicitMarkingFullRenderOptions().delay` 40->0. Live result: visible
       mark +2232ms->+387ms, render.total +2351ms->+554ms (toggle-perf probe
       `toggle-latency-seo.mjs`). Unit: tests/core-scheduling.test.js (28 pass).
- #16 preview list rows not visible/scrollable (VERY HIGH) . FIXED +
  live-verified (2026-06-08). Root cause: preview rows were derived from
  visibility-agnostic inclusion matches, so row xpaths could reference
  non-renderable ancestors. Fix: `content-main.js` remaps preview rows to
  renderable targets via `collectSilentHighlightRenderTargets` and
  `hasRenderableClientBox` before storing preview item sets used by the
  sidebar/focus handlers. Live verification probe
  (`preview-row-visibility-forced-selectors.mjs`): preview opened, 133
  rows, 0 non-renderable rows.

Cluster 3 - mode transitions / temporary state reset:
- #15 saved data used on enable -> dirty/discard wrong .... PATCHED (live
  verification blocked in current harness environment).
  Code changes (2026-06-08): popup now tracks `currentPageHasPendingChanges`
  separately from session-wide pending state. Revert gating and page-save UI
  discard state now use current-page pending (`buildPageSaveUiState`
  `pageHasPendingChanges` + `handlePageRevert` guard), preventing stale
  session-level dirtiness from keeping Discard enabled on a clean current page.
  Deterministic validation: focused node tests pass (96/96), including new
  page-save-state coverage for session-dirty/current-page-clean behavior.
  Remaining: rerun strict real-flow harness once service-worker/popup bootstrap
  instability in fresh persistent contexts is resolved.
- #17 exit AI content list -> silent mode, cannot save (VERY HIGH) . FIXED +
  live-verified (2026-06-08). Root cause: popup preview-close reconciliation
  could transiently miss authoritative marking restoration and fall back to
  silent-mode UI while content had already restored marking. Fix:
  `content/core.js` now sends `aiPreviewClosed` with `markingEnabled`; popup
  (`popup.js` + `popup/state.js`) applies a short post-close marking hold
  (`aiPreviewMarkingRestoreDeadlineAt`) and clears it when runtime status
  confirms marking-enabled.
  Live probe (`preview-close-popup-state-check.mjs`): pre-fix after-close-short
  popup toggle=false with content marking=true; post-fix popup toggle=true with
  content marking=true.
  - #17 follow-up root cause (Run AI completion path) . FIXED + live-verified
    (2026-06-08). `content-main.js` `configUpdated` could run its non-enabled
    branch during `compute_lock` and clear preview restore intent
    (`clearAiPreviewState`) right before `showAiPreview`, dropping
    `previousEnabled/restoreMarkingOnExit`. Fix: when `aiPreviewState.active`,
    `configUpdated` now refreshes config only and never clears/disables; the
    accidental duplicate preview guard in `capturePageSnapshot` was removed.
    Validation: real `run-ai-completion-preview-exit-check.mjs` and patched
    `tmp-run-ai-close-debug.mjs` both preserve `previousEnabled:true` and
    restore marking after close.
  - #18 enable after that silent landing -> only Run AI/Discard enabled
     (temp changes not discarded) ........................ NO LONGER REPRO in
    the strict top-frame Run AI completion flow after #17 follow-up. The
    prerequisite silent landing no longer occurs (`tmp-run-ai-close-debug.mjs`:
    `LONG_STATUS.markingEnabled:true`, `LONG_UI.toggleChecked:true`). Keep
    watch, but this is treated as resolved by #17 follow-up unless a new live
    repro appears.
  - #19 "Preview in desktop mode" shown after that flow ...... PATCHED (live
    verification blocked in current harness environment).
    Code changes (2026-06-08): `popup.js` now shows desktop preview controls
    only in silent mode (`desktopPreviewVisible` gated by `silentModeActive`),
    matching #14/#19 intent and preventing visibility in marking mode after
    re-enable. Deterministic validation: focused node tests pass (96/96), with
    added assertions in `tests/device-emulation-lifecycle.test.js` and
    `tests/popup-marking-refresh.test.js`.
  - #21 marking-mode button states wrong after a clean AI run + preview exit
     (surfaced by #17 fix landing in marking mode) ........ FIXED +
    live-verified (2026-06-08). Symptom (owner-reported): after a successful AI run and
    exiting the content-list preview, the popup now correctly returns to
    MARKING mode (per the #17 fix) but the four marking-mode controls are
    inverted: Run AI content detection is ENABLED, Show Content List is
    DISABLED, Save Session is DISABLED (and Discard state is incidental).
    Expected per owner's product logic: Run AI runs ONCE, then the user checks
    results; if good they Save (concludes the round, clears the page temp
    data, exits to silent mode, reapplies inclusions/exclusions from the latest
    CSS selectors); otherwise they keep editing markings and Run AI again.
    Discard returns the current page's markings to the session-start baseline.

    Confirmed correct truth table (marking mode; in scope; not busy; not
    reconciling):
      A. Fresh marking enable (no changes, no run):
         Run AI ENABLED, Show Content List DISABLED, Save DISABLED,
         Discard DISABLED.
      B. After a mark/unmark change (not yet run for these markings):
         Run AI ENABLED, Show Content List DISABLED, Save DISABLED
         (must run AI), Discard ENABLED.
      C. After a clean AI run, still in marking (<- the bug state):
         Run AI DISABLED (already ran), Show Content List ENABLED,
         Save ENABLED, Discard ENABLED.
      D. Reconciliation / server-sync pending: all four DISABLED.
      E. AI run in flight (busy): all four DISABLED.

    Root cause (two divergent signals on return to marking mode):
      1. `aiRunUpToDate` (`isAiRunUpToDateForCurrentMarkings`) evaluates FALSE
         after preview-exit refresh because the run's marking fingerprint no
         longer matches the live `currentDraftEntry` -> wrongly ENABLES Run AI
         (`computeButtonDisabled`) and DISABLES Show Content List
         (`markingPreviewDisabled`).
      2. `sessionRequiresAiRun` (`doesSessionRequireAiRun`) evaluates TRUE
         because the content draft still reports dirty (`currentDraftDirty`)
         after the run -> wrongly DISABLES Save (`buildPageSaveUiState`) and
         shows "Run AI before saving".
    Previously masked because preview-exit used to land in SILENT mode (where
    these three controls are not shown); the #17 fix made exit land in MARKING
    mode and exposed the inverted gating.

    Plan: smallest reconciliation-based fix so a successful AI run leaves the
    state consistent on return to marking mode (run fingerprint still matches
    -> `aiRunUpToDate` true; draft no longer dirty -> `sessionRequiresAiRun`
    false), rendering State C correctly. Add deterministic `node --test`
    coverage for States A/B/C/D, then LIVE-verify the four control states in a
    real Run-AI -> preview -> exit flow before declaring solved.

    FIX IMPLEMENTED (2026-06-08, popup.js only - no content/background change):
      1. `fingerprintPageMarkingEntry` now normalizes markings to sorted
         `${xpath}|${excluded?1:0}` identity strings (+ sorted include xpaths)
         instead of stringifying raw entry-object arrays, so incidental
         object-shape/order noise across the run+exit cycle no longer
         invalidates `aiRunUpToDate`.
      2. `applyComputedSelectorSet` now sends `configUpdated`, awaits
         `refreshCurrentPageRuntimeStatus()`, THEN calls
         `captureAiRunMarkingsFingerprint()` (before `showAiPreview`), so the
         fingerprint is captured from the same committed content draft the
         post-exit refresh reads back (was captured from a possibly stale /
         refresh-nulled in-memory draft).
      3. `doesSessionRequireAiRun` now skips the dirty-draft early return when
         the run already matches the live markings: `if (currentDraftDirty &&
         !aiRunUpToDate) return true;`. The refresh computes `aiRunUpToDate`
         before the call and passes it in. State C (clean run) can Save; State B
         (post-change) still requires a run. Save gating stays on
         `buildPageSaveUiState`/`sessionRequiresAiRun` (no second
         `!aiRunUpToDate` block on the Save view flag - per repo memory note).
      Tests: 4 new source-pattern assertions in
      `tests/popup-ai-run-gating.test.js`; full suite green (630/630). State C
      Save dimension is also covered behaviorally by the existing page-save
      "enables save and discard when the session is ready to sync" test.

    LIVE VERIFICATION (2026-06-08, full harness
      `issue21-marking-buttons-after-run.mjs` over CDP :9222 against the loaded
      fixed extension; candidate https://www.bonliva.no/, siteId 5542):
      State C after a real Run AI -> preview -> exit cycle landed in marking
      mode with `pass: true` and all verdict dimensions true:
        backInMarking:true, runAiDisabled:true, showContentListEnabled:true,
        saveEnabled:true, discardEnabled:true (status "Changes ready to save").
      This confirms the inverted gating is resolved end-to-end.

  - #2b non-candidate page leaves the marking toggle ENABLED ...... FIXED +
    live-verified (2026-06-08). Symptom (owner-reported, surfaced while
    verifying #21): on a page that is NOT one of the current Live Page
    candidates, the popup shows the non-candidate notice but the "Enable
    Marking" toggle stays interactive, so marking can be (wrongly) enabled
    where it must be impossible (ref owner directive for #13).
    Root cause: `nextViewState.toggleEnabledDisabled` (popup.js) did not
    include `pageTypeUiBlocked` inside its `!navigationInspectionPending`
    guard, so once navigation inspection settled the toggle was re-enabled even
    on non-candidate pages. The existing force-disable block already set
    `toggleEnabled=false` for `pageTypeUiBlocked`, but the recomputed
    enabled/disabled flag overrode it.
    Fix (popup.js only): `toggleEnabledDisabled` now reads
    `... || (!navigationInspectionPending && (!siteIdReady || !renderModeReady
    || pageTypeUiBlocked)) || desktopPreviewActive;` (added `|| pageTypeUiBlocked`).
    Anti-flicker note: the toggle intentionally stays enabled WHILE navigation
    inspection is pending (warmup); it disables once inspection settles. So on a
    non-candidate page the disable appears only after the inspection warmup
    completes and marking is off.
    Tests: added a source-pattern assertion in
    `tests/popup-marking-refresh.test.js` asserting `pageTypeUiBlocked` is part
    of the `toggleEnabledDisabled` navigation-inspection guard; full suite green
    (630/630).
    LIVE VERIFICATION (2026-06-08): standalone probe
      `issue21-candidate-probe.mjs` opening a fresh popup at the confirmed
      non-candidate `https://www.bonliva.no/interessemelding` reported
      `toggleDisabled: true` stably across repeated reads while the
      non-candidate notice was shown. (The combined full-harness sub-check reads
      `false` only because a second popup is held open on the same tab during
      that phase, keeping navigation inspection pending - a harness artifact,
      not a product regression; the single-popup probe is authoritative.)

Cluster 4 - property-lock countdown / lock-loss loop:
- #10 "return within XXs" resets to 30 after 0 and loops ... OPEN
- #11 refresh after countstuck -> read-only config view, back disabled, loop . OPEN
- #12 render-mode options reset while countdown banner shows . OPEN

Cluster 5 - confirmations / debugger:
- #7  discard-confirm message delayed on uncheck ........... FIXED +
  live-verified (2026-06-08). Root cause: popup disable flow always
  awaited runtime-status + full UI refresh before confirm. Fix gates that
  refresh behind `!pendingKnownFromCurrentView`, so known-dirty sessions
  confirm immediately on uncheck. Live probe: uncheck->confirm 38ms
  (`uncheck-confirm-delay-seo.mjs`).
- #8  discard-confirm message delayed on navigation ........ FIXED +
  live-verified (2026-06-08). Root cause: `confirmNavigationAwayFromMarking`
  always awaited runtime-status + full UI refresh before confirm. Fix mirrors
  #7 by gating that refresh behind `!pendingKnownFromCurrentView`, so
  known-dirty navigation attempts prompt immediately. Live probe:
  nav-click->confirm 2ms (`navigation-confirm-delay-manual-assist.mjs`).
- #9  fast repeated debugger disable not detected .......... OPEN

Cluster 6 - render mode / conditional UI:
- #13 "With JavaScript" doesn't run on a fresh non-candidate page . OPEN
- #14 "Preview in desktop mode" should only show on silent-mode view
       with saved CSS selectors, disabled+with-note otherwise ... OPEN

Cluster 7 - server-authoritative property config (post-sprint owner directive):
- #23 silent mode must use SAVED selectors only; property config becomes
       session-scoped and server-authoritative ............... IMPLEMENTED + UNIT + LIVE VERIFIED (2026-06-08)
  IMPLEMENTATION SUMMARY (2026-06-08):
    * Storage swap: common/utilities.js gained sessionKvGet/sessionKvSet/
      sessionKvRemove (extension ctx -> chrome.storage.session via storageGet/
      Set/Remove; content ctx -> relay via sendRuntimeMessage sessionKvGet/Set/
      Remove). background.js added matching message handlers. common/config.js
      import switched idbGet/idbSet -> sessionKvGet/sessionKvSet; ALL property
      persistence (configs, backendSavedPageMarkings, pageSaveReconciliations)
      now targets chrome.storage.session. NO call-site changes (API preserved).
      Stale IDB blobs are orphaned/never read (no migration, per owner Q1).
    * Storage keying DECISION: single session store keyed by property baseUrl
      (per-url + per-session), NOT per-tab. Rationale: store holds only
      server-authoritative property-global SAVED data; per-tab keying would
      force redundant /load per tab and is semantically wrong for shared
      property data. /load-replace prevents stale carryover; no onRemoved
      cleanup needed. (Supersedes the earlier `tab:<tabId>:<baseUrl>` idea.)
    * Silent-leak fix: popup.js applyComputedSelectorSet (~8120) no longer
      persists computed-but-unsaved selectors via config.updateConfig; it keeps
      them IN-MEMORY only (state.currentConfig = config.normalizeConfig(...)).
      Save/Lynx read selectors from state.currentConfig via
      getCurrentSelectorsFromConfig. Submit path still persists SUBMITTED
      selectors right before /save. => silent only ever reads SAVED session data.
    * property-url-actions REMOVED (popup/ui.js block + renderBasePageMenu,
      popup.js handlers/wiring + basePageUrls, common/text.js strings,
      theme-components.css). Inert setBasePageMenuOpen/basePageMenuOpen kept.
    * Tests: tests/server-authoritative-config.test.js (5 new). Full suite 645/645.
    * LIVE (:9222 harness ~/.uf-blink-harness):
      - issue23-storage-probe: config.js persists to chrome.storage.session not IDB.
      - issue23-drive-load: /load bonliva.no siteId 5542 -> not_found -> session empty
        (negative: 48 unsaved IDB exclusion selectors NO LONGER drive silent).
      - issue23-silent-render (POSITIVE): injected SAVED session config ->
        tab reload -> #unfluffify-silent-highlight-overlay rendered 33 marks
        (proves silent reads the session store). Test config cleaned up after.
    * #19 re-verified live (issue19-desktop-preview-gating): silent mode + stored
      selectors -> popup renders #desktop-preview-enabled (desktopPreviewVisible).
      Marking-mode hiding is covered deterministically by popup-marking-refresh /
      device-emulation-lifecycle tests. #15 covered deterministically by
      page-save-state + popup-marking-refresh (handlePageRevert guards on
      currentPageHasPendingChanges); marking-mode live repro needs content drive.
  ORIGINAL OWNER DIRECTIVE (2026-06-08): "The silent mode should never use CSS selectors
  that are not saved." Concretely:
    1. Property data (configs: selectors + pageMarkings) no longer lives in
       IndexedDB. It moves to SESSION storage, isolated PER TAB + PER property
       URL + PER browser session, so no stale data is carried around. No
       migration of existing IDB data is required.
       Impl decision: background-owned `chrome.storage.session`, keyed
       `tab:<tabId>:<baseUrl>`, cleaned up on `chrome.tabs.onRemoved`.
    2. The session-stored config is populated ONLY from the server:
       - `/load` on property page load -> replace the local session config.
       - `/save` success -> use the RETURNED payload to replace the local
         session config (discard the pre-save local copy).
    3. That session-stored SAVED config is the single source of truth for BOTH
       silent-mode highlighting AND the Lynx submission. Silent mode must never
       render in-progress (unsaved) marking edits.
    4. In-progress marking edits stay in-memory (content/core.js state) for the
       marking overlay only; they become "saved" solely via a server round-trip
       (Run AI / Save -> /save -> response payload -> session store).
    5. Side effect: the `property-url-actions` base-page menu (multi-baseUrl
       switcher) is no longer functional and is REMOVED (UI popup/ui.js ~1805 +
       renderBasePageMenu ~604, handler popup.js handleBasePageMenuToggle ~7052,
       CSS theme-components.css ~761).
  FILE MAP (current, pre-change): config persistence common/config.js
  getConfigs 1155 / saveConfigs 1211 / updateConfig 1239 (IDB key "configs");
  backendSavedPageMarkings 166-206; payload builders createConfigSyncPayload
  1048 / normalizeConfigSyncPayload 1006. /save background.js
  saveRemoteConfigSnapshot 956 + popup.js syncBaseConfigToServer 3541. /load
  background.js loadRemoteConfigSnapshot 914 + popup.js
  loadRemoteConfigForCurrentPage 3404 + replaceServerConfigIntoLocalSnapshot bg
  703. Silent selectors content-main.js getStoredAiSelectorSet 4650 /
  getEffectiveAiSelectorSet 4671 / refreshSilentHighlightings 6209. Lynx
  popup.js handleLynxChecklistSend 8653 / getCurrentSelectorsFromConfig 8672.
  STATUS: DONE - implemented, unit-tested (645/645), live-verified on :9222
  bonliva; #15/#19 re-verified (deterministic unit + #19 live positive). Ready
  to commit + push (owner OK'd push).

Regressions reported during this sprint:
- #R1 reveal/freeze phase runs incompletely - FIXED + live-verified (2026-06-08).
       Owner report (2026-06-07, after B1.1 revert): freeze icons showed but
       reveal/freeze had no visible scroll pass or spinner progression.
       A/B comparison isolated the regression to the last core-motion tweak:
       on 649c810, `r1-triage.mjs` produced 0 SCROLL events; on 5679d42, the
       same probe produced SCROLL activity.
       Final mitigation (2026-06-08): narrowed warmup behavior in
       `content/core.js` so `warmupSilentHighlightingBeforeMotionPause()` does
       NOT fully call `resumePageMotion(reason)` before reveal. Instead it:
       1) checks `hadPauseReason` for the reveal reason,
       2) temporarily releases only timer-bridge pausing via
          `setPageMotionFreezeTimersPaused(false)` before reveal,
       3) restores pause posture with `refreshPageMotionPause()` in `finally`,
          and still re-applies the reveal reason via `pausePageMotion(reason)`.
       This preserves existing motion locks while avoiding stale deferred-timer
       stalls during the reveal scroll walk.
       Regression coverage updated in `tests/core-motion-pause.test.js` to
       assert timer-bridge-only release before reveal and pause restoration.
       UNIT VERIFICATION: `node --test tests/core-motion-pause.test.js` -> pass.
       LIVE VERIFICATION:
       - `r1-triage.mjs` on patched build: reveal `ok:true`, SCROLL events
         restored (12 events), page height grows 3754 -> 4099 in the
         marking/lock-pending repro.
       - R2 sanity preserved in `drive-seo4.log`:
         `render-mode-set-nav-guard-start/observed/clear` + `nav-overlay-end`.
       - R3 sanity preserved: `without-js-spinner-timer.mjs` ~7084ms.

  - #R2 render-mode Set can trigger delayed reveal/freeze with no popup spinner.
      STATUS: FIXED + owner-confirmed (2026-06-08).
      Owner report: after Set, reveal/freeze can fire later after a random,
      usually long delay, and popup shows no spinner ownership for that late run.
      Diagnosed causal chain: unrelated editor-lock refresh paths were re-arming
      render-mode inspection active state, extending watchdog recovery timing and
      allowing stale inspection recovery to trigger a later heavy reveal.
      Final fix path (popup/content reconciliation):
      1) `popup.js` render-mode Set/onUpdated inspection expectation now supports
        in-scope silent-mode reloads (does not require `tabState.enabled`) and
        keeps nav overlay ownership via the render-mode-set guard until
        inspection is observed and settled.
      2) `content-main.js` avoids unrelated re-arming on guard paths and
        watchdog recovery only re-runs heavy reveal when inspection UI is still
        active.
      Outcome: owner confirmed the post-Set spinner behavior now appears solved.

  - #R3 "Without JavaScript" inspection spinner remains visible too long.
      STATUS: FIXED + live-verified (harness, 2026-06-08).
      Owner report: popup spinner can remain for a long period after reload in
      the Without JavaScript inspection path.
      Mitigation applied (popup.js): reduced
      `ensureContentReadyForRenderModeInspection()` polling window from 30 to 12
      attempts (250ms spacing), keeping explicit inspection flow robust while
      tightening worst-case spinner duration.
      Live measurement: `without-js-spinner-timer.mjs` now measures ~6.8-7.1s
      spinner tails on the seo.se repro flow.

--------------------------------------------------------------------------------
## Next actions (updated)

1. (DONE) Marking-enable curtain - #2/#5 fixed + owner-confirmed solved.
2. (DONE) Issue #3 fixed live (session3-root-cause.mjs):
   - same-base reload preserves marking mode,
   - navInspect spinner now appears and clears,
   - post-reload content status remains markingEnabled=true.

   SESSION 4 (seo.se, 2026-06-07):
   - Reproduced pre-fix behavior: after Enable Marking + reload,
     marking dropped to silent and nav spinner did not appear.
   - Patch in background.js: keep enabled state on same-base
     `webNavigation.onCommitted`; only disable outside baseUrl.
   - Re-verified live: nav reload now emits popup spinner push/set-message,
     then nav settle/end; inspection status after reload stays in marking mode.

3. (DONE) B1.1 re-evaluation (premature navInspect clear risk):
   - Reverted B1.1 behavior in `background.js` so superseded terminal events do
     not clear navInspect.
   - Re-verified live with synthetic supersede check + full session3 flow:
     no early clear regression observed, and #3 remains fixed.

4. (DONE) #R1 reveal/freeze incomplete run:
   - Patched core warmup to release timer-bridge pausing only (not full motion
     resume) while preserving pause locks.
   - Live replay (`r1-triage.mjs`) restored scroll activity in the
     marking/lock-pending repro.

5. NEXT (owner-set priority order, 2026-06-08):
  Completed from queue: #6, #7, #8, #16, #17.
  1) #18
  2) #15
  3) #19
  4) #14
  5) #10
  6) #11
  7) #12
  8) #4
  9) #20
  10) #13
  11) #9
  12) anything else left.

  #13 owner directive (must hold): on non-candidate pages, regardless of
  property status, show only the locked banner and the non-candidate note, and
  expose no other functionality.

Latest phase decision (updated 2026-06-08):
- #R2 is now owner-confirmed solved after the silent-mode inspection-ownership
  correction.
- #R3 now has harness live verification (~6.8-7.1s spinner tail) and should
  still be watched on broader owner properties for long-tail reloads.
- UX polish shipped: render-mode Step-1 button placement now lists
  "Without JavaScript" before "With JavaScript" (no behavior change).

6. Historical investigation notes for #3 (kept for traceability):
   the reveal/freeze SPINNER DOES NOT APPEAR after
   refresh/navigation. With launch-live running, open the instrumented popup,
   reload the candidate page (sw.evaluate chrome.tabs.reload), and poll broker
   lifecycle + popup curtain + whether beginNavigationInspectionOverlay fires.
   Hypothesis: after reload the broker lifecycle resets to none and the popup's
   broker port / tabs.onUpdated navInspect-raising path is not re-established, so
   subsequent reveal/freeze events never raise the spinner. Fix, then verify by
   triggering a reveal/freeze after reload and watching the spinner appear.

   LIVE INVESTIGATION 2026-06-07 (drive-refresh.mjs, on bonliva.se): could NOT
   cleanly repro #3 because the test environment was confounded:
   - Content IS alive (getInspectionStatus ok:true, mode:silent) BUT
     lockClaimPending:true - the property-lock editor claim is stuck pending.
   - Marking-enable never completed: clicking Enable Marking showed "Inspecting
     page..." for ~30s then cleared, but tabState.enabled stayed FALSE and broker
     lifecycle stayed lc[none] (no lifecycle events recorded for the tab).
   - So the marking-enabled-then-reload precondition for the #3 repro can't be
     reached while the property lock claim is stuck (this overlaps Cluster 4,
     #10-#12).
   CLEAN-REPRO PREREQUISITE for next session: start from a clean property-lock
   state - use a fresh candidate page / release the editor lock first (or a
   different account/page) so Enable Marking actually reaches enabled=true and
   the broker records lifecycle. THEN reload and check the reveal/freeze spinner.
   Watch whether the stuck lockClaimPending is itself the cause of "no lifecycle
   / no spinner" after navigation (i.e. #3 may be a symptom of the property-lock
   claim never resolving after a reload).
   NOTE: many chrome.runtime.reload() cycles during a debug session can also
   drift content/tab state - prefer a fresh tab when starting a new repro.
   FOLLOW-UP (bonliva.se): closing orphaned popups did NOT clear lockClaimPending
   there - bonliva had a real lock cooldown.

   SESSION 2 (seo.se, owner-provided to bypass the lock cooldown; lock starts
   CLEAN there):
   - METHODOLOGY FIX: drive scripts MUST call popup.close() at the end. A CDP
     browser.close() does NOT close the popup.html?debugTabId tabs, and every
     open popup claims the editor lock -> orphaned popups make lockClaimPending
     stick. drive-seo3.mjs closes its popup (good); older drivers did not.
   - Render-mode "With JavaScript" reveal/freeze SPINNER WORKS: it appears both
     before AND after a page reload ("Please wait..." -> "Detecting render
     mode...", ~8-13s, then clears). lc[none] throughout: render-mode inspection
     uses a popup-LOCAL runWithSpinner, not the lifecycle broker. So #3 is NOT
     this path.
   - => #3 is most likely the MARKING-mode navInspect "Inspecting page..."
     spinner on navigation (tabs.onUpdated -> beginNavigationInspectionOverlay),
     which requires marking ENABLED.
   - BLOCKER to auto-repro: enabling marking on a fresh seo.se page first needs
     the RENDER MODE SET (select #render-mode-choice-static|rendered radio ->
     #render-mode-set, which is disabled until a radio is chosen; the radio
     selection RESETS each time the popup reopens until Set is clicked). Clicking
     Set PERSISTS render-mode config to the owner's real property (a
     side-effectful change to live data) - do NOT do this unprompted. ASK the
     owner to set render mode + enable marking on a seo.se candidate page (or OK
     it), THEN observe the navigation behavior: enable marking, reload within the
     base URL, and watch whether beginNavigationInspectionOverlay raises the
     "Inspecting page..." navInspect spinner via tabs.onUpdated. #3 = it does not
     appear after the refresh.
   - Property-lock claim still a candidate common root for #3/#10-#12 (see
     bonliva follow-up), but seo.se shows the lock CAN be clean, so test there.

   SESSION 3 (seo.se, full sequence observed via drive-seo4.mjs - instruments
   BOTH the page (framenavigated/load/console) and the popup). Sequence:
   land -> "With JavaScript" -> pick Static -> Set -> Enable Marking.
   KEY OBSERVATIONS (page reload = reveal/freeze ran on the page):
   - STEP A (fresh landing): no page reload, no reveal/freeze. OK.
   - STEP B ("With JavaScript"): PAGE RELOADED (reveal/freeze RAN) on a fresh
     property. Owner: this should NOT happen here = ISSUE #13 confirmed.
   - STEP C (pick Static + Set): page reloaded after Set. OWNER CLARIFICATION:
     this is GENUINE/expected - JavaScript must be enabled before exiting the
     render-mode detection view. NOT a bug.
   - STEP D (Enable Marking): curtain went "Applying device emulation..." ->
     "Inspecting page..." -> cleared, BUT tabState.enabled stayed FALSE (marking
     did NOT actually enable) and NO page reload happened (no reveal/freeze on
     enable).
   - THROUGHOUT after the STEP B/C reloads: getInspectionStatus returned
     undefined (a=undefined,p=undefined,rmi=undefined) and broker lc[none] - i.e.
     CONTENT-MAIN IS NOT ACTIVE/RESPONDING on the tab after the reveal/freeze
     reloads. (content-loader is present but content-main, which answers
     getInspectionStatus + emits lifecycle, is not loaded.)
   STRONG ROOT-CAUSE HYPOTHESIS (links #3, #5-followups, #13): after a
   reveal/freeze / debugger-driven page reload, content-main is NOT reliably
   re-activated (background not re-sending activateContentMain, or the
   activation path post-render-mode-reload is broken). That would explain:
   marking-enable silently failing (enabled stays false; the flow needs content),
   no lifecycle/spinner after navigation (#3), etc. The render-mode "With
   JavaScript" path still works because it is BACKGROUND/debugger-driven, not
   content-driven.
   NEXT STEP (verify the root): after the sequence, send
   chrome.tabs.sendMessage(tabId,{type:"activateContentMain"}) (or re-open the
   popup which triggers activation) and re-probe getInspectionStatus; if content
   revives, the bug is the missing auto re-activation after the reveal/freeze
   reload. Then fix in background.js (re-activate content after render-mode /
   debugger reloads) and re-verify the full sequence live, expecting marking to
   reach enabled=true and the reveal/freeze spinner to appear on navigation.
4. Re-evaluate B1.1 (see CORRECTION above) and revert if it causes premature
   navInspect clearing; re-verify live.
5. Continue per the priority order in plan-core-hotfix-4h.md: #18/#15/#19/#14,
  then #10-#12, #4/#20, and #13/#9.

## Constraints
- Verify every runtime/visual fix LIVE before recording it as done.
- Keep fixes minimal and deterministic; prefer authoritative state reconciliation
  over fixed-time give-ups (the #2 bug was exactly a premature give-up).
- Do not weaken the locked marking contract.

Latest autonomous pass note (2026-06-08, post-#17 follow-up):
- #17 real-flow regression is fixed in both the strict completion harness and
  the previously failing debug harness after frame-targeting correction.
- #18 could not be reproduced anymore in the exact Run AI completion path.
- #15/#19 received targeted code fixes with focused test coverage, but strict
  live re-verification is currently blocked by harness environment instability:
  fresh persistent contexts intermittently fail to bootstrap a usable popup/
  service-worker flow (`serviceworker` timeout or popup compute-controls absent),
  so the exact end-to-end Run AI completion assertion for these two issues is
  still pending a stable repro session.
