# Completeness Critique — what the nine study reports do NOT cover

**Role.** Completeness critic. I did not re-do the studies; I enumerated ground truth independently and
asked *what would a repository-level implementation plan written from these nine reports get wrong or
silently omit?*

**Trees inspected.**
- LEGACY: `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main` (branch `main`, HEAD `28974c2a`, v1.10.0+3) — 185 source files under `src/`, 72,750 LOC of `.ts`/`.tsx`.
- REWRITE: `/home/rojan/Documents/Git/GitHub/Unfluffify` (branch `re-write`, HEAD `9bc59120`) — 116 source files under `src/`, 13,157 LOC.
- **BACKEND (never read by any report): `/home/rojan/Documents/Git/GitHub/UnfluffifyHub`, branch `develop`, HEAD `4a4878e`.**

**Reports audited (9).** `legacy-popup-ux.md`, `legacy-content-ux.md`, `legacy-feature-flows.md`,
`legacy-locked-contracts.md`, `legacy-arch-weaknesses.md`, `rewrite-architecture.md`,
`rewrite-implementation-state.md`, `verdicts-weakness-resolution.md`, `catalog-ux-bring-over.md`.

**Headline.** The nine reports are, for their declared scopes, unusually good. The UX catalog and the
weakness verdict table are close to exhaustive within their lanes. **The gaps are not inside the lanes —
they are between them.** Four things fall in the seams and each one can break a plan written from these
reports:

1. **70 of 112 locked behavioral contracts (`C-*`) have no verdict anywhere.** The verdict table maps
   `W-*` (architecture weaknesses); the catalog maps UX. Nobody mapped the `[ALG]`/`[PROTO]` families —
   marking model, target resolution, widening, shadow DOM, submission rows, save protocol, perf. Spot
   checks prove these are not bookkeeping: real divergences exist in at least three of them.
2. **No report reads the backend.** The backend on `develop` has **already merged the rewrite's
   unified-rows contract** (`SaveRequest.CurrentVersion = 1`) with a strict `Disallow`-unknown-members
   schema. That changes cutover ordering, invalidates one locked contract as written, and exposes at
   least one live wire mismatch on the rewrite's own save payload.
3. **The legacy test suite (203 files) is unanalyzed as a spec corpus.** The rewrite has 64. No report
   says which legacy behavior test has no counterpart, so the plan has no regression net to specify.
4. **The signal-birth topology is mis-stated in the binding decision `D1`.** `fold → decide` is *not*
   dead code — it is live via `fact.reported`. The real defect is that **both** birth paths run and
   `signalLog.append` never dedups. A phase-1 mandate written from D1's phrasing turns on a path that is
   already on and never addresses the duplicate class.

Everything below is evidence for those four, plus the smaller findings and the *negative* results (things
I checked and found genuinely covered, so the plan author need not re-check them).

---

## 1. File-level coverage sweep

### 1.1 Method

Extracted every `basename.ext` token from all nine reports (185 distinct, including brace-expanded
citations such as `{fold,decide,project,signals}.ts`), then diffed against `find src -type f` in both
trees. Basename matching is deliberately generous — it over-credits coverage, so anything it flags as
uncovered is very likely a genuine blind spot.

### 1.2 Rewrite tree — 12 of 116 source files cited by no report

| File | LOC | Why it matters |
|---|---|---|
| `src/content/marking/resolve.ts` | 66 | Click→target resolution. This is the whole of `C-TGT-1/3/4/6` on the rewrite side. |
| `src/content/marking/flatten.ts` | 41 | The `C-SHDW-1` "flatten shadow into the sanitized snapshot" surface. |
| `src/content/marking/silent-highlight.ts` | 19 | `C-SIL-1`; see §5.5 — it is selector-independent, unlike legacy. |
| `src/domain/schema/facts.ts` | — | The `TabFacts` vocabulary the brain folds. The plan's phase 1 rewrites exactly this. |
| `src/domain/schema/property.ts` | — | `SiteIdSchema` — nullable client-side, non-nullable server-side (§3.3). |
| `src/messaging/contracts/facts.ts` | — | The `fact.reported` envelope, i.e. the live brain input path. |
| `src/storage/repositories/{lock-identity,run-records}.ts` | — | Lock identity durability and AI run records — both in scope after `D4`/`D7`. |
| `src/types/{lifecycle,messaging,operations,assets.d}.ts` | — | Carried-over legacy type surface; likely dead, but nobody said so. |

