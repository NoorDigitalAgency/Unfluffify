# Legacy Unfluffify — Register of Locked Behavioral Contracts, Pain Points, and QA Decisions

**Scope.** Digest of the LEGACY repo's documented contracts and institutional knowledge at
`/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`
(worktree of `main`, production v1.10.0 lineage). All citations are `file:line` inside that
worktree. Abbreviations: **MHL** = `MARKING_AND_HIGHLIGHTING_LOGIC.md`, **KN** = `.copilot/knowledge.md`,
**PL** = `PROPERTY_LOCK.md`, **HO** = `.copilot/HANDOFF.md`, **LRP** = `.copilot/lifecycle-resume-plan.md`,
**CM-03/04** = `.copilot/architecture/content-marking/03-locked-contract.md` / `04-qa-decisions.md`,
**MA-03/04** = `.copilot/architecture/marking-algorithm/03-locked-contract.md` / `04-qa-decisions.md`,
**MWR** = `.copilot/architecture/marking-widening-review.md`, **MIP** = `.copilot/architecture/marking-implementation-plan.md`,
**RAP** = `.copilot/architecture/reflex-arc-plan.md`, **PLAN** = `.copilot/plan.md`.

Each contract is tagged **[ALG]** (algorithmic/marking-model), **[UX]** (visual/interaction), or **[PROTO]** (protocol/lifecycle/backend).

---

## PART 1 — LOCKED CONTRACTS

### 1.0 Contract meta / change discipline

- **C-META-1 [PROTO].** The marking rules are a *locked compatibility contract* anchored to commit
  `052c164b077d459fa7a6e79b306f01144336719c` with named safeguards on top: `BUTTON` stays toggleable,
  the void `LINK` tag is omitted, stricter geometry/paint guards stay active, selector-excluded content
  gets no dedicated overlay, silent highlighting keeps the `immutable`/`content`/`excluded` layers
  (MHL:1-21, KN:539, PLAN:1106-1117).
