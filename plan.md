# P24 exact-readiness and cross-property parity remediation

**Status:** Executed, acceptance incomplete. P22 remains externally blocked;
P23 is complete. P24's exact-readiness and Hub fence slices are implemented,
but the headed matrix retains product red cells documented in
`.reimplementation/p24-exact-readiness-cross-property-report-2026-08-27.md`.

## Goal

Make every operator-visible ready state correspond to the exact current
document, property, session, and reveal/freeze occurrence that is actually able
to receive input. Correct the legacy/rewrite harness so it measures canonical
marking decisions instead of a monotonic dirty-event counter, then repeat the
complete headed comparison on every supplied valid candidate page and separate
code defects from Hub deployment and candidate-data blockers.

## Current facts

- Baseline `0f31b54a0c81edb82686eccade9a60fe418a052c` is clean and synchronized
  0 ahead / 0 behind `origin/re-write`.
- The previous P24 harness read `contentStatus().markedCount`, but that field is
  `userToggleCount`: it increases for every successful toggle, including a
  clear. Its `finalCount < afterShift` assertion therefore makes a successful
  widened-owner clear impossible to pass.
- The harness chose arbitrary headings, paragraphs, and list items without
  proving current canonical markability or that the target was uncovered. A
  plain exclusion click on already excluded content is a specified no-op, not a
  gesture failure.
- `activateContentMain()` starts `runPageVisitRitual()` fire-and-forget,
  installs marking, and immediately acknowledges `interactionsReady`. While the
  ritual is still walking/frozen, `pageInspectionActive` presents a full
  pointer-owning curtain. The popup consequently releases its preflight and
  enables later actions before the visible page can receive marking input.
- Acne evidence captured that race directly: activation was reported complete
  with the page still at the reveal bottom, motion not yet frozen, and no
  delivered hover transitions. Aleris, where the ritual had already settled,
  was responsive.
- P23's captured presentation clock, latest-only hover scheduling, canonical
  evaluator, stable overlay reuse, and incremental motion maintenance remain
  correct. P24 must not reintroduce a second evaluator or weaken Shift/Alt,
  exact-owner clearing, hidden-exclusion, consent, extraction, Save, or lock
  contracts.
- Ledigajobb's 45-second AI observation and the legacy run exceeding 62 seconds
  were labeled too aggressively by the old harness; a non-terminal operation
  inside the contract timeout is long-running, not proven wedged.
- Five prior rewrite Saves returned Hub `stale_fence`, production `/context`
  returned 404, and 3D Prima's supplied candidate URL is a site-owned 404. P24
  will audit those authorities but will not add unsafe retries, bypass a fence,
  or count an invalid page as a valid candidate pass.

## Decisions

- Replace the fire-and-forget ritual seam with one shared promise per exact
  document/URL occurrence. Page-load preparation and marking activation join the
  same occurrence; neither starts a second walk.
- Activation acknowledges success only after the exact ritual reaches a
  terminal result, the document/property occurrence is still current, the
  curtain is gone, and canonical marking listeners are installed. Skipped
  no-scroll rituals may complete successfully; stale, failed, timed-out, or
  identity-mismatched rituals fail visibly and restore the prior posture.
- Keep the popup preflight and Run AI unavailable while activation is preparing.
  No intermediate boolean may masquerade as readiness.
- Expose an explicit current decision-row count while retaining
  `userToggleCount` as the dirty/edit sequence authority. The harness must diff
  normalized `contentRows` and exact overlay ownership for every gesture.
- Select gesture targets from current visible canonical overlay/row state and
  verify eligibility before physical input. Test plain no-widen, Shift widen,
  exact widened-owner clear, Alt explicit include, and context-menu actions as
  independent physical occurrences.
- Preserve intentional consent suppression: suppressed commerce/account/contact
  and other blocking UI stays hidden and excluded from overlays, captures,
  marking rows, AI HTML, and payloads.
- Treat AI as terminal only on an authoritative completed/failed/cancelled
  outcome or the configured timeout. Every terminal path must clear both popup
  busy state and the page curtain for the same run generation.
- Audit Hub stale-fence and endpoint deployment as separate authority systems.
  Fix and deploy only a proven code-owned defect; otherwise retain the client
  fence and report the external blocker precisely.

## Non-goals

- No change to marking taxonomy, selector precedence, extraction grammar,
  consent selectors, payload schema, public permissions, or Lynx publication
  fences.
- No extra Save request, automatic stale-fence retry, fake candidate, or
  production-to-alpha authority mixing.
- No final Lynx selector publication while coverage or candidate authority is
  incomplete. Alpha checklist navigation may be tested up to that boundary.
- No regression to page-clock rAF, full-document hover scans, or legacy global
  state.

## Implementation phases

### R1 — Exact reveal/activation occurrence

- Refactor `runPageVisitRitual()` in
  `src/entrypoints/content-loader.content.ts` to return/join one promise carrying
  URL, document nonce, lifecycle generation, route generation, terminal status,
  lazy-expansion result, and frozen-at-bottom proof.
