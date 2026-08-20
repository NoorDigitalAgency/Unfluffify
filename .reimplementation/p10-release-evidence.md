# P10 Automated Release Evidence

**Extension commit under test:** `56fb4a8f`  
**Production directory:** `.output/chrome-mv3`  
**Deterministic file-tree SHA-256:** `e36805e00eb66af19dd3764bb707295a07c8f9ee2659620a729bc90611405999`

## Required commands

| Command | Result |
|---|---|
| `pnpm lint` | Passed. |
| `pnpm check` | Generated page-world freshness, WXT preparation, and all three TypeScript projects passed. |
| `pnpm test` | 91 files / 684 tests passed. |
| `pnpm build:debug` | Passed; debug Chrome MV3 build produced 3.94 MB. |
| `pnpm verify` | Passed; repeated lint/check/91-file suite, rebuilt the 3.94 MB production Chrome MV3 package, then passed all 7 generated-manifest assertions. |

## Additional gates

- `tests/integration/rewrite-cutover.test.ts` remains enabled and green; no
  reachability allow-list or entrypoint assertion was weakened.
- `tests/page-world-source-parity.test.ts` proves the generated MAIN-world file
  is byte-current with its authored TypeScript source.
- `tests/build-artifact-parity.test.ts` proves the production package contains
  no callable popup debug API, detailed Activity/debug controls, internal
  classifications, trace/direct-mode markers, or silent copy annotations.
- `tests/marking-performance-equivalence.test.ts` uses a 2,000-node standard
  fixture. Branch toggle-to-paint output must exactly equal the retained legacy
  full-tree oracle and its p95 must remain within the 10% budget.
- The performance gate initially exposed a full-row sort on every branch toggle.
  Commit `56fb4a8f` replaces it with ordered contiguous branch splicing; focused
  evaluator/marking/performance evidence passed 3 files / 34 tests before the
  full release gate.
- `tests/golden/ai-snapshot.test.ts` keeps the captured/submitted output corpus
  byte-equivalent and free of extension artifacts.
- Hub stayed clean at `9bdce9f`; its 96-test contract suite passed in P9, so no
  Alpha deployment was required.
