# Legacy Unfluffify — In-Page (Content Script) UX / Visual Specification

Source tree: `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main` (worktree of `main`, production v1.10.0+3).
All `file:line` references below are relative to that root. Primary sources read in full: `src/content/core.ts` (14,312 lines), `src/content-main.ts` (7,557 lines), `src/content/marking-rules.ts`, `src/content/silent-highlight-rules.ts`, `src/content/page-toast.ts`, `src/content/property-lock-banner.ts`, `src/content/render-mode-inspection-handlers.ts`, `src/content/overlay-memory.ts`, `src/content/inspection-status.ts`, `src/content/layers/content-bus-client.ts`, `src/common/{constants,emulation,spinner-contract,page-motion-freeze-control,page-motion-freeze-bridge,text,utilities}.ts`, `src/public/cursors/{include,exclude}.svg`, and `MARKING_AND_HIGHLIGHTING_LOGIC.md` (the locked contract).

---

## 1. Injected extension chrome — complete inventory

Everything the content scripts put into the page, all tagged `data-uf-extension-ui="true"` so it is excluded from marking, hit-testing, motion freezing, and saved snapshots (strip selectors at core.ts:952-961; the tag check at core.ts:2524-2529):

| Element / style | id | Purpose | Created at |
|---|---|---|---|
| Marking overlay | `#unfluffify-overlay` | full-viewport fixed overlay holding all marking layers | core.ts:7543-7545 |
| Marking overlay stylesheet | `#unfluffify-freeze-style` | all `uf-*` marking CSS + cursor rules | core.ts:7276-7540 |
| Silent overlay | `#unfluffify-silent-highlight-overlay` | passive highlight layers | content-main.ts:2390-2438 |
| Silent stylesheet | `#unfluffify-silent-highlightings-style` | `uf-silent-*` CSS + consent-hidden + preview-cursor rules | content-main.ts:2080-2140 |
| Page-motion pause stylesheet | `#unfluffify-page-motion-pause-style` | animation/transition freeze CSS + indicator CSS | core.ts:5654-5738 |
| Page-motion pause indicator | `#unfluffify-page-motion-pause-indicator` | fixed snowflake+code-tags glyph pill | core.ts:5740-5767 |
| Page-inspection cursor style | `#unfluffify-page-inspection-style` | `cursor: progress` on whole page during reveal | core.ts:4933-4962 |
| Popup-busy overlay | `#unfluffify-popup-busy-overlay` + `#unfluffify-popup-busy-style` | full-page dim curtain + spinner card during data-affecting ops | core.ts:5442-5568 |
| Page toast | `#unfluffify-page-toast` + `#unfluffify-page-toast-style` | top-of-page toast used in silent mode / hotkeys | page-toast.ts:43-68 |
| Property-lock banner | `#unfluffify-lock-banner` + `#unfluffify-lock-banner-style` | fixed top yellow collaboration banner | property-lock-banner.ts:60-127 |
| AI-preview focus style | `#unfluffify-ai-preview-focus-style` | yellow flash class for previewed elements | core.ts:8363-8378 |
| Consent bypass style | `#uf-consent-bypass` | re-enables pointer-events killed by consent frameworks | core.ts:2555-2570 |
| AI popover marker | hidden `<div>` (no id, `hidden`) | invisible sentinel that anchors the preview session (`state.aiPopover`) | core.ts:13312-13325 |

Marked page elements additionally get a `data-uf-mark-id="uf-N"` attribute (core.ts:8510-8529) so overlay boxes can be correlated (`data-mc-mark-id` / `data-mc-mark-kind` on the boxes, core.ts:9871-9879).

---

## 2. The marking overlay: geometry, stacking, layers

`#unfluffify-overlay` (core.ts:7307-7315):
```css
position: fixed; top: 0; left: 0; right: 0; bottom: 0;
z-index: 2147483647 !important;   /* max int32 — topmost */
pointer-events: auto;              /* it CAPTURES clicks in marking mode */
```
Its `right`/`bottom` are inset by the live scrollbar gutter so boxes never draw over scrollbars (`updateOverlayGutter`, core.ts:7995-8005).

Ten child layers, all `.uf-layer { position:absolute; inset:0; pointer-events:none; transition: opacity 0.15s ease; }` (core.ts:7319-7324), stacked via explicit z-index (core.ts:7325-7334):

| data-layer | z | Draws |
|---|---|---|
| `hard` | 2 | immutable exclusions (`uf-hard-locked`) |
| `default` | 3 | implicit/default marks (`uf-default`) |
| `saved-explicit-exclude` | 4 | session-baseline explicit excludes |
| `saved-explicit-include` | 5 | session-baseline explicit includes (+ghosts) |
| `ai-content` | 6 | AI/CSS-selector content (`uf-ai-content` + variants) |
| `session-explicit-exclude` | 7 | this-session user excludes |
| `session-explicit-include` | 8 | this-session user includes (+ghosts) |
| `focus` | 9 | preview focus box (`uf-focus`) |
| `hover` | 10 | hover feedback (`uf-hover`) |
| `interaction` | 11 | click-acknowledgement pulse |

DOM creation order is different (core.ts:7547-7558) but irrelevant — z-index wins. Note the "saved" layers are the *fresh session baseline* (defaults + selector influence recomputed at enable), not backend-fetched marks — the contract at MARKING_AND_HIGHLIGHTING_LOGIC.md:97-113; the split function is `splitExplicitMarkingCollectionsBySavedState` (core.ts:10086-10129), which compares against `getSavedPageEntry` (baseline adopted on first render after enable, core.ts:11288-11295).

Whole-overlay state classes (core.ts:7335-7348):
- `.uf-scrolling` → all layers `opacity: 0` (marks vanish during viewport scroll; re-render fades them back in over the 0.15s layer transition). Set by `handleScroll` (core.ts:13110-13155) with a 250 ms debounce (`SCROLL_DEBOUNCE_MS`, core.ts:799); only *viewport* scrolls hide — nested-container scrolls redraw without hiding (core.ts:13120-13132).
- `.uf-page-inspection-active` → all layers `opacity: 0` and the overlay background dims to `rgba(16, 20, 28, 0.2)` (core.ts:7316-7318, 7338-7340) — the reveal/inspection "curtain tint".
- `.uf-marking-temporarily-disabled` → layers dim to `opacity: 0.28; filter: grayscale(0.75) saturate(0.55)`, hover+interaction layers go fully `opacity: 0` (core.ts:7341-7348).

### 2.1 Rect drawing mechanics

