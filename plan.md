# P25 root-cause legacy parity closure

**Status:** Phases 0–7 are implemented and clean-source automated acceptance is
green. The approved plan package was committed and pushed first as `6db3433a`;
the product closure landed in `9b162bfb`, and the clean-browser regression repair
landed in `f5c82960`. Headed-launch and evidence hardening landed through
`ce8494eb`; the observer-free headed matrix is in progress. P25 stays open until
that matrix is complete and the final evidence commit is synchronized.

The complete finding register is
`.reimplementation/p25-legacy-rewrite-frame-parity-audit-2026-08-28.md`.

## Goal

Make the rewrite match the correct operator-visible behavior of pinned legacy
`28974c2a0c859c91a7167f4757cf84a47ea31e28` across render inspection,
reveal/freeze, lazy loading, marking, silent highlighting, Content List, AI,
Save, Discard, and checklist flows while retaining the rewrite's deliberately
stronger architecture: canonical evaluation, explicit mobile/desktop posture,
brain-owned signals, consent and payload hygiene, semantic keyboard access,
single-page Save, and atomic publication fences.

The rewrite must be perceptually at least as responsive and smooth as legacy,
must never trade correctness for a faster acknowledgement, and must provide
bounded visible failure instead of leaving an invisible posture or busy state.

## Repository ground truth

- Branch `re-write` starts this plan at
  `b32c393e34ee96d495f551fbb985c135204d6604`, synchronized 0 ahead / 0 behind
  `origin/re-write` before plan publication.
- The shared worktree began with intended preliminary P25 edits in stabilization,
  page-world freeze, marking, popup, performance harnesses, and tests. Run-plan
  reviewed and integrated those edits; the resulting implementation is awaiting
  its clean-source acceptance commit rather than further preliminary triage.
- P14–P24 retained artifacts are historical evidence, not certification of the
  current dirty source. Several old live measurements were contaminated by an
  attached page observer and are excluded from latency acceptance.
- The pinned legacy build and rewrite can reuse the configured deterministic
  extension ID only sequentially. Same-path build swapping is permitted with a
  recoverable backup; concurrent profile use is not.
- Valid candidates currently include Ledigajobb, DPJ, Acne Specialisten,
  Acapedia, Assist24, Arno, ArkivIT, Teknikhallen, Humanova, and any currently
  valid Aleris candidate. 3D Prima's supplied page is a 404 and Bigbag has no
  candidate; eligibility is rechecked at run time.

## Locked product decisions

1. Consent suppression is correct. Suppressed commerce, account, contact,
   assembly, country, modal, cookie, and similar blocking UI stays hidden and is
   absent from visible overlays, captured HTML, rows, AI payloads, Save payloads,
   and publication artifacts.
2. Plain click is unmark-only. Shift alone creates a widened exclusion; plain
   click clears the exact painted widened owner; Alt creates an eligible explicit
   inclusion. The four-action context menu remains.
3. Invisible exclusions retain their canonical extraction decision but never
   paint while their source/rect is not currently visible and paint-reachable.
4. Content List retains technical rows and extraction decisions, semantic native
   buttons, keyboard focus/activation, accessible names, and two-way occurrence
   routing. Scale is solved by indexing, memoization, and virtualization—not by
   deleting the approved taxonomy.
5. Marking owns 412×960 mobile posture; silent desktop preview owns 1920×1080.
   A failed transition restores the last confirmed safe posture.
6. Render inspection remains manual, document/generation fenced, and requires
   two-frame paint acknowledgement with the guarded starvation fallback.
7. Local marking freshness comes from brain-appended signals. Remote authority
   stays on a single-flight 15-second lane; one definitive `not_found` is cached
   per property binding.
8. Save emits exactly one current-page mutation, adopts the complete
   authoritative response, and never automatically retries a stale/unknown
   mutation. Final Lynx selector publication remains fenced until coverage is
   complete.

