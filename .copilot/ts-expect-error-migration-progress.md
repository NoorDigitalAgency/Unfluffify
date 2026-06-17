# @ts-ignore to @ts-expect-error migration - progress

- Baseline: 2619 @ts-ignore across 13 files; 37 stale; target end 2582 @ts-expect-error and 0 @ts-ignore.
- Branch: feat/ts-expect-error-migration (off feat/ts-typesafety-hardening).

## Log
- [2026-06-17] Phase 0: branch created, baseline green (check + 849 tests), total 2619.
- [2026-06-17] Phase 1: suppression tooling renamed to generic suppression budget/counter and now counts both @ts-ignore and @ts-expect-error; source-contract tolerance regexes updated to accept either directive token; all gates green (targeted + full + ratchets). Reseeded suppression total is 2622 because 3 runtime @ts-expect-error lines were already present before conversion work.
- [2026-06-17] Phase 2 batch 1: converted content/property-lock-state-machine.ts to @ts-expect-error, removed 2 stale directives, and validated strict + targeted property-lock suites + full suite + ratchets. File count is now 6 and global suppression total is 2620.
- [2026-06-17] Phase 2 batch 2: converted background/remote-config-sync.ts to @ts-expect-error, removed 3 stale directives, and validated strict + targeted remote-config-sync suites + full suite + ratchets. File count is now 6 and global suppression total is 2617.
- [2026-06-17] Phase 2 batch 3: converted common/text.ts to @ts-expect-error with no stale directives found; validated strict + targeted feature-flags/marking-refresh suites + full suite + ratchets. File count remains 14 and global suppression total remains 2617.
