# Contract & Invariant Register — Unfluffify (Verified)

**Status:** Authoritative spec for the big-bang rewrite. This is the "what must never regress" bible.

**Source of truth:** the verified decisions log (`decisions-log.md`, T1–T12), as amended by
[`study/qa-decisions-save-contract.md`](./study/qa-decisions-save-contract.md), which wins over
conflicting older rows in this register. Where this register cites the legacy docs
`MARKING_AND_HIGHLIGHTING_LOGIC.md` and `PROPERTY_LOCK.md`, the register's **CORRECTED** items override them.

**How to read this document**
- Every invariant is stated as a **testable rule** — a property a conformance test can assert.
- Each is tagged **CONFIRMED** (carried forward unchanged from the old behavior) or **CORRECTED** (the old behavior was wrong or superseded; the note says what changed).
- "Old code" = the pre-rewrite implementation, kept only as reference. No logic/contract is carried over wholesale; the contract below is the sole behavioral obligation.
- Cross-references: [architecture doc](./architecture.md), [remote-API contract](./remote-api.md), [plan.md](./plan.md), and [decisions log](./decisions-log.md) are sibling deliverables in `.reimplementation/`.

**Legend**
- **INV-n.m** — invariant id (domain n, item m).
- Tags: `[CONFIRMED]` / `[CORRECTED]`.

---

## 1. Domain model & vocabulary

| ID | Rule | Tag |
|----|------|-----|
| INV-1.1 | **Property identity is `(environmentKey, siteId)`.** The Hub obtains `siteId` from GraphQL `urlSearchInfo` using the client-selected registered environment and exact delegated JWT. The frontend never normalizes/longest-matches an observed origin to establish identity. | **CORRECTED** — stage is part of identity; the Hub now performs the GraphQL lookup. |
| INV-1.2 | **GraphQL owns canonical property facts; observed origins are informational.** `siteId` and canonical property/base-URL facts come from the authoritative GraphQL context. Scheme, credentials, host/`www`, port, and redirects do not determine page identity. Candidate pages use a GraphQL-derived relative `pageKey` (path + query + fragment). | **CORRECTED** — supersedes config-`/load` base-URL sourcing and full-URL page keys. |
| INV-1.3 | **One editor per property.** Exactly one client holds the editor role for a `siteId` at a time, enforced by a backend-coordinated lock (see §9). Everyone else is passive, even the same authenticated user in another tab. | CONFIRMED |
| INV-1.4 | **A page is a marking candidate only when the backend says so.** Live Page candidacy comes from backend candidate lists (`propertyPageTypes` / candidate feed) keyed by `siteId`; the frontend never invents candidacy. | CONFIRMED |
| INV-1.5 | **Vocabulary is inclusion-centric** (see §2). The domain speaks in *inclusions* (implicit/explicit) and *exceptions* (unified exclusions), plus a permanent *immutable* blanket list. The terms "implicit exclusion" and "default-exclusion layer as a source of truth" are retired. | **CORRECTED** — retired the implicit-exclusion vocabulary. |
| INV-1.6 | **Render mode** is a per-baseUrl backend-confirmed attribute with two values: `rendered` (JS-on capture) and `static` (JS-disabled capture). It gates what HTML is submitted (§5). | CONFIRMED |
| INV-1.7 | **Session working draft vs backend baseline.** The Hub is the source of truth for saved state. The background retains the complete validated `/load` corpus; a current marking-session draft is a separate overlay. Successful mutation responses replace the authoritative baseline atomically; failures preserve the last valid baseline. | **CORRECTED** — authority is background-owned, not popup-local. |

---

## 2. Element taxonomy + inclusion-centric exception model + wire schema

### 2.1 Taxonomy (tag lists are contract — see `src/common/constants.ts`)

| ID | Rule | Tag |
|----|------|-----|
| INV-2.1 | **Immutable excluded tags** = a permanent, DOM-independent blanket list: `IMG, INPUT, NOSCRIPT, SELECT, TITLE, STYLE, SCRIPT, TEMPLATE, IFRAME, VIDEO, SVG`. Elements matching these (and their descendants) are never included, never markable, never a per-element row. Matching is **case-insensitive on both sides** (`.toUpperCase()`), so foreign-namespace `<svg>` — whose `tagName` is lowercase `"svg"` — matches reliably. | CONFIRMED (`SVG` is a deliberate addition vs the deepest-historical list) |
| INV-2.2 | **Toggleable-default excluded tags** = `FOOTER, FORM, LABEL, NAV, HEADER, DIALOG, ASIDE, BUTTON`. These start excluded (as ordinary auto exceptions) but the user may toggle them. `BUTTON` is intentionally toggleable. | CONFIRMED |
| INV-2.3 | **`LINK` is not in any taxonomy.** A `<link>` is a void metadata element that can never be a marking target; listing it (even as immutable) is redundant and forbidden. | CONFIRMED |
| INV-2.4 | The immutable list and the toggleable list are disjoint; the immutable list is exactly `DEFAULT_EXCLUDED_TAG_SELECTORS \ DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS`. | CONFIRMED |

### 2.2 Inclusion-centric exception model

