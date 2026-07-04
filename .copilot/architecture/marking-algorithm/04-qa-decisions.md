# Marking Algorithm — Q&A Decisions (single source of truth, in progress)

> Live record of the architect's decisions from the marking-algorithm Q&A (see
> `00-report.md` for the agenda: MA-1..MA-4 + confirm-intents). Folds into
> `MARKING_AND_HIGHLIGHTING_LOGIC.md` (+ knowledge.md, plan.md, README.md, tests)
> when complete; implementation review/harden follows. Appended as locked.

---

## MA-1 — Shadow-DOM marking scope — LOCKED: FULL in-shadow, treat flattened shadow as REAL DOM

**Decision:** The extension must handle shadow-DOM content **exactly as Googlebot
does** — because "if there is something Google cares about happening in there,
the extension needs to handle it." That means **flatten the shadow tree into real
DOM** and treat it as a regular (non-shadow) hierarchy across ALL four areas:
enumeration, marking / target resolution / hover / click, XPath, and rendering.
This supersedes the earlier "capture-only + host-markable" recommendation.

**Evidence (Googlebot render of the cramo category page, `~/Desktop/example.html`):**
- Googlebot inlines shadow content as **ordinary elements** — **zero
  `<template shadowrootmode>` wrappers** in the rendered HTML. The `cramo-read-more`
  shadow tree appears flattened as:
  `<cramo-read-more> › div.overflow-hidden[height:100px] › div#textContainer ›
  p.mb-0 (full text)` + sibling `div.button-container.is-collapsed ›
  button.read-more-btn "Läs mer"`.
- This is exactly what the consumer's `ContentDeepAsync` produces
  (`flattenShadowTemplates` unwraps `<template shadowrootmode>` into inline real
  elements). The extension replicates the same to match Google.

**Consequences for the four areas:**
1. **Enumeration** must descend into shadow roots (composed/flattened tree) so
   shadow text is enumerated as elaborate inclusions and shadow noise is
   classified by the default taxonomy — like light DOM.
2. **Marking / target resolution** must be shadow-aware: `elementsFromPoint`
   composed-path / `getRootNode()` traversal so the user can click and
   include/exclude **individual nodes inside a shadow tree** (the read-more case:
   include the `<p>`, exclude the read-more, independently). Host-level-only
   marking is NOT sufficient.
3. **XPath** = **continuous, regular positional XPath** through the flattened
   shadow nodes — NO special `<template>` indexing. A shadow `<p>` is addressed
   like any light-DOM `<p>`. This resolves the earlier open XPath question: the
   flattened view has shadow content as real inline elements, so indices are
   continuous with the light DOM and align to the sent (deep-captured) HTML.
4. **Rendering** must position overlays over the composed/flattened positions of
   shadow nodes (they render at their real on-screen boxes).

**Contract status:** CHANGE REQUIRED — `MARKING_AND_HIGHLIGHTING_LOGIC.md` is
silent on shadow DOM; add: shadow trees are flattened to real DOM (Googlebot
parity) and participate fully in target resolution, enumeration, XPath, and
render. Coordinates with the semantics D5a deep-capture (`content-marking/04`)
— capture + marking + XPath all use the same flattened view.

**After-phase implementation scope (largest item in the program):**
- Deep-capture: replicate `ContentDeepAsync` (flatten `<template shadowrootmode>`
  → inline) for the sent `renderedHtml`.
- Target resolution: composed-path hit-testing (`elementsFromPoint` +
  `getRootNode()` / shadow descent) so inner shadow nodes are click-targetable.
- Enumeration + XPath: traverse the flattened/composed tree; positional XPath
  continuous through former shadow boundaries; verify xpath↔captured-HTML
  alignment on the flattened view.
- Render: reposition over composed-tree geometry.
- Handle **open** shadow roots (cramo is `mode:"open"`); note closed shadow
  roots are inaccessible (flag if any target site uses closed mode).

---

## MA-1b — CSS-clamped-but-present text — LOCKED: INCLUDE (match Google)

