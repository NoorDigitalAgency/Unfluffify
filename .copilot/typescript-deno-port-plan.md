# TypeScript + Deno Toolchain Port Plan

Last updated: 2026-06-17

## 0. Purpose And Scope

Port the Unfluffify Chrome MV3 extension from plain JavaScript to **TypeScript**,
with **Deno as the development / build / watch / test toolchain** (replacing the
`npm` + `node --test` workflow), and add a **dev-only hot-reload watch** that
rebuilds and reloads the service worker plus affected tabs on change.

This document is written so an autonomous coding agent (target: GPT-5.3-Codex,
medium effort) can execute the entire port end to end without further design
decisions. Every phase has: Goal, Preconditions, Steps, Exit Criteria, a
Review/Fix iteration, and a Commit/Push checkpoint.

The extension artifact is the source of truth. Deno is the workshop around it.
**At the end of every phase the extension must still load in Chrome and the full
test suite must pass.** Never trade a green suite or a loadable extension for
migration progress.

## 1. Non-Negotiable Invariants (apply to every phase)

1. The extension remains loadable as an unpacked MV3 extension after every phase.
2. The full test suite is green at every phase boundary (no skips to "fix later").
3. The shipped/release artifact NEVER contains dev-only hot-reload code.
4. No behavior change to runtime contracts unless a phase explicitly calls for it.
   This is a tooling/type port, not a refactor. Do not "improve" logic in passing.
5. The locked contracts in `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `PROPERTY_LOCK.md`,
   `.copilot/knowledge.md` stay behaviorally identical. Types describe them; types
   do not change them.
6. `manifest.json` entry points and `web_accessible_resources` must keep resolving
   to real shipped files. The content world is loaded via dynamic `import()` from
   `content-loader.js`, so the module graph must stay as separate files (do NOT
   bundle the content world into one file unless a phase explicitly re-architects
   the loader + manifest + packaging together).
7. Artifact parity: when the build pipeline is introduced, the built JS that ships
   must be byte-equivalent in behavior to the current hand-written JS. Prove it
   with the parity gate (Phase 3) before converting any source to `.ts`.

## 2. Operating Rules For The Executing Agent

- Work only on the feature branch created in Phase 0. Never commit the port to
  `main` directly.
- Commit + push at the end of every phase AND at every internal checkpoint marked
  "CHECKPOINT". Use conventional commits, e.g.
  `chore(build): add deno toolchain alongside npm`.
- After any edit batch, run `get_errors` on changed files before moving on.
- Validate with the commands in Section 12. Capture the test summary line
  (`# tests`, `# pass`, `# fail`) every time.
- Terminal note: this workspace's interactive shell may break with an
  `oh-my-posh` "No such file or directory" error (stale Homebrew Cellar path).
  If interactive commands produce only oh-my-posh noise, run commands through a
  non-interactive shell (`bash --noprofile --norc -c '<cmd>'`) or via the VS Code
  task runner, and redirect output to a file under `.tmp/` to read it
  deterministically. Do not let this block validation.
- Keep a running scratchpad of the current phase + last green test count in
  `.copilot/typescript-deno-port-progress.md` (create it in Phase 0). Update it at
  every checkpoint so the port is resumable after interruption.
- If a phase's spike proves a chosen approach unworkable, STOP, record findings in
  the progress file, pick the documented fallback for that phase, and continue.
  Do not invent a third approach without recording why.

## 3. Locked Technical Decisions

These are decided. Do not relitigate during execution.

1. **In-place conversion.** Source files keep their current relative paths; a file
   converts from `x.js` to `x.ts` in the same directory. Source tree layout does
   not move to `src/`. This preserves manifest paths, `web_accessible_resources`,
   packaging dependency tracing, and the many source-contract tests that read
   files by relative URL.
2. **Transpile-only build, module graph preserved.** The build emits one `.js` per
   `.ts`, mirroring the directory structure into `dist/extension/`, keeping
   relative import specifiers intact. No bundling of the content world.