## Plan publication bootstrap — complete

- Review `plan.md` and the P25 audit for internal consistency and diff hygiene.
- Stage only those two documents; do not include the existing source edits in
  the plan commit.
- Commit the approved plan, refresh the code graph, fetch, push non-force to
  `origin/re-write`, and verify 0 ahead / 0 behind.
- Then begin Phase 0 through Phase 9 without waiting for another approval.

## Implementation phases

### Phase 0 — Preserve, classify, and certify the starting source — complete

- Snapshot `git status`, the complete source diff, current generated artifacts,
  branch/upstream counts, and the restored rewrite build. Keep unrelated/user
  work untouched.
- Review every preliminary P25 edit against the audit. Classify each hunk as
  `retain`, `revise`, or `remove-by-forward-fix`; do not use destructive reset or
  checkout.
- Remove only the two exact generated P23 acceptance artifacts already identified
  as transient. Move temporary same-ID legacy builds and worktrees to retained
  `.temp` evidence or remove them only after the rewrite build is restored.
- Reindex the current source graph, run focused compile/tests, and record the
  first trustworthy dirty-source baseline. Historical green artifacts remain
  clearly labeled by commit.

### Phase 1 — O(visible-hit) marking and exact target semantics — complete

**Findings closed:** audit 16–18, 21, 25–26, 29–31.

- Replace full composed-tree hit enumeration with native top-hit collection plus
  open-shadow traversal only along hit branches. Prune every branch by current
  client-rect containment before style or descendant work; never traverse BODY
  or HTML subtrees wholesale.
- Make the renderer own a generation-fenced spatial index of each painted
  `getClientRects()` fragment: owner occurrence, semantic row, layer, z/order,
  visibility, and exact rect. Input resolution queries that index first and the
  composed page hit path second. Overlay nodes may stay pointer-transparent.
- Remove per-event scans of all exclusion owners. Plain unmark resolves the
  visually top painted owner in O(hit fragments), respects fragment gaps, and
  cannot clear a nested/sibling/default row by XPath depth accident.
- Cache hover resolution by render generation, modifier set, source hit stack,
  and target bounds. Moving within one target performs no target reconstruction,
  full style walk, or redundant render.
- Acknowledge Shift/Alt/plain/context input on the next presentation frame, then
  perform the canonical mutation on a trailing task. Serialize duplicate input
  without dropping the latest valid gesture.
- Build one shared legacy/rewrite target corpus covering direct text,
  descendant-only structural containers, shallow landmark and generic shells,
  mixed eligible/ineligible textual siblings, structural noise, single/multiple
  groups, display-contents, fragments, overlap, shadow DOM, and hidden sources.
  Correct boundary/widening code and any contradictory tests together.
- Retain cursor preload objects for the document lifetime and prevent first-use
  cursor flashes.

**Gates**

- Adding 20,000 unrelated nodes or 2,000 unrelated marks changes hover/click
  style/rect reads and p95 by less than 10%.
- No marking input long task exceeds 50 ms. Acknowledgement paints within one
  frame. Candidate-page hover/click p95 is no slower than 1.05× legacy.
- Every painted fragment clears exactly its owner; a gap changes no row; overlap
  follows visible layer/order; every modifier target matches the shared corpus.

### Phase 2 — Overlay visibility, cardinality, layers, and scroll presentation — complete

**Findings implementation-closed:** audit 19–20, 22–24, 27–28, 31, 50, 54;
audit 50 and 54 retain headed-validation gates.

- Unify evaluator and renderer visibility around current paint proof. Connection,
  ancestor display/visibility/opacity, current non-zero fragments, viewport
  reachability, top-layer/covering state, and consent suppression determine
  paint; `aria-hidden` metadata alone does not. Remove immutable/closed-shadow
  raw-geometry bypasses while retaining canonical rows.