| ID | Rule | Tag |
|----|------|-----|
| INV-2.5 | **Only inclusions carry an implicit/explicit split.** *Implicit inclusion* = the computed content baseline (a visible, markable, direct-text element), never stored. *Explicit inclusion* = a user Alt-rescue, stored. | **CORRECTED** — the split is now exclusive to inclusions. |
| INV-2.6 | **There is no "implicit exclusion."** Every exclusion is one unified kind of **exception**: a per-element row carving a hole out of the inclusion baseline. | **CORRECTED** — removed the implicit-exclusion concept entirely. |
| INV-2.7 | **Exceptions have exactly two origins, both ordinary.** (a) user toggle; (b) automatic creation at the initial calculation or a branch recalculation, from the default taxonomy + CSS/AI selectors. Auto exceptions are **"not special"** — after creation they carry no rule, privilege, or priority over user exceptions, and are represented by the same wire row. | **CORRECTED** — old code re-applied selector/default rules on top of existing rows (the drift that caused the blank-element bug). Forbidden now. |
| INV-2.8 | **Seed once, then step aside.** The default-tag rules and CSS/AI selectors *seed* the initial exception rows and then no longer own their elements. Rendering, target resolution, and submission derive an element's state from its stored row, and MUST NOT re-match a selector or re-apply a default-tag rule on top of an element that already has a row. | **CORRECTED** — see INV-2.7. |
| INV-2.9 | **An un-excluded toggleable default renders as implicit content.** A stored `{excluded:false}` row for a toggleable-default boundary suppresses that boundary's own implicit marking but does **not** exclude descendants and is **not** a subtree include; the element renders/submits as ordinary implicit/included content **even if a selector or default rule would otherwise match it**. It must never render blank. | CONFIRMED (this is the exact behavior the blank-element bug violated) |
| INV-2.10 | **Immutable tags never become per-page rows.** They ride the payload as the separate `defaultExclusionSelectors` list; stale per-page immutable rows are suppressed before submission. | CONFIRMED |

### 2.3 Wire schema (AI submission snapshot)

| ID | Rule | Tag |
|----|------|-----|
| INV-2.11 | **Top-level payload** = `{ baseUrl, renderMode, defaultExclusionSelectors, pages[] }`, where `defaultExclusionSelectors` is exactly the immutable tag list (INV-2.1). | CONFIRMED (verified from `AiRunPayloadSnapshot`) |
| INV-2.12 | **Per-page** = `{ url, renderedHtml, rawHtml?, renderedXPaths[] }`. `renderedHtml` is always present; `rawHtml` is present **only when** `renderMode === 'static'`. | CONFIRMED |
| INV-2.13 | **Each XPath row** = `{ xpath, excluded: boolean, explicit?: boolean }`. `explicit` marks a user-authored (or user-rescued) row; auto rows omit or carry it per submission semantics (§5). This single row shape carries both includes (`excluded:false`) and excludes (`excluded:true`). | CONFIRMED |
| INV-2.14 | Include lists and selector-suppression overrides are **not** separate wire fields — they merge into `renderedXPaths` as `{excluded:false, explicit:true}` rows and are reconstructed locally on load. | CONFIRMED |

---

## 3. Marking-interaction FSM + target resolution

### 3.1 Mode FSM (single derivation authority)

| ID | Rule | Tag |
|----|------|-----|
| INV-3.1 | **Mode is a pure function of inputs** via one authority (`deriveMarkMode`). Precedence: **`disabled` > `passthrough`(Space) > `include`(Alt) > `exclude`(default)**. `getMarkModeFromEvent` reads `altKey` from the committing event so the mode is race-proof at click time. | CONFIRMED |
| INV-3.2 | **`disabled`** = not enabled, or no overlay, or temporarily busy-locked (AI run in flight, save/sync reconciliation pending). No target resolution or commits happen in `disabled`. | CONFIRMED |
| INV-3.3 | **`Shift` is not a mode.** It is an orthogonal breadth modifier resolved separately, active only outside include mode. | CONFIRMED |
| INV-3.4 | **Latches reset on** window blur, tab visibility change, and navigation — releasing Alt/Shift/Space. The machine holds no mode state beyond these latches; every event re-derives the mode. | CONFIRMED |

### 3.2 Target resolution

