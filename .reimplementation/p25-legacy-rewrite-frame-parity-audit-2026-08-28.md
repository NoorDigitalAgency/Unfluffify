# P25 legacy/rewrite frame-parity audit — 2026-08-28

## Result

**Implementation closure complete; clean headed acceptance pending.** The initial
side-by-side audit found 54 product gaps, adversarial run-plan review found 30
additional lifecycle, input, evidence, and release-gate gaps, and final
precommit review plus the clean headed campaign extended the register through
finding 109. The current P25 implementation addresses every classified finding without weakening the
rewrite's locked contracts. This document remains the finding register rather
than a PASS claim:
the clean-source P25 gate and observer-free candidate matrix are the acceptance
authorities.

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
- The audit began against uncommitted preliminary P25 changes. Run-plan reviewed
  and integrated that source; findings below retain the original observations
  while their headers record implementation closure. Historical green artifacts
  still do not certify a different source identity.
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

1. **Closed P0 — freeze acknowledgement raced initial discovery.** Legacy completes its
   first motion/media/SVG/style discovery before returning. Rewrite
   `installMotionFreeze()` schedules full discovery roughly 250 ms later but can
   acknowledge `SET_MOTION_PAUSED` immediately. Capture, return scrolling, row
   counts, and overlay paint can start against a partially moving page.
2. **Closed P0 — freeze-authored inline values leaked into captured HTML.** Legacy keeps a
   property ledger and restores authored values in the capture clone. Rewrite
   remembers values only in page-world memory while `captureFlattenedHtml()`
   serializes the mutated `style` attribute. Freeze-only opacity, transform,
   filter, transition, and empty-style changes can enter AI HTML.
3. **Closed P0 — hash-only and same-URL history events tore down content state.**
   Background inspection identity correctly ignores fragments, but content URL
   handling, inspection reconciliation, and the SPA guard compare exact hrefs.
   A fragment or same-document `replaceState` can reset freeze/marking or reload.
4. **Closed P0 — the page-inspection curtain was not a complete input firewall.** It owns
   a pointer surface but does not capture-block every page mouse, pointer,
   keyboard, form, drag, touch, and wheel path as legacy did. Focused inputs,
   global listeners, top-layer UI, or default scroll can race the ritual.
5. **Closed P0 — lost page-world replies could wedge an invisible posture.** If ARM,
   lazy-suppression, freeze, or DESTROY applies and the reply is lost, isolated
   and page worlds can disagree about the nonce. Cleanup is not acknowledged,
   later ARM can be permanently rejected, and a frozen or armed page can remain.
6. **Closed P0 — true-bottom logic assumed the window/root scroll owner.** Height,
   midpoint, bottom proof, restore, and shield wheel fallback do not resolve an
   actual nested viewport owner. Ledigajobb stays at the top and the ritual gets
   stuck. Pinned legacy is also root-only, so this is a shared limitation against
   the intended legacy experience rather than a source-level regression.
7. **Closed P1 — no-scroll preparation did not retain lazy suppression.** The rewrite
   no-scroll branch freezes motion without necessarily keeping
   `lazySuppressed:true`, allowing later intersection/resize expansion.
8. **Closed P1 — extension lazy hydration was early, broad, and unledgered.** It runs
   before suppression acknowledgement, mutates any `[data-src]` element, forces
   eager loading, removes site classes, can execute/load unintended iframe or
   script-like resources, and leaves mutations in the captured DOM.
9. **Closed P1 — extension-owned animation could be frozen.** Initial WAAPI discovery,
   patched animation/media play paths, and batch processing do not consistently
   exclude extension UI before pausing. Spinner, focus, and dash animation can
   stop with page motion.
10. **Closed P1 — SVG/root/pseudo motion restoration was not lossless.** Rewrite resumes
    every discovered SVG even when it was authored paused; root and pseudo motion
    can escape the descendant CSS lock until later discovery.
11. **Closed P1 — the 250 ms stage settle had no equivalent stability proof.** Legacy's
    longer stage and final warmup waits are mechanical but stable. Rewrite is
    faster only nominally; rects, scroll height, resources, and rows are not
    proven quiet before release.
12. **Closed P1 — stalled-scroll fallback visibly teleported.** The audited
    implementation wrote root/body `scrollTop` directly after 650 ms, producing
    the mechanical jump and failing to help a non-root owner.
13. **Closed P2 — timer and listener instrumentation was installed too broadly.** Timer
    bridges start at module boot in every frame and listener interception patches
    all `EventTarget`s. Legacy deferred timer wrapping until actual freeze.
14. **Closed P2 — motion indicator presentation drifted.** Gap, top padding, ARIA role,
    and hostile-page-style resistance differ from the legacy 48×30 indicator.
15. **Closed P2 — render-mode UI allowed meaningless transitions and reversed the
    comparison order.** Both modes remain available; same-mode reload is not
    disabled; no-JS/JS order differs from the intended ritual.

### B. Marking targets, expansion, inclusion, hit testing, and overlays

16. **Closed P0 — hit testing performed full composed-DOM traversal.**
    `getComposedHitElements()` collects pointer-suppressed descendants before
    geometry pruning, including BODY/HTML. Renderer paint proof repeats the call
    at five points per rectangle. Complexity approaches
    `rectangles × document-size` on real pages.
17. **Closed P0 — plain-unmark scanned every exclusion owner twice.** The audited
    preliminary engine enumerated explicit owners and then all owners, performing
    ancestor style and geometry work per owner for ordinary hover/click. Latency grew
    with unrelated mark count.
18. **Closed P0 — exact widened-owner clearing had no dependable painted-owner key.**
    Overlays are pointer-transparent, so target-derived overlay XPath normally
    resolves only the full-screen root. The geometric fallback uses one bounding
    box: fragmented inline gaps count as hits and overlaps can clear the deepest
    XPath instead of the visually top owner.
19. **Closed P0 — hidden-exclusion paint had bypasses and contradictory visibility
    rules.** Immutable/closed-shadow branches can retain raw geometry after paint
    proof fails. The evaluator can accept painted `aria-hidden` content while the
    renderer rejects it solely from metadata. Canonical exclusion must remain;
    its overlay must not.
20. **Closed P0 — visibility mixed viewport and document coordinates.** A bridge built
    while scrolled passes viewport-relative top with document scroll height,
    allowing unchanged above-viewport content to change classification.
21. **Closed P0 — the markable/Shift target universe differed from the correct legacy
    contract.** Descendant-only structural containers can become self-markable;
    shallow generic wrappers are over-classified as page shells; mixed groups
    can qualify after an ineligible textual sibling is discarded. Existing tests
    lock some of the contradictory behavior.
22. **Closed P0 — silent cardinality was inflated.** Every included structural row and
    every descendant exception is painted. Marking has ancestor-exception
    suppression, silent mode does not. A single excluded ancestor can therefore
    produce many red descendants.
23. **Closed P1 — scroll left stale marking classifications visible.** Legacy fades
    all layers, redraws after 250 ms idle, then reveals after paint. Rewrite hides
    only hover/interaction layers and can reveal before reposition commits.
24. **Closed P1 — silent scroll did O(all-target) proof/repaint work on continuous
    frames.** Stable node identity is useful, but coordinates must not be recomputed
    and paint-proved for the whole projection on every scroll event.
25. **Closed P1 — large Shift work blocked its acknowledgement frame.** Canonical branch
    evaluation happens synchronously before only the render is deferred. Legacy
    acknowledged first and queued the mutation.
26. **Closed P1 — hover cache missed ordinary within-target movement.** It reuses only
    identical coordinates or a normally unavailable overlay XPath. Legacy cached
    target bounds, hit stack, modifiers, and render generation.
27. **Closed P1 — Content List emphasis used ordinary hover presentation.** The declared
    cyan focus layer is unused; preview focus calls yellow hover. Source focus and
    occurrence focus are not a distinct, stable presentation.
28. **Closed/intentional — selector provenance is not a semantic/presentation
    authority.** D-02 requires AI/saved selector matches to become ordinary
    explicit rows, so legacy AI-content dashes are not restored. Preview
    occurrence focus is different: it remains an interaction presentation and
    must use the dedicated focus layer rather than ordinary hover.
29. **Closed P2 — collapsed/display-contents fallback was shallower and less textual.**
    Rewrite stops at 64 nodes/depth eight and accepts the first measurable depth;
    legacy searched up to 200 and required a visible textual descendant.
30. **Closed P2 — cursor preloads were not retained.** Short-lived `Image` references can
    permit a fallback-cursor flash during first modifier interaction.
31. **Closed P2 — the parity harness could not compare markable cardinality exactly.**
    Previous legacy overlay selectors were rewrite-specific and reported zero.
    The checked-in gate now records implementation-neutral source, rect,
    visible-layer, and physical-hit counts at one document/viewport generation.

### C. Content List, AI, Save, and popup workflow

32. **Closed P0 — disabling marking could discard unsaved post-AI selectors without
    confirmation.** AI success clears `contentDirty`, but disable confirmation
    checks only that flag. Legacy fenced any pending selector session until Save.
33. **Closed P1 — successful AI did not open Content List.** Rewrite declares Preview
    an operator action. Legacy held the operation through terminal selector
    adoption and automatically opened Preview.
34. **Closed P1 — Content List had no immediate pending state and could flash a false
    empty result.** Full projection work happens before busy paint, and null and
    empty both render “No content detected.”
35. **Closed P1 — Content List work scaled with the entire structural model.** Expanded
    technical rows are rendered synchronously without virtualization. DPJ showed
    1,042 disabled rows; Ledigajobb showed zero in one run and later took about
    15.6 seconds for 1,159 rows.
36. **Closed P1 — unchanged 500 ms signal ticks still rerendered open Preview.** Focus and
    routing also trigger root React work, full linear lookup, and full row DOM
    queries. Page-to-row and row-to-page are not O(1) occurrence operations.
37. **Closed P1 — Save had no click-time progress for its longest preflight.** It waits
    polls/context/signals/lock/load/gates/capture before reconciliation busy UI.
38. **Closed P1 — Discard lost confirmation, immediate spinner, and success toast.** It
    can begin authoritative work with no operator acknowledgement.
39. **Closed P1 — disable and candidate navigation lacked truthful immediate progress.**
    Duplicate input can appear accepted while the slow operation is unresolved.
40. **Closed P1 — render-mode Set was not authoritative on existing properties.** Local
    UI exits while background persistence can refuse; rejection is activity-only
    and the mode can revert on reopen.
41. **Closed P1 — toast anchoring was wrong on long popup content.** A sticky toast
    rendered after the list can be outside the viewport; legacy fixed it to the
    popup viewport.
42. **Closed P1 — spinner phases were collapsed or exposed internal tokens.** Capture,
    payload, XPath, remote wait, Preview opening, and synchronization are not
    truthful distinct phases; countdown begins before the remote wait.
43. **Closed P1 — several operator aborts were silent or console-only.** Missing tab,
    Preview, discard, render inspection, candidate construction, and render-mode
    persistence can end without a visible reason.
