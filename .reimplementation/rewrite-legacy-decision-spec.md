# Rewrite–Legacy Decision Specification

**Status:** Binding product and implementation specification

**Decision dates:** 2026-08-20; follow-up comparison resolved 2026-08-21;
marking/session/payload contract re-approved 2026-08-31

**Scope:** 104 resolved decision units: the original 91 (37 Intentional,
22 Unsure, and 32 Diverged) plus 13 findings from the post-implementation deep
comparison.

This document records the point-by-point rewrite-versus-legacy Q&A. It is the
latest authority for every difference listed here. It preserves the rewrite's
deliberate architecture while defining exactly where legacy behavior, styling,
performance work, and recovery logic must be restored.

## 1. Authority and interpretation

When documents conflict, use this order:

1. This specification.
2. `study/qa-decisions-save-contract.md` for details not changed here.
3. `contract-invariants.md`.
4. `MARKING_AND_HIGHLIGHTING_LOGIC.md` and `PROPERTY_LOCK.md`.
5. `decisions-log.md`, `parity-plan.md`, and the historical implementation plans.

The execution plan in `rewrite-legacy-execution-plan.md` controls delivery order,
not product semantics. Product semantics come from this document.

The terms **must**, **must not**, and **only** are normative. “Debug build” means
a build produced with `UNFLUFFIFY_DEBUG=1`; debug-only capability must be absent
or unreachable in a production build, not merely hidden with CSS.

### 1.1 2026-08-31 marking authority

The operator-approved contract in `MARKING_AND_HIGHLIGHTING_LOGIC.md` section
**Approved session, interaction, and submission authority** supersedes older
rows in this specification where they conflict. The operator's 2026-09-01
modifier correction is part of that authority. In particular: plain click
toggles the individual mutable state; Ctrl changes breadth; Alt owns explicit
inclusion and wins over Ctrl; Shift and Meta have no marking meaning; the custom context menu is removed; dirty is
monotonic after the first successful mutation; unsaved marking state exists only
inside the active session; hidden UI and payload decisions are separate; the AI
endpoint is stateless; and Save followed by authoritative Load is the only
backend/local adoption boundary.

## 2. Reconciled system rules

The following rules combine decisions that otherwise appear to overlap:

1. **Selector influence is one-shot.** Calculate the clean default baseline,
   then simulate ordinary user inclusion clicks for inclusion selectors and
   ordinary user exclusion clicks for exclusion selectors. Persist the results
   as normal explicit rows. Selector identity, provenance, precedence,
   suppression, and re-matching then disappear for that session.
2. **Defaults and selectors are no longer one mechanism.** Toggleable default
   posture is calculated at session start and may be re-evaluated only within
   the branch affected by a user toggle. It must never override an explicit
   include/exclude row. Selectors are never re-applied during that branch pass.
3. **One canonical evaluation owns output.** The same normalized row set and
   evaluation result drive marking overlays, silent highlights, preview, and
   submitted rows. Fast rendering may cache or splice this result but may not
   create a second marking truth.
4. **Pointer ownership depends on surface.** Active marking owns the pointer;
   holding Space temporarily releases it to the page. Silent highlighting and
   post-AI preview keep the underlying page frozen against actionable clicks,
   buttons, forms, menus, hover activation, and navigation, but permit page
   scrolling and extension highlight/preview interaction.
5. **Mobile is continuously enforced.** Every recognized managed tab stays in
   Googlebot Smartphone emulation. There is no manual device or scale control.
   The only desktop exception is the already-approved silent-only desktop
   preview.
6. **Shadow content follows retrievability, not mode labels.** Open roots and
   closed roots captured by early `attachShadow` instrumentation are flattened,
   preserved, markable, and captured. A genuinely inaccessible closed root is
   omitted by itself; its host and accessible light DOM remain ordinary content.
7. **Debug detail is structurally gated.** Raw diagnostics, expanded preview
   classifications, silent annotation/copy tools, traces, direct mode, bus
   inspection, and spinner/state tooling are debug-only. Production surfaces
   concise actionable status and toasts.
