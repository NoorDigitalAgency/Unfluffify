# Unfluffify — Parity & Correction Plan

> **Status:** the executable plan for bringing branch `re-write` to production parity with the
> legacy extension and to conformance with the reimplementation contract.
> **Authority:** [`study/qa-decisions-save-contract.md`](./study/qa-decisions-save-contract.md) →
> [`contract-invariants.md`](./contract-invariants.md) → [`decisions-log.md`](./decisions-log.md) →
> [`study/qa-decisions.md`](./study/qa-decisions.md). Where this plan conflicts with those, the
> earlier item in that chain wins. D13–D24 are the latest architect decisions and supersede every
> conflicting full-snapshot save, popup authority, URL identity, lock, or GraphQL-caller statement.
> **Predecessor:** [`plan.md`](./plan.md) is the original P0–P10 greenfield build plan and is
> **complete**. This is a sibling, not an edit of it.

---

## 0. How to use this plan

This document is written to be **implemented, paused, and resumed by someone with no memory of
the session that wrote it**, on any machine.

**Resuming from cold:** read §1 (what this is), §3 (state of the world), then find the first
slice in §6 whose checkbox is unticked and whose prerequisites are ticked. Everything needed to
execute that slice is in its own entry. `study/RESUME.md` covers the study that produced this
plan.

**Slice discipline.** Every slice is independently shippable and independently revertible:

1. It states its **contract** (which INV / C-* rule or D-decision it satisfies).
2. It names the **files** it touches and the **evidence** (`file:line`) for the defect.
3. It names the **test that proves it**. A slice is not done until that test exists and fails
   without the fix.
4. It ends **green**: `pnpm lint && pnpm check && pnpm test`.
5. It is **one commit in the repository it changes**: extension slices push `re-write`; H slices
   push the agreed `UnfluffifyHub` implementation branch. Record both SHAs when a cross-repo
   acceptance scenario becomes green.

**Do not batch slices.** The study found the current damage was done by ~15 commits of feature
work accreting onto one file with no corrective pass between them. One slice, one commit, gate
green — that is the discipline that prevents a repeat.

**Tick the checkbox in §6 when a slice lands**, and note its commit SHA. That table is the
resume pointer.

---

## 1. Goal

Branch `re-write` is a clean-room reimplementation whose **lower layers are sound** and whose
**coordination layer and user-facing surface are not yet the product**. This plan closes three
gaps, in priority order:

1. **Correctness regressions** — places where the rewrite silently produces *different marking
   output* than legacy, or destroys data. These are not "missing features"; they are wrong
   answers, and some are invisible in the UI.
2. **Doctrine correction** — the reflex-arc authority model has inverted at the top; the
   architect has ruled it must be restored **before** more features accrete (D1).
3. **UX parity** — legacy's established, polished operator surface, brought over onto the
   corrected architecture.

**Non-goal:** re-litigating the backend-facing schema redesign. It is deliberate (per the task
brief) and out of scope except where the *backend itself* must change (§5).

---

## 2. What was decided (D1–D24)

The architect's answers, in force. D1–D12 are in
[`study/qa-decisions.md`](./study/qa-decisions.md); D13–D24 are in the later
[`study/qa-decisions-save-contract.md`](./study/qa-decisions-save-contract.md).

| # | Decision |
|---|----------|
| **D1** | **The reflex-arc doctrine stands, and its correction comes first.** Signal birth returns to the brain; popup-composed content directives are removed; the dual state bag is deleted. `.reimplementation/` is *not* relaxed. |
| **D2** | **`/save` must become keyed per-page on the backend.** Verified from `UnfluffifyHub@develop`: today it is full-replace of the page set, deliberately so. See §5. |
| **D3** | **AI runs and saves are per-page**, but each run's **payload is the whole stored corpus merged with the current page**. Save persists the named page's rows plus the site-level selectors. |
| **D4** | **Ship live:** property-lock collaboration; page-type assignments + Todo list + Send to Lynx; appearance/16-theme customization. **Dropped:** desktop preview. |
| **D5** | **Static-render-mode properties are in scope** — port a static-HTML fetcher + offscreen XPath refinement. |
| **D6** | **Restore GraphQL `propertyPageTypes` candidacy** (INV-1.4). |
| **D7** | **The property lock is tab-scoped** and survives the side panel closing. |
| **D8** | **Keep the side-panel surface.** |
| **D9** | **Consent hiding stays on every configured property page at load** (legacy behavior). |
| **D10** | **Save ends the marking session and drops to silent** (legacy behavior, INV-6.5 D-SAVE). |
| **D11** | **The freeze stays page-visit-sticky** until navigation. |
| **D12** | **Device emulation targets Googlebot-smartphone parity** — UA + client hints + touch/pointer media, above the 412×960 viewport. |
| **D13** | **Identity is `(environmentKey, siteId, relative pageKey)`.** The Hub derives registered GraphQL endpoints; observed origins are informational. |
| **D14** | **The background owns the full authoritative corpus.** Popup views are projections; drafts are separate session overlays. |
| **D15** | **`/save` is structurally singular.** It sends current page + domain selectors, partially upserts, preserves absent pages, and returns the full snapshot. |
| **D16** | **The server owns timestamps and selector semantics.** Only normalized selector-value changes matter; no marking-basis fingerprint. |
| **D17** | **The Hub fetches/validates GraphQL with the exact client JWT.** Payload classification beats misleading HTTP status. |
| **D18** | **Complete-feed reconciliation is deterministic.** Missing keys delete, relabels preserve, duplicate cross-type keys block, empty types are silent. |
| **D19** | **Snapshot shrink requires explicit reconciliation proof.** Anything else is an integrity stop. |
| **D20** | **Candidate loss/conflict suspends a session.** Preserve the draft, poll every 15s, use a 10-minute recovery grace, and never auto-replay Save. |
| **D21** | **The lock is fenced and presence-qualified.** Hidden/idle tabs do not renew; stale-untransferred may reacquire; transfer destroys the draft. |
| **D22** | **Same-user `Continue here` is explicit and destructive.** Warn from `hasUnsavedWork`; rotate the fence; no merge/recovery. |
| **D23** | **Every mutation is idempotent** by operation id and expected fence/revisions. |
| **D24** | **The Hub owns Send to Lynx** and advances the submitted fingerprint only on definitive GraphQL success. |

