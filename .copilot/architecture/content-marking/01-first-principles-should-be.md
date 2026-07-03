# Content Marking Semantics — First-Principles Reasoning (SHOULD-BE)

> **Provenance and discipline.** This document is deliberately written BEFORE
> reading the current implementation or the locked contract, at the architect's
> explicit instruction to "put aside the locked contract and do your own
> reasoning." It is a from-scratch derivation of what the include/exclude logic
> *ought* to be, reasoned from the stated purpose and general knowledge of the
> DOM, rendering, and SEO content extraction — NOT a description of what the code
> or the contract currently do. Those are documented separately (`02-*`, `03-*`)
> and reconciled in the report (`00-report`). Where I am genuinely unsure, the
> question is raised in §12 rather than guessed.

---

## 1. Purpose and pipeline context (the frame everything is derived from)

The extension's job, stated precisely:

> Reliably and accurately mark and extract the XPaths for **implicit and
> explicit inclusions and exclusions** on a page, alongside the **rendered and
> static HTML** of the page, and send them to a custom AI. That AI detects the
> most feasible **CSS selectors across the pages of the website** that isolate
> the **meaningful content**. Downstream (outside this extension) those selectors
> feed keyword extraction and content-improvement systems for **SEO**.

Three consequences fall straight out of this and constrain every rule below:

1. **The target is "mobile-first, meaningful, user-visible content."** That is
   the north star. "Meaningful" = carries the semantic/keyword payload that is
   the reason the page exists. "User-visible" = actually rendered to a human, not
   present only for crawlers or assistive tech or hidden by CSS. "Mobile-first" =
   evaluated as the page renders on a mobile viewport, because that is what
   modern search indexing treats as authoritative.

2. **Marks are examples for GENERALIZATION, not a per-page answer.** The AI turns
   the XPaths from ONE page into CSS selectors meant to hold across MANY pages of
   the site. Therefore a good mark is one whose underlying structure recurs
   site-wide (a component/region with a stable class or structural position), not
   an arbitrary text fragment. This biases the whole system toward marking
   **structural regions/components**, and it means the *quality* of a mark is
   judged partly by how well it generalizes, not only by whether it is correct on
   the sampled page.

3. **The extension is the ground-truth producer, not the analyzer.** Its single
   duty is to emit an accurate, reproducible description of the page:
   `{ inclusions: xpath[], exclusions: xpath[], renderedHtml, staticHtml }`.
   Correctness and reproducibility of that payload are the entire contract; the
   AI does the fuzzy generalization. So the extension must be *conservative and
   deterministic*: it should never silently guess in a way it cannot reproduce.

---

## 2. Definitions

### 2.1 Meaningful content — KEEP

Content a human reader would consider "the point of the page." Concretely, the
recurring positive signals:

- Primary headings (the page's `h1`, section headings) and their body copy.
- Article / blog / editorial body text; paragraphs, meaningful lists.
- Product / service descriptions, specs, prices, and the descriptive prose
  around them.
- Meaningful list/table content (job listings, catalog items, FAQ Q&A pairs).
- Figure captions and descriptive labels that carry information.
- Visible, information-bearing microcopy that is genuinely part of the content
  (e.g., a value proposition sentence in a hero), as opposed to UI chrome.

### 2.2 Non-meaningful content — EXCLUDE

Site scaffolding and noise that is not the page's informational payload:

- **Site chrome:** primary navigation, mega-menus, header bars, footers,
  sidebars, breadcrumbs, pagination, "skip to content" links, in-page search
  boxes.
- **Cross-page boilerplate:** anything that appears identically on (almost) every
  page — by definition it is not *this page's* meaningful content. (This is also
  the strongest generalization signal for an exclusion selector.)
- **Interruptions:** cookie/consent banners, GDPR notices, newsletter/subscribe
  prompts, modals, popups, interstitials, promo bars.
- **Widgets:** ads, social-share buttons, "related/recommended" carousels, "you
  may also like," comment threads, star-rating widgets, share counts.
- **Interactive controls that are not content:** buttons, form inputs, toggles,
  filters — unless their *label text* is itself the meaningful content (see §11
  gray cases).
- **Non-visible / non-content nodes:** `script`, `style`, `noscript`, `template`,
  tracking pixels, hidden inputs, decorative-only elements, icons.

### 2.3 The gray zone (rules must take an explicit position; see §11)

CTAs with keyword-rich labels; breadcrumbs (navigation vs. taxonomy signal);
image `alt` text (meaningful but not visible text); captions; accordion/tab
bodies hidden until interaction; responsive-hidden blocks; visually-hidden
a11y text; legal/disclaimer prose. These are the cases where reasonable people
disagree, so the contract must state the rule; §11 proposes one for each.

