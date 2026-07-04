# Marking Semantics + Algorithm — Implementation Plan

> Executable plan for the fix phase agreed in the Q&A. Sources of truth:
> `content-marking/04-qa-decisions.md` (semantics: D5a shadow deep-capture,
> D5b svg→immutable, D1 expand-then-mark, C2 submission geometry) and
> `marking-algorithm/04-qa-decisions.md` (MA-1 full in-shadow, MA-1b clamp,
> MA-2 FSM, MA-3 branch-scoped rebuild target + interim, MA-4 collapse verify).
> Branch `feat/marking-semantics-and-algorithm`; pre-fix baseline tag
> `pre-marking-fix-baseline`.

## 1. Goal

Make the extension's marking match "what Google indexes": shadow-DOM content is
handled as real DOM (flattened, Googlebot parity) across capture, enumeration,
XPath, target resolution, and render; CSS-clamped-but-present text is included;
`svg` is immutable-excluded; the interaction FSM is formalized; and the render
reconcile moves toward a branch-scoped incremental rebuild (interim = shipped
behavior, documented).

## 2. Current facts (verified, file:line)

- `src/common/constants.ts:39-84` — `DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS`
  (IMG/INPUT/NOSCRIPT/SELECT/TITLE/STYLE/SCRIPT/TEMPLATE/IFRAME/VIDEO) +
  `DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS` (FOOTER/FORM/LABEL/NAV/HEADER/DIALOG/
  ASIDE/BUTTON).
- `src/content/core.ts`: `isVisible` (11059) / `isVisibleUncached` (1750-1760
  definitive-hidden; opacity:0, `isVisuallyHiddenByStyle`), `isClippedByOverflow`
  (1277-1327), `getMarkMode` (7397) / `getMarkModeFromEvent` (7413) /
  `syncModifierState` (7503) / `resetModifierState` (7531),
  `getXPath` (2454) / `getSnapshotXPath` (2520), `createSanitizedPageSnapshot`
  (4275), `collectDefaultLayerElements` (2924), `collapseElementsByNesting`
  (3796), `renderHighlightsInner` (9937) / `buildMarkingCollectionsCacheKey`
  (1245) / `repositionHighlights` (10152) / `applyExplicitStateToCachedCollections`
  (9465), `getMarkableTarget` (8156) / `resolveMarkableElement` (8056),
  `matchesImmutableExcluded` (2222).
- `src/background/remote-network.ts:548` — `fetchStaticPageHtmlForBackground`
  (static/raw HTML). Consumer parity target = `ContentDeepAsync`
  (getHTML({shadowRoots}) + flattenShadowTemplates), full source in the
  marking-algorithm Q&A transcript.
- Tests: `tests/marking-rules.test.ts`, `core-visibility.test.ts`,
  `submission-rules.test.ts`, `silent-highlight-rules.test.ts`,
  `selector-suppression.test.ts`, `config.test.ts`, `core-motion-pause.test.ts`.
- Contract docs to co-update (change-discipline): `MARKING_AND_HIGHLIGHTING_LOGIC.md`,
  `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`.

## 3. Decisions already made

All in the two `04-qa-decisions.md` files. No open questions. Highlights:
shadow = flatten to real DOM (Googlebot parity, no `<template shadowrootmode>`
in the final flattened view); XPath = continuous positional through former shadow
boundaries; CSS-clamp-with-full-text = included (distinct from display/visibility
hiding); svg immutable; FSM formalized; MA-3 incremental rebuild = target /
shipped = interim.

## 4. Non-goals (must NOT change)

- The locked semantics that were CONFIRMED (heuristic-free noise handling;
  enumerated payload; a11y hit-test model; drill-vs-reach; closed include
  boundaries; positional-XPath-vs-captured-HTML alignment).
- The reveal/freeze contract, property-lock, spinner/reflex-arc P0–P6 behavior.
- Selector/AI-run payload shape beyond adding flattened-shadow coverage.
- No behavior change from CP3 (FSM formalization is behavior-preserving) or the
  MA-3 interim.