- Use one coordinate space for bridge classification and geometry. Rebuilding at
  top, middle, and bottom must not alter canonical rows for an unchanged DOM.
- Apply shallow ancestor/exception deduplication to silent projection so one
  exclusion boundary does not paint every descendant exception.
- Preserve canonical semantic rows and D-02's ordinary explicit presentation for
  selector-seeded decisions. Keep hard/default, explicit include/exclude, hover,
  context, and cyan occurrence-focus layers distinct. Content List emphasis uses
  focus, not ordinary hover; AI/saved provenance does not regain special borders.
- Keep overlay nodes identity-stable, but fade every coordinate-dependent layer
  before visual drift. Coalesce continuous scroll/resize, perform one structural
  or geometry redraw after the appropriate idle window, await committed paint,
  and then restore opacity. No O(all-target) proof on every scroll frame.
- Make desktop/mobile posture adoption retire stale generation/XPath geometry
  before new paint. Shield and overlays must derive from the same confirmed
  viewport generation.
- Expand collapsed/display-contents textual fallback to the approved bounded
  corpus and filter offscreen ghost geometry.
- Add an implementation-neutral metric for canonical rows, markable sources,
  visible fragments, layers, and physical hit targets. Never infer legacy count
  from rewrite-only class selectors.

**Gates**

- Invisible/detached/covered/suppressed sources paint zero exclusion fragments
  within one frame; canonical extraction stays unchanged and reappears correctly.
- Scroll alignment error is at most 1 px. Per continuous-scroll overlay work is
  at most 2 ms; one idle redraw occurs; no stale box appears at its old position.
- Silent ancestor/exception and focus counts match the shared corpus exactly.
  Static border width/color/radius and layer precedence match legacy within
  0.5 px where the same presentation state exists.

### Phase 3 — Transactional reveal, freeze, lazy suppression, and inspection — complete

**Findings closed:** audit 1–15 and 54.

- Make ARM, lazy suppression, freeze, initial discovery, and DESTROY idempotent
  commands keyed by exact document/session/generation, each with applied and
  acknowledged state. A freeze acknowledgement is terminal only after the first
  full motion/media/SVG/root/pseudo/style discovery completes or a bounded,
  visible failure fully destroys the posture.
- Treat lost replies as ambiguous application: run an idempotent acknowledged
  destroy/reconcile sequence before releasing the curtain. Local nonce state is
  not cleared before cleanup acknowledgement. Immediate reactivation must work.
- Add a freeze mutation ledger usable by capture cloning and teardown. Restore
  every authored inline value and remove empty extension-created style attributes
  from captured HTML without mutating the live frozen posture.
- Acknowledge lazy suppression before any hydration. Prefer site-owned reveal.
  If bounded hydration remains, restrict it to approved media types and
  non-consent capture-relevant nodes, prevent script execution, ledger every
  mutation, and restore authored capture markup.
- Resolve the actual viewport scroll owner using scrollability, visual movement,
  viewport coupling, and containment—not merely an element that accepts
  `scrollTop`. Use it consistently for height, offset, top/mid/bottom, growth,
  restore, wheel, and touch. Support window and nested owners.
- Remove direct teleport fallback. Use a bounded extension-owned smooth
  continuation or fail visibly while preserving the last safe position.
- Retain the intended top → midpoint → lock → growth-aware bottom → freeze →
  original-position order, ten-pass cap, and two bottom confirmations. Replace
  fixed optimism with an adaptive quiet proof for rects, height, resources, and
  canonical row count before release.
- Maintain lazy suppression for no-scroll pages. Exclude all extension targets
  before pausing WAAPI, CSS, SVG, media, patched play, or animation calls. Resume
  only sources the extension actually paused; cover root and pseudo animation.
- Install timer/listener bridges only when needed and only in relevant frames.
  Keep the approved early lazy observer bridge and idle-callback suppression.
