# Unfluffify Backlog

Last updated: 2026-06-09

This file holds work that used to be active in `.copilot/plan.md` and
`.copilot/plan-core-hotfix-4h.md`. Do not treat any item here as active until
the user explicitly asks to resume it. The active plan is now the feature-flag
stabilization plan in `.copilot/plan.md`.

## Backlog Rules

1. Do not implement backlog items while working the active stabilization plan.
2. Before resuming a backlog item, re-read the current source and re-verify the
   item still reproduces. Some historical hotfix notes are stale or conflict
   with later live verification.
3. Do not weaken the locked marking contract described in `.copilot/knowledge.md`.
4. Runtime or visual bugs must be verified with the live debugging harness before
   being marked fixed. Source reasoning alone is not enough.
5. Never commit local orchestration secrets, profiles, or run artifacts.

## From Main Plan

### Test Orchestration Follow-Up

Status: paused.

Backlogged items:

- Install Playwright or set `UNFLUFFIFY_PLAYWRIGHT_PATH` / `playwrightModulePath`,
  then rerun the Phase 4 property-lock one-machine scenario.
- Create local gitignored `orchestration/config.jsonc` and
  `orchestration/.secrets.jsonc`, then seed director/follower profiles with
  `orchestration/setup-auth.mjs`.
- Rerun the Phase 4 off-candidate countdown sub-check with a staging property
  that has both a known current Live Page candidate and a known same-base
  non-candidate URL.
- Rerun Phase 5 remote-support request/join validation after secrets/profile
  seeding and host-specific desktop-capture source token verification.
- Run Phase 6 on two real hosts with a LAN-reachable bus host and remote
  follower host to validate permission prompts, viewer transport, telemetry
  mirrors, and teardown behavior.

Reference documents:

- `.copilot/test-orchestration-plan.md`
- `.copilot/handoff-test-orchestration.md`

## From Core Hotfix Plan

Status: paused and superseded by feature-flag stabilization.

The old hotfix sprint contained a large runtime-debug queue for spinner,
silent-highlight, preview, property-lock, render-mode, trace, and debugger
issues. It is no longer the active plan. Resume only after the feature-flag
stabilization work is complete or if the user explicitly prioritizes one issue.

Backlogged open or uncertain items from the old priority queue:

- `#15` saved data used on enable, causing wrong dirty/discard button state.
- `#19` desktop preview shown after silent landing.
- `#14` desktop-preview visibility, enablement, and note rules.
- `#10`, `#11`, `#12` property-lock countdown and lock-loss loops.
- `#4` spinner text sync.
- `#20` trace toggle mismatch.
- `#13` non-candidate render-mode/reveal behavior.
- `#9` fast repeated debugger disable detection.
- `#18` only if a fresh repro appears; old notes say it may have been resolved
  by the `#17` follow-up.
- `#R1` has conflicting historical notes in the old sprint text. Re-triage from
  source and live behavior before taking action.

Historical detail remains in `.copilot/handoff-core-hotfix.md`. Use it only as
background; re-check the current code before acting.
