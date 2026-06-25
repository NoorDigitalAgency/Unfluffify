# Post-WXT Cleanup and Type-Safety Finalization Plan

Last updated: 2026-06-25

## Goal

Bring the repository from "WXT-native build/runtime with tracked cleanup debt" to
an after-cleanup state where only required source, tests, docs, config, and
intentional custom infrastructure remain. The final state must be WXT-native,
pnpm/Node-only, free of stale Deno-era artifacts, type-safe except for explicitly
documented eval-only exceptions, and clear about every custom seam kept because
WXT does not provide the required functionality.

## Current facts

- `package.json` uses WXT/pnpm/Node for the public workflow: `pnpm lint`,
  `pnpm check`, `pnpm test`, `pnpm build`, `pnpm zip`, `pnpm verify`,
  `pnpm browser:live <target-url>`, and `pnpm orchestrate:*`.
- `wxt.config.ts` is the only manifest source. It uses `srcDir: "src"`,
  `publicDir: "src/public"`, `manifestVersion: 3`, package-version manifest
  ownership, and a `build:manifestGenerated` hook to restore the source-owned
  `action` block without `action.default_popup`.
- Runtime source lives under `src/`: browser entrypoints in `src/entrypoints`,
  shared types in `src/types`, and stable public assets in `src/public`.
- The repo has no runtime `@ts-ignore` and no runtime `@ts-nocheck`, guarded by
  `tests/no-ts-ignore-guard.test.js` and `tests/typing-ratchet.test.js`.
- Runtime still has 1,830 tracked `@ts-expect-error` suppressions across:
  `src/content/core.ts`, `src/content-main.ts`, `src/popup.ts`, and the eval
  bridge pair `src/common/page-motion-freeze-bridge.ts` /
  `src/common/page-motion-freeze-control.ts`.
- `src/common/config.ts` is now suppression-free after the config
  normalization/persistence cleanup batches.
- `src/popup/ui.ts` is now suppression-free after typing the popup view state,
  render props, and configuration/control helper surfaces.
- `src/popup.ts` is down to 278 tracked suppressions after typing the
  `refreshUi()` view-state projector against `uiModule.getViewState()` and
  tightening the preview-state/open-flow helpers around `buildPreviewViewState()`
  plus the preview close/restore helpers around `requestTabCloseAiPreview()`,
  `applyPreviewClosedState()`, preview-restore token handling, and the
  runtime-status / preview-restore reconciliation helpers around
  `setCurrentPageSaveReconciliationReason()`,
  `finalizePreviewRestoreFromRuntime()`, and
  `refreshCurrentPageRuntimeStatus()`, then typing the navigation-inspection /
  render-mode-set guard helpers around
  `clearNavigationInspectionSettlePoll()`,
  `startRenderModeSetNavGuard()`,
  `clearRenderModeSetNavGuard()`,
  `noteRenderModeSetNavGuardInspection()`,
  `shouldHoldNavInspectUntilRenderModeInspectionSeen()`,
  `isRenderModeSetNavGuardActive()`, and
  `scheduleNavigationInspectionSettlePoll()`.
- `tests/browser-polyfill-boundary.test.js` still keeps an explicit
  `CURRENT_MIGRATION_DEBT_FILES` bucket, but it is now empty. The remaining
  named boundary buckets are `src/common/browser.ts`,
  `src/common/storage-core.ts`, and `src/common/page-motion-freeze-bridge.ts`;
  the current raw `chrome.*` findings only land in the latter two compatibility
  buckets.
- `tests/storage-access-boundary.test.js` has an empty storage migration-debt
  bucket; storage access is already routed through approved storage/domain
  modules.
- `src/entrypoints/background.ts` is now the sole bootstrap owner for
  `startBackground()`, while `src/background.ts` keeps the idempotent
  `backgroundStarted` guard for safe re-entry.
- `src/offscreen.ts` is removed; `src/entrypoints/offscreen/main.ts` now owns
  offscreen startup directly through `src/offscreen/bootstrap.ts`.
- `src/entrypoints/content-loader.content.ts` intentionally preserves the
  `activateContentMain` lazy activation handshake that background bootstrap
  still depends on.
- `deno.json`, `deno.lock`, `scripts/run-deno.mjs`, Deno test shims, and the
  old `vitest-tests/` tree are removed and guarded by
  `tests/package-test-script.test.js`.
- All automated tests now live under `tests/`; the old `vitest-tests/` tree and
  dedicated Deno runtime shim files are gone.
- Active runtime/scripts/orchestration/test surfaces no longer carry
  `deno-lint-ignore` comments or executable Deno command examples. Historical
  `.copilot/` rationale docs may still mention the earlier Deno migration.