---

## 3. The four mark categories

The problem statement names two axes: **implicit vs explicit**, and **inclusion
vs exclusion**. That yields four categories, and the whole model is how they
compose:

| | Inclusion (keep) | Exclusion (drop) |
|---|---|---|
| **Implicit** (rule/default, no user action) | Content the default classifier keeps | Content the default classifier drops |
| **Explicit** (user marks it) | User rescues something the default would drop | User drops something the default would keep |

- **Implicit inclusion** — the meaningful baseline that survives the default
  rules without the user touching it.
- **Implicit exclusion** — chrome/noise/hidden nodes the default rules drop
  automatically.
- **Explicit inclusion** — the user marks a region to KEEP that the defaults
  would otherwise have dropped (a meaningful block that lives inside chrome, or
  is an element type the rules exclude, or was hidden). This is the exact case
  the architect called out: *"explicitly include the meaningful content that
  would be excluded otherwise if not explicitly included."*
- **Explicit exclusion** — the user marks a region to DROP that the defaults
  would otherwise have kept (site-specific boilerplate that looks like content,
  an embedded promo inside the article, etc.).

**Why both explicit directions must exist:** no default classifier is perfect on
an arbitrary site. Explicit marks are the human correction channel in *both*
directions, and — because they generalize — a handful of explicit marks on a
few sampled pages is how the AI learns the site's specific quirks.

---

## 4. Default (implicit) classification rules

The baseline classifier, applied to the rendered mobile DOM. Two families:

### 4.1 Structural exclusions (drop by default)

Drop elements that are, by tag or role or recognizable pattern, site scaffolding:

- Semantic chrome tags/roles: `nav`, `header` (site header), `footer`,
  `aside`, `[role=navigation]`, `[role=banner]`, `[role=contentinfo]`,
  `[role=search]`, `[role=dialog]`/`[role=alertdialog]` (modals).
- Non-content tags: `script`, `style`, `noscript`, `template`, `svg` (unless it
  carries meaningful text — see §11), `iframe` (cross-origin unreachable),
  `form` controls, `button`, `input`, `select`, `textarea`.
- Recognizable noise by convention (weaker, heuristic): cookie/consent
  containers, ad slots, social/share widgets, "related" widgets. These are the
  least reliable defaults and the most likely to need explicit correction.

### 4.2 Visibility exclusions (drop by default)

Drop anything not actually visible to a mobile user at capture time (see §7 for
the precise visibility test): `display:none`, `visibility:hidden`, `hidden`
attribute, `aria-hidden="true"`, zero-area boxes, off-screen positioning
(`text-indent:-9999px`, clip-hidden a11y text), collapsed regions whose content
is not currently rendered.

### 4.3 Inclusion baseline (keep by default)

Everything that is (a) user-visible on mobile, (b) carries text/content, and
(c) is not caught by 4.1/4.2 is KEPT by default. **This is a decision, not a
given** — see §5.1 for the "carve-out vs. mark-in" baseline-philosophy question,
which is the single most important thing to settle.

---

## 5. Explicit override semantics

### 5.1 The baseline-philosophy question (MUST be settled first — see §12 Q1)

There are two coherent models, and the rest of the rules depend on which one is
canonical:

- **Model A — "carve-out" (include-by-default within the content region).** The
  default keeps everything meaningful; explicit EXCLUSIONS carve out the noise
  the defaults missed; explicit INCLUSIONS re-add islands inside excluded
  regions. The extracted payload is "everything visible and meaningful, minus
  the exclusions, plus the explicit-include islands." Inclusions are the rarer,
  corrective mark.

- **Model B — "mark-in" (exclude-by-default; nothing captured unless included).**
  Nothing is meaningful until the user (or a strong rule) marks it IN. Explicit
  INCLUSIONS are the primary act; explicit EXCLUSIONS carve holes inside included
  regions. The payload is "the union of inclusions, minus the exclusions."

My reasoning leans **Model A** for the extraction target but with a **Model-B
flavor for what is TRANSMITTED**: i.e., the page's meaningful body is kept by
default for the user's mental model and the rendered/static HTML capture, but the
XPATH lists that are actually sent should be the *corrections* — the explicit
inclusions and the exclusions — because those are the generalizable signal the AI
needs, and enumerating "every meaningful node" as an inclusion list is neither
stable nor generalizable. This split (what the user sees kept vs. what XPaths are
emitted) is subtle and is the crux of the Q&A. **Flagged as Q1.**

### 5.2 What an explicit inclusion means

