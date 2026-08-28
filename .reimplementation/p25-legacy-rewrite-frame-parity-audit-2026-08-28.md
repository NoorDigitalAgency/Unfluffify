# P25 legacy/rewrite frame-parity audit — 2026-08-28

## Result

**Overall: FAIL.** The rewrite is not yet behaviorally or perceptually equivalent
to pinned legacy `28974c2a0c859c91a7167f4757cf84a47ea31e28`. The most important
failures are code-owned: freeze can acknowledge before it is complete; extension
freeze styles can enter captured HTML; marking hit testing can become
DOM-size-by-overlay-size work; exact widened-owner clearing has no reliable
painted-owner identity; scroll-time overlays drift or repaint too often; the
actual page scroll owner is not resolved; Content List construction and routing
scale with the full structural model; and several slow operator actions have no
immediate or authoritative UI lifecycle.

Consent suppression is a pass. DPJ cart, account, contact, assembly, country,
modal, and similar blocking UI is intentionally hidden and excluded from every
extraction surface. It is not a remediation target.

## Comparison method and evidence limits

- The live comparison used the repository `live-browser` launcher, its managed
  Chromium, the same `.wxt/browser-profile`, the same deterministic extension
  ID, and one implementation at a time. The only swapped input was the built
  extension directory. The legacy build used the pinned commit above.
- Legacy's old `/load` request lacks the rewrite environment key. A temporary
  extension-target-only compatibility shim supplied that key. It never attached
  to the website while the extension owned emulation.
- Page observers were detached for render inspection and device transitions.
  Earlier P24 runs that kept expensive page observation active produced several
  approximately 91-second activation measurements; those values are classified
  as measurement contamination and are not used as product latency evidence.
- Retained P14–P24 artifacts, live screenshots, computed overlay styles, network
  counts, popup states, and source-to-source traces were combined. Live sites can
  change between runs, so exact semantic counts are compared only when document
  posture and source identity match.
- The current working tree already contains uncommitted preliminary P25 changes.
  Findings below describe the current tree where stated and otherwise the last
  retained headed build. Every preliminary change must be reviewed and rerun;
  no existing green artifact certifies the dirty tree.
- Valid candidate pages are Ledigajobb, DPJ, Acne Specialisten, Acapedia,
  Assist24, Arno, ArkivIT, Teknikhallen, Humanova, and any currently valid Aleris
  candidate. The supplied 3D Prima page is a site-owned 404, Bigbag has no
  candidate, and Aleris currently serves a not-found body. Those are not content
  accuracy passes.
- No final selector publication was issued. Save and checklist fencing were
  exercised where authority permitted.

## Direct live frame evidence

### Same-profile Ledigajobb comparison

- A corrected clean legacy observation reached terminal marking UI in about
  38 seconds. The reveal never moved from `scrollY=0` on a roughly 6,953 px
  document, so the intended true-bottom ritual did not occur on this page.
- The matching rewrite activation did not reach a usable marking posture. The
  toggle returned to off and the lifecycle observer failed to terminate after
  more than 180 seconds. This is a bounded-cleanup/readiness failure, not a valid
  performance sample.
- The live legacy viewport contained 48 visible extension nodes: 22 hard-locked
  exclusions at `2px dashed rgba(225,70,70,.4)`, seven explicit exclusions at
  `3px solid`, six animated AI-content rectangles, one explicit inclusion at
  `3px solid`, ten ordered layers, and the motion indicator. All overlay
  rectangles had `pointer-events:none`.
- The retained rewrite Ledigajobb run exposed 1,690 canonical decision rows but
  only 39 marking overlays. Its three hover probes had a 212.8 ms median and a
  7,914.1 ms p95. The retained legacy screenshot set had a visible orange Shift
  target on the hero heading; the rewrite screenshot did not.
- The prior legacy harness reported zero overlays because it queried rewrite-only
  markers. The clean live count above supersedes that field. A common
  implementation-neutral cardinality probe is required before an exact target
  count can be accepted.

### Cross-property retained evidence

- Rewrite DPJ activated in 4.912 seconds with 1,043 decision rows and 144 visible
  marking overlays; 16 overlays failed the then-current visibility audit. After
  AI it rendered 1,042 disabled Content List rows, no interactive buttons, and a
  failed row-to-page route. Its local dirty projection took 7.465 seconds.
