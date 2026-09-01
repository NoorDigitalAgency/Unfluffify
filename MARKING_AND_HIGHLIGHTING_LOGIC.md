# Marking And Highlighting Logic

> **Authority amendment (2026-08-20):**
> [`.reimplementation/rewrite-legacy-decision-spec.md`](./.reimplementation/rewrite-legacy-decision-spec.md)
> supersedes conflicting behavior in this document. In particular, selector influence is now a
> one-shot simulated-user seeding phase, retrievable closed shadow roots are flattened and markable,
> and silent/post-AI preview blocks underlying page actions while allowing scrolling. The prose below
> has been reconciled to those decisions; git history retains the superseded legacy details.

> **Authority amendment (2026-08-31):** The operator-approved contract in
> **Approved session, interaction, and submission authority** below supersedes
> every older plain-click, context-menu, dirty-fingerprint, hidden-row, local
> persistence, and AI-corpus statement that conflicts with it. Save is the only
> remote persistence boundary. After it commits, a distinct Load fetches the
> newest complete backend shape and complete-replaces local configuration; the
> Save response is not local authority. The AI endpoint is stateless.

This document is the source of truth for the marking rules restored from
`052c164b077d459fa7a6e79b306f01144336719c`, with deliberate current safeguards
kept in place: `BUTTON` remains toggleable, the redundant void `LINK` tag is
omitted from the taxonomy, stricter
geometry/paint guards remain active, selector-excluded content does not get a
dedicated marking overlay, and silent highlighting keeps the
`immutable`/`content`/`excluded` layers.

## Locked Contract

The marking rules in this document are a locked compatibility contract. Do not
change the taxonomy, target resolution, sync semantics, overlay projection, or
default-exclusion behavior unless the user explicitly asks for a marking-rules
contract change.

Any legitimate contract change must update this document, `.copilot/knowledge.md`,
`.copilot/plan.md`, `README.md`, and the focused regression tests in the same
commit. A change that only patches rendering, caching, hover targeting, or sync
output is not sufficient if it alters the rules below.

## Approved session, interaction, and submission authority

### State and session lifetime

- The mutable taxonomy is exactly `implicit inclusion`, `explicit inclusion`,
  and `explicit exclusion`. Expansion is boundary ownership, not a fourth state.
- Enabling marking starts a fresh clean session from defaults followed by the
  current saved CSS-selector influence. Only explicit mutable decisions are
  retained in the active session; every other mutable target is projected as an
  implicit inclusion.
- The first successful operator marking mutation makes the session dirty and it
  stays dirty monotonically. Reversing the visible decision does not make the
  session clean; fingerprints may optimize or fence work but never decide dirt.
- No mutable marking session is preserved outside active marking. Clean disable
  dismisses it directly. Dirty disable and dirty navigation first require user
  approval; approval discards the complete session and cancellation preserves
  it exactly. Full-document navigation uses the native before-unload gate;
  same-document path/query navigation is synchronously gated in the MAIN world
  before History/Navigation commits. Fragment-only movement is not a new page
  boundary. Discard has the same complete-reset meaning.
- Run AI retains the active session but presents subdued gray, non-interactive
  markings. Completion restores interactive marking; failure restores the same
  dirty session. Save ends the session only after authoritative success.
- Save persists exactly the authorized current-page result plus the domain-wide
  selectors to the backend. A distinct Load then fetches the backend's latest
  complete property shape and replaces local configuration atomically. Once
  that Load succeeds, the active mutable session is destroyed: no session row,
  selector suggestion, draft, or pre-Load snapshot is merged into or preserved
  beside the loaded shape. A failed Save
  leaves the session intact. Silent highlighting after Save reflects the loaded
  authoritative selectors, and the next enable starts fresh from them.

### Gestures and target ownership

- Every visible eligible target highlights in all three mutable states. Hidden
  or invisible targets never paint or accept UI interaction. Immutable nodes,
  immutable descendants, extension UI, consent UI, source-only nodes, and other
  inherently ineligible nodes are not marking targets.
- Plain left click toggles an implicit inclusion to explicit exclusion, explicit
  exclusion to implicit inclusion, and explicit inclusion back to its default
  result (or to unmarked when owned by an expanded exclusion).
- Shift changes exclusion target breadth, not the toggle taxonomy. Its hover may
  move between the individual target and the nearest eligible ancestor according
  to pointer position. Shift-click applies the same state transitions to that
  resolved target and can create a widened exclusion.
- An expanded exclusion owns ordinary descendants. Clicking one removes the
  boundary, rehydrates all descendants from defaults with no expansion
  provenance, then explicitly excludes the clicked descendant. Clicking the
  boundary itself removes it and performs the same rehydration. An explicitly
  included descendant is the exception: clearing it removes only that inclusion
  and leaves the expanded ancestor intact.
- Alt is individual explicit-inclusion mode and wins over Shift. It toggles
  implicit inclusion to explicit inclusion, explicit exclusion to explicit
  inclusion, and explicit inclusion back to the applicable default/unmarked
  result. It can target a mutable descendant below an expanded exclusion.
  Mixed-text targeting may expose both a textual container and its child up to
  that container; Alt-clicking the child of an explicitly included container
  atomically removes the parent inclusion and includes the child.
- Immutable descendants can never be explicitly included or excluded. Meta and
  Ctrl have no marking semantics. The extension does not listen for or suppress
  `contextmenu`; native right click is always preserved.
- Hover and click consume the same occurrence-fenced target. During scroll,
  resize, or layout churn, overlays fade out; once stable they are repositioned
  when topology is unchanged or recomputed when needed, then fade back in.
  Passive gray boundaries may remain where suitable but never imply interaction.

### Payload and AI corpus

- UI visibility and payload disposition are separate. An existing explicit
  inclusion or exclusion survives its element becoming hidden and remains the
  same explicit payload row; only its paint and interaction disappear. If it
  becomes visible again, its preserved session decision paints again.
- An otherwise mutable hidden/invisible target with no explicit session decision
  is emitted as an effective explicit exclusion for that payload occurrence. It
  is not inserted into the session decision snapshot and does not dirty it.
- Explicit inclusions always submit, including below a mutable expanded
  exclusion. Expanded-exclusion descendants without such an inclusion are
  omitted and covered by the shallowest submitted exclusion ancestor.
- Immutable elements and every immutable descendant are omitted as individual
  XPath rows. The hardcoded immutable-selector list is sent separately to AI;
  immutable descendants cannot override it.