- Make `activateContentMain()` asynchronous. Await the exact occurrence before
  final listener reconciliation and acknowledge only when the request URL,
  document nonce, lifecycle generations, authority, curtain, and listener set
  are still current.
- Keep the page curtain mounted while preparing. In all stale/failure paths,
  retire the attempted marking presentation, release the curtain, restore the
  prior silent/device posture through existing popup `finally` paths, and return
  a reason-specific failure.
- Make `preparePageVisit` join the same promise and return its terminal reason
  rather than inspecting a later string latch.
- Regression tests: duplicate activation joins one walk; activation waits for
  reveal/freeze; skipped no-scroll completes; hidden document waits; stale URL,
  lifecycle, and replacement-document occurrences fail; listeners exist only at
  success; every failure clears the curtain and restores the popup posture.

### R2 — Exact marking and silent readiness

- Add explicit status fields for current normalized decision-row count,
  presentation phase, ritual occurrence, and physical listener readiness; do not
  overload the dirty toggle count.
- Ensure the popup regards activation as complete only after both content
  readiness and requested 412x960 emulation are current. Silent/highlight mode
  similarly waits for desktop posture, shield, selector projection, retained
  overlay geometry, and reveal/freeze ownership before Content List is enabled.
- Retain P23 scheduling. If focused evidence still finds delivery loss after the
  readiness race is removed, add only a validated hover-overlay XPath hint or
  renderer-root listener ownership; canonical resolution remains the fallback.
- Regression tests cover Run AI disabled during preparation, first physical
  hover/click immediately after success, scroll/resize retention, and no stale
  transition applying an old device posture.

### R3 — Correct the legacy/rewrite evidence harness

- Replace arbitrary DOM target selection in
  `.temp/p24-side-by-side/run-flow-production.mjs` and its reusable helpers with
  visible, connected, current-generation canonical target discovery.
- Compare normalized row maps and exact XPath/classification changes before and
  after each physical input. A clear passes when its owned explicit row is
  removed, independent of the monotonic dirty counter.
- Record delivered pointer events, presentation latency, overlay identity,
  viewport/freeze/lazy state, semantic selector output, payload hygiene,
  Content List row counts, and two-way focus evidence with explicit N/A reasons.
- Use the configured AI timeout and distinguish `long_running`,
  `terminal_error`, and `ui_wedge`. Stabilize Content List before reading rows.
- Add a deterministic local harness self-test proving that a designed no-op is
  not a failure and a successful clear cannot be misreported.

### R4 — AI, Save, and Hub authority audit

- Trace AI start/poll/terminal generation through popup, background, content
  organ, and curtain. Add missing `finally` cleanup or exact-generation tests
  only where a code-owned terminal path can retain busy presentation.
- Reproduce `stale_fence` against the authoritative Hub revisions. Inspect the
  Hub mutation-fence implementation if the request and latest websocket lease
  match; fix, test, commit, and deploy Alpha only for a proven backend defect.
- Verify default environment endpoint selection. A production Hub missing the
  rewrite `/context` contract remains a deployment blocker unless the extension
  is incorrectly addressing it.
- Preserve exactly one current-page Save per click and complete response
  adoption. Never retry or publish around an authority refusal.

### R5 — Automated and clean-build acceptance

- Run focused entrypoint, stabilization, marking, popup, AI, Save, content-list,
  emulation, and harness tests after each slice.
- Run `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`,
  `pnpm build:debug`, `pnpm verify`, P14–P20, P23, and the new P24 gate on a
  clean source set.
- Acceptance: activation acknowledgement never precedes reveal terminal proof;
  immediate post-ack physical hover/click works; gesture row diffs pass; no
  hidden exclusion paint; silent geometry survives scroll/resize; no unchecked
  message errors; clean production/debug artifacts.

### R6 — Full headed side-by-side candidate comparison

- Use the repository `live-browser`/`live-round` managed Chromium workflow and
  the pinned legacy commit `28974c2a0c859c91a7167f4757cf84a47ea31e28`.
  Copy the configured profile posture, but never launch OS Chrome or attach an
  external debugger during extension-owned emulation.
- Run the full flow, one property at a time, on Ledigajobb, DPJ, Aleris, Acne
  Specialisten, Acapedia, Assist24, Arno, ArkivIT, Teknikhallen, and Humanova.
  Probe 3D Prima and Bigbag, but classify site-owned 404/no-candidate outcomes
  outside the valid-candidate pass denominator.
- For both implementations record activation/reveal/freeze, 412x960 marking,
  all modifier/context gestures, overlay responsiveness, consent/hidden paint,
  AI start/terminal timing, payloads, Save/freshness where authority permits,
  Content List/two-way focus, 1920x1080 silent mode, scroll/resize/lazy behavior,
  Discard, checklist fencing, and console/network cleanliness.
- Do not issue the final Lynx publish request. Report overall result, contract
  matrix, performance/accuracy/similarity statistics, every code defect, and
  every external or invalid-candidate blocker with retained artifacts.