- Rewrite Ledigajobb AI took 127.437 seconds, returned 16 include and 35 exclude
  selectors, then exposed zero Content List rows. A second AI run failed because
  the page did not acknowledge AI start. Its payload hygiene checks passed.
- Rewrite Acne, Arno, and ArkivIT also exceeded the one-second post-edit UI
  freshness budget in retained runs. Humanova painted one exclusion from a
  visually absent source. Teknikhallen previously failed the mobile emulation
  transition.
- On the latest clean P14 artifact, rewrite large-page marking activation was
  32% slower than legacy, marking scroll 50% slower, marking mutation 29% slower,
  and silent activation 44% slower. The artifact predates the current exclusion
  owner scan, so it is a lower bound, not current acceptance evidence.
- Rewrite Content List opening was generally tens of milliseconds versus a few
  milliseconds in legacy, and a later Ledigajobb projection with 1,159 rows took
  about 15.6 seconds. Rewrite AI spinner feedback itself appeared faster than
  legacy in retained runs; the remaining spinner defects concern phase truth,
  cleanup, and action feedback rather than initial AI-click paint alone.

## Confirmed defect register

Severity describes the remediation order, not whether a legacy mechanism must
be copied literally. A rewrite-native implementation is preferred when it
preserves the stronger architecture.

### A. Render inspection, reveal, freeze, and lazy loading

1. **P0 — freeze acknowledgement races initial discovery.** Legacy completes its
   first motion/media/SVG/style discovery before returning. Rewrite
   `installMotionFreeze()` schedules full discovery roughly 250 ms later but can
   acknowledge `SET_MOTION_PAUSED` immediately. Capture, return scrolling, row
   counts, and overlay paint can start against a partially moving page.
2. **P0 — freeze-authored inline values leak into captured HTML.** Legacy keeps a
   property ledger and restores authored values in the capture clone. Rewrite
   remembers values only in page-world memory while `captureFlattenedHtml()`
   serializes the mutated `style` attribute. Freeze-only opacity, transform,
   filter, transition, and empty-style changes can enter AI HTML.
3. **P0 — hash-only and same-URL history events still tear down content state.**
   Background inspection identity correctly ignores fragments, but content URL
   handling, inspection reconciliation, and the SPA guard compare exact hrefs.
   A fragment or same-document `replaceState` can reset freeze/marking or reload.
4. **P0 — the page-inspection curtain is not a complete input firewall.** It owns
   a pointer surface but does not capture-block every page mouse, pointer,
   keyboard, form, drag, touch, and wheel path as legacy did. Focused inputs,
   global listeners, top-layer UI, or default scroll can race the ritual.
5. **P0 — lost page-world replies can wedge an invisible posture.** If ARM,
   lazy-suppression, freeze, or DESTROY applies and the reply is lost, isolated
   and page worlds can disagree about the nonce. Cleanup is not acknowledged,
   later ARM can be permanently rejected, and a frozen or armed page can remain.
6. **P0 — true-bottom logic assumes the window/root scroll owner.** Height,
   midpoint, bottom proof, restore, and shield wheel fallback do not resolve an
   actual nested viewport owner. Ledigajobb stays at the top and the ritual gets
   stuck. Pinned legacy is also root-only, so this is a shared limitation against
   the intended legacy experience rather than a source-level regression.
7. **P1 — no-scroll preparation does not retain lazy suppression.** The rewrite
   no-scroll branch freezes motion without necessarily keeping
   `lazySuppressed:true`, allowing later intersection/resize expansion.
8. **P1 — extension lazy hydration is early, broad, and unledgered.** It runs
   before suppression acknowledgement, mutates any `[data-src]` element, forces
   eager loading, removes site classes, can execute/load unintended iframe or
   script-like resources, and leaves mutations in the captured DOM.
9. **P1 — extension-owned animation can be frozen.** Initial WAAPI discovery,
   patched animation/media play paths, and batch processing do not consistently
   exclude extension UI before pausing. Spinner, focus, and dash animation can
   stop with page motion.
10. **P1 — SVG/root/pseudo motion restoration is not lossless.** Rewrite resumes
    every discovered SVG even when it was authored paused; root and pseudo motion
    can escape the descendant CSS lock until later discovery.