- Add a capture-phase inspection input lease covering window and document
  pointer, mouse, keyboard, form, drag, touch, and wheel paths while allowing the
  scripted scroll owner. Release every listener/lease in all terminal paths.
- Normalize content-side inspection/navigation identity to origin/path/query and
  current document. Same-document hash and same-URL history events preserve the
  inspection/freeze/lock; path/query/document changes fence once.
- Match motion indicator box/icon geometry and hostile-style resistance while
  retaining appropriate accessible semantics without repeated announcements.

**Gates**

- At freeze ACK, initial discovery is complete; for the next two seconds rects,
  height, resources, motion, and row count remain stable.
- Drop each page-world reply after application. Within the deadline the page has
  no orphan armed/frozen/lazy state, input recovers, and reactivation succeeds.
- Capture during freeze contains zero freeze-authored style values or empty
  extension-created style attributes.
- The resolved viewport owner reaches at least 99.5% of its visual range, freezes
  there, and restores within 2 px without a discontinuity outside the smooth
  velocity envelope.
- During inspection no page listener/default action receives operator input;
  extension spinner/focus/dash animation continues normally.

### Phase 4 — Content List and AI terminal projection — complete

**Findings implementation-closed:** audit 27, 32–36, 42, 51–53; audit 51–53
retain headed-validation gates.

- Fence pending selector sessions independently of the old `contentDirty` flag.
  Pre-AI edits, fresh post-AI selectors, and open Preview remain pending until
  authoritative Save or explicit confirmed Discard.
- On fresh or resumed AI success, adopt the exact terminal selector generation,
  build/publish its projection locally, and automatically open Content List.
  Keep the AI busy surface through meaningful first paint.
- Paint a truthful `Preparing content list…` state within 100 ms. Distinguish
  pending, authoritative empty, stale projection, missing target, and terminal
  rows. Never flash “No content detected” while construction is pending; require
  a stable settled-empty verdict.
- Retain expanded technical semantics but build stable row metadata once, index
  occurrence IDs and XPath/source routes in O(1) maps, virtualize long lists, and
  memoize unchanged list subtrees. The 500 ms local backstop performs zero React
  commits when signal/projection state is unchanged.
- Publish and retain the projection before popup release; rebind current-document
  targets by stable occurrence identity. Disable only a genuinely stale or
  unresolvable row with a specific accessible reason.
- Pointer hover and keyboard focus share one cyan occurrence emphasis; native
  Enter/Space activates smooth page scroll. Page emphasis finds and scrolls the
  popup row through O(1) occurrence lookup. Emit at most one emphasis message per
  frame.
- Restore truthful human AI phases: capture, payload preparation, XPath work,
  remote wait/countdown, response adoption, opening Preview, and terminal sync.
  Internal tokens never appear in production. Every generation and second-run
  path clears spinner, curtain, shield lease, and stale projection in `finally`.

**Gates**

- Fresh/restored AI opens Preview automatically. Busy feedback appears within
  100 ms; typical first meaningful list paint is within 500 ms and a 1,500-row
  list within one second.
- Unchanged 500 ms ticks cause zero list commits. Focus paint is within one frame;
  row/page scrolling starts within 100 ms; both directions select the exact
  occurrence.
- DPJ rows are usable when targets exist; Ledigajobb cannot return selectors and
  then silently expose zero rows. A true empty result carries stable evidence.
- A post-AI edit disables Save/List and shows `requires-ai-run` within one second
  without a remote authority request.

### Phase 5 — Operator lifecycle, emulation, Save, and popup parity — complete

**Findings implementation-closed:** audit 32, 37–49, 50–54; audit 50–54 retain
headed-validation gates.

- Route Save, Discard, Disable, candidate navigation, render inspection, and
  render-mode Set through one serialized operator-action lifecycle. An accepted
  action paints button/busy feedback within 100 ms, rejects duplicate input
  visibly, and ends in exactly one visible success or reason-specific failure.
