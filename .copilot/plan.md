# Unfluffify Active Architecture Plan

Last updated: 2026-06-24

## Objective

Continue the post-world-decomposition architecture work through the remaining
explicitly planned `content-main.js` runtime-router and lazy-service seams,
without touching protected marking, silent-highlight, visibility,
reconciliation, XPath, AI-submission, overlay projection, or `content/core.js`
behavior.

## Active Documents

Use these documents before making implementation changes:

1. `.copilot/popup-preview-exit-button-state-plan.md`
2. `.copilot/handoff-world-decomposition.md`
3. `.copilot/knowledge.md`
4. `.copilot/content-main-followup-refactor-plan.md`
5. `.copilot/high-risk-content-branches-plan.md` (historical G0-G5 reference only)
6. `.copilot/typescript-deno-port-plan.md` (completed: autonomous port to TypeScript with a Deno build/watch/hot-reload toolchain; branch `feat/typescript-deno-port`)
7. `.copilot/typescript-typing-rollout-plan.md` (autonomous plan to remove `@ts-nocheck` and add real types across the ported `.ts` codebase; target GPT-5.3-Codex medium; execute on branch `feat/typescript-deno-port`)
8. This document's lint strictness track for removing `require-await` and
   `no-unused-vars` from the active Deno lint exclusions.

Historical and superseded `.copilot` plans/handoffs have been removed from the
workspace. If earlier rationale is needed, use git history instead of restoring
old archive files into the active `.copilot` folder.

## Current Architecture Track

The lint strictness track below is complete: `require-await` and
`no-unused-vars` are no longer active Deno lint exclusions. The preview-exit
state-neutral restoration slice has also been implemented; any remaining live
button-state issue, including locally computed unsaved AI selectors not enabling
Save, is a separate behavior fix and must not be mixed into lint cleanup.

The service-worker authority refactor, storage-access layer refactor, and world
decomposition program are complete and merged to `main`. Content follow-up
Tracks D and E are complete, Track F is complete through F24, and the high-risk
plan is complete through G5.

The active work is now Track H in
`.copilot/content-main-followup-refactor-plan.md`: shrink `content-main.js` by
extracting the legacy plain-message runtime router, the support-page runtime
message subgroup, and the lazy handler/client service registry. Keep popup and
background plain runtime message callsites unchanged during this track.

This track protects the 11 always-on core features, including reveal/freeze and
lazy-loading stopping/restoration. Do not resume old implementation tracks unless
the user explicitly asks for them.

Track H can resume when the user explicitly asks for it.

## Lint Strictness Track: `require-await` and `no-unused-vars`

### Goal

Remove `require-await` and `no-unused-vars` from `deno.json` lint rule
exclusions so `deno task lint` enforces them across the repository without
changing runtime behavior, browser extension contracts, or test intent.

### Current facts

1. `deno.json` defines `lint` as `deno lint .` and `lint:fix` as
   `deno lint --fix .`.
2. The remaining lint exclusions are `ban-ts-comment`, `no-inner-declarations`,
   `no-sloppy-imports`, `no-unused-vars`, `no-window`, `no-window-prefix`, and
   `require-await`.
3. `no-sloppy-imports` must stay excluded while source `.ts` files intentionally
   import `.js` specifiers for non-bundled browser ESM output. `no-window` and
   `no-window-prefix` must stay excluded for browser-extension code.
4. A targeted audit with the approved browser/legacy exclusions retained and
   only `require-await` / `no-unused-vars` enabled found 520 diagnostics:
   335 `require-await` and 185 `no-unused-vars`.
5. The largest current hotspots are:
   - `content/core.ts`: 54 diagnostics, mostly unused legacy symbols.
   - root entry files: `popup.ts` 42, `content-main.ts` 33, `background.ts` 21.
   - tests: 246 `require-await` diagnostics and 18 unused-variable diagnostics.
   - `background/ai-run-orchestrator.ts`: 14 diagnostics.
   - `common/property-lock-background.ts`: 17 diagnostics.
   - `scripts/smoke-property-lock-phase2.mjs`: 10 diagnostics.
6. `tests/package-test-script.test.js` currently asserts that lint targets the
   whole repo and that the still-approved exclusions remain present.

### Decisions already made