- Consent elements are non-interactive in marking UI. Their page content is
  still given truthful extraction coverage: when hidden/suppressed and not
  already covered by immutable or excluded ancestry, it is represented as an
  effective exclusion rather than silently becoming included.
- The AI endpoint persists nothing about a property or its pages. Its returned
  session id is only an ephemeral asynchronous-job polling handle. Every run sends one self-contained corpus
  containing every candidate page for the property, its applicable static and/or
  rendered HTML, its rows/ancestor coverage, the separate immutable selectors,
  and the active current-page session projection. The endpoint returns one
  domain-wide selector set and cannot reuse any input from an earlier run.
- Save, not Run AI, is the remote persistence boundary. After Save succeeds,
  Load adopts the complete newest backend shape locally. Discard or an abandoned
  AI run leaves no remote draft.

Non-negotiable invariants:

- **Defaults and selectors are two ordered phases.** First calculate the clean
  baseline from the default taxonomy. Second apply inclusion and exclusion
  selectors exactly as simulated user clicks, producing ordinary explicit
  rows. Selector identity, provenance, precedence, suppression, and re-matching
  then disappear for the session. A later user toggle may re-evaluate default
  posture only within its affected branch; it never re-runs selectors and never
  overwrites an explicit row. Rendering, target resolution, preview, and
  submission consume the same canonical rows and evaluation.
- Toggleable defaults differ from user/CSS-selected exclusions only while the
  excluded/included state is being decided.
- After that decision, default exclusions are ordinary generated `{ xpath,
  excluded: true }` rows and render through the ordinary exclude overlay.
  User-created exclude rows carry `explicit: true`.
- The ordinary exclude overlay collector must include both user-created exclude
  rows and live generated rows whose element still matches a toggleable default.
  It must also keep excluded-by-state defaults out of the implicit/default
  content layer and must not draw stale untagged non-default excluded rows.
- Toggleable default exclusions must not have a dedicated visual layer, CSS
  class, render collection, or post-hoc overlay rule.
- A stored `{ xpath, excluded: false }` row for a toggleable default unmarks only
  that exact boundary. It suppresses that boundary's own implicit/default
  marking, but it does not suppress descendants or become a subtree include.
  Exception (leaf boundary): a boundary with visible textual DESCENDANTS suppresses
  its own marking so the descendants render in its place (anti-ghost); but a LEAF
  textual boundary — an unmarked `BUTTON` whose only content is its own text and
  which has no descendant surface — MUST stay visible in the implicit/default
  layer so the unmarked control still carries marking UI and can be re-excluded.
  It is therefore force-included as a default-layer candidate (a toggleable-default
  is not "self-markable content" so the plain default walk would otherwise skip
  it). Selector matching is not consulted here because it ended after seeding.
- Fast refresh, caching, or performance work may only be an adaptation layer over
  the canonical evaluator and must not create a second marking truth. Toggles are
  serialized, generation/occurrence guarded, and branch-spliced; stale work is
  rejected. A routine full-document reconcile after every toggle is forbidden.

The implementation is split across:

- `content/core.js` for DOM targeting, synchronization, and overlay rendering.
- `content/marking-rules.js` for pure marking decisions.
- `content/submission-rules.js` for AI submission row decisions.
- `content/silent-highlight-rules.js` for silent-highlight redraw/source rules.
- `common/constants.js` for default exclusion categories.
- `common/emulation.js` for the mobile simulation state that submission
  visibility uses.

## Core Model

A page marking entry combines immutable defaults, toggleable defaults, selector
matches, and explicit XPath choices, but rendering precedence is a separate
locked contract:

1. defaults,
2. CSS/AI selector influence,
3. current marking-session explicit markings.

`current marking-session explicit markings` means local draft deltas the user
makes after marking is enabled, relative to the freshly computed session
baseline for the same page in the same base URL.

### Marking data is session-scoped and recomputed fresh on every enable

Page marking data only lives for the duration that marking is enabled. Each time
marking is enabled for a page, the per-page entry is recomputed fresh from
defaults plus CSS/AI-selector influence (selector influence only when a selector
set is present), and any stale persisted `config.pageMarkings[pageUrl]` draft is
discarded. Previously backend-saved explicit markings do not pre-populate the
fresh session entry and must not seed the clean baseline; the first render after
enable adopts the freshly synced defaults + selector entry as the clean baseline,
so a freshly enabled page never starts in a dirty state. Because each enable
starts fresh, no unsaved-draft cache is preserved across a disable, and marking
is disabled on any navigation or page reload regardless of whether the same page
or property is involved. The render-time layer split (`saved-explicit-*` vs
`session-explicit-*`) is retained, but the `saved-explicit-*` layer now reflects
that fresh session baseline rather than separately fetched backend-saved
markings.

The resulting model renders marking overlays while marking mode is enabled and
holds normalized XPath rows only in the active session until Save.

The active session may contain local drafts in memory. Candidate completion is a
backend-save fact for passive observers, but the current editor's popup must use
that active page-marking session as the source of truth for the Todo List,
candidate `Marked` badges, marked-pages list, and Lynx checklist coverage while
that editor remains on an eligible Live Page.
Preview Contents has two accepted entry points. The silent-highlighting Preview
button reads from the latest stored selector set in config storage and stays on
the silent-highlighting surface; it is enabled whenever stored selectors exist in
silent mode and does not require a fresh in-session AI run, and exiting the
preview returns to the origin mode (silent stays silent). Marking mode also
exposes Preview Contents as a
current-page verification action after a successful AI run matches the live
markings; opening or closing that preview must not create, mutate, or dirty page
marking drafts. Send to Lynx remains silent-highlighting-only and must stay
hidden, disabled, and handler-guarded while marking mode is active. Lynx send
must read its marked-page coverage from the same editor-local storage view while
the editor owns the property.
When the current tab is a valid Live Page candidate, the Todo List must label
both the candidate row and its parent page-type subsection as `Current` so the
active page remains findable when subsections are collapsed.
Initial Live Page candidate loading may use the normal popup loading state, but
periodic non-initial candidate refreshes must run quietly. A periodic refresh
only interrupts the user after the fetched candidate signature changes: if the
active page is no longer valid, marking is stopped and a blocking alert explains
why; in all changed cases the Todo List root is expanded and a warning notice
asks the user to review the updated candidates.
Unrelated config syncs must not upload local draft page markings. The explicit
session Save action is the sole persistence boundary: it uploads exactly the
current page plus the property-wide selectors, then Load adopts the backend's
complete newest response as the only local configuration. Nothing from the
active session is preserved or merged after that successful Load. Marking
changes remain session-local until that Save; Discard removes the whole session and immediately rebuilds a clean
active session from defaults plus the latest already-loaded authoritative
selectors, without retaining any dismissed decision or treating the AI result
as a baseline. A marking session that
changes local page markings must run AI again before save is enabled, and
marking mode must not be disabled until the user saves or discards that
session.

