# Handoff - World Decomposition Program

Last updated: 2026-06-10
Branch at document creation: main
Implementation status: IN_PROGRESS (Track A Phase 9 complete)
Document commit scope: plan + handoff authoring only

## Read This First

The active successor architecture plan is:

1. `.copilot/world-decomposition-plan.md`

Follow that file exactly, in order, one phase per commit, one track at a time
(A -> B -> C). This handoff records current status, validation evidence, and the
next exact step. Do not design or re-group; the plan is prescriptive.

## Predecessor Status

1. Storage-access-layer refactor is COMPLETE and merged to `main`
   (`.copilot/storage-access-layer-plan.md`, last commit `2aaa641`).
2. Post-review fixes for that track are merged (config cross-base write race,
   command-router policy completeness, unscoped-command policy).
3. Full suite at handoff authoring: `npm test` = 758 passed, 0 failed.
4. Working tree clean; `main` aligned with `origin/main`.

## Why This Program

Three monoliths remain after the messaging/authority and storage layers were
modularized: `background.js` (~4.8k), `popup.js` (~9.4k), and `content-main.js`
(~9.5k, plus the locked `content/core.js` ~11.5k). The program decomposes them
into single-responsibility modules behavior-preservingly, in three ordered
tracks (Background -> Popup -> Content), with bounded hardening.

Decision inputs (from the planning interview, 2026-06-10):

1. Scope: all three worlds, as ordered tracks A/B/C. Background first.
2. Depth: behavior-preserving extraction PLUS targeted hardening
   (async error reporting, per-tab/popup state + timer consolidation, managed
   timeouts).
3. Validation: `node --test` source-contract + focused + full `npm test`,
4. Guardrail: program-wide hard prohibition on touching locked marking/silent-
   highlight/visibility/reconciliation logic and `content/core.js`. Track C may
   only move explicitly-listed peripheral content domains and MUST keep them in
   `web_accessible_resources`.

## Phase Checklist

Status values: TODO / IN_PROGRESS / DONE / BLOCKED.

### Track A — Background (`background.js` -> `background/*`)

1. Phase 0 - Baseline + boundary guard test: DONE.
2. Phase 1 - command-ledger module: DONE.
3. Phase 2 - live-page-client module: DONE.
4. Phase 3 - network-core module: DONE.
5. Phase 4 - remote-network module: DONE.
6. Phase 5 - remote-config-sync module: DONE.
7. Phase 6 - world-trace module: DONE.
8. Phase 7 - popup-state-broker module (HIGH RISK): DONE.
9. Phase 8 - render-mode-inspector module: DONE.
10. Phase 9 - ai-run-orchestrator module (HIGHEST RISK): DONE.
11. Phase 10 - async error reporting (hardening): TODO.
12. Phase 11 - per-tab state consolidation (hardening): TODO.
13. Phase 12 - managed timeouts (hardening, optional last): TODO.

### Track B — Popup (`popup.js` -> `popup/*`) — starts after Track A is merged

1. Phase B0 - Baseline + popup boundary guard: TODO.
2. Phase B1 - popup/spinner.js: TODO.
3. Phase B2 - popup/site-resolution.js: TODO.
4. Phase B3 - popup/remote-config.js: TODO.
5. Phase B4 - popup/render-mode-inspection.js: TODO.
6. Phase B5 - popup/page-reconciliation.js: TODO.
7. Phase B6 - popup/property-lock-ui.js (HIGH RISK): TODO.
8. Phase B7 - popup/remote-support-ui.js: TODO.
9. Phase B8 - popup/timers.js (hardening): TODO.

### Track C — Content (peripheral only) — starts after Track B is merged

1. Phase C0 - Baseline + content boundary guard + manifest allowlist assert: TODO.
2. Phase C1 - content/page-telemetry-bridge.js: TODO.
3. Phase C2 - content/remote-support-client.js: TODO.
4. Phase C3 - content/property-lock-banner.js: TODO.

Track C live scenarios (remote-support / property-lock sessions) depend on the
paused/flaky orchestration harness; Track C slices may legitimately BLOCK. Never
skip the live gate or the `web_accessible_resources` update for content slices.

## First Commands For The Implementer

```bash
git status --short
git fetch origin
git pull --ff-only
npm ci
npm test
rg -n '^(async function|function) [A-Za-z0-9_]+|^registerBackgroundCommand\(' background.js
rg -n 'readFileSync\(new URL\("\.\./background\.js"' tests
```

If baseline `npm test` fails before any edit, STOP and record it here. Do not
begin implementation on top of unexplained failures.

## Hard Guardrails (repeat from plan)

1. Behavior-preserving moves only; no contract/timeout/retry/key changes.
2. Never edit `content/core.js` or any marking/silent-highlight/visibility/
   reconciliation logic, in ANY track (program-wide invariant).
3. Per-track file scope only: Track A = `background.js` + `background/` + tests;
   Track B = `popup.js` + `popup/` + tests; Track C = `content-main.js` + the
   allowed new `content/*` modules + `manifest.json` + tests.
4. New modules must not access `chrome.storage` directly; route through the
   approved stores (`tab-session-store`, `transfer-payload-store`,
   `ai-run-record-store`, `storage-core`, `settings-store`).
5. Every new `content/*` module MUST be added to `web_accessible_resources` in
   the same slice (runtime footgun), with `tests/manifest-permissions.test.js`
   updated.
6. Update source-contract tests in lockstep with every move (tests that read
   `background.js`/`popup.js`/`content-main.js` source will break otherwise).
