# Code Inspection Remediation Plan

Source findings: `CODE_INSPECTION_TODO.md` (9 items, all second-reviewer
verified at HEAD `d59ba49`). This document turns those findings into an
ordered, phased fix plan with explicit acceptance criteria and a test plan
for each item. **Planning only — do not change the locked marking contract.**

## Q&A Decisions Recorded Before Implementation

The user answered the pre-implementation Q&A on 2026-06-06. Treat these as
binding choices for the remediation work:

1. **Page-motion bridge:** remove startup injection, remove the persistent
   public `postMessage` listener, and use just-in-time MAIN-world execution
   only when pause/unpause is needed.
2. **Same-document URL changes:** for dirty same-base URL changes, preserve
   the draft and enter the existing temporary-disabled/recovery path; for
   cross-base changes, keep the current disable behavior.
3. **`disable()` teardown:** flush both pending draft persistence and pending
   page snapshot work using captured pre-clear `baseUrl`/`config`, but only
   when the corresponding timer was actually pending.
4. **Save Session retry UX:** use a bounded retry policy plus a visible
   terminal failure state, preserving the local draft. Do not add a new cancel
   button unless the existing UI has a natural action slot.
5. **Test-count stability:** first try the technical fix: remove
   `--test-force-exit`, identify and clean up open handles/timers, and make
   the test count stable.
6. **Content-script logs:** remove production content-script logs entirely
   unless they are already part of an existing trace/diagnostic mode.
7. **Commit cadence:** one finding per commit where practical, update docs at
   the end of each phase, validate each commit, and push after each validated
   commit.

## How to read this