11. **P1 — the 250 ms stage settle has no equivalent stability proof.** Legacy's
    longer stage and final warmup waits are mechanical but stable. Rewrite is
    faster only nominally; rects, scroll height, resources, and rows are not
    proven quiet before release.
12. **P1 — stalled-scroll fallback visibly teleports.** After 650 ms rewrite
    writes root/body `scrollTop` directly. This produces the mechanical jump the
    user observed and still does not help a non-root owner.
13. **P2 — timer and listener instrumentation is installed too broadly.** Timer
    bridges start at module boot in every frame and listener interception patches
    all `EventTarget`s. Legacy deferred timer wrapping until actual freeze.
14. **P2 — motion indicator presentation drifts.** Gap, top padding, ARIA role,
    and hostile-page-style resistance differ from the legacy 48×30 indicator.
15. **P2 — render-mode UI allows meaningless transitions and reverses the
    comparison order.** Both modes remain available; same-mode reload is not
    disabled; no-JS/JS order differs from the intended ritual.

### B. Marking targets, expansion, inclusion, hit testing, and overlays

16. **P0 — hit testing performs full composed-DOM traversal.**
    `getComposedHitElements()` collects pointer-suppressed descendants before
    geometry pruning, including BODY/HTML. Renderer paint proof repeats the call
    at five points per rectangle. Complexity approaches
    `rectangles × document-size` on real pages.
17. **P0 — plain-unmark scans every exclusion owner twice.** The current dirty
    engine enumerates explicit owners and then all owners, performing ancestor
    style and geometry work per owner for ordinary hover/click. Latency grows
    with unrelated mark count.
18. **P0 — exact widened-owner clearing has no dependable painted-owner key.**
    Overlays are pointer-transparent, so target-derived overlay XPath normally
    resolves only the full-screen root. The geometric fallback uses one bounding
    box: fragmented inline gaps count as hits and overlaps can clear the deepest
    XPath instead of the visually top owner.
19. **P0 — hidden-exclusion paint has bypasses and contradictory visibility
    rules.** Immutable/closed-shadow branches can retain raw geometry after paint
    proof fails. The evaluator can accept painted `aria-hidden` content while the
    renderer rejects it solely from metadata. Canonical exclusion must remain;
    its overlay must not.
20. **P0 — visibility mixes viewport and document coordinates.** A bridge built
    while scrolled passes viewport-relative top with document scroll height,
    allowing unchanged above-viewport content to change classification.
21. **P0 — the markable/Shift target universe differs from the correct legacy
    contract.** Descendant-only structural containers can become self-markable;
    shallow generic wrappers are over-classified as page shells; mixed groups
    can qualify after an ineligible textual sibling is discarded. Existing tests
    lock some of the contradictory behavior.
22. **P0 — silent cardinality is inflated.** Every included structural row and
    every descendant exception is painted. Marking has ancestor-exception
    suppression, silent mode does not. A single excluded ancestor can therefore
    produce many red descendants.
23. **P1 — scroll leaves stale marking classifications visible.** Legacy fades
    all layers, redraws after 250 ms idle, then reveals after paint. Rewrite hides
    only hover/interaction layers and can reveal before reposition commits.
24. **P1 — silent scroll does O(all-target) proof/repaint work on continuous
    frames.** Stable node identity is useful, but coordinates must not be recomputed
    and paint-proved for the whole projection on every scroll event.
25. **P1 — large Shift work blocks its acknowledgement frame.** Canonical branch
    evaluation happens synchronously before only the render is deferred. Legacy
    acknowledged first and queued the mutation.
26. **P1 — hover cache misses ordinary within-target movement.** It reuses only
    identical coordinates or a normally unavailable overlay XPath. Legacy cached
    target bounds, hit stack, modifiers, and render generation.
27. **P1 — Content List emphasis uses ordinary hover presentation.** The declared
    cyan focus layer is unused; preview focus calls yellow hover. Source focus and
    occurrence focus are not a distinct, stable presentation.
28. **P1 — state provenance and layer routing do not reproduce legacy visuals.**
    Semantic decisions may remain canonical explicit rows, but AI/saved/focus
    presentation is not projected through the corresponding layers. The clean
    legacy frame visibly animates AI-content dashes while rewrite screenshots
    collapse more states into solid classification boxes.
