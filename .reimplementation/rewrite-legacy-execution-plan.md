# Rewrite–Legacy Decision Execution Plan

**Status:** Active follow-up implementation plan

**Authority:** [`rewrite-legacy-decision-spec.md`](./rewrite-legacy-decision-spec.md)

**Created:** 2026-08-20; extended 2026-08-21

**Branch:** `re-write`

## 1. Outcome

Bring the rewrite into conformance with all 104 resolved rewrite-versus-legacy
decisions without weakening its architecture, data-authority model, or marking
semantics. P0–P11 established and accepted the original 91-decision baseline.
P12–P20 own the 13 decisions from the follow-up deep comparison. Delivery is
complete only after automated gates and a witnessed production-build browser
run pass.

This plan supersedes `parity-plan.md` as the active resume pointer. The older
plan remains useful provenance and defect evidence.

## 2. Execution rules

1. **Do not infer completion from existing code.** The worktree contained
   uncommitted implementation changes when this plan was written. They belong to
   the user and must be preserved, audited, and tested. A decision is complete
   only when its acceptance evidence passes.
2. **One semantic source.** Update the decision spec first if implementation
   uncovers a genuine ambiguity. Never encode a new behavior only in code or a
   test.
3. **Red–green slices.** Add or identify a failing focused test before changing
   behavior. End each slice with the focused tests plus `pnpm lint` and
   `pnpm check`; end every phase with `pnpm test`.
4. **Small, revertible commits.** Do not mix backend, domain semantics,
   stabilization, and popup styling into one commit. Record the commit SHA next
   to the completed slice.
5. **Production/debug parity is explicit.** Every debug-only feature requires a
   negative production-build assertion as well as a positive debug-build test.
6. **Generated page-world source.** TypeScript is the authored source; generated
   JavaScript is a build artifact with a parity gate. Never patch the generated
   program as the only source change.
7. **No destructive git cleanup.** Preserve unrelated or pre-existing worktree
   edits. Partition them only after reviewing their diff and tests.
8. **Backend live gate.** If `UnfluffifyHub` changes, commit and push its
   `develop` branch, run `gh workflow run 'Alpha Release'`, and monitor the
   workflow/deployed version until the new Alpha is live before testing the
   extension against it.

## 3. Dependency sequence

```text
P0 Contract alignment
  -> P1 Runtime and architecture
    -> P2 Canonical marking + composed document
      -> P3 Fast interaction + overlay grammar
        -> P4 Reveal/freeze + emulation
          -> P5 Authority, configuration, auth, persistence
            -> P6 Lock, candidacy, session, navigation
              -> P7 Preview and inspection
                -> P8 Popup UX, debug gating, recovery
                  -> P9 End-to-end integration
                    -> P10 Automated release gates
                      -> P11 Witnessed live acceptance
                        -> P12 Executable traceability repair
                          -> P13 Clean capture, shadow, and consent lifecycle
                            -> P14 Single-pass interaction and browser benchmark
                              -> P15 Frozen-page interaction shield
                                -> P16 Durable render inspection
                                  -> P17 Canonical preview projection
                                    -> P18 Transient UI and production toasts
                                      -> P19 Targeted decomposition
                                        -> P20 Integrated release and live acceptance
```

P0–P11 are the completed baseline. The follow-up sequence is intentionally
conservative. A later phase may start early only when it consumes stable public
contracts from all predecessors and does not modify their source of truth.

## 4. Phase plan

### P0 — Align the contract corpus and freeze the baseline

**Primary decisions:** all 91 as documentation/test traceability.

**Work**

- Update `contract-invariants.md`, `MARKING_AND_HIGHLIGHTING_LOGIC.md`,
  `PROPERTY_LOCK.md`, `.copilot/knowledge.md`, `.copilot/plan.md`, and relevant
  README text so none contradict the latest specification.
- Explicitly remove the old claims that selectors re-enter branch evaluation,
  inaccessible closed-shadow hosts become excluded, silent highlighting allows
  page actions, users may disable managed-tab mobile emulation, or manual scale
  controls remain supported.
- Add a decision-to-test traceability matrix. Every I/U/D ID names its unit,
  integration, build, and/or live acceptance evidence.
- Capture the current `git diff` and focused-test status without modifying or
  discarding the user's in-progress implementation.

**Exit gate**

- One unambiguous authority chain.
- A machine-checkable list contains every ID exactly once in the decision
  register and at least once in the traceability matrix.
- Baseline test failures, if any, are recorded rather than hidden.

**Evidence artifacts:** [`decision-test-traceability.md`](./decision-test-traceability.md) and
[`p0-baseline.md`](./p0-baseline.md).

### P1 — Runtime, cross-realm authority, and panel resilience

**Primary decisions:** I-02–I-06, U-10, U-15, U-16, D-31.

**Work**

- Audit `src/background/brain/*`, `rewrite-brain-runtime.ts`, persistence,
  keepalive, and the typed messaging contracts for sole decision birth,
  sequence/idempotency, and MV3 rehydration.
- Remove remaining popup/content duplicate authority or raw cross-realm command
  paths; retain event-first updates with slow reconciliation polling.
- Create a TypeScript-authored page-world program and deterministic generation
  step for `src/page-world/program.js`; extend the existing artifact parity test.
- Store large transient HTML once in the background/offscreen repository and
  pass scoped handles plus content hashes through the bus.
- Extract cohesive typed controllers from `src/entrypoints/popup/main.tsx` in
  small steps. Add an error boundary and root-remount/rehydration controller.

**Likely files**

- `src/background/{index,rewrite-brain-runtime,persistence,keepalive}.ts`
- `src/background/brain/*`, `src/messaging/*`, `src/storage/*`
- `src/entrypoints/{page-world.content.ts,popup/main.tsx}`
- `src/page-world/program.js`, `src/popup/App.tsx`

**Required evidence**

- Worker restart rehydrates durable facts and never replays one logical signal
  twice.
- Panel root corruption/remount preserves background-owned session state and
  creates exactly one subscription set.
- Production build fails if generated page-world JavaScript is stale.

### P2 — Canonical marking model and composed-document capture

**Primary decisions:** I-01, I-19–I-22, U-13, U-14, D-01–D-06.

**Work**

- Implement the reconciled clean-baseline algorithm: defaults first, selector
  inclusion/exclusion as simulated user actions second, then delete all selector
  provenance and suppression state.
- Ensure branch recomputation can reconsider default posture only within the
  affected surface and never re-match selectors or overwrite an explicit row.
- Keep one evaluator for overlay, silent, preview, and submission projections.
- Add serialized toggle execution, DOM generation/fingerprint guards, stale-run
  rejection, and branch-splice invariants without routine full-page reconcile.