| ID | Rule | Tag |
|----|------|-----|
| INV-3.5 | **Self-markable predicate:** an element is self-markable iff `visible ∧ ¬immutable ∧ ¬chrome(extension/consent/doc-root) ∧ (owns-direct-text ∨ structural-boundary)`. "Direct text" = a text node owned by the element itself; a container with only descendant text yields to the descendant. | CONFIRMED |
| INV-3.6 | **Structural-boundary definition:** section / article / card-group / list / table / toggleable-default. It **rejects shallow generic page shells** — generic wrappers in roughly the first two levels under `body`, or wrappers with a broad viewport footprint / multiple page landmarks (header, main, footer, nav). | CONFIRMED |
| INV-3.7 | **Exclude drills.** A plain exclude click selects the *nearest self-markable* target and drills **past** already-excluded (non-default) ancestors, so the user can refine a broad exclusion by clicking deeper. | CONFIRMED |
| INV-3.8 | **Toggleable defaults don't steal descendant clicks.** Clicking a markable descendant inside a default-excluded FOOTER/HEADER/FORM/LABEL/NAV/DIALOG/ASIDE records that boundary as `{excluded:false}` and records the descendant as the explicit exclusion — on the *first* click. Clicking the boundary itself (no descendant wins) unmarks the boundary directly. | CONFIRMED |
| INV-3.9 | **Include reaches in.** Alt/include mode inspects descendants inside excluded parents, prefers explicit targets, and can promote an eligible mixed-direct-text ancestor (not only the deepest child). The chosen element is stored as an explicit include row. | CONFIRMED |
| INV-3.10 | **Include boundaries are closed.** Descendants under an active explicit include are not targetable until the include itself is removed. | CONFIRMED |
| INV-3.11 | **Include always submits included, even if hidden/nested.** An explicit include submits as an included row regardless of visibility or nesting depth. | CONFIRMED |
| INV-3.12 | **Include/exclude are mutually exclusive per element.** Adding an include removes overlapping exclude rows for that element/subtree; adding an exclude removes overlapping include rows (see §5 normalization). | CONFIRMED |
| INV-3.13 | **Space passthrough is the only path to hidden content.** Holding Space lets clicks pass to the page (open accordions/tabs/menus); once revealed, the content can be Alt-included. Space passthrough clicks never commit a mark. | CONFIRMED |
| INV-3.14 | **Closed boundary is reachable only in include mode.** Exclude mode never targets inside a closed include; only removing the include re-opens it. | CONFIRMED (companion to INV-3.10) |
| INV-3.15 | **O(1) hover.** Hover resolves a single hover rect per pointer position; it must not recollect the page or re-scan all candidates on hover. Paint-reachability for the hovered element is checked without a full pass. | CONFIRMED |
| INV-3.16 | **Hit path pierces pointer-events suppression and open shadow roots.** `elementsFromPoint` is extended to surface `pointer-events:none` descendants of the topmost hit whose rects contain the point (deepest-first), and to pierce open shadow roots, so hit-transparent header text and shadow content stay markable. | CONFIRMED |
| INV-3.17 | **Paint-reachability gate.** A target must be paint-reachable in the current viewport: responsive alternates that keep measurable boxes but are fully covered by another face/slide/overlay are not separate targets. A miss counts as *reachable* when the topmost page hit is an ancestor and the chain up is pointer-events-suppressed (transparency, not coverage); a genuine foreign overlay reads as covered. | CONFIRMED |

### 3.3 Shift climb rule

| ID | Rule | Tag |
|----|------|-----|
| INV-3.18 | **A grouping ancestor qualifies as a widen target iff it has ≥2 direct descendants that are themselves eligible widening targets** (each holding multiple textual markable content). The grouping ancestor owns no direct textual markable content itself. | **CORRECTED** — the old "full-width wrapper rejection" is **removed**; a qualifying grouping ancestor qualifies **regardless of width**. |
| INV-3.19 | **Shift climbs to the broadest qualifying group.** It ascends through successive qualifying grouping ancestors to the broadest that still groups ≥2 eligible targets, and **stops before the first non-qualifying ancestor / page shell** ("one level higher, not any shallower" — never ascend into shells). | **CORRECTED** — width no longer bounds the climb; qualification does. |
| INV-3.20 | **Ancestor ladder candidates must be self-markable, and the walk hard-stops at `body`/`documentElement`.** The broadest-markable rung only selects an ancestor with direct own text; generic wide wrapper divs (no direct text) are never ladder candidates. Root exclusions are impossible. | CONFIRMED |
| INV-3.21 | **Descendants-only widen targets need ≥2 markable descendants and face the page-shell rejection at any depth.** A wrapper around a single content piece is not a widen target (excluding the piece directly is equivalent and tighter). Semantic boundaries and direct-text elements keep their exemption. | CONFIRMED |

---

## 4. Branch-scoped, action-triggered re-derivation

| ID | Rule | Tag |
|----|------|-----|
| INV-4.1 | **Re-derivation runs only on two triggers:** (1) the **initial calculation** on activation, and (2) the **exact branch** the user just toggled, incorporating that toggle. There is **no global, periodic, or config-merge re-derivation**. | **CORRECTED** — the old global rebuild / config-merge re-derivation is forbidden. |
| INV-4.2 | **A mark's blast radius is branch-local.** An element's fate depends only on its own ancestry, never a sibling's mark. On a toggle of E, recompute only `subtree(E) ∪ ancestor-chain(E)` up to the nearest marked or structural ancestor (rooted at the *outermost flip-capable* ancestor — a toggleable-default or structured-group candidate — else E itself). Everything outside is provably unchanged and reused. | CONFIRMED |
| INV-4.3 | **The branch recompute is provably identical to a full rebuild of that branch.** The minimal canonical mark set is evaluated by one pure pass ("nearest-marked-ancestor decides each node") that drives both overlay classification and submission rows. | CONFIRMED |
| INV-4.4 | **Why the blank-element bug is structurally impossible:** because a user decision (a stored row) is never re-derived over — no pass re-applies a selector/default rule on top of an element that already has a row (INV-2.7/2.8), and no pass runs outside the two triggers (INV-4.1) — an un-excluded element can never be left neither-excluded-nor-content. It always resolves to its stored row or to implicit content. | **CORRECTED** — the old blank-element bug was an illegitimate global re-derivation; designed out here. |
| INV-4.5 | **No parity-audit machinery in the shipped product.** The old `incremental == full` corpus audit and settle-time reconcile backstop existed only to police a fragile splice; with branch-scoped derivation being the *definition* of correctness, they are removed. Ordinary test coverage suffices. | **CORRECTED** — removed the parity audit + trailing full reconcile. |