The Save Session button is gated by the page-save UI state: dirty session
changes, page controls visibility, reconciliation state, and
`sessionRequiresAiRun`. Dirty is monotonic after the first successful marking
mutation and is never cleared by a matching fingerprint. A content-equivalence
fingerprint may still avoid a redundant AI run while nothing changed after the
last successful run, but it is not session-clean authority.

Property edit ownership is defined separately in `PROPERTY_LOCK.md`. Marking
mode must respect that contract: only the current property editor can mutate
page markings, while locked passive observers may refresh remote state and
silent-highlighting status without becoming a second source of truth.

The content script is the source of truth for whether the page is in marking
mode. Popup refreshes must reconcile the toggle and tab state to the content
`getInspectionStatus.markingEnabled` value when that status is available,
without sending a redundant `setEnabled` message. This prevents stale popup or
reload-restore state from showing marking controls while the page is actually in
silent highlighting mode, or the inverse.

Inspection and popup busy state is event-first. Content emits lifecycle events
to the background broker for content readiness, marking activation, render-mode
inspection, reveal/freeze progress, HTML capture, finish, and failure. Popup
spinners are current background state, not session-storage replay: popup-owned
spinners call background `ufSpinnerSet`/`ufSpinnerRemove`/`ufSpinnerClear`, and
the popup mirrors `getUfBackgroundState` / `ufPopupState:<tabId>` updates. Polls
such as `getInspectionStatus` are fallback/diagnostic safeguards, not the
primary source of spinner truth.

## Exclusion Categories

### Immutable Defaults

Immutable defaults are always excluded and cannot be overridden from marking
mode. They include `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`,
`SCRIPT`, `TEMPLATE`, `IFRAME`, `VIDEO`, and `SVG`.

`SVG` is immutable because an `<svg>` is a self-contained graphic (icon,
illustration, chart) whose internal `<text>`/`<title>` is not page copy Google
indexes as prose. Tag matching for the taxonomy is case-insensitive on both
sides: foreign-namespace elements such as `<svg>` report a lowercase `tagName`
(`"svg"`), unlike uppercased HTML tags, so the `SVG` selector is compared with
`.toUpperCase()` on the element side to match the `<svg>` root reliably.

An element inside an immutable default subtree is not markable. Immutable nodes
render as hard exclusions in marking mode and on the dedicated immutable layer
in silent highlighting.

### Toggleable Defaults

Toggleable defaults start excluded but can be toggled by the user. The locked
taxonomy is:

- `FOOTER`
- `FORM`
- `LABEL`
- `NAV`
- `HEADER`
- `DIALOG`
- `ASIDE`
- `BUTTON`

`BUTTON` is intentionally toggleable. `LINK` is intentionally omitted from the
taxonomy: a `<link>` is a void metadata element that never carries text or
descendants, so it can never be a marking target and listing it as immutable was
redundant.

Plain click toggles an eligible implicit inclusion to explicit exclusion and an
explicit exclusion back to implicit inclusion. `Shift` changes the resolved
breadth and is required only to widen the target to an eligible ancestor; it is
not required to create an exclusion on the individual target.
Include mode is explicit:
the user holds `Alt` and the selected target is written to the local
`includeXpaths` list, then synced as an explicit include row in `xpaths`. This
also applies to eligible content that is currently included implicitly; Alt is
the operator's way to turn that implicit decision into an explicit one.
Shift-parent expansion is bounded to content-shaped regions. It may climb
through wrapper chains to a cohesive section, article, card group, list, table,
or toggleable default boundary, but it must not select shallow generic page
shells such as body-level site/app wrappers. Generic ancestors within the first
two levels under `body` are rejected when they have a broad viewport footprint
or contain multiple page landmarks such as header, main, footer, or navigation.

Toggleable default exclusions have no separate visual layer or class. Once the
decision step marks a default boundary as excluded, it is represented by the
same `{ xpath, excluded: true }` row and the same exclude overlay as any other
excluded element. The renderer must not require `explicit: true` for those
generated rows; otherwise broad defaults such as forms and footers suppress
descendants without showing an exclusion marking, or can appear as implicit
content underneath the exclusion. This keeps the visual layer a projection of
the current marking state instead of an independent source of default-exclusion
behavior.

## Stored Page Entries

Each page entry may contain:

- `title`
- `timestamp`
- `xpaths`: ordered `{ xpath, excluded, explicit? }` rows; explicit inclusion is
  `{ excluded: false, explicit: true }`
- `silentWhitespaceExcludedXpaths`: local bookkeeping for generated whitespace
  explicit-exclude rows
- `submissionXpaths`
- `renderedHtml`
- `rawHtml`

`xpaths` stores explicit user exclusions plus generated/default posture rows.
Rows with `explicit: true` are user-created exclude rows for local editing and
explicit-tag preservation. AI submission intentionally uses the 052c-compatible
rule that every stored excluded XPath row submits as excluded unless it is
explicitly included or suppressed by an excluded ancestor. Untagged generated or
legacy rows are still sync posture and may be dropped if they do not still match
a generated default.
Normalization removes redundant nested rows when a broader boundary takes over
a subtree. Config sync carries explicit includes directly in `xpaths`. No
selector-provenance or selector-suppression field is stored or reconstructed.

Visible renderable block elements whose subtree has no meaningful normalized
text may be synced as silent whitespace explicit exclusions. The `xpaths` row is
the ordinary `{ xpath, excluded: true, explicit: true }` shape so submission can
treat it as an explicit exclusion, while `silentWhitespaceExcludedXpaths` records
that the row was generated by sync. These rows are not a new default or
immutable taxonomy category: they do not render an explicit overlay, are not
returned by marking target resolution, cannot be explicitly included, and do not
make an otherwise unmarked page count as manually marked for AI auto-seeding.
Sync drops the generated row when the element gains meaningful text, disappears,
becomes hidden/non-rendered, or falls under another exclusion.

AI-selector seeding runs once, after the clean default baseline. Inclusion
selectors simulate ordinary include actions and exclusion selectors simulate
ordinary exclude actions. Their results are explicit rows and are thereafter
indistinguishable from the same user actions. Later rebuilds never consult the
selector set.