44. **Closed P2 — clean candidate navigation over-confirmed.** Rewrite always warns about
    unsaved markings; legacy prompts only for a pending session.
45. **Closed P2 — marking action hierarchy and copy drifted.** Run AI, Save, Discard, and
    disabled Content List share one row instead of the staged legacy hierarchy.
46. **Closed P2 — Todo adaptive state was incomplete.** Current and incomplete sections
    should expand, completed sections should collapse, and manual per-property
    overrides should persist as required by U-08.
47. **Closed/intentional — global popup shortcuts remain absent.** Legacy Ctrl/Cmd+E,
    S, and M are deliberately not restored by binding decision D-30; visible
    gated controls plus marking modifiers, Space, and Escape remain authoritative.
48. **Closed P2 — checklist checking trapped Cancel/Escape and mislabeled publication.**
    Checking and publishing are treated as one locked phase even though only the
    mutation must be non-cancellable.
49. **Closed P2 — successful login cleared the remembered email.** Legacy cleared only
    the password.

### D. Previously observed live closure items

50. **Implementation closed P0; headed validation pending — emulation/session transition could fail or restore stale geometry.**
    Teknikhallen failed mobile activation, and silent overlays previously retained
    mobile XPaths after desktop transition. The integrated implementation remains
    subject to clean headed validation.
51. **Implementation closed P0; headed validation pending — local dirty projection missed the one-second contract.** DPJ was
    7.465 seconds; Acne, Arno, and ArkivIT also failed in retained evidence.
52. **Implementation closed P0; headed validation pending — terminal projection identity could be empty or wholly unusable.**
    Ledigajobb returned selectors but zero rows; DPJ returned 1,042 disabled rows.
53. **Implementation closed P1; headed validation pending — second-run/page acknowledgement cleanup was unreliable.** Ledigajobb's
    second AI start timed out even after the first run terminalized.
54. **Implementation closed P1; headed validation pending — blocked-page ownership and retained scrolling needed a single contract.**
    Silent/post-AI shielding is intentional, but page clicks must be blocked while
    the resolved viewport scroll owner, wheel, touch, and extension controls stay
    responsive.

### E. Adversarial closure findings discovered during run-plan

55. **Closed P0 — starvation fallback used a second acknowledgement owner.** The
    background could terminalize a JavaScript-off inspection while the content
    controller still owned a connected curtain. The fallback now proves only
    `ready`; the exact local controller performs the ordinary acknowledgement and
    reconciles its own curtain and shield.
56. **Closed P0 — freeze normalization could visually revive consent UI.** Motion
    and reveal traversal could apply visible/fixed authored-state overrides below
    a suppressed consent branch. All isolated and MAIN freeze paths now prune the
    composed suppressed subtree before reads or writes.
57. **Closed P0 — Chromium native touch takeover stranded nested scrolling.** A
    native `pointercancel` ended the shield packet before the following touch
    stream could continue. The packet now survives the ownership handoff and the
    real-CDP P15 case scrolls the nested viewport owner.
58. **Closed P0 — connected but stale viewport owners were trusted forever.** SPA
    replacement and late lazy growth could leave a connected old owner patched
    while the new owner escaped. Owner identity is invalidated and re-resolved
    without dropping an already-bound wheel/touch packet.
59. **Closed P0 — synthetic untrusted input could cross ordinary extension
    surfaces.** Trusted-only boundaries now cover shield callbacks and fallbacks,
    marking document handlers, direct Preview activation, and marking-menu
    actions. Registered extension controls remain the sole scoped exception;
    page-originated synthetic events cannot pass by mounting extension-like DOM.
60. **Closed P0 — timer aliases and string handlers escaped freeze.** Cancelling
    pre-pause timeout, animation-frame, or idle handles by their native positive
    token did not cancel the deferred alias, and string timeout handlers could run
    while paused. Both token forms and both handler forms now share one ledger.
61. **Closed P0 — hidden consent modals could become viewport owners.** Owner
    scoring in both isolated and MAIN paths now rejects consent-hidden and
    extension composed roots before geometry or rank work.
62. **Closed P1 — mutation churn cancelled active input and performed broad
    scans.** Cache invalidation is separated from active packet ownership, and
    mutation candidates use an iterative 64-node cap that prunes consent and
    extension subtrees instead of materializing every descendant.
63. **Closed P0 — native top-layer UI could visually occlude ordinary extension layers.**
    `dialog`, popover, fullscreen, and their backdrops can paint above the curtain
    even when pointer input is inert, allowing paint proof to pass behind an
    invisible extension surface. Reversible display neutralization now covers
    document/open-shadow dialog, popover, fullscreen, and backdrop state, with
    exact authored capture projection and restoration even when serialization
    throws.
64. **Closed P0 — open-shadow and late viewport-owner lifecycle was incomplete.** Light
    DOM hit stacks cannot discover a nested scrolling owner inside an open shadow
    root, and an owner installed after lazy suppression can escape non-composed
    scroll suppression. Composed hit traversal plus bounded active-lifecycle
    invalidation and refresh now cover both isolated and MAIN worlds.
65. **Closed P0 — static raw HTML retained consent subtrees.** XPath refinement
    stripped the live clone but the static source sent to AI could still contain
    suppressed commerce/modal markup. The static source is now sanitized with
    the exact consent selector contract after refinement and before payload
    adoption.
66. **Closed P1 — suppressed churn prevented stabilization quiet proof.** Consent
    mutations, rects, resources, motion, rows, and open-shadow fingerprints no
    longer reset or contribute to quiet proof; adjacent page mutations still do.
67. **Closed P1 — pointer-suppressed hit recovery descended hidden consent
    worlds.** Composed exclusion now runs before style, geometry, shadow, native
    top-hit, or child descent. A 500-descendant adversarial branch records zero
    reads while an adjacent eligible target still resolves.
68. **Closed P1 — Content List label projection remained quadratic.** Per-row
    descendant queries and `innerText` layout traversal are replaced by one
    iterative, generation-scoped, bottom-up metadata pass with bounded text
    state. A 3,000-level corpus proves linear work and no recursive stack risk.
69. **Closed P1 — a preceding page curtain spoof could starve the fallback.** The
    debugger proof searched only the first marker and required exact opacity 1.
    It now finds the exact token/generation/document candidate among all markers
    and shares the local `>= 0.999` opacity threshold; the regression executes the
    proof with a valid curtain behind a spoof.
70. **Closed P1 — open-shadow discovery could starve beyond its first budget.**
    Discovery is resumable and fair beyond 1,500 light nodes and nested roots,
    instead of restarting at the document head on every capped pass.

### F. Final integration and release-gate findings

71. **Closed P0 — silent layers did not enter the scroll-fade lifecycle.** The
    CSS omitted all three silent layers and the silent-only scheduler never set
    the scrolling state. Stale boxes now hide synchronously, retain identity and
    old geometry through the queued frame, reposition once, and restore only
    after the render commit; P23 proves the interim and final frames.
72. **Closed P0 — the P25 composite could not pass or prove a clean source.** A
    child acceptance artifact made every later child appear dirty, P23 did not
    require clean source, and several catalogs accepted unknown checks. P25 now
    owns one preflight identity, permits only its named child artifact roots,
    executes all children, enforces exact catalogs, parses and retains every
    child result, and proves postflight source stability.
73. **Closed P0 — accepted Save could resume an old marking engine after silent
    entry failed.** The popup cleared local state and emitted success even when
    content did not enter silent mode. Post-commit recovery is now explicit and
    fenced; no mutation retry, false session fact, success toast, or interaction
    resume is possible before exact local proof.
74. **Closed P0 — a tiny real document range outranked a dominant nested owner.**
    A 3 px root could steal reveal and lazy ownership from a movement-proven
    3,000 px app shell. Both worlds now compare proven capacity: a nested owner
    wins when it supplies at least one viewport and materially dominates root
    travel; hybrid light/open-shadow and replacement regressions cover it.
75. **Closed P0 — P25 did not enforce its stated performance budget.** Historical
    P14 bounds allowed approximately 2× legacy plus slack and captured no long
    tasks. Physical hover, click, and wheel windows now collect Chromium long-task
    evidence, reject missing/unsupported or >50 ms input tasks, and P25
    independently recomputes all operation p95 ratios at rewrite <=1.05× legacy.
76. **Closed P0 — declarative-shadow consent content escaped static payload
    sanitation.** Document selectors do not enter `template.content`, and the
    first fix also crossed the popup/content realm boundary. One realm-neutral
    taxonomy and recursive visited-root sanitizer now handle ordinary/nested/
    declarative-shadow templates while preserving adjacent markup and doctype.
77. **Closed P0 — an edit arriving after Save response could trigger a second
    mutation.** The success response was followed by an awaited signal drain
    before the code recorded the commit boundary. Authoritative success is now
    marked immediately; every later dirty, binding, adoption, or cleanup path is
    a no-retry committed recovery terminal.
78. **Closed P0 — silent entry success masked silent posture failure.** A failed,
    timed-out, or identity-changed session transition still emitted green Save
    completion. Recovery kinds now distinguish content-inactive proof from
    reload-required posture failure, so inactive status cannot clear the wrong
    fence and every post-commit await/return/throw is terminally classified.
79. **Closed P1 — cached movement proof survived same-identity SPA shell changes.**
    Both worlds now invalidate movement evidence before owner re-resolution, and
    isolated shielding observes every discovered open shadow root before it can
    later become the owner.
80. **Closed P1 — Discard could falsely acknowledge emulation coherence.** It
    ignored posture failure, while generic emulation returned true whenever any
    transition was in progress. Discard now joins/serializes the exact mobile
    target, keeps freshness fenced on failure, and suppresses success until that
    posture is proven.
81. **Closed P0 — AI success ignored content clean/adoption acknowledgement.** A
    rejected or missing receiver could clear dirty state and enable stale Save or
    Content List. Failure now clears cached selectors, retains dirty state,
    projects `requires-ai-run` immediately on both controls, reports run failure,
    and shows reason-specific recovery copy.
82. **Closed P1 — settled-only configuration caching permitted duplicate
    concurrent loads.** Content startup and popup load could both call `/load`
    before either result settled. Both now join one property-keyed authority
    operation with generation-fenced invalidation, one response adoption, cached
    200/404 reuse, rejection eviction, and successful explicit retry.
83. **Closed P0 — the earlier side-by-side harness could not certify its own evidence.**
    Ignored/stale stage files, zero exit on aggregate failure, missing source and
    bundle identity, weak publish fencing, ~10 Hz state samples, one render mode,
    and dropped network/frame/cardinality evidence made a nominal matrix
    non-auditable. A checked-in raw-CDP harness with nonces, coherent identities,
    hard publish abort, rAF/screencast/long-task frames, exact probes, durable
    artifacts, and schema-valid aggregation now replaces the scratch harness.