- **C-META-2 [PROTO].** Any legitimate contract change must update `MARKING_AND_HIGHLIGHTING_LOGIC.md`,
  `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and the focused regression tests **in the same
  commit**. A change that only patches rendering/caching/hover/sync is NOT sufficient if it alters the
  rules (MHL:18-21, KN:538).
- **C-META-3 [PROTO].** Property-lock contract has the same change discipline: do not change unless a task
  explicitly asks; update README + PROPERTY_LOCK.md + focused tests in the same commit (PL:1-7).

### 1.1 The marking model — non-negotiable invariants **[ALG]**

- **C-MARK-1 — "Seed then step aside" (THE first invariant, architect-authoritative).** Default-tag and
  CSS/AI-selector markings are ONLY an element's *initial* marking state. After seeding they carry no
  special rule, privilege, or priority — they are ordinary markings identical to a hand-made user mark.
  The selectors and default rules SEED the initial `xpaths` rows and then STEP ASIDE; the stored rows are
  the sole marking truth. Rendering, target resolution, and submission MUST derive an element's state from
  its stored row and MUST NOT re-apply a CSS selector or default-tag rule
  (`matchesToggleableDefaultExcluded`, selector re-match) on top of an element that already has an explicit
  row. Concretely: an un-excluded `{excluded:false}` element renders and submits as ordinary implicit
  content **even if a selector or default rule would otherwise match it** — it must never be blank
  (neither excluded by the row nor content because a rule re-caught it). The ONLY post-seed recompute of
  default/selector state is the temporary recalculation of the AFFECTED branch when an
  ancestor/descendant marking mutates (MHL:23-43; KN:555 records the live root-cause history behind this).
- **C-MARK-2 — Rendering precedence.** The per-page entry combines: (1) defaults, (2) CSS/AI selector
  influence, (3) current marking-session explicit markings — where (3) means local draft deltas made after
  marking is enabled, relative to the freshly computed session baseline (MHL:83-96).
- **C-MARK-3 — Session-scoped marking data, fresh on every enable.** Page marking data lives only while
  marking is enabled. Every enable recomputes the entry fresh from defaults + selector influence (selector
  influence only when a selector set exists), discards any stale persisted `config.pageMarkings[pageUrl]`
  draft. Backend-saved explicit markings do NOT pre-populate the fresh session entry; the first render
  after enable adopts the freshly synced defaults+selector entry as the clean baseline, so a freshly
  enabled page never starts dirty. No unsaved-draft cache survives disable. **Marking is disabled on any
  navigation or page reload regardless of same page/property.** The `saved-explicit-*` vs
  `session-explicit-*` render layer split is retained but `saved-explicit-*` reflects the fresh session
  baseline (MHL:97-115, KN:573).
- **C-MARK-4 — Immutable defaults (exact list).** `IMG, INPUT, NOSCRIPT, SELECT, TITLE, STYLE, SCRIPT,
  TEMPLATE, IFRAME, VIDEO, SVG`. Always excluded, never overridable from marking mode; elements inside an
  immutable subtree are not markable. `SVG` was added by QA decision D5b (self-contained graphic; its
  internal `<text>`/`<title>` is not indexed prose). Tag matching is **case-insensitive on both sides**
  (foreign-namespace `<svg>` reports lowercase `tagName`). At submission, immutable exclusion travels as
  the **immutable tag list sent with the payload**, not per-page XPath rows; stale immutable rows are
  suppressed (MHL:184-199, MHL:848-850, KN:564, CM-04:143-151).
- **C-MARK-5 — Toggleable defaults (exact list).** `FOOTER, FORM, LABEL, NAV, HEADER, DIALOG, ASIDE,
  BUTTON`. Start excluded, user-toggleable. `BUTTON` intentionally toggleable; `LINK` intentionally
  omitted (void metadata element, never a marking target) (MHL:201-218, KN:564).
- **C-MARK-6 — Unconditional auto-exclusion of toggleable defaults (F1, deliberate 052c deviation,
  2026-07-04).** Automatic toggleable-default collection follows the taxonomy tag UNCONDITIONALLY
  (subject only to hidden-subtree/immutable-ancestor/consent/extension-UI skips). The 052c "visible
  immutable descendant suppresses boundary auto-exclusion" rule is REMOVED — it leaked boundary
  boilerplate into AI-included content while the media was excluded via the tag list anyway
  (MHL:683-693, KN:540, MWR:56-76).
- **C-MARK-7 — Toggleable defaults have NO dedicated visual layer.** No separate CSS class, render
  collection, or post-hoc overlay rule. Once decided excluded, the boundary is an ordinary
  `{xpath, excluded:true}` row rendered through the ordinary exclude overlay; the renderer must NOT
  require `explicit:true` for generated rows. The exclude-overlay collector includes user exclude rows
  AND live generated rows whose element still matches a toggleable default; excluded-by-state defaults
  stay out of the implicit/default content layer; stale untagged non-default excluded rows are not drawn
  (MHL:44-54, MHL:228-240, KN:566-567).
- **C-MARK-8 — `excluded:false` unmarks exactly one boundary.** A stored `{xpath, excluded:false}` row for
  a toggleable default suppresses only that boundary's own implicit/default marking — never descendants,
  never a subtree include. **Leaf-boundary exception:** a boundary with visible textual DESCENDANTS
  suppresses its own marking so descendants render in its place (anti-ghost); but a LEAF textual boundary
  (e.g. unmarked `<button>Akne</button>`, own text only, no descendant surface) MUST stay visible in the
  default layer (force-included via `forceIncludeSet`) so the unmarked control still carries marking UI
  and can be re-excluded. Similarly an un-excluded element that a CSS/AI selector still matches has that
  selector **suppressed at render** (derived from the un-excluded rows) so it renders as implicit content
  (MHL:55-67, MHL:294-313, KN:555 items (1)/(2), KN:568-569).
- **C-MARK-9 — First-click unmark of a default boundary.** A direct exclude-click on an
  already-default-excluded boundary with no stored row records `{excluded:false}` on the FIRST click
  (never a redundant explicit exclusion requiring a second click) (MHL:294-300, KN:550).
- **C-MARK-10 — Default-layer projection uses two distinct sets.** Explicit excludes suppress only the
  explicit boundary itself at default-layer precedence; ALL synced excluded boundaries suppress descendant
  default-layer projection. This keeps generated default boundaries visible on first render while
  preventing duplicate descendant default marks under excluded ancestors. Default-layer collection stays
  otherwise 052c-structural — explicit marks must not globally filter unrelated implicit default targets
  (flicker on alternating toggles) (MHL:314-321, MHL:308-312, KN:570).
- **C-MARK-11 — Stored page entry shape.** Entry fields: `title`, `timestamp`, `xpaths` (ordered
  `{xpath, excluded}`; user exclude rows carry `explicit:true`), `includeXpaths`,
  `selectorSuppressedXpaths`, `silentWhitespaceExcludedXpaths`, `submissionXpaths`, `renderedHtml`,
  `rawHtml`. Config sync does NOT send `includeXpaths`/`selectorSuppressedXpaths` separately: both merge
  into `xpaths` as `{xpath, excluded:false, explicit:true}` rows and are reconstructed on load. Untagged
  generated/legacy rows are sync posture and may be dropped if they no longer match a generated default
  (MHL:242-269).
- **C-MARK-12 — Silent-whitespace generated exclusions.** Visible renderable block elements with no
  meaningful normalized text may sync as `{xpath, excluded:true, explicit:true}` rows recorded in
  `silentWhitespaceExcludedXpaths`. They are NOT a new taxonomy category: no explicit overlay, not
  returned by target resolution, cannot be explicitly included, do not make an unmarked page count as
  manually marked for AI auto-seeding. Sync drops the row when the element gains text, disappears, hides,
  or falls under another exclusion (MHL:270-280).
- **C-MARK-13 — AI auto-seed rows MUST carry `explicit:true`.** AI-selector auto-seeding on an unmarked
  page writes `{xpath, excluded:true, explicit:true}` — the seeded CSS/AI baseline IS the explicit
  precedence baseline. The flag is load-bearing twice: (a) seeded rows survive the sync reconcile (which
  rebuilds from scan candidates + preserved explicit rows), (b) it satisfies the
  `hasExplicitUserMarkings` gate so the seed runs at most once per session. Without it the seeded rows
  suppressed the generated default rows as excluded parents then evaporated in the same pass (MHL:282-292;
  root-caused live as S1/S2, KN:545).
- **C-MARK-14 — Auto-seed suppression when the user owns the baseline.** The render-path seed guard also
  suppresses auto-seed when `hasUserMarkingEdit(pageUrl)` (set on real toggle via
  `completeExplicitToggle`, cleared at enable/disable/discard) or the entry has
  `selectorSuppressedXpaths`; the one-shot restore suppression is consumed only on an exact page match
  (KN:550).
- **C-MARK-15 — Explicit exclude normalization rules.** On explicit exclude: remove redundant descendant
  exclude rows; remove overlapping include rows; remove broader explicit-exclude ancestors when the new
  target is more specific; **convert broader generated default-excluded ancestors to `excluded:false`**
  (so the descendant exclusion lives inside an un-excluded default boundary); clean hidden include
  overrides inside a removed excluded ancestor. Toggling an exclude off removes descendant includes that
  only existed to punch through it (MHL:714-729).
- **C-MARK-16 — Explicit include normalization rules.** On explicit include: remove descendant excludes
  and includes under it; convert non-toggleable explicit excludes away; toggleable-default rows may remain
  `excluded:false` (boundary unmark, not subtree include). Hidden explicit includes remain stored while
  their DOM element exists and render as ghost include markings when measurable. **Explicit include
  boundaries are CLOSED**: descendants under an active include are not targetable until the include is
  removed (MHL:731-742, MHL:626-631, KN:575-576).
- **C-MARK-17 — Include+exclude mutually exclusive per element (C3).** Applying one clears the other; no
  contradictory state, no tiebreak (CM-04:182-187).

### 1.2 Marking interaction FSM **[ALG]/[UX]**

- **C-FSM-1.** Marking interaction is a formal FSM with a single derivation authority
  `deriveMarkMode(inputs)` in `src/content/core.ts`; `getMarkMode()` sources live state,
  `getMarkModeFromEvent(event)` sources `altActive` from the committing event's `altKey` (race-proof at
  click time). Modes: `disabled` (off / no overlay / busy-locked), `passthrough` (Space latch),
  `include` (Alt), `exclude` (default). Fixed precedence `disabled > passthrough > include > exclude`.
  **`Shift` is NOT a mode** — an orthogonal breadth modifier (`shouldAllowParentMarking`), active only
  outside include mode. Window blur, tab visibility change, and navigation reset the held-modifier latch.
  The machine holds no mode state beyond the latches; every event re-derives the mode
  (MHL:505-542, KN:559, MA-04:99-107).
- **C-FSM-2 — Page interaction (Space passthrough).** Holding `Space` lets clicks pass through to page UI
  (accordions, tabs, menus) before returning to marking; releasing Space/blur/visibility/disable restores
  the overlay and **redraws markings over the page's new posture**. Silent-highlighting overlays never
  capture page clicks (MHL:633-644).
- **C-FSM-3 — Temporary disabled state.** Marking can stay active while edits are blocked (page save,
  sync pending): overlay stays mounted, dims markings, clears hover, progress cursor, persistent
  `aria-live` paused notice (stripped from snapshots). The decision to enter is **brain-dictated**: the
  view-projector composes the post-AI/preview lock (`aiComputing || previewActive || previewBlocked`,
  reason `ai_run`) and pending page-save reconciliation (`saving`/`syncing`) into
  `markingEditsBlocked`/`markingEditsBlockedReason`; content reflects the directive and never re-derives.
  `editor_preparing` reconciliation is exempt brain-side and never raises the overlay. Toast copy follows
  the directive reason (MHL:646-667, KN:599).

### 1.3 Target resolution, widening, self-markability **[ALG]**

- **C-TGT-1 — Hit-testing.** Targets resolve from `document.elementsFromPoint(...)`, skipping extension
  UI, consent UI, document roots, immutable subtrees. The composed hit path additionally surfaces
  **pointer-events-suppressed descendants** of the topmost page hit whose client rects contain the point,
  deepest-first (accordion-header span case) — those are hover- and click-markable (MHL:544-556, KN:547
  item (3)).
- **C-TGT-2 — Renderable geometry + paint-reachability.** A hit target must have renderable marking
  geometry: hidden/transparent own box cannot be selected merely because `elementsFromPoint` returned it.
  Collapsed textual wrappers may fall back to visible descendant geometry; hidden explicit includes may
  remain ghost markings when measurable; completely invisible explicit targets are ignored. Geometry must
  be paint-reachable in the current viewport (covered responsive alternates/card faces must not render as
  separate default targets). An element missing from its own hit stack still counts reachable when the
  TOPMOST page hit is an ancestor and the chain up to it is pointer-events-suppressed (transparency, not
  coverage); a genuine foreign overlay above the ancestor still reads covered (MHL:558-571).
- **C-TGT-3 — Exclude drills; include reaches.** Plain exclude clicks pick the nearest self-markable
  target; already-excluded non-default ancestors are not forced back into the path (refine by drilling
  deeper). Active toggleable-default boundaries do not steal descendant clicks: clicking a markable
  descendant inside a default-excluded footer/header/form/label/nav/dialog/aside records the boundary as
  `excluded:false` and the descendant as the explicit exclusion; clicking the boundary itself unmarks it
  (MHL:573-581, KN:565). Include mode (Alt) can inspect descendants inside excluded parents, prefers
  explicit targets first, and restores 052c mixed direct-text ancestor promotion (MHL:621-627).
- **C-TGT-4 — Shift widening ladder (052c order).** Shift+Click resolution: (1) the clicked element if
  it is a structured group or toggleable boundary, (2) nearest structured-group ancestor, (3) nearest
  toggleable ancestor, (4) broadest markable ancestor (MHL:583-589, KN:541).
- **C-TGT-5 — Widening restraints (W1–W5; F-decisions locked 2026-07-04/05).**
  1. **Ancestor ladder candidates must be self-markable** (evaluated `allowParent:false` → direct own
     text only); the walk hard-stops at `body`/`documentElement`, making root exclusions impossible by
     construction (MHL:592-598, KN:542).
  2. **Descendants-only targets face page-shell rejection at ANY depth** — and since 2026-07-05 the
     rejection is **LANDMARK-BASED ONLY** (≥2 page-shell landmarks: main/nav/header/footer tags or
     banner/contentinfo/main/navigation roles). The broad-footprint disjunct was DROPPED
     (`hasBroadParentMarkingFootprint` deleted): a real footer is dimensionally indistinguishable from a
     content column; a bare landmark-less full-width column is widen-eligible again (accepted tradeoff,
     architect decision). Content-boundary-tag + direct-text exemptions preserved (MHL:599-608, KN:542,
     KN:546 N1).
  3. **W4/F3:** descendants-only widen targets require **≥2 markable descendants** — single-child
     wrappers are not widen targets (deliberate 052c deviation) (MHL:609-612, MWR:77-81).
  4. **W5/F4:** structured-group cohesion filters textless children (spacers/decorations) before the
     min-2/every() checks; groups qualify with ≥2 conforming textual children; monotone (MHL:613-618,
     MWR:82-90).
  5. **W2/F5:** `getDepthBelowBody` walks the flattened (shadow-crossing) parent chain (guard ≤500) so
     shell protection applies inside open shadow trees (KN:542, MWR:34).
  6. The depth≤2 shallow guard is unchanged where it feeds the structured-group definition (KN:542).
  (Also F8: the shell-rejection call inside `isStructuredGroupExclusionCandidate` was dead code and was
  removed as a behavioral no-op — MWR:37.)
- **C-TGT-6 — Self-markability.** An element is self-markable when it is a textual container not blocked
  by consent UI, extension UI, or immutable defaults. Direct own text → self-markable; container with
  only descendant text yields to the descendant. Toggleable-default boundary: direct own text →
  self-markable; else self-markable only when it has no visible textual descendant and no explicitly
  marked descendant (MHL:669-681).
- **C-TGT-7 — Visibility & CSS clamps (MA-1b).** Genuine hiding (`display:none`,
  `visibility:hidden|collapse`, `opacity:0`, `hidden`, sr-only/clip off-canvas, zero-area) is not
  markable/submitted; interaction-gated panels (collapsed accordions, inactive tabs) fall here until
  expanded via Space. **A CSS text clamp is NOT hiding**: text fully present in DOM but truncated
  downward by a vertical clamp (`overflow-y hidden/clip` with `scrollHeight > clientHeight`, fixed
  height/max-height, `-webkit-line-clamp`) with a non-empty preview is visible and included (it is what
  Google indexes). Only downward truncation with a visible preview is spared; horizontal displacement and
  fully collapsed zero-height boxes stay excluded (MHL:695-712, KN:563, MA-04:67-95).
- **C-TGT-8 — a11y-hidden text = hit-test reality-check (D4).** `aria-hidden`, `sr-only`,
  `visually-hidden` are AMBIGUOUS and resolved by actual paint-path presence (`isActuallyVisibleToUser`),
  not a blanket exclude (CM-04:90-98, CM-02 §3).

### 1.4 Shadow DOM **[ALG]**

- **C-SHDW-1 — Googlebot parity: flatten to real DOM.** Shadow content is handled exactly as Googlebot
  renders it: open shadow roots are inlined into the sanitized snapshot as real elements at the FRONT of
  the host (composed order), recursing through nested roots; **no `<template shadowrootmode>` wrapper**.
  Inlining happens before the strip/class/`data-uf-*` passes. Closed roots are silently skipped; the
  extension's own shadow root (WXT host, `data-wxt-shadow-root`/`data-uf-extension-ui`) is never captured
  (MHL:776-795, KN:560, MA-04:10-64).
- **C-SHDW-2 — Continuous positional XPath through shadow.** `getXPath`/`getSnapshotXPath` walk the
  composed tree (cross a top-level shadow child up to its host; a light child of a shadow host is
  index-shifted past the host's preceding same-tag shadow children). Byte-identical to the light-DOM path
  when no capturable shadow root exists. `getElementFromXPath` is native-first with composed fallback
  gated on `documentHasCapturableShadow()` (MHL:796-804, KN:561).
- **C-SHDW-3 — Live engine descends shadow.** Enumeration and reconcile scans descend capturable shadow
  roots (composed order, shadow first); hit-testing is composed-aware (a hit on a shadow host counts as a
  hit on painted shadow content); target resolution/hover pierce open shadow (via
  `shadowRoot.elementsFromPoint`); overlays position over composed geometry. All descent gated on the
  presence of a capturable shadow root, so shadow-free pages are behavior-identical and perf-neutral
  (MHL:806-818, KN:562).

### 1.5 AI submission rows **[ALG]/[PROTO]**

- **C-SUB-1 — Shallow boundary rows aligned to the sanitized view.** `submissionXpaths` is the shallow
  boundary list for CSS-selector calculation. Sync runs before saving; submission XPath indexes are
  computed in the **same sanitized DOM view as saved `renderedHtml`** — extension UI, browser-automation
  roots, and save-time strip selectors do not count as siblings (MHL:820-830, KN:516-517).
- **C-SUB-2 — Row rules (exact).** (a) Explicit includes always submit as included (even hidden or under
  excluded ancestors). (b) **Every stored excluded XPath row submits as excluded** unless explicitly
  included or suppressed by an already-submitted excluded ancestor — includes generated/default rows;
  `explicit:true` is local user-edit metadata, not the submission gate (052c submission semantics).
  (c) Silent-whitespace rows submit excluded but stay hidden from marking UI/include targeting.
  (d) Descendants under a submitted excluded ancestor are omitted unless explicit includes. (e) Consent
  UI is never stored/submitted as dedicated consent rows — it is hidden before saving and any textual
  consent content falls under the invisible-textual rule. (f) Immutable defaults travel as the payload's
  immutable tag list, never per-page rows; stale immutable rows suppressed. (g) Visible textual markable
  content → included rows. (h) Visually invisible textual content → excluded rows using **mobile
  simulation geometry at save time**; below-fold is visible (submission viewport = page-height) while
  content outside mobile viewport width or document height is invisible; CSS-clamped text is NOT
  invisible-textual. (i) Non-textual implicit nodes omitted. (j) Document roots `/html[1]` and
  `/html[1]/body[1]` never submitted (MHL:831-875, KN:512-521, CM-04:174-180).
- **C-SUB-3 — Enumerated payload philosophy (D3).** The payload is the full enumerated set: every visible
  direct-text-bearing non-excluded element as included rows + shallow-boundary exclusions. The custom AI
  expects explicit positive AND negative ground truth; do NOT move to corrections-only (CM-04:71-87).
- **C-SUB-4 — Positional XPaths (C1).** Purely positional `/tag[index]/...`, no id/class, aligned to the
  sanitized HTML sent; the AI maps xpath → captured HTML, never a live DOM (CM-04:166-172).
- **C-SUB-5 — AI run corpus.** An AI run always uses the stored local page snapshots for **every marked
  page under the current base URL** (saved `renderedHtml`, saved/backfilled `rawHtml`, saved
  `submissionXpaths`/refined raw XPaths). Compute-time DOM collection must not replace that corpus. The
  only allowed live overlay is the active current page (refresh its stored snapshot immediately before
  building the request) (MHL:766-774). `rawHtml` is sent only when render mode is static; `renderedHtml`
  always (CM-03:231, CM-02 §7).
- **C-SUB-6 — Run start UX ordering.** Starting an AI run must first enter popup compute-busy state,
  render spinner/countdown, and apply the page-side compute lock **before** raw-HTML backfills, XPath
  refinement, and payload construction (so large payloads can't make the click look ignored). Async run
  status polls at a 5-second cadence (MHL:759-764, KN:514). Heavy payloads (renderedHtml/rawHtml/AI
  request/response/server config) must not ride multi-hop runtime messages — use storage/cache keys or a
  context-owned fetch (KN:515).
- **C-SUB-7 — AI-run timeout single source of truth.** `AI_RUN_DEFAULT_TIMEOUT_MS`/`_MINUTES` in
  `common/bus/contracts/ai-run.ts` feeds the abort deadline, the REMOTE_WAIT spinner duration, the
  countdown fallback, and the busy note — never hardcode minutes (KN:622).

### 1.6 Marking performance contract **[ALG]**

- **C-PERF-1 — One activation path.** Popup sends `setEnabled`; content activation/sync/render flows from
  there — **no second immediate `forceRefresh`**. Before freeze + overlays: show page-inspection spinner,
  block page and content-overlay input, do the bottom-and-top reveal scroll for lazy content, restore
  original scroll (MHL:340-347, KN:572).
- **C-PERF-2 — Refinement tiers.** A manual refinement performs a cheap immediate explicit-layer refresh;
  structural refinements then run an immediate invalidating full rebuild; leaf explicit-exclude
  refinements may patch cached lower-priority collections and debounce the invalidating rebuild. The
  immediate refresh must not recompute the default layer; the full rebuild owns
  default/selector/AI/ancestor correctness. Fast refreshes must run `syncPageMarkings` before drawing and
  must not create a second source of marking truth; fast patches apply only current-session explicit
  deltas, not fetched saved rows (MHL:322-337, MHL:348-356, KN:571).
- **C-PERF-3 — CP7a per-element caches.** Visibility/text/immutable-default-selector/ancestor/
  textual-descendant/paint-reachability decisions are pure functions of DOM+viewport; the sync render path
  REUSES them across passes gated by a DOM/viewport version bumped ONLY on real DOM/viewport changes
  (rebuild-class mutation, scroll, motion pause/resume) — **never** on collection invalidation. The async
  chunked reconcile stays ephemeral. Silent highlighting consumes the same caches; its reposition
  scheduler signals the same invalidation (scroll bump runs regardless of mode; teardown invalidates).
  While actively scrolling, paint-reachability is unknowable: the draw filter passes rects through, the
  scan answers optimistically without persisting a verdict, the post-scroll pass re-applies the strict
  filter (MHL:357-373, KN:557, KN:545 S3).
- **C-PERF-4 — CP7b branch-scoped rebuild (shipped) + MA-3 model.** A mark's blast radius is
  branch-local. A SINGLE explicit toggle takes the scoped path: `affectedRoot` = outermost flip-capable
  ancestor (toggleable-default boundary or structured-group candidate) else the element itself; splice
  cached outside-subtree collections (stashed at invalidation, version-tagged) + freshly walked subtree
  seeded from real ancestor state; the redundant sync scan is skipped. Guards falling back to FULL:
  >1 pending toggle; any page/selector-fingerprint change; entry-row differences not confined to the
  subtree (`entryKeyDiffConfinedToSubtree`); pending fresh-baseline adoption; stale stash; unbounded
  affected root. After every scoped rebuild one coalesced trailing FULL reconcile runs (~1.5s after
  toggles settle) as the self-healing backstop; settle/invalidating renders stay full. Debug parity audit
  `localStorage["unfluffify:cp7b-parity"]="1"`. Verified prerequisite: a marking toggle never changes
  which elements the AI selectors match (selector fingerprint is config-derived; toggle mutates only the
  entry) (MHL:388-425, KN:556-558, MIP:143-213).
- **C-PERF-5 — Collection cost bounds (MA-4).** `collapseElementsByNesting` is O(rows×depth) —
  keptSet parent-walk / ancestor-set, no pairwise `contains()`; depth memoized in the sort. Explicit ops
  may cache xpath→element resolution only per-operation. Scroll/pointer repaint paths reuse current
  collections and reposition only (MHL:374-386, KN:544).
- **C-PERF-6 — Motion-pause maintenance must stay cheap.** Full-document motion candidate sweep
  (`querySelectorAll("*")` + per-element computed styles) ONLY at explicit engage points
  (`pausePageMotion`, post-reveal re-apply, snapshot/submission passes). The periodic (250ms) and
  observer-driven refreshes use the cheap path: re-pause document animations, reassert tracked locks,
  evaluate only observer-flagged `pendingDiscovery` elements; the observer ignores `style` mutations on
  elements in `lockedElements` (self-write feedback loop) and only populates `pendingDiscovery` (the
  250ms timer drains it — no rAF rescheduling); hover-pause dispatched ONCE per target. **NEVER make the
  periodic/observer refresh do a full-document sweep again** (KN:548).

### 1.7 Motion stability / reveal-freeze **[PROTO]/[UX]**

- **C-FRZ-1 — The reveal/freeze ritual (architect, 2026-07-03): exactly ONE per page visit**, run either
  immediately at page-load complete or immediately after render-mode detection exits. Ritual steps:
  smooth scroll to top → walk down → at 50% of the INITIAL scroll height the LAZYLOADING freeze engages
  (maximum ONE lazy expansion for the whole ritual; an expansion during the 0→50% sweep counts as the
  one) → arrive at bottom, wait for the expansion → scroll to the new bottom and wait (no further
  expansions may occur) → the PAGE FREEZE (full motion pause) engages AT THE ABSOLUTE BOTTOM, never
  earlier → the return scroll happens under the freeze. The full scroll to the true bottom is never
  neglected (early-stop and initial-extent clamp were tried and rejected). Enforcement: concurrent
  warmups JOIN the in-flight ritual (never supersede); only the walk that ENGAGED the lazy-load lock may
  release it; unpaused-subsystem resumes do not restore suppression while a ritual is in flight; the
  freeze rides the reveal's `pauseAtBottom` hook (KN:269-286, HO:309-347).
- **C-FRZ-2 — Page-visit freeze is a single lock, released only on navigation.** `pausePageMotion(reason)`
  always also holds `PAGE_VISIT_MOTION_PAUSE_REASON="page-visit"`; per-subsystem resumes (marking
  disable, silent teardown, AI run/preview/exit) drop only their own reason and never unfreeze the page.
  `resumeAllPageMotion()` is the single release, wired to URL-change navigation events. `enableForBaseUrl`
  checks `isPageMotionPaused()` to keep an existing freeze and skip re-running the reveal warmup. Do NOT
  reintroduce per-phase freeze teardown (KN:585).
- **C-FRZ-3 — What the pause covers.** Freezes CSS animations/transitions via an extension stylesheet;
  pauses Web Animations, SVG clocks, autoplay-like media; refreshes for new animations while active;
  synthetic hover-pause to generic motion candidates (no fixed slider-library class list); locks computed
  values of moving properties (transforms/offsets/opacity/filters/position edges); a page-world timer
  bridge holds `setTimeout`/`setInterval`/`requestAnimationFrame` while paused; the content script uses
  extension-owned timers so the gate can't starve its own UI. **Freeze boundary is page content only** —
  extension UI (`#unfluffify-overlay`, indicators, popovers, `[id^="unfluffify-"]`,
  `[data-uf-extension-ui="true"]`) keeps animating (MHL:455-476).
