# Marking And Highlighting Logic

This document is the source of truth for how Unfluffify decides:

- what can be marked,
- what is highlighted,
- how AI selector output is merged with manual markings,
- how default exclusions behave,
- how per-page XPath markings are regenerated and stored.

The implementation lives primarily in `content/core.js`, with default selector categories in `common/constants.js`.

## Core Model

Unfluffify builds the page state from four inputs:

1. Immutable exclusions
2. Toggleable default exclusions
3. AI selector output
4. Manual per-page XPath markings

The page is then rendered into highlight layers and persisted back into `pageMarkings`.

## Exclusion Categories

### Immutable exclusions

Immutable exclusions are elements that are always excluded and cannot be toggled by the user.

They come from `DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS` in `common/constants.js`.

Examples include:

- `IMG`
- `INPUT`
- `SCRIPT`
- `STYLE`
- `IFRAME`
- `VIDEO`

If an element matches one of these selectors, or lives inside one, it is treated as hard-excluded.

### Toggleable default exclusions

Toggleable default exclusions are elements that start from an excluded posture, but the user may refine, unmark, or explicitly include them.

They come from `DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS` in `common/constants.js`.

Current default toggleable tags:

- `FOOTER`
- `FORM`
- `LABEL`
- `BUTTON`
- `NAV`
- `HEADER`
- `DIALOG`
- `ASIDE`

Toggleable defaults still remain toggleable, but auto-applied default exclusion now uses structural rules instead of tag-specific exceptions. Content wrappers are not auto-applied as excluded boundaries when they contain meaningful text descendants and visible immutable media such as stretched hero images. Separately, once a descendant inside a toggleable default subtree has any explicit user marking, broader auto-default ancestors above that descendant are suppressed so the user can clear the subtree level by level without the ancestor snapping back in automatically.

## Stored Per-Page Markings

Each page entry in `config.pageMarkings[pageUrl]` stores:

- `timestamp`
- `title`
- `xpaths`: ordered XPath items with `{ xpath, excluded }`
- `includeXpaths`: ordered XPath list for explicit includes
- `consentXpaths`
- `submissionXpaths`
- `renderedHtml`
- `rawHtml`

Important rules:

- `xpaths` holds both generated and explicit exclude-state items.
- `includeXpaths` is the canonical list of explicit includes.
- A given subtree is normalized so that broader and narrower markings do not coexist redundantly.
- `submissionXpaths` is the final AI payload boundary list.
- Submission boundaries are intentionally shallow: excluded ancestors suppress descendant exclusion rows unless the descendant is itself an explicit include.
- Explicit includes always submit as included rows, even when they are currently hidden or live inside excluded ancestors.

## Markable Elements

An element is markable only if it passes the content-side eligibility checks in `content/core.js`.

### Self-markable elements

An element is self-markable when it is a textual container and is not blocked by consent UI, extension UI, or immutable exclusions.

The important distinction is between:

- elements with their own direct text,
- elements that only become textual because of descendants.

Direct text means actual text-node content owned by the element itself, not only text inherited from descendants.

For toggleable default exclusions, direct text keeps the boundary self-markable even when the element also contains nested textual descendants. This is what allows labels, buttons, and similar toggleable boundaries to stay targetable as their own unit instead of collapsing entirely to the nested child nodes.

Examples:

- `<span>Hello <strong>world</strong></span>`: the `span` has direct text and a descendant.
- `<span><strong>world</strong></span>`: the `span` has no direct text.

That difference matters during include targeting.

### Mixed-text ancestor preference

When the user is in include mode and the pointer is over a descendant inside a mixed-text ancestor, Unfluffify prefers the nearest markable ancestor that has its own direct text.

This rule also applies to toggleable default-excluded boundaries that carry their own text, such as labels that contain both plain text and nested required markers.

Example:

```html
<span>Hello <strong>world</strong></span>
```

In include mode, clicking on `strong` should resolve to the `span`, because the `span` owns real text outside the descendant and represents the logical content boundary the user sees.

By contrast:

```html
<span><strong>world</strong></span>
```

Here the `span` has no own text, so the `strong` remains the appropriate target.

### Parent selection with Shift

In exclude mode, `Shift+Click` means “choose a broader eligible ancestor instead of the deepest eligible descendant under the pointer.”

This is how users intentionally move back up to a broader boundary such as a form or sidebar container.

An expanded exclusion boundary must either own direct text at its root level or contain more than one textual descendant. A parent with no direct text and only one textual descendant is not a valid exclusion target, even if it has other non-textual children.

For structured non-text wrappers whose direct children are the separate textual boundaries the user sees, `Shift+Click` prefers the nearest such grouping ancestor. This is what allows containers like button groups and list wrappers to be excluded as one logical block.

When multiple toggleable default exclusions are nested, `Shift+Click` prefers the nearest toggleable default ancestor in the clicked subtree rather than jumping straight to the broadest one. That keeps intermediate boundaries such as `FORM` inside `ASIDE` and `NAV` inside `HEADER` reachable.

Without `Shift`, exclude mode prefers drilling down.

## Pointer Target Resolution

