# Marking Algorithm — The LOCKED CONTRACT (as documented)

> **Source.** Distilled from `MARKING_AND_HIGHLIGHTING_LOGIC.md` (052c164b-anchored)
> — sections Target Resolution, Exclude Mode, Include Mode, Page Interaction
> Mode, Temporary Disabled State, Self-Markability, Explicit Exclude/Include
> Rules, Marking Performance Contract, Motion Stability Contract, Silent
> Highlighting — plus the knowledge.md marking bullets. Organized by the
> architect's four areas + the interaction FSM, mirroring `01-first-principles`.
> Section refs `[MHL §…]` point into `MARKING_AND_HIGHLIGHTING_LOGIC.md`. This is
> what the contract SAYS; `02-as-implemented` is what the code does.

---

## 0. Shared foundations the contract defines

### 0.1 Self-markability [MHL §Self-Markability]
An element is self-markable when it is a **textual container** not blocked by
consent UI, extension UI, or immutable defaults. **Direct own text** (text nodes
the element itself owns) → self-markable; a container with **only descendant
text yields to the descendant**. For a **toggleable-default boundary**: direct
own text makes it self-markable; otherwise it is self-markable only when it has
**no visible textual descendant and no explicitly-marked descendant**. Automatic
toggleable-default collection: no-textual-descendant qualifies, nested-toggleable-
defaults qualify, visible-immutable-descendants suppress unless the other
structural cases apply.

### 0.2 Target resolution baseline [MHL §Target Resolution]
Targets resolve from `document.elementsFromPoint(...)`, **skipping extension UI,
consent UI, document roots, immutable subtrees**. A hit target must have
**renderable marking geometry** — a live element whose own box is hidden/
transparent cannot be selected just because `elementsFromPoint` returned it.
Collapsed textual wrappers may fall back to **visible descendant geometry**;
hidden explicit includes may remain as **ghost** markings when measurable;
completely invisible explicit targets are ignored. Geometry must also be
**paint-reachable** in the viewport — responsive alternates fully covered by
another card/slide/click face must not render as separate default targets; if
off-screen, the cached collection keeps the element and the viewport redraw
re-checks paint-reachability when it scrolls in.

---

## 1. AREA 1 — Exclusion: eligibility + interaction sequence [MHL §Exclude Mode]

### 1.1 Eligibility / target selection
- Plain exclude clicks choose the **nearest self-markable target**.
- **Already-excluded non-default ancestors are NOT forced back into the path** —
  users refine a broad exclusion by clicking deeper descendants (DRILL).
- **Active toggleable-default boundaries do not steal descendant clicks:**
  clicking a markable descendant inside a default-excluded footer/header/form/
  label/nav/dialog/aside records that boundary as `excluded:false` and the
  descendant as the explicit exclusion. Clicking the **boundary itself** (no
  descendant wins) unmarks that boundary directly.

### 1.2 Ctrl = parent/breadth selection
`Ctrl+Click` resolution order (restored 052c): **(1)** the clicked element if it
is a structured group or toggleable boundary, **(2)** nearest structured group
ancestor, **(3)** nearest toggleable ancestor, **(4)** broadest markable
ancestor. A **shallow-page-shell guard** rejects generic body-level wrappers with
broad viewport footprints or multiple page landmarks (header/main/footer/nav).
[MHL §Exclude Mode, §Toggleable Defaults]

### 1.3 Row normalization on exclude [MHL §Explicit Exclude Rules]
When an element is explicitly excluded: remove redundant descendant exclude rows;
remove overlapping include rows; remove broader explicit-exclude ancestors when
the new target is more specific; **convert broader generated default-excluded
ancestors to `excluded:false`** (so the descendant exclusion lives inside an
un-excluded default boundary); clean hidden include-overrides inside a removed
excluded ancestor. **Toggling an exclude OFF** removes descendant include-
overrides that only existed to punch through it.

---

## 2. AREA 2 — Inclusion (implicit + explicit): eligibility + interaction sequence

### 2.1 Implicit inclusion (the default/content layer)
Not marked by the user — it is the projection of self-markable, visible,
non-excluded content (the "default layer"). Precedence: defaults → selector
influence → explicit. [MHL §Core Model, §AI Selector Integration] A selector-
excluded node suppresses that exact element in the default layer while unmatched
markable descendants still fall through as default content.

