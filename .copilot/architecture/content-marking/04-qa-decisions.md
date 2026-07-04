# Content Marking Semantics — Q&A Decisions (single source of truth, in progress)

> Live record of the architect's decisions from the reconciliation Q&A (see
> `00-report.md` for the agenda). Once complete, these fold into
> `MARKING_AND_HIGHLIGHTING_LOGIC.md` (+ knowledge.md, plan.md, README.md,
> tests), THEN the implementation is reviewed/hardened against them. Decisions
> are appended as they are locked.

---

## D1 — Interaction-gated / hidden content — LOCKED

**Decision:** Do NOT auto-reveal-and-include hidden content. Auto-including
content whose meaningfulness is uncertain (and which may be invisible-from-user
and require real copy-work) is the risk to avoid. Interaction-gated / hidden
content (accordion bodies, inactive tab panels, "read more", carousel slides,
modals) stays **excluded by default**.

The user captures the meaningful hidden bits manually:
- The marking UI is the **sole interaction** (page clicks are locked by the
  overlay) — this stays.
- The user may **temporarily bypass that lock** (the `Space` page-interaction
  passthrough) to expand an accordion / open a tab / reveal content.
- The user then marks the revealed content as an **explicit include that
  overrides the hidden state**.

This is (already) the contract's model: `MHL §Page Interaction Mode` (Space
passthrough "for opening accordions, tabs, menus… before returning to marking or
explicit include work") + "explicit includes always submit as included even when
hidden or nested inside excluded ancestors."

**Contract status:** CONFIRMED (no rule change) — the default and the mechanism
already exist.

**Harden / verify items for the after-phase (implementation review):**
1. After a `Space`-passthrough expand, the newly-revealed element must be
   markable and eligible for explicit include (not blocked by a stale
   visibility/geometry cache from before the expand).
2. An explicit include placed on revealed content must persist and be present in
   the saved `renderedHtml` — i.e., if the region is left expanded at save time
   its content is captured; confirm the reveal/freeze **motion pause does not
   re-collapse or fight** a user-driven expand.
3. Confirm the `Space` bypass is discoverable/usable enough for this to be the
   real path (it is the only way to reach hidden content now).
4. Confirm explicit-include-on-hidden renders as a ghost include and submits as
   included even though it was hidden at freeze time (contract says yes — verify
   in code).

---

## D2 — Noise-by-convention heuristics — LOCKED

**Decision:** Stay **heuristic-free**. No auto-exclusion of ads / social-share /
"related" widgets / breadcrumbs by class/role/name convention. Symmetric with
D1: the tool never auto-DECIDES an uncertain case in either direction — it never
auto-includes uncertain content (D1) and never auto-DROPS content it isn't sure
about (D2). A false auto-exclusion would silently lose real content, the worst
failure for an SEO extractor. Noise is handled only by: the fixed tag taxonomy
(immutable + toggleable), the visibility test, consent-hiding, and the user's
**explicit excludes** (which generalize per-site anyway).

**Contract status:** CONFIRMED (no rule change) — the contract is already
heuristic-free.

**Note (breadcrumbs, first-principles Q8):** consequently breadcrumbs are
default CONTENT unless they live inside a `NAV` (then toggleable-excluded); no
breadcrumb-specific rule. The user explicitly excludes them if unwanted.

---

## D3 — Emitted-payload philosophy — LOCKED

**Decision:** Keep the **enumerated** payload: the full set of visible textual
elements as INCLUDED rows + the exclusions as shallow-boundary rows (defaults +
explicit + invisible), as today. The custom AI is built to receive explicit
positive AND negative ground truth; do not switch to a leaner corrections-only
payload. (The architect owns the AI and confirms it expects the enumerated set.)

**Contract status:** CONFIRMED (no rule change) — `MHL §AI Submission Rows`
already specifies enumerated included + shallow-boundary excluded rows.

