# WXT Port + Brain Authority Program — INDEX

Last updated: 2026-06-24
Branch: `feat/wxt-port-plan`

This is the **index** for a two-part program. It is written so a low-context agent
can execute the whole thing without heavy reasoning or open design decisions:

- **Part A — WXT toolchain cutover** (this file, §6): move from the custom
  Deno/esbuild pipeline to pnpm + WXT + Vitest, preserving user-visible behavior
  and runtime contracts. Behavior does NOT change in Part A; only the toolchain
  and entrypoint packaging change.
- **Part B — Brain (event-bus) rearchitecture** (driven by a dedicated doc set,
  §7): on the stable WXT baseline, stand up the event-bus authority model (single
  background Brain, stateless popup/content layers, typed request/publish seams)
  and migrate the code onto it domain-by-domain. Fully specified in:
  - `.copilot/event-bus-architecture-plan.md` (master spec, WXT-adapted)
  - `.copilot/event-bus/track-00-foundation.md` (Track 0, full detail)
  - `.copilot/event-bus/track-template.md` (per-domain executor-doc template)

> Sequencing decision (locked): **Part A fully cuts over first; then Part B runs on
> the stable WXT baseline.** We do NOT build the Brain on a half-migrated dual
> Deno+WXT build. See §3.

## 1. Goal

Port Unfluffify from the custom Deno/esbuild packaging pipeline to a pnpm + WXT +
Vitest pipeline (Part A) while preserving user-visible behavior and runtime
contracts on recent Chrome MV3, then shape the migrated code around the event-bus
authority model (Part B). The migration is phased with runnable checkpoints and
keeps equivalent live-browser debugging capability to the current
`deno task browser:live` flow.

## 2. Current facts

- Current build pipeline is custom Deno-based and writes unpacked outputs to
  `dist/extension-dev` and `dist/extension` via `scripts/build-extension.ts`.
- Current packaging/release staging is custom-manifest-driven via
  `scripts/package-extension.mjs` and
  `.github/workflows/build-extension-package.yml`.
- The extension is MV3 Chrome-targeted (`manifest.json`) and uses explicit
  `web_accessible_resources` allowlisting (no `content/*.js` wildcards). Cursor
  SVGs under `cursors/` are injected into the page world via
  `chrome.runtime.getURL(...)` and must stay web-accessible.
  `common/page-motion-freeze-control.ts` runs via
  `chrome.scripting.executeScript({ func })` and must NOT be web-accessible.
- Live debug flow is `scripts/launch-test-browser.ts`; it currently builds/loads
  `dist/extension-dev`, then binds the popup with `debugTabId`.
- Dev/test commands are Deno task based (`deno.json`): `check`, `test`, `lint`,
  `build:dev`, `build:release`, `verify`, `browser:live`.
- Tests (`tests/`, ~134 files) run on the Deno test runner. Many are
  source-contract tests that read raw source and regex-match implementation
  structure (e.g. `tests/manifest-permissions.test.js`, many
  `readFileSync(new URL(...))` assertions).
- No `package.json` exists on `main`; Part A introduces the Node/pnpm surface.
- Runtime modules and their decision ownership are catalogued in
  `.copilot/event-bus-architecture-plan.md` §3 (used by Part B).
- Repository constraints require preserving locked marking/highlighting,
  silent-highlight, visibility, reconciliation, XPath, AI-submission, and
  property-lock behavior contracts unless explicitly changed via the Part B
  approval gates.

## 3. Decisions already made (locked)

- Baseline for migration is **current `main` exactly**.
- Package manager/tooling direction is **pnpm + WXT**.
- **Test runner after cutover is Vitest** (WXT-native); the Deno test suite is
  migrated to Vitest in Part A. Lint moves from `deno lint` to **ESLint**.
- Migration strategy is **phased strangler migration with runnable checkpoints**.
- The **authority model target** is the event-bus Brain model (single background
  Brain + stateless layers + typed bus seams), specified in
  `.copilot/event-bus-architecture-plan.md`.
- **Sequencing: Part A (toolchain) fully cuts over first; Part B (Brain) runs on
  the stable WXT baseline.** No Brain skeleton is built mid-toolchain-migration.
