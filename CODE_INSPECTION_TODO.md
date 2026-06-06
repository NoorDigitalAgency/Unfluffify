# Code Inspection Todo

Review target: `recovery/clean-rebuild` at `d8a78fdfb80bdeab39933a49f93b47957fd32098`.

Scope reviewed:
- Latest commit contents: docs-only changes in `.copilot/next-agent-handoff.md` and `.copilot/plan.md`.
- Current branch state against `origin/main`: extension runtime, popup/content/background lifecycle, property lock, remote support, packaging, tests, and locked docs.

Checks run on 2026-06-06:
- `npm test` on Node `v22.22.1`: passed, but reported `515` tests, not the documented `532`.
- `node --check popup.js`
- `node --check background.js`
- `node --check content-main.js`
- `git ls-files '*.js' '*.mjs' | xargs -n 1 node --check`
- `npm run package:extension -- --stage-dir .tmp/review-package --metadata-file .tmp/review-package-metadata.json`

Do not treat this file as approval to change the locked marking contract. Each item below should be fixed with focused tests and then re-run the relevant full and focused suites.

## Second-reviewer verification (2026-06-06, HEAD `93df272`)

A second pass re-checked every item against the current code. Result: **all 9
items AGREED / confirmed; none removed.** Per-item verification notes are added
inline under each heading as `> Verified:` blocks. One refinement: item 6's
root cause is the `--test-force-exit` flag (non-deterministic count), not
dropped tests — details under item 6.

Determinism note observed during this pass: `npm test` reported `532`, `521`,
`482`, `463`, and `515` tests across five consecutive runs, always with
`# fail 0`. The suite is green; the count is unstable by harness design.

## 1. High: page-motion freeze bridge is injected on every page and is publicly controllable

> Verified: AGREE. `content-loader.js:63` calls
> `ensurePageMotionFreezeBootstrapScript()` unconditionally; `manifest.json:32`
> matches `<all_urls>`. `common/page-motion-freeze.js:433` runs
> `initLazyLoadingBridge()` immediately, which wraps `IntersectionObserver`,
> `ResizeObserver`, and `addEventListener` (lines 166-173) before any
> activation. `page-motion-freeze.js:401` gates control only on the static
> `CONTROL_MARKER` ("unfluffify:page-motion-freeze-control:v1", line 11), and
> the listener is installed at line 435 — so any same-window page script can
> drive pause/suppress. Security + fingerprint + compatibility risk all real.

Files and lines:
- `content-loader.js:22-63` injects `common/page-motion-freeze.js` at content-loader startup for every matched page.
- `common/page-motion-freeze.js:396-421` accepts `window` message commands based only on the public marker string.
- `common/page-motion-freeze.js:424-436` exposes a predictable global state object and installs the message listener.
- `common/page-motion-freeze.js:433` initializes the lazy-loading bridge immediately, before an explicit extension activation.

Why this is problematic:
- The content script matches `<all_urls>`, so inactive pages receive a page-world script before the user enables Unfluffify.
- The control marker is static (`unfluffify:page-motion-freeze-control:v1`). Any page script can send a same-window `postMessage` with that marker and command the bridge to pause timers/animation frames or suppress lazy-loading listeners.
- The bridge also wraps page APIs (`IntersectionObserver`, `ResizeObserver`, `addEventListener`) before activation. Even when suppression is false, this changes observable page runtime behavior and gives sites a strong extension fingerprint.
- This is both a security/abuse risk and a compatibility risk: a page can deliberately or accidentally freeze itself through the extension's bridge.

Requested fix:
- Do not install the page-world bridge on every page at content-loader startup. Load it just in time when a real reveal/freeze operation starts.
- Avoid a long-lived public `postMessage` command surface if possible. Prefer one-shot MAIN-world script execution for pause/unpause operations, or another design that does not let arbitrary page scripts issue commands.
- If a bridge remains necessary, add a design note explaining why page scripts cannot spoof controls. A simple token sent through `window.postMessage` is probably not sufficient because page listeners can observe window messages.
- Add regression coverage that an inactive page does not have page APIs wrapped, does not expose the bridge global, and cannot pause timers by posting the public marker before extension activation.

