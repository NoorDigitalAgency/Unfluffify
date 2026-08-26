# Humanova marking, preview, and stabilization remediation

## Goal

Restore the latest legacy interaction contract for explicit/implicit markings, make Content List and silent preview immediate and genuinely two-way, and restore the legacy smooth reveal/freeze sequence without regressing P14–P20 lifecycle, payload, lock, or consent guarantees.

## Observed facts

- Humanova live-watch confirmed that activation and Run AI latency are fixed, but invisible exclusions can still draw raw fallback rectangles.
- Shift is the widening modifier in the latest legacy implementation. A plain click targets the nearest boundary and can remove that exact mark; Shift is required to create or manipulate a widened exclusion.
- Alt changes the cursor in the rewrite, but include resolution currently requires an excluded context. This prevents explicit inclusion of otherwise implicitly/default-included content and disables the equivalent context-menu action.
- Clear resolves only the point's nearest exact explicit node. It cannot find the explicit widened ancestor represented by the visible overlay.
- Content List opening waits for binding, signals, lock, and brain acknowledgement before requesting the local projection; open projections are then re-requested on the 500 ms lane.
- Popup-row to page activation exists. The reverse page-highlight to popup-row focus edge from the latest legacy implementation is absent.
- Silent scroll currently hides the retained overlay layer and waits 120 ms plus a repaint/reprojection path. Resize rebuilds silent projection geometry.
- The rewrite reveal uses instant scrolling and reaches the bottom before lazy-load suppression. Latest legacy smoothly scrolls to top, engages lazy suppression at the midpoint, continues through growth, freezes at the real bottom, and restores the starting position.
- Consent suppression remains intentional extraction hygiene. Suppressed nodes must remain absent from markings, preview rows, AI HTML, and payloads.

## Decisions

- Interpret “marking expansion” according to the latest legacy contract: Shift is mandatory for widened/ancestor exclusion; plain interaction remains the nearest-boundary toggle and can remove the exact mark. This preserves ordinary exclusion marking while preventing accidental expansion.
- Preserve invisible explicit exclusion state for extraction, but never render an exclusion overlay when its evaluated target is not user-visible. Explicit-inclusion ghost diagnostics remain unchanged.
- Allow Alt/context-menu explicit inclusion on eligible implicit/default-included content, not only inside an excluded ancestor.
- A plain click or Clear-one-mark action over a widened overlay resolves the owning explicit ancestor and removes only that mark.
- Content List opening uses the current local binding and selector snapshot first; authority refresh remains asynchronous and cannot block local projection/opening.
- Add a typed page-preview-focus event. Clicking a page highlight focuses and scrolls the matching popup row; row hover/focus and activation continue to emphasize/scroll the page.
- Retain silent overlay nodes through scrolling and resize. Geometry updates are frame-coalesced, do not clear the layer, and do not re-request the projection.
- Port the latest legacy smooth reveal order and settlement proof while retaining rewrite ownership fences, hidden-document deferral, single-flight execution, consent suppression, and persistent freeze.

## Non-goals

- No endpoint, public payload schema, permission, consent-selector, AI selector-generation, Save, or Lynx publication changes.
- No change to Space passthrough or the rule that ordinary page links/actions are inert while the extension owns interaction.
- No publication while required page coverage is incomplete.

## Execution phases

### H1 — Contract characterization and regression harnesses

- Update the durable marking/highlighting and execution-plan contracts with the Humanova findings and the decisions above.
- Add failing regression coverage for invisible exclusion rendering, Shift-only widening, nearest/exact unmarking, Alt inclusion of implicit content, widened-owner clear, immediate preview opening, both focus directions, retained silent geometry, and smooth midpoint-first lazy suppression.

### H2 — Marking resolution and rendering

- Remove raw-geometry fallback for invisible exclusion classifications.
- Separate target resolution for new nearest exclusion, widened exclusion, and removal of an existing explicit owning boundary.
- Expand include resolution to eligible implicit/default content and expose the same result in the context menu.
- Make Clear remove one resolved explicit owner, with branch repair and signal emission identical to other marking changes.