3. **Import specifiers stay `.js` in TS source.** TS files import siblings with the
   `.js` extension (e.g. `import { x } from "./foo.js"` even though `foo.ts` is the
   source). This is what the browser needs at runtime and what the transpile-only
   output preserves. Configure TS/Deno to resolve `.js` specifiers to `.ts` source
   for type-check and test (Deno `--unstable-sloppy-imports`; TS
   `moduleResolution: "bundler"` for `deno check`/editor).
4. **Build tool: esbuild, invoked through Deno** (`deno run -A npm:esbuild` or a
   Deno build script importing `npm:esbuild`), transpile-only
   (`bundle: false`, `format: "esm"`, `loader: ts`, per-file entry points mirrored
   to `dist/extension/`). Rationale: fastest, preserves ESM + module graph, trivial
   watch integration. Fallback: `deno run -A npm:typescript/bin/tsc` emit-only.
5. **Tests run with `deno test`** against the in-place source (TS once converted,
   JS until then), using `node:test` + `node:assert/strict` via Deno's Node compat.
   Until Phase 4 proves `deno test` runs the whole suite, keep `node --test`
   working in parallel as the safety net.
6. **Source-contract tests read source files** (`.ts` after a module converts), not
   `dist/`. Artifact-contract tests (packaging, manifest resolution, web-accessible
   coverage) run against `dist/extension/` after a build.
7. **Dev hot-reload is a generated, dev-only artifact.** It is injected only into
   the dev build (`dist/extension-dev/`), gated behind a build flag, and asserted
   ABSENT from the release build by a test.
8. **`.tmp/` and `dist/` are build output.** `dist/` must be added to `.gitignore`.
   Never commit built output.

## 4. Current-State Facts (verified 2026-06-17)

- MV3, `"type": "module"` service worker `background.js`; popup `popup.js` /
  `popup.html`; content entry `content-loader.js` dynamically importing
  `content-main.js` and the `content/*` graph; MAIN-world `common/page-motion-freeze-bridge.js`.
- `manifest.json` lists ~70 explicit files in `web_accessible_resources` plus
  `cursors/*.svg` glob. Every getURL-injected and dynamically-imported module is
  enumerated there; tests enforce this (`tests/manifest-permissions.test.js`,
  `tests/storage-access-boundary.test.js`).
- `package.json` scripts: `test` = `node --test`; `package:extension` =
  `node ./scripts/package-extension.mjs`.
- 124 `tests/*.test.js` files using Node's built-in runner. Many are
  **source-contract** tests using `readFileSync(new URL("../<file>.js", import.meta.url))`
  + regex assertions. Converting a module to `.ts` requires updating its
  source-contract test URL from `.js` to `.ts` and re-validating each regex against
  the emitted TS (most structural regexes survive; type annotations may need minor
  tweaks).
- `scripts/package-extension.mjs` statically traces deps from manifest entry points
  and `import`/asset specifiers, validates web-accessible coverage, and stages a
  release dir. After the build exists, packaging must stage from `dist/extension/`.
- `tests/package-test-script.test.js` asserts `npm test` uses the clean Node
  runner; this contract changes in Phase 4/10 and that test must be updated then.
- No existing `tsconfig.json`, `deno.json`, or `.ts` files.

## 5. Target Repository Shape (end state)

```
deno.json                      # tasks: check, test, build:dev, build:release, watch, package, fmt, lint
tsconfig.json                  # editor + deno check config (bundler resolution, strict)
types/                         # shared contract types (*.ts / *.d.ts)
scripts/build-extension.ts     # Deno build (esbuild transpile-only -> dist/extension[-dev])
scripts/dev-reload-client.ts   # dev-only reload helper, injected into dev build only
scripts/package-extension.ts   # packaging, staging from dist/extension/
background/*.ts content/*.ts common/*.ts popup/*.ts  # converted source, .js import specifiers
background.ts content-main.ts content-loader.ts popup.ts  # converted entrypoints
dist/extension/                # release build output (gitignored)
dist/extension-dev/            # dev build output, includes hot reload (gitignored)
tests/*.test.ts                # tests run by `deno test`, contract tests read .ts source
```

`package.json` is retained only as a thin compatibility shim (or removed in
Phase 10 once CI + docs reference Deno). `manifest.json` stays at repo root and is
copied into `dist/extension/` unchanged (paths already `.js`).

## 6. The Central Tension And How It Is Resolved