**No product/design questions remain open for this plan.** §7 records closed implementation
choices so resumption does not silently reopen them.

---

## 3. State of the world (verified 2026-08-14)

- **Branch topology.** `main` == `origin/legacy-main` == `28974c2a` (legacy v1.10.0 + 3 fixes).
  PR #48 merged the rewrite and **main was then reset back to legacy**, so the rewrite ships
  nowhere. `re-write` is the live line, 69 commits off the legacy base.
- **Gate:** green after this amendment — `pnpm verify` passes: 485 tests / 58 files, lint,
  typecheck, production build, and 5 generated-manifest tests.
- **Size:** legacy ≈43k lines of real code; rewrite ≈13k (both excluding the vendored 29,930-line
  icon CSS and theme CSS).
- **The backend is already ahead of the extension.** `UnfluffifyHub@develop` (`4a4878e`) has
  **merged the unified-rows contract**: `SaveRequest.CurrentVersion = 1`, `PageMarking.rows`,
  and `[JsonUnmappedMemberHandling(Disallow)]` on both records. **Legacy v1.10.0 (version 5,
  `xpaths` + `submissionXpaths`) is rejected twice over by that build.** This makes the switch a
  **hard cutover**, not a rollout — see §5.3.
- **The design system is already ported byte-identically.** `theme-color.css`,
  `theme-components.css`, `theme-utilities.css` and `fonts.css` all diff clean against legacy,
  the MDI webfont ships and is imported in legacy's order, and the logo + cursor SVGs ship and
  are web-accessible. **Every "absent" popup surface is markup and state wiring, not design
  work.** This materially shrinks §6.C.

**Verdict tally** (all 49 legacy weaknesses judged against rewrite code):
19 SOLVED-BY-DESIGN · 8 SOLVED-IN-CODE · 13 PARTIAL · 8 UNSOLVED · 1 N/A.

What is *genuinely* designed out and must not regress: one typed bus with an enumerable route
table; one pure domain spine whose single pass yields both overlay and wire rows so they cannot
drift; a single-writer backend-authority rule; no config merge; no retry ladder; one storage
area; popup-independent content activation and consent hiding; and the render-mode saga deleted
rather than repaired (which also fixed the live "deleted config record cannot be re-bootstrapped"
finding).

---

## 4. Correction backlog

Ordered by blast radius. **Tier A is data-correctness and must land first** — every one of
these is either silent or destructive.

### Tier A — wrong answers and data loss

