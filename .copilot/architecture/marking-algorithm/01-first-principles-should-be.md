# Marking Algorithm — First-Principles Reasoning (SHOULD-BE)

> **Provenance and discipline.** Written as an independent, from-scratch
> derivation of the *mechanical, deterministic marking interaction* — the state
> machine, eligibility predicates, XPath determinism, and render model — BEFORE
> re-opening the marking contract or the code for this task, per the architect's
> instruction to reason first. Honest caveat: during the immediately-prior
> *content-marking semantics* reconciliation I was exposed to some of the
> contract's target-resolution vocabulary (`MHL §Target Resolution/Exclude/Include
> Mode`) and the code's `getMarkableTarget`/`toggleExplicit*`/render-layer names,
> so total isolation isn't possible. I have nonetheless re-derived the four areas
> as a machine-state formulation from the GOAL rather than transcribing either
> source; `02-as-implemented.md` and `03-contract.md` document those, and
> `00-report.md` reconciles. Where I'm unsure, it's a question in §6, not a guess.

This document is built around the four areas the architect named:
1. Exclusion eligibility + the sequence it dictates to the interaction/marking UI.
2. Inclusion (implicit + explicit) eligibility + the sequence it dictates.
3. Mechanical, deterministic XPath extraction + state.
4. Lightweight, deterministic, mechanical rendering/repaint.

---

## 0. Foundations the four areas share

### 0.1 The payload target (locked in `content-marking/04-qa-decisions.md`)

The algorithm must produce, deterministically: **elaborate (enumerated) implicit
inclusions**, **shallow exclusion roots**, **immutable exclusions** (by tag
list), and **explicit inclusions** (which override exclusion/hidden). Every
mechanical rule below serves that output.

### 0.2 The reflex-arc principle applied to marking

Marking is a **mechanical layer**: the visible marking state at any instant is a
**pure projection** of three inputs — (a) the frozen DOM snapshot, (b) the stored
mark rows (`xpaths`/`includeXpaths`), (c) the transient interaction state
(hovered target, held modifier). Same inputs → same overlay, always. No hidden
timers or heuristics decide a mark. The interaction is a finite state machine;
level/DOM churn between events cannot move it.

### 0.3 Core eligibility predicates (pure functions, reused by all areas)

Define once, use everywhere. Each is a deterministic predicate over an element +
the frozen DOM:

- **`isRenderedVisible(el)`** — the visibility test (semantics D4): not
  `display:none`/`visibility:hidden`/`opacity:0`/`hidden`/zero-area/overflow-
  clipped on it or any ancestor; a11y-hidden (`aria-hidden`/`sr-only`) is
  resolved by hit-test reality.
- **`isImmutable(el)`** — tag ∈ immutable set (IMG/INPUT/NOSCRIPT/SELECT/TITLE/
  STYLE/SCRIPT/TEMPLATE/IFRAME/VIDEO/**SVG** per D5b), or inside such a subtree.
  Immutable elements are never markable.
- **`isChrome(el)`** — extension UI (`[id^="unfluffify-"]`, `[data-uf-…]`),
  consent UI, document roots. Never markable.
- **`ownsDirectText(el)`** — the element has non-whitespace text node children it
  owns directly (not only via descendants).
- **`isSelfMarkable(el)`** — `isRenderedVisible ∧ ¬isImmutable ∧ ¬isChrome ∧
  (ownsDirectText ∨ isStructuralBoundary)`, where a *structural boundary* is a
  cohesive region (section/article/card-group/list/table/toggleable-default) with
  no visible textual descendant and no explicitly-marked descendant (so a
  container yields to its text-bearing descendant unless it is itself the
  meaningful unit).
- **`isToggleableDefault(el)`** — tag ∈ {FOOTER, FORM, LABEL, NAV, HEADER, DIALOG,
  ASIDE, BUTTON}. Excluded by default, user-overridable.

These predicates are the entire "eligibility" vocabulary; areas 1 and 2 are just
different compositions of them plus the interaction FSM.

---

## 1. AREA 1 — Exclusion: eligibility + interaction sequence

### 1.1 What is eligible for an EXCLUSION mark

An element may receive an explicit exclusion iff it is a **resolved self-markable
target** for the pointer (see 1.3). Additional mechanical rules:

- **Immutable / chrome are never eligible** (they're excluded by construction;
  marking them is meaningless).
- **Already-explicitly-excluded ancestors do not block a deeper target.** If the
  user clicks inside an already-excluded region, resolution DRILLS to the nearest
  self-markable descendant so the user can refine (exclude a sub-part more
  precisely). The broad ancestor is not re-selected.
- **Toggleable-default boundaries do not steal descendant clicks.** Clicking a
  markable descendant inside a default-excluded `footer`/`nav`/`form`/… records
  the descendant as the explicit exclusion AND records the boundary as
  `excluded:false` (the boundary is "unmarked" so the descendant exclusion lives
  inside an un-excluded boundary). Clicking the boundary itself (no descendant
  wins resolution) toggles that boundary directly.

### 1.2 What is eligible for UN-marking an exclusion

- Clicking an element that currently holds an explicit exclude **toggles it off**
  (removes the row; a toggleable-default row flips back to its generated posture).
- Un-excluding must also **remove descendant include-overrides that only existed
  to punch through that exclude** (they're now meaningless).

### 1.3 The interaction sequence (the FSM in exclude mode)

State `IDLE_EXCLUDE` (marking enabled, no Alt, no Space):
1. **pointermove** → resolve the exclude candidate: from `elementsFromPoint`,
   skip chrome/immutable/consent, take the **nearest self-markable** target
   (drilling past already-excluded ancestors). If `Shift` held → broaden to the
   nearest *structured group / toggleable / broadest-markable* ancestor, rejecting
   shallow page shells (body-level wrappers with broad footprint or multiple
   landmarks). Draw the **hover rect** on the resolved candidate — this is the
   "what will be marked" feedback and it is the ONLY thing pointermove changes
   (no collection recompute).
2. **click** → commit an exclude toggle on the resolved target: write/flip the
   row, run **row normalization** (1.4), then repaint only the affected layers.
3. **modifier change** (Shift down/up) → re-resolve the candidate for the new
   breadth; redraw the hover rect; update cursor.

### 1.4 Row normalization on exclude commit (deterministic cleanup)

When an exclude is added on target T (xpath X):
- remove any explicit-exclude rows for **descendants** of X (X subsumes them);
- remove any explicit-include rows for descendants of X (the exclude wins over
  them within its subtree — but see area 2 for the closed-include interaction);
- if a **broader explicit-exclude ancestor** exists and T is a more specific
  descendant, remove the ancestor (the user is refining downward);
- convert a **broader generated toggleable-default-excluded ancestor** to
  `excluded:false` (so the specific descendant exclusion lives inside an
  un-excluded boundary — the drill case).

This keeps the stored set canonical and the "shallow exclusion roots" property
(area 3) true by construction.

---

## 2. AREA 2 — Inclusion (implicit + explicit): eligibility + interaction sequence

> Interpretation note (flag for Q&A, §6 Q-α): the architect wrote "implicit
> inclusion marking/unmarking." Implicit inclusion is *automatic* (you don't
> click to create it). I read area 2 as the whole INCLUSION side: (a)
> implicit-inclusion eligibility — what auto-enters the default content set; and
> (b) the explicit-include action — how the user forces inclusion of something
> that would otherwise be excluded, and how it/unmark composes.

### 2.1 Implicit inclusion — eligibility (automatic, no click)

An element is **implicitly included** (enters the enumerated content layer, gets
a content rect, submits as an included row) iff:

`isSelfMarkable(el) ∧ ¬(el or an ancestor is in any exclusion set: immutable,
toggleable-default-excluded, explicit-exclude, invisible-textual,
silent-whitespace) ∧ ¬(a more specific self-markable descendant owns the text)`.

It **leaves** the implicit-included set (is "unmarked" implicitly) automatically
when: it becomes not-visible, an ancestor gets excluded, or the user explicitly
excludes it. No user action creates an implicit inclusion; user action only
*removes* one (by exclude) or *rescues* an excluded one (by explicit include).

### 2.2 Explicit inclusion — eligibility

`Alt` = include mode. An element is eligible for an **explicit include** iff it
is markable AND it **would otherwise be excluded**:
- inside a toggleable-default boundary, or
- hidden (so the user can rescue meaningful hidden content — the D1
  expand-then-mark case: `Space` to expand, `Alt`-click to include), or
- under an explicit-excluded ancestor (island inside excluded region).

An element that is **already visible default content** is NOT explicit-include-
eligible (it's already included; a redundant include adds noise). Explicit
include **always submits as included even when hidden or nested in an excluded
ancestor** (payload contract).

### 2.3 Include-mode target resolution + closed boundaries

In `IDLE_INCLUDE` (Alt held): resolution may **inspect descendants inside
excluded parents** (unlike exclude, which drills for refinement, include reaches
in to rescue), **prefers explicit targets first**, and allows **mixed
direct-text ancestor promotion** (an eligible textual ancestor can be included
instead of only the deepest child). Once an explicit include exists on E, E is a
**CLOSED boundary**: descendants under it are not targetable until the include is
removed (the whole subtree is "in," so there's nothing to refine).

### 2.4 Un-marking an inclusion

- Clicking an explicit-included element (in include mode) **toggles it off**
  (removes from `includeXpaths`).
- Adding an explicit include on E **removes** explicit excludes and includes that
  are descendants of E (E subsumes them) and converts non-toggleable explicit
  excludes away; a toggleable-default row may remain `excluded:false`.

### 2.5 The interaction sequence (FSM in include mode)

1. **pointermove (Alt held)** → resolve include candidate per 2.3; draw hover rect
   (include cursor).
2. **click** → commit include toggle; run include row-normalization (2.4);
   repaint affected layers.
3. **Alt release** → fall back to `IDLE_EXCLUDE`; re-resolve candidate; update
   cursor.

---

## 3. AREA 3 — Mechanical, deterministic XPath extraction + state

### 3.1 The XPath function (deterministic, positional)

`xpath(el)`: walk `el → documentElement`, at each level emit `tag[k]` where `k`
counts the element's same-tag preceding siblings + 1; join with `/`, prefix `/`.
Purely positional, no id/class (locked C1). **Deterministic:** same element in
the same DOM → identical string, no randomness, no time dependence.

### 3.2 Snapshot alignment (the one subtlety that makes it correct)

XPaths are emitted against the **same sanitized DOM view as the saved
`renderedHtml`**: when counting sibling indices, **skip nodes stripped at save
time** (extension UI, automation roots, consent). This guarantees each emitted
XPath resolves to exactly the node the AI sees in the HTML we send (locked C1).
For shadow DOM (D5a), the sanitized view is the **flattened deep-capture**
(`<template shadowrootmode>` inlined); XPath indexing must be computed over that
same flattened representation so alignment holds across the shadow boundary.

### 3.3 State assignment (deterministic mapping from marks → rows)

Each marked element maps to a row with a fully-determined state:
- explicit exclude → `{ xpath, excluded:true, explicit:true }`.
- toggleable-default excluded (generated) → `{ xpath, excluded:true }` (no
  `explicit`).
- explicit include → stored in `includeXpaths`, synced/merged as
  `{ xpath, excluded:false, explicit:true }`.
- toggleable-default un-excluded by the user → `{ xpath, excluded:false }`
  (boundary-only unmark, not a subtree include).
- silent-whitespace exclusion (generated) → `{ xpath, excluded:true, explicit:true }`
  + bookkeeping.
- immutable → NOT a per-page row; excluded via the immutable tag list in the
  payload.

### 3.4 Submission derivation (shallow roots — deterministic)

From the row set + the live DOM, derive `submissionXpaths` deterministically:
- explicit includes → included rows (always, even hidden/nested);
- every stored excluded row → an excluded row, UNLESS explicitly included or
  **suppressed by an already-emitted excluded ancestor** (this is what makes
  exclusions *shallow roots* — a descendant of an excluded root is omitted);
- visible textual markable content → included rows (the elaborate inclusions);
- invisible textual markable content → excluded rows;
- document roots (`/html[1]`, `/html[1]/body[1]`) and non-textual implicit nodes
  → never emitted.

The order of operations must be fixed (sort rows by document position; emit
excluded roots first so descendant suppression is decidable) so the output is
byte-stable for identical inputs.

---

## 4. AREA 4 — Lightweight, deterministic, mechanical rendering/repaint

### 4.1 Render is a pure projection into fixed layers

The overlay is `render(DOM snapshot, mark rows, interaction state) → ordered
rects`, with a **fixed z-index layer order** (lowest→highest): immutable
exclusions · default/content · saved-explicit-exclude · saved-explicit-include ·
ai-content · session-explicit-exclude · session-explicit-include · focus · hover.
Same inputs → same rects. No layer's content depends on timing.

### 4.2 Two repaint tiers (the mechanical cost model)

- **Full pass** (structural change: enable, config change, structural
  include/exclude toggle, DOM mutation): recollect all layers ONCE, memoizing
  per-element `isVisible`/text/immutable/ancestor decisions **for the duration of
  that pass only** (caches are derived, never persistent truth). Prune nested/
  redundant rows via ancestry sets / parent walks, not pairwise `contains()`
  scans (keep cost ∝ marked-rows × depth, not candidate-pairs).
- **Fast patch** (leaf explicit toggle): update only the explicit include/exclude
  layers + cached collections immediately for responsive acknowledgement, then
  **debounce** the invalidating full rebuild. Structural toggles instead run the
  full rebuild immediately (correctness of default/selector/ancestor layers can't
  lag). A fast patch must `syncPageMarkings` before drawing and must apply only
  current-session explicit deltas (not saved rows).

### 4.3 Scroll / pointer repaint (the cheapest tier)

On scroll or hover, **reuse the current collections and only reposition boxes**
(and run the paint-reachability check for elements scrolling into view). Never
trigger a full recollection unless the DOM, config, or explicit-mark state
changed. Hover changes only the single hover/focus rect.

### 4.4 Settle (determinism under a moving page)

Because pages animate/reflow, a redraw waits for tracked positions to **settle**
(N consecutive stable position samples, or a bounded timeout) before finalizing —
so the overlay converges deterministically instead of chasing a moving target.
The page-motion freeze (established at activation) is what makes this convergence
fast and stable.

### 4.5 Boundary: extension UI is never frozen or marked

The freeze/marking boundary is page content only; `#unfluffify-overlay`,
indicators, popovers, `[id^="unfluffify-"]`/`[data-uf-extension-ui]` keep their
own render/animation alive. This keeps the marking UI responsive while the page
is held still.

