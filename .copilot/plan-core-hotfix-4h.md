# Core Hotfix Sprint Plan (4h)

Date: 2026-06-07
Branch: main
Owner: active engineer in current environment

## Objective

Stabilize core user-facing workflows before returning to two-machine orchestration.
Priority order after core stabilization:
1. Property lock validation and hardening.
2. Remote support validation and hardening.

This plan is execution-focused for a 4-hour emergency window.

## Rules For This Sprint

1. No net-new feature work.
2. Fix P0/P1 regressions only.
3. Keep changes minimal and isolated.
4. Update this plan and the handoff document after every phase.
5. Commit and push after every completed fix phase.
6. Every fix phase must include:
   - Repro note
   - Root cause note
   - Files touched
   - Validation commands and results

## Issue Clusters

Cluster 1 (highest): operation lifecycle and spinner consistency
- Related issues: #2, #3, #4, #5, #20
- Goal: one authoritative per-tab lifecycle state and spinner ownership across popup/background/content.

Cluster 2 (highest): silent highlight and preview consistency
- Related issues: #1, #6, #16
- Goal: remove visible blinking, reduce delayed state application confusion, and align list item visibility/highlight targeting.

Cluster 3: mode transitions and temporary state reset
- Related issues: #17, #18, #19, #15

Cluster 4: property-lock countdown and lock-loss loop handling
- Related issues: #10, #11, #12

Cluster 5: confirmations and debugger edge behavior
- Related issues: #7, #8, #9

Cluster 6 (lower): render mode and conditional UI visibility
- Related issues: #13, #14

## 4-Hour Timeline

Phase A (00:00-00:25)
- Repro matrix and instrumentation pass for Cluster 1 and Cluster 2.
- Identify message/event paths and stale state sources.

Phase B (00:25-01:45) - Cluster 1
- Implement lifecycle/spinner source-of-truth and timeout cleanup.
- Ensure popup restore behavior uses authoritative state and does not lose future events.
- Fix spinner text mapping synchronization while preserving queue semantics.
- Update docs, commit, push.

Phase C (01:45-03:05) - Cluster 2
- Remove/limit highlight repaint loop causing blink.
- Align preview list eligibility with actual visible/highlightable targets.
- Improve immediate feedback path when state application is deferred.
- Update docs, commit, push.

Phase D (03:05-03:35) - verification and triage delta
- Re-run focused tests and manual flow checks for Cluster 1/2.
- Capture open deltas and severity.

Phase E (03:35-04:00) - handoff hardening
- Prepare environment-switch handoff with exact next commands and checkpoints.
- Commit and push final sprint checkpoint.

## Acceptance Criteria For Cluster 1

1. Spinner starts for reveal/freeze and ends reliably on complete/fail/cancel.
2. Spinner can recover after popup close/reopen and after page refresh.
3. Spinner text matches active operation stage.
4. No stuck "Applying device emulation..." spinner after operation settle.
5. Trace cross-world messaging setting is reflected in UI and behavior.

## Acceptance Criteria For Cluster 2

1. Silent-mode highlight no longer blinks at periodic interval.
2. User feedback appears immediately on marking interactions.
3. Preview list items always map to visible targets and can scroll/highlight.
4. Delayed state updates do not appear as ignored user clicks.

## Required Validation Commands

Use these during each phase and record pass/fail in handoff.

- npm test -- tests/popup-marking-refresh.test.js tests/device-emulation-lifecycle.test.js tests/content-activation-order.test.js
- npm test -- tests/content-main*.test.js tests/popup*.test.js
- npm test

If command patterns are not supported by the local test runner, run equivalent explicit files.

## Documentation Update Checklist (Mandatory Per Phase)

After each completed phase:
1. Update .copilot/plan-core-hotfix-4h.md (phase status + deltas).
2. Update .copilot/handoff-core-hotfix.md (exact current state and next steps).
3. Commit with phase-specific message.
4. Push branch.

## Commit Convention

- hotfix(core): phase B cluster 1 lifecycle and spinner stabilization
- hotfix(core): phase C cluster 2 silent highlight and preview consistency
- hotfix(core): phase E handoff checkpoint for environment switch

## Resume Procedure After Environment Change

1. git fetch --all --prune
2. git checkout main
3. git pull --ff-only
4. Open .copilot/handoff-core-hotfix.md
5. Execute Next Actions in order.
6. Keep plan and handoff updated before writing code and before stopping.
