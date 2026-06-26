# WXT Migration Finalization Plan

Status: complete on `feat/wxt-port-plan`. This file is retained for migration
rationale and phase history. Older `.copilot` execution docs were reduced, while
the still-relevant type-safety rationale files remain intentionally checked in.
The follow-up cleanup/type-safety work is now tracked in
`.copilot/post-wxt-cleanup-plan.md`.

Goal: Remove every WXT-migration hybrid/leftover so the repo is WXT-native end to
end, with custom solutions kept ONLY where WXT has no coverage (the dev test
browser launcher). Approved scope decisions (Q&A with @Sojaner):

1. Layout: **full `srcDir` consolidation** — move root modules + CSS under a
   source folder, update test paths.
2. Manifest: **eliminate `manifest.json`** — single source of truth in
   `wxt.config.ts`; version from `package.json`.
3. Deno: **remove Deno 100% from the repo** — port the `browser:live` launcher
   AND the orchestration subsystem to Node, port packaging + manifest-permissions
   test to Node, delete `deno.json`/`deno.lock`/`run-deno.mjs`/`deno-executable.ts`,
   and drop Deno from CI. (Updated per @Sojaner: "port the browser:live's
   script/backend to node so you can de-deno everything 100%".)
4. Tests: **unify into one `tests/` dir AND remove the Deno-compat shims**
   (de-Deno-ify the kit files).
5. Docs: **delete clearly-complete historical `.copilot` plan docs**; keep the
   still-active TypeScript-typing plans.

Hard guardrails:
- Locked contracts must NOT change content: marking/highlighting/visibility/
  reconciliation logic, `content/core.ts`, `common/page-motion-freeze-control.ts`
  + `common/page-motion-freeze-bridge.ts` byte-identical pair, PROPERTY_LOCK,
  MARKING_AND_HIGHLIGHTING_LOGIC. Files MOVE (git mv preserves bytes) but their
  source content stays identical.
- Keep `pnpm browser:live` working, now as a **Node** launcher (the approved
  WXT-coverage-gap custom solution) — same MCP-managed-Chromium flow, Node
  runtime instead of Deno.
- Validate after every phase: targeted tests while iterating, then
  `pnpm lint && pnpm check && pnpm test && pnpm build` (full `pnpm verify` at the
  end). Change → review → fix loop per phase before moving on.

Final repo location of this plan: `.copilot/wxt-finalization-plan.md`.

---

## Phase 0 — Delete dead leftovers (low risk)

- Delete root `content-loader.ts` (dead; superseded by
  `entrypoints/content-loader.content.ts`).
- Delete root `popup.html`, `offscreen.html` (dead; superseded by
  `entrypoints/popup/index.html`, `entrypoints/offscreen/index.html`; they still
  point at root `popup.js`/`offscreen.js`).
- Delete obsolete test `tests/dev-reload-build-separation.test.js` (asserts the
  old esbuild `dist/extension` + `dist/extension-dev` dev-reload artifacts; both
  tests early-return now — vacuous).
- Delete the stale untracked `dist/` directory (esbuild-era; gitignored).
- Re-point or remove the two tests that read root `content-loader.ts` as text:
  `tests/content-activation-order.test.js` and
  `tests/page-motion-bridge-isolation.test.js` → assert against
  `entrypoints/content-loader.content.ts` instead (preserve the behavioral
  intent of each assertion).
- Remove the `esbuild` import from `deno.json` (and regenerate `deno.lock`); it
  is used nowhere now that build = `wxt build`.

Validate: `pnpm test` (targeted on touched tests) then full `pnpm test`,
`pnpm check`, `pnpm build`.

## Phase 1 — Eliminate `manifest.json` dual-source

- Rewrite `wxt.config.ts` to be the single manifest source of truth:
  - Inline the full manifest (permissions, host_permissions,
    web_accessible_resources, icons, action.default_title) — already mostly
    present.
  - Drop the `readFileSync("./manifest.json")` + `sourceManifest` usage; take
    version from `package.json` (WXT default — omit `manifest.version`).
  - Keep a `build:manifestGenerated` hook that STRIPS `action.default_popup`
    (WXT auto-adds it from the popup entrypoint; Unfluffify opens the popup via
    side panel and intentionally omits it). This is a kept custom hook
    (WXT-coverage gap), replacing `restoreSourceAction`.
- Delete root `manifest.json`.
- Update all tests that read `manifest.json`:
  - `tests/a1-bootstrap.test.ts` (source-manifest assertions →
    assert against generated `.output/chrome-mv3/manifest.json` and/or
    `wxt.config.ts` contract).
  - `tests/manifest-permissions.test.js` (default branch read of
    `../manifest.json` → use generated manifest; see Phase 2 for runner).
  - `tests/content-high-risk-branches.test.js`,
    `tests/background-render-mode-inspection.test.js`,
    `tests/page-motion-freeze-bridge.test.js` (re-point manifest reads).
- Note: `package.json` version (`1.2.0`) already matches old manifest version.

Validate: `pnpm build` then `pnpm test`, `pnpm check`. Confirm generated
`.output/chrome-mv3/manifest.json` is byte-equivalent to the previous shipped
manifest (diff against a pre-change build) — especially the absent
`default_popup`, the permissions list, web_accessible_resources, and icons.

## Phase 2 — De-Deno 100% (incl. browser:live launcher + orchestration)

### 2a — Packaging + manifest test → Node
- Port `scripts/package-extension.mjs` from Deno fs APIs to Node
  (`node:fs/promises`, `node:fs`, `node:path`, `node:url`, `process.argv`,
  `process.exit`). Keep behavior + CLI flags identical.
- Port `scripts/emit-package-metadata.ts` → `scripts/emit-package-metadata.mjs`
  (Node; `process.argv` + `node:fs`). Update references.
- `package.json` `verify`: drop the trailing Deno `manifest-permissions.test.js`
  run. Replace with a post-build vitest run:
  `... && pnpm build && UF_MANIFEST_SOURCE=generated vitest run tests/manifest-permissions.test.js`.

### 2b — `browser:live` launcher → Node (user-directed)
- Port `scripts/launch-test-browser.ts` (594 lines) to a Node ESM module
  (`scripts/launch-test-browser.mjs`). Deno→Node API mapping (all bounded,
  1:1):
  - `Deno.args` → `process.argv.slice(2)`
  - `Deno.Command` / `Deno.ChildProcess` → `node:child_process` `spawn`
  - `Deno.exit` → `process.exit`
  - `Deno.mkdir` / `Deno.stat` / `Deno.readTextFile` / `Deno.writeTextFile` →
    `node:fs/promises`
  - `Deno.stdin` / `Deno.stderr` → `process.stdin` / `process.stderr`
    (control channel via `readline`/`process.stdin` data events)
  - `Deno.addSignalListener("SIGINT"/"SIGTERM")` →
    `process.on("SIGINT"/"SIGTERM")`
  - The MCP server spawn: replace the `run-deno.mjs ... npm:@playwright/mcp`
    invocation with a Node spawn of the locally-resolved `@playwright/mcp`
    package (it is already an npm dependency reachable via `node_modules`/`npx`).
  - `install-browser chromium` step → Node spawn of the same MCP package CLI.
- `package.json` `browser:live` → `node ./scripts/launch-test-browser.mjs`.
- Delete `scripts/run-deno.mjs` and `scripts/deno-executable.ts` (only existed to
  locate/spawn Deno).
- Preserve EVERY behavior in the launcher contract: mandatory target URL, build
  unless `--no-build`, materialize `.temp/browser-mcp.config.json` (drop
  `executablePath`, inject `--remote-debugging-port=9222`,
  `--remote-allow-origins=*`), single launcher-owned MCP stdio client,
  `--user-data-dir=.mcp-browser-profile`, extension-id resolution + path-hash
  cross-check, popup binding to the page tab id, and the same-session control
  channel (`state`, `exit-preview`, `observe`, `stop-observe`, `help`) plus CDP
  at `http://127.0.0.1:9222`. The committed placeholdered MCP configs
  (`.vscode/mcp.json`, `.mcp.json`, `.vscode/browser-mcp.config.json`) stay
  placeholdered.

### 2c — Orchestration subsystem → Node (for true 100%)
- Port the `orchestration/**/*.mjs` Deno usage to Node:
  - `Deno.serve` + `Deno.upgradeWebSocket` (bus-server / rpc-server) → `node:http`
    + the `ws` package (add `ws` as a devDependency).
  - `Deno.env` → `process.env`, `Deno.cwd` → `process.cwd()`,
    `Deno.args` → `process.argv`, `Deno.exit` → `process.exit`,
    `Deno.mkdir/stat/readTextFile/writeTextFile/remove` → `node:fs/promises`,
    `Deno.hostname` → `node:os.hostname()`, `Deno.pid` → `process.pid`,
    `Deno.build.os` → `process.platform`, `Deno.version` → `process.versions`,
    `Deno.errors.NotFound` → Node `err.code === "ENOENT"`,
    `Deno.addSignalListener` → `process.on(...)`.
  - The native client `WebSocket` usage already has Node 22 global WebSocket.
- Replace `deno.json` tasks with `package.json` npm scripts
  (`orchestrate:bus`, `orchestrate:runner`, `orchestrate:rpc-server`, etc.)
  invoking `node ./orchestration/...`.
- NOTE: orchestration is a separate dev/agent subsystem; this is the heaviest
  port. If a runtime blocker emerges (e.g. a Deno-only WS handshake nuance),
  STOP and surface it rather than silently changing orchestration behavior.

### 2d — Remove Deno from repo + CI
- Delete `deno.json` and `deno.lock`.
- `.github/workflows/build-extension-package.yml`:
  - Remove both `denoland/setup-deno` steps.
  - Packaging step → `node ./scripts/package-extension.mjs ...`; metadata →
    `node ./scripts/emit-package-metadata.mjs ...`.
  - Update the `required_files` staged-runtime list (confirm WXT still emits
    `popup.html`/`offscreen.html` from entrypoints).
- Update affected tests:
  - `tests/package-test-script.test.js` — currently reads `deno.json` and asserts
    launcher `Deno.*` usage; rewrite for the Node launcher (no `deno.json`).
  - `tests/package-extension.test.js`,
    `tests/build-extension-package-workflow.test.js` — update any Deno-invocation
    assertions to the Node invocations.
  - `tests/orchestration-*.test.js` — update if they assert Deno specifics.
- `eslint.config.js` / lint globs — drop Deno-specific scoping.

Validate: `pnpm zip` + a manual `node ./scripts/package-extension.mjs ...` dry
run; `pnpm browser:live <url>` smoke (launcher must open the bound popup +
control channel); orchestration bus/rpc smoke; `pnpm test`, `pnpm check`,
`pnpm lint`.

## Phase 3 — Unify tests + remove Deno-compat shims

- Simplify `tests/test-kit.ts` and `tests/file-kit.ts` to Node/vitest-only:
  remove `isDenoTestRuntime`, the `@std/*` dynamic imports, and all `Deno.*`
  branches. Keep the SAME exported API (`test`, `assert`, file helpers, `path`)
  so importing tests need no changes.
- Delete `tests/shims/deno-runtime.js` and `tests/shims/std-path.ts`.
- `vitest.config.ts`: remove `setupFiles: ["tests/shims/deno-runtime.js"]` and
  the `@std/path` alias.
- Move the Vitest-only entrypoint tests into `tests/` (rename if needed to avoid
  collisions) and update `vitest.config.ts` `include` to a single `tests/` glob.
  Update the moved tests' relative paths.
- `tests/package-test-script.test.js` is rewritten in Phase 2 for the Node
  launcher; ensure no remaining `Deno.*` string assertions or `deno.json` reads.

Validate: `pnpm test` (full), `pnpm check`, `pnpm lint`.

## Phase 4 — `srcDir` consolidation (largest, highest churn)

- Set `srcDir: "src"` in `wxt.config.ts`.
- `git mv` into `src/` (preserve internal relative structure so intra-source
  imports are unchanged):
  - dirs: `entrypoints/`, `background/`, `common/`, `content/`, `popup/`,
    `offscreen/`
  - root impl files: `background.ts`, `popup.ts`, `content-main.ts`,
    `offscreen.ts`
  - CSS: `popup.css`, `theme-color.css`, `theme-components.css`,
    `theme-utilities.css`
  - `types/` (shared d.ts) — decide: keep at root and reference via tsconfig, or
    move to `src/types`. Default: move to `src/types`.
- Public assets → `src/public/` (WXT copies `<srcDir>/public` to output root):
  move `assets/`, `cursors/`, `icons/` into `src/public/` and DELETE the
  `REQUIRED_PUBLIC_ASSETS` / `build:publicAssets` hook in `wxt.config.ts`
  (idiomatic replacement that preserves the same stable output paths). Verify
  the popup HTML `<link>` paths and runtime `getURL(...)` paths still resolve
  to identical output locations.
- Update entrypoint HTML CSS `<link href="../../theme-*.css">` if relative depth
  changes after the move (paths stay `../../` since both move together — verify).
- Update external references INTO moved files:
  - `wxt.config.ts` asset/import paths.
  - tsconfigs: `tsconfig.json` (root impl includes → `src/**`),
    `tsconfig.wxt.json` (`entrypoints/**` → `src/entrypoints/**`),
    `tsconfig.wxt-node.json` (unchanged — config files stay at root).
  - `package.json` `lint` globs (`entrypoints/**` → `src/entrypoints/**`).
  - `eslint.config.js` ignore/scope patterns if any.
  - `deno.json` lint exclude is removed entirely in Phase 2 (file deleted); make
    sure `eslint`/`package.json` lint globs cover `src/popup/vendor` exclusions
    if any vendor dir exists under the new `src/` tree.
  - ALL tests that `readFileSync(new URL("../<file>"))` for moved files: update
    `../background.ts` → `../src/background.ts`, etc. (~64 test files — full list
    captured in the test-map; mechanical path rewrite, one prefix change).
  - `scripts/smoke-ai-submission.mjs`, `scripts/package-extension.mjs`, CI
    `required_files`, and any path that reaches into moved source.
  - `common/utilities.ts` and manifest `content_scripts` js paths are WXT output
    paths (`content-scripts/*.js`) — unchanged by srcDir.
- Confirm WXT still resolves `src/entrypoints/*` and emits identical output
  filenames (`background.js`, `popup.html`, `offscreen.html`,
  `content-scripts/content-loader.js`,
  `content-scripts/page-motion-freeze-bridge.js`).

Validate: `pnpm prepare` + `pnpm build`; diff `.output/chrome-mv3` file list and
`manifest.json` against a pre-Phase-4 build (must be identical). Then full
`pnpm test`, `pnpm check`, `pnpm lint`.

## Phase 5 — Docs cleanup + knowledge/README refresh

- Delete clearly-complete HISTORICAL `.copilot` docs:
  `wxt-port-plan.md`, `wxt-port-handoff.md`, `wxt-native-adoption-plan.md`,
  `content-main-followup-refactor-plan.md`, `handoff-world-decomposition.md`,
  `high-risk-content-branches-plan.md`, `event-bus-architecture-plan.md`,
  `event-bus/` (track-00..04 + template), `track-f-protected-content-plan.md`,
  `typescript-deno-port-plan.md`, `typescript-deno-port-progress.md`.
- KEEP active TypeScript-typing plans: `full-typesafety-plan.md` (+progress),
  `ts-expect-error-migration-plan.md` (+progress), plus `knowledge.md`,
  `plan.md`, `popup-preview-exit-button-state-plan.md`.
- Before deleting, scan `knowledge.md`/instructions/skills for references to the
  deleted docs and update those references (e.g. the
  `content-main-followup-refactor-plan.md` H3 ceiling reference) to avoid
  dangling links.
- Update `.copilot/knowledge.md`: record the finalized state — `srcDir: "src"`
  layout, no `manifest.json` (single source = `wxt.config.ts`, version from
  `package.json`), **Deno fully removed (browser:live + orchestration are now
  Node)**, unified `tests/` with shims removed, public assets via `src/public/`.
- Update the Deno→Node launcher change across repo workflow docs/instructions:
  `.github/instructions/browser-launch.instructions.md`,
  `.github/skills/launch-test-browser/SKILL.md`, and any `knowledge.md`/README
  text that references `run-deno.mjs`, `deno task`, or `node ./scripts/run-deno.mjs`.
  `pnpm browser:live <url>` stays the canonical command (now Node-backed).
- Update `README.md`: srcDir layout, manifest source-of-truth change, **Deno
  removed everywhere (CI is pnpm/Node-only; orchestration runs on Node)**,
  unified tests.
- Move/keep this plan at `.copilot/wxt-finalization-plan.md`.

## Phase 6 — Final validation + ship

- Full gate: `pnpm verify` (lint + check + test + clean + build + generated
  manifest test). Must be green.
- If feasible/needed for core unflagged behavior, live-validate via
  `pnpm browser:live <url>` (test-browser flow must still work).
- Commit in logical phases (or one reviewed commit) with the
  `Co-authored-by: Copilot` trailer; push to `feat/wxt-port-plan`.

---

## Risk notes / stop conditions
- If the generated `.output/chrome-mv3/manifest.json` or output file list differs
  from the pre-change baseline after Phase 1 or Phase 4, STOP and reconcile — the
  shipped artifact must be unchanged.
- Do not alter locked-contract module CONTENT; only move files.
- If WXT `srcDir`/`publicDir` behaves differently than assumed (e.g. publicDir
  resolves to `<rootDir>/public` not `<srcDir>/public`), adjust the public-assets
  approach (keep the hook) rather than changing output paths.

## Progress checkpoint

- The latest `src/popup.ts` zero-suppression checkpoint is complete: the remaining popup helper seams around runtime-status refresh options, navigation-inspection settle and render-mode debugger helpers, theme/menu/input handlers, login/key handling, config/todo menu toggles, explicit include/exclude actions, enable/disable and device-preview toggles, AI run/result/preview flows, preview view-state normalization, and storage-change listeners now use concrete event/message/config types instead of broad helper suppressions.
- That checkpoint also tightened the coupled popup state types (`currentSiteId` / `aiRunSiteId`) and relaxed the affected source-contract tests only enough to tolerate the new TypeScript annotations for popup helper signatures such as `handleEnableToggle(...)`, `refreshUiInner(...)`, `waitForEnableMarkingInspectionToSettle(...)`, `buildPreviewViewState(...)`, `applyAiPreviewStateUpdate(...)`, `handleExplicitExcludeRemove(...)`, `handleExplicitIncludeRemove(...)`, `handlePreviewShowAllCategoriesChange(...)`, `applyThemeValue(...)`, `navigateActiveTabToUrlWithTodoCollapse(...)`, and `runRenderModeInspectionReload(...)` while preserving the same wiring assertions.
- `src/popup.ts` is now suppression-free. Full review/validation is green for that checkpoint (`code-review`: CLEAN, then `pnpm lint && pnpm check && pnpm test && pnpm build`).
- Current suppression count is 80 total; the only remaining tracked suppressions are the intentionally exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: decide whether to keep the eval bridge pair as the final intentional exemption or open a separate approved plan for that byte-parity/`eval`-locked seam.

- The latest `src/content/core.ts` zero-suppression checkpoint is complete: selector-fingerprint/cache-key helpers, self-markable and explicit-boundary detection, XPath/snapshot/CSS-path helpers, motion-animation pause/resume helpers, explicit include/exclude toggle flows, pointer/key/url watcher handlers, consent-scroll restoration, page-draft/save-reconciliation helpers, and draft-status notifications now use concrete DOM/config/message types instead of broad helper suppressions.
- That checkpoint also tightened the coupled `src/content-main.ts` snapshot/save-entry adapters and relaxed the affected source-contract tests only enough to tolerate the new TypeScript annotations for `handleUrlWatcherTransition(...)`, `toggleExplicitExclude(...)`, `toggleExplicitInclude(...)`, `handleToggleEvent(...)`, `handleKeydown(...)`, `handleKeyup(...)`, and `buildMarkingCollectionsCacheKey(...)` while preserving the same wiring assertions.
- `src/content/core.ts` is now suppression-free. Full review/validation is green for that checkpoint (`code-review`: CLEAN, then `pnpm lint && pnpm check && pnpm test && pnpm build`).
- Current suppression count is 216 total; the remaining tracked files are `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: attack the remaining `src/popup.ts` tail in a large batch, then finish the last non-exempt `src/content-main.ts` suppressions.

- The latest `src/content/core.ts` tail typing checkpoint is complete: pending snapshot/teardown persistence, markability/visibility checks, loose page-marking lookup/cache helpers, immutable-element collection, render scheduling/config loading, enable/disable/scroll handlers, preview-item extraction, element labeling, save-config / AI popover helpers, and tab-state refresh helpers now use concrete DOM/state/config/message types instead of broad helper suppressions.
- The coupled `src/content-main.ts` wrappers were tightened only where the stricter `core` signatures required it, and the affected source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for `scheduleRender(...)`, `flushPendingTeardownPersistence(...)`, `removePageMarkingEntriesForPage(...)`, and `enableForBaseUrl(...)` while preserving the same wiring assertions.
- Full review/validation is green for that checkpoint (`code-review`: CLEAN, then `pnpm lint && pnpm check && pnpm test && pnpm build`).
- Current suppression count is 277 total; the remaining tracked files are `src/content/core.ts` (61), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: finish the final `src/content/core.ts` tail before pivoting back to the `src/popup.ts` tail and the last `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` preview-targeting / layer-geometry checkpoint is complete: AI preview close/focus helpers, mark-id/marked-element tracking, markable-target resolution, excluded-ancestor checks, hover-pointer updates, layer box reuse, visible-rect fallback collection, and explicit-marking element collection now use concrete DOM/state/collection types instead of broad helper suppressions.
- The existing preview/visibility/source contracts stayed intact, including explicit-target preference, excluded-ancestor filtering, hover highlighting, ghost-rect eligibility, and AI preview close notifications.
- Current suppression count is 317 total; the remaining tracked files are `src/content/core.ts` (101), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: finish the remaining `src/content/core.ts` toggle/save-adjacent tail before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` inspection-ui / mark-mode helper checkpoint is complete: page-entry timestamp helpers, per-entry include/exclude XPath set lookups, mutation render-mode detection, inspection-notice/UI activation plumbing, pre-motion inspection warmup flows, toast/temporary-disable messaging, and mark-mode/modifier helpers now use concrete DOM/state/event types instead of broad helper suppressions.
- The coupled source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for `isPageInspectionUiActive()`, `getMarkingTemporarilyDisabledReason()`, and `getMarkMode()` while preserving the same wiring assertions.
- Current suppression count is 379 total; the remaining tracked files are `src/content/core.ts` (163), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: finish the remaining `src/content/core.ts` helper/save-adjacent tail before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` page-motion pause checkpoint is complete: motion-pause state ownership, animation/media/SVG freezing, motion candidate collection, reveal normalization, pause-refresh scheduling/observation, and pause/resume restoration now use concrete DOM/style/pause-state types instead of broad helper suppressions.
- The existing page-motion/source-contract coverage stayed intact without behavior changes; the typed guards preserve extension-UI exclusion, reveal normalization, and the page-world freeze bridge flow.
- Current suppression count is 417 total; the remaining tracked files are `src/content/core.ts` (201), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: continue the remaining `src/content/core.ts` save-adjacent and page-entry helper hotspots before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` entry-normalization/page-inspection checkpoint is complete: exclusion XPath normalization, sanitized snapshot creation, page-inspection reveal scrolling, lazy-loading suppression, input blockers, popup-busy leasing, and the coupled page-entry/core helper contracts now use concrete DOM/state/result types instead of broad helper suppressions.
- The coupled source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for the popup-busy/page-inspection helper signatures while preserving the same wiring assertions.
- Current suppression count is 491 total; the remaining tracked files are `src/content/core.ts` (275), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: continue the remaining `src/content/core.ts` page-motion/save-adjacent hotspots before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` save/reconcile checkpoint is complete: `syncPageMarkings*`, synced-candidate append/merge, previous-item reconcile state, cached XPath element resolution, and silent-whitespace exclusion persistence now use concrete config/XPath/DOM contracts instead of broad helper suppressions.
- The coupled source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for save/reconcile helper signatures and typed `Set<string>` / `Set<Element>` locals while preserving the same wiring assertions.
- Current suppression count is 574 total; the remaining tracked files are `src/content/core.ts` (358), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: continue the remaining `src/content/core.ts` entry-normalization and save-adjacent helper hotspots before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` mid-file/default-layer checkpoint is complete: reconcile candidate scanning, toggleable-target collection, selector suppression/inclusion traversal, explicit-vs-implicit include partitioning, excluded-descendant collection, and nesting-collapse helpers now use concrete DOM/collection types instead of broad helper suppressions.
- The coupled source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for reconcile/default-layer/selector helper signatures and typed `Set<Element>` locals while preserving the same wiring assertions.
- Current suppression count is 607 total; the remaining tracked files are `src/content/core.ts` (391), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: continue the remaining `src/content/core.ts` save/reconcile helper hotspots before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.

- The latest `src/content/core.ts` explicit-overlay/render checkpoint is complete: saved/session explicit-layer splitting, AI selector render filtering, cached explicit-state application, explicit overlay refresh/reconcile scheduling, queued toggle mutation jobs, and draw/reposition helpers now use concrete collection/context types instead of broad helper suppressions.
- The coupled source-contract tests were relaxed only enough to tolerate the new TypeScript annotations for cache-key, explicit-overlay, and queued-toggle helpers while preserving the same wiring assertions.
- Current suppression count is 739 total; the remaining tracked files are `src/content/core.ts` (523), `src/popup.ts` (111), `src/content-main.ts` (25), and the exempt eval bridge pair (`src/common/page-motion-freeze-bridge.ts` 43, `src/common/page-motion-freeze-control.ts` 37).
- Next immediate step: continue the remaining `src/content/core.ts` mid-file/default-layer hotspots before returning to the smaller `src/popup.ts` tail and the final `src/content-main.ts` cleanup.