### H3 — Content List projection and two-way focus

- Open from a locally requested projection before authority reconciliation; use occurrence/generation fencing when the asynchronous authority lane catches up.
- Stop projecting every 500 ms. Refresh only on typed selector/marking/structural revision signals and explicit Refresh.
- Add the content-to-popup typed focus event and active-row state/scroll behavior; keep popup-to-content hover, keyboard focus, and activation intact.

### H4 — Silent overlay lifecycle and latency

- Keep retained silent boxes mounted during scroll and resize; update their transforms/rects in the next animation frame without opacity/removal gaps.
- Reuse the current projection and bridge indexes when opening silent Content List; structural mutations alone may advance the projection revision.
- Ensure scroll, visual viewport, and resize coalescing cannot retire preview occurrence identity.

### H5 — Legacy reveal/freeze parity

- Use smooth scroll with scroll/scrollend plus rAF dwell/timeout settlement.
- Sequence start -> midpoint -> lazy suppression acknowledgement -> growth-aware bottom -> persistent freeze -> smooth restore.
- Preserve hidden deferral, single-flight/generation ownership, consent suppression, motion freeze, and fail-open cleanup.

### H6 — Integration, performance, and headed acceptance

- Run focused tests after each phase, then `pnpm verify`, production/debug builds, and the P14–P20 performance/browser gates affected by marking, preview, and stabilization.
- Run a headed Humanova workflow with repository live-browser tooling and observer discipline. Verify no invisible exclusion overlay, Shift/Alt/unmark behavior, immediate Content List, both focus directions, persistent responsive silent highlights, smooth reveal/freeze, payload hygiene, consent exclusion, and console cleanliness.
- Update P20/Humanova evidence, review the final diff, commit, refresh the code graph, push, and refresh the graph again.

## Test matrix

| Contract | Unit/component | Integration | Headed acceptance |
| --- | --- | --- | --- |
| Invisible exclusions never draw | renderer/dom bridge | marking engine branch repaint | Humanova suppressed/menu nodes |
| Shift-only widening; exact unmark | resolve/store/interaction | content listener context menu | mouse + Shift workflow |
| Alt explicit inclusion | resolve/hover/context menu | typed marking signal | Alt hover/click and menu |
| Content List opens immediately | popup controller | popup/content bus | post-AI and silent modes |
| Two-way focus | row component + renderer hit target | typed focus event | row->page and page->row |
| Silent overlay retention | renderer/stabilizer | scroll/resize observers | scroll/resize without gaps |
| Reveal/freeze parity | reveal scheduler | activation lifecycle | visible smooth top/down/restore |
| Hygiene | evaluator/payload assertions | P14–P20 gates | consent + console inspection |

## Risks and controls

- Ancestor unmark resolution can remove the wrong row: require overlay-owner/exact-XPath proof and occurrence generation checks.
- Allowing implicit-content explicit include can create redundant selectors: canonical store normalization and evaluator tests remain authoritative.
- Page-to-popup focus can loop with row hover: focus events carry projection/row occurrence and popup adoption does not echo activation.
- Smooth scrolling can hang on hostile pages: bounded dwell/timeout, hidden deferral, and fail-open cleanup remain mandatory.
- Retained overlays can show stale geometry: coalesced rAF reposition plus structural revision refresh, never a remote poll, repairs them.

## Acceptance

- All ten Humanova findings have an automated regression and pass in a clean headed run.
- Marking activation/Run AI fixes remain passing.
- Consent-suppressed and extension UI remain excluded from extraction and payload artifacts.
- No unchecked message-port errors, stale preview occurrences, overlay gaps on scroll/resize, or overlapping fast/slow polling.
- `pnpm verify`, required builds, and affected P14–P20 gates pass before commit and push.