**Implication:** "meaningful content" the extension emits = every visible,
direct-text-bearing, non-excluded element (the default content layer) as included
rows, plus explicit includes; exclusions are the immutable/toggleable defaults,
explicit excludes, invisible-textual, and silent-whitespace rows, submitted as
shallow boundaries with descendants suppressed unless explicitly included.

---

## D4 — Accessibility-hidden text — LOCKED

**Decision:** Keep the **hit-test reality-check** model. `aria-hidden`,
`sr-only`, `visually-hidden` are AMBIGUOUS and resolved by whether the element is
actually in the paint path (`isActuallyVisibleToUser`), NOT a blanket exclude. A
"visually-hidden"-classed element that is actually shown counts; a real SR-only
skip-link does not. Matches the "visible to the user" north star precisely.

**Contract status:** CONFIRMED (no rule change) — matches `02 §3`.

---

## D5 — DOM boundaries (shadow DOM + svg) — TWO DECISIONS, ONE IS A CONTRACT CHANGE

### D5a — Shadow DOM — **SUPPORT (CONTRACT CHANGE + implementation work)**

**Decision:** Shadow-DOM content MUST be supported — target sites use shadow
roots, and the **consumer side already extracts deep content**; the extension
must **replicate that same deep-content capture** so the `renderedHtml` sent to
the AI contains the shadow content (currently `createSanitizedPageSnapshot`
uses `cloneNode(true)`, which does NOT cross shadow boundaries → shadow content
is missing from the payload today).

**Canonical technique to replicate** (from the consumer's
`Hublet.Api.Extensions.PlaywrightExtensions.ContentDeepAsync`, full source
pasted into the Q&A transcript). Key mechanics:
- `getAllShadowRoots(document)` — walk every element, collect `el.shadowRoot`
  recursively.
- `document.documentElement.getHTML({ shadowRoots: getAllShadowRoots(document) })`
  — serialize WITH declarative shadow DOM as `<template shadowrootmode="…">`.
- `flattenShadowTemplates(html)` — unwrap those `<template shadowrootmode>`
  blocks (balanced-tag scan) so shadow content is inlined into the final HTML.
- Result: `<!doctype html>\n<html{attrs}>\n{flattened inner}\n</html>`.

**After-phase implementation scope (coordinated — flag for the review phase):**
1. Rendered-HTML capture (`createSanitizedPageSnapshot`, `core.ts:4275`) must
   produce the deep/flattened-shadow HTML (replicate ContentDeepAsync) while
   keeping the existing extension-node stripping and `data-uf-*` removal.
2. **XPath alignment:** submission XPaths must locate nodes in the SAME flattened
   view the AI receives. If capture inlines shadow content via
   `<template shadowrootmode>`, the XPath scheme + `getSnapshotXPath` sibling
   counting must be consistent with that flattened representation (open design
   question: XPath-through-shadow vs. XPath-into-flattened-template).
3. **Marking target resolution:** whether the user can MARK inside shadow content
   (target resolution, geometry, overlay) or whether shadow support is
   CAPTURE-ONLY for now (AI still sees it, user marks only light-DOM) — needs a
   follow-up decision. Capture-only is the smaller first step; full in-shadow
   marking is the larger lift.

**Contract status:** CHANGE REQUIRED — `MARKING_AND_HIGHLIGHTING_LOGIC.md` must
add a shadow-DOM deep-capture rule; today it is silent (a gap). This is the one
substantive new implementation item from the Q&A so far.

### D5b — svg — **CONTRACT CHANGE (small)**

**Decision:** Add `SVG` to the **immutable default exclusions**
(`DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS`, joining IMG/INPUT/NOSCRIPT/SELECT/TITLE/
STYLE/SCRIPT/TEMPLATE/IFRAME/VIDEO). Resolves the svg-`<text>` ambiguity: svg is
never a marking target and never markable content.

**Contract status:** CHANGE REQUIRED — update the immutable list in
`MARKING_AND_HIGHLIGHTING_LOGIC.md`, `common/constants.ts`, and tests.