The first three are the sharpest: **the rewrite's entire click-resolution + shadow-flattening + silent
highlight implementation is 126 lines that no report opened.**

### 1.3 Legacy tree — 72 of 185 source files cited by no report

Ranked by size, the ones that carry behavior rather than plumbing:

| File | LOC | Contract / behavior at stake |
|---|---|---|
| `src/common/xpath-utilities.ts` | 449 | **`C-SHDW-2`** — continuous positional XPath through shadow (composed-tree walk, index-shift past preceding same-tag shadow children, native-first `getElementFromXPath` with composed fallback). The rewrite's whole `src/domain/xpath.ts` is **74 lines**. Nobody quantified that delta. |
| `src/common/storage-core.ts` | 472 | Storage serialization/queueing — the substrate under `W-14` (whole-map read-modify-write) that the plan must replace. |
| `src/content/explicit-marking-handler.ts` | 319 | The explicit include/exclude write path (`C-TGT-3` "exclude drills; include reaches"). |
| `src/content/shared-selector-cache.ts` | 216 | The `CP7a` caches whose absence the verdicts report blames for the rewrite's O(n²) (Finding B) — but the cache design itself was never read. |
| `src/background/tab-inactivity-observer.ts` | 218 | 30 s inactivity alarm that restores JavaScript after a no-JS hold. Appears in 4 study reports, **in neither synthesis report**. |
| `src/content/marking-machine.ts` | 143 | The marking interaction FSM (`C-MARK-*` §1.2). |
| `src/content/submission-rules.ts`, `src/content/shared-inclusion.ts` | 80–? | `C-SUB-2` row rules (a)–(j). |
| `src/content/property-lock-banner-mode.ts` | 120 | The 13 banner modes; `D4`/`D7` put all of them in scope. `legacy-content-ux.md:317` describes them, but the mode *derivation* was not read. |
| `src/background/brain/deciders/{activation,render-mode,popup-state}-decider.ts` | 152/103/? | Legacy's already-factored deciders — the closest existing prior art for the rewrite's `decide.ts`. |
| `src/background/brain/view-projector.ts` | 312 | Legacy's projection layer, the analogue of `brain/project.ts`. |

Full list at `…/scratchpad/legacy-uncovered.txt`.

### 1.4 Chrome-level surfaces — checked, and the answer is clean (no gap)

I checked every surface the brief named as a likely blind spot. `wxt.config.ts` is **byte-identical**
between the two trees (`diff` exit 0), so the manifest is not a divergence source at all.

| Surface | Legacy | Rewrite | Report coverage |
|---|---|---|---|
| Options page | none | none | n/a — correctly absent from reports |
| i18n / `_locales` | none | none | n/a |
| `chrome.commands` / keyboard shortcuts (manifest) | none | none | catalog §G.2 covers *in-page* hotkeys |
| `contextMenus` | none | none | n/a |
| `onInstalled` / `setUninstallURL` | none | none | **see §6.2 — the absence is itself a plan item** |
| Badge text | none | none | `legacy-content-ux.md:321-323` states this explicitly |
| `action.setIcon` per-tab | `common/utilities.ts:754-798`, refreshed from `background.ts:1159,3518,3608,3634,4041,4281` and `ai-run-orchestrator.ts:489` | **none** | fully covered: catalog §G.1 ASSET-ONLY P2, `rewrite-implementation-state.md:226,476`, OQ-16 |
| `sidePanel` | `background.ts:525-533` | `background/index.ts` | covered; settled by `D8` |
| `browsingData.remove` | `background.ts:542-556` | **none** | covered (3 reports) |
| `webNavigation` (5 listeners) | `background.ts:3914,3957,3959,3973,3984` | **none** | covered (5 reports) |
| `chrome.alarms` | 5 modules | 1 (`background/index.ts` keepalive) | covered |
| `web_accessible_resources` | `assets/materialdesignicons-webfont.woff2`, `cursors/*.svg` | identical | catalog §D.6 (cursors ASSET-ONLY), §A.4 (icons) |
| Offscreen document | both | both | covered (7 reports) |