---

## 5. Submission

| ID | Rule | Tag |
|----|------|-----|
| INV-5.1 | **Submission = enumerated visible-text includes + shallow-boundary excludes.** Explicit includes always submit as included rows. Every stored excluded row submits as excluded **unless** explicitly included or suppressed by an already-submitted excluded ancestor. | CONFIRMED |
| INV-5.2 | **Shallow-boundary excludes.** A descendant under an already-submitted excluded ancestor is omitted unless it is an explicit include. Non-textual implicit nodes are omitted. | CONFIRMED |
| INV-5.3 | **Positional XPath.** XPaths are purely positional (`/tag[index]`, no id/class), computed **after** marking sync against the **same sanitized DOM** saved as `renderedHtml`. Extension UI, browser-automation roots, and other strip-time nodes never count as siblings when indexes are assigned. | CONFIRMED |
| INV-5.4 | **Document roots are never rows.** `/html[1]` and `/html[1]/body[1]` are never submitted. | CONFIRMED |
| INV-5.5 | **Mobile-width / page-height geometry.** Submission visibility uses mobile-simulation geometry: page-**height** counts (below-fold content is still *visible*), mobile-**width** clips (out-of-width content is *invisible*). Visible textual content → included row; visually invisible textual content → excluded row. | CONFIRMED |
| INV-5.6 | **CSS text clamp is not hiding → included.** Text fully present in the DOM but truncated downward by a vertical clamp (`overflow-y:hidden/clip` on an over-tall box, fixed `height`/`max-height`, or `-webkit-line-clamp`) with a non-empty visible preview submits as **included**. This applies only to downward truncation with a visible preview; horizontal/off-canvas/upward displacement and fully-collapsed zero-height boxes stay excluded. | CONFIRMED |
| INV-5.7 | **Genuine hiding → excluded/not-markable.** `display:none`, `visibility:hidden/collapse`, `opacity:0`, `hidden`, sr-only/clip-rect off-canvas, zero-area, and interaction-gated collapsed panels are not visible, not markable, not submitted (until revealed via Space). | CONFIRMED |
| INV-5.8 | **One shared user-visible definition** governs live `isVisible`, save-time `isVisibleForSubmission`, and silent-highlight retention. They must not diverge. | CONFIRMED |
| INV-5.9 | **Shadow flatten (Googlebot parity).** Open shadow roots are inlined into the sanitized clone as real elements at the front of the host (composed-tree order, recursing nested roots) — **no** `<template shadowrootmode>` wrapper. Inlining happens before strip/sanitize passes so inlined nodes are cleaned too. | CONFIRMED |
| INV-5.10 | **XPath continuity across shadow boundaries.** `getXPath`/`getSnapshotXPath` walk the composed tree; a light child of a shadow host is index-shifted past the host's preceding same-tag inlined shadow children, so shadow elements address like any other node and align with the captured HTML. Resolution back to elements walks the composed tree (shadow-first) when a capturable shadow root exists, and the native light-DOM path otherwise. | CONFIRMED |
| INV-5.11 | **Closed shadow roots are skipped from capture** and their host is treated as excluded/unmarkable/uncaptured — but rendered with a **distinct overlay style** (a new closed-shadow category, visually different from the immutable overlay) so the editor sees an unreachable region. | **CORRECTED** — old behavior silently skipped closed roots with no distinct affordance; a new overlay category is added. |
| INV-5.12 | **The extension's own shadow root is never captured** (`data-wxt-shadow-root` / `data-uf-extension-ui`); it is chrome, not content. | CONFIRMED |
| INV-5.13 | **Immutable exclusion via the tag list, not rows.** Immutable defaults and their descendants are excluded through `defaultExclusionSelectors`, not per-page rows; stale immutable rows are suppressed pre-submission. | CONFIRMED |
| INV-5.14 | **Consent UI is not stored/submitted as dedicated rows.** It is hidden before saving; any textual consent content is handled by the ordinary invisible-textual rule. | CONFIRMED |
| INV-5.15 | **The AI run corpus is the stored multi-page snapshot** for every marked page under the current property. The payload is built from saved `renderedHtml`, saved/backfilled `rawHtml`, and saved submission XPaths; the only allowed live overlay is refreshing the *current* page's stored snapshot immediately before building. | CONFIRMED |

---

## 6. Session lifecycle