- Tests may be reworked structurally, but behavior/contracts must remain intact.
- CI/CD can be redesigned to fit WXT.
- Strict prior manifest/compatibility process is not required; acceptance target
  is full functionality on recent Chrome.
- Live debug flow does **not** need identical command/output paths, but must
  remain functionally equivalent (same practical debugging ability).
- **WXT bundles the content entry**, so the historical "every new `content/*`
  module must be a separate web-accessible resource" rule is superseded for bundled
  modules; only `chrome.runtime.getURL(...)` page-world assets stay web-accessible.

## 4. Open questions

None pending from planning Q&A.

## 5. Non-goals

- Do not change locked marking/highlighting, silent-highlight, visibility,
  reconciliation, XPath, or AI-submission semantics during Part A; in Part B,
  change them only behind their approval gates.
- Do not change property-lock protocol semantics (Part B GATE P only).
- Do not change user-facing AI-run/save/reconcile semantics as part of toolchain
  migration.
- Do not attempt Firefox/Safari parity as part of this migration.
- Do not run dual long-term build systems after the Part A cutover (temporary
  dual-path is allowed during Part A phases only).
- Do not introduce new cross-cutting decision logic in popup/content modules; in
  Part B that logic moves toward background Brain deciders.

## 5a. WXT command surface (canonical mapping)

Every phase/track below uses these. After the Part A cutover (A7), no `deno task`
command remains.

| Purpose | Old (Deno) | New (pnpm + WXT) |
|---|---|---|
| dev build + watch | `deno task build:dev` (watch) | deferred until a later Part A watch phase; A1/A2 keep the current watcher on `deno task dev` because WXT still needs a watch-time bridge for the legacy runtime subtree |
| type-check | `deno task check` | `pnpm check` (`wxt prepare && tsc --noEmit`) |
| lint | `deno task lint` | `pnpm lint` (bootstrap-scoped ESLint in A1; broadens during A4) |
| test | `deno task test` | `pnpm test` (`vitest run`) |
| release build | `deno task build:release` | `pnpm build` (`wxt build` → `.output/chrome-mv3/`) |
| zip/package | `scripts/package-extension.mjs` | `pnpm zip` (A1 bridge zip over `.output/chrome-mv3`; WXT-native zip lands later) |
| verify (all) | `deno task verify` | `pnpm verify` (`lint && check && test && deno task verify`, where `deno task verify` now includes the post-build generated-manifest/WAR check) |
| live browser | `deno task browser:live <url>` | `pnpm browser:live <url>` (bridge: `deno task browser:live <url>`; loads `.output/chrome-mv3`) |

---

## 6. Part A — WXT toolchain cutover (behavior-preserving)

Part A produces a WXT + pnpm + Vitest baseline with **zero behavior change**. The
current runtime modules are wrapped by WXT entrypoints; their internals are not
touched. The Brain is NOT introduced in Part A.

### Phase A0 — Baseline parity inventory and safety rails

**Files to edit**: `.copilot/wxt-port-handoff.md`; (optional) `.copilot/knowledge.md`
only if new durable migration constraints are discovered.

**Steps**
1. Record baseline behavior checkpoints: build/test commands currently used; core
   runtime entrypoints and manifest mapping; live-debug critical capabilities
   (`state`, `observe`, `exit-preview`, popup binding).
2. Enumerate contract-critical tests that must stay green and catalogue the Deno
   test suite for the Vitest migration (count, which use `readFileSync`/source
   regex, which use `Deno.*` APIs that need a Vitest equivalent).
3. Freeze the baseline + test-migration checklist in the handoff doc.

**Expected state**: a concrete parity + test-migration checklist exists before
toolchain edits begin.
**Focused validation**: `git --no-pager diff --check`.
**Rollback rule**: if any baseline fact is uncertain, stop and add an explicit
"verify-first" checklist item before A1.

---

### Phase A1 — Bootstrap pnpm + WXT + ESLint + Vitest (dual-path)

**Files to edit (new)**: `package.json`, `pnpm-lock.yaml` (generated),
`wxt.config.ts`, `web-ext.config.ts` (optional, browser startup),
`tsconfig.json` (WXT-extended), `eslint.config.js` (flat config),
`vitest.config.ts`; `deno.json` (temporary bridge tasks); `README.md` (command
surface notes).

