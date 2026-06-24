# WXT Port Plan (pnpm-first, main baseline, Brain-authority shape)

Last updated: 2026-06-24  
Branch: `feat/wxt-port-plan`

## 1. Goal

Port Unfluffify from the custom Deno/esbuild packaging pipeline to a pnpm + WXT pipeline while preserving user-visible behavior and runtime contracts on recent Chrome MV3, **and** shape the migrated code around the event-bus authority model defined in the initial event-bus architecture plan (`31ab189`). The migration must remain phased with runnable checkpoints and keep equivalent live-browser debugging capability to the current `deno task browser:live` flow.

## 2. Current facts

- Current build pipeline is custom Deno-based and writes unpacked outputs to `dist/extension-dev` and `dist/extension` via `scripts/build-extension.ts`.
- Current packaging/release staging is custom-manifest-driven via `scripts/package-extension.mjs` and `.github/workflows/build-extension-package.yml`.
- The extension is MV3 Chrome-targeted (`manifest.json`) and uses explicit `web_accessible_resources` allowlisting.
- Live debug flow is implemented by `scripts/launch-test-browser.ts` and currently builds/loads `dist/extension-dev`, then binds popup with `debugTabId`.
- Dev/test commands are Deno task based (`deno.json`), including `check`, `test`, `build:dev`, `build:release`, and `browser:live`.
- Tests include source-contract-style coverage that reads raw source and regex-matches implementation structure (for example `tests/manifest-permissions.test.js` and many `readFileSync(new URL(...))` assertions).
- No `package.json` currently exists on `main`; adding pnpm/WXT introduces Node package-manager surface as new project infrastructure.
- Repository constraints still require preserving locked marking/highlighting and property-lock behavior contracts unless explicitly changed.
- Initial event-bus architecture plan was introduced in commit `31ab189` and defines the target authority model:
  - one in-realm bus per realm (`request` + `publish`)
  - single authoritative background logical unit (“Brain”)
  - stateless popup/content layers that execute directives and report events
  - cross-realm transport with legacy bridge during migration.

## 3. Decisions already made

- Baseline for migration is **current `main` exactly**.
- Package manager/tooling direction is **pnpm + WXT**.
- Migration strategy is **phased strangler migration with runnable checkpoints**.
- The **authority model target** for this WXT migration is the event-bus initial-plan model from `31ab189` (Brain ownership + stateless layers + bus transport seams).
- Tests may be reworked structurally, but behavior/contracts must remain intact.
- CI/CD can be redesigned to fit WXT.
- Strict prior manifest/compatibility process is not required; acceptance target is full functionality on recent Chrome.
- Live debug flow does **not** need identical command/output paths, but must remain functionally equivalent (same practical debugging ability).

## 4. Open questions

None pending from planning Q&A.

## 5. Non-goals

- Do not change locked marking/highlighting semantics.
- Do not change property-lock protocol semantics.
- Do not change user-facing AI-run/save/reconcile semantics as part of toolchain migration.
- Do not attempt Firefox/Safari parity as part of this migration.
- Do not run dual long-term build systems after final cutover (temporary dual-path is allowed during migration phases only).
- Do not introduce new cross-cutting decision logic in popup/content modules during migration; that logic must move toward background Brain deciders.

## 6. Implementation phases

### Phase 0 — Baseline parity inventory and safety rails

**Files to edit**
- `.copilot/wxt-port-handoff.md`
- (optional) `.copilot/knowledge.md` only if new durable migration constraints are discovered

**Functions/tests to touch**
- No production code changes
- Only documentation and parity checklist references

**Steps**
1. Record baseline behavior checkpoints:
   - build/test commands currently used
   - core runtime entrypoints and manifest mapping
   - live-debug critical capabilities (`state`, `observe`, `exit-preview`, popup binding)
2. Enumerate contract-critical tests that must stay green.
3. Freeze baseline checklist in handoff doc.

**Expected intermediate state**
- A concrete parity checklist exists before toolchain edits begin.

**Focused validation**
- `git --no-pager diff --check`

**Rollback/fallback rule**
- If any baseline fact is uncertain, stop and add explicit “verify-first” checklist item before Phase 1.

---

### Phase 1 — Bootstrap pnpm + WXT and preserve dual-path safety