**Conclusion: there is no manifest/Chrome-API blind spot.** The brief's hypothesis is disconfirmed;
the plan author can skip this class.

---

## 2. Cross-check: synthesis reports vs study reports

### 2.1 Weaknesses → verdicts: **complete**

All 49 `W-01…W-49` from `legacy-arch-weaknesses.md` appear in `verdicts-weakness-resolution.md`. Set
difference is empty. Pain register `P#`/`D#`/`M#` items are likewise carried.

### 2.2 UX elements → bring-over rows: **essentially complete**

Every numbered section of `legacy-popup-ux.md` (30 sections) and `legacy-content-ux.md` (19 sections)
has a corresponding catalog area. Spot-checked the least-likely-to-be-carried items and all are present:
debug affordances / `directMode`, vestigial view-state, Space passthrough, click-to-copy, right-click /
`contextmenu` toggling, tooltip annotations, 16-theme appearance catalog, activity log, side panel.

Two minor omissions:
- **Tab-inactivity / no-JS-hold restore** (`legacy-feature-flows.md:171,341`) has no catalog row and no
  verdict row. It is the mechanism that un-holds a JS-disabled tab after 30 s; the rewrite has no
  equivalent, and `catalog §E.5` (render-mode inspection ritual, PARTIAL) does not mention it.
- **Popup lifecycle** (`legacy-popup-ux.md` §26) has no catalog section (`grep -c "popup lifecycle"`
  → catalog 0). Boot order, unload teardown and port lifecycle are scattered but never gathered.

### 2.3 Locked contracts → mapped: **NOT complete — this is the big one**

| Report | distinct `C-*` referenced |
|---|---|
| `legacy-locked-contracts.md` | **112** (the register itself) |
| `catalog-ux-bring-over.md` | 40 |
| `verdicts-weakness-resolution.md` | 9 |
| all seven other reports | **0** |

Union of the two synthesis reports = 42. **70 contracts are referenced by no report other than the one
that authored them.** They are not obscure ones — they are whole families:

```
C-BRAIN-1,2,3,4,5,6,9,10,11,12,13   (11 of 13)  brain/signal/state doctrine
C-MARK-1,2,3,4,5,8,10,…,17          (12 of 17)  the marking model itself
C-TGT-1,3,5,6,7,8                   ( 6 of 8 )  hit-testing, widening, visibility
C-SUB-1,2,3,4,5                     ( 5 of 7 )  AI submission row rules
C-SAVE-1,2,3,4,5,6                  ( 6 of 7 )  page save / backend data
C-LOCK-1,2,4,5,7,8,9,10             ( 8 of 10)  property-lock protocol
C-SHDW-1,2,3                        ( 3 of 3 )  shadow DOM — entirely unmapped
C-PERF-1,3,4,5                      ( 4 of 5 )  marking performance
C-POP-1,2,8,9 · C-META-1,2,3 · C-LIFE-7,8 · C-SIL-1 · C-SPIN-1,3 · C-EMU-2
```

This matters because §5 shows that when you actually check them, **they fail**. The `W-*` verdict table
answers "did the rewrite fix legacy's architectural sins?" It does not answer "does the rewrite still
produce the same marking rows?" — and *that* is the product.

### 2.4 Rewrite's own invariants (`INV-*`) → mapped: partial

`.reimplementation/contract-invariants.md` declares **123** `INV-*` ids. Only `rewrite-architecture.md`
cites any (25). Lower priority than §2.3 — `INV-*` are the rewrite's self-imposed rules, and `D1`
already re-affirms `.reimplementation/` as the acceptance bar — but a plan that claims INV compliance
has no evidence base for ~98 of them.

---

## 3. The backend was never read — and it has already moved