"Treat this element and its subtree as meaningful content to extract, overriding
any default exclusion (structural or visibility) that would otherwise drop it."
Use cases: a meaningful SEO paragraph living in the `footer`; content inside a
region the rules mistook for chrome; a component whose tag is default-excluded
but whose text matters.

### 5.3 What an explicit exclusion means

"Treat this element and its subtree as non-meaningful, overriding any default
inclusion that would otherwise keep it." Use cases: an inline ad or promo box
inside the article; a site-specific boilerplate block that looks like content;
duplicate content.

---

## 6. Precedence and conflict resolution (the hard part)

This is where correctness lives. A defensible, fully-specified model:

### 6.1 Subtree inheritance

A mark on element E applies to E and its entire descendant subtree, UNTIL a more
specific descendant mark overrides it. (Marks are regional, not per-node.)

### 6.2 Most-specific (deepest) wins

For any given node N, its effective classification is determined by the NEAREST
ancestor-or-self that carries a mark. A mark on N itself beats a mark on N's
parent; a mark on the parent beats one on the grandparent; and so on.

### 6.3 Explicit beats implicit at the same node

If a node is classified both by a default rule and by an explicit mark AT THE
SAME LEVEL, the explicit mark wins. (Explicit marks are the human correction
channel; they must be able to override defaults or they are useless.)

### 6.4 The nesting cases (spelled out)

- **Ancestor EXCLUDE + descendant INCLUDE** → the descendant subtree is KEPT (an
  island of content inside an excluded region). Everything else under the
  ancestor stays dropped. *(This is the headline use case from the problem
  statement.)*
- **Ancestor INCLUDE + descendant EXCLUDE** → the descendant subtree is DROPPED
  (a hole punched in an included region — e.g., an ad inside the article).
- **Alternating nesting** (include > exclude > include) → resolved by §6.2:
  each node takes the nearest marked ancestor-or-self. Arbitrary depth is
  well-defined by the "nearest mark wins" rule.

### 6.5 Same-node conflict

An explicit include AND an explicit exclude on the *exact same element* is a
contradiction. Proposal: the UI must prevent it (toggling one clears the other);
if it ever occurs in data, define a deterministic tiebreak (proposal:
**exclusion wins**, because dropping is the safe/conservative default — see §12
Q4).

### 6.6 Precedence summary (one sentence)

> For each node, walk from the node up to the root; the first mark encountered
> decides its fate; an explicit mark outranks a default rule at the same node;
> absent any mark, the default classifier (§4) decides.

---

## 7. Visibility and mobile-first rules

### 7.1 The visibility test (what "user-visible" means)

An element is visible iff, in the rendered mobile DOM at capture time:
`display` ≠ none on it and every ancestor; `visibility` ≠ hidden/collapse;
`opacity` > 0 (borderline — see Q3); it has non-zero layout area; it is not
`aria-hidden`, not `hidden`, not positioned off-screen via the common a11y
clip/indent idioms. Content reachable only by scrolling counts as visible
(after reveal, §8).

### 7.2 Mobile-first

The page must be evaluated at a mobile viewport so that responsive CSS resolves
to the mobile layout. Consequences to decide (Q5): a block that is
`display:none` at the mobile breakpoint but visible on desktop — is it excluded
(strict mobile-first) or kept (superset)? Strict mobile-first says exclude;
practicality may argue keep. Default proposal: **strict mobile-first — if it is
not visible on mobile, it is not captured** — because that matches the indexing
model the SEO purpose targets.

### 7.3 Interaction-gated content (accordions, tabs, "read more", carousels)

Meaningful content that is present in the DOM but hidden until the user
interacts. Options: (a) exclude (not currently visible); (b) reveal-then-include
(it IS meaningful and a user CAN see it). Default proposal: **include if the
content is present in the DOM after the reveal ritual and is meaningful, even if
a specific tab/panel is not the active one** — because the content is genuinely
part of the page's payload and a mobile user can reach it. This needs the
architect's call (Q6); it materially changes what gets captured on tabbed/FAQ
pages.

---

## 8. Dynamic content and capture timing

- **Lazy-load / reveal:** the page must be driven to load its deferred content
  (scroll to bottom, allow one expansion, settle) BEFORE capture, or below-the-
  fold meaningful content is absent from the DOM. (This is the reveal/freeze
  concern; the marking layer depends on it having run.)
- **Freeze point:** marks and HTML must be captured against a single, stable DOM
  snapshot. If the DOM mutates between marking and capture, XPaths can dangle.
  Capture must be atomic w.r.t. a frozen DOM.
