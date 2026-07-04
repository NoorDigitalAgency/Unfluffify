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

## RELATED NUANCE RAISED (pending decision) — collapse-clamped-but-present text vs Google indexing

The cramo `cramo-read-more` clamps the `<p>` to `overflow-hidden; height:100px;
is-collapsed`, yet **Google renders/indexes the FULL paragraph** (verbatim in the
page `<meta name="description">`). Under the current visibility rule + D1
(interaction-gated), collapse-clamped overflow text reads as invisible → excluded
unless explicitly included. If the north star is "handle what Google cares
about," this argues the extension should **include collapse-clamped-but-present
text** (a CSS `overflow/height/line-clamp` truncation where the full text is in
the DOM), rather than treat it as hidden. This is a refinement to D1 /
visibility — PENDING the architect's decision (raised, not yet locked).
