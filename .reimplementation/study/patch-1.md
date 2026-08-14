# Patch 1 — Algorithm / Protocol Contract Parity Matrix

**Gap filled:** the `[ALG]`/`[PROTO]` contract families that define the product's actual output — which
rows reach the AI. Sections 1.1–1.9 and 1.13–1.14 of `legacy-locked-contracts.md`: **C-MARK-1..17,
C-FSM-1..3, C-TGT-1..8, C-SHDW-1..3, C-SIL-1..2, C-SUB-1..7, C-PERF-1..6, C-EMU-1..2, C-SAVE-1..7.**

**Trees.**
LEGACY = `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`
(worktree of `main`, v1.10.0 lineage).
REWRITE = `/home/rojan/Documents/Git/GitHub/Unfluffify` (branch `re-write`).
All `file:line` citations are relative to the respective tree root.

**Reading the verdicts.**

| Verdict | Meaning |
|---|---|
| **PASS** | Rewrite implements the contract's observable behaviour; the deliberate schema redesign is not counted against it. |
| **PARTIAL** | Core intent present, a named clause of the contract is missing or weaker. |
| **FAIL** | The contract is violated, inverted, or entirely absent with no substitute. |
| **N/A-SCHEMA** | The clause is purely about the legacy v5 storage shape; excluded per the ground rules. |

Newly-read rewrite files (no prior report opened them): `src/content/marking/{resolve.ts, flatten.ts,
silent-highlight.ts, hit-testing.ts, paint-reachability.ts, submit.ts, dom-view.ts, engine.ts,
store.ts, renderer.ts}`, `src/domain/{widening.ts, boundary.ts, visibility.ts, xpath.ts, evaluate.ts,
selector-seed.ts, taxonomy.ts, constants.ts, schema/marking.ts, schema/submission.ts}`,
`src/offscreen/xpath-refinement.ts`, `src/content/consent.ts`.
Newly-cited legacy files: `src/common/xpath-utilities.ts`, `src/content/{explicit-marking-handler.ts,
submission-rules.ts, shared-inclusion.ts, marking-machine.ts, shared-selector-cache.ts,
marking-rules.ts}`, plus the target-resolution/submission/XPath regions of `src/content/core.ts` and
`src/content-main.ts` and `src/background/ai-run-orchestrator.ts`.

---

## 0. Verdict on the critic's two spot checks

### (a) `chooseWidenTarget` implements only step 4 of C-TGT-4 — **CONFIRMED**

C-TGT-4 locks a four-step ladder (MHL:583-589, KN:541). Legacy implements it literally, as an ordered
cascade, in `src/content/marking-rules.ts:87-121`:

```
 98   if (options.selfStructuredGroup || options.selfToggleableBoundary) return selfValue;   // step 1
102   const structuredGroupAncestor = ancestors.find(c => c.isStructuredGroup && c.value);    // step 2
108   const toggleableAncestor    = ancestors.find(c => c.isToggleableBoundary && c.value);   // step 3
114   let broadestMarkableAncestor = null; ancestors.forEach(... last markable wins ...);      // step 4
```

The three candidate flavours are computed separately per ancestor in `src/content/core.ts:8963-9011`
(`selfStructuredGroup` 8964, `selfToggleableBoundary` 8968, and per-ancestor
`structuredGroupBoundary`/`toggleableBoundary`/`markableBoundary` 8985-9002), and the whole chain up to
`body` is collected first (loop 8979-9005) **before** the cascade runs.

Rewrite `src/domain/widening.ts:67-78`:

```
67 export function chooseWidenTarget(node, ctx = {}) {
68   let selected = node;
69   let cursor = ctx.getParent?.(node) ?? node.parent;
70   while (cursor) {
71     if (!isEligibleWidenTarget(cursor, ctx)) break;
74     selected = cursor;
75     cursor = ...parent...
77   return selected;
```

Three concrete divergences, each independently observable:

1. **Step 1 is absent.** The clicked element is never tested for "is itself a structured group or a
   toggleable boundary". It is only ever returned as the *fallback* when no ancestor qualifies
   (line 68). Legacy stops immediately at the click when it is already a boundary — Shift on a
   `<footer>` selects that footer. The rewrite walks past it to the broadest eligible ancestor.
2. **Steps 2 and 3 are collapsed into step 4.** `isEligibleWidenTarget` (widening.ts:54-65) merges
   "structured group", "toggleable boundary" and "markable ancestor" into a single boolean, so the
   *nearest* structured group can never beat a *broader* plain ancestor. Legacy's `find()` at
   marking-rules.ts:102 gives the nearest structured group absolute priority over the broadest markable
   one at line 114.
3. **The walk breaks on the first ineligible ancestor** (widening.ts:71). Legacy collects the whole
   chain and lets a *later* ancestor win across a gap (core.ts:8979-9005 + marking-rules.ts:115-119).
   A single non-qualifying wrapper `<div>` between a card and its `<section>` therefore stops the
   rewrite at the card while legacy widens to the section.

The rewrite's own test suite documents the reduced intent — `tests/src/domain/widening.test.ts:44-56`
is named *"climbs to the broadest qualifying group"*, and there is no test for a clicked boundary
stopping the ladder or for structured-group-beats-broader-ancestor.

Also note the engine flattens the domain's `structuralRole` vocabulary to two values before widening
runs — `src/content/marking/engine.ts:60`
(`structuralRole: node.structuralBoundary ? "card-group" : "generic"`) — so the `section`/`article`/
`list`/`table` distinctions that `boundary.ts:58-64` defines never reach the widening chooser at
runtime.

### (b) `dom-view.ts:200-206` `/__closed-shadow[n]` violates C-SUB-4 — **REFUTED for the payload, CONFIRMED as a latent hazard**

Why it cannot reach the wire today:

- The synthetic segment is only minted for elements carrying `data-uf-closed-shadow-host`
  (`src/content/marking/dom-view.ts:169-171, 201-206`). The only writer is
  `installClosedShadowHostInstrumentation` (dom-view.ts:258-278) — **and nothing calls it**. A repo-wide
  grep finds the symbol only at its definition and in `submit.ts:30`. `src/entrypoints/page-world.content.ts`
  (30 lines) does not patch `attachShadow`, and the content-script world's `Element.prototype` is not
  the page's, so the patch would be inert even if wired. In production the attribute is never set.
- Even if it were set: `evaluate` classifies such a node `"closed-shadow"`
  (`src/domain/evaluate.ts:47-49`) and returns before pushing any row (evaluate.ts:101-104), and
  `buildNode` does not descend into it (dom-view.ts:193), so no descendant xpath can inherit the
  segment.
- Even if a row escaped: `MarkRowSchema`'s `POSITIONAL_XPATH_PATTERN` in
  `src/domain/schema/marking.ts` requires `^\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\]...`; `__closed-shadow`
  starts with `_` and is hard-rejected by `AiRunPayloadSnapshotSchema.parse` in `submit.ts:15`.

What the finding *does* correctly expose:

- The rewrite carries **two mutually incompatible composed-XPath schemes**. `src/domain/xpath.ts:15-44`
  (`getFlattenedChildren`/`getXPath`) *omits* closed-shadow hosts from the sibling list and returns
  `null` for them; `src/content/marking/dom-view.ts:196-216` *keeps* them as a synthetic segment. Only
  dom-view runs at runtime; `domain/xpath.ts:getXPath` is dead outside `flatten.ts` and tests. Two
  answers to one question is exactly the "second source of truth" the reflex-arc doctrine forbids.
