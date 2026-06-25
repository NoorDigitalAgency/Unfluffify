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
4. `.copilot/post-wxt-cleanup-plan.md` for the active cleanup/type-safety
   finalization track
5. `.copilot/wxt-finalization-plan.md` when prior WXT finalization decisions or
   migration rationale are relevant
6. `.copilot/popup-preview-exit-button-state-plan.md` for popup preview/exit
   behavior
7. For suppression/ratchet cleanup, use `.copilot/post-wxt-cleanup-plan.md` as
   the active execution plan.
8. `.copilot/full-typesafety-plan.md`, `.copilot/full-typesafety-progress.md`,
   `.copilot/ts-expect-error-migration-plan.md`, and
   `.copilot/ts-expect-error-migration-progress.md` remain historical rationale
   until they are refreshed for the current pnpm/`src/` repository layout.
9. Older Deno-era typing rollout notes were removed after the WXT/pnpm cleanup.
   Use git history if earlier rationale is needed.

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
3. The post-WXT cleanup/type-safety finalization track is approved and specified
   in `.copilot/post-wxt-cleanup-plan.md`.
4. Event-bus Tracks 0-4 and Part C native WXT adoption are complete on this
   branch.
5. Track H remains paused after H3 by design. Do not resume deeper
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

## Marking Contract Lock

The 052c-derived marking restoration completed on this branch and remains a
locked compatibility contract. Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking contract change.

Key reminders for any future work in this area:

1. Keep silent-highlighting and marking behavior aligned with
   `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Keep selector/default precedence and overlay projection behavior unchanged
   unless the task explicitly authorizes a contract change.
3. Keep AI submission behavior aligned with the locked contract: submit every stored excluded XPath row as excluded.

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