Every mark is one or more `.uf-rect` divs — `position:absolute; box-sizing:border-box; pointer-events:none; border-radius:4px;` (core.ts:7349-7354) — one div per *client rect* of the element (multi-line inline elements get one box per line): `drawMultiRectReuse`/`drawRectReuse` (core.ts:9846-9903). Boxes are keyed `markId|className|kind|rectIndex` and reused across renders (position patched in place); unused boxes are removed at `finalizeLayerRender` (core.ts:9836-9844).

Rect sources:
- `getVisibleRects` (core.ts:9959-9974): element's `getClientRects()`, zero-size and fully-off-viewport rects dropped (core.ts:9905-9930), then filtered by **paint reachability** — 5-point hit-test (center + 4 corners inset 1px, core.ts:9906-9921) via `document.elementsFromPoint`, tolerating pointer-events-suppressed chains and open-shadow hosts (core.ts:1765-1802). During active scroll reachability is "unknowable" and rects pass through unfiltered (core.ts:1830-1857).
- Collapsed-text fallback: an element with normalized text whose own box is collapsed borrows its first visible descendant's rects (core.ts:9932-9957).
- `getGhostRects` (core.ts:11462-11467): raw client rects with no reachability filter — used for hidden ("ghost") marks.
- Reposition-only passes (cached collections unchanged) use `getRectsInViewport` (core.ts:11448-11460).

---

## 3. Overlay class catalog — exact visuals

All in `#unfluffify-overlay` scope, injected at core.ts:7287-7539.

### Marking-mode marks

| Class | Border | Background | Extra | Semantics |
|---|---|---|---|---|
| `uf-hover` | `2px solid #ffb300` (amber) | `rgba(255,179,0,0.1)` | — | current resolved click target under cursor (core.ts:7355-7358) |
| `uf-focus` | `3px solid #00acc1` (cyan) | `rgba(0,172,193,0.12)` | `box-shadow: 0 0 5px 5px #00acc178`; `animation: blink 1s linear infinite` (`blink`: opacity 0↔1, core.ts:7359-7369) | element focused from the popup content list / AI preview |
| `uf-hard-locked` | `2px dashed rgba(225,70,70,0.4)` | `repeating-linear-gradient(45deg, rgba(225,70,70,0.25) 0 20px, rgba(225,150,70,0.25) 20px 40px)` — red/orange diagonal candy-stripe | — | immutable default exclusions (IMG/INPUT/SCRIPT/SVG/… subtrees) + hidden stored explicit excludes; not clickable (core.ts:7370-7373, collections at core.ts:11367-11370, 11496-11503) |
| `uf-default` | `1px solid #2e7d32` (green) | `rgba(46,125,50,0.08)` | — | implicit/default content layer: everything currently counted as *included content* by default rules (core.ts:7374-7377, drawn at 11646-11653) |
| `uf-explicit-include` | `3px solid #1b5e20` (dark green) | `rgba(27,94,32,0.2)` | — | user explicit include (Alt-click); drawn on saved- and session-include layers (core.ts:7411-7414; class from `getExplicitMarkingPresentation`, marking-rules.ts:172-185) |
| `uf-explicit-include-ghost` | `1px dotted rgba(27,94,32,0.45)` | transparent | — | explicit include whose element is currently hidden but still has measurable geometry (core.ts:7415-7418; ghost buckets at 10304-10317, 11535-11548) |
| `uf-explicit-exclude` | `3px solid #c62828` (red) | `rgba(198,40,40,0.2)` | — | explicit exclusion row (user click, selector-seeded row, or auto-excluded toggleable default rendered through the ordinary exclude overlay — contract MARKING_AND_HIGHLIGHTING_LOGIC.md:232-240) (core.ts:7419-7422) |
| `uf-explicit-exclude-ghost` | `1px dashed rgba(198,40,40,0.45)` | transparent | — | defined at core.ts:7423-7426; hidden excluded elements are actually routed into the hard layer as hard-locked (collections at core.ts:11367-11370), so this class is present in CSS but not emitted by `drawCollections` |
| `uf-ai-content` | `1px solid transparent` | `background-color: rgba(46,125,50,0.08)` plus four repeating-linear-gradient stripes forming an **animated marching-dashes green border** (`#35943a` 6px dash / 6px gap, 2px thick, `animation: uf-ai-content-dash 2s linear infinite`) | core.ts:7378-7400 | content the stored AI/CSS selector set currently counts as included |
| `uf-ai-content uf-ai-content-overlay` | same dash animation | `background-color: transparent` | core.ts:7401-7403 | AI-content box drawn *on top of* a session explicit include (element is both) — dashes only, so the solid include green shows through (drawn at core.ts:11573-11585) |
| `uf-ai-content uf-ai-content-ghost` | `border-style: dotted; border-color: rgba(53,148,58,0.45)`; gradients and animation removed (`animation: none`) | transparent | core.ts:7404-7410 | hidden AI-content elements (ghost bucket, core.ts:11559-11571) |
| `uf-interaction-ack` | inherits the include/exclude class it is combined with | — | `animation: uf-interaction-pulse 160ms ease-out forwards` — `opacity .95→0`, `scale 1→1.02` (core.ts:7427-7433); reduced-motion: no animation, `opacity: .6` (core.ts:7434-7439) | instant click acknowledgement flash drawn on the `interaction` layer before the real mark lands (core.ts:8332-8361); cleared after 180 ms (`TOGGLE_ACK_CLEAR_MS`, core.ts:800-801) |

Semantic notes (locked contract):
- Toggleable-default exclusions (FOOTER/FORM/LABEL/NAV/HEADER/DIALOG/ASIDE/BUTTON — common/constants.ts:67-76) have **no dedicated visual layer**; once auto-excluded they render through the ordinary red exclude overlay like any user exclusion (MARKING_AND_HIGHLIGHTING_LOGIC.md:53-54, 232-240; renderer requires `explicit:true` OR live default-tag match at core.ts:10018-10021).
- Selector-*excluded* matches also get no dedicated overlay; they only suppress the default layer at the matched element itself (MARKING_AND_HIGHLIGHTING_LOGIC.md:751-753; `selectorExcludedElements` participate in default-layer precedence only, core.ts:11372-11389).
- Immutable defaults render candy-striped in marking mode and as the dashed "immutable" layer in silent mode (contract line 197-199).

### Extension notices inside the overlay