**Decision:** When text is **fully present in the DOM but visually truncated by
CSS** — `overflow:hidden` + fixed/`max-height`, or `-webkit-line-clamp` — treat
it as **VISIBLE and included**. It is a layout truncation, not a genuine hide,
and it is exactly what Google indexes (the cramo `<p>` clamped to
`overflow-hidden; height:100px; is-collapsed` is nonetheless the page's full
`<meta name="description">`).

This is a **distinct case** from, and does NOT change:
- genuine hiding (`display:none`, `visibility:hidden`, `opacity:0`,
  zero-area) → still excluded;
- interaction-gated panels (tab panels / accordions with `display:none` until
  interaction) → still excluded-unless-expanded per D1.

The distinction is: **is the full text present and laid out in the DOM, merely
clipped by an overflow/height/line-clamp?** If yes → include. If it's genuinely
not rendered (display/visibility) → the existing rules apply.

**Contract status:** CHANGE REQUIRED — refines the visibility rule in
`MARKING_AND_HIGHLIGHTING_LOGIC.md` / `content-marking/04` (D4) + the invisible-
textual submission rule: CSS-clamp overflow is NOT "invisible textual"; the
clipped-off content submits as included, not excluded.

**After-phase note:** the current `isClippedByOverflow` visibility check
(`core.ts:1277-1327`) treats overflow-clipped elements as not-visible — it must
be refined to distinguish a *layout clamp with full text present* (include) from
a genuine off-screen/clipped-away element (exclude). Verify against the cramo
clamp and a true `-webkit-line-clamp` case.

---

## MA-2 — Formalize the interaction FSM in the contract — LOCKED: YES

**Decision:** Promote the explicit states/events/transitions table (`01 §5`) into
`MARKING_AND_HIGHLIGHTING_LOGIC.md` as the canonical marking-interaction spec
(states OFF/BUSY_LOCKED/PASSTHROUGH/INCLUDE/EXCLUDE, Shift a breadth modifier;
events enable/disable/busy/keydown/keyup/pointermove/click/blur/visibility/
navigation; transitions). Back it with a single `deriveMarkMode` authority + FSM
tests. No behavior change — makes the machine legible, test-anchored, and
consistent with the reflex-arc program.

**Contract status:** CHANGE (documentation + small consolidation) — add the FSM
section; after-phase may consolidate mode derivation behind one function + tests.

---

## MA-4 — Nesting-collapse cost — LOCKED: VERIFY + HARDEN IF NEEDED

**Decision:** In the after-phase, confirm `collapseElementsByNesting`
(`core.ts:3796`) is O(rows×depth) on large pages; if a pathological O(n²) path
exists, refactor to a strict ancestry-set / parent-walk per the contract's
Marking Performance Contract. Correctness-preserving; low priority.

**Contract status:** no rule change; a performance verification/harden item.

---

## MA-3 — Render debounce / rebuild model — LOCKED: branch-scoped incremental rebuild is the TARGET; shipped immediate-ack + debounce is the documented INTERIM