Chrome cannot run `.ts`; many tests read source as text; the content world is a
multi-file dynamic-import graph enumerated in `web_accessible_resources`.

Resolution, in order:
1. Keep files in place and keep `.js` import specifiers in `.ts` source.
2. Build transpile-only, mirroring the tree to `dist/extension/` so every
   manifest/web-accessible path still resolves to a real `.js` file.
3. Prove artifact parity (Phase 3) before any `.ts` exists, using an identity copy
   build, so the pipeline is trusted before it transforms anything.
4. Type-check and test against source using Deno sloppy-imports so `.js`
   specifiers resolve to `.ts`.
5. Convert modules leaf-first; each conversion updates its own tests and keeps the
   suite green.

## 7. Phase Overview

| Phase | Title | Net effect |
|------|-------|-----------|
| 0 | Feature branch + baseline | branch, progress file, recorded baseline |
| 1 | Deno toolchain alongside npm | `deno.json` tasks wrap existing node test + packaging |
| 2 | Type foundation (checkJs + shared types) | `deno task check` green over JS via JSDoc + `types/` |
| 3 | Build pipeline + artifact parity gate | `dist/extension/` built, parity proven, packaging from dist |
| 4 | Test runner migration to `deno test` | whole suite runs under Deno; node runner retained as net |
| 5 | Convert `common/*` + `types/*` leaf modules | first real `.ts` runtime modules |
| 6 | Convert `background/*` leaf modules | background helpers typed |
| 7 | Convert `content/*` handlers + `popup/*` modules | mid-tier typed |
| 8 | Convert entrypoints | `background.ts`, `content-main.ts`, `content/core.ts`, `popup.ts`, `content-loader.ts` |
| 9 | Dev watch + hot reload (dev-only) | `deno task watch` rebuilds + reloads SW/tabs |
| 10 | Cutover + cleanup | Deno is primary; npm scripts/docs/CI updated; release gate |

Phases 5-8 are the bulk; execute them in small module batches, each batch its own
CHECKPOINT commit.

---

## Phase 0 — Feature Branch + Baseline

Goal: isolate the port and capture an objective baseline.

Steps:
1. Ensure `main` is clean and up to date.
2. Create and switch to branch `feat/typescript-deno-port`.
3. Run the full suite; record the exact summary (`# tests`, `# pass`, `# fail`).
   As of this plan's writing the baseline is ~844 tests, 0 fail — confirm the live
   number and treat it as the regression floor.
4. Run `node ./scripts/package-extension.mjs --stage-dir .tmp/extension-baseline`
   and record success; keep the staged dir path for later parity comparison.
5. Create `.copilot/typescript-deno-port-progress.md` with: current phase, baseline
   test count, baseline package result, and an empty checkpoint log.

Exit criteria: branch exists; baseline test count + packaging recorded in the
progress file.

Review/Fix: confirm no stray files; `.tmp/` artifacts are gitignored.

Commit/Push: `chore(port): start typescript+deno port branch and baseline`.

---

## Phase 1 — Deno Toolchain Alongside npm

Goal: introduce Deno as a task runner without changing any runtime source.

Preconditions: Deno installed (`deno --version`); if absent, record the install
command in the progress file and install via the platform package manager.

Steps:
1. Add `deno.json` at repo root with tasks that initially shell out to the existing
   tooling so behavior is identical:
   - `test`: run the existing suite. First try `deno test -A --no-check tests/`
     using Node compat; if the whole suite does not run cleanly under Deno yet,
     make `test` invoke `node --test` for now and add a separate `test:deno` task
     for incremental migration (Phase 4 flips them).
   - `package`: `node ./scripts/package-extension.mjs`.
   - Placeholders (no-op or echo) for `check`, `build:dev`, `build:release`,
     `watch`, `fmt`, `lint` to be filled in later phases.
2. Add `deno.lock` handling: commit the lockfile once tasks pull `npm:` deps.
3. Do NOT delete or change `package.json` yet.
4. Add a spike: run `deno test -A --no-check tests/tab-operation-runner.test.js`
   (a pure module test) and `tests/background-render-mode-inspection.test.js` (a
   source-contract test). Record whether `node:test` + `node:assert/strict` +
   `readFileSync(new URL(...))` work under Deno. This de-risks Phase 4.