- Centralize the toggleable-boundary predicate and use WeakMap identity.
  Temporary cross-realm IDs must be scoped and cleaned.
- Preserve semantic XPath identity for collapsed wrappers while projecting
  visible-descendant geometry.
- Capture early closed `attachShadow` calls, flatten every retrievable root,
  preserve host/light DOM, and keep composed XPath/capture ordering identical.
- Strip extension, consent-helper, automation, freeze, and diagnostic artifacts
  before XPath indexing, hashing, capture, preview, or submission.

**Likely files**

- `src/domain/{selector-seed,evaluate,boundary,taxonomy,xpath}.ts`
- `src/content/marking/{dom-view,flatten,engine,store,submit,resolve}.ts`
- `src/entrypoints/content-loader.content.ts`, page-world bridge source

**Required evidence**

- Selector-seeded rows are indistinguishable from the equivalent sequence of
  user actions and remain correct after later toggles.
- Open, captured-closed, nested, slotted, and inaccessible-closed shadow fixtures
  produce expected markability, XPath, and sanitized HTML.
- Overlay and submission classifications agree for every canonical fixture.
- Stale concurrent toggles cannot commit or draw.

### P3 — Fast marking interaction and legacy visual grammar

**Primary decisions:** I-36, U-02, U-12, D-07–D-12, D-14–D-16.

**Work**

- Port legacy observer coalescing, geometry caching, pointer-hit caching, and
  bounded multi-sample stabilization onto the canonical evaluator.
- Keep pointermove/scroll paths to repositioning and O(1) hover resolution; no
  full document walk from a hover, scroll frame, or extension-owned mutation.
- Implement the right-click marking-action menu, duplicate physical-click
  suppression, invalid-target feedback, press-and-hold Space recovery, and the
  temporary-disabled visual state.
- Make overlay geometry scrollbar-gutter-, zoom-, resize-, and RTL-aware.
- Apply legacy thick/dashed/animated border grammar using the rewrite colors.
- Gate silent annotation/copy UI to debug builds. Keep preview rows pointer-only
  and outside keyboard focus.

**Likely files**

- `src/content/marking/{engine,hit-testing,overlay,renderer,resolve,silent-highlight}.ts`
- `src/theme-components.css`, `src/content/copy.ts`
- `tests/src/content/marking/*`, production/debug package tests

**Performance gates**

- Hover performs no full collection/evaluation pass.
- One physical click yields one commit and one immediate acknowledgement.
- On the standard large-DOM fixture, p95 toggle-to-paint is no slower than the
  same legacy benchmark by more than 10%, and no semantic output differs.
- Observer storms coalesce and do not create unbounded queued repaint work.

### P4 — Reveal, persistent freeze, and crawler emulation

**Primary decisions:** I-31–I-35, U-17, D-20–D-24.

**Work**

- Make reveal runs visibility-aware and single-flight. Hidden tabs defer and
  coalesce; concurrent callers join; a newer generation/scope yields one rerun.
- Preserve the chosen reveal sequence, growth detection, ten-pass bound, bottom
  freeze point, and original-scroll restoration.
- Freeze CSS transitions/animations, Web Animations, SVG SMIL, media, computed
  moving properties, page timers/rAF, and page-owned idle callbacks while
  extension scheduling remains live.
- Normalize only motion-hidden entrance content. Preserve semantic hidden state.
- Maintain the freeze for late nodes, restarted animation/media, relevant
  style/class changes, hover targets, and lifecycle restoration. Teardown must
  restore only extension-owned changes.
- Enforce Googlebot Smartphone emulation continuously for every managed tab and
  self-heal after navigation/debugger detach/rebinding. Remove manual simulation
  and scale controls while preserving the silent-only desktop-preview exception.

**Likely files**

- `src/content/stabilization/{reveal,freeze,emulation,index}.ts`
- authored page-world bridge and generated `src/page-world/program.js`
- `src/background/render-emulation-runtime.ts`
- `src/entrypoints/content-loader.content.ts`

**Required evidence**

- Tall lazy pages, late growth, hidden-tab activation, and concurrent activation
  produce exactly one authoritative final ritual and correct restored scroll.
- Motion-source matrix stays frozen through late insertion and lifecycle events.
- Underlying page actions cannot activate in silent mode, but wheel/touch scroll
  and extension overlays remain responsive.
- Managed tabs cannot remain in desktop/non-crawler mode except during the
  explicit silent desktop preview.

### P5 — Backend authority, configuration, authentication, and persistence

**Primary decisions:** I-07–I-13, I-15, I-18, I-26–I-28, U-07, D-28.

**Work**

- Audit extension and Hub contracts for `(environmentKey, siteId, pageKey)`,
  singular fenced/idempotent save, server timestamps/revisions, exact delegated
  JWT, background corpus ownership, and Hub-owned publication.
- Make configuration per-field editable but atomically validated/committed as a
  complete profile.
- Invalidate JWT on normalized endpoint/environment/backend identity change;
  never send the previous credential to the new service.
- Persist background AI completion with session/generation identity. Reopened
  panels may present it only to the matching session and never auto-apply it.
- Implement authoritative-shrink adoption plus prominent integrity warning and
  fail-closed subsequent mutation until proof/clean refresh clears it.
- Verify every read/write failure follows the fail-open-read/fail-closed-write
  split and blocks only the surface actually affected.

**Likely files/repositories**

- Extension: `src/background/{services,auth-token-monitor,page-context-runtime}.ts`,
  `src/lynx/*`, `src/storage/*`, schemas and messaging contracts.
- Hub: `/home/rojan/Documents/Git/GitHub/UnfluffifyHub` only where its current
  `develop` implementation does not already satisfy the contract.

**Required evidence**

- Contract tests cover successful, stale-fence, duplicate-operation,
  misleading-status GraphQL, unexpected-shrink, and publication-unknown paths.
- A profile identity change clears authentication in one atomic transition.
- Background AI completion survives panel close and MV3 worker restart while a
  mismatched/new session cannot adopt it.
- If Hub changed, Alpha Release is live before P9/P11 remote acceptance begins.

### P6 — Lock, candidacy, sessions, and navigation

**Primary decisions:** I-14, I-16, I-17, I-23–I-25, I-34, I-37,
U-08, U-10, U-11, U-18c, D-25, D-27.

**Work**

- Preserve background-owned, presence-qualified lock renewal and explicit
  destructive same-user transfer with rotated fencing.
- Keep complete-feed reconciliation deterministic and surface conflict/loss as
  suspended, recoverable session state. Poll every 15 seconds only under the
  approved presence/grace rules.
