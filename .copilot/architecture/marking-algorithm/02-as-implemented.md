# Marking Algorithm — AS IMPLEMENTED (the code today)

> **Source.** Traced read-only from `src/content/core.ts`,
> `src/content/explicit-marking-handler.ts`, `src/content/silent-highlight-rules.ts`
> (two focused tracers for the interaction FSM + the render scheduling; XPath
> detail carried from the prior semantics investigation). `file:line` anchored;
> organized by the architect's four areas + the FSM to mirror `01`/`03`. This is
> what the code DOES; `00-report` reconciles it against `01` (ideal) and `03`
> (contract).

**Headline: the implementation faithfully realizes the contract's marking
algorithm.** Drill-vs-reach, Shift breadth, closed include boundaries,
passthrough, cursor modes, row normalization, layered rendering, per-pass caches,
scroll-reposition reuse, O(1) hover, and settle are all present. The open items
are a few nuances (§6): the render debounce model shifted toward "immediate
overlay ack" for issue #6, and shadow-DOM is light-DOM-only today (the D5a
coordinated scope).

---

## 0. The interaction FSM (as coded)

- **Mode derivation** `getMarkMode` (`core.ts:7397`): `disabled` (¬enabled /
  ¬overlay / temporarily-disabled) → `passthrough` (`state.altPassThrough`) →
  `include` (`state.altHeld`) → `exclude` (default). Type
  `"disabled"|"passthrough"|"exclude"|"include"` (`:375`). Modifier vars
  `altPassThrough`/`altHeld`/`shiftHeld` (`:656-659`).
- **Modifier sync** `syncModifierState` (`:7503`) polls
  `getModifierState("Alt"|"Shift")`, and on change calls `updateCursorMode` +
  `refreshHoverHighlight`. `resetModifierState` (`:7531`) clears all held state.
- **Reset events**: `handleWindowBlur` (`:7544`) and `handleVisibilityChange`
  (`:7551`) → `resetModifierState` (releases the held-key latch — matches `01`
  §5). Listeners are capture-phase (`:6930`: keydown/click/keyup/blur +
  visibilitychange).
- **Keydown/keyup** (`:8818`/`:8844`): `Space` (page-interaction key) toggles
  `altPassThrough`; `Alt`/`Shift` route to `syncModifierState`.
- ✔ Matches the `01`/`03` FSM. **Note:** the FSM is *implicit* (derived from held
  modifiers each event), not an explicit state-object machine — see `00` Q-θ2.

---

## 1. AREA 1 — Exclusion: eligibility + interaction sequence

- **Target resolution** `getMarkableTarget` (`core.ts:8156`): hit-test
  `document.elementsFromPoint(x,y)`, skip overlay / `documentElement` / `body` /
  AI-popover / consent. **Pass 1** (explicit preference) returns a direct
  excluded/included xpath match with renderable geometry. **Pass 2** resolves via
  `resolveMarkableElement`.
- **Exclude DRILL** (`:8208-8214`): `withinExplicitExcludedParent`
  (`isWithinExplicitExcludedXpath`, `:2565`, XPath-ancestor walk) → the element
  is skipped **unless** `allowExcludedParentChildren` (which is only true in
  include mode). So in exclude mode, clicks inside an already-excluded region
  drill to a deeper self-markable target. ✔ matches contract §Exclude Mode.
- **Shift = parent/breadth** `resolveMarkableElement` (`:8056`) with
  `allowParent`: collects ancestor candidates classified as structured-group /
  toggleable-boundary / markable, then `chooseExcludeParentBoundaryTarget` picks
  (self-if-structured/toggleable → nearest structured group → nearest toggleable
  → broadest markable), with the shallow-page-shell rejection. ✔ matches contract
  §Exclude Mode Shift order (`01` Q-δ).
- **Toggleable-default drill**: clicking a descendant inside an excluded
  footer/nav/… records the boundary `excluded:false` + the descendant explicit
  (contract §Exclude Mode) — realized in `toggleExplicitExclude`'s ancestor
  cleanup (prior task: `cleanupAncestorHierarchy`, `core.ts:8470-8575`).
