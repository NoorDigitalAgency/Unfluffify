# P23 frozen-surface presentation performance remediation

**Status:** Complete. Implementation `f71f5dab` and all clean-source automated
acceptance gates passed. P22's remaining Hub/candidate acceptance blockers are
external and do not block this independent code repair.

## Goal

Make interactive marking and silent highlighting at least as responsive and
smooth as the pinned legacy release while preserving the rewrite's canonical
evaluator, branch-scoped mutation model, generation/fingerprint fences,
reveal/freeze ownership, and extraction semantics. Extension presentation work
must remain live while the page's own timers and animation clock are frozen,
and page-motion maintenance must be incremental instead of feeding extension UI
mutations into repeated full-document scans.

## Current facts

- The synchronized baseline is `6711652a5aacdb50ba529e3ff301f983a8e252ee`
  on `re-write`, 0 ahead / 0 behind `origin/re-write`, with a clean worktree.
- The retained same-profile DPJ A/B evidence in
  `.temp/ab-performance/report.md` shows legacy produced 159 hover frames for
  82 inputs with 100% next-frame coverage, while the rewrite produced zero
  hover frames for 81 inputs. Eight pointer positions produced eight legacy
  visual frames but one static rewrite frame. Silent scrolling changed five
  legacy geometry hashes and zero rewrite geometry hashes.
- `src/entrypoints/content-loader.content.ts:scheduleHover()` and
  `src/content/marking/engine.ts:scheduleRender()` dynamically use the current
  document `requestAnimationFrame`. When reveal/freeze starves that clock, their
  coalescing handles never clear and all trailing pointer/geometry work remains
  permanently blocked.
- `src/content/marking/engine.ts:installObservers()` supplies the same starvable
  clock to `createGeometryStabilizer()`, so resize and mutation stabilization can
  stall for the same reason.
- The legacy `src/content/core.ts` captured extension scheduling primitives
  before freeze, coalesced hover to one trailing frame, and reused the previous
  canonical hover result while the physical overlay owner/hit surface was
  unchanged.
- `src/page-world/program.ts:scheduleMotionEnforcement()` defaults its `root`
  argument to `document.documentElement`. Its mutation observer first collects
  targeted roots and then calls the function with no argument, re-adding the
  entire document on every mutation batch. `pauseMotionSources()` consequently
  repeats `document.getAnimations()` and `querySelectorAll("*")`, including for
  cursor and overlay mutations authored by the extension.
- The legacy motion-maintenance fix deliberately limited full scans to explicit
  engage points, collected incremental discovery roots, collapsed overlapping
  roots, and ignored its own writes. The rewrite decision spec permits those
  adaptations only when canonical output and freeze semantics remain identical.
- `src/content/marking/engine.ts:resolveAtPoint()` linearly resolves every
  explicit exclusion row on plain hover even when the event already carries a
  current `data-uf-overlay-xpath`. The hint can safely accelerate an existing
  owner only after current-generation/canonical-row/visibility validation; it
  must never authorize creation, widening, or a semantic target change.

## Decisions already made

- Keep `MARKING_AND_HIGHLIGHTING_LOGIC.md` unchanged: plain click cannot widen,
  Shift is the only widening modifier, Alt creates explicit inclusions, and a
  widened explicit exclusion owns its visible surface for ordinary unmarking.
- Keep the rewrite's single canonical evaluator/store and branch-splice path.
  No legacy monolithic cache or parallel marking truth will be copied.
- Add one content-owned presentation clock that captures scheduling primitives
  before page freeze, coalesces work, and uses a bounded task fallback so each
  requested frame completes exactly once even when native rAF starves.
- Use a 20 ms starvation fallback: normal rAF remains the primary paint-aligned
  path, while the fallback bounds visible input latency to approximately one
  60 Hz frame plus task dispatch.
- Treat `data-uf-overlay-xpath` only as a validated performance hint for an
  already canonical current-generation target. Missing, stale, invisible, or
  ineligible hints fall back to the existing composed hit-test resolver.
- Full page motion discovery remains exactly once at freeze engagement. Late
  maintenance processes only minimal connected page-authored roots, enumerates
  document animations once per enforcement batch, and ignores extension-owned
  subtrees, cursor-only class changes, and normalization writes.
- Do not weaken persistent page timer/rAF/idle freezing, lazy suppression,
  consent suppression, payload/capture rules, emulation, lock authority, Save,
  AI, Content List, or publication fences.

## Open questions

- None.

## Non-goals

- No marking taxonomy, target-resolution precedence, row normalization,
  selector seeding, overlay grammar, extraction, payload, or endpoint changes.
- No routine full-document reconcile after a toggle and no second evaluator or
  legacy global state transplant.
- No release of the page motion/lazy freeze while marking, silent highlighting,
  or preview owns it.
- No attempt to clear P22's external Hub `stale_fence` or unavailable candidate
  blockers as part of this performance phase.

## Implementation phases

### R1 — Characterize frozen-clock and incremental-maintenance failures

- Add `tests/src/content/presentation-clock.test.ts` covering normal rAF,
  starved rAF fallback, exactly-once delivery, trailing coalescing compatibility,
  cancellation, and a clock captured before later global patching.
