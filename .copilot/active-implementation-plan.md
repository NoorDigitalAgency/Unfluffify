# Active Implementation Plan: Test cleanup → TS uniformity → React port → drop Preact

Last updated: 2026-06-27

Status: active. This is the single active handoff plan. `.copilot/plan.md` is the
durable architecture index and `.copilot/knowledge.md` is durable knowledge; all
other historical `.copilot` plan/progress docs were removed.

Progress checkpoint: Phase A and Phase F are complete and pushed. Phase B is
complete: the first batch removed the pure decomposition/code-shape tests, the
second batch trimmed the mixed/source-grep bus, feature-flag, lifecycle,
device-emulation, render-mode, and world-trace files down to lean runtime plus
narrow contract coverage, the next batch converted
`background-marking-activation`, `preview-tooltip`, and `popup-ai-run-gating`
into slimmer runtime/contract coverage while restoring the review-identified
background/content/popup seams, the following batch trimmed
`content-activation-order`, `core-scheduling`, and `core-motion-pause` while
keeping the unique contracts around manual enable rollback, consent observer
rescans, editor-reveal gating, queued explicit-toggle draining, stale async
reconcile aborts, cache-key invalidation, settle renders, and inspection
scroll-end settling, the next batch slimmed `popup-marking-refresh`,
`selector-suppression`, `content-high-risk-branches`, and
`page-motion-bridge-isolation` to focused popup/property-lock/live-page/
page-motion contracts while restoring the review-identified guard, transport,
and UI-wiring checks, and the latest batch trimmed `property-lock`,
`popup-mode-sync`, `popup-background-snapshot`, `popup-authority-boundary`,
`background-render-mode-inspection`, and `property-lock-render-mode` to lean
property-lock/render-mode/popup contracts while restoring the review-identified
reconnect, retarget, preserve-enabled, and popup-authority boundary checks. The
newest batch then trimmed `preview-tooltip`, `feature-flags`,
`background-remote-network`, and `background-command-hardening` by deleting
duplicated preview runtime coverage, dropping redundant flag/network shape
assertions, and keeping only the unique preview-restore, disabled-command,
payload-transfer, and background-ledger contracts. The closeout batch then
reduced the remaining source-grep holdouts in `page-save-state`,
`content-main-service-registry`, and `device-emulation-lifecycle` to their
final narrow behavior/helper-routing contracts. The latest checkpoint then
completed Phase C by renaming every surviving `tests/**/*.test.js` file to
`.test.ts`, moving the shared Vitest setup to `tests/setup-runtime.ts`,
updating the bootstrap/package/docs references, and removing the stale Deno
locator helpers from `tests/file-kit.ts`. The latest checkpoint then completed
Phase D by porting `src/popup/ui.ts` to React/JSX in `src/popup/ui.tsx`, adding
the React/WXT/Vitest tooling, extracting `src/popup/feature-flags-helpers.ts`,
and preserving the preview-scroll/self-heal seams with `flushSync(...)` plus
root error-hook remount recovery. The latest checkpoint then completed Phase E
by deleting the unused vendored Preact files and the stale vendor ignore,
leaving the popup stack React-only. The latest checkpoint then completed Phase G
by converting relative `.js` source imports under `src/**/*.{ts,tsx}` to
extensionless specifiers while preserving the frozen page-motion pair and
updating the coupled source-contract tests. The latest checkpoint then completed
Phase H: the final lint/dead-code cleanup pass. Unused catch bindings renamed to
`_error`/`_e`/`_fallbackError`; unused vars, functions, and type imports removed;
no-useless-assignment patterns fixed by removing the dead first assignment or
prefixing unused destructured args with `_`; the no-useless-escape in
`src/common/config.ts` fixed; and the locked freeze pair
(`page-motion-freeze-bridge.ts` / `page-motion-freeze-control.ts`) exempted from
`@typescript-eslint/no-unused-vars` and `prefer-spread` via a file-level ESLint
override rather than editing their content. All phases are now complete.

## 1. Goal