- Implement adaptive Todo expansion and preserve per-property manual choices.
  Page-type assignment stays feed-owned; remove any client assignment POST.
- Keep panel binding sticky to the opening tab until explicit rebind/reopen.
- Apply new-session rules for SPA page-key change and terminal rules for reload,
  definitive config deletion, tab unregister, and transfer.
- Implement inline candidate-navigation confirmation and the controlled cleanup
  sequence. On failure, restore usable state instead of unregistering.
- Add bounded fail-open navigation inspection without bypassing known dirty
  state or explicit confirmation.

**Likely files**

- `src/background/{lock-runtime,lock-browser-lifecycle,page-context-runtime}.ts`
- `src/lock/*`, `src/domain/todo.ts`, `src/popup/todo-recovery.ts`
- `src/content/stabilization/spa-guard.ts`
- `src/entrypoints/{content-loader.content.ts,popup/main.tsx}`

**Required evidence**

- Multi-tab lock scenario covers hidden/unselected tabs, panel closure, stale
  reacquisition, transfer, candidate suspension/recovery, and tab close.
- Candidate row click navigates the bound tab after inline confirmation; cancel
  changes nothing; failure restores the original usable state.
- SPA change and reload never leak the previous page's draft or overlays.

### P7 — Preview, silent highlighting, and render-mode inspection

**Primary decisions:** U-18b, U-18d, D-13, D-17–D-19, D-26.

**Work**

- Fully wire inspection overlay state and deterministic teardown.
- Keep manual render-mode comparison; add a watchdog and retryable recovery but
  never infer from partial inspection.
- Preserve the complete internal preview classification and map it to the simple
  production view; expose full detail only in debug.
- Restore mouse correspondence: row hover emphasizes the page highlight and row
  click scrolls it into view. Do not add row keyboard focus.
- Enforce constrained frozen preview: scrolling and extension preview actions
  work; underlying page interactions, hover UI, and navigation do not.

**Likely files**

- `src/content/marking/{silent-highlight,overlay,renderer}.ts`
- `src/content/stabilization/render-mode.ts`
- `src/entrypoints/{content-loader.content.ts,popup/main.tsx}`
- `src/popup/{App,view,store}.tsx`/`.ts` as applicable

**Required evidence**

- Production/debug classification snapshots differ only as specified.
- Preview remains aligned through scroll/resize/layout stabilization.
- Page buttons, links, menus, forms, and hover targets are blocked while preview
  list/highlight interaction and scrolling remain responsive.
- Every inspection timeout/exit path removes temporary state and allows retry.

### P8 — Popup UX, theme, configuration actions, and debug gating

**Primary decisions:** I-29, I-30, U-01–U-06, U-09, U-18a, U-18e,
D-29, D-30, D-32.

**Work**

- Implement responsive hybrid layout, shipped branding/icons, legacy kebab
  navigation, property/page context hierarchy, and one prioritized notice.
- Keep full theme customization live and ensure dark lock/Todo/Send surfaces use
  the same token system.
- Restore **Empty cache for current domain** in main configuration and the
  macOS-style close button bound to **Unregister current tab**, with destructive
  confirmation and structured failure feedback.
- Use curated production toasts and lock copy. Gate detailed Activity,
  diagnostics, silent copy/annotations, trace/direct/bus/spinner/state tools, and
  expanded classifications out of production artifacts.
- Restore dynamic action icons for the five approved states.
- Keep global keyboard shortcuts absent; preserve only Shift/Alt, Space, and
  Escape behavior already required by marking.
- Connect panel-only busy/modal scroll locking with scroll-position restoration
  and cleanup on every terminal path.

**Likely files**

- `src/popup/{App,copy,theme,view,event-log}.tsx`/`.ts`
- `src/entrypoints/popup/main.tsx`, `src/popup.css`, theme CSS
- manifest/action icon logic in background and generated manifest configuration

**Required evidence**

- Production package contains no callable debug toolkit path.
- Every theme renders lock, Todo, Send, configuration, and modal states with
  legible semantic contrast.
- Unregister/cache operations confirm, target only the requested tab/domain, and
  report failure without leaving a false-success UI.
- Busy/modal teardown always restores panel scroll; page preview scroll is never
  locked by panel state.

### P9 — End-to-end integration and failure recovery

**Primary decisions:** integrated verification of all 91.

**Scenarios**

1. Onboard/configure → authenticate → candidate feed → lock acquisition.
2. Managed-tab mobile enforcement → reveal/growth/freeze → silent highlighting.
3. Enable marking → defaults + one-shot selectors → Shift/Alt/right-click/Space
   interactions → fast overlay acknowledgement.
4. Open/captured-closed shadow marking → artifact-free snapshot → multi-page AI
   run → panel close/reopen → constrained post-AI preview.
5. Save singular page → adopt authoritative corpus → silent mode → Todo update →
   Hub-owned Send to Lynx.
6. Discard → clean baseline; SPA change/reload → new session; candidate navigation
   → inline confirmation and controlled transition.
7. Candidate feed loss/conflict/recovery, lock transfer, endpoint change, worker
   restart, panel render recovery, and unexpected authoritative shrink.

**Exit gate**

- Scenario tests assert state in background, content, panel, Hub fixture, and
  saved/captured artifacts—not only visible text.
- No scenario relies on fixed sleeps where a lifecycle event/condition exists.

### P10 — Automated release gates

