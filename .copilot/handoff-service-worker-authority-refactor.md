# Handoff - Service Worker Authority Refactor

Last updated: 2026-06-09 (implementation checkpoints through Phase 5 ready to checkpoint)
Branch at document creation: main
Implementation status: IN PROGRESS
Document commit scope: planning + active implementation handoff updates

## Implementation Checkpoints (2026-06-09)

Branch used for implementation and pushes:

1. `refactor/service-worker-authority`

Completed and pushed checkpoints:

1. Phase 0 checkpoint commit `bb90fc3`
    - Message: `docs(refactor): record phase-0 baseline verification`
    - Baseline failure documented before implementation:
       `tests/core-motion-pause.test.js` lazy-load suppression assertion mismatch.

2. Phase 1 checkpoint commit `76693d0`
    - Message: `feat(messaging): add acknowledged async request wrapper`
    - Added:
       - `common/message-protocol.js`
       - `common/async-messaging.js`
       - `tests/async-messaging.test.js`
    - Verification at checkpoint:
       - `node --test tests/async-messaging.test.js tests/utilities-runtime.test.js` passed.
       - Full suite remained on the single known baseline failure.

3. Phase 2 checkpoint commit `25923df`
    - Message: `feat(background): add tab-scoped command router`
    - Added:
       - `background/command-router.js`
       - `background/tab-runtime.js`
       - `tests/background-command-router.test.js`
    - Integrated envelope-only dispatch path in `background.js` with per-tab
       command ledger and runtime bridge.
    - Verification at checkpoint:
       - `node --test tests/background-command-router.test.js` passed.
       - Full suite remained on the single known baseline failure.

4. Phase 3 checkpoint commit `241bbc1`
    - Message: `feat(background): centralize async spinner operations`
    - Added:
       - `background/spinner-operations.js`
       - `tests/background-spinner-operations.test.js`
    - Extracted spinner queue mutation helpers in `background.js` to module-based
       operations and added `withTabSpinner` wrapper.
    - Low-risk migration applied:
       - `clearBrowsingDataForOrigin` now uses `withBackgroundTabSpinner` when
          `tabId` is available.
    - Verification at checkpoint:
       - `node --test tests/background-spinner-operations.test.js tests/world-trace-contract.test.js` passed.
       - Full suite remained on the single known baseline failure.

5. Phase 4 checkpoint commit `3f3c17b`
    - Message: `feat(content): route page commands through executor`
    - Added:
       - `content/content-command-router.js`
       - `tests/content-command-router.test.js`
    - `content-main.js` registers content command handlers for envelope
       dispatch while preserving legacy message handling for compatibility.
    - Verification at checkpoint:
       - `node --test tests/content-command-router.test.js` passed.
       - Full suite remained on the single known baseline failure at this phase.

Current in-progress phase (ready for checkpoint commit/push at this handoff update):

1. Phase 5 (page-world relay through content)
    - Added:
       - `common/page-world-protocol.js`
       - `content/page-world-relay.js`
       - `tests/page-world-relay.test.js`
    - Updated:
       - `common/page-motion-freeze-bridge.js` now serves nonce-scoped relay
          requests and replies in MAIN world while preserving byte-identical
          `runPageMotionFreezeControl` body contract.
       - `content/core.js` now routes page-motion commands relay-first through
          content->page-world with deterministic request/reply and keeps
          background executeScript fallback for compatibility.
       - `content-main.js` best-effort initializes relay session on startup.
       - `tests/core-motion-pause.test.js` now guards lazy-load suppression
          restore in finally on both success and thrown reveal paths.
       - `tests/page-motion-bridge-isolation.test.js` now guards relay-first
          architecture with compatibility fallback.
    - Verification in working tree before checkpoint commit:
       - `node --test tests/page-world-relay.test.js tests/page-motion-freeze-bridge.test.js tests/page-motion-bridge-isolation.test.js tests/core-motion-pause.test.js` passed (33/33).
       - Core guard suite from Phase 0 list passed (220/220).
       - Full suite passed (675/675).
       - Historical Phase 0 lazy-load assertion mismatch is now resolved by the
          Phase 5 contract tests that enforce suppression restore in finally.