**Steps**
1. Add `package.json` with the bootstrap scripts needed in A1 (`build`, `zip`,
   `check`, `lint`, `test`, `verify`, `prepare`) and pnpm metadata. Defer the
   canonical `pnpm dev` watcher command to A2 when real WXT entrypoints exist.
2. `pnpm install` WXT, ESLint (flat config), Vitest, and required dev deps.
3. Add `wxt.config.ts`: Chrome MV3 target; **disable WXT auto-imports**
   (`imports: false`) to preserve the explicit-import codebase; set the manifest
   baseline equal to current `manifest.json` (permissions, host permissions, WAR,
   action, icons). Defer entrypoint-driven manifest generation to A2/A3.
4. Add `eslint.config.js` and `vitest.config.ts` scaffolding (no test files moved
   yet — that is A4).
5. Keep current Deno tasks working in parallel (dual-path) so check/test cadence
   stays available during A2–A6.

**Expected state**: `pnpm wxt --help`, `pnpm check`, `pnpm build`, and the
existing `deno task check` all succeed; no real entrypoints yet; `pnpm dev` is
still deferred to A2.
**Focused validation**: `pnpm wxt --help`; `pnpm check`; `pnpm build`; `deno task check`.
**Rollback rule**: if WXT bootstrap blocks on missing config assumptions, revert
only the new WXT files and retry with a minimal vanilla WXT config.

---

### Phase A2 — WXT entrypoints wrapping current modules (no Brain, no behavior change)

**Files to edit (new entrypoints)**:
- `entrypoints/background.ts` — `defineBackground(main)` that runtime-loads the
  mirrored legacy `legacy/background.js` bootstrap inside `main`. WXT imports
  this file in Node at build time, so no top-level runtime code; `main` cannot
  be async.
- `entrypoints/content-loader.content.ts` — `defineContentScript({ matches,
  runAt, world:"ISOLATED", main })`; `main()` runtime-loads
  `legacy/content-loader.js`.
- `entrypoints/page-motion-freeze-bridge.content.ts` —
  `defineContentScript({ world:"MAIN", matches, runAt, allFrames, main })`;
  `main()` runtime-loads `legacy/common/page-motion-freeze-bridge.js`.
- `entrypoints/popup/index.html` + `entrypoints/popup/main.ts` — WXT popup page
  that reproduces the current `popup.html` body while `main.ts` runtime-loads
  `legacy/popup.js`.
- `entrypoints/offscreen/index.html` + `entrypoints/offscreen/main.ts` —
  unlisted page entrypoint wrapping `legacy/offscreen.js` (referenced by
  `chrome.offscreen.createDocument`).
- `wxt.config.ts` — keep the source-owned manifest baseline fields (name/version/
  permissions/WAR/action/icons) but let WXT discover background/content entrypoints.
- `scripts/sync-wxt-bootstrap.mjs` — preserve WXT-owned runtime roots, mirror the
  Deno release tree under `.output/chrome-mv3/legacy/`, materialize root-path
  aliases for the WXT content scripts that must keep legacy root paths, and
  bridge the final manifest back to the source `action`/`background`/
  `content_scripts` contract.

**Steps**
1. Implement each entrypoint as a thin wrapper that runtime-loads the mirrored
   built JS under `.output/chrome-mv3/legacy/`, preserving init order. Do NOT
   edit the wrapped modules' logic.
2. Ensure content-script metadata (`matches`, `runAt`, `world`, `allFrames`)
   matches the current `manifest.json` exactly.
3. Because WXT emits content scripts under `content-scripts/<name>.js` and
   treats `popup.html` as a special popup entrypoint, bridge the final output so
   the shipped manifest/action block still matches the current source contract:
   keep `content-loader.js` as a root alias, keep no `action.default_popup`, and
   leave `background.js` plus `common/page-motion-freeze-bridge.js` on the
   mirrored legacy root artifacts until a later phase can replace them safely.
4. Keep page-injected static assets on the existing `chrome.runtime.getURL(...)`
   paths by preserving the current WAR list in `wxt.config.ts` and mirroring the
   legacy runtime tree alongside the WXT-owned roots.
5. Confirm `pnpm build` builds a loadable extension whose runtime behavior is
   unchanged. `pnpm dev` remains deferred until a watch-time bridge exists.