---

## 5. The interaction state machine (consolidated)

**States** (derived each event from enable/busy + held modifiers, highest
precedence first): `OFF` (disabled) → `BUSY_LOCKED` (enabled, save/reconcile
block) → `PASSTHROUGH` (Space held) → `INCLUDE` (Alt held) → `EXCLUDE` (default).
`Shift` is an orthogonal modifier on INCLUDE/EXCLUDE that broadens target
resolution.

**Events:** enable / disable / busy-on / busy-off / keydown(Alt|Shift|Space) /
keyup / pointermove / click / blur / visibilitychange / navigation.

**Transition rules (deterministic):**
- Any modifier keydown/keyup recomputes the mode from the current held set;
  `blur` / `visibilitychange` / `navigation` clear all held modifiers (release
  latch) and reset to `IDLE_EXCLUDE`/`OFF`.
- `pointermove` in EXCLUDE/INCLUDE re-resolves the candidate and redraws only the
  hover rect + cursor.
- `click` in EXCLUDE → exclude toggle + normalize + repaint; in INCLUDE → include
  toggle + normalize + repaint; in PASSTHROUGH → pass to page (no marking); in
  OFF/BUSY_LOCKED → no-op (BUSY shows the dimmed/paused overlay).
- Marks/fact churn are NOT events — they cannot move the FSM; only the listed
  discrete events do.

