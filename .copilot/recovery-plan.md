# Unfluffify Clean-Rebuild Recovery Plan

> Status: **CONFIRMED — implementation in progress on branch `recovery/clean-rebuild`.**
> Base commit: `0a07bcd5a74a3c395c08914558b87810598ae7e3` ("Merge marking latency optimization").
> Range analyzed: `0a07bcd..HEAD` = **53 commits** + uncommitted working-tree changes (7 files).
>
> **Reconstruction method:** branched clean from base; ported the *committed* HEAD tree as the
> genuine feature baseline (435/435 tests green, proving the committed features A–F are sound and
> test-locked); **excluded** the corrupted uncommitted curtain WIP (stashed on `main`). The
> remaining work is layered as focused commits: (1) clean curtain reconciliation, (2) the two
> user-directed marking-contract corrections + docs/tests, (3) version bump to `1.2.0`.

## 1. Strategy

Rebuild the genuine, durable feature set on a fresh branch off the known-good base, **re-deriving each feature cleanly** instead of replaying the messy commit sequence. The HEAD code is treated as a strong behavioral *reference* and the contract docs (`.copilot/plan.md`, `.copilot/knowledge.md`, `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `PROPERTY_LOCK.md`, `REMOTE_SUPPORT.md`) as the *spec of intent*, but the drift, "potential fix" auto-commits, superseded iterations, and corrupted in-progress edits are dropped.

### Why a rebuild and not a cherry-pick
- The 53 commits contain heavy churn: 4× "Potential fix for pull request finding", 3 merge commits, and several "Refactor … to improve clarity" passes that supersede each other.
- The uncommitted work is **corrupted**: in `popup/ui.js`, `syncBlockingUiCurtainDom` is defined as a named function *expression* (IIFE) wedged inside `renderBasePageMenu`'s `h()` call rather than as a module-scope declaration. It passes `node --check` but throws a runtime `ReferenceError` when `renderApp()` and `setUiBusy()` call it. Replaying it verbatim re-imports the breakage.

## 2. Working principles (do not violate)

- **Marking-rules contract is locked** to the approved `052c164b…`-derived behavior plus documented safeguards. Do not change taxonomy, target resolution, sync semantics, overlay projection, or default-exclusion behavior. Any legitimate change must update all four contract docs + focused tests in the same commit. (Source: `.copilot/knowledge.md`.)
- **Remote support is view-only.** Do not reintroduce supporter remote-control or control handoff/takeover paths.
- **Manifest version bumps to `1.2.0`** for this recovery work (user directive). Bump to `2.0.0` later, only when the user confirms things are stable.
- **Deliberate marking-contract change (user directive):** rendering precedence is **defaults → CSS/AI selector influence → current-session explicit** — there is **no separate "backend-saved explicit" rendering layer**. Saved/loaded page markings exist only to construct the AI payload for *other* pages from the current page's live data; they are not replayed as an overlay precedence layer. This supersedes the HEAD `.copilot/knowledge.md` precedence (which listed a backend-saved explicit layer) and must be reflected in all contract docs + tests in the same commit.
- Every feature lands with the focused tests that lock it. Run the focused suites before each commit.

## 3. Branching step (first implementation action, after confirmation)

```
git stash push -u -m "pre-recovery WIP (corrupted curtain edits)"   # preserve, do not lose
git switch -c recovery/clean-rebuild 0a07bcd5a74a3c395c08914558b87810598ae7e3
```
The stash retains the uncommitted edits for reference (their *intent* is reimplemented in Phase 3). The new branch starts from the clean base; `main` is left untouched.

## 4. Feature extraction inventory

Each unit lists: the genuine behavior, the concrete implementation surface, the originating commits to honor, and the noise to skip.

### Unit A — Page motion freeze + reveal-scroll inspection + lazy-load suppression
**Genuine behavior**
- Page-world freeze script (`common/page-motion-freeze.js`) wraps `setTimeout/setInterval/requestAnimationFrame` (+ cancels) and defers callbacks while `paused`; flushes on resume. Exposes `init()`, `setPaused()`, `setLazyLoadingSuppressed()` via a versioned `postMessage` control channel (`unfluffify:page-motion-freeze-control:v1`).
- Lazy-load suppression: wraps `IntersectionObserver`/`ResizeObserver` constructors and `scroll`/`wheel`/`touchmove` listeners; while suppressed, callbacks are dropped (not deferred); restored on unsuppress.
- Content-side multi-reason pause: `pausePageMotion(reason)`/`resumePageMotion(reason)`/`refreshPageMotionPause()` with a `reasons` Set so marking and silent-highlighting cannot resume each other; page stays frozen until `reasons.size === 0`. Broad coverage: CSS anim/transition, Web Animations, SVG clocks, media autoplay, hover candidates, computed inline motion locks, page-world timer/rAF gate. Excludes extension-owned UI; normalizes layout-present scroll/viewport/attribute-driven reveal candidates (incl. Webflow `data-w-id`) to visible posture. Snowflake/code MDI indicator without injecting global `.mdi` styles.
- Reveal sequence before freeze: `revealPageContentBeforeMotionPause()` saves scrollY, scrolls top/bottom with smooth-scroll + `scrollend` settle (`PAGE_INSPECTION_SCROLL_SETTLE_MS=220`, tolerance 2px, 8s cap), activates lazy-load suppression after the first bottom scroll, repeats while scroll range grows, restores the reserved scroll point.
**Implementation surface:** `common/page-motion-freeze.js`; `content/core.js` (`revealPageContentBeforeMotionPause`, `scrollPageInspectionTo`, `waitForPageInspectionScrollEnd`, `suppressPageInspectionLazyLoading`, `pausePageMotion`/`refreshPageMotionPause`/`resumePageMotion`, `ensurePageMotionFreezeScript`, `setPageMotionFreezeTimersPaused`, `setPageMotionFreezeLazyLoadingSuppressed`, `postPageMotionFreezeControl`, `PAGE_MOTION_PAUSE_*`/`PAGE_INSPECTION_*` constants); `common/constants.js`.
**Honor commits:** `988e362`, `8187a33`, `799dd33`, `3768262`, PR #33 net result (`11a4bcb`/`43b77d4`), final reveal-scroll result of `ee69a16`→`8557458` cluster.
**Drop/fold:** `45d7174`, `20caae4`, `2852e52`, `0bfa75d`, `68dcc8b`, `8557458`, `edc6d72`, `34ce669`, `6eec159`, `3b5630a`, `dd99ccf` (iterative polish — implement only the final coherent result); `11a4bcb` (auto "potential fix").
**Tests:** `tests/page-motion-freeze.test.js`, `tests/core-motion-pause.test.js`.
**Cleanup-fix to apply (was a HEAD risk):** ensure pause-reason and lazy-load-suppress restorers are released on abnormal/`disable()` exit so freeze/suppression cannot leak.

### Unit B — Marking lifecycle (precedence, caching, settle renders, fast toggle, session save/discard, AI gating, editor reveal)
**Genuine behavior**
- Precedence (**revised per user directive**): **defaults → CSS/AI selector influence → current-session explicit**. There is **no backend-saved explicit rendering layer**: AI-detected (CSS/AI selector) markings are authoritative except where the user is actively changing markings in the current session. Backend save/load of page markings is **only** for assembling the AI payload for other pages from the current page's live data — it does not feed overlay precedence. Implication: drop the saved-vs-session explicit *rendering* split (`splitExplicitMarkingCollectionsBySavedState` is not used to add a saved overlay layer); keep only session-explicit override of selector influence.
- Overlay collection cache keyed by `{pageUrl, selectorSet, entry-fingerprint}`; stale keys force rebuild; reposition-only renders reuse cache.
- Three forced invalidating settle renders at `[180, 700, 1800]ms` after enable (`scheduleMarkingSettleRenders`/`clearMarkingSettleRenders`) to catch late DOM/layout.
- Fast explicit-toggle path: `refreshExplicitMarkingOverlay()` syncs then redraws explicit layers only; structural toggles run the invalidating full render immediately; leaf explicit-exclude toggles patch cached lower-priority collections and debounce the full render (`EXPLICIT_TOGGLE_DEFERRED_FULL_RENDER_DELAY_MS=180`). Rapid toggles coalesce into one frame.
- `setEnabled` is the single activation path (no redundant immediate `forceRefresh`).
- **Session save (unchanged):** save uploads all local marked pages for the property (`includeAllLocalPageMarkings: true`) and clears reconciliation only after a forced backend reload confirms the page; AI must be re-run after local marking changes before save is enabled (`doesSessionRequireAiRun`, `sessionRequiresAiRun`); exiting marking blocked until saved or discarded.
- **Session discard/revert (revised per user directive):** discard simply **reverts the current page's markings to the defaults → CSS/AI selector influence baseline** (drops the current-session explicit deltas) and **saves nothing** — no backend upload, no `forceReloadPageEntry` round-trip required for the revert itself. After revert the page shows the AI/selector baseline as if no session edits were made.
- **Todo-list completion (clarified per user directive):** a page is marked done in the Todo List **only when the AI has been run and the page has been saved** — never merely by enabling marking mode or having local draft edits.
- Editor-role reveal-once then stay frozen across silent-highlighting/marking even when selectors produce no boxes.
**Implementation surface:** `content/core.js` (collection precedence, cache key, settle scheduling, fast-toggle, `enableForBaseUrl`/reveal); `popup.js` (`handlePageSave`, `handlePageRevert`, AI-gating); `common/page-save-state.js` (`buildPageSaveUiState`, pending/AI-run flags); `common/config.js`.
**Honor commits:** `3fff6a7`, `5957708`, `cff454a`, `cef20f2`, `112d821`, `e7a9749`.
**Drop:** `e6a8e0a`, `9f8173b`, `6c02db2` (refactor churn — fold their net effect into clean code).
- **Tests:** `tests/core-scheduling.test.js`, `tests/selector-suppression.test.js`, `tests/silent-highlight-annotations.test.js`, `tests/page-save-state.test.js`, `tests/popup-marking-refresh.test.js`. **Update/replace** any test that asserts a backend-saved explicit rendering layer or saved/session split, and add a test asserting discard reverts to the defaults+selector baseline without uploading.

### Unit C — Spinner keyed queue + busy-curtain reconciliation + reload restoration + activation order (the corrupted zone — rebuild cleanly)
**Genuine behavior**
- Persistent keyed spinner queue: `popupSpinnerQueue = Map<key,{message,persistent}>`, per-tab `chrome.storage` persistence (`persistSpinnerQueueToStorage`/`restoreSpinnerQueueFromStorage`/`buildSpinnerQueueStorageRecord`), `pushSpinner`/`popSpinner`/`setSpinnerMessage` with `suppressIfActive`, in-place upsert, top-key message resolution, per-tab serialized storage ordering, orphan cleanup for inactive tabs (`popupSpinnerKeyTabIds`). `navInspect` key preserved across tab activation; persistent-only record persisted on tab switch.
- Busy-curtain reconciliation (intent from uncommitted work, **reimplemented cleanly at module scope**):
  - `syncBlockingUiCurtainDom()` as a **module-scope function** in `popup/ui.js` that directly toggles `body.is-busy` and `#ui-curtain.hidden`/title/hint/timer from `getBlockingUiCurtainState(viewState)`. `renderApp()` calls it; `setUiBusy()` wraps `setViewState` in try/catch and falls back to `normalizeViewState` + `syncBlockingUiCurtainDom()` + `notifyViewStateListeners()` when Preact render aborts on the persistent curtain node.
  - `scheduleStaleInspectionBusyClear()` in `popup.js`: bounded retry (≤12, 150ms then 400ms) that clears a stuck `pageInspection` busy curtain once the queue is empty and runtime status reports no real inspection pending; invoked from `popSpinner`.
  - `getInspectionStatus` in `content-main.js`: `propertyLockEditorClaimPending` is split out of `editorPreparationPending` into a separate `lockClaimPending` flag so a lingering property-lock claim handoff cannot keep `pending` true. (See Unit E.)
  - `finishPageInspectionUiAfterRender()` in `content/core.js`: poll on `extensionSetTimeout(…,50)` (not rAF), and after `PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS=3000` force `flushPendingInspectionRender()` so the inspection blocker cannot outlive the enable response.
  - `refreshUiInner` uses `let` for `contentInspectionPending`/`restoreInspectionPending`/`inspectionStatus`, prefers the latest runtime status response, and clears `restoreInspectionPending` once a real runtime response is observed (`runtimeStatusBaseUrl` fallback).
- Reload restoration: tab-state restore path keeps the inspection curtain active while enabled pages re-inspect after reload (`navigationInspectionPending`, `beginNavigationInspectionOverlay`/`endNavigationInspectionOverlay`/`scheduleNavigationInspectionSettlePoll`, `getTabState(...,"restore")`).
- Page-inspection status messages (`cbf0f4c`): new `PopupText.overlay.pageInspection` and related copy.
**Implementation surface:** `popup.js`, `popup/ui.js`, `popup/messages.js`, `popup/state.js`, `content-main.js`, `content/core.js`, `background.js`, `content-loader.js`, `common/constants.js`.
**Honor commits:** `08e573e` (queue core), `60b64c2`, `c5ff01e`, `1ef6645`, `2471619`, `2e74ecb` (reload restore), `cbf0f4c` (messages), `daa37c3` (curtain reconcile), and the **intent** of the uncommitted edits.
**Drop:** `813d54c`, `d512a98`, `096999d` (auto "potential fix" churn), `89c416e` (merge).
**Tests:** `tests/popup-marking-refresh.test.js`, `tests/content-activation-order.test.js`, `tests/core-scheduling.test.js` — including the uncommitted test deltas (`lockClaimPending`, `syncBlockingUiCurtainDom`, `setUiBusy` try/catch, `scheduleStaleInspectionBusyClear`, `flushPendingInspectionRender`, `PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS`, `let` inspection flags).
**Explicit fix vs HEAD:** declare `syncBlockingUiCurtainDom` at module scope in `popup/ui.js` (NOT inside `renderBasePageMenu`).

### Unit D — Mobile-simulation default, render-mode status chip, remote-support error UI
**Genuine behavior**
- Mobile sim default-on for a fresh tab session (`ensureDefaultMobileDeviceEmulation`, `ensureDefaultMobileEmulationForTab` in `background.js`), with user-disable preserved as a per-session choice across navigation/reload cleanup and preserved through Render Mode inspection cleanup.
- Render Mode presented as an informative status chip (`role=status`, `aria-live=polite`) with `getRenderModeOptionLabel`/`getRenderModeOptionIcon` and safe confirm-only messaging (`resolveRenderModeInspectionReloadOutcome`); labels static/JavaScript/undetermined.
- Remote-support: port-disconnect `lastError` consumption, error normalization + dismissible error notice UI (`#uf-support-page-error*`, `renderRemoteSupportErrorNotice`), data-channel fallback chunking, inactivity countdown notice, removal of deprecated inline join form / sidebar / connect cards, explicit view-only copy.
**Implementation surface:** `common/emulation.js`, `background.js`, `popup/render-mode.js`, `popup/ui.js`, `common/text.js`, `common/remote-support.js`, `common/remote-support-background.js`, `remote-support-offscreen.js`, `remote-support-viewer.js`, `theme-components.css`.
**Honor commits:** `828de50`, `379529a`, `8cf51d2` (net mobile-sim default), `9077925`, `b71f095` (render chip), `52e2c82`, `999198b` (remote error UI).
**Tests:** `tests/device-emulation-lifecycle.test.js`, `tests/popup-render-mode.test.js`, `tests/remote-support-*.test.js`.

### Unit E — Property lock + interaction-block messages
**Genuine behavior**
- `PROPERTY_LOCK_CONTENT_RELEASE` content-lock release management; `warmupPageRevealBeforeMotionPause` page-reveal optimization; `refreshFromTabState` initial-reveal option; `toggleEnabledFromPage` user-facing error feedback; interaction-block message copy (`common/text.js`) for property-lock claim/handoff. Claim handoff (`propertyLockEditorClaimPending`) must not keep inspection `pending` true (ties into Unit C `lockClaimPending`).
**Implementation surface:** `content-main.js`, `content/core.js`, `background.js`, `popup/messages.js`, `common/text.js`, `PROPERTY_LOCK.md`.
**Honor commits:** `282b401`, `a4f58c2`.
**Tests:** `tests/property-lock.test.js`, `tests/content-activation-order.test.js`.

### Unit F — Theme `--warn-ink` + dev infra (lower priority, near-mechanical)
**Genuine behavior**
- Introduce `--warn-ink` warning-color variable used consistently across `popup.css`, `theme-color.css`, `theme-components.css`, `theme-utilities.css`; lock with `tests/theme-colors.test.js`.
- Dev infra config: `.vscode/mcp.json`, `.vscode/browser-mcp.config.json`, `.mcp.json`, `.codex/config.toml`, `.gitignore` updates, Playwright managed-code project scaffolding. Bring over the **final** resolved config only.
**Honor commits:** `aff0698` (theme), `2818346`+`2699d25` (final infra config), `58631c8` (keep version `1.1.0`).
**Drop:** treat the version revert as "final state = 1.1.0", not as a step to replay.

## 5. Implementation sequence (after confirmation)

Dependency-ordered phases, each ending with focused tests + a clean commit:

1. **Branch + infra/theme baseline** — create branch; apply Unit F (theme variable + infra config). Cheap, isolating.
2. **Unit A — page motion freeze + reveal + lazy-load** — foundational; marking/silent-highlight depend on it.
3. **Unit E — property lock + interaction messages** — provides `warmupPageRevealBeforeMotionPause`, `PROPERTY_LOCK_CONTENT_RELEASE`, `lockClaimPending` groundwork.
4. **Unit B — marking lifecycle** — precedence, cache key, settle renders, fast toggle, session save/discard, AI gating, editor reveal.
5. **Unit C — spinner queue + curtain reconciliation + reload restoration** — built last because it observes inspection/reconciliation state from A/B/E; reimplement the curtain reconciliation **cleanly** (module-scope `syncBlockingUiCurtainDom`, `setUiBusy` fallback, `scheduleStaleInspectionBusyClear`, `flushPendingInspectionRender`, `lockClaimPending`).
6. **Unit D — mobile sim default + render chip + remote-support error UI** — largely independent surface.
7. **Docs sync** — reconcile `.copilot/knowledge.md`, `.copilot/plan.md`, `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `PROPERTY_LOCK.md`, `README.md` to the rebuilt state in the same commits as the behavior they describe.

## 6. Validation strategy

- Full suite: `npm test` (Node test runner, `--test-force-exit`).
- Focused marking guard suite before marking commits:
  `node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`
- `node --check` on every edited JS file (catches the IIFE-misplacement class of bug — note it does NOT catch module-scope reference errors, so also run the popup tests which assert `syncBlockingUiCurtainDom` is a module-scope declaration).
- Live Playwright MCP validation of the busy-curtain on a real page (bonliva) using the tab-scoped debug harness (`localStorage.ufDebugSpinnerQueue="1"`, `?debugTabId=`), confirming `Inspecting page...` hides after reveal/freeze and does not get stuck.

## 7. Commit classification summary (53 commits)

- **Honor (net result):** `3768262`, `8cf51d2`, `58631c8`(→1.1.0), `aff0698`, `ee69a16`(final), `e7a9749`, `828de50`, `379529a`, `9077925`, `52e2c82`, `999198b`, `b71f095`, `282b401`, `988e362`, `cff454a`, `3fff6a7`, `2818346`, `5957708`, `2699d25`, `cef20f2`, `112d821`, `8187a33`, `799dd33`, `cbf0f4c`, `2e74ecb`, `08e573e`, `60b64c2`, `c5ff01e`, `1ef6645`, `2471619`, `a4f58c2`, `daa37c3`, **+ intent of uncommitted curtain edits**.
- **Fold into final result (iterative polish, do not replay individually):** `20caae4`, `2852e52`, `0bfa75d`, `45d7174`, `edc6d72`, `34ce669`, `6eec159`, `3b5630a`, `dd99ccf`, `68dcc8b`, `8557458`.
- **Drop (refactor churn):** `e6a8e0a`, `9f8173b`, `6c02db2`.
- **Drop (auto "potential fix" noise):** `813d54c`, `d512a98`, `096999d`, `11a4bcb`.
- **Drop (merge commits):** `bc86825`, `43b77d4`, `89c416e`.

## 8. Open decisions / assumptions (made autonomously; flag for review)

1. Branch name `recovery/clean-rebuild`; `main` left untouched; current WIP stashed (not discarded). *(confirmed)*
2. Curtain reconciliation reimplemented from the uncommitted *intent*, fixing the module-scope bug, since live notes show the stuck-curtain bug is the active failure. *(confirmed)*
3. Manifest version → `1.2.0` now; `2.0.0` later on user's signal when stable. *(confirmed)*
4. Marking taxonomy/target-resolution/sync/overlay-projection stay locked, **except** the user-directed precedence change (no backend-saved explicit rendering layer) and revert-to-baseline discard semantics, which are applied and documented across all contract docs.
5. Final end-state = HEAD's intended contract, minus drift, minus corrupted implementations, **plus** the two user-directed marking-contract corrections (precedence + discard).