- **Commit sequence**: `handleToggleEvent` (`:8723`) → `getMarkModeFromEvent`
  (**uses `event.altKey`, not `state.altHeld`** — race-proof if Alt released
  between hover and click) → `getMarkableTarget` → duplicate-click suppression →
  `showImmediateToggleAcknowledgement` → `scheduleQueuedToggleMutation` (`:9890`)
  → drain (`:9832`, RAF/setTimeout) → `toggleExplicitExclude` (`:8413`, blocks
  immutable + reconcile-pending) → row normalization → `completeExplicitToggle`
  (`:9790`).

---

## 2. AREA 2 — Inclusion (implicit + explicit)

- **Implicit inclusion** = the default/content layer (`collectDefaultLayerElements`
  `core.ts:2924`, prior task): self-markable, visible, not in any
  exclusion/precedence set; a selector-excluded node suppresses itself while
  unmatched markable descendants fall through. No user action.
- **Explicit include** (`Alt`): `getMarkableTarget` invoked with
  `preferExplicitTarget:true`, `preferMixedTextAncestor:true`,
  `allowExcludedParentChildren:true` → include mode **reaches into excluded
  parents** (`:8756`) and can promote a mixed-text ancestor (`:8056`
  `preferMixedTextAncestor` branch). `toggleExplicitInclude` (`:8611`) stores in
  `includeXpaths`; row normalization removes descendant excludes/includes; closed
  boundary. Eligibility gate `canApplyExplicitInclude` (`:10989`, prior task):
  toggleable-default / hidden / under-excluded elements are includable; a
  currently-visible default-content element is not (already included). ✔ matches
  contract §Include Mode + §Explicit Include Rules.
- **Expand-then-mark (D1 path)**: `Space` → `altPassThrough` (`:8833`); in
  passthrough the overlay opacity drops and pointer-events are disabled
  (`~:10936`) so clicks reach the page (open accordion/tab); hover is disabled in
  passthrough. Releasing Space / blur / visibility → overlay restored + redraw.
  ✔ matches contract §Page Interaction Mode and the D1 decision.
- **Implicit "unmark"**: an element leaves the content layer automatically when
  excluded or when it becomes ineligible (visibility/precedence) — a projection
  effect, no dedicated action (matches `01` §2.1).

---

## 3. AREA 3 — XPath extraction + state (carried from the prior investigation)

- **`getXPath`** (`core.ts:2454`): positional `/tag[index]`, root-relative, no
  id/class. **`getSnapshotXPath`** (`:2520`): same, but **skips stripped nodes
  when counting sibling indices** so it aligns to the sanitized `renderedHtml`
  sent to the AI. ✔ matches `content-marking/04` C1 + contract §AI Submission
  Rows sanitized-view alignment.
- **State rows**: excludes → `xpaths[]` `{xpath,excluded:true,explicit:true}`;
  toggleable-default generated → `{excluded:true}` (no explicit); explicit include
  → `includeXpaths[]` (merged as `{excluded:false,explicit:true}` on sync);
  mutually exclusive per element. Immutable via payload tag list, not rows.
- **Submission** `buildAiSubmissionXpaths` (`popup/ai-run.ts:13`) /
  `collectAiSubmissionXpathsForCurrentPage` (`content-main.ts:4990`): shallow
  boundary rows; includes always submit; excluded rows suppressed under an
  already-emitted excluded ancestor; roots never emitted. ✔ matches contract.
- **⚠ Shadow gap (D5a):** `getXPath` and `elementsFromPoint` do NOT cross shadow
  boundaries → shadow content is currently un-markable AND absent from the
  positional-XPath space. The D5a deep-capture change must extend BOTH the
  capture and (if in-shadow marking is wanted) target resolution + XPath. See `00`.

---

## 4. AREA 4 — Rendering/repaint

- **Layers** (`core.ts:6641-6650`): fixed z-index 2→11: hard(immutable) ·
  default · saved-explicit-exclude · saved-explicit-include · ai-content ·
  session-explicit-exclude · session-explicit-include · focus · hover ·
  interaction. Box classes at `:6665` (`uf-rect`, `uf-default`,
  `uf-explicit-include(-ghost)`, `uf-explicit-exclude(-ghost)`, `uf-ai-content`,
  `uf-hover`, `uf-focus`, `uf-hard-locked`). ✔ fixed-order projection.