Exit criteria: `deno task test` and `deno task package` both succeed and match the
Phase 0 baseline; spike results recorded.

Review/Fix: ensure `deno.json` tasks do not silently weaken validation (no `|| true`,
no reduced test scope).

Commit/Push: `chore(build): add deno toolchain alongside npm`.

---

## Phase 2 — Type Foundation (checkJs + Shared Contract Types)

Goal: gain type certainty over the existing JS before converting it, and define
the shared contract types that motivated this port.

Steps:
1. Add `tsconfig.json`: `strict: true`, `allowJs: true`, `checkJs: true`,
   `noEmit: true`, `module: "esnext"`, `moduleResolution: "bundler"`,
   `target: "es2022"`, `types: []` plus Chrome types
   (`deno run -A npm:@types/chrome` or add `@types/chrome` via an import map / npm:
   specifier consumed only by the type-check task). Include `lib`:
   `["es2022","dom","dom.iterable","webworker"]` as needed for SW + DOM + popup.
2. Create `types/` with shared contract type modules (as `.ts` exporting types, or
   `.d.ts`):
   - `types/messaging.ts`: request/reply envelopes, `MESSAGE_ERROR_CODES`,
     `MESSAGE_SOURCES/TARGETS` unions (mirror `common/message-protocol.js`).
   - `types/lifecycle.ts`: `LifecycleKind`, `LifecyclePhase`, lifecycle event shape,
     spinner entry shape, `SPINNER_KEYS` (mirror `common/world-messaging-contract.js`).
   - `types/operations.ts`: `TabOperationResult<T>` and descriptor (mirror
     `background/tab-operation-runner.js`).
   - `types/render-mode.ts`: render-mode inspection result + snapshot.
   - `types/config.ts`: page-marking entry, config snapshot, tab state.
3. Wire the most fragile existing modules to these types via JSDoc
   `@typedef`/`@type`/`@param` annotations (no runtime change). Start with:
   `background/tab-operation-runner.js`, `background/spinner-operations.js`,
   `background/popup-state-broker.js`, `common/message-protocol.js`,
   `common/world-messaging-contract.js`, `popup/render-mode.js`.
4. Implement `deno task check` = `deno run -A npm:typescript/bin/tsc --noEmit -p tsconfig.json`
   (or `deno check` if sloppy-imports resolution is configured). Drive type errors
   to zero by adding annotations only — never by changing runtime behavior.
5. CHECKPOINT after the shared types compile and the first batch of annotated
   modules is clean. Commit.
6. Expand `checkJs` coverage outward in batches (common → background → content →
   popup), each batch a CHECKPOINT commit, until `deno task check` is green for the
   whole repo or a documented, tracked allowlist of remaining `// @ts-expect-error`
   / `any` boundaries (recorded in the progress file with a reason each).

Exit criteria: `deno task check` runs over the whole repo with zero errors (or a
recorded, minimal, justified allowlist); full test suite still green; zero runtime
diffs (annotations + comments only — confirm with a behavior-only review).

Review/Fix: diff-review every changed runtime file to confirm only JSDoc/comments
changed, not logic. Re-run full suite.

Commit/Push (final phase commit): `feat(types): add shared contract types and checkJs foundation`.

---

## Phase 3 — Build Pipeline + Artifact Parity Gate

Goal: a trusted transpile-only build to `dist/extension/`, proven to produce a
working artifact BEFORE any `.ts` exists.

Steps:
1. Add `dist/` to `.gitignore`.
2. Write `scripts/build-extension.ts` (Deno + `npm:esbuild`):
   - Inputs: every shipped source file referenced (directly or transitively) by
     `manifest.json` plus its CSS/HTML/asset siblings.
   - For `.js`/`.ts` modules: esbuild transpile-only (`bundle:false`,
     `format:"esm"`, `sourcemap` only in dev), output mirrored to
     `dist/extension/<same relative path>` with `.js` extension.
   - For non-JS assets (`.html`, `.css`, images, fonts, cursors, `manifest.json`):
     copy verbatim to `dist/extension/`.
   - Accept `--dev` (adds sourcemaps + later the reload client) and `--release`.
