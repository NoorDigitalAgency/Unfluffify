# Handoff - Core Hotfix Sprint (Environment Switch Ready)

Date started: 2026-06-07
Current branch: main
Scope: core stability first, then return to two-machine orchestration.

## Sprint Guardrails

1. Keep .copilot/plan-core-hotfix-4h.md and this handoff file updated continuously.
2. Commit and push after every completed fix phase.
3. Do not start new feature work until listed P0/P1 items are stabilized.

## Priority Map

Now:
1. Cluster 1 - lifecycle/spinner consistency
2. Cluster 2 - silent highlight and preview consistency

Next after core stabilization:
3. Property lock completion/hardening
4. Remote support (last priority)

## Work Log

### Phase A - Repro and instrumentation
Status: NOT STARTED
Owner: TBD
Started at: -
Completed at: -

Repro coverage:
- #1 silent highlight blinking
- #2/#3/#5 spinner stuck/missing
- #4 spinner text sync (low)
- #6 delayed apply feedback
- #16 preview item visibility mismatch
- #20 trace cross-world mismatch

Findings:
- Pending

### Phase B - Cluster 1 lifecycle/spinner
Status: NOT STARTED
Owner: TBD
Started at: -
Completed at: -

Files touched:
- Pending

Validation:
- Pending

Commit:
- Pending

Push:
- Pending

### Phase C - Cluster 2 highlight/preview
Status: NOT STARTED
Owner: TBD
Started at: -
Completed at: -

Files touched:
- Pending

Validation:
- Pending

Commit:
- Pending

Push:
- Pending

## Environment Switch Checklist

Before stopping work:
1. Update this handoff with exact status and next command.
2. Update .copilot/plan-core-hotfix-4h.md with completed phase details.
3. Commit and push current phase.
4. Ensure git status is clean or intentionally includes only active-phase changes.

When resuming in a new environment:
1. git fetch --all --prune
2. git checkout main
3. git pull --ff-only
4. Read this file from top to bottom.
5. Run first command in Next Actions.

## Next Actions (Always Keep Current)

1. Start Phase A:
   - Map current event flow for spinner and lifecycle across popup/background/content.
   - Locate periodic highlight refresh path causing blink.
2. Implement Phase B Cluster 1 fixes.
3. Validate and commit/push Phase B.
4. Implement Phase C Cluster 2 fixes.
5. Validate and commit/push Phase C.

## Immediate Commands

- git status --short
- rg -n "spinner|runWithSpinner|ufLifecycleEvent|ufSpinner|navInspect|getInspectionStatus" popup.js background.js content-main.js common
- rg -n "highlight|silent|refreshSilent|preview|visibility|xpath|scroll" content-main.js content popup.js common
- npm test -- tests/popup-marking-refresh.test.js tests/device-emulation-lifecycle.test.js tests/content-activation-order.test.js

## Known Constraints

- Do not weaken the locked marking contract.
- Keep fix scope minimal and deterministic.
- Prefer robust state reconciliation over timing-based hacks.