- **C-FRZ-4 — Reveal normalization vs semantic hiding.** Layout-present elements hidden only by motion
  styling (low opacity, clip, visibility, transform, blur; Webflow `data-w-id`/`data-ix` hooks) are
  normalized to final visible posture. **Semantic hidden UI (modals, dialogs, menus, tabs, carousels,
  accordions, `aria-hidden`) MUST remain hidden.** All freeze mechanics (timer controls, inline locks,
  root pause class, stylesheet, indicator) are stripped from sanitized save snapshots (MHL:478-494).
- **C-FRZ-5 — Pause indicator [UX].** While motion is paused a small fixed snowflake/code glyph pair is
  shown as extension UI, using a content-script-injected MDI font face with Unfluffify-scoped selectors —
  never the global `.mdi` stylesheet (MHL:496-503). Extension-injected UI uses the shared
  `EXTENSION_UI_FONT_STACK` (Inter) (KN:583).
- **C-FRZ-6 — Editor activation reveal is blocking.** While the editor-role reveal runs, block page
  interaction with the inspection spinner/overlay and hold the `editor_preparing` blocking reconciliation
  reason so the user cannot interrupt reveal/freeze setup (MHL:439-444).
- **C-FRZ-7 — Render-mode inspection owns its own reveal/freeze.** Entering the Render Mode view must NOT
  run editor-acquisition reveal/freeze while the base URL still has an unconfirmed render mode. The
  explicit With/Without-JavaScript inspection action is the only Render-Mode path that may reveal/freeze:
  after reload + content-main active, one reveal pass, capture sanitized rendered HTML and static/raw
  HTML (same stripping rules as saved snapshots), **before** highlighting refresh; then local/remote data
  loading and highlighting continue (MHL:446-453, MHL:871-873).

### 1.8 Lifecycle: consent, reveal/freeze scope, silent highlighting **[PROTO]**

The USER-SPECIFIED durable contract (2026-07-01; KN:589-593, LRP:233-245):

- **C-LIFE-1 — Consent removal on ALL property pages.** Cookie-consent hiding runs on every configured
  property page (candidate or not), always/end-to-end, decoupled from reveal/freeze and candidacy — users
  must not be able to click consent buttons that mutate the DOM. Implemented by decoupling
  `hideConsentElements()` from the silent-highlight source collection and running it as soon as the
  property snapshot is confirmed (KN:553). During active marking, the mutation observer re-runs
  `hideConsentElements()` on any non-overlay childList batch (idempotent, loop-safe, currently
  un-debounced) (KN:581).