8. **Authoritative Loads are adopted; risky writes fail closed.** A structurally
   valid `/load` response is adopted even when an unexpected shrink lacks
   proof. That sets a prominent integrity-warning state. In combination with the
   fail-closed-write rule, later mutations remain blocked until a clean refresh
   or reconciliation proof clears the condition; dismissing the warning does not
   clear the integrity state.
9. **Navigation never traps the operator.** Known dirty-state and candidate
   confirmations remain mandatory. If navigation inspection itself fails, a
   bounded fallback releases the navigation after the applicable generic warning.
10. **Performance adaptations preserve semantics.** Serialized toggles,
    generation checks, branch splicing, frame-chunked intersection registration,
    observer coalescing, geometry sampling, root-level compositor fading, and
    render caches may improve latency, but stale work must be rejected and no
    optimization may alter include/exclude results. The first trusted viewport
    input may defer structural work until the stable repaint; wheel fallback may
    run only after a presentation boundary proves native scrolling did not move.
11. **Consent suppression is property-scoped, not candidate- or session-scoped.**
    Every recognized property page continuously suppresses ordinary consent UI
    without removing its DOM and closes native HTML dialogs through the extension.
    Marking state, candidacy, preview state, panel presence, Save, Discard, and
    same-property navigation do not release that suppression.
12. **Frozen surfaces own pointer targeting.** Silent highlighting and post-AI
    preview place a reversible transparent interaction shield above page content
    and below extension UI. The shield prevents CSS and JavaScript hover/click
    activation while preserving wheel/touch scrolling and extension interaction.
13. **Reload-spanning inspection is background-owned.** Render-mode inspection
    has a durable token and generation in the background. A replacement document
    adopts and paints the pending state before acknowledging it; only a matching
    terminal outcome may clear the inspection surface.
14. **Performance evidence measures the real browser path.** Pure evaluator
    benchmarks remain useful but may not be called toggle-to-paint evidence.
    Release evidence must cover DOM discovery, hit testing, geometry, overlay
    commit, browser paint, scrolling, stabilization, and silent/marking startup
    against preserved legacy behavior on deterministic fixtures.
15. **Marking sessions are ephemeral and dirty is monotonic.** A session starts
    fresh on enable, retains only explicit mutable decisions, becomes dirty on
    its first successful mutation, and stays dirty until successful Save or
    approved complete dismissal. No fingerprint can make it clean again.
16. **Visibility never rewrites an explicit decision.** Hidden targets do not
    paint or accept interaction. A prior explicit inclusion/exclusion survives
    and submits unchanged; an otherwise mutable hidden target contributes an
    effective explicit exclusion only to payload evaluation, never to session
    state.
17. **Immutable ancestry is absolute.** Immutable nodes and descendants cannot
    be marked and emit no individual XPath rows. AI receives the hardcoded
    immutable selectors separately.
18. **AI is a stateless whole-property calculation.** Every run supplies every
    candidate page and its applicable HTML/rows in one request and receives one
    domain-wide selector set. No property corpus, AI draft, or page state
    persists remotely. Any returned session id is only the ephemeral job handle
    needed to poll that run; it supplies no input or memory to a later run.
19. **Save then Load is the persistence boundary.** Save persists exactly the
    authorized current page plus the property-wide selectors. Only after that
    commit succeeds, a separate Load fetches the latest complete backend shape
    and complete-replaces local configuration. The Save response itself is not
    local authority, and no active-session row, suggestion, draft, or pre-Load
    snapshot is merged into or preserved beside a successful Load. Discard and
    abandoned/failed AI runs preserve nothing remotely.

## 3. Intentional differences — keep the rewrite decision

