# Active Implementation Plan: Test cleanup → TS uniformity → React port → drop Preact

Last updated: 2026-06-26

Status: active. This is the single active handoff plan. `.copilot/plan.md` is the
durable architecture index and `.copilot/knowledge.md` is durable knowledge; all
other historical `.copilot` plan/progress docs were removed.

Progress checkpoint: Phase A and Phase F are complete and pushed. Phase B is in
progress: the first batch removed the pure decomposition/code-shape tests, the
second batch trimmed the mixed/source-grep bus, feature-flag, lifecycle,
device-emulation, render-mode, and world-trace files down to lean runtime plus
narrow contract coverage, the next batch converted
`background-marking-activation`, `preview-tooltip`, and `popup-ai-run-gating`
into slimmer runtime/contract coverage while restoring the review-identified
background/content/popup seams, and the latest batch trimmed
`content-activation-order`, `core-scheduling`, and `core-motion-pause` while
keeping the unique contracts around manual enable rollback, consent observer
rescans, editor-reveal gating, queued explicit-toggle draining, stale async
reconcile aborts, cache-key invalidation, settle renders, and inspection
scroll-end settling. The next active execution step is the remaining mixed
source-grep holdouts inside Phase B (`popup-marking-refresh`,
`selector-suppression`, and adjacent leftovers that still block the later JSX
port).

## 1. Goal

Make the test suite lean and uniformly TypeScript (only contract/behavior/
sentiment/guard tests, no fragile source-shape tests), keep only the single
active plan doc, replace the hand-written Preact `h()`/`render()` popup UI with
React + JSX markup, remove Preact entirely, fix the `logo.png` build placement,
convert `src` imports to extensionless, and run a lint/dead-code cleanup pass —
all with `pnpm verify` green and the live popup behavior unchanged.

## 2. Current facts (verified)

- Preact is vendored, not a package dep: `src/popup/ui.ts:1` imports
  `{ h, render, Fragment }` from `./vendor/preact/dist/preact.module.js`. Only
  `src/popup/ui.ts` (3166 lines, 269 `h(` calls, 17 `Fragment`, 2 `render(`)
  uses it.
- `ui.ts` re-renders the whole tree per state change: `renderApp()` calls
  `render(h(App,{state,actions}),root)` (`src/popup/ui.ts:2879-2904`) with a
  manual Preact-internal self-heal (`root.__k`/`_children`).
- `ui.ts` exposes a large public API consumed by `popup.ts` and the live
  launcher: `initUi`, `getViewState`, `setViewState`, `onViewStateChange`,
  `getRefs`, `showToast`, `setUiBusy`, `View`, `ViewText`,
  `isPopupFeatureEnabled`, and many `setX` functions. `popup.ts` wires
  `__UNFLUFFIFY_POPUP_DEBUG__.getViewState = uiModule.getViewState` and the
  `pnpm browser:live` flow depends on it.
- No JSX tooling exists: `tsconfig*.json` has no `jsx`; tsconfig `include` uses
  `src/**/*.ts` (not `.tsx`). `vitest.config.ts` includes
  `tests/**/*.test.{js,ts}`.
- Tests: 132 `.js` + 24 `.ts`. `.js` tests use `tests/test-kit.ts`
  (`test()`+`assert`); `.ts` tests use native vitest. `tests/file-kit.ts` still
  has Deno leftovers (`resolveNodeDenoPath`, `denoExecutable`, `DENO_BIN`).
- Verified pure structural-shape tests (no execution):
  `popup-decomposition-boundary`, `background-decomposition-boundary`,
  `content-decomposition-boundary`, `content-main-runtime-router-contract`,
  `a1-bootstrap`, `c1/c2/c3/c4-entrypoint`.
- Many ui/popup/core tests still read source as text (grep or extract+eval) and
  break under the JSX port; the highest remaining examples are now
  `popup-marking-refresh`, `selector-suppression`, and smaller adjacent popup/
  content holdouts. The mixed/source-grep `content-activation-order`,
  `core-scheduling`, `core-motion-pause`, `background-marking-activation`,
  `preview-tooltip`, `popup-ai-run-gating`, `bus-boundary`,
  `device-emulation-lifecycle`, `feature-flags`, `lifecycle-broker`,
  `popup-render-mode`, and `world-trace-contract` files now keep only lean
  runtime or narrow contract coverage.