- **Full vs reposition** `renderHighlightsInner` (`:9937`): builds
  `buildMarkingCollectionsCacheKey` (`:1245`, = pageUrl ⊕ selector fingerprint ⊕
  entry fingerprint); **if the key matches the cached one → `repositionHighlights`
  (`:10152`) reposition-only** (reuse element collections, recompute rects); else
  **full rebuild**. ✔ this is the deterministic "reuse unless DOM/config/explicit
  changed" model from `01` §4 / contract §Marking Performance.
- **Per-pass caches** `resetElementComputationCaches` (`:1114`): visibility /
  ancestor-vis / overflow / direct-text / normalized-text / toggleable-default /
  immutable / textual-descendant maps, cleared+restored around the pass via
  `withElementComputationCache` (`:1142`). `cachedCollections`/`Key` persist
  across passes (`:700-701`) as the reposition anchor. ✔ per-pass, derived.
- **Fast explicit patch** `applyExplicitStateToCachedCollections` (`:9465`):
  filters cached collections in place (`filterSuppressed`, ancestry test) without
  a DOM re-scan. Debounce `EXPLICIT_TOGGLE_DEFERRED_FULL_RENDER_DELAY_MS` (~180ms,
  `:755`); `scheduleExplicitOverlayRefresh` (`:9707`) coalesces via RAF/
  setTimeout(0).
- **Hover = O(1)ish** `handleMouseMove` (`:8375`) RAF-debounced;
  `updateHoverHighlight` (`:8276`) → `canReuseHoverHighlight` (`:7845`) returns
  early unless `elementsFromPoint` result / options / target-bounds changed.
  Hover is its own layer, never invalidates `cachedCollections`. ✔ matches `01`
  Q-θ (hover only redraws the hover rect).
- **Scroll/resize**: **no ResizeObserver**; `scheduleRender` (`:11312`)
  invalidates collections only if `pendingRenderInvalidate`, else the cache-key
  gate decides reposition-vs-rebuild. ✔ no full recollection unless state changed.
- **Settle** `sampleSettledSilentHighlightPosition` (`silent-highlight-rules.ts:59`):
  finalize at **3 stable samples** or **2600ms** timeout. ✔ matches `01` §4.4.
- **Nesting collapse** `collapseElementsByNesting` (`:3796`): walks each
  candidate's ancestors against a `keptSet` (parent-walk + set membership). ⚠ the
  render tracer flagged a possible O(n²) worst case; the contract requires
  ancestry-set/parent-walk (not pairwise) — **verify the cost is O(rows×depth)**
  (`00` Q-η2).

---

## 5. Impl vs contract — summary

| Area | Status |
|---|---|
| FSM (modes, modifier sync, blur/visibility reset, cursor) | ✔ match (implicit FSM) |
| Exclude drill / Shift breadth / toggleable-default drill | ✔ match |
| Include reach-in / mixed-text ancestor / closed boundary / eligibility | ✔ match |
| Passthrough expand-then-mark (D1) | ✔ match |
| XPath positional + snapshot-aligned + state rows + shallow submission | ✔ match |
| Layers / cache-key reposition / per-pass caches / hover O(1) / scroll reuse / settle | ✔ match |
| **Render debounce model** | ~ nuance: shifted toward immediate-overlay-ack for issue #6 (`00` Q-ζ2) |
| **Nesting-collapse cost** | ~ verify O(rows×depth), not O(n²) (`00` Q-η2) |
| **Shadow-DOM marking + XPath** | ✗ gap — light-DOM only; D5a coordinated scope (`00`) |
| **Explicit FSM in contract** | ~ FSM is implicit in code + prose in contract (`00` Q-θ2) |

**Bottom line:** no true behavioral divergence from the locked marking-algorithm
contract; the algorithm is implemented as documented. The Q&A items are: (a) the
few implementation nuances to confirm/verify (render debounce, collapse cost),
(b) the shadow-DOM extension the D5a decision already mandates (which touches the
marking algorithm's target resolution + XPath, not just capture), and (c) whether
to formalize the interaction FSM in the contract per the reflex-arc program.
