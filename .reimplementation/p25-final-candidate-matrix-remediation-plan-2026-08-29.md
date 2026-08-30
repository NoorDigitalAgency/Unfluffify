# P25 final candidate-matrix remediation plan — 2026-08-29

## Objective

Close every code-owned red cell exposed by the first uniform headed rewrite
matrix, retain every intentional rewrite contract, and rerun the complete
legacy/rewrite comparison from one clean pushed source commit. P25 remains open
until no valid candidate has a code-owned failure.

Consent suppression remains correct extraction hygiene. Suppressed commerce,
account, contact, assembly, country, cookie, modal, and similar blocking UI
must remain absent from visible overlays, Content List routes, captures, AI and
Save payloads, and publication artifacts.

## Immutable baseline

- Rewrite source: `0c1e9fde35da1ba127c6abe88e142d7e087a437f`
- Rewrite bundle inventory:
  `14ff8c8249bb2964dbf79da04d2630abc70d27e2fa929496fd35e27940ba3d34`
- Pinned legacy source: `28974c2a0c859c91a7167f4757cf84a47ea31e28`
- Browser/profile authority: repository launcher, one headed Chromium at a
  time, the same launcher-owned profile fingerprint, no observer attached while
  the extension owns render inspection or emulation.
- Publication authority: the run-lifetime guard forbids and counts every final
  Lynx publish attempt. No final selector publication is permitted.

The exact baseline runs are retained under
`output/playwright/p25-live-comparison/runs/` and are never overwritten.

| Property | Baseline result | Exact red contract |
| --- | --- | --- |
| Ledigajobb | FAIL | 228 ms marking input task; 168 ms scroll task; 100 ms resize task; 174 ms AI feedback; transient silent visual root absence |
| DPJ | FAIL | site navigation returned `chrome-error://chromewebdata/` for the JavaScript-on stage; 97 ms silent resize task |
| Acne Specialisten | FAIL | 60 ms silent resize task |
| Acapedia | N/A | authoritative live candidate preflight resolved N/A; publication fence remained green |
| Assist24 | PASS | all 13 stages green |
| Aleris | PASS | runtime candidate currently valid; all 13 stages green |
| Arno | FAIL | three covered/invisible exclusion sources painted; no stable gesture target; workflow/silent/publication cascade |
| ArkivIT | FAIL | Content List row-to-page route selected a skip-link row, scrolled to the wrong terminal position, and painted no focus |
| Teknikhallen | FAIL | post-inspection control recovery race; 61 gesture owner-normalization rejections; 293/301/277/238 ms input tasks; Run AI readiness absent; silent posture cascade |
| Humanova | FAIL | downward wheel started from a terminal scroll position; Content List activated a nominally available `span` but painted no correlated focus |

## Evidence classification

### Product-owned and actionable

1. Exclusion presentation can still outlive actual paint reachability. Arno
   retained canonical decisions correctly but painted three sources that the
   independent hit stack classified as covered/invisible.
2. Content List availability is weaker than its activation promise. ArkivIT and
   Humanova exposed enabled semantic rows that could not produce a correlated
   page focus. The rewrite currently calls `setFocus` before starting its
   scroll; pinned legacy scrolls first and then computes the focus highlight.
3. Large-page marking/silent input windows contain tasks above 50 ms. The worst
   examples are Teknikhallen and Ledigajobb. Current evidence does not yet prove
   whether each task belongs to the page, a full structural bridge refresh, or
   geometry cleanup; attribution is mandatory before a code change.
4. AI feedback exceeded the 100 ms visual-acknowledgement budget once on
   Ledigajobb. The first local busy/spinner paint must not depend on an authority
   request or the later popup projection.
5. Render/emulation transition controls can be observed transiently disabled
   after a successful JavaScript-off inspection. Product state and the driver
   must share a terminal acknowledgement rather than racing the next action.

### Harness-owned or external, still requiring truthful closure

1. DPJ's `chrome-error://chromewebdata/` document is a real site/navigation
   failure, not a render-mode product assertion. The rerun must retain it as
   external if it recurs and must pass if the exact page loads.
2. Humanova's scroll probe dispatched a positive wheel delta while already at
   the lower terminal position. The probe must establish movable geometry in
   the requested direction before measuring fade; it must never reinterpret a
   no-op wheel as an extension failure.
