# Architect Q&A Brief — consolidated from the study

The study agents raised **38 open questions** (verbatim, per-agent, in `agent-returns.md`).
Most are variants of a smaller number of real decisions. This brief consolidates them into
the decisions that actually change the plan, ranked by whether they **block** plan-writing.

Status: provisional until the two synthesis reports land; they may add or retire items.

---

## Tier 1 — BLOCKING. The plan's structure depends on these.

### Q1. Does the reflex-arc doctrine still govern acceptance?

**Why it's blocking.** The study found the rewrite's authority model is inverted at the top:
`src/entrypoints/popup/main.tsx` (1,800 lines, ~45 module-level mutables) is the de-facto
orchestrator. It emits **12 of the 16 signal names itself** with `source:"popup"`, bypassing
the brain's fold→decide loop, which leaves the brain's tested deciders as **dead code in the
live path**. It also composes the content organ's whole curtain/banner surface and pushes it
on a 500 ms poll — the retired "dictation model" relocated from background to popup — and
hand-builds FSM states outside the transition table (`preLockPopupState`), which is the dual
state bag INV-10.4 forbids. Content consumes **zero** brain signals.

The lower layers are genuinely contract-true (pure domain spine, popup FSM + frozen memory
matrix, typed bus, nonce-armed page-world program, backend-issued lock identity). The rot is
confined to the entrypoints — the coordination layer the rewrite existed to fix — and it grew
in the **newest ~15 commits**.

**The decision.** Either (a) the doctrine stands and the plan opens with a corrective mandate
to move signal birth into the brain and stop popup-composed directives, or (b) the doctrine is
consciously relaxed to "one popup orchestrator over clean organs", and `.reimplementation/`
must be amended so future audits measure against the real target. **Answering (b) makes much
of the correction work disappear; answering (a) makes it the plan's spine.** This cannot be
decided from code.

### Q2. What are the owned backend's `/save` semantics — full replace or per-page merge?

**Why it's blocking.** The rewrite posts a **single-page** ConfigSnapshot and **discards the
`/save` response** (INV-6.5 requires all locally-marked pages as one snapshot, response
replaces local). If the backend does full-replace, **saving page B wipes pages A and C** —
the identical class that wiped a production property on a 200 response in legacy, whose only
guard exists as dangling commit `e11059b1` and is on no branch.

**The decision.** Full-replace (so the client must assemble a multi-page snapshot and carry a
refuse-to-shrink guard), or keyed per-page/delta writes (which closes the wipe class
server-side). You own this backend, so this is yours to set. Related: should the client keep a
destructive-write guard regardless, as defence in depth?

### Q3. Is the single-page marking session an accepted redesign, or must the multi-page corpus return?

**Why it's blocking.** Legacy marks several pages, runs AI over the stored corpus, and saves
all at once (INV-5.15 / INV-6.5). The rewrite marks and saves **one page at a time** and never
persists the session. **The current architecture cannot express the multi-page model without a
storage-model change**, so this decides whether the plan contains a storage redesign phase.

---

## Tier 2 — SCOPE. These set the plan's size and cutover bar.

### Q4. Which dark-shipped capabilities are actually wanted?

**All 10 legacy feature flags ship `false` in production.** Built but never run by a real user:
property-lock collaboration (the entire `PROPERTY_LOCK.md` contract), desktop preview,
device-emulation toggle, render-mode auto-detection, cache/unregister tools, page-type
assignments, page-types change detection, preview expanded states, 16-theme appearance
customization. Porting these faithfully is a large fraction of the total work — and porting
them *dark* is pure cost. For each: **want it live, keep it dark, or drop it?**

Property-lock deserves its own answer: the rewrite's lock is popup-tethered (heartbeats stop
within 30 s of closing the panel; no reconnect, probes, off-candidate/cooldown timers,
tab-close release, or takeover UI). Building it to contract is significant work that no
production user has ever exercised.

### Q5. Are static-render-mode properties in scope for the first cutover?

Run AI and Save on a static property are **structurally impossible today**: the schema requires
`rawHtml` iff static, and no static-HTML fetcher exists anywhere in the rewrite. Either port a
`fetchStaticPageHtml` equivalent, or explicitly exclude static properties from cutover.