- **C-LIFE-2 — `REMOVABLE_ELEMENT_SELECTORS` is a HIGH-PRECISION allowlist.** Covers
  cookie/consent/gdpr, modal/popup/dialog/alertdialog/`aria-modal`, native `dialog[open]`,
  overlay/backdrop, interstitial, newsletter/subscribe signals across class/id/role/aria-label. Do NOT
  add generic content words (`banner`, `notice`, `toast`, `lightbox`, `paywall`, the `cmp` substring,
  `role=banner`) — they hide real content. Every non-element entry keeps `:not(body):not(html)`. Any
  addition must be validated against the live AI-submission smoke counts (bonliva 117 / prowork 76 /
  vitec-pyramid 57 included-visible) (KN:582).
- **C-LIFE-3 — Reveal/freeze runs ONLY on a candidate page, in exactly two cases:** (a) full page load
  when the render mode is already set, or (b) immediately after FIRST-TIME render-mode set (exiting the
  render-mode view). NEVER in marking mode, during render-mode decision/EDITING (re-inspect of an
  existing mode), or at any later in-session point. It runs right before silent highlighting (KN:589-591).
- **C-LIFE-4 — Silent highlighting is independent of reveal/freeze.** It renders whenever (stored
  selectors present AND marking off) — immediately post-save/in-session, or after reveal/freeze on page
  load; never gated on/held by a reveal/freeze activation completing. During an active AI preview it ALSO
  renders alongside the yellow AI-detected content (saved-vs-detected comparison). While a preview is
  displaying (`previewActive && !previewRestorePending`) the whole marking-off base condition
  (`silentModeActive` + `!isEnabled`) is waived along with clean-session gates; only a restoring/exiting
  preview or an in-flight AI compute still suppresses it. Ownership: solely the brain directive
  `shouldActivateSilentHighlighting`; content only reflects `directive.silentHighlightActive` (KN:592).
