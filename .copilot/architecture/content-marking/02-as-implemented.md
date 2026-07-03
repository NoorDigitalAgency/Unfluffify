# Content Marking Semantics — AS IMPLEMENTED (the code today)

> **Source.** Traced from the code on `main` at commit `70767e8` (the state when
> this was written), via three focused read-only investigations of
> `src/content/core.ts`, `src/content/marking-rules.ts`,
> `src/content/explicit-marking-handler.ts`, `src/content/silent-highlight-rules.ts`,
> `src/common/constants.ts`, `src/common/emulation.ts`, `src/background/ai-run-orchestrator.ts`,
> `src/background/remote-network.ts`, `src/common/selector-set.ts`, and the type
> defs. Organized to mirror `01-first-principles-should-be.md` and
> `03-locked-contract.md`. Every claim carries a `file:line` anchor. This
> documents what the code DOES; the report (`00-report`) reconciles it against
> the contract (03) and the first-principles ideal (01).

---

## 1. Pipeline as built (two distinct "selector" concepts — clarification)

The code has TWO things both loosely called "selectors," and separating them
resolves most of the confusion:

- **INPUT to the AI = XPath rows.** The user's marks become
  `submissionXpaths: XpathEntry[]` (`{ xpath, excluded, explicit? }`) plus the
  rendered/static HTML. Built by `collectAiSubmissionXpathsForCurrentPage`
  (`content-main.ts:4990`) / `buildAiSubmissionXpaths` (`popup/ai-run.ts:13`).
- **OUTPUT from the AI = CSS selectors.** The AI returns
  `{ exclusionSelectors, inclusionSelectors }` (`ai-run-orchestrator.ts:35`),
  stored in `config.selectors` (`types/config.ts:6`) and later sent to Lynx.
  `normalizeAiSelectorSet` / `combineAiSelectorSet` (`common/selector-set.ts:25,37`)
  operate on THIS (the CSS result), not on the marks.

So: marks → XPaths (+HTML) → AI → CSS selectors. The extension's ground-truth
duty is the XPath+HTML INPUT.

- **AI run payload shape** (`ai-run-orchestrator.ts:22-33`):
  `{ baseUrl, renderMode, defaultExclusionSelectors[], pages: [{ url,
  renderedHtml, rawHtml?, renderedXPaths }] }`, transported via the
  transfer-payload store key (not multi-hop messaging)
  (`transfer-payload-store.ts:40`, `requestAiRunStartSnapshot`
  `remote-network.ts:448` → POST `/get_selectors`).
- **Corpus:** the run uses **all saved pages under the base URL**, not just the
  current tab (matches the contract).

---

## 2. Default classifier (matches the contract exactly)

- **Immutable defaults** (`common/constants.ts:39-84`,
  `DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS`): `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`,
  `TITLE`, `STYLE`, `SCRIPT`, `TEMPLATE`, `IFRAME`, `VIDEO`. Applied via
  `matchesImmutableExcluded` (`core.ts:2222-2250`), cached.
- **Toggleable defaults** (`common/constants.ts:66-75`,
  `DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS`): `FOOTER`, `FORM`, `LABEL`, `NAV`,
  `HEADER`, `DIALOG`, `ASIDE`, `BUTTON`.
- **Content/default layer** (`collectDefaultLayerElements` `core.ts:2924-2965`):
  everything self-markable (visible, direct text, not in the hard-excluded or
  precedence sets) is the implicit-include layer.
- ✔ **Agreement:** the 10 immutable + 8 toggleable taxonomy is exactly the
  contract's. No ad/cookie/social/"related"-by-name heuristics exist in the
  code — noise is handled by consent-hiding + visibility + user excludes, as the
  contract states.

---

## 3. Visibility test (richer than the contract prose; consistent with it)

`isVisible` (`core.ts:11059-11114`) → `isVisibleUncached`:

- **Definitively hidden** (`core.ts:1755-1760`): `hidden` attr; `display:none`;
  `visibility:hidden|collapse`; **`opacity:0`**; `isVisuallyHiddenByStyle`
  (clip / clipPath / 1px box with overflow:hidden).
- **Ambiguously hidden** (`core.ts:1750-1754`): `aria-hidden="true"`, or class
  `sr-only` / `visually-hidden` → **resolved by a hit-test reality check**
  (`isActuallyVisibleToUser` `core.ts:1677-1696`, using `elementsFromPoint`), NOT
  a blanket exclude.
- **Zero-area** (`core.ts:11104`): `rect.width===0 || rect.height===0` → hidden.
- **Overflow-clipped** (`isClippedByOverflow` `core.ts:1277-1327`): outside an
  `overflow:hidden|clip` ancestor's box → hidden.