Target resolution is performed from `document.elementsFromPoint(...)`.

The effective rules are:

### Include mode

- explicit targets are preferred first,
- descendants inside excluded parents are allowed,
- mixed-text ancestor promotion is enabled,
- descendants inside explicit include parents are blocked until that explicit include is removed,
- the result is the nearest meaningful content boundary.

### Exclude mode

- explicit exclude ancestors are not force-selected first,
- direct clicks on the currently excluded element itself still resolve to that exact element,
- direct clicks on a toggleable default boundary itself still resolve to that exact boundary when the user is intentionally selecting ancestors with `Shift`,
- descendants inside excluded parents are still inspectable,
- descendants inside explicit include parents are not inspectable or markable until the explicit include boundary is removed,
- the default behavior is to drill down,
- `Shift` is required to select a broader ancestor on purpose.

This prevents a previously excluded parent from reasserting itself when the user is trying to refine the exclusion to a deeper child.

## Exclusion Refinement Rules

When a new explicit exclusion is applied, the exclusion hierarchy is normalized in both directions.

### Descendant cleanup

If a broader element is newly excluded, descendant markings inside that subtree are removed.

Reason:

- once the parent is excluded, separate descendant excludes are redundant.

### Ancestor cleanup

If a narrower descendant is newly excluded inside an already excluded ancestor, the broader ancestor exclusion is removed.

Reason:

- the user is refining the boundary,
- the more specific target should replace the broader one,
- non-`Shift` exclude clicks should drill deeper rather than bounce back up.

This is the rule that prevents `ASIDE -> FORM -> LABEL` hierarchies from snapping back to the ancestor while the user is trying to go down a level.

### Explicit include boundary protection

Explicit includes are closed content boundaries. Their descendants do not show hover targeting and cannot be marked as either explicit includes or explicit excludes while the ancestor include remains active.

The exact explicit include boundary itself remains targetable so the user can remove it. After the include is removed, the descendants return to their default or inherited marking behavior and may be marked normally.

### Descendant include cleanup during exclusion removal

If an excluded boundary is unmarked, any descendant explicit include overrides beneath that boundary are removed as well.

The same cleanup also runs when a broader excluded ancestor is removed indirectly because the user refined the exclusion to a narrower descendant.

Reason:

- once the parent exclusion is gone, descendant explicit includes that only existed to punch holes through that exclusion become redundant,
- the subtree should return to its default state instead of preserving stale include overrides.

## Explicit Include Rules

Explicit includes are stored separately in `includeXpaths`.

When an explicit include is added:

- descendant excludes under that include are removed,
- descendant includes under that include are removed,
- the explicit include becomes the boundary for that subtree.

Explicit includes always override default toggleable exclusions for the targeted subtree.

If an element is temporarily hidden after being explicitly marked, the explicit marking remains stored while the element is present in the DOM. When the element still has a measurable box, it is rendered as a non-toggleable ghost marking: hidden includes use a semi-transparent dotted green border without a background, and hidden excludes use a semi-transparent dashed red border without a background. When it becomes visible again, the normal toggleable explicit marking returns.

## AI Selector Interpretation

AI selectors are normalized into two lists:

- `exclusionSelectors`
- `inclusionSelectors`

The content logic resolves these selectors to DOM elements and derives:

- AI included content
- AI excluded content

### AI submission boundary rules

The saved `submissionXpaths` sent for CSS-selector calculation follow these rules:

- exclusion rows are only the root boundaries of excluded regions,
- descendants under an already-submitted excluded root are omitted,
- immutable exclusion roots are always submitted as excluded rows,
- consent UI roots are submitted as excluded rows,
- toggleable roots that are excluded by current page markings are submitted as excluded rows,
- toggleable roots that are visually hidden at save time are also submitted as excluded rows,
- textual boundaries that do not fall under those exclusion rules submit as included rows,
- explicit includes always submit as included rows, even when hidden or nested inside excluded ancestors.

### AI inclusion eligibility

An element is eligible for AI inclusion when it is:

- not inside immutable exclusions,
- not inside consent or extension UI,
- not inside a submitted exclusion boundary unless explicitly included.

Because auto-applied toggleable default exclusion is now structural, text inside content wrappers such as hero sections can still participate in implicit inclusion and silent highlighting when the wrapper is only carrying decorative immutable media, while true UI/control containers remain excluded by default.

AI preview is read-only. Opening or closing the AI preview popover must not create or dirty a page draft by itself, even when the normal marking overlay would auto-seed an unmarked page from stored AI selectors. Preview restore suppresses that one auto-seed pass so the pre-preview draft state is preserved.

Silent highlight overlay positions are refreshed not only on scroll and relevant DOM mutations, but also on detected layout shifts. Movement-driven repositioning waits for tracked elements to settle before redrawing, so long-running shifts do not leave overlays stuck at an intermediate position.

An active full silent-highlight refresh always repaints the overlay, even if the tracked node set and selector maps are unchanged. This prevents delayed visibility or render-box changes from being missed just because the render key stayed stable.

