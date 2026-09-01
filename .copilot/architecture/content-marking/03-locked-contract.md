# Content Marking Semantics — The LOCKED CONTRACT (as documented)

> **Source.** This is a faithful distillation of the repository's canonical
> locked contract, primarily `MARKING_AND_HIGHLIGHTING_LOGIC.md` (647 lines,
> "source of truth for the marking rules restored from commit `052c164b…`") plus
> the marking/AI-submission bullets in `.copilot/knowledge.md`. It is organized
> to mirror `01-first-principles-should-be.md` section-for-section so the two can
> be compared in the Q&A. Every claim is traceable to the source doc; section
> references like `[MHL §Exclusion Categories]` point into
> `MARKING_AND_HIGHLIGHTING_LOGIC.md`. This documents what the contract SAYS; how
> the code actually behaves is `02-as-implemented.md`.

---

## 0. Contract status and change discipline

- The marking rules are a **locked compatibility contract** anchored to commit
  `052c164b077d459fa7a6e79b306f01144336719c` with a few named safeguards on top
  (`BUTTON` toggleable; `LINK` omitted; stricter geometry/paint guards;
  selector-excluded content gets no dedicated overlay; silent highlighting keeps
  the `immutable`/`content`/`excluded` layers). [MHL §Locked Contract]