**No report string-matches `UnfluffifyHub`, `SaveRequest`, or `CurrentVersion`.** The only place the
backend appears in this whole study is `.reimplementation/study/qa-decisions.md` §D2, which read
`SiteRepository.cs` for *merge* semantics only. The schema, validation and version contract were never
opened. Reading them changes several plan inputs.

### 3.1 The backend `develop` branch has already adopted the rewrite contract

`UnfluffifyHub/Dtos/SaveRequest.cs`:

```csharp
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record SaveRequest(… Dictionary<string, PageMarking> PageMarkings, SelectorSet? Selectors, …)
{
    // Rewrite ConfigSnapshot schema version. The rewritten frontend stamps version 1
    // for the new unified-rows contract … No backwards compatibility with the
    // legacy version-5 payload.
    public const int CurrentVersion = 1;
    public string? Validate()
    {
        if (Version != CurrentVersion) return $"Only version {CurrentVersion} is supported.";
        …
        if (Selectors is null) return "selectors is required.";
```

`UnfluffifyHub/Dtos/PageMarking.cs:6-18` carries `rows` (`List<XpathEntry>`), **not**
`xpaths`/`submissionXpaths`. Git history: `4a4878e Merge pull request #49 from
NoorDigitalAgency/rewrite/rows-contract-and-migration`, including `94c4562 … guard XpathsJson column
existence in legacy migration`.

**Consequences the plan must absorb:**

- Legacy production (v1.10.0, config `version: 5`, sends `xpaths`+`submissionXpaths`) will be **rejected
  twice over** by this backend: version check fails, and `JsonUnmappedMemberHandling.Disallow` rejects
  the unknown members. If `develop` is deployed, legacy is already broken; if not, the deploy is a
  hard cutover, not a rollout. **This is a release-sequencing constraint no report states.**
- The project brief's ground rule ("the schema redesign is DELIBERATE, do not flag it") is correct
  *and* under-stated: the backend is already committed to it, so the rewrite is not optional.

### 3.2 `C-SAVE-1` as written is stale

`legacy-locked-contracts.md:605-609` states *"backend `PageMarking.PageType` is `[JsonRequired]`;
validation rejects blank/unknown."* On `develop` that is **false**: `PageMarking.cs:10-11` marks
`PageType` as `string?` with `JsonIgnore(WhenWritingNull)`, and `Validate()` (`:37-43`) says outright
*"pageType is optional in the rewrite contract; when present it must be a known slug."* There is no
`[JsonRequired]` anywhere in the repository (`grep -rn "JsonRequired" --include=*.cs` → 0 hits).

So the plan should **not** carry `C-SAVE-1`'s "pageType is mandatory or the save is rejected" premise.
What survives is the *product* consequence: the rewrite never sends `pageType` (`grep -rn "pageType"
src` → 4 hits, none on the save path) and never reads `GET /page-types` (`Program.cs:108`), so page-type
coverage, the Todo card, candidate badges and Send-to-Lynx — all **SHIP LIVE** per `D4` — have no data
source. `catalog §C.7` correctly marks the Todo card ABSENT/P0; nobody connected it to the taxonomy
endpoint.

### 3.3 A live wire mismatch on the rewrite's own save payload

Client (`src/storage/config.ts:22`): `siteId: SiteIdSchema.nullable()`.
Payload builder (`src/entrypoints/popup/main.tsx:860`): `siteId: activeSiteId`, where
`activeSiteId: number | null` (`main.tsx:66`, reset to `null` at `:354`).
Server (`SaveRequest.cs`): `[property: JsonPropertyName("siteId")] int SiteId` — **non-nullable**.

A `siteId: null` body fails System.Text.Json deserialization before `Validate()` ever runs, i.e. a 400
with no useful message. Whether that state is reachable depends on the save gating; it needs a read of
the enable/save guard chain, which no report performed. Also unchecked: `Disallow` means **any** field
the plan adds to the payload (e.g. re-introducing `title`, which legacy sent and the rewrite drops) is a
hard 400 until the backend adds it.

### 3.4 What the backend does *not* host