This FSM + the §0.3 predicates + the §3 XPath rules + the §4 render tiers is the
complete mechanical specification.

---

## 6. Open questions (for the Q&A)

- **Q-α — Area-2 scope.** Did "implicit inclusion marking/unmarking" mean the
  whole inclusion side (implicit eligibility + explicit-include action, as I
  modeled), or specifically the implicit/default-content eligibility only?
- **Q-β — Structural-boundary definition.** Is "isStructuralBoundary" (section/
  article/card-group/list/table/toggleable-default, rejecting shallow shells) the
  right cohesion rule, and are the shallow-shell guards (first-two-levels-under-
  body, broad footprint, multiple landmarks) the right rejection tests?
- **Q-γ — Exclude drill vs Include reach.** Confirm the asymmetry: exclude DRILLS
  (refine deeper, skip excluded ancestors), include REACHES IN (rescue inside
  excluded/hidden). Is that the intended mental model?
- **Q-δ — Shift breadth ordering.** Confirm the Shift target-resolution order
  (self-if-structured/toggleable → nearest structured group → nearest toggleable
  → broadest markable), and the shallow-shell rejection.
- **Q-ε — Closed include boundary.** Confirm descendants under an explicit include
  are non-targetable until the include is removed (no sub-refinement inside an
  include).
