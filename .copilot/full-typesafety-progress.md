# Full type-safety progress

- Baseline: 2585 @ts-expect-error / 3115 underlying errors. Non-exempt target: 0 directives; eval-bridge exempt floor stays (bridge 41, control 35).
- Branch: feat/full-typesafety (off feat/ts-expect-error-migration).

## Log
- [2026-06-17] Phase 0: branch created and baseline green (deno task check + 850 tests), suppression total 2585.
- [2026-06-17] Phase 1: added global Window augmentation in `types/globals.d.ts` for `__UNFLUFFIFY_TOGGLE_PERF__`; removed 3 stale directives in `content/core.ts`; gates + full suite + ratchets green; suppression total 2582.