- The synthetic key is used as a `Map` key in `bridge.byXpath` and `evaluation.overlay`
  (dom-view.ts:236, evaluate.ts:98) and is then fed to `isXPathInSubtree`,
  `compareXpathsInDocumentOrder` and `depthFromBody(xpath.split("/").length - 3)` (xpath.ts:57-74,
  dom-view.ts:32-34) — all of which silently treat it as a real positional segment.
- The genuine, live C-SHDW-1 bug is adjacent and worse: see **C-SHDW-1** below.

---

## 1. C-MARK — the marking model (§1.1)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-MARK-1 | Seed then step aside; stored rows are the sole truth | **PARTIAL** | `core.ts:3385` seed, MHL:23-43 | `src/domain/selector-seed.ts:28-41`; `src/content/marking/engine.ts:270-283`; `content-loader.content.ts:735-737` | Selectors seed once and never re-match (engine.ts:270 is the only caller, gated by `selectorsSeeded`). BUT the *default-tag* rule is re-applied on every rebuild: `engine.ts:166-169` calls `mergeDefaultExclusions` inside `refreshBridge`, which runs on every scroll/mutation frame (engine.ts:184-200). It is guarded by an xpath-presence check (engine.ts:150-153) so it cannot overwrite an existing row, but any row *deleted* by a toggle is silently re-seeded on the next frame. |
| C-MARK-2 | Rendering precedence defaults → selectors → session explicit | **PASS** | MHL:83-96 | `src/domain/evaluate.ts:46-66` | `classifyNode` precedence: closed-shadow → immutable → chrome → excluded mark → explicit/implicit mark → implicit content. |
| C-MARK-3 | Session-scoped, fresh on every enable; saved rows never pre-populate; disabled on navigation | **PASS** | MHL:97-115 | `content-loader.content.ts:689-707` (`resetMarking`), `605-618` (`deactivateMarking`), `655-667` (`handleUrlChanged` → deactivate) | Backend rows never enter a session: config load hands the popup selectors only, and the popup *pulls* rows from content (`main.tsx:916 adoptContentRows`), never pushes. One wrinkle: `activateContentMain` uses `markingEngine ??= createMarkingEngine(...)` (content-loader.content.ts:729), reusing a silent-mode engine rather than starting clean. |
| C-MARK-4 | Immutable list exact, case-insensitive both sides, travels as payload tag list | **PASS** | MHL:184-199 | `src/domain/constants.ts:63-75`; `src/domain/taxonomy.ts:7-15`; `src/content/marking/submit.ts:18` | List byte-identical incl. `SVG`. `normalizeTagName` uppercases both sides so foreign-namespace `svg` matches. Immutable nodes emit no rows (evaluate.ts:101-104); the tag list rides the payload. |
| C-MARK-5 | Toggleable list exact (`BUTTON` in, `LINK` out) | **PASS** | MHL:201-218 | `src/domain/constants.ts:52-61` | Byte-identical. |
| C-MARK-6 | Toggleable auto-exclusion is UNCONDITIONAL (F1) | **FAIL** | `src/content/marking-rules.ts:41-59` — only hidden/AI/consent/extension/immutable/explicit-include skips | `src/content/marking/engine.ts:98-114` | The rewrite adds `!node.pageShell` (engine.ts:102). `pageShell` is true whenever `landmarkCount >= 2` (dom-view.ts:226), and `landmarkCount` counts **the element itself plus every descendant occurrence** (dom-view.ts:36-49). A `<footer>` containing a `<nav>` scores 2 → `pageShell` → **no default exclusion row is ever generated for that footer**, and `isStructuralBoundary` returns false for it (boundary.ts:52-53) so it is not even self-markable. Footer-with-nav is one of the commonest layouts on the web. |
| C-MARK-7 | Toggleable defaults have NO dedicated visual layer; renderer must not require `explicit:true` | **PASS** | MHL:44-54, 228-240 | `src/domain/evaluate.ts:108-112`; `src/content/marking/renderer.ts:20-23, 92-107` | Generated rows carry no `explicit` flag and are classified `"exception"` like any user exclude; one shared overlay style. |
| C-MARK-8 | `excluded:false` unmarks exactly one boundary — never descendants; leaf-boundary force-include | **FAIL** | `src/content/explicit-marking-handler.ts:233-235` → `cleanupDescendantIncludeOverrides` (170-194) removes only descendant **includes** | `src/content/marking/store.ts:18-22` | `applyToggle`'s unmark branch does `rows.filter(row => row.xpath !== xpath && !isXPathInSubtree(row.xpath, xpath))` — it **deletes every descendant row, excludes included**. Unmark a footer and any hand-made exclusion inside it is destroyed. Generated defaults come back via `mergeDefaultExclusions`; explicit user excludes do not. Leaf-boundary force-include (`forceIncludeSet`, MHL:294-313, the P3 root cause) has no analogue. |
| C-MARK-9 | First-click unmark of a default boundary | **PASS** | MHL:294-300, KN:550 | `src/content/marking/store.ts:18-22` | Generated rows are `{excluded:true}` with no `explicit` (engine.ts:108); the first exclude-click hits the `existing?.excluded` branch and writes `{excluded:false}`. No redundant second click. |
| C-MARK-10 | Two distinct default-layer suppression sets; nested rows collapse | **FAIL** | `core.ts:4222-4296` `collapseElementsByNesting` (+ `collapseElementsByNestingPreservingExplicit` 4297) | `src/domain/evaluate.ts:56-58, 97-99` | `classifyNode` returns `"exception"` for **every** node under an excluded mark, and `walk` writes each into the overlay map. `renderer.render` (renderer.ts:92-107) then draws one 0.2-alpha red box per node. A `<footer>` with 200 descendants renders as ~200 stacked boxes — visually near-opaque, and O(n) overlay elements where legacy draws one. No nesting collapse anywhere in the rewrite. |
| C-MARK-11 | Stored page-entry shape | **N/A-SCHEMA** | MHL:242-269 | `src/storage/config.ts:11-18` | Deliberate redesign. |
| C-MARK-12 | Silent-whitespace generated exclusions | **FAIL (absent)** | `core.ts:4402` `collectSilentWhitespaceExcludedXPaths`, `4515` candidates; MHL:270-280 | — | No implementation. `silentWhitespaceExcludedXpaths` survives only as a dead field in `src/types/config.ts:25`. Visible blocks with no meaningful text are neither excluded nor hidden from target resolution. |
| C-MARK-13 | AI auto-seed rows MUST carry `explicit:true` | **PASS** | MHL:282-292, KN:545 (S1/S2) | `src/domain/selector-seed.ts:32, 37` | Both exclude and include seeds write `explicit: true`. The legacy day-one defect is not reproduced. |
| C-MARK-14 | Auto-seed suppressed when the user owns the baseline | **PARTIAL** | KN:550 (`hasUserMarkingEdit` ∥ `selectorSuppressedXpaths` ∥ one-shot) | `content-loader.content.ts:735` (`!selectorsSeeded && !isUserMarkingDirty()`) | Two of three guards. There is no `selectorSuppressedXpaths` equivalent (no record that the operator un-excluded a selector match), and `selectorsSeeded` is a module-level boolean cleared by `resetMarking`/`deactivateMarking` (content-loader.content.ts:608, 697) rather than a per-page one-shot. |
| C-MARK-15 | Explicit-exclude normalization (5 rules) | **PARTIAL** | `explicit-marking-handler.ts:195-235` | `src/content/marking/store.ts:23-32, 74-89` | Rules met: descendant rows removed (store.ts:24-25), overlapping includes removed (same filter), broader explicit-exclude ancestors removed (store.ts:26), **generated toggleable-default ancestors converted to `excluded:false`** (store.ts:78-88 + applyToggle 28-30) — a faithful port of `explicit-marking-handler.ts:211-213`. Missing: the hidden-include cleanup inside a removed excluded ancestor (`cleanupDescendantIncludeOverrides` at handler:210). |
| C-MARK-16 | Explicit-include normalization; include boundaries are CLOSED | **PARTIAL** | `explicit-marking-handler.ts:262-300`; MHL:626-631 | `src/content/marking/store.ts:23-32`; `src/content/marking/resolve.ts:28-48` | Descendants under an include are correctly untargetable in exclude mode (resolve.ts:45-48). But the boundary itself is only returnable when it is `hitPath[0]` — clicking anywhere *inside* an explicit include in exclude mode returns `null`, so the include can only be un-toggled by hitting its own padding. Legacy's explicit-target-first pass (`core.ts:9063-9113`) returns the include from anywhere in the hit path. |
| C-MARK-17 | Include and exclude mutually exclusive; applying one clears the other | **PARTIAL** | CM-04:182-187 | `src/content/marking/store.ts:13-17` | Exclude-clicking an explicit include *clears* it and returns — it does not then apply the exclusion. Two clicks where the contract implies one. |

