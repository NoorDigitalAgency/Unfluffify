# Marking And Highlighting Logic

This document is the source of truth for the marking rules restored from
`b9c86238b08dd0b0ee0231fcab7b214625e29670`, with the explicit contract change
that `BUTTON` is now toggleable and `LINK` is now immutable.

## Locked Contract

The marking rules in this document are a locked compatibility contract. Do not
change the taxonomy, target resolution, sync semantics, overlay projection, or
default-exclusion behavior unless the user explicitly asks for a marking-rules
contract change.

Any legitimate contract change must update this document, `.copilot/knowledge.md`,
`.copilot/plan.md`, `README.md`, and the focused regression tests in the same
commit. A change that only patches rendering, caching, hover targeting, or sync
output is not sufficient if it alters the rules below.

Non-negotiable invariants:

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
- Fast refresh, caching, or performance work may only be an adaptation layer over
  the b9 rules. It must sync page markings before drawing and must not create a
  second source of marking truth.

The implementation is split across:

- `content/core.js` for DOM targeting, synchronization, and overlay rendering.
- `content/marking-rules.js` for pure marking decisions.
- `content/submission-rules.js` for AI submission row decisions.
- `content/silent-highlight-rules.js` for silent-highlight redraw/source rules.
- `common/constants.js` for default exclusion categories.

## Core Model

A page marking entry combines four inputs:

1. immutable default exclusions,
2. toggleable default exclusions,
3. AI selector matches,
4. explicit per-page XPath choices.

The resulting model renders marking overlays while marking mode is enabled and
stores normalized XPath rows in `config.pageMarkings[pageUrl]`.

`config.pageMarkings` can contain local drafts. Candidate completion is a
backend-save fact, not a local-draft fact: the Todo List, candidate `Marked`
badges, marked-pages list, and Lynx checklist coverage must read the separate
backend-saved page-marking cache populated from confirmed backend payloads.
When the current tab is a valid Live Page candidate, the Todo List must label
both the candidate row and its parent page-type subsection as `Current` so the
active page remains findable when subsections are collapsed.
Initial Live Page candidate loading may use the normal popup loading state, but
periodic non-initial candidate refreshes must run quietly. A periodic refresh
only interrupts the user after the fetched candidate signature changes: if the
active page is no longer valid, marking is stopped and a blocking alert explains
why; in all changed cases the Todo List root is expanded and a warning notice
asks the user to review the updated candidates.
Unrelated config syncs must not upload local draft page markings; only
backend-saved pages and the current page during an explicit save/revert belong
in a sync payload. Page-save reconciliation can be cleared only after the
forced backend reload confirms that current page exists in the backend-saved
cache. Confirmed current-page saves must refresh that cache even when their
second-granularity timestamp matches the previous saved entry, otherwise the
saved baseline can stay one save behind and keep the page falsely dirty. A new
page with no saved local or remote data remains saveable with the default
markings accepted as-is.

Property edit ownership is defined separately in `PROPERTY_LOCK.md`. Marking
mode must respect that contract: only the current property editor can mutate
page markings, while locked passive observers may refresh remote state and
silent-highlighting status without becoming a second source of truth.

## Exclusion Categories

### Immutable Defaults

Immutable defaults are always excluded and cannot be overridden from marking
mode. They include `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`,
`SCRIPT`, `TEMPLATE`, `IFRAME`, `VIDEO`, and `LINK`.

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

`BUTTON` is intentionally toggleable. `LINK` is intentionally immutable.

Toggleable defaults are not promoted to explicit includes by a plain exclude
click. Exclude mode keeps drilling to the nearest markable content target unless
the user holds `Shift` to select a broader boundary. Include mode is explicit:
the user holds `Alt` and the selected target is written to the local
`includeXpaths` list, then synced as an explicit include row in `xpaths`.
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
- `xpaths`: ordered `{ xpath, excluded }` rows; user-created exclude rows
  carry `explicit: true`
- `includeXpaths`: local explicit include XPath rows
- `selectorSuppressedXpaths`: local selector-default suppression overrides
- `silentWhitespaceExcludedXpaths`: local bookkeeping for generated whitespace
  explicit-exclude rows
- `submissionXpaths`
- `renderedHtml`
- `rawHtml`

`xpaths` stores explicit user exclusions plus generated/default posture rows.
Only rows with `explicit: true` are treated as user exclusions for AI
submission and explicit-overlay rendering; untagged generated or legacy rows are
sync posture and may be dropped if they do not still match a generated default.
`includeXpaths` is the local explicit-include list. Normalization removes
redundant nested rows when a broader boundary takes over a subtree. Config sync
does not send `includeXpaths` or `selectorSuppressedXpaths` as separate fields:
both are merged into `xpaths` as `{ xpath, excluded: false, explicit: true }`
rows and reconstructed into the local lists when loaded.

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