| ID | Defect | Evidence | Contract |
|----|--------|----------|----------|
| **A1** | **Page-shell rejection is back, and now suppresses exclusion rows.** `isPageShell` again treats `broadViewportFootprint` (width ≥ 0.9 × innerWidth) as a shell disjunct — the exact rule the architect **deleted on 2026-07-05** after the bonliva footer bug. Worse, the rewrite wired the shell test into default-exclusion collection, so a full-width or landmark-bearing FOOTER/HEADER/NAV holding its text in children gets **no exclusion row at all**, and its descendants classify `implicit-include` and **ship to the AI as content**. Silent in the UI. | `domain/boundary.ts:41`, `content/marking/dom-view.ts:225,228`, `content/marking/engine.ts:99-107`, `domain/evaluate.ts:62-64`, `boundary.ts:52` | INV-3.18/3.19, C-MARK-6 |
| **A2** | **Destructive save, now deterministic.** `configFromSubmission` builds a one-key `pageMarkings` map and the backend currently treats the map as full replacement. The correction is **not** to merge the full corpus into the client request: D15 requires a singular `page` request, partial server upsert, full authoritative response, fenced/idempotent execution, and explicit shrink proof. | `main.tsx:866-873, :1250-1251`, `background/index.ts:300-309`, `lynx/rest.ts:49-69`; backend `SiteRepository.cs:153-170` | INV-6.5, D15, D19, D23 |
| **A3** | **Shift-widening picks a different element than legacy.** `chooseWidenTarget` climbs straight to the outermost eligible ancestor, implementing only step 4 of C-TGT-4's locked four-step ladder. | `domain/widening.ts:66-77` | C-TGT-4, INV-3.19 |
| **A4** | **Static properties cannot be marked at all.** Schema requires `rawHtml` iff `renderMode === "static"`; `buildSubmissionSnapshot` parses eagerly and throws; **nothing anywhere fetches static HTML**. Run AI and Save fail at capture for a whole property class. | `domain/schema/submission.ts:42-48`, `content/marking/submit.ts:15`, `background/services.ts:71` | D5, INV-8.6 |
| **A5** | **Synthetic XPath segment.** `dom-view.ts` emits a `/__closed-shadow[n]` segment, which may violate the "purely positional `/tag[index]`" rule and cannot resolve against the captured HTML. **Verify before fixing** — confirm against the capture path. | `content/marking/dom-view.ts:200-206` | C-SUB-4, INV-5.3 |
| **A6** | **AI selectors live only in popup memory.** They arrive on the `run.completed` payload and are read back at save; `runRecordRepo` stores phase and timestamps but **not the selectors**, and there is **no resume path**. Closing the panel loses a completed run. This is legacy's intermittent-selector-loss bug, reproduced. | `main.tsx:1584-1589, :1626-1630`, `background/services.ts:296-305` | INV-6.4 |

### Tier B — doctrine (D1)

| ID | Defect | Evidence |
|----|--------|----------|
| **B1** | **Dual signal birth with no dedup.** The popup births `session.navigated`, `marking.enabled`, `marking.disabled` — the same three names `decide.ts` births from fact edges — plus `run.*`, `preview.*`, `session.saved/discarded`, `reconciliation.*`, all `source:"popup"`; `append` is unconditional. One logical edge → two signals → the FSM consumes both. | `main.tsx:470,897,952,984,1001,1531-1724`; `brain/decide.ts:14-35`; `brain/signals.ts:24-40` |
| **B2** | **Popup dictates the content surface.** `composeContentDirective` builds content's whole curtain/banner/blocked surface and pushes it every 500 ms — the retired dictation model, relocated. Content consumes **zero** brain signals. | `main.tsx:675-708, :829, :482-487` |
| **B3** | **Dual state bag returned.** `preLockPopupState` + `settlePreLockAiRun` hand-build FSM states outside the transition table and `store.reset()` moves the organ between signals; the offline path fabricates `source:"brain"` signals that are in no log. | `main.tsx:65, :738-770, :260-272, :454` — violates INV-10.4 |
| **B4** | **Composed display strings cross the layer boundary.** `lock-runtime.ts` sends `curtain: { text: "Property locked" }`; the popup echoes composed copy into the content directive. Legacy **deleted exactly this shortcut** (C-SPIN-2). Fixing it is a **prerequisite** for every curtain/toast/banner port in §6.C/D. | `lock-runtime.ts:77`, `main.tsx:696-698, :785` |
| **B5** | **MV3 rehydrate is dead.** `rehydrateDurableFacts` has **zero callers**; `getBrain` always builds a fresh brain. After a worker restart facts and `seq` restart at 0 while the popup's cursor survives and rejects `seq <= consumedThrough` — post-wake signals are **silently discarded**, with no error surface. | `background/rewrite-brain-runtime.ts:62-69`, `popup/signal-cursor.ts:35-41` |

### Tier C — performance

| ID | Defect | Evidence |
|----|--------|----------|
| **C1** | **O(n²) rebuild at up to 60 Hz.** MutationObserver + ResizeObserver + IntersectionObserver + capture-phase scroll + resize all bound to a **full** `createDomBridgeView` + full `evaluate` + full overlay rebuild. Per node, `buildNode` calls `landmarkCount` (itself a subtree walk) 4× and `geometryFor` 3×. Legacy's CPU-peg class with a worse asymptote and none of the CP7a caches. | `content/marking/engine.ts:166-239`, `dom-view.ts:68-70,223-228` |
| **C2** | **The popup drives C1 twice a second, forever.** The directive is pushed unconditionally every 500 ms into a root tagged only `data-uf-content-directive-root`, **not** `data-uf-extension-ui="true"`, so the engine's mutation filter does not exclude it. Any visible banner or curtain re-triggers a full rebuild indefinitely. | `content-loader.content.ts:304`, `engine.ts:204-207` |
| **C3** | **`ai.run` polls up to 480 s inside one bus request with no keepalive**, while `signals.emit` does acquire one. An SW suspension mid-run loses it, and A6 means nothing resumes it. | `background/index.ts:278-283` vs `:140` |