- Extend `tests/c4-content-entrypoint.test.ts` with a marking mousemove case in
  which rAF never fires but the latest pointer reaches `hoverAtPoint` within the
  fallback bound and a later pointer schedules normally.
- Extend `tests/src/content/marking/dom-bridge.test.ts` with frozen-rAF silent
  scroll and geometry-stabilizer cases that retain overlay nodes and repaint.
- Extend `tests/src/page-world/program.test.ts` with counters proving one initial
  full scan, no full scan for extension-only mutations, minimal nested-root
  collapse, one animation enumeration per enforcement batch, and continued
  handling of genuine late page content.
- Focused validation: `pnpm vitest run` on those four files.
- Fallback rule: if a unit seam cannot reproduce the retained DPJ starvation,
  add a narrow P23 browser fixture; do not relax the observed failure.

### R2 — Install the content-owned presentation clock

- Add `src/content/presentation-clock.ts` with an opaque logical handle registry,
  captured/bound rAF and timeout primitives, rAF-first delivery, 20 ms starvation
  fallback, exactly-once arbitration, cancellation of the losing primitive, and
  deterministic teardown.
- In `src/entrypoints/content-loader.content.ts:scheduleHover()`, use the shared
  clock, preserve one coalesced trailing pointer, clear the logical handle before
  resolving, and cancel it on listener teardown.
- In `src/content/marking/engine.ts`, route `scheduleRender()`, the geometry
  stabilizer, and deferred branch presentation through the same clock. Track and
  cancel pending logical handles on refresh/dispose, and settle structural
  single-flight state in all terminal paths.
- Preserve rAF as the primary rendering acknowledgement and keep structural
  quiet/idle batching intact; only its terminal presentation delivery changes.
- Focused validation: presentation-clock, content entrypoint, marking engine,
  renderer, stabilizer, and source-contract tests.
- Rollback rule: if the dual primitive can deliver twice in any realm-specific
  fake/native ordering, keep the logical registry and disable the rAF branch;
  never return to an unbounded starvable handle.

### R3 — Port safe legacy hover reuse without changing marking truth

- In `src/entrypoints/content-loader.content.ts`, capture the closest current
  classification overlay XPath from mousemove/click/contextmenu targets and pass
  it as an optional resolution hint.
- In `src/content/marking/engine.ts`, validate hinted explicit owners against the
  current bridge generation, fingerprint, canonical explicit-exclude row,
  connection, visual visibility, and pointer rectangle before bypassing the
  all-row owner scan. Otherwise run the unchanged composed hit-test path.
- Reuse the prior resolved hover only when non-empty overlay identity,
  mode/Shift state, bridge generation, node identity/fingerprint, and connection
  are unchanged. Reset the cache on every bridge/store/viewport-invalidating
  transition already identified by the engine.
- In `src/content/marking/renderer.ts:setHover()`, no-op when element and XPath
  are unchanged so repeated events do not open a new geometry batch.
- Add parity tests for implicit targets, widened exact-owner unmarking, Alt,
  Shift, stale hints, invisible hints, navigation/generation changes, and
  fallback hit-testing.
- Focused validation: domain resolve, marking interaction/dom-bridge/renderer,
  content entrypoint, and P14 smoke.
- Rollback rule: any semantic row/classification difference disables the hint
  fast path for that case; canonical resolution always wins.

### R4 — Make page-motion maintenance incremental

- In authored `src/page-world/program.ts`, make
  `scheduleMotionEnforcement(root?: Element)` schedule collected work without
  injecting a default root. Keep the initial explicit
  `pauseMotionSources(documentElement)` full scan.
- Add a minimal-root collector that discards a new descendant when an ancestor
  is already queued and replaces queued descendants when a broader genuine
  page-authored root arrives.
- For child-list records, enqueue connected non-extension added element roots,
  not their whole parent/document. For attributes, enqueue the target only when
  the change is page-authored; compare `attributeOldValue` after stripping only
  `uf-cursor-*` tokens, skip extension subtrees, and consume tracked
  normalization-style writes.
- Enumerate `document.getAnimations()` once per enforcement batch and reuse that
  snapshot across minimal roots. Keep media, SVG, WAAPI, reveal normalization,
  semantic-hidden preservation, restoration, and late/restarted source behavior
  unchanged.
- Generate `src/page-world/program.js` only through `pnpm page-world:generate`.
- Focused validation: page-world program, source parity, motion freeze bridge,
  stabilization, and full `pnpm test`.
- Rollback rule: if a page-authored late animation is missed, broaden only that
  record's minimal root; never restore unconditional document-root injection.

### R5 — Add a frozen-surface browser performance gate and rerun A/B

- Extend the P14 performance harness or add a P23 companion scenario that uses
  the production presentation scheduler with a deliberately starved page rAF,
  physical mousemove/scroll inputs, retained overlay identities, and semantic
  signature equality. Keep the existing clean-source, finite-timing, cardinality,
  and page-error assertions.