**Expected state**: WXT owns the safe runtime roots (`content-loader.js`,
`popup.html`, `offscreen.html`); the legacy release tree is mirrored under
`.output/chrome-mv3/legacy/`; `background.js` and
`common/page-motion-freeze-bridge.js` remain on the mirrored legacy root
artifacts; final manifest/action/content-script paths still match the current
source contract.
**Focused validation**: `pnpm build`; load `.output/chrome-mv3` and smoke the popup
+ a marking/AI run on a representative page.
**Rollback rule**: if an adapter import causes Node-context side effects at build
time, ensure ALL runtime code is inside `main` and runtime-loads mirrored built
JS; never put chrome APIs at entrypoint module top level and never import the
legacy browser-source entry roots directly from the WXT definition files.

---

### Phase A3 — Manifest / WAR parity via wxt.config.ts

**Files to edit**: `wxt.config.ts`; `manifest.json` (kept only as a comparison
artifact until parity is proven, then deleted in A7); the manifest-permissions
test.

**Steps**
1. Move full manifest authority to `wxt.config.ts` + entrypoint options. WXT
   generates `.output/chrome-mv3/manifest.json`.
2. Preserve required permissions/host permissions and explicit WAR entries needed
   by `chrome.runtime.getURL(...)` resources (cursors, injected HTML). Keep
   `common/page-motion-freeze-control.*` OUT of WAR.
3. Update `tests/manifest-permissions.test.js` to read the WXT-generated manifest
   (`.output/chrome-mv3/manifest.json`) or assert against `wxt.config.ts`, instead
   of the source `manifest.json`.
4. Add a deterministic manifest parity check (old `manifest.json` vs generated)
   during transition; allow intentional diffs (WXT housekeeping fields).

**Expected state**: the generated WXT manifest is authoritative and behaviorally
equivalent for Chrome runtime needs.
**Focused validation**: `pnpm build`; manifest-permissions test green.
**Rollback rule**: if the generated manifest breaks runtime, pin explicit manifest
fields in `wxt.config.ts` and defer optimization.

---

### Phase A4 — Migrate the test suite to Vitest + lint to ESLint

**Files to edit**: `tests/**` (Deno → Vitest), `vitest.config.ts`,
`eslint.config.js`, `package.json` scripts; remove Deno-test-only shims.

**Steps**
1. Convert `tests/*.test.js` from the Deno test runner to Vitest: `Deno.test(...)`
   → `describe/it`; `assert*` → `expect`; replace `Deno.*` file/URL APIs with Node
   `node:fs`/`node:url` equivalents. Source-contract tests that `readFileSync(new
   URL(...))` keep their structure; only the runner/assertion API changes.
2. Convert source-path assertions that referenced Deno/esbuild outputs (e.g.
   `dist/extension-dev`) to the WXT output (`.output/chrome-mv3`) where applicable.
3. Make `pnpm test` (Vitest) green for the whole suite; make `pnpm lint` (ESLint)
   green (port the rule intent from the active `deno.json` lint config).
4. Keep `deno task test` available until A7 as a temporary cross-check.

**Expected state**: `pnpm test` and `pnpm lint` pass on the full suite; behavior
coverage equals the prior Deno suite.
**Focused validation**: `pnpm test`; `pnpm lint`.
**Rollback rule**: migrate in batches by test directory/topic; if a converted file
weakens coverage, restore its assertions before deleting the Deno variant.

---

### Phase A5 — Live browser debug flow parity on WXT output

**Current status**: complete; the canonical launcher is now
`pnpm browser:live <url>` and the legacy `deno task browser:live <url>` entry
remains as a bridge to the same launcher until A7.

**Files to edit**: `scripts/launch-test-browser.ts`; `package.json`
(`browser:live` script); `.github/instructions/browser-launch.instructions.md`;
`.github/skills/launch-test-browser/SKILL.md`; `README.md` (debugging sections);
`deno.json` (`browser:live` task kept as a bridge until A7).

**Steps**
1. Point the launcher build/load logic to the WXT dev output
   (`.output/chrome-mv3`); build via `pnpm dev`/`pnpm build` before loading.
2. Preserve practical debugging capabilities: bound popup with correct `debugTabId`;
   `state`, `observe`, `exit-preview` control behavior; CDP attach to the same
   browser.