Make the test suite lean and uniformly TypeScript (only contract/behavior/
sentiment/guard tests, no fragile source-shape tests), keep only the single
active plan doc, replace the hand-written Preact `h()`/`render()` popup UI with
React + JSX markup, remove Preact entirely, fix the `logo.png` build placement,
convert `src` imports to extensionless, and run a lint/dead-code cleanup pass —
all with `pnpm verify` green and the live popup behavior unchanged.

## 2. Current facts (verified)

- Popup UI now lives in `src/popup/ui.tsx` on React + JSX. It keeps the same
  public API consumed by `popup.ts` and the live
  launcher: `initUi`, `getViewState`, `setViewState`, `onViewStateChange`,
  `getRefs`, `showToast`, `setUiBusy`, `View`, `ViewText`,
  `isPopupFeatureEnabled`, and many `setX` functions. `popup.ts` wires
  `__UNFLUFFIFY_POPUP_DEBUG__.getViewState = uiModule.getViewState` and the
  `pnpm browser:live` flow depends on it.
- `renderApp()` now uses a module-held React root, `flushSync(...)` for
  immediate ref availability after each render, and root error hooks that
  schedule a hard remount recovery on caught/uncaught React render failures.
- React tooling is now wired end-to-end: repo deps include `react`,
  `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, and
  `@wxt-dev/module-react`; `wxt.config.ts` registers the WXT React module;
  `vitest.config.ts` uses the React Vite plugin; and `tsconfig.json` /
  `eslint.config.js` now include `src/popup/**/*.tsx`.
- The old vendored Preact implementation is gone: `src/popup/vendor/preact/`
  was deleted, the vendor-specific ESLint ignore was removed, and repo docs now
  describe the popup UI as React-based.
- Relative source imports are now extensionless across `src/**/*.{ts,tsx}`
  except the locked `page-motion-freeze-bridge.ts` /
  `page-motion-freeze-control.ts` pair, whose source content stays frozen for
  parity/eval reasons.
- Popup feature-flag reads now have a plain-TS home in
  `src/popup/feature-flags-helpers.ts`, which `ui.tsx` re-exports so runtime
  callers stay stable while tests avoid importing the JSX module just to probe
  flag behavior.
- Tests are now uniformly TypeScript: all surviving test files are `.test.ts`,
  Vitest bootstraps through `tests/setup-runtime.ts`, the older `test-kit.ts`
  compatibility layer remains for the legacy assertion-style suites, and
  `tests/file-kit.ts` is now Node-only with the stale Deno locator helpers
  removed.
- Verified pure structural-shape tests (no execution):
  `popup-decomposition-boundary`, `background-decomposition-boundary`,
  `content-decomposition-boundary`, `content-main-runtime-router-contract`,
  `a1-bootstrap`, `c1/c2/c3/c4-entrypoint`.
- Many ui/popup/core tests still read source as text (grep or extract+eval) and
  break under the JSX port, but the biggest Phase B holdouts have now been
  reduced. `popup-marking-refresh`, `selector-suppression`,
  `content-high-risk-branches`, `page-motion-bridge-isolation`,
  `property-lock`, `popup-mode-sync`, `popup-background-snapshot`,
  `popup-authority-boundary`, `background-render-mode-inspection`, and
  `property-lock-render-mode` now keep only focused popup/property-lock/
  live-page/render-mode/page-motion contracts. `preview-tooltip`,
  `feature-flags`, `background-remote-network`, and
  `background-command-hardening` have now also been reduced to their remaining
  unique preview, flag-gate, transfer-payload, and ledger contracts. The
  final small holdouts `page-save-state`, `content-main-service-registry`, and
  `device-emulation-lifecycle` now keep only behavior-first or narrow ownership
  contracts. The earlier mixed/source-grep `content-activation-order`,
  `core-scheduling`, `core-motion-pause`, `background-marking-activation`,
  `popup-ai-run-gating`, `bus-boundary`, `lifecycle-broker`,
  `popup-render-mode`, and `world-trace-contract` files already keep only lean
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
- Add assertions: `tests/build-artifact-parity.test.ts` requires `logo.png` in
  output and triggers `pnpm build` itself when `.output/chrome-mv3` is absent;
  `tests/package-extension.test.ts` asserts `logo.png` is both listed in staged
  metadata and physically present in the stage directory.
- Validation: `pnpm exec vitest run tests/build-artifact-parity.test.ts
  tests/package-extension.test.ts`, including a clean `.output` run.

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

### Phase C — Port remaining tests to TS (task 2) — complete

- Renamed every surviving `tests/*.test.js` file to `tests/*.test.ts` and moved
  the shared Vitest setup file to `tests/setup-runtime.ts`.
- Updated package/bootstrap/docs/source-comment references to the `.ts` paths,
  including the generated-manifest verify command and the Vitest include glob.
- Removed the stale Deno locator helpers from `tests/file-kit.ts`; nothing
  imports them anymore.
- Validation: `pnpm lint && pnpm check && pnpm test && pnpm build` green; `find
  tests -name '*.test.js'` returns empty.

### Phase D — Port popup UI to React + JSX (task 4) — complete

- Added React runtime/tooling deps, registered `@wxt-dev/module-react` in
  `wxt.config.ts`, wired `@vitejs/plugin-react` into `vitest.config.ts`, and
  broadened TS/eslint coverage to `src/popup/**/*.tsx`.
- Renamed `src/popup/ui.ts` -> `src/popup/ui.tsx` and converted the full popup
  tree from Preact `h(...)` calls to JSX, preserving the exported UI API,
  preview/menu/toast/busy behaviors, and the popup debug view-state seam.
- Replaced the Preact-internal root reset with a React root using
  `flushSync(...)` for post-render ref safety and root error hooks that schedule
  a hard remount recovery on render failures.
- Extracted `isPopupFeatureEnabled(...)` into
  `src/popup/feature-flags-helpers.ts`, updated the coupled source-text tests to
  read `ui.tsx`, and broadened storage-boundary scanning to include `.tsx`.
- Validation: `pnpm lint && pnpm check && pnpm test && pnpm build` green.

### Phase E — Remove Preact completely (task 5)

- Deleted `src/popup/vendor/preact/` and removed the stale vendor ignore entry
  from `eslint.config.js`.
- Repo/runtime references to Preact are gone; only this plan keeps historical
  `preact` mentions to record the completed migration steps.
- Validation: `pnpm verify` green.

### Phase G — Convert src imports to extensionless

- Rewrote relative `from "./X.js"` / `import("./X.js")` specifiers to
  extensionless paths across `src/**/*.{ts,tsx}`.
- Kept the locked `src/common/page-motion-freeze-bridge.ts` and
  `src/common/page-motion-freeze-control.ts` pair untouched.
- Updated the coupled source-contract tests so they now assert extensionless
  imports while still normalizing manifest guard comparisons back to emitted
  `.js` artifact names where required.
- Validation: `pnpm lint && pnpm check && pnpm test && pnpm build` green.

### Phase H — Lint + dead-code cleanup pass — complete

- Added `eslint-plugin-unused-imports`; enabled
  `unused-imports/no-unused-imports: "error"` (auto-fixable) and turned
  `@typescript-eslint/no-unused-vars` back to `"error"`
  (`argsIgnorePattern: "^_"`); re-enabled `no-useless-assignment`,
  `no-useless-escape`, `prefer-spread`. Applied to BOTH runtime `src` globs and
  `tests/**`.
- Added file-level ESLint override for the locked freeze pair
  (`src/common/page-motion-freeze-bridge.ts` and
  `src/common/page-motion-freeze-control.ts`) disabling
  `@typescript-eslint/no-unused-vars` and `prefer-spread` without editing their
  content.
- Renamed all unused catch bindings (`error`, `e`, `fallbackError`) to
  `_error`, `_e`, `_fallbackError` to satisfy `caughtErrorsIgnorePattern: "^_"`.
- Removed/deleted dead functions, types, and imports across all flagged files.
- Fixed `no-useless-assignment` patterns by removing dead first-assignments.
- Fixed `no-useless-escape` in `src/common/config.ts` (unnecessary `\-` in
  character class).
- Prefixed unused function/callback args with `_`.
- Validation: `pnpm lint && pnpm check && pnpm test && pnpm build && pnpm verify
  && pnpm zip` all green. Live smoke (`pnpm browser:live <target-url>`) still
  requires an explicit target URL from the user.

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