For toggleable default exclusions, a stored row with `excluded: false` is the
user's explicit unmark for that exact default boundary. A direct exclude-mode
click on an already-default-excluded boundary that has no stored row records that
`excluded: false` unmark on the FIRST click, rather than promoting the boundary
to a redundant explicit exclusion (which is visually identical to the default
exclusion and would force a second click to actually toggle it off). It must
suppress the boundary's own default-layer marking without suppressing unmarked
descendants,
so the unmarked boundary does not render as a visual-only ghost around an
explicit descendant marking. That self-suppression applies only when the
boundary has visible textual descendants that render in its place: a LEAF
textual boundary (an unmarked `BUTTON` whose only content is its own text) has
no descendant surface, so it stays in the default layer — otherwise the
unmarked control would carry no marking UI at all and could not be visually
re-excluded. Nested toggleable defaults keep their own default
behavior. Default-layer collection intentionally remains otherwise 052c-like:
explicit marks should not globally filter unrelated implicit default targets,
because that can make implicit descendant markings flicker on alternating
toggles.

Default-layer projection uses two related but distinct sets:

- explicit excludes suppress only the explicit boundary itself at default-layer
  precedence,
- all synced excluded boundaries suppress descendant default-layer projection.

That split keeps generated default boundaries visible on initial render while
still preventing duplicate descendant default markings under excluded ancestors.

Fast explicit-toggle rendering operates on the serialized canonical mutation
result. It recomputes and redraws the affected branch only, validates the DOM
generation/fingerprint before commit, and rejects stale work. Cached projection
data may be patched only when branch-splice invariants prove equivalence; it may
never outrank or reinterpret an explicit row.

## Marking Performance Contract

Marking mode must avoid duplicate full-page passes:

- Enabling marking performs one activation path. The popup sends `setEnabled`;
  content activation/sync/render is handled from there, without a second
  immediate `forceRefresh`. Before page motion is frozen and marking overlays
  are rendered, activation must show the page-inspection spinner, block page and
  content-overlay input, perform a bottom-and-top reveal scroll for lazy
  content, then restore the user's original scroll position.
- A manual refinement performs one serialized branch-scoped evaluation and a
  cheap immediate acknowledgement. It does not schedule a routine full-document
  rebuild. Default posture may be reconsidered only inside that branch;
  selectors do not re-enter evaluation.
- A marking pass may cache per-element visibility, text, immutable/default
  selector, ancestor, textual-descendant, and paint-reachability decisions.
  These are pure functions of the current DOM + viewport, so the synchronous
  render path REUSES them across passes (a marking toggle changes neither DOM
  nor viewport), gated by a DOM/viewport version that is bumped only on real
  DOM/viewport changes — a rebuild-class DOM mutation, scroll, or motion
  pause/resume — never on collection invalidation (settle-time precautionary
  rebuilds and config/selector changes do not affect visibility/text/paint).
  The async chunked reconcile keeps rebuilding them per run (it yields, so
  persistence would be unsafe). These caches are still derived state, not a
  persistent source of truth. Silent highlighting consumes the same caches, so
  its reposition scheduler signals the same invalidation (the scroll bump runs
  regardless of marking mode, and marking teardown invalidates too). While the
  viewport is actively scrolling, paint-reachability is treated as unknowable:
  the draw filter passes rects through and the scan-side check answers
  optimistically without persisting a verdict — the post-scroll pass re-applies
  the strict hit-tested filter.
- A manual explicit include/exclude operation may cache XPath-to-element
  resolution only for that operation. Expanded exclusions must prune descendant
  rows, ancestor rows, and include overrides from the same row set without
  repeatedly resolving the same XPath or scanning every kept element with nested
  `contains()` checks.
- Collection helpers that collapse or suppress nested elements should prefer
  ancestry sets or parent walks over pairwise descendant scans. This keeps the
  performance model proportional to selected rows and DOM depth rather than to
  every possible candidate pair.
- Scroll and pointer repaint paths reuse the current collections and reposition
  boxes; they must not trigger a full default-layer collection unless the DOM,
  config, or explicit marking state changed.
- Initial IntersectionObserver registration is frame-chunked. The first trusted
  scroll/resize input owns the compositor fade immediately, cancels or defers
  competing structural work, and resumes it only after the stable repaint.
  Effective visibility is the product of the root and layer opacity; retained
  gray boundaries keep node identity while the root fades out and back in.
- The transparent interaction shield keeps its proved scroll owner across visual
  viewport movement. A wheel packet waits through the next presentation boundary
  (with a 40 ms starvation bound) before applying a manual fallback, and only if
  native scrolling did not move; one physical delta must never be doubled.
- Silent Preview is a view over the existing authoritative silent-selector
  paint, not a reason to clear it. Its list and page remain two-way routable for
  the whole occurrence. In debug builds, clicking an annotated XPath rectangle
  performs page-to-row routing while Preview is open; outside Preview it keeps
  the debug copy behavior.

### Rebuild model: target and interim (MA-3)

A mark's blast radius is branch-local: an element's fate depends only on its own
ancestry, never a sibling's mark. The model is therefore a
branch-scoped incremental rebuild — on a mark of element E, recompute only the
affected surface (`subtree(E) ∪ ancestor-chain(E)` to the nearest marked or
structural ancestor), splice it into the cached projections, and keep unrelated
branches untouched. Corpus tests compare this optimization with the canonical
evaluator; production does not rely on a trailing full-document reconcile.

**Shipped (branch-scoped rebuild):** a single explicit toggle takes the
branch-scoped path. The affected surface is rooted at the OUTERMOST
flip-capable ancestor of the toggled element — a toggleable-default boundary or
structured-group candidate, the only ancestors whose candidacy can flip on an
explicitly-marked-descendant change — else the element itself; everything
outside that subtree is provably unchanged and reused from the pre-toggle
collections (stashed at invalidation, DOM/viewport-version-tagged). The scoped
render skips the (redundant) sync scan and re-walks only the affected subtree
with the root frame seeded from its real ancestor state.

Guards reject or retry serialized work when the DOM generation/fingerprint is
stale, the affected root is unbounded, or branch-splice invariants fail. A new
structural generation starts a new authoritative calculation rather than
committing stale output. Debug/test corpora may expose canonical equivalence
audits; production does not carry a live parity-audit mechanism.

## Motion Stability Contract