- Save busy state starts before poll drain/context/signals/lock/load/gates/capture.
  Preserve one current-page request, frozen binding/generation/selectors,
  authoritative adoption, Todo refresh, and guaranteed interaction cleanup.
- Restore Discard confirmation, full-operation busy state, and success/failure
  toast. Disable confirms every pending session state and restores the exact prior
  posture on cancel/failure. Clean candidate navigation is direct; pending
  navigation confirms exactly once.
- Make render-mode Set authoritative and visible for first-config and existing
  properties. Refusal/error remains in the dialog with a toast; success survives
  popup close/reopen. Disable same-mode inspection and present the meaningful
  no-JS/JS comparison order.
- Keep emulation helpers explicit about target mobile/desktop mode. Serialize
  session transitions and prevent polling/restoration from applying stale modes.
  Every debugger boundary has a typed stage/deadline; recover only proven
  extension-owned stale attachments and never steal a foreign debugger owner.
- Keep local signal projection event-driven with a 500 ms backstop and remote
  authority single-flight at 15 seconds. Coalesce one trailing run; explicit
  Refresh may force one authority refresh.
- Anchor toasts to the popup viewport through fixed/portal presentation. Restore
  staged marking action hierarchy/copy without removing approved keyboard access.
- Restore operator-facing parity polish within binding decisions: adaptive Todo
  sections and retained manual per-property overrides; cancellable checklist
  checking but locked publication; accurate publishing copy; retain email after
  successful login. Do not restore global Ctrl/Cmd action shortcuts (D-30).
- Convert every operator-triggered console-only return into an obviously disabled
  control or visible toast. Production Activity may supplement, never replace,
  operator feedback.

**Gates**

- Every accepted slow action paints feedback within 100 ms and leaves no orphan
  spinner, curtain, shield, debugger posture, or disabled control on any abort.
- Disable/Discard/candidate navigation preserve an unsaved post-AI session on
  cancel. Save emits one request and adopts its complete response.
- Render mode survives reopen. Toast is visible at top, middle, and bottom of a
  long Preview. D-30's absence of global action shortcuts remains test-locked.
- Mobile marking and desktop silent transitions pass success, failure, retry,
  concurrent-poll, reload, and restoration cases observer-free.

### Phase 6 — Contracts, capture, consent, and publication hygiene — complete

- Update the authoritative marking/interaction specification to remove the stale
  plain-click exclusion text and reference the shared target corpus. Record which
  legacy presentation rules are projections rather than semantic authorities.
- Validate capture clone restoration, consent exclusion, hidden-overlay behavior,
  script/style/noscript stripping, extension branch removal, production/debug
  diagnostics, current-page Save payload, and atomic publication payload from one
  canonical fixture and headed samples.
- Preserve suppressed nodes as excluded decisions without leaking suppressed text
  or extension/freeze artifacts to marking rows, Preview, AI HTML, Save payloads,
  or publication artifacts.
- Keep incomplete coverage fenced. Checklist testing may reach Alpha mutation
  preflight where safe, but the final selector publication request is forbidden
  until 7/7 authority is genuinely present.

**Gates**

- Zero consent-suppressed or extension branches in any extraction/payload
  surface; zero non-empty production script/style/noscript bodies; zero
  freeze-authored inline values.
- One current-page Save request; incomplete coverage emits zero final publish;
  an unknown atomic outcome reuses the same idempotency identity.

### Phase 7 — Automated and performance acceptance — complete

- Add focused regression tests with each implementation slice, then run
  `pnpm lint`, `pnpm check`, focused Vitest, full `pnpm test`, `pnpm build`,
  `pnpm build:debug`, and `pnpm verify`.
- Run clean P14, P15, P16, P17, P18, P20, P23, and a checked-in P25 parity gate.
  Extend P14 to include BODY/HTML hit stacks, 20k-node scaling, thousands of
  marks, Shift, exact fragment/overlap unmark, continuous scroll, and current
  owner-scan code.