3. Phase-3 build is effectively an IDENTITY build (source is still `.js`), so the
   emitted files should be behaviorally identical to source.
4. Parity gate: build `dist/extension/`, then run
   `node ./scripts/package-extension.mjs --stage-dir .tmp/extension-from-dist`
   pointed at the built output, and compare the staged file set + the manifest
   resolution against the Phase 0 baseline. Add a test
   `tests/build-artifact-parity.test.*` asserting: every `web_accessible_resources`
   entry exists in `dist/extension/`; every manifest entry point exists; the dev
   build contains the reload client and the release build does not (the latter two
   assertions are stubbed now, enforced in Phase 9).
5. Update packaging to stage from `dist/extension/` (add a `--from-dist` mode or a
   new `scripts/package-extension.ts`). Keep the old packaging path working until
   Phase 10.
6. Add `deno task build:release` and `deno task build:dev`.
7. CHECKPOINT: load `dist/extension/` as an unpacked extension in Chrome and
   confirm the popup opens, marking enables, and render-mode inspection works (live
   smoke; if a live browser is unavailable, rely on the parity test + packaging and
   record that a manual smoke is pending).

Exit criteria: `deno task build:release` produces a loadable `dist/extension/`;
parity test green; packaging works from `dist/`; full suite green.

Review/Fix: confirm no source file changed behavior; confirm `dist/` is gitignored
and not staged.

Commit/Push: `feat(build): add deno transpile-only build with artifact parity gate`.

---

## Phase 4 — Test Runner Migration To `deno test`

Goal: make `deno test` the primary runner for the whole suite while keeping
`node --test` as a temporary safety net.

Steps:
1. Configure `deno test` to run all `tests/*.test.*` with the permissions the suite
   needs (`-A` is acceptable for a local dev/test runner; narrow later if desired).
   Use `--unstable-sloppy-imports` so `.js` specifiers will resolve to `.ts` once
   modules convert.
2. Resolve any Node-compat gaps surfaced by the Phase 1 spike (e.g. `node:fs`,
   `node:test` lifecycle, `import.meta.url` URL reads). Prefer adjusting the test
   harness over changing runtime code.
3. Make `deno task test` run the full suite under Deno and assert the SAME pass
   count as the Phase 0 baseline. Keep `deno task test:node` = `node --test` until
   Phase 10.
4. Update `tests/package-test-script.test.js` expectations only when the canonical
   command actually changes (guard against asserting a command that no longer
   exists); if it still asserts `npm test`, leave it until Phase 10 and note it.

Exit criteria: `deno task test` runs the entire suite with the baseline pass count;
`node --test` still green too.

Review/Fix: compare Deno vs Node test counts; investigate any test that passes
under one runner but not the other before proceeding.

Commit/Push: `feat(test): run full suite under deno test with node runner as net`.

---

## Phase 5 — Convert `common/*` + `types/*` Leaf Modules To `.ts`

Goal: first real runtime `.ts`, lowest-risk (pure/shared, no Chrome entrypoint).

Batch order (smallest dependency fan-in first): `common/message-protocol`,
`common/world-messaging-contract`, `common/selector-set`, `common/text`,
`common/feature-flags`, `common/constants`, `common/utilities`, then the rest of
`common/*`. Promote the Phase-2 `types/` JSDoc shapes into real exported TS types.

Per-module procedure (the repeatable unit of work for Phases 5-8):
1. Rename `x.js` to `x.ts`. Keep `.js` import specifiers.
2. Replace JSDoc types with real TS annotations; remove now-redundant runtime type
   guards ONLY if they were pure type assertions with no runtime effect (be
   conservative; when in doubt keep them).
3. Update the module's build inclusion (the build globs `.ts` automatically once
   the tree is globbed; verify output lands at the same relative `.js` path).
4. Update every test and source file that imports it — specifier stays `.js`, no
   change needed at call sites; only the file on disk changed extension.
5. Update that module's source-contract test (if any) to read the `.ts` file and
   adjust regexes for type syntax. Rename the test to `.test.ts` if it now contains
   TS.
6. `deno task check` + `deno task test` (focused on the touched module + its
   dependents) must be green; then full suite.