---

## 2. C-FSM — marking interaction FSM (§1.2)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-FSM-1 | Single derivation authority; `disabled > passthrough > include > exclude`; Shift is not a mode; latches reset on blur/visibility/navigation | **PARTIAL** | `core.ts:8172` `shouldAllowParentMarking`, 9656; MHL:505-542 | `content-loader.content.ts:231-236` (`markModeForClick`), `221-229`, `574-589` | Precedence and the Shift-is-orthogonal rule are right (`resolveAtPoint(..., mode, event.shiftKey)`, content-loader.content.ts:557; gated to exclude mode at engine.ts:297). Alt is read from the committing event (`event.altKey`, line 235) — race-proof, as contracted. Blur and visibilitychange reset the Space latch (lines 574-589). Missing: navigation does not reset the latch (only `deactivateMarking` does), and there is no `disabled` derivation inside the mode function — it is enforced by an outer `markingActive` guard (line 548). |
| C-FSM-2 | Space passthrough restores overlay and **redraws over the page's new posture** | **PASS** | MHL:633-644 | `content-loader.content.ts:225-227, 574-579` → `refreshActiveMarking()` | Redraw on release/blur is wired. Silent overlays are `pointer-events:none` (renderer.ts:140). |
| C-FSM-3 | Temporary disabled: overlay mounted, markings dimmed, hover cleared, brain-dictated reason | **PARTIAL** | MHL:646-667, KN:599 | `content-loader.content.ts:534-538, 620-624`; `command-router.ts:118-120` | The directive is reflected, never re-derived (correct doctrine). But `pauseMarkingInteractions` removes the listeners rather than dimming a still-mounted overlay, and there is no `aria-live` paused notice or progress cursor. |

---