Run and retain output for:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build:debug
pnpm verify
```

Also verify:

- The cutover/reachability test was not weakened.
- The generated page-world parity gate is green.
- Production manifest/package exposes no debug-only routes or controls.
- The performance benchmark and output-equivalence corpus are green.
- Hub contract tests and Alpha deployment checks are green if backend changed.

### P11 — Witnessed live acceptance and release handoff

Use a production extension build against the live Alpha backend and `bonliva.se`.
Observe browser console, background state, and network calls while the user runs
the workflow.

**Required live matrix**

- Todo candidate navigation targets the correct bound tab/page.
- Reveal reaches each growth bottom, waits for lazy content, freezes at the final
  bottom, and restores the original scroll.
- Mobile emulation is already active and remains forced without a desktop-toggle
  workaround.
- Silent and marking borders use rewrite colors plus legacy thickness, dash, and
  animation grammar.
- Marking remains responsive on a large page; Shift/Alt/right-click/Space match
  the specification.
- Silent/post-AI surfaces allow scrolling and preview interaction but cannot
  operate or navigate the page.
- Shadow-flattened content is visible, markable, captured, and submitted.
- Save/Discard/Todo/Send, candidate recovery, lock transfer, endpoint token
  invalidation, panel close/reopen, and reload recovery all behave correctly.

Record the extension commit, Hub commit/deployed Alpha version, build artifact,
browser version, property/site identity, and pass/fail evidence. Fix any failure
in the owning phase and rerun its focused gate plus P9–P11.

### P12 — Repair the contract and make traceability executable

**Primary decision:** N-12.

**Work**

- Extend the decision register and traceability corpus from 91 to 104 decisions
  without renumbering the original I/U/D rows.
- Make the traceability validator require every decision exactly once in the
  register and at least one decision-specific executable assertion or explicitly
  named live/build acceptance check in the matrix.
- Validate every referenced automated-evidence path on disk. Repair the stale
  references currently named as `tests/popup-view-projector.test.ts`,
  `tests/page-toast.test.ts`, `tests/property-lock-banner-mode.test.ts`,
  `tests/mark-mode-fsm.test.ts`, `tests/popup-render-mode.test.ts`,
  `tests/render-mode-inspector.test.ts`,
  `tests/render-mode-inspection-handlers.test.ts`, and
  `tests/preview-tooltip.test.ts`.
- Add or relocate focused tests for behavior those stale paths were meant to
  prove. Do not satisfy traceability by deleting evidence or retaining
  non-executable prose alone.

**Exit gate**

- The checker fails for a missing decision, duplicate register row, nonexistent
  test path, or evidence entry without an executable/live/build acceptance.
- All 104 rows pass the repaired traceability gate.

### P13 — Make capture artifact-free and consent property-scoped

**Primary decisions:** N-01, N-10, N-11; reinforces D-04 and D-05.

**Work**

- While serializing the live composed DOM, identify consent-helper changes by
  their marker, remove only extension-added inline style properties, and only
  then strip the marker and all remaining `data-uf-*` artifacts.
- Feed direct rendered capture, fingerprints, and AI submission from that one
  clean representation. Never restore or mutate the live consent UI merely to
  capture it.
- Move consent suppression under recognized-property authority so it runs on
  candidate and non-candidate pages, including pages without an editor or panel.
  Keep ordinary consent subtrees in place but invisible and non-interactive;
  close native HTML dialogs so their modal state cannot block the document.
- Observe and suppress late-added consent UI continuously. Retain suppression
  through Save, Discard, preview/marking changes, and same-property navigation;
  end it only on Unregister, property-configuration removal, leaving the
  property, or extension unload.
- Retain the early force-open closed-shadow hook and its documented observable
  `host.shadowRoot` compatibility tradeoff. Keep MAIN-world generation parity
  and artifact stripping mandatory.

**Exit gate**

- Focused tests cover direct capture, fingerprinting, and submission through the
  real serialization pipeline, including no leaked marker or helper style.
- Composed-DOM fixtures cover open, forced-open formerly closed, nested, and
  slotted shadow content without extension artifacts.
- Browser/integration tests cover non-candidate property pages, ordinary
  overlays, native dialogs, late insertion, same-property transitions, and all
  terminal cleanup paths.

### P14 — Initialize once and prove interaction performance in a browser

**Primary decisions:** N-05 and N-06.

**Work**

- Give the marking/silent engine one initialization transaction that calculates
  defaults, applies selector seed rows as ordinary explicit user markings,
  builds indexes, and renders through one composed-DOM bridge pass.
- Remove redundant whole-document refreshes from constructors, activation, and
  selector seeding. Reuse geometry and branch caches without changing canonical
  evaluation or selector influence.
- Retain the pure evaluator equivalence gate but rename its descriptions and
  evidence so it does not claim browser interaction coverage.
- Add deterministic real-browser rewrite-versus-preserved-legacy benchmarks for
  silent activation, marking activation, hover, physical click through committed
  and painted overlay, scroll repositioning, and mutation stabilization.
- Assert identical rows and classifications before comparing timings. Use fixed
  fixtures, warmup, samples, percentiles, explicit budgets, and retained output
  so CI failures are diagnosable rather than timing noise.

**Exit gate**

- Instrumented initialization proves one composed-document traversal/bridge
  activation for defaults plus optional selector seed.
- Pure semantic equivalence and real-browser semantic/performance gates pass on
  both small and large fixtures with recorded percentile evidence.

### P15 — Freeze page interaction with a transparent shield

**Primary decision:** N-02; refines D-19.

**Work**

- Mount a reversible transparent shield above page content and below every
  extension-owned marking, preview, and debug surface during silent highlighting
  and post-AI preview.
- Ensure the underlying page cannot become the pointer target, so CSS-only hover,
  JavaScript hover/click handlers, buttons, menus, selections, and navigation do
  not activate.
- Preserve native wheel and touch scrolling and all extension highlight/preview
  interactions, including debug copy controls, without granting general page
  interaction.
- Cover document, composed shadow content, viewport/zoom changes, route changes,
  and every terminal teardown path without leaving an orphan shield.

**Exit gate**

- Real-browser tests prove that CSS-only and JavaScript hover menus do not open,
  page clicks do not fire, scrolling still works, and extension UI remains
  operable in silent and post-AI modes.
- Save, Discard, Unregister, property exit, reload, failure, and extension unload
  all remove or correctly re-adopt the shield.

### P16 — Make render inspection a durable background-owned session

**Primary decision:** N-03; reinforces D-13 and D-26.

**Work**

- Persist an inspection session token, generation, property/tab scope, intended
  mode, and terminal status in the background-owned repository so the session
  survives MV3 worker restart, page reload, and panel closure.
- Have the replacement document adopt the pending session during earliest
  content bootstrap, render the requested inspection surface, then acknowledge
  paint with the matching token and generation after browser paint opportunity.
- Clear the session only for matching success, explicit failure, bounded timeout,
  cancellation, terminal navigation, Unregister, or teardown. Ignore stale
  acknowledgements and never let a prior `true`/`false` pull end the new session.
- Fail open with retryable operator feedback if inspection cannot be restored;
  do not infer or silently fabricate the render mode.

**Exit gate**

- Integration tests cover replacement-document adoption, paint acknowledgement,
  stale generation rejection, panel close, worker restart, timeout, navigation,
  failure, cancellation, and Unregister.
- A browser reload test proves the inspection surface is present before the
  background clears the matching session.

### P17 — Transport and project the canonical preview model

**Primary decisions:** N-04 and N-09; reinforces D-16–D-18 and U-18d.

**Work**

- Project explicit-included, implicit-included, excluded, undetected, immutable,
  and closed-shadow classifications directly from the canonical evaluator into
  the content bus contract. Do not collapse to binary and reconstruct later.
- Extract concise, safe, human-readable page text for each row. Production leads
  with that text and a simple included/excluded status; debug adds XPath, full
  classification, selector/technical details, and diagnostic tooltips.
- Preserve pointer-only row behavior, exact-target hover emphasis, click-to-scroll,
  shadow provenance, and stable row identity across mutations.
- Add a production-build negative assertion for XPath, internal classifications,
  selector detail, and diagnostics, plus a debug-build positive assertion.

**Exit gate**

- A canonical corpus proves all six classifications survive transport unchanged
  and are projected correctly in production and debug.
- Browser tests prove readable text, pointer hover/click behavior, exact scroll
  targeting, shadow rows, mutation stability, and absence of keyboard focus.

### P18 — Centralize transient surfaces and production toasts

**Primary decisions:** N-07 and N-08; reinforces U-03, U-06, and D-30.

**Work**

- Introduce one context-sensitive transient-surface manager for popup menus,
  marking context menus, tooltips, previews, dialogs, and similar dismissible UI.
- Opening one menu closes competing menus; outside-click closes the applicable
  surface; Escape closes only the topmost dismissible surface. When none exists,
  Escape exits preview through normal restoration.
- Never bind Escape to Save, Discard, marking disablement, or cancellation of
  irreversible/busy work. Integrate the right-click marking menu without
  bypassing canonical marking commands.
- Make production toasts replaceable and manually closable. Auto-dismiss success
  after 1.8 seconds, warning after 4 seconds, and danger/error after 6 seconds;
  keep persistent conditions in notices, banners, or status surfaces.

**Exit gate**

- Focused ordering tests cover mutual exclusion, outside-click, nested/topmost
  Escape handling, preview exit, right-click integration, busy protection, and
  restoration of scroll/interaction state.
- Fake-clock and browser tests prove tone-specific timing, visible manual close,
  replacement behavior, cleanup, and production/debug consistency.

### P19 — Decompose only after behavior is stable

**Primary decision:** N-13; continues U-15.

**Work**

- Freeze each corrected behavior with characterization and contract tests before
  moving code.
- Incrementally extract typed configuration, render-inspection, preview, Todo,
  maintenance, consent, and transient-surface controllers, plus focused React
  sections with narrow props and explicit background-owned commands.
- Move one cohesive seam per commit. Preserve public contracts, authority,
  lifecycle cleanup, signal ordering, and the completed P12–P18 evidence.
- Avoid a big-bang component rewrite or any new popup/content decision authority.

**Exit gate**

- The large popup/content entrypoints no longer own the listed cohesive concerns;
  import-boundary and authority tests remain green.
- Each extraction commit passes its characterization tests, `pnpm lint`,
  `pnpm check`, and the full suite without snapshot-only behavioral claims.

### P20 — Run integrated release gates and witnessed live acceptance

**Primary decisions:** N-01–N-13 integrated acceptance.

**Work**

- Run and retain `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build:debug`, and
  `pnpm verify`, plus the pure and real-browser performance/equivalence gates.
- Inspect the production artifact for debug-only exclusions and the debug artifact
  for required internal preview and inspection capabilities.
- Exercise a production build against the live Alpha backend and `bonliva.se`:
  non-candidate consent suppression, native-dialog closure, late consent UI,
  silent/post-AI shield behavior and scrolling, inspection across reload/panel
  closure, human-readable preview rows, debug classifications, transient/Escape
  behavior, tone-aware toasts, shadow content, and interaction performance.
- Record extension commit, production artifact digest, browser version, property
  identity, site URL, benchmark output, Hub commit, and deployed Alpha version.
- If `UnfluffifyHub` changes, commit and push `develop`, run
  `gh workflow run 'Alpha Release'`, and monitor until that version is live before
  final browser acceptance.

**Exit gate**

- All automated, build, benchmark, and witnessed live checks pass with retained
  evidence. A failure returns to its owning P12–P19 phase and reruns P20.

## 5. Resume checklist

- [x] P0 — Contract alignment and baseline
  - Commit: `8cde4c49` (`Align rewrite contract decisions`)
  - `pnpm vitest run tests/decision-traceability.test.ts` — 1 file / 2 tests passed.
  - `pnpm lint && pnpm check && pnpm test` — lint and all TypeScript checks passed;
    75 files / 622 tests passed.
  - Baseline/push evidence: [`p0-baseline.md`](./p0-baseline.md).
- [x] P1 — Runtime and architecture
  - Commits: `ca923627` (`Generate page-world runtime from TypeScript`) and
    `1f0786d1` (`Harden panel and cross-realm payload recovery`).
  - `pnpm vitest run tests/src/domain/import-boundary.test.ts tests/integration/rewrite-cutover.test.ts tests/src/messaging/bus.test.ts tests/src/messaging/contracts.test.ts tests/src/background/brain.test.ts tests/src/popup/signal-cursor.test.ts tests/page-world-source-parity.test.ts tests/src/popup/root-recovery.test.ts tests/transfer-payload-store.test.ts tests/capture-page-snapshot-handler.test.ts tests/offscreen-entrypoint.test.ts tests/src/popup/entrypoint.test.ts`
    — 12 files / 91 tests passed.
  - `pnpm lint && pnpm check` passed; `pnpm test` — 79 files / 632 tests
    passed.
  - Worker rehydration, monotonic signal heads, idempotent keepalive leases,
    consumed-once cursors, popup root remount/rehydration, scoped SHA-256 payload
    transfer, and stale generated-page-world rejection are covered by the phase
    evidence above.
- [x] P2 — Canonical marking and composed document
  - Commit: `0a13b7b3` (`Reconcile composed marking semantics`).
  - `pnpm vitest run tests/src/domain/boundary.test.ts tests/src/domain/evaluate.test.ts tests/src/domain/selector-seed.test.ts tests/src/domain/widening.test.ts tests/src/content/marking/dom-bridge.test.ts tests/src/content/marking/marking.test.ts tests/src/page-world/program.test.ts tests/page-world-source-parity.test.ts tests/golden/ai-snapshot.test.ts`
    — 9 files / 117 tests passed.
  - `pnpm lint && pnpm check` passed; `pnpm test` — 79 files / 637 tests
    passed.
  - Evidence covers one-shot selector-as-user rows, branch-only evaluation and
    splice invariants, WeakMap identity, stale generation/fingerprint rejection,
    collapsed-wrapper geometry, open/captured-closed/nested/slotted/inaccessible
    shadow cases, and artifact-free rendered/static submission HTML.
- [x] P3 — Fast interaction and visual grammar
  - Commits: `ba91b542` (`Harden marking interaction and overlays`) and
    `57ef9015` (`Complete P3 interaction evidence`).
  - `pnpm vitest run tests/c4-content-entrypoint.test.ts tests/src/content/marking/interaction.test.ts tests/src/content/marking/marking.test.ts tests/src/content/marking/dom-bridge.test.ts tests/src/popup/app.test.ts --reporter=dot`
    — 5 files / 146 tests passed.
  - `pnpm lint && pnpm check` passed; `pnpm test -- --reporter=dot` — 80 files /
    643 tests passed.
  - Evidence covers pointer-capturing overlays with Space release/recovery,
    right-click Include/Exclude/Widen/Clear, physical-gesture deduplication,
    invalid-target acknowledgement and production-safe copy, bounded geometry
    stabilization, branch-only repainting, RTL/zoom/scrollbar client geometry,
    suspended animation state, exact border grammar, debug-only silent XPath
    copy affordances, logo/icon assets, and pointer-only preview rows.
- [x] P4 — Reveal/freeze and emulation
  - Commit: `bc69b56d` (`Make reveal and crawler posture persistent`).
  - `pnpm lint && pnpm check` passed.
  - `pnpm vitest run tests/src/background/emulation-policy.test.ts tests/src/background/render-emulation-runtime.test.ts tests/src/content/stabilization/stabilization.test.ts tests/src/page-world/program.test.ts tests/page-world-source-parity.test.ts tests/c4-content-entrypoint.test.ts --reporter=dot`
    — 6 files / 59 tests passed.
  - `pnpm test -- --reporter=dot` — 81 files / 649 tests passed.
  - Evidence covers hidden-tab deferral/coalescing, joined concurrent callers,
    generation/scope follow-up, ten-pass reveal and scroll restoration, persistent
    CSS/WAAPI/SMIL/media/timer/rAF/idle freezing, semantic-hidden preservation,
    late/restarted motion sources, extension-owned teardown, and continuous fixed
    Googlebot Smartphone posture with only the held silent desktop exception.
- [x] P5 — Authority/config/auth/persistence
  - Commit: `86a7f7dd` (`Harden backend authority and durable AI state`).
  - `pnpm lint && pnpm check` passed.
  - `pnpm vitest run tests/src/background/services.test.ts tests/src/background/property-authority.test.ts tests/src/background/property-snapshot-authority.test.ts tests/src/background/startup.test.ts tests/src/storage/settings.test.ts tests/src/messaging/contracts.test.ts tests/src/popup/app.test.ts tests/src/popup/entrypoint.test.ts --reporter=dot`
    — 8 files / 156 tests passed.
  - `pnpm test -- --reporter=dot` — 82 files / 655 tests passed.
  - Hub audit: `dotnet test UnfluffifyHub.sln --no-restore --nologo` on clean
    `develop` at `9bdce9f` — 96 tests passed; no Hub change was required.
  - Evidence covers singular fenced/idempotent saves, server-owned revision and
    timestamp contracts, full background corpus ownership, Hub-only publication,
    authoritative-shrink adoption with durable prominent write blocking and clean
    recovery, fail-open reads/fail-closed writes, per-field Change/Cancel with an
    atomic complete-profile commit, atomic normalized backend/JWT invalidation,
    and AI completion scoped to exact editor session/run generation across panel
    closure and MV3 worker restart without automatic application.
- [x] P6 — Lock/candidacy/session/navigation
  - Commit: `23aa8faa` (`Control candidate navigation and session boundaries`).
  - `pnpm lint && pnpm check` passed; `pnpm test` — 83 files / 663 tests
    passed.
  - Evidence covers presence-qualified background lock retention, rotated-fence
    destructive transfer and suspended-feed recovery, 15-second candidate
    reconciliation, adaptive per-property Todo expansion, feed-owned page types,
    sticky opening-tab binding, terminal SPA/reload/config-deletion/unregister
    boundaries, inline confirmed same-tab candidate navigation, bounded
    fail-open inspection warnings, and cleanup failure restoration without
    unregistering the tab.
- [x] P7 — Preview and inspection
  - Implementation commit: `54f62756` (`Constrain preview and inspection lifecycles`).
  - `pnpm lint && pnpm check` passed.
  - `pnpm vitest run tests/src/content/organ.test.ts tests/src/content/input-firewall.test.ts tests/src/popup/preview-classification.test.ts tests/src/popup/render-mode-inspection.test.ts tests/src/background/render-emulation-runtime.test.ts tests/src/content/marking/dom-bridge.test.ts tests/src/popup/app.test.ts tests/src/popup/entrypoint.test.ts tests/c4-content-entrypoint.test.ts`
    — 9 files / 165 tests passed.
  - `pnpm test -- --reporter=dot` — 86 files / 672 tests passed.
  - Evidence covers curtain-free but page-action-blocked silent/post-AI preview,
    native scroll preservation, row-hover emphasis and row-click exact-XPath
    scrolling, pointer-only row behavior, production/debug classification
    projection, explicit inspection begin/end lifecycle, and popup/background
    watchdog teardown with retryable no-inference failures.
- [x] P8 — Popup UX/debug/recovery
  - Implementation commit: `4893f3fa` (`Restore popup operations and debug boundaries`).
  - `pnpm lint && pnpm check` passed.
  - `pnpm vitest run tests/src/background/action-icon.test.ts tests/src/background/domain-cache.test.ts tests/src/background/startup.test.ts tests/src/popup/scroll-lock.test.ts tests/src/popup/theme.test.ts tests/src/popup/app.test.ts tests/src/popup/entrypoint.test.ts tests/src/popup/preview-classification.test.ts tests/src/messaging/contracts.test.ts tests/c3-popup-entrypoint.test.ts tests/manifest-permissions.test.ts tests/popup-responsive-layout.test.ts tests/theme-colors.test.ts tests/property-lock-banner-mode.test.ts tests/page-toast.test.ts tests/build-artifact-parity.test.ts --reporter=dot`
    — 14 files / 139 tests passed.
  - `pnpm test -- --reporter=dot` — 90 files / 683 tests passed.
  - Production bundle inspection proves the callable debug API, detailed
    Activity surface, internal classifications, traces, direct mode, and silent
    copy annotations are absent; the debug build retains them. Evidence also
    covers responsive property-first layout, kebab operations, scoped cache and
    unregister confirmation/recovery, prioritized notices and concise production
    toasts, five-state action icons, absence of manifest shortcuts, and exact
    panel scroll restoration across busy/modal teardown.
- [x] P9 — End-to-end integration
  - Evidence commit: `7019f099` (`Record P9 integration evidence`) and
    [`p9-integration-evidence.md`](./p9-integration-evidence.md).
  - Cross-layer seven-scenario gate — 13 files / 116 tests passed, covering
    background, content, popup, Hub-facing fixtures, persisted authority, and
    captured/submitted artifacts.
  - Hub `dotnet test UnfluffifyHub.sln --no-restore --nologo` on clean `develop`
    at `9bdce9f` — 96 tests passed.
  - Full extension suite — 90 files / 683 tests passed. Lifecycle readiness is
    event/condition-driven; zero-delay uses only flush already-resolved work.
- [x] P10 — Automated release gates
  - Performance implementation: `56fb4a8f` (`Benchmark and optimize branch repaint`).
  - [`p10-release-evidence.md`](./p10-release-evidence.md) records the exact
    command results and production tree digest.
  - `pnpm lint`, `pnpm check`, `pnpm build:debug`, and `pnpm verify` passed;
    `pnpm test` passed 91 files / 684 tests.
  - Cutover reachability, generated page-world parity, production debug
    exclusion, output-equivalence corpus, and the 2,000-node p95 marking
    benchmark are green. Hub remained unchanged and its 96-test P9 gate passed.
- [x] P11 — Witnessed live acceptance
  - Live/fix commit: `82cd129d` (`Fix live navigation and silent session transitions`).
  - [`p11-live-acceptance-evidence.md`](./p11-live-acceptance-evidence.md)
    records the production artifact, browser, property/site identity, live
    matrix, Alpha deployment identity, failures found, and repair evidence.
  - Focused P11 regression gate passed 4 files / 66 tests; `pnpm verify` passed
    lint, all TypeScript checks, 91 files / 685 tests, production build, and all
    7 manifest assertions.
  - Hub remained clean at the already-live `9bdce9f`; no Alpha redeploy was
    required.
- [x] P12 — Executable traceability repair
  - Commits: `6417cda2` (`Enforce executable decision traceability`) and
    `9c52a441` (`Resolve decision evidence to exact checks`).
  - `pnpm vitest run tests/decision-traceability.test.ts --reporter=verbose` —
    1 file / 4 tests passed. The gate covers all 104 exact IDs, missing/unknown/
    duplicate decisions, test-directory containment, regular test files, exact
    executable titles, and resolved acceptance procedures with retained artifacts.
  - `pnpm lint && pnpm check` passed; `pnpm test -- --reporter=dot` — 91 files /
    686 tests passed.
- [x] P13 — Clean capture, shadow, and consent lifecycle
  - Commit: `cfa60970` (`Preserve consent DOM across property lifecycle`).
  - `pnpm vitest run tests/src/content/consent.test.ts tests/src/content/marking/dom-bridge.test.ts tests/c4-content-entrypoint.test.ts tests/src/background/startup.test.ts tests/src/messaging/contracts.test.ts tests/src/popup/entrypoint.test.ts tests/src/page-world/program.test.ts tests/page-world-source-parity.test.ts --reporter=dot` — 8 files / 147 tests passed.
  - `pnpm lint`, `pnpm check`, and `git diff --check` passed; `pnpm test -- --reporter=dot` — 91 files / 696 tests passed.
  - `ACCEPT-P13-CAPTURE-SANITIZER` and `ACCEPT-P13-CONSENT-LIFECYCLE` remain registered for the P20 retained browser artifacts.
- [x] P14 — Single-pass interaction and real-browser performance
  - Commits: `3c9a7e5f` (`Initialize marking engine in one pass`),
    `f6c93c52` (`Optimize marking interactions and add browser gate`), and
    `355d1507` (`Reduce marking paint latency`).
  - `pnpm verify` passed lint, generated page-world parity, all TypeScript
    checks, 92 files / 711 tests, the production build, and all 7 generated
    manifest assertions.
  - `pnpm performance:p14` passed on clean commit `355d1507b82f` with 192/192
    real-Chromium scenarios, 3 warmups plus 21 measured samples per pair,
    10/10 semantic comparisons, 96/96 rewrite activation transactions, and
    16/16 performance budgets. Large marking activation rewrite p50/p95 was
    307.2/370.7 ms versus legacy 224.2/328.9 ms; strict physical click
    p50/p95 was 84.1/124.8 ms versus legacy 194.8/333.5 ms.
  - Retained artifact:
    `output/playwright/p14-marking-performance/acceptance-2026-08-21T13-18-32-297Z.json`
    (SHA-256 `66f0217733dc3bdf5794c518528256ca96c7246922c667404cf0680f10621fde`),
    Chromium `151.0.7922.108`, 1280×900 at DPR 1. Source identity, exact run
    plan, finite timings, page-error, cleanup, environment, and profiler-absence
    checks all passed.
- [x] P15 — Frozen-page interaction shield
  - Commit: `65281eda` (`Freeze managed property pages behind interaction shield`).
  - `pnpm verify` passed lint, generated page-world parity, all TypeScript
    checks, 99 files / 853 tests, the production build, and all 7 generated
    manifest assertions.
  - `pnpm performance:p15` passed on clean commit `65281edaf2be` with 36/36
    required real-Chromium checks, including physical page/shadow/top-layer
    blocking, native wheel/touch scrolling, extension UI interaction, early
    retained-posture adoption before deferred page context, same-document and
    full reload behavior, and every named terminal cleanup path. Page and
    console errors were empty.
  - Retained artifact:
    `output/playwright/p15-frozen-shield/acceptance-2026-08-21T16-01-16-817Z.json`
    (SHA-256 `08e204ba61d86aad5cd4169ac33ef5bcb71d01fda4357b0c29722cb74d21b619`),
    Chromium `151.0.7922.108`, 1280×900 at DPR 1. Source identity, exact check
    catalog, clean-worktree, viewport, fatal-error, and controller-cleanup
    assertions all passed.
- [x] P16 — Durable background-owned render inspection
  - Commit: `3bc84cdb` (`Add durable render inspection lifecycle`).
  - `pnpm verify` passed lint, generated page-world parity, all TypeScript
    checks, 104 files / 958 tests, the production build, and all 7 generated
    manifest assertions.
  - `pnpm performance:p16` passed on clean commit `3bc84cdbb6f4` with 13/13
    required real-Chromium checks, including replacement-document adoption
    before deferred page context, a physically painted exact-identity curtain
    before acknowledgement, panel-close and worker-restart durability, stale
    acknowledgement rejection, the complete terminal matrix, monotonic
    generations, and retirement of legacy inspection-fact authority. Page and
    console errors were empty.
  - Retained artifact:
    `output/playwright/p16-render-inspection/acceptance-2026-08-21T18-31-12-749Z.json`
    (SHA-256 `a348dc7781b317a857300904dfe9f8505ddb247606ba627ebf8fcf0163c1fd61`),
    Chromium `151.0.7922.108`, 1280×900 at DPR 1. Source identity, clean-worktree,
    exact session scope, fatal-error, and controller-cleanup assertions all passed.
- [x] P17 — Canonical preview transport and projection
  - Commit: `a4bcd4db` (`Transport canonical preview model`).
  - `pnpm verify` passed lint, generated page-world parity, all TypeScript
    checks, 106 files / 977 tests, the production build, and all 7 generated
    manifest assertions.
  - `pnpm performance:p17` passed on clean commit `a4bcd4db38ec` with 19/19
    required real-Chromium checks. The exact six-state corpus survived the typed
    content-to-popup bus; production exposed only readable included/excluded
    rows while debug retained classification, XPath, selector, shadow detail,
    and tooltips. Physical hover, leave, click-to-center, pointer-only focus,
    selector reprojection, per-preview occurrence fencing, stable element/React
    identity, stale-XPath rejection, and active-hover mutation rebind/removal all
    passed with no page or console errors.
  - Retained artifact:
    `output/playwright/p17-preview/acceptance-2026-08-21T19-44-18-338Z.json`
    (SHA-256 `37ec1923581ed60185233cf62e739b73cb9919d5503395d36d49d9b96da39ae9`),
    Chromium `151.0.7922.108`, 1280×900 at DPR 1. Source identity,
    clean-worktree, exact catalog, production/debug bundle manifests,
    fatal-error, and process/build cleanup assertions all passed.
- [x] P18 — Transient surfaces and production toasts
  - Commits: `0544f5f3` (`Coordinate transient surfaces and toasts`),
    `01b88bc5` (`Fix P18 manual-close occurrence isolation`), and
    `7ddfa208` (`Use raw hit test for P18 toast close`).
  - `pnpm verify` passed lint, generated page-world parity, all TypeScript
    checks, 109 files / 1006 tests, the production build, and all 7 generated
    manifest assertions.
  - `pnpm performance:p18` passed on clean commit `7ddfa2080691` with 14/14
    required real-Chromium checks. Competing menus, outside pointer dismissal,
    nested/topmost Escape, busy protection, Preview fallback, panel scroll
    restoration, canonical right-click marking, and post-dismissal marking all
    passed without running Save, Discard, marking disablement, or another
    terminal action. Production popup/content toasts replaced in place, exposed
    exact physical close controls, stayed dismissed, and matched debug
    disclosure policy. Paused production-clock checks proved success, warning,
    and danger present at 1799/3999/5999 ms and absent exactly at
    1800/4000/6000 ms.
  - Retained artifact:
    `output/playwright/p18-transient-toast/acceptance-2026-08-21T21-17-49-127Z.json`
    (SHA-256 `6984d521b51c924fcb36f7f01f8527c27f24ef2cde9cc94ae9077069581ed5f3`),
    Chromium `151.0.7922.108`, 1280×900 at DPR 1. Source identity,
    clean-worktree, exact catalog, production/debug bundle manifests,
    page/console/fatal-error absence, and process/build cleanup assertions all
    passed.
- [x] P19 — Targeted post-correction decomposition
  - Commits: `94836745` (`Move fact sensation schemas to domain`), `852ef00e`
    (`Extract popup presentation contract`), `e01bdedb` (`Add P19 architecture
    boundary gates`), `961f67e4` (`Extract content toast lifecycle`),
    `f0023a13`/`e129027f` (`Extract popup maintenance controller` and its
    reentrancy lint fix), `f18de228` (`Extract content consent lifecycle`),
    `567cf2f1` (`Extract popup Todo controller`), `6b62d1ce` (`Extract content
    transient surface adapter`), `ac4155cc` (`Extract popup render inspection
    controller`), `28f0534e` (`Extract popup preview controller`), `8cd95178`
    (`Extract preview row React section`), `09e9ed9c` (`Extract popup toast React
    section`), and `cf98c9d9`/`3a5d11a7` (`Extract popup configuration
    controller` and fence property adoption).
  - `tests/p19-import-boundary.test.ts` and
    `tests/p19-bundle-reachability.test.ts` passed all 11 architecture checks.
    Characterization remained green for every extracted controller and section;
    the final configuration gate passed 69 focused controller, real-entrypoint,
    import-boundary, and bundle-reachability tests, including delayed
    A→B→A property-load rejection and same-site retry supersession.
  - `pnpm verify` passed on clean commit `3a5d11a7831b`: lint, generated
    page-world parity, all TypeScript projects, 122 files / 1,093 tests, the
    production build, and all 7 generated-manifest assertions.
- [ ] P20 — Integrated release gates and witnessed live acceptance
  - Automated release evidence is complete in
    [`p20-release-evidence.md`](./p20-release-evidence.md): `pnpm verify` passed
    123 files / 1,097 tests plus production build and manifest checks; retained
    P14–P18 and P20 browser acceptances all pass; production/debug stripping,
    package hashes, Hub commit, and deployed Alpha version are recorded.
  - P20 remains unchecked because the browser-control connection reported no
    available browser instances on 2026-08-22. The production extension still
    must be witnessed against environment `a.lynxdev.se`, site `60`, and
    `https://bonliva.se`; local fixtures and the earlier P11 witness were not
    substituted for this final live matrix.

