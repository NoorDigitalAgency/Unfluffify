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

Implementation remediation is code-complete through finding 113; findings
110–112 are closed by the immutable pushed-source DPJ gesture run. Findings 108
and 113 await exact clean pushed reruns, while finding 109 remains a recurrence
watch. P25 remains open until the exact
clean pushed commit completes every valid candidate's observer-free headed
rewrite flow. Rewrite marking
and silent p95 must be no slower than 1.05× pinned legacy on equivalent pages,
with no input long task over 50 ms; true bottom must reach at least 99.5% of the
resolved viewport range and restore within 2 px; post-edit projection must be
under one second; every accepted slow action must paint feedback within 100 ms;
and no invisible/suppressed/extension/freeze-authored artifact may enter visible
overlays or payloads.