`Program.cs` exposes only `/version`, `/page-types`, `/save`, `/load`, `/remove`. The lock endpoints,
`/get_selectors`, `/is_js_rendered` and `/assign_page_types` live elsewhere. `/is_js_rendered` and
`/assign_page_types` are the only two endpoints in `legacy:background/remote-network.ts` that I feared
were uncovered — both are in fact cited by `legacy-feature-flows.md` and `catalog-ux-bring-over.md`, so
the **endpoint inventory is complete**. It is the *schema and validation* layer that is missing.

---

## 4. The legacy test suite is unanalyzed

| Tree | test files |
|---|---|
| legacy `tests/` | **203** |
| rewrite `tests/` | **64** |

Distinct test-file paths cited across all nine reports: **11**, of which 6 are rewrite guard tests
(`typing-ratchet`, `no-ts-ignore-guard`, `import-boundary`, `rewrite-cutover`, `theme-colors`,
`build-artifact-parity`). The verdict table quotes the aggregate ("58 files / 485 tests green, 8.06 s")
but never asks what those 485 do *not* cover.

Legacy's suite is not incidental — it is the executable form of the `C-*` register that §2.3 shows is
unmapped. Examples with no rewrite counterpart by name:
`core-hover-performance`, `core-visibility`, `core-motion-pause`, `core-scheduling`,
`content-marking-machine`, `content-overlay-memory`, `content-activation-order`,
`consent-selector-precision`, `collect-ai-submission-xpaths`, `dirty-baseline`,
`device-emulation-lifecycle`, `background-page-data-lifecycle`, `background-render-mode-inspection`,
`brain-projection-dedup`, `config-store-queue`, `command-ledger`, `storage-access-boundary`
(the last of which is itself a locked contract, `C-BRAIN-13`).

A repository-level plan needs to say, per slice, *which tests prove it*. Right now there is no input
document from which that sentence can be written.

---

## 5. Verification of the ten most load-bearing claims

All ten read directly from source in this session. Rewrite HEAD is `9bc59120`; the verdict table's
baseline `07197d39` differs only by two docs-only commits (`git diff --stat 07197d39..HEAD` touches only
`.reimplementation/study/*`), so its citations remain valid.

| # | Claim | Source | Verdict |
|---|---|---|---|
| 1 | **Finding A** — `broadViewportFootprint` re-introduces the page-shell rejection legacy deleted | verdicts headline | ✅ **CONFIRMED, and worse than stated** — see §5.1 |
| 2 | **Finding B** — the content directive root is not tagged as extension UI, so every push re-triggers the O(n²) rebuild | verdicts headline | ✅ **CONFIRMED** — see §5.2 |
| 3 | `/save` body carries exactly one page | `main.tsx:866-873` | ✅ CONFIRMED — `pageMarkings: { [page.url]: {…} }` from `snapshot.pages[0]` (`main.tsx:856,866-872`) |
| 4 | `rehydrateDurableFacts` is never called | `services.ts:229-230` | ✅ CONFIRMED — the only non-test references are the import (`services.ts:28`) and the service wrapper (`:229-230`); `getBrain` (`rewrite-brain-runtime.ts:62-69`) constructs `createRewriteBrain(tabId)` with no initial facts |
| 5 | The reveal walk is synchronous / inert | `reveal.ts:21-31` | ✅ CONFIRMED — `runReveal` is `async` but contains **zero `await`s**: `scrollTo("top")→("half")→suppressLazy→("bottom")→freeze→("restore")` all in one turn (`reveal.ts:17-32`). Nothing can lazy-load in between; `lazyExpansions` is computed from a caller-supplied height, not observed. |
| 6 | Composed display copy crosses the layer boundary | `lock-runtime.ts:77` | ✅ CONFIRMED — `curtain: { visible: !view.canEdit, text: view.text \|\| "Property locked" }` |
| 7 | The popup pushes a content directive every 500 ms | `main.tsx:829` | ✅ CONFIRMED (mechanism) — `window.setInterval(…, 500)` at `main.tsx:482-486`; each tick reaches `refreshLockDirective` → `sendContentMessage(…, composeContentDirective(…))` (`main.tsx:823-830`), unconditional |
| 8 | No `action.setIcon` anywhere in the rewrite | catalog §G.1 | ✅ CONFIRMED — `grep -rl "setIcon" src` → empty |
| 9 | Silent highlighting is popup-gated and selector-driven | catalog §D.8 | ✅ CONFIRMED for the popup gating (`refreshSilentSelectorPreview`, `main.tsx:509,516-539`) — **but see §5.5**, there is a *second*, selector-independent silent path the catalog does not mention |
| 10 | `fold → decide` is dead code / signals are born in the popup | `qa-decisions.md` D1 | ❌ **PARTLY WRONG** — see §5.4 |