7. CHECKPOINT commit per small batch (3-8 modules), e.g.
   `refactor(common): convert message-protocol and contract modules to typescript`.

Exit criteria: all of `common/*` is `.ts`; `deno task check` + full suite green;
`dist/extension/` still builds and loads.

Review/Fix: run the build, re-run the parity test, diff-review for accidental
behavior changes.

Commit/Push: phase-final commit summarizing the common conversion.

---

## Phase 6 — Convert `background/*` Leaf Modules

Goal: type the background helper layer (not `background.js` itself yet).

Batch order: `background/tab-operation-runner`, `background/spinner-operations`,
`background/popup-state-broker`, `background/managed-timeouts`,
`background/async-tasks`, `background/tab-runtime`, `background/tab-session-store`,
`background/command-router`, `background/command-ledger`,
`background/transfer-payload-store`, `background/world-trace`,
`background/tab-inactivity-observer`, then the remaining `background/*`.

Use the same per-module procedure as Phase 5. Pay special attention to
`background/tab-session-store.js` — it is enumerated in `web_accessible_resources`,
so confirm `dist/extension/background/tab-session-store.js` still exists and is
referenced.

Exit criteria: all `background/*` helpers are `.ts`; build + suite green.

Review/Fix: re-run `tests/storage-access-boundary.test.*`, `tests/manifest-permissions.test.*`,
and the parity test (web-accessible coverage is the main risk here).

Commit/Push: `refactor(background): convert background helper modules to typescript`.

---

## Phase 7 — Convert `content/*` Handlers + `popup/*` Modules

Goal: type the mid-tier handler and popup-helper layers (not `content/core.js`,
`content-main.js`, or `popup.js` yet).

Batch order: pure `content/*-rules` and `content/*-handler` modules first
(`content/marking-rules`, `content/submission-rules`,
`content/silent-highlight-rules`, `content/shared-inclusion`,
`content/shared-selector-cache`, the `content/*-handler` set,
`content/inspection-status`, `content/page-toast`, `content/page-world-relay`,
`content/content-command-router`, `content/content-main-service-registry`), then
the `popup/*` modules (`popup/render-mode`, `popup/spinner`, `popup/ui` helpers,
`popup/messages`, `popup/page-reconciliation`, `popup/render-mode-inspection`,
`popup/ai-run`, `popup/property-lock-ui`, etc.).

Every `content/*` module converted here is in `web_accessible_resources` — after
each batch, rebuild and confirm the corresponding `dist/extension/content/*.js`
exists. Same per-module procedure.

Exit criteria: all `content/*` (except `content/core.js`) and all `popup/*` (except
`popup.js`) are `.ts`; build + suite green; web-accessible coverage intact.

Review/Fix: full parity test + manifest-permissions test + a live or stubbed smoke.

Commit/Push: `refactor(content,popup): convert handler and popup helper modules to typescript`.

---

## Phase 8 — Convert Entrypoints

Goal: convert the five high-risk entrypoints last, one per CHECKPOINT, with extra
validation each.

Order (each its own commit): `content-loader.ts` → `popup.ts` → `content-main.ts`
→ `content/core.ts` → `background.ts`. Also convert
`common/page-motion-freeze-bridge.js` carefully — it is a MAIN-world
`document_start` classic-ish script whose body must stay byte-identical to
`common/page-motion-freeze-control.js` (a test enforces this); convert both
together and keep that test green.

Extra rules for this phase:
- Entrypoints have the largest source-contract test surface. Expect to update many
  `readFileSync(new URL("../<entry>.js"))` to `.ts` and re-validate dozens of
  regexes per entrypoint. Do this methodically; run the touched test file after
  each regex fix.
- `background.ts` is the service worker — confirm `manifest.json` still points at
  `background.js` and the build emits `dist/extension/background.js`.
- After each entrypoint converts, rebuild `dist/extension/`, run the full suite,
  and (if a browser is available) live-smoke popup open + marking enable +
  render-mode without-JS/with-JS + spinner clear.

Exit criteria: every shipped runtime file is `.ts`; `deno task check` + full suite
green; release build loads and passes a live smoke (or smoke explicitly deferred
and recorded).