3. Expose `pnpm browser:live <url>` as the canonical command; update
   instructions/skill docs to match. Keep "managed Chromium only / no OS Chrome"
   guardrails.

**Expected state**: equivalent debug workflow works end-to-end against WXT output.
**Focused validation**: `pnpm browser:live <known-test-url>` manual flow check.
**Rollback rule**: if direct WXT-output loading is unstable, add a deterministic
adapter step that materializes the expected unpacked path, keeping the same command.

---

### Phase A6 — CI/CD and release migration to WXT

**Files to edit**: `.github/workflows/build-extension-package.yml`;
`scripts/package-extension.mjs` (replace with `wxt zip` or a thin wrapper);
`scripts/emit-package-metadata.ts` (adapt to WXT output if release consumers rely
on it); `README.md` packaging section.

**Steps**
1. Swap CI build/verify steps to the pnpm/WXT pipeline (`pnpm install`,
   `pnpm verify`, `pnpm zip`).
2. Recreate release artifact and alias semantics (`extension-latest`, stable alias
   zip naming) unless intentionally changed.
3. Keep deterministic metadata emission if release consumers rely on it.
4. Side-by-side compare the WXT zip against the legacy artifact before removing the
   old job.

**Expected state**: CI produces valid WXT-built artifacts and the release workflow
succeeds.
**Focused validation**: local `pnpm build` + `pnpm zip` smoke; workflow dry-run.
**Rollback rule**: keep the old packaging workflow as a temporary fallback job
until the new job produces an identical installable artifact.

---

### Phase A7 — Cutover cleanup (single WXT toolchain)

**Files to edit**: remove `scripts/build-extension.ts`, `scripts/package-extension.mjs`
(if replaced), the source `manifest.json`, and obsolete `deno.json` tasks/bridges;
`README.md`; `.copilot/knowledge.md` (record the durable toolchain change);
`.copilot/wxt-port-handoff.md`.

**Steps**
1. Remove dead Deno build/packaging paths and the dual-path bridges.
2. Finalize a single canonical developer workflow (pnpm/WXT/Vitest).
3. Ensure no stale references to removed outputs/commands remain (grep
   `deno task`, `dist/extension`, `build-extension.ts`).

**Expected state**: one clear, documented WXT-first build/release path with
equivalent behavior. **This is the Part A exit / Part B precondition** (see
`.copilot/event-bus-architecture-plan.md` §0).
**Focused validation**: `pnpm verify`; `pnpm browser:live <url>`.
**Rollback rule**: if cleanup reveals a hidden dependency on a removed script,
temporarily restore a thin wrapper and schedule targeted removal.

---

## 7. Part B — Brain (event-bus) rearchitecture on the WXT baseline

Part B is fully specified in its own doc set. Do not re-derive it here.

1. **Read** `.copilot/event-bus-architecture-plan.md` (master spec): goal, approved
   decisions, target architecture (bus / envelope / transport / Brain / layers /
   spinner authority), strangler-fig migration framework, the 14-track map, the
   lock-lifting approval gates (M/S/X/R/P), global validation, acceptance, and the
   Deno→WXT reconciliation table (§11).
2. **Confirm** Part A is complete and green (master plan §0 precondition).
3. **Execute Track 0** from `.copilot/event-bus/track-00-foundation.md` (bus,
   envelope, transport, Brain skeleton, legacy bridge, spinner-authority skeleton,
   empty layer hosts, dev-only round-trip self-test). No behavior change.
4. **Execute the domain tracks 1–13** in dependency order (master plan §7). For
   each, author its executor doc just-in-time by copying
   `.copilot/event-bus/track-template.md`, then implement. Locked tracks (5/7/8/9/11)
   MUST open with their approval gate.

Part B guardrails (from the master spec): exactly one authoritative `request`
handler per type per realm; layers are stateless; the page MAIN world stays
minimal (four relay commands); bus/brain/layer modules are bundled (no per-module
WAR); never change locked behavior without its gate; every commit is green
(`pnpm lint && pnpm check && pnpm test && pnpm build`).

---

## 8. Test matrix

### Part A (behavior parity)
- During migration: keep the Deno suite green (`deno task test`) AND grow the
  Vitest suite (`pnpm test`) until Vitest covers everything; then drop Deno (A4/A7).