- `orchestration/` is required custom test/debug infrastructure and must be
  kept, but cleaned to Node-only current docs/comments.

## Decisions already made

1. Keep `orchestration/`, but clean stale Deno-era comments/docs and keep the
   subsystem Node-only.
2. Keep `pnpm browser:live <target-url>` and `scripts/launch-test-browser.mjs`
   as the required custom live-browser solution because WXT does not provide the
   full managed-Chromium, bound-popup, same-session control-channel flow.
3. Preserve locked marking/highlighting, AI submission, storage, spinner,
   property-lock, and live-browser behavior.
4. Use the repository review/fix/commit/push loop after each implementation
   checkpoint.

## Open questions

None. If an implementation step discovers a behavior-impacting choice not
covered here, stop and ask a deterministic multiple-choice question before
changing behavior.

## Non-goals

- Do not change marking/highlighting taxonomy, target resolution, sync
  semantics, overlay projection, or default-exclusion behavior.
- Do not change AI submission payload semantics for explicit includes,
  exclusions, immutable defaults, saved submission XPath rows, raw/rendered HTML,
  or large-message avoidance.
- Do not remove the live-browser launcher or orchestration subsystem.
- Do not weaken `strict`, TypeScript ratchets, lint coverage, or validation
  gates to make cleanup pass.
- Do not delete ignored/generated local directories as part of a commit; only
  tracked source-controlled files belong in this plan.
- Do not remove the `activateContentMain` compatibility handshake until a
  separate plan replaces background bootstrap semantics and tests prove the new
  path.

## Implementation phases

### Phase 0 - Inventory and safety baseline

**Files to inspect**

- `package.json`
- `wxt.config.ts`
- `tsconfig.json`, `tsconfig.wxt.json`, `tsconfig.wxt-node.json`
- `.gitignore`
- `.copilot/knowledge.md`
- `.copilot/plan.md`
- `.copilot/post-wxt-cleanup-plan.md`
- `tests/browser-polyfill-boundary.test.js`
- `tests/storage-access-boundary.test.js`
- `tests/no-ts-ignore-guard.test.js`
- `tests/ts-suppression-budget.test.js`
- `tests/typing-ratchet.test.js`

**Steps**

1. Confirm branch/worktree:
   ```bash
   git --no-pager status --short
   git --no-pager branch --show-current
   git rev-parse --abbrev-ref --symbolic-full-name @{u}
   ```
2. Capture tracked and ignored file inventory for reference only:
   ```bash
   git ls-files > /tmp/unfluffify-tracked-files.txt
   git status --ignored --short > /tmp/unfluffify-fs-status.txt
   ```
3. Capture current cleanup debt:
   ```bash
   rg "Deno|deno task|run-deno|deno-lint-ignore" .
   rg "@ts-expect-error|@ts-ignore|@ts-nocheck" src
   rg "chrome\\." src
   node ./scripts/count-ts-suppressions.mjs
   ```
4. Run baseline:
   ```bash
   pnpm verify
   ```

**Expected intermediate state**

No source edits yet; a clean baseline and concrete inventory exist.

**Focused validation**

`pnpm verify`

**Rollback/fallback**

No rollback needed; if the baseline fails, fix or document the baseline failure
before starting cleanup edits.

### Phase 1 - Filesystem prune and active-plan cleanup

**Status:** completed 2026-06-25.

**Files edited/deleted**

- `.copilot/plan.md`
- `.copilot/wxt-finalization-plan.md`
- `.copilot/typescript-typesafety-port-plan.md` (deleted)
- `.copilot/typescript-typing-rollout-plan.md` (deleted)
- `.copilot/typescript-typing-rollout-progress.md` (deleted)
- `orchestration/ssh-rpc-plan.md`
- `README.md`

**Completed work**

1. Deleted the obsolete Deno-era typing rollout plan/progress files that no
   longer matched the pnpm/`src/` repository state.
2. Updated `.copilot/plan.md` so only current suppression/type-safety plans are
   presented as active inputs.
3. Updated `.copilot/wxt-finalization-plan.md` to stop listing the deleted docs
   as retained active typing plans.
4. Updated `orchestration/ssh-rpc-plan.md` to use the current pnpm/Node
   orchestration command surface and generated-output preflight.
5. Updated `README.md` so the current cleanup track points to this plan, while
   `.copilot/wxt-finalization-plan.md` remains historical rationale.

**Expected intermediate state**

The active `.copilot` tree contains only current plans plus explicitly marked
historical references that cannot mislead an executor.

**Focused validation**