Review/Fix: a full read-through diff of each entrypoint focused on "did any logic
change?"; the answer must be no except type-driven narrowing.

Commit/Push: phase-final `refactor(core): convert extension entrypoints to typescript`.

---

## Phase 9 — Dev Watch + Hot Reload (Dev-Only)

Goal: `deno task watch` rebuilds on change and reloads the service worker + active
Unfluffify tabs, without any of this reaching the release artifact.

Steps:
1. Write `scripts/dev-reload-client.ts`: a tiny module that, in the dev build only,
   opens a connection to the watcher (e.g. a localhost WebSocket the Deno watch
   server hosts) and on a "rebuilt" message calls `chrome.runtime.reload()` from
   the service worker, and refreshes tabs where the extension is active. Keep it
   fail-open and side-effect-free if the watcher is absent.
2. `scripts/build-extension.ts --dev` injects the reload client into the dev SW
   entry (and only the dev build) and outputs to `dist/extension-dev/`.
3. `deno task watch`: watch source globs (`background/**`, `content/**`, `common/**`,
   `popup/**`, root entrypoints, `manifest.json`, CSS/HTML), debounce, run
   `deno task check` (fast, optional fail-soft in watch), rebuild `--dev`, and
   notify connected reload clients.
4. Enforce dev/release separation with tests:
   - release build (`dist/extension/`) must NOT contain the reload client or any
     `chrome.runtime.reload()` dev hook (assert absence).
   - dev build (`dist/extension-dev/`) MUST contain it (assert presence).
   These are the assertions stubbed in Phase 3.
5. Document the dev loop in `README.md` (load `dist/extension-dev/` unpacked, run
   `deno task watch`).

Exit criteria: `deno task watch` rebuilds + reloads on change against the dev build;
release build proven free of dev-reload code by test; full suite green.

Review/Fix: confirm the watcher never edits source, only `dist/extension-dev/`;
confirm no dev port/permission leaks into `manifest.json` release.

Commit/Push: `feat(dev): add deno watch with dev-only service-worker hot reload`.

---

## Phase 10 — Cutover + Cleanup

Goal: Deno becomes the canonical toolchain; remove redundancy; final gates.

Steps:
1. Make `deno task test` the canonical test command; drop `deno task test:node`
   (or keep one CI fallback). Update `tests/package-test-script.test.*` and any
   test asserting `npm test`/`node --test` to assert the Deno command.
2. Repoint `scripts/package-extension.*` to build (`deno task build:release`) then
   stage from `dist/extension/`. Update `tests/package-extension.test.*` accordingly.
3. Reduce `package.json` to a compatibility shim or remove it if nothing depends on
   it; if removed, confirm no docs/CI/tooling references remain.
4. Update `README.md` Build/Testing/Development sections to Deno commands; update
   `.copilot/plan.md` "Validation Baseline" to the Deno commands + new test count.
5. Update `.copilot/knowledge.md` with the new toolchain facts (Deno tasks, build
   output location, dev-reload separation, type-contract source of truth in
   `types/`). Update repo memory (`/memories/repo/`) similarly.
6. Update `.github/` CI (if present) to install Deno and run `deno task check`,
   `deno task test`, `deno task build:release`, `deno task package`.
7. Final full review (Section 11 checklist) + final full suite + release build +
   live smoke.

Exit criteria: Deno is the only documented toolchain; all docs/tests/CI consistent;
release build loads and smokes clean; full suite green.

Review/Fix: a complete repository review pass (Section 11). Fix to clean.

Commit/Push: `chore(port): cut over to deno toolchain and retire npm scripts`.
Then open a PR from `feat/typescript-deno-port` to `main` (do not self-merge unless
instructed).

---

## 8. Per-Phase Review/Fix Iteration (run before each phase's final commit)

Iterate REVIEW → FIX → RE-REVIEW until the review is clean, then commit:
1. `deno task check` — zero type errors (or only the recorded allowlist).
2. `deno task test` (and `node --test` until Phase 10) — pass count >= baseline,
   0 fail.
3. `deno task build:release` — succeeds; parity test green.
4. Behavior-only diff review of every changed runtime file — confirm no logic
   change beyond the phase's stated intent.
