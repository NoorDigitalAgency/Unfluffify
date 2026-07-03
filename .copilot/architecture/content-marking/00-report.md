# Content Marking Semantics — Report & Q&A Agenda

> **Read this first.** This folder documents the include/exclude ("meaningful
> content") logic three ways so we can agree on a single source of truth before
> touching code. Nothing here changes the implementation — that is the *after*
> phase. The three documents:
>
> - `01-first-principles-should-be.md` — my independent reasoning of what the
>   logic *ought* to be, written deliberately BEFORE reading the contract or code
>   (uncontaminated), committed separately (`70767e8`).
> - `02-as-implemented.md` — what the code actually does, traced with `file:line`
>   anchors.
> - `03-locked-contract.md` — a faithful distillation of the canonical locked
>   contract (`MARKING_AND_HIGHLIGHTING_LOGIC.md`, commit `052c164b…`) + the
>   knowledge.md marking bullets.
>
> This report is the map: the three-way picture, the ranked decisions, and the
> agenda for our Q&A. Question labels `Q-A…Q-H` are defined in `03 §13`;
> `Q1…Q12` are the first-principles questions in `01 §12`.

---

## The three-way picture, in one paragraph

The **implementation faithfully realizes the locked contract** — on the
exclusion taxonomy (10 immutable + 8 toggleable tags), the
defaults→selector→explicit precedence, the explicit include/exclude mechanics
and row-normalization, submission-row semantics, silent highlighting, and
(verified after an initial tracer misread) **mobile-first enforcement**. I found
**no true code-vs-contract divergence** in the marking semantics. Therefore the
Q&A is almost entirely about whether the **contract itself is what you want** —
the places where my from-scratch reasoning (`01`) reaches a different answer than
the locked contract (`03`) are genuine *product/design* decisions, not bugs. The
biggest three are interaction-gated content, noise heuristics, and the
emitted-payload philosophy.

---

## What all three AGREE on (the stable core — likely not up for debate)

- **Two exclusion tiers:** immutable (`IMG INPUT NOSCRIPT SELECT TITLE STYLE
  SCRIPT TEMPLATE IFRAME VIDEO`, never markable) and toggleable-by-default
  (`FOOTER FORM LABEL NAV HEADER DIALOG ASIDE BUTTON`).
- **Default content layer** = visible, direct-text-bearing elements not in the
  excluded taxonomy = implicit inclusions.
- **Explicit inclusion rescues meaningful content the defaults dropped** (the
  footer-blurb case) and **always submits even when hidden or nested in an
  excluded ancestor**; **explicit exclusion drops kept content**; explicit beats
  implicit; include boundaries are closed; nested islands/holes are well-defined.
- **Mobile-first is enforced** (forced mobile emulation on activation).
- **Reveal/freeze** loads deferred content before a single frozen capture.
- **Both rendered + static HTML are sent** (raw only when render mode = static),
  with the marks as XPath rows; the AI returns CSS selectors.
- **Consent UI is hidden then treated as invisible** (no dedicated consent list).
- **Silent highlighting** previews the three layers (immutable/content/excluded).

If you agree these stay, the contract's spine is settled and the Q&A is only the
items below.

---

## The decision agenda (ranked by impact) — these are the real Q&A

### D1 — Interaction-gated content: keep hidden, or reveal-and-include? (Q-C / Q6) — HIGH
Contract **and** code **exclude** accordion / tab-panel / carousel-slide /
collapsed content (kept hidden; only motion/entrance animations are normalized
to visible). My first-principles reasoning argued the opposite: a mobile user
*can* reach that content and it's often genuinely meaningful (FAQ answers, spec
tabs), so reveal-and-include. **This materially changes what gets captured on
tabbed/FAQ/accordion-heavy sites.** Decide the rule; if we change it, it's a real
implementation change (reveal ritual + visibility).