```bash
git --no-pager diff --check
rg "deno task|typescript-deno-port|wxt-port-plan.md|event-bus/" .copilot README.md orchestration
```

**Rollback/fallback**

If a deleted file is referenced by active tests/instructions, either restore it
with a historical warning or update the active reference to this plan.

### Phase 2 - Normalize WXT bootstrap ownership

**Status:** completed 2026-06-25.

**Files edited/deleted**

- `src/background.ts`
- `tests/c2-background-entrypoint.test.ts`
- `src/offscreen.ts` (deleted)
- `tests/c1-offscreen-entrypoint.test.ts`

**Completed work**

1. Background:
   - Removed the bottom-level `startBackground();` from `src/background.ts`.
   - Kept `export function startBackground(): void`.
   - Kept the `backgroundStarted` guard.
   - Updated `tests/c2-background-entrypoint.test.ts` to assert that WXT
     entrypoint startup owns background boot and that `src/background.ts` does
     not self-start.
2. Offscreen:
   - Deleted `src/offscreen.ts` because no current entrypoint imported it.
   - Kept `src/offscreen/bootstrap.ts:startOffscreen()` idempotent.
   - Updated `tests/c1-offscreen-entrypoint.test.ts` to assert entrypoint-owned
     startup and the absence of the old shim.
3. Popup:
   - Kept `src/entrypoints/popup/main.ts` as a side-effect import of
     `../../popup.js` unless a separate exported `startPopup()` refactor is
     proven safe.
   - Left popup bootstrap unchanged.
4. Content:
   - Kept `activateContentMain` unchanged.

**Expected intermediate state**

Background/offscreen are WXT-entrypoint-owned where safe; popup/content retain
intentional side-effect/handshake behavior.

**Focused validation**

```bash
pnpm exec vitest run tests/c1-offscreen-entrypoint.test.ts tests/c2-background-entrypoint.test.ts tests/c3-popup-entrypoint.test.ts tests/c4-content-entrypoint.test.ts tests/background-managed-timeouts.test.js tests/sw-keepalive.test.js
pnpm check
pnpm build
```

**Rollback/fallback**

If service-worker startup or offscreen tests fail in a non-local way, restore the
idempotent self-start and document it as an intentional exception.

### Phase 3 - Remove Deno-era comments and docs

**Status:** completed 2026-06-25.

**Files to edit**

- active runtime files under `src/`
- active Node scripts under `scripts/`
- active orchestration helpers under `orchestration/`
- Deno-removal tests:
  - `tests/package-test-script.test.js`
  - `tests/build-extension-package-workflow.test.js`
  - `tests/popup-marking-refresh.test.js`
- `.copilot/post-wxt-cleanup-plan.md`

**Starting inventory**

- every active file matched by:
  ```bash
  rg "deno-lint-ignore|deno task|Deno\\." src scripts orchestration README.md .github tests
  ```

**Steps**

1. Replace `// deno-lint-ignore no-unused-vars -- ...` with:
   - no comment if no current tool needs it, or
   - `// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ...`
     only if source-contract compatibility still requires the unused symbol.
2. Replace `// deno-lint-ignore require-await -- ...` with:
   - removal of unnecessary `async` if behavior permits, or
   - an ESLint-specific disable only if current ESLint requires it.
3. Update stale Deno examples in orchestration docs to `pnpm orchestrate:*`.
4. Update tests that intentionally assert Deno removal only if needed.

**Completed work**

1. Removed copied Deno-era lint directives from active runtime, script,
   orchestration, and test surfaces where current tooling no longer needed them.
2. Kept the negative-match cleanup gate focused on active surfaces; historical
   `.copilot/` rationale docs remain outside this Phase 3 validation scope.
3. Updated the Deno-removal tests to preserve intent without embedding stale
   literal `Deno.` / `deno task` checks in the active validation scope.
4. Updated `tests/popup-marking-refresh.test.js` so its source-contract regex no
   longer depends on the removed Deno-era separator comment.

**Expected intermediate state**

No active source/script/orchestration doc contains Deno-era lint directives or
executable Deno examples.

**Focused validation**

```bash
! rg "deno-lint-ignore" src scripts orchestration tests
! rg "deno task|Deno\\." src scripts orchestration README.md .github tests
pnpm lint
pnpm exec vitest run tests/package-test-script.test.js tests/build-extension-package-workflow.test.js tests/orchestration-rpc.test.js tests/popup-marking-refresh.test.js
```

**Rollback/fallback**

If replacing comments changes source-contract expectations, update the
source-contract tests in the same commit without weakening their intent.

### Phase 4 - Reduce raw Chrome API debt

**Status:** completed 2026-06-25.