For toggleable default exclusions, a stored row with `excluded: false` is the
user's explicit unmark for that exact default boundary. It must suppress the
boundary's own default-layer marking without suppressing unmarked descendants,
so the unmarked boundary does not render as a visual-only ghost around an
explicit descendant marking. Nested toggleable defaults keep their own default
behavior. Default-layer collection intentionally remains otherwise b9-like:
explicit marks should not globally filter unrelated implicit default targets,
because that can make implicit descendant markings flicker on alternating
toggles.

Default-layer projection uses two related but distinct sets:

- explicit excludes suppress only the explicit boundary itself at default-layer
  precedence,
- all synced excluded boundaries suppress descendant default-layer projection.

That split keeps generated default boundaries visible on initial render while
still preventing duplicate descendant default markings under excluded ancestors.

Both full renders and fast explicit-toggle overlay refreshes must run page
marking synchronization before drawing. The fast refresh is only an adaptation
layer over the b9 rules; it cannot draw from a just-mutated entry until
generated default posture rows, including default ancestors converted to
`excluded: false`, have been reconciled.

## Marking Performance Contract

Marking mode must avoid duplicate full-page passes:

- Enabling marking performs one activation path. The popup sends `setEnabled`;
  content activation/sync/render is handled from there, without a second
  immediate `forceRefresh`. Before page motion is frozen and overlays are
  rendered, activation may run a bounded reveal warm-up that restores the
  user's original scroll position.
- A manual refinement performs a cheap immediate explicit-layer refresh, then a
  delayed invalidating full rebuild for correctness. The immediate refresh may
  update explicit include/exclude layers and cached explicit collections, but it
  must not recompute the default layer or redraw every layer. The delayed full
  rebuild should run on a short cadence so ancestor unmarks do not visibly lag
  before descendants receive refreshed default markings.
- A full marking pass may cache per-element visibility, text, immutable/default
  selector, ancestor, and textual-descendant decisions for the duration of that
  pass. These caches are derived from the current DOM/config and are not a
  persistent source of truth.
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
- Overlay drawing must not interleave layout reads with overlay writes. Every
  draw pass (full rebuild, explicit-layer refresh, and scroll/pointer
  reposition) resolves all element geometry first, then applies every overlay
  mutation in a single write batch. Reading layout
  (`getClientRects`/`getBoundingClientRect`/`getComputedStyle`/`elementsFromPoint`)
  between overlay writes forces one synchronous reflow per marked element, which
  is what freezes the page after a toggle on large pages.
- The delayed full rebuild that paints descendant default markings runs under a
  short idle budget, not the snapshot idle timeout. A long idle budget lets the
  toggle's own work defer the descendant defaults for seconds when the main
  thread is briefly busy.

## Motion Stability Contract

Any page that Unfluffify owns for marking or silent highlighting holds a page
motion pause. This includes active marking mode, passive silent highlighting,
and matching base-URL pages that have no selector highlights yet. The pause is
part of the save and highlighting contract, not just a visual convenience:
animated carousels can move text outside the viewport, update inline transforms,
flip visibility state, and change which textual nodes are submitted as visible
AI evidence.

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

## Target Resolution

Targets are resolved from `document.elementsFromPoint(...)`, skipping extension
UI, consent UI, document roots, and immutable subtrees.

Hit targets must have renderable marking geometry. A live element whose own box
is hidden, transparent, or otherwise not visible cannot be selected just
because `elementsFromPoint` returned it. Collapsed textual wrappers may fall
back to visible descendant geometry, and hidden explicit includes may remain as
ghost include markings when measurable, but completely invisible explicit
targets are ignored.

Renderable marking geometry also has to be paint-reachable in the current
viewport. Responsive alternates that keep measurable boxes but are fully covered
by another card face, slide face, or click layer must not render as separate
default targets. If hit testing is unavailable or the element is off-screen, the
cached collection keeps the element and the viewport redraw performs the same
paint-reachability check when it scrolls into view.

### Exclude Mode

Plain exclude clicks choose the nearest self-markable target. Already excluded
non-default ancestors are not forced back into the selection path, so users can
refine a broad exclusion by clicking deeper descendants. Active toggleable
default boundaries do not steal descendant clicks: clicking a markable
descendant inside a default-excluded footer, header, form, label, nav, dialog,
or aside records that boundary as `excluded: false` and records the descendant
as the explicit exclusion. Clicking the default boundary itself, where no
descendant wins target resolution, still unmarks that default boundary directly.

`Shift+Click` enables parent selection. Under the restored b9 behavior, a parent
boundary is eligible when it has direct text or at least one self-markable
descendant. This intentionally allows single-content-branch wrappers to be
selected as broader boundaries.

### Include Mode

`Alt` switches to include mode. Include mode can inspect descendants inside
excluded parents and prefers explicit targets first. The selected element is
stored locally in `includeXpaths` when it is eligible and synced through the
single `xpaths` field as an explicit include row.

Explicit include boundaries are closed boundaries: descendants under an active
include are not targetable until the include itself is removed.