## 3. C-TGT — target resolution, widening, self-markability (§1.3)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-TGT-1 | Hit-testing skips extension/consent UI, roots, immutable subtrees; surfaces pointer-events-suppressed descendants deepest-first | **PARTIAL** | `core.ts:9062-9127` (skip list at 9072-9083, 9119-9127) | `src/content/marking/hit-testing.ts:45-67`, `16-35` | The pointer-events-suppressed descendant surfacing is faithfully ported (`collectPointerSuppressedDescendants` 16-35, `unshift` for deepest-first at 31) and open shadow is pierced (37-43). But `getComposedHitElements` applies **no** skip list — extension UI, `<html>`, `<body>` and consent chrome all enter the path. They are filtered downstream (engine.ts:290 by bridge membership, resolve.ts by `selfMarkable`), so the verdict is behaviourally close; the cost is that hidden consent chrome — which the rewrite hides with `pointer-events:none` (consent.ts:115) — is *specifically* re-surfaced by the suppressed-descendant walk. |
| C-TGT-2 | Renderable geometry + paint-reachability; collapsed textual wrappers fall back to descendant geometry; ghost includes | **PARTIAL** | `core.ts:9976` `hasRenderableMarkingTargetGeometry`; `shared-inclusion.ts:71-80` `canUseCollapsedTextFallback` | `src/content/marking/paint-reachability.ts:24-61`; `src/domain/visibility.ts:47-90` | Paint-reachability incl. the pointer-events-suppressed-chain exemption is ported well (`isPaintReachableAt` 37-61 + `hasPointerEventsSuppressedPath` hit-testing.ts:69-79). Missing: the collapsed-textual-wrapper descendant-geometry fallback has no port; ghost includes survive only in the silent path (silent-highlight.ts:12-14), not in marking. |
| C-TGT-3 | Exclude drills, include reaches; default boundaries don't steal descendant clicks | **PASS** | MHL:573-581, KN:565; `core.ts:9115-9158` | `src/content/marking/resolve.ts:45-65`; `src/content/marking/store.ts:74-92` | Verified end-to-end: clicking a descendant inside a default-excluded `<footer>` returns the descendant (resolve.ts:49-56, since all descendants classify `"exception"` so the drill finds nothing deeper), and `store.toggle` then writes the footer `{excluded:false}` + descendant `{excluded:true, explicit:true}` (store.ts:78-89 → applyToggle 28-31). Include mode inspects inside excluded parents and prefers explicit targets first (resolve.ts:28-43). Edge case: once a descendant carries its own `{excluded:false}`, clicking the boundary's own padding re-targets that descendant instead of the boundary (resolve.ts:51). |
| **C-TGT-4** | **Shift widening ladder, 052c order (4 steps)** | **FAIL** | `src/content/marking-rules.ts:87-121`; `core.ts:8963-9014` | `src/domain/widening.ts:67-78` | See §0(a). Step 1 absent; steps 2/3 collapsed into 4; walk breaks on the first ineligible ancestor. |
| C-TGT-5.1 | Ladder candidates self-markable; hard stop at `body`/`documentElement` | **PASS** | `core.ts:8981-8983`; MHL:592-598 | `src/domain/boundary.ts:30-34`; `widening.ts:55-57, 71` | `isPageShell` returns true for `HTML`/`BODY` → ineligible → break. Root exclusions impossible by construction; `evaluate` also refuses root rows (`evaluate.ts:107`, `xpath.ts:46-48`). |
| **C-TGT-5.2** | **Descendants-only page-shell rejection is LANDMARK-BASED ONLY; broad-footprint disjunct DROPPED (2026-07-05)** | **FAIL** | `core.ts:8868-8888` (`isUnsafeWideDescendantOnlyTarget`, comment explicitly records the drop) + `8824-8846` (`containsPageShellLandmark`: **≥2 distinct landmark KINDS among DESCENDANTS**) | `src/domain/boundary.ts:38-43`; `src/content/marking/dom-view.ts:36-49, 69-70, 226-228` | Two independent regressions. (i) The dropped heuristic is **back**: `isPageShell` returns true on `broadViewportFootprint` (boundary.ts:41-43), computed as `rect.width >= innerWidth * 0.9` (dom-view.ts:70, 228). This is precisely `hasBroadParentMarkingFootprint`, deleted by architect decision (KN:542, KN:546 N1, MWR). (ii) `landmarkCount` counts **occurrences including the element itself** (dom-view.ts:39-48) whereas legacy counts **distinct kinds among descendants only** (core.ts:8825-8845, `landmarkKinds` is a `Set` and the stack starts at `el.children`). Consequence: `<footer><nav>…</nav></footer>` scores 2 in the rewrite and 1 in legacy. Combined with C-MARK-6 this removes real footers from marking entirely. Also missing: the content-boundary-tag / direct-text exemptions (`isParentMarkingContentBoundary`, `hasDirectText` at core.ts:8881-8886) — `isPageShell` has no such escape hatch. |
| C-TGT-5.3 | W4/F3: descendants-only widen targets need ≥2 markable descendants | **PASS** | `marking-rules.ts:73-85`; `core.ts:8778-8786` | `src/domain/widening.ts:37-42, 61-63` | `holdsMultipleTextualMarkableContent` ≥2. Single-child wrappers rejected — test at `tests/src/domain/widening.test.ts:68`. |
| C-TGT-5.4 | W5/F4: cohesion filters textless children, then ≥2 **and** `every()` conforming | **PARTIAL** | `core.ts:2415-2436` (filter 2415-2432, `children.length < 2` 2433, `children.every(isGroupedBoundaryChildCandidate)` 2436) | `src/domain/widening.ts:44-52` | The `every()` half is gone. `isGroupingWidenTarget` filters children by `isEligibleWidenTarget` — a *different, stricter* predicate (each child must itself be a widen target) — then only checks `>= 2`. Legacy's predicate is `isGroupedBoundaryChildCandidate` (core.ts:2373-2390): textual container **and** (self-markable or toggleable-with-direct-text). Different groups qualify in the two implementations. |
| C-TGT-5.5 | W2/F5: `getDepthBelowBody` walks the flattened (shadow-crossing) chain, guard ≤500 | **PASS (by construction)** | `core.ts:8795-8811` | `src/content/marking/dom-view.ts:32-34`; `engine.ts:57` | Depth is derived from the composed xpath (`xpath.split("/").length - 3`), which already inlines shadow children — so shell protection applies inside open shadow with no guard needed. |
| C-TGT-5.6 | depth ≤2 shallow guard feeding the structured-group definition | **PARTIAL** | `core.ts:8848-8866` (guard fires only for `allowParent` targets, exempts content boundaries and direct-text) | `src/domain/boundary.ts:44` | `node.structuralRole === "generic" && node.depthFromBody <= 2` is unconditional — it applies to *every* caller of `isPageShell`, not only widening, and has no content-boundary/direct-text exemption. |
| C-TGT-6 | Self-markability; toggleable boundary self-markable only without visible textual descendants | **PARTIAL** | `core.ts:2278` `isSelfMarkableWithoutParentMode`; `marking-rules.ts:31-39` `shouldSelfMarkToggleableDefaultBoundary` | `src/domain/boundary.ts:67-76`; `engine.ts:28` | `isSelfMarkable` = visible ∧ ¬chrome ∧ ¬immutable ∧ (ownsDirectText ∨ structuralBoundary). The toggleable-boundary refinement (direct text → yes; else only when no visible textual descendant **and** no explicitly marked descendant) is absent, as is "container with only descendant text yields to the descendant" — the rewrite relies on `elementsFromPoint` ordering to reach the descendant first. |
| C-TGT-7 | Visibility & CSS clamps (MA-1b): clamp is NOT hiding, downward-only | **PARTIAL** | `core.ts:12444-12493` `isVisibleForSubmission`; MHL:695-712 | `src/domain/visibility.ts:32-45, 76-87` | The clamp rule is implemented and correct in shape (downward clamp or `-webkit-line-clamp` + non-empty preview + height > 1). Two gaps: (i) `webkitLineClamp` is **never populated** by the path that decides `visible` — `dom-view.ts:86-99` omits it (only `engine.ts:138`, used for silent highlights, sets it), so the line-clamp branch is dead in the evaluation; (ii) `interactionGated` is reduced to a single `aria-expanded="false"` ancestor probe (dom-view.ts:94) where legacy models collapsed accordions/inactive tabs through the full theoretical-visibility state machine. |
| C-TGT-8 | a11y-hidden text is AMBIGUOUS — resolved by hit-test reality check (D4) | **FAIL** | `core.ts:12451-12481` — `ambiguousHidden` flag, resolved by `isActuallyVisibleToUser(el)` (core.ts:1923) with an explanatory comment at 12472-12479 | `src/domain/visibility.ts:50-52` | `if (style?.hidden \|\| style?.ariaHidden \|\| style?.srOnly \|\| style?.interactionGated) return false;` — a blanket exclude, exactly what D4 forbids. `srOnly` is additionally *inherited from any ancestor* (`hasClassInAncestors`, dom-view.ts:93, 123-132), so one `.visually-hidden` wrapper hides an entire real subtree from marking and flips it to excluded at submission. |

**Additional finding not covered by a contract number:** legacy's submission visibility uses
`anyClientRectIntersectsSubmissionArea` as a deliberate bridge (core.ts:12485-12492) so that "wrapper /
ancestor rows whose primary bounding rect anchors out of bounds (column layouts, sticky containers,
broad clipping ancestors)" are not auto-promoted to `excluded:true` while their visible descendants are
submitted as included. The rewrite reads only `getBoundingClientRect` (`dom-view.ts:75`,
`visibility.ts:47-74`) — it reproduces the failure shape legacy explicitly bridged. See C-SUB-2(h).

---

## 4. C-SHDW — Shadow DOM (§1.4)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-SHDW-1 | Googlebot parity: open roots inlined as real elements at the FRONT of the host, recursive, no `<template>` wrapper; closed roots silently skipped; extension shadow never captured | **PARTIAL / latent FAIL** | `core.ts:4732-4752` `getCapturableShadowRoot`, `4754-4790` `buildFlattenedShadowFragment` | `src/content/marking/dom-view.ts:25-30, 160-163, 294-303`; `src/content/marking/flatten.ts:12-41` | Open-shadow inlining at the front of the host is correct in both the tree (`elementChildren` puts `shadowRoot.children` first, dom-view.ts:162) and the capture (`flattenedChildNodes`, dom-view.ts:26-29), recursive, no template wrapper. Extension shadow is skipped (`isExtensionUi`, dom-view.ts:152-158). **The latent failure:** `captureFlattenedHtml` returns `""` for a closed-shadow host (dom-view.ts:295), deleting the host element **and all of its light-DOM children** from the snapshot — and `stripUncapturableHtml` (`submit.ts:28-40`) does the same to any HTML that reached it another way. Legacy skips only the closed *root*; the host and its slotted light content stay, because Googlebot renders them. This is dormant only because the instrumentation is unwired (§0(b)); wiring it as designed would silently delete real content from every payload. |
| C-SHDW-2 | Continuous positional XPath through shadow; byte-identical to light-DOM when no capturable root; native-first resolver with composed fallback | **PARTIAL** | `core.ts:2757-2781` `countFlattenedPrecedingSameTag`, `2732-2748` `getFlattenedParentElement`, `2783-2798` `getXPath`, `2841-2863` `getSnapshotXPath`, `12551-12581` `resolveXPathThroughComposedTree`, `12583-12616` `getElementFromXPath` gated on `documentHasCapturableShadow()` (12501-12521) | `src/content/marking/dom-view.ts:196-216`; `src/domain/xpath.ts:15-44` | Index shifting past a host's preceding same-tag shadow children falls out of building indices in one composed pass, and shadow-free pages are byte-identical. Gaps: (i) two incompatible schemes (§0(b)); (ii) there is **no xpath→element resolver at all** — resolution is a `byXpath` map rebuilt from scratch every frame (dom-view.ts:236, engine.ts:170), so an xpath arriving from outside the current bridge (a stored row, a backend selector result, a refined raw xpath) cannot be resolved; (iii) `getSnapshotXPath`'s strip-selector-aware sibling skipping has a partial analogue (extension children are skipped without consuming an index, dom-view.ts:197-199) but no configurable strip list. |
| C-SHDW-3 | Live engine descends shadow; hit-testing composed-aware; overlays over composed geometry; all descent gated on presence of a capturable root | **PARTIAL** | MHL:806-818, KN:562; `core.ts:12501-12521` gate | `dom-view.ts:160-163`; `hit-testing.ts:9-14, 37-43`; `paint-reachability.ts:7-22` | Enumeration, hit-testing (`shadowRoot.elementsFromPoint`, hit-testing.ts:37-43), and composed containment (`composedContains`, paint-reachability.ts:7-22 and engine.ts:36-51) all descend shadow correctly. **The gate is missing**: there is no `documentHasCapturableShadow()` equivalent, so shadow-free pages pay the composed-path cost on every frame — the explicit "shadow-free pages are behavior-identical and perf-neutral" clause is not honoured. |