---

## D6 — Non-visible-but-meaningful signals (alt text etc.) — LOCKED

**Decision:** Keep **out of scope**. The extension extracts VISIBLE meaningful
content; image `alt` text and similar non-visible attributes are left to the
downstream systems. Keeps the extension's duty crisp and matches "visible to the
user."

**Contract status:** CONFIRMED (no rule change).

---

## C1 — XPath format — CONFIRMED

Keep **purely positional** XPaths (`/tag[index]/…`, no id/class), aligned to the
sanitized HTML that is sent. Correct for this pipeline (the AI maps xpath →
captured HTML, never re-runs against a live DOM). **Constraint:** the D5a
shadow-DOM deep-capture MUST preserve xpath↔captured-HTML alignment in the
flattened view. No rule change.

## C2 — Submission visibility geometry — CONFIRMED (verify in code)

At save time, visibility uses **page-HEIGHT** viewport (below-fold content is
visible → included) but **mobile-WIDTH** (content outside the mobile viewport
width is invisible → excluded). Matches mobile-first + `MHL §AI Submission Rows`.
After-phase: verify the submission path applies exactly this (distinct from the
live `isVisible` viewport-clip).

## C3 — Same-node include+exclude — CONFIRMED

Explicit include and exclude stay **mutually exclusive per element** (applying
one clears the other); no contradictory state, no tiebreak rule needed. No rule
change (`02 §5.2`).

---

## OUTCOME SUMMARY

The locked contract is **confirmed almost entirely.** Two substantive changes and
a set of verify/harden items came out of the Q&A:

| # | Decision | Result |
|---|---|---|
| D1 | Interaction-gated content | CONFIRMED (no auto-include; Space-expand + explicit-include) — harden the expand-then-mark path |
| D2 | Noise heuristics | CONFIRMED heuristic-free |
| D3 | Payload philosophy | CONFIRMED enumerated included + shallow-boundary excluded |
| D4 | a11y-hidden text | CONFIRMED hit-test model |
| **D5a** | **Shadow DOM** | **CHANGE — deep-capture (replicate ContentDeepAsync); contract gap → new rule** |
| **D5b** | **svg** | **CHANGE — add `SVG` to immutable exclusions** |
| D6 | alt text / non-visible signals | CONFIRMED out of scope |
| C1 | XPath format | CONFIRMED positional (align shadow flattened view) |
| C2 | Submission geometry | CONFIRMED page-height/mobile-width (verify in code) |
| C3 | Same-node marks | CONFIRMED mutually exclusive |

## AFTER-PHASE PLAN (implementation review + fix/harden)

Executed only after this record is agreed; each lands with the contract-change
discipline (`MARKING_AND_HIGHLIGHTING_LOGIC.md` + knowledge.md + plan.md +
README.md + focused tests in the same commit) under the review-push gate:

1. **D5a shadow DOM (largest):** replicate the consumer's `ContentDeepAsync`
   deep-capture in `createSanitizedPageSnapshot`; keep extension-node stripping;
   align the submission-XPath scheme to the flattened `<template shadowrootmode>`
   view; then decide+implement capture-only vs full in-shadow marking (I'll bring
   a concrete recommendation once I've read the capture + XPath code).
2. **D5b svg:** add `SVG` to `DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS` + contract +
   tests.
3. **D1 harden:** verify Space-passthrough expand → revealed element markable →
   explicit-include persists and is present in saved `renderedHtml`; motion pause
   must not re-collapse a user-driven expand.
4. **C2 verify:** confirm submission visibility applies page-height/mobile-width
   at save.
5. Everything else (D2/D3/D4/D6/C1/C3): confirmed as-is — regression-guard only,
   no behavior change.

This document (`04-qa-decisions.md`) is the agreed single source of truth for the
after-phase; `MARKING_AND_HIGHLIGHTING_LOGIC.md` is updated to match as each item
is implemented (so the contract never claims behavior the code lacks).

