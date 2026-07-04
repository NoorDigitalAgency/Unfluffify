# Widening-restraints hardening — implementation plan

> Executable plan for the two hardening findings (F2, F5) from
> `marking-widening-review.md`. Branch `feat/marking-widening-hardening`;
> baseline tag `pre-widening-hardening`. F1/F3/F4 are OUT OF SCOPE — they are
> semantic decisions queued for architect Q&A (options + recommendations in the
> review doc) and must not be implemented without those decisions.

## 1. Goal

Close the two purely-mechanical widening gaps without changing any agreed
marking semantics: (W1/F2) a Shift-click directly on a deep (depth-3+)
full-width wrapper that is markable only via its descendants must be rejected
by the page-shell guard like its shallow counterparts; (W2/F5) the shell
guard's depth computation must see through open shadow boundaries so shadow
content is not silently exempt.

## 2. Current facts (verified, file:line at branch point)

- `isUnsafeShallowParentMarkingTarget` (core.ts ~8525): exemptions =
  `isParentMarkingContentBoundary` (semantic tags set ~:801) + `hasDirectText`;
  then `if (getDepthBelowBody(el) > 2) return false;` → the
  landmark/footprint rejection NEVER runs deeper than 2 below body.
- `isMarkableElement` (core.ts ~11880) `allowParent` path: shallow-guard then
  `hasMultipleMarkableDescendants` (threshold ≥1 via
  `shouldAllowParentMarkingBoundary`) — the clicked element itself is the
  runaway vector; ancestor-ladder candidates are safe (evaluated with
  `allowParent:false` → must be SELF-markable → direct-text only).
- `getDepthBelowBody` (core.ts ~8453) walks `parentElement` → ∞ inside shadow
  roots → guard disabled there (CP6 residual).
- Guards available: `containsPageShellLandmark` (≥2 landmark kinds),
  `hasBroadParentMarkingFootprint` (≥0.85w ∧ ≥0.65h of viewport; sane under
  the forced mobile emulation).
- Existing tests: core-visibility.test.ts "parent marking rejects broad
  shallow page wrappers" + "…shallow generic page shells with site landmarks".
- Contract anchor: MARKING_AND_HIGHLIGHTING_LOGIC.md §Exclude Mode — "current
  shallow page-shell guard still rejects generic body-level wrappers…".

## 3. Decisions already made

The architect approved hardening F2+F5 (review doc, "HARDENED" disposition) and
queuing F1/F3/F4 for Q&A. F2's design keeps the existing exemptions (semantic
content boundaries, direct-text elements) so no agreed-positive case changes;
it only extends the REJECTION surface to any-depth descendants-only targets.
The shallow (depth≤2) guard stays unchanged for the structured-group predicate.

## 4. Non-goals

- NO change to F1 (svg vs immutable-descendant suppression), F3 (≥1
  threshold), F4 (structured-group every()) — Q&A-gated.
- NO change to the ladder order, drill/reach rules, self-markability, or any
  assessment predicate semantics.
- NO change to shallow-guard behavior for structured groups.

## 5. Checkpoints

### W1 — F2: any-depth shell rejection for descendants-only widen targets
- Add `isUnsafeWideDescendantOnlyTarget(el)` (same exemptions:
  content-boundary tags, direct text; rejection = `containsPageShellLandmark ||
  hasBroadParentMarkingFootprint`, NO depth gate).
- In `isMarkableElement`'s `allowParent` path, after
  `hasMultipleMarkableDescendants` passes, reject when
  `isUnsafeWideDescendantOnlyTarget(el)`.
- Tests (core-visibility.test.ts): deep (depth-3) full-width wrapper with only
  descendant markability → rejected; deep NARROW card container → still
  eligible; deep full-width `<section>` → still eligible (exemption).
- Contract: extend §Exclude Mode shell-guard sentence (any-depth for
  descendants-only targets) + document the ancestor self-markability restraint
  (the real ladder bound, currently undocumented). knowledge.md bullet.
- Gate: pnpm lint+check+test+build. review-push.

### W2 — F5: shadow-aware depth for the shell guard
- `getDepthBelowBody` walks `getFlattenedParentElement` (guarded, ≤500) so
  open-shadow content gets a real depth instead of ∞.
- Test: source pin (flattened-parent walk) + a mock behavioral case if the
  harness supports it cheaply.
- Contract: one-line note in §Shadow DOM (shell guard applies inside open
  shadow trees). knowledge.md bullet.
- Gate + review-push.

## 6. Test matrix
Per checkpoint: the new focused tests + the full gate
(`pnpm lint && pnpm check && pnpm test && pnpm build`). The existing two
shallow-shell tests must stay green (regression guard).

## 7. Regression risks
- W1 could over-reject legitimate wide targets: mitigated by keeping the
  content-boundary + direct-text exemptions (sections/articles/lists,
  toggleable boundaries via the ladder, mixed-text ancestors unaffected) and by
  the narrow-container test. Hover parity: the same predicate drives
  Shift-hover, so hover and click stay consistent by construction.
- `containsPageShellLandmark` now runs for deep Shift targets (hover included):
  children-only DFS with early exit; bounded, RAF-debounced hover — acceptable.
- W2 changes depth for shadow content only; light-DOM depth identical
  (getFlattenedParentElement === parentElement when a parent exists).

## 8. Acceptance criteria
- Deep full-width wrapper Shift-target rejected; narrow/semantic targets
  unchanged; both existing shallow-shell tests green; full gate green per
  checkpoint; contract + knowledge updated in the same commits.

## 9. Execution
run-plan W1 → W2 with review-push (inline review + gate + commit + push) at
the end of each checkpoint; then report.