---

## 5. C-SIL — silent highlighting rendering (§1.9)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-SIL-1 | Three layers — `immutable` (dashed border, transparent bg), `content`, `excluded`; hidden implicit includes dropped, hidden explicit includes ghost-retained; redraws wait for positions to settle | **FAIL** | MHL:877-896; `src/content/silent-highlight-rules.ts` | `src/content/marking/silent-highlight.ts:5-19`; `renderer.ts:128-147` | `buildSilentHighlights` returns **one flat list of non-excluded row xpaths** and the renderer paints them all with one blue style (renderer.ts:142-143). No immutable layer, no dashed-border treatment, no excluded-content layer — an operator in silent mode cannot see what the stored selectors *exclude*, which is the primary review question. The one clause that is honoured: `row.explicit === true` bypasses the geometry filter (silent-highlight.ts:12-14) = hidden explicit includes remain ghost sources; implicit rows are geometry-gated (15-16) = hidden implicit includes dropped. No settle-wait — redraw is a bare rAF (engine.ts:184-200). |
| C-SIL-2 | Silent overlays never capture page clicks | **PASS** | MHL:643-644 | `renderer.ts:58, 69, 140` | `pointer-events:none` on the root, every layer, and every overlay. |

---

## 6. C-SUB — AI submission rows (§1.5)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-SUB-1 | Shallow boundary rows aligned to the sanitized view; extension UI / automation roots / strip selectors do not count as siblings | **PARTIAL** | `core.ts:952-961` `EXTENSION_SNAPSHOT_STRIP_SELECTORS`, `2826-2839` `isStrippedFromSnapshot`, `2841-2863` `getSnapshotXPath` | `dom-view.ts:152-158, 197-199, 294-303` | Indices and capture agree on skipping recognised extension UI. **Two unrecognised extension nodes leak into the sanitized HTML:** (i) the content directive root, `content-loader.content.ts:303-309`, carries `data-uf-content-directive-root` but **not** `data-uf-extension-ui`, is appended to `document.documentElement`, and is therefore serialized by `captureFlattenedHtml` — curtain and banner markup and all (content-loader.content.ts:324-349); (ii) the consent bypass `<style id="uf-consent-bypass">` injected into `<head>` (`consent.ts:96-105`) shifts `style[n]` indices in head and ships in the payload. Both are stripped by legacy's `[id^="unfluffify-"]` / `[data-uf-extension-ui="true"]` rules. Also: the rewrite has no "shallow boundary" list distinct from the marking rows — `submissionXpaths` and the render rows are the same array (`submit.ts:23`). |
| C-SUB-2(a) | Explicit includes always submit as included, even hidden / under excluded ancestors | **PASS** | `submission-rules.ts:35-37` | `src/domain/evaluate.ts:113-115` | The explicit-include push is unconditional on visibility and on `submittedExcludedAncestor`. |
| C-SUB-2(b) | Every stored excluded row submits as excluded unless explicitly included or under a submitted excluded ancestor; `explicit:true` is NOT the gate | **PASS** | `submission-rules.ts:43-45`; `content-main.ts:5150-5174` | `src/domain/evaluate.ts:108-112` | Generated and explicit excludes both push; `explicit` only rides along as metadata. |
| C-SUB-2(c) | Silent-whitespace rows submit excluded but stay out of the marking UI | **FAIL (absent)** | `content-main.ts:5228-5244` + `core.ts:4402` | — | No silent-whitespace concept (see C-MARK-12). |
| C-SUB-2(d) | Descendants under a submitted excluded ancestor omitted unless explicitly included | **PASS** | `content-main.ts:5176-5190` `hasExcludedAncestorRow` | `src/domain/evaluate.ts:105-131` | `nextSubmittedExcludedAncestor` threads down the walk. |
| C-SUB-2(e) | Consent UI never stored/submitted as dedicated rows; hidden before saving | **PASS** | KN:582; MHL:831-875 | `src/content/consent.ts:108-128`; `evaluate.ts:121-124` | Consent is hidden (`opacity:0`/`visibility:hidden !important`) before capture and therefore falls under the invisible-textual rule rather than a dedicated row — matching the contract. Cosmetic leak: the inline `!important` hides remain in the captured HTML (the `data-uf-*` attribute is stripped by `serializeAttributes`, dom-view.ts:289, but the inline style is not). |
| C-SUB-2(f) | Immutable defaults travel as the payload tag list, never per-page rows; stale immutable rows suppressed | **PASS** | MHL:848-850 | `submit.ts:18`; `evaluate.ts:101-104`; `schema/submission.ts` superRefine | The schema even *enforces* that `defaultExclusionSelectors` is byte-identical to the immutable contract. |
| C-SUB-2(g) | Visible textual markable content → included rows | **PASS** | `content-main.ts:5234` `memoMarkable` | `src/domain/evaluate.ts:68-70` | `shouldSubmitImplicitInclude` = visible ∧ ownsDirectText ∧ ¬root, matching legacy's `isMarkableElement(allowParent:false)`. |
| C-SUB-2(h) | Invisible textual content → excluded rows, mobile geometry at save time; below-fold is visible | **PARTIAL** | `core.ts:12444-12493`; `content-main.ts:5248-5263` (Phase B ancestor guard) | `src/domain/evaluate.ts:72-74, 121-124`; `visibility.ts:66-74` | The rule and the viewport model are present (`viewportWidth` from `innerWidth`, `pageHeight` from `documentElement.scrollHeight`, so below-fold counts as visible — visibility.ts:66-74, dom-view.ts:84-85). **Missing: the Phase B ancestor guard.** Legacy refuses to emit an implicit `!visible ∧ markableTextual` row when the node still has a visible markable textual descendant (content-main.ts:5256-5263, with a comment naming it "the failure shape observed in field reproduction on long-form article layouts"). The rewrite emits the row *and* sets it as a `submittedExcludedAncestor` (evaluate.ts:121-123), suppressing every visible descendant beneath it. Combined with the `getBoundingClientRect`-only visibility (C-TGT-7 note), a sticky/column wrapper can silently delete a whole article from the payload. |
| C-SUB-2(i) | Non-textual implicit nodes omitted | **PASS** | `submission-rules.ts:47-49` | `evaluate.ts:68-70, 119-124` | Nodes with no direct text produce no row. |
| C-SUB-2(j) | `/html[1]` and `/html[1]/body[1]` never submitted | **PASS** | `submission-rules.ts:1-25` | `src/domain/xpath.ts:46-48`; `evaluate.ts:107`; `schema/marking.ts` `MarkRowSchema` refine | Enforced three times, including at the schema. |
| C-SUB-3 | Enumerated payload philosophy (positive AND negative ground truth) | **PASS** | CM-04:71-87 | `src/domain/evaluate.ts:105-125` | Both included and excluded rows are emitted; no corrections-only shortcut. |
| C-SUB-4 | Purely positional `/tag[index]` xpaths, aligned to the sanitized HTML sent | **PASS** | CM-04:166-172; `core.ts:12523-12542` `parsePositionalXPathSteps` | `src/domain/schema/marking.ts` `POSITIONAL_XPATH_PATTERN` | Every row is regex-validated at `submit.ts:15`. `/__closed-shadow[n]` cannot reach a row (§0(b)). |
| **C-SUB-5** | **AI run corpus = stored snapshots for EVERY marked page under the base URL; `rawHtml` only in static mode; refined raw XPaths** | **FAIL** | `src/background/ai-run-orchestrator.ts:671-692` (`storedPageEntries.map`, rawHtml backfills, `requiresRawXPathRefinement`), `385-427` (per-page refine loop), `src/common/xpath-utilities.ts:1-450` (fingerprint refiner) | `src/content/marking/submit.ts:19-25`; `src/entrypoints/popup/main.tsx:642-661, 833-851, 854-875`; `src/offscreen/xpath-refinement.ts:3-5` | Three separate failures. **(i) Single-page corpus:** `buildSubmissionSnapshot` hard-codes `pages: [{ …one page… }]`. There is no multi-page assembly anywhere. **(ii) `rawHtml` is never produced:** a repo-wide grep shows the only writer is `content-loader.content.ts:811`, which copies it from the *caller's* payload — and the sole caller (`main.tsx:842-847`) never passes it. `renderMode.inspect` (`main.tsx:1330-1333`) only reloads the tab with/without JS and captures nothing. Because `AiRunPayloadSnapshotSchema` requires `rawHtml` in static mode (`schema/submission.ts:42-47`), `buildSubmissionSnapshot` **throws** for every static-mode property; the router converts it to `{ok:false, failure:"command-failed"}` (`command-router.ts:200-205`) and `captureSubmission` returns `null` — so Run-AI and Save are silently impossible on any static property. **(iii) XPath refinement is a no-op stub:** `refineXPathEntries(_html, rows) => rows.map(MarkRowSchema.parse)`. The 449-line legacy fingerprint matcher (tag/attr/text/class/ancestor scoring, `minScore` 30, `buildAbsoluteIndexedXPath`) has no port, so even if `rawHtml` existed the xpaths would address the rendered DOM, not the raw HTML. Legacy also budgets the refinement (2.5 s, `ai-run-orchestrator.ts:323-327, 356-384`); the rewrite has nothing to budget. |
| C-SUB-6 | Run-start UX ordering: busy state + spinner + page lock BEFORE backfills/refinement/payload; 5 s poll cadence | **PARTIAL** | MHL:759-764, KN:514-515 | `main.tsx:1620-1622` (capture), `ai-job.ts:104-127` (poll) | The 5 s cadence is right (`ai-job.ts:106`, and the compute lock is acquired before the loop at 108). But `captureSubmission` runs the whole capture + refine round-trip inline before any busy state, and heavy payloads ride the runtime message bus rather than a storage/cache key (`main.tsx:842-851`, `background/index.ts:273-276`) — the exact multi-hop-heavy-payload pattern KN:515 forbids. |
| C-SUB-7 | AI-run timeout single source of truth | **FAIL** | KN:622 (`common/bus/contracts/ai-run.ts`) | `src/lynx/ai.ts:7-8` vs `src/lynx/ai-job.ts:105-106`, `src/background/services.ts:279`, `src/entrypoints/popup/main.tsx:1534` | `AI_RUN_TIMEOUT_MS = 8 * 60 * 1000` and `AI_RUN_POLL_INTERVAL_MS = 5_000` are declared and then **never imported**. Three call sites hard-code `480_000` and one hard-codes `5_000`. The constant exists; the contract ("never hardcode minutes") does not hold. |