### Tier D — the reveal ritual is inert

| ID | Defect | Evidence |
|----|--------|----------|
| **D-1** | **The reveal walk never reveals.** `runReveal` chains `scrollTo` calls with **no awaits between steps**, so the browser never paints, never fires scroll events and never runs IntersectionObserver callbacks before the freeze. Lazy content is therefore never triggered — the ritual runs, and does nothing. | `content/stabilization/reveal.ts:21-31` |
| **D-2** | **Lazy expansion can never fire.** `expandedScrollHeight` is passed the *same live expression* as `initialScrollHeight`, so `lazyExpansions` is structurally always 0. | `content-loader.content.ts:179-180` |

> The one-per-visit bookkeeping around the ritual is correct and tested. Only the walk is dead.

---

## 5. Backend work (`UnfluffifyHub`, branch `develop`)

Owned by the architect. **These changes gate cutover.** Implement them in
`UnfluffifyHub@develop` as separately tested backend commits; the extension may use a contract
fixture/fake until they land. The exact contract is D13–D24 and `remote-api.md` A/B/D.

### 5.1 Stage-aware delegated GraphQL context

- Add an explicit deployment environment registry keyed by normalized `stageBase`; derive only
  registered GraphQL endpoints. Reject arbitrary URLs.
- Add the Hub context resolver around the locked `urlSearchInfo` and `propertyPageTypes` queries.
  Forward the **exact** client JWT for authorization; never store/log it or substitute a service
  credential. Forward `x-update-token` to the extension.
- Classify GraphQL payloads before status: auth and permission payloads may arrive as HTTP 500;
  partial data+errors and malformed payloads are invalid, never empty feeds.
- Canonicalize candidate URLs to relative path+query+fragment, and return membership and assignment
  fingerprints. State is keyed by `(environmentKey, siteId)`.

### 5.2 Fenced, idempotent property mutations

- Separate `editorSessionId` from opaque backend `lockToken`. Grant/transfer/takeover rotates the
  fence; every mutation rejects stale tokens before touching storage.
- Standardize `operationId`, expected property revision, and expected feed revision on save,
  remove, reconcile, publish acknowledgement, and transfer. Duplicate delivery returns the recorded
  outcome.
- A stale but untransferred editor session may reacquire; an actual transfer irreversibly destroys
  the old session draft. Persist only `hasUnsavedWork` metadata for cross-browser warnings.
- Renew only from visible selected tabs in a focused, non-idle browser. Add the 10-minute
  candidate-suspension recovery grace before the ordinary inactivity countdown.

### 5.3 Singular partial `/save` and authoritative responses

- Replace `SaveRequest.PageMarkings` with required singular `Page`. `siteId:null`, missing page,
  and empty-map/full-replace forms are structurally impossible.
- Upsert the named `(environmentKey, siteId, pageKey)` only; preserve absent records. `/remove`
  remains the explicit ordinary deletion door.
- Assign page/render-mode/selector timestamps server-side. Compare selector sets semantically;
  preserve `selectorsUpdatedAt` for identical values and never blank
  `submittedSelectorsFingerprint` on save.
- Return the complete property snapshot from save/remove/reconcile/publish. Include property/feed
  revisions and exact reconciliation removal/relabel proof so the client can reject unexplained
  shrink.

### 5.4 Complete-feed reconciliation and operational block

- Before lock grant, Run AI, Save, Remove, and Publish, fetch the complete property feed with the
  delegated JWT.
- Remove stored markings for missing keys; preserve rows/HTML/timestamps when only page-type labels
  change. Reconciliation is idempotent by feed fingerprint and fenced like every mutation.
- A key assigned to different page types persists `candidate_feed_conflict`, rejects mutations,
  lists the offending key/types and recovery instruction, and changes no data. Clear only after a
  later valid feed. Ignore empty page types in the editor workflow.

### 5.5 Hub-owned Lynx publication

- Add one publish operation that refreshes feed/auth, validates fence/revisions/Todo coverage/
  normalized selector fingerprint and the existing `cssInfo` gate, then calls the locked
  `updateScrapingConditions` mutation with the delegated JWT.
- Advance `submittedSelectorsFingerprint` only on definitive payload success. Preserve it on
  failure; persist `publication_unknown` for ambiguous transport and retry only under the same
  idempotency key with identical replace-state values.

### 5.6 Deploy ordering (hard cutover)

`develop` already rejects legacy v5 payloads, and D15 introduces another intentional wire break.
Do not deploy this Hub contract to a stage still serving legacy v1.10.0. Cut both over together or
keep a version-5 endpoint alive until extension replacement. State the chosen order before release.

---

## 6. Slices

Prerequisite notation: a slice may start when the slices in **Needs** are ticked.