- `logo.png` (1.1 MB) is at repo root, referenced once in
  `src/popup/ui.ts:1898` as `<img src="logo.png">`, but is NOT in `src/public/`
  and NOT emitted to `.output/chrome-mv3/`; `scripts/package-extension.mjs`
  stages manifest entrypoints + transitively-imported files + icons/WAR only, so
  it would also be missed in the release zip.
- 389 relative `from "….js"` import specifiers across 76 `src` files. tsconfig
  uses `moduleResolution: "Bundler"`.
- `eslint.config.js` sets `@typescript-eslint/no-unused-vars: "off"` (plus
  `no-useless-assignment`, `no-useless-escape`, `prefer-spread` off) for runtime
  `src` files, so dead imports/vars survive `pnpm lint`.
- `.copilot/` keep: `plan.md` (index) + `knowledge.md` + this file. Obsolete
  (remove): `full-typesafety-plan.md`, `full-typesafety-progress.md`,
  `ts-expect-error-migration-plan.md`, `ts-expect-error-migration-progress.md`,
  `wxt-finalization-plan.md`, `post-wxt-cleanup-plan.md`,
  `popup-preview-exit-button-state-plan.md`, empty `event-bus/`. Referenced only
  by `.copilot/plan.md` and `README.md`.

## 3. Decisions already made (user-approved)

1. Framework: **React + JSX** (near 1:1 with the existing full-rerender model).
2. Tests: keep contract-enforcing guards (manifest/permissions, storage-access
   boundary, browser-polyfill boundary, type-safety ratchets, Deno-removal,
   mcp-config, package/build artifact); remove only pure structural-shape tests.
3. Source-extraction/grep tests: remove as code-shape; add focused import-based
   tests only where a unique behavior would otherwise lose all coverage.
4. Phase H re-enables unused detection for BOTH `src` runtime files and
   `tests/**`.

## 4. Open questions

None. Live validation (Phases D/E/H) needs a target URL from the user at run
time.

## 5. Non-goals

- No change to marking/highlighting/AI-submission/property-lock/spinner/storage
  runtime behavior or the `ui.ts` public API / `__UNFLUFFIFY_POPUP_DEBUG__`
  contract.
- No change to WXT manifest/permissions/WAR output, the page-motion freeze pair,
  or `knowledge.md`/`plan.md` as durable assets (reference updates only).
- Not converting the `test-kit` harness to native vitest (rename only).
- Not converting Node-executed files (`scripts/**`, `orchestration/**`,
  `wxt.config.ts`) to extensionless imports.

## 6. Implementation phases

### Phase A — Prune obsolete plan/handoff docs (task 3)

- Delete `.copilot/full-typesafety-plan.md`,
  `.copilot/full-typesafety-progress.md`,
  `.copilot/ts-expect-error-migration-plan.md`,
  `.copilot/ts-expect-error-migration-progress.md`,
  `.copilot/wxt-finalization-plan.md`, `.copilot/post-wxt-cleanup-plan.md`,
  `.copilot/popup-preview-exit-button-state-plan.md`, and the empty
  `.copilot/event-bus/` dir.
- Add this file as the single active handoff.
- Edit `.copilot/plan.md` "Read this first" list and closeout reference to drop
  deleted docs and point to this plan + `knowledge.md`; edit `README.md` to drop
  the deleted-doc references.
- Validation: `git --no-pager diff --check`; grep for deleted filenames returns
  only historical prose in `knowledge.md` (acceptable).

### Phase F — Fix logo.png build placement

- `git mv logo.png src/public/logo.png` (WXT `publicDir` copies to output root;
  `src: "logo.png"` reference unchanged).
- Add `logo.png` to an explicit static-asset include in
  `scripts/package-extension.mjs` `collectManifestEntryPoints()`.