### R7 — Evidence, review, and publication

- Write the durable P24 report under `.reimplementation/`, update this plan,
  the execution checklist, and `.copilot/knowledge.md` with the false-metric and
  premature-readiness lessons.
- Review the complete diff and generated artifacts, explicitly stage intended
  files, commit, refresh the code graph, fetch, push without force to
  `origin/re-write`, verify 0 ahead / 0 behind, and index the pushed HEAD.

## Test matrix

| Contract | Automated proof | Headed proof |
| --- | --- | --- |
| Activation occurrence | joined exact promise, stale document/URL tests | no usable toggle before reveal/freeze terminal |
| Marking semantics | canonical row-map gesture tests | plain/Shift/Alt/exact-clear/context menu |
| Responsive presentation | P23 + immediate-post-ack input gate | frame/latency comparison against legacy |
| Hidden/consent exclusion | visibility/evidence/payload tests | no invisible paint; suppressed nodes absent |
| AI lifecycle | exact run-generation terminal cleanup | start delay, terminal timing, curtain release |
| Content List | stabilized rows and typed two-way routing | row/page focus in marking and silent modes |
| Emulation/silent posture | serialized transition tests | 412x960 marking, 1920x1080 silent |
| Save/authority | one-request/freshness/fence tests | HTTP outcome and complete adoption |
| Reveal/freeze/lazy | one-visit occurrence tests | smooth top/mid/bottom/start, freeze retained |
| Payload/publication | capture hygiene and coverage fence tests | payload inspection; no final Lynx publish |

## Regression risks and rollback rules

- Awaiting reveal can make activation visibly longer. The popup must show a
  truthful preparing state and bounded failure, never restore premature input.
- Two callers can race one ritual. One occurrence promise and generation-fenced
  terminal cleanup must prevent duplicate walks or one caller clearing another's
  curtain.
- Dynamic pages can rebase rows during a gesture. Harness assertions use exact
  owner XPath/classification and current-generation rows; an invalidated target
  is retried as a new measurement, not counted as a semantic failure.
- Backend fence repair can broaden mutation authority accidentally. Any Hub
  change requires focused concurrency tests and Alpha deployment only; client
  fences remain unchanged.
- If the full suite finds a page that legitimately never becomes load-ready,
  the existing bounded load fallback remains. Do not turn activation back into
  fire-and-forget.

## Acceptance criteria

- Every successful Enable marking acknowledgement proves the exact current
  document is revealed/frozen, the preparation curtain is gone, and the first
  physical hover/click is accepted immediately.
- Plain click never widens; Shift alone widens; Alt creates explicit inclusion
  on eligible implicit content; exact widened-owner unmark works without a key;
  hidden exclusions never paint; canonical extraction state is unchanged.
- The corrected harness cannot report a successful clear as failure and cannot
  treat a designed no-op on already excluded content as a gesture defect.
- Silent highlights and Content List become ready without remote-poll delay,
  remain current through scroll/resize, and work in both focus directions.
- AI/Save busy presentation terminates exactly with its authoritative operation;
  Save remains one request and stale authority remains fenced.
- All automated production/debug gates pass, the full valid-candidate headed
  legacy/rewrite matrix is retained, code-owned regressions are fixed, and
  external/candidate blockers are explicitly separated from product failures.

## Execution record — 2026-08-27

- R1 completed: page-load, render-mode preparation, and activation now join one
  exact URL/document/lifecycle/route occurrence. Activation awaits a prepared,
  frozen ritual and installed interactions before acknowledging success.
- R2 partially completed: explicit decision-row count, presentation phase, and
  ritual status are exposed; strict popup acknowledgement is enforced. The live
  matrix still found one Humanova invisible-target overlay and Teknikhallen could
  not apply emulation.
- R3 completed: canonical row-map evidence replaces the monotonic dirty-toggle
  count, and exact widened-owner clearing is tested independently.
- R4 completed for the proven Hub defect: Hub commit `ff4a460` refreshes
  persisted mutation authority under the gate; Alpha release
  `v2026.11-alpha.14` is live. Eight current rewrite Saves returned one HTTP 200
  apiece with no `stale_fence`.
- R5 completed: final `pnpm verify` passed (130 files / 1,181 tests), debug
  build passed, P14 passed 192/192, P15 36/36, P16 13/13, P17 19/19,
  P18 14/14, P20 4/4, and P23 24/24 on clean source sets where required.
  The clean P15 pass first exposed and then verified the terminal orphan-root
  cleanup repair.
- R6 completed as an evidence pass, not an acceptance pass. Nine rewrite core
  flows reached AI; eight reached one successful Save. Current legacy Alpha
  runs were mostly fenced before AI, so the pinned retained production baseline
  is used for comparable performance while current failures are reported
  separately.
- R7 report completed. P24 remains open for Teknikhallen emulation,
  Ledigajobb AI/list, DPJ freshness/list, Humanova hidden paint, and
  observer-free sequential-transition rechecks.
