# WXT Port Handoff (for low-context implementation agent)

## Read first (mandatory)

1. `.copilot/knowledge.md`
2. `.github/instructions/agent-workflow-guardrails.instructions.md`
3. `.github/instructions/browser-launch.instructions.md`
4. `.github/skills/launch-test-browser/SKILL.md`
5. `.copilot/wxt-port-plan.md`

## Branch and baseline

- Working branch for planning: `feat/wxt-port-plan`
- Migration implementation baseline: **current `main` behavior exactly**
- There is an existing unstaged `deno.lock` modification in this working tree; do not assume it is part of migration scope unless intentionally updated.

## User-approved constraints (authoritative)

- Use **pnpm + WXT** for migration.
- Preserve behavior/contracts; tests can be refactored structurally.
- CI/CD may be redesigned to fit WXT.
- Functional target is recent Chrome; strict old manifest process is not required.
- Live debug workflow must remain functionally equivalent to current capability (command/path exactness not required).
- Use phased migration with runnable checkpoints (not big-bang).
- WXT migration architecture must start from the event-bus authority model shape (single Background Brain authority, stateless popup/content layers, typed request/publish seams).

## Authority model guardrails (mandatory)

- Background Brain owns cross-cutting policy/decisions/state projection for migrated domains.
- Popup/content layers must remain thin: render local state, execute directives, report events.
- Do not introduce new cross-cutting business decisions in popup/content while porting to WXT.
- Use typed bus contracts and transport seams; keep legacy bridge coexistence only as temporary migration scaffolding.
- Migrate domain-by-domain (strangler style), proving behavior parity at each domain move.

## Baseline capability checklist (must stay true after cutover)

### Runtime and UX

- Marking/highlighting locked behavior remains unchanged.
- Property-lock protocol behavior remains unchanged.
- AI-run / preview / save / reconciliation behavior remains unchanged.

### Build/run

- Extension can be built reproducibly and loaded unpacked in Chrome.
- Dev workflow remains documented and executable.

### Debug flow parity

- Can launch live browser against a target URL.
- Popup is bound to the target tab (`debugTabId` equivalent behavior).
- Can inspect button state and transitions (`state`/`observe` equivalent).
- Can trigger Exit Preview from control flow (`exit-preview` equivalent).
- Can attach CDP to same managed browser session for deep inspection.

### Packaging/release

- CI can build and publish installable artifact(s) suitable for existing release usage.

## Execution todos (from SQL)

- `wxt-phase0-baseline-inventory` (done)
- `wxt-phase1-bootstrap-toolchain`
- `wxt-phase2-entrypoint-adapters`
- `wxt-phase3-manifest-war-parity`
- `wxt-phase4-brain-authority-migration`
- `wxt-phase5-browser-live-debug-flow`
- `wxt-phase6-tests-authority-parity`
- `wxt-phase7-ci-release-migration`
- `wxt-phase8-cutover-cleanup`

Follow dependency order from `todo_deps`.

## Immediate next action for implementer

Start `wxt-phase1-bootstrap-toolchain` after marking phase0 done:

1. add `package.json` and pnpm lock with WXT scripts
2. add `wxt.config.ts` (Chrome MV3-focused)
3. keep Deno wrappers temporarily so existing check/test cadence remains available during migration
4. in `wxt-phase2`, scaffold Brain/bus/layer shells early (compile-safe, no behavior move yet) so later domain migrations cannot drift ownership

Then proceed phase-by-phase from `.copilot/wxt-port-plan.md`.