84. **Closed P1 — nested touch could move both the document and resolved owner.**
    Shield routing now cancels wheel/touch default only when a nested owner is
    authoritative, retaining pointer-cancel continuation semantics while headed
    proof shows the document fixed and only the owner moving.

### G. Final precommit launcher and live-evidence findings

85. **Closed P0 — a nominally canonical launch did not exclusively prove browser,
    profile, port, target, tab, and bundle ownership.** The launcher now locks all
    mutable authorities, re-proves them immediately before mutation and spawn,
    and emits one atomic launch record bound to the exact process, profile,
    extension ID, CDP target, tab, source, and normalized bundle inventory.
86. **Closed P0 — the publication fence was not durable for the complete run or
    newly created extension targets.** A nonce-bound guard now remains active
    from begin through final evidence, dynamically covers exact-extension pages
    and workers, aborts final publication before transmission, drains in-flight
    interception work, and records atomic redacted evidence. Website debugger
    ownership is released immediately.
87. **Closed P0 — candidate promotion and comparable document identity could be
    asserted or mixed across reloads.** Implementation-neutral preflight signals
    now determine candidate validity, bind the adopted disposition to the exact
    document, and preserve one loader/time-origin identity across comparable
    stages. Known not-found pages remain N/A rather than operator-promoted.
88. **Closed P0 — recorded pair and matrix fields could pass without being
    independently recomputed.** Pair validation now reprojects exact stage
    evidence and enforces label, URL, candidate disposition, document, source,
    bundle, browser, profile, timing, visual, gesture, and zero-publication
    parity. Matrix validation rejects stale, missing, duplicate, unknown, or
    mislabeled pairs and mixed authorities.
89. **Closed P1 — live probes could accept covered/invisible paint, wrong resize
    posture, aggregate marking similarity, or contaminated latency.** Composed
    clipping and top-hit proof, exact pre/post emulation posture, target-keyed
    gesture decisions, first-correct-paint acknowledgements, run-window long
    tasks, and per-operation rewrite-to-legacy ratios now fail closed.
90. **Closed P0 — the live harness claimed a full flow without exercising the
    operator workflow.** Candidate runs now use trusted physical controls for AI,
    Content List first paint and both routes, post-edit freshness, fresh rerun,
    one current-page Save and authoritative adoption, Discard confirmation,
    acknowledged silent shield/scroll posture, payload hygiene, and checklist
    opening. The final checklist Send remains untouched and forbidden.
91. **Closed P0 — launcher and skill guidance could expose input values or kill,
    reuse, reload, or overwrite resources it did not own.** Inputs are redacted;
    cleanup targets only the proven child; stale live-round output, broad process
    kills, fixed-port/profile reuse, in-place extension reload, and concurrent
    bundle clobbering are rejected or recovered without losing user state.
92. **Closed P0 — pinned legacy and debug dispositions relied on labels rather
    than verifiable provenance.** Legacy begin now requires the exact pinned
    commit, tree, lock digest, build command, and normalized bundle-inventory
    attestation, permitting only the numeric manifest launch counter. Tampered
    files, manifests, or heads fail; unavailable pinned-legacy debug evidence is
    explicitly N/A and cannot become a parity pass.
93. **Closed P0 — post-scroll marking geometry
    was one monolithic main-thread transaction.** On the exact clean rewrite,
    Ledigajobb passed render, activation, visual, and gesture stages before a
    640 px wheel produced a 142 ms Long Task approximately 250 ms after input.
    Frame and CPU evidence proved fade/reposition/restore correctness but showed
    all 737 bridge targets being measured in one retained-overlay repaint. Large
    interactive geometry updates now remain fully faded and reconcile in
    generation-fenced 24-target presentation-frame chunks; only the final chunk
    rebuilds explicit-owner routing and reveals the completed generation.
    Cancellation covers subsequent scroll, bridge replacement, clear, park, and
    disposal. A later exact-source physical scroll completed with zero JavaScript
    Long Tasks and correct fade/reposition/restore. The strict 50 ms budget was
    not widened.
94. **Closed P0 — the first chunking fix could
    temporarily withdraw explicit-owner input during unrelated page geometry.**
    The next clean run passed through marking visuals, then a page-owned layout
    change started a full 737-target, 31-frame faded reconciliation between the
    Alt inclusion and its context/plain-clear checks. The visible inclusion
    remained canonical, but owner routing was generation-safed off: Context Menu
    exposed Exclude instead of Widen and the plain click did not clear. Rewrite
    geometry now consumes a bridge-bound native intersection snapshot and
    measures only current plus boundary-crossing targets. Initial observation
    must cover every current target before it becomes authoritative; bridge
    refresh disconnects and rebinds the corpus. The deterministic full-map
    chunker remains a fallback, not the ordinary Chrome path. The clean headed
    rerun completed all six plain/Shift/Alt/context/clear gestures in 944 ms with
    zero input Long Tasks, proving owner routing remained live.
95. **Closed harness P0 — the exact Shift stage could select a target that the
    contract says must not widen.** After finding 94, the next run proved Alt,
    context-menu disabled states, exclusion clear, and inclusion clear, but its
    chosen `H3` was already the Shift hover owner. Product correctly created an
    exact exclusion under the meaningful-boundary rule; the harness incorrectly
    demanded an ancestor and larger breadth for every clean node. Candidate
    selection now uses the physical Shift-hover path as a read-only preflight,
    always releases the modifier, skips same-owner nodes, and adopts only a
    candidate with a distinct ancestor owner before asserting expansion.
96. **Closed harness P0 — “different Shift owner” did not prove ancestor or
    exact Alt identity.** A selected `H2` was physically covered by its child
    anchor; the product correctly created both marks on that descendant, while
    the target-keyed probe compared them against the heading. The chooser now
    requires Alt hover to resolve the exact candidate XPath and Shift hover to
    resolve a strict bridge ancestor. Descendants, siblings, same-owner results,
    and stale/no-hover results are rejected before any mark mutation.
97. **Closed harness P0 — target cleanliness and gesture frame timing were
    measured on stale and incomplete boundaries.** The following run selected
    an exact `H1` with a strict Shift ancestor, but late explicit-owner paint
    placed that ancestor in `session-explicit-exclude` before the first plain
    click. The product correctly removed it; the probe incorrectly reported a
    no-create mutation. Its compact collector also ended at 2.2 seconds although
    target preparation plus six gestures took 4.3 seconds, so later Alt,
    context-menu, and clear frames were absent. The reported 59 ms and 53 ms
    Long Tasks started during the harness's two full-document target scans,
    before the first operation at page time 37879.8 ms. Target preparation now
    runs before frame collection, revalidates zero target ownership after both
    modifier preflights, and fails closed on any final ownership drift. The
    collector stays alive until the complete action and a 180 ms settled tail;
    gesture Long Tasks are filtered to explicit page-clock action bounds. No
    product performance waiver was introduced: the next clean run must still
    prove every real input task at or below 50 ms.
98. **Closed misclassification plus closed evidence gaps — resize and AI were
    reported against the wrong authorities.** On exact pushed source after
    finding 97, Ledigajobb passed both render modes, activation, visual
    cardinality, all six gestures, scroll fade, and posture restoration. The
    original run then reported a 629 ms resize task and timed AI out at 180
    seconds. Resize is now checked at both stage and aggregate boundaries, and a
    failed AI run retains its transitions and requests. The clean diagnostic
    replay recorded zero JavaScript Long Tasks during resize; sampling attributed
    about 460.6 ms to Chromium `(program)`/layout/render and only 6.55 ms to
    extension JavaScript. Its 433.3 ms rAF p95 is faster than pinned legacy's
    516.7 ms p95 (0.84×), so the presentation pause is not a rewrite-relative
    regression. Run AI painted feedback in 62 ms, entered capture in 239 ms,
    began polling in 432 ms, and emitted exactly one 1,116,106-byte
    `/get_selectors` POST that returned 202 in 538 ms. Job
    `8abe8cf7-1244-4c42-94c1-1d15cec2691c` completed in about 238 seconds and
    automatically opened a 96-row Content List. The audit's override was shorter
    than the product's authoritative eight-minute deadline; the default live gate
    now waits through that deadline plus a bounded evidence-drain allowance.
99. **Closed harness P0 — rewrite AI payload hygiene was falsely rejected.** The
    guard recognized only legacy `page`/`pageMarkings` envelopes and treated
    intentionally empty script/style/noscript shells as executable source. It
    now recognizes rewrite `pages[]`, normalizes every page identity, and rejects
    only non-empty executable-source bodies. The retained Ledigajobb request has
    one current page, no extension/freeze artifact, and no executable body.
100. **Closed harness P0 — Content List two-way interaction was correlated through
    stale absolute XPath rather than visible geometry.** Ledigajobb inserted
    `#mailtoui-modal` after projection, shifting body ordinals while retained
    overlay geometry and engine element references remained valid. Direct trusted
    pointer input proved page→row and row→page; trusted Space produced native
    keydown, keyup, and click and focused the corresponding page occurrence. The
    formal probe now foregrounds the panel, witnesses the semantic native Space
    click, resolves focus text through the visible overlay underlay, and clicks
    visible overlay geometry through the interaction shield. Dynamic DOM
    insertion can no longer create a false two-way failure.
101. **Closed P0 — consent mutation work
    crossed the marking-input frame boundary.** A clean production run preserved
    all six gesture outcomes but recorded five 55–73 ms Long Tasks. The first two
    sampling profiles attributed about 313–326 ms per one-second flow to native
    `querySelectorAll` called by `hideConsentOverlaysInRoots`; marking evaluation
    and paint remained only a few milliseconds. One native comma-separated query
    removed 27 redundant traversals, but the next exact build still recorded a
    138 ms Long Task. A source-mapped 100-microsecond CPU profile then proved that
    290 ms remained under `consent-lifecycle.ts:219`: attribute-only mutations
    were being routed through the added-subtree scanner. That is unnecessary—an
    attribute mutation can only make its target start matching; unchanged
    descendants cannot acquire a consent attribute. The lifecycle now keeps
    separate exact-node and added-subtree queues, deduplicates exact roots already
    covered by a new subtree, and reserves full-document sweeps for the existing
    document-root boundary. A same-browser headed diagnostic of the corrected
    build passed all six semantic gestures with zero Long Tasks, 16.8 ms rAF p95,
    and a 33.4 ms worst frame (previously 66.7 ms p95 and 138 ms). Exact-node and
    subtree regressions pass, while the unchanged taxonomy, initial/full sweep,
    late subtree discovery, hiding, restoration, and payload exclusion contracts
    remain intact. Clean commit `1ee034b7` repeated the decisive stage with all
    six gestures correct, zero Long Tasks, 16.8 ms rAF p95, and a 33.4 ms worst
    frame, closing the input-frame blocker.