| ID | Binding outcome |
|---|---|
| I-01 | Keep the clean rewrite strategy. Session-start defaults are recalculated fresh; later default re-evaluation is limited to the user-affected branch. |
| I-02 | Preserve the modular, decomposed architecture and its explicit realm boundaries. Do not restore legacy god files. |
| I-03 | Keep the background reflex-arc/brain as the sole cross-realm decision authority. UI and content organs consume decisions and report facts; they do not independently birth the same decision. |
| I-04 | Keep one typed, enumerable bus for extension realm RPC/events, with one reply or structured failure for every request. |
| I-05 | Keep repository-backed durability, MV3 rehydration, idempotent replay, and explicit keepalive during active work. |
| I-06 | Author the page-world program in TypeScript, generate the injected JavaScript during the build, and enforce generated-source parity. Hand-maintained duplicate TS/JS implementations are forbidden. |
| I-07 | Keep property identity as `(environmentKey, siteId)`. Observed origins remain informational. |
| I-08 | Keep the canonical page key as relative `path + query + fragment`. |
| I-09 | Keep UnfluffifyHub as the sole backend authority and API façade for property state, delegated GraphQL context, mutations, locking, and publication. |
| I-10 | Keep the full property corpus in the background. Only the current page may be a live session overlay. Popup state is a projection, never authority. |
| I-11 | Keep Save structurally singular and partial: one current page plus property selectors, fenced and idempotent. Treat its response only as the commit outcome; a separate post-commit Load supplies the complete authoritative shape that replaces local configuration. |
| I-12 | Adopt otherwise valid authoritative responses even when shrink is not proven, but enter the prominent integrity-warning/write-block state defined in §2. |
| I-13 | Keep timestamps and revisions server-owned. Client clocks do not decide authority or conflict winners. |
| I-14 | Keep deterministic complete-feed reconciliation: missing keys delete, relabels preserve content, conflicting duplicate assignments block without mutation, and empty page types are non-actionable. |
| I-15 | Keep fencing tokens, expected revisions, and operation IDs on every mutation. Duplicate delivery returns the recorded outcome; stale fences mutate nothing. |
| I-16 | Keep the lock background-owned, presence-qualified, and independent of the side panel. Hidden, unselected, unfocused, or idle tabs do not renew it. |
| I-17 | Keep same-user transfer explicit, fenced, and destructive to the displaced draft. Never silently merge or transfer unsaved work. |
| I-18 | Keep publication Hub-owned. Only definitive GraphQL success advances the submitted fingerprint; ambiguous transport yields an explicit unknown outcome under the same idempotency key. |
| I-19 | Keep one canonical normalized marking-row model for defaults, selector-seeded decisions, and user decisions. |
| I-20 | Keep a single evaluation source and branch-scoped recomputation for toggles, subject to the selector/default separation in §2. |
| I-21 | Keep Ctrl widening independent of width. Qualification and page-shell boundaries, not viewport width alone, determine the broadest valid grouping ancestor. |
| I-22 | Discard resets the current page to a freshly calculated clean baseline; it does not restore a saved or cached draft. |
| I-23 | A canonical SPA page-key change terminates the old page session and starts a new one. |
| I-24 | Reload always terminates the current marking session and draft. |
| I-25 | Definitive configuration deletion returns the extension to explicit onboarding. Do not silently reconstruct or reuse deleted connection state. |
| I-26 | A background AI run may complete after the panel closes and remain locally resumable only inside that same active marking session. Its local continuation metadata and remote session id are temporary job-control state, not property persistence. Retire and generation-fence them on every terminal session edge. The AI endpoint retains no property corpus; never retain or auto-apply the result after dismissal or to a different/new session. |
| I-27 | Keep fail-closed writes and fail-open reads. Reads may use the last validated baseline with warnings; writes require current authority, fence, revisions, and integrity. |
| I-28 | Keep page blocking narrow and result-sensitive. Block only the interaction needed by the current operation/surface, and always provide an escape or recovery path. |
| I-29 | Keep the full live theme system and user customization. |
| I-30 | Keep lock, Todo, Send-to-Lynx, and other previously dark surfaces live in production when their state makes them applicable. |
| I-31 | Keep the explicit silent-only desktop-preview exception; it is not a general device simulator. |
| I-32 | Keep Googlebot Smartphone as the crawler emulation target, including viewport, UA/client hints, touch, and pointer media characteristics. |
| I-33 | Continuously force mobile emulation on every recognized managed tab; it must self-heal after navigation, debugger detach, or tab rebinding. |
| I-34 | Keep 15-second candidate-recovery polling only while presence/grace rules qualify the suspended editor. |
| I-35 | Keep the current reveal sequence, scroll-height growth detection, ten-pass cap, and restoration of the operator's original scroll position after freezing. |
| I-36 | Keep the rewrite's chosen colors, but use the legacy border grammar: thick, dashed, animated, and state-specific on both silent highlighting and marking UI. |
| I-37 | Extension-initiated candidate navigation uses an inline panel confirmation. Native `beforeunload` remains only for browser-, page-, or externally initiated navigation. |