Each finding is assigned to a phase ordered by severity + blast radius. Within
a phase, items are ordered to land the smallest safe fix first. Every item
lists:
- **Root cause** — the precise reason it is broken.
- **Fix approach** — the intended change (subject to the implementer's judgment).
- **Acceptance criteria** — observable conditions that must hold to call it done.
- **Test plan** — the exact suites/commands and new coverage to add.

## Standing validation rules (apply to every phase)

1. Run the focused marking guard suite before committing any content/marking
   change:
   `node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`
2. Run the full suite: `npm test`. The count is non-deterministic (see
   Finding 6); the pass condition is `# fail 0`, not a specific count.
3. Syntax-check touched entry points:
   `node --check popup.js && node --check background.js && node --check content-main.js`
4. For any content-script behavior change, run a headful live smoke:
   `xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/smoke-ai-submission.mjs https://www.bonliva.no/artikler/barnehagevikar-lonn https://prowork.se/`
   Pass condition: `errs=0`, snapshot persisted, included-row verdicts
   unchanged from the pre-change baseline.
5. One finding per commit (or one tightly-scoped group). Never bundle a
   behavior fix with cosmetic cleanup.
6. Do not weaken the no-auto-restore / editor-mobile-only / marking-rules
   contracts to make a fix easier.

---

## Phase 1 — High severity: security and data integrity

These three are the highest-impact. Land them first, each as its own commit.

**Status 2026-06-06:** Phase 1 is complete. Finding 3 flushes pending
draft/snapshot work before `disable()` clears state; Finding 2 removes stale
restore-scope resurrection; Finding 1 removes startup page-motion bridge
injection and the public marker listener, replacing it with one-shot
MAIN-world execution via background `chrome.scripting.executeScript`. Phase-end
validation passed focused motion tests, the marking guard suite, syntax checks,
full `npm test` (`# pass 530`, `# fail 0` in this run), and live AI-submission
smoke on Bonliva + Prowork (`snapshot.ok=true`, `errs=0` for both).

### 1.1 Finding 3 — `disable()` drops the pending draft (data loss)

Order rationale: smallest, most surgical High fix; pure data-loss prevention;
no contract or design decision needed. Do it first.

- **Root cause:** `content/core.js` `disable()` sets `state.baseUrl = ""`
  (`:10120`) and `state.config = null` (`:10122`) before the draft-persist
  fallback at `:10159-10166`, whose guard `if (state.baseUrl && state.config)`
  is therefore always false. The pending debounced draft is never flushed on
  teardown.
- **Fix approach:** Capture `baseUrl`, `config`, and the current page URL into
  locals at the very top of `disable()` (before any state clearing). When the
  `draftPersistTimer` is cleared, flush using the captured locals, not the
  already-cleared `state.*`. Also flush pending page snapshot work using the
  captured locals when `snapshotTimer` was pending. Do not create spurious
  saves when the corresponding timer was not pending.
- **Acceptance criteria:**
  1. After a rapid mark → unmark → `disable()` sequence with a pending
     draft-persist timer, `saveConfig(...)` is invoked with the original
     base URL and config object.
  2. `disable()` never calls `saveConfig` with `""`/`null`.
  3. No behavior change when there is no pending timer (no spurious saves).
- **Test plan:**
  - New unit test in `tests/page-save-state.test.js` or a new
    `tests/disable-draft-flush.test.js`: import `state`, `disable`, stub/spy
    `saveConfig` (or assert via a captured config write), schedule a draft
    persist, call `disable()`, assert `saveConfig` was called once with the
    pre-clear base URL/config.
  - Source-pattern guard: assert the `saveConfig` flush in `disable()` reads
    from captured locals, not `state.baseUrl`/`state.config`.
  - Full suite + marking guard suite green.

### 1.2 Finding 2 — popup can resurrect marking from stale `restore` scope

Order rationale: contract violation (no-auto-restore) with a concrete leak
path; medium-sized, mostly deletions.

- **Root cause:** `popup.js:3936-3939` falls back to
  `messages.getTabState(tabId, "restore")`; `popup.js:8688-8702` reads
  `restore` on tab update and writes it back into live state via
  `messages.setTabState(tabId, tabState)` (`:8702`). Writers were retired, but
  a legacy `tabState:restore:*` key from an older build can still be promoted
  back into live state and re-enable marking UI. Background still defines
  `getReloadRestoreTabState` (`background.js:2729`) used only by
  `clearReloadRestoreTabStateAfterActivation` (`:2748`).
- **Fix approach:**
  - Remove the `restore`-scope fallback reads in both the popup refresh path
    (`:3936-3939`) and the tab-update path (`:8688-8702`). Replace the
    write-back at `:8702` so it never repopulates live state from restore.
  - Convert any remaining `restore` read into an explicit cleanup-only read
    that deletes the legacy key without using it as live state (belt-and-
    suspenders for users upgrading from an older build).
  - Delete or quarantine the now-unused background restore read helper
    (`getReloadRestoreTabState`) and re-point
    `clearReloadRestoreTabStateAfterActivation` to a direct key removal, or
    remove that helper too if its only purpose was post-restore cleanup.
- **Acceptance criteria:**
  1. With `tabState:restore:<tabId>` seeded to an enabled session and live
     `tabState:<tabId>` absent, opening/refreshing the popup and firing a
     `tabs.onUpdated` does NOT repopulate live `tabState:<tabId>` and does NOT
     turn on marking UI.
  2. The legacy restore key is cleared (not just ignored) after the popup runs.
  3. No remaining runtime path reads `restore` scope as live state.
- **Test plan:**
  - Update `tests/popup-marking-refresh.test.js:626-645` (currently asserts the
    stale fallback) to assert the retired behavior instead.
  - New regression: seed `restore` scope, simulate popup refresh + tab update,
    assert no live-state write and marking stays off. Prefer a source-pattern
    assertion plus, if feasible, a smoke assertion via
    `scripts/smoke-property-lock-phase2.mjs`.
  - Source-pattern guard: `popup.js` no longer contains
    `getTabState(tabId, "restore")` used as a live fallback;
    `setTabState(tabId, tabState)` write-back in `tabs.onUpdated` is gone.
  - Full suite green.

### 1.3 Finding 1 — page-motion freeze bridge on every page, publicly controllable

Order rationale: highest design/security risk but the largest change; do it
last in Phase 1 so the quick data-loss wins land first. May need a short design
note approved before coding.

- **Root cause:** `content-loader.js:63` injects
  `common/page-motion-freeze.js` on every `<all_urls>` page at startup.
  `page-motion-freeze.js:433` runs `initLazyLoadingBridge()` immediately,
  wrapping `IntersectionObserver`/`ResizeObserver`/`addEventListener`
  (`:166-173`) before activation. `:435` installs a `window`-message listener
  gated only on the static `CONTROL_MARKER` (`:11`), so any same-window page
  script can drive pause/suppress.
- **Fix approach (design-first):**
  - **Design note recorded 2026-06-06:** The accepted Option A approach is to
    remove content-loader bootstrap injection and the persistent page-world
    `postMessage` listener entirely. Content code will request pause/unpause
    or lazy-load suppression through the background service worker, which will
    run one-shot `chrome.scripting.executeScript({ world: "MAIN" })` commands
    using a self-contained control function. The MAIN-world state may exist
    only while pause or lazy-load suppression is active, and the control
    function must restore native timer/observer/listener APIs and delete its
    global state when both controls are off.
  - Do not install the page-world bridge at content-loader startup.
  - Remove the long-lived public `postMessage` command surface.
  - Use one-shot MAIN-world script execution (`chrome.scripting.executeScript`
    with `world: "MAIN"`) for pause/unpause, so there is no persistent page-
    controllable listener and inactive pages have no bridge global.
  - Ensure that an inactive page has unwrapped native APIs, no exposed bridge
    global, and cannot be paused by posting the marker.
  - **Before coding:** write a 1-paragraph design note in this file (or the
    handoff) describing the chosen approach; the bridge interacts with the
    locked motion-pause behavior, so confirm no marking/motion-pause contract
    regression.
- **Acceptance criteria:**
  1. On a page where Unfluffify has not been activated: `window.IntersectionObserver`,
     `window.ResizeObserver`, and `window.addEventListener` are the native
     originals; `window.__unfluffifyPageMotionFreezeState` is absent; posting
     the `CONTROL_MARKER` message has no effect (no timers/animation frames
     paused, no lazy-load suppression).
  2. After activation, freeze/reveal still works (motion pause, lazy-load
     reveal, snapshot stripping) — existing
     `tests/page-motion-freeze.test.js` and
     `tests/core-motion-pause.test.js` stay green.
  3. Save snapshots still strip extension-owned pause classes / bridge script
     / inline locks (existing contract).
- **Test plan:**
  - New `tests/page-motion-bridge-isolation.test.js` (source-pattern +,
    where possible, jsdom/eval harness): assert the bridge is NOT initialized
    at content-loader startup and that an unactivated context exposes no
    bridge global and unwrapped APIs.
  - Live smoke: on a normal page without activating Unfluffify, evaluate in the
    page that native observers are intact and the marker is inert; then activate
    and confirm freeze works. Extend `scripts/smoke-ai-submission.mjs` or add a
    dedicated smoke script.
  - Full suite + `tests/page-motion-freeze.test.js` +
    `tests/core-motion-pause.test.js` green.
  - Re-run the marking guard suite (motion pause is part of the contract).
- **Implementation status:** Complete. `content-loader.js` no longer injects a
  page-world script, `common/page-motion-freeze.js` was removed, content sends
  `pageMotionFreezeControl` messages to background, and background executes the
  self-contained `runPageMotionFreezeControl` function in `world: "MAIN"`.
  New guards in `tests/page-motion-bridge-isolation.test.js` lock the absence
  of the startup bridge, static marker, and persistent `message` listener.

---

## Phase 2 — Medium severity: correctness and unsaved-work safety

### 2.1 Finding 4 — async reconcile ignores aborts after candidate merge

- **Status (2026-06-06): complete.** The async reconcile path now defers
  newly-created entry persistence until the final commit point, checks aborts
  after candidate merge, through the silent-whitespace/previous-item loops,
  and immediately before assigning `entry.includeXpaths`, `entry.xpaths`, and
  `silentWhitespaceExcludedXpaths`. Late loops also yield through the existing
  toggle reconcile slice interval. Regression tests cover both an existing
  entry left untouched after a late abort and a newly-created entry that is not
  inserted into `pageMarkings` when aborted.
- **Root cause:** In `content/core.js`, the last `shouldAbort` check is at
  `:11226`. The silent-whitespace merge loop (`:11247`), both previous-item
  loops (`:11265`, `:11297`), the `changed` computation, the
  `entry.xpaths = items` mutation (`:11336`), and the persist (`:11351`) run
  with no further abort/yield, so a superseded toggle generation can still
  mutate and persist a stale entry.
- **Fix approach:** Add `shouldAbort` checks (and periodic yields on large
  inputs) inside the silent-whitespace and previous-item loops. Build a local
  next-entry object and only assign `entry.xpaths` /
  `silentWhitespaceExcludedXpaths` + persist after a final post-loop abort
  check. Return `{ aborted: true }` consistently when bailing.
- **Acceptance criteria:**
  1. Forcing `shouldAbort` to flip true after candidate merge results in NO
     mutation of `entry.xpaths`/`silentWhitespaceExcludedXpaths` and NO persist.
  2. When not aborted, output is byte-identical to current behavior (no
     marking-rule contract change).
  3. On a large page, the loops yield so the toggle stays responsive.
- **Test plan:**
  - New unit test driving `syncPageMarkings*` (async path) with a
    `shouldAbort` that returns true right after merge; assert the entry is
    untouched and not persisted.
  - Source-pattern guard: assert `shouldAbort` appears in the
    silent-whitespace/previous-item loop region and that `entry.xpaths`
    assignment is gated by a final abort check.
  - Marking guard suite + full suite green; live smoke verdicts unchanged.

### 2.2 Finding 5 — SPA/hash URL changes silently discard a dirty session

Order rationale: needs a product decision before coding (what should happen to
a dirty session on same-document nav), so it follows 2.1.

- **Status (2026-06-06): complete.** The core URL watcher now passes the
  previous page URL into `disable()` so teardown persistence and draft caching
  operate on the page that owned the draft, not the already-mutated
  `location.href`. Dirty same-base same-document transitions preserve the
  temporary disabled draft cache; clean transitions and cross-base transitions
  keep the prior discard behavior. Regression tests cover hash, pushState-style,
  replaceState-style, clean same-base, and dirty cross-base transitions.
- **Root cause:** `content/core.js:9289-9296` URL watcher calls
  `disable({ preserveUnsavedDraftCache: false })` on ANY `location.href`
  change including `history.pushState`/`replaceState`/hash. `handleBeforeUnload`
  (`:10261`) only covers real unloads, so same-document changes bypass the
  save/discard contract that popup-initiated navigation honors.
- **Decision:** For a dirty marking session on a same-base same-document URL
  change, preserve the draft and surface the existing temporary-disabled/
  recovery UI. For cross-base changes, keep the current disable behavior.
- **Fix approach:** Branch the URL-watcher transition on same-base vs
  cross-base and on dirty vs clean. Never clear the only local draft copy
  without a persisted replacement (ties into Finding 3 — land 1.1 first).
- **Acceptance criteria:**
  1. Dirty session + same-base `pushState`/`replaceState`/hash change does not
     silently destroy the draft; the agreed UI/behavior is shown.
  2. Clean session behavior is unchanged.
  3. Cross-base navigation behavior matches the existing contract.
- **Test plan:**
  - New tests simulating `pushState`, `replaceState`, and hash change with a
    dirty entry; assert the draft is preserved (or the recovery path fires) per
    the decision.
  - Full suite + marking guard suite green; live smoke unaffected.

---

## Phase 3 — Medium-low: robustness and validation hygiene

### 3.1 Finding 7 — Save Session can retry forever

- **Status (2026-06-06): complete.** `handlePageSave()` now uses a bounded
  five-attempt retry policy with the existing 1.5s exponential backoff capped
  at 10s. Repeated retryable failures surface the existing save-failed status
  and toast, refresh the popup UI, and return through `runWithSpinner()` so the
  busy overlay is released. The terminal failure branch does not call the
  post-save silent transition and does not clear `state.currentDraftDirty`, so
  the local draft remains available for a later retry. No new cancel control was
  added because the current save overlay has no natural action slot; the
  terminal failure path is the accepted exit path without data loss.
- **Root cause:** `popup.js:7527` `while (true)` around
  `syncBaseConfigToServer({ ..., maxAttempts: 1 })`. Success/`authExpired`/
  `skipped` return, but any other retryable failure loops indefinitely with a
  10s-capped backoff and no cancel path.
- **Fix approach:** Add a bounded retry policy and a visible terminal
  "save failed — retry later" state. Preserve the no-data-loss contract: a
  failed save must not discard the local draft. Do not add a new cancel button
  unless the existing UI has a natural action slot.
- **Acceptance criteria:**
  1. Repeated retryable failures end in a terminal failure state (bounded), not
     an infinite busy loop.
  2. A user cancel path exits the busy state without data loss if the UI has a
     natural cancel affordance; otherwise the bounded terminal branch is the
     exit path.
  3. The local draft survives a failed/cancelled save.
- **Test plan:**
  - New tests in `tests/popup-*` driving `syncBaseConfigToServer` to fail
    repeatedly; assert the loop terminates and surfaces a failure state, and
    that cancel works.
  - Source-pattern guard: `while (true)` replaced by a bounded condition or
    accompanied by a cancel/terminal branch.
  - Full suite green.

### 3.2 Finding 6 — non-deterministic full-suite test count

- **Root cause:** `package.json` `"test": "node --test --test-force-exit"`.
  `--test-force-exit` terminates the process when top-level tests settle,
  truncating the still-incrementing subtest counter (observed 532/521/482/
  463/515, always `# fail 0`).
- **Fix approach:** First try to remove `--test-force-exit` and fix whatever
  open handle/timer keeps the process alive, making the count stable and
  meaningful. If that proves infeasible after focused investigation, document
  the blocker before falling back to count-variance wording.
- **Acceptance criteria:**
  1. Either `npm test` reports a stable count across 5 consecutive runs, OR all
     handoff/plan docs stop asserting a fixed number and state the count is
     non-deterministic by harness design.
  2. `# fail 0` on every run regardless.
- **Test plan:**
  - If (a): run `npm test` 5× and confirm a stable count; investigate any
    lingering open handle (timers, sockets, watchers) that blocked clean exit.
  - If (b): update `.copilot/next-agent-handoff.md` and `.copilot/plan.md`
    wording; no code change.

---

## Phase 4 — Low: documentation and console hygiene

These are safe to batch into a single commit if desired.

### 4.1 Finding 8 — stale names/comments

- **Root cause:** `common/constants.js:27` comment says default-excluded tags
  "cannot be toggled" though the list includes toggleable defaults;
  `tests/marking-rules.test.js:178` test name says "links immutable" while the
  body asserts LINK is omitted; `tests/device-emulation-lifecycle.test.js:278`
  is named "completed reload restores marking" after auto-restore was retired.
- **Fix approach:** Rename the test cases and correct the comment to match the
  current locked contract (LINK omitted from both taxonomies; toggleable
  defaults are user-toggleable; reload auto-restore retired). Do not change
  assertions/behavior.
- **Acceptance criteria:**
  1. Comment and test names accurately describe current behavior.
  2. No assertion or runtime change; suite still green.
- **Test plan:** `npm test` green; quick grep confirms the stale strings are
  gone.

### 4.2 Finding 9 — content scripts log to every page console

- **Root cause:** Unconditional logs at `content-loader.js:73/77/89/102` and
  `content/core.js:9362` run on `<all_urls>` pages.
- **Fix approach:** Remove production content-script logs entirely unless they
  are already part of an existing trace/diagnostic mode. Do not log full
  message objects by default.
- **Acceptance criteria:**
  1. A normally-loaded page with trace mode off produces no Unfluffify content
     logs.
  2. Trace mode still surfaces diagnostics if that path is kept.
- **Test plan:**
  - Source-pattern guard test asserting no bare `console.log/info` in the
    content-loader activation path and consent scroll-restore path (or that
    they are gated behind the trace flag).
  - Live smoke: confirm `errs=0` and no stray Unfluffify logs on a normal page.

---

## Suggested commit sequence

1. `fix: flush pending draft in disable() before clearing state` (1.1 / F3)
2. `fix: stop popup resurrecting marking from stale restore scope` (1.2 / F2)
3. `fix: load page-motion bridge just-in-time, remove public control surface` (1.3 / F1)
4. `fix: honor aborts through async reconcile merge/persist` (2.1 / F4)
5. `fix: preserve dirty session on same-document URL changes` (2.2 / F5)
6. `fix: bound Save Session retries with cancel/terminal state` (3.1 / F7)
7. `chore: stabilize or document the test count` (3.2 / F6)
8. `chore: correct stale names/comments and gate content logs` (4.1 + 4.2 / F8 + F9)

Each commit must pass the standing validation rules before push.