- Add assertions: `tests/build-artifact-parity.test.js` requires `logo.png` in
  output and triggers `pnpm build` itself when `.output/chrome-mv3` is absent;
  `tests/package-extension.test.js` asserts `logo.png` is both listed in staged
  metadata and physically present in the stage directory.
- Validation: `pnpm exec vitest run tests/build-artifact-parity.test.js
  tests/package-extension.test.js`, including a clean `.output` run.

### Phase B — Remove code-shape tests, preserve real coverage (task 1)

Deterministic per-file procedure (record each verdict in a `test_triage` SQL
table):

- PURE-SHAPE -> delete: all assertions are source/config-text via
  regex/`toContain`/`indexOf`/`doesNotMatch`/import-or-function-presence with no
  runtime execution. Confirmed: the decomposition x3, content-main-runtime-
  router-contract, a1-bootstrap, c1/c2/c3/c4-entrypoint.
- EXTRACT-AND-EVAL / source-grep coupled -> delete: reads source then greps or
  regex-extracts+eval's it. Before deleting, check whether an importable
  behavior test already covers the logic (many do: `marking-rules`,
  `submission-rules`, `silent-highlight-rules`, `popup-state-decider`,
  `spinner-state-decider`, handler tests). If a unique behavior would lose all
  coverage and the function is importable, add a focused `*.test.ts` importing
  the real module; if not importable, record the gap in `test_triage` and skip.
- MIXED -> keep, strip shape: keep behavior assertions, delete only the
  source-text assertions (e.g. `bus-boundary.test.ts` routing-order `indexOf`,
  `feature-flags`, `popup-render-mode`, `selector-suppression`).
- KEEP (convert in Phase C): behavior tests; contract-on-artifact guards
  (`manifest-permissions`, `package-extension`, `package-test-script`,
  `build-artifact-parity`, `build-extension-package-workflow`,
  `playwright-mcp-config`); boundary/ratchet guards (`storage-access-boundary`,
  `browser-polyfill-boundary`, `typing-ratchet`, `ts-suppression-budget`,
  `no-ts-ignore-guard`); sentiment/style (`ui-font-uniformity`, `theme-colors`).
- Validation per batch: `pnpm exec vitest run` on touched files; then `pnpm test`.

### Phase C — Port remaining tests to TS (task 2)

- Rename every surviving `tests/*.test.js` -> `tests/*.test.ts` (keep
  `test-kit`/`file-kit` imports; vitest resolves them).
- Remove Deno leftovers from `tests/file-kit.ts` (`resolveNodeDenoPath`,
  `denoExecutable`, `DENO_BIN`, the `deno` import); verify nothing imports them.
- Fix only real TS syntax errors surfaced by `.ts` parsing.
- Validation: `pnpm test` green; `ls tests/*.test.js` empty.

### Phase D — Port popup UI to React + JSX (task 4)

- Tooling: add deps `react`, `react-dom`, `@types/react`, `@types/react-dom`,
  and WXT React support (`@wxt-dev/module-react` registered in `wxt.config.ts`
  `modules`); add `"jsx": "react-jsx"` to `tsconfig.json`; broaden tsconfig
  `include` and `pnpm check`/eslint globs to cover `**/*.tsx`; confirm `eslint .`
  parses `.tsx`.
- Rename `src/popup/ui.ts` -> `src/popup/ui.tsx`. Convert all
  `h(Type, props, ...children)` -> JSX, `Fragment` -> `<>…</>`, and
  `render(h(App,…),root)` -> a module-held `createRoot(root)` whose
  `.render(<App state={…} actions={…}/>)` is called by `renderApp()`. Replace
  the Preact-internal `__k`/`_children` self-heal with a React-appropriate
  remount (recreate root) or error boundary.
- Preserve exactly: every exported function/const of `ui.ts`, the `App` props
  shape, `refs` population, toast/busy/menu/preview behaviors, and `getViewState`
  (the `__UNFLUFFIFY_POPUP_DEBUG__` hook).
- Convert by render-helper sections (~270 `h()` sites), `pnpm check` after each
  batch.