7. No circular imports. Background uses injected-state factories; popup uses the
   shared `popup/state.js` singleton; content uses function injection for state.
8. One phase per commit; focused + full + live validation before every push.

## Validation Baseline

Authoring baseline (no code changes yet):

```bash
npm test
```

Result: 758 passed, 0 failed (carried from the storage track's final state).

Current run baseline (2026-06-10, start of Track A):

```bash
npm test
```

Result: 758 passed, 0 failed (pre-edit baseline confirmed).

Record per-slice results here as the track progresses, using this template:

```
Phase N - <module>:
  Focused: node --test <files> -> <pass>/<fail>
  Full:    npm test -> <pass>/<fail>
  Live:    <fixture flow exercised> -> <pass|blocked + reason>
  Commit:  <hash> <message>
```

Progress log:

```
Phase 0 - Baseline + boundary guard:
   Files:   tests/background-decomposition-boundary.test.js
   Focused: node --test tests/background-decomposition-boundary.test.js -> 1 pass / 0 fail
   Full:    npm test -> 759 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  49b3de6 test(background): add decomposition boundary guard

Phase 1 - command-ledger module:
   Files:   background/command-ledger.js; background.js; tests/command-ledger.test.js; tests/background-command-hardening.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/command-ledger.test.js tests/background-command-hardening.test.js tests/background-decomposition-boundary.test.js -> 7 pass / 0 fail
   Full:    npm test -> 762 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  84adabe refactor(background): extract command ledger redaction

Phase 2 - live-page-client module:
   Files:   background/live-page-client.js; background.js; tests/live-page-client.test.js; tests/selector-suppression.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/live-page-client.test.js tests/selector-suppression.test.js tests/background-decomposition-boundary.test.js -> 24 pass / 0 fail
   Full:    npm test -> 767 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  81715d1 refactor(background): extract live-page client

Phase 3 - network-core module:
   Files:   background/network-core.js; background.js; tests/background-network-core.test.js; tests/ai-run.test.js; tests/popup-marking-refresh.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/background-network-core.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/background-decomposition-boundary.test.js -> 69 pass / 0 fail
   Full:    npm test -> 773 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  30ede30 refactor(background): extract network core and auth

Phase 4 - remote-network module:
   Files:   background/remote-network.js; background.js; tests/background-remote-network.test.js; tests/ai-run.test.js; tests/popup-marking-refresh.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/background-remote-network.test.js tests/popup-marking-refresh.test.js tests/ai-run.test.js tests/property-lock.test.js tests/background-decomposition-boundary.test.js -> 96 pass / 0 fail
   Full:    npm test -> 777 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  544c39d refactor(background): extract remote network client

Phase 5 - remote-config-sync module:
   Files:   background/remote-config-sync.js; background.js; tests/background-remote-config-sync.test.js; tests/ai-run.test.js; tests/popup-marking-refresh.test.js; tests/property-lock.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/background-remote-config-sync.test.js tests/background-decomposition-boundary.test.js tests/popup-marking-refresh.test.js tests/property-lock.test.js tests/ai-run.test.js -> 95 pass / 0 fail
   Full:    npm test -> 780 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  206d349 refactor(background): extract remote config sync

Phase 6 - world-trace module:
   Files:   background/world-trace.js; background.js; tests/world-trace.test.js; tests/world-trace-contract.test.js; tests/background-decomposition-boundary.test.js; tests/feature-flags.test.js
   Focused: node --test tests/feature-flags.test.js tests/world-trace.test.js tests/world-trace-contract.test.js tests/background-decomposition-boundary.test.js -> 23 pass / 0 fail
   Full:    npm test -> 783 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  5529707 refactor(background): extract world trace store

Phase 7 - popup-state-broker module:
   Files:   background/popup-state-broker.js; background.js; tests/popup-state-broker.test.js; tests/lifecycle-broker.test.js; tests/world-trace-contract.test.js; tests/device-emulation-lifecycle.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/device-emulation-lifecycle.test.js tests/world-trace-contract.test.js tests/lifecycle-broker.test.js tests/popup-state-broker.test.js tests/background-decomposition-boundary.test.js -> 41 pass / 0 fail
   Full:    npm test -> 786 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  87b5479 refactor(background): extract popup state broker

Phase 8 - render-mode-inspector module:
   Files:   background/render-mode-inspector.js; background.js; tests/render-mode-inspector.test.js; tests/background-render-mode-inspection.test.js; tests/render-mode-inspection-order.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/render-mode-inspector.test.js tests/background-render-mode-inspection.test.js tests/render-mode-inspection-order.test.js tests/background-decomposition-boundary.test.js -> 13 pass / 0 fail
   Full:    npm test -> 789 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  0f03890 refactor(background): extract render-mode inspector

Phase 9 - ai-run-orchestrator module:
   Files:   background/ai-run-orchestrator.js; background.js; tests/ai-run-orchestrator.test.js; tests/ai-run.test.js; tests/background-decomposition-boundary.test.js
   Focused: node --test tests/ai-run-orchestrator.test.js tests/ai-run.test.js tests/popup-ai-run-gating.test.js tests/background-decomposition-boundary.test.js -> 35 pass / 0 fail
   Full:    npm test -> 791 pass / 0 fail
   Live:    skipped by current requirement scope (not required for non-marking slices)
   Commit:  pending
```

## Next Action

Commit and push Track A Phase 9 with:
`refactor(background): extract ai run orchestrator`, then proceed to Track A
Phase 10 (async error reporting hardening). Do not start Track B until Track A is
complete and merged; do not start Track C until Track B is complete and merged.