**Completed in batch 1**

- migrated low-risk storage callers to active browser/storage roots with browser
  seam fallback:
  - `src/background/ai-run-record-store.ts`
  - `src/background/tab-session-store.ts`
  - `src/background/transfer-payload-store.ts`
  - `src/common/settings-store.ts`
  - `src/common/render-mode-js-state.ts`
- removed type-only `chrome.runtime.Port` debt from:
  - `src/background/brain/index.ts`
  - `src/background/popup-state-broker.ts`
- migrated small runtime/event surfaces:
  - `src/background/render-mode-inspector.ts`
  - `src/background/tab-inactivity-observer.ts`
- moved true WXT-gap surfaces into named boundary exception buckets:
  - `src/common/storage-core.ts`
  - `src/common/page-motion-freeze-bridge.ts`

**Completed in batch 2**

- migrated the remaining hot-file runtime seams to the shared browser layer:
  - `src/background.ts`
  - `src/common/emulation.ts`
  - `src/common/utilities.ts`
  - `src/content/core.ts`

**Remaining migration-debt files after Phase 4**

- none; `tests/browser-polyfill-boundary.test.js` now leaves only the deliberate
  seam/compatibility buckets:
  - `src/common/browser.ts`
  - `src/common/storage-core.ts`
  - `src/common/page-motion-freeze-bridge.ts`

**Files edited**

- `tests/browser-polyfill-boundary.test.js`
- `src/background.ts`
- `src/common/emulation.ts`
- `src/common/utilities.ts`
- `src/content/core.ts`

**Steps**

1. Batch 1 migrated the low-risk storage, type-only, and smaller event surfaces.
2. Batch 2 migrated the remaining hot files to the shared browser seam while
   preserving Node/test-host compatibility where needed.
3. `tests/browser-polyfill-boundary.test.js` no longer carries a live
   migration-debt bucket; only named exception buckets remain for true
   compatibility surfaces.
4. `src/common/storage-core.ts` storage semantics stayed unchanged; the storage
   boundary remains explicit and separately tested.

**Expected intermediate state**

The browser boundary test either has no migration-debt bucket or only permanent
exception buckets with explicit names.

**Focused validation**

```bash
pnpm exec vitest run tests/browser-polyfill-boundary.test.js tests/storage-access-boundary.test.js tests/extension-messaging.test.ts tests/bus-transport-routing.test.ts tests/background-command-router.test.js tests/utilities-runtime.test.js
pnpm check
```

**Rollback/fallback**

If live MV3 behavior depends on raw Chrome callback semantics, restore raw usage
and classify it as a permanent exception with a test comment explaining why.

### Phase 5 - Remove non-exempt type suppressions

**Files to edit**

- `src/popup/ui.ts`
- `src/background.ts`
- `src/common/config.ts`
- `src/popup.ts`
- `src/content-main.ts`
- `src/content/core.ts`
- `src/types/*`
- `tests/fixtures/ts-suppression-budget.json`
- `tests/ts-suppression-budget.test.js` only if the final acceptance shape
  changes

**Do not add TypeScript syntax to**

- `src/common/page-motion-freeze-bridge.ts`
- `src/common/page-motion-freeze-control.ts`

**Steps**

1. Treat this Phase 5 section as the active type-safety execution strategy.
2. Use older type-safety plans only as historical rationale after validating any
   borrowed command/path against the current pnpm/`src/` repository layout.
3. Remove `@ts-expect-error` in micro-batches of 10-50 directives.
4. Add real types from the code's logic:
   - typed state interfaces
   - DOM/Window types
   - domain interfaces under `src/types`
   - narrow runtime guards at JSON/browser boundaries
5. Avoid blanket `unknown` replacements where real types can be inferred.
6. Re-run the count and update `tests/fixtures/ts-suppression-budget.json` only
   after actual suppression count decreases.
7. Keep eval bridge suppressions unless a JSDoc-only approach is separately
   approved and proven safe.

**Expected intermediate state**

Non-exempt `@ts-expect-error` count monotonically decreases to zero. Eval bridge
exceptions remain documented and budgeted unless removed safely.

**Focused validation per batch**

```bash
pnpm check
node ./scripts/count-ts-suppressions.mjs
pnpm exec vitest run tests/no-ts-ignore-guard.test.js tests/ts-suppression-budget.test.js tests/typing-ratchet.test.js
```