3. Already-configured pages may have no clean gesture target in the current
   viewport. The probe must sweep bounded reachable viewports and report
   `configured-no-clean-target` distinctly. It must not erase an authoritative
   saved selector merely to manufacture a pass.
4. A transient first silent stage may recover on the following stage. Each
   stage must establish and prove its own starting posture so one prior failure
   neither cascades nor silently repairs the recorded result.

## Implementation slices

### 1. Paint truth and row routability

- Make hard/default/explicit/silent exclusion rendering use only the canonical
  source's own currently visible and independently paint-reachable rectangles.
  Never borrow a descendant rectangle for an exclusion presentation.
- Revalidate connectedness, composed visibility, viewport intersection, and
  paint hit reachability at the final draw. Remove stale keyed overlay nodes in
  the same transaction while retaining canonical extraction decisions.
- Make Preview availability represent the actual focus promise: reject clipped,
  off-document, permanently viewport-bound, covered, and non-paintable technical
  targets while preserving their disabled rows and reason text.
- Reorder row activation to match legacy's successful path: resolve and scroll
  first, then paint focus on the next captured presentation frame after the
  target reaches stable geometry. Fence the occurrence by projection, bridge
  generation, document, row, and physical Element identity.

### 2. Input-path performance

- Capture attributable main-thread profiles for the failing marking gesture,
  scroll, and resize windows after activation, with external observers detached
  during extension-owned emulation.
- If the extension owns a task, remove document-scale work from the input
  window. Coalesce structural mutations behind viewport motion, refresh only
  affected presentation branches when identity is unchanged, and split any
  unavoidable bridge or overlay cleanup into generation-fenced chunks.
- Preserve the immediate compositor fade, keyed node identity, one idle redraw,
  intersection-bounded geometry, and exact final classification. Do not raise
  thresholds, hide measurements, or trade correctness for a synthetic pass.
- Report shared site-owned tasks separately and compare the equivalent pinned
  legacy window. A rewrite task or p95 above `1.05x` legacy remains blocking;
  every extension-owned input task must stay at or below 50 ms.

### 3. Immediate feedback and transition terminals

- Paint Run AI busy feedback from the trusted local action before starting
  capture/authority work. Later brain projection adopts the same occurrence
  instead of starting a second spinner or delaying cleanup.
- Give render-mode controls one exact post-terminal readiness signal. The next
  stage waits for that signal and the controls' enabled state; it does not infer
  readiness from elapsed time.
- Keep all cleanup in `finally`: no stale curtain, shield, spinner, emulation,
  preview, or lock posture may leak into the next stage.

### 4. Evidence-driver corrections

- Position the actual viewport owner inside a movable range before directional
  wheel evidence, retaining the original position and restoring it afterward.
- Establish every stage's required marking/silent posture independently and
  record the exact acknowledgement used.
- Improve gesture target preparation for configured pages without mutating
  saved production selectors. Retain rejection counts for visibility,
  reachability, capability, identity, and owner normalization.
- Wait through bounded legitimate control transitions and fail with the exact
  terminal blocker. Continue to reject unavailable controls, wrong documents,
  or identity mismatches.

## Regression and acceptance plan

- Add focused regressions for:
  - covered and composed-invisible exclusions retaining state but painting zero
    rectangles;
  - own-source exclusion geometry never falling back to descendants;
  - Preview rows for skip links, clipped spans, off-document menus, and covered
    targets becoming disabled with truthful reasons;
  - scroll-before-focus ordering, generation cancellation, smooth-scroll
    completion, and correlated two-way focus;
  - structural mutation trains during scroll/resize producing no unbounded
    input task and one final authoritative redraw;
  - immediate Run AI acknowledgement and one spinner occurrence;
  - post-inspection terminal readiness and independent stage posture setup;
  - scroll probes selecting a movable direction and restoring the owner.
- Run focused tests, `pnpm verify`, `pnpm build:debug`, and the complete
  `pnpm performance:p25` composite on the final source.
- Push the clean implementation commit, then rerun every valid candidate from
  that exact HEAD through the repository `live-*` workflow. Finalize every run,
  including failures and N/A dispositions.
- Generate authentic pinned-legacy/rewrite pair artifacts where both sides have
  comparable stages. Mark legacy-unsupported contracts honestly instead of
  weakening rewrite acceptance. Authentic legacy debug remains N/A.