29. **P2 — collapsed/display-contents fallback is shallower and less textual.**
    Rewrite stops at 64 nodes/depth eight and accepts the first measurable depth;
    legacy searched up to 200 and required a visible textual descendant.
30. **P2 — cursor preloads are not retained.** Short-lived `Image` references can
    permit a fallback-cursor flash during first modifier interaction.
31. **P2 — current parity harness cannot compare markable cardinality exactly.**
    Previous legacy overlay selectors were rewrite-specific and reported zero.
    The next gate needs implementation-neutral source, rect, visible-layer, and
    physical-hit counts at the same document/viewport generation.

### C. Content List, AI, Save, and popup workflow

32. **P0 — disabling marking can discard unsaved post-AI selectors without
    confirmation.** AI success clears `contentDirty`, but disable confirmation
    checks only that flag. Legacy fenced any pending selector session until Save.
33. **P1 — successful AI does not open Content List.** Rewrite declares Preview
    an operator action. Legacy held the operation through terminal selector
    adoption and automatically opened Preview.
34. **P1 — Content List has no immediate pending state and can flash a false
    empty result.** Full projection work happens before busy paint, and null and
    empty both render “No content detected.”
35. **P1 — Content List work scales with the entire structural model.** Expanded
    technical rows are rendered synchronously without virtualization. DPJ showed
    1,042 disabled rows; Ledigajobb showed zero in one run and later took about
    15.6 seconds for 1,159 rows.
36. **P1 — unchanged 500 ms signal ticks still rerender open Preview.** Focus and
    routing also trigger root React work, full linear lookup, and full row DOM
    queries. Page-to-row and row-to-page are not O(1) occurrence operations.
37. **P1 — Save has no click-time progress for its longest preflight.** It waits
    polls/context/signals/lock/load/gates/capture before reconciliation busy UI.
38. **P1 — Discard lost confirmation, immediate spinner, and success toast.** It
    can begin authoritative work with no operator acknowledgement.
39. **P1 — disable and candidate navigation lack truthful immediate progress.**
    Duplicate input can appear accepted while the slow operation is unresolved.
40. **P1 — render-mode Set is not authoritative on existing properties.** Local
    UI exits while background persistence can refuse; rejection is activity-only
    and the mode can revert on reopen.
41. **P1 — toast anchoring is wrong on long popup content.** A sticky toast
    rendered after the list can be outside the viewport; legacy fixed it to the
    popup viewport.
42. **P1 — spinner phases are collapsed or expose internal tokens.** Capture,
    payload, XPath, remote wait, Preview opening, and synchronization are not
    truthful distinct phases; countdown begins before the remote wait.
43. **P1 — several operator aborts are silent or console-only.** Missing tab,
    Preview, discard, render inspection, candidate construction, and render-mode
    persistence can end without a visible reason.
44. **P2 — clean candidate navigation over-confirms.** Rewrite always warns about
    unsaved markings; legacy prompts only for a pending session.
45. **P2 — marking action hierarchy and copy drift.** Run AI, Save, Discard, and
    disabled Content List share one row instead of the staged legacy hierarchy.
46. **P2 — Todo interaction parity is incomplete.** Root collapse, Expand all,
    Collapse all, Auto-collapse, and retained per-property/tab state are missing.
47. **P2 — popup shortcuts are missing.** Legacy Ctrl/Cmd+E, S, and M action
    shortcuts are not implemented through the current gates.
48. **P2 — checklist checking traps Cancel/Escape and mislabels publication.**
    Checking and publishing are treated as one locked phase even though only the
    mutation must be non-cancellable.
49. **P2 — successful login clears the remembered email.** Legacy cleared only
    the password.

### D. Previously observed live closure items

50. **P0 — emulation/session transition can fail or restore stale geometry.**
    Teknikhallen failed mobile activation, and silent overlays previously retained
    mobile XPaths after desktop transition. Preliminary uncommitted fixes require
    clean headed validation.
51. **P0 — local dirty projection misses the one-second contract.** DPJ was
    7.465 seconds; Acne, Arno, and ArkivIT also failed in retained evidence.
52. **P0 — terminal projection identity can be empty or wholly unusable.**
    Ledigajobb returned selectors but zero rows; DPJ returned 1,042 disabled rows.