| Element | Visuals | Copy | Ref |
|---|---|---|---|
| `.uf-toast` (marking-mode toast) | fixed bottom (14px insets), `padding:10px 12px`, `background:rgba(47,42,36,0.9)`, `color:#fdf6ed`, Inter stack, `font-size:12px`, `border-radius:10px`, slides up 8px + fades in `0.2s ease`; auto-hides after **1800 ms** | dynamic (see toast catalog §12) | core.ts:7440-7459, showToast core.ts:8007-8019 |
| `.uf-marking-disabled-notice` | fixed top-center (`top:max(14px, safe-area)`, `left:50%`, translateX(-50%)), max-width `min(420px, 100vw-28px)`, `padding:9px 12px`, `border-radius:8px`, `border:1px solid rgba(255,255,255,0.22)`, `background:rgba(35,39,47,0.94)`, white text `13px/650`, `box-shadow:0 12px 32px rgba(0,0,0,0.22)`, fade/slide `0.16s`; only visible while overlay has `.uf-marking-temporarily-disabled` | "Saving page... marking paused" / "Save sync pending... marking paused" / "Marking temporarily paused" (text.ts:167-169; message chosen at core.ts:8059-8070) | core.ts:7460-7488; aria-live=polite role=status (7577-7583) |
| `.uf-page-inspection-notice` | fixed dead-center card: `translate(-50%,-50%)`, max-width `min(460px, 100vw-32px)`, `padding:14px 16px`, `border-radius:12px`, `border:1px solid rgba(255,255,255,0.24)`, `background:rgba(22,26,34,0.96)`, white `14px/650`, `box-shadow:0 18px 44px rgba(0,0,0,0.28)`; scales 0.98→1 + fades in `0.16s` when overlay has `.uf-page-inspection-active` | "Inspecting page... it will be ready soon" (text.ts:164) | core.ts:7489-7520; created 7586-7601, aria-live=assertive |
| `.uf-page-inspection-spinner` | 20×20 ring, `border:2px solid rgba(255,255,255,0.28)`, white top arc, `border-radius:999px`, spins `0.8s linear infinite`; reduced-motion: no spin | — | core.ts:7521-7538 |

### Popup-busy curtain (page-side mirror of the popup spinner)

`#unfluffify-popup-busy-overlay` (core.ts:5460-5513): full-viewport fixed, `z-index:2147483647`, `background: rgba(16,20,28,0.2)`, `cursor: progress`, centers a `.uf-popup-busy-notice` card **identical in style to the inspection notice** (same paddings/radius/colors/shadow) with a `.uf-popup-busy-spinner` (identical 20px ring). Default copy "Working... page controls are temporarily paused" (text.ts:165, applied core.ts:5629-5634). While up it installs a capture-phase input blocker over 22 event types (clicks, keys, wheel, touch — the same `PAGE_INSPECTION_INPUT_EVENTS` list, core.ts:892-916, blockers 5390-5440). It fail-opens via a watchdog: default 65 s, or the caller's `releaseBy` lease capped at 10 min (core.ts:876-883, 5640-5646).

**Single-spinner contract**: when the brain broadcasts a page curtain that is page-blocking, content raises the popup-busy overlay (its own spinner) and simultaneously *suppresses* the inspection notice's spinner while keeping the dim tint, so the reveal/freeze and AI-run curtains never stack two spinners (content-bus-client.ts:105-147; `setPageInspectionUiActive(active, {suppressNotice})`, core.ts:7623-7646). Curtain message resolution order: machine overlay-memory first (`compute_lock` → "Analyzing page content with AI..." with real input block, `restoring` → "Inspecting page... it will be ready soon" without block — overlay-memory.ts:49-75, PopupText copy text.ts:218), then the shared spinner phase-definition table (spinner-contract.ts — e.g. REVEAL_FREEZE titles "Revealing lazy-loaded content", "Scrolling page down", "Scrolling page up", "Freezing page motion", "Capturing static page", "Restoring page motion", spinner-contract.ts:248-307). The brain re-broadcasts ~1/s re-arming the fail-open watchdog (content-bus-client.ts:113-117).

---

## 4. Custom cursors and the cursor state machine

The `<html>` element carries exactly one cursor class, derived from the marking FSM (`updateCursorMode`, core.ts:8189-8205; FSM `deriveMarkMode` core.ts:8131-8142 — precedence disabled > passthrough > include > exclude):