- **C-LIFE-5 — Brain `silentHighlightActive` is the STABLE intent** and must not be gated on the
  activation's own transient signals (`navigationInspectionPending`, `pageInspectionBusy`,
  `editor_preparing`) — gating there re-triggers the activation forever (perpetual "Preparing page
  content…" curtain). Only a non-`editor_preparing` reconciliation suppresses it (KN:486-495).
- **C-LIFE-6 — Popup curtain ⇒ page block.** Whenever the popup shows a blocking curtain (incl. the AI
  run), the page must also be blocked from interaction (full pageCurtain), not merely marking-disabled.
  Refined by the user to: block when popup is busy AND page interaction can affect results
  (reveal/freeze, AI run, save) (KN:593, LRP:302-317, 375-395).
- **C-LIFE-7 — Content activation at page load on ANY configured property page.** Content activates on
  `tabs.onUpdated(status==="complete")` when the tab URL matches a configured property (marking stays
  OFF) — consent hiding, reveal/freeze, and silent highlights must work with the popup never opened
  (Slice 5, KN:553; live-validated KN:555).
- **C-LIFE-8 — Editor-role pages hold the motion pause in both lifecycles.** Any page where Unfluffify
  owns the editor role holds a page-motion pause for both marking and silent-highlighting; matching
  base-URL pages stay frozen even before selector overlays exist (MHL:429-437, KN:584).

### 1.9 Silent highlighting rendering **[UX]**

- **C-SIL-1.** Three overlay layers: (1) `immutable` exclusions, (2) `content`, (3) `excluded` content.
  The 052c `links` layer is NOT part of the contract. Immutable silent highlights use a subtle dashed
  border + transparent background. Hidden implicit includes are dropped; hidden explicit includes can
  remain ghost sources; excluded sources remain collectable while temporarily hidden (renderability only
  controls whether a rect draws now). Redraws wait for tracked positions to settle after movement and
  force a repaint on full active refreshes even when the render key is unchanged (MHL:877-896).
- **C-SIL-2.** Silent-highlight overlays never capture page clicks (MHL:643-644).

### 1.10 Popup UX contracts **[UX]**

- **C-POP-1 — Preview exit button-state matrix (approved contract).** Page LOCKED (marking-edits overlay,
  `cursor-disabled`) only while the AI run is in flight (computing) or its preview is open; in every
  editable stage the page cursor stays markable.
  - State A `MARKING_FRESH`: Run AI enabled; Show Content List disabled; Save disabled; Discard disabled;
    toggle checked/enabled; page editable.
  - State B `MARKING_DIRTY` (pre-AI dirty): Run AI enabled; List disabled; Save disabled; **Discard
    enabled**; page editable.
  - computing/preview: page LOCKED; Run AI disabled; Save/Discard/List per preview matrix.
  - State C `READY_TO_SAVE` (POST_AI && !pendingChanges): Run AI disabled; List enabled; Save enabled;
    Discard enabled; page editable.
  - Post-AI edit drops the projected phase back to `MARKING_DIRTY` (underlying `store.aiRun.phase` stays
    POST_AI); Run AI re-enables; Save/List block (`REQUIRES_AI_RUN`); Discard stays enabled.
  - The dirty axis is **DETERMINISTIC, NOT fingerprints**: `currentPageHasPendingChanges =
    currentDraftDirty || reconciliationPending`; `currentDraftDirty` = dirty ONLY after a real user
    marking-toggle click (`completeExplicitToggle` → `markUserMarkingEdit`), plus
    auto-seeded/reconciliation short-circuits; cleared at clean baselines (enable, AI-run snapshot,
    disable, discard). Scroll/cursor/reflow/background re-sync NEVER flip a page dirty (KN:370-423; user
    verbatim at HO:56-58).
  - Deciders: `postAiClean = postAi && !currentPageHasPendingChanges`; Run AI disabled only when
    `actionMatrixDisabled || postAiClean`; Save/List enabled only when `postAiClean`; Discard enabled when
    `postAi || (currentPageHasPendingChanges && !pageSaveReconciliationPending)`; secondary gates return
    `REQUIRES_AI_RUN` when `!postAiClean`; an enabled button carries an empty blocked-reason (KN:414-423).
- **C-POP-2 — Save Session gating.** Save is gated by pending session changes, page controls visibility,
  reconciliation state, and `sessionRequiresAiRun` — do NOT add a second `aiRunUpToDate` fingerprint gate
  on top (that fingerprint only disables Run AI while the last AI output still matches).
  CSS-selector-only edits do not change the AI-run fingerprint (MHL:155-159). A marking session that
  changes local page markings must run AI again before save enables, and marking mode must not be
  disabled until the user saves or discards (MHL:150-152).
- **C-POP-3 — Preview Contents entry points.** Two accepted entries: (1) silent-mode "Show Content List"
  reads the latest stored selector set from config storage, enabled whenever stored selectors exist in
  silent mode, does NOT require a fresh in-session AI run, and **exit returns to the origin mode (silent
  stays silent)**; (2) marking-mode Preview Contents as a current-page verification action after a
  successful AI run matches live markings. Opening/closing a preview must not create, mutate, or dirty
  page-marking drafts (read-only; exit is state-neutral, restoring the exact pre-preview marking state).
  **Send to Lynx remains silent-highlighting-only** — hidden, disabled, and handler-guarded while marking
  is active (MHL:125-133, KN:578, KN:424-432).
- **C-POP-4 — Local drafts vs candidate completion.** Candidate completion is a backend-save fact for
  passive observers, but the current editor's popup must use the local page-marking session as source of
  truth for the Todo List, candidate `Marked` badges, marked-pages list, and Lynx checklist coverage
  while on an eligible Live Page (MHL:117-124). For non-editors and coverage accounting: local drafts are
  NOT candidate-completion evidence; use the backend-saved page-marking cache from confirmed `/load` or
  valid `/save` payloads (KN:525).
- **C-POP-5 — Todo List `Current` labels.** When the tab is a valid Live Page candidate, label BOTH the
  candidate row and its parent page-type subsection `Current` so the active page stays findable when
  subsections are collapsed (MHL:135-138, KN:526).
- **C-POP-6 — Quiet periodic candidate refresh.** Initial candidate loading may use the normal popup
  loading state; periodic refreshes run quietly and only interrupt after the fetched candidate signature
  changes: if the active page is no longer valid, stop marking + blocking alert; in all changed cases
  expand the Todo List root + warning notice (MHL:139-143).
- **C-POP-7 — Marking-mode source of truth for the toggle.** The content script is the source of truth
  for whether the page is in marking mode; popup refreshes reconcile the toggle/tab state to content's
  `getInspectionStatus.markingEnabled` without sending a redundant `setEnabled` (MHL:166-171).
- **C-POP-8 — Session save/discard semantics.** Unrelated config syncs must not upload local draft page
  markings (only backend-saved pages belong in ordinary sync payloads). The explicit session save uploads
  all local marked pages for the property as one snapshot. Discard reloads the saved backend state and
  forces the current page entry to reload in content so no live draft survives (MHL:144-152, KN:527).
- **C-POP-9 — Popup notices are sanctioned local derivation.** `pageDraftStatusText`/
  `pageSessionNoticeVisible`/`aiDirtyNoticeVisible` are computed by the shared pure
  `buildPageSaveUiState` from brain-owned facts; byte-identical to a brain projection; do NOT re-flag for
  brain projection (Audit 3 decision) (KN:600).

### 1.11 Spinner / curtain contracts **[UX]**

- **C-SPIN-1 — Event-first busy state.** Content emits lifecycle events for readiness, marking
  activation, render-mode inspection, reveal/freeze progress, HTML capture, finish, failure. Popup
  spinners are current background state, not session-storage replay: popup-owned spinners call background
  `ufSpinnerSet`/`ufSpinnerRemove`/`ufSpinnerClear`; the popup mirrors `getUfBackgroundState` /
  `ufPopupState:<tabId>`. Polls like `getInspectionStatus` are fallback/diagnostic only (MHL:172-180).
- **C-SPIN-2 — Surface vocabulary only (P4 doctrine).** The brain broadcasts
  `{kind, phase, startedAt, deadlineAt, operationId, reason?, spinnerKey?}` — never composed display
  strings. Every layer resolves presentation locally: popup from the shared phase-definition table
  (`common/spinner-contract.ts`) with machine-state memories overriding; content from
  `resolveContentOverlayMemory(machineState)` first, then the table. `deriveDictation` and
  `phaseToSpinnerState` are DELETED; `session.dictation` is a phase pointer `{phase}` only (KN:616).
- **C-SPIN-3 — No popup-local spinner state.** `src/popup/spinner.ts` is deleted; popup operations hold a
  brain broker LEASE (`runWithBrainSpinnerLease`); the navigation-inspection spinner's single writer is
  the brain's lifecycle selection; gates observe `hasProjectedNavigationInspectionSpinner()` (KN:617).
- **C-SPIN-4 — Single curtain (no stacked spinners).** The content curtain renderer must not raise both
  the page-inspection notice and the popup-busy overlay: the orchestrator computes `pageBlocking` first
  and calls `setPageInspectionUiActive(visible, { suppressNotice: pageBlocking })`;
  `setPopupBusyOnPage` stays INDEPENDENT of the page-inspection UI (dedup lives in the orchestrator, not
  cross-references); semantic active state is `state.pageInspectionUiEnabled` so `inspectionSettled`
  still reports while the notice is visually suppressed (KN:551).
- **C-SPIN-5 — Deterministic curtain settle.** The popup curtain is driven by the
  `navigationInspectionPending` fact; content emits `inspectionSettled` (fired in
  `finishPageInspectionUi`, and ALSO from the editor activation's `.finally()`), so the fact clears
  deterministically; settle safety is a single bounded one-shot fail-open deadline (no polling)
  (KN:453-461, LRP:155-183).
- **C-SPIN-6 — Spinner recovery policies (MV3 suspension).** `projectSurface` enforces recovery: a
  selection past `deadlineAt + 30s grace` or `startedAt + maxDurationMs + 30s` projects null (fail-open);
  `runBackgroundTabOperation` holds `swKeepAlive` for the operation's lifetime (KN:547 item (2)).
- **C-SPIN-7 — Countdown clocks.** Visible 1s countdown timers are display clocks and exempt from any
  "no setInterval" source guard; page-motion 250ms refresh and silent-highlight dwell also stay
  (no DOM event exists for them) (KN:461-467).

### 1.12 Property lock protocol **[PROTO]**

- **C-LOCK-1 — Ownership.** Content connects to the property-lock background service as soon as the page
  resolves to a Live Page candidate property; connection lives while the tab stays on a candidate page of
  that property. Landing on an eligible Live Page queues the editor claim immediately (claiming no longer
  waits for marking enable). Lock identity = stable page-session client ID in `sessionStorage`, NOT the
  Chrome tab ID (tab IDs only as local popup-routing hints). A duplicated/cloned tab copies
  `sessionStorage`, so the extension must rotate the new tab onto a fresh client ID before lock state,
  popup routing, or observer/editor decisions derive from it. First client on an eligible candidate
  requests the lock and becomes editor when the server grants; every other client for the same property
  is passive and shows locked UI **even for the same authenticated user** (PL:9-27).
- **C-LOCK-2 — Same-user tabs.** Passive tab shows "You are already editing this property in another
  tab". If the active editor tab has no unsaved changes: `Continue editing here` transfers the local
  editor session. With unsaved changes: that action is disabled, UI shows "Other tab has unsaved
  changes", and `Continue editing here anyway` transfers while discarding the previous tab's draft
  (PL:29-39).
- **C-LOCK-3 — Heartbeat/release timing (exact numbers).** Editor heartbeats every **30s** while the
  editor interacted within the last **30 minutes**; after 30 minutes idle, heartbeats stop and the lock
  is expected to lapse after the server's warning window. Connectivity loss → editor sees a **70s**
  countdown (role lost unless connection recovers). Editor on a same-property page that is no longer a
  candidate → **70s** countdown mirrored by content and popup from tab-scoped initial state; expiry sends
  `release_lock`. Navigation to a DIFFERENT property → the previous property's editor session stays
  recoverable for **30s** (cross-property cooldown stored in initial tab state: `siteId`, `baseUrl`,
  `clientId`, `deadlineAt`); returning restores the same client session; expiry sends `release_lock` for
  the old property by stored siteId+clientId. Tab close → background immediately sends `release_lock` and
  disposes (no 70s port-disconnect grace). Passive subscribers see a **60s** "property will be released"
  countdown before release; if the editor recovers, passive UI returns to the ordinary locked banner
  (PL:41-68, KN:594-596).
- **C-LOCK-4 — Render-mode inspection reloads are expected.** During the inspection window the editor
  sees a reconnecting-after-inspection status instead of the 70s connection-loss countdown; after
  re-injection the popup explicitly re-claims the lock, then polls the snapshot until connected/inactive
  (PL:58-62).
- **C-LOCK-5 — Connectivity checking.** WebSocket state alone is not the network signal; independent
  stable HTTP endpoints are also checked (PL:70-72).
- **C-LOCK-6 — Takeover flow.** Passive shows `Suggest to take over`; editor sees the sender's name with
  accept/reject. Reject notifies the requester. Accept with unsaved changes asks save-and-sync vs
  discard; saving must complete backend sync + reload reconciliation before the transfer is accepted.
  During transfer both parties see "Editing is being transferred from User A to User B"; after, the new
  editor gets a toast and the previous editor becomes passive (PL:81-98).
- **C-LOCK-7 — Data freshness.** The current editor's page session is the single source of truth;
  ordinary periodic remote loads must not replace the editor's local draft. When a passive tab becomes
  editor, the popup fetches the latest upstream payload ONCE and fully replaces that tab's local property
  data; after that bootstrap the editor stops calling `/load` and local saves stay authoritative until
  the explicit backend save. Passive observers keep periodic loads (max once/minute); replacement is
  silent apart from a short-lived toast (PL:100-113).
- **C-LOCK-8 — Extension lifecycle.** `Extension context invalidated` is a terminal signal for that
  content-script instance: clear reconnect timers, disconnect the local port without notifying
  background, reset local lock UI, wait for a fresh instance. Ordinary unexpected port disconnects still
  reset UI and schedule reconnects (PL:115-127, KN:288-289).
- **C-LOCK-9 — Popup warning rendering.** Mirrored initial-tab-state countdowns are authoritative UI
  state; cross-property and off-candidate warnings render even when the freshly fetched live lock
  snapshot is inactive/unavailable/no longer `isEditor` (PL:74-80, KN:597).
- **C-LOCK-10 — Off-candidate pages keep silent highlighting.** Same-property pages outside the current
  candidate list keep silent highlighting and property-lock visibility; only marking entry is blocked
  there; the popup must not collapse the whole page UI (MHL:865-867, KN:588).

### 1.13 Mobile emulation **[PROTO]/[UX]**

- **C-EMU-1.** Opening Unfluffify enables mobile simulation by default per fresh tab session (including
  when an already-open side panel moves to a new tab). A user-disabled simulation state is preserved for
  that session while marking is off, but the **active marking editor tab forces mobile simulation back
  on until marking is disabled**; Render-Mode inspection must not clear an existing session simulation
  choice (MHL:854-859, KN:586). Verified in code: `ensureDefaultMobileDeviceEmulation` forces
  `enabled:true` on activation; the `deviceEmulationToggle` flag only blocks DISABLING (CM-02 §4).
- **C-EMU-2 — Desktop preview.** When the property already has AI selectors, the popup exposes a
  desktop-preview checkbox persisting for the tab lifecycle: switches to desktop emulation, keeps silent
  previewing available, disables marking entry while on, and falls back to forced mobile if DevTools
  tears the emulation debugger down (MHL:860-863, KN:587).

### 1.14 Page save / candidate completion / backend data **[PROTO]**

- **C-SAVE-1 — pageType is mandatory.** Every saved page marking must carry a valid candidate-resolved
  `pageType` (backend `PageMarking.PageType` is `[JsonRequired]`; validation rejects blank/unknown).
  `refreshUi` repairs pageTypes on LOCAL draft markings via `repairLocalPageMarkingPageTypes` before save;
  without it the blank-pageType page is dropped/rejected, never persists, coverage stays empty AND the
  page stays dirty, which also suppresses silent highlighting (KN:529).
- **C-SAVE-2 — Page-type taxonomy is backend-sourced and dynamic.** Backend owns it
  (`Dtos/PageTypeTaxonomy.cs`, `GET /page-types`, authorized); the extension caches it in
  `chrome.storage.local` (`pageTypeTaxonomy`) and reads through `src/common/page-type-taxonomy.ts`; only
  the TOP level is consumed today; `DEFAULT_PAGE_TYPE_TAXONOMY` is the offline fallback and must stay in
  sync with the backend (KN:530).
- **C-SAVE-3 — Save reconciliation must confirm.** Page-save reconciliation must NOT clear merely because
  `/save` returned OK; the forced backend reload must confirm the current page is present in the
  backend-saved cache (KN:531).
- **C-SAVE-4 — Empty/partial responses never destroy local.** Empty or partial `/load`/`/save` responses
  must not replace local saved page snapshots or clear the backend-saved cache; merge confirmed save
  payloads and incoming remote entries by timestamp (KN:528).
- **C-SAVE-5 — Default-markings save.** A page with no local or remote saved data must remain saveable
  even when the user accepts default markings as-is with no manual toggles (KN:532).
- **C-SAVE-6 — Save replaces local from the save-response snapshot (#15/#12).** After a successful page
  save, local is rebuilt from the `/save` RESPONSE snapshot the same way `/load` does
  (`replaceServerConfigIntoLocalSnapshot`), scoped to the save caller only — this is what updates
  `backendSavedPageMarkings` so the Lynx checklist marks the candidate done and Send-to-Lynx unlocks
  (LRP:36-83).
- **C-SAVE-7 — Send-to-Lynx staleness guard (fail-closed).** Backend `cssInfo(url)` GraphQL is the source
  of truth. On checklist popover open — only once page-type coverage is complete — the popup compares
  SANITIZED selector sets (split commas, trim, collapse whitespace, order-insensitive set equality per
  inclusion+exclusion field, no case folding) against the exact submit payload. FAIL-CLOSED: send
  disabled while pending / on a both-field match / on check failure (reopen retries).
  `usesUnfluffify:false` or an empty backend never blocks; our submit flips it true (KN:621).

### 1.15 Brain / signal / state doctrine (rewrite-relevant architecture contracts) **[PROTO]**

- **C-BRAIN-1 — Reflex-arc doctrine.** The brain keeps DECISION authority and OBSERVES; each layer runs
  mechanical, deterministic, locally-orchestrated routines (muscle memory) moved ONLY by discrete
  signals through predefined transition tables, each state applying a COMPLETE memorized presentation
  including spinner/curtain content. Signals are EVENTS born at the source with provenance + per-tab
  sequence + once-only consumption (pull-cursor) — never reconstructed downstream from re-served level
  snapshots (RAP:25-49, KN:613-615).
- **C-BRAIN-2 — Sticky facts must be republished on reset.** Session-fact reporting is sticky per layer
  (popup/content each re-serve merged snapshots to the 1s heartbeat pull). Any state teardown that resets
  a fact's local source WITHOUT republishing leaves a stale sticky value the heartbeat re-folds forever
  (fact/directive flap class) (KN:603).
- **C-BRAIN-3 — Popup fact seq discipline.** Popup facts carry a monotonic per-popup-session `seq`
  stamped at `refreshUiInner` START (compute time, not send time), a COUNTER not a wall clock; the brain
  drops popup reports with stale seq per tab; reset on popup port (re)connect; untagged reports always
  apply (KN:438-451).
- **C-BRAIN-4 — Projection broadcasts deduped, content directive NOT.** `publishProjectedState` caches
  the last broadcast per tab and re-publishes `VIEW_UPDATED`/spinner surfaces only on content change
  (cache reset on popup reconnect); `directive.content` is intentionally NOT deduped (push-only
  subscription; a freshly reloaded content script must still receive the current directive) (KN:468-485).
- **C-BRAIN-5 — Marking-session epoch write discipline.** Every popup-initiated marking transition bumps
  `state.markingSessionEpoch`; each `refreshUiInner` pass captures the epoch at start; a STALE pass skips
  marking-fact publishes and enabled-flip writes; time/count windows CANNOT fix this class. The post-exit
  restore also needs the RAISE-ONLY `previewCloseMarkingRestoreUnconfirmed` observation latch;
  `previewSuppressReopen` is a durable latch cleared only by the next in-popup open (KN:606-611).
- **C-BRAIN-6 — Criterion-4 trap.** Brain dictation locks the enable toggle for POST_AI so runs resolve
  via Save/Discard — but Save/Discard are hidden in silent mode, so `postAi` must lock **only while
  `facts.isEnabled`**; the popup resets its POST_AI mirror on real navigation (beyond-hash URL change)
  (KN:611).
- **C-BRAIN-7 — Discard settles marking-active.** `applyLocalPageDiscard` publishes settled facts AT the
  new epoch right after the bump+signal: `{isEnabled:true, silentModeActive:false, aiRunPhase:PRE_AI,
  aiRunUpToDate:false, previewActive:false, previewBlocked:false, currentDraftDirty:false,
  discarding:false, sessionHasPendingChanges:false}`. The preview fields + `aiRunUpToDate:false` are
  LOAD-BEARING (brain AI-run authority handover `shouldKeepBrainAiRunAuthority` requires the reported
  patch itself to be a full clean reset). Disable-flow discard stays silent (KN:549, HO:47-98).
- **C-BRAIN-8 — Preview sidebar is popup-owned.** Visibility/items driven by `previewOpenIntent`,
  `previewSuppressReopen`, and the item latch; all three open paths must set intent + reset the latch;
  `resolveOpenPreviewItems` is the single item authority; "No content detected" is a CONFIRMED verdict
  requiring qualifying observations sustained 3s (KN:605, HO:349-364).
- **C-BRAIN-9 — `silentModeActive` publishes PAGE state.** The popup-published fact reflects
  `!pageScopedUiDisabled && renderModeReady && !isEnabled`, never the popup `currentView` (KN:496-503).
- **C-BRAIN-10 — POST_AI mirror.** The popup's `state.sessionAiRunPhase` mirror must reach POST_AI on run
  completion (drives the brain's clean-reset handover and guarantees the `EXITED` ai-run event on preview
  exit) (KN:604).
- **C-BRAIN-11 — Cross-URL navigation disposes tab state.** `disableExtensionOnTopLevelNavigation`
  detects a cross-URL navigation and calls `disposeTabState(tabId)` (clears AI compute lock, spinner
  queue, lifecycle, world-trace) — scoped to cross-URL so same-URL reloads (incl. render-mode inspection
  reloads) keep in-flight state; the marking disable stays unconditional. `brain.disposeTab` is NOT
  usable for navigation reset (it deletes `popupPortCounts`) (KN:552).
- **C-BRAIN-12 — Legacy activation handshake.** `chrome.tabs.sendMessage(tabId,
  {type:"activateContentMain"})` must keep returning `{ok:true, initialized:true}`
  (`ensureContentMainForTab` depends on it) (KN:204-209).
- **C-BRAIN-13 — Storage/messaging boundaries.** Chrome storage access restricted to approved
  storage/domain modules (`tests/storage-access-boundary.test.ts`); popup tab-runtime snapshots flow
  through `POPUP_GET_TAB_VIEW_STATE`; popup/content→background one-shots stay on the raw runtime-message
  shape (the `@webext-core/messaging` envelope does not reach the MV3 worker); background→content may use
  the package envelope (KN:303-358).

---

## PART 2 — PAIN REGISTER

Status legend: **FIXED** (fixed in legacy main), **DEFERRED** (documented, not fixed),
**RETRACTED** (misdiagnosis), **ACCEPTED** (known cost, deliberate), **GOTCHA** (QA/tooling knowledge).

### 2.1 Marking-model bugs (all FIXED, all instructive for a rewrite)

| # | Pain | Root cause | Status | Source |
|---|------|-----------|--------|--------|
| P1 | Unmarked pages with stored AI selectors rendered ZERO exclusion rows ("defaults appear included"); assessment flipped on first user mark; sessions dirty from enable (S1/S2) | `seedMarkingsFromAiSelectorsForUnmarkedPage` pushed seeded rows WITHOUT `explicit:true` → sync reconcile dropped them same-render while they suppressed ~70 generated default rows; `hasExplicitUserMarkings` stayed false so wipe-and-reseed re-ran every rebuild. Latent day-one defect activated once computed selector sets persisted | FIXED (seed rows carry `explicit:true`) | KN:545, MHL:282-292 |
| P2 | Marking/silent boxes collapsed or drifted on scroll, worst in silent mode (S3) | Mid-scroll `elementsFromPoint` verdicts persisted into CP7a caches; silent mode never invalidated (scroll handler early-returned before the version bump when disabled) | FIXED (bump before mode guards; `isScrolling` makes paint-reachability unknowable; disable() bumps) | KN:545 |
| P3 | "Unmark → element goes blank (hover still works)" — misdiagnosed TWICE before the architect's model | Render re-applied initial-state rules (selector/default match) to un-excluded elements, catching them between "not drawn excluded" and "not drawn content". Two facets: leaf toggleable-default BUTTON filtered out of both collections; selector re-caught un-excluded elements | FIXED (forceIncludeSet for leaf boundaries; suppressed-selector set derived from `{excluded:false}` rows); codified as the first non-negotiable invariant | KN:555, MHL:23-43 |
| P4 | User-unmarked selector-seeded element re-excluded + resubmitted excluded (unmark reverted) | Auto-seed re-ran because `{excluded:false}` on a non-default selector match doesn't count as a user mark for `hasExplicitUserMarkings` → page still read "unmarked" | FIXED (seed guard: `hasUserMarkingEdit` \|\| `entryHasSelectorSuppressedXpaths` \|\| one-shot suppression) | KN:550 |
| P5 | Unmarking a default boundary took 2 clicks | First click wrote a redundant `{excluded:true, explicit:true}` (visually identical); reseed also fought the unmark | FIXED (first click records `{excluded:false}`) | KN:550, MHL:294-300 |
| P6 | Green include borders ~50% missing | `drawExplicitMarkingLayers` drew visible explicit includes only from paint-reachability-filtered rects; transiently covered/just-toggled includes dropped | FIXED (`computeIncludeRects` falls back to raw ghost geometry) | KN:550 |
| P7 | FAQ header span unmarkable (acnespecialisten accordion) | Page sets `pointer-events:none` on header text spans → never in any hit stack → scan-path paint-reachability false → dropped from default layer and untargetable | FIXED (topmost-hit ancestor counts reachable through a pointer-events-suppressed chain; composed hit path surfaces suppressed descendants) | KN:547 item (3) |
| P8 | Unmarked default leaf BUTTON lost all marking UI | Anti-ghost self-suppression applied unconditionally; leaf boundary had no descendant surface to render instead | FIXED (self-suppression only with textual descendants) | KN:547 item (4) |
| P9 | Widening: Shift-click on a deep full-width wrapper selected the whole content column (F2); shell guard silently OFF inside shadow roots (F5) | Shell guard self-disabled at depth>2; widen eligibility needed only ≥1 markable descendant; `getDepthBelowBody` returned ∞ in shadow | FIXED (any-depth landmark-based rejection; flattened-parent depth walk) | MWR:31,34, KN:542 |
| P10 | Real footers rejected as widen targets (bonliva `div.footer5_component`) | Broad-footprint disjunct made real footers dimensionally indistinguishable from content columns | FIXED (landmark-only rejection; accepted tradeoff: landmark-less full-width columns widen-eligible again) | KN:546 N1 |
| P11 | Baseline submitted a dead row to the AI (`…/svg[1]/title[1]`, unresolvable by standard XPath) | svg not in the immutable tag list pre-CP1 | FIXED (CP1: SVG immutable; row class eliminated) | MIP:245-266 |

### 2.2 Lifecycle / state-machine bugs

| # | Pain | Root cause | Status | Source |
|---|------|-----------|--------|--------|
| P12 | **#5/#14 post-exit collapse** (the program's motivating bug): after AI preview exit, sidebar reopened, marking session silently collapsed to silent, Save unreachable — permanent wedge | Interleaved stale `refreshUiInner` passes (4-8s on heavy pages) published `isEnabled:false` computed from reads that predate the exit settle → brain folded SILENT → dictation disabled content → content genuinely disabled. Plus the "content wins" toggle sync firing from the same stale reads, and a `previewBlocked` echo loop (popup republished a brain-dictated view field as a fact, self-sustaining across restarts/navigations) | FIXED at source (P5 refresh-cadence removal; epoch + latch guards remain belt-and-suspenders). Class doctrine: gate at the moment of effect with pass-epochs; time windows can never fix it | KN:606-620, HO:415-495 |
| P13 | **False `markings-changed` signal** at ~+45s post-exit moved the (correct) popup machine wrongly | Content's post-exit config-sync merge (`handleEnabledSameBaseUpdate` mergeDraftEntry) rewrote the draft entry; draft-status flipped clean→dirty with no user edit; downstream edge-detection can't tell user edits from internal reshapes | FIXED (P3 provenance: `markings.changed` emitted ONLY for `user-marking-edit`); doctrine: signals born at source with provenance | HO:415-426, RAP:284-297 |
| P14 | **Post-AI CPU peg** (~1 full O(document) render/sec for 2h+, popup repaint frozen) — N2 | Layer 1: stuck `previewActive` oscillation (non-epoch-gated publish resurrected a torn-down preview) flapping the `silentHighlightActive` directive → `scheduleRender` storm. Layer 2 (dominant, ~35% self-time): `refreshPageMotionPause()` full-document scan on a 250ms timer AND every MutationObserver batch, feeding its own observer (self-sustaining loop); observer rescheduled via rAF up to ~60x/sec | FIXED (epoch-gated `previewActive`; storm-breaker skip; full sweep only at engage points; observer only populates `pendingDiscovery`, 250ms timer drains). Idle CPU 97.6%→53.6%→resolved | KN:546 N2, KN:548 |
| P15 | **Post-discard "marking UI vanishes"** (silent layers rendered though marking still enabled; Save/Discard/Show-List disabled; recover by toggling off/on). Was the release blocker in HO §1 | Discard bumped the epoch (staling every in-flight pass, which then publish NO marking facts) and never re-asserted `isEnabled` — the brain stayed SILENT forever. Previously masked by the ~60x/sec motion re-render (P14's fix unmasked it) | FIXED (discard publishes settled facts at the new epoch; preview/`aiRunUpToDate` fields load-bearing; `dirty` contract cleaned: `submissionXpathsStale` OR-term removed) | KN:549, HO:1-166 |
| P16 | Marking non-responsive symptom "each marking target drawn multiple times" | Same as P14 layer 2 — motion reassert style writes thrashed the highlight render | FIXED (freq cap 688a818) | KN:548 |
| P17 | Reveal ritual broken cold (six extra lazy expansions, 3.8k→29k px; bottom never reached) | Three lock-revocation paths: overlapping warmups' id-bump abort released the page-world lazy-load lock under the survivor; a walk that skipped engagement released a lock it didn't own; unpaused-subsystem resume unconditionally restored suppression | FIXED (warmups JOIN; only the engaging walk releases; resume gated on `pageRevealWarmupInFlight`; freeze rides `pauseAtBottom`) | HO:309-347, KN:269-286 |
| P18 | Stuck render-mode inspection curtain ("Starting render-mode inspection / Working…") | Overlapping `refreshUiInner` passes: an early `applyCentralSessionDictation` + long async tail overwrote the cleared curtain with a stale `true` | FIXED (dictation applied as the LAST mutation immediately before the synchronous `setViewState`) | LRP:124-153 |
| P19 | Stuck "Preparing page content…" curtain after reveal/freeze (~1 in 3 fresh candidates) | `pending = inspectionActive \|\| editorPreparationPending \|\| reconciliationPending` but only `inspectionActive` fired `inspectionSettled`; `editorPreparationPending` cleared later with no event | FIXED (fire `notifyInspectionSettled()` in the activation's `.finally()`; 8/8 clear) | LRP:155-183 |
| P20 | Stuck render-mode spinner (sporadic, longest operation) | MV3 idle suspension: spinner SELECTIONS persisted in `chrome.storage.session` while the queue + REMOVE lived in SW memory — a suspension lost the REMOVE forever | FIXED (recovery policies in `projectSurface` + `swKeepAlive` for tab operations) | KN:547 item (2) |
| P21 | Config-view exit dead popup (fresh install / expired JWT) — "Unable to resolve domainId" latch | Navigation-time brain siteId resolution ran without credentials; post-config every refresh re-discovered the property but `currentSiteId` only read projected/config sources → page types never fetched, /load skipped, `siteIdReady` false forever | FIXED (`refreshUiInner` adopts pass-discovered siteId as last fallback, never persisted) | KN:547 item (1) |
| P22 | Double curtain spinner during freeze/reveal + AI run (BUG 6) | Content curtain renderer raised BOTH the page-inspection notice and the popup-busy overlay | FIXED (suppressNotice orchestration; see C-SPIN-4) | KN:551 |
| P23 | Cross-property navigation leaked session state (stale compute lock / spinner queue blocked a fresh Run AI) (BUG 3.2/3.3) | No tab-state disposal on cross-URL navigation | FIXED (`disposeTabState` on cross-URL nav; same-URL reloads keep state) | KN:552 |
| P24 | Consent not hidden / no silent highlights / wrong activation order on property pages where the popup was never opened (BUGs 3.1/4/5) | Content activation gated on popup bootstrap (`initial.active`); consent hiding coupled inside silent-source collection | FIXED (activate on configured-property page load; consent decoupled + run before directive early-return) | KN:553 |
| P25 | "Show Content List" failed silently on a state race | Defensive re-check silently returned on a blocked reason between render (enabled) and click | FIXED (always surface `PopupText.preview.openFailed`) | KN:554 |
| P26 | Silent "Show Content List" disabled Send-to-Lynx + Show-Content-List after exit (N4) | The silent preview wrongly captured a marking-session snapshot → `previewCloseMarkingRestoreUnconfirmed` never cleared in silent → clamped `silentModeActive:false` | FIXED (silent preview never snapshots) | KN:546 N4 |
| P27 | AI-run curtain stayed up during slow preview open (#4/N3); Discard confirm delayed behind a slow roundtrip (#5) | Curtain teardown ordered after `requestTabShowAiPreview`; `confirm()` after `refreshCurrentPageRuntimeStatus` | FIXED (run-completed FSM signal tears curtain at results-applied; confirm before roundtrips; discard applies local first, reconciles non-blocking) | KN:546 |
| P28 | Save wiped pages / coverage empty: `/save` uploaded `pageMarkings: {}` although the user had marked + run AI (live QA #5) | The marked page never reached the shared config at upload time; committed pageType-repair fix operated on entries not yet present (insufficient). Root confirmed later in the save-payload/pageType-key chain: blank draft `pageType` → `buildPageMarkingKey` returned "" → page dropped from payload | FIXED across several passes (pageType repair on local drafts + resolved-pageType filter + save-response replace #15/#12); flagged as the class behind the production half-snapshot wipe | LRP:331-451, KN:529 |
| P29 | Silent highlights suppressed post-save | Consequence of P28: backend-saved cache empty → `current != backend` kept `currentPageHasPendingChanges` true → directive suppressed | FIXED with P28 chain | LRP:360-373 |
| P30 | Marking clicks looked ignored on heavy pages | Payload construction ran before busy feedback painted | FIXED (C-SUB-6 ordering) | MHL:759-764 |
| P31 | Signal-pairing wedge: "the spinner is stuck" (twice) | `inspection./reconciliation.` edges emitted only inside `foldSessionFacts`, but `sessionDictation` was rewritten by other mutate paths → closing edge never born | FIXED (store `mutate` wrapped at creation — the single choke point; per-cycle payload+dedupeKey; 30s fail-open popup parachute) | HO:280-293 |
| P32 | Popup empty "No content detected" while content held items; open list oscillated 130↔0 | Transient `tabInScope=false` passes wrote the empty no-probe default past the session latch; stale pre-open probe armed the settled-empty memory | FIXED (out-of-scope passes keep popup-owned state; "no content" requires a 3s-sustained confirmed verdict) | KN:605,610, HO:349-364 |
| P33 | Main UI stuck hidden after marking enable on first-visit/slow-load | Out-of-order full facts publishes from overlapping `refreshUiInner` runs; stale run was last writer of `mainUiHidden` | FIXED (per-tab seq gate, compute-time stamp, counter not wall clock) | KN:438-451 |
| P34 | Unbounded publish→fold→project→apply→publish loop (~200 projections/sec) remounting popup inputs (typed characters lost) | Store bumped version and re-projected on EVERY fold including no-op folds; popup re-published on every applied projection | FIXED (per-tab broadcast dedupe; content directive exempt) | KN:468-485 |
| P35 | `silentModeActive` fact oscillation | Popup published a view-gated value (false on config view) while content reported the page truth | FIXED (publish page state; keep the view-gated variant local) | KN:496-503 |

### 2.3 Deferred / open items (NOT fixed in legacy main)

| # | Item | Detail | Source |
|---|------|--------|--------|
| D1 | **Same-URL-refresh popup session reset** | The popup only resets its AI-run mirror on URL CHANGE; a same-URL refresh keeps stale AI-run/preview state (candidate cause of checkbox-stuck 3.4 + preview-after-refresh 3.3). Needs live repro | KN:552 |
| D2 | **Narrow brain tab-reset on navigation** | A full brain session reset on navigation needs a NEW method (`store.dispose(tabId)` + projection-cache reset preserving `popupPortCounts`) — architecture-sensitive, deferred | KN:552 |
| D3 | **Task #18: fail-open API audit** | Audit ALL fail-open API calls so the architect can flip some to fail-closed (queued for his decision table) | HO:183-187, KN:621 |
| D4 | **#16 stacked spinner cards** (low) | Tracked, not fixed | HO:547 |
| D5 | **"Waiting for AI results" curtain re-asserts ~200ms mid-open-preview** | Pre-exit only, self-clears | HO:545-546 |
| D6 | **Motion-lock reassert cost on Webflow-class pages** | ~799 locked elements (800 cap) re-applied every 250ms; acceptable now; future: reassert only observer-flagged dirty locks | KN:548 |
| D7 | **`getCollapsedTextualFallbackRects` is light-DOM-only** (CP6 residual) + broad shadow marking wants an on-page acceptance pass on cramo | KN:562, MIP:140-141 |
| D8 | **sessionCurtainPhase pointer flaps ~2s during exit settles** (fold churn; no surface renders from it) | HO:230-232 |
| D9 | **Curtain/spinner ownership migration** | Architect direction: curtain+spinner ownership belongs to each layer's orchestrator (predicted async routing machine); brain becomes signal+observe only. Partially realized by P4-P6; the full model was NOT completed in legacy | KN:549, HO:47-53 |
| D10 | **`aiRunMarkingsFingerprint` is decision-dead** (stored, never compared; capture/reset only matter for phase side effects) — separable cleanup, ~15 test pins | KN:549 |
| D11 | **pageTypeAssignments feature flag** stays false until the backend endpoint lands | HO:185-186 |
| D12 | **signalHead on the dictation pointer** deferred until a consumer exists | HO:187 |
| D13 | **DISCARDING session phase is dead** (no `discarding:true` publish exists anywhere) | HO:110-111 |
| D14 | **`GET /page-types` 404 on the stage backend** at last check (taxonomy live-validation deferred) | LRP:436-438 |
| D15 | **Un-debounced consent re-run on mutation batches** — fold into a throttled path if a highly mutating page shows cost | KN:581 |
| D16 | **Broadened content-engine activation perf** — running on all configured property pages (not only popup-engaged tabs) was flagged RISK: live-validate perf + reveal-once-per-visit | KN:553 |

### 2.4 Retracted / misdiagnoses (learn from these)

| # | Misdiagnosis | Correction | Source |
|---|-------------|-----------|--------|
| M1 | "Mobile emulation is not enforced" (tracer saw `deviceEmulationToggle:false`) | The flag only blocks DISABLING; `ensureDefaultMobileDeviceEmulation` forces mobile ON. Q-E downgraded to a detail | CM-02 §4, CM-03:180-186 |
| M2 | "The brain only drives a tab's directives when a popup exists" | Really "the brain needs a fold trigger" — content activation is one; directives broadcast unconditionally per fold | KN:553 vs KN:137-139 |
| M3 | The unmark→blank bug was twice mis-fixed (seed-guard durability fix ≠ the render blank) before @Sojaner's "rules step aside" model settled it | The invariant is now documented expressly to prevent that drift | KN:555 |
| M4 | Live-QA findings #1/#2/#3 (2026-07-01): "discard does nothing / cannot disable marking / navigation silently stopped" | HARNESS ARTIFACTS — a persistent Playwright `connectOverCDP` auto-dismisses `window.confirm` | LRP:223-231 |
| M5 | The committed #5 pageType-repair fix believed sufficient | Live capture of the `/save` body showed `pageMarkings:{}` — the repair ran on entries absent at upload time | LRP:397-417 |
| M6 | Early hypothesis for the stuck render-mode curtain (brain busyVisible loop) | Actual: stale late `setViewState` overwrite (P18) | LRP:129-137 |
| M7 | Round-3 belief that epoch-gating alone fixes the stale-pass class | A pass can start AFTER the settle (same epoch) and still read mid-restore content; six mechanisms were needed; final fix was removing the cadence (P5) | HO:444-455, KN:620 |

### 2.5 Live-QA gotchas (tooling/institutional knowledge worth keeping)

- Exclude-mode clicks on an ALREADY-excluded element resolve to no target — a designed no-op; scripted
  click harnesses must land on content not covered by an existing `.uf-rect` (auto-seeded drafts flipping
  `sessionHasPendingChanges` is NOT proof a click landed) (KN:106-115).
- CDP `DOMDebugger.getEventListeners` cannot see isolated-world listeners; probe with dispatched events
  (KN:116-121). Background popup tabs get throttled/frozen by Chrome and wedge their CDP socket — keep QA
  popups in their own focused window (KN:121-124). A tab stuck on an unhandled `beforeunload` dialog
  blocks its whole CDP target (KN:125-128).
- Never `tabs.reload` after `runtime.reload` — orphaned content-script instances answer probes
  nondeterministically; always full-navigate (KN:129-131, KN:608).
- The persistent profile CACHES the MV3 service worker — after any rebuild the running SW is STALE; clear
  `Service Worker/{ScriptCache,Database}` or `chrome.runtime.reload()` (KN:504-510, LRP:117-118,188-189).
- The brain persists per-tab state in `chrome.storage.session["brain:state-store"]`; a stale preview-open
  there survives SW reload/navigation and is self-sustained by the popup republish loop (KN:608).
- A lingering Playwright `connectOverCDP` auto-dismisses `confirm()` dialogs — use raw-CDP WebSocket for
  dialog flows (KN:549, LRP:223-231). Extension auth lives in `Default/Local Extension Settings/<ext-id>`
  — never delete it when clearing profile state (KN:612).
- Reveal/freeze measurement: attach the CDP sampler BEFORE navigating; cold vs warm arms must both keep a
  popup present; COLD = fresh extension + fresh page, WARM = refresh (synced entries appear only after the
  first visit) (KN:132-139).
- 250ms/2s samplers and short windows produce FALSE PASSES — the per-frame harness (`run-flow2.mjs`:
  screencast PNG-per-repaint, 100ms change-only sampling, 6-minute post-exit hands-off window) is the
  acceptance rig for #5-family work (KN:612, HO:390-393).
- Endpoints gotcha: the AI endpoint must include the `:8443` port (`https://unfluffify.dnscdn.se:8443`);
  bare host returns Cloudflare 525. Clearing the `/load` config DB does NOT clear GraphQL Live Pages or
  cssInfo selector history (KN:623).
- Debug-gated DIRECT MODE (test-only marking on unconfigured pages) requires BOTH a debug build
  (`pnpm build:debug` → `__UF_DEBUG_BUILD__`) and `popup.html?debugTabId=<id>&directMode=1`; production
  never honors the param; scope is marking/enumeration/overlay only (save + AI-run stay gated) (KN:60-76).

---

## PART 3 — QA DECISION LOG (locked decisions that constrain design)

### 3.1 Content-marking semantics Q&A (`content-marking/04-qa-decisions.md`)

| # | Decision | Result | Constraint |
|---|----------|--------|-----------|
| D1 | Interaction-gated/hidden content | **LOCKED: do NOT auto-reveal-and-include.** Accordion bodies, inactive tabs, "read more", carousel slides, modals stay excluded by default. The user's path: Space passthrough to expand → explicit include that overrides hidden state. Harden items: revealed element must be markable (no stale visibility cache); include must persist into saved `renderedHtml`; motion pause must never re-collapse a user expand (CM-04:11-48; verified as CP8/D1, MIP:214-227, KN:544) |
| D2 | Noise-by-convention heuristics | **LOCKED: heuristic-free.** No auto-exclusion of ads/social/"related"/breadcrumbs by class/role/name. Symmetric with D1: the tool never auto-DECIDES an uncertain case in either direction; a false auto-exclusion silently loses real content — the worst failure for an SEO extractor. Breadcrumbs are default content unless inside `NAV` (CM-04:51-68) |
| D3 | Emitted-payload philosophy | **LOCKED: enumerated payload** (full visible-textual included set + shallow-boundary exclusions). The architect owns the AI and confirms it expects positive AND negative ground truth; never corrections-only (CM-04:71-87) |
| D4 | a11y-hidden text | **LOCKED: hit-test reality-check** (no blanket exclude for `aria-hidden`/`sr-only`/`visually-hidden`) (CM-04:90-98) |
| D5a | Shadow DOM | **CONTRACT CHANGE: deep-capture + treat flattened shadow as real DOM** (replicating the consumer's `ContentDeepAsync`); shipped as CP4-CP6 (CM-04:102-141) |
| D5b | svg | **CONTRACT CHANGE: `SVG` added to immutable exclusions** (CM-04:143-151) |
| D6 | alt text / non-visible signals | **LOCKED: out of scope** — the extension extracts VISIBLE content only (CM-04:155-162) |
| C1 | XPath format | **CONFIRMED: purely positional**, aligned to the sanitized sent HTML; shadow flattening must preserve xpath↔HTML alignment (CM-04:166-172) |
| C2 | Submission visibility geometry | **CONFIRMED: page-HEIGHT viewport / mobile-WIDTH** (below-fold visible; out-of-mobile-width invisible) (CM-04:174-180) |
| C3 | Same-node include+exclude | **CONFIRMED: mutually exclusive per element** (CM-04:182-187) |

### 3.2 Marking-algorithm Q&A (`marking-algorithm/04-qa-decisions.md`)

| # | Decision | Result |
|---|----------|--------|
| MA-1 | Shadow scope | **LOCKED: FULL in-shadow** (not capture-only) — Googlebot parity across enumeration, marking/target/hover/click, XPath, render; continuous positional XPath, no `<template>` indexing; overlays over composed geometry; open roots only (MA-04:10-64) |
| MA-1b | CSS-clamped text | **LOCKED: INCLUDE** (layout truncation, not hiding); distinct from `display:none` and interaction-gated D1 cases; the test is "full text present and laid out, merely clipped by overflow/height/line-clamp?" (MA-04:67-95) |
| MA-2 | Interaction FSM | **LOCKED: formalize** — explicit states/events/transitions in the contract, single `deriveMarkMode` authority + FSM tests; behavior-preserving (MA-04:99-107) |
| MA-3 | Rebuild model | **LOCKED: branch-scoped incremental rebuild is the TARGET**; shipped immediate-ack + debounced full reconcile was the documented INTERIM (both later shipped as CP7a/CP7b). Prerequisite verified: toggles never change selector matches (MA-04:125-156) |
| MA-4 | Nesting-collapse cost | **LOCKED: verify O(rows×depth)**, harden if pathological — verified, no O(n²) path; sort depth memoized (MA-04:114-121, KN:544) |
| Q-α | Area-2 scope | CONFIRMED: "inclusion" = implicit eligibility + explicit include (MA-04:159-164) |
| Q-β | Structured-group definition | CONFIRMED: section/article/card-group/list/table/toggleable-default + shallow-page-shell rejection (MA-04:166-172) |

### 3.3 Widening review F-decisions (`marking-widening-review.md`, architect 2026-07-04/05)

- **F1 LOCKED:** REMOVE the visible-immutable-descendant suppression entirely; auto-exclusion collapses to
  the plain taxonomy tag match. Deliberate 052c deviation; counter-case accepted (media+text asides
  become excluded by default; toggle/Alt-include are the rescue paths) (MWR:56-76).
- **F2 HARDENED:** page-shell rejection applies at ANY depth to descendants-only widen targets; later
  narrowed to **landmark-based only** (broad-footprint disjunct dropped, 2026-07-05) (MWR:31, KN:542,546).
- **F3 LOCKED:** widen threshold ≥2 markable descendants (052c deviation) (MWR:77-81).
- **F4 LOCKED:** filter textless children before structured-group cohesion checks (monotone 052c
  refinement) (MWR:82-90).
- **F5 HARDENED:** flattened-parent depth walk for shell guard in shadow (MWR:34).
- **F6 ACCEPTED:** initial assessment depends on freeze-moment paint-reachability (inherent to
  user-visibility semantics). **F7 ACCEPTED:** landmark counting is conservative. **F8 RESOLVED:** dead
  shell-rejection call removed (behavioral no-op) (MWR:35-37).

### 3.4 Reflex-arc program decisions (RAP:11-22; architect verbatim)

- **D-SAVE:** `saved` lands in SILENT (post-save transition to silent mode is the shipped contract).
- **D-BUS:** NATIVE signal frames immediately (no bridge phase): sequenced, provenance-tagged,
  consumed-once frames on the existing uf-bus.
- **D-SCOPE:** EVERYTHING — popup surfaces AND content overlays (curtains, spinners, inspection tint,
  freeze narration) become layer machine memories.
- **D-ROLLOUT:** DIRECT replacement per phase, no feature flags; safety = phase discipline (independently
  shippable, full gate, per-frame live acceptance before the next phase); rollback = git revert.
- Signal vocabulary is CLOSED (`marking.enabled/disabled`, `markings.changed` (user-edit only),
  `run.started/completed/failed`, `preview.opened/exit.requested/exited`, `session.saved/discarded/
  navigated`, `inspection.started/ended`, `reconciliation.started/ended`) — do not invent others without a
  DECISION line (RAP:95-121).
- Popup machine states (shipped): boot, silent, silent_preview, pre_ai_clean, pre_ai_dirty, running,
  preview_open, exit_restoring, post_ai_clean, plus overlay states inspecting/reconciling that return to a
  remembered prior state (RAP:175-196).

### 3.5 Other architect/user decisions embedded in the docs

- **User dirty-contract (verbatim, 2026-07-05):** "no finger printing is needed. The dirty is set only
  when the a marking is clicked toggled. The discard only reapplies the default/css influenced markings
  like it's a fresh load." (HO:56-58)
- **Audit 3 (2026-06-30):** page-save informational notices stay a sanctioned local shared derivation —
  do NOT convert to brain projection (KN:600).
- **Send-to-Lynx guard fail-closed** was an explicit architect call (KN:621, HO:238-253).
- **User-relaxed page-block contract:** block the page only when the popup is busy AND page interaction
  can affect results (reveal/freeze, AI run, save) — not every popup curtain (LRP:388-390).
- **Preview + silent comparison (#8):** during an active AI preview, silent highlights ALSO render
  alongside the yellow AI content (resolved into the durable contract) (KN:592; the earlier open question
  at LRP:369-373 was settled by that contract).
- **channel decision C8:** popup/content→background one-shots stay raw (package envelope never reached
  the MV3 worker) (KN:349-358).

---

## PART 4 — Cross-reference: what a rewrite must NOT lose (condensed checklist)

1. Seed-then-step-aside (C-MARK-1) — the single most re-litigated invariant; three separate live bugs
   (P1, P3, P4) came from violating it.
2. Exact taxonomies (C-MARK-4/5) incl. case-insensitive matching and the payload-side immutable tag list.
3. `explicit:true` semantics on seeded rows + include/suppression merge into a single `xpaths` field on
   sync (C-MARK-11/13) — the rewrite's unified `rows:[{xpath, excluded, explicit?}]` schema is the
   deliberate redesign, but the behavioral semantics (first-click unmark, leaf-boundary exception,
   closed includes, normalization rules) must survive.
4. The full AI-submission row rules incl. page-height/mobile-width geometry and never-submit roots
   (C-SUB-2).
5. Reveal/freeze ritual exactness (C-FRZ-1/2) + reveal-once-per-visit + freeze-at-absolute-bottom +
   navigation-only release.
6. Consent-on-every-property-page, decoupled from candidacy (C-LIFE-1/2) with the high-precision
   selector list.
7. Property-lock timing constants and clone-tab client rotation (C-LOCK-1/3).
8. Popup button-state matrix + deterministic (non-fingerprint) dirty axis (C-POP-1).
9. Single-curtain rule + spinner surface vocabulary + MV3 fail-open recovery (C-SPIN-2/4/6).
10. Mobile-emulation forcing for the marking editor tab; desktop preview gated on existing selectors
    (C-EMU-1/2).
11. Empty-response-never-destroys-local + save-confirm-by-reload (C-SAVE-3/4) — directly relevant to the
    known production /save wipe finding.
12. Shadow flattening with Googlebot parity everywhere (C-SHDW-1..3) and the CSS-clamp visibility rule
    (C-TGT-7).