- **Answers first-principles Q3:** `opacity:0` IS treated as hidden;
  a11y-hidden text is hit-tested, not auto-excluded (nuance my proposal missed).

---

## 4. Mobile-first (VERIFIED — matches the contract; an initial tracer misread was corrected)

The first-pass tracer flagged this as a divergence (it saw
`deviceEmulationToggle: false` and concluded emulation was off). A direct read of
the activation path **disproves that** — mobile emulation IS forced:

- On tab activation and on marking activation, the background calls
  `ensureDefaultMobileEmulationForTab` (`background.ts:1157`, `1297`) →
  `ensureDefaultMobileDeviceEmulation` (`common/emulation.ts:443-461`), which
  calls `updateDeviceEmulation(tabId, { enabled: true, mode: "mobile", … })`
  (mobile preset 412×960, `common/constants.ts:19-32`), applied via CDP
  `Emulation.setDeviceMetricsOverride` (`common/emulation.ts:367-386`).
- The `deviceEmulationToggle` feature flag only gates DISABLING emulation:
  `updateDeviceEmulation` blocks `enabled === false` when the flag is off
  (`common/emulation.ts:399-404`), but does NOT block `enabled: true`. So the
  flag being `false` means the user cannot turn mobile OFF — it makes mobile-first
  MORE enforced, not less.
- The visibility test reads live `window.innerWidth/innerHeight`
  (`getViewportBounds` `core.ts:1329-1340`); under the forced 412px emulation
  those ARE the mobile dimensions, so content detection evaluates at mobile
  width. Consistent with the contract's "mobile simulation geometry at save
  time."
- ✔ **Resolved: contract and code AGREE — mobile-first is enforced.** One finer
  point left for the Q&A (report Q-E, downgraded): confirm the SUBMISSION
  visibility uses the contract's "page-height viewport, mobile-width" treatment
  (below-fold visible, out-of-mobile-width invisible) rather than the live
  `isVisible` viewport-clip — a detail, not a divergence.

---

## 5. Explicit marking mechanics + precedence (matches the contract's model)

### 5.1 Modes (`getMarkMode` `core.ts:7397-7411`)
`exclude` (plain click, default) · `include` (`Alt`+click, `state.altHeld`) ·
`passthrough` (`Space`, `state.altPassThrough`) · `disabled` (extension off /
temporarily blocked). Cursor feedback via `uf-cursor-*` classes
(`core.ts:7442-7458`). Shift enables parent selection.

### 5.2 Storage
- Excludes → `entry.xpaths[]` as `{ xpath, excluded:true, explicit:true }`.
- Includes → `entry.includeXpaths[]` (separate list).
- **Mutually exclusive per element** (`core.ts:8596-8598`): adding one removes
  the other.
- DOM tag `data-uf-mark-id` (`core.ts:7738-7781`); render layers z-index 2–11
  (`core.ts:6643-6650`): hard/default/saved-exclude/saved-include/ai-content/
  session-exclude/session-include/focus/hover/interaction.

### 5.3 Precedence (the "nearest ancestor" walk IS present)
- **Explicit include overrides an excluded ancestor**:
  `isWithinExplicitExcludedXpath` walks the XPath ancestor chain
  (`core.ts:2565-2581`, via `isXPathDescendant`); `isProtectedByExplicitInclude`
  / `isSuppressedByExplicitExclude` (`core.ts:9481-9484`) → an element is
  suppressed by an exclude ONLY if not within an explicit-include ancestor.
- **Row normalization on toggle** (matches contract §Explicit Include/Exclude
  Rules): on exclude-add — `cleanupHierarchy` removes included descendants,
  `cleanupAncestorHierarchy` reverts a toggleable-default parent to
  `excluded:false`, `cleanupIncludeHierarchy` removes overlapping includes
  (`core.ts:8470-8575`); on include-add — remove excluded descendants, collapse
  nested includes (`core.ts:8689-8711`); toggling an exclude off removes
  descendant include-overrides that only punched through it
  (`explicit-marking-handler.ts:167-231`).
- **Closed include boundaries**: descendants under an active include aren't
  targetable until it's removed.
- **Toggleable-default include** (`canApplyExplicitInclude` `core.ts:10989-11047`):
  a toggleable-default element (footer/nav/…) can be explicit-included; a
  toggleable default that is currently visible with text is NOT include-eligible
  by that path (visible ones are already default content).
- ✔ **Agreement:** this is the contract's model; my first-principles
  "nearest-mark-wins + explicit-beats-implicit + both nesting directions" is
  realized here as an ancestor-XPath walk plus edit-time row normalization.

---

## 6. XPath generation (⚠ notable design choice vs first-principles §9.2)