### D2 — Noise-by-convention heuristics: none vs. a heuristic layer? (Q-B) — HIGH
The contract has **no** ad / cookie / social-share / "related"-widget / breadcrumb
heuristics. Noise is handled only by (a) the fixed tag taxonomy, (b) visibility,
(c) consent-hiding, and (d) the user's explicit excludes. My reasoning proposed a
heuristic layer for common noise patterns. Trade-off: heuristics reduce manual
exclusion work but misfire and hurt generalization. Decide whether the fixed
taxonomy + user-excludes is deliberately the whole story.

### D3 — Emitted-payload philosophy: enumerated set vs. corrections-only? (Q-A / Q1) — FOUNDATIONAL
The contract emits BOTH an included set (every visible textual element) AND an
excluded set (defaults + explicit + invisible) as **shallow-boundary XPath
rows**. My reasoning leaned toward transmitting mainly the *corrections* (explicit
includes + exclusions), on the theory that the AI generalizes better from
representative marks than from an exhaustive per-node enumeration. This is the
fulcrum — it defines what "the payload" even is. Likely the contract is right for
the AI's needs, but it deserves an explicit confirmation because everything
composes on it.

### D4 — a11y-hidden text: hit-test model vs. blanket exclude? (Q-G / Q3, Q9) — MEDIUM
The code treats `aria-hidden` / `sr-only` / `visually-hidden` as **ambiguous** and
decides by a **hit-test reality check** (not a blanket exclude). Skip-links and
SR-only text therefore may or may not be captured depending on paint. My
reasoning proposed a simpler "not user-visible → exclude." Confirm the nuanced
model is intended (it is more correct, but subtle).

### D5 — DOM boundaries: shadow DOM & `svg` text (Q-F) — MEDIUM (genuine gaps)
The contract is silent on shadow DOM (XPaths don't cross the boundary) and on
`svg` text (svg isn't in the immutable list; "non-textual implicit nodes
omitted" is ambiguous for svg `<text>`). These are real gaps — decide the
behavior (pierce/descend or document-as-unsupported).

### D6 — Non-visible-but-meaningful signals: `alt` text, etc. (Q9) — LOW/SCOPE
Image `alt` text and similar carry SEO value but aren't visible DOM text. The
current model is "visible content only," so they're out of scope. Confirm that's
intended, or note as a possible separate signal for the downstream systems.

---

## "Confirm intent" details (probably fine as-is; quick yes/no)

- **Positional XPaths, no id/class (Q-H).** `getXPath` emits `/tag[index]` paths
  with no id/class, aligned to the sanitized captured HTML the AI receives. My
  instinct was "prefer id/class for stability," but for this pipeline
  positional-against-the-captured-HTML is arguably *more* correct (the AI
  correlates xpath → that exact HTML; future DOM drift is irrelevant). Confirm.
- **Submission-visibility geometry (Q-E detail).** Contract: submission viewport
  is page-height (below-fold visible) but mobile-width (out-of-width invisible).
  Confirm the submission path applies this, distinct from the live `isVisible`
  viewport-clip.
- **Same-node include+exclude (Q4).** The code makes them mutually exclusive per
  element (adding one removes the other), so the contradiction can't occur.
  Confirm that's the desired guarantee (no tiebreak needed).

---

## How the Q&A will run (the after-phase plan)

1. We walk D1–D6 (+ the confirm-intent details), and for each you pick the rule.
   Where the contract already matches your intent, we lock it; where you want a
   change, we note the contract amendment.
2. The agreed answers become the **single source of truth** — I update
   `MARKING_AND_HIGHLIGHTING_LOGIC.md` (and its mandated companions:
   knowledge.md, plan.md, README.md, tests) so the contract reflects the
   decisions.
3. Only THEN do I review the implementation against the agreed contract and
   **fix / correct / harden** it, with focused regression tests, under the normal
   review-push gate.

Nothing in the implementation is touched before step 2 is agreed. This document
set is the input to step 1.

---

## One-line status

Three-way documentation complete and committed; implementation verified to match
the locked contract (no semantic code bugs found); the open items are design
decisions (D1–D6) where my first-principles reasoning diverges from the contract,
ready for the Q&A.