## 2. High: popup still restores retired reload state and can re-enable marking from stale `restore` scope

> Verified: AGREE. `popup.js:3936-3939` reads `restore` scope as a fallback
> when live state is missing; `popup.js:8688-8702` reads `restore` on tab
> update and writes it back into live state via `messages.setTabState(tabId,
> tabState)` at line 8702. Background still defines `getReloadRestoreTabState`
> (`background.js:2729`) and uses it from `clearReloadRestoreTabStateAfterActivation`
> (`background.js:2748`). Writers were removed in the prior session, but a
> stale `tabState:restore:*` key from an older build can still be promoted back
> into live state and resurrect marking UI — contradicts the no-auto-restore
> contract.

Files and lines:
- `popup.js:3935-3939` falls back to `messages.getTabState(tabId, "restore")` when live tab state is missing.
- `popup.js:4815-4825` treats that restore state as an inspection-pending enabled state.
- `popup.js:8688-8703` reads `restore` during tab updates and writes it back into live tab state via `messages.setTabState(tabId, tabState)`.
- `background.js:2707-2742` still defines restore-scope helpers even though writers were removed.
- Tests currently assert this stale behavior in `tests/popup-marking-refresh.test.js:626-645`.

Why this is problematic:
- The branch handoff says auto-restore is retired and stale restore entries must not leak through. The popup still has a path that promotes a legacy `tabState:restore:*` value back into live `tabState:*`.
- Even if current code no longer writes restore scope, users can have old session-storage keys from an earlier extension version or from a failed previous run.
- This can resurrect marking/inspection UI after navigation cleanup and contradicts the editor-mobile-only/no-auto-restore contract.

Requested fix:
- Remove popup restore-scope fallback reads from refresh and tab-update paths, or convert them into explicit cleanup-only reads that clear the legacy key without using it as live state.
- Delete or quarantine dead background restore helpers once no runtime path needs them.
- Update tests that currently assert restore fallback behavior so they assert retired auto-restore behavior instead.
- Add a regression that seeds `tabState:restore:<tabId>` with enabled state, opens/updates the popup, and verifies live `tabState:<tabId>` is not repopulated and marking UI does not turn on.

## 3. High: `disable()` cancels pending draft persistence after clearing the state needed to save it

> Verified: AGREE. `content/core.js:10120` sets `state.baseUrl = ""` and
> `:10122` sets `state.config = null`. The draft-persist fallback at
> `:10159-10166` then checks `if (state.baseUrl && state.config)` before
> calling `saveConfig(...)` — both are already cleared, so the branch is dead
> and the pending draft is never flushed on teardown. Real data-loss-window bug.

Files and lines:
- `content/core.js:9560-9599` schedules debounced snapshot and draft persistence after explicit toggles.
- `content/core.js:10109-10122` clears `state.enabled`, `state.baseUrl`, and `state.config`.
- `content/core.js:10155-10166` then clears `state.snapshotTimer` and `state.draftPersistTimer`; the immediate `saveConfig(state.baseUrl, state.config)` branch can never run because those fields were already cleared.

Why this is problematic:
- A rapid mark/unmark followed by disable, navigation, reload, or content teardown can cancel the pending draft-persist timer before it writes the local marking session.
- The intended fallback save path in `disable()` is dead due to ordering. The code checks `state.baseUrl && state.config` after setting both to empty/null.
- The in-memory `disabledUnsavedDraft` cache is not enough for reload/navigation because it is lost with the content-script lifetime and is intentionally cleared for URL watcher transitions.

Requested fix:
- Capture `baseUrl`, `config`, and current page URL before clearing state.
- Flush or synchronously queue the pending draft and any required snapshot before canceling timers.
- Decide whether `scheduleSnapshotSave` also needs a teardown flush, because AI/save evidence can be stale if the snapshot timer is dropped.
- Add a regression that schedules draft persistence, calls `disable()`, and verifies `saveConfig` is attempted with the original base URL/config before state is cleared.

## 4. Medium-high: async marking reconciliation can ignore aborts after candidate merge and still persist stale results