| Mode | class | CSS (core.ts:7291-7306) |
|---|---|---|
| exclude (default active) | `uf-cursor-exclude` | `cursor: url("chrome-extension://…/cursors/exclude.svg") 4 3, crosshair !important` |
| include (Alt held) | `uf-cursor-include` | `cursor: url(".../cursors/include.svg") 4 3, copy !important` |
| passthrough (Space held) | `uf-cursor-passthrough` | `cursor: unset !important` (page's own cursors) |
| disabled/busy | `uf-cursor-disabled` | `cursor: progress !important` |

Cursor artwork (32×32 SVG, viewBox 11.1×16.65): a black arrow with white outline plus a badge circle — **exclude** = dark-red circle (`#a02626`) containing a horizontal minus; **include** = green circle (`#609423`) containing a plus (public/cursors/exclude.svg, include.svg). Hotspot `4 3` = the arrow tip. Fallbacks are deliberately neutral (`crosshair`/`copy`, *not* `not-allowed`) because Chromium transiently drops custom image cursors and flashed the forbidden cursor (comment core.ts:7280-7286); both SVGs are pre-decoded via `new Image()` at overlay creation to shrink that window (core.ts:7236-7258, 7541).

During the reveal walk the separate `#unfluffify-page-inspection-style` forces `cursor: progress` on `html.uf-page-inspection-active` and every descendant (core.ts:4951-4956).

---

## 5. Marking interactions (what a click does)

### Mode & modifiers
- **FSM** (contract MARKING_AND_HIGHLIGHTING_LOGIC.md:505-541; code core.ts:8105-8174): `disabled` (off/busy) → `passthrough` (Space latch) → `include` (Alt) → `exclude` (default). Shift is an orthogonal *breadth* modifier (`shouldAllowParentMarking`, core.ts:8172-8174), never a mode. Commit-time mode is re-derived from the click event's own `altKey` (race-proof, core.ts:8154-8170).
- Modifier state syncs on every mousemove/keydown/keyup; window blur, tab hide, and navigation reset all latches (core.ts:8250-8303).

### Hover feedback
Mousemove (only the overlay hears it — it sits on top) resolves the would-be target through `getMarkableTarget` and draws `uf-hover` boxes over all its rects on the hover layer, throttled to one rAF and memoized against the exact hit-stack + target bounds so an idle cursor costs nothing (core.ts:9163-9298, cache 8689-8752). Hover is suppressed while busy/reconciliation-pending (clearHoverHighlight, core.ts:9241-9247).

### Exclude click (plain click or right-click — contextmenu also toggles, core.ts:9711-9717)
- Resolves the nearest **self-markable** target from the composed hit stack (`document.elementsFromPoint` + open-shadow piercing + pointer-events-suppressed descendant surfacing, core.ts:8610-8664; target walk 9043-9161).
- **First-click unmark on default boundaries**: a direct exclude click on an already-default-excluded boundary with no stored row writes `{excluded:false}` — visibly unmarking it on the FIRST click instead of requiring two (core.ts:9464-9483 with the explanatory comment; contract lines 294-312).
- A click on an already-explicitly-excluded element toggles it off; hierarchy cleanup removes descendant rows, converts broader default ancestors to `excluded:false`, removes overlapping includes (core.ts:9357-9509).
- Clicks inside immutable subtrees show toast "Default exclusions cannot be overridden" (core.ts:9312-9315; text.ts:160).
- **Immediate acknowledgement**: before any recompute, the target flashes a 160 ms `uf-interaction-ack` pulse in the matching include/exclude colors on the interaction layer (core.ts:9697, 8332-8361). Duplicate clicks on the same target within 320 ms are swallowed (`USER_TOGGLE_DUPLICATE_WINDOW_MS`, marking-rules.ts:132-170; check at core.ts:9686-9696).
- The mutation is queued to the next frame; the explicit layers redraw synchronously-fast, a full invalidating rebuild follows (~180 ms deferred or immediate), and settle re-renders run at 180/700/1800 ms after enable (core.ts:805-807, 10603-10661, 12901-12919). A single toggle takes the branch-scoped CP7b rebuild with a 1.5 s trailing full reconcile (core.ts:10838-11128).

### Include click (Alt+click)
- Alt switches hover+click to include mode: target resolution may reach inside excluded parents (`allowExcludedParentChildren`), prefers explicit targets, and restores mixed direct-text ancestor promotion (core.ts:9656-9677).
- Ineligible targets toast "Element cannot be explicitly included" (core.ts:9585-9587; text.ts:162). Alt-click on an excluded element that cannot be included acts as an unmark of that exclusion (core.ts:9554-9572).
- Explicit includes render solid dark-green (`uf-explicit-include`) and are *closed boundaries* (descendants untargetable until removed, contract lines 631-633). Hidden includes persist as dotted ghosts.

### Shift widening (parent selection)
`Shift+click`/`Shift+hover` climbs: clicked element if structured-group/toggleable boundary → nearest structured-group ancestor → nearest toggleable ancestor → broadest self-markable ancestor (chooseExcludeParentBoundaryTarget, marking-rules.ts:87-121; ladder built at core.ts:8963-9015). Guards: body-level page shells with ≥2 landmarks rejected (core.ts:8848-8888), descendants-only targets need ≥2 markable descendants (marking-rules.ts:73-85), root exclusions impossible (ancestor walk stops at body, core.ts:8980-8982).

### Space passthrough (page interaction mode)
Holding Space (outside editable fields) sets the latch: overlay becomes `pointer-events:none` and fades to `opacity:0.5` (core.ts:12252-12269); cursor unsets; toast "Page interaction mode" shows once (core.ts:9727-9738; text.ts:163). Clicks reach the page (open accordions/tabs/menus). While latched, Alt+click on a link is intercepted to navigate/open-in-new-tab explicitly (core.ts:9766-9798). Releasing Space (or blur/visibility change) restores the overlay and schedules a redraw over the page's new posture (core.ts:9745-9758).

### Temporarily-disabled (busy-locked) state
Brain-dictated (post-AI lock, save/sync reconciliation, machine preview/restoring states — core.ts:8041-8074, overlay-memory.ts:38-75). Overlay stays mounted with `.uf-marking-temporarily-disabled`: marks dim/desaturate, hover clears, cursor becomes progress, the top-center aria-live notice shows the reason copy, and any attempted click toasts either "Finish server sync before editing" (saving/syncing) or "Marking temporarily paused" (core.ts:9636-9649).

### Unsaved-changes guard
`beforeunload` prompts when the current page draft is dirty (core.ts:13081-13090).

---

## 6. The reveal/freeze ritual (page inspection)

**Contract**: exactly ONE reveal/freeze ritual per page visit; concurrent warmups JOIN the in-flight ritual (core.ts:7680-7700 with the architect note; join implementations 7702-7747 and 7757-7844). Page-visit dedupe key = `baseUrl|pageUrl` (`consumePageVisitRevealFreezeAttempt`, content-main.ts:2176-2189); keys reset on SPA navigation (content-main.ts:7496-7502).

What the user sees, in order (`revealPageContentBeforeMotionPause`, core.ts:5245-5336):
1. Consent chrome is hidden first (core.ts:5258, see §8).
2. `html.uf-page-inspection-active` cursor style + the overlay's dim tint + centered "Inspecting page... it will be ready soon" card with spinner; a capture-phase input blocker eats every mouse/key/touch/wheel event (core.ts:5354-5372; UI at `setPageInspectionUiActive` core.ts:7623-7646).
3. Smooth-scroll to top (if not already there), pause 1000 ms (`PAGE_INSPECTION_DEFAULT_PAUSE_MS`, core.ts:885).
4. Smooth-scroll toward the bottom in up to 10 passes (`PAGE_INSPECTION_DEFAULT_MAX_SCROLLS`, core.ts:884), 1000 ms dwell between passes; each scroll waits for `scrollend`/settle (tolerance 2 px, settle 220 ms, hard timeout 8 s — core.ts:888-890, 5006-5115).
5. At 50% of the initial scroll height, **lazy-load suppression** engages in the page world (`PAGE_INSPECTION_LAZY_LOAD_SUPPRESSION_SCROLL_RATIO = 0.5`, core.ts:886; engage 5284-5294): IntersectionObserver/ResizeObserver callbacks and scroll/wheel/touchmove listeners are gated off so at most ONE lazy expansion happens for the whole ritual (page-world wrappers armed at document_start by the MAIN-world bridge — page-motion-freeze-bridge.ts:1-25; gating logic page-motion-freeze-control.ts:318-470).
6. **The freeze engages at the absolute bottom** while the page rests fully revealed (`pauseAtBottom` hook — core.ts:5305-5315 and the contract comment 332-339), never after scrolling back.
7. Smooth-scroll back to the original scroll offset; the return leg happens *under* the freeze.
8. Marking enable path: overlay renders marks, then the input blocker/tint lifts only after the first render completes (`finishPageInspectionUiAfterRender`, core.ts:7925-7950, 3 s render-wait cap). Silent path: an extra 2000 ms settle (`SILENT_HIGHLIGHT_WARMUP_SETTLE_DELAY_MS`, core.ts:887, used 7813-7816), then a full-document motion re-sweep (core.ts:7827-7831).

The popup mirrors the ritual through REVEAL_FREEZE spinner phases ("Revealing lazy-loaded content" / "Scrolling page down" / "Scrolling page up" / "Freezing page motion" / …, spinner-contract.ts:248-307), all `PAGE_AND_POPUP` blocking with elapsed timers. While editor preparation runs, a blocking reconciliation reason `editor_preparing` is held so the user cannot interrupt (content-main.ts:2338-2340, 443; exempt from the marking-paused overlay brain-side, core.ts:8050-8056).

Triggers of the ritual: marking enable (`enableForBaseUrl` → `warmupPageRevealBeforeMotionPause`, core.ts:13060-13071), editor silent-highlight activation on candidate pages (content-main.ts:2258-2388), and the explicit render-mode inspection reveal (§10). Marking restore after reload deliberately does NOT re-run it (core.ts:13395-13398). Skips: hidden tab (core.ts:5255-5257) — the ritual still concludes with the freeze (core.ts:7740-7744, 7820-7824); no vertical scroll room (bottom check 5132-5144).

---

## 7. Page-motion pause (the freeze itself)

Held as a **reason set**; every pause also holds the sticky `page-visit` reason so subsystem resumes (marking disable, silent teardown, AI preview exit) never actually unfreeze the page — the ONLY release is navigation (`resumeAllPageMotion` wired to the URL notifier: core.ts:861-868, 6976-6992, 7039-7092, release point 11749-11768).

What freezes (refreshPageMotionPause, core.ts:7000-7021):
- **Stylesheet** `#unfluffify-page-motion-pause-style` sets on `html.uf-page-motion-paused body` and every non-extension descendant (+ ::before/::after): `animation-play-state: paused !important; transition-property: none !important; transition-duration: 0s; transition-delay: 0s; scroll-behavior: auto !important` (core.ts:5672-5689). Extension UI is carved out by the selector itself (`:not([data-uf-extension-ui="true"]) …`, core.ts:917-919).
- Web Animations paused via `document.getAnimations({subtree:true})` (core.ts:5934-5971); SVG animation clocks via `pauseAnimations()` (6784-6806); autoplay-ish media (`video/audio` with autoplay/loop/muted playing) paused (6822-6850).
- **Inline locks**: motion candidates (attribute/class descriptor regexes for carousel/slider/marquee/animation/parallax…, core.ts:920-924) get their computed `transform/translate/rotate/scale/offset-*/perspective/opacity/filter/backdrop-filter/clip-path` and non-static position edges locked as `!important` inline styles, capped at 800 elements (core.ts:928-951, 869-871, 6389-6650); locks tracked via `data-uf-motion-lock-id` and stripped from snapshots (6686-6711).
- **Reveal-normalization**: elements hidden only by entrance-animation styling (opacity<0.5, visibility, transforms, clip/filter) that match reveal descriptors (`aos|fade|reveal|wow|zoom|…` or Webflow `data-w-id`/`data-ix`, core.ts:921-923) are normalized to final visible posture instead of frozen pre-reveal; semantic hidden UI (modal/menu/tab/accordion/aria-hidden…) is excluded (core.ts:6532-6619).
- **Synthetic hover-pause**: pointerenter/mouseenter/mouseover dispatched once per motion candidate + up to 8 ancestor levels (≤500 targets) to park hover-pausing sliders; reversed on teardown (core.ts:6722-6771).
- **Page-world timer bridge**: `setTimeout`/`setInterval`/`requestAnimationFrame` callbacks in the page world are deferred while paused (recursive carousel loops stop), flushed on resume; the extension's own UI uses captured pre-bridge timers so it can never starve itself (freeze-control.ts:211-316; capture at core.ts:973-1067).
- Maintenance: a 250 ms timer + a MutationObserver drain incremental candidates (never a full re-sweep — the post-AI CPU-storm fix, core.ts:6319-6347, 6869-6962).

**Visible indicator**: while paused, a small fixed pill sits top-right (`top/right: max(10px, safe-area+10px)`), 48×30 px, `border-radius:7px`, `border:1px solid rgba(255,255,255,0.32)`, `background:rgba(17,24,39,0.78)`, blur(6px) backdrop, shadow `0 6px 18px rgba(15,23,42,0.22)`, showing two 18 px white glyphs from a content-injected Material Design Icons face ("Unfluffify Material Design Icons", woff2 at assets/materialdesignicons-webfont.woff2): **snowflake** (`\F0717`) + **code-tags** (`\F1C86`) (core.ts:5690-5731, font-face 4917-4931, ids/classes 848-859). `aria-label`/`title` = "Page motion paused" (core.ts:5758-5760). It is pointer-events:none and stripped from snapshots.

---

## 8. Consent chrome hiding

Runs on **every configured property page**, decoupled from candidacy/marking (durable contract note, content-main.ts:5604-5610), plus before every reveal (core.ts:5258) and on every childList mutation while marking observes (core.ts:11684-11686).

- Selectors: `REMOVABLE_ELEMENT_SELECTORS` — high-precision overlay/modal/cookie/consent/gdpr/interstitial/newsletter selectors, each guarded `:not(body):not(html)` (content/constants.ts:10-39).
- Hiding is **visual, not removal**: each matched root and every descendant gets `data-uf-consent-hidden="on"` plus inline `opacity:0 !important; visibility:hidden !important; pointer-events:none !important` (core.ts:2579-2604). Open `<dialog>` top-layer elements are `close()`d because CSS cannot dethrone the top layer (core.ts:2586-2593). DOM/XPaths stay intact so detection/submission still see the text (consent text submits under the hidden-textual rule; no consent XPath rows — contract lines 843-846).
- After hiding, page scrolling is repaired: `overflow(-x/-y) hidden|clip → auto`, `position:fixed → static`, `height → auto` on html/body (core.ts:11847-11883), and the `#uf-consent-bypass` style re-enables `pointer-events` on `[aria-hidden='true']` page content that consent frameworks disabled (core.ts:2555-2570).
- One pass per page URL on enable (`hideConsentOnEnable`, core.ts:11885-11891); silent stylesheet also enforces `html [data-uf-consent-hidden] { pointer-events:none !important; visibility:hidden !important; }` (content-main.ts:2123-2126).
- Consent subtrees are ignored by hit-testing, marking, and the silent layers everywhere (`isWithinConsentElement`, core.ts:2636-2653).

User-visible effect: cookie walls/newsletter modals vanish (invisible, non-interactive) the moment the extension engages on a property page, without the user clicking them; scroll locks they set are undone.

---

## 9. Silent highlighting (passive mode)

Runs whenever marking is off on a configured property page with stored selectors (directive-gated: `isSilentHighlightActiveByDirective`; page-prep reveal/freeze may run even without selectors, content-main.ts:2208-2225, 5563-5656).

### Overlay & layers
`#unfluffify-silent-highlight-overlay`: `position:fixed; inset:0; pointer-events:none; z-index: 2147483646` — one below the marking overlay, so silent overlays **never capture clicks** (users can use accordions freely; contract line 641-643) (content-main.ts:2086-2092, 453). Three layers in stacking order `immutable` < `content` < `excluded` (`SILENT_HIGHLIGHT_LAYER_KEYS`, content-main.ts:452; order enforced 2423-2436). Root marker attribute `data-uf-silent-highlightings="on"` on `<html>` while active (content-main.ts:2142-2148).

### Silent rect classes (content-main.ts:2101-2122)
| Class | Border | Background | Semantics |
|---|---|---|---|
| `uf-silent-rect` | — | — | base: absolute, border-box, radius 4px, pointer-events none |
| `uf-silent-content` | `2px dashed #44b532` (green) | `rgba(68,181,50,0.08)` | included content (implicit + explicit includes) |
| `uf-silent-content-ghost` (combined with content) | `1px dotted rgba(68,181,50,0.45)` | transparent | hidden explicit includes retained as ghosts (ghost set from hidden explicit-include sources, content-main.ts:2649-2652, 2741-2749) |
| `uf-silent-immutable` | `1px dashed rgba(156,107,107,0.45)` (subtle brick) | transparent | immutable default exclusions |
| `uf-silent-excluded` | `2px dashed #b03b3b` (red) | `rgba(176,59,59,0.08)` | excluded content (selector-excluded + inferred) |
| overlay class `uf-silent-hidden` | — | layers `opacity:0` | applied during scroll/rebuild so half-updated boxes never show (content-main.ts:2098-2100, 2456-2465) |

Rects: per client rect within the viewport with a bounding-rect fallback; only visible nodes draw (`collectSilentHighlightRects`, content-main.ts:2534-2583). Boxes reuse keyed nodes exactly like marking (drawSilentRectsForNode, 2683-2712); excluded nodes use per-occurrence keys so duplicate render targets survive (2750-2759).

### Tooltip annotations + click-to-copy
Every silent-highlighted node gets a rewritten `title` (original saved & restored): "Matched CSS selector: <sel>\nXPath: <xpath>" (multi-selector variant lists them) or just the XPath for implicit content (buildSilentHighlightTitle, content-main.ts:3022-3047; setSilentSelectorAnnotation 3049-3090; attrs `data-uf-silent-selector-include/-exclude`, `data-uf-silent-title-copy`). A plain left-click on any annotated node **copies that title to the clipboard** (handleSilentSelectorClickCopy, content-main.ts:3183-3205; wired only when marking is off, 7426-7434).

### Refresh / reposition choreography (anti-blink rules)
- Full refreshes hide → rebuild → reveal on a rAF once no reposition timers are pending (2467-2483); an already-live overlay updates **in place** (`keepVisible`) so periodic refreshes do not blink (2714-2729, 5522-5527).
- Scroll/resize: hide immediately, reposition after 120 ms debounce (2913-2955; scroll listener 7513-7534).
- DOM mutation / layout-shift (PerformanceObserver "layout-shift", 3437-3476): settle-sampled every 120 ms until 3 identical position signatures or 2600 ms max, then reposition **without hiding** (silent-highlight-rules.ts:1-2, content-main.ts:2872-2911).
- Full re-collection on structural mutations, debounced 300 ms with a 1200 ms min interval; attribute-only changes on tracked nodes take the cheap reposition path (3281-3435).
- While silent calc is heavy, both surfaces narrate "Calculating highlightings..." via a 300 ms-threshold spinner lease (content-main.ts:5619-5654, 743-803); the marking counterpart "Calculating markings..." engages immediately around the first full rebuild after enable (core.ts:12778-12795, content-main.ts:805-813).

### Editor activation & motion pause in silent mode
Property editors get the one-per-visit reveal/freeze before silent overlays draw (runEditorSilentHighlightingActivation, content-main.ts:2227-2388), holding "Inspecting page..." + `editor_preparing`. The silent motion pause is held whether or not selectors currently produce boxes (holdSilentMotionPause, content-main.ts:5365-5378, 5612-5618, 5629). The same frozen page posture keeps markings and silent highlights comparable (contract 427-443).

### Handover marking ⇄ silent
- Enable (popup `setEnabled` or Ctrl/Cmd+E): silent observer stopped, silent marks cleared, `data-uf-silent-highlightings` removed, then `enableForBaseUrl` runs (reveal→freeze→render) (content-main.ts:7118-7159; hotkey 2018-2078). If the visit is already frozen, the freeze is kept and reveal skipped (core.ts:13060-13063).
- Disable: `core.disable()` tears the marking overlay down, drops only the marking pause reason (page stays frozen under `page-visit`), then `refreshSilentHighlightings()` rebuilds the passive view (content-main.ts:7174-7187; core.disable at 12921-13019).
- Full teardown of marking chrome on disable: overlay + freeze-style removed, cursor classes cleared, ack timers cancelled, marked-element attributes stripped (removeOverlay, core.ts:7953-7993).

---

## 10. AI preview mode ("Preview Contents") — page-side UX

The list/sidebar itself lives in the popup; the page side provides focus + affordances:

- Entering preview (popup sends `aiPreviewShow`): marking is disabled (`beginAiPreviewMode` → `core.disable()`, content-main.ts:3581-3638) — marking overlays disappear; silent-style comparison rendering takes over via `refreshSilentHighlightings`. A hidden popover marker anchors the session (core.ts:13312-13325). Items hydrate async ("Preparing content list..." popup phase, spinner-contract.ts:228-236).
- Every preview item's element becomes **clickable**: `data-uf-ai-preview-clickable` + `cursor: pointer !important` on it and descendants (style content-main.ts:2127-2130; sync 1503-1524), and its `title` is rewritten to the selector/XPath explanation (1462-1482).
- Clicking a preview element (capture-phase, marking off): copies its title/XPath to the clipboard, focuses it, and notifies the popup (`aiPreviewFocusChanged`); clicking elsewhere clears focus (handleAiPreviewClick, content-main.ts:1570-1587).
- **Focus visuals** (from the popup list or a page click): the overlay `uf-focus` box — cyan 3px border, glow, 1 s blink (core.ts:8305-8330) — plus the element itself flashes with `uf-ai-preview-focus-target`: `background: rgb(255,255,0) !important; color: rgb(0,0,0) !important; border-radius:6px; scroll-margin:24vh` (core.ts:8363-8396), and `scrollIntoView({block:"center"})` (core.ts:8452-8466).
- Preview item categories: excluded / explicit_included / implicit_included / undetected (content-main.ts:663-672; category builder 1686-1763). Undetected = visible markable content the selectors missed (1654-1684).
- Preview is read-only (no drafts dirtied); marking edits are paused with the persistent notice (overlay-memory.ts:59-64: `preview` state → markingTemporarilyDisabled). Exit restores the previous mode (silent stays silent; a compute-lock preview restores marking, exitAiPreviewMode content-main.ts:3685-3820).
- **Compute lock** (AI run in flight): page-blocking curtain "Analyzing page content with AI..." (+popup note "This can take up to N minutes...", text.ts:218-221) with the real input block; auto-expires via `scheduleAiComputeLockRelease` (content-main.ts:3564-3579; overlay-memory.ts:49-58).

---

## 11. Render-mode inspection (JS-on / JS-off) — visible flow

Driven by the popup ("Inspect the page" step; popup copy text.ts:243-249). Page-side (render-mode-inspection-handlers.ts):
1. `begin`: flags the session (persisted in sessionStorage key `unfluffify:render-mode-inspection-active`, content-main.ts:444) and emits busy "Inspecting page..." (handlers:50-61). The popup reloads the tab (with or without JS).
2. After reload, `revealOnce` runs THE one reveal/freeze ritual for the visit (same visuals as §6: progress cursor, dim tint, centered spinner card, scroll walk, freeze at bottom) — handlers:63-153. Reveals are deduped per visit; a second inspection pass reports `skippedReveal`.
3. `captureHtml`: sanitized rendered snapshot + background-fetched static HTML captured *before* highlighting refresh (handlers:155-183; snapshot strips all extension chrome and un-does inline motion locks in the clone — core.ts:4813-4882, 6686-6711). Popup narrates "Comparing rendered and raw HTML..." (text.ts:225).
4. `end`: flag cleared, inspection UI released, property-lock banner mode `editor_inspection_reconnecting` refreshed (handlers:185-204).
- Self-healing: a 30 s watchdog force-clears a stuck inspection (popup closed mid-flow), emits FAILED, and restores the correct silent/editor posture so the page is never left frozen behind a dead flag (content-main.ts:444-451, 1847-1896).
- Entering the Render Mode view alone does NOT reveal/freeze while the render mode is unconfirmed (contract 445-453); marking cannot be enabled until render mode is confirmed (gate at content-main.ts:1962-1964).
- Render-mode inspection must not clear an existing session simulation choice (contract line 860-861).

---

## 12. Mobile emulation (legacy)

Legacy emulation is **viewport-only**, via the Chrome debugger (visible yellow "started debugging this browser" info-bar is a side effect):
- Presets (common/constants.ts:19-32): mobile = **412×960, deviceScaleFactor 1, mobile: true**; desktop = 1920×1080. Applied with `Emulation.setDeviceMetricsOverride` after `debugger.attach` v1.3 (emulation.ts:367-386).
- Page `scale` (zoom-to-fit) auto-computed as min(viewportW/presetW, viewportH/presetH), clamped 0.25–1; defaults mobile 0.85 / desktop 0.7 (constants.ts:14-17; emulation.ts:186-196) — the user sees a letterboxed phone-width page centered in the tab.
- Opening Unfluffify enables mobile simulation by default per fresh tab session; a user-disabled state persists for the session while marking is off, but the active marking editor tab forces mobile back on until marking is disabled (contract lines 853-858; `ensureDefaultMobileDeviceEmulation`, emulation.ts:443-462; reconcile 299-326 also falls back to mobile if DevTools detaches the debugger).
- Desktop-preview checkbox (popup) switches to the 1920×1080 preset, persists for the tab lifecycle, and disables marking entry while on (contract 859-863; feature-gated `desktopPreview`, emulation.ts:414-416).
- Hotkey Ctrl/Cmd+M (feature `deviceEmulationToggle`) toggles simulation from the page with toasts "Mobile simulation enabled." / "Simulation disabled." / "Unable to update simulation mode." (content-main.ts:1972-2016, 7404-7423).
- Submission visibility geometry is evaluated under the mobile viewport: below-the-fold counts visible (submission viewport treated as page-height) but content outside the mobile width is invisible-textual → excluded (contract 849-853; bounds at core.ts:1519-1531).
- **Legacy does NOT spoof identity**: `navigator.userAgent`/client hints remain desktop. (The rewrite added UA + client-hints spoofing — Pixel 7 / Android 13 derived from the browser's own Chrome version — in re-write commit 489649d8; noted here only as a comparison point.)

---

## 13. Page-visit lifecycle from the user's perspective

1. **Passive load on a non-property page**: nothing visible. Action icon = grey/default set.
2. **Passive load on a configured property page**: consent chrome silently vanishes and scrolling is repaired (§8; runs for any resolved property, content-main.ts:5604-5610). If the render mode is confirmed and the page is a Live Page candidate with the user as editor, the one-per-visit reveal/freeze ritual runs (progress cursor, dim tint, "Inspecting page..." card, scroll walk, freeze + snowflake pill). If stored selectors exist, the silent green/red/dashed overlays then appear, with tooltips and click-to-copy. If no selectors, the page just stays frozen with the pill.
3. **Activation (marking enable)** via popup or Ctrl/Cmd+E: silent overlays disappear; if the visit is not yet frozen, the ritual runs now; then the marking overlay mounts (exclude cursor, hover boxes, candy-striped immutables, green defaults, animated AI dashes, red/green explicit marks). Input is blocked until the first render lands ("Calculating markings..." on both surfaces for the initial rebuild).
4. **Editing**: hover → amber box; click → 160 ms pulse then red exclude (or first-click unmark of a default boundary); Alt-click → dark-green include; Shift widens; Space passes clicks through (overlay half-fades); Alt+click follows links in passthrough. Dirty page triggers a beforeunload prompt.
5. **AI run**: full-page dim curtain "Analyzing page content with AI..." with hard input block (fail-open ≤10 min); afterwards the preview comparison; marking edits stay paused ("Marking temporarily paused") until exit.
6. **Save**: "Saving page... marking paused" / "Save sync pending... marking paused" notices, dimmed marks, progress cursor; clicks toast "Finish server sync before editing".
7. **Deactivation**: overlay unmounts; page STAYS frozen (page-visit lock); silent overlays return.
8. **Any navigation (full or SPA)**: the URL notifier (history patch + popstate/hashchange, core.ts:11739-11795) releases the freeze — the only release point — disables marking, discards the unsaved draft (fresh-session contract), resets reveal keys, and the new page re-evaluates from step 1/2. Cross-property navigation while editor additionally starts the 30 s recoverable-session cooldown surfaced on the lock banner (contract 866-870; banner modes §14).

---

## 14. Property-lock banner (page-level collaboration UI)

Fixed full-width top banner `#unfluffify-lock-banner`, `z-index: 2147483645` (below both overlays): `padding:12px 16px; background:#fff3cd; border-bottom:1px solid #d39e00; color:#4d3900; font 14px Inter; box-shadow:0 4px 14px rgba(0,0,0,0.16)`; buttons `background:#f8b400; border:1px solid #bf8500; radius 4px; 12px/600; color:#2f2200`, hover `#e6a700`, disabled `opacity:.55; background:#f5d886; cursor:not-allowed` (property-lock-banner.ts:60-127). Modes (render switch 178-287): passive_locked ("X is editing…", Suggest-takeover button; same-user variant with Continue-editing-here / "…anyway" + unsaved-changes label), passive_expiry_countdown, passive_suggestion_pending/rejected, takeover_available, editor_disconnect_countdown, editor_inspection_reconnecting, editor_inactivity_warning (Continue button), editor_cross_property_countdown, editor_off_candidate_countdown, editor_takeover_suggestion (Accept/Reject), editor_transfer_countdown — countdowns tick 1 Hz (292-316). While a blocking banner shows, page interactions are intercepted capture-phase and answered with rate-limited toasts (≤1/1.2 s) — locked/disconnected/inactivity copy from `propertyLockText` (content-main.ts:5661-5724, listeners 7435-7440).

---

## 15. Badge / action icon

No badge text or color anywhere; feedback is the **icon set** per tab: active tab with tab-state `enabled` (or initial-state `active`) → `icons/active/icon16|32|48|128.png`, otherwise `icons/default/...` (`updateActionForTab`, utilities.ts:754-798). Background refreshes it on tab activation/updates, setTabState, AI-run transitions, and bulk tab sweeps (background.ts:1159, 3518, 3608, 3634, 4041, 4281; ai-run-orchestrator.ts:489).

---

## 16. Toast & notice copy catalog (page-side)

Marking-overlay toast (bottom, 1.8 s): "Default exclusions cannot be overridden" · "Element cannot be explicitly included" · "Page interaction mode" · "Finish server sync before editing" · "Marking temporarily paused" (text.ts:159-169; call sites core.ts:9313, 9586, 9736, 9309/9521, 9642-9646).
Page toast (top, 3 s default, silent-mode/hotkeys — page-toast.ts:43-101): "Set Base Page URL in the Unfluffify popup first." · "Finish server sync before editing" · "Unable to activate on this page" · "Mobile simulation enabled." · "Simulation disabled." · "Unable to update simulation mode." (content-main.ts:2008-2015, 2026, 2039, 2074) · property-lock blocked variants (5694-5713).
Persistent notices: "Inspecting page... it will be ready soon" (reveal), "Working... page controls are temporarily paused" (generic busy curtain), "Saving page... marking paused", "Save sync pending... marking paused", "Marking temporarily paused", "Analyzing page content with AI..." (compute lock), "Calculating markings..." / "Calculating highlightings..." (calc narration), popup-side reveal mirror "Preparing page content..." (text.ts:164-169, 218, 232; content-main.ts:751).

## 17. Hotkeys (page-side)

- Ctrl/Cmd+E — toggle marking (gated: base URL match, render mode confirmed, Live-Page candidate, property lock free) (content-main.ts:7395-7417, 1952-1970).
- Ctrl/Cmd+M — toggle mobile simulation (feature-gated) (7404-7423).
- Space (hold) — page-interaction passthrough; Alt (hold) — include mode; Shift (hold) — widen; all reset on blur/tab-hide (core.ts:9719-9763, 8278-8303).

## 18. Key timing constants (quick reference)

| Constant | Value | Ref |
|---|---|---|
| Toast visible (marking overlay) | 1800 ms | core.ts:8014-8018 |
| Page toast visible | 3000 ms | page-toast.ts:93-95 |
| Toggle ack animation / clear | 160 / 180 ms | core.ts:800-801 |
| Duplicate-toggle window | 320 ms | marking-rules.ts:132 |
| Scroll overlay-hide debounce | 250 ms | core.ts:799 |
| Deferred full render after toggle | 180 ms | core.ts:805 |
| Marking settle re-renders | 180 / 700 / 1800 ms | core.ts:807 |
| CP7b trailing reconcile | 1500 ms | core.ts:10846 |
| Reveal: max scrolls / dwell | 10 / 1000 ms | core.ts:884-885 |
| Reveal scroll-end timeout / settle / tolerance | 8000 / 220 ms / 2 px | core.ts:888-890 |
| Lazy-load suppression point | 50% of initial height | core.ts:886 |
| Silent warmup settle | 2000 ms | core.ts:887 |
| Silent reposition debounce / settle sample / stable / max | 120 / 120 ms / 3 samples / 2600 ms | content-main.ts:454-459 |
| Silent mutation refresh debounce / min interval | 300 / 1200 ms | content-main.ts:460-461 |
| Motion-pause maintenance tick | 250 ms | core.ts:869 |
| Motion locks / hover targets cap | 800 / 500 | core.ts:870-871 |
| Popup-busy watchdog default / max | 65 s / 10 min | core.ts:876-883 |
| Render-mode inspection watchdog | 30 s | content-main.ts:451 |
| Calc-narration threshold | 300 ms | content-main.ts:734 |
| Snapshot save delay (default / after toggle) | 1000 / 3500 ms | core.ts:802-803 |
| Cross-property editor cooldown | 30 s | contract line 866-869 / property-lock.ts constant |

## 19. Known fragile points relevant to a re-implementation (observed in this code)

- `uf-explicit-exclude-ghost` is styled but never drawn (hidden excludes go to the hard layer) — the class exists only as CSS (core.ts:7423-7426 vs 11367-11370).
- The silent overlay's hide→reveal cycle plus the settle sampler is the anti-blink mechanism; skipping `keepVisible` on in-place updates reproduces the historical 1 Hz blink (#1) (content-main.ts:2718-2729, 2814-2828).
- Explicit-include boxes must fall back to ghost rects when paint-reachability transiently rejects them, but ONLY for visible elements — otherwise a just-included element's green box drops while hover still works (core.ts:10252-10267).
- Reveal/freeze ownership: only the walk that engaged the lazy-load lock may release it; the freeze must engage at the walk's absolute bottom (core.ts:5305-5333, 7039-7051).
- The exclude cursor's CSS fallback must remain a neutral cursor (never `not-allowed`) (core.ts:7280-7286).