- Extend stabilization gates with lost-reply commands, nested viewport owners,
  capture-clone restoration, extension animation, no-scroll lazy posture,
  root/pseudo/SVG restoration, input firewall, and fragment navigation.
- Extend popup gates with 1,500 rows, zero-commit unchanged ticks, auto Preview,
  all slow-action feedback, post-AI pending confirmation, toasts, render-mode
  authority, Todo, shortcuts, checklist phases, and credentials retention.
- A gate failure is fixed at its owning layer. Budgets are not widened to accept a
  regression, and observer-contaminated evidence is discarded.
- Clean-source authority at `f5c82960`: `pnpm verify` passes 140 files / 1,376
  tests; P14, P17, P18, P20, and P23 browser smokes pass 48/48, 19/19, 14/14,
  4/4, and 25/25. The checked-in P25 aggregate validates P14, P15, P16, P17,
  P18, P20, and P23 with `cleanSourceSet: true`; all 16 strict p95 comparisons
  and long-task budgets pass.
- The first headed launch exposed a host Wayland/DRM stall followed by a
  zero-sized XWayland SIGTRAP. The repository launcher now pins X11 and falls
  back to its headed 1280×900 Xvfb display when RandR has no usable dimensions;
  a real legacy launch reached CDP, loaded the candidate, bound the side panel,
  and enabled controls under that posture.

### Phase 8 — Full headed frame-by-frame legacy/rewrite matrix — in progress

- Use the repository `live-browser`, `live-round`, and `live-watch` skills only.
  Run one implementation/profile at a time. Keep website observers detached while
  the extension owns emulation or render inspection; attach bounded samplers only
  after acknowledgement and detach before the next transition.
- Re-resolve candidate validity immediately before each property. Exercise every
  valid candidate sequentially in pinned legacy and rewrite. Retain exact N/A,
  404, not-found, and external-authority reasons outside the pass denominator.
- For both implementations record timestamped frames and state transitions for:
  both render types; curtain/adopt/mount/frame/fallback/ack stages; reveal path,
  scroll owner, growth, true bottom, freeze, restore, lazy state; layer count,
  border width/style/color/radius/order; visible and markable source/fragment
  counts; hover and gesture acknowledgement; plain/Shift/Alt/exact clear/context;
  continuous scroll fade/reposition/restore; resize; invisible/consent targets;
  AI phases and second run; Content List first paint and both routes; post-edit
  freshness; Save; Discard; silent 1920×1080 shield/scroll/highlight; payloads;
  checklist fence; console, message-port, network, and debugger hygiene.
- Report medians, p95, worst frame, long tasks, source/rect/cardinality diffs,
  semantic selector diffs, payload artifacts, and screenshots. Compare only
  equivalent document generations and flag site drift explicitly.
- Do not issue the final Lynx publication request.
- Ledigajobb now has one complete pinned-legacy reference with all 13 physical
  stages and zero publish attempts. Its failing controls, frame starvation,
  scroll/resize posture, AI availability, and silent posture are retained as
  measured legacy behavior rather than rewritten into a synthetic pass.
- The first rewrite Ledigajobb pass proved activation and resize posture, then
  exposed observer defects before a comparable result could be claimed:
  render-mode controls were judged while their real menu was closed; gesture
  waits depended on page-owned timers that reveal/freeze may suspend; a terminal
  AI return to idle was allowed to wait for the full outer timeout; and
  bridge-relative `/body[1]/…` source identities were incorrectly resolved as
  document-global XPath. These are now fail-closed, regression-covered harness
  contracts. The partial run remains recovery evidence only and will not enter
  the comparison denominator.
- The same pass measured one 174 ms post-scroll geometry task on a 724-candidate
  document. The renderer no longer performs a queue-shifting breadth-first scan
  in that path; the clean rerun must still prove the strict no-long-task budget
  before the optimization is accepted as sufficient.