### 5.1 Finding A is confirmed — and the widening ladder is a second, separate regression

Chain verified end to end:

- `src/domain/boundary.ts:41-43` — `isPageShell` returns `true` for any `broadViewportFootprint` node.
- `src/content/marking/dom-view.ts:228` — `broadViewportFootprint: rect.width >= innerWidth * 0.9`.
- `src/domain/boundary.ts:52` — `isStructuralBoundary` early-returns `false` when `isPageShell(node)`.
- `src/content/marking/dom-view.ts:60-72` — the DOM-side `isStructuralBoundary` **passes
  `broadViewportFootprint` straight through** to the domain function, so any full-width element gets
  `structuralBoundary: false` at `dom-view.ts:225`.
- `src/content/marking/engine.ts:99-107` — `collectDefaultExclusionRows` requires
  `(node.ownsDirectText || node.structuralBoundary)`.

⇒ a full-width `<footer>` that owns no direct text (a container of links/lists — the normal case) gets
**no default exclusion row**, and `domain/evaluate.ts:62-64` then classifies its text-bearing
descendants `implicit-include`, which `evaluate.ts:67,113-116` submits to the AI as content. This is
exactly the bonliva footer bug legacy fixed and locked as `C-TGT-5` item 2.

**Second regression, not in any report.** The same predicate also kills `isSelfMarkable`
(`boundary.ts:67-76`) for full-width containers, and `widening.ts` bails on `isPageShell` in all three
entry points (`:44,55,57`). Separately, `chooseWidenTarget` (`widening.ts:66-77`) climbs to the
**outermost** eligible ancestor. Legacy's `C-TGT-4` locks a four-step ladder: *(1) the clicked element if
it is a structured group or toggleable boundary, (2) the **nearest** structured-group ancestor, (3) the
nearest toggleable ancestor, (4) the broadest markable ancestor.* The rewrite implements only step (4).
Shift+Click therefore selects a materially different element than legacy on the same page. Nobody
reported this because widening lives under `C-TGT-4/5`, i.e. inside the 70 unmapped contracts.

### 5.2 Finding B is confirmed at the exact seam

`src/entrypoints/content-loader.content.ts:301-310` creates the directive root with
`setAttribute("data-uf-content-directive-root", "true")` — **not** `data-uf-extension-ui`. The mutation
filter at `engine.ts:204-207` tests `element?.closest?.('[data-uf-extension-ui="true"]')`, and the DOM
bridge's own skip test (`dom-view.ts:152-157`) accepts `data-wxt-shadow-root`,
`data-uf-extension-ui="true"`, `browser-mcp-container`, or `id` starting `unfluffify-` — the directive
root matches none of them. The overlay renderer *does* tag itself correctly
(`renderer.ts:54,65,99,116,136`), so the bug is specific to the directive surface.

⇒ every 500 ms tick that renders or clears a banner/curtain mutates an untagged node inside the observed
root, which calls `scheduleRender` → `refreshBridge` → `createDomBridgeView(rootElement)` — a full
document rebuild whose per-node cost is `O(subtree)` (`dom-view.ts:219-233` recomputes
`landmarkCount(element)` **twice** per node plus `geometryFor(element)`). The directive root is also
*inside* `document.documentElement`, which is the observed root.

### 5.3 What is genuinely covered (do not re-investigate)

