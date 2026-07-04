# Critical review: default/selector assessment, target candidacy, exclusion widening

> Post-`cp7-complete` critical audit of the marking dynamics requested by the
> architect: (1) initial default/selector-based assessment, (2) candidate
> targets, (3) Shift-widening to the shallowest eligible parent, (4) the effect
> of immutable descendants on ancestor markability, (5) restraints that keep
> widening meaningful and make too-wide/root exclusions impossible. Findings
> F2/F5 are HARDENED (same-day checkpoint); F1/F3/F4 are QUEUED for Q&A below.

## Verdict

Robust overall. Root/body exclusion is impossible via four independent layers
(hit-test skip of body/html; the ancestor-walk hard break at body/documentElement
in `resolveMarkableElement`; the `isRoot` candidate rejection in
`collectDefaultHighlightTargets`; `getDepthBelowBody` returning ∞ off-body).
The widening ladder (self → nearest structured group → nearest toggleable →
broadest markable ancestor, `chooseExcludeParentBoundaryTarget`) is bounded by
an under-documented but decisive restraint: **ancestor candidates are evaluated
with `allowParent:false`, so the broadest-markable rung can only ever select a
SELF-markable ancestor (direct own text)** — generic wide wrappers have no
direct text and are ineligible. Precedence/suppression composition
(selector-excluded = self-only; immutable = subtree) is coherent across all
seven predicates. Determinism measurably improved post-CP7a (byte-identical
repeat runs vs. a flapping baseline).

## Findings

| # | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | CP1 (svg→immutable) silently widened the 052c "visible immutable descendant suppresses boundary auto-exclusion" rule (`matchesAutoToggleableDefaultExcluded` rule 3): a visible svg ICON now vetoes auto-exclusion of its toggleable boundary. Affected shape: boundary with a textual descendant ELEMENT + no nested toggleable + visible svg (e.g. `<footer><p>©…</p><svg/></footer>`). `<button>Text<svg/></button>` is NOT affected (rule 1 fires — text nodes aren't descendant elements); nested-nav footers NOT affected (rule 2). Empirically zero rows changed on bonliva home, but the interaction is real and unreviewed. | Medium (semantic) | **Q&A** |
| F2 | The shell guard (`isUnsafeShallowParentMarkingTarget`) self-disabled at depth>2 below body, and widen-eligibility via `hasMultipleMarkableDescendants` needs only ≥1 markable descendant — so Shift-clicking directly on a depth-3+ full-width wrapper (div-soup SPAs) selected the whole content column with no footprint/landmark check. The ladder itself was safe (self-markability restraint); the vector was the clicked element. | Medium (too-wide) | **HARDENED** — shell checks now apply at ANY depth to descendants-only targets (see below) |
| F3 | `shouldAllowParentMarkingBoundary` threshold is ≥1, contradicting the `hasMultipleMarkableDescendants` name/intent — single-descendant wrappers are widen-eligible (near-equivalent to the descendant itself, at a wider box). | Low-Med | **Q&A** (052c-compat decision) |
| F4 | `isStructuredGroupExclusionCandidate` requires `children.every(isGroupedBoundaryChildCandidate)` after filtering only popover/consent/immutable children: one textless spacer div disqualifies the group, and img+caption cards collapse below the 2-child minimum — so card grids often can't group and widening degrades past the intended level. | Medium (usability) | **Q&A** |
| F5 | `getDepthBelowBody` walked `parentElement`, returning ∞ inside shadow roots → the shell guard was silently OFF for shadow-internal wrappers (CP6 residual). | Low | **HARDENED** — flattened-parent walk |
| F6 | Initial assessment depends on freeze-moment paint-reachability (carousel card flip observed on the PRE-fix build; bounded by settle sampling; improved by CP7a reuse). Inherent to user-visibility semantics. | Low | Accept, documented |
| F7 | `containsPageShellLandmark` counts tag-kinds and role-kinds independently (one `<header role="banner">` child = 2 kinds). Conservative direction (blocks more); harmless. | Info | Accept |

## Hardening shipped with this review (F2 + F5)

- **F2:** `isMarkableElement`'s `allowParent` path now applies the page-shell
  rejection (`containsPageShellLandmark` / `hasBroadParentMarkingFootprint`) at
  **any depth** when — and only when — the target is markable solely via its
  descendants (not self-markable). Semantic content boundaries
  (`PARENT_MARKING_CONTENT_BOUNDARY_TAGS`) and direct-text elements keep their
  exemption, so sections/articles/lists and mixed-text ancestors are unaffected;
  narrow card containers remain widen-eligible. The depth≤2 shallow guard is
  unchanged for the structured-group predicate (deep structured groups stay
  legitimate).
- **F5:** `getDepthBelowBody` walks `getFlattenedParentElement`, so shadow
  content gets a real depth and shell protection applies inside open shadow
  trees.

## Q&A agenda (decisions queued for the architect)

- **F1 — LOCKED (architect, 2026-07-04): REMOVE the visible-immutable-descendant
  suppression entirely (rule 3), superseding the svg-only exemption.**
  Rationale (architect): the rule is confined to the AUTOMATIC default
  assessment (generated rows, default-exclusion overlay, drill-ancestor
  semantics — manual toggling unaffected), and within its real blast radius
  (simple boundaries: text element + visible immutable media + no nested
  toggleable, e.g. `<footer><p>©…</p><img logo></footer>`) it actively LEAKS
  boilerplate text into AI-included content: "not auto-excluded" makes the
  boundary's text fall through to the default content layer and submit as
  included, while the media was excluded by the immutable tag list anyway.
  FORM/NAV/BUTTON descendants never suppressed (they are toggleable → rule 2
  fires), so most real footers were unaffected — the rule protected nothing.
  Consequences: rules 1/2 existed only as bypasses of rule 3, so
  `matchesAutoToggleableDefaultExcluded` collapses to the plain taxonomy tag
  match ("a toggleable-default tag is auto-excluded, period"). This is a
  DELIBERATE 052c DEVIATION: the contract line "boundaries with visible
  immutable descendants are suppressed…" is removed and the 052c-restoration
  test (footer with visible logo img NOT collected) flips to its opposite.
  Counter-case accepted: media+meaningful-text asides/headers become excluded
  by default — which the taxonomy already declares, with toggle/Alt-include as
  the rescue paths.
- **F3 — LOCKED (architect, 2026-07-04): require ≥2 markable descendants** for
  a descendants-only widen target (`shouldAllowParentMarkingBoundary` threshold
  1 → 2). Widening always means "group several content pieces"; single-child
  wrappers stop being widen targets (the user excludes the child directly).
  Deliberate, documented 052c deviation.
- **F4 — LOCKED (architect, 2026-07-04): filter textless children** (children
  that are not textual containers at all — spacers/decorations) before the
  structured-group `every()`/min-2 checks, extending the existing noise filter
  (immutable/consent/popover children are already ignored). Spacers stop
  vetoing groups; cards can group when ≥2 textual children remain.
  Deterministic, no scoring. Documented 052c refinement of the Q-β cohesion
  definition. Monotone: every group that qualified before still qualifies
  (previously all children had to be textual grouped-candidates, so the new
  filter removes nothing from passing groups).