- The next clean rewrite Ledigajobb run passed preflight, both render modes,
  activation, and resize, but exposed a product identity race: adding
  `data-uf-consent-hidden` to an already bridged page node was treated as a
  geometry-only mutation even though removing that node from the flattened DOM
  bridge renumbered later same-tag siblings. The result was 32 unresolved
  painted sources and Shift/Alt gestures recorded against the preceding sibling.
  Consent-boundary membership changes now force a coalesced structural rebuild;
  mutations inside an already suppressed subtree remain ignored. The run also
  measured a 145 ms frame in the same delayed stale-overlay reconciliation and
  remains failure evidence outside the final comparison denominator. Rerun the
  unchanged gate after the identity fix before deciding whether any independent
  renderer optimization is still required.
- That rerun reduced unresolved paint sources from 32 to nine. The remaining
  nine were a live-probe parity defect: its bridge-relative XPath resolver
  skipped extension roots but not consent-hidden/WXT/helper roots, while the
  production bridge intentionally excludes all of them. The resolver now uses
  the production exclusion rules and has a hidden-same-tag-sibling regression;
  no product visibility rule or consent suppression behavior was weakened.
- With source resolution corrected, the next run isolated seven real edge-paint
  defects. Reachability sampled the full source rectangle after only an overlap
  check, so corners above or below the viewport produced empty hit stacks that
  were accepted as permissive paint proof. Reachability and the live observer
  now sample only the strict viewport intersection using the same center and
  one-pixel inset corners; zero-area boundary contact is rejected. A regression
  covers both top- and bottom-clipped sources whose in-viewport pixels are all
  covered.
- The corrected sampler left one bottom navigation with exactly one CSS pixel
  inside the viewport. Because its exclusion border is wider than its visible
  source area, the renderer now requires more than one CSS pixel of paint extent
  on both axes before admitting a rectangle. The regression also proves that a
  physically hit-reachable one-pixel sliver remains unpainted.
- A subsequent run exposed an independent physical-control race before marking
  activation: the site target remained foregrounded after render inspection, so
  CDP mouse coordinates sent to the side panel could be ignored while its DOM
  still reported an enabled checkbox. Popup actions now foreground the real
  side-panel target, center the control, prove `elementFromPoint` reaches the
  control/label, and only then dispatch trusted input. Activation evidence now
  fails within 45 seconds instead of waiting three minutes for a click that
  never started a lifecycle.
- The next clean rewrite activation exposed a one-frame restored-scroll race.
  Ledigajobb's sticky header committed its final hit-test posture after the
  synchronous marking render, so one correctly classified include border could
  remain visible beneath the header until the ordinary scroll debounce repainted
  it. Marking activation now waits one extension-owned presentation frame,
  reconciles every retained rectangle against the current hit stack, and waits
  one further paint frame before acknowledging readiness. The captured clock's
  bounded fallback preserves hidden/frozen-document liveness, and a regression
  proves the stale box is removed before the activation acknowledgement resolves.
- The following exact-key gesture gate separated one harness error from one real
  contract defect. Its target used native sibling ordinals while rewrite marks
  use the flattened bridge, so a consent-suppressed preceding sibling made every
  correct gesture look unrelated. P25 now derives and resolves target identity
  with the same consent/extension/shadow/slot flattening as the product. The run
  also proved that plain input could clear exclusions but not Alt-created
  inclusions. The renderer now indexes every painted explicit owner, plain input
  resolves that owner before an exclusion, and the content handler commits a
  semantic clear. Shift remains required to create/widen exclusions.

### Phase 9 — Evidence, review, commit, and push — in progress

- Write `.reimplementation/p25-legacy-parity-closure-report-2026-08-28.md` with
  the new overall result, contract matrix, per-property results, performance,
  accuracy, similarity, payload, external blockers, and retained artifact paths.