53. **P1 — second-run/page acknowledgement cleanup is unreliable.** Ledigajobb's
    second AI start timed out even after the first run terminalized.
54. **P1 — blocked-page ownership and retained scrolling need a single contract.**
    Silent/post-AI shielding is intentional, but page clicks must be blocked while
    the resolved viewport scroll owner, wheel, touch, and extension controls stay
    responsive.

## Confirmed parity or stronger rewrite behavior

- Static border dimensions and primary colors are substantially aligned: 2 px
  amber hover, 3 px cyan focus, 2 px hard/default/silent styles, 3 px explicit
  include/exclude, 1 px ghosts, and 4 px radius. The failures are state routing,
  target choice, multiplicity, visibility, and paint timing—not a blanket border
  size mismatch.
- Core reveal order remains top → midpoint → lazy lock → growth-aware bottom →
  freeze → original position; two bottom confirmations and hidden-document
  deferral are stronger when they actually reach terminal proof.
- Consent suppression is active and retained AI payloads contained zero
  extension artifacts and zero non-empty script/style/noscript bodies.
- The fast local signal lane plus single-flight 15-second authority lane, cached
  definitive `not_found`, and one load per binding are sound designs. Unchanged
  UI rendering and delayed event projection are the defects.
- Single current-page Save, authoritative response adoption, lock/revision
  fences, and no automatic mutation retry are safer than legacy behavior.
- Optional content messaging uses typed delivered/no-receiver/failed outcomes and
  consumes expected missing receivers.
- Semantic Preview buttons, pointer and keyboard focus, accessible names, human
  production labels, and longer warning/danger toasts are improvements.
- Atomic publication with fingerprint/revision/idempotency fencing is stronger
  than legacy's split preflight/mutation protocol.

## Intentional differences to preserve

1. Plain click is **unmark-only**. Shift is the only gesture that creates a
   widened exclusion. Alt creates an eligible explicit inclusion. This later,
   direct user contract supersedes legacy plain-click exclusion creation.
2. The four-action context menu remains; it must share one cached target
   resolution rather than resolve independently per action.
3. Consent-suppressed commerce/account/contact/modal UI remains hidden and
   excluded. No suppression-selector rollback is allowed.
4. Manual durable render comparison, exact document/generation fencing, two-frame
   paint acknowledgement, and guarded starvation fallback remain.
5. Marking owns 412×960 mobile posture and silent preview owns 1920×1080 desktop
   posture. Transitions must be correct even where legacy did not enforce them.
6. Hidden exclusion decisions remain in canonical extraction state while their
   invisible overlays do not paint.
7. Expanded technical Preview rows and extraction decisions remain, as directly
   approved; rendering must be virtualized/bounded rather than silently deleting
   the taxonomy.
8. Content List remains keyboard-operable and uses semantic buttons even though
   pinned legacy was pointer-only.
9. The silent interaction shield, top-layer neutralization, and retained page
   freeze remain; scrolling must use the actual viewport owner.
10. Stricter payload stripping, brain-owned signals, one current-page Save, and
    atomic publication fences remain.
11. No final Lynx selector publication occurs until the candidate coverage gate
    is complete, despite Alpha being available for non-final workflow testing.

## Documentation conflicts to close

- `MARKING_AND_HIGHLIGHTING_LOGIC.md` still describes plain-click exclusion
  creation in one section, while the newer direct contract and implementation
  make plain click unmark-only.
- Existing boundary tests lock some target-universe behavior contradicted by the
  legacy contract the user designated as correct. A shared target corpus must
  replace prose ambiguity.
- “Silent boxes remain mounted” and “legacy fade/restore” are compatible: nodes
  can retain identity while opacity is suppressed during coordinate drift and
  one idle reposition commits before reveal.

## Acceptance headline

P25 remains open until the current source passes clean automated gates and every
valid candidate completes an observer-free headed rewrite flow. Rewrite marking
and silent p95 must be no slower than 1.05× pinned legacy on equivalent pages,
with no input long task over 50 ms; true bottom must reach at least 99.5% of the
resolved viewport range and restore within 2 px; post-edit projection must be
under one second; every accepted slow action must paint feedback within 100 ms;
and no invisible/suppressed/extension/freeze-authored artifact may enter visible
overlays or payloads.