- **Q-ζ — Repaint tiers.** Confirm the three-tier cost model (full / fast-debounced
  leaf / scroll-reposition) and the "structural toggle = immediate full rebuild,
  leaf toggle = debounced" split.
- **Q-η — Settle policy.** Confirm settle-by-sampling (N stable samples or
  timeout) is the right convergence rule, and the thresholds.
- **Q-θ — Hover feedback granularity.** Confirm pointermove only ever redraws the
  single hover/focus rect (never recollects), i.e., hover is O(1).

---

## 7. One-paragraph summary

The marking interaction is a deterministic FSM (OFF/BUSY/PASSTHROUGH/INCLUDE/
EXCLUDE, Shift a breadth modifier) driven only by discrete events; each event
re-resolves a candidate via pure eligibility predicates (visible ∧ ¬immutable ∧
¬chrome ∧ (direct-text ∨ structural-boundary), with toggleable defaults
override-able) and either redraws the single hover rect (pointermove) or commits
a toggle + canonical row-normalization (click). Exclude DRILLS to refine; include
REACHES IN to rescue and forms a closed boundary. XPaths are positional and
computed against the exact sanitized (shadow-flattened) HTML that is sent, so
they align by construction; state maps deterministically to `{xpath, excluded,
explicit?}` rows plus a separate include list, and submission derives shallow
exclusion roots + elaborate inclusions in a fixed order. Rendering is a pure
projection into fixed z-index layers with three cost tiers (full pass with
per-pass memo caches; debounced fast leaf-patch; O(1) scroll/hover reposition)
and settle-by-sampling convergence, with the extension UI always outside the
freeze/marking boundary.