Silent exclusion source selection is visibility-agnostic. Selector-excluded and inferred excluded boundaries stay in the silent-highlight source set even when they are temporarily non-drawable, such as Webflow-style `opacity: 0` fade-ins. Current visibility only affects whether rects are drawn at that moment, not whether the exclusion boundary is tracked.

Marking overlay updates watch style attribute changes as well as class, id, hidden, aria-hidden, child-list, and text mutations. Opacity, visibility, displacement, and animation-driven style changes therefore trigger a redraw/reposition pass instead of leaving stale markings.

## Regression Coverage

The pure decision rules that are most likely to regress are covered by Node tests:

- `tests/marking-rules.test.js` locks in toggleable self-markability and exclude parent-boundary selection.
- `tests/marking-rules.test.js` also locks in the one-shot suppression rule that keeps AI preview restore from auto-seeding a new draft.
- `tests/marking-rules.test.js` also locks in expanded exclusion eligibility, explicit-include descendant blocking, and hidden explicit ghost presentation.
- `tests/submission-rules.test.js` locks in the final AI submission row decisions for exclusion roots, explicit includes, hidden toggleable roots, consent roots, immutable roots, and excluded-ancestor suppression.
- `tests/core-visibility.test.js` locks in visibility semantics for hidden attributes, `aria-hidden`, and collapsed visibility.
- `tests/core-visibility.test.js` also locks in that style mutations trigger overlay repositioning for dynamic visibility changes.
- `tests/silent-highlight-rules.test.js` locks in the settle-before-redraw behavior for movement-driven silent highlighting.
- `tests/silent-highlight-rules.test.js` also locks in the rule that a full active silent-highlight refresh must repaint even when the render key is unchanged.
- `tests/silent-highlight-rules.test.js` also locks in the rule that temporarily hidden excluded nodes must remain collectable as silent-highlight sources.

Run `npm test` from the repository root to execute the regression suite.

## Highlight Collections

The rendered overlay is split into these logical collections:

- ghost explicit elements
- hard elements
- explicit exclude elements
- explicit include elements
- AI content elements
- AI excluded content elements
- default elements

### Ghost explicit elements

Ghost explicit elements are hidden stored explicit includes or excludes that must remain persisted but are not currently toggleable. They render below normal markable layers with static semi-transparent borders and no backgrounds.

### Hard elements

Hard elements are:

- immutable exclusions.

These render in the hard-excluded layer.

### Explicit exclude elements

These come from the current page entry's excluded XPath items after filtering out:

- consent exclusions,
- immutable exclusions,
- explicit-included subtrees.

### Explicit include elements

These come from `includeXpaths` after removing invalid, consent, immutable, or overridden elements.

### AI content elements

These come from:

- explicit include elements that are also part of the AI-included content model,
- implicit AI-included XPath items stored as `excluded === false`.

### Default elements

Default elements are generated from the live DOM after higher-precedence layers are known.

They are the lowest-precedence visible content candidates that remain after removing:

- hard exclusions,
- consent exclusions,
- explicit excludes,
- explicit includes,
- AI included content,
- AI excluded content.

## Precedence Order

When layers overlap, precedence is:

1. Ghost explicit markings
2. Immutable and hard exclusions
3. Default content highlights
4. AI excluded descendants
5. Explicit excludes
6. AI included content
7. Explicit includes
8. Focus and hover targeting

Visual layers are ordered so immutable exclusions remain subtle, markable elements can appear above immutable overlaps, and inclusions remain easiest to see. Lower-precedence decision layers do not replace higher-precedence classification decisions.

## Rebuild And Persistence Flow

On render or relevant DOM/config changes, Unfluffify:

1. collects immutable exclusions,
2. loads the current page entry,
3. optionally seeds a new page entry from AI selectors when the page is still unmarked,
4. regenerates normalized `xpaths` and `includeXpaths`,
5. builds the visual collections,
6. schedules snapshot persistence and config persistence.

The rebuild is intentionally idempotent:

- broader and narrower redundant boundaries are collapsed,
- invalid or disappeared elements are filtered out when possible,
- hidden explicit includes are preserved when needed so accordion-like UI does not erase user intent.

## Practical Behavior Summary

### If the user excludes without Shift

- choose the deepest meaningful target,
- allow drilling inside already excluded ancestors,
- do not drill inside explicit include ancestors until that include is removed,
- replace broader excludes with the newly chosen deeper exclude.

### If the user excludes with Shift

- choose a broader eligible ancestor on purpose,
- prefer the nearest structured grouping ancestor when the wrapper itself has no direct text but its direct children are the separate textual items,
- use this when moving back up to a broader container.

### If the user includes

- prefer explicit targets first,
- prefer mixed-text ancestors over purely nested text descendants,
- allow inclusion inside excluded parents as a deliberate override,
- do not target descendants inside an existing explicit include until the include boundary is removed.

## Design Intent

The system tries to keep one consistent mental model:

- immutable things stay immutable,
- default exclusions are a starting point, not a trap,
- explicit user actions always refine the tree in the direction the user clicked,
- include actions define the content boundary,
- exclude actions carve out smaller excluded boundaries unless the user explicitly asks for a parent with `Shift`.

If behavior changes in code, this document should be updated with the same change.