Any page where Unfluffify currently owns the editor role holds a page motion
pause for both marking and silent-highlighting lifecycles. Editor-role
activation first runs a one-time page reveal sweep, then silent highlighting
stays active with motion paused whether or not selectors currently produce
overlay targets. The pause is part of the save and highlighting contract, not
just a visual convenience:
animated carousels can move text outside the viewport, update inline transforms,
flip visibility state, and change which textual nodes are submitted as visible
AI evidence.

Editor-role activation reveal is a blocking preparation phase. While that phase
runs, Unfluffify must block page interaction with the inspection spinner/overlay
and hold a blocking pending reconciliation reason (`editor_preparing`) so users
cannot interrupt reveal/freeze setup before silent-highlighting motion pause is
established.

Render Mode inspection owns its reveal/freeze lifecycle separately from editor
activation. Entering the Render Mode view must not run editor-acquisition
reveal/freeze while the base URL still has an unconfirmed render mode. The
explicit With/Without JavaScript inspection action is the only Render Mode path
that may reveal/freeze: after the reload completes and content-main is active,
it runs one reveal pass, captures sanitized rendered HTML and static/raw HTML,
then allows local/remote data loading and highlighting to continue. The rendered
capture must be taken before highlighting refresh and must use the same
extension-node stripping rules as saved snapshots.

The pause is source-owned, so marking mode and silent highlighting can both hold
it without accidentally resuming the page for the other lifecycle. It freezes
CSS animations and transitions with an extension stylesheet, pauses Web
Animations and SVG animation clocks, pauses autoplay-like media, refreshes for
new animations while active, and sends synthetic hover-pause events to generic
motion candidates and their nearby ancestors instead of relying on a fixed
class list for one slider library. The freeze boundary is page content only:
extension-owned UI such as `#unfluffify-overlay`, pause/status indicators, AI
popovers, injected bridge scripts, `[id^="unfluffify-"]` roots, and any
`[data-uf-extension-ui="true"]` root must keep its own animations, timers, and
overlay render scheduling alive while the underlying page is held still.

JavaScript-driven motion is stabilized in two layers. A page-world timer bridge
holds `setTimeout`, `setInterval`, and `requestAnimationFrame` callbacks while
the pause is active, which stops recursive carousel loops that change slide
text or visibility even after CSS motion is frozen. The content script also
uses extension-owned timer and animation-frame helpers for marking overlay
rendering, hover refreshes, snapshots, and pause maintenance so page-world timer
gating cannot starve Unfluffify's own UI. It locks the current computed values
of common moving properties such as transforms, offsets, opacity, filters, and
position edges on detected motion candidates.

Installing or recovering that page-world runtime is a distinct, exact-document
acknowledgement. Activation allows the cold acquisition up to 15 seconds and
starts the shorter lifecycle-command deadline only after readiness is proved.
A runtime installed or proved in the current service worker remains hot: each
command performs one MAIN-world invocation between exact pre/post document,
URL, generation, navigation, consent, and terminal authority checks. A lease
recovered from session storage after a worker restart must probe once before it
becomes hot. Runtime loss fails the current operation and forgets the poisoned
lease; only a later operation may install one replacement. There is no
automatic lifecycle-command retry or success-shaped fallback.

Viewport and scroll-triggered reveal effects are handled as a distinct case. On
marking enable, before the motion pause starts, the content script stores the
current scroll offset, temporarily forces instant scroll behavior, samples a
bounded set of top-to-bottom viewport positions to trigger scroll/intersection
handlers, restores the original scroll offset, and only then freezes page motion
and renders marking overlays. The sweep is skipped when the page has no vertical
scroll room or activation becomes stale.

If a layout-present page element has generic entrance/reveal descriptors or an
attribute-driven interaction hook such as Webflow's `data-w-id`/`data-ix`, and is
currently hidden only by motion styling such as low opacity, clipped paint,
visibility, transform, or blur, the pause normalizes it to its final visible
posture instead of locking the pre-reveal state. Semantic hidden UI such as
modals, dialogs, menus, tabs, carousels, accordions, and `aria-hidden` content
must remain hidden. Those extension-owned timer controls, reveal normalizations,
inline locks, the root pause class, the pause stylesheet, and the pause
indicator are removed from sanitized save snapshots so saved `renderedHtml`
records the page posture without recording Unfluffify UI or freeze mechanics.

While motion is paused, a small fixed snowflake/code glyph pair is shown as
extension UI so the user can see that page animations and transitions are
intentionally held. The indicator uses a content-script-injected Material Design
Icons font face with Unfluffify-specific selectors and direct glyph `content`,
without injecting the global `.mdi` stylesheet into the target page.
When the last lifecycle source releases the pause, Unfluffify restores the
synthetic hover state, inline locks, media playback that it paused, SVG clocks,
and Web Animations that it paused.

## Marking Interaction FSM

The marking interaction is a finite state machine whose mode is a pure function
of a small set of inputs. There is a single derivation authority,
`deriveMarkMode(inputs)` in `src/content/core.ts`; `getMarkMode()` sources the
inputs from live state and `getMarkModeFromEvent(event)` sources `altActive`
from the committing event's `altKey` (race-proof at click time).

**Modes (states):**

- `disabled` — marking is off (`enabled` false or no overlay) or busy-locked
  (temporarily disabled: run in flight, save/sync reconciliation pending). No
  target resolution or commits.
- `passthrough` — the Space page-interaction latch is held; clicks pass to the
  page (open accordions/tabs) and the overlay yields.
- `include` — Alt is active; clicks reach individual eligible targets inside
  mutable excluded content and toggle explicit inclusion. Hidden content and
  immutable descendants remain non-interactive.
- `exclude` — the default active mode; plain clicks toggle the individual target
  while Shift changes target breadth and can resolve a widened ancestor.

**Mode inputs and precedence.** The mode is derived by fixed precedence:

1. `disabled` if not `enabled`, no overlay, or `temporarilyDisabled`;
2. else `passthrough` if the Space latch is held;
3. else `include` if Alt is active;
4. else `exclude`.

So `disabled > passthrough > include > exclude`. `Shift` is **not** a mode: it is
an orthogonal breadth modifier resolved separately (`shouldAllowParentMarking`),
active only outside include mode.

**Events (transitions):** enable/disable (popup) and busy/unbusy (brain
directive) move in and out of `disabled`; Space keydown/keyup toggles the
passthrough latch; Alt keydown/keyup drives `altActive`; a click commits the
current mode's action; window blur, tab visibility change, and navigation reset
the held-modifier latch (releasing Alt/Shift/Space). The machine holds no mode
state of its own beyond these latches — every event re-derives the mode.