## 4. Previously unsure differences — resolved product choices

| ID | Binding outcome |
|---|---|
| U-01 | Use a responsive hybrid side-panel layout: fill ordinary widths, cap unusually wide layouts, and allow list-heavy views additional width. |
| U-02 | Restore the shipped logo/wordmark and the legacy icon choice for equivalent actions. |
| U-03 | Restore the legacy kebab header navigation. |
| U-04 | Show the property URL as the primary context, the current relative page key beneath it, and at most one prioritized actionable notice. |
| U-05 | Raw technical diagnostics exist only in debug builds and automation APIs. Production shows actionable status without internals. |
| U-06 | Production uses concise toasts. A detailed Activity surface is debug/automation-only. |
| U-07 | Configuration keeps per-field Change/Cancel interactions, but validates and commits the complete connection profile atomically. |
| U-08 | Todo is adaptive: expand current and incomplete sections, collapse completed sections, and preserve manual per-property overrides. |
| U-09 | Production lock copy is curated and plain-language. Raw lock/operation details are debug-only. |
| U-10 | Prefer event-driven state updates with slower reconciliation polling as a fallback, never a competing authority. |
| U-11 | Keep the side panel bound to the tab that opened it until explicit rebind or reopen. Active-tab changes alone do not silently move its context. |
| U-12 | Restore overlay-owned pointer capture during marking. Holding Space temporarily releases pointer interaction to the page. |
| U-13 | Use `WeakMap` identity primarily. Temporary DOM IDs are allowed only for cross-realm/preview needs and must be removed deterministically. |
| U-14 | Implement an explicit, unit-tested toggleable-boundary predicate shared by target resolution and evaluation. |
| U-15 | Incrementally decompose the popup entrypoint into typed controllers; do not perform another big-bang UI rewrite. |
| U-16 | Store large transient HTML once and pass scoped references plus integrity hashes between layers. |
| U-17 | Do not restore manual device simulation or scale controls. Keep the fixed crawler profile plus the silent-only desktop preview. |
| U-18a | Restore **Empty cache for current domain** to the main configuration menu. Restore the macOS-style close button and bind it to **Unregister current tab**, with destructive confirmation and failure feedback. |
| U-18b | Do not restore automatic render-mode detection. Keep explicit manual comparison/confirmation. |
| U-18c | Do not restore client-side page-type assignment POST behavior. Page-type facts come from the authoritative feed. |
| U-18d | Keep production preview categories and colors simple. Preserve the expanded classification model internally and expose it only in debug builds. |
| U-18e | Restore the complete diagnostic toolkit only in debug builds: direct mode, trace controls, bus diagnostics, spinner/state inspection, and related tooling. |

## 5. Diverged behavior — required correction

