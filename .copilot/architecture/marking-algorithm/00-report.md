# Marking Algorithm — Report & Q&A Agenda

> **Read this first.** Companion to `content-marking/` (the *semantics* — what
> counts as meaningful). This folder is the *algorithm* — the deterministic,
> mechanical marking interaction across the architect's four areas. Same
> three-way method:
> - `01-first-principles-should-be.md` — independent machine-state derivation
>   (FSM + eligibility predicates + XPath determinism + render tiers), committed
>   before re-opening the contract/code (`fd00b09`).
> - `02-as-implemented.md` — the code today, `file:line` anchored.
> - `03-locked-contract.md` — the `MARKING_AND_HIGHLIGHTING_LOGIC.md` marking
>   algorithm distilled, mirroring `01`/`02`.
>
> This report maps the three-way picture and the Q&A agenda. `MA-#` = the
> algorithm decisions; `Q-α…θ` are the first-principles questions from `01 §6`.

---

## The three-way picture, one paragraph

For the marking algorithm, **all three largely agree.** The implementation
faithfully realizes the contract (interaction modes + modifier sync + reset,
drill-vs-reach target resolution, Shift breadth order, closed include boundaries,
passthrough expand-then-mark, positional snapshot-aligned XPaths, layered
cache-key-gated rendering with per-pass caches, O(1) hover, scroll-reposition
reuse, 3-sample/2.6s settle). My from-scratch FSM formulation reached the same
answers, and the contract explicitly confirms the ones I flagged as questions
(drill/reach Q-γ, Shift order Q-δ, closed boundary Q-ε, repaint tiers Q-ζ/η,
hover O(1) Q-θ). So — as with the semantics — there is **no true behavioral
divergence**; the Q&A is about (a) one real extension the D5a decision already
mandates (shadow-DOM), (b) a couple of shipped nuances to confirm, and (c)
whether to formalize the FSM in the contract.

---

## The agreed core (likely lock as-is)

- **Interaction FSM:** `OFF → BUSY_LOCKED → PASSTHROUGH(Space) → INCLUDE(Alt) →
  EXCLUDE(default)`, `Shift` an orthogonal breadth modifier; mode derived from
  held modifiers each event; blur/visibility/navigation release the latch. Click
  mode reads `event.altKey` (race-proof). Cursor per mode.
- **Eligibility predicates:** self-markable = visible ∧ ¬immutable ∧ ¬chrome ∧
  (direct-text ∨ structural-boundary); toggleable defaults override-able;
  immutable never markable.
- **Exclude DRILLS to refine** (skip excluded ancestors, deepen); **Include
  REACHES IN to rescue** (into excluded/hidden) and forms a **closed boundary**.
- **Row normalization** on every toggle keeps the stored set canonical (shallow
  exclusion roots; includes always submit even hidden/nested).
- **XPath** positional + computed against the exact sanitized HTML sent; state
  maps deterministically to `{xpath, excluded, explicit?}` + a separate include
  list; submission derives shallow roots + elaborate inclusions in fixed order.
- **Render** = pure projection into fixed z-index layers; cache-key gate →
  reposition-only vs full rebuild; per-pass derived caches; O(1) hover;
  scroll-reposition reuse; settle-by-sampling; extension UI outside the freeze.

If you agree these are the mechanical spine, they get locked (and, per MA-2, may
be written into the contract as an explicit FSM).

---

## Decision agenda (ranked)

