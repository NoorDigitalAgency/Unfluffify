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

- #14 Silent preview + exit-to-origin: in SILENT mode with stored selectors, the
  "Show Content List" button must be enabled -> opens preview list -> exiting
  returns to SILENT (exit-preview returns to ORIGIN mode: silent->silent,
  post-AI-marking->marking). Currently Show List is marking-mode only. Touch:
  dictation-decider MARKING_PREVIEW visibility/enabled + secondary-gates
  markingPreview/previewLatest reasons (gate on hasStoredSelectors + silentModeActive
  for the silent case) and the content exit-preview origin restore
  (src/content-main.ts:3478 exitAiPreviewMode).
- #13 Reveal/freeze immediacy: a candidate page must run reveal/freeze IMMEDIATELY
  on nav/reload when render mode is confirmed — NOT gated on marking-enable; NOT
  during render-mode detection; run after the FIRST render-mode set; NO
  reveal/freeze when updating an already-set render mode. Currently
  `shouldRunSilentHighlightEditorActivation` (src/content-main.ts:2067-2078)
  blocks when `state.enabled===true` and requires stored selectors, so fresh
  candidates wait for marking-enable. `refreshSilentHighlightings`
  (content-main.ts:5318-5366) gates the same way. Decouple reveal/freeze from
  marking-enable + stored-selectors; trigger on render-mode-confirmed.
- #1/#3/#4 Visual remainder: (1) "Preparing page content" curtain lingers on
  initial load + post-reveal-freeze; (3) missing main-word spinner label beside
  reveal/freeze; (4) green include-borders not rendered in preview/marking (yellow
  focus + list<->page sync work). Re-observe after #13/#14 since some may resolve.

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
