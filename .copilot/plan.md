# Unfluffify Active Architecture Plan

Last updated: 2026-06-25

## Objective

Keep the active architecture index aligned with the repository's finalized WXT
runtime and current approved work. The extension now ships from the WXT-native
`src/` tree, public assets come from `src/public/`, and no new content/runtime
refactor track is approved beyond the paused post-H3 state.

## Read this first before changing code

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. `.github/skills/*/SKILL.md` relevant to the task
4. `.copilot/wxt-finalization-plan.md` while Phase 5/6 closeout remains active
5. `.copilot/popup-preview-exit-button-state-plan.md` for popup preview/exit
   behavior
6. Active TypeScript safety docs when touching ratchets or suppressions:
   - `.copilot/full-typesafety-plan.md`
   - `.copilot/full-typesafety-progress.md`
   - `.copilot/ts-expect-error-migration-plan.md`
   - `.copilot/ts-expect-error-migration-progress.md`
   - `.copilot/typescript-typesafety-port-plan.md`
7. Older retained typing-rollout notes may still exist for historical rationale,
   but validate all commands and paths against the current pnpm/`src/` workflow
   in this document and `.copilot/knowledge.md`.

Historical `.copilot` plans that no longer describe current execution have been
removed from the workspace. Use git history if older rationale is needed.

## Current branch state

1. The shipped runtime is WXT-native end to end:
   - source code lives under `src/`
   - entrypoints live under `src/entrypoints/`
   - shared types live under `src/types/`
   - stable public assets live under `src/public/`
   - `wxt.config.ts` is the sole manifest source of truth
2. The public workflow is pnpm/Node-only:
   - validation: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`,
     `pnpm verify`
   - packaging: `pnpm zip`, `node ./scripts/package-extension.mjs`
   - live browser: `pnpm browser:live <target-url>`
   - orchestration: `pnpm orchestrate:*`
3. Event-bus Tracks 0-4 and Part C native WXT adoption are complete on this
   branch.
4. Track H remains paused after H3 by design. Do not resume deeper
   `content-main` extraction unless a new written plan is approved.

## Guardrails

1. Do not change locked marking/highlighting/property-lock contracts without an
   explicit new plan.
2. Keep Chrome storage access behind the approved storage/domain modules guarded
   by `tests/storage-access-boundary.test.js`.
3. Keep the WXT/browser seams intact:
   - `common/browser.ts` remains the browser-compatible extension API seam
   - `common/storage-core.ts` remains the storage seam
   - generated manifest output must keep stable WAR/icon/cursor paths
4. For browser/live validation, use only `pnpm browser:live <target-url>` and
   the managed Playwright MCP Chromium.

## Validation policy

1. Source changes: iterate with focused tests, then run `pnpm lint`,
   `pnpm check`, `pnpm test`, and `pnpm build`.
2. Docs-only changes: run `git --no-pager diff --check`.
3. Live validation is required for core unflagged browser behavior when tests
   and source review are not enough.

## Model recommendation

Use a strong reasoning model for non-trivial runtime changes. Do not let a
low-context executor infer new product behavior, reopen retired architecture
tracks, or continue the paused Track H work by continuity alone.
