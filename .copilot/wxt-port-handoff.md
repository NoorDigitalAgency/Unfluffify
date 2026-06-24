# WXT Port + Brain Program Handoff (for low-context implementation agent)

## Read first (mandatory, in order)

1. `.copilot/knowledge.md`
2. `.github/instructions/agent-workflow-guardrails.instructions.md`
3. `.github/instructions/browser-launch.instructions.md`
4. `.github/skills/launch-test-browser/SKILL.md`
5. `.copilot/wxt-port-plan.md` (program INDEX: Part A phases + Part B pointer)
6. `.copilot/event-bus-architecture-plan.md` (Part B master spec, WXT-adapted)
7. `.copilot/event-bus/track-00-foundation.md` (Part B Track 0, full detail)
8. `.copilot/event-bus/track-template.md` (Part B per-domain executor-doc template)

## Program shape (two parts, sequenced)

- **Part A — WXT toolchain cutover** (`wxt-port-plan.md` §6): pnpm + WXT + Vitest,
  behavior-preserving. The current runtime modules are wrapped by `entrypoints/*`;
  their internals are not touched. The Brain is NOT introduced in Part A.
- **Part B — Brain (event-bus) rearchitecture** (the event-bus doc set): runs on
  the stable WXT baseline AFTER Part A is complete and green.

**Sequencing (locked):** Part A fully cuts over first; then Part B. Do not build
the Brain on a half-migrated dual Deno+WXT build.

## Branch and baseline

- Working branch: `feat/wxt-port-plan`.
- Migration baseline: **current `main` behavior exactly**.
- The full Brain spec was originally authored against the legacy Deno build on
  `feat/event-bus-architecture` (commit `31ab189`). It has been **brought onto this
  branch and rewritten for the WXT baseline**; use the copies in `.copilot/` (do
  not chase the other branch). The Deno→WXT reconciliation is in
  `.copilot/event-bus-architecture-plan.md` §11.

## User-approved constraints (authoritative)

- Use **pnpm + WXT**; test runner is **Vitest**; lint is **ESLint** (all migrated
  in Part A). After the Part A cutover, no `deno task` command remains.
- Preserve behavior/contracts; tests can be refactored structurally.
- CI/CD may be redesigned to fit WXT.
- Functional target is recent Chrome; strict old manifest process is not required.
- Live debug workflow must remain functionally equivalent (command/path exactness
  not required): `pnpm browser:live <url>`.
- Phased migration with runnable checkpoints (not big-bang).
- The Brain architecture (single background Brain, stateless popup/content layers,
  typed request/publish seams) is the Part B target; it starts only after Part A.
- **WXT bundles the content entry**, so new bus/brain/layer modules are bundled and
  do NOT need individual `web_accessible_resources` entries; only
  `chrome.runtime.getURL(...)` page-world assets (cursors, injected HTML) stay
  web-accessible. This resolves the legacy "bundled content entry" gate (no GATE B).

## WXT command surface

| Purpose | Command |
|---|---|
| dev/watch | `pnpm dev` |
| type-check | `pnpm check` (`wxt prepare && tsc --noEmit`) |
| lint | `pnpm lint` (`eslint .`) |
| test | `pnpm test` (`vitest run`) |
| release build | `pnpm build` (`wxt build` → `.output/chrome-mv3/`) |
| zip | `pnpm zip` (`wxt zip`) |
| verify | `pnpm verify` |
| live browser | `pnpm browser:live <url>` |

## Authority model guardrails (Part B, mandatory)

- Background Brain owns cross-cutting policy/decisions/state projection for migrated
  domains.
- Popup/content layers stay thin: render local state, execute directives, report
  events.
- Exactly one authoritative `request` handler per type per realm.
- Use typed bus contracts and transport seams; keep the legacy bridge only as
  temporary migration scaffolding.
- Migrate domain-by-domain (strangler style), proving behavior parity at each move.
- Locked behavior (marking/silent/visibility/reconciliation/XPath/AI-submission/
  property-lock and `content/core.ts`) is wrap-only unless its approval gate
  (M/S/X/R/P, master spec §4) is granted.

## Baseline capability checklist (must stay true after each cutover)

### Runtime and UX
- Marking/highlighting locked behavior unchanged.
- Property-lock protocol behavior unchanged.
- AI-run / preview / save / reconciliation behavior unchanged.

### Build/run
- Extension builds reproducibly (`pnpm build`) and loads unpacked
  (`.output/chrome-mv3`).
- Dev workflow documented and executable (`pnpm dev`).

### Debug flow parity
- `pnpm browser:live <url>` launches the live browser against a target URL.
- Popup bound to the target tab (`debugTabId` equivalent).
- Button state + transitions inspectable (`state`/`observe`).
- Exit Preview triggerable from control flow (`exit-preview`).
- CDP attach to the same managed browser session.

### Packaging/release
- CI builds and publishes installable artifact(s) via WXT (`pnpm zip`).

## Execution todos (from SQL `todos`/`todo_deps`)

Part A (sequential):
- `wxt-a0-baseline-inventory`
- `wxt-a1-bootstrap-toolchain`
- `wxt-a2-entrypoint-adapters`
- `wxt-a3-manifest-war-parity`
- `wxt-a4-vitest-eslint-migration`
- `wxt-a5-browser-live-debug-flow`
- `wxt-a6-ci-release-migration`
- `wxt-a7-cutover-cleanup`

Part B (depends on `wxt-a7-cutover-cleanup`, then predecessors per master spec §7):
- `bus-track0-foundation` … `bus-track13-legacy-teardown`

Follow the dependency order in `todo_deps`.

## Immediate next action for implementer

Part A is not yet started. Begin `wxt-a0-baseline-inventory`:

1. Record the baseline behavior + live-debug capability checklist.
2. Catalogue the Deno test suite for the Vitest migration (count; which use
   `readFileSync`/source-regex; which use `Deno.*` APIs needing a Node/Vitest
   equivalent).
3. Freeze the parity + test-migration checklist here, then proceed to
   `wxt-a1-bootstrap-toolchain`.

Do NOT start Part B (Brain) until `wxt-a7-cutover-cleanup` is done and
`.copilot/event-bus-architecture-plan.md` §0 preconditions all hold. Then proceed
phase-by-phase from `.copilot/wxt-port-plan.md` and track-by-track from the
event-bus doc set.
