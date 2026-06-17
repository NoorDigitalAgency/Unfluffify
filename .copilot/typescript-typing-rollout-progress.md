# TypeScript Strict-Typing Rollout Progress

Last updated: 2026-06-17
Current phase: Phase 1 (leaf modules)

## Baseline
- Branch: feat/typescript-deno-port
- Full tests baseline: 847 pass / 0 fail
- Current runtime @ts-nocheck count: 100
- Ratchet allowlist: tests/fixtures/expected-ts-nocheck.txt

## Checkpoints
- [2026-06-17] Phase 0 completed.
- [2026-06-17] Added `@types/chrome` foundation (`types/globals.d.ts`, `tsconfig.json`, `package.json`, `deno.lock`).
- [2026-06-17] Added `@ts-nocheck` ratchet test and baseline fixture (`tests/typing-ratchet.test.js`, `tests/fixtures/expected-ts-nocheck.txt`).
- [2026-06-17] Phase 1 batch 1 completed: removed `@ts-nocheck` from `common/constants.ts` and `common/selector-set.ts` with strict annotations.

## Notes
- PoC typed module already merged: background/tab-operation-runner.ts and types/operations.ts.
