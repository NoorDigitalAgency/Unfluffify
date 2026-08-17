# Legacy regression net

Baseline: the full legacy-suite audit in `study/patch-3.md`, reconciled against rewrite commits
`8f2e2610` and `a037f80e`. The executable proof is the rewrite suite; this inventory records which
legacy behavior each current test owns.

## Porting rule

The legacy suite contained 203 files and 1,194 test blocks. The audit grouped its useful shapes as
approximately 60 pure-logic/harness files, 55 modules tested through injected dependencies, and 73
source-regex wiring pins. We port behavior, not file bodies:

- Pure logic moves to the rewrite's domain and repository seams.
- Injected-dependency tests move to the equivalent rewrite service, store, engine, or runtime seam.
- Source-regex tests are rewritten as executable ordering or lifecycle tests. Production source text
  is not treated as runtime proof.
- A legacy mechanism retired by D13-D24 is represented by the approved rewrite behavior, not
  recreated solely to make the old test shape fit.

## Cutover-critical legacy subjects

These are the Tier 1 subjects from `study/patch-3.md` that were previously absent, inverted, or only
partly pinned.

| Legacy subject | Rewrite behavioral proof | Disposition |
|---|---|---|
| `legacy:tests/storage-access-boundary.test.ts` | `tests/src/storage/access-boundary.test.ts` | Walks all source modules and rejects raw browser/DOM persistence APIs outside `src/storage/**`. The default IndexedDB-vs-memory choice consequently moved into the storage layer. |
| `legacy:tests/brain-projection-dedup.test.ts` | `tests/src/background/brain.test.ts`, `tests/src/background/startup.test.ts`, `tests/c4-content-entrypoint.test.ts` | The old content directive was retired. Durable facts rehydrate with monotonic per-organ cursors, and a new `content-started` consumer handshake re-establishes current background authority without reviving popup projection. |
| `legacy:tests/config-store-queue.test.ts` | `tests/src/background/property-authority.test.ts` | Holds a local-property write open while a render-mode choice arrives; the choice must wait and survive. Operations serialize per environment/site while independent properties remain parallel. |
| `legacy:tests/core-hover-performance.test.ts` | `tests/src/content/marking/dom-bridge.test.ts` | Repeated pointer coordinates reuse the resolved hit until bridge/render geometry invalidates the cache. |
| `legacy:tests/core-scheduling.test.ts:998` and `legacy:tests/content-activation-order.test.ts:94` | `tests/c4-content-entrypoint.test.ts`, `tests/src/content/consent.test.ts` | A managed non-candidate with no render mode still receives the consent sweep; the installed mutation observer re-sweeps a late insertion. |
| `legacy:tests/consent-selector-precision.test.ts` | `tests/src/content/consent.test.ts` | Pins both halves of the allowlist: required `alertdialog`, `aria-modal`, open-dialog, GDPR, and interstitial selectors are present, while broad content words remain forbidden. |

## Broader behavioral-family mapping

| Legacy family | Rewrite net |
|---|---|
| `core-visibility`, `submission-rules`, `collect-ai-submission-xpaths` | `tests/src/domain/{visibility,evaluate,boundary,widening}.test.ts`, `tests/src/content/marking/{marking,dom-bridge}.test.ts`, `tests/golden/ai-snapshot.test.ts` |
| `explicit-marking-handler`, `dirty-baseline`, marking parts of `core-scheduling` | `tests/src/content/marking/marking.test.ts`, `tests/src/content/marking/dom-bridge.test.ts`, `tests/src/popup/{organ,entrypoint}.test.ts` |
| `shadow-xpath`, `shadow-deep-capture` | `tests/src/domain/xpath.test.ts`, `tests/src/content/marking/dom-bridge.test.ts` |
| `core-motion-pause`, render-mode inspection | `tests/src/content/stabilization/stabilization.test.ts`, `tests/src/page-world/program.test.ts`, `tests/page-motion-freeze-bridge.test.ts` |
| `device-emulation-lifecycle` | `tests/src/background/render-emulation-runtime.test.ts`, `tests/src/content/stabilization/stabilization.test.ts` |
| `content-activation-order`, `content-marking-machine`, `content-overlay-memory` | `tests/c4-content-entrypoint.test.ts`, `tests/src/content/organ.test.ts`, `tests/src/popup/organ.test.ts` |
| `runtime-message-handler` command gating | `tests/c4-content-entrypoint.test.ts`, `tests/src/messaging/{bus,contracts}.test.ts` |
| `background-page-data-lifecycle` | `tests/src/background/{page-context-runtime,lock-browser-lifecycle,property-authority}.test.ts` |
| `brain-projection-dedup`, `background-brain-lifecycle` | `tests/src/background/{brain,startup}.test.ts`, `tests/src/popup/event-log.test.ts` |
| `ai-run-timeout-sync` | `tests/src/lynx/ai-timing-authority.test.ts`, `tests/src/background/startup.test.ts` |

The detailed contract verdicts, including approved redesigns and deliberately recorded PARTIAL
clauses, remain authoritative in `study/contract-parity-matrix.md`. G3 adds the executable regression
ownership that the matrix audit found missing; it does not silently upgrade those verdicts.

## Deliberate non-ports

These tests exercise legacy message branches with no sender and are not part of the regression net:

- `legacy:tests/default-exclusions-handler.test.ts`
- `legacy:tests/describe-xpaths-handler.test.ts`
- `legacy:tests/invisible-xpaths-handler.test.ts`

Their dead handlers are not recreated. The user-facing capability behind human-readable row labels is
tracked separately from the unused `describeXPathsOnPage` message.

## Verification

`pnpm verify` passes after the port: 73 test files, 611 tests, lint, all TypeScript projects, the
production MV3 build, and generated-manifest permission checks.