- **Consent-gated content:** content that only appears after accepting cookies —
  the capture should reflect the state a normal user reaches. Decision (Q7):
  capture pre- or post-consent? Proposal: post-consent (that is the real page).

---

## 9. Rendered vs static HTML and XPath extraction

### 9.1 Why both HTMLs are sent

- **Rendered HTML** = the post-JavaScript DOM — what the user actually sees and
  what the marks/XPaths are computed against.
- **Static HTML** = the raw server-delivered markup — needed so the AI can
  derive selectors that are stable against the *served* document, which matters
  for static-render-mode sites and for selectors that must survive without JS.
- The site's **render mode** (static vs JS-rendered — the extension already
  determines this) tells the AI which HTML is authoritative for selector
  synthesis.

### 9.2 XPath requirements

- Each mark → a **deterministic, reproducible** XPath locating exactly that node
  in the rendered DOM.
- XPaths should be as **structural/stable** as possible (prefer id/class/tag
  positional paths that survive minor DOM changes) so they correlate to the
  static HTML and generalize.
- The rendered→static correlation is the AI's job, but the extension must emit
  XPaths that are valid against the captured rendered HTML it also sends, so the
  AI has a consistent pair.
- **Boundaries that break XPath** must be documented as gaps: shadow DOM
  (XPaths don't cross the boundary), cross-origin iframes (unreachable),
  pseudo-elements (`::before/::after` — not nodes, cannot be marked).

### 9.3 What the emitted lists contain (ties back to Q1)

The exact contents of `inclusionSelectors` and `exclusionSelectors` depend on
the baseline philosophy (§5.1). Under Model A, exclusions carry the bulk of the
signal and inclusions are the rescues. Under Model B, inclusions carry the bulk.
This must be settled because it determines what "correct extraction" even means.

---

## 10. The generalizability principle (a constraint on GOOD marks)

Because the AI generalizes marks into site-wide CSS selectors:

- Prefer marking a **whole component/region** (stable class, semantic container)
  over an arbitrary inner text span — the former yields a generalizable selector.
- The best exclusions are **cross-page-constant chrome** (nav/footer/cookie) —
  they generalize almost perfectly.
- The best inclusions are **the main content region(s)** — "the article body,"
  "the product description," which recur structurally across the site's pages of
  the same type.
- A mark that is correct on the sampled page but structurally unique (no
  recurring selector) is low-value and possibly misleading to the AI. The
  extension can't know this, but the *guidance to the user* and the *default
  granularity of marks* should bias toward component-level selection.

---

## 11. Scenario catalog (concrete cases with the proposed SHOULD-BE outcome)

Each row: the situation → the proposed correct handling. Cases marked ⚠ are
genuine judgment calls surfaced in §12.

1. **Article `h1` + paragraphs** → implicit include.
2. **Primary top nav / mega-menu** → implicit exclude (structural).
3. **Footer (copyright, link columns)** → implicit exclude (structural).
4. **Cookie/consent banner** → implicit exclude (interruption); capture the
   post-consent page (§8).
5. **Sidebar "related articles" widget** → implicit exclude (widget/boilerplate).
6. **Inline ad or promo box inside the article** → the article is included; the
   ad is a descendant EXCLUDE (explicit, or rule if recognizable) → §6.4 hole.
7. **Meaningful SEO blurb inside the `footer`** → default excludes the footer;
   user EXPLICIT-INCLUDES the blurb → §6.4 island. *(Headline use case.)*
8. ⚠ **"Read more" accordion; collapsed body is meaningful** → proposal:
   reveal + include (Q6).
9. ⚠ **Tabbed content; only active tab visible** → proposal: include all
   meaningful tab panels present in the DOM after reveal (Q6).
10. ⚠ **Block `display:none` on mobile, visible on desktop** → proposal: exclude
    (strict mobile-first, Q5).
11. **Content lazy-loaded below the fold** → reveal (§8) then implicit include.
12. ⚠ **Breadcrumbs** → proposal: exclude (navigation); user can explicit-include
    if the taxonomy text is wanted (Q8).
13. ⚠ **Figure captions** → include (meaningful). **Image `alt` text** → not
    visible DOM text; proposal: out of scope for visible-text extraction, note
    as a possible separate signal (Q9).
14. ⚠ **CTA button with keyword-rich label ("Book a free consultation")** →
    proposal: exclude by default (interactive chrome), user can explicit-include
    if the label is genuinely a content keyword (Q10).
15. **Newsletter / search / filter forms** → implicit exclude (controls).
16. **Duplicate content (visible block + hidden dup)** → keep the visible one;
    the hidden one is excluded by visibility (§7).
17. **Explicit-include nested in explicit-exclude** → island kept (§6.4).
18. **Explicit-exclude nested in explicit-include** → hole dropped (§6.4).
19. **Same element marked twice / overlapping marks** → dedupe; nearest-mark and
    explicit-wins resolve it (§6.2, §6.5).
20. **"Mark the whole body, then carve out chrome" workflow** → supported under
    Model A (§5.1); include `body`/main, then targeted excludes.
21. **Heading containing a decorative share icon** → include the heading text;
    the icon (svg/button) is default-excluded within it.
22. **Pseudo-element content (`::before`)** → cannot mark (not a node); document
    as a gap.
23. ⚠ **Cross-origin iframe (embedded video/widget)** → unreachable; exclude and
    document. Same-origin iframe → possibly reachable (Q11).
24. **Shadow DOM content** → XPaths don't cross the boundary; document as a gap /
    decide whether to pierce (Q11).
25. ⚠ **Meaningful text inside `svg`** → proposal: exclude by default, explicit-
    include allowed; note XPath-into-SVG caveat (Q9).
26. **Modal/popup open at capture** → exclude (interruption) unless it IS the
    page's main content.
27. **"Skip to content" link (visually hidden a11y)** → exclude (not visible,
    a11y chrome).
28. ⚠ **Visually-hidden screen-reader-only text** → not user-visible but IS
    meaningful for indexing; proposal: exclude (we target *visible* content), flag
    (Q3/Q9).
29. **Off-screen carousel slides** → hidden slides excluded by visibility; the
    active/revealed slide included (ties to Q6).
30. **Sticky header duplicating the nav** → exclude.
31. ⚠ **Meaningful element whose only stable selector is shared with chrome** →
    the extension marks it correctly; note the AI-side generalization tension
    (nothing the extension can resolve, but worth recording).

---

## 12. Open questions (the decisions the architect must make in the Q&A)

- **Q1 — Baseline philosophy (§5.1).** Model A (carve-out) or Model B (mark-in)?
  And separately: what do the emitted `inclusion`/`exclusion` XPath lists
  actually contain — the corrections only, or an enumeration of the meaningful
  set? This is the single most load-bearing decision; every other rule composes
  on top of it.
- **Q2 — Granularity.** Do marks attach to whole components/regions (favoring
  generalization) or can they be arbitrary sub-spans? Is there guidance/UI that
  nudges toward component-level marks?
- **Q3 — `opacity:0` and visually-hidden a11y text.** Visible or not? (Affects
  §7.1 and scenario 28.)
- **Q4 — Same-node include+exclude tiebreak.** Prevent in UI (preferred) and, as
  a data-safety net, which wins? (Proposal: exclude.)
- **Q5 — Strict mobile-first.** Exclude desktop-only content, or keep a superset?
  (Scenario 10.)
- **Q6 — Interaction-gated content** (accordions/tabs/read-more/carousels):
  reveal-and-include, or exclude-because-hidden? (Scenarios 8, 9, 29.)
- **Q7 — Consent state at capture.** Pre- or post-consent DOM? (Proposal: post.)
- **Q8 — Breadcrumbs:** exclude as navigation, or keep as taxonomy signal?
- **Q9 — Non-visible-but-meaningful signals** (`alt` text, SVG text, SR-only
  text): in or out of scope for this "visible content" extraction?
- **Q10 — Interactive labels (CTAs):** default exclude with explicit-include
  escape hatch, or default include?
- **Q11 — DOM boundaries:** shadow DOM (pierce or not?) and same-origin iframes
  (descend or not?).
- **Q12 — Precedence confirmation.** Is the §6 model (nearest-mark-wins,
  explicit-beats-implicit, both nesting directions) the intended one, end to
  end?

---

## 13. Summary of the proposed model (one paragraph)

Evaluate the page at a mobile viewport, after the reveal ritual has loaded
deferred content, against a single frozen DOM. A default classifier keeps
user-visible meaningful content and drops structural chrome, interruptions,
widgets, controls, and non-visible nodes. The user corrects the defaults in both
directions with explicit inclusions (rescue meaningful content the defaults
dropped — the footer-blurb case) and explicit exclusions (drop non-meaningful
content the defaults kept — the inline-ad case). Every node's fate is decided by
the nearest marked ancestor-or-self, explicit outranking implicit, with both
nesting directions well-defined. The result is emitted as reproducible XPaths
for inclusions and exclusions plus the rendered and static HTML, biased toward
component-level marks that generalize into site-wide CSS selectors. The single
unresolved fulcrum is Q1 (baseline philosophy + what the emitted lists contain);
everything else is a bounded judgment call listed in §12.