## 5. Implementation phases (checkpoints)

### CP1 — svg → immutable (D5b)
- Edit `src/common/constants.ts`: add `"SVG"` to the immutable tag set (verify it
  is not accidentally also in toggleable; keep the derived `IMMUTABLE` filter
  correct).
- Update `MARKING_AND_HIGHLIGHTING_LOGIC.md §Immutable Defaults` + knowledge.md
  bullet (immutable list) + README if it lists tags.
- Tests: extend `tests/marking-rules.test.ts` (svg is immutable, not markable) +
  any constants test.
- Validation: `pnpm lint && pnpm check && pnpm test`.

### CP2 — CSS-clamp visibility (MA-1b)
- Refine `isClippedByOverflow` / the invisible-textual determination in
  `core.ts` so an element whose FULL text is present but clipped by a layout
  clamp (`overflow:hidden`+fixed/`max-height`, `-webkit-line-clamp`) is treated
  as VISIBLE/included; keep genuine off-screen/`display:none`/`visibility:hidden`
  excluded. Decision rule: text present in DOM + clipped by overflow/height/
  line-clamp ⇒ include; element not laid out / zero-area / display-hidden ⇒
  exclude.
- Update contract §Self-Markability / visibility + submission invisible-textual
  rule.
- Tests: `core-visibility.test.ts` + `submission-rules.test.ts` (clamp-with-full-
  text included; `-webkit-line-clamp` case; genuine hide still excluded).

### CP3 — FSM formalization (MA-2, behavior-preserving)
- Consolidate mode derivation behind one `deriveMarkMode(state|event)` authority
  in `core.ts` (wrap existing `getMarkMode`/`getMarkModeFromEvent`); no behavior
  change.