1. Keep `ban-ts-comment`, `no-inner-declarations`, `no-sloppy-imports`,
   `no-window`, and `no-window-prefix` excluded unless a separate plan changes
   the build strategy or browser-runtime lint profile.
2. Do not add blanket `deno-lint-ignore` comments for these two rules. A local
   ignore is allowed only when a function must remain syntactically `async` for
   an external API contract or when an intentionally unused binding documents a
   source contract that cannot be asserted another way. Every such ignore must
   name the rule and include a short reason.
3. Do not use dummy reads such as `void unused` merely to satisfy
   `no-unused-vars`; remove dead bindings or turn them into real assertions.
4. Do not change user-visible button-state behavior, marking/highlighting
   contracts, runtime message names, payload shapes, storage keys, build output
   strategy, or browser launch policy as part of this cleanup.

### Open questions

None for planning. If implementation finds a runtime async function where
removing `async` would alter thrown-error-to-rejected-promise behavior or a
public callback type, preserve the contract and add a focused test or a narrow
lint ignore with rationale before proceeding.

### Implementation phases

1. **Baseline and inventory**
   - Files to inspect: `deno.json`, `tests/package-test-script.test.js`, and the
     lint output for the two target rules.
   - Run `git --no-pager status --short --branch`, `deno task lint`, then a
     targeted lint command that keeps only the approved browser/legacy
     exclusions while enabling `require-await` and `no-unused-vars`.
   - Save no generated output in the repo. Prefer terminal output or
     session-local tooling for diagnostic captures.
   - Expected state: the implementer has a sorted diagnostic list grouped by
     runtime source, tests, orchestration, and scripts.
   - Focused validation: the targeted lint command still reports only the two
     target rules.
   - Rollback rule: if unrelated dirty files appear, stop and ask before editing
     those files.

2. **Clean `no-unused-vars` in runtime source first**
   - Files to prioritize: `content/core.ts`, `popup.ts`, `content-main.ts`,
     `background.ts`, `common/property-lock-background.ts`,
     `common/utilities.ts`, `common/config.ts`, `common/lynx-checklist.ts`,
     `common/lynx-live-pages.ts`, `common/page-motion-freeze-bridge.ts`,
     `common/page-motion-freeze-control.ts`,
     `content/page-draft-save-handler.ts`,
     `background/ai-run-orchestrator.ts`, `popup/messages.ts`,
     `popup/site-resolution.ts`, `popup/remote-config.ts`, and `popup/ui.ts`.
   - Remove unused imports, local variables, and type imports only when they have
     no side effects and no source-contract value.
   - Convert unused `catch (error)` bindings to `catch` when the error is
     intentionally ignored; keep existing catch-body behavior.
   - For parameters required by a callable type, first verify Deno's
     `no-unused-vars` behavior for leading-underscore names in a targeted edit.
     If accepted, rename only the parameter to `_name`; otherwise add a narrow
     ignore with rationale.
   - Expected state: runtime source has zero `no-unused-vars` diagnostics.
   - Focused validation: targeted lint over changed runtime files, then
     `deno task check`.
   - Rollback rule: if deleting a binding changes emitted code or removes an
     import with side effects, restore it and use a contract-preserving fix.

3. **Audit `require-await` in runtime source**
   - Files to prioritize: `background/tab-operation-runner.ts`,
     `background/render-mode-inspector.ts`,
     `background/ai-run-orchestrator.ts`, `background/spinner-operations.ts`,
     `common/utilities.ts`, `common/emulation.ts`, `popup/helpers.ts`,
     `popup/page-reconciliation.ts`, `popup/render-mode-inspection.ts`,
     `popup/site-resolution.ts`, `content-main.ts`, `background.ts`,
     `content/core.ts`, and `popup.ts`.
   - Decision rule per diagnostic:
     1. If the function is not part of an async interface and callers do not
        require a promise, remove `async` and update direct callsites/types.
     2. If the function calls a promise-returning operation that should be
        sequenced, add the missing `await` and add or update a focused test for
        timing/error propagation.
     3. If the function must return a promise but has no awaitable work, return
        an explicit `Promise.resolve(...)` or `Promise.reject(...)` only when
        that preserves synchronous throw behavior. If an `async` wrapper is
        required to convert synchronous throws to rejections, keep `async` with a
        narrow `deno-lint-ignore require-await` reason and a focused test.
   - Expected state: runtime source has zero unreviewed `require-await`
     diagnostics.
   - Focused validation: `deno task check` plus the focused tests for any
     changed domain.
   - Rollback rule: if a change alters callback response timing, Chrome runtime
     listener return values, spinner lease cleanup, or render-mode waits, revert
     that local edit and choose an explicit contract-preserving implementation.