---

## 7. C-PERF — marking performance contract (§1.6)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-PERF-1 | One activation path (`setEnabled`), no second immediate `forceRefresh`; spinner + input block + reveal scroll before freeze/overlays | **PARTIAL** | MHL:340-347, KN:572 | `content-loader.content.ts:709-747`, `478-527` | The single-path clause holds: `activateContentMain` runs the ritual then refreshes and renders once (lines 723-741) — no second refresh. The reveal-before-overlays ordering holds. Missing: no page-inspection spinner or page-input block wraps the ritual; the curtain is popup-directive-driven (`renderDirectiveSurface`, 313-349) and the page-load ritual runs with no popup bound at all (`establishPageContext` 408-444). |
| C-PERF-2 | Refinement tiers: cheap explicit-layer refresh, then invalidating full rebuild; fast paths must not create a second marking truth | **FAIL** | MHL:322-337, 348-356, KN:571 | `src/content/marking/engine.ts:184-200`; `store.ts:74-103` | There is exactly one tier and it is the heaviest: `scheduleRender` → `refreshBridge()` (full `createDomBridgeView` walk) → `evaluate()` (full tree walk) → `renderer.render` (full overlay rebuild). The branch-scoped `evaluateBranch` machinery exists (`evaluate.ts:145-179`, used by `store.toggle` at 96-101) but is thrown away by the very next `refreshBridge`, which reconstructs the store from scratch (engine.ts:167-168). |
| C-PERF-3 | CP7a per-element caches, invalidated only on real DOM/viewport change; paint-reachability unknowable while scrolling | **FAIL** | MHL:357-373, KN:557, KN:545 (S3) | `dom-view.ts:60-72, 173-238`; `renderer.ts:94`; `engine.ts:231` | No caches at all. `buildNode` recomputes per element: `landmarkCount(element)` **four times** (lines 68, 69, 226, 227), each a full-subtree recursion; `geometryFor(element)` **three times** (223 via `isUserVisible`, 70 and 228), each doing `getBoundingClientRect` + `getComputedStyle` + `hasStyleHiddenAncestor` (which itself calls `getComputedStyle` per ancestor, dom-view.ts:134-150). That is O(n²) subtree walks plus O(n·depth) forced style reads **per rebuild**, and a rebuild is scheduled on every `scroll` event (engine.ts:231, capture phase). The S3 regression is reproduced verbatim: `renderer.render` applies the strict `isPaintReachable` filter unconditionally (renderer.ts:94) with no is-scrolling escape, which is exactly the mid-scroll `elementsFromPoint` verdict problem KN:545 fixed. |
| C-PERF-4 | CP7b branch-scoped rebuild + guards + trailing coalesced FULL reconcile | **PARTIAL** | MHL:388-425, KN:556-558, MIP:143-213 | `src/domain/evaluate.ts:145-179`; `src/content/marking/store.ts:74-103` | `evaluateBranch` implements the splice-outside/rewalk-subtree shape, and `store.toggle` computes the inherited ancestor state (94-95) and falls back to FULL when an excluded ancestor is removed (75-77, 90-93). Missing: the >1-pending-toggle guard, the selector-fingerprint guard, `entryKeyDiffConfinedToSubtree`, the stale-stash guard, the unbounded-affected-root guard, the parity audit switch, and the ~1.5 s trailing FULL reconcile. And, as noted in C-PERF-2, the scoped result is discarded by the next bridge refresh anyway. |
| C-PERF-5 | Collection cost bounds (MA-4): `collapseElementsByNesting` O(rows×depth), no pairwise `contains()`; per-operation xpath caches; scroll repaint repositions only | **FAIL** | `core.ts:4222-4296`; `explicit-marking-handler.ts:79-90` (per-operation xpath cache); `shared-selector-cache.ts:125-206` | `renderer.ts:90-107`; `engine.ts:284-303`; `store.ts:48-62` | (i) No nesting collapse (see C-MARK-10). (ii) Scroll does not reposition — it rebuilds everything (engine.ts:231 → 184-200). (iii) `renderer.render` calls `isPaintReachable` per overlay entry, and each call runs `getComposedHitElements` → `document.elementsFromPoint` plus a full-subtree `getComputedStyle` walk per hit (hit-testing.ts:16-35). (iv) `resolveAtPoint` computes the composed hit list once, then calls `isPaintReachableAt` per hit which recomputes it again (engine.ts:285-287) — N+1 composed hit computations per **mousemove**. (v) `nearestAncestorMark`/`nearestExcludedAncestorMark` scan and sort all rows per toggle (store.ts:48-62). (vi) `xpathsMatching` re-runs `querySelectorAll` per selector with no cache (engine.ts:244-262) where legacy has the generation-keyed `shared-selector-cache.ts`. |
| C-PERF-6 | Motion-pause maintenance stays cheap; never re-introduce the full-document sweep on the periodic/observer path | **NOT ASSESSED HERE** | KN:548 | `src/content/stabilization/*` | Outside this patch's read set; flagged for the freeze-focused report. |

