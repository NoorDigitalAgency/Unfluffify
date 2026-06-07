# Handoff - Core Hotfix Sprint

Last updated: 2026-06-07
Branch: main
Scope: stabilize core user-facing spinner/curtain + silent-highlight behavior.

This handoff is written so that you OR a fresh agent can reproduce, diagnose,
fix, and VERIFY each issue independently using a real loaded extension. Read the
"Live debugging methodology" section first - it is the single most important
part. Do NOT declare a runtime/visual fix done from source reasoning or
source-snapshot tests alone; verify it live.

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

RISK: B1.1 (clear navInspect even when the lifecycle is superseded) can clear a
legitimate navInspect curtain mid-operation. During live testing the user once
observed the curtain "disappear too early". B1.1 is the prime suspect.
ACTION FOR NEXT AGENT: evaluate reverting B1.1 (restore B1's supersede-gated
clear, or remove the background navInspect teardown entirely) and re-verify the
real navInspect flows live. Keep V2 (the popup reconciler fix) regardless.

--------------------------------------------------------------------------------
## Issue status (full original 20-issue report)

Cluster 1 - operation lifecycle / spinner (messaging layers):
- #1  silent blink ........................ FIXED+verified (V1)
- #2  spinner stuck after reveal/freeze ... FIXED+verified (V2); owner confirms
       the spinner-stuck issue is solved.
- #3  refresh/navigation -> reveal/freeze SPINNER DOES NOT APPEAR for any later
       events (the run itself works) ....... OPEN (NEXT; owner-flagged, possibly
       related to #2/#5). Hypothesis: after reload the broker lifecycle resets to
       none and the popup's broker port / tabs.onUpdated navInspect-raising path
       (beginNavigationInspectionOverlay, gated on tabState.enabled + inScope) is
       not re-established / no longer fires. REPRO: instrumented
       popup.html?debugTabId, settle, reload the candidate page (sw.evaluate
       chrome.tabs.reload), poll broker lifecycle + curtain + whether
       beginNavigationInspectionOverlay logs fire; then trigger reveal/freeze and
       confirm the spinner appears.
- #4  spinner text out of sync (low) ...... OPEN (low)
- #5  "Applying device emulation..." stuck . FIXED+verified (V4: dedicated
       deviceEmulationApplying flag; root cause was deviceControlsDisabled
       raising the curtain for the whole marking session). V3 watchdog + 12s
       device-emul timeout added as safety nets. Owner confirms solved.
- #20 trace enabled in sync but checkbox off/no logs . OPEN (observed live:
       getUfBackgroundState traceEnabled=false despite sync flag; popup disables it)

Cluster 2 - silent highlight / preview:
- #6  marking apply delayed a few seconds .. OPEN (core.scheduleRender default
       delay=50ms on user actions; candidate fix delay:0 for user-driven renders)
- #16 preview list rows not visible/scrollable (VERY HIGH) . OPEN (needs AI
       preview list populated; reconcile preview eligibility against
       collectSilentHighlightRenderTargets / renderable collections)

Cluster 3 - mode transitions / temporary state reset:
- #15 saved data used on enable -> dirty/discard wrong .... OPEN
- #17 exit AI content list -> silent mode, cannot save (VERY HIGH) . OPEN
- #18 enable after that silent landing -> only Run AI/Discard enabled
       (temp changes not discarded) ........................ OPEN
- #19 "Preview in desktop mode" shown after that flow ...... OPEN (see #14)

Cluster 4 - property-lock countdown / lock-loss loop:
- #10 "return within XXs" resets to 30 after 0 and loops ... OPEN
- #11 refresh after countstuck -> read-only config view, back disabled, loop . OPEN
- #12 render-mode options reset while countdown banner shows . OPEN

Cluster 5 - confirmations / debugger:
- #7  discard-confirm message delayed on uncheck ........... OPEN
- #8  discard-confirm message delayed on navigation ........ OPEN
- #9  fast repeated debugger disable not detected .......... OPEN

Cluster 6 - render mode / conditional UI:
- #13 "With JavaScript" doesn't run on a fresh non-candidate page . OPEN
- #14 "Preview in desktop mode" should only show on silent-mode view
       with saved CSS selectors, disabled+with-note otherwise ... OPEN

--------------------------------------------------------------------------------
## Next actions (keep current)

1. (DONE) Marking-enable curtain - #2/#5 fixed + owner-confirmed solved.
2. Issue #3 (NEXT): the reveal/freeze SPINNER DOES NOT APPEAR after
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
3. Re-evaluate B1.1 (see CORRECTION above) and revert if it causes premature
   navInspect clearing; re-verify live.
4. Continue per the priority order in plan-core-hotfix-4h.md: #16 + #17 (very
   high), then #20, #4, then Clusters 3-6 and #6.

## Constraints
- Verify every runtime/visual fix LIVE before recording it as done.
- Keep fixes minimal and deterministic; prefer authoritative state reconciliation
  over fixed-time give-ups (the #2 bug was exactly a premature give-up).
- Do not weaken the locked marking contract.