**Decision (architect's reframe).** Today a mark toggle changes the coarse cache
key (`pageURL ⊕ selector-set ⊕ entry`) and triggers a **full-document rebuild**
(re-walk the whole DOM, re-run eligibility on every element, recollect all
layers); a leaf fast-patch mitigates only the visual latency (issue #6). This is
wasteful because a mark's blast radius is **branch-local**.

**Target model:** treat the HTML hierarchy as the unit of invalidation. On a mark
on element E, rebuild only the **affected surface = subtree(E) ∪ ancestor-chain(E)**
(to the nearest marked/structural ancestor), splice into the cached collections,
and **keep the selector-influence, AI-content, and immutable layers cached
untouched** (a marking toggle does not change the AI selector set — VERIFY before
freezing). Cost drops from O(document) to O(affected-branch + depth). Because an
element's fate depends only on its OWN ancestry (never a sibling's mark), the
incremental result is provably identical to a full rebuild — guard that with an
`incremental == full-rebuild` equivalence test over a corpus + a settle-time full
reconcile as a safety net. Run the scoped rebuild **immediately** (it's cheap
enough — no debounce hack needed; the structural-vs-leaf split collapses into one
rule: recompute the affected branch immediately).

**Interim (until the incremental rebuild ships):** keep the shipped
immediate-explicit-overlay-ack + debounced (~180ms) full reconcile — it is
correct, just not optimal — and update the contract wording to describe it
accurately. This keeps the program unblocked; the incremental rebuild is a
distinct, larger checkpoint.

**Contract status:** CHANGE — document the target incremental-rebuild model + the
interim in `MARKING_AND_HIGHLIGHTING_LOGIC.md §Marking Performance Contract`.
**Prerequisite to verify:** marking toggles never alter selector matches (so
selector/AI/immutable layers can be frozen across marks).

---

## Q-α — Area-2 scope — CONFIRMED (as documented)

"Implicit inclusion marking/unmarking" is read as the whole INCLUSION side:
implicit-inclusion eligibility (automatic default-content membership) + the
explicit-include action (Alt) that rescues would-otherwise-excluded content, and
how excluding removes from the implicit set. Low-stakes; revisitable.

## Q-β — Structured-group definition — CONFIRMED (contract's definition stands)

The "structured group" cohesion rule = section / article / card-group / list /
table / toggleable-default boundary, rejecting shallow page shells (generic
body-level wrappers within the first two levels under `body`, broad viewport
footprint, or multiple page landmarks). Matches contract §Exclude Mode Shift +
§Self-Markability. No change.

---

## OUTCOME SUMMARY (marking algorithm Q&A)

| # | Decision | Result |
|---|---|---|
| MA-1 | Shadow-DOM scope | **CHANGE** — full in-shadow, treat flattened shadow as real DOM (Googlebot parity) across all 4 areas |
| MA-1b | CSS-clamped-but-present text | **CHANGE** — include (match Google); distinct from display:none/interaction-gated |
| MA-2 | Formalize interaction FSM | **CHANGE (doc + small consolidation)** — explicit FSM in the contract + deriveMarkMode + tests |
| MA-3 | Render rebuild model | **CHANGE** — branch-scoped incremental rebuild = target; shipped ack+debounce = documented interim |
| MA-4 | Nesting-collapse cost | verify O(rows×depth), harden if needed |
| Q-α/Q-β | scope + structured-group | CONFIRMED as documented |

Combined with the semantics decisions (`content-marking/04`: D5a shadow
deep-capture, D5b svg→immutable, D1 expand-then-mark harden, C2 submission
geometry), this is the complete agreed contract for the fix phase.

## AFTER-PHASE IMPLEMENTATION ORDER (checkpoints)

Each checkpoint is independently shippable, gate-green, and lands with the
contract change-discipline (`MARKING_AND_HIGHLIGHTING_LOGIC.md` + knowledge.md +
plan.md + README.md + tests, same commit) under review-push:

1. **CP1 — svg→immutable (D5b)** — smallest; add `SVG` to
   `DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS` + contract + tests.
2. **CP2 — CSS-clamp visibility (MA-1b)** — refine `isClippedByOverflow` /
   invisible-textual so full-text-present clamps are included; tests
   (cramo clamp + `-webkit-line-clamp`).
3. **CP3 — FSM formalization (MA-2)** — `deriveMarkMode` single authority +
   explicit FSM in the contract + FSM tests (behavior-preserving).
4. **CP4 — Shadow deep-capture (D5a)** — replicate `ContentDeepAsync`
   flatten-to-real-DOM in the sanitized snapshot; tests.
5. **CP5 — Shadow-aware enumeration + XPath (MA-1 pt 1)** — traverse the
   composed/flattened tree; continuous positional XPath through former shadow
   boundaries; xpath↔captured-HTML alignment tests.
6. **CP6 — Shadow-aware target resolution / marking / render (MA-1 pt 2)** —
   composed-path hit-testing so inner shadow nodes are click-markable; overlay
   positioning over composed geometry; tests (read-more case).
7. **CP7 — Branch-scoped incremental rebuild (MA-3 target)** — the largest;
   scoped collection + `incremental == full` equivalence test + settle reconcile;
   only after the selector-invariance prerequisite is verified. (Interim shipped
   behavior stands until this lands.)
8. **CP8 — D1 expand-then-mark harden + MA-4 collapse verify** — the smaller
   verification/harden items.

Live acceptance after the shadow + render checkpoints: heavy bonliva page,
performance + correctness vs the pre-fix baseline (tagged checkpoint on main).