## Resume From Here

Next strict phase to implement after the Phase 5 checkpoint push:

1. Phase 6A: popup tab view snapshot from background.

Recommended first commands to resume immediately after pull:

```bash
git status --short
git log --oneline -n 3
node --test tests/background-command-router.test.js tests/popup-marking-refresh.test.js
```

## Read This First

The user wants a careful refactor where the service worker becomes the command
headquarters. Do not start by moving random code. Read the plan first:

- `.copilot/service-worker-authority-refactor-plan.md`

Then follow this handoff exactly.

## Current State

As of this handoff:

1. The repository has a committed debug/flag stabilization baseline.
2. Runtime trace toggling was removed and fixed debug flags are centralized.
3. The service worker already owns useful pieces:
   - tab state
   - content activation helper
   - background spinner broker
   - lifecycle broker
   - page-motion freeze executeScript bridge
   - AI persistence/background network pieces
4. The popup still directly orchestrates many content workflows.
5. Content still owns marking/highlighting/consent/reveal/freeze logic.
6. Page-world freeze/lazy-loading suppression now supports deterministic
   content->page-world relay with nonce-scoped request/reply; background
   executeScript remains as compatibility fallback.
7. Next work is Phase 6A popup snapshot migration to background authority.

## First Commands For A Future Implementer

Run these before editing code:

```bash
git status --short
git fetch origin
git pull --ff-only
git switch -c refactor/service-worker-authority
npm ci
npm test
node --test tests/core-visibility.test.js tests/core-motion-pause.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
```

If any baseline test fails before edits, stop and document it here or in a new
handoff update. Do not begin the refactor on top of unexplained failures.

## Phase 0 Baseline Execution (2026-06-09)

Executed on branch `refactor/service-worker-authority` from `main` head
`3457176` after `git fetch origin` and `git pull --ff-only`.

Commands executed:

```bash
npm ci
node --test
node --test tests/core-visibility.test.js tests/core-motion-pause.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
```

Baseline result:

1. Full suite: 649 passed, 1 failed.
2. Focused suite: 218 passed, 1 failed.
3. Same failing pre-existing test in both runs:
   - `tests/core-motion-pause.test.js`
   - test name: `page inspection reveal keeps page-world lazy-load suppression active until marking is disabled`
   - assertion mismatch: expected `{ suppressed: true }`, got `{ suppressed: false }`

Interpretation:

1. Failure is pre-existing before Phase 1 edits.
2. Refactor can proceed only with this known baseline failure tracked.
3. Each later phase must confirm this failure is unchanged unless that phase
   intentionally fixes this behavior.

## Protected 11 Checklist

Every phase must preserve these always-on behaviors. Lazy-loading stopping is
explicitly part of item 7 and must not be forgotten.

1. Tab-scoped content bootstrap and extension activation.
2. Base URL scoping and per-tab session state.
3. Marking mode activation and deactivation.
4. Marking overlay rules and interactions.
5. Silent highlighting mode and overlay rendering.
6. Consent removal.
7. Page reveal, page motion freeze, and lazy-loading stopping/suppression.
8. Mobile simulation contract for marking and submission.
9. Local drafts, page-save reconciliation, save, and discard.
10. AI selector run, result application, and stored evidence usage.
11. Inspection and review surfaces: manual render-mode inspection/capture,
    Preview Contents, and Send to Lynx.

Before changing a phase, identify which checklist items it touches and run the
corresponding focused tests after the change.

## Architecture Target In One Line

Popup intent -> service worker command -> content executor -> optional
content-mediated page-world relay -> acknowledged reply -> service worker state
snapshot -> popup render.

## Where The Current Authority Is Distributed

Useful current seams:

1. `common/utilities.js`
   - Has `sendRuntimeMessage`, but it resolves some failures as values. The plan
     requires a stricter acknowledged async wrapper that rejects failures.

