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
- After that decision, default exclusions are ordinary `{ xpath, excluded: true }`
  rows and render through the ordinary exclude overlay.
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
Unrelated config syncs must not upload local draft page markings; only
backend-saved pages and the current page during an explicit save/revert belong
in a sync payload. Page-save reconciliation can be cleared only after the
forced backend reload confirms that current page exists in the backend-saved
cache. A new page with no saved local or remote data remains saveable with the
default markings accepted as-is.

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
the user holds `Alt` and the selected target is written to `includeXpaths`.

Toggleable default exclusions have no separate visual layer or class. Once the
decision step marks a default boundary as excluded, it is represented by the
same `{ xpath, excluded: true }` row and the same exclude overlay as any other
excluded element. This keeps the visual layer a projection of the current
marking state instead of an independent source of default-exclusion behavior.

## Stored Page Entries

Each page entry may contain:

- `title`
- `timestamp`
- `xpaths`: ordered `{ xpath, excluded }` rows
- `includeXpaths`: explicit include XPath rows
- `consentXpaths`
- `selectorSuppressedXpaths`
- `submissionXpaths`
- `renderedHtml`
- `rawHtml`

`xpaths` stores excluded rows and generated/default posture rows. `includeXpaths`
is the canonical explicit-include list. Normalization removes redundant nested
rows when a broader boundary takes over a subtree.

For toggleable default exclusions, a stored row with `excluded: false` is the
user's explicit unmark for that exact default boundary. It must suppress the
boundary's own default-layer marking without suppressing unmarked descendants,
so the unmarked boundary does not render as a visual-only ghost around an
explicit descendant marking. Nested toggleable defaults keep their own default
behavior. Default-layer collection intentionally remains otherwise b9-like:
explicit marks should not globally filter unrelated implicit default targets,
because that can make implicit descendant markings flicker on alternating
toggles.

Both full renders and fast explicit-toggle overlay refreshes must run page
marking synchronization before collecting overlays. The fast refresh is only an
adaptation layer over the b9 rules; it cannot draw from a just-mutated entry
until generated default posture rows, including default ancestors converted to
`excluded: false`, have been reconciled.

## Target Resolution

Targets are resolved from `document.elementsFromPoint(...)`, skipping extension
UI, consent UI, document roots, and immutable subtrees.

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
stored in `includeXpaths` when it is eligible.

Explicit include boundaries are closed boundaries: descendants under an active
include are not targetable until the include itself is removed.

## Self-Markability

An element is self-markable when it is a textual container and is not blocked by
consent UI, extension UI, or immutable defaults.

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

## AI Submission Rows

`submissionXpaths` is the shallow boundary list sent for CSS selector
calculation. Submission XPath rows are calculated in the same sanitized DOM view
as `renderedHtml`: extension UI and other save-time strip selectors do not count
when sibling indexes are assigned. This keeps saved HTML and saved XPath evidence
aligned even when the extension has injected overlay or toast nodes into the live
page.

Rules:

- explicit includes always submit as included rows,
- explicit excludes submit as excluded rows unless explicitly included; generated
  toggleable-default rows are not treated as explicit exclusions,
- descendants under an already submitted excluded ancestor are omitted unless
  they are explicit includes,
- consent roots submit as excluded rows,
- immutable defaults and their descendants are excluded by the immutable tag list
  sent with the payload, not by per-page XPath rows,
- visible textual markable content submits as included rows,
- visually invisible textual markable content submits as excluded rows using the
  mobile simulation geometry at save time; below-fold content is still considered
  visible because the submission viewport is treated as page-height, while
  content outside the viewport/document bounds is invisible,
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

- `tests/marking-rules.test.js`
- `tests/core-visibility.test.js`
- `tests/submission-rules.test.js`
- `tests/silent-highlight-rules.test.js`
- `tests/selector-suppression.test.js`
- `tests/silent-highlight-annotations.test.js`