## Target Resolution

Targets are resolved from `document.elementsFromPoint(...)`, skipping extension
UI, consent UI, document roots, and immutable subtrees. Native hit testing can
never report a `pointer-events: none` element (a common accordion pattern marks
the header text spans hit-transparent so clicks always land on the delegated
header), so the composed hit path additionally surfaces pointer-events-
suppressed descendants of the topmost page hit whose client rects contain the
point, deepest-first — those elements are real, visible content and stay
hover- and click-markable.

Hit targets must have renderable marking geometry. A live element whose own box
is hidden, transparent, or otherwise not visible cannot be selected just
because `elementsFromPoint` returned it. Collapsed textual wrappers may fall
back to visible descendant geometry. Existing hidden explicit decisions remain
in session/payload state but never draw ghost geometry and are not interactive
until the target becomes user-visible again.

Renderable marking geometry also has to be paint-reachable in the current
viewport. Responsive alternates that keep measurable boxes but are fully covered
by another card face, slide face, or click layer must not render as separate
default targets. If hit testing is unavailable or the element is off-screen, the
cached collection keeps the element and the viewport redraw performs the same
paint-reachability check when it scrolls into view. An element missing from its
own hit stack counts as reachable when the TOPMOST page hit is one of its
ancestors and the chain up to that ancestor is pointer-events-suppressed: that
miss is hit-test transparency, not coverage, while a genuine foreign overlay
above the ancestor still reads as covered.

### Exclude Mode

Plain exclude clicks toggle the resolved individual target: implicit inclusion
becomes explicit exclusion, explicit exclusion becomes implicit inclusion, and
explicit inclusion is removed back to its default result. Immutable exclusions
remain immutable. Clicking a gap between painted fragments is a valid no-op.

An existing widened explicit exclusion owns ordinary descendants. Clicking the
boundary removes it and rehydrates descendants. Clicking an ordinary descendant
does the same atomically and then explicitly excludes the clicked target. An
explicitly included descendant is independent: clearing it leaves the widened
ancestor intact. Overlapping owners follow visible layer/paint order, not XPath
depth or one broad bounding box.

`Shift+Click` enables parent selection. Under the restored 052c behavior, target
resolution first prefers the clicked element when it is a structured group or
toggleable boundary, then the nearest structured group ancestor, then the nearest
toggleable ancestor, then the broadest markable ancestor. The current shallow
page-shell guard still rejects generic body-level wrappers with broad viewport
footprints or multiple page landmarks.

Two restraints bound how wide a parent selection can reach:

- **Ancestor ladder candidates must be self-markable.** Ancestors on the
  structured-group/toggleable/broadest rungs are evaluated without parent mode,
  so the broadest-markable rung can only select an ancestor with direct own
  text (a mixed-text ancestor). Generic wide wrapper divs have no direct text
  and are never ladder candidates; the ancestor walk additionally hard-stops at
  `body`/`documentElement`, so root exclusions are impossible.
- **Descendants-only targets face the page-shell rejection at ANY depth.** When
  the clicked element itself is markable only through its descendants (it is
  not self-markable), the landmark/footprint page-shell rejection applies
  regardless of depth below body — a deep full-width content-column wrapper is
  not a valid widening target. Semantic content boundaries (section, article,
  lists, tables, toggleable defaults, …) and direct-text elements keep their
  exemption, so meaningful wide containers remain selectable. The depth-limited
  shallow guard is unchanged where it feeds the structured-group definition.
- **Descendants-only targets must group MULTIPLE content pieces.** A widen
  target that is not self-markable requires at least TWO markable descendants —
  a wrapper around a single content piece is not a widening target (excluding
  the piece directly is equivalent and tighter). Deliberate 052c deviation
  (decision record: marking-widening-review.md F3).
- **Structured-group cohesion ignores structural noise children.** The
  every-child cohesion check filters out children that are not textual
  containers at all (spacers, decorations) — the same treatment immutable and
  consent children already receive — before the two-child minimum and the
  grouped-child test. A group qualifies when at least two textual children
  remain and all of them conform; previously-qualifying groups are unaffected.
  052c refinement of the Q-β cohesion definition (decision record:
  marking-widening-review.md F4).

### Include Mode

`Alt` switches to include mode. Include mode can inspect descendants inside
excluded parents and eligible implicitly-included content, prefers explicit
targets first, and restores 052c mixed
direct-text ancestor promotion so an eligible textual ancestor can be included
instead of only the deepest child. The selected element is stored locally in
`includeXpaths` when it is eligible and synced through the single `xpaths` field
as an explicit include row.

Explicit include boundaries own ordinary plain-click targeting, but Alt may
target an eligible individual descendant. If Alt selects that descendant, the
ancestor include is removed and the child becomes the explicit include in one
atomic mutation.

### Page Interaction Mode

Holding `Space` while marking mode is enabled temporarily lets clicks pass
through to the underlying page UI. This is for opening accordions, tabs,
menus, and similar controls before returning to marking or explicit include
work. `Alt` remains include mode and `Shift` remains parent selection, so page
interaction is intentionally a separate hold state. Releasing `Space`, window
blur, visibility changes, or disabling marking restores the overlay and redraws
markings over the page's new posture.

Silent highlighting and post-AI preview deliberately do not offer page
passthrough. They allow page scrolling and extension highlight/list interaction,
but block underlying links, buttons, forms, menus, hover activation, and
navigation. The same page-motion pause remains active to keep output comparable.

### Temporary Disabled State

Marking can remain active while editing is temporarily blocked, such as during a
page save or while saved page data is waiting for backend sync confirmation. In
that state the page overlay stays mounted, dims existing markings, clears hover
feedback, switches to a progress cursor, and shows a persistent `aria-live`
status notice that marking is paused. The notice is extension UI and is stripped
from saved snapshots with the rest of the overlay.

The decision to enter this state is brain-dictated. The background view-projector
composes both causes — the post-AI/preview lock (`aiRunPhase` POST_AI/AI_PREVIEW,
reason `post_ai`) and a pending page-save reconciliation (reason `saving` or
`syncing`) — into the content directive's `markingEditsBlocked` and
`markingEditsBlockedReason`. Content reflects the directive via
`getMarkingEditsBlockedReasonByDirective()` and never re-derives the block
locally; it only reports the reconciliation pending flag and its raw reason up to
the brain. The silent-highlight editor-preparation reconciliation
(`pageSaveReconciliationReason === "editor_preparing"`) is exempt brain-side and
never raises this overlay. The blocked-interaction toast shown when a user tries
to mark while disabled also reflects the directive reason — `saving`/`syncing`
show the reconciliation copy, `post_ai` shows the generic temporarily-disabled
copy — so no marking-block path re-reads local reconciliation state.

