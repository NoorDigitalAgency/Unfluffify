# UNFLUFFIFY — AUTONOMOUS HANDOFF PLAN (executor: gpt-5.4, xhigh reasoning)

Author: prior session (deep investigation done). Executor: an autonomous, CAPABLE
agent (gpt-5.4 at xhigh) — @Sojaner is ASLEEP and NOT available. Work end-to-end
without waiting for anyone. Repo: NoorDigitalAgency/Unfluffify, branch `main`.

EXECUTOR MINDSET: You are capable. This plan gives you root causes, exact file:line
anchors, constraints, and acceptance criteria — you do the reasoning and choose the
precise edits. Where a spec and the code diverge, REASON to the correct minimal
behavior-preserving change and DOCUMENT it; do not stall. Every phase must be
COMPLETABLE and COMMITTABLE on automated tests alone (you cannot script page marking
and must not run heavy-page live browsers on the user's machine). Live QA is a
SEPARATE, non-blocking pass @Sojaner runs later (see the checklist at the bottom).

READ THIS FIRST, THEN EXECUTE PHASES IN ORDER. Do not skip the guardrails.

---

## 0. HOW TO WORK (mandatory, every phase)

1. Before ANY editing session, read:
   - `.copilot/knowledge.md`
   - `.github/instructions/*.instructions.md`
   - the relevant `.github/skills/*/SKILL.md` (`safe-change`, `review-push`,
     `live-browser`, `branch-sync`)
   - this file
2. Use `codebase-memory-mcp` (search_graph / search_code / get_code_snippet /
   trace_path) BEFORE `rg`/manual search. Refresh the graph
   (`codebase-memory-mcp-index_repository`, mode `fast`) if HEAD changed and it
   was not indexed this session.
3. For each phase: follow `safe-change`, make the SMALLEST edit that satisfies the
   spec, add/extend the named tests, then run validation.
4. Default validation gate (source changes):
   ```bash
   pnpm lint && pnpm check && pnpm test && pnpm build
   ```
5. MANDATORY per phase (this keeps a comprehensive commit history): every phase
   ENDS with a full `review-push` round — run the code-review/fix loop until clean,
   run the gate, COMMIT (ONE focused conventional commit per phase, e.g.
   `fix(scope): …` / `perf(scope): …`), PUSH to `main`, then reindex the graph
   (`fast`). NEVER batch multiple phases into one commit; NEVER start a new phase
   with the previous phase uncommitted. Commit trailer:
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
6. Update the SQL todo status (`in_progress` before, `done` after).
7. NO-USER-AVAILABLE decision rule (replaces "stop and ask"): @Sojaner is asleep,
   so you cannot ask. When the spec and the code diverge, or a design micro-decision
   arises, REASON from the codebase + these constraints to the smallest correct
   behavior-preserving change, IMPLEMENT it, and record a one-line `DECISION:` note
   in this file under the phase for later review. DEFER (mark the todo `blocked` +
   write a precise note) ONLY for a TRUE blocker you cannot resolve yourself: a
   genuine product-behavior fork with no safe default derivable from the code,
   missing external access/credentials, or a change that would require violating a
   HARD GUARDRAIL. A blocked phase must NOT stop the other independent phases —
   continue with the next ready one.

### HARD GUARDRAILS (from repo instructions — do not violate)
- Do NOT edit locked marking/highlighting/reveal-freeze behavior beyond the exact
  minimal change specified. Preserve output/contracts.
- Do NOT reintroduce popup-local button/curtain authority. Brain (background)
  owns projection; extend brain deciders/view-projector/fact-reporters instead.
- Do NOT add broad catch blocks, silent success fallbacks, or hidden early
  returns.
- Always add regression coverage for a fixed bug.
- Keep changes scoped to the phase.

### VALIDATION IS TEST-BASED (do NOT run the live browser autonomously)
- You cannot script page marking, and heavy-page live browsers JANK @Sojaner's
  whole OS — so DO NOT launch `pnpm browser:live` as part of autonomous execution.
- Every phase is completed and committed on AUTOMATED validation ONLY:
  `pnpm lint && pnpm check && pnpm test && pnpm build`, plus the phase's named
  unit/source-contract tests — which you MUST add/extend so the behavior is proven
  WITHOUT a browser. If a phase's behavior seems un-testable without a browser,
  that is a signal to add a unit-level seam (mock the content probe / brain fact /
  DOM fixture), not to launch a browser.
- Perf phase (D) "output must not change": prove it with a JSDOM/unit fixture that
  asserts identical produced rows, NOT with live profiling.
- LIVE QA IS DEFERRED, NON-BLOCKING: for each phase, append an entry to the
  "LIVE QA CHECKLIST FOR @Sojaner" section at the BOTTOM of this file (what to
  click, expected result). @Sojaner validates everything in one live pass when
  awake. Do NOT block a phase on live validation.
- REMINDER for any human/live QA sequence: enable marking (the toggle/checkbox)
  and mark elements FIRST — the Run AI (#compute) button does not exist until
  marking is enabled and the page has marks.
- CDP helpers from prior session (may exist in /tmp): `/tmp/cdp.mjs <popup|page|service_worker> <awaitBool> '<expr>'`,
  `/tmp/multiconsole.mjs <secs> <filter>`, `/tmp/swnet.mjs <secs>`. Recreate if
  missing (raw CDP over http://127.0.0.1:9222).

---

## GOAL (whole handoff)
Make the extension usable and responsive on huge-DOM pages, finish the remaining
confirmed QA bugs, close out items already fixed this session, and add the
solution-architect consult skill — without changing AI-submission output, marking
semantics, or brain authority.

## ALREADY SHIPPED THIS SESSION (context; do not redo)
- `fcf3aba` fix(remote-config): `/load` loop fix (IndexedDB transfer payloads +
  age-based `sanitizeTransferPayloads` + in-flight load dedupe + load-once guard +
  200-complete-replace + exp backoff w/ reset) AND AI-run snapshot-timeout raise
  (`AI_RUN_SNAPSHOT_CONTENT_TIMEOUT_MS = 120_000`, ai-run-orchestrator).
- `8eacb3a` fix(remote-network): `updateScrapingConditions` GraphQL schema fix
  (scalar return, `DomainRenderMode` enum, STATIC/RENDERED value mapping).
- `1ad3150` fix: silent-highlight-in-preview (#8).

## NON-GOALS (must NOT change)
- The SET of xpaths/elements produced by `collectAiSubmissionXpathsForCurrentPage`
  (perf phases are pure memoization — identical output).
- Marking mark/unmark semantics, saved-page silent-highlight contracts.
- Brain projection authority model (extend, never bypass).
- The spinner surface contract (POPUP_ONLY vs PAGE_AND_POPUP mapping).

---

# EXECUTION PHASES (in order)

RECOMMENDED ORDER (given the Phase D<->F coupling and the top blocker):
A (#12, safe win) -> B (#6) -> C (#11) -> D (PERF P1, removes the Phase F trigger)
-> F (TOP BLOCKER exit-corruption) -> E (PERF P2 preview loop) -> G (#7) -> H (P4)
-> I (close-outs) -> K (architect skill). Each phase = safe-change + full gate +
review-push (commit/push) + reindex, then the next. Do NOT batch phases into one
commit. If short on time, A+B+C+D+F deliver the shipping-blocker value.

## PHASE A — #12 Save button feels unresponsive (busy-first + paint yield)
Risk: LOW. Mechanical.
- Root: `submitSelectorSetToServer()` (`src/popup.ts` ~7701–7839) does heavy
  awaited work (refreshCurrentPageRuntimeStatus ~7708, reconciliation/draft
  ~7709-7714, selector normalization ~7716-7719, global settings load ~7721,
  site-id resolution ~7727-7738, token read ~7754) BEFORE setting
  `state.aiRequestInFlight = "save"; await refreshUi();` (~7756-7757). So the
  spinner paints late.
- Edit: move `state.aiRequestInFlight = "save"; await refreshUi();` to the TOP of
  `submitSelectorSetToServer()` (right after entry validation, before
  `refreshCurrentPageRuntimeStatus`). Immediately after `await refreshUi()` add a
  single paint yield: `await new Promise((r) => requestAnimationFrame(() => r(null)));`
  (guard for non-DOM env: `typeof requestAnimationFrame === "function"`; else skip).
  Ensure on every early-return/error path the flight flag is cleared (search the
  function for existing `aiRequestInFlight = ""`/reset and keep it correct).
- Also apply the same busy-first pattern to page-save if needed:
  `src/popup/page-reconciliation.ts:144-146` (set spinner before the awaited
  `syncBaseConfigToServer`). Only if the delay reproduces there too.
- Tests: extend `tests/popup-remote-config.test.ts` — assert `aiRequestInFlight`
  is set / `refreshUi` called BEFORE the mocked heavy steps run (order assertion
  via call log). If a spinner-order contract test exists (`tests/popup-spinner.test.ts`),
  add the paint-yield-before-heavy-work assertion.
- Acceptance: the "save"/compute busy state is set and rendered before any awaited
  network/DOM work; no behavior change to the actual save result.
- Rollback: revert the reorder if any save flow regresses (watch for double-submit
  / flight-flag stuck).
- DECISION (2026-07-02): `refreshUi()` was too expensive for first paint, so the
  fix applies a direct `uiModule.setViewState(...)` patch for the save-loading
  UI, the normal `aiBusy`-disabled config + render-mode controls, and an
  immediate `publishCurrentTabSessionFacts({ saving: true/false })` pair, then
  uses `waitForPopupUiPaint()`; `handlePageSave()` stayed unchanged because it
  already enters `runWithSpinner(...)` before its expensive sync loop.

## PHASE B — #6 Reveal/freeze wrongly runs on pure render re-inspect
Risk: LOW (narrow predicate). LOCKED area — minimal change only.
- Root: `shouldRunSilentHighlightEditorActivation()` (`src/content-main.ts`
  ~2069-2082) does not exclude render-mode inspection. It is called from the
  directive watcher (~7135-7138), init (~7170-7172), and property-lock sync
  (~5991-5995) whenever `pageRevealFreezeActive || silentHighlightActive`.
- `isRenderModeInspectionActive()` EXISTS at `src/content-main.ts:1704`
  (already used at 1727, 2120). Confirmed.
- Edit: at the TOP of `shouldRunSilentHighlightEditorActivation()` add:
  `if (isRenderModeInspectionActive()) { return false; }`
  Change NOTHING else. Do NOT gate on `silentHighlightActive` alone (that breaks
  saved-page silent-highlight). Do NOT remove the watcher/init/property-lock calls.
- Tests: extend `tests/silent-highlight-annotations.test.ts` — source-contract or
  behavioral assertion that the predicate returns false when render-mode
  inspection is active AND still returns true for a normal marking-mode activation.
- Acceptance: entering "With/Without JavaScript" render re-inspect on a property
  that already has a render mode does NOT run the reveal/freeze editor activation;
  normal marking-mode reveal/freeze still runs.
- Rollback: remove the added guard.

## PHASE C — #11 AI preview tears down reveal/freeze
Risk: MEDIUM (shared popover teardown). Opt-in for preview ONLY.
- Root: `showAiPopover()` (`src/content/core.ts` ~11509-11522) unconditionally
  calls `closeAiPopover({ notify: false, suppressCallback: true })`, and
  `closeAiPopover()` (~7456-7490) calls `resumePageMotion()` (~6322-6352), which
  clears the page-motion pause + lazy-load suppression → the page unfreezes under
  the preview. Preview open path: `src/content/ai-preview-show-handler.ts:47-56`
  (`beginAiPreviewMode` → `showAiPopover`).
- Edit (opt-in, do NOT change default close behavior):
  1. Add an option to `showAiPopover(items, options)` e.g.
     `preservePageMotionPause?: boolean`. When true, the internal
     `closeAiPopover(...)` call must NOT resume page motion — pass a flag through
     to `closeAiPopover` (add `preservePageMotionPause?: boolean` there too) so it
     SKIPS `resumePageMotion()` when set. Default (unset) = unchanged behavior.
  2. In `src/content/ai-preview-show-handler.ts:47-56`, pass
     `preservePageMotionPause: true` when opening the preview popover.
- Tests: extend `tests/ai-preview-show-handler.test.ts` (assert the preview-open
  popover options include the preserve flag). Add a motion-pause regression test
  (`tests/core-motion-pause.test.ts` if present, else create a focused one) that
  asserts opening the AI preview does NOT call `resumePageMotion()` / does not
  clear the paused state.
- Acceptance: opening the AI preview keeps animations frozen + lazy content
  revealed (page does not revert); closing the preview / normal popover close is
  unchanged (still resumes motion).
- Rollback: remove the flag + its call site; default path already unchanged.
- DECISION (2026-07-02): the current code actually releases the reveal/freeze on
  preview OPEN because `enterAiPreviewMode()` immediately runs
  `refreshSilentHighlightings()`, whose `holdSilentMotionPause` calculation drops
  to false during preview mode and calls `setSilentHighlightingPageMotionPaused(false)`.
  The fix therefore preserves an ALREADY-held silent motion pause while
  `aiPreviewState.mode === "preview"` instead of changing popover teardown. On
  preview EXIT, keep the non-marking refresh BEFORE `resetAiPreviewState()` so
  the local pause bridge survives until the brain re-projects the post-exit
  directive flip (`previewActive=false`).

## PHASE D — PERF P1: memoize the AI-run snapshot DOM scan (BIGGEST WIN)
Risk: MEDIUM. MUST NOT change output. Target: collectAiSubmissionXpaths 16s→seconds.
- Root: `collectAiSubmissionXpathsForCurrentPage()` (`src/content-main.ts`
  4907-5098) walks all of `document.body` (loop ~5020-5096) calling per node:
  `getCurrentPageSnapshotXPath` (5028), `core.isVisibleForSubmission` (5055;
  getComputedStyle up ancestors + getBoundingClientRect = reflow), and
  `core.isMarkableElement` (5060). It also calls
  `hasVisibleMarkableTextualSubmissionDescendant(node, configValue)` (5091),
  which (`src/content-main.ts:5100-5138`) RE-WALKS descendants calling
  `core.isVisibleForSubmission` (5121) and `core.isMarkableElement` (5122) with
  the EXACT SAME options object as the main loop (5060) — verified identical:
  `{ allowParent:false, allowImmutableChildren:false, allowConsentElements:true, ignoreVisibilityForInclusionDetection:true }`.
  There is NO per-pass memoization here. `withElementComputationCache`
  (`src/content/core.ts:1113`) resets/restores per-pass caches for
  visibility(isVisible)/text/immutable/toggleable — but NOT for
  `isVisibleForSubmission` or `getSnapshotXPath`.
- Edit (three memos + one wrapper; all inside `src/content-main.ts`, no core.ts
  logic change):
  1. Wrap the BODY of `collectAiSubmissionXpathsForCurrentPage` in
     `return core.withElementComputationCache(() => { …existing body… });`
     (speeds `isMarkableElement`'s internal immutable/textual/toggleable checks).
     Note: it already calls `core.refreshPageMotionPause()` at 4908 — keep that
     BEFORE the wrapper or inside; keep behavior identical.
  2. Create three function-scoped memos at the top of the function:
     - `const visMemo = new WeakMap<Element, boolean>();`
     - `const xpathMemo = new WeakMap<Node, string>();`
     - `const markMemo = new WeakMap<Element, boolean>();`
     and helpers:
     - `memoVisible(el)` → cache `core.isVisibleForSubmission(el)`
     - `memoXPath(node)` → cache `getCurrentPageSnapshotXPath(node)`
     - `memoMarkable(el)` → cache `core.isMarkableElement(el, configValue, SUBMISSION_MARK_OPTIONS)`
       where `SUBMISSION_MARK_OPTIONS` is the SHARED constant object with the exact
       four fields above. IMPORTANT: only memoize `isMarkableElement` for THIS
       exact options object (5060 + 5122). Do NOT memoize the other
       isMarkableElement call sites (they use different options).
  3. Replace the direct calls: main loop 5028→`memoXPath(node)`,
     5055→`memoVisible(node)`, 5060→`memoMarkable(node)`.
  4. Pass the SAME three memos into `hasVisibleMarkableTextualSubmissionDescendant`
     (add params) and use `memoVisible`/`memoMarkable` at 5121/5122 there. This is
     where the quadratic amplification collapses (descendant re-walk reuses the
     main loop's cached results).
  5. Do NOT memoize `hasExcludedAncestorRow` / `isImmutableExcludedElement`
     unless trivially safe; the big wins are the three above.
- CRITICAL output-equality guard (do this, do not skip):
  - Before editing, run the submission-xpath unit tests to capture current
    behavior: `tests/submission-rules.test.ts`,
    `tests/ai-submission-xpaths-handler.test.ts` (and any test that exercises
    `collectAiSubmissionXpaths`/submission rows). They must stay green after.
  - Add a NEW unit test (best in `tests/submission-rules.test.ts` or a new
    `tests/collect-ai-submission-xpaths.test.ts`) that builds a small JSDOM
    fixture with excluded/included/nested nodes and asserts the produced `rows`
    array is byte-identical with and without memoization (or assert against a
    known expected array). The memos MUST be pure (WeakMap keyed by node, values
    stable for the pass) so output cannot change.
  - LIVE re-profile (optional but recommended): temporarily log
    `rows.length` + a cheap hash of `rows` before/after on a huge page; confirm
    identical + the ~16s drops. REMOVE the temp logging before commit.
- Acceptance: identical submission output; `collectAiSubmissionXpaths` wall-time
  on a huge page drops from ~16s to low single-digit seconds; the popup's content
  probes (getInspectionStatus/getPageDraftStatus) no longer queue ~16s during a run.
- Rollback: the memos are additive; revert to direct calls if any output test fails.

## PHASE E — PERF P2: stop the preview list recomputing/emptying repeatedly
Risk: MEDIUM-HIGH (touches popup refresh + brain projection path). Extend, don't
rip out. Consider splitting; STOP-AND-ASK if the guard risks dropping real updates.
- Root: `refreshUi()` (`src/popup.ts` ~5705-5726) rebuilds `previewItems` from
  scratch on EVERY trigger; triggers include `applyPopupViewSnapshot()`
  (~1240-1260, re-calls refreshUi on VIEW_UPDATED) and
  `handleSpinnerSurfaceChangedFromBrain()` (~8173-8181). Only a re-entry guard
  exists (comment ~1245-1260 "cooldown was removed"); NO diff/debounce. Preview
  build: `normalizePreviewItems` (~8065-8112), `buildPreviewViewState`
  (~8082-8112), set by `applyAiPreviewStateUpdate` (~7520-7535) +
  `applyComputedSelectorSet` (~7475-7511). Content-side render `drawCollections`
  (`src/content/core.ts:9883-10061`) fully rebuilds the overlay each refresh.
- Edit (two independent, low-risk sub-steps; do the popup one first):
  1. previewItems diff guard: before assigning `previewItems` in
     `buildPreviewViewState`/`applyAiPreviewStateUpdate`, compute a cheap signature
     (e.g. JSON of the item xpaths+categories or a length+hash) and skip the
     reassignment + skip the dependent DOM/content refresh if the signature is
     unchanged from the last applied one (store `state.lastPreviewItemsSignature`).
     This makes repeated identical refreshes no-ops. Do NOT skip when the signature
     actually changed.
  2. refreshUi debounce for rapid brain projections (ONLY if step 1 is
     insufficient — verify first): coalesce bursts of `VIEW_UPDATED` /
     spinner-surface-changed into one refresh via a microtask/rAF debounce, being
     careful NOT to drop the final state. Repo memory warns of a "brain projection
     loop" — do not create a publish↔project loop; the debounce must settle.
- Tests: `tests/popup-marking-refresh.test.ts` and/or a new focused test —
  assert that applying the SAME preview snapshot twice does not rebuild
  previewItems the second time (signature guard), and that a CHANGED snapshot does
  rebuild. If you add debounce, test that N rapid updates yield 1 rebuild with the
  final state.
- Acceptance: opening the preview builds the list ONCE (no empties/reloads on a
  stable state); a genuine content update still refreshes; no dropped final state.
- Rollback: remove the signature guard/debounce (pure additive).
- STOP-AND-ASK if: making this safe requires changing brain projection dedup or
  the VIEW_UPDATED contract — leave a note, mark blocked.

## PHASE F — [TOP SHIPPING BLOCKER] Post-exit-preview state-machine corruption (#14)
Risk: HIGH (brain/state machine + locked contracts). COUPLED WITH PHASE D. Do Phase D
first (it removes the trigger), then this. LIVE-VALIDATE with @Sojaner. STOP-AND-ASK
if the two-layer (popup+brain) unification is ambiguous — this is the phase most
likely to need @Sojaner pairing.

EXACT SYMPTOMS (user-observed, on a heavy page, after clicking Exit on the preview
list): cannot Save; popup AND page oscillate between "marking" and "marking
temporarily unavailable" with a repeatedly EMPTY preview list; contradictory button
matrix = marked-checkmark DISABLED, Run AI ENABLED, Show content DISABLED, Save
DISABLED, Discard ENABLED; only multiple Discard clicks + confirm recovers to stable
silent highlighting.

ROOT CAUSE (verified):
- Exit is split between popup-local snapshot restore and brain-authoritative
  projection, and they diverge. `handleExitPreviewMode()` (src/popup.ts:8012-8063)
  can return early via the restore path (8038-8058) without deterministically
  clearing the brain-owned preview facts.
- The restore WEDGES on heavy pages: `finalizePreviewRestoreFromRuntime()`
  (src/popup.ts:2960-3010) — when `restoreMarkingSessionSnapshot()` fails (2967) —
  falls to a runtime path that sends `getInspectionStatus` + `getPageDraftStatus`
  CONTENT PROBES with retry (src/popup.ts:2990-2993). On a heavy DOM those probes
  block ~16s or fail after retries (SAME content-thread starvation as Phase D), so
  `previewRestorePending` stays true. The fallback timer
  (`schedulePreviewRestoreFallback`, 3012-3018) just re-calls the same runtime
  finalize → re-sends the blocking probes → never settles.
- `beginPreviewRestorePending()` (3020-3034) has already published
  `previewRestorePending: true` to the brain. "marking temporarily unavailable" is
  brain-projected: `markingEditsBlocked = aiRunMarkingBlocked || reconciliation...`
  where `aiRunMarkingBlocked = aiComputing || previewActive || previewBlocked`
  (src/background/brain/view-projector.ts:251-276), surfaced by content
  `getMarkingTemporarilyDisabledReason` (src/content/core.ts:7148-7153) via
  `layer-host.ts:69-78`. The half-closed state makes markingEditsBlocked FLAP
  (preview facts present→true; popup clears some→false; popup republishes→…).
- Oscillation driver: each refresh/projection bumps `state.version`
  (src/background/brain/state-store.ts:233); popup refresh triggers
  `applyPopupViewSnapshot` (1240-1260) + `handleSpinnerSurfaceChangedFromBrain`
  (8173-8181) re-run refreshUi → re-project → loop.
- Contradictory button matrix (src/popup.ts:4358-4427): `toggleEnabled` is FORCED
  true while `previewRestorePending || aiComputeRunActive || aiPreviewSessionActive`
  (marked-checkmark locked); Run AI enabled because `sessionRequiresAiRun` is stale;
  Show content disabled because `previewActive/previewBlocked/previewRestorePending`
  still block; Save disabled by the pending/restore/dirty mismatch; Discard enabled
  because it is the hard-reset path.
- Discard recovers because `applyLocalPageDiscard` hard-resets the session
  (previews/restore/reconciliation facts) → brain settles to silent highlighting.

FIX (three parts; smallest-safe first). Preserve locked marking/silent-highlight
contracts; extend brain authority, do not add popup-local authority beyond clearing
popup-owned pending flags.
1. FALLBACK MUST FORCE-CLEAR (safest single lever; likely breaks the loop):
   add a hard finalizer, e.g. `finalizePreviewRestoreHard(token)`, that (with the
   current-token guard) clears pending + marking snapshot + publishes the brain
   preview facts cleared + does ONE refreshUi — WITHOUT sending the blocking
   `getInspectionStatus`/`getPageDraftStatus` probes (mirror the existing
   `!tabId || !baseUrl` branch at 2984-2988). Point `schedulePreviewRestoreFallback`
   (3012-3018) at THIS hard finalizer, so `previewRestorePending` cannot persist
   past `AI_PREVIEW_RESTORE_FALLBACK_MS` regardless of content responsiveness.
2. EXIT DETERMINISTICALLY CLEARS BRAIN PREVIEW FACTS (both paths): ensure that when
   exit completes (restore path 8038-8058 AND applyPreviewClosedState path
   8060-8062), the brain receives `previewActive:false, previewBlocked:false,
   previewItemsPending:false, previewRestorePending:false` (via
   `publishCurrentTabSessionFacts`) so `markingEditsBlocked` settles false. Do not
   let the restore early-return skip this.
3. EXIT IDEMPOTENT: at the top of `handleExitPreviewMode()`, if
   `state.previewRestorePending` is already true, re-arm the fallback and return
   (no second restore token / no second close request).
- COUPLING: after Phase D (fast content probes), the runtime finalize at 2990-2993
  should succeed quickly, so the wedge rarely arms; part 1 guarantees it can never
  persist. Validate BOTH orders (D-then-F) live.

TESTS: `tests/ai-preview-close-handler.test.ts` (exit clears brain-facing preview
facts idempotently; repeated exit does not flap previewRestorePending; fallback
force-clears when probes never resolve — mock a never-resolving getInspectionStatus),
`tests/popup-view-projector.test.ts` (preview-close projects markingEditsBlocked=false;
no ai_run block remains), `tests/popup-ai-run-gating.test.ts` (button matrix after
exit is self-consistent: not the contradictory combination).
ACCEPTANCE: after exit, within <= fallback delay, previewRestorePending is false, the
brain projects markingEditsBlocked=false, the preview list is gone, and the button
matrix is consistent (Save reachable per the real session state); no oscillation;
Discard is NOT required to recover. LIVE: @Sojaner marks + runs AI + previews + exits
on a heavy page; confirm stable, one-click exit, and Save works.
ROLLBACK: parts are additive; revert the hard finalizer / fact-clear / idempotency
guard independently. STOP-AND-ASK if clearing popup facts does not settle the brain
(would indicate the content exit path itself doesn't clear aiPreviewState — then the
fix belongs in the content ai-preview close handler + its reported facts).

## PHASE G — #7 Page not blocked during popup curtain (brain-side sync)
Risk: HIGH (brain projection authority). INVESTIGATE-THEN-FIX. Do live/behavioral
verification first; STOP-AND-ASK if the current projection already covers it.
- Facts: spinner surface model `src/common/spinner-contract.ts:131-235`
  (`POPUP_ONLY={page:false,popup:true}`, `PAGE_AND_POPUP`). AI-run phases
  PREPARING_PAGE/CAPTURE_MARKED_CONTENT/PREPARE_SELECTOR_PAYLOAD/REMOTE_WAIT are
  PAGE_AND_POPUP (166-213); REFINING_STATIC_XPATHS/OPENING_PREVIEW are POPUP_ONLY
  (195-223); SYNCING_MARKINGS UNBLOCKED (225-235). Brain projects both surfaces:
  `src/background/brain/spinner-authority.ts:92-102`
  `pageCurtain: projectSurface(aiRunSelection || state.spinners.pageCurtain)`.
  Content renders pageCurtain solely from the brain broadcast
  (`src/content/layers/content-bus-client.ts:64-68`,
  `src/content/layers/spinner-layer.ts:21-33`). Brain folds AI-run facts
  `src/background/brain/index.ts:246-259` (aiBusy/aiComputing/busyVisible on
  STARTED). RC: fresh run doesn't publish popup `aiComputing`
  (`src/popup.ts:2453-2471`, gated on `aiRunResumed`).
- STEP 1 (verify BEFORE editing): live or via unit trace, confirm what the
  pageCurtain broadcast actually is during a FRESH AI run's PAGE_AND_POPUP phases.
  If the brain already drives pageCurtain for those phases, the real gap may be
  elsewhere (e.g., the run never enters a PAGE_AND_POPUP spinner phase because the
  popup-authored aiComputing never reaches the brain). Pin the exact gap.
- STEP 2 (fix, brain-side only — extend, never popup-local):
  - Make the page-blocking AI-run state drive `pageCurtain` from the BRAIN's own
    folded AI-run facts (index.ts:246-259) rather than depending on a popup
    `aiComputing` publish. Concretely, in
    `src/background/brain/spinner-authority.ts` (projectAiRunSelection/
    projectSpinners ~41-102): ensure a page-blocking AI-run phase yields a
    pageCurtain selection even for a fresh (non-resumed) run; POPUP_ONLY phases
    must NOT drive pageCurtain. Possibly also extend
    `src/background/brain/view-projector.ts:251-276` busy/page-block reason.
- Tests: `tests/spinner-authority.test.ts` (page-blocking AI run mirrors onto
  pageCurtain; POPUP_ONLY phases do not), `tests/popup-view-projector.test.ts`,
  `tests/spinner-contract.test.ts` (surface contracts unchanged).
- Acceptance: during a fresh AI run's page-blocking phases the page is blocked
  (pageCurtain shown) in sync with the popup curtain; POPUP_ONLY phases leave the
  page interactive; no popup-local authority added.
- Rollback: revert the projection change.
- STOP-AND-ASK if: the fix would require moving authority to the popup, or the
  dedup loop (index.ts:504-546) is affected — leave a note, mark blocked.

## PHASE H — PERF P4: marking-mode hover cost (LOWER PRIORITY)
Risk: MEDIUM. Only after A–G. User said less urgent.
- Root: `handleMouseMove` (`src/content/core.ts:8094-8130`) → RAF
  `updateHoverHighlight` (~8010-8062) does `getMarkableTarget` + `getVisibleRects`
  + `drawMultiRectReuse` per move → frequent hit-testing/rect/overlay redraw.
- Edit (safe, additive): (1) ensure hover work is throttled to one per rAF (verify
  it already is); (2) skip recompute when the hovered markable target element is
  unchanged since the last move (cache last target; early-return if same); (3)
  reuse the memo pattern from Phase D for any per-node visibility/markable check
  in the hover path (do NOT change what becomes markable).
- Tests: extend the marking/hover tests if present; assert no recompute when the
  target is unchanged.
- Acceptance: marking-mode hover is noticeably lighter on huge pages; hover
  targeting unchanged.
- STOP-AND-ASK if: touching hover changes which element highlights.

## PHASE I — Verify/close-out (no or minimal code)
- #5 (Todo not updated after saving a page for a page type): FIXED — user confirmed
  the Todo list updates on save. Close the todo/reported_issue; NO code change
  needed. (Reference only, if a regression ever appears: after a successful save in
  `handlePageSave()` src/popup/page-reconciliation.ts:144-169, force a fresh
  page-type coverage refresh by invalidating the `propertyPageTypes` cache in
  src/popup/site-resolution.ts:178-195 then `refreshUi()`; Todo completion =
  `markedCount>0` in src/common/lynx-checklist.ts:352-406.)
- Config-lifecycle step 5 (render-mode + reveal/freeze AFTER load settles): the
  `/load` loop fix already made reveal/freeze run after load (user observed it
  working). VERIFY live on a candidate-page navigation; if it works, close. The
  Phase B fix handles the over-run (render re-inspect) case.
- Close as RESOLVED (update reported_issues/todos, retest lightly if cheap):
  #13 (AI run broke extension → loop + snapshot timeout fixed),
  #10 (Content timed out → snapshot timeout fix),
  #8 (preview silent highlights → 1ad3150), #4 (silent highlights → resolved).
- Retest harness-artifacts on a LIGHT page (likely NOT real): #1/#2/#3 (observer
  auto-dismissed discard/disable/navigate confirms — reproduce WITHOUT an
  auto-dismissing observer), #9 (inspection overlay stuck — likely automation
  artifact; confirm on a plain reload).

## PHASE J — DEFERRED / FUTURE (do not implement unless asked)
- `ll-remove-detections`: a standalone, feature-flagged 120s page-type poll in the
  SW does NOT currently exist (the loop fix removed recurring loads; no 120s poll
  found). This is a FUTURE feature to ADD later, isolated + behind a feature flag,
  with NO side effects. Leave for a future directive.

## PHASE K — Meta: create the solution-architect consult skill
Risk: LOW (docs/skill). 
- Create `.github/skills/consult-architect/SKILL.md` (name it clearly) that
  encodes: for any task involving architectural reasoning, design, or advanced
  problem solving, the agent MUST consult @Sojaner (Senior Solution Architect)
  EARLY — present the root cause + proposed solution + one deterministic
  multiple-choice question, get approval or direction BEFORE deep implementation,
  to avoid spiraling / broken plans / wasted tokens. Wire it into the workflow the
  same way other skills are referenced (add a bullet in
  `.github/instructions/*.instructions.md` "Use the repository skills…" list and,
  if present, in `.copilot/knowledge.md`). Follow the `repo-knowledge` skill for
  durable updates. Validation: docs-only → `git --no-pager diff --check`.
- Acceptance: the skill exists, is discoverable, and is referenced from the
  always-on instructions so future tasks trigger the consult-early behavior.

---

# TEST MATRIX (per phase, plus final)
- Unit/source-contract: named per phase above.
- Full gate after each phase: `pnpm lint && pnpm check && pnpm test && pnpm build`.
- Live: DEFERRED and NON-BLOCKING — do NOT run the browser autonomously. Record
  each phase's manual check in the "LIVE QA CHECKLIST FOR @Sojaner" below.
- Final: full gate green; @Sojaner later runs the live-QA `validation_phases`
  checklist (session SQL `validation_phases`): assess, render-detect, marking,
  ai-detect, discard, re-ai, save, nav-invalidation, todo-list, buttons, spinners.

# REGRESSION RISKS (highest)
- Phase D changing submission output → guarded by output-equality UNIT tests
  (JSDOM fixture; identical produced rows before/after).
- Phase E/F/G touching brain projection / refresh → publish↔project loop; guarded
  by "extend not bypass", dedup awareness, and the NO-USER-AVAILABLE decision rule
  (decide-and-document, defer only true blockers).
- Phase B/C touching locked reveal/freeze/popover → minimal opt-in changes only.

# ARCHITECT (@Sojaner) REVIEW MATTERS (call these out in the phase commit messages)
- Phase F (#14) and Phase G (#7) change the brain state machine / projection. Keep
  DECISION notes in this file; @Sojaner reviews the commits + live-validates.

# LIVE QA CHECKLIST FOR @Sojaner (run after the autonomous phases; NOT a blocker)
Sequence reminder: ENABLE MARKING (toggle) + mark elements FIRST — Run AI (#compute)
does not appear until then. Use a heavy page (e.g. bonliva.se/lediga-jobb) for the
perf/exit items; a light page (e.g. a small sove.se product page) for the rest.
- FOUNDATION (already shipped fcf3aba/8eacb3a): mark + Run AI on a heavy page → run
  completes and preview shows (a couple minutes is normal); no "/load loop" /
  "Content message timed out"; Lynx submit ("Send to Lynx") succeeds. (Closes
  #13/#10.)
- A (#12): click Save/Send → busy spinner appears immediately (no dead delay).
- B (#6): on a property that already has a render mode, click With/Without
  JavaScript render re-inspect → reveal/freeze does NOT re-run.
- C (#11): open the AI preview → page stays frozen (lazy/animated items do NOT
  revert to initial state).
- D (perf): mark + Run AI on the heavy page → the run starts promptly (no ~16s
  content stall; popup stays responsive).
- F (#14, TOP): mark + Run AI + open preview + click Exit ONCE → clean exit, no
  marking↔"temporarily unavailable" oscillation, preview list gone, Save works,
  Discard NOT required to recover.
- E: open the preview → the list builds ONCE (no empty/reload flicker).
- G (#7): during an AI run's page-blocking phases → the page is blocked (curtain);
  during popup-only phases the page stays interactive.
- H: marking-mode hover on the heavy page feels light.
- Close-out retests (light page): #1 discard-confirm, #2 disable-marking-confirm,
  #3 navigate-away-confirm all appear on a dirty session; #9 inspection overlay
  clears on its own.

# ACCEPTANCE (whole handoff)
- Huge-DOM pages are responsive: snapshot fast (Phase D), preview builds once
  (Phase E), exit works in one click (Phase F), page blocked during AI run
  (Phase G), marking hover light (Phase H).
- #6/#11/#12 fixed with tests; #5 verified/closed; resolved items closed.
- Consult-architect skill in place.
- Every phase committed + pushed on `main`, graph reindexed, gate green.