- Add explicit FSM section (states/events/transitions) to
  `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
- Tests: new FSM/mode-derivation test asserting the transition table.

### CP4 — Shadow deep-capture (D5a)
- In `createSanitizedPageSnapshot` (`core.ts:4275`), produce the deep/flattened
  HTML: collect all (open) shadow roots, serialize with
  `getHTML({ shadowRoots })`, and flatten `<template shadowrootmode>` into inline
  real elements (replicate `ContentDeepAsync`), preserving existing extension-node
  stripping + `data-uf-*` removal. Closed shadow roots: document as inaccessible.
- Tests: snapshot test with an open shadow root → flattened inline in
  `renderedHtml`, no `<template shadowrootmode>`.

### CP5 — Flattened XPath scheme (MA-1 pt 1) — SHIPPED
Regrouped: CP5 is the pure, testable XPath scheme; the invasive live-engine
composed traversal (enumeration `.children` walks) moved to CP6 so it lands
together with target resolution + render (they must be coherent).
- `getXPath`/`getSnapshotXPath` walk the composed tree: `getFlattenedParentElement`
  crosses a top-level shadow child up to its host; `countFlattenedPrecedingSameTag`
  shifts a light child of a shadow host past the host's preceding same-tag shadow
  children (shadow inlined first). No-op when no ancestor has a capturable shadow
  root → byte-identical for shadow-free pages + the evaluate test mocks.
- `getElementFromXPath`: native-first, composed-tree fallback
  (`resolveXPathThroughComposedTree`) gated on `documentHasCapturableShadow()`
  (memoized on `state.documentShadowPresence`, reset per pass) + a `getXPath`
  round-trip check, so shadow-free/native resolution is unchanged.
- Tests (`shadow-xpath.test.ts`): continuous shadow path, light-child index
  shift, composed round-trip, extension-shadow exclusion.

### CP6 — Shadow-aware live engine: enumeration + target resolution + marking + render (MA-1 pt 2) — SHIPPED
- Enumeration + reconcile scan (`collectDefaultHighlightTargets`,
  `scanReconcileDocumentCandidates`) descend into capturable shadow roots via
  `getComposedChildrenForWalk` (shadow-first, cached on the frame); the DFS
  classification walks descend via `pushCapturableShadowChildren`. Both collapse
  to the live light `.children` (perf-neutral, one `.shadowRoot` probe) with no
  capturable shadow root → shadow-free pages behavior-identical.
- Paint-reachability: `composedContainsAcrossShadow` in `isElementInHitPath`
  counts a hit on a shadow host as a hit on its shadow content.
- Target resolution / hover: `getComposedHitElements` (gated on
  `documentHasCapturableShadow()`) pierces open shadow via
  `shadowRoot.elementsFromPoint`, used by `getHoverProbeElements` +
  `getMarkableTarget`. Render uses each element's real client rects.
- Net cramo behavior largely automatic: shadow read-more `<button>` auto-excluded
  by taxonomy, shadow `<p>` auto-included; both independently click-markable.
- Tests (`core-visibility.test.ts` CP6): shadow enumeration, host-only-hit
  reachability, getMarkableTarget piercing.
- Residual (flagged, wants cramo live validation): `getCollapsedTextualFallbackRects`
  geometry fallback left light-only; on-page acceptance for broad shadow marking.

### CP7 — Branch-scoped incremental rebuild (MA-3 target) — PREREQUISITE VERIFIED; INTERIM STANDS
- Prerequisite VERIFIED (by construction + source-pin test): a marking toggle
  never changes selector matches. The cache key's selector fingerprint comes from
  the config-owned selector set (`getNewestConfigSelectorSet`); a toggle mutates
  only the entry (`xpaths`/`includeXpaths`) → separate entry fingerprint. Pinned
  in `core-scheduling.test.ts` ("CP7: selector matches are invariant…").
- Per the MA-3 decision + this plan, the incremental-rebuild refactor is the
  TARGET and is explicitly deferrable: the shipped immediate-ack + debounced
  (~180ms) full reconcile interim is correct and STANDS (P5 already cut refresh
  churn ~60/min→~0). The refactor is recorded as the sanctioned follow-up rather
  than risking the core render path in an autonomous pass without live validation.
- Contract §Marking Performance Contract updated with the target model, the
  verified prerequisite, and the accurate interim.

### CP8 — D1 expand-then-mark harden + MA-4 collapse verify
- Verify Space-passthrough expand → revealed element markable → explicit-include
  persists + present in saved `renderedHtml`; motion pause doesn't re-collapse.
- Verify `collapseElementsByNesting` cost O(rows×depth); harden if O(n²).

## 6. Test matrix
Per checkpoint: focused unit/source-contract tests named above, then the full
gate `pnpm lint && pnpm check && pnpm test && pnpm build`. Live: after CP4–CP6
and CP7, drive the heavy `bonliva.se/lediga-jobb` page (and the cramo shadow
page) via the scratchpad playwright driver; compare vs the `pre-marking-fix-
baseline` build.

## 7. Regression risks
- `core.ts` is the 11k-line marking engine; visibility/XPath/collection changes
  can silently shift what's included. Guard: the existing marking-rules /
  visibility / submission tests must stay green, plus new focused tests per CP.
- Shadow flattening must not double-count nodes or break light-DOM XPaths (CP5
  alignment test).
- CP7 incremental rebuild must equal full rebuild (equivalence test) — highest
  drift risk; interim fallback available.

## 8. Acceptance criteria
- svg never markable; CSS-clamped full text included; shadow `<p>` (cramo)
  enumerated + XPath-addressable + captured in `renderedHtml`; a shadow inner
  node independently markable; FSM test green; full gate green each CP.
- Live: heavy bonliva flow correct (marking/run/preview/exit/save) and render
  pass-rate/latency no worse (ideally better with CP7) than the pre-fix baseline.

## 9. Execution
run-plan CP1→CP8 in order; review-push (gate + contract-discipline commit +
push) at each checkpoint. CP7 may defer to interim if too risky. Then live
perf/correctness vs baseline; report; stop.