102. **Remediated, headed verification pending harness P0 — the silent gate
    demanded desktop posture without enabling the desktop-preview preference.**
    The clean Ledigajobb workflow passed through Save and authoritative silent
    acknowledgement, then the runner rejected its valid retained 412×960 mobile
    preference as though it were the required 1920×1080 desktop case. Physical
    activation of the real desktop-preview control immediately proved product
    correctness: 1920×1080, 24 visible silent highlights, and an opaque,
    interactive 1905×1080 scrollbar-aware shield. Activation setup now uses that
    real control, waits for the terminal page viewport, records the initial silent
    posture, and only then enables marking and proves 412×960. The post-Save
    silent stage therefore measures the intended desktop→mobile→desktop contract
    rather than relying on an unstated profile preference.
103. **Remediated, headed verification pending harness P1 — AI feedback latency
    included CDP setup and dispatch round trips.** The fresh AI run reported 107
    ms while the first reported 35 ms, but the clock started before foregrounding,
    hit verification, mouse movement, press, and release. The physical activation
    witness now records the host epoch immediately before trusted key/pointer
    dispatch; feedback is measured from that input boundary. The workflow gate
    now enforces the same ≤100 ms requirement for both initial and post-edit AI
    runs. This changes evidence authority only, not product timing.
104. **Remediated, headed verification pending harness P0 — the workflow probe
    omitted its new desktop-preview dependency.** Immutable run
    `2026-08-28T23-41-31-894Z-a070f39f-rewrite-ledigajobb` physically enabled
    the real preference and the popup visibly reached silent, idle, checked state,
    but activation failed closed after 45 seconds because
    `captureWorkflowPopupState` did not include `desktop-preview-enabled` in its
    serialized control set. The shared probe now records that control, and a
    source-contract regression prevents the activation predicate from becoming
    impossible again. No marking action or final publication occurred in the
    failed run.
105. **Closed P0 — Refresh could race the
    desktop→mobile marking transition.** Immutable run
    `2026-08-28T23-47-25-220Z-a51efe8c-rewrite-ledigajobb` proved silent desktop
    and dispatched a trusted marking click 750 ms after explicit Refresh. The
    operator action started, then rolled back to silent and remained unchecked
    for the 45-second gate; the same trusted click without overlapping Refresh
    subsequently completed, isolating transition coherence rather than hit
    testing. The fast signal lane, bound signal delivery, explicit Refresh, and
    authority lane were serialized only against Save, not against an emulation
    reload. They can no longer rebind or reconcile the same document while a
    session transition owns it: already-started work drains first, same-binding
    work coalesces behind the transition, and one trailing refresh resumes after
    release. A real navigation is still observed immediately so it can fence a
    stale action. Regression coverage holds Refresh mid-request, proves no mobile
    apply or content activation occurs early, then proves exact ordered
    activation after release; existing A→B→A and one-post-Save-refresh contracts
    remain green. Immutable production run
    `2026-08-29T00-55-58-246Z-cf9c2d03-rewrite-ledigajobb` then passed its exact
    activation/network stage on clean pushed commit `33c390e3`, closing the
    headed gate as well as the deterministic regression.
106. **Closed P0 —
    one responsive header class change rebuilt the complete marking bridge.** The
    exact Ledigajobb resize stage restored 412×960 but recorded 616 ms and 438 ms
    Long Tasks. Source-mapped cold profiles attributed the extension work to a
    full 760-node bridge pass: composed-child flattening, geometry/visibility,
    XPath construction, and store/index recreation. The page emitted net-zero
    `min-height: 48px → auto → 48px` churn plus one genuine terminal
    `#page-header` class change from `sticky-top` to
    `sticky-top no-transition`; the latter kept forcing the full rebuild after
    same-batch and cross-callback net-zero coalescing correctly removed the style
    noise. Stable presentation attributes now refresh only shallow, non-overlapping
    affected bridge branches. The refresh recomputes descendant visibility and
    silent-whitespace state, preserves element/key/XPath topology and canonical
    marks, refreshes evaluation/candidate/Preview projection state, retains text
    and IntersectionObserver caches, and repaints only those branches. Child-list,
    character-data, `role`, and consent-boundary changes still rebuild the full
    bridge. Geometry fallback work is additionally bounded to 12 targets per
    frame. A fresh production cold probe restored exact 388→412 posture with
    zero Long Tasks, 16.7 ms p95, and a 16.8 ms worst frame. A separate
    non-profiled 60-cycle run restored exact posture 60/60 times with zero Long
    Tasks, max reported p95 16.8 ms, and a 50 ms worst frame. The scoped
    visibility, hidden-text reevaluation, net-zero churn, class-branch, and
    role/full-rebuild regressions pass in the 111-test DOM bridge suite; the next
    clean pushed run repeated the immutable marking-resize stage on commit
    `33c390e3`: exact 412×960 → 388×960 → 412×960 posture, 217.237 ms total
    action including the intentional settle, zero Long Tasks, 16.8 ms rAF p95
    and worst frame, 752 markable sources, eight painted rectangles, zero
    invisible/composed-invisible/covered/unresolved paint, and 114 consent-
    suppressed sources. Stages 00–07 all passed on the same run.
107. **Closed P0 — a passive authority retry could strand a successful AI result behind a
    transient lock overlay.** Stage 08 of the same immutable run emitted exactly
    one clean, current-page-only 1,118,728-byte `/get_selectors` POST, received
    202, polled the job to terminal, and fetched its 763-byte selector result.
    An unrelated 15-second `/context` pass began about 165 seconds after the AI
    click, hung for 100.248 seconds, and returned 503 about 79 seconds after the
    successful result. Its passive lock projection wrapped the popup's running
    state in `locked`; `run.completed` correctly advanced the retained underlay
    to `post_ai_clean`, but automatic Content List opening requires the exposed
    state and therefore never ran. The selectors were not lost and became
    manually available after authority recovered. The harness compounded the
    diagnosis by inspecting only body text and reporting “without showing a
    failure” even though the terminal spinner explicitly said the saved
    endpoints did not answer the site lookup.

    Local AI is now an authority-adoption transaction. The 500 ms local signal
    and navigation lane stays live, while only the remote authority lane pauses.
    A slow pass already in transport is generation-retired: its Todo, lock,
    configuration, and AI-resume projections cannot adopt after the AI action
    starts, and one forced fresh pass coalesces behind it only when work was
    actually retired or queued. An already-proven exact mobile posture bypasses
    the transition queue, so AI capture does not wait behind an unrelated Hub
    request; a pending opposite transition still serializes normally. The
    harness now treats spinner/setup lock failures as visible terminal failures.
    Integration regressions hold `/context`, complete AI and open a populated
    Content List, release a synthetic 503, prove zero stale lock adoption and one
    fresh trailing pass, and separately prove a path change still fences the
    delayed AI result. The complete automated gate is green at 140 files / 1410
    tests plus seven generated-manifest tests. Immutable production run
    `2026-08-29T01-46-36-763Z-86b81d8e-rewrite-ledigajobb` on pushed commit
    `423abc92` then completed both real backend jobs without passive-authority
    overlap or takeover. The initial job auto-opened the 96-row semantic Content
    List; both two-way routes, Discard, the fresh AI run, one current-page Save,
    authoritative adoption, silent transition, and three clean payloads passed.
108. **Remediated, immutable rerun pending harness P1 — post-AI freshness was
    timed from site-session setup rather than trusted input.** The same immutable
    stage's only acceptance failure was `post-ai-freshness`: it recorded 1,148.3
    ms against the one-second budget. The physical evidence contradicts a product
    regression: the Shift edit dispatched in 45.0 ms, received target-keyed paint
    acknowledgement in 85.6 ms, and both Save and Content List were disabled with
    `requires-ai-run`. The stale clock started before connecting a fresh CDP site
    session, enabling domains, foregrounding the candidate, choosing a clean
    target, hovering it, and waiting two presentation frames—roughly 1.06 seconds
    of harness preparation before input existed. The probe now records a host
    epoch at the trusted gesture boundary, retains input and observation epochs,
    derives the interval from them, and rejects missing acknowledgement,
    mismatched origin, non-monotonic time, or a projection over one second.
    Focused regressions prove the 85 ms interval and prohibit the old pre-session
    clock. The complete gate passes lint, all type/page-world checks, 140 test
    files / 1,412 tests, the production build, and seven generated-manifest
    tests. This repairs evidence authority only; product behavior is unchanged.
109. **Unclassified watch item P1 — one clean production activation rolled back
    before reveal, but did not reproduce.** Run
    `2026-08-29T01-33-11-605Z-bcc2a232-rewrite-ledigajobb` passed preflight and
    both render modes, then its trusted marking toggle entered pending and
    returned to silent in about 1.5 seconds. Eight immediate production
    Refresh→trusted-pointer repetitions subsequently activated 8/8 in 1.18–1.74
    seconds on the warmed page, and a fresh debug first-entry sequence passed the
    exact activation gate. Because no stable rewrite divergence or root cause is
    proven, no speculative product change is justified. The immutable matrix
    retains this as a recurrence watch; any repeat must capture the pre-reveal
    terminal reason and becomes a blocker.
110. **Closed harness P0 — DPJ gesture preparation
    treated off-screen carousel content as physical input.** Immutable production
    run `2026-08-29T02-09-47-414Z-f26b4c44-rewrite-dpj` passed preflight, both
    render modes, exact 412×960 activation, network bounds, and marking visuals.
    It retained 712 markable sources, 14 painted/visible/reachable rectangles,
    zero invisible, composed-invisible, covered, or unresolved paint, and 21
    consent-suppressed sources. Stage 05 then failed before dispatching input
    because the chooser accepted vertical visibility alone, clamped horizontally
    off-screen slider geometry to the viewport edge, sampled structural boxes
    rather than readable pixels, and required the painted owner to equal the
    outer candidate even when the pointer correctly resolved a nested link.
    Candidate proof now requires horizontal and vertical viewport intersection,
    a readable text-range or element point whose extension-filtered
    `elementsFromPoint` hit belongs to the source, bridge-related Alt-owner
    normalization, a strict widened Shift ancestor, and a physically reachable
    point reacquired before every gesture. Moving grouped content remains
    eligible—the probe tests the real widening surface instead of deleting the
    feature class—but an owner that leaves the viewport fails closed. Context
    dismissal is also proven before the following page click. The corrected
    same-browser diagnostic selected DPJ's nested Kundcase link on its first
    attempt and completed plain no-create, Shift widen, exact clear, Alt include,
    four-action context state, and plain include clear. Immutable run
    `2026-08-29T03-11-06-978Z-ac1210ae-rewrite-dpj` repeated that exact prepared
    physical sequence on pushed source and passed it.