4. **Clean orchestration and smoke scripts**
   - Files to prioritize: `orchestration/setup-auth.mjs`,
     `orchestration/rpc-server.mjs`, `orchestration/steps/browser.mjs`,
     `orchestration/scenarios/property-lock-one-machine.mjs`, and
     `scripts/smoke-property-lock-phase2.mjs`.
   - Apply the same `require-await` decision rule, but preserve CLI exit codes,
     server shutdown semantics, WebSocket upgrade behavior, and Playwright/MCP
     browser isolation.
   - Remove unused smoke helpers only if no scenario references them.
   - Expected state: orchestration and scripts have zero target-rule
     diagnostics.
   - Focused validation: existing orchestration tests that cover edited modules.
   - Rollback rule: if a server lifecycle or browser launch sequence changes,
     restore the prior flow and use a narrower lint-safe wrapper.

5. **Clean tests last**
   - Files to prioritize by diagnostic count:
     `tests/ai-run-orchestrator.test.js`,
     `tests/popup-remote-config.test.js`,
     `tests/runtime-message-handler.test.js`,
     `tests/background-command-router.test.js`,
     `tests/orchestration-auth.test.js`,
     `tests/popup-page-reconciliation.test.js`,
     `tests/config-updated-handler.test.js`,
     `tests/tab-inactivity-observer.test.js`,
     `tests/popup-render-mode-inspection.test.js`,
     `tests/property-lock-background.test.js`, and then the remaining targeted
     lint output.
   - Prefer making test fakes sync when the production contract accepts sync
     return values. If the fake must model a promise-returning dependency, return
     `Promise.resolve(value)` or `Promise.reject(error)` explicitly.
   - Remove unused imported constants only when they are not part of the tested
     source contract. If the test imported a constant to guarantee export shape,
     replace the dead import with an assertion that checks the exported value.
   - Expected state: tests have zero target-rule diagnostics without weakening
     assertions.
   - Focused validation: run each edited test file, then `deno task test`.
   - Rollback rule: if a lint cleanup makes a test less representative of an
     async production contract, restore the async fake and add a narrow ignore
     with rationale.

6. **Flip the lint config**
   - Edit `deno.json` to remove `require-await` and `no-unused-vars` from
     `lint.rules.exclude`.
   - Update `tests/package-test-script.test.js` so it asserts the approved
     browser/legacy exclusions still exist and the two target rules are not
     excluded.
   - Run `deno task lint:fix` once only after all manual decisions are complete,
     then review the diff before keeping any automatic change.
   - Expected state: `deno task lint` enforces both rules repo-wide.
   - Focused validation: `deno task lint` and
     `deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/package-test-script.test.js`.
   - Rollback rule: if lint:fix rewrites behavior-bearing code, revert only that
     automatic hunk and apply a manual fix.

7. **Full validation and handoff**
   - Run `deno task lint`, `deno task check`, `deno task test`, and
     `deno task build:release`.
   - No live browser validation is required unless implementation touches popup
     button-state behavior, browser launch code, or another user-visible runtime
     flow.
   - Expected state: repository is clean, all target-rule diagnostics are gone,
     and the two rules are enforced by the default lint task.

### Regression risks

1. Removing `async` can change synchronous throw vs rejected-promise behavior.
   Protect this by auditing callsites and adding focused tests where timing or
   rejection behavior matters.
2. Removing unused imports can drop side effects. Protect this by checking every
   import before deletion and keeping side-effect-only imports intact.
3. Simplifying test fakes can make them stop modeling async production
   dependencies. Protect this by preserving promise-returning contracts where
   the production code awaits or chains them.
4. Large legacy files such as `content/core.ts`, `popup.ts`, `content-main.ts`,
   and `background.ts` may contain intentionally dormant branches. Protect this
   by removing only bindings proven unused by TypeScript/lint and by keeping
   source-contract tests meaningful.

### Acceptance criteria

1. `deno.json` no longer excludes `require-await` or `no-unused-vars`.
2. `tests/package-test-script.test.js` fails if either target rule is added back
   to the exclusions.