Manifest/permissions (§1.4); the endpoint inventory (§3.4); toolbar icon; 16-theme catalog; page-side
toast copy tables; overlay class catalog; cursors; consent hiding; property-lock banner mode list;
feature-flag production state; timing-constant tables. `catalog-ux-bring-over.md` §A–§K is the best
document in the set and needs no supplement for UX.

### 5.4 Claim 10 is wrong in a way that matters for phase 1

`qa-decisions.md` D1 says *"the brain's `fold → decide` loop **becomes** the live path and its
already-tested deciders **stop being dead code**."* Verified against source:

- `brain.observe` (which runs `fold` → `decideSignals` → `signalLog.append`, `rewrite-brain.ts:14-22`)
  **is on the live path today**, reached from `background/index.ts:158-170` on every `fact.reported`
  bus event, and from `:115-131` on every property-lock fact.
- `fact.reported` is emitted by **both** organs: `main.tsx:1020-1032` (popup) and
  `content-loader.content.ts:262-275` (content).
- The `uf.rewriteBrain.observe` runtime message (`rewrite-brain-runtime.ts:10,77-80`) *is* dead —
  `grep -rn "rewriteBrain.observe" src tests` finds senders only in `tests/src/background/brain.test.ts:268,318`.
  That is probably what was mistaken for "fold/decide is dead".

**The actual defect is dual birth with no dedup.** The popup also births signals directly:
`emitPopupSignal` / `emitPopupSignalAndPullTail` (`main.tsx:414-441`, both stamping `source: "popup"`)
are called from 12 sites (`:470, 897, 952, 984, 1001, 1531, 1540, 1558, 1584, 1638, 1646, 1654, 1671,
1676, 1704, 1724`) covering ~10 distinct names — `session.navigated`, `marking.enabled`,
`marking.disabled`, `run.started/failed/completed`, `reconciliation.started/ended`, `session.saved`,
`session.discarded`, `preview.opened`. Content does the same via `emitContentBrainSignal`
(`content-loader.content.ts:250-259`, `source: "content"`).

`decideSignals` independently births `session.navigated` (`decide.ts:14-20`), `marking.enabled`
(`:22-28`) and `marking.disabled` (`:29-35`) from fact edges. And `signalLog.append`
(`brain/signals.ts:24-40`) unconditionally does `seq += 1; entries.push(signal)` — **there is no dedup,
no idempotency key, no same-name-same-edge suppression.** Once-only consumption
(`pullForOrgan`/`markConsumed`, `signals.ts:53-61`) is a per-organ cursor, so a consumer sees *both*
copies as two distinct events.

⇒ enabling marking births `marking.enabled` twice (once `source:"popup"`, once `source:"brain"` on the
next content fact ping); a navigation births `session.navigated` twice. The `W-04` verdict noticed the
adjacent class ("one fact, `markingToggleSeq`, has two reporters") but not this one. **A phase-1
mandate written from D1 will "move signal birth into the brain" without being told that the brain path
already exists and that the work is deleting the popup path *and* adding edge-dedup.**

### 5.5 A second silent-highlight path the catalog does not describe

`catalog §D.8` documents the popup-driven, selector-based path
(`applySilentSelectors`/`clearSilentSelectors`, `main.tsx:516-539`). There is also
`src/content/marking/silent-highlight.ts:5-19` → `engine.ts:171-177,180-182`, which derives highlights
from `evaluation.rows` — i.e. **from the live marking evaluation, with no reference to stored CSS
selectors at all**. Legacy's silent mode is definitionally selector-driven (the point is to show what
the *saved selectors* would match). Which of the two the rewrite actually paints, and whether they can
both be armed, is unresolved by any report. `silentHighlightsArmed` (`engine.ts:164,180`) is the gate;
its callers were not traced.

---

## 6. Smaller gaps worth a line in the plan

### 6.1 Closed-shadow instrumentation is a rewrite-only invention with no legacy contract