**Full validation per major file**

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```

**Rollback/fallback**

If a type fix changes runtime behavior, revert that batch and split it into
smaller typed helpers before retrying.

### Phase 6 - Final closeout

**Files to update**

- `.copilot/knowledge.md`
- `.copilot/plan.md`
- `.copilot/post-wxt-cleanup-plan.md`
- `README.md`
- relevant boundary/ratchet tests

**Steps**

1. Run final inventory:
   ```bash
   ! rg "deno-lint-ignore" src scripts orchestration tests
   ! rg "deno task|Deno\\." src scripts orchestration README.md .github tests
   ! rg "@ts-ignore|@ts-nocheck" src
   node ./scripts/count-ts-suppressions.mjs
   rg "chrome\\." src
   ```
2. Expected final suppression output:
   - zero non-exempt suppressions
   - only the eval bridge exceptions remain, unless safely removed
3. Run:
   ```bash
   pnpm verify
   pnpm zip
   ```
4. If bootstrap/browser-seam behavior changed, live-smoke with the user-provided
   target:
   ```bash
   pnpm browser:live https://copy.noorlynx.com/content-generation/77aa5711-4589-4a6a-8c28-27081acfa2f9
   ```
5. Update docs/knowledge to describe the final state.
6. Run review/fix until clean, then commit and push.

**Expected intermediate state**

The repository has no misleading cleanup plan left and the final architecture is
documented by current files only.

**Focused validation**

`pnpm verify && pnpm zip`

**Rollback/fallback**

If live smoke fails after source changes, stop the launcher, inspect service
worker/popup state through the committed browser launcher, fix, and rerun the
smallest relevant focused tests before repeating live smoke.

## Test matrix

| Area | Commands |
| --- | --- |
| WXT/build | `pnpm check`, `pnpm build`, `pnpm verify` |
| Manifest/WAR | `pnpm exec vitest run tests/manifest-permissions.test.js tests/build-artifact-parity.test.js` |
| Bootstrap | `pnpm exec vitest run tests/c1-offscreen-entrypoint.test.ts tests/c2-background-entrypoint.test.ts tests/c3-popup-entrypoint.test.ts tests/c4-content-entrypoint.test.ts` |
| Browser seam | `pnpm exec vitest run tests/browser-polyfill-boundary.test.js tests/extension-messaging.test.ts tests/bus-transport-routing.test.ts` |
| Storage seam | `pnpm exec vitest run tests/storage-access-boundary.test.js tests/storage-core.test.js tests/settings-store.test.js` |
| Type safety | `pnpm check && node ./scripts/count-ts-suppressions.mjs && pnpm exec vitest run tests/no-ts-ignore-guard.test.js tests/ts-suppression-budget.test.js tests/typing-ratchet.test.js` |
| Deno cleanup | `! rg "deno-lint-ignore" src scripts orchestration tests && ! rg "deno task|Deno\\." src scripts orchestration README.md .github tests` |
| Live smoke | `pnpm browser:live <target-url>` |

## Regression risks

- Service worker startup missing after bootstrap cleanup. Protect with C2
  entrypoint tests, service-worker tests, `pnpm build`, and live smoke if source
  startup changes.
- Offscreen listener missing after self-start cleanup. Protect with offscreen
  entrypoint tests and offscreen message tests.
- Content activation broken. Preserve `activateContentMain` until a separate
  explicit replacement exists.
- Browser API promise/callback drift. Migrate raw Chrome calls one file at a
  time and keep permanent exceptions for true Chrome-only semantics.
- Type fixes changing behavior. Use micro-batches, source-contract tests, and
  full suite after major files.
- Deleted docs still referenced. Run `rg` for deleted names after filesystem
  pruning.
- Stable public assets missing from output. Protect with build-artifact,
  package, and manifest tests.

## Acceptance criteria

- `pnpm verify` and `pnpm zip` pass.
- No active Deno command examples or `deno-lint-ignore` comments remain.
- No tracked obsolete historical docs remain unless explicitly marked
  historical and accurate.
- No runtime `@ts-ignore` or `@ts-nocheck`.
- Non-exempt `@ts-expect-error` count is zero.
- Raw `chrome.*` is eliminated or only appears in named permanent exception
  buckets with tests.
- WXT entrypoints own startup where safe; any remaining side-effect startup is
  documented and tested as intentional.
- README, `.copilot/knowledge.md`, `.copilot/plan.md`, and boundary tests
  describe the final state accurately.

## Todo chain

Use the existing SQL todos for this plan:

1. `cleanup-phase-0-inventory`
2. `cleanup-phase-1-filesystem-prune`
3. `cleanup-phase-2-wxt-bootstrap`
4. `cleanup-phase-3-node-only-comments-docs`
5. `cleanup-phase-4-browser-seam`
6. `cleanup-phase-5-type-safety`
7. `cleanup-phase-6-final-closeout`
