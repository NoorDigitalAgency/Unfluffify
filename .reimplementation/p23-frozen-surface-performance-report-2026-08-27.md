# P23 frozen-surface presentation performance report — 2026-08-27

## Overall result

The rewrite's marking and silent-highlighting presentation regression is fixed
at its scheduling and maintenance roots. Extension presentation no longer
depends on the page animation clock that reveal/freeze intentionally starves,
and page-motion maintenance no longer turns extension UI mutations into repeated
full-document work.

- Implementation commit: `f71f5dabca97a4435a19343677a36171b66ad09c`.
- `pnpm verify` passed 129 files / 1,177 tests, the production build, and the
  generated-manifest 7/7 gate. `pnpm build:debug` also passed.
- The clean-source P14 legacy/rewrite gate passed all 192 scenarios with zero
  semantic, budget, activation, or mutation-pressure failures.
- P15, P16, P17, P18, and P20 passed 36/36, 13/13, 19/19, 14/14, and 4/4.
- The new P23 headed Chromium gate passed 24/24 while the page's
  `requestAnimationFrame` was permanently starved before the production runtime
  loaded.
- Eight physical hover inputs selected eight exact canonical targets in
  21.0–22.4 ms. Silent geometry followed a physical wheel input in 22.6 ms,
  retained the same keyed overlay node, and left zero pending scheduler work.
- Canonical rows were byte-stable. Page errors and console errors were empty.

## Reproduced failure and root cause

The retained controlled DPJ comparison used copied profiles, the same extension
identity, a 412×960 viewport, legacy commit `28974c2a`, and rewrite baseline
`6711652a`. The page received all inputs and scroll positions, but the rewrite
painted zero hover frames and one static silent-geometry hash while legacy
painted every input and followed every scroll.

Three coupled defects caused that behavior:

1. The content entrypoint and marking engine dynamically read page
   `requestAnimationFrame` after the freeze layer had replaced it. Their armed
   coalescing handles never cleared when that queue was starved.
2. The motion observer collected targeted roots and then accidentally re-added
   `document.documentElement`, repeating `querySelectorAll("*")` and animation
   enumeration for cursor, overlay, and normalization mutations.
3. Plain hover repeatedly scanned every explicit exclusion owner even when the
   pointer event already identified the current extension-owned classification
   rectangle.

## Remediation

### Extension-owned presentation clock

`src/content/presentation-clock.ts` captures and binds scheduling primitives at
content-module evaluation, before page freeze can replace them. Native rAF stays
the primary paint-aligned branch, while a 20 ms captured timer races it. One
logical registry settles exactly once, cancels the losing branch, supports
synchronous realms, and provides deterministic cancellation and teardown.

The content hover queue, marking/silent render queue, geometry stabilizer, P14
runtime, and oversized-branch paint acknowledgement now use that clock. Latest
pointer coalescing remains intact, but no starved native handle can permanently
block trailing work.

### Behavior-preserving legacy hot-path adaptations

The rewrite keeps one canonical evaluator and store. The closest physical
`data-uf-overlay-xpath` is only a hint for an already-current classification
surface. It is accepted only for the current bridge generation and fingerprint,
connected and visibly painted exact owner, canonical explicit-exclusion row,
and pointer rectangle. Missing or stale hints use the existing composed
hit-test resolver.

Repeated movement within the same validated overlay reuses the prior canonical
hover result, and the renderer no-ops when element plus XPath are unchanged.
Shift-only widening, Alt explicit inclusion, exact-owner ordinary unmarking,
row normalization, extraction, and payload semantics are unchanged.

### Silent overlay continuity without invisible paint

Geometry-only scroll/resize updates retain keyed silent nodes when strict paint
reachability is transiently empty. Such nodes are hidden immediately rather
than leaving a stale visible rectangle, then the same node is revealed and
repositioned when measurable geometry returns. Structural and authoritative
silent renders still remove hidden, deleted, or no-longer-canonical nodes.

### Incremental motion maintenance

Freeze performs one explicit full-document discovery at engagement. Later
maintenance collapses genuine page-authored additions and attribute changes to
minimal connected roots, ignores extension subtrees, cursor-only class changes,
and its own style-normalization writes, and enumerates document animations once
per enforcement batch. Repeated pause is idempotent; release resets all caches
and restoration state. The generated `src/page-world/program.js` is in sync with
its TypeScript source.

## Automated evidence

| Gate | Result | Artifact |
| --- | --- | --- |
| `pnpm verify` | PASS — 129 files / 1,177 tests; production build; manifest 7/7 | command output |
| `pnpm build:debug` | PASS | command output |
| P14 | PASS — 192 scenarios; zero semantic/budget/activation/mutation failures | `output/playwright/p14-marking-performance/acceptance-2026-08-27T10-14-05-759Z.json` |
| P15 | PASS — 36/36 | `output/playwright/p15-frozen-shield/acceptance-2026-08-27T10-22-36-878Z.json` |
| P16 | PASS — 13/13 | `output/playwright/p16-render-inspection/acceptance-2026-08-27T10-23-15-103Z.json` |
| P17 | PASS — 19/19 | `output/playwright/p17-preview/acceptance-2026-08-27T10-23-38-671Z.json` |
| P18 | PASS — 14/14 | `output/playwright/p18-transient-toast/acceptance-2026-08-27T10-24-07-388Z.json` |
| P20 | PASS — 4/4 | `output/playwright/p20-integrated/acceptance-2026-08-27T10-25-07-710Z.json` |
| P23 | PASS — 24/24; hover max 22.4 ms; silent 22.6 ms | `output/playwright/p23-frozen-presentation/acceptance-2026-08-27T10-25-58-566Z.json` |

The focused post-review run passed 133/133 tests across presentation clock,
content entrypoint, marking DOM bridge/renderer, page-world freeze, and the P23
gate contract. `pnpm page-world:check` passed after generation.

## Live qualification note

The pre-fix DPJ frame comparison is retained in `.temp/ab-performance/report.md`
and was sufficient to identify the exact frozen-clock failure. This execution
also launched copied-profile legacy and rewrite sessions through the repository
live-browser workflow and proved the legacy overlay posture at 412×960. A clean
post-fix desktop frame sampler could not be retained because the external
computer-use runtime was unavailable on the host, while the repository browser
contract requires external debugger observers to remain detached during
extension-owned emulation.

No post-fix DPJ legacy-relative p95 is invented. The clean P14 pinned
legacy/rewrite browser matrix and the production-shaped P23 headed gate are the
durable performance authorities for this commit. The remaining desktop-sampler
limitation is an environment qualification gap, not a known product failure.

## Contract conclusion

P23 changes presentation scheduling and maintenance cost, not marking truth.
Consent suppression, invisible-exclusion paint suppression, canonical rows,
capture/payload hygiene, reveal/freeze/lazy ownership, render mode, Save, AI,
Content List, property locks, and publication fences remain governed by their
existing contracts and passed the integrated gates.
