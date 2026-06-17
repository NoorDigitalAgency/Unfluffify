# TypeScript + Deno Port Progress

Last updated: 2026-06-17
Current phase: Phase 2 (Type foundation)

## Baseline (Phase 0)
- Branch: feat/typescript-deno-port
- Baseline tests: 844
- Baseline pass: 844
- Baseline fail: 0
- Baseline duration_ms: 6010.615023
- Baseline package stage: .tmp/extension-baseline
- Baseline staged file count: 130

## Checkpoints
- [2026-06-17] Phase 0 complete: baseline test and packaging recorded.
- [2026-06-17] Phase 1 complete: added deno.json with task shim alongside npm/node.
- [2026-06-17] Phase 1 validation: deno task test -> 844/844 pass, deno task package succeeded.
- [2026-06-17] Phase 1 spike: deno test -A --no-check passed for tests/tab-operation-runner.test.js and tests/background-render-mode-inspection.test.js.

## Notes
- Interactive shell startup was blocked by stale oh-my-posh init in ~/.bashrc; guarded with command-exists check to restore terminal reliability.