### Phase H — owned Hub contract (`UnfluffifyHub@develop`)

These are cross-repository prerequisites. Each is one backend commit with Hub tests green; record
its SHA here and in the extension integration slice. Extension work may proceed against exact
versioned fixtures, but live acceptance waits for the corresponding H slice.

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **H1** | Environment registry + delegated-JWT `/context`: locked GraphQL queries, payload-first error classification, token rotation forwarding, relative page keys, membership/assignment fingerprints. **Landed in `UnfluffifyHub@8a57106`.** | — | HTTP 500 auth payload maps to auth; partial data never reconciles; two stages with the same `siteId` remain isolated. |
| ☑ | **H2** | Fenced/idempotent lock and mutation envelope: `editorSessionId`, rotated `lockToken`, operation log, expected revisions, qualifying-presence heartbeat, same-user destructive transfer. **Landed in `UnfluffifyHub@ec13dad`.** | H1 | Stale token mutates nothing; duplicate transfer rotates once; hidden/idle heartbeat cannot extend lease; stale-untransferred same session reacquires. |
| ☑ | **H3** | Full `/load`, singular partial `/save`, explicit `/remove`, server timestamps, normalized selector comparison, full authoritative responses. **Landed in `UnfluffifyHub@a4f7850`.** | H2 | Save B request contains no A; response contains A+B; duplicate operation has one timestamp; identical selectors preserve timestamps/fingerprint. |
| ☑ | **H4** | Complete-feed reconciliation + persisted conflict block + explicit shrink/relabel proof. **Landed in `UnfluffifyHub@1d7d39d`.** | H1, H2, H3 | Missing key deletes; relabel preserves; duplicate cross-type key blocks without mutation; invalid feed deletes nothing. |
| ☑ | **H5** | Hub-owned `/publish`: feed/fence/completeness/`cssInfo` gates, exact-JWT GraphQL mutation, idempotent definitive/unknown outcomes. **Landed in `UnfluffifyHub@5661e04`.** | H4 | Submitted fingerprint advances only on definitive success; timeout never reports success; same operation safely resolves/retries. |

### Phase A — stop the bleeding (data correctness)

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **A1** | Remove `broadViewportFootprint` from the shell disjunct and unwire the shell test from `collectDefaultExclusionRows`. Restores INV-3.18's width-independence. **Landed in `9bbe6709`.** | — | A full-width landmark-bearing `<footer>` whose text lives in children **gets an exclusion row** and does not classify `implicit-include`. |
| ☑ | **A2** | Implement D14/D15 client authority: background persists the full validated corpus, AI overlays the live current page, and Save sends a structurally singular current-page request plus selectors. Adopt only a validated full response; require reconciliation proof for shrink. **Landed in `a4e0e8fd`.** | H3, H4 (or exact fixtures) | Two-page property: saving B sends no A, response/adopted baseline contains A+B; unexplained shrink is rejected without losing baseline/draft. |
| ☑ | **A3** | Implement C-TGT-4's four-step widening ladder in `chooseWidenTarget`. **Landed in `def61c32`.** | — | Golden fixture: Shift+Click on a known page selects the same element as legacy's ladder, not the outermost ancestor. |
| ☑ | **A4** | Verify `/__closed-shadow[n]`: it is a render-only key; closed-shadow evaluation terminates before row creation and positional schema validation is a second wire guard. **Locked by `10b3e89b`.** | — | No submitted XPath contains a non-`/tag[index]` segment; closed-shadow host renders its distinct overlay category. |
| ☑ | **A5** | Persist AI selectors in `runRecordRepo` at `run.completed` (background-side), not popup memory; add the resume path. **Landed in `9894dab3`.** | — | Panel closed mid-run: the completed run's selectors are readable on next open. |
| ☑ | **A6** | Acquire a keepalive around `ai.run` polling. **Landed in `561b62b4`.** | A5 | A simulated SW suspension mid-run does not lose the run. |