| ID | Rule | Tag |
|----|------|-----|
| INV-6.1 | **Fresh-session seed.** Every enable re-seeds the page fresh from defaults + CSS/AI selectors (selector influence only when a selector set is present) and **discards any stale persisted draft**, so a freshly enabled page never starts dirty. The first render adopts that computed seed as the clean baseline. | CONFIRMED |
| INV-6.2 | **Dirty only on explicit toggle.** The session becomes dirty only when the user makes an explicit marking change; auto-seeding does not dirty it. | CONFIRMED |
| INV-6.3 | **AI-fresh-before-save gate.** After any marking change, Run AI must re-run before Save enables. Any post-AI edit drops back to dirty and re-requires a run. Marking cannot be disabled until Save or Discard. | CONFIRMED |
| INV-6.4 | **The AI-run gate is `sessionRequiresAiRun`, not a second fingerprint.** Save gating composes pending session changes + page-controls visibility + reconciliation state + `sessionRequiresAiRun`. The Run-AI fingerprint (`aiRunUpToDate`) only disables *Run AI* while the last output still matches the current include/exclude XPaths; CSS-selector-only edits don't change that fingerprint. | CONFIRMED |
| INV-6.5 | **Save = one-page partial upsert, full authoritative response.** The request structurally carries exactly the current page plus domain-wide selectors; it never uploads a page map or the full corpus. The Hub preserves absent pages and returns the complete snapshot, which atomically replaces the background baseline. Save clears the draft only after response adoption and lands in silent mode (`D-SAVE`). | **CORRECTED** — full corpus is for AI, not Save. |
| INV-6.6 | **Discard = clean computed baseline.** Discard throws away the session's uncommitted edits and returns to the **clean, freshly-computed baseline** — the same defaults + CSS/AI-selector seed a fresh enable produces, from the property config `/load`. It does **not** restore a prior saved user-markings draft. **Marking stays active and clean.** | **CORRECTED** — old Discard reloaded/reverted to a saved user-markings draft (and disabled marking); now it resets to the computed baseline and stays active. |
| INV-6.7 | **Navigation/reload disables marking.** Any navigation or reload — same page/property or not — disables marking; no unsaved-draft cache survives a disable. | CONFIRMED |
| INV-6.8 | **The background authoritative corpus is the UI source.** Todo, candidate badges, marked-page counts, and Lynx coverage are projections of the last validated full Hub snapshot plus the current session overlay where appropriate; popup memory is never authority. | **CORRECTED** |
| INV-6.9 | **Send-to-Lynx is silent-only and Hub-orchestrated.** It stays hidden/disabled/handler-guarded while marking is active. The Hub refreshes GraphQL, validates lock/feed/completeness/fingerprint, performs `updateScrapingConditions` with the delegated JWT, and advances the submitted fingerprint only on definitive success. | **CORRECTED** |
| INV-6.10 | **Preview Contents never dirties a draft.** Both entry points (silent Preview from stored selectors; marking-mode post-AI verification) open/close without creating or mutating page-marking drafts; exiting returns to the origin mode. | CONFIRMED |
| INV-6.11 | **Candidate loss/conflict suspends an active draft.** Preserve it visibly, disable writes, explain the reason, and poll Hub context every 15s while focused/non-idle or within the 10-minute recovery grace. Candidate return resumes the same session but never auto-replays Save. | **CORRECTED** |
| INV-6.12 | **Draft terminal events are explicit.** Successful save, discard, marking exit, navigation/reload, tab close, definitive property loss/change, or actual lock transfer destroys the draft. Temporary authority failures and a stale-but-untransferred lease do not. | **CORRECTED** |
| INV-6.13 | **Selector values are the semantic product.** Marking/candidate changes do not create a second calculation-basis fingerprint or automatically stale saved selectors. Only a normalized selector-value change updates `selectorsUpdatedAt`; only definitive Lynx success updates `submittedSelectorsFingerprint`. | **CORRECTED** |

---

## 7. Reveal/freeze ritual + activation gating + SPA force-reload

| ID | Rule | Tag |
|----|------|-----|
| INV-7.1 | **Exactly one reveal/freeze per page visit.** On editor activation: store scroll, force instant scroll behavior, sweep top→bottom to trigger scroll/intersection handlers (≤1 lazy expansion, lazy-suppression at 50% of initial height), freeze at absolute bottom, then restore original scroll under the freeze. The sweep is skipped when there's no vertical scroll room or activation goes stale. | CONFIRMED |
| INV-7.2 | **Activation gating.** Reveal/freeze and silent highlighting activate **only after real editor activation** — never on passive page-load. Reveal is a blocking preparation phase: while it runs, page interaction is blocked with the inspection spinner/overlay and a blocking `editor_preparing` reconciliation reason so setup can't be interrupted. | CONFIRMED |
| INV-7.3 | **Freeze scope is page content only.** Extension-owned UI (`#unfluffify-overlay`, indicators, popovers, injected bridge, `[id^="unfluffify-"]`, `[data-uf-extension-ui="true"]`) keeps its own animations/timers/overlay scheduling alive. | CONFIRMED |
| INV-7.4 | **Two-layer JS motion stabilization.** A page-world timer bridge holds page `setTimeout`/`setInterval`/`requestAnimationFrame` while paused (stopping recursive carousel loops); the content script uses extension-owned timer/rAF helpers so page-world gating never starves extension UI. Deferred timer/rAF callbacks are **flushed on resume, not lost**. | CONFIRMED |
| INV-7.5 | **Reveal normalization vs semantic hidden.** Layout-present elements hidden only by *motion styling* (low opacity, clip, visibility, transform, blur) or with entrance hooks (`data-w-id`/`data-ix`) are normalized to their final visible posture. Semantic hidden UI (modals, dialogs, menus, tabs, carousels, accordions, `aria-hidden`) stays hidden. | CONFIRMED |
| INV-7.6 | **Source-owned pause, shared across modes.** The pause is held independently by marking and silent-highlight lifecycles; the *same* freeze is active in both. It lifts fully only on navigation; per-subsystem resumes don't drop it while another source holds it. On full release, synthetic hover state, inline locks, paused media, SVG clocks, and Web Animations are restored. | CONFIRMED |
| INV-7.7 | **Freeze mechanics are stripped from saved snapshots.** The pause class, pause stylesheet, indicator, inline locks, reveal normalizations, and timer controls are removed from sanitized `renderedHtml` so saved HTML records page posture, not freeze mechanics. | CONFIRMED |
| INV-7.8 | **Silent overlays never capture page clicks** — the user can operate accordions directly in silent mode — while the same motion pause keeps markings and highlights comparable. | CONFIRMED |
| INV-7.9 | **SPA force-reload.** While the extension is **active on the page** (editor or silent-highlight), a non-navigating URL change (`pushState`/`replaceState`/`hashchange`) forces a full page reload so the standard reveal/freeze + fresh capture re-run for the new route. | **CORRECTED** — old code let SPA route changes proceed without a fresh capture; now forced-reload while active. |

