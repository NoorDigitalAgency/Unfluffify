# Rewrite–Legacy Decision Execution Plan

**Status:** Active implementation plan

**Authority:** [`rewrite-legacy-decision-spec.md`](./rewrite-legacy-decision-spec.md)

**Created:** 2026-08-20

**Branch:** `re-write`

## 1. Outcome

Bring the rewrite into conformance with all 91 resolved rewrite-versus-legacy
decisions without weakening its architecture, data-authority model, or marking
semantics. Delivery is complete only after automated gates and a witnessed
production-build browser run pass.

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
```

The sequence is intentionally conservative. A later phase may start early only
when it consumes stable public contracts from all predecessors and does not
modify their source of truth.

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

## 5. Resume checklist

- [ ] P0 — Contract alignment and baseline
- [ ] P1 — Runtime and architecture
- [ ] P2 — Canonical marking and composed document
- [ ] P3 — Fast interaction and visual grammar
- [ ] P4 — Reveal/freeze and emulation
- [ ] P5 — Authority/config/auth/persistence
- [ ] P6 — Lock/candidacy/session/navigation
- [ ] P7 — Preview and inspection
- [ ] P8 — Popup UX/debug/recovery
- [ ] P9 — End-to-end integration
- [ ] P10 — Automated release gates
- [ ] P11 — Witnessed live acceptance

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

U-10 is implemented primarily in P1 and exercised again in P6. U-02 is owned by
P3 for overlay assets and exercised again in P8 for panel branding. All decisions
are integrated and revalidated in P9–P11.