### Q6. Is candidacy-from-stored-page-records accepted (vs GraphQL `propertyPageTypes`)?

The rewrite redefined "candidate page" as *has a stored `pageMarkings` record from `/load`*,
not the GraphQL feed (INV-1.4). Consequence: **a property with no config record cannot be
bootstrapped** — matching the live finding on ledigajobb. Also decides whether the Todo list,
candidate badges, and Send-to-Lynx surfaces are required for cutover or deferred.

### Q7. Must the editor lock be held while the side panel is closed?

Contract implies yes (claim on candidacy, heartbeat while interacted < 30 min); the
implementation ties heartbeats to the open panel's poll. This is a product call on lock
semantics, and it determines whether the current behavior is a bug or a simplification.

---

## Tier 3 — UX FIDELITY. Port faithfully, or deliberately change?

The task says port legacy's established UX. These are the places where legacy's own UX is
questionable, so faithful porting may be the wrong call. Each is cheap to decide, and the plan
should record the decision rather than silently choose.

| # | Legacy behavior | The question |
|---|-----------------|--------------|
| Q8 | The "popup" is really a per-tab **side panel** (persists across tab switches and navigations). The entire tab-rebinding lifecycle exists only because of that. | Keep the side panel, or move to a conventional action popup? |
| Q9 | **Save ends the session** and drops the user back to silent mode; marking must be re-entered. | Intended UX, or an artifact of the legacy save/reconciliation design? |
| Q10 | The freeze is **page-visit-sticky**: after disabling marking the page stays frozen (animations and media halted) until navigation. | Desired, or should disabling fully release the page? |
| Q11 | **Consent chrome is hidden on every configured property page**, including for passive visitors who are not editing. | Intended scope? It means the operator can never interact with a cookie banner on a live customer site — worth an explicit decision given consent implications. |
| Q12 | The reveal ritual runs **up to 10 scroll passes with 1 s dwells** — potentially 20–30 s of blocked input on a long page. | Keep the timings, or is a faster/interruptible reveal acceptable? |
| Q13 | **Right-click also commits a mark** (contextmenu is captured). | Keep, or reserve right-click for the browser context menu? |
| Q14 | In silent mode, **left-click on a highlighted node copies** selector+XPath, hijacking normal page clicks. | Preserve this affordance? |
| Q15 | Destructive confirmations use **native blocking `window.confirm`**, which freezes the fact pipeline and breaks automation. | Keep native dialogs, or move to non-blocking in-popup confirmation? |
| Q16 | Legacy emulates **viewport only** (412×960, no UA spoofing); the rewrite added Pixel 7 / Android 13 UA + client-hints spoofing (`489649d8`). | How deep should identity spoofing go — is Googlebot-smartphone parity the target? It defines what saved snapshots actually represent. |
| Q17 | A render-mode change **silently invalidates** previously computed AI selectors (timestamp rule). | Keep the invalidation, and should the user be told when it happens? |
| Q18 | Send-to-Lynx's `cssInfo` gate **disables Send when Lynx already holds matching selectors**. | Keep "cannot re-send identical selectors", or allow an idempotent re-send? |

---

## Tier 4 — Inherited unresolved decisions (legacy never answered these)

- **Fail-open API audit (legacy task #18)** — never resolved. The rewrite needs the decision
  table: which network failures must **block** vs **degrade**.
- **Recovery UX for a deleted backend config record** — silent auto-recreation from local
  state, or an explicit re-onboarding flow requiring render-mode re-inspection? (Observed live:
  such a property is currently un-editable.)
- **AI run completing after the panel closes** — should the background persist and surface the
  result on next open? Today the popup is the only writer of `config.selectors`, on the happy
  path only, which is the mechanism behind the observed intermittent selector loss.
- **Marking never survives navigation/reload** — keep, or should an accidental same-URL reload
  resume the session with its unsaved draft?
- **Page-block scope** — block the page only when the popup is busy *and* interaction can
  affect results (the last recorded user word), or every popup curtain blocks the page?
- **Widening F2 tradeoff** — landmark-less full-width columns are widen-eligible again; accept
  the same over-widening risk, or impose a different restraint now the code is rebuilt?