### MA-1 — Shadow-DOM marking scope (HIGH — the real work; ties to D5a) 
The semantics phase already decided (D5a) that shadow content must reach the AI
via deep-capture (replicate the consumer's `ContentDeepAsync`). The algorithm
consequence: today `elementsFromPoint` and `getXPath` **do not cross shadow
boundaries**, so shadow content is both **un-markable** and **outside the
positional-XPath space**. Decide the scope:
- **(a) Capture-only (smaller):** deep-capture puts shadow content in the
  `renderedHtml` the AI sees; the user marks only light-DOM; the enumerated
  visible-text inclusion still needs to *enumerate* shadow text — so even
  capture-only requires the visibility/text walk and XPath indexing to traverse
  shadow roots for the flattened view. XPaths address nodes in the flattened
  `<template shadowrootmode>` representation.
- **(b) Full in-shadow marking (larger):** target resolution
  (`elementsFromPoint` composed-path / `getRootNode()` walks), hover geometry,
  and XPath all become shadow-aware so the user can explicitly include/exclude
  inside shadow trees.
- **Recommendation:** start with (a) — it satisfies the D5a payload need and the
  enumerated-inclusion requirement; add (b) only if target sites need the user to
  correct *inside* shadow content. I'll bring a concrete code plan once you pick.

### MA-2 — Formalize the interaction FSM in the contract? (MEDIUM — architecture/doc)
The reflex-arc program favors explicit state machines. The marking interaction is
currently an *implicit* FSM (derived from held modifiers) in code and prose-by-
mode in the contract. Decide whether to promote `01 §5`'s explicit
states/events/transitions table into `MARKING_AND_HIGHLIGHTING_LOGIC.md` as the
canonical spec (documentation + a possible small refactor to a single
`deriveMarkMode(event/state)` authority), or keep the current prose. No behavior
change either way; it's about making the machine legible and test-anchored.

### MA-3 — Render debounce model: reconcile contract text with shipped behavior (MEDIUM)
The contract says "structural refinements → immediate invalidating full rebuild;
leaf explicit-exclude → debounced." The code (issue #6 fix) now draws the
**explicit overlay immediately** on every toggle for responsive acknowledgement,
then reconciles the full rebuild (deferred ~180ms in the deferred path). Decide:
is the shipped "immediate overlay ack + deferred full reconcile" the intended
model (then update the contract wording to match), or should structural toggles
force the immediate full rebuild as the contract literally says (then adjust
code)? Likely the shipped behavior is right (it fixed a real "clicks feel
ignored" bug) and the contract text just needs updating.

### MA-4 — Nesting-collapse cost (LOW — verify/harden)
`collapseElementsByNesting` walks each candidate's ancestors against a kept-set.
The contract requires ancestry-set/parent-walk cost (∝ rows×depth), not pairwise
`contains()` scans. Verify the current implementation meets that bound on
large pages; harden if a pathological O(n²) path exists.

---

## Confirm-intent (mostly already contract-answered)

- **Q-α (area-2 scope):** I read "implicit inclusion marking/unmarking" as the
  whole inclusion side (implicit eligibility + the explicit-include action).
  Confirm that's what you meant (vs. only the automatic default-content
  eligibility).
- **Q-β (structural-boundary definition):** confirm the cohesion rule (section/
  article/card-group/list/table/toggleable-default) and the shallow-page-shell
  rejection (first-two-levels-under-body, broad footprint, multiple landmarks)
  are the intended "structured group" definition.
- **Q-γ drill/reach · Q-δ Shift order · Q-ε closed boundary · Q-ζ/η repaint
  tiers · Q-θ hover-O(1):** all CONFIRMED by the contract + code — flag only if
  any is NOT what you want.

---

## After-phase plan (implementation review + fix/harden)

Runs only after this record is agreed; each lands with the contract change-
discipline (`MARKING_AND_HIGHLIGHTING_LOGIC.md` + knowledge.md + plan.md +
README.md + focused tests, same commit) under review-push:

1. **MA-1 shadow DOM** — the coordinated D5a work: deep-capture in the snapshot +
   shadow-aware visibility/text/XPath for the flattened view (capture-only first),
   optionally full in-shadow target resolution; add `SVG` to immutable (D5b) in
   the same pass.
2. **MA-2** — if chosen, write the explicit FSM into the contract (+ optional
   `deriveMarkMode` consolidation + FSM tests).
3. **MA-3** — reconcile the render-debounce contract text with the shipped
   immediate-overlay model (doc update, or code adjust if you want literal
   structural-immediate).
4. **MA-4** — verify/harden `collapseElementsByNesting` cost.
5. Plus the D1 harden items from `content-marking/04` (expand-then-mark path).
6. Everything in "the agreed core": confirmed as-is — regression-guard only.

## One-line status

Marking-algorithm three-way documentation complete and (01) committed; the
implementation matches the locked contract with no behavioral divergence; the
open items are MA-1 (shadow-DOM, mandated by D5a), MA-2 (formalize the FSM?),
MA-3/MA-4 (confirm shipped nuances), ready for the Q&A.