### 2.2 Explicit inclusion [MHL §Include Mode, §Explicit Include Rules]
- `Alt` = include mode. It **can inspect descendants inside excluded parents**,
  **prefers explicit targets first**, and restores **mixed direct-text ancestor
  promotion** (an eligible textual ancestor can be included instead of only the
  deepest child).
- Stored locally in `includeXpaths`, synced through the single `xpaths` field as
  an explicit include row.
- **Explicit include boundaries are CLOSED**: descendants under an active include
  are not targetable until the include is removed.
- On include-add: remove descendant excludes and includes under it; convert
  non-toggleable explicit excludes away; toggleable-default rows may remain
  `excluded:false` (boundary-unmark, not a subtree include).
- **Hidden explicit include choices remain stored** while their DOM element
  exists and render as **ghost** markings when they still have measurable
  geometry. (Combined with the payload rule: explicit includes always submit as
  included even when hidden or nested in an excluded ancestor.)

### 2.3 Page-interaction passthrough (the expand-then-mark path) [MHL §Page Interaction Mode]
Holding `Space` while marking is enabled temporarily lets clicks **pass through
to the underlying page UI** — for opening accordions, tabs, menus before
returning to marking or explicit-include work. `Alt` remains include, `Ctrl`
remains parent, Alt wins Ctrl+Alt, and Shift/Meta are inert; `Space` is a separate hold. Releasing `Space` / window blur /
visibility change / disabling marking **restores the overlay and redraws
markings over the page's new posture**. (Silent-highlighting overlays never
capture clicks, so accordions are directly interactive in passive mode.)

### 2.4 Temporary disabled state [MHL §Temporary Disabled State]
While editing is blocked (save/sync), marking stays active but the overlay dims
markings, clears hover, shows a progress cursor + an `aria-live` paused notice.
Brain-dictated via `markingEditsBlocked`/`markingEditsBlockedReason`; content
reflects the directive, never re-derives it.

---

## 3. AREA 3 — XPath extraction + state

### 3.1 Extraction [MHL §AI Submission Rows, knowledge §AI Submission Rules]
Submission XPath indexes are computed **after marking sync**, against the **same
sanitized DOM view as saved `renderedHtml`**: extension UI, browser-automation
roots, and save-time-stripped nodes **do not count as siblings**. Document roots
`/html[1]` and `/html[1]/body[1]` are **never submitted**; non-textual implicit
nodes are omitted. (XPath format itself — positional, no id/class — is confirmed
in `content-marking/04` C1; the contract doc doesn't prescribe the string format
beyond the sanitized-view alignment.)

### 3.2 State rows [MHL §Stored Page Entries]
`xpaths[]` = ordered `{ xpath, excluded }`; user-created exclude rows carry
`explicit:true`. `includeXpaths` = local explicit-include list (merged into
`xpaths` as `{ xpath, excluded:false, explicit:true }` for sync, reconstructed on
load). `selectorSuppressedXpaths`, `silentWhitespaceExcludedXpaths` =
bookkeeping. Immutable defaults are excluded by the **immutable tag list in the
payload**, not per-page rows (stale immutable rows suppressed).

### 3.3 Submission semantics (shallow roots) [MHL §AI Submission Rows]
Explicit includes always submit as included; every stored excluded row submits as
excluded unless explicitly included or **suppressed by an already-submitted
excluded ancestor**; descendants under a submitted excluded ancestor are omitted
unless explicit includes; visible textual markable content → included; invisible
textual → excluded (mobile-sim geometry, page-height/mobile-width — `04` C2).
`submissionXpaths` is the **shallow boundary list**.

---

## 4. AREA 4 — Rendering/repaint [MHL §Marking Performance Contract, §Motion Stability, §Silent Highlighting]

### 4.1 Layers & projection
Marking overlays render while marking mode is enabled; the render-time layer split
is `saved-explicit-*` vs `session-explicit-*` (plus default/immutable/ai). Silent
highlighting uses three layers: `immutable` / `content` / `excluded`. Hidden
implicit includes dropped; hidden explicit includes → ghost; excluded sources
stay collectable while temporarily hidden (renderability only controls whether a
rect draws now). [MHL §Silent Highlighting, §Stored Page Entries]

### 4.2 Enable = one activation pass [MHL §Marking Performance Contract]
The popup sends `setEnabled`; content activation/sync/render runs from there
(**no second immediate `forceRefresh`**). Before motion freeze + overlays:
show the page-inspection spinner, block page + content-overlay input, do a
**bottom-and-top reveal scroll** for lazy content, restore the user's original
scroll, then freeze and render.