### Phase B — doctrine correction (D1) — *no feature work until this lands*

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **B1** | Delete the popup's birth sites for the three names the brain already decides (`session.navigated`, `marking.enabled`, `marking.disabled`); the popup reports **facts**, the brain decides edges. **Landed in `84012d27`.** | — | One enable produces **exactly one** `marking.enabled` in the log. |
| ☑ | **B2** | Move the remaining popup-born names (`run.*`, `preview.*`, `session.saved/discarded`, `reconciliation.*`) behind facts the brain folds and decides. **Landed in `5aa2e0da`.** | B1 | Every signal in the log carries `source:"brain"`; no `source:"popup"` frame exists. |
| ☑ | **B3** | Delete `composeContentDirective` and the 500 ms push. Content becomes a **signal consumer** with its own per-state memory matrix. **Landed in `a009f46a`.** | B2 | Content renders its surface from consumed signals; no directive message type remains. |
| ☑ | **B4** | Delete `preLockPopupState` / `settlePreLockAiRun` / `store.reset()` transitions and the fabricated `source:"brain"` offline signals. **Landed in `1b77582c`.** | B2 | The organ only ever moves via the transition table; a property-lock episode returns to `priorState` mechanically. |
| ☑ | **B5** | Replace composed display strings with reason/phase codes plus per-layer copy tables (C-SPIN-2). **Landed in `660fcb8d`.** | B3 | No layer sends user-visible copy across a realm boundary. |
| ☑ | **B6** | Call `rehydrateDurableFacts` on brain construction; restore `seq` past the persisted head. **Landed in `ca7b4b41`.** | — | After a simulated SW restart the popup's cursor still receives subsequent signals. |
| ☑ | **B7** | Tag the directive/overlay root `data-uf-extension-ui="true"` and gate re-render on genuine DOM change. **Landed in `ddf655f7`.** | B3 | Extension chrome mutations trigger **zero** engine rebuilds. |
| ☑ | **B8** | Memoize `landmarkCount` / `geometryFor` per pass and make observer-driven work branch-scoped (INV-4.1/4.2). **Landed in `2faed0f5`.** | B7 | Per-toggle render cost is bounded; a scroll storm does not trigger full rebuilds. |

### Phase C — close the operator loop

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **C1** | Stamp `data-theme` / `data-theme-mode` + `style.colorScheme` at panel boot (legacy forced `nordic`). **One-line fix for a visible brand mismatch. Landed in `2e39760b`.** | — | Panel renders nordic tokens, not the `:root` indigo fallback. |
| ☑ | **C2** | Define the three tokens `popup.css` references that no theme provides (`--surface`, `--surface-2`, `--ink-soft`) — invisible in legacy behind a dark flag, always visible now in the Activity log. **Landed in `c53675c2`.** | C1 | Activity log renders with background and label colour in every theme. |
| ☑ | **C3** | Replace direct/stale classification with Hub `/context`: generation-scoped page load/SPA/auth/settings recovery, registered environment, canonical relative page key, typed managed/unmanaged/suspended outcomes. **Landed in `9e300ad9`.** | B2, H1 | Late navigation result is discarded; misleading GraphQL status is typed correctly; definitive property change terminates while transient failure preserves. |
| ☑ | **C4** | Todo + candidate badges from the background's last valid canonical feed: header `covered/actionable`; per-type `marked/1` uncapped; silent empty-type exclusion; conflict/removal suspension surfaces and 15s recovery checks. **Landed in `4c666969`.** | C3, H4 | `4/6`, `6/6`, `0/1`, `1/1`, `3/1` states/color semantics pass; empty vs error is distinct; candidate return yields Ready-to-save without auto-write. |
| ☑ | **C5** | Lynx checklist + Hub `/publish`: fail-closed authority/`cssInfo` gate, one saved mark per non-empty type, publication unknown/retry UI, authoritative response adoption. **Landed in `14095440`.** | C4, H5 | Client never calls GraphQL publication directly; submitted fingerprint changes only after definitive Hub success; empty-only feed cannot publish. |
| ☑ | **C6** | Preview surface: emit `preview.exit.requested` / `preview.exited`; add the exit control. Today preview is a **one-way door**. **Landed in `ae727d1f`.** | B3 | Entering and exiting preview returns to the origin mode without dirtying a draft (INV-6.10). |
| ☑ | **C7** | Theme customization UI over the existing 16-theme token catalog (D4). **Landed in `52d1bc02`.** | C1 | Theme selection persists and applies. |

### Phase D — in-page visual parity

The in-page layer is where the visual language **diverged**, not merely thinned: 5 flat inline
styles against legacy's 16-class grammar, explicit-include rendered blue where legacy was dark
green, hover cyan where cyan was legacy's *focus* colour (colliding with silent highlights), and
one box per bounding rect instead of one per client rect — so a multi-line paragraph draws a
single box overlapping unmarked siblings.

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **D1** | Port the 16-class overlay grammar with legacy's exact colours/metrics, and switch to **one box per client rect** with keyed reuse. **Landed in `0eb085eb`.** | B3 | Overlay classes and colours match the legacy catalog; a wrapped paragraph draws one box per line box. |
| ☑ | **D2** | Fix the reveal walk: await paint between steps so scroll/IntersectionObserver handlers actually run; pass a re-measured `expandedScrollHeight`. **Landed in `08bc3847`.** | — | Lazy content is triggered; `lazyExpansions` can reach 1; freeze engages at the absolute bottom. |
| ☑ | **D3** | Custom cursors (SVGs already ship, web-accessible, zero code references), 160 ms interaction-ack pulse, ghost rects, `.uf-scrolling` hide. **Landed in `1c8fbd5f`.** | D1 | Cursor changes per mark mode; a click acknowledges within 160 ms. |
| ☑ | **D4** | Real input-blocking curtain (today `pointer-events:none` makes it decorative; legacy blocked 22 event types), inspection card, freeze pill, toasts. **Landed in `4b891903`.** | B5 | Page interaction is genuinely blocked during a blocking phase. |
| ☑ | **D5** | Property-lock in-page banner + all lock UI states. **Landed in `8e395024`.** | E1 | Banner reflects lock state transitions. |