> Verified: AGREE. The last `shouldAbort` check is at `content/core.js:11226`.
> After it, the silent-whitespace merge loop (`:11247`), both previous-item
> loops (`:11265`, `:11297`), the `changed` computation, the
> `entry.xpaths = items` mutation (`:11336`), and the persist
> (`setPageMarkingEntry`, `:11351`) all run with no further abort/yield. A
> newer toggle generation that starts mid-loop cannot stop the stale write.

Files and lines:
- `content/core.js:11033-11228` handles `shouldAbort` through async candidate collection and merge.
- `content/core.js:11235-11351` then processes silent-whitespace candidates and previous explicit items without further abort/yield checks before mutating `entry.xpaths` and persisting the entry.

Why this is problematic:
- `scheduleAsyncExplicitToggleReconcile()` uses a generation-based abort to prevent stale toggle reconciles from winning. That protection stops after candidate merge.
- On large pages, later loops can still be expensive and can mutate `entry` after a newer toggle generation has started.
- This undermines the responsiveness work and can make the final stored marking state depend on which async reconcile finishes last.

Requested fix:
- Add `shouldAbort` checks and periodic yields in the silent-whitespace and previous-item loops.
- Prefer building a local next-entry object and only assigning `entry.xpaths` / `silentWhitespaceExcludedXpaths` after the final abort check.
- Add tests that force an abort after candidate merge and verify no entry mutation/persist occurs.

## 5. Medium: SPA/hash URL changes bypass the pending-session discard guard

> Verified: AGREE. `content/core.js:9289-9296` polls `location.href` and calls
> `disable({ preserveUnsavedDraftCache: false })` on ANY change, including
> `history.pushState`/`replaceState`/hash. `handleBeforeUnload` (`:10261`) only
> fires on real unloads, so same-document URL changes silently drop the draft
> with no save/discard prompt. Compounds with item 3's teardown ordering.

Files and lines:
- `background.js:2643-2644` disables marking on `onHistoryStateUpdated` and `onReferenceFragmentUpdated`.
- `content/core.js:9288-9294` polls `location.href` and calls `disable({ preserveUnsavedDraftCache: false })` when the URL changes.
- `content/core.js:10261-10270` only prompts through `beforeunload`, which does not cover normal History API or hash changes.
- Popup-initiated navigation has a discard confirmation, but page-initiated same-document changes do not.

Why this is problematic:
- Modern sites frequently use `history.pushState`, `replaceState`, or hash navigation without a page unload.
- A dirty marking session can be disabled without the same save/discard decision the popup requires for user-initiated navigation.
- Combined with the draft-persist teardown ordering issue above, rapid edits are especially vulnerable.

Requested fix:
- Define the intended behavior for active dirty marking sessions on same-document URL changes.
- If the URL remains within the same base URL, consider preserving the draft and surfacing a blocking/recovery UI instead of silent disable.
- If marking must stop, ensure the user-visible save/discard contract is still honored as much as the platform allows, and never clear the only local draft copy without a persisted replacement.
- Add tests for dirty session plus `pushState`, `replaceState`, and hash changes.

## 6. Medium: latest handoff commit records an incorrect full-suite test count

> Verified: AGREE, with root-cause refinement. The count is non-deterministic,
> not simply wrong, and no tests were dropped. `package.json` runs
> `node --test --test-force-exit`; `--test-force-exit` terminates the process
> as soon as top-level tests settle, truncating the still-incrementing subtest
> counter. Five consecutive runs reported 532 / 521 / 482 / 463 / 515, always
> with `# fail 0`. Recommended fix is therefore to (a) stop quoting a fixed
> number in handoff/plan docs and instead state "all green; count varies due to
> --test-force-exit", and/or (b) drop `--test-force-exit` (or replace it with a
> clean teardown) so the count stabilizes, then quote the stable number.

Files and lines:
- `.copilot/next-agent-handoff.md:23` says `532/532`.
- `.copilot/plan.md` latest Phase 2 notes also reference `532/532`.

Why this is problematic:
- Running `npm test` on this checkout with Node `v22.22.1` passed but reported `515` tests.
- The latest commit is specifically a handoff/status update, so an incorrect validation count is part of the reviewed change.
- Future agents may waste time looking for missing tests or assume a different suite was run.