### 4.3 Refinement cost tiers [MHL §Marking Performance Contract]
- A manual refinement performs a **cheap immediate explicit-layer refresh**.
- **Structural** refinements then run an **immediate invalidating full rebuild**.
- **Leaf explicit-exclude** refinements may **debounce** the invalidating rebuild
  after patching cached lower-priority collections.
- The immediate refresh may update explicit include/exclude layers + cached
  explicit collections but **must not recompute the default layer or redraw every
  layer**; the following full rebuild owns default/selector/AI/ancestor
  correctness.
- Fast patches must `syncPageMarkings` **before** drawing, must apply only
  current-session explicit deltas (not saved rows), and must not create a second
  source of marking truth.

### 4.4 Caches (per-pass, derived) [MHL §Marking Performance Contract]
A full pass may cache per-element **visibility / text / immutable-default-selector
/ ancestor / textual-descendant** decisions **for that pass only** (derived from
current DOM/config, not persistent truth). A manual explicit op may cache
xpath→element resolution **for that op only**. Expanded exclusions prune
descendant/ancestor/include rows **without** repeatedly resolving the same XPath
or nested `contains()` scans; collection helpers prefer **ancestry sets / parent
walks over pairwise descendant scans** (cost ∝ selected-rows × depth).

### 4.5 Scroll / pointer repaint [MHL §Marking Performance Contract]
Scroll and pointer repaint paths **reuse the current collections and reposition
boxes**; they **must not trigger a full default-layer collection unless the DOM,
config, or explicit marking state changed**.

### 4.6 Settle [MHL §Silent Highlighting]
Silent-highlight redraws **wait for tracked positions to settle** after movement
and force a repaint on full active refreshes even when the render key is
unchanged. (The motion freeze established at activation makes convergence fast.)

### 4.7 Freeze boundary [MHL §Motion Stability Contract]
The freeze/marking boundary is **page content only**; extension UI
(`#unfluffify-overlay`, indicators, popovers, `[id^="unfluffify-"]`,
`[data-uf-extension-ui]`) keeps its own animation/timers/render alive.

---

## 5. The interaction FSM (the contract's implied machine)

The contract doesn't draw an explicit FSM, but its modes compose into one:
`disabled` (off / temporarily-blocked) · `passthrough` (`Space`) · `include`
(`Alt`) · `exclude` (default) · with `Ctrl && !Alt` an orthogonal breadth modifier
for exclusions. Shift and Meta are inert. Mode is derived from held modifiers; `Space`/blur/visibility/
disable restore the overlay and redraw over the new page posture. This matches
the `01` first-principles FSM (which formalizes states, events, transitions).

---

## 6. Where the contract answers / mirrors the first-principles questions

- **Q-α (area-2 scope):** the contract covers implicit-inclusion (default layer)
  AND explicit-include (Alt) — consistent with my reading of area 2 as the whole
  inclusion side.
- **Q-β (structural boundary):** the contract's "structured group / cohesive
  section / article / card group / list / table / toggleable-default" + shallow-
  page-shell guard is the cohesion rule.
- **Q-γ (drill vs reach):** CONFIRMED by the contract — Exclude Mode drills
  (skip excluded ancestors, refine deeper); Include Mode reaches into excluded
  parents.
- **Q-δ (Ctrl order):** CORRECTED — the four-step resolution order above; Shift is inert.
- **Q-ε (closed include boundary):** CONFIRMED — descendants under an active
  include are not targetable until removed.
- **Q-ζ / Q-η (repaint tiers / settle):** the contract specifies the immediate-
  explicit / structural-full / leaf-debounced tiers, scroll-reposition reuse, and
  settle-after-movement — matching the first-principles tiers.
- **Q-θ (hover O(1)):** the contract implies scroll/pointer paths only reposition
  (no recollection) — to be confirmed against code in `02`.

## 7. Contract gaps / items to confirm in the Q&A (carried to `00-report`)

- The contract does not prescribe the XPath **string format** (positional) — that
  lives in `content-marking/04` C1; fine, just note the cross-doc home.
- Shadow-DOM target resolution / XPath (the D5a change) is **not** in the marking
  contract yet — the algorithm's target resolution + XPath must be extended for
  the flattened deep-capture view; currently silent.
- Whether the FSM should be made **explicit** in the contract (states/events/
  transitions) as the reflex-arc program prefers, vs. the current prose-by-mode
  description.