- Update `plan.md`, the execution checklist, and durable knowledge only with
  verified reusable conclusions. Mark every issue closed, external, invalid, or
  still blocking; do not call partial evidence complete.
- Review the entire diff for correctness, races, data loss, stale authority,
  accessibility, performance, and production debug leakage. Fix every
  significant finding and rerun its gates.
- Explicitly stage intended files, commit, refresh the graph, fetch, push
  non-force to `origin/re-write`, verify 0 ahead / 0 behind, and reindex pushed
  HEAD. Use the repository completion notification only after all acceptance is
  genuinely green.

## Acceptance matrix

| Contract | Automated proof | Headed proof |
| --- | --- | --- |
| Render type | normalized identity, exact paint ACK, authoritative Set | both modes, meaningful transition only, survive reopen |
| Reveal/freeze | transactional commands, lost replies, quiet proof | smooth top/mid/bottom/restore, actual owner, no stuck bottom |
| Lazy loading | ordered suppression, media ledger, no-scroll retention | stable height/resources and clean captured markup |
| Marking targets | shared corpus and O(hit) resolver | exact plain/Shift/Alt/clear/context on every candidate |
| Overlay visual | visibility, layer, cardinality, scroll tests | frame-aligned borders/layers/fade/focus; zero invisible paint |
| Performance | 20k-node/2k-mark scaling, no long tasks | p95 ≤1.05× legacy; no input task >50 ms |
| Content List | 1,500 rows, virtualization, O(1) routing | auto-open, ≤1 s heavy paint, both directions |
| AI/spinners | exact phases/generation/finally tests | ≤100 ms feedback, truthful phases, second run terminal |
| Freshness | brain signal generation and zero remote dependency | physical post-edit projection <1 s |
| Emulation/shield | queued target-mode/failure/reload tests | 412×960 marking, 1920×1080 silent, scrolling retained |
| Save/Discard | pending fence, one mutation, all abort cleanup | confirmation, feedback, one Save, authoritative adoption |
| Consent/payload | clone restore and stripping fixtures | no suppressed/extension/freeze artifacts |
| Publication | atomic idempotency and coverage fence | checklist phases only; no incomplete final publish |

## Regression risks and controls

- A spatial index can route to stale geometry. Fence it by document, render
  generation, viewport generation, layer order, and connected source; retire it
  before posture changes.
- Faster activation can reintroduce premature readiness. Only replace waits with
  measured stability proof; never acknowledge before exact generation terminal.
- Cleanup retries can destroy a newer session. Every command and teardown is
  idempotent and exact-generation scoped.
- Visibility fixes can erase extraction state. Apply paint reachability only to
  presentation; canonical rows remain authoritative.
- Virtualization can break keyboard or two-way focus. Retain semantic list
  positions, accessible ordinal/state names, and occurrence-indexed scroll.
- Direct signal rendering can bypass brain authority. Consume only committed
  brain signals and drain the exact generation before AI/Save.
- Debugger recovery can steal a foreign owner. Retry only a proven
  extension-owned stale attachment; otherwise fail visibly and restore posture.
- Legacy similarity can undo deliberate safety. The locked decisions above are
  release constraints and must be covered by regression tests throughout.

## Definition of done

- Every confirmed defect in the P25 audit is closed or proven external/invalid
  with retained evidence; no code-owned red cell remains.
- All focused, full, build, verify, P14–P20, P23, and P25 gates pass on the exact
  source committed for release.
- Every valid candidate completes the observer-free rewrite workflow and its
  comparable legacy reference. Performance, accuracy, visual similarity,
  payload, and lifecycle results meet the acceptance budgets.
- Consent suppression, Shift-only exclusion creation, keyboard Content List,
  explicit posture, one-page Save, and publication fences remain intact.
- The final source and evidence are reviewed, committed, pushed non-force, graph
  indexed, and synchronized 0 ahead / 0 behind. P25 is then marked complete.