For each completed item, append the commit SHA(s), exact test command, result,
and any live artifact/version directly beneath the checkbox. The first unchecked
phase whose dependencies are complete is the sole resume pointer.

## 6. Decision coverage by primary phase

This map prevents decisions from disappearing between feature-oriented phases.
Cross-cutting decisions may be tested again later, but each has one primary owner.

| Phase | Decision IDs |
|---|---|
| P1 | I-02–I-06; U-10, U-15, U-16; D-31 |
| P2 | I-01, I-19–I-22; U-13, U-14; D-01–D-06 |
| P3 | I-36; U-02, U-12; D-07–D-12, D-14–D-16 |
| P4 | I-31–I-35; U-17; D-20–D-24 |
| P5 | I-07–I-13, I-15, I-18, I-26–I-28; U-07; D-28 |
| P6 | I-14, I-16, I-17, I-23–I-25, I-34, I-37; U-08, U-11, U-18c; D-25, D-27 |
| P7 | U-18b, U-18d; D-13, D-17–D-19, D-26 |
| P8 | I-29, I-30; U-01, U-03–U-06, U-09, U-18a, U-18e; D-29, D-30, D-32 |
| P12 | N-12 |
| P13 | N-01, N-10, N-11 |
| P14 | N-05, N-06 |
| P15 | N-02 |
| P16 | N-03 |
| P17 | N-04, N-09 |
| P18 | N-07, N-08 |
| P19 | N-13 |
| P20 | N-01–N-13 integrated acceptance |

U-10 is implemented primarily in P1 and exercised again in P6. U-02 is owned by
P3 for overlay assets and exercised again in P8 for panel branding. The original
91 decisions were integrated and revalidated in P9–P11. All 104 decisions are
integrated and revalidated in P20.
