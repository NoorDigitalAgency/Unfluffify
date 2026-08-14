# Architect Q&A — Decisions (round 1)

Answers given by the architect on 2026-08-14, against `qa-brief.md`. These are binding
inputs to the plan. Questions still open are listed at the end.

---

## D1 — The reflex-arc doctrine STANDS, and the correction comes FIRST. ✅

The popup-as-orchestrator drift is a **defect to fix, not a new target to document**. The
plan's first phase is the corrective mandate:

- Signal birth moves **into the brain**. `main.tsx` must stop emitting the 12 signal names it
  currently emits with `source:"popup"`; the brain's `fold → decide` loop becomes the live
  path and its already-tested deciders stop being dead code.
- **Popup-composed content directives are removed.** The 500 ms poll that pushes a composed
  curtain/banner surface to content is the retired dictation model and must go; content
  becomes a signal consumer.
- The **dual state bag is deleted** (`preLockPopupState`, hand-built FSM states outside the
  transition table) per INV-10.4, along with the fabricated `source:"brain"` offline signals.
- Corollary: no further feature work should accrete onto `main.tsx` before this lands —
  the study found the rot grew in the newest ~15 commits, so every ported feature makes the
  correction larger.

`.reimplementation/` is **not** amended: the documents remain the acceptance bar.

---

## D2 — `/save` semantics: delegated to code inspection. **Answer: the backend must move to keyed per-page writes.**

The architect directed that this be answered from the backend source
(`/home/rojan/Documents/Git/GitHub/UnfluffifyHub`, branch `develop`). Findings:

**The backend today is effectively FULL-REPLACE of the page set, and it is deliberate.**

- `SaveCoreAsync` reads existing markings, computes `MergePageMarkings(existing, incoming,
  siteId)`, then **`DELETE FROM dbo.PageMarkings WHERE SiteId = @SiteId`** followed by an
  insert of the merged values (`SiteRepository.cs:46-60, 183-205`).
- `MergePageMarkings` (`SiteRepository.cs:153-170`) iterates **only over `incoming`**. A page
  that exists in the database but is **absent from the request is never copied into the merged
  set**, so the delete removes it and nothing re-inserts it. The "merge" resolves only
  *per-page timestamp conflicts* (newer wins) for pages the request names — it is **not** a
  preservation merge.
- This is **pinned by a test** stating the intent outright:
  `ConfigSyncContractTests.MergePageMarkings_DropsMarkings_AbsentFromIncomingRequest`
  (`ConfigSyncContractTests.cs:124`).
- `SaveRequest.Validate()` (`SaveRequest.cs:24-43`) accepts an **empty** `pageMarkings` map —
  it only requires non-null. So a save carrying `pageMarkings: {}` legally deletes every page
  marking for the site. **This is precisely the mechanism of the production wipe recorded in
  the live-QA findings, and it is still live on `develop`.**

**Why the answer is forced, not preferred.** D3 chooses **per-page** save operations. A
per-page save against full-replace semantics deletes the rest of the corpus *on every save* —
the hazard stops being an edge case and becomes the normal path. The two decisions are
incompatible, so the backend must change.

**Required backend change (small and surgical):** seed the merged dictionary from the existing
rows before applying incoming ones, so a request can only ever affect the pages it names:

```csharp
Dictionary<string, PageMarkingEntity> merged = new(existingByUrl, StringComparer.Ordinal);
foreach ((string pageUrl, PageMarking dto) in incoming) { /* newer-wins as today */ }
```

Deliberate deletion keeps its own door: `/remove` already exists and uses
`RemovePageMarking` (`SiteRepository.cs:172-181`). The pinned test must be **inverted** to
assert preservation, and a regression test should assert that an empty `pageMarkings` map
changes nothing.

**Client-side defence in depth is still warranted** — the legacy guard (dangling commit
`e11059b1`) refused to send a snapshot with zero page markings while the client or server
still held pages. That guard should be reinstated in the rewrite regardless of the backend
fix, since it costs little and closes the class from both ends.

---

## D3 — Per-page run and save; multi-page corpus as the AI *payload*. ✅

The architect's model, which differs from both options offered:

- **The AI run and the save both operate per page**, and a save is *"only meant for saving the
  latest calculated CSS selectors"*.
- **But the AI analysis dataset is multi-page**: each run submits the **whole stored corpus
  merged with the currently marked page** as one multi-page dataset, so the AI still
  generalizes across the property rather than from a single page.

Consequences for the plan:

- Selectors are **site-level** state (`Sites.SelectorsJson` / `SelectorsUpdatedAt` /
  `SubmittedSelectorsFingerprint`) — confirmed in `Entities/Site.cs:11-13`. Page markings are
  per-page. A save updates the named page's rows **and** the site's selectors.
- No storage redesign for multi-page *sessions* is needed; what is needed is **corpus assembly
  at AI-run time** — read all stored pages for the property from `/load`, merge the current
  page's live markings over the top, and submit that as the payload (this matches INV-5.15's
  "stored multi-page snapshot ... the only allowed live overlay is the current page").
- This makes D2's keyed-per-page write mandatory: the corpus must survive per-page saves in
  order to be assembled on the next run.

---

## D4 — Dark-shipped features: three of four go live. ✅

| Capability | Decision |
|---|---|
| **Property-lock collaboration** | **SHIP LIVE.** The full `PROPERTY_LOCK.md` contract. Note the rewrite's lock is currently popup-tethered (heartbeats stop ~30 s after the panel closes; no reconnect, HTTP reachability probes, off-candidate / cross-property / dispose-grace timers, tab-close release, or takeover UI) — all of that is now in scope. |
| **Page-type assignments + Todo list + Send to Lynx** | **SHIP LIVE.** Requires the `propertyPageTypes` candidacy feed, the coverage checklist (TODO x/5), candidate badges, and the `cssInfo`-gated Send flow. Bears on Q6 (candidacy source) — see open questions. |
| **Appearance / 16-theme customization** | **SHIP LIVE.** The full light-dark token catalog with user-selectable themes, rather than the single Nordic/System default production has always run. |
| **Desktop preview** | **NOT selected — treat as dropped** unless the architect says otherwise. |

---

---

# Q&A round 2 — decisions

## D5 — Static-render-mode properties are IN SCOPE for first cutover. ✅

Port a `fetchStaticPageHtml` equivalent plus the offscreen DOMParser XPath refinement, so a
static property can Run AI and Save. Excluding them would be a capability regression against
the shipping legacy product. Until this lands, the rewrite cannot serve any static property at
all — today the failure surfaces late, at Run AI time, because the schema requires `rawHtml`
iff `renderMode === 'static'` and no fetcher exists.

## D6 — Restore GraphQL `propertyPageTypes` candidacy. ✅

Candidacy returns to the backend feed as INV-1.4 requires, replacing the rewrite's
"has a stored `pageMarkings` record" rule. This:

- fixes the live-observed bug where a property whose config record was deleted becomes
  permanently un-editable (no record → not a candidate → cannot bootstrap), and
- is a prerequisite for the Todo list, candidate badges, and page-type coverage chosen in D4.

## D7 — The property lock is TAB-SCOPED and survives the side panel closing. ✅

The lock lifecycle moves out of the popup and into the background/brain: claim immediately on
landing on a candidate page, heartbeat every 30 s while the editor has interacted within 30
min, independent of whether the panel is open. In scope as a direct consequence: reconnect
with backoff, independent HTTP reachability probes, off-candidate (70 s), connection-loss
(70 s), cross-property cooldown (30 s), port-disconnect dispose grace (70 s) with tab-close
bypassing it, passive-observer release countdown (60 s), and the takeover/transfer UI. The
current popup-tethered heartbeat is therefore a **bug**, not a simplification.

## D8 — Keep the side-panel surface. ✅

The per-tab Chrome side panel (opened via `action.onClicked`; no `default_popup`) stays. It
persists across tab switches and navigations, which suits a workflow where the operator clicks
around the page while marking. The tab-rebinding lifecycle is an accepted cost.

---

## Still open (carried to Q&A round 3)

All of Tier 3 (Q8–Q18 UX fidelity, minus the side-panel question now settled as D8) and Tier 4
(inherited decisions legacy never resolved) remain unasked.