---

## 8. Device emulation + render-mode inspection

| ID | Rule | Tag |
|----|------|-----|
| INV-8.1 | **Forced mobile emulation (submission viewport).** Fresh tab sessions enable mobile 412×960 by default (including when an open side panel moves to a new tab). A user-disabled state is preserved for that session while marking is off, but the active marking editor tab forces mobile back on until marking is disabled. | CONFIRMED |
| INV-8.2 | **Desktop preview is a distinct, feature-gated toggle.** Only when the property already has AI selectors: a desktop 1920×1080 preview checkbox that persists for the tab lifecycle, switches to desktop emulation, disables marking entry while on, and falls back to mobile if DevTools tears the debugger down. | CONFIRMED |
| INV-8.3 | **Scale is clamped 0.25..1** and reconciled on load. | CONFIRMED |
| INV-8.4 | **Emulation self-heals after nav / silent detach** and **must be active for Save.** If the debugger silently detaches after navigation, emulation is re-cleared/re-applied. | CONFIRMED |
| INV-8.5 | **Render-mode inspection owns its own reveal/freeze lifecycle.** It must not run editor-acquisition reveal/freeze while the base URL's render mode is unconfirmed. The explicit With/Without-JavaScript action is the only render-mode path that reveals/freezes. | CONFIRMED |
| INV-8.6 | **Render-mode capture sequence:** capture sanitized rendered HTML (JS on, after reveal, **before** highlighting) → reload JS-disabled via CDP → capture static/raw HTML (background `fetchStaticPageHtml`) → restore JS. The rendered capture uses the same extension-node stripping as saved snapshots. | CONFIRMED |
| INV-8.7 | **No-JS hold is tracked and always cleared** on end/nav/inactivity. During inspection the editor sees a *reconnecting-after-inspection* status that **suppresses the 70s connection-loss countdown** (see §9). | CONFIRMED |
| INV-8.8 | **Render-mode inspection must not clear an existing session simulation choice.** | CONFIRMED |

---

## 9. Property lock

### 9.1 Identity & ownership

| ID | Rule | Tag |
|----|------|-----|
| INV-9.1 | **Distinct editor session and fencing token.** Every tab/window/browser editor has an `editorSessionId`; the Hub issues a separate opaque `lockToken` for the `(environmentKey, siteId)` lease. Authentication identity is not editor-session identity. | **CORRECTED** |
| INV-9.2 | **Backend-rotated fencing.** Grant, transfer, and takeover rotate `lockToken`. Every mutation presents the current token; a stale token returns conflict and performs no mutation. The frontend never mints or collision-rotates lock authority. | **CORRECTED** |
| INV-9.3 | **Immediate claim on candidacy.** Landing on an eligible Live Page candidate queues the editor claim immediately for the tab session — it does **not** wait for marking to be enabled. | CONFIRMED |
| INV-9.4 | **First grantee is editor; all others are passive.** Every other client for the property shows the locked UI, even the same authenticated user in another tab. | CONFIRMED |
| INV-9.5 | **The Hub snapshot is authoritative; the draft is isolated.** Refreshes never overwrite a draft. Promotion/reacquisition loads and adopts the current full snapshot; explicit suspended-state polling may continue without making popup memory authoritative. | **CORRECTED** |

### 9.2 Timings (backend-authoritative)