## Self-Markability

An element is self-markable when it is a textual container and is not blocked by
consent UI, extension UI, or immutable defaults. AI submission may opt into
consent elements after they have been hidden so they are handled by the same
hidden-textual rule as any other invisible text instead of by a stored consent
XPath list.

Direct text means text-node content owned by the element itself. Containers with
only descendant text normally yield to the descendant. Toggleable default
boundaries follow the restored 052c shape rule: direct own text makes the
boundary self-markable, otherwise the boundary is self-markable only when it has
no visible textual descendant and no explicitly marked descendant.

Automatic toggleable-default collection follows the taxonomy tag
UNCONDITIONALLY: every toggleable-default boundary is auto-excluded (subject to
the existing hidden-subtree/immutable-ancestor/consent/extension-UI skips).
This is a deliberate deviation from the 052c structure rule that suppressed
boundaries with visible immutable descendants — that suppression leaked the
boundary's boilerplate text into the default content layer (and the AI
inclusion set) whenever the boundary carried a visible image/video/svg with no
nested toggleable default, while the media itself was already excluded via the
immutable tag list. Manual toggling is unaffected; the toggle and explicit
include remain the rescue paths for meaningful content inside such boundaries.
(Decision record: marking-widening-review.md F1.)

### Visibility and CSS Clamps

Genuine hiding — `display:none`, `visibility:hidden`/`collapse`, `opacity:0`,
`hidden`, sr-only/`clip`-rect off-canvas, or a zero-area box — is not visible and
is not markable in the UI. Payload evaluation remains complete: a preserved
explicit decision survives hiding, and an otherwise mutable hidden target emits
an effective explicit exclusion without becoming a session decision.

A **CSS text clamp is not hiding.** When an element's text is fully present in
the DOM but visually truncated downward by a vertical clamp — `overflow-y`
`hidden`/`clip` on a box whose content is taller than its visible height
(a fixed `height`/`max-height` cap or `-webkit-line-clamp`) that still shows a
non-empty preview — the clipped tail is treated as visible and included, because
it is exactly the copy Google indexes (e.g. a read-more paragraph clamped to a
preview height). This sparing applies only to downward text truncation with a
visible preview: content displaced horizontally (carousels, off-canvas) or
upward is still clipped-away and excluded, and a fully collapsed zero-height box
shows no preview and stays excluded.

## Explicit Exclude Rules

When an element is explicitly excluded:

- redundant descendant exclude rows are removed,
- overlapping ordinary descendant rows are removed, while an explicit inclusion
  may coexist as a deliberate override inside a mutable expanded exclusion,
- clicking an ordinary descendant of a broader explicit exclusion removes that
  boundary, rehydrates its descendants from defaults, then excludes the clicked
  target,
- broader generated default-excluded ancestors are converted to `excluded:
  false` instead of being removed, so the descendant exclusion can live inside an
  unexcluded default boundary,
- include overrides are retained only when the approved gesture leaves their
  owning expanded boundary intact.

When an expanded explicit exclusion is toggled off, descendants are rehydrated
from defaults with no provenance link to the removed boundary.

## Explicit Include Rules

When an explicit include is added:

- ordinary descendant decisions under that include are normalized,
- Alt may later move the inclusion atomically from a mixed-text ancestor to an
  eligible child,
- non-toggleable explicit excludes are converted away,
- toggleable default rows can remain with `excluded: false` to record the user
  override. That row unmarks the exact default boundary; it is not treated as a
  full explicit include subtree.

Hidden explicit include choices remain stored while their DOM element exists and
always submit as explicit inclusions, but never render ghost geometry.

## AI Selector Integration

AI selector matches are previewed and merged with page markings without replacing
manual choices. Selector-excluded nodes suppress that exact element in the
default marking layer, while unmatched markable descendants can still appear as
default markable content.

AI excluded content is still collected for selector-matched elements, but it is not rendered as a dedicated overlay layer.

The matched selector-excluded element itself suppresses the default layer, but unmatched markable descendants can still fall through to the default layer.

The AI preview is read-only. Opening and closing preview must not create or dirty
a page draft by itself. Content List is a local content projection: opening it
must not wait for a fresh authority poll, and the 500 ms signal backstop must not
rebuild it. Row hover/focus emphasizes the page, row activation scrolls the
page, and clicking a projected page highlight focuses and scrolls the exact
occurrence-fenced row. Because popup and content consume Preview signals
independently, projected rows remain readable but disabled until the exact bound
content organ acknowledges `preview_open` or `silent_preview` through the local
signal drain and reports a consumed signal sequence at least as new as the
current Preview-open occurrence. This acknowledgement is not a remote authority
refresh, and a delayed or same-name stale reply from an exited, reopened, or
navigated occurrence cannot unlock the current list.

Inverse page-to-row routing carries two identities: the stable projection/row
ID selects the target, while a popup-local monotonic focus occurrence identifies
each accepted page activation. A second activation of the same page highlight
must therefore refocus the same semantic row button after focus moved elsewhere.
The same occurrence is handled only once, so polling, projection refresh, and
ordinary React rerenders cannot replay focus.

Starting an AI content-detection run must first enter the popup compute-busy
state, render the spinner/countdown, and apply the page-side compute lock that
pauses marking edits. Raw HTML backfills, XPath refinement, and payload
construction run only after that visible feedback has had a chance to paint, so
large saved-page payloads cannot make the click look ignored. Async run status
polling uses a five-second cadence while the run is active.

The AI endpoint is stateless with respect to property/page data. Its asynchronous
session id is only a temporary status/result polling handle, not retained property
state. Every run sends the complete property corpus at once: every candidate
page, its static and/or rendered HTML according to render
mode, its submission rows and coverage, the separate immutable-selector list,
and the active current-page session projection. Other pages come from the
latest authoritative loaded property shape. The endpoint persists no property corpus or draft and
returns one domain-wide selector set. Save subsequently persists the accepted
property/page result; Load adopts the backend's latest complete shape.

## Shadow DOM

Shadow DOM content is handled exactly as Googlebot handles it: **flattened into
real DOM**. If something Google cares about happens inside a shadow tree, the
extension must handle it too.

