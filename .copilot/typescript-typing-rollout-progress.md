# TypeScript Strict-Typing Rollout Progress

Last updated: 2026-06-17
Current phase: Phase 1 (leaf modules)

## Baseline
- Branch: feat/typescript-deno-port
- Full tests baseline: 847 pass / 0 fail
- Current runtime @ts-nocheck count: 13
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
- [2026-06-17] Phase 1 batch 14 completed (micro): removed `@ts-nocheck` from four modules (`popup/helpers.ts`, `content/page-draft-save-handler.ts`, `content/render-mode-inspection-handlers.ts`, `background/tab-runtime.ts`) with source-contract-compatible handler signatures preserved where required.
- [2026-06-17] Phase 1 batch 15 completed (micro): removed `@ts-nocheck` from four modules (`background/popup-state-broker.ts`, `background/tab-inactivity-observer.ts`, `content/shared-selector-cache.ts`, `background/transfer-payload-store.ts`) while preserving source-contract regex compatibility in lifecycle and transfer-payload tests.
- [2026-06-17] Phase 1 batch 16 completed (micro): removed `@ts-nocheck` from `content/content-main-service-registry.ts` and `background/tab-session-store.ts` with explicit factory/session-store typings and no behavioral regressions.
- [2026-06-17] Phase 1 batch 17 completed (micro): removed `@ts-nocheck` from `background/spinner-operations.ts` with typed spinner queue operations and tab-isolation/full-suite coverage passing.
- [2026-06-17] Phase 1 batch 18 completed (micro): removed `@ts-nocheck` from `background/live-page-client.ts` with typed live-page transport helpers and source-contract-compatible signature comments retained for regex tests.
- [2026-06-17] Phase 1 batch 19 completed (micro): removed `@ts-nocheck` from `content/explicit-marking-handler.ts` with typed explicit-marking dependencies/options and source-contract-compatible signature anchors preserved for selector-suppression tests.
- [2026-06-17] Phase 1 batch 20 completed (micro): removed `@ts-nocheck` from `content/property-lock-banner.ts` with explicit parameter typing and full property-lock/render-mode regression coverage passing.
- [2026-06-17] Phase 1 batch 21 completed (micro): removed `@ts-nocheck` from `background/render-mode-inspector.ts` with typed orchestration helpers and source-contract-compatible signature anchors for render-mode tests.
- [2026-06-17] Phase 1 batch 22 completed (micro): removed `@ts-nocheck` from `content/page-world-relay.ts` with typed relay session/pending-request handling and relay/bridge/full-suite coverage passing.
- [2026-06-17] Phase 1 batch 23 completed (micro): removed `@ts-nocheck` from `popup/spinner.ts` with typed spinner helpers and source-contract-compatible signature anchors for popup render-mode/marking tests.
- [2026-06-17] Phase 1 batch 24 completed (micro): removed `@ts-nocheck` from `popup/render-mode-inspection.ts` with typed popup inspection helpers and render-mode/popup/full-suite coverage passing.
- [2026-06-17] Phase 1 batch 25 completed (micro): removed `@ts-nocheck` from `background/command-router.ts` with typed command registration/dispatch helpers and command-router/tab-isolation/full-suite coverage passing.
- [2026-06-17] Phase 1 batch 26 completed (micro): removed `@ts-nocheck` from `common/xpath-utilities.ts` with typed DOM/XPath refinement helpers and full-suite coverage passing.
- [2026-06-17] Phase 1 batch 27 completed (micro): removed `@ts-nocheck` from `common/emulation.ts` with typed device-emulation helpers while preserving source-contract signatures for lifecycle tests.
- [2026-06-17] Phase 1 batch 28 completed (micro): removed `@ts-nocheck` from `content/property-lock-state-machine.ts` by preserving contract-sensitive signatures with targeted TS suppressions and passing property-lock/full-suite coverage.
- [2026-06-17] Phase 1 batch 29 completed (micro): removed `@ts-nocheck` from `popup/remote-config.ts` using internal narrowing plus source-contract signature suppressions, and adjusted popup source-shape regex to tolerate the optional TS suppression line between exports.
- [2026-06-17] Phase 1 batch 30 completed (micro): removed `@ts-nocheck` from `popup/site-resolution.ts` using internal state/options casts with contract-sensitive signatures preserved and popup-site-resolution/selector-suppression/full-suite coverage passing.
- [2026-06-17] Phase 1 batch 31 completed (micro): removed `@ts-nocheck` from `popup/messages.ts` using internal narrowing and targeted line-level suppressions to preserve regex-sensitive source contracts (`requestTabRunRenderModeInspection` and `loadActiveTab` literals), with strict check, popup authority/render-mode/device-lifecycle suites, and full-suite coverage passing.
- [2026-06-17] Phase 1 batch 32 completed (micro): removed `@ts-nocheck` from `popup/page-reconciliation.ts` with typed pending-change inputs and targeted signature suppressions for `handlePageSave`/`handlePageRevert`, and updated popup source-contract extraction regexes to tolerate the optional TS suppression separator between exports; strict check, popup reconciliation/marking-refresh/AI-run-gating suites, and full-suite coverage passing.
- [2026-06-17] Phase 1 batch 33 completed (micro): removed `@ts-nocheck` from `content/runtime-message-handler.ts` with minimal handler/callback `any` typing while preserving all `if (message.type === "...")` branch literals used by source-contract tests; strict check, runtime-router/content-activation/high-risk/selector-suppression/AI/preview/popup suites, and full-suite coverage passing.
- [2026-06-17] Phase 1 batch 34 completed (micro): removed `@ts-nocheck` from `common/text.ts` by typing formatting helpers and preserving regex-sensitive `propertyLockText` lambda signatures with targeted line-level suppressions; strict check, core-scheduling/property-lock/render-mode/popup-marking-refresh/world-trace suites, and full-suite coverage passing.
- [2026-06-17] Phase 1 batch 35 completed (micro): removed `@ts-nocheck` from `background/remote-network.ts` by preserving regex-locked function signatures (`options = {}` and `fetchStaticPageHtmlForBackground(url)`), adding local options casts, and restoring contract-sensitive `requestPayloadKey` source text with targeted suppression; strict check, background-remote-network/popup-marking-refresh/ai-run suites, and full-suite coverage passing.

## Notes
- PoC typed module already merged: background/tab-operation-runner.ts and types/operations.ts.