Requested fix:
- Update the handoff and plan to the reproducible count, or document the exact counting method/environment that produces `532`.
- If tests were unintentionally dropped, restore them and make the suite count align with the handoff.

## 7. Medium-low: Save Session can retry forever without a cancellation or terminal failure path

> Verified: AGREE. `popup.js:7527` is `while (true)` around
> `syncBaseConfigToServer({ ..., maxAttempts: 1 })`. Success (`:7538`),
> `authExpired` (`:7549`), and `skipped` (`:7552`) all `return`, but any other
> retryable failure falls through to `:7557-7559` (busy text + backoff capped
> at 10s) and loops forever. No bounded retry count and no user cancel path.

Files and lines:
- `popup.js:7527-7560` loops `while (true)` around `syncBaseConfigToServer`.
- `popup.js:7536` calls the sync helper with `maxAttempts: 1`, then the outer loop retries indefinitely.
- `popup.js:7557-7559` only updates busy text and backs off up to 10 seconds.

Why this is problematic:
- A persistent backend/network failure can trap the popup in a busy save state indefinitely.
- Users have no visible cancel path and no bounded failure state for a save that will not recover.
- This also complicates automated validation because a hung save can look like a still-running operation rather than a failed one.

Requested fix:
- Add a bounded retry policy, cancel action, or explicit "retry later" failure state while preserving the no-data-loss contract.
- Add tests for repeated retryable failures and user cancellation/terminal failure behavior.

## 8. Low: stale names/comments conflict with the locked marking and restore contracts

> Verified: AGREE. `common/constants.js:27` comment says default-excluded tags
> "cannot be toggled", but `DEFAULT_EXCLUDED_TAG_SELECTORS` (`:30`) contains
> FOOTER/FORM/NAV/HEADER etc. that also appear in
> `DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS` (`:57`) — the comment is inaccurate.
> `tests/marking-rules.test.js:178` test name says "links immutable" while its
> body (`:208-209`) correctly asserts LINK is omitted from both taxonomies.
> `tests/device-emulation-lifecycle.test.js:278` is still named "completed
> reload restores marking" though auto-restore is retired. All cosmetic; no
> runtime impact, but misleading to the next agent.

Files and lines:
- `common/constants.js:26-28` says all default excluded tags "cannot be toggled", but the same list includes toggleable defaults.
- `tests/marking-rules.test.js:178` says "links immutable", while `tests/marking-rules.test.js:208-209` correctly asserts `LINK` is omitted from both taxonomies.
- `tests/device-emulation-lifecycle.test.js:278` still names a test "completed reload restores marking" after auto-restore was retired.

Why this is problematic:
- The repo relies heavily on source-pattern tests and handoff docs. Misleading names/comments can send the next agent toward the wrong contract.
- These do not currently break runtime behavior, but they increase the chance of future "fixes" reintroducing retired behavior.

Requested fix:
- Rename stale tests and update comments to match the current locked contract.
- Keep the actual assertions aligned with the docs: `LINK` is omitted, toggleable defaults are user-toggleable, and reload auto-restore is retired.

## 9. Low: content loader writes debug-style logs into every matched page console

> Verified: AGREE. `content-loader.js:73` and `:77` log content-main load
> status; `:89` logs "Initializing content main"; `:102` logs
> `"Content loader received message:"` with the full message object;
> `content/core.js:9362` logs `"Restored scrolling on", element.tagName`. All
> run unconditionally on `<all_urls>` pages and are not gated behind trace mode.

Files and lines:
- `content-loader.js:72-85` logs content-main load status.
- `content-loader.js:101-103` logs every activation message received by the loader.
- `content/core.js:9361-9363` logs scroll restoration for consent handling.

Why this is problematic:
- The extension runs on all URLs. These logs can pollute customer page consoles and remote-support telemetry.
- The activation log includes the whole message object, which is not needed for normal operation.
- This also creates another fingerprint that the extension is present.

Requested fix:
- Gate these logs behind the existing trace/diagnostic mode or remove them.
- Add a lightweight source-pattern test if the project wants production content scripts to stay quiet by default.