111. **Closed P0 — explicit-include clearing and
    context capabilities depended on a current painted-owner index.** Repeating
    the same DPJ diagnostic against the unchanged loaded bundle alternated
    between a correct six-operation result and a state where Exclude was enabled,
    Widen was disabled, and the next plain click only dismissed the context menu.
    The canonical explicit inclusion never disappeared. The pure exclusion
    resolver returned a closed explicit-include boundary only when it was the
    deepest native hit; descendants returned `null`. A generation-current
    renderer index usually masked that violation, but scrolling/carousel geometry
    intentionally retires the index while coordinates settle. The locked legacy
    contract makes the include boundary authoritative anywhere in its composed
    hit path. The pure resolver now returns that owner regardless of which
    descendant painted under the pointer. The context menu additionally derives
    Include, Exclude, Widen, and Clear from one cached composed-hit observation,
    preventing page motion between three independent resolutions. Unit coverage
    proves descendant plain-clear and a one-read context capability set; the
    focused four-file gate passes 198/198 tests. The complete gate also passes
    lint, every page-world/TypeScript check, 140 files / 1,415 tests, the
    production build, and seven generated-manifest checks. The subsequent
    immutable pushed-source stage passed immediate context state and clearing
    while the renderer index remained generation-fenced.
112. **Closed P0 — the
    semantic explicit-include fallback was still rejected by the final
    unmark-only classification guard.** Immutable pushed-source DPJ run
    `2026-08-29T02-46-05-129Z-244a5cc6-rewrite-dpj` passed stages 00–04 on
    `81850ffc`, then deterministically failed the exact stage-05 sequence after
    Alt inclusion: the immediate context menu enabled Exclude, disabled Widen,
    and the following plain click left the inclusion intact. Frame evidence kept
    the target connected and stationary; a later physical click cleared it.
    The renderer's current spatial index bypassed the problem once available.
    While that index was generation-fenced, the pure resolver correctly
    returned the closed explicit-inclusion owner, but the final plain-exclude
    guard accepted only nodes whose evaluated classification was `exception`.
    An explicit inclusion is classified as content, so the guard discarded the
    exact owner it was meant to clear. Plain input now accepts either explicit
    decision kind while continuing to reject every unmarked/non-excluded node.
    A regression forces both painted-owner fast paths unavailable and proves
    immediate context ownership plus plain clear through the semantic path. The
    focused marking/P25 gate passes five files / 219 tests. The complete gate
    passes lint, every page-world/TypeScript check, 140 files / 1,415 tests, the
    production build, and seven generated-manifest checks. Immutable production
    run `2026-08-29T03-11-06-978Z-ac1210ae-rewrite-dpj` on pushed commit
    `43185a83` then passed the exact DPJ preparation and all six physical gesture
    outcomes, closing findings 110–112 without relying on a current spatial
    owner index.
113. **Remediated, immutable rerun pending P1 — retained technical Content List
    rows did not expose whether their page occurrence had renderable geometry.**
    The same immutable run passed stages 00–07, including both render modes,
    activation/network, marking visuals, all gestures, scroll fade, and resize.
    Stage 08 then failed `content-list-row-to-page`. The auto-opened production
    list retained DPJ's selector-backed empty `<footer class="page-footer">`,
    which had a live element identity but a zero-height client box. It was still
    an enabled semantic button, so the trusted Space probe correctly activated
    it but the cyan occurrence layer could not truthfully paint. Pinned legacy's
    render-target mapper omitted zero-box occurrences; the approved rewrite
    contract instead retains technical extraction decisions and disables only a
    genuinely unresolvable occurrence with a specific reason. Preview rows now
    carry a typed available/unavailable target outcome. Detached, currently
    hidden, and zero-box occurrences remain in the list but are native-disabled
    with public-safe reason text; the engine independently rechecks the live
    target before hover or activation. The physical gate selects enabled native
    buttons, so an intentionally retained disabled technical row cannot poison
    the two-way proof. Focused projection, popup, marking, and workflow tests
    pass four files / 154 tests. The complete gate passes lint, every page-world
    and TypeScript check, 140 files / 1,418 tests, the production build, and seven
    generated-manifest checks. A new pushed-source DPJ run must prove both routes.
114. **Remediated, immutable rerun pending harness P0 — gesture preparation
    stopped before exhausting DPJ's moving candidate corpus and discarded the
    rejection evidence.** Immutable run
    `2026-08-29T03-31-35-565Z-3a5f9dc9-rewrite-dpj` on pushed commit
    `dceb7085` passed preflight, both Render Inspection modes, exact activation,
    network bounds, and marking visuals, then failed before physical input with
    `No stable exact and widenable clean marking target is available`. The
    fixed 24-candidate cap was not authoritative on DPJ: its carousel and lazy
    document expose more than 100 readable candidates, and the set can change
    while preparation scrolls. The search now prefers generic article leaves,
    exhausts a 128-attempt/30-second bounded corpus across fresh sweeps, requires
    two identical Alt-owner/Shift-ancestor/clean-decision observations, and
    records reason counts plus the last twelve rejections. Preparation remains
    outside the operator Long Task window. A failed stage now retains enough
    evidence to distinguish unreachable geometry, moving identity, missing Alt
    authority, non-widenable structure, existing ownership, and unstable
    generations instead of collapsing them into one null result.
115. **Remediated, immutable rerun pending P0 — CSS-only carousel motion could
    leave interaction eligibility at its activation-time horizontal visibility
    snapshot.** The expanded DPJ trace rejected 67 candidates in 30.2 seconds:
    37 were currently non-widenable and 30 lost the Alt owner after the page
    moved them. A long-settle physical check then proved a default-included,
    onscreen review heading had no Alt hover and created no explicit inclusion.
    The heading was in the real top page hit stack; it had merely been
    horizontally offscreen when the bridge was captured, and DPJ moved it with
    a CSS transform that emits no DOM mutation. Resolution now treats only the
    current paint-reachable composed hit path as stronger visibility authority,
    recomputes Shift grouping from locally visible siblings, and keeps the
    canonical bridge/store identity intact. This is O(hit path) for ordinary
    include/exclude input; the extra sibling geometry work occurs only for
    Shift. A chosen widened owner that cannot bind to the current bridge
    generation now rejects instead of silently degrading to an exact exclusion.
    A regression moves an initially clipped article onscreen without refreshing
    the bridge and proves exact Alt inclusion, widened Shift ownership,
    acknowledgement, and canonical toggle. The focused product/harness gate
    passes three files / 172 tests. Clean complete-gate and immutable headed
    evidence remain required.
116. **Remediated, immutable rerun pending P0 — the painted acknowledgement
    boundary treated a fresh bridge object as a different physical target.**
    Gesture resolution, paint acknowledgement, and canonical mutation are
    intentionally split across one presentation frame and one task. A
    structural refresh in either gap rebuilds every `EvaluationNode`, so the
    engine's former object/generation equality check rejected the pending
    gesture even when the exact same DOM `Element` survived. Interaction
    decisions now retain the node-to-element identity and rebind by the
    element-stable bridge key at acknowledgement, toggle, clear, and explicit-
    ownership checks. The current entry must still be the same physical
    `Element`, connected, generation-current, and fingerprint-current; a
    replacement that recycles the XPath or key fails closed. Debug builds retain
    reason-specific interaction rejection stages, while production compiles
    them out. Regressions refresh the bridge repeatedly between resolution,
    acknowledgement, mutation, ownership, and clear, then replace the target at
    the same XPath and prove rejection.
117. **Remediated, immutable rerun pending harness P0 — painted explicit-owner
    rows were not sufficient authority for calling a gesture target clean.**
    The first post-fix DPJ diagnostic still failed Shift even though its hover
    preflight had twice selected a strict ancestor. Debug lifecycle evidence
    showed that `plain-no-create` first cleared a retained explicit ancestor
    whose canonical decision existed but whose explicit overlay was temporarily
    unpainted. Removing that owner legitimately changed the following Shift
    choice, so the timed sequence no longer exercised the structure the
    preflight had approved. Preparation now opens the real trusted context menu
    outside the performance window and accepts a target only when Include and
    Exclude are enabled while Widen and Clear are disabled. The proof consumes
    the same atomic content capability resolver as the operator and dismisses
    with trusted Escape before timing. On DPJ it rejected nine latent-owner
    candidates, selected candidate 40, and then passed all six physical
    operations: no-create 44.1 ms, widened Shift 72 ms, exact plain clear 63.9
    ms, Alt include 74 ms, context menu 31.8 ms, and inclusion clear 59.1 ms.
    This is dirty-tree diagnostic evidence; a clean pushed-source stage remains
    mandatory.
118. **Remediated, immutable matrix rerun pending harness P0 — the comparison
    gate required a rewrite-only action menu from pinned legacy.** Pinned legacy
    installs `contextmenu` as an alias of its ordinary marking toggle; it has no
    four-button Include/Exclude/Widen/Clear menu. P25 nevertheless dispatched a
    right click, waited for rewrite menu actions, and validated those actions for
    both implementations. That could mutate legacy and then fail an impossible
    requirement before any honest comparison. Gesture capture now declares the
    implementation contract explicitly. Both implementations run and compare
    the five shared operations—plain no-create, Shift widen, exact plain clear,
    Alt include, and inclusion clear. Only the rewrite runs and validates the
    action menu and its four capability states. Comparative latency excludes the
    rewrite-only menu; its timing remains separate diagnostic evidence. Rewrite
    preparation likewise uses the context capability resolver for clean-owner
    proof, while legacy never receives the mutating right-click preflight. The
    focused gate passes four files / 181 tests; the complete gate passes lint,
    generated page-world parity, all TypeScript projects, 140 files / 1,424
    tests, a fresh production build, and seven manifest checks.
119. **Remediated, immutable rerun pending product/evidence P0 — explicit
    Refresh and marking admission could overlap without a durable visible
    boundary.** Immutable production DPJ run
    `2026-08-29T04-29-13-545Z-68974e41-rewrite-dpj` on pushed checkpoint
    `8e11cafc` passed preflight and both Render Inspection modes. The activation
    stage then clicked Refresh, slept a fixed 750 ms, dispatched the real Enable
    Marking toggle, and ultimately returned to an enabled unchecked silent state.
    The harness retained only the terminal popup snapshot, so it could not prove
    whether the activation was rejected, rolled back, or lost operator-action
    admission; later exact debug/manual sequences succeeded. This is therefore
    not a speculative activation diagnosis. It is a proven evidence gap plus a
    real UI serialization gap: Refresh owned an in-flight promise while its
    button and Enable Marking remained operable. Explicit Refresh now publishes
    `aria-busy`, disables both controls until the exact promise terminalizes,
    and renders both admission and release edges. A stale duplicate marking edge
    receives `another action is still finishing` as a warning toast. P25 now
    waits for the observed Refresh busy→terminal edge and retains a compact
    toggle/curtain/toast/disabled timeline on every activation timeout.