### Phase E — property lock to contract (D4 + D7)

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **E1** | Move the lock lifecycle into background and adopt H2's split identity: per-editor `editorSessionId`, backend `lockToken`, environment-scoped lease, fenced command envelope. Panel closure does not end the editor session. **Landed in `8394b68e`.** | B2, H2 | Every write carries the current fence; panel close preserves; stale fence is typed conflict with zero mutation. |
| ☑ | **E2** | Add `tabs.onRemoved` / `onUpdated` / `onActivated` / `windows.onFocusChanged` / `webNavigation` + browser-idle integration. Only visible selected tab + focused window + non-idle status qualifies renewal; tab close/navigation enforce draft terminal rules. **Landed in `ef61fc20`.** | E1 | Forgotten hidden tab cannot keep lock; focused active page can; navigation/reload destroys draft; tab close releases. |
| ☑ | **E3** | Reconnect/backoff + independent HTTP reachability. Distinguish uncertain disconnect, stale-untransferred reacquisition, and authoritative transfer. **Landed in `0dd27c11`.** | E1 | Same session reacquires stale lease with draft; rotated fence immediately discards old draft; network failure alone does not. |
| ☑ | **E4** | Mirror backend deadlines: existing connection/off-candidate/cross-property/passive timers plus 10-minute candidate-removal/conflict recovery grace and 15-second client-driven context polling only while focused or in grace. **Landed in `1bea465c`.** | E2, E3, C3 | Recovery poll stops after grace, refocus checks immediately, then ordinary inactivity expiry makes the lock takeover-eligible. |
| ☑ | **E5** | Same-user `Continue here` and takeover UI. Heartbeat publishes `hasUnsavedWork` for dirty/post-AI/Ready/in-flight/unknown save; missing/stale status warns conservatively; saved-unpublished selectors do not. **Landed in `d8a1703e`.** | E4 | Cross-tab and cross-browser transfer rotate once, warn correctly, discard old work, and leave the previous tab locked/passive as ownership changes. |

### Phase F — static properties (D5)

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **F1** | Background static-HTML fetcher (`fetchStaticPageHtml` equivalent). **Landed in `c115cb41`.** | — | A static property's snapshot carries `rawHtml`. |
| ☑ | **F2** | Offscreen DOMParser XPath refinement for static mode. **Landed in `5d785813`.** | F1 | Static-mode rows align with the raw HTML. |
| ☑ | **F3** | Corpus assembly at run time (D3): merge all stored pages with the current page's live markings. **Landed in `62d943c5`.** | A2, F2 | The AI payload contains every stored page plus the current one. |

### Phase G — emulation, cutover, release

| ✅ | ID | Slice | Needs | Test that proves it |
|----|----|-------|-------|---------------------|
| ☑ | **G1** | Googlebot-smartphone parity (D12): UA + client hints + touch/pointer media over 412×960. **Landed in `308ac70e`.** | — | Emulated identity matches the target profile; posture re-asserts after navigation. |
| ☑ | **G2** | **Contract parity matrix** — the critic's gap 1: 70 of 112 locked `C-*` contracts have **no verdict in any report**, including all 3 `C-SHDW`, 12 of 17 `C-MARK`, 6 of 7 `C-SAVE`. Produce one PASS/PARTIAL/FAIL row per contract with `file:line` on both sides. Two regressions (A1, A3) were already found in this gap, so it is not bookkeeping. **Landed in `fbcf8696`.** | Phase A | The matrix exists and every FAIL has a slice. |
| ☑ | **G2a** | Exact boundary truth and collapsed projection (C-MARK-8/10): unmark only the boundary, preserve independent descendant rows, keep leaf boundaries visible, and collapse descendant default projection below an exclusion. **Landed in `9e95b1e2`.** | G2 | Nested exclude/include rows survive or clear by dependency; an unexcluded text button stays visible; one excluded branch draws one projected boundary. |
| ☐ | **G2b** | Generated whitespace + accessibility reality (C-MARK-12, C-TGT-8): lifecycle/submission-only whitespace exclusions and paint/hit resolution for ambiguous a11y-hidden text. | G2 | Whitespace rows never enter marking UI and disappear when text arrives; genuinely visible `aria-hidden`/sr-only prose remains eligible. |
| ☐ | **G2c** | AI timing authority (C-SUB-7): one timeout/poll definition drives popup deadline, durable run deadline, and poll defaults. | G2 | A guard rejects hard-coded duplicate timing literals; all AI lifecycle deadlines agree. |
| ☐ | **G3** | **Regression net** — the critic's gap 3: legacy has 203 test files, the rewrite 64. Identify which legacy tests encode *behavior* (not the 77 that regex production source) and port them as the parity net. | G2a, G2b, G2c | Named legacy behavioral tests pass against the rewrite. |
| ☐ | **G4** | Live-round validation on a throwaway environment/site id — **never against a production property** (see `study/` and the live-QA findings). | G3, H5 | Full fenced lifecycle and Lynx publication pass end to end. |
| ☐ | **G5** | Cutover: deploy ordering per §5.6, version bump, replace `main`. | G4, H5 | — |