5. `web_accessible_resources` / manifest coverage tests green.
6. No `dist/` or `.tmp/` artifacts staged; `.gitignore` correct.
7. Progress file updated with phase, checkpoint, and current green test count.

## 9. Commit / Push Cadence

- Conventional commits; one phase may contain several CHECKPOINT commits plus a
  phase-final commit.
- Push after every commit (`git push -u origin feat/typescript-deno-port` first
  time). Pushing frequently makes the port resumable and reviewable.
- Never force-push shared history. Never commit `dist/` or `.tmp/`.

## 10. Rollback Strategy

- Every phase is independently revertible: if a phase regresses, `git revert` its
  phase-final commit (and its checkpoints) rather than hand-unwinding.
- Because conversion is leaf-first and the extension stays loadable each phase, the
  branch can be paused and shipped from the last green phase if needed.
- The Phase 0 baseline (test count + `.tmp/extension-baseline`) is the reference for
  "are we still equivalent".

## 11. Final Repository Review Checklist (Phase 10)

- [ ] Every shipped runtime file is `.ts`; build emits matching `.js` in `dist/extension/`.
- [ ] `manifest.json` paths + `web_accessible_resources` all resolve in `dist/extension/`.
- [ ] Release build contains zero dev-reload code; dev build contains it (tests prove both).
- [ ] `deno task check` clean; `deno task test` >= baseline, 0 fail.
- [ ] `deno task build:release` + packaging produce a loadable, smoke-clean artifact.
- [ ] Locked contracts (marking, property-lock, knowledge) behaviorally unchanged.
- [ ] Docs (`README.md`, `.copilot/plan.md`, `.copilot/knowledge.md`) + CI reference Deno.
- [ ] `dist/` gitignored; no build output committed; `package.json` reduced/removed cleanly.
- [ ] Repo memory (`/memories/repo/`) updated with the new toolchain + type-contract facts.

## 12. Validation Commands Reference

Replace `<deno>` with the resolved Deno binary. If the interactive shell is broken
by oh-my-posh, run via `bash --noprofile --norc -c '<cmd>'` and tee to `.tmp/`.

- Full suite (Node, baseline net): `node --test`
- Full suite (Deno): `deno task test`
- Focused tests (Node): `node --test tests/<file>.test.ts tests/<file2>.test.ts`
- Type check: `deno task check`
- Release build: `deno task build:release`
- Dev build: `deno task build:dev`
- Watch + hot reload: `deno task watch`
- Package (post-build): `deno task package` (stages from `dist/extension/`)
- Baseline package (Phase 0): `node ./scripts/package-extension.mjs --stage-dir .tmp/extension-baseline`

## 13. Risk Register

| Risk | Mitigation |
|------|-----------|
| `.js`↔`.ts` specifier resolution for tests | Deno `--unstable-sloppy-imports`; spike in Phase 1; fallback = run tests against `dist/` for behavior tests, source for contract tests |
| Source-contract regexes break on TS syntax | Convert each test alongside its module; re-validate per regex; keep changes structural |
| Content world is multi-file dynamic import | Transpile-only, preserve module graph + `web_accessible_resources`; never bundle without re-architecting loader+manifest+packaging together |
| Dev-reload code leaking into release | Dev-only injection + presence/absence tests (Phase 9), enforced in CI |
| Artifact drift from build transform | Identity-build parity gate in Phase 3 before any `.ts` exists |
| `node:test` gaps under Deno | Phase 1 spike + Phase 4; keep `node --test` net until Phase 10 |
| Entrypoint conversions destabilize runtime | Convert last, one per commit, with live smoke each (Phase 8) |
| Broken interactive shell hides failures | Non-interactive shell / VS Code tasks + tee to `.tmp/`; never accept unparseable output as "passing" |

## 14. Definition Of Done

- The whole shipped codebase is TypeScript; Deno builds it to a loadable MV3
  artifact; `deno task` is the documented dev/build/test/watch toolchain; dev
  hot-reload works and is provably absent from release; the full test suite passes
  at or above the Phase 0 baseline; locked behavioral contracts are unchanged; and
  a PR from `feat/typescript-deno-port` to `main` is open for human review.