120. **Remediated, immutable rerun pending P0 — one physical resize repeatedly
    rebuilt or redrew the rewrite overlay while pinned legacy committed once.**
    Debug DPJ run
    `2026-08-29T04-35-08-877Z-0d85fe15-rewrite-dpj` passed both render modes,
    activation, marking visuals, all gestures, and scroll fade before failing
    the unmodified 50 ms Long Task gate at resize: 89 ms and 77 ms tasks, with a
    66.7 ms worst frame. An identical pinned-legacy 412→388→412 perturbation
    recorded zero Long Tasks. A separate silent diagnostic recorded 53–252 ms
    tasks and repeated ~20 ms `silent-render` stages. The rewrite admitted the
    same viewport transaction through Window resize, VisualViewport
    scroll/resize, and root ResizeObserver; the latter entered a four-sample
    stabilizer and could restart for every responsive-layout delivery. Silent
    scroll also repainted on every available frame instead of using legacy's
    120 ms quiet window. The engine now fades once, retains overlay node identity,
    coalesces every source into one trailing transaction, and performs a
    geometry-only commit after the exact legacy 120 ms silent or 250 ms marking
    scroll dwell and a 50 ms marking resize dwell. Silent geometry uses the full
    retained presentation rather than deleting non-intersecting boxes. A
    regression emits 20 rounds across all three observer sources and proves one
    redraw, no selector re-evaluation, retained nodes, and complete listener
    cleanup. The obsolete four-frame stabilizer and its isolated tests are
    removed so the production-path transaction is the only geometry authority;
    D-07 traceability now binds directly to that path. The complete gate passes
    lint, page-world parity, every TypeScript project, 140 files / 1,424 tests, a
    fresh production build, a fresh debug build, and seven manifest checks.
121. **Remediated, immutable rerun pending harness P0 — pinned legacy's Render
    Inspection opener was sampled before its menu render committed.** Pinned
    legacy DPJ run
    `2026-08-29T04-42-25-106Z-c5b16f17-legacy-dpj` passed preflight, physically
    clicked `#config-toggle`, then immediately failed because
    `#render-mode-open-view` was still hidden in that same capture. The opener
    exists and becomes visible on the following React presentation; this is not
    a product divergence. The harness now polls within the existing bounded
    10-second view deadline for the opener to be visible and enabled before the
    next physical activation. Focused marking, popup, App, and P25 coverage
    passes five files / 310 tests; the complete gate is green at 140 files /
    1,424 tests.
122. **Remediated, immutable rerun pending P0 — responsive presentation work
    could preempt resize geometry twice.** Clean production DPJ run
    `2026-08-29T05-14-00-298Z-140ffc0e-rewrite-dpj` on pushed checkpoint
    `594564b8` passed preflight, both render modes, activation, marking visuals,
    every shared/rewrite-only gesture, and scroll fade. Resize then measured one
    76 ms task and no temporary 388 px rectangle signature. Debug run
    `2026-08-29T05-20-38-881Z-4cfca8af-rewrite-dpj` reproduced it with exact
    phase evidence: the 150 ms presentation quiet edge evaluated the full store
    for 72 ms while the harness's probe was still active; the blocked 180 ms
    restore then caused a second 91 ms presentation evaluation. At the same time,
    Chromium's induced scrollY adjustment reset the shared geometry timer from
    the 50 ms marking-resize deadline to the 250 ms scroll deadline. Resize now
    retains priority over induced scroll; Window, VisualViewport, and root
    observer duplicates are deduplicated by normalized viewport signature while
    a real width change remains admissible. Presentation records retain their
    first old value for the full 250 ms marking window, so the 180 ms A→B→A
    round-trip terminalizes without evaluation. Geometry classification iterates
    only the measured target corpus rather than every document classification.
    The regression fires 20 duplicate observer/scroll rounds, proves a single
    50 ms repaint at both probe and restore, and extends the existing net-zero
    responsive test past the old 150 ms failure edge. Focused marking coverage
    passes four files / 152 tests; the complete gate passes lint, page-world
    parity, every TypeScript project, 140 files / 1,425 tests, a fresh production
    build, and seven manifest checks.
123. **Remediated, immutable rerun pending P0 — declaration-order-only inline
    style churn still scheduled one expensive presentation proof.** Pushed
    checkpoint `b97b8d87` corrected the resize deadline and both immutable DPJ
    reruns painted the temporary 388 px device posture, but production run
    `2026-08-29T05-37-16-828Z-858361ab-rewrite-dpj` retained one 86 ms task and
    debug run `2026-08-29T05-41-43-304Z-deee8090-rewrite-dpj` retained one 84 ms
    task. The debug isolated-world ledger attributed 75.1 ms to presentation/store
    evaluation and 19 ms to its index projection. A physical mutation trace then
    recorded DPJ Swiper's 412→388→412 cycle restoring the same width, margin,
    inset, and priority declarations in a different serialized order. Raw style
    strings therefore looked changed even though the CSS declaration endpoint
    was identical. Structural mutation coalescing now canonicalizes inline style
    endpoints through a detached `CSSStyleDeclaration`, comparing sorted
    property/value/priority triples across both the MutationObserver batch and
    the full quiet window. Empty and absent style endpoints are presentation
    equivalent; real declaration changes still branch-refresh normally. The
    regression restores an equivalent reordered style after 180 ms and proves
    zero presentation work, while the existing `display:none` case continues to
    prove genuine visibility changes. Focused DOM bridge coverage passes 118
    tests; the complete gate passes lint, page-world parity, every TypeScript
    project, 140 files / 1,425 tests, a fresh production build, and seven
    manifest checks. Clean production/debug reruns remain.
    Clean production rerun
    `2026-08-29T05-50-40-226Z-e1b0485c-rewrite-dpj` on pushed checkpoint
    `802a0218` then retained one 79 ms task. A terminal physical mutation trace
    showed only two semantically changed Swiper endpoints, both caused by
    extension-owned motion-freeze identity declarations (`translate:none`,
    `rotate:none`, `scale:none`, and `offset-distance:0`). The page-world motion
    capture ledger already records the exact authored value/priority for every
    such property. Structural comparison now restores both old and current style
    endpoints through that shared ledger before canonicalization, aligning live
    presentation authority with capture/payload hygiene. A regression proves
    freeze-only locks schedule no presentation work while a page-authored width
    change under the same locks still branch-refreshes. Focused coverage passes
    119 tests; the complete gate passes lint, page-world parity, every TypeScript
    project, 140 files / 1,426 tests, a fresh production build, and seven
    manifest checks. Clean reruns remain.
124. **Remediated, immutable rerun pending P0 — the workflow probe falsely
    rejected an exact short Content List route and erased its decisive row
    evidence.** Clean pushed-source production run
    `2026-08-29T05-57-28-385Z-7c779261-rewrite-dpj` closed finding 123: DPJ
    marking resize painted 388→412 px with 14 distinct rectangle signatures,
    zero Long Tasks, and a 16.8 ms worst animation frame. Its full workflow then
    used trusted native Space activation on enabled row `3. 15 %. Included`,
    moved the document from scrollY 5208 to 64, and painted a new focus owner
    whose resolved page text was exactly `15 %`. The reverse physical route also
    focused the matching `526. DPJ Workspace. Excluded` row. Product behavior
    was therefore correct. The implementation-neutral comparator required
    either an eight-character substring or three long common tokens, so two
    identical short normalized labels still returned false. The stage serializer
    then spread the row witness before replacing its `before` field with site
    posture, obscuring the activated label in retained evidence. Exact normalized
    equality now succeeds before fuzzy matching and `activatedRow` is retained
    independently from before/after site posture. Regression coverage includes
    matching `15 %`, rejecting `15 %` versus `20 %`, and a source-wiring check
    for the retained witness; the focused suite passes 33 tests. After
    normalizing the prior live bundle, the complete gate passes lint,
    page-world parity, every TypeScript project, 140 files / 1,426 tests, a
    fresh production build, and seven manifest checks. A fresh exact commit run
    remains required because immutable failed evidence is not reclassified in
    place.
125. **Remediated, immutable rerun pending P0 — silent renderer ownership and
    viewport evidence diverged after an otherwise clean workflow.** Exact pushed
    production run
    `2026-08-29T06-12-00-966Z-44936c94-rewrite-dpj` on `570b8f24` passed both
    render modes, activation/network, marking visual, all five shared gestures,
    marking scroll/resize, and the complete product workflow through fresh AI,
    both Content List directions, dirty projection, Discard, one authoritative
    Save, payload hygiene, and silent transition. The next stage found an
    interactive shield at `[0,0,1912,1080]` under exact 1920×1080 emulation.
    That geometry was correct: DPJ's native scrollbar owns the remaining 8 px,
    and page scrolling must remain usable. The oracle incorrectly compared the
    shield to `innerWidth` instead of the visual/layout viewport. The document
    also contained two connected rewrite renderer roots: an empty stale
    404×960 root from an older content realm and the current 1912×1080 root with
    35 visible silent highlights. The frame collector's first-match query chose
    the stale root and reported zero rectangles. This second condition is a real
    lifecycle defect even though it did not duplicate visible paint. The next
    authoritative marking-engine construction now retires every connected
    superseded extension root before mounting, and a source-wiring regression
    covers all five construction routes. Frame evidence reevaluates roots per
    animation frame, selects the greatest painted cardinality and newest root on
    ties, and records root count. Silent acceptance separately requires exact
    1920×1080 outer emulation, a shield matching the exact interactive viewport,
    positive highlights, and one renderer root; marking visual acceptance also
    requires one root. Focused coverage passes four files / 89 tests; the
    complete repository gate passes lint, page-world parity, every TypeScript
    project, 141 files / 1,432 tests, a fresh production build, and seven
    manifest checks. Full dirty-source P14 evidence retained 192 scenarios with
    zero semantic, budget, activation, mutation-pressure, or input Long Task
    failures; the aggregate correctly failed only its mandatory clean-source
    identity check. A clean checkpoint rerun and a fresh immutable headed run
    remain required.
126. **Closed P1 — the P17 phase oracle required
    canonical Preview churn for geometry-only fixture setup.** Clean
    pushed-source P14, P15, and P16 gates on `ffae6bdc` pass with 192 performance
    scenarios, 36/36 frozen-shield checks, and 13/13 inspection lifecycle
    checks. P17 then passed 16 checks with no browser or console errors before a
    deterministic timeout while pinning the explicit target. The fixture set
    only `position`, `left`, and `top`, but waited for both physical `top=80`
    and a new Preview projection revision. The optimized renderer intentionally
    handles layout-only style mutations as presentation geometry without
    replacing canonically identical rows; the controller explicitly calls
    `reproject` immediately after the pin. The oracle now requires only the
    physical layout endpoint, retaining the subsequent explicit projection and
    active-hover mutation proofs. A source regression forbids reintroducing the
    revision condition. Focused coverage passes 6/6, and clean pushed aggregate
    `acceptance-2026-08-29T07-43-12-778Z.json` validates the retained P17 child
    at all 19/19 checks with clean teardown.
