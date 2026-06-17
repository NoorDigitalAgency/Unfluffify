# Full type-safety progress

- Baseline: 2585 @ts-expect-error / 3115 underlying errors. Non-exempt target: 0 directives; eval-bridge exempt floor stays (bridge 41, control 35).
- Branch: feat/full-typesafety (off feat/ts-expect-error-migration).

## Log
- [2026-06-17] Phase 0: branch created and baseline green (deno task check + 850 tests), suppression total 2585.
- [2026-06-17] Phase 1: added global Window augmentation in `types/globals.d.ts` for `__UNFLUFFIFY_TOGGLE_PERF__`; removed 3 stale directives in `content/core.ts`; gates + full suite + ratchets green; suppression total 2582.
- [2026-06-17] Phase 2.1: fully typed `content/config-updated-handler.ts` (removed final directive, typed `handleAiPreviewUpdate` message param); updated source-contract regex in `tests/preview-tooltip.test.js`; gates + full suite + ratchets green; suppression total 2581.
- [2026-06-17] Phase 2.2: fully typed `background/network-core.ts` (typed both stage-base endpoint builders, removed final 2 directives); gates + full suite + ratchets green; suppression total 2579.
- [2026-06-17] Phase 2.3: fully typed `content/property-lock-state-machine.ts` (typed state-machine/dependency params, normalized numeric guards, removed final 6 directives); gates + full suite + ratchets green; suppression total 2573.
- [2026-06-17] Phase 2.4: fully typed `background/remote-config-sync.ts` (typed core function params, normalized page-url key handling, removed final 6 directives); updated source-contract expectations in `tests/background-remote-config-sync.test.js`, `tests/popup-marking-refresh.test.js`, `tests/property-lock-render-mode.test.js`, `tests/property-lock-state-machine.test.js`, and `tests/property-lock.test.js`; gates + full suite + ratchets green; suppression total 2567.