**Files to edit**
- `package.json` (new)
- `pnpm-lock.yaml` (new, generated)
- `wxt.config.ts` (new)
- `web-ext.config.ts` (new, optional if needed for startup behavior)
- `deno.json` (task wrappers/bridges)
- `README.md` (command surface notes)

**Functions/tests to touch**
- Add script-level wiring only; no domain behavior logic.

**Steps**
1. Add `package.json` with WXT scripts (`dev`, `build`, `zip`, `prepare`) and pnpm metadata.
2. Install WXT and required dependencies with pnpm.
3. Add `wxt.config.ts` with Chrome MV3 targeting and explicit manifest baseline copied from current `manifest.json`.
4. Keep current Deno tasks initially; add temporary bridge tasks (for example Deno task invoking pnpm where needed).
5. Keep current Deno build path intact in parallel.

**Expected intermediate state**
- `pnpm install` and basic WXT command invocation succeed while old Deno build still works.

**Focused validation**
- `pnpm wxt --help`
- `deno task check`

**Rollback/fallback rule**
- If WXT bootstrap blocks on missing config assumptions, revert only new WXT files and retry with a minimal vanilla WXT config.

---

### Phase 2 — Establish authority skeleton in WXT shape (no behavior change)

**Files to edit**
- `entrypoints/background.ts` (new)
- `entrypoints/popup.html` + `entrypoints/popup.ts` (new)
- `entrypoints/content-loader.content.ts` (new)
- `entrypoints/page-motion-freeze-bridge.content.ts` (new)
- `entrypoints/offscreen.html` + `entrypoints/offscreen.ts` (new, if needed)
- `common/bus/*` (new skeleton modules)
- `background/brain/*` (new skeleton modules)
- `popup/layers/*` and `content/layers/*` (new skeleton modules)
- `wxt.config.ts`

**Functions/tests to touch**
- Existing runtime modules remain source-of-truth:
  - `background.ts`
  - `popup.ts`
  - `content-loader.ts`
  - `common/page-motion-freeze-bridge.ts`
  - `offscreen.ts`
- New modules must initially be scaffolds compatible with the event-bus model:
  - background Brain root + state-store/projection shells
  - bus envelope/bus/errors/realms + transport interfaces
  - popup/content layer hosts (stateless, render-only shells)

**Steps**
1. Implement WXT entrypoints that load current modules inside WXT-expected entrypoint contracts.
2. Ensure content script metadata (`matches`, `runAt`, `world`, `allFrames`) matches existing manifest behavior.
3. Ensure popup/offscreen wiring points to current UI/runtime modules.
4. Add the Brain/bus/layer skeleton files in compile-safe, no-op mode (no production route changes yet).
5. Keep existing modules unchanged except where wrapper-safe initialization is required.

**Expected intermediate state**
- WXT builds a runnable extension with current runtime logic still concentrated in existing modules, while Brain/bus/layer seams exist and are ready for progressive cutover.

**Focused validation**
- `pnpm wxt build`
- Focused test batch for entrypoint assumptions:
  - `deno test -A --no-check --unstable-sloppy-imports tests/manifest-permissions.test.js tests/background-command-hardening.test.js`

**Rollback/fallback rule**
- If adapter import strategy causes Node-context side effects at build time, switch to lazy runtime import in entrypoint `main()` and keep legacy modules untouched.

---

### Phase 3 — Manifest/WAR parity plus transport seams

**Files to edit**
- `wxt.config.ts`
- `manifest.json` (remove only after parity proven; until then keep as comparison artifact)
- tests referencing raw `manifest.json` paths:
  - `tests/manifest-permissions.test.js`

**Functions/tests to touch**
- Manifest-generation expectations, parity assertions, and initial bus wire seam checks.

**Steps**
1. Move full manifest authority to WXT config.
2. Preserve required permissions/host permissions and explicit WAR entries needed by `chrome.runtime.getURL(...)` resources.
3. Update tests that read source `manifest.json` to read generated manifest or equivalent config source.
4. Add a deterministic manifest parity check script during transition (`old manifest` vs `generated manifest`, allow intentional diffs).
5. Add/adjust source-contract tests to lock that new bus traffic classification does not alter legacy message handling paths yet.

**Expected intermediate state**
- Generated WXT manifest is authoritative and behaviorally equivalent for Chrome runtime needs.

**Focused validation**
- `pnpm wxt build`
- `deno test -A --no-check --unstable-sloppy-imports tests/manifest-permissions.test.js`