- Any change must update `MARKING_AND_HIGHLIGHTING_LOGIC.md`,
  `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and the focused
  regression tests **in the same commit**. [MHL §Locked Contract]
- Implementation split: `content/core` (DOM targeting, sync, overlay render),
  `content/marking-rules` (pure decisions), `content/submission-rules` (AI
  rows), `content/silent-highlight-rules`, `common/constants` (default
  categories), `common/emulation` (mobile sim state used by submission
  visibility). [MHL §top]

---

## 1. Purpose / pipeline (agreement with first-principles)

The contract shares the frame: mark meaningful content, emit XPath rows +
rendered/static HTML, send to the AI for site-wide CSS-selector synthesis. It
adds concrete transport facts: heavy HTML/payloads go via storage/cache keys
(transfer-payload store), not multi-hop runtime messages; the configuration
backend durably owns the saved corpus, while the AI endpoint is stateless. Every
AI run uses the **complete latest backend-loaded multi-page property corpus**
(every saved page under the base URL) and replaces only the current page's saved
occurrence with its live projection. Save is commit-only; its distinct following
Load atomically replaces local configuration with the newest complete backend
shape and preserves no local draft or pre-Load overlay. [MHL §AI Selector
Integration, §knowledge AI Submission Rules]

---

## 2. What is meaningful (the contract's operational definition)

The contract does not define "meaningful" prose-style; it defines it
**operationally** through markability + defaults + visibility:

- **Self-markable = a textual container** that is not consent UI, extension UI,
  or an immutable default. "Direct own text" (text nodes the element itself owns)
  makes an element self-markable; a container with only descendant text yields to
  the descendant. [MHL §Self-Markability]
- So "meaningful content" ≈ **visible, direct-text-bearing elements** that are
  not in the excluded taxonomy — surfaced as the "default/content layer."

---

## 3. The four categories — how the contract expresses them

The contract's vocabulary maps onto the four categories thus:

- **Implicit inclusion** = the **default/content layer**: self-markable textual
  content not otherwise excluded. Rendered as the "default" silent-highlight
  layer; **visible textual markable content submits as INCLUDED rows.** [MHL §AI
  Submission Rows]
- **Implicit exclusion** = **immutable defaults** + **toggleable defaults** (by
  default) + **visually-invisible textual content** (submits as excluded) +
  generated **silent-whitespace** exclusions. [MHL §Exclusion Categories, §AI
  Submission Rows, §Stored Page Entries]
- **Explicit inclusion** = user `Alt`-click; stored in `includeXpaths`, synced as
  an explicit include row; **always submits as included even when hidden or
  nested inside an excluded ancestor.** [MHL §Include Mode, §AI Submission Rows]
- **Explicit exclusion** = user click (nearest markable target) / `Shift`-click
  (broader boundary); stored as `{ xpath, excluded: true, explicit: true }`.
  [MHL §Exclude Mode, §Stored Page Entries]

---

## 4. Default classifier (the contract's exact taxonomy)

### 4.1 Immutable defaults — ALWAYS excluded, cannot be overridden

`IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`, `SCRIPT`, `TEMPLATE`,
`IFRAME`, `VIDEO`. Elements inside an immutable subtree are not markable.
Excluded at submission **by the immutable tag list sent with the payload**, not
by per-page XPath rows (stale immutable rows are suppressed). [MHL §Immutable
Defaults, §AI Submission Rows]

### 4.2 Toggleable defaults — start excluded, user may toggle

`FOOTER`, `FORM`, `LABEL`, `NAV`, `HEADER`, `DIALOG`, `ASIDE`, `BUTTON`.
`BUTTON` is intentionally toggleable; `LINK` intentionally omitted (void).
[MHL §Toggleable Defaults]

### 4.3 The content baseline

Everything self-markable (visible, direct text, not excluded taxonomy) is the
default content layer = implicitly included. Precedence for building an entry:
**(1) defaults → (2) CSS/AI selector influence → (3) current-session explicit
markings.** [MHL §Core Model]

### 4.4 Note vs first-principles

The contract's default exclusion is a **fixed tag/role taxonomy** (8 toggleable +
10 immutable), not the broader heuristic set I proposed (ads, cookie banners,
social widgets, "related" carousels by convention). Those noise categories are
handled instead by: consent-hiding (§7), visibility (invisible → excluded), and
the user's explicit excludes — NOT by name/convention heuristics. **This is a
real divergence to discuss (see report Q-B).**

---

## 5. Baseline philosophy (answers first-principles Q1)

The contract is **Model A (carve-out) with a fixed-taxonomy default**, and the
emitted rows are RICHER than "corrections only":

- The page entry = defaults + selector influence + explicit deltas. [MHL §Core
  Model]
- **Submission emits BOTH directions as rows:** visible textual markable content
  → included rows; every stored excluded row (explicit + generated/default) →
  excluded rows unless explicitly included or under an already-excluded ancestor;
  invisible textual content → excluded rows; explicit includes → included rows
  always. [MHL §AI Submission Rows]
- `submissionXpaths` are **shallow boundary rows**: an exclusion root is
  submitted once and its descendants suppressed (unless a descendant is an
  explicit include). Document roots `/html[1]`, `/html[1]/body[1]` never
  submitted; non-textual implicit nodes omitted. [MHL §AI Submission Rows]

So the answer to Q1 the contract gives: **not** "emit only corrections" (my
lean) — it emits an enumerated included set (visible text) AND an excluded set
(defaults + explicit + invisible), as shallow boundary rows. **Discuss whether
that is still the intent (report Q-A).**

---

## 6. Precedence and conflict resolution (the contract's mechanics)

Rather than a single "nearest-mark-wins" walk, the contract specifies
**row-normalization rules** that keep the stored row set canonical:

- **Explicit exclude added** → remove redundant descendant excludes; remove
  overlapping includes; remove broader explicit-exclude ancestors when the new
  target is more specific; **convert broader generated default-excluded ancestors
  to `excluded:false`** (so a descendant exclusion can live inside an unexcluded
  default boundary); clean hidden include-overrides inside a removed ancestor.
  Toggling the exclude off removes descendant includes that only existed to punch
  through it. [MHL §Explicit Exclude Rules]
- **Explicit include added** → remove descendant excludes and includes under it;
  convert non-toggleable explicit excludes away; toggleable-default rows may
  remain `excluded:false`. **Explicit include boundaries are CLOSED** —
  descendants under an active include are not targetable until the include is
  removed. [MHL §Explicit Include Rules, §Include Mode]
- **Ancestor-exclude + descendant-include** → the descendant include **always
  submits as included even nested inside an excluded ancestor** (the headline
  island case — AGREES with first-principles §6.4). [MHL §AI Submission Rows]
- **Ancestor-include + descendant-exclude** → the include is a closed boundary,
  so a descendant exclude under it is removed on include-add; the hole is punched
  the other way (exclude-then-the-broader-include-normalizes). [MHL §Explicit
  Include Rules]
- **Submission suppression** → descendants under an already-submitted excluded
  ancestor are omitted unless explicit includes. [MHL §AI Submission Rows]

**Divergence vs first-principles:** I modeled a live "nearest marked
ancestor-or-self decides each node." The contract instead **normalizes the row
set at edit time** (pruning redundant/overlapping rows) and then applies
shallow-boundary submission. Same intent in most cases, but the mechanism and
edge outcomes differ — a key Q&A comparison (report Q-D).

---

## 7. Visibility, mobile-first, consent (the contract's rules)

- **Mobile simulation is the submission viewport.** Opening Unfluffify enables
  **mobile simulation by default per fresh tab session**; the **active marking
  editor tab forces mobile simulation ON until marking is disabled**; a
  desktop-preview checkbox (only when the property has AI selectors) can switch
  to desktop and disables marking entry while on. Submission visibility uses the
  **mobile simulation geometry at save time.** [MHL §AI Submission Rows]
  **VERIFIED implemented** (`ensureDefaultMobileDeviceEmulation` forces
  `enabled:true` on activation; the `deviceEmulationToggle` flag only blocks
  DISABLING) — an initial tracer misread was corrected; see `02 §4`. Q-E is
  downgraded from a divergence to a detail (confirm submission-visibility
  page-height/mobile-width treatment).
- **Visibility for submission:** below-fold content **is** considered visible
  (submission viewport treated as page-height); content **outside the mobile
  viewport width or document height is invisible**. Visible textual → included;
  invisible textual → excluded. [MHL §AI Submission Rows]
- **Interaction-gated content stays HIDDEN.** During reveal/freeze, "semantic
  hidden UI such as modals, dialogs, menus, tabs, carousels, accordions, and
  `aria-hidden` content MUST remain hidden." Only **motion/entrance-animation**
  hidden content (low opacity, clip, transform, Webflow `data-w-id`/`data-ix`) is
  normalized to its final visible posture. [MHL §Motion Stability Contract]
  **This DIRECTLY CONTRADICTS my first-principles lean (§7.3 / scenario 8-9,
  where I proposed reveal-and-include for accordions/tabs). Report Q-C.**
- **Consent UI:** hidden before saving, then handled by the ordinary invisibility
  rule (its text becomes an invisible-textual exclusion). No `consentXpaths`
  persisted. [MHL §AI Submission Rows, §Self-Markability]

---

## 8. Capture timing (reveal/freeze) — the contract

- Exactly ONE reveal/freeze ritual per visit; smooth scroll top → walk down →
  lazy-load freeze at 50% of initial height (max ONE expansion) → full page
  freeze at the absolute bottom → return scroll under freeze. [knowledge §Reveal/
  Freeze Contract]
- Editor-role activation runs a **blocking** reveal sweep behind the inspection
  spinner + an `editor_preparing` reconciliation hold before motion pause, so the
  user can't interrupt setup. [MHL §Motion Stability Contract]
- Rendered capture: **sanitized rendered HTML captured after reveal/freeze and
  before highlighting**, using the same extension-node stripping as saved
  snapshots. Static/raw HTML from the background `fetchStaticPageHtml` path.
  [MHL §Motion Stability Contract, §AI Submission Rows]

---

## 9. Rendered vs static + XPath (the contract)

- Stored page entry fields: `xpaths` (ordered `{xpath, excluded, explicit?}`),
  `includeXpaths`, `selectorSuppressedXpaths`, `silentWhitespaceExcludedXpaths`,
  `submissionXpaths`, `renderedHtml`, `rawHtml`. [MHL §Stored Page Entries]
- Config sync merges `includeXpaths`/`selectorSuppressedXpaths` into `xpaths` as
  `{xpath, excluded:false, explicit:true}` and reconstructs them on load. [MHL
  §Stored Page Entries]
- Submission XPath indexes computed **after** marking sync against the **same
  sanitized DOM view as saved `renderedHtml`** — extension UI / automation roots
  / save-stripped nodes don't count as siblings. [MHL §AI Submission Rows]
- `rawHtml` is sent (per the as-implemented tracer) **only when render mode is
  static**; rendered HTML always. [Cross-ref `02-as-implemented`.]

---

## 10. Silent highlighting (the passive preview)

Three overlay layers: `immutable` exclusions, `content`, `excluded` content.
(The old 052c `links` layer is dropped.) Hidden implicit includes are dropped;
hidden explicit includes remain as ghost sources; excluded sources stay
collectable while temporarily hidden (renderability only controls whether a rect
draws). Redraws wait for positions to settle. Silent highlighting overlays never
capture clicks (users interact with accordions directly). [MHL §Silent
Highlighting]

---

## 11. Scenario catalog — the contract's position (mirrors 01 §11)

1. Article `h1` + paragraphs → default content layer (implicit include). ✔ agree
2. Top nav / mega-menu → `NAV`/`HEADER` toggleable default exclude. ✔ agree
3. Footer → `FOOTER` toggleable default exclude. ✔ agree
4. Cookie banner → hidden before save, then invisible-textual exclude. ✔ agree
   (mechanism differs — no "banner heuristic," it's consent-hide + visibility)
5. Sidebar "related" widget → `ASIDE` toggleable default exclude IF it's an
   `aside`; otherwise it is default CONTENT unless the user excludes it.
   ⚠ **divergence:** no widget/"related"-by-convention heuristic (Q-B).
6. Inline ad inside article → NOT auto-excluded by convention; user must
   explicit-exclude it (or it's an `IMG`/`IFRAME` immutable). ⚠ (Q-B)
7. Meaningful blurb inside `footer` → user `Alt`-include; the footer row becomes
   `excluded:false` for that boundary; the blurb submits as included. ✔ agree
   (headline case, both agree)
8. "Read more" accordion body → **stays hidden = excluded** (semantic hidden UI).
   ✗ **contradicts first-principles (I proposed reveal+include). Q-C**
9. Tab panels (inactive) → **stay hidden = excluded.** ✗ contradicts (Q-C)
10. `display:none`-on-mobile block → invisible under mobile sim → excluded.
    ✔ agree (strict mobile-first) — modulo the emulation-active question (Q-E)
11. Lazy-loaded below-fold content → revealed by the ritual, below-fold treated
    as visible → included. ✔ agree
12. Breadcrumbs → default content UNLESS in `NAV`; no breadcrumb-specific rule.
    ⚠ (Q-B / first-principles Q8)
13. Figure captions → default content (visible text) → included. `alt` text →
    not in the visible-text model; not addressed → effectively out of scope.
    ⚠ (first-principles Q9)
14. CTA button → `BUTTON` toggleable default → excluded, user may include. ✔
    agree (matches my proposal for Q10)
15. Newsletter/search/filter forms → `FORM` toggleable default exclude. ✔ agree
16. Duplicate content (visible + hidden) → hidden one is invisible-excluded. ✔
17. Explicit-include in explicit-exclude → island kept (always submits). ✔ agree
18. Explicit-exclude in explicit-include → include is a closed boundary; handled
    by row normalization (exclude-under-include removed on include-add). ~ agree
    with different mechanics (Q-D)
19. Overlapping/duplicate marks → row-normalization prunes redundant rows. ✔
20. "Mark body then carve out" → not the contract's model; the DEFAULT layer
    already IS "everything meaningful," so the user carves with excludes; there's
    no need to mark the body. ~ (baseline is auto, not user-marked; Q-A)
21. Heading + decorative share icon → heading is content; the icon (svg/button/
    img) is immutable/toggleable-excluded within it. ✔ agree
22. Pseudo-element `::before` content → not a node, cannot mark. ✔ agree (gap)
23. Cross-origin iframe → `IFRAME` immutable exclude. ✔ agree
24. Shadow DOM → not addressed by the contract. ⚠ gap (Q-F)
25. `svg` text → `svg` not in the immutable list explicitly (IMG/VIDEO are), but
    non-textual implicit nodes are omitted; svg text handling is unclear.
    ⚠ gap (Q-F)
26. Modal open at capture → `DIALOG` toggleable default / semantic hidden UI kept
    hidden. ✔ agree
27. Skip-to-content link → visually-hidden a11y → the visibility rule (see
    `02`: `sr-only`/`visually-hidden` are AMBIGUOUS, hit-tested). ~ (Q-G)
28. SR-only text → AMBIGUOUS-hidden, decided by hit-test reality check, not a
    blanket exclude. ⚠ **more nuanced than my "exclude" proposal. Q-G**
29. Off-screen carousel slides → semantic hidden UI kept hidden. ✔ agree
30. Sticky header duplicating nav → `HEADER`/`NAV` exclude. ✔ agree
31. Meaningful element sharing a chrome selector → not resolvable in-extension
    (AI-side). ✔ agree (noted, not actionable)

---

## 12. Where the contract ANSWERS the first-principles open questions

- **Q1 (baseline/emitted lists):** Model A carve-out; emits both included
  (visible text + explicit includes) and excluded (defaults + explicit +
  invisible) as shallow boundary rows. (Discuss if still intended — Q-A.)
- **Q3 (opacity/a11y):** `opacity:0` = definitively hidden (excluded);
  `aria-hidden`/`sr-only`/`visually-hidden` = AMBIGUOUS, resolved by hit-test.
- **Q5 (mobile-first):** yes, strict — mobile simulation geometry; out-of-mobile-
  width = invisible = excluded; below-fold still visible. (Modulo Q-E.)
- **Q6 (interaction-gated):** EXCLUDE — semantic hidden UI stays hidden;
  contradicts my lean. (Q-C.)
- **Q7 (consent):** hide-then-invisible-exclude; not captured.
- **Q10 (CTAs):** `BUTTON` toggleable default (exclude + include escape). Agree.
- **Q11 (iframe/shadow):** iframe immutable-excluded; shadow DOM not addressed.

## 13. Where the contract leaves gaps / the open reconciliation items

Carried into the report (`00-report`) as the Q&A agenda:

- **Q-A** — Is the "emit an enumerated included set (all visible text) + excluded
  set" still the intended payload, or should it move toward corrections-only?
- **Q-B** — No noise-by-convention heuristics (ads/cookie/social/related): is the
  fixed 8+10 taxonomy + visibility + consent-hide + user-excludes sufficient, or
  is a heuristic layer wanted?
- **Q-C** — Interaction-gated content (accordions/tabs/carousels): keep the
  contract's "stay hidden = exclude," or move toward reveal-and-include?
- **Q-D** — Precedence: confirm the row-normalization mechanism vs. a
  nearest-mark-wins evaluation; check the nesting edge outcomes match intent.
- **Q-E** — Mobile simulation: VERIFIED forced-on in code (not a divergence);
  remaining detail = confirm the submission-visibility page-height/mobile-width
  geometry matches the contract.
- **Q-F** — Shadow DOM and `svg` text: define behavior (currently gaps).
- **Q-G** — a11y-hidden text (`sr-only`, skip links): the hit-test-reality model
  vs. a blanket exclude — confirm intent.