### Page Interaction Mode

Holding `Space` while marking mode is enabled temporarily lets clicks pass
through to the underlying page UI. This is for opening accordions, tabs,
menus, and similar controls before returning to marking or explicit include
work. `Alt` remains include mode and `Shift` remains parent selection, so page
interaction is intentionally a separate hold state. Releasing `Space`, window
blur, visibility changes, or disabling marking restores the overlay and redraws
markings over the page's new posture.

Silent highlighting overlays never capture page clicks, so users can interact
with accordions directly in passive highlighting mode. The same page-motion
pause remains active in both modes to keep markings and highlights comparable.

### Temporary Disabled State

Marking can remain active while editing is temporarily blocked, such as during a
page save or while saved page data is waiting for backend sync confirmation. In
that state the page overlay stays mounted, dims existing markings, clears hover
feedback, switches to a progress cursor, and shows a persistent `aria-live`
status notice that marking is paused. The notice is extension UI and is stripped
from saved snapshots with the rest of the overlay.

## Self-Markability

An element is self-markable when it is a textual container and is not blocked by
consent UI, extension UI, or immutable defaults. AI submission may opt into
consent elements after they have been hidden so they are handled by the same
hidden-textual rule as any other invisible text instead of by a stored consent
XPath list.

Direct text means text-node content owned by the element itself. Containers with
only descendant text normally yield to the descendant. Toggleable default
boundaries follow the b9 shape rule: they are self-markable only when they do
not have a visible textual descendant. Existing explicit descendant markings do
not by themselves suppress the boundary.

## Explicit Exclude Rules

When an element is explicitly excluded:

- redundant descendant exclude rows are removed,
- overlapping include rows are removed,
- broader explicit exclude ancestors are removed when the new target is a more
  specific descendant,
- broader generated default-excluded ancestors are converted to `excluded:
  false` instead of being removed, so the descendant exclusion can live inside an
  unexcluded default boundary,
- hidden include overrides inside a removed excluded ancestor are cleaned up.

When an explicit exclude is toggled off, descendant include overrides that only
existed to punch through that exclusion are removed with it.

## Explicit Include Rules

When an explicit include is added:

- descendant excludes under that include are removed,
- descendant includes under that include are removed,
- non-toggleable explicit excludes are converted away,
- toggleable default rows can remain with `excluded: false` to record the user
  override. That row unmarks the exact default boundary; it is not treated as a
  full explicit include subtree.

Hidden explicit include choices remain stored while their DOM element exists and
render as ghost include markings when they still have measurable geometry.

## AI Selector Integration

AI selector matches are previewed and merged with page markings without replacing
manual choices. Selector-excluded nodes suppress that exact element in the
default marking layer, while unmatched markable descendants can still appear as
default markable content.

AI excluded content is still collected for selector-matched elements, but it is not rendered as a dedicated overlay layer.

The matched selector-excluded element itself suppresses the default layer, but unmatched markable descendants can still fall through to the default layer.

The AI preview is read-only. Opening and closing preview must not create or dirty
a page draft by itself.

Starting an AI content-detection run must first enter the popup compute-busy
state, render the spinner/countdown, and apply the page-side compute lock that
pauses marking edits. Raw HTML backfills, XPath refinement, and payload
construction run only after that visible feedback has had a chance to paint, so
large saved-page payloads cannot make the click look ignored. Async run status
polling uses a five-second cadence while the run is active.

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
- only `explicit: true` excludes submit as excluded rows unless explicitly
  included; generated toggleable-default rows and untagged stale rows are not
  treated as explicit exclusions,
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
- visually invisible textual markable content submits as excluded rows using the
  mobile simulation geometry at save time; below-fold content is still considered
  visible because the submission viewport is treated as page-height, while
  content outside the mobile viewport width or document height is invisible,
- non-textual implicit nodes are omitted,
- document roots `/html[1]` and `/html[1]/body[1]` are never submitted.

## Silent Highlighting

Silent highlighting uses three overlay layers:

1. immutable exclusions,
2. included content,
3. excluded content.

Immutable silent highlights use a subtle dashed border and transparent
background. Hidden implicit includes are dropped, while hidden explicit includes
can remain as ghost include sources. Excluded sources remain collectable while
temporarily hidden; current renderability only controls whether a rect is drawn
at that moment.

Silent highlight redraws wait for tracked positions to settle after movement and
force a repaint on full active refreshes even when the render key is unchanged.

## Regression Coverage

Focused rule coverage lives in:

- `tests/config.test.js`
- `tests/core-motion-pause.test.js`
- `tests/marking-rules.test.js`
- `tests/core-visibility.test.js`
- `tests/submission-rules.test.js`
- `tests/silent-highlight-rules.test.js`
- `tests/selector-suppression.test.js`
- `tests/silent-highlight-annotations.test.js`
- `tests/core-scheduling.test.js`
- `tests/popup-marking-refresh.test.js`