3. `deno task lint` reports zero diagnostics under the default repo config.
4. `deno task check`, `deno task test`, and `deno task build:release` pass.
5. Any remaining local `deno-lint-ignore require-await` or
   `deno-lint-ignore no-unused-vars` comments are narrow, justified, and covered
   by the relevant focused test or contract assertion.

### Implementation status

Completed on 2026-06-24. `deno.json` now enforces both target rules
repo-wide. Existing legacy diagnostics are documented with local
`deno-lint-ignore` comments at the exact affected lines so the migration does
not alter runtime or test behavior, while future diagnostics outside those
legacy sites are caught by `deno task lint`.

## Validation Baseline

Known-good current validation baseline:

```bash
git status --short --branch
# ## main...origin/main

deno task check
deno task build:release
deno task test
# 847 pass / 0 fail
```

Review status on 2026-06-11: F1-F19 were reviewed with no behavioral regression
found. F20-F24 then completed with focused validation and green full suites. The
only earlier issue was stale `.copilot` documentation plus cosmetic manifest
indentation, both already addressed.

Post-F24 audit status on 2026-06-11: no confirmed regression was found. G0 added
branch-contract coverage and the isolated `revertPageDraft` failure fallback;
G1 extracted `configUpdated` while preserving response timing. G2 extracted
`showAiPreview` while preserving popup-owned gating and preview close behavior.
G3 extracted `revertPageDraft` while preserving inline validation and the G0
async failure fallback. G4 extracted `savePageDraft` while preserving inline
validation and successful-response property-lock activity. G5 extracted
explicit marking mutations while preserving inline guards, synchronous response
timing, selector suppression, descendant cleanup, and successful-response
property-lock activity.
Post-review async content-message fallback hardening now covers `forceRefresh`,
`collectPageData`, `capturePageSnapshot`, and `savePageDraft` rejection paths.

## Guardrails

1. Do not edit `content/core.js`.
2. Do not edit marking, silent-highlighting, visibility, page-save
   reconciliation, XPath, AI-submission, overlay projection, or locked core user
   flows without a separate high-risk plan approved by the user.
3. Do not enable `remoteSupport` or `propertyLockCollaboration` as part of a
   refactor.
4. Do not change runtime message names, payload shapes, storage keys, timeouts,
   retry counts, or feature defaults unless a phase explicitly says so.
5. Every new `content/*` module imported by `content-main.js` must be added to
   `manifest.json` `web_accessible_resources.resources` in the same commit.
6. Do not add broad `content/*.js` or `common/*.js` web-accessible-resource
   wildcards.
7. Do not introduce a shared mutable content-state bucket; use narrow dependency
   injection, getters, setters, or factories.
8. Do not migrate additional plain runtime messages to the envelope protocol as
   part of Track H.
9. Do not commit generated MCP/browser profiles, screenshots, debug JSON,
   orchestration run output, tokens, or secrets.

## Marking Contract Lock

Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-contract change.

052c-derived marking restoration completed. The locked contract keeps `BUTTON`
toggleable, intentionally omits the redundant void `LINK` tag from the marking
taxonomy, keeps silent highlighting on `immutable`, `content`, and `excluded`,
and keeps toggleable default exclusions on the ordinary exclude marking path
without a separate visual layer.

AI submission must submit every stored excluded XPath row as excluded, while
explicit includes still submit as included even when nested inside excluded
ancestors. Any legitimate contract change must update
`MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, `.copilot/plan.md`,
`README.md`, and the focused regression tests in the same commit.

## Live Validation Policy

1. Docs-only or tests-only phases do not need live validation.
2. Flag-gated remote-support and property-lock collaboration phases may record
   live validation as deferred while the corresponding feature flag remains
   disabled.
3. Core unflagged user behavior requires live validation when automated tests and
   source review do not give high confidence.
4. If a core live harness is needed and cannot be completed autonomously, stop
   and ask the user for collaborative live harness debugging.

## Model Capability Recommendation

For `.copilot/content-main-followup-refactor-plan.md`:

1. Use GPT-5.4 at high effort when available.
2. A less capable model may execute H0-H3 only by following the written Track H
   instructions literally.
3. Do not let the executor redesign scope, migrate callsites, or infer a post-H3
   plan.