- Acceptance thresholds: every physical pointer sequence paints the latest
  canonical target within 40 ms; silent geometry changes within 50 ms of each
  scroll; no overlay node retirement on scroll/resize; no full-document motion
  scan after extension-only mutations; current rows/classes equal the canonical
  pre-optimization output.
- Build production and debug artifacts. Using the repository `live-browser` /
  `live-round` tooling and copied profile posture, rerun DPJ at 412x960 against
  pinned legacy `28974c2a` and the rewrite. Capture frame-by-frame hover and
  silent-scroll evidence with page debuggers detached during extension-owned
  emulation.
- Live acceptance: rewrite hover coverage is 100%, pointer-to-overlay p95 is no
  slower than legacy plus 10 ms, eight distinct targets produce eight matching
  frames, every silent scroll produces current geometry, and console/page error
  sets are empty. Canonical rows, modifier behavior, exact unmarking, freeze,
  consent exclusion, and payload hygiene remain unchanged.
- Fallback rule: a timing miss returns to its owning R2-R4 slice; do not increase
  the budget without retained profiler evidence identifying unavoidable browser
  variance.

### R6 — Integrated validation, durable evidence, review, and publication

- Run `pnpm lint`, `pnpm check`, focused/full `pnpm test`, `pnpm build`,
  `pnpm build:debug`, `pnpm verify`, the P14-P20 production gates, and the new
  frozen-surface gate on a clean source set.
- Record implementation, benchmark, live A/B, artifact identity, and exact
  results in `.reimplementation/p23-frozen-surface-performance-report-2026-08-27.md`;
  update `.copilot/knowledge.md` with the reusable scheduling/full-scan pitfall
  and this execution checklist with the final evidence.
- Perform a final high-signal diff review, explicitly stage only intended files,
  commit, re-index the code graph, verify ahead/behind, push without force to
  `origin/re-write`, verify 0/0 equality, and re-index the pushed HEAD.

## Test matrix

Execution result: focused 133/133; `pnpm verify` 129 files / 1,177 tests;
production and debug builds; P14 192 scenarios; P15 36/36; P16 13/13; P17
19/19; P18 14/14; P20 4/4; P23 24/24. Under permanently starved page rAF,
physical hover latency was 21.0–22.4 ms and silent scroll latency was 22.6 ms,
with unchanged canonical rows and no console/page errors. See
`.reimplementation/p23-frozen-surface-performance-report-2026-08-27.md`.

| Contract | Focused evidence | Browser/live evidence |
| --- | --- | --- |
| Frozen-clock liveness | presentation clock, hover, geometry stabilizer | starved-rAF physical pointer/scroll gate |
| Exactly-once/coalescing | scheduler cancellation/race tests | one paint per latest input, no stuck handle |
| Marking semantic parity | resolve/store/dom-bridge/renderer tests | legacy/rewrite row and modifier equality |
| Silent retention | scroll/resize overlay identity tests | every DPJ scroll changes current geometry |
| Incremental freeze maintenance | page-world counters and late-source tests | no scan/CPU storm during hover mutations |
| Existing architecture | full unit/source/integration suite | P14-P20 production/debug gates |

## Regression risks

- A fallback and native rAF can race. The logical handle registry removes the
  entry before invoking user code and cancels the losing primitive; tests cover
  both callback orders and synchronous fakes.
- A hint could become stale after DOM rebase. Generation, fingerprint, canonical
  row, connection, visibility, and rect checks are mandatory; failure uses the
  existing resolver.
- Incremental motion discovery could miss a late descendant. Child-list roots
  include every non-extension added element and genuine page-authored attribute
  targets; late WAAPI/media/SVG tests remain binding.
- Filtering class mutations could hide a real page class change. Comparison
  removes only `uf-cursor-*`; every other token difference remains page-authored.
- A 20 ms fallback can run outside a paint callback. Overlay writes remain one
  coalesced geometry batch and the following browser paint is measured by the
  physical acceptance gate.

## Acceptance criteria

- With page rAF permanently starved, marking hover, marking scroll, silent
  scroll, resize, and geometry stabilization continue after every input; no
  scheduling handle remains permanently armed.
- DPJ rewrite hover coverage is 100%, eight tested target positions paint eight
  correct target states, and input-to-overlay p95 is no slower than pinned
  legacy plus 10 ms.
- Silent highlight nodes remain mounted and their geometry follows every tested
  scroll/resize within 50 ms.
- Freeze engagement performs one full document discovery; later extension UI,
  cursor, and normalization mutations perform zero full-document scans, while
  genuine late page animations/media/SVG sources are still paused.
- Canonical rows, classifications, Shift-only widening, Alt include, exact-owner
  unmarking, consent exclusion, capture/payload output, reveal/freeze lifetime,
  and publication fences are unchanged.
- All focused, full, production/debug, P14-P20, P23 browser, review, commit,
  graph-index, and non-force push gates pass.

## Todo chain

1. `p23-characterize-frozen-presentation`
2. `p23-extension-presentation-clock`
3. `p23-hover-hotpath-parity`
4. `p23-incremental-motion-maintenance`
5. `p23-browser-performance-acceptance`
6. `p23-integrated-review-push`
