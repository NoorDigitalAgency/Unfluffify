# Marking lifecycle redesign — resume plan

Live-QA driven redesign of the marking session lifecycle (user-approved
locked-area changes). Resume from here in any environment.

## DONE and pushed to `origin/main`

- `e83d843` feat(marking): editable post-AI, lock only during run, post-AI edits
  re-enter pre-AI dirty (bugs #10 + #11).
  - view-projector: `aiRunMarkingBlocked = aiComputing || previewActive ||
    previewBlocked` (was POST_AI/AI_PREVIEW); reason `post_ai` -> `ai_run`.
  - session-phase-decider: `READY_TO_SAVE` also requires
    `!currentPageHasPendingChanges`; otherwise `MARKING_DIRTY`.
  - dictation-decider: `postAiClean = postAi && !currentPageHasPendingChanges`;
    Run AI disabled only when `actionMatrixDisabled || postAiClean`; Save/List
    enabled only when `postAiClean`; Discard enabled when
    `postAi || (currentPageHasPendingChanges && !pageSaveReconciliationPending)`.
  - secondary-gates: pageSave/markingPreview block `REQUIRES_AI_RUN` when
    `!postAiClean`.
  - index.ts buildAiRunFactsPatch: PREVIEW_READY + RESULTS_APPLIED/EXITED now
    also set `currentPageHasPendingChanges: false` (clean post-AI baseline,
    flicker-free; popup overrides true on a real edit).
  - knowledge.md "Popup Preview Exit Contract" + overlay-reason bullet updated.
- Earlier this session (already on main): `0366375` (seq ordering),
  `6e403fc` (popup/content fact reconciliation).

Live-verified on sove.se full cycle A -> B -> computing(locked) ->
preview(locked) -> C(editable) -> edit -> B; State C stable across ~18
heartbeats (no clobber). Dirty axis is the existing `currentPageHasPendingChanges`
SessionFact (NOT fingerprints); it is popup-owned and NOT in
`omitPopupAiRunAuthorityFacts`, so the brain always sees post-AI edits. Post-AI
clean is `!dirty` because `exitAiPreviewMode` re-enables via
`core.enableForBaseUrl` which sets `pendingFreshBaselinePageUrl` -> the next
render re-adopts the current markings as the clean baseline.

## NEXT — Step #15/#12: Save replaces local from save-response snapshot (IMPLEMENTED — live-verify deferred)

Implemented in this session (scoped option, validated `pnpm lint && check && test
&& build`; 1018 tests green). Live-verify on a property with backend data remains
deferred (no backend credentials in the sandbox environment):
- `SyncBaseConfigOptions.replaceLocalFromServerResponse?: boolean`
  (src/popup/remote-config.ts) + destructure default `false`.
- syncBaseConfigToServer success branch now sends
  `replaceServerConfigIntoLocalSnapshot` (payloadKey/currentPageUrl/siteId) when
  the flag is set, else the existing merge message. Result var renamed
  `mergeResult` -> `snapshotResult`; replace returns no `invalidLoadedUrls`, so
  the prune is a no-op for replace. Selector-submit caller unchanged.
- handlePageSave (src/popup/page-reconciliation.ts) passes
  `replaceLocalFromServerResponse: true`.
- Tests: tests/popup-remote-config.test.ts asserts the replace path sends
  `replaceServerConfigIntoLocalSnapshot` (not merge) and prunes `[]`;
  tests/popup-page-reconciliation.test.ts asserts handlePageSave passes the flag.

Design notes (verified by reading code):
- Goal: after a successful page Save, rebuild local from the `/save` RESPONSE
  snapshot the same way LOAD does, so `backendSavedPageMarkings` (the Lynx
  checklist "done" coverage source) updates -> current candidate is marked done ->
  Send-to-Lynx unlocks. User direction (#15): "the save returns a new snapshot of
  the save data for the property that must replace the local data similar to load".
- LOAD uses `replaceServerConfigIntoLocalSnapshot` (src/background/remote-config-sync.ts:266-404)
  which sets `backendSavedPageMarkings = nextConfig.pageMarkings` (line 383) = full
  server snapshot (REPLACE).
- The replace handler/function consume only `payload/payloadKey/currentPageUrl/
  siteId` (background.ts:3191-3199) — it does NOT need `confirmedPageMarkings`/
  `preferConfirmedPageMarkings`; the full `/save` response snapshot is the source.
- `syncBaseConfigToServer` has TWO callers: handlePageSave
  (src/popup/page-reconciliation.ts:148, `includeAllLocalPageMarkings: true`) and
  the selector-submit flow (src/popup.ts:7742, selectors only). The REPLACE is
  SCOPED to the save caller only.

LIVE VERIFY #15/#12 on a property WITH backend data: `pnpm browser:live
https://bonliva.se` (user said bonliva.se has backend data). Drive a candidate to
State C, click Save, then confirm via popup `getViewState()`:
`saveExcludesButtonDisabled`/`lynxChecklistSendBlockedReason` clear and the
candidate page-type shows covered/done (checklist `markedPages` now includes the
saved page from `backendSavedPageMarkings`).

Risk to live-verify: REPLACE adopts the server snapshot for ALL pages (wipes local
markings not echoed back). Save sends `includeAllLocalPageMarkings: true` but the
coverage filter (remote-config.ts:414-432) narrows to coverage-active pages, so
non-active local markings could be dropped on replace — this matches "backend is
sole source of truth" + load semantics (user-approved), but live-verify it does
not wipe needed data.

## REMAINING steps (in order, same workflow: implement -> tests -> live-verify -> review -> commit/push -> graph refresh)

- #14 Silent preview + exit-to-origin — DONE (uncommitted; live-verify deferred).
  Scope confirmed by @Sojaner: enable the silent-mode "Show Content List"
  (`preview-latest`) on `silentModeActive + hasStoredSelectors` only by dropping
  the AI-run-freshness gate (`!aiRunUpToDate || sessionRequiresAiRun ->
  REQUIRES_AI_RUN`) from `previewLatestBlockedReason`
  (src/background/brain/deciders/secondary-gates-decider.ts). Marking-mode
  `MARKING_PREVIEW` (gated on `postAiClean`) left unchanged. Exit-to-origin needed
  NO content change: `beginAiPreviewMode` captures `previousEnabled =
  Boolean(state.enabled)` (false in silent) and `restoreMarkingOnExit` only for
  `compute_lock`, so `exitAiPreviewMode` falls through to
  `refreshSilentHighlightings()` (silent->silent); marking->marking restore is the
  existing `previousEnabled` branch. Tests: secondary-gates-decider.test.ts
  updated (enable without fresh run + no_stored_selectors block); exit-to-origin
  already locked by preview-tooltip.test.ts / popup-marking-refresh.test.ts. Docs:
  knowledge.md + MARKING_AND_HIGHLIGHTING_LOGIC.md. Gate green (check/lint/test
  1019). Code-review clean.
- #13 Reveal/freeze immediacy — DONE (uncommitted; live-validated). Implemented
  via a brain-authority approach (NOT a content-local gate, per the non-drift
  rule): new brain directive `pageRevealFreezeActive` (view-projector
  `shouldRevealFreezePage` — a superset of `shouldActivateSilentHighlighting`
  minus `silentModeActive` + `hasStoredSelectors`), reflected in content
  (`layer-host.isPageRevealFreezeActiveByDirective`). Content gates now key on it:
  `shouldRunSilentHighlightEditorActivation`, the directive watcher, the
  `isStillCurrent` check, and `refreshSilentHighlightings` holds the freeze when
  `holdSilentMotionPause` (instead of deactivating) so a fresh candidate's
  reveal/freeze is not immediately undone. The silent OVERLAY still requires
  stored selectors (`silentHighlightActive` unchanged). Live-validated on a fresh
  bonliva.se candidate (hasStoredSelectors=false): page frozen, motion-pause
  indicator, 372 consent elements hidden, no overlays. Resolves backlog blockers
  #2 + #3. Gate green (check/lint/1021 tests/build), code-review clean.
  NOTE: live deploy required clearing the stale SW ScriptCache — re-running
  `pnpm browser:live` does NOT clear it (known launcher gap).
- #1/#3/#4 Visual remainder: (1) "Preparing page content" curtain lingers on
  initial load + post-reveal-freeze; (3) missing main-word spinner label beside
  reveal/freeze; (4) green include-borders not rendered in preview/marking (yellow
  focus + list<->page sync work). Re-observe after #13/#14 since some may resolve.

## Backlog bug — render-mode inspection stuck spinner (FIXED 2026-07-01, commit pending)
Repro: on a property re-inspecting render mode (www.bonliva.se via the render-mode
With/Without-JavaScript buttons), the popup curtain "Starting render-mode
inspection / Working… controls are temporarily blocked" stayed STUCK visible even
though the page reloaded fine and the brain correctly cleared the curtain.

ACTUAL root cause (confirmed via live CDP curtain-write tracing) — NOT the brain
busyVisible loop hypothesized earlier: the popup session curtain
(`view.sessionCurtainVisible`) is brain-authoritative, reflected from the projected
`sessionDictation` via `applyCentralSessionDictation(nextViewState, currentTabId)`
inside the big async `refreshUiInner` (src/popup.ts). The original code called
`applyCentralSessionDictation` EARLY (computing `sessionCurtainVisible` from the
dictation at that instant), then ran a long async tail (token validation,
config/tab fetches, `await syncRenderModeDebuggerLifecycle`), then finally wrote
the whole `nextViewState` via `uiModule.setViewState(nextViewState)`. During an
inspection MANY `refreshUiInner` runs overlap; one that read the dictation while
the curtain was VISIBLE would finish AFTER the brain cleared it (and after a
snapshot set `sessionCurtainVisible=false`) and its final `setViewState` OVERWROTE
the cleared curtain with the stale `true`. Nothing updated afterward → stuck.
Live trace smoking gun: `refreshFinal-setView {vis:true, dictVis:false}` (wrote
visible=true while the current dictation was already invisible).

FIX (popup-side, brain authority preserved): move
`applyCentralSessionDictation(nextViewState, currentTabId)` to be the LAST mutation
immediately before the synchronous `uiModule.setViewState(nextViewState)` (no await
between), so every late/overlapping refresh re-derives the dictation-owned fields
from the CURRENT dictation at write time. Regression guard:
tests/popup-central-state-dictation.test.ts asserts the adjacency + no-await-between
invariant (fails on the old ordering). Live-validated over two inspection rounds:
the curtain now appears during the inspection and CLEARS when it completes.

## Backlog bug — reveal/freeze "Preparing page content…" stuck spinner (FIXED 2026-07-01, commit pending)
Repro: fresh candidate (clear the `unfluffify` IndexedDB) → render-mode detection
view → pick a render mode → Set → the reveal/freeze runs and the popup busy curtain
"Preparing page content… / Working… controls are temporarily blocked"
INTERMITTENTLY sticks forever (~1 in 1-3 attempts live). The spinner text changes
twice (navInspect → silent-highlighting lifecycle → page-inspection-pending) before
sticking on the third.

Root cause (confirmed via live CDP event-log tracing): the popup page-inspection
busy curtain is driven by `contentInspectionPending` polled from content's
`getInspectionStatus`. In `src/content/inspection-status.ts`,
`pending = inspectionActive || editorPreparationPending || reconciliationPending`.
The popup's deterministic clear relies on content's `inspectionSettled` event, but
that fires ONLY from `core.finishPageInspectionUi()` when `inspectionActive` clears.
`editorPreparationPending` (the silent-highlight editor reveal/freeze, tracked by
`silentHighlightEditorActivationPromise` in content-main.ts) clears LATER in the
activation's `.finally()` with NO event, so the popup's post-settle refresh polls
`pending=true` and nothing re-triggers a refresh once editorPreparation clears.
Live proof: one `inspectionSettled` fires, the triggered refresh reads
`active=false pending=true`, and it sticks.

FIX (content-side, minimal): fire `notifyInspectionSettled()` in
`runEditorSilentHighlightingActivation()`'s `.finally()` (after nulling the
promise) so the popup re-polls the now-settled status. Regression guard:
tests/inspection-settled-event.test.ts asserts the activation fires the second
settle after the promise clears. Live-validated 8/8 fresh-candidate render-mode-set
rounds cleared (0 stuck); event log confirms the SECOND `inspectionSettled` drives
a re-poll that reads `pending=false` and clears. A popup-side view-write seq guard
was prototyped but proved unnecessary (content fix alone is robust) and dropped.

## Live-test infra notes

- Launch: `pnpm browser:live <url>` (committed launcher) — real :0/Wayland
  display so it runs HEADED. CDP at http://127.0.0.1:9222.
- ALWAYS clear `.wxt/browser-profile/Default/Service Worker/{ScriptCache,Database}`
  and relaunch after a rebuild, or the stale MV3 SW keeps running old background.js.
- Driver: `.temp/cdp.mjs` (gitignored) — `state`, `click <id>`, `clicksel <sel>`,
  `eval-popup <expr>`, `nav <url>`. Popup debug hook exposes only
  `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()`.
- Mark an element via CDP: Alt+down, `mouse.click(x,y)` at a real content element
  (avoid Cybot/cookie), Alt+up (Alt=include, plain=exclude). Playwright text
  locators are unreliable for multi-line nodes — use coordinate clicks.
- Cursor classes on `<html>`: `uf-cursor-disabled` = LOCKED, `uf-cursor-exclude` =
  editable. The always-present `uf-marking-disabled-notice` element is a false
  positive for "locked" — check the cursor class instead.
- sove.se backend is CLEARED (404 on load -> local wipe). bonliva.se has backend
  data (use for save/coverage tests). acapedia.no also used earlier.
- Config page values if prompted: config `https://unfluffify.lynxdev.se`, AI
  `https://unfluffify.dnscdn.se:8443`, stage `a.lynxdev.se`, email
  `rojan.gh@noordigital.com`, password in `~/Desktop/password.txt`.

## Validation gate

`pnpm lint && pnpm check && pnpm test && pnpm build` (all green at e83d843: 1016
tests). After each commit AND after each push, refresh codebase-memory graph
(`index_repository`). Follow safe-change for edits and review-push for the
commit/push loop (fast-forward only, no force-push).

## Live QA round #2 — full findings + fix specs (2026-07-01, NOT yet implemented, needs live validation)

User ran a full mark->AI->save->navigate round and reported 8 findings, then gave the
definitive reveal/freeze / consent / silent-highlight contract. This section is the
handoff: root causes + precise fix specs. NONE are implemented yet — scripted CDP
marking reproduction proved unreliable (the "Inspecting page..." page-inspection
overlay sticks over content and Alt+click marks do not register), so each fix needs
live validation (user drives mark->AI->save->navigate) before shipping. User chose:
"implement fixes from confirmed root causes with regression tests, I validate after."

### Confirmed HARNESS ARTIFACTS (not bugs) — do not fix
#1 discard does nothing / #2 cannot disable marking / #3 navigation silently stopped in
dirty marking. All three gate on window.confirm (page-reconciliation.ts:236 revertConfirm,
popup.ts:6680 disableDiscardConfirm, popup.ts:6553 navigateDiscardConfirm). A persistent
Playwright observer (connectOverCDP) auto-dismisses window.confirm (returns false =>
silent no-op). Proven via raw CDP that the launcher MCP does NOT dismiss (dialog stays
open). User confirmed #1/#2/#3 are fine. LESSON: never run a persistent Playwright
connectOverCDP while the user tests dialogs; use raw CDP (fetch /json + WebSocket) for
non-interfering reads. Helper pattern used this session works.

### DURABLE CONTRACT (user-specified target behavior; also stored as repo memories)
1. CONSENT REMOVAL: runs on ALL property pages (candidate or not), always/end-to-end,
   decoupled from reveal/freeze and candidacy. Reason: stop users clicking consent
   buttons that mutate the DOM.
2. REVEAL/FREEZE/lazy-load-lock: runs ONLY on a candidate page, in two cases:
   (a) full page load when the render mode is ALREADY set, or
   (b) immediately after FIRST-TIME render-mode set (exiting the render-mode view).
   NEVER: in marking mode, during render-mode decision/EDITING (re-inspect of an
   existing mode), or any later in-session point. Runs right before silent highlighting.
3. SILENT HIGHLIGHTING: renders whenever (stored selectors present + marking off),
   independent of reveal/freeze — immediately post-save / in-session (no reveal/freeze),
   or after reveal/freeze on page load.

### #6 reveal/freeze runs on render re-inspect (REAL) — must not
Root cause: reveal/freeze = runEditorSilentHighlightingActivation, gated by
shouldRunSilentHighlightEditorActivation() (content-main.ts:2068) on !state.enabled &&
isPageRevealFreezeActiveByDirective(). It runs from the content directive watcher
(content-main.ts:7063) on any pageRevealFreezeActive/silentHighlightActive directive
change, and from content-main init (7098). After a render re-inspect (editing an
existing mode) the page reloads for inspection (isRenderModeInspectionActive suppresses
the init run, 2111), the inspection settles, then pageRevealFreezeActive turns true and
the directive watcher runs the activation -> unwanted reveal/freeze.
Brain gate: shouldRevealFreezePage (view-projector.ts:198) is LEVEL-triggered (true
whenever ready candidate + marking off + not dirty...). It cannot distinguish page-load
vs first-time-set vs edit vs post-save.
Fix direction: make reveal/freeze EDGE-triggered per the contract. Distinguish
first-time render-mode set (undetermined->set) from EDIT (set->set) and from
post-save (selectors changed, mode unchanged). Likely need a transient signal recorded
by the render-mode set/inspection flow ("mode was already set before this op") that the
activation checks. Then: run the activation only on (a) page-load-with-mode-set (init,
7098, already gated by isRenderModeInspectionActive) and (b) first-time-set; do NOT run
it from the directive watcher for edit/post-save/in-session directive changes.
REGRESSION RISK: #13 (blocker #2/#3) wants first-time-set to reveal/freeze via the
directive path — verify first-time-set still runs it. Add a decider/source test.

### #4/#8 silent highlights wait for reveal/freeze (REAL) — must render immediately
Root cause: silent overlay render = refreshSilentHighlightings (content-main.ts:5332),
shouldObserve = snapshot.hasSelectorHighlights || hasHiddenConsent (5175) — i.e. it
renders directly from stored selectors, NOT gated on the activation. The directive
watcher (7063) DOES call refreshSilentHighlightings first, then the activation. But
user sees highlights only appear at the END of the reveal/freeze activation
(shouldRefreshAfterActivation, 2207) or after a reload. Suspected: the activation, once
running, deactivates/holds the overlays during reveal/freeze then re-renders at the end;
and/or the immediate refreshSilentHighlightings runs before selectors are loaded into
the snapshot (loadAndNormalizeConfigs timing) so hasSelectorHighlights is briefly false.
Fix direction: silent highlight render must be a pure function of (stored selectors +
marking off), never held by the reveal/freeze activation. Ensure refreshSilentHighlightings
renders as soon as the silentHighlightActive directive is true with selectors loaded, and
that the activation does not clear/hold already-rendered silent overlays. Post-save
(applyPostSaveSilentTransition) must trigger a silent-highlight render with NO reveal/freeze
(ties to #6: directive watcher should render highlights but not run the activation
in-session). NEEDS LIVE VALIDATION with a page that HAS saved selectors (mark->AI->save).

### #5 todo/coverage not updated after saving a page for a page type (REAL)
Root cause candidates (needs live save to confirm): coverage = buildLynxChecklistViewModel(
propertyPageTypes, coverageMarkedPageItems) at popup.ts:4680, and coverageMarkedPageItems
= backendSavedPageMarkingItems (popup.ts:4514-4524, from config.getBackendSavedPageMarkings).
The save (handlePageSave, page-reconciliation.ts:86) awaits syncBaseConfigToServer which
awaits the background replaceServerConfigIntoLocalSnapshot (remote-config.ts:494) that
writes backendSavedPageMarkings (background/remote-config-sync.ts:383), THEN refreshUi.
So the source IS refreshed. Remaining suspects: (1) the saved page's pageType key does
not match a propertyPageType key in buildLynxChecklistViewModel (common/lynx-checklist.ts:362);
(2) propertyPageTypes is served from cache (site-resolution.ts:163 freshness interval) so
the page-type list/coverage counts are stale post-save; (3) buildLynxChecklistViewModel
markedCount uses markedPages length per type and a mismatch drops it. FIX: after a
successful save, force a propertyPageTypes refresh (bypass cache) and rebuild coverage,
OR confirm+fix the pageType-key match. NEEDS LIVE SAVE to see which. Live check: compare
backendSavedPageMarkings[baseUrl] entries (pageType) vs coverage pageTypeGroups after save.

### #7 page not fully blocked while popup curtain up / during AI run (REAL)
CORRECTION to earlier note: the background DOES report aiComputing:true on AI-run STARTED
(buildAiRunFactsPatch, brain/index.ts:249) via the AI-run lease, so a fresh run IS
marking-disabled (markingEditsBlocked = aiComputing||previewActive||previewBlocked,
view-projector.ts:241). The gap: markingEditsBlocked only disables MARKING (cursor +
uf-marking-disabled notice, core.ts:6553-6700), NOT full page interaction. Full page
block = pageCurtain (setPageInspectionUiActive -> uf-page-inspection-active overlay,
core.ts:6837), driven by brain spinner surfaces (PAGE_AND_POPUP). Some AI-run phases are
POPUP_ONLY (REFINING_STATIC_XPATHS, OPENING_PREVIEW) and SYNCING_MARKINGS is UNBLOCKED
(spinner-contract.ts:164-235), so the page is interactive during those while the popup
shows a curtain. Contract: whenever the popup shows a blocking curtain, the page must be
blocked too. FIX direction: sync the page block to the popup curtain — either promote the
relevant AI-run/operation spinner phases to PAGE_AND_POPUP, or project a pageCurtain
whenever sessionDictation.curtain.visible is true. Decide with the user whether preview
phases should also block the page (preview shows on-page yellow AI highlights, so a full
page block there may conflict — confirm intended).

### #8 preview-list: silent highlights gone, yellow AI highlight present
Per user, this is the SAME as #4 (silent highlights must show whenever selectors + not
marking). In preview mode previewActive=true so silentHighlightActive is false by design
(view-projector.ts:185) — clarify with user whether silent highlights should ALSO show in
preview-list mode, or if #8 is fully covered by fixing #4/#8 for the non-preview silent case.

### Extra finding logged: stuck "Inspecting page..." page overlay
While scripting, enabling marking sometimes left the page-inspection overlay
("Inspecting page... it will be ready soon", text.ts:162) stuck over content (clears in
~10s on a plain reload). Likely rapid-automation overlap of two reveal/freezes, but worth
a live check that the marking reveal/freeze overlay always clears.