| ID | Binding outcome |
|---|---|
| D-01 | Restore fresh session-start default calculation. During editing, re-evaluate default posture only in the branch affected by the user's toggle and never over an explicit row. |
| D-02 | Treat selector application as simulated user markings immediately after the clean baseline. Inclusion selectors create ordinary explicit includes; exclusion selectors create ordinary explicit excludes. Delete selector-origin suppression and all post-seed selector behavior. |
| D-03 | Preserve the semantic XPath of a collapsed wrapper, but draw its overlay using suitable visible-descendant geometry. Geometry fallback must not change marking identity. |
| D-04 | Flatten all retrievable shadow roots, including closed roots captured by early `attachShadow` instrumentation. Preserve and mark flattened content, host, and accessible light DOM. If a closed root is genuinely inaccessible, omit only that root. |
| D-05 | Strip every extension, consent-helper, and browser-automation artifact from rendered HTML, raw/static HTML, fingerprints, XPath sibling indexing, and every other captured representation. |
| D-06 | Serialize toggles; validate generation and fingerprint; reject stale results; and assert branch-splice invariants. Do not perform a routine full-document reconcile after every toggle. |
| D-07 | Treat Window, VisualViewport, root-resize, and scroll notifications as sources for one geometry transaction, not independent repaint authority. Fade stale viewport-fixed layers once, retain their nodes, coalesce the complete event train, then commit one geometry-only redraw after the pinned-legacy quiet window (120 ms silent scroll/resize, 250 ms marking scroll, 50 ms marking resize). A resize owns Chromium's induced scroll; same-signature observer duplicates cannot extend its deadline, while a genuinely changed viewport can. Retain the first presentation old value for 250 ms so responsive A→B→A churn is net-zero; compare inline-style endpoints as canonical property/value/priority declarations after restoring extension-owned motion locks through the capture ledger; and let geometry work walk only its measured corpus. Observer delivery must never restart a multi-frame full projection loop. |
| D-08 | Superseded 2026-08-31: the extension never intercepts `contextmenu`; native browser right-click is always preserved and the custom marking-actions menu is removed. |
| D-09 | Suppress duplicate physical-click delivery using pointer identity, timestamp, target, and mode while preserving intentional rapid distinct clicks. |
| D-10 | Invalid targets receive immediate non-blocking overlay feedback and a concise actionable production toast. Technical rejection details are debug-only. |
| D-11 | Space passthrough is complete press-and-hold behavior. It restores marking on release and safely recovers from blur, visibility changes, navigation, or missed `keyup`. |
| D-12 | Wire the temporarily-disabled overlay style to real suspension. Borders visibly dim and pause animation during passthrough/busy suspension, then immediately restore. |
| D-13 | Wire inspection-overlay state end to end. Entry, state changes, exit, navigation, reload, unregister, and failure all create/update/clean the right overlay deterministically. |
| D-14 | Restore silent-highlight annotations and explicit copy affordances in debug builds only. Copying never changes markings and gives brief success feedback. |
| D-15 | Size and position overlays from the actual document client area so scrollbar gutters, RTL placement, resize, and zoom cannot misalign them. |
| D-16 | Superseded by N-14 after the user's direct P20 accessibility decision. |
| D-17 | Restore mouse-based panel-to-page preview correspondence: hover emphasizes the matching highlight and click scrolls it into view. Page highlights remain non-editing in preview. |
| D-18 | Retain the full legacy preview classification model internally. Production maps it to simple categories/colors; debug exposes the complete classification. |
| D-19 | Silent/post-AI preview is a constrained frozen surface: permit scrolling and extension highlight/list interaction, but block page buttons, links, menus, forms, hover UI, and navigation. |
| D-20 | Defer visual reveal/freeze/inspection rituals while the document is hidden and coalesce them into one pending run for visibility restoration. Cleanup, lock maintenance, and background state continue. |
| D-21 | Concurrent callers join one single-flight ritual. A newer generation or stronger scope schedules at most one consolidated follow-up. |
| D-22 | Freeze CSS animation/transition, Web Animations, SVG SMIL, autoplay/playing media, and computed motion at the visible post-reveal state; restore only extension-changed state at lifecycle end. |
| D-23 | Normalize content hidden only by entrance/motion styling, including opacity, transform, clip, blur, and animated collapse. Preserve semantically hidden menus, tabs, dialogs, accordions, carousels, and application state. |
| D-24 | Maintain freeze for the entire applicable session: catch late motion/media, relevant style/class changes, hover activation, lifecycle restoration, and page-owned `requestIdleCallback` work. Extension scheduling remains live; all hooks restore on teardown. |
| D-25 | Navigation inspection has a bounded fail-open fallback. It never bypasses a known dirty-state block, explicit candidate confirmation, or received block decision; unknown dirty state receives a generic warning. |
| D-26 | Render-mode inspection has a watchdog that cancels stalled work, removes overlays/listeners/spinners, and returns to a retryable manual-comparison state without inferring a result. |
| D-27 | After candidate-navigation confirmation, cancel page-scoped work, remove overlays/freeze/hooks, discard only confirmed uncommitted state, preserve property authority/lock/panel binding, navigate the same tab, start a fresh session, and reapply mobile. Failed navigation restores a usable state and does not unregister the tab. |
| D-28 | Changing normalized GraphQL endpoint, environment, or backend identity invalidates the stored JWT atomically with the profile change. Authenticated requests remain disabled until a valid token for the new backend is obtained. |
| D-29 | Restore dynamic extension-action icons for a small state set: unregistered, connecting, active, locked, and error/attention. Plain-language panel status remains authoritative. |
| D-30 | Do not restore global keyboard shortcuts. Keep Ctrl as the exclusion-breadth modifier, Alt as the explicit-inclusion modifier with Alt-over-Ctrl precedence, press-and-hold Space passthrough, and Escape as a safety exit. Shift and Meta are inert for marking. Primary actions remain visible and pointer-driven. |
| D-31 | Add React panel recovery: error boundary, detached/corrupted root detection, UI-root recreation, and rehydration from background authority without page reload, lost session, or duplicate subscriptions. |
| D-32 | Connect scroll locking only to blocking panel operations and modal confirmations. Preserve panel scroll position and unlock on every terminal path. Never lock the inspected page's permitted preview/silent scrolling. |