- `getXPath` (`core.ts:2454`): **purely positional**, root-relative,
  `/tag[index]/…` — **no id/class ever used**; walks `parentElement` to
  `documentElement` counting same-tag siblings.
- `getSnapshotXPath` (`core.ts:2520`): same, but **skips save-time-stripped
  elements when counting sibling indexes**, so the XPath aligns to the sanitized
  `renderedHtml` that is actually sent.
- **Reconciliation:** my first-principles doc proposed "prefer id/class for
  stability." The code deliberately does the opposite — **positional XPaths that
  are exact against the captured HTML the AI receives.** For THIS pipeline that
  is arguably MORE correct (the AI correlates `xpath → captured rendered HTML →
  CSS selector`; stability across future DOM changes is irrelevant because the
  HTML is captured in the same breath). Worth confirming this is intended
  (report Q-H), but the code's choice is coherent.

---

## 7. Submission-row semantics (matches the contract)

`buildAiSubmissionXpaths` / submission-rules:
- Explicit includes always submit as included (even hidden / under excluded
  ancestors).
- Every stored excluded row submits as excluded unless explicitly included or
  under an already-submitted excluded ancestor (shallow-boundary suppression).
- `rawHtml` included in the payload **only when `renderMode === "static"`**
  (`ai-run-orchestrator.ts:688`); `renderedHtml` always.
- Visible textual markable content → included rows; invisible textual → excluded
  rows (per the visibility test §3).
- ✔ Matches `03 §5/§7`.

---

## 8. Reveal/freeze + interaction-gated content (matches the contract)

- Reveal warmup (`warmupSilentHighlightingBeforeMotionPause` `core.ts:7065-7150`
  → `revealPageContentBeforeMotionPause`) scrolls to trigger lazy-load, then
  freezes motion.
- **Interaction-gated UI is kept hidden**: `PAGE_MOTION_REVEAL_EXCLUDED_DESCRIPTOR_RE`
  (`core.ts:872`) = `accordion|backdrop|carousel|collapse|dialog|drawer|dropdown|
  lightbox|marquee|menu|modal|offcanvas|overlay|popover|slider|slideshow|tab|
  tabpanel|ticker|toast|tooltip` — these are NOT revealed. Only motion/entrance
  effects are normalized to visible.
- ✔ Matches the contract AND ✗ contradicts my first-principles lean (I proposed
  reveal-and-include). **Code and contract agree; report Q-C is really "should we
  CHANGE this?" not "which is true."**

---

## 9. Silent-whitespace exclusions (implemented per contract)

`isSilentWhitespaceExclusionCandidate` (`core.ts:4001-4028`): a visible,
renderable, block-level element with no normalized text and no visible
non-textual content → generated silent-whitespace explicit-exclude. Matches
`03 §Stored Page Entries`.

---

## 10. Silent highlighting (implemented per contract)

Three layers (`immutable`/`content`/`excluded`); predicates in
`silent-highlight-rules.ts`: `shouldRetainIncludedSource` (`:52`, keep if
explicitly included OR visible), `shouldCollectSilentExcludedSource` (`:? `,
collect excluded even while hidden if it has renderable text and isn't within an
include), `shouldRenderSilentHighlightOverlay` (redraw triggers), settle sampler
(3 stable samples or 2.6s). Matches `03 §Silent Highlighting`.

---

## 11. Summary — implementation vs contract

| Area | Implementation vs contract |
|---|---|
| Immutable + toggleable taxonomy | ✔ exact match |
| Baseline (defaults→selector→explicit) | ✔ match |
| Visibility test | ✔ consistent, richer detail (opacity:0 hidden; a11y hit-tested) |
| Explicit include/exclude + normalization | ✔ match |
| Precedence (ancestor walk + closed includes) | ✔ match |
| Submission rows (shallow boundary, includes-always) | ✔ match |
| rawHtml only when static | ✔ (contract implies; code confirms) |
| Interaction-gated kept hidden | ✔ match (both exclude) |
| Silent-whitespace / silent-highlight layers | ✔ match |
| **Mobile-first forced-on** | ✔ VERIFIED match — `ensureDefaultMobileDeviceEmulation` forces `enabled:true` on activation; the flag only blocks disabling (§4). |
| XPath = positional (no id/class) | (not specified by contract) — deliberate, coherent; confirm intent (Q-H) |

**Bottom line:** the implementation faithfully realizes the locked contract on
taxonomy, explicit marking, precedence, submission, silent highlighting, AND
mobile-first enforcement (the last verified after an initial tracer misread).
No true implementation-vs-contract divergence was found. The open items for the
Q&A are therefore mostly **contract-vs-first-principles design questions** (what
the rules SHOULD be), not code bugs — plus two "confirm intent" details
(positional XPaths §6, submission-visibility geometry §4).