---

## 8. C-EMU — mobile emulation (§1.13)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-EMU-1 | Mobile simulation on by default per tab session; editor tab forces it back on; Render-Mode inspection must not clear the session choice | **PARTIAL** | MHL:854-859, KN:586 | `src/domain/constants.ts:14-27`; `main.tsx:631-640`; `src/content/stabilization/emulation.ts` | Presets and the session re-attach (`ensureSessionEmulation`) exist and the emulation is re-applied after a save (`main.tsx:1665`). Relevant to this patch mainly because C-SUB-2(h) requires **mobile simulation geometry at save time**: `applySessionEmulation` is called before capture (`main.tsx:839`), so the geometry is right when the popup drives it — but the evaluation that produces `visible` also runs continuously from `refreshBridge` under whatever emulation is current, so the marking-time and save-time verdicts can disagree. |
| C-EMU-2 | Desktop preview checkbox with fallback to forced mobile | **NOT ASSESSED HERE** | MHL:860-863 | — | Covered by the popup-UX catalog. |

---

## 9. C-SAVE — page save / candidate completion / backend data (§1.14)

| # | Contract | Verdict | Legacy | Rewrite | Note |
|---|---|---|---|---|---|
| C-SAVE-1 | `pageType` is mandatory on every saved page marking; repaired before save | **FAIL** | KN:529 (`repairLocalPageMarkingPageTypes`) | `src/storage/config.ts:11-18` (`pageType` **optional**); `main.tsx:854-875` (`configFromSubmission` never sets it) | No page-type is ever attached to a saved page marking, and nothing repairs one. Against a backend whose `PageMarking.PageType` is `[JsonRequired]` this rejects or drops the page. |
| C-SAVE-2 | Page-type taxonomy is backend-sourced, cached, top level consumed, offline fallback in sync | **FAIL (absent)** | KN:530 | `src/lynx/graphql.ts:14-26, 98-100` | `PROPERTY_PAGE_TYPES_QUERY` / `buildPropertyPageTypesRequest` are declared and **never referenced** anywhere else in the tree. No cache, no `GET /page-types`, no `DEFAULT_PAGE_TYPE_TAXONOMY`. |
| C-SAVE-3 | Save reconciliation must not clear on a bare 200 — the forced reload must confirm the page is present | **FAIL** | KN:531 | `src/background/index.ts:300-309`; `main.tsx:1658-1671` | `config.save` clears the local copy and declares success purely on `result.status === "ok"` (`services.applyBackendSave` → `configRepo.clear(siteId)`, `services.ts:197-204`). No forced reload, no presence confirmation. |
| C-SAVE-4 | Empty/partial `/load`/`/save` responses never destroy local; merge by timestamp | **FAIL** | KN:528 | `src/lynx/rest.ts:49-69`; `main.tsx:854-875`; `background/index.ts:300-309` | `saveConfigSnapshot` does classify an empty body as `"empty"` (rest.ts:65-67) — good. But the *outbound* snapshot is the destructive part: `configFromSubmission` builds `pageMarkings: { [page.url]: … }` from the single captured page, so **every other page's markings for the property are overwritten with nothing on every save.** There is no merge with the remote set and no timestamp reconciliation. This is the structural form of the known live finding "a 200 /save once wiped all page markings" — in the rewrite it is not a race, it is the design. |
| C-SAVE-5 | A page with no local or remote data stays saveable with default markings and no manual toggles | **PARTIAL** | KN:532 | `src/lynx/ai-job.ts:78-84`; `main.tsx:1609-1619, 1633` | `saveEnabled = pageControlsVisible ∧ ¬reconciliationPending ∧ ¬sessionRequiresAiRun`, and save additionally demands the popup be in `post_ai_clean`/`preview_open` (main.tsx:1633). So an accept-the-defaults save is reachable, but only after a completed AI run — no zero-toggle, zero-run path. |
| C-SAVE-6 | Save replaces local from the `/save` RESPONSE snapshot, scoped to the save caller | **FAIL** | LRP:36-83 (`replaceServerConfigIntoLocalSnapshot`) | `src/lynx/rest.ts:68`; `src/background/index.ts:300-309`; `src/background/services.ts:197-204` | The response *is* parsed (`SaveResponseSchema.parse`, rest.ts:68) and then discarded — `config.save` returns `{status}` only (index.ts:306-308) and `applyBackendSave` **clears** local rather than rebuilding it from the response. Nothing populates a `backendSavedPageMarkings` equivalent, so nothing can drive a Lynx checklist. |
| C-SAVE-7 | Send-to-Lynx staleness guard, fail-closed, sanitized set comparison against `cssInfo(url)` | **FAIL (absent)** | KN:621 | `src/lynx/graphql.ts:28-39, 102-104`; `src/background/services.ts:318` | `CSS_INFO_QUERY` and `buildCssInfoRequest` are declared and wired into `services.lynx` — and **called from nowhere**. There is no checklist popover, no sanitized selector-set comparison, no `usesUnfluffify` handling, and no Send-to-Lynx action at all. `UPDATE_SCRAPING_CONDITIONS_MUTATION` is likewise unreferenced outside its own builder. |

---

## 10. Summary of load-bearing regressions, ranked