**Rollback/fallback rule**
- If generated manifest introduces runtime breakage, pin explicit manifest fields in `wxt.config.ts` and defer optimization.

---

### Phase 4 — Introduce Brain-owned decision boundaries domain-by-domain

**Files to edit**
- Background authority and bus wiring:
  - `background.ts`
  - `background/brain/index.ts`
  - `common/bus/contracts/*`
  - `common/bus/transport/*`
- Popup/content layer route points:
  - `popup/messages.ts`
  - `popup/page-reconciliation.ts`
  - `content/runtime-message-handler.ts`
- Source-contract suites that depend on old file layout/authority:
  - `tests/popup-marking-refresh.test.js`
  - `tests/background-marking-activation.test.js`
  - `tests/ai-run.test.js`
  - `tests/page-save-state.test.js`
  - `tests/selector-suppression.test.js`

**Functions/tests to touch**
- Move decision ownership toward Brain deciders by domain while keeping behavior stable.
- Update source-read expectations and add behavior guards for ownership moves.

**Steps**
1. Migrate one domain at a time to Brain-request-owned routes (activation, render-mode, AI-run, remote-config, page-save/reconciliation) with typed contracts.
2. For each moved domain, keep popup/content modules thin: local render + event report only, no new cross-cutting policy.
3. Replace brittle file-path/shape assertions with contract-level checks tied to behavior-critical symbols.
4. Keep “contract intact” semantics explicit in test names/messages.
5. Run focused suite per moved domain before broad suite.

**Expected intermediate state**
- Core cross-cutting logic ownership is centralized in background Brain deciders; tests reflect authority model and still guard behavior.

**Focused validation**
- Domain-focused Deno test batches while editing
- then `deno task check && deno task test`

**Rollback/fallback rule**
- If a test rewrite weakens protection, add parallel behavior assertion before removing old source-contract clause.

---

### Phase 5 — Live browser debug flow parity on WXT outputs

**Files to edit**
- `scripts/launch-test-browser.ts`
- `deno.json` (`browser:live` task)
- `.github/instructions/browser-launch.instructions.md`
- `.github/skills/launch-test-browser/SKILL.md`
- `README.md` (debugging sections)

**Functions/tests to touch**
- Launcher path resolution and build-step command routing.

**Steps**
1. Point launcher build/load logic to WXT-produced unpacked extension output (or add bridge copy step).
2. Preserve practical debugging capabilities:
   - bound popup with correct `debugTabId`
   - `state`, `observe`, `exit-preview` control behavior
   - CDP attach flow to same browser
3. Update instructions/skill docs to match new canonical flow.
4. Keep “managed Chromium only” and “no OS Chrome” guardrails.

**Expected intermediate state**
- Equivalent debug workflow works end-to-end against WXT build outputs.

**Focused validation**
- `deno task browser:live <known-test-url>` manual flow check
- `deno task build:dev` equivalent command for WXT path

**Rollback/fallback rule**
- If direct WXT output loading is unstable, keep `deno task browser:live` command and add deterministic adapter step that materializes expected unpacked path.

---

### Phase 6 — Contract-preserving test/plan finalization for authority model

**Files to edit**
- Remaining domain tests that still assert old ownership/layout
- `.copilot/knowledge.md` (if durable architecture facts changed)
- `.copilot/wxt-port-handoff.md`

**Functions/tests to touch**
- Ownership-contract assertions and docs.

**Steps**
1. Finish migrating source-contract tests to authority-model-aware assertions.
2. Ensure every migrated domain has explicit tests proving Brain ownership and layer thinness.
3. Update durable knowledge/handoff docs to reflect final authority model.

**Expected intermediate state**
- Test suite and docs align with WXT + Brain architecture without ambiguous ownership.

**Focused validation**
- `deno task check && deno task test && pnpm wxt build`

**Rollback/fallback rule**
- If ownership assertion changes are noisy, split into per-domain follow-up commits and keep behavior assertions stronger than structure assertions.

---

### Phase 7 — CI/CD and release migration to WXT

**Files to edit**
- `.github/workflows/build-extension-package.yml`
- release/package scripts (replace or remove):
  - `scripts/package-extension.mjs`
  - any replacement scripts for WXT output zipping/version metadata
- `README.md` packaging section

**Functions/tests to touch**
- Workflow commands and artifact naming rules.

