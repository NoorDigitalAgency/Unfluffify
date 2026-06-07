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
    Commit: (this change).

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
- #2  spinner stuck after reveal/freeze ... FIXED+verified (V2, popup reconciler)
- #3  refresh -> spinner gone, never returns . OPEN (next; likely broker port
       re-connect / lifecycle reset after page reload - drive it with reload-ext +
       a page reload, watch broker lifecycle->none and whether popup re-subscribes)
- #4  spinner text out of sync (low) ...... OPEN (low)
- #5  "Applying device emulation..." stuck . FIXED via V3 (queued runWithSpinner
       spinner whose device-emulation await could hang; now bounded by a 12s
       targeted timeout + a 60s universal spinner watchdog). Verified live.
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

1. (DONE) Confirm marking-enable curtain clears - verified via drive2.mjs.
2. Issue #3 (refresh -> spinner never reappears): with launch-live running,
   open instrumented popup, reload the candidate page, and poll broker lifecycle
   + popup port state. Hypothesis: after reload the broker lifecycle resets to
   none and the popup's broker port / event subscription is not re-established,
   so subsequent events never reach the popup. Confirm live, then fix, then
   verify by triggering an event after reload and watching the curtain appear.
3. Re-evaluate B1.1 (see CORRECTION above) and revert if it causes premature
   navInspect clearing; re-verify live.
4. Continue down Cluster 1 (#20, #4), then Cluster 2 very-high (#16, #17).

## Constraints
- Verify every runtime/visual fix LIVE before recording it as done.
- Keep fixes minimal and deterministic; prefer authoritative state reconciliation
  over fixed-time give-ups (the #2 bug was exactly a premature give-up).
- Do not weaken the locked marking contract.