1. **Static render mode cannot produce a payload at all.** `rawHtml` is required by the schema and
   never produced by anything (`schema/submission.ts:42-47` vs the empty grep for a `rawHtml` writer).
   Capture throws and is swallowed as `command-failed` (`command-router.ts:200-205`). Blocks Run-AI and
   Save on every static property. *(C-SUB-5)*
2. **Every save destroys the property's other pages.** `configFromSubmission` writes a single-page
   `pageMarkings` map (`main.tsx:866-873`) with no merge. *(C-SAVE-4, C-SUB-5)*
3. **XPath refinement is a stub.** `src/offscreen/xpath-refinement.ts:3-5` vs legacy's 449-line
   fingerprint matcher. Even with `rawHtml`, static-mode xpaths would not address the HTML they ship
   with. *(C-SUB-5)*
4. **Footers, headers and navs with a nested landmark drop out of marking entirely.**
   `landmarkCount >= 2` counting self + occurrences (`dom-view.ts:36-49, 226`) → `pageShell` →
   excluded from default rows (`engine.ts:102`) and from `isStructuralBoundary`
   (`boundary.ts:52`). *(C-MARK-6, C-TGT-5.2)*
5. **The dropped broad-footprint widening heuristic is back** (`boundary.ts:41-43`,
   `dom-view.ts:70, 228`), reversing an explicit architect decision. *(C-TGT-5.2)*
6. **Shift widening is one step of four** (`widening.ts:67-78`). *(C-TGT-4)*
7. **Unmarking a boundary deletes hand-made exclusions inside it** (`store.ts:18-22`). Silent data
   loss during ordinary editing. *(C-MARK-8)*
8. **a11y-hidden / sr-only is a blanket exclude, inherited from ancestors** (`visibility.ts:50-52`,
   `dom-view.ts:93`), against the explicit D4 decision — and it flips those subtrees to `excluded`
   rows at submission. *(C-TGT-8, C-SUB-2h)*
9. **The Phase B ancestor guard is missing** (`evaluate.ts:121-124`), so an off-bounds wrapper can
   submit as excluded and suppress its whole visible subtree. Compounded by bounding-rect-only
   visibility. *(C-SUB-2h)*
10. **Marking rebuilds the entire DOM view, evaluation and overlay set on every scroll frame**, with
    four subtree recursions and three forced layouts per element (`dom-view.ts:60-72, 173-238`,
    `engine.ts:184-200, 231`), and applies the strict paint-reachability filter mid-scroll
    (`renderer.ts:94`) — reproducing the fixed S3 drift bug. *(C-PERF-2/3/5)*
11. **Every descendant of an excluded ancestor gets its own overlay box** (`evaluate.ts:56-58`,
    `renderer.ts:92-107`) — no nesting collapse. *(C-MARK-10, C-PERF-5)*
12. **Silent highlighting is one flat layer** (`silent-highlight.ts:9-18`), so the excluded and
    immutable review layers do not exist. *(C-SIL-1)*
13. **Extension chrome ships inside `renderedHtml`** — the directive root
    (`content-loader.content.ts:303-309`) and the consent bypass style (`consent.ts:96-105`) are not
    recognised as extension UI. *(C-SUB-1)*
14. **The whole Lynx-facing surface is declared but unwired**: `cssInfo`, `propertyPageTypes`,
    `updateScrapingConditions` all have builders and no callers. *(C-SAVE-2, C-SAVE-7)*
15. **`installClosedShadowHostInstrumentation` is dead code that would cause content loss if wired**
    (`dom-view.ts:258-278` + `captureFlattenedHtml` returning `""` at 295). *(C-SHDW-1)*

## 11. UX elements to bring over from legacy

These are behaviours an operator will notice is missing, ordered by how visible the loss is.

1. **Excluded and immutable silent-highlight layers**, with the immutable layer's dashed-border /
   transparent-background treatment (MHL:877-896). Silent mode currently answers "what does the AI
   keep?" but not "what does it drop?", which is the review question that matters most.
2. **Nesting collapse before drawing** (`core.ts:4222-4296`). Without it, excluding a container turns
   its whole area into a saturated block and the operator loses the ability to see structure through
   the overlay.
3. **Leaf-boundary force-include** (`forceIncludeSet`, MHL:294-313). An unmarked `<button>Akne</button>`
   must stay visible in the default layer so the operator can re-exclude it. This was legacy pain P3,
   misdiagnosed twice; the rewrite has no equivalent, so an unmarked leaf boundary goes blank.
4. **Explicit-target-first hit resolution** (`core.ts:9063-9113`). Clicking anywhere inside an explicit
   include should offer that include as the target; today only its own padding works.
5. **One-click include→exclude conversion** (C-MARK-17). Currently two clicks.
6. **The temporary-disabled presentation** — dimmed markings on a still-mounted overlay, cleared hover,
   progress cursor, persistent `aria-live` paused notice (MHL:646-667). The rewrite silently removes
   the listeners instead.
7. **Collapsed-textual-wrapper geometry fallback** (`shared-inclusion.ts:71-80`) and **ghost markings
   for hidden explicit includes in marking mode**, so a zero-box wrapper with real text is still
   hoverable and markable.
8. **Mid-scroll paint-reachability suspension** (KN:545 S3) — the visible symptom is boxes collapsing
   and drifting during scroll, which legacy already paid for once.
9. **Cheap-tier refinement on toggle** (MHL:322-337) so a click repaints in a frame instead of
   rebuilding the document view.
10. **Send-to-Lynx checklist with the fail-closed staleness guard** (KN:621) — currently no path exists
    from a saved property to Lynx at all.

---

## 12. Product-owner questions

These are genuine product/design decisions that the code cannot answer.

1. **Static render mode:** the rewrite has no raw-HTML capture path and no XPath refiner. Is static
   mode still a supported product mode for the rewrite's first release, or is the rewrite deliberately
   rendered-mode-only until the refiner is ported? The answer decides whether item 1 and 3 of §10 are
   release blockers or backlog.
2. **Multi-page AI corpus:** legacy always submits every marked page under the base URL (C-SUB-5).
   Should the rewrite keep whole-property corpus semantics, or is a per-page run now the intended
   product (which would change what "the property's selectors" means and how a second page's marks
   affect the first)?
3. **Page types:** legacy requires a backend-resolved `pageType` on every saved page and drives the
   Lynx completion checklist from it. Is the page-type taxonomy still part of the product, or has the
   candidate/coverage concept been retired in the rewrite's model?
4. **Widening ladder priority:** if the four-step ladder is restored, is the legacy priority order
   (nearest structured group beats broadest markable ancestor) still what editors want, or was the
   rewrite's "always climb to the broadest qualifying group" a deliberate simplification worth keeping?
   Editors' muscle memory is built on the legacy order.
5. **Page-shell protection strength:** the architect dropped the broad-footprint heuristic on
   2026-07-05 accepting that a landmark-less full-width column becomes widen-eligible. The rewrite
   reinstated it. Which tradeoff does the product want — occasional over-wide exclusions, or occasional
   un-widenable columns?
6. **Silent-whitespace exclusions (C-MARK-12):** legacy silently excludes visible blocks with no
   meaningful text. Is that still wanted, given the rewrite's unified row model has no place to hide
   such rows from the marking UI?
7. **Destructive-save policy:** should `/save` be a whole-property replace (current rewrite behaviour)
   or a per-page merge? Legacy's dangling guard commit `e11059b1` implies merge was the intended
   answer; confirming it decides whether the fix is a client-side merge or a backend contract change.