**Steps**
1. Swap CI build/verify steps to pnpm/WXT pipeline.
2. Recreate release artifact and alias semantics (`extension-latest`, stable alias zip naming), unless intentionally changed.
3. Keep deterministic metadata emission if release consumers rely on it.
4. Remove Deno-only packaging path after parity proof.

**Expected intermediate state**
- CI produces valid WXT-built artifacts and release workflow succeeds.

**Focused validation**
- Workflow dry-run equivalent in local commands
- `pnpm wxt build` + packaging script smoke test

**Rollback/fallback rule**
- If release automation breaks, keep old packaging workflow as temporary fallback job until new job produces identical installable artifacts.

---

### Phase 8 — Cutover cleanup and documentation finalization

**Files to edit**
- `deno.json` (remove obsolete tasks)
- Remove obsolete scripts:
  - `scripts/build-extension.ts`
  - legacy packaging helpers no longer used
- `README.md`
- `.copilot/knowledge.md` (if durable workflow changed)

**Functions/tests to touch**
- Final command references and docs.

**Steps**
1. Remove dead build paths.
2. Finalize single canonical developer workflow.
3. Ensure no stale references to removed outputs/commands remain.
4. Confirm no remaining cross-cutting decision logic lives in popup/content except explicitly approved local-only execution logic.

**Expected intermediate state**
- Repo has one clear, documented WXT-first build/release path with equivalent behavior.

**Focused validation**
- `deno task check`
- `deno task test`
- `pnpm wxt build`

**Rollback/fallback rule**
- If final cleanup introduces hidden dependency on removed scripts, temporarily restore wrapper script and schedule targeted removal follow-up.

## 7. Test matrix

### Unit/source-contract
- Keep running current Deno test suite during migration:
  - `deno task test`
- Run focused suites per touched domain:
  - manifest + entrypoint + message-route suites
  - popup/AI/page-save contract suites

### Integration/build
- During transition:
  - `deno task check`
  - `deno task test`
  - `pnpm wxt build`
- Final phase:
  - `deno task check && deno task test && pnpm wxt build`

### Live/manual
- Equivalent live-browser debug flow check on WXT output:
  - launch browser
  - verify popup binding to target page
  - verify `state` / `observe` / `exit-preview` operations
  - verify CDP attach to same browser instance

## 8. Regression risks

- **WAR under-scoping regressions** break runtime `getURL(...)` loads (cursor assets/content modules).
  - Protection: keep explicit WAR checks and generated-manifest assertions.
- **Content-script registration/runtime world mismatch** (`MAIN` vs `ISOLATED`, run-at timing) can silently alter behavior.
  - Protection: adapter-entrypoint tests + manual smoke on representative pages.
- **Authority regression (logic drifts back into popup/content)** during migration.
  - Protection: per-domain tests lock Brain ownership boundaries and thin-layer rule.
- **Background/popup initialization timing drift** from entrypoint wrapper + bus skeleton changes.
  - Protection: preserve source-of-truth modules first; use lazy imports in WXT entrypoint `main()`; migrate ownership one domain at a time.
- **Debug flow breakage** due to output path/layout changes.
  - Protection: dedicated phase for launcher parity, update launcher/docs together.
- **CI artifact/release drift** after packaging migration.
  - Protection: side-by-side artifact comparison until new pipeline is proven.

## 9. Acceptance criteria

- WXT build produces a loadable Chrome MV3 extension that preserves current functionality on recent Chrome.
- Core behavior contracts (marking/highlighting, AI run, page save/reconciliation, property lock, popup flows) remain intact.
- Cross-cutting decision logic is centralized in background Brain deciders; popup/content layers are stateless render/execution units for migrated domains.
- Live browser debug workflow remains functionally equivalent to current capability.
- CI builds and packages extension artifacts through the new WXT path.
- Legacy Deno custom build/packaging scripts are removed or clearly deprecated after parity confirmation.

## 10. Todo chain

SQL todo chain seeded for execution:

1. `wxt-phase0-baseline-inventory`
2. `wxt-phase1-bootstrap-toolchain`
3. `wxt-phase2-entrypoint-adapters`
4. `wxt-phase3-manifest-war-parity`
5. `wxt-phase4-brain-authority-migration`
6. `wxt-phase5-browser-live-debug-flow`
7. `wxt-phase6-tests-authority-parity`
8. `wxt-phase7-ci-release-migration`
9. `wxt-phase8-cutover-cleanup`

Dependency graph is enforced in `todo_deps` and supports phased autonomous execution.