- Build/integration: `pnpm check`, `pnpm build`.
- Live/manual: `pnpm browser:live <url>` — popup binding, `state`/`observe`/
  `exit-preview`, CDP attach; smoke a marking + AI run + page save on a
  representative page.

### Part B (authority model)
- Per-track focused Vitest batches while editing; then `pnpm verify`.
- Boundary tests: bus has no chrome import; layers hold no authoritative state and
  import no sibling layer; one `registerHandler` per request type per realm.
- Live validation for runtime-behavior tracks (master plan §8.1).

## 9. Regression risks

- **WAR under-scoping** breaks runtime `getURL(...)` loads (cursor assets).
  Protection: keep `getURL` assets web-accessible (or in `public/`) and keep the
  manifest-permissions test green against the generated manifest.
- **Content-script world/run-at mismatch** (`MAIN` vs `ISOLATED`, timing) silently
  alters behavior. Protection: entrypoint options mirror the current manifest
  exactly; live smoke on representative pages.
- **WXT build-time entrypoint execution**: chrome APIs at entrypoint top level run
  in Node and fail the build. Protection: all runtime code inside `main`; A2
  rollback rule.
- **Vitest migration coverage drift**: a converted test silently weakens coverage.
  Protection: dual-run Deno+Vitest through A4; compare counts/assertions before
  deleting Deno variants.
- **Authority regression** (Part B): logic drifts back into popup/content.
  Protection: per-domain Brain-ownership + layer-thinness boundary tests.
- **Debug-flow breakage**: output path/layout changes. Protection: dedicated phase
  A5; update launcher + docs together.
- **CI artifact/release drift**: side-by-side artifact comparison until the new
  pipeline is proven (A6).

## 10. Acceptance criteria

### Part A
- `pnpm build` produces a loadable Chrome MV3 extension; behavior is unchanged from
  `main` (live-smoked).
- `pnpm test` (Vitest), `pnpm check`, `pnpm lint`, `pnpm build` all green; the Deno
  build/packaging/tasks are removed.
- `pnpm browser:live` reproduces the live-debug capability.
- CI builds + packages through WXT.

### Part B
- Per the master spec §8.3: every cross-cutting decision is in a
  `background/brain/deciders/*` module; layers are stateless and import no sibling
  layer; one `registerHandler` per request type per realm; spinner content is
  produced only by `spinner-authority.ts`; legacy wire is deleted; the page MAIN
  world carries only the four relay commands; `pnpm verify` passes and all locked
  behaviors are unchanged (live-validated where required).

## 11. Todo chain

Combined SQL todo chain (seeded in `todos` + `todo_deps`):

Part A:
1. `wxt-a0-baseline-inventory`
2. `wxt-a1-bootstrap-toolchain`
3. `wxt-a2-entrypoint-adapters`
4. `wxt-a3-manifest-war-parity`
5. `wxt-a4-vitest-eslint-migration`
6. `wxt-a5-browser-live-debug-flow`
7. `wxt-a6-ci-release-migration`
8. `wxt-a7-cutover-cleanup`

Part B (depends on A7):
9. `bus-track0-foundation`
10. `bus-track1-popup-state`
11. `bus-track2-spinner-authority`
12. `bus-track3-activation-lifecycle`
13. `bus-track4-render-mode`
14. `bus-track5-ai-run`
15. `bus-track6-remote-config`
16. `bus-track7-page-save`
17. `bus-track8-marking`
18. `bus-track9-silent`
19. `bus-track10-preview`
20. `bus-track11-property-lock`
21. `bus-track12-emulation`
22. `bus-track13-legacy-teardown`

The dependency graph in `todo_deps` enforces phased autonomous execution (Part A
sequential; each Part B track depends on its predecessors per master plan §7).

## 12. Document index

- `.copilot/wxt-port-plan.md` — this index (Part A phases + Part B pointer).
- `.copilot/wxt-port-handoff.md` — low-context handoff (read-first list, baseline
  checklist, immediate next action).
- `.copilot/event-bus-architecture-plan.md` — Part B master spec (WXT-adapted).
- `.copilot/event-bus/track-00-foundation.md` — Part B Track 0 (full detail).
- `.copilot/event-bus/track-template.md` — Part B per-domain executor-doc template.
- `.copilot/event-bus/track-NN-<name>.md` — authored just-in-time per domain track.