- Validation: `pnpm lint && pnpm check && pnpm test && pnpm build`; then live
  `pnpm browser:live <target-url>` for popup parity (render, marking preview,
  busy curtain, menus, exit-preview); reload the SW after rebuild.

### Phase E — Remove Preact completely (task 5)

- Delete `src/popup/vendor/preact/`; remove the vendor ignore entry from
  `eslint.config.js`.
- Confirm zero `preact` references: `grep -rn "preact" src tests *.ts *.json`
  empty.
- Validation: `pnpm verify`.

### Phase G — Convert src imports to extensionless

- Rewrite relative specifiers `from "./X.js"` -> `from "./X"` across
  `src/**/*.{ts,tsx}`.
- Exclude the freeze pair (`src/common/page-motion-freeze-bridge.ts`,
  `page-motion-freeze-control.ts`) to preserve parity/eval tests; do NOT touch
  `scripts/**`, `orchestration/**`, `wxt.config.ts`.
- Validation: `pnpm check`, `pnpm build`, `pnpm test`.
- Fallback: if a specifier fails WXT/Vite resolution, restore the explicit
  `.ts`/`.tsx` extension for that one import only.

### Phase H — Lint + dead-code cleanup pass

- Add `eslint-plugin-unused-imports`; enable
  `unused-imports/no-unused-imports: "error"` (auto-fixable) and turn
  `@typescript-eslint/no-unused-vars` back to `"error"`
  (`argsIgnorePattern: "^_"`); re-enable `no-useless-assignment`,
  `no-useless-escape`, `prefer-spread`. Apply to BOTH runtime `src` globs and
  `tests/**`. Keep `ban-ts-comment: off` only where the freeze pair needs it.
- Run `eslint . --fix` to strip dead imports, then manually remove remaining
  unused vars/exports, leftover commented-out port scaffolding, and now-unused
  types. Removal only; no behavior change.
- Validation: final `pnpm verify` + `pnpm zip` + `pnpm browser:live
  <target-url>` live smoke.

## 7. Test matrix

- Per-batch: targeted `pnpm exec vitest run <files>` + `pnpm check`.
- Phase gates: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`.
- Release/UI gate: `pnpm verify`, `pnpm zip`, `pnpm browser:live <target-url>`.

## 8. Regression risks

- Live debug hook loss: removing `c3-popup-entrypoint` drops the
  `__UNFLUFFIFY_POPUP_DEBUG__.getViewState` guard; mitigated by preserving the
  hook in the React port + live validation.
- `.js`->`.tsx` and extensionless resolution: tests/`popup.ts` import
  `../popup/ui.js`; Vite resolves `.js`->source. Verify after rename/extension
  change; keep a thin re-export only if required.
- React reconciliation parity (keyed lists, focus, scroll-to-xpath in preview):
  covered by live smoke.
- Coverage loss from removed extract tests: mitigated by the import-based
  replacement rule and the `test_triage` gap log.
- logo staging: must be included in BOTH the WXT output and the release zip.
- Stricter lint may surface many violations in `popup.ts`/`content/core.ts`: fix
  by removal only, batch by file, `pnpm check` after each.

## 9. Acceptance criteria

- `pnpm verify` and `pnpm zip` pass; `ls tests/*.test.js` empty;
  `grep -rn preact src tests` empty.
- `.copilot/` contains only `plan.md`, `knowledge.md`, this file (no empty dirs).
- `.output/chrome-mv3/logo.png` exists and is staged in the release zip.
- `src/**/*.{ts,tsx}` (excluding the freeze pair) use extensionless relative
  imports.
- `pnpm lint` passes with unused-imports/unused-vars enabled for `src` and
  `tests`.
- Popup live behavior unchanged in `pnpm browser:live`.
- No pure structural-shape test files remain; contract/guard/sentiment tests
  still present and green.

## 10. Todo chain

`phase-a-plan-cleanup` -> `phase-logo-fix` -> `phase-b-test-cleanup` ->
`phase-c-ts-port` -> `phase-d-react-port` -> `phase-e-drop-preact` ->
`phase-extensionless-imports` -> `phase-lint-deadcode`. Each ends with
review -> fix -> commit -> push.