| ID | Rule | Tag |
|----|------|-----|
| INV-9.6 | **Backend owns lease expiry + countdown deadlines**; the client mirrors/displays them from backend-provided state. The client does not invent timings. | **CORRECTED** — timings are now explicitly backend-authoritative; the client displays, never computes, deadlines. |
| INV-9.7 | **Heartbeat requires qualifying presence.** The backend owns the cadence/deadline. Renewal counts only when the property page is the visible selected tab in the focused browser window and the browser is not idle. Merely open hidden tabs/background windows cannot retain a lock. | **CORRECTED** |
| INV-9.8 | **Connection-loss: 70s** countdown ("editor role lost unless connection recovers"). Suppressed during render-mode inspection (INV-8.7). | CONFIRMED |
| INV-9.9 | **Off-candidate and suspended timing differ.** Existing same-property non-candidate deadlines remain backend-authoritative. Candidate-removal/feed-conflict suspension receives a 10-minute recovery grace after qualifying presence is lost, then the ordinary inactivity countdown begins. | **CORRECTED** |
| INV-9.10 | **Cross-property cooldown: 30s.** Navigating to a different property keeps the previous property's editor session recoverable for 30s (metadata: `siteId`, `baseUrl`, `clientId`, cooldown deadline). Returning within the window restores the same session; expiry releases the old property lock (by stored `siteId` + `clientId`). | CONFIRMED |
| INV-9.11 | **Port-disconnect dispose grace: 70s**, but tab close **bypasses** it — the background immediately sends `release_lock` for that tab's editor runtime and disposes the connection. | CONFIRMED |
| INV-9.12 | **Passive-observer release countdown: 60s.** In the last 60s before release, passive subscribers see a "property will be released for editing" countdown; if the editor recovers, the passive UI returns to the ordinary locked banner. | CONFIRMED |
| INV-9.13 | **Connectivity = WS state + independent HTTP reachability probes.** WebSocket state alone is not the sole network signal. | CONFIRMED |
| INV-9.14 | **Off-candidate countdown mirrors from tab-scoped initial state**, so reopening the popup during the warning still shows remaining time. | CONFIRMED |

### 9.3 Terminal vs transient, handoff/takeover

| ID | Rule | Tag |
|----|------|-----|
| INV-9.15 | **`Extension context invalidated` is terminal.** The old script instance stops reconnect work: clear reconnect timers, disconnect the port without notifying background, reset local lock UI, and wait for a fresh content-script instance — never retry Chrome APIs from the invalidated context. | CONFIRMED |
| INV-9.16 | **Ordinary port disconnects are transient.** Reset the local UI and schedule a reconnect so transient SW/WebSocket interruptions recover automatically. | CONFIRMED |
| INV-9.17 | **Same-user transfer.** Another editor session for the same authenticated user can choose `Continue here`. If the holder reports (or may have) unsaved work, show a destructive warning; confirmation transfers immediately, rotates the fence, and discards the previous session's draft with no recovery. | **CORRECTED** |
| INV-9.18 | **Takeover suggestion.** Passive subscribers see `Suggest to take over`; the editor sees the requester's name with accept/reject. Reject notifies the requester. Accept with unsaved changes prompts save-first-or-discard; saving must complete backend sync + reload reconciliation before the transfer is accepted. | CONFIRMED |
| INV-9.19 | **Transfer state shown to both parties** (`Editing is being transferred from User A to User B`); after transfer the new editor gets a confirming toast and the previous editor becomes passive and sees the new editor on the banner. | CONFIRMED |
| INV-9.20 | **Render-mode reload re-claim.** Render-mode inspection reloads are expected short reloads; after re-injection the popup explicitly re-claims the lock, then polls the snapshot until connected/inactive. | CONFIRMED |
| INV-9.21 | **Stale is not transferred.** The same `editorSessionId` may renew/reacquire a stale, untransferred lease and retain its draft. Actual transfer terminates and destroys the old session's work. | **CORRECTED** |
| INV-9.22 | **Unsaved status is metadata only.** Heartbeat reports `hasUnsavedWork` for dirty marking, unsaved post-AI, Ready-to-save, in-flight, or unknown-outcome save; it never sends draft content. Saved-but-unpublished selectors are not unsaved local work. | **CORRECTED** |
| INV-9.23 | **All mutations are idempotent and fenced.** Save, remove, reconciliation, publication acknowledgement, and transfer carry `operationId`, `editorSessionId`, `lockToken`, and expected revisions. Duplicate delivery returns the original result. | **CORRECTED** |

---

## 10. Authority, presentation, command integrity & page-world security

### 10.1 Reflex-arc authority

| ID | Rule | Tag |
|----|------|-----|
| INV-10.1 | **Brain is highest authority.** The brain observes (folds facts/sensations into a per-tab **state snapshot**), decides, and emits **discrete, sequenced, provenance-tagged, consumed-once** signals. It does not micro-orchestrate buttons/curtains/copy/timers/countdowns. | CONFIRMED |
| INV-10.2 | **Layers are autonomous organs.** Each layer (popup, content) runs a deterministic FSM with a predefined transition table and a **complete per-state presentation matrix** ("muscle memory"). Between signals an organ cannot move; it acts on brain signals and reports sensations back. | CONFIRMED |
| INV-10.3 | **Facts for the brain's eyes; signals drive organs.** The per-tab snapshot is the brain's own observation/deciding substrate; the cross-realm contract is the sequenced signals, not a shared bag of state. | CONFIRMED |
| INV-10.4 | **Consistency is a guarantee, not a shared core.** Popup and content always render from one consistent state and never independently derive-and-disagree on marking-enabled / curtain / gate — but this is achieved via the brain's signals, **not** a single shared orchestration core. No legacy local re-derivation; no dual PopupState/ViewState bags; one store per organ + derived selectors. | **CORRECTED** — removed dual state bags and local re-derivation as the consistency mechanism. |
| INV-10.5 | **Content is the source of truth for marking-enabled.** Popup reconciles its toggle/tab state to content's reported `markingEnabled` when available, without sending a redundant `setEnabled`. | CONFIRMED |
| INV-10.6 | **Temporary-disabled is brain-dictated.** The background view-projector composes the post-AI/preview lock (`post_ai`) and pending save reconciliation (`saving`/`syncing`) into a content directive (`markingEditsBlocked` + reason); content reflects the directive and never re-derives the block locally. `editor_preparing` is exempt and never raises the temporarily-disabled overlay. | CONFIRMED |