127. **Closed P1 — P23 conflated immediate scroll
    feedback with legacy-matched quiet geometry settlement.** Clean pushed-source
    P17, P18, and P20 gates on `664e1f22` pass at 19/19, 14/14, and 4/4. P23
    passed every semantic, identity, retention, scheduler, and error check but
    measured silent geometry settlement at 143 ms against its original 50 ms
    budget. That oracle predates the production 120 ms silent quiet transaction,
    which intentionally hides stale fixed coordinates synchronously, retains
    the same nodes during scroll, commits one redraw after quiet, and then
    restores them like pinned legacy. Treating the full settle as a 50 ms input
    response both contradicts the production timer and fails correct behavior.
    P23 now measures the two contracts independently: fully transparent retained
    layers within 50 ms, and geometry settlement within 120 ms plus 50 ms of
    bounded scheduling/frame slack. A source assertion binds the gate's quiet
    constant to production so they cannot drift again. The strengthened
    dirty-source run records a 0.3 ms fade, 143.5 ms settlement, identical eight
    silent nodes, and unchanged canonical rows. Clean pushed aggregate
    `acceptance-2026-08-29T07-43-12-778Z.json` validates the retained P23 child
    at 25/25 checks.
128. **Closed P1 — silent-only geometry scanned absent
    marking state and interactive restore requested paint one frame late.** The
    first complete P25 aggregate on clean `c9574633` retained one 51 ms input
    Long Task in large silent scroll and missed the small marking-scroll strict
    p95 ratio by 0.135 ms: rewrite 333.3 ms versus the 1.05× legacy limit of
    333.165 ms. In silent-only posture the renderer's classification map is
    empty, but every geometry transaction still iterated the document-scale
    target map before drawing silent presentations. That empty miss loop now
    returns immediately after retiring any stale classification boxes, with a
    proxy-backed regression proving the target iterator is never entered while
    silent geometry still measures its presentation. Interactive scroll also
    waited 250 ms before requesting its frame-fenced repaint, so the rewrite's
    extra paint frame landed after legacy's visible restore. It now requests
    paint at 230 ms while keeping the layer faded until the repaint completes,
    placing the visible restore in the same approximately 250 ms window. Four
    focused contracts pass 137/137, lint and all TypeScript projects pass, and
    the dirty-source 192-scenario browser rerun records zero semantic, budget,
    activation, mutation-pressure, or input Long Task failures. Small
    marking-scroll p95 is 305.6 ms versus legacy 317.2 ms; large marking-scroll
    is 300.0 ms versus 349.9 ms; large silent-scroll is 184.7 ms versus 216.6
    ms. Pushed commit `8b22d7d4` passes full verification at 141 files / 1,434
    tests plus production build and seven manifest checks. Standalone clean P14
    artifact `acceptance-2026-08-29T07-26-19-164Z.json` passes all 192 scenarios,
    and clean aggregate `acceptance-2026-08-29T07-43-12-778Z.json` validates all
    seven ordered P25 children. Its fresh embedded sample records rewrite small
    marking-scroll p95 301.8 ms versus legacy 317.2 ms, large marking-scroll
    299.8 ms versus 333.3 ms, and large silent-scroll 186.3 ms versus 214.7 ms.
129. **Closed P0 — live silent geometry still
    measured every markable target after its quiet window.** Clean production
    DPJ run `2026-08-29T07-46-14-018Z-6a7bca79-rewrite-dpj` passed every stage
    through silent visual, including both paint-acknowledged render modes, exact
    marking gestures, the complete AI/Content List/Save workflow, one current
    renderer root, and correct 1920×1080 desktop posture. Its physical wheel
    then overlapped a 71 ms Long Task and resize overlapped 61 ms and 58 ms Long
    Tasks. The tasks begin at the 120 ms geometry commits. Only 35–56 silent
    sources were visible while the engine supplied all 787 markable targets to
    the renderer, forcing document-wide client-rect measurement on DPJ's complex
    layout. Viewport motion now always uses the current plus crossing
    IntersectionObserver corpus. The renderer treats omitted sources as
    intentionally unmeasured: it keeps their keyed nodes connected and hidden,
    measures only supplied targets, and restores the same nodes in place when
    they re-enter. This preserves retained identity, fade, and no-flicker
    semantics while bounding forced layout. A focused browser-model regression
    proves two measured targets instead of three, zero reads for the offscreen
    source, hidden retained identity, and same-node restoration; four focused
    files / 167 tests, lint, and all TypeScript projects pass. Full verification
    passes 141 files / 1,435 tests, production build, and seven manifest checks;
    dirty-source P23 passes 25/25 behavioral checks. The failed run is finalized
    with publication attempt count zero. Pushed source `fb446685` then passes
    clean P23 at 25/25 and complete clean P25 aggregate
    `acceptance-2026-08-29T08-06-59-992Z.json`, whose seven ordered children are
    all present and validated. Exact clean production headed run
    `2026-08-29T08-08-12-287Z-1b3fcddb-rewrite-dpj` then passes every one of
    the 13 required stages and finalizes green. Silent wheel and resize each
    record zero Long Tasks, 16.7 ms median animation frames, 33.3 ms p95, one
    current renderer root, correct fade/reposition/restore, and exact retained
    silent-desktop posture. The full real-control workflow completes both AI
    generations, automatic and bidirectional Content List routing, immediate
    dirty projection, Discard, exactly one current-page Save with authoritative
    adoption, and payload hygiene. The publication guard records zero attempts.
130. **Closed evidence P1 — the live harness treated an authentic legacy busy
    curtain as a terminal non-physical control.** Two finalized pinned legacy
    DPJ attempts prove that opening Render Inspection can trigger a long
    `Calculating highlightings...` `ui-curtain`; the curtain physically covers
    the alternate mode and session-return controls, while the already-selected
    mode is disabled. Immediate hit-target failure preserved safety but stopped
    the comparison before the steady-state legacy workflow. The shared physical
    activation probe now has an explicit bounded readiness option which waits
    only when the actual center-point blocker is `#ui-curtain` or the typed
    popup busy curtain. It retains the initial blocker, attempt count, and wait
    duration, still rejects every unrelated overlay immediately, and dispatches
    only trusted pointer/keyboard input after the real control becomes the hit
    target. The legacy render probe physically switches away when the requested
    mode is already selected, proves that terminal, then physically clicks the
    requested mode; returning to the session also requires the curtain to clear
    and the marking toggle to be enabled. Focused coverage passes 37/37. The
    retained wait remains legacy latency evidence rather than being hidden or
    charged to the rewrite.
131. **Confirmed legacy divergence P0 — JavaScript-disabled inspection never
    terminalizes on live DPJ and poisons later workflow evidence.** Clean pinned
    legacy run `2026-08-29T08-31-33-092Z-cee475eb-legacy-dpj` physically starts
    the alternate inspection. After the complete 180-second lifecycle budget,
    legacy still reports `Reloading page with JavaScript disabled` and
    `Inspecting page...`, has no terminal inspection identity, and retains the
    prior JavaScript render choice. A reciprocal 60-second probe records 585
    physical center-point attempts with `#ui-curtain` continuously covering the
    enabled control; a 30-second session-return probe records another 294
    blocked attempts. Re-enabling JavaScript and reloading the same managed tab
    does not recover the operation; the popup cycles between inspection and
    highlight calculation. The immutable run is finalized failed and records
    zero publication attempts. P25 now supports an explicit diagnostic
    observe-only render stage for the independent follow-up run. It dispatches
    no render control, captures the real popup/page/screenshots, and necessarily
    fails normal render acceptance (`clicked=false`, `terminal=false`). This
    preserves the render failure while allowing marking, workflow, silent, and
    publication cells to be measured in an unpoisoned fresh legacy session.
132. **Confirmed rewrite P0 — repeated viewport-owner discovery can make a
    valid reveal/freeze ritual fail and is unbounded inside quiet sampling.**
    Production Assist24 and ArkivIT each passed preflight and both render-mode
    inspections, but real marking activation returned
    `page-visit-stabilization-skipped`. The ritual currently calls the complete
    viewport-owner resolver from extent measurement and quiet sampling. That
    resolver can walk 1,500 nodes, retain 1,600 candidates, read computed style,
    and physically movement-probe up to 12 candidates. Repeating it can switch
    authority mid-walk and adds page work precisely while the quiet proof is
    looking for settlement. The fix is one ritual-owned scroll owner, observed
    by the restoration ledger, with a forced re-proof only after disconnection
    or a proved stalled movement. True-bottom and restore tolerances are not
    relaxed.
133. **Confirmed rewrite P0 — Preview exit can remain visibly open after a
    trusted Exit click.** Acne Specialisten, Arno, and Teknikhallen completed
    current-run AI and both Content List focus directions, then remained in the
    Preview view for the full 20-second terminal budget. The popup sends
    `previewExitRequested` and performs one signal pull, but does not bind the
    operator occurrence to the content-owned `preview.exited` completion edge.
    Silent posture and publication failures after this point are cascades, not
    independent renderer failures. Exit must await the falling preview-active
    edge, retain truthful pending UI, and surface a visible terminal reason.
134. **Confirmed rewrite P1 — exclusion presentation can borrow a visible
    descendant rectangle for a canonical source with no reachable box.** Arno
    painted two and Teknikhallen four exclusion sources that the independent
    top-hit oracle could not reach. The common renderer geometry helper falls
    back from an unmeasurable semantic wrapper to the first visible descendant
    while keeping the wrapper XPath on the overlay. That violates the direct
    user contract that an invisible exclusion owner must have no visible
    marking. Exclusion presentation will require own reachable geometry;
    canonical extraction decisions and non-painted Content List rows remain.
135. **Evidence classification — several candidate reds are dependent or
    external, not additional product defects.** Assist24/ArkivIT marking,
    workflow, and silent cells follow their failed activation and zero renderer
    roots. Acne/Arno/Teknikhallen silent and publication cells follow the stuck
    Preview exit. Acapedia served a live HTTP 403 with only `403 Forbidden`, so
    its candidate workflow is N/A for that immutable run. The supplied 3D Prima
    page remains a site-owned 404, and Hub supplies no authoritative Bigbag
    candidate. Aleris live preflight proved substantive content and its rewrite
    workflow passed, promoting it for that run despite the registry's retained
    runtime-validation warning.
136. **Confirmed legacy divergence P0 — the pinned baseline is not a passing
    oracle on any current candidate.** Every production pair is red because the
    authentic legacy build cannot terminalize extension-owned render inspection;
    observe-only downstream runs intentionally leave both render cells red.
    Legacy also recorded 132–404 ms DPJ input Long Tasks and up to 409 ms on
    Teknikhallen resize. The rewrite's clean DPJ, Ledigajobb, Aleris, and
    Humanova workflows pass with zero extension-owned DPJ input Long Tasks, but
    parity cannot be declared by pretending the legacy stall succeeded.
137. **Evidence integrity P1 — the first ten-property matrix spans two rewrite
    source identities.** DPJ was captured on `7264839f`; the remaining current
    runs were captured after harness-only commit `2a07034d`. Bundle identity is
    coherent, but the matrix correctly rejects a single-authority claim. The
    final matrix must be rebuilt from one clean pushed HEAD after this
    remediation wave; immutable earlier artifacts remain diagnostic evidence.
