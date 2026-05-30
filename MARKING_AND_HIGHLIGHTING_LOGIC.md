# Marking And Highlighting Logic

This document is the source of truth for the marking rules restored from
`b9c86238b08dd0b0ee0231fcab7b214625e29670`.

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

## Exclusion Categories

### Immutable Defaults

Immutable defaults are always excluded and cannot be overridden from marking
mode. They include `IMG`, `BUTTON`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`,
`STYLE`, `SCRIPT`, `TEMPLATE`, `IFRAME`, and `VIDEO`.

An element inside an immutable default subtree is not markable. Immutable nodes
render as hard exclusions in marking mode and on the dedicated immutable layer
in silent highlighting.

### Toggleable Defaults

Toggleable defaults start excluded but can be toggled by the user. The b9
taxonomy is:

- `FOOTER`
- `FORM`
- `LABEL`
- `NAV`
- `HEADER`
- `DIALOG`
- `ASIDE`

`BUTTON` is intentionally immutable, not toggleable. `LINK` is not a default
exclusion.

Toggleable defaults are not promoted to explicit includes by a plain exclude
click. Exclude mode keeps drilling to the nearest markable content target unless
the user holds `Shift` to select a broader boundary. Include mode is explicit:
the user holds `Alt` and the selected target is written to `includeXpaths`.

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

## Target Resolution

Targets are resolved from `document.elementsFromPoint(...)`, skipping extension
UI, consent UI, document roots, and immutable subtrees.

### Exclude Mode

Plain exclude clicks choose the nearest self-markable target. Already excluded
ancestors are not forced back into the selection path, so users can refine a
broad exclusion by clicking deeper descendants.

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
- hidden include overrides inside a removed excluded ancestor are cleaned up.

When an explicit exclude is toggled off, descendant include overrides that only
existed to punch through that exclusion are removed with it.

## Explicit Include Rules

When an explicit include is added:

- descendant excludes under that include are removed,
- descendant includes under that include are removed,
- non-toggleable explicit excludes are converted away,
- toggleable default rows can remain with `excluded: false` to record the user
  override.

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
calculation.

Rules:

- explicit includes always submit as included rows,
- explicit excludes submit as excluded rows unless explicitly included,
- descendants under an already submitted excluded ancestor are omitted unless
  they are explicit includes,
- consent roots, immutable roots, and hidden toggleable roots submit as excluded
  rows,
- visible textual markable content submits as included rows,
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
