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

## 1. High: page-motion freeze bridge is injected on every page and is publicly controllable

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