138. **Closed evidence P1 — scaled mobile pages can prove the exact interactive
    viewport while the layout viewport includes browser gutter.** Assist24
    entered the required 412×960 emulation posture, but its responsive metadata
    exposed a 424×988 layout viewport while `visualViewport` remained exactly
    412×960. The old gate rejected the valid posture even though pointer input,
    painting, and screenshots are bounded by the interactive viewport. The
    posture oracle now accepts an exact layout viewport or an exact interactive
    viewport, records both, and retains the same device-pixel-ratio and mobile
    emulation requirements. Regression coverage proves desktop gutter and
    scaled-mobile cases without widening the numerical target.
139. **Closed evidence P0 — the gesture oracle contradicted the invisible-
    exclusion contract.** A physical Assist24 Shift click painted the transient
    `explicit-exclude` acknowledgement on the widened ancestor within 20 ms,
    then intentionally removed the box because that canonical exclusion owner
    had no reachable geometry. The following plain click acknowledged `clear`
    on the same exact owner. The old oracle demanded a persistent canonical
    exclusion box, so it called both correct actions failures. Gesture evidence
    now retains the target-keyed transient acknowledgement and accepts a hidden
    exclusion only when Shift-create and plain-clear acknowledge the same
    widened owner with the required ancestor relation. Fingerprint-only or
    mismatched acknowledgements still fail closed.
140. **Closed evidence P1 — a copied profile's same-user edit lease could block
    an otherwise fresh immutable run.** Session preparation returned as soon as
    it saw a visible Enable marking toggle, even when that toggle was disabled
    behind `Continue here`. The live harness now requires the toggle to be
    enabled and idle, and physically follows only the conservative same-user
    `Continue here` plus `Discard and continue` confirmation before proceeding.
    Other-user locks remain untouched and time out visibly; no storage, lock,
    or DOM state is mutated outside the real controls.
141. **Closed evidence P0 — leaving the two-mode comparison required a current
    proof for the retained choice.** The required stage order ends on the
    JavaScript-disabled inspection. When the stored choice remains rendered,
    the popup correctly rejects Cancel because that choice is not the current
    inspection generation. Session preparation formerly retried Cancel until
    timeout. It now physically re-runs the retained choice through the normal
    Render Inspection lifecycle, waits for its terminal document/generation
    proof, then leaves the view. The comparison still retains both original
    immutable mode stages; the extra inspection is an explicit workflow
    precondition, not fabricated evidence.
142. **Closed evidence P1 — an interrupted stage directory could prevent the
    publication guard from finalizing.** A process interruption between atomic
    stage-directory creation and `stage.json` commit left a truthful but empty
    directory. Finalization used to throw before requesting guarded shutdown.
    It now synthesizes an in-memory failed interrupted-stage record from the
    immutable directory identity, marks validation red, stops and drains the
    publication guard, and writes the failed aggregate. It never deletes,
    overwrites, or upgrades the interrupted artifact.
143. **Confirmed rewrite P0 — one trusted Preview exit could lose its required
    fact/acknowledgement round trip.** Assist24 completed current-run AI and both
    Content List directions, but the first real Exit click remained in Preview
    for the full terminal budget; the next trusted click and three exact
    diagnostic cycles exited immediately. The required popup fact relay logged
    and swallowed delivery failure, while a single false→true request pair had
    no recovery path. Preview exit is now one serialized operator occurrence
    with three bounded, idempotent false→true attempts. Content remains the sole
    restoration authority, a retired binding stops retries, duplicate clicks
    coalesce, and final failure is visible with its attempt count.
144. **Closed evidence P1 — resize posture repeated the preflight viewport
    oracle bug.** Assist24 marking activation, visual, gestures, and scroll all
    passed in an exact 412×960 interactive viewport, but resize compared only
    its 424×988 responsive layout viewport. Visual snapshots now retain both
    dimensions and resize accepts either exact layout or exact interactive
    viewport while continuing to require device scale, page scale, touch,
    pointer, hover, and the complete CDP restore record.
145. **Closed evidence P0 — the first cross-target Preview-exit pointer dispatch
    was not proven to reach the side panel.** The exact clean Assist24 rerun
    passed both render modes and every marking gate, then repeated finding 143's
    visible symptom even after product-level fact retries: Preview stayed open.
    That distinguishes an unstarted click handler from a lost fact round trip.
    Immediately beforehand the page-to-row probe had foregrounded the site
    target, so a successful CDP dispatch was not evidence that Chrome delivered
    a click to the side-panel document. Physical popup activation can now arm a
    capture-phase token on the exact hit-tested control, require `isTrusted`,
    and retry only an unacknowledged dispatch after foregrounding the panel
    again. The synchronous trusted-click proof prevents duplicate activation;
    the product's bounded fact/ack retries remain responsible only after the
    handler has actually started.
146. **Closed evidence P1 — a closed headed session could mature from same-user
    continuation into the explicit takeover state before the next run.** The
    clean Assist24 rerun encountered the retained lock as `Take over`, not
    `Continue here`; the prior recovery loop therefore waited while all marking
    controls correctly remained fenced. The implementation-neutral workflow now
    physically accepts `Take over` as well as `Continue here`, then handles the
    same visible discard confirmation if one is required. This does not mutate
    lock storage or bypass the lock organ; it exercises the operator-facing
    transfer path and retains the rotated revision/fence returned by authority.
147. **Confirmed rewrite P0 — Preview-exit retries used a reorderable boolean
    re-arm protocol.** The trusted-control proof in finding 145 showed that the
    handler started, yet the exact durable Assist24 record ended with
    `previewActive: true`, `previewExitRequested: false`, and no restoration; a
    later independent click succeeded. The retry previously emitted separate
    false and true facts through asynchronous event delivery, so a delayed
    re-arm could overwrite the requested edge. Popup exit now reports one
    monotonic `previewExitRequestSeq` occurrence per bounded attempt. The brain
    emits the existing `preview.exit.requested` signal whenever that sequence
    advances; the older boolean edge remains compatibility-only for content
    Escape. Duplicate sequence signals are harmless outside an open Preview,
    navigation resets the local occurrence, and content remains the sole owner
    of `preview.exited` after physical restoration.
148. **Closed evidence P1 — stale-lock recovery could dispatch a control after
    that recovery surface had already terminalized.** A fresh Assist24 run
    captured `Take over`, then authority removed the action between the stage's
    state snapshot and its physical hit-test. The comparison driver treated the
    now-missing button as a hard product failure. Recovery now revalidates the
    exact actionable control immediately before dispatch, accepts disappearance
    only when a newly captured popup state proves a transition, and waits up to
    two seconds for a semantic surface change before considering another action.
    Missing controls with unchanged state and all other physical-hit errors still
    fail closed. Unit coverage proves actionable, raced-away, and unchanged
    recovery states.
149. **Confirmed rewrite P0 — pre-freeze DOM quiet was incorrectly a fatal
    reveal gate.** In the exact clean Assist24 run, the first activation joined
    the page-load ritual while responsive widgets were still mutating and failed
    with `page-visit-stabilization-skipped`; the same physical activation passed
    after the page cooled. Pinned legacy performs a bounded delay after top,
    midpoint, lazy suppression, bottom, and restore, but never requires a hot
    page to become mutation-quiet before continuing. The rewrite now preserves
    those bounded dwell measurements as advisory paint waits. Physical step
    reach, growth-aware 99.5% true-bottom confirmation, strict post-freeze quiet,
    stale identity fencing, and origin restoration remain mandatory. Regression
    coverage proves continuously hot pre-freeze steps pass, post-freeze motion
    still fails, and an actually unreached step still fails.
150. **Confirmed rewrite P0 — the first Preview exit after the page-to-row focus
    round trip could die between a trusted target click and React's delegated
    handler.** The exact clean Assist24 run proved the visible button received a
    trusted physical click, yet durable facts retained `previewActive: true` and
    no `previewExitRequestSeq`. With instrumentation installed, the next trusted
    click traversed window/document capture and bubble, emitted exactly one
    monotonic exit occurrence, and restored the page. The critical exit control
    now owns one native click listener through a synchronous ref callback instead
    of depending on root delegation during Chrome side-panel foreground and list
    focus commits. The React `onClick` path was removed, so pointer and native
    Enter/Space activation still dispatch exactly once. Unit and source-contract
    coverage fence binding, disposal, and the absence of duplicate handlers.

## Confirmed parity or stronger rewrite behavior

- Static border dimensions and primary colors are aligned: 2 px amber hover,
  3 px cyan focus, 2 px hard and silent content/excluded styles, 1 px default,
  silent-immutable, and ghost styles, 3 px explicit include/exclude, and 4 px
  radius. P25 corrected the historical
  state-routing, target, multiplicity, visibility, and paint-timing gaps without
  changing those correct dimensions.
- Core reveal order remains top → midpoint → lazy lock → growth-aware bottom →
  freeze → original position; two bottom confirmations and hidden-document
  deferral are stronger when they actually reach terminal proof.
- Consent suppression is active and retained AI payloads contained zero
  extension artifacts and zero non-empty script/style/noscript bodies.
- The fast local signal lane plus single-flight 15-second authority lane, cached
  definitive `not_found`, and one load per binding are retained. Generation-
  scoped projection now prevents unchanged ticks from rerendering Preview and
  makes committed dirty signals immediately visible.
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
12. Global Ctrl/Cmd popup action shortcuts remain absent under D-30. Shift/Alt
    marking modifiers, held Space passthrough, and Escape safety remain.
13. AI/saved selector provenance does not create a special decision or border
    layer. Selector matches become ordinary explicit rows under D-02; only
    transient Preview occurrence focus uses the focus presentation.

## Documentation conflicts closed during run-plan

- `MARKING_AND_HIGHLIGHTING_LOGIC.md`, the decision specification, and tests now
  agree that plain click is unmark-only, Shift alone widens an exclusion, and Alt
  creates an eligible explicit inclusion.
- Boundary and widening expectations now share the same target corpus instead of
  preserving contradictory prose-era behavior.
- Silent boxes retain node identity while fading during coordinate drift, then
  reposition once and restore after the committed idle redraw.

## Acceptance headline

Implementation remediation is code-complete through finding 134; findings
135–150 bind the resulting evidence and rerun authority. Immutable
pushed-source DPJ runs close findings 108 and 110–124; finding 109 remains a
recurrence watch, finding 125 awaits an exact clean pushed headed rerun,
findings 126–128 are closed by the clean aggregate, finding 129 is closed by its
exact clean headed rerun, finding 130 closes the legacy evidence-collection
gap, and finding 131 retains the resulting legacy render stall without
poisoning independent downstream measurements. P25 remains open until the exact
clean pushed commit completes every valid candidate's observer-free headed
rewrite flow. Rewrite marking
and silent p95 must be no slower than 1.05× pinned legacy on equivalent pages,
with no input long task over 50 ms; true bottom must reach at least 99.5% of the
resolved viewport range and restore within 2 px; post-edit projection must be
under one second; every accepted slow action must paint feedback within 100 ms;
and no invisible/suppressed/extension/freeze-authored artifact may enter visible
overlays or payloads.