- Update the P25 audit and closure report with the final overall result,
  contract matrix, property matrix, performance/accuracy/similarity results,
  payload and consent evidence, external blockers, commit identities, and exact
  artifact paths.
- Review, commit, non-force push, reindex pushed HEAD, verify zero ahead/behind,
  and send the configured completion notification only when the acceptance
  state is truthful.

## Execution result — 2026-08-30

All four implementation slices and their focused regressions are complete. The
uniform rewrite matrix on pushed product source `af59ce9d` passes all thirteen
stages for all nine valid candidates (117/117). Two final rerun-only paint
escapes were then closed: ordinary covered implicit marks are pruned live, and
silent nodes retain identity while the viewport fade transaction is active.

The fresh pinned-legacy batch reaches real activation on all nine pages but
cannot produce a passing comparison: Render Inspection is independently
non-terminal, five pages paint invisible/covered sources, no page completes the
shared target/AI/Content List/silent flow, and every AI envelope contains
executable source. The generated production matrix is correctly FAIL with zero
missing eligible candidates and zero publication attempts. This is a rewrite
sanity PASS and a strict legacy-pair FAIL; no baseline failure is waived.

Acapedia and 3D Prima remain external blocks, Bigbag remains N/A, and Aleris was
promoted by substantive live preflight. Consent suppression, Shift-only
exclusion creation, Alt inclusion, semantic keyboard rows, 412×960 marking,
1920×1080 silent posture, one-page Save, and the final-publication fence are all
retained.

### Post-matrix acceptance hardening

A later clean P25 composite exposed three shared-gate regressions that the
headed candidate matrix did not isolate: progressive geometry paid one browser
frame for every two-target sub-millisecond chunk, duplicate Window and
VisualViewport scroll signals could restart the same quiet transaction, and a
real nested touch gesture could move the document compositor while the manual
fallback also moved the correctly resolved nested owner.

The run-plan now consumes up to four cheap geometry chunks behind an 8 ms frame
budget, coalesces only identical normalized root/visual scroll signatures, and
binds each touch gesture to a freshly proven owner. When that owner is nested,
the shield reserves single-touch panning before input and restores the document
scrolling element inside the browser scroll dispatch while advancing the nested
owner. Document-owned wheel/touch stays native and multi-touch pinch remains
available. Focused P14, P15, and P23 smoke gates are green; the final clean P25
composite and exact pushed-head candidate rerun remain the terminal evidence
steps.

The first clean composite then isolated one final strict-ratio miss: small
Shift-hover p95 was 36.7 ms against a 35.175 ms limit because a new semantic
target still waited for the same frame throttle used by within-target pointer
motion. Hover now paints the leading target/modifier boundary in the trusted
input task and keeps only trailing movement frame-coalesced.

The next full sample separated three remaining mechanisms rather than accepting
the initial smoke result: P14's rewrite harness still modeled the old trailing
scheduler, rewrite hover nodes were created/deleted instead of using legacy's
retained rectangle pool, and the two-frame proof began after the automation
round trip rather than at the actual paint. One shared scheduling helper now
drives product and harness; the renderer prewarms and reuses hover boxes; and
the same two-frame proof is anchored in the trusted paint task. A repeated P15
physical run also found eventless terminal compositor motion, so the nested
document guard now survives a 160 ms quiet window with a gesture-scoped frame
watchdog. The first clean composite then exposed a P15 evidence-boundary race:
the following touch scenario sampled while the preceding +620 px wheel packet
was still settling. P15 now proves a 250 ms wheel-quiet window and an exact,
locked 900 px document baseline before raw touch input; the isolated headed
rerun is 36/36 with nested movement and zero document movement. Focused tests,
TypeScript checks, and P14/P15 headed gates are green; a second clean P25 and the
exact pushed-head live matrix remain the terminal evidence steps.

## Release constraints retained

- Plain click remains unmark-only; Shift alone creates widened exclusions; Alt
  creates eligible explicit inclusions.
- Marking remains 412x960 mobile; silent Preview remains 1920x1080 desktop.
- Hidden decisions remain canonical while invisible overlays never paint.
- Semantic keyboard Content List rows and two-way routing remain required.
- Save remains exactly one current-page-only request with authoritative
  adoption; final Lynx publication remains fenced.