`dom-view.ts:254-278` monkey-patches `Element.prototype.attachShadow` to stamp
`data-uf-closed-shadow-host` on closed hosts (mirrored in the page world at
`src/page-world/program.js:30-49`), and `evaluate.ts:46-48` then classifies those subtrees
`"closed-shadow"` with a synthetic `/__closed-shadow[n]` XPath segment (`dom-view.ts:200-206`).
Legacy's `C-SHDW-1` is explicit that *"closed roots are silently skipped."* Three reports mention
"closed shadow" in passing; none asks whether the synthetic XPath segment is legal in a payload the AI
must map back to captured HTML (`C-SUB-4`: *"purely positional `/tag[index]/…`"*). It is not obviously
legal.

### 6.2 No install/update hook and no storage migration

Neither tree registers `onInstalled`. The rewrite has no migration for `chrome.storage` data written by
legacy (`grep -rn "migrat" src/storage` → 0). Since the backend shipped a *server-side* legacy migration
(`94c4562 … guard XpathsJson column existence in legacy migration`), the client-side counterpart is a
visible asymmetry: an editor who updates in place keeps legacy-shaped local state that
`parseConfigSnapshot` (`storage/config.ts:36-38`) will throw on. Not a report error — nobody was asked —
but it is a plan item nobody will otherwise write.

### 6.3 Static render mode: `D5` scope has no design input

`D5` puts `fetchStaticPageHtml` + the offscreen DOMParser XPath refinement in scope for first cutover.
`rewrite-architecture.md` is the only report that mentions `src/offscreen/xpath-refinement.ts`;
`legacy-feature-flows.md` §8 describes the legacy inspection flow. Nobody compared them, and no report
covers legacy's `/is_js_rendered` decision path in enough detail to re-implement it.

### 6.4 `catalog §0.4` self-declares corrections to its inputs

The catalog contains a "Corrections to the input reports" section. Those corrections are *inside* the
catalog and were never folded back into the study reports, so a plan author reading the studies directly
will read superseded claims. Same for the two "material findings neither study report contains" in the
verdict table's preamble. **The studies and the syntheses now disagree in at least three places and
nothing marks which wins.**

---

## 7. What I would read next, in order

1. **A `C-*` parity matrix for the `[ALG]`/`[PROTO]` families.** Read `legacy-locked-contracts.md`
   §§1.1–1.9, 1.13–1.14 (`C-MARK`, `C-TGT`, `C-SHDW`, `C-SUB`, `C-PERF`, `C-SAVE`) and give each a
   PASS/PARTIAL/FAIL against `src/domain/{boundary,evaluate,widening,visibility,xpath,taxonomy,
   selector-seed}.ts` and `src/content/marking/{resolve,hit-testing,flatten,submit,engine,dom-view,
   paint-reachability,silent-highlight}.ts` — 126 lines of which no report has opened. Cross-read
   legacy `src/common/xpath-utilities.ts` and `src/content/{explicit-marking-handler,submission-rules,
   shared-inclusion,marking-machine}.ts`.
2. **A wire-conformance pass against `/home/rojan/Documents/Git/GitHub/UnfluffifyHub` (`develop`).**
   `Dtos/{SaveRequest,PageMarking,LoadRequest,RemoveRequest,SelectorSet,XpathEntry,PageTypeTaxonomy}.cs`,
   `Program.cs:97-190`, `Repositories/SiteRepository.cs`, `Tests/ConfigSyncContractTests.cs` versus
   `src/storage/config.ts`, `src/lynx/rest.ts` and `main.tsx:854-875`. Answer: does every field the
   rewrite sends deserialize; is any required field missing; is any sent field unknown (→ `Disallow`
   400); is `siteId: null` reachable; what is the deploy ordering against legacy production.
3. **A test-corpus map.** All 203 legacy `tests/*.test.ts` names/subjects vs the rewrite's 64;
   per-`C-*`-family, which legacy test is the executable spec and does a counterpart exist.
4. **A signal-topology trace.** `main.tsx:414-441` + its 12 call sites, `content-loader.content.ts:250-281`,
   `background/index.ts:110-175`, `brain/{fold,decide,signals}.ts` — enumerate every signal name and
   every path that can birth it, and confirm/deny duplicate births per name.