### 10.2 Presentation & command integrity

| ID | Rule | Tag |
|----|------|-----|
| INV-10.7 | **No flicker on transient churn.** UI changes only on genuine transitions, not on transient churn. | CONFIRMED |
| INV-10.8 | **Every block self-explains.** A blocked control carries a block reason (curtain narration / block reason); an **enabled** control carries an **empty** blocked-reason. | CONFIRMED |
| INV-10.9 | **Exactly one reply per command.** Every inbound command produces exactly one reply — success or structured failure — never dropped. | CONFIRMED |
| INV-10.10 | **Data-affecting content commands are gated** by: `baseUrl-match ∧ config-present ∧ lock-permits-marking ∧ ¬reconciliation-pending`, plus an activity ping on success. | CONFIRMED |
| INV-10.11 | **Idempotent-by-sequence messaging.** Cross-realm messages are idempotent by sequence so a lost MV3 wake can safely replay. MV3 suspension handling: keep-alive primary; fallback = persist durable facts (per-tab state, run records, backend lock identity) + rehydrate + re-derive volatile authority (spinner selection, leases, connection runtimes). | CONFIRMED |

### 10.3 Page-world security

| ID | Rule | Tag |
|----|------|-----|
| INV-10.12 | **Fixed page-world allow-list.** Page-world (MAIN) commands are exactly `ARM, SET_MOTION_PAUSED, SET_LAZY_LOADING_SUPPRESSED, DESTROY` — no others accepted. | CONFIRMED |
| INV-10.13 | **Nonce handshake.** Page-world commands sit behind a nonce handshake; the relay's replies must match the nonce **and** the originating command. | CONFIRMED |
| INV-10.14 | **One bus, page-world is a PAGE transport.** All realm-to-realm RPC + events go over one typed bus; the page-world relay is a PAGE transport that keeps the nonce + allow-list. The property-lock WebSocket stays a separate connection to the remote hub, but its bg↔popup state relay rides the bus. | CONFIRMED |

---

## Appendix A — Corrected-from-old-behavior index (quick regression map)

| Area | Old behavior (forbidden) | New rule |
|------|--------------------------|----------|
| Property identity | Frontend base-URL normalization / longest-match | `(environmentKey, siteId)` from Hub-delegated GraphQL; GraphQL-derived relative `pageKey`; observed origins informational (INV-1.1/1.2) |
| Exclusion model | "Implicit exclusion" + default/selector layer as ongoing authority | One unified exception kind; seed-then-step-aside (INV-2.6/2.7/2.8) |
| Blank element | Global/config-merge re-derivation re-caught un-excluded elements | Branch-scoped, action-triggered only; un-excluded → implicit content (INV-2.9, INV-4.1/4.4) |
| Parity audit | `incremental == full` corpus audit + trailing full reconcile | Removed; branch-scoped derivation is the definition of correct (INV-4.5) |
| Shift widening | Full-width wrapper rejection | Width-independent; qualifies on ≥2 eligible descendants; climb to broadest (INV-3.18/3.19) |
| Discard | Reverted to saved user-markings draft; disabled marking | Clean computed baseline; marking stays active (INV-6.6) |
| Lock identity | Frontend sessionStorage client-id + cloned-tab UUID rotation | Backend-issued + backend-rotated identity (INV-9.1/9.2) |
| Lock timings | Client-owned | Backend-authoritative; client mirrors (INV-9.6) |
| Closed shadow | Silently skipped, no affordance | Distinct closed-shadow overlay category (INV-5.11) |
| SPA nav | Route change without fresh capture | Force full reload while active (INV-7.9) |
| Presentation | Dual PopupState/ViewState bags + local re-derivation | One store per organ; brain signals guarantee consistency (INV-10.4) |

## Appendix B — Ownership & sourcing model

| Surface | Owner | Sourcing |
|---------|-------|----------|
| Config REST (`/load`, `/save`, `/remove`) | USER | 🟢 **OWNED — DESIGN TARGET**: the rewrite defines the ideal schema (unified `rows[]`, `baseUrl` attribute); the backend is adapted to match |
| Property-lock (WS/HTTP) | USER | 🟢 **OWNED — DESIGN TARGET**: backend-issued/rotated identity + backend-authoritative timers; backend adapted |
| AI (`/get_selectors`) | Separate team | 🟠 **LOCKED — CONFORM EXACTLY** to current code; no team dependency, no blocker |
| GraphQL (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`, `updateScrapingConditions`) | Separate team | 🟠 **LOCKED SCHEMA — HUB CALLER** with exact delegated JWT and registered environment; payload-first error classification |
| Accounts (`validate`, `login`) | Separate team | 🟠 **LOCKED — CONFORM EXACTLY** |

See [remote-API contract](./remote-api.md) for the designed target schemas (owned) and the locked schemas.