The sanitized page snapshot (`createSanitizedPageSnapshot`) clones the light DOM
and then inlines every retrievable shadow root into the clone as real elements
at the front of the host (composed-tree order), recursing through nested roots.
There is no `<template shadowrootmode>` wrapper in the captured HTML — the shadow
tree appears as ordinary inline elements, matching the deep-capture the consumer
performs. Because inlining happens before the strip / class / `data-uf-*`
sanitizing passes, those passes also clean the inlined shadow nodes.

- **Open** roots and closed roots captured by early `attachShadow`
  instrumentation are flattened, markable, and captured. If a closed root is
  genuinely inaccessible, omit only that root; preserve its host and accessible
  light DOM as ordinary content.
- The extension's own shadow root (WXT content-UI host, `data-wxt-shadow-root` /
  `data-uf-extension-ui`) is never captured — it is extension chrome, not page
  content.
- Positional XPath is continuous through former shadow boundaries and aligned to
  the flattened capture. `getXPath` / `getSnapshotXPath` walk the composed tree:
  they cross from a top-level shadow child up to its host, and — because shadow
  children are inlined at the front of the host — a light child of a shadow host
  is index-shifted past the host's preceding same-tag shadow children. So a
  shadow element is addressed like any other element in the flattened view and
  submission XPaths align with the captured HTML. `getElementFromXPath` resolves
  such flattened paths through the composed tree (shadow children first) when the
  document has a capturable shadow root; shadow-free pages resolve via the native
  light-DOM path unchanged.
- The page-shell guard's depth computation walks the flattened (shadow-crossing)
  parent chain, so shell protection applies inside retrievable shadow trees the same as
  in light DOM.
- The live engine treats shadow content as real DOM: the default-content
  enumeration and the reconcile scan descend into capturable shadow roots
  (composed order, shadow first), so shadow text is enumerated as implicit
  content and shadow noise is default-classified by the taxonomy (a shadow
  read-more `<button>` is auto-excluded, the shadow `<p>` auto-included).
  Hit-testing is composed-aware: a hit reported on a shadow host still counts as
  a hit on the shadow content it paints (paint-reachability), and target
  resolution / hover pierce retrievable shadow roots so inner shadow nodes are
  click-markable. Overlays position over composed geometry via each element's
  real client rects. All shadow descent is gated on the presence of a capturable
  shadow root, so shadow-free pages behave exactly as before.

## AI Submission Rows

`submissionXpaths` is the shallow boundary list sent for CSS selector
calculation. Page marking sync runs before saving, and submission XPath rows are
calculated in the same sanitized DOM view as `renderedHtml`: extension UI,
browser-automation roots, and other save-time strip selectors do not count when
sibling indexes are assigned. This keeps saved HTML and saved XPath evidence
aligned even when overlays, toasts, or automation containers are present in the
live page.

Rules:

- explicit includes always submit as included rows,
- every stored excluded XPath row submits as an excluded row unless explicitly
  included or suppressed by an already submitted excluded ancestor; this includes
  generated/default excluded rows and preserves 052c submission semantics while
  still keeping `explicit: true` as local user-edit metadata,
- silent whitespace explicit-exclude rows submit as excluded rows but are hidden
  from the marking UI and include targeting,
- descendants under an already submitted excluded ancestor are omitted unless
  they are explicit includes,
- consent UI is not stored or submitted through dedicated consent XPath rows; it
  is hidden before saving and any textual consent content is handled by the
  visually invisible textual-content rule,
- immutable defaults and their descendants are excluded by the immutable tag list
  sent with the payload, not by per-page XPath rows; stale immutable rows are
  suppressed before submission,
- visible textual markable content submits as included rows,
- visually invisible textual markable content submits as effective explicit
  excluded rows using the
  mobile simulation geometry at save time; below-fold content is still considered
  visible because the submission viewport is treated as page-height, while
  content outside the mobile viewport width or document height is invisible;
  text merely clipped by a vertical CSS clamp (see Visibility and CSS Clamps) is
  not invisible-textual — it submits as included,
- every recognized managed tab continuously uses the fixed Googlebot Smartphone
  posture; users cannot disable it or change scale/device metrics, and
  navigation, debugger detach, and tab rebinding self-heal,
- the only desktop posture is the approved silent-only desktop preview; it is
  not a general simulator, disables marking entry, and restores crawler mobile
  when the preview ends,
- same-property pages that are outside the current Live Page candidate list
  still keep silent highlighting and property-lock status for that property;
  only marking entry is blocked there,
- if the editor tab navigates to a different property, property-lock cooldown
  may remain recoverable for 30 seconds, but approved navigation discards the
  marking session itself; returning never restores mutable marking decisions,
- Render Mode detection uses the explicit inspection snapshot: sanitized
  rendered HTML captured after reveal/freeze and before highlighting, paired
  with static/raw HTML from the background `fetchStaticPageHtml` path,
- non-textual implicit nodes are omitted,
- document roots `/html[1]` and `/html[1]/body[1]` are never submitted.

## Silent Highlighting

Silent highlighting uses three overlay layers:

1. `immutable` exclusions,
2. `content`,
3. `excluded` content.

The older 052c `links` silent layer for already-marked page anchors is not part
of the current locked contract.

Immutable silent highlights use a subtle dashed border and transparent
background. Hidden targets never draw ghost geometry. Their effective payload
state remains independent from current renderability.

Marking and silent-highlight rectangles fade out during scroll, resize, and
layout churn. Once stable, they reuse/reposition existing geometry when valid or
recompute when required, then fade back in without waiting for remote refresh.

Content List inverse targeting is acknowledged by DOM focus, not merely by a
persistent selected-row value. Each accepted page-highlight click carries a new
popup-local occurrence, so clicking the same highlight again after focus moved
elsewhere must restore focus to the same semantic row button and is a distinct
successful interaction.

On a replacement document, a marking or preview command may arrive after the
initial property probe but before interaction-shield authority is bound. The
content entrypoint performs at most one exact-current-page context re-probe in
that case. It proceeds only when that probe establishes authority and otherwise
fails closed; navigation, URL, lifecycle, and terminal fences are unchanged.

## Regression Coverage

Focused rule coverage lives in:

- `tests/config.test.ts`
- `tests/core-motion-pause.test.ts`
- `tests/marking-rules.test.ts`
- `tests/core-visibility.test.ts`
- `tests/submission-rules.test.ts`
- `tests/silent-highlight-rules.test.ts`
- `tests/selector-suppression.test.ts`
- `tests/silent-highlight-annotations.test.ts`
- `tests/core-scheduling.test.ts`
- `tests/popup-marking-refresh.test.ts`