---

## 7. Closed implementation choices

These are either faithful legacy parity, a prior architect answer, D13–D24, or a safety consequence
of the target architecture. They are not unresolved plan blockers.

| Topic | Decision | Source / change cost |
|---|---------------|--------------|
| Reveal timings (10 passes × 1 s dwell) | **Port legacy's timings**, but make the walk interruptible on navigation | D2 only |
| Right-click commits a mark | **Port the established legacy interaction** while marking; parity is the default when no removal was requested | D1 only |
| Silent-mode click-to-copy tooltip | **Port it** — cheap, and editors rely on it for reporting | D1 only |
| Native `window.confirm` for destructive actions | **Move to in-panel confirmation** — legacy's blocking dialogs freeze the fact pipeline and break automation | C6-adjacent |
| Render-mode change silently invalidating selectors | **Do not stale selector values.** Surface render-mode publication state separately if Lynx must receive it. | C3/C5 |
| Send-to-Lynx blocking an identical re-send | **Keep fail-closed** | C5 |
| Fail-open API audit (legacy task #18, never resolved) | **Fail closed on anything that writes; fail open on anything that only displays** | Cross-cutting; record per call site in G2 |
| Deleted backend config record recovery | **Explicit re-onboarding** (render-mode re-inspection), not silent auto-recreation | C3 |
| AI run completing after the panel closes | **Persist and surface on next open**, do not auto-apply | A5 |
| Marking surviving a same-URL reload | **Do not survive** — keep INV-6.7 | — |
| Page-block scope | **Block only when the popup is busy *and* interaction can affect results** (the last recorded architect word) | D4 |
| Widening F2 over-widening tradeoff | **Accept it**, as the architect did for the bonliva footer | A3 |

---

## 8. Acceptance criteria

The rewrite may replace `main` when **all** hold:

1. **Every Tier A defect is closed**, each with a test that fails without its fix.
2. **No `source:"popup"` signal frame exists**; one logical edge produces exactly one signal.
3. **Content consumes signals** and renders from its own per-state memory; no directive push.
4. **The contract parity matrix (G2) is complete**, with no unexplained FAIL.
5. **A two-page property survives a singular per-page save** — request for B contains no A;
   authoritative response contains A+B; unexplained shrink is rejected.
6. **A static property completes Run AI and Save.**
7. **The lock survives panel closing but not forgotten-tab abuse**: hidden/idle tabs cannot renew;
   stale-untransferred same session may reacquire; transfer destroys its draft.
8. **Candidate removal/conflict suspends without data loss**, recovers on a 15-second context check,
   and restores Ready-to-save without automatic mutation replay.
9. **Every mutation is fenced and idempotent**, including a response-lost retry and transfer race.
10. **The Hub owns GraphQL context and publication** with exact-JWT delegation, registered stages,
    payload-first error classification, and token-rotation forwarding.
11. **Feed reconciliation is deterministic**: missing key deletes with proof, relabel preserves,
    duplicate cross-type key blocks without mutation, and empty types are non-actionable.
12. **The operator loop closes**: mark → Run AI → preview → save → Todo counters → Hub Send to Lynx.
    Submitted fingerprint advances only on definitive Lynx success.
13. **Gate green** (`pnpm verify`), plus the ported legacy behavioral net (G3).
14. **A live round passes on a throwaway site id.**

---

## 9. Risks

- **Phase B is invasive and touches everything.** It is nonetheless first, by D1, because every
  feature added before it makes it larger — that is precisely how the current state arose.
- **A1 is invisible.** Nothing in the UI reveals that a footer's text is being submitted as
  content; only the parity matrix (G2) or a payload diff catches it. Treat any marking-output
  change as high-severity even when the screen looks right.
- **Backend and extension must cut over together** (§5.6), or legacy clients break the moment
  `develop` deploys.
- **Delegated GraphQL is an authority boundary.** Never log/persist the JWT, trust a client-supplied
  feed/conflict flag, or classify authorization solely by HTTP status.
- **The shrink guard is expected never to fire** outside explicit reconciliation. Treat it as an
  incident, not an invitation to merge or auto-repair.
- **The 500 ms poll currently masks bugs.** Removing it (B3) may expose latent ordering
  assumptions elsewhere; expect fallout in the slices immediately after.
- **Live rounds have already destroyed production data once.** Use a throwaway site id (G4).
