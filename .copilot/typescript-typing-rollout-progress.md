# TypeScript Strict-Typing Rollout Progress

Last updated: 2026-06-17
Current phase: Phase 1 (leaf modules)

## Baseline
- Branch: feat/typescript-deno-port
- Full tests baseline: 847 pass / 0 fail
- Current runtime @ts-nocheck count: 42
- Ratchet allowlist: tests/fixtures/expected-ts-nocheck.txt

## Checkpoints
- [2026-06-17] Phase 0 completed.
- [2026-06-17] Added `@types/chrome` foundation (`types/globals.d.ts`, `tsconfig.json`, `package.json`, `deno.lock`).
- [2026-06-17] Added `@ts-nocheck` ratchet test and baseline fixture (`tests/typing-ratchet.test.js`, `tests/fixtures/expected-ts-nocheck.txt`).
- [2026-06-17] Phase 1 batch 1 completed: removed `@ts-nocheck` from `common/constants.ts` and `common/selector-set.ts` with strict annotations.
- [2026-06-17] Phase 1 batch 2 completed: removed `@ts-nocheck` from `common/page-world-protocol.ts`, `common/feature-flags.ts`, `common/world-messaging-contract.ts`, and `common/render-mode-js-state.ts`.
- [2026-06-17] Updated `tests/lifecycle-broker.test.js` source-contract regexes to accept TypeScript annotations.
- [2026-06-17] Phase 1 batch 3 completed: removed `@ts-nocheck` from `common/page-save-state.ts`, `common/lynx-live-pages.ts`, and `common/message-protocol.ts`.
- [2026-06-17] Phase 1 batch 4 completed: removed `@ts-nocheck` from `common/storage-core.ts` and preserved method-specific runtime validation semantics.
- [2026-06-17] Phase 1 batch 5 completed: removed `@ts-nocheck` from `common/async-messaging.ts` with strict request/reply and error-context typings.
- [2026-06-17] Phase 1 batch 6 completed: removed `@ts-nocheck` from `common/property-lock.ts` with typed lock-state normalization and predicate helpers.
- [2026-06-17] Phase 1 batch 7 completed: removed `@ts-nocheck` from `common/settings-store.ts` and retained default-object sync reads required by settings-store tests.
- [2026-06-17] Phase 1 batch 8 completed: removed `@ts-nocheck` from `common/lynx-checklist.ts` with typed candidate/page-type normalization and checklist view-model outputs.
- [2026-06-17] Phase 1 batch 9 completed: removed `@ts-nocheck` from eleven small content handlers (ai-preview get/show/close/expanded/compute-lock, submission xpaths, default exclusions, force refresh, visible/invisible xpaths, and page-save pending handler).
- [2026-06-17] Phase 1 batch 10 completed: removed `@ts-nocheck` from eleven additional lightweight popup/background/content modules (telemetry, describe xpaths, ai-run record store, popup emulation, collect page data, page-save clear, focus, background tab state, page draft revert, inspection status, and managed timeouts).
- [2026-06-17] Phase 1 batch 11 completed: removed `@ts-nocheck` from eleven additional utility/handler modules (content constants, submission rules, ai-preview state response, page-draft status, capture snapshot, silent-highlight rules, render-mode inspection client, popup render-mode metadata, popup chrome helpers, popup timers, and background async tasks).
- [2026-06-17] Phase 1 batch 12 completed: removed `@ts-nocheck` from nine medium modules (command ledger, shared inclusion, world trace, config-updated handler, property-lock banner mode, page toast, content loader, popup ai-run helpers, and content command router), while preserving source-contract signatures used by tests.
- [2026-06-17] Phase 1 batch 13 completed (micro): removed `@ts-nocheck` from four modules (`background/network-core.ts`, `content/marking-rules.ts`, `content/property-lock-port-client.ts`, `popup/state.ts`) and kept `popup/page-reconciliation.ts` deferred due strict source-contract matching constraints.

## Notes
- PoC typed module already merged: background/tab-operation-runner.ts and types/operations.ts.