2. `popup/messages.js`
   - Has popup runtime and tab messaging wrappers. This is a migration target;
     popup tab messaging should eventually disappear for core workflows.

3. `background.js`
   - Has `sendContentMessageToTab`, `ensureContentMainForTab`, spinner broker,
     lifecycle broker, and page-motion freeze relay. Extract from here
     incrementally; do not rewrite the whole file in one pass.

4. `content-loader.js`
   - Handles `activateContentMain`. Keep the idempotent loading behavior.

5. `content-main.js`
   - Has the giant content message handler and content mode logic. Wrap existing
     handlers in a command router before changing behavior.

6. `content/core.js`
   - Holds protected marking, consent, reveal, freeze, and lazy-loading
     suppression logic. Treat as high risk. Do not move marking rules out.

7. `common/page-motion-freeze-bridge.js`
   - MAIN-world document_start bridge. There are tests enforcing bridge/control
     compatibility. Be very careful.

8. `common/page-motion-freeze-control.js`
   - Serialized page-world function for motion freeze and lazy-loading stopping.
     This must remain correct and not web-accessible unless the architecture is
     deliberately changed with tests.

## Recommended First Implementation Slice

Start with Phase 1 only: central async messaging core.

Expected files:

1. `common/message-protocol.js`
2. `common/async-messaging.js`
3. `tests/async-messaging.test.js`

Do not migrate popup activation, content activation, or spinners in the first
commit. The first commit should prove the request/reply contract in isolation.

Minimum Phase 1 tests:

1. Success response resolves.
2. `{ ok: false }` rejects.
3. `chrome.runtime.lastError` rejects.
4. Timeout rejects with `code: "timeout"`.
5. Timeout timer is cleared after success.
6. Missing response rejects when reply expected.
7. Fire-and-forget can resolve when `expectsReply: false`.

Suggested commit:

```bash
git add common/message-protocol.js common/async-messaging.js tests/async-messaging.test.js
git commit -m "feat(messaging): add acknowledged async request wrapper"
git push -u origin refactor/service-worker-authority
```

## Exact Phase Order

Do not reorder unless the user explicitly approves it.

1. Phase 0: baseline and branch.
2. Phase 1: central async messaging core.
3. Phase 2: background command router and tab runtime.
4. Phase 3: service-worker spinner authority.
5. Phase 4: content command executor boundary.
6. Phase 5: page-world relay through content.
7. Phase 6A: popup tab view snapshot from background.
8. Phase 6B: marking activation orchestration in background.
9. Phase 6C: marking deactivation orchestration in background.
10. Phase 6D: render-mode inspection orchestration in background.
11. Phase 6E: AI run orchestration in background.
12. Phase 6F: save, discard, preview, and send surfaces.
13. Phase 7: remove direct popup-to-content authority.
14. Phase 8: replace fragile source-shape tests with behavior guards.
15. Phase 9: tab isolation hardening.
16. Phase 10: cleanup and documentation.

## Per-Phase Done Definition

A phase is done only when:

1. The phase-specific implementation is complete.
2. No unrelated behavior was changed.
3. The touched protected behaviors have focused test coverage.
4. Phase-specific tests pass.
5. `npm test` passes, unless the user explicitly approved a narrower temporary
   checkpoint.
6. `git diff --check` passes.
7. The commit is atomic and pushed.
8. This handoff is updated if the next phase is not started immediately.

## Git Workflow

Use this workflow throughout implementation:

1. Work on `refactor/service-worker-authority` or a similarly named branch, not
   directly on main, unless the user explicitly asks for direct main commits.
2. Pull with `--ff-only` before work.
3. Keep commits small and phase-based.
4. Run focused tests before full tests.
5. Inspect diff before commit.
6. Commit only passing states.
7. Push after each stable commit.
8. Do not squash during active development; intermediate commits are useful for
   rollback in a delicate refactor.

Commit style examples:

```bash
feat(messaging): add acknowledged async request wrapper
feat(background): add tab-scoped command router
feat(background): centralize async spinner operations
feat(content): route page commands through executor
feat(page-world): relay motion commands through content
refactor(popup): send marking activation intent to background
test(background): guard tab-scoped command isolation
docs(architecture): document service-worker command authority
```

## Testing Strategy

The current test suite has both real logic tests and source-shape tests. The
source-shape tests are not all bad, but they should be used sparingly.

Keep source-shape tests for:

1. MAIN-world bridge/control byte identity.
2. Manifest/web-accessible-resource constraints.
3. Forbidden direct imports or forbidden direct popup-to-content messaging.
4. Architecture boundary rules that are hard to execute in Node.

Replace source-shape tests when they only assert syntax such as:

1. A function name exists.
2. An `if (message.type === ...)` branch exists.
3. A string appears in a file.
4. A regex can be updated to follow refactored syntax without proving behavior.

Preferred replacements:

1. Fake Chrome runtime/tabs tests.
2. Command router tests.
3. Tab runtime reducer tests.
4. Spinner lifecycle tests.
5. Page-world relay nonce/timeout tests.
6. Existing pure marking/highlighting tests.

Do not delete an old source-shape test until its replacement test exists and
guards the same regression.

## Lazy-Loading Stopping Guardrails

This is a special risk area and must be protected explicitly.

Current relevant files:

1. `content/core.js`
   - reveal path
   - lazy-loading suppression restore path
   - page motion freeze calls

2. `common/page-motion-freeze-control.js`
   - page-world lazy-loading suppression implementation

3. `common/page-motion-freeze-bridge.js`
   - document_start bridge that must cooperate with the control function

4. `background.js`
   - current direct executeScript relay for `pageMotionFreezeControl`

When migrating this area:

1. Add tests before moving the relay.
2. Prove suppression `true` is sent before the relevant reveal scroll phase.
3. Prove suppression `false` is sent in `finally` on success.
4. Prove suppression `false` is sent in `finally` on failure/cancel.
5. Prove page-world command timeout rejects clearly and does not leave the
   content operation hanging forever.
6. Keep `tests/core-motion-pause.test.js` and
   `tests/page-motion-freeze-bridge.test.js` passing.

Do not accept a refactor that only freezes animation but drops lazy-loading
suppression. The user explicitly requires lazyloading stopping in the protected
always-on core set.

## Live Validation Notes

When a headed browser environment is available, use the methodology documented
in `.copilot/handoff-core-hotfix.md`. The most important flows to validate live
after later phases are:

1. Enable marking on a real candidate page.
2. Reveal/freeze completes and the curtain clears.
3. Lazy-loaded content stops loading during frozen posture.
4. Silent highlighting does not blink.
5. Render-mode inspection reload follow-up completes.
6. Spinner appears and clears for success and failure.
7. Same URL in two tabs does not leak state.

If live validation is not available, do not claim visual/runtime completion for
phases that require it. Mark that validation as pending.

## Stop Conditions

Stop and ask the user or write a blocker note if:

1. A protected behavior appears to require behavior change.
2. Full tests fail and the failure is not clearly unrelated/pre-existing.
3. A source-shape test must be deleted but no behavioral replacement exists.
4. A command cannot be made tab-scoped.
5. Lazy-loading suppression cannot be proven to restore on all paths.
6. A page-world relay change breaks the document_start bridge contract.
7. A payload becomes too large for safe runtime messaging.

## Final Completion Checklist

The full refactor is complete only when:

1. Popup core workflows are background commands, not direct content messages.
2. Background owns tab runtime state and spinner operation state.
3. Content exposes a command executor and owns only page UI/DOM logic.
4. Page-world functionality is request-only and relayed through content, or any
   remaining direct path is documented as temporary with tests.
5. The protected 11 all pass focused tests.
6. Lazy-loading stopping has explicit activation and cleanup tests.
7. Tab isolation tests cover same URL in multiple tabs.
8. Fragile source-shape tests have been reduced or justified.
9. `npm test` passes.
10. README, `.copilot/knowledge.md`, and this handoff reflect the final state.