## 6. Follow-up deep-comparison decisions

These decisions resolve the findings discovered after P11. They are equally
binding with the original 91 decisions. Where a row refines an earlier I/U/D
decision, this row is the more specific authority.

| ID | Binding outcome |
|---|---|
| N-01 | Sanitize consent-helper changes while serializing the live composed DOM, before removing their internal marker. Remove only extension-added consent properties and every `data-uf-*` artifact. Direct rendered capture, fingerprints, and AI submission must all receive the same clean representation without restoring or mutating the live consent UI for capture. |
| N-02 | Use a reversible transparent interaction shield in silent highlighting and post-AI preview. It sits above page content and below extension UI, prevents both CSS and JavaScript hover/click targeting, permits native wheel and touch scrolling, and is removed on every terminal path. Silent Preview retains the already-painted authoritative silent-selector layers; opening it must never clear and reconstruct them. Event interception alone is insufficient. |
| N-03 | Make render-mode inspection a durable, tokenized background-owned session. It survives reload and panel closure, is adopted by the new content document, waits for an acknowledgement that the inspection surface painted, and clears only for a matching success, failure, timeout, cancellation, navigation, unregister, or teardown outcome. |
| N-04 | Transport the complete internal preview model from the canonical evaluator: explicit-included, implicit-included, excluded, undetected, immutable, and closed-shadow. Production projects these to simple operator-facing included/excluded states; debug exposes the complete internal classification. No downstream layer may reconstruct information discarded by content. |
| N-05 | Initialize a marking or silent engine in one transaction and one composed-DOM bridge pass: calculate defaults, apply optional selectors as ordinary explicit user marks, build indexes, and render. Constructors, activation, and selector seeding must not perform redundant whole-document refreshes. |
| N-06 | Add deterministic real-browser rewrite-versus-legacy performance gates. Measure silent activation, marking activation, hover, physical click through committed and painted overlay, scroll repositioning, and post-mutation stabilization while asserting identical rows/classifications. The existing pure `evaluateBranch` comparison must be retained but named and scoped accurately. |
| N-07 | Add one context-sensitive transient-surface manager. Opening one menu closes competing menus; outside-click closes menus; Escape closes only the topmost dismissible surface and, when none exists, exits preview through normal restoration. Escape never saves, discards, disables marking, or cancels irreversible/busy work. |
| N-08 | Production toasts are replaceable and transient, with a visible manual close control. Success auto-dismisses after 1.8 seconds, warnings after 4 seconds, and danger/error after 6 seconds. Persistent conditions belong in notices, banners, or status surfaces rather than toasts. |
| N-09 | Production preview rows lead with concise extracted human-readable page text and simple included/excluded status. XPath, full classification, selector/technical detail, and diagnostic tooltips are debug-only. Interaction follows N-14. |
| N-10 | Retain force-open early closed-shadow instrumentation. A page that requests `mode: "closed"` may observe an open `shadowRoot`; this compatibility tradeoff is explicitly accepted to obtain direct, complete flattening, hit testing, geometry, marking, and capture. Generated MAIN-world source parity and artifact stripping remain mandatory. |
| N-11 | Continuously suppress consent UI on every recognized property page, including non-candidates and pages with no active editor. Ordinary consent elements remain in the DOM but are invisible and non-interactive; native HTML dialogs are closed by the extension so the underlying document can be used. Late-added consent UI is suppressed continuously. Save, Discard, preview, marking changes, and same-property page transitions never restore it. Explicit Unregister, property-configuration removal, leaving the property, or extension unload ends the guarantee. |
| N-12 | Make decision-to-test traceability executable. Every referenced automated-evidence path must exist; every decision must map to a decision-specific executable assertion or an explicitly named live/build acceptance check. Repair stale paths and add missing behavior tests rather than satisfying the gate with non-empty prose. |
| N-13 | After the behavioral corrections above are stable, incrementally extract typed configuration, render-inspection, preview, Todo, maintenance, consent, and transient-surface controllers plus focused React sections. Preserve authority boundaries and behavior; do not perform another big-bang rewrite. |
| N-14 | Each Preview row is a semantic button inside its list item. Pointer hover and keyboard focus share occurrence emphasis; native Enter/Space activation scrolls to the exact target; clicking a painted page target focuses its exact virtualized row; and the accessible name includes ordinal, readable label, and included/excluded status. While Preview is open, debug XPath rectangles route to that same page-to-row action instead of stealing the click for copy. This direct P20 decision supersedes D-16's earlier pointer-only rule. |
| N-15 | Superseded 2026-09-01: plain click toggles an individual implicit inclusion, explicit inclusion, or explicit exclusion. Ctrl changes breadth and may widen to an eligible ancestor; it is not required for an individual exclusion. Alt creates/toggles explicit inclusion and wins over Ctrl. Shift and Meta are completely inert, including over expanded exclusions. Expanded-boundary and descendant rehydration follow the locked marking document. |

## 7. Conformance definition

An implementation conforms only when all of the following are true:

- Every I/U/D/N row above has at least one automated contract assertion or a documented
  live-browser acceptance scenario; high-risk rows have both.
- Production and debug builds are separately tested for capability gating.
- Optimized marking output is byte-for-byte/structurally equivalent to the
  canonical evaluator for the same sanitized composed tree and row set.
- Captured HTML, XPath indexing, overlay targets, preview classifications, and
  AI submission all use the same artifact-free, shadow-flattened document model.
- MV3 worker restart, panel close/reopen, hidden-tab transitions, candidate-feed
  changes, lock loss/transfer, navigation, and reload have deterministic recovery.
- `pnpm verify` is green and the witnessed live-browser matrix in the execution
  plan passes on a production build before release.
