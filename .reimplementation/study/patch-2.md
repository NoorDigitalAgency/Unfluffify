# Patch 2 — Extension↔Backend wire-contract conformance against UnfluffifyHub (`develop`)

**Scope of this supplement.** The comparative study never string-matched `UnfluffifyHub`,
`SaveRequest` or `CurrentVersion`. This report closes that gap: it reads the backend at
`/home/rojan/Documents/Git/GitHub/UnfluffifyHub` (branch `develop`, HEAD `4a4878e`
*"Merge pull request #49 from NoorDigitalAgency/rewrite/rows-contract-and-migration"*)
against both extension clients, and answers the five questions the critic raised.

**Evidence standard.** Every claim below is either a `file:line` citation or the output of a
**live deserialization probe** I built and ran against the *actual compiled backend assembly*
(a console project referencing `UnfluffifyHub.csproj`, aliased as `UnfluffifyHub.Tests` to
satisfy `InternalsVisibleTo`, at
`/tmp/claude-1000/.../scratchpad/wireprobe/Program.cs`), plus a **zod probe** that emits the
exact bytes the rewrite puts on the wire
(`/tmp/claude-1000/.../scratchpad/emit-payload.ts`,
`/tmp/claude-1000/.../scratchpad/probe-load.ts`). Probe transcripts are quoted verbatim.

**Headline.** The backend has already merged the rewrite contract. This is therefore a
**flag-day cutover, not a rollout** — legacy v1.10.0 cannot save against `develop` at all, and
the DB migration is one-way. On top of that the probes surface **four live mismatches** the
merge did not resolve, the worst of which is that `develop` still full-replaces the page set
while the rewrite saves exactly one page per save.

---

## 0. Executive summary of findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| **F1** | Every field the rewrite sends deserializes and validates cleanly. No unknown field is sent. | ✅ conformant | probe A |
| **F2** | `siteId: null` is representable end-to-end in the rewrite and produces a hard `400` (`JsonException` at `$.siteId`) — `int SiteId` is non-nullable. | 🔴 latent break | `config.ts:23`, `main.tsx:860`, `background/index.ts:301-302`, probe B |
| **F3** | `develop` still **full-replaces** the page-marking set. The keyed-per-page merge D2 requires **does not exist**; the drop behaviour is pinned by a test asserting it. Combined with D3's per-page save, **every rewrite save deletes every other page of the property**. | 🔴🔴 data loss, certain | `SiteRepository.cs:153-170`, `:46-60`, `ConfigSyncContractTests.cs:124-135`, `main.tsx:866-873`, probe C |
| **F4** | Legacy v1.10.0 `/save` → `400` the instant `develop` deploys; legacy `/load` → `200` but **silently renders every page as unmarked**. The DB migration drops the legacy columns and is not reversible. | 🔴🔴 flag day | probe F/G, `DatabaseInitializer.cs:262-291`, `config.ts:941-947` (legacy) |
| **F5** | The rewrite reads **neither** page-type source (`GET /page-types` nor GraphQL `propertyPageTypes`) and never sends `pageType`. D4's Todo list / candidate badges / Send-to-Lynx have **no data path at all**; `buildPropertyPageTypesRequest` is dead code and the `.page-types__*` CSS is orphaned. | 🟠 whole feature absent | `graphql.ts:98-100` (no callers), `main.tsx:854-875`, `theme-components.css:1296-1470` |
| **F6** | `C-SAVE-1` ("pageType is mandatory / `[JsonRequired]`") is **invalidated**: `PageMarking.PageType` is now optional-and-validated-only-if-present. | 🟡 contract stale | `PageMarking.cs:10-11,37-43`, `ConfigSyncContractTests.cs:218-226` |
| **F7** | The rewrite stamps `selectorsUpdatedAt = now` and `submittedSelectorsFingerprint = ""` on **every** save, so the backend's newer-wins selector guard always resolves in favour of the incoming set — including when that set is empty. | 🔴 data loss | `main.tsx:864-865`, `:1626`, `SiteRepository.cs:413-429` |
| **F8** | `/load` and `/save` responses are parsed with `.parse()` (throwing). Four backend-legal response shapes make the **whole property unusable** with an opaque `HANDLER_FAILED`, with no per-row quarantine. | 🟠 fragility | `rest.ts:46,68`, probe J/M/N/O |
| **F9** | The rewrite discards the backend's `{error: "..."}` reason on a non-200; the operator sees `Save failed · error`. The backend goes to real trouble to produce a precise reason. | 🟠 UX | `services.ts:76-83`, `rest.ts:62-63`, `main.tsx:1673`, `Program.cs:255-309` |
| **F10** | `removePageMarking` (the `/remove` client) is **dead code** in the rewrite — nothing calls it. There is no deliberate-deletion door, only the accidental one (F3). | 🟠 gap | `rest.ts:71-84` (no callers) |
| **F11** | Neither client calls `GET /version`; there is no contract handshake, so a mismatch can only be discovered as a `400` mid-save. | 🟡 gap | no matches for `/version` in either `src/` |

---

## 1. The backend contract as it now stands on `develop`

### 1.1 What merged

`git log --oneline -6` on `develop`:

```
4a4878e Merge pull request #49 from NoorDigitalAgency/rewrite/rows-contract-and-migration
94c4562 fix: guard XpathsJson column existence in legacy migration + fix comment wording
3563639 fix: guard against null Rows and null row entries in PageMarking.Validate()
10ea913 fix: enforce renderedHtml and row xpaths validation in PageMarking.Validate()
de0b3f8 fix: normalize PageType (trim + null-if-empty) in ToEntity persisting
ba48466 feat(config-sync): adopt rewrite unified-rows contract + data migration
```

The backend has adopted the rewrite's schema **by name**, citing the extension's own files:

> `SaveRequest.cs:18-22` — *"Rewrite ConfigSnapshot schema version. The rewritten frontend
> stamps version 1 for the new unified-rows contract (see `src/entrypoints/popup/main.tsx` and
> `src/storage/config.ts` in the extension repo). **No backwards compatibility with the legacy
> version-5 xpaths/submissionXpaths payload.**"*

```csharp
// UnfluffifyHub/Dtos/SaveRequest.cs:22
public const int CurrentVersion = 1;
```

### 1.2 The strictness posture

Three independent strictness mechanisms are active simultaneously:

1. **Per-record `[JsonUnmappedMemberHandling(Disallow)]`** on `SaveRequest.cs:5`,
   `PageMarking.cs:5`, `LoadRequest.cs:5`, `RemoveRequest.cs:5`, `SelectorSet.cs:5`,
   `XpathEntry.cs:5`.
2. **A global `UnmappedMemberHandling = Disallow`** on the serializer options
   (`ConfigSyncJson.cs:12`), wired into ASP.NET's HTTP JSON options at `Program.cs:37`. This
   makes *every* type strict, including `PageTypeDefinition`, which carries no attribute of
   its own.
3. **`PropertyNameCaseInsensitive = false`** (`ConfigSyncJson.cs:11`). Probe I confirms the
   consequence:
   ```
   ### I. PascalCase 'Version' key (case-insensitive off)
     DESERIALIZE -> THROW JsonException: The JSON property 'Version' could not be mapped
                    to any .NET member contained in type 'UnfluffifyHub.Dtos.SaveRequest'.
   ```

And `Program.cs:38` sets `options.ThrowOnBadRequest = true`, so a body that fails model binding
throws rather than silently binding null. The middleware at `Program.cs:72-86` converts
`BadHttpRequestException` / `JsonException` into a `400` with `{ "error": <reason> }`, where
the reason is composed from the JSON path, line and byte position (`Program.cs:285-309`).

**Consequence: the wire contract is closed-world in both directions.** Any field the extension
adds without a matching backend change is an instant `400` — including a field added purely as
a debugging aid.

### 1.3 Server-side validation, precisely

`SaveRequest.Validate()` (`SaveRequest.cs:24-43`) rejects:
- `Version != 1` → `"Only version 1 is supported."`
- `PageMarkings is null` (**note: an empty map passes** — `SaveRequest.cs:29-30`)
- `Selectors is null`
- any per-page error from `PageMarking.Validate()`

`PageMarking.Validate()` (`PageMarking.cs:20-46`) rejects:
- blank `renderedHtml` (`:22-23`)
- null `rows` (`:25-26`) and null row entries (`:28-31`)
- blank `rows[].xpath` (`:33-34`)
- a **present but unknown** `pageType` slug (`:38-43`)

`RemoveRequest.Validate()` (`RemoveRequest.cs:11-20`) requires `siteId > 0` and non-blank `url`.

**Nothing validates `renderMode`.** It is a bare `string RenderMode` (`SaveRequest.cs:10`) with
no enum check anywhere. This matters for F8 below.

---

## 2. Q1 — Does everything the rewrite sends deserialize? Is any sent field unknown?

### 2.1 The exact bytes the rewrite puts on the wire

`saveConfigSnapshot` re-parses the snapshot through `ConfigSnapshotSchema` before sending
(`rest.ts:53`), and zod v4 `z.object()` **strips** unknown keys. I ran the real schema:

```
$ npx tsx emit-payload.ts
{"version":1,"baseUrl":"https://example.com","siteId":123,"renderMode":"rendered",
 "renderModeUpdatedAt":"2026-08-14T10:00:00.000Z",
 "selectors":{"exclusionSelectors":["header"],"inclusionSelectors":["main"]},
 "selectorsUpdatedAt":"2026-08-14T10:00:00.000Z","submittedSelectorsFingerprint":"",
 "pageMarkings":{"https://example.com/page-a":{"timestamp":"2026-08-14T10:00:00.000Z",
  "renderedHtml":"<html></html>",
  "rows":[{"xpath":"/html[1]/body[1]/div[1]","excluded":true,"explicit":true},
          {"xpath":"/html[1]/body[1]/div[2]","excluded":false}]}}}
```

Two mechanical facts worth recording, because they are what keeps this conformant:

- **The `.parse()` at `rest.ts:53` is load-bearing as an allow-list.** It is the only thing
  standing between a future stray field on `ConfigSnapshot` and a `400`. It works today only
  because zod strips. If anyone ever changes `ConfigSnapshotSchema` to `z.looseObject`
  (passthrough), every save breaks.
- **`rawHtml: undefined` disappears entirely** (key absent, not `null`) — confirmed above:
  `configFromSubmission` writes `rawHtml: page.rawHtml` unconditionally (`main.tsx:870`) and
  the key simply is not in the emitted JSON for a rendered-mode page. `PageMarking.RawHtml` is
  `string?` so absence is fine.

### 2.2 The backend's answer

Probe A, run against the compiled `UnfluffifyHub` assembly:

```
### A. rewrite /save body (siteId=123)
  DESERIALIZE -> OK
  VALIDATE     -> OK (null)
  RESERIALIZED -> {"version":1,...,"rows":[{"xpath":"/html[1]/body[1]/div[1]","excluded":true,
                   "explicit":true},{"xpath":"/html[1]/body[1]/div[2]","excluded":false}]}
```

Field-by-field:

| Wire field | Rewrite source | Backend member | Verdict |
|---|---|---|---|
| `version` | `main.tsx:858` (literal `1`) | `int Version` + `CurrentVersion == 1` | ✅ |
| `baseUrl` | `main.tsx:859` | `string BaseUrl` | ✅ |
| `siteId` | `main.tsx:860` (`number \| null`) | `int SiteId` **non-nullable** | ⚠️ see §3 |
| `renderMode` | `main.tsx:861` (`"rendered"\|"static"`) | `string RenderMode`, unvalidated | ✅ out, ⚠️ in (§7) |
| `renderModeUpdatedAt` | `main.tsx:862` ISO string | `DateTime?` | ✅ |
| `selectors` | `main.tsx:863` | `SelectorSet?` (required by `Validate`) | ✅ |
| `selectorsUpdatedAt` | `main.tsx:864` | `DateTime?` | ✅ |
| `submittedSelectorsFingerprint` | `main.tsx:865` (always `""`) | `string?` | ✅ shape, ⚠️ semantics (§8) |
| `pageMarkings[url].timestamp` | `main.tsx:868` | `DateTime` | ✅ |
| `pageMarkings[url].title` | **never sent** | `string?`, omit-when-null | ✅ but see §6.4 |
| `pageMarkings[url].pageType` | **never sent** | `string?`, optional | ✅ but see §6 |
| `pageMarkings[url].renderedHtml` | `main.tsx:869` | `string`, must be non-blank | ✅ (⚠️ `z.string()` permits `""` → `400`) |
| `pageMarkings[url].rawHtml` | `main.tsx:870` | `string?` | ✅ |
| `pageMarkings[url].rows[]` | `main.tsx:871` | `List<XpathEntry>` `{xpath,excluded,explicit?}` | ✅ exact match |

`/load` (`rest.ts:24-26,35`) sends `{siteId}`, matching `LoadRequest.cs:6-8`; `/remove`
(`rest.ts:71-79`) sends `{siteId, url}`, matching `RemoveRequest.cs:6-9`. Probes D and E both
report `DESERIALIZE -> OK`.

**Answer to Q1: yes, everything deserializes, and no unknown field is sent** — for the request
direction, with the single exception of `siteId: null`, which is next.

---

## 3. Q2 — Is `siteId: null` reachable on the save path?

### 3.1 The type permits it, all the way down

```ts
// src/storage/config.ts:23
siteId: SiteIdSchema.nullable(),
```

`ConfigSnapshotSchema` is *also* the `config.save` request schema on the message bus
(`realms.ts:166`), so the bus revalidates it and passes `null` through. And `configFromSubmission`
assigns from a nullable module-level variable:

```ts
// src/entrypoints/popup/main.tsx:860
    siteId: activeSiteId,          // let activeSiteId: number | null = null;   (main.tsx:66)
```

The background handler **acknowledges the null case, but only after the network call**:

```ts
// src/background/index.ts:300-305
bus.onCommand("config.save", async (snapshot) => {
  const result = await services.lynx.saveConfigSnapshot(snapshot);   // ← sent regardless
  if (result.status === "ok" && snapshot.siteId !== null) {
    await services.property.applyBackendSave(snapshot.siteId);
  }
```

There is no guard anywhere on the path that refuses a null `siteId` before the fetch.

### 3.2 What the backend does with it

```
### B. rewrite /save body with siteId:null
  DESERIALIZE -> THROW JsonException: The JSON value could not be converted to
                 UnfluffifyHub.Dtos.SaveRequest. Path: $.siteId | LineNumber: 0 |
                 BytePositionInLine: 58.
```

Because `ThrowOnBadRequest = true` (`Program.cs:38`), this surfaces as a `400` from the
middleware (`Program.cs:78-85`) — **`SaveRequest.Validate()` never runs**, so the operator gets
a JSON-binding message, not a domain message. The rewrite then reports `status: "error"` and
logs `Save failed · error` (`rest.ts:62-63`, `main.tsx:1673`) with no reason at all.

### 3.3 How reachable is it in practice?

Narrower than the type suggests, but not closed:

- `activeSiteId` is only ever assigned at `main.tsx:824` (`activeSiteId = lock.siteId`, inside
  `refreshLockDirective`) and cleared at `main.tsx:354` (inside `bindToTab`).
- `saveSession` calls `refreshLockDirective` first (`main.tsx:1604`) and bails unless
  `lockAllowsEditing(lock)` (`:1605-1608`), which requires `lock.lockRole === "editor"`
  (`main.tsx:709`).
- `lockRole` can only be `"editor"` when a `PropertyLockState` exists, and the only
  `directiveFromState` call carrying a non-null `state` is `lock-runtime.ts:242`, on a path
  guarded by `resolvedSite.siteId === null` returning `not_candidate` at `:212-215`.

So on the happy path `lock.siteId` is a number. **The residual exposure** is the ~7 `await`
points between `refreshLockDirective` (`:1604`) and the `config.save` request (`:1650`) —
`captureSubmission`, emulation application, `pauseContentMainInteractions`, three
`pullSignals`/`emitPopupSignalAndPullTail` round trips — during which the 500 ms poll can run
`bindToTab` and null `activeSiteId` (`:354`). The reconciling-state guards at `:1640-1648`
happen to catch most of that, because `bindToTab` also calls
`resetPopupState({name:"silent"})` (`:365`).

**Answer to Q2: yes at the type and bus level, and the code at `background/index.ts:302`
explicitly anticipates it; runtime reachability is narrow but is defended only by an incidental
state-machine coincidence, not by an intentional guard. The only backstop is a backend `400`
whose reason the client throws away.** The clean fix is to make the save path take a
`ConfigSnapshot & {siteId: number}` (or refuse before the fetch at `background/index.ts:301`)
rather than relying on the lock's shape.

---

## 4. Q3 — What breaks for legacy v1.10.0 the moment `develop` deploys, and the required deploy ordering

### 4.1 What legacy actually sends

`src/common/config.ts:20` — `const SERVER_SYNC_VERSION = 5;`

`createConfigSyncPayload` (`config.ts:1216-1268`) emits, per page:

```js
payloadMarkings[url] = {
  timestamp, title, pageType, renderedHtml, rawHtml,
  xpaths: buildConfigSyncXpathItems(safeEntry),      // config.ts:1247
  submissionXpaths: [...]                            // config.ts:1248-1256
};
```

and at top level `version: SERVER_SYNC_VERSION` (`config.ts:1258`).

### 4.2 What `develop` does with that

```
### F. LEGACY v1.10.0 /save body (version 5)
  DESERIALIZE -> THROW JsonException: The JSON property 'xpaths' could not be mapped
                 to any .NET member contained in type 'UnfluffifyHub.Dtos.PageMarking'.
```

**A hard `400` on every legacy save.** Note *which* error: the `Disallow` handling fires during
**deserialization**, before `SaveRequest.Validate()` ever runs, so legacy never receives the
tidy `"Only version 1 is supported."` message the backend was written to produce. Probe G
confirms this ordering by sending the legacy body shape with `version` forced to `1` — same
`xpaths` mapping exception. The version gate is unreachable for a legacy payload.

This is intentional and pinned: `ConfigSyncContractTests.Deserialization_RejectsRemovedLegacyFields`
(`ConfigSyncContractTests.cs:375-504`) asserts `JsonException` for five different legacy-shaped
bodies, including `latestComputedSelectors`, a nested `url`, `rawHTML` casing, and
`consentXpaths`/`includeXpaths`/`selectorSuppressedXpaths`.

### 4.3 The quieter half: legacy `/load` succeeds and lies

`/load` is unaffected — `LoadRequest` is `{siteId}` on both sides — so legacy gets a `200`. But
the response carries `rows`, not `xpaths`. Legacy's normalizer:

```ts
// legacy src/common/config.ts:941-947
if (!Array.isArray(entry.xpaths) && entry.xpaths !== undefined) { changed = true; }
const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
```

`entry.xpaths` is `undefined`, so `changed` is *not* set and `rawXpaths` is `[]`. `rows` is
ignored entirely (there is no key for it anywhere in legacy). **Every page comes back looking
unmarked, with no error, no warning, and no "changed" signal.**

That is the worst possible failure mode for a mixed fleet: a legacy editor opens a fully-marked
page, sees zero markings, re-marks it from scratch, and only then discovers Save is broken.

### 4.4 The migration is one-way

`DatabaseInitializer.InitializeAsync()` runs on **every startup** (`Program.cs:90`). The rows
migration (`DatabaseInitializer.cs:262-291`):

1. adds `RowsJson` if missing (`:268-271`),
2. backfills `RowsJson = XpathsJson` where null (`:273-280`),
3. **`ALTER TABLE dbo.PageMarkings DROP COLUMN SubmissionXpathsJson`** (`:282-285`),
4. **`ALTER TABLE dbo.PageMarkings DROP COLUMN XpathsJson`** (`:287-290`).

Once the process boots, the previous backend build can no longer read markings — it reads
`XpathsJson`, which no longer exists. There is **no down migration**. Rolling back the Hub
requires a database restore.

Two related notes:
- `submissionXpaths` are gone permanently by design (`PageMarking.cs:15-17`: *"submission rows
  are derived client-side now and no longer transmitted or stored"*). If any downstream consumer
  reads them, that consumer breaks silently.
- **Good news, worth recording so nobody assumes otherwise:** the backfilled `RowsJson` is safe
  to deserialize. `XpathEntry` has *always* been a strict subset — `git log --follow` shows it
  was `{xpath, excluded}` from `d412e87` through `07f24d7`, gaining `explicit` only later — and
  the earlier SQL migration emits exactly `xpath, excluded, explicit` via `FOR JSON PATH`
  (`DatabaseInitializer.cs:156,204`). So `Deserialize<List<XpathEntry>>` with `Disallow`
  (`SiteRepository.cs:480,496-499`) will not throw on migrated data. That specific 500 risk is
  **not** present.

### 4.5 Required deploy ordering

There is no version negotiation available. `SaveRequest.CurrentVersion` is a compile-time
constant accepting exactly `1` (`SaveRequest.cs:22,26-27`), `Disallow` forbids the legacy field
names outright, and neither client calls `GET /version` (`Program.cs:97-106`) to detect the
mismatch in advance. So:

> **This is a flag day.** `develop` and legacy v1.10.0 cannot coexist for writes. Ordering must
> be: (a) freeze legacy saves / take the editor team offline, (b) back up
> `dbo.PageMarkings`, (c) deploy the Hub (the migration runs at boot), (d) push the rewrite to
> **all** editors before any of them resume. Any editor still on v1.10.0 after step (c) is in
> the silent-data-loss state of §4.3.

If a phased rollout is required instead, the backend needs a compatibility shim — most cheaply,
a second `LegacySaveRequest` record bound behind a `version` sniff, mapping
`xpaths`+`submissionXpaths` → `rows`. That is a product decision (§9, Q-B), not a code fact.

---

## 5. Q4 — The page-type data path (D4: Todo list / candidate badges / Send to Lynx)

### 5.1 There are **two** distinct page-type systems, and they are not the same thing

The study's terminology collapses them; the code does not.

| System | Purpose | Source | Legacy status | Rewrite status |
|---|---|---|---|---|
| **Taxonomy** — the *vocabulary* of page types | slug → label (+ subtypes) used to label an assignment | Hub `GET /page-types` (`Program.cs:108-114`, `PageTypeTaxonomy.cs`) | **live** — fetched (`remote-network.ts:286-312`) and cached in `chrome.storage.local` under `pageTypeTaxonomy`, with a hardcoded offline fallback `DEFAULT_PAGE_TYPE_TAXONOMY` (`common/page-type-taxonomy.ts:19-91`) that is a byte-for-byte mirror of the C# dictionary | **absent** — no call, no cache, no fallback |
| **Candidacy feed** — *which pages* of this property need marking, grouped by type | drives the Todo list and candidate badges | Lynx **GraphQL** `propertyPageTypes(domainId){ pageTypes { pageType pages { url wordsCount } } }` | **live** — feeds `lynx-checklist.ts` | **query defined, never called** (`graphql.ts:14-26, 98-100`; zero call sites) |

The Hub's own doc comment says the taxonomy is not the candidacy feed:
`PageTypeTaxonomy.cs:3-9` — *"Canonical page-type taxonomy served by the `/page-types` endpoint
and used to validate `PageMarking.PageType`."*

### 5.2 The rewrite has neither

- `configFromSubmission` (`main.tsx:857-874`) builds the page marking with **four keys**:
  `timestamp`, `renderedHtml`, `rawHtml`, `rows`. No `pageType`, no `title`.
- `buildPropertyPageTypesRequest` (`graphql.ts:98-100`) is exported and **never imported**. The
  services layer imports `buildCssInfoRequest`, `buildUpdateScrapingConditionsRequest`,
  `buildUrlSearchInfoRequest` (`services.ts:26`) — not this one.
- `grep -rni "todo\|checklist\|send to lynx"` over `src/popup/` and `src/entrypoints/` returns
  **nothing** relevant — every `candidate` hit is an unrelated local variable name.
- The **CSS is already ported and orphaned**: `.page-types__group`, `.page-types__candidate`,
  `.page-types__candidate-badge--marked / --current / --duplicate`, `.page-types__empty`,
  `.lynx-checklist-popover__page-types` all exist at `theme-components.css:996, 1296-1470` with
  no consumer in any `.tsx`.
- `src/types/config.ts` is **dead legacy typing** (zero importers; `grep -rn "types/config"`
  returns nothing) still describing `xpaths`/`includeXpaths`/`selectorSuppressedXpaths`/
  `submissionXpaths` (`types/config.ts:11-29`). It will mislead anyone who greps for the schema.

### 5.3 The pageType write path, for when D4 is built

The only **live** carrier of a page-type assignment is the `/save` payload's
`pageMarkings[url].pageType` — persisted at `SiteRepository.cs:468`
(`PageType = string.IsNullOrWhiteSpace(dto.PageType) ? null : dto.PageType.Trim()`), echoed at
`:477`, and confirmed by my probe to round-trip through the extension schema:

```
PASS  P. pageType present in the echo (backend keeps it; extension schema allows)
      pageType round-trips as: "article"
```

`PageMarkingSnapshotSchema.pageType` already exists (`config.ts:14`) — the field is wired, only
unpopulated.

**Legacy's second write path is dead on arrival.** `submitPageTypeAssignments`
(`legacy remote-network.ts:411-421`) POSTs an array to `POST /assign_page_types` on the *config*
endpoint. `git grep` across **all** Hub history returns zero hits for `assign_page_types` — the
endpoint has never existed. Legacy knows this and gates it off:

> `legacy src/popup.ts:8745-8748` — *"The backend endpoint is not live yet — submitting raised a
> 404 on every Send to Lynx. Behind the flag until the backend ships."*

**Answer to Q4: the data path D4 needs does not exist in the rewrite, and it is two paths, not
one.** Building it requires: (a) `GET /page-types` → cached taxonomy + offline fallback,
(b) GraphQL `propertyPageTypes` → candidacy grouping (this is also D6's fix for the
un-bootstrappable deleted-config property), (c) a per-page assignment UI, (d) populating
`pageMarkings[url].pageType` in `configFromSubmission`, and (e) the `cssInfo`-gated Send flow
(`C-SAVE-7`; `lynx-checklist.ts:450-484` has the sanitiser and set-equality already written).

### 5.4 `C-SAVE-1` is invalidated as written

The locked contract states (`legacy-locked-contracts.md:605-609`):

> *"C-SAVE-1 — pageType is mandatory. Every saved page marking must carry a valid
> candidate-resolved `pageType` (backend `PageMarking.PageType` is `[JsonRequired]`; validation
> rejects blank/unknown)."*

On `develop` that is false in both clauses:

```csharp
// PageMarking.cs:10-11 — no [JsonRequired]; omitted when null
[property: JsonPropertyName("pageType")]
[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PageType,

// PageMarking.cs:37-43 — validated ONLY when present
if (!string.IsNullOrWhiteSpace(PageType)) { ... }
```

Pinned by `ConfigSyncContractTests.Validate_AcceptsMissingPageType` (`:218-226`, passes `"   "`)
and `Validate_AcceptsEveryTaxonomyPageType` (`:356-365`). Probe A also validates cleanly with
no `pageType` at all.

The **surviving** half of C-SAVE-1 is: *if* you send a `pageType`, it must be one of the ten
slugs, or the save is rejected with
`pageMarkings[url]: pageType must be one of: homepage, article, listing, category, product,
service_page, company, landing_page, utility, how_to.` (`PageMarking.cs:42`;
`Validate_RejectsUnsupportedPageType` at `:344-354`). Note `how_to` is newer than the legacy
constant list — `Taxonomy_IncludesHowToTopLevelType` (`:367-373`) exists precisely to pin it —
so any client shipping a hardcoded taxonomy will drift. `C-SAVE-2`'s "must stay in sync"
warning is real and is a live drift risk for the rewrite's *absent* fallback list.

---

## 6. Q5 — Does D2's keyed-per-page merge exist on `develop`? **No. Full-replace is still live.**

### 6.1 The code

```csharp
// SiteRepository.cs:153-170
internal static Dictionary<string, PageMarkingEntity> MergePageMarkings(
    IEnumerable<PageMarkingEntity> existing,
    Dictionary<string, PageMarking> incoming,
    int siteId)
{
    Dictionary<string, PageMarkingEntity> existingByUrl = existing.ToDictionary(e => e.PageUrl, StringComparer.Ordinal);
    Dictionary<string, PageMarkingEntity> merged = new(StringComparer.Ordinal);

    foreach ((string pageUrl, PageMarking dto) in incoming)          // ← iterates INCOMING ONLY
    {
        if (!existingByUrl.TryGetValue(pageUrl, out PageMarkingEntity? dbRow) || dto.Timestamp >= dbRow.Timestamp)
            merged[pageUrl] = ToEntity(pageUrl, dto, siteId);
        else
            merged[pageUrl] = dbRow;
    }

    return merged;                                                    // ← existing-only keys are GONE
}
```

`merged` is seeded **empty** and populated only from `incoming`. A page in the database that
the request does not name is never copied in. Then:

```csharp
// SiteRepository.cs:58-60
await DeletePageMarkingsBySiteIdAsync(conn, tx, site.Id);   // DELETE ... WHERE SiteId = @SiteId  (:187-190)
await InsertPageMarkingsAsync(conn, tx, merged.Values);
await tx.CommitAsync();
```

The "merge" resolves only **per-page timestamp conflicts for pages the request names**
(newer-wins). It is not a preservation merge. `D2`'s prescribed one-line fix — seeding
`merged` from `existingByUrl` — **has not been applied**; the file is byte-identical in shape to
what the study described.

### 6.2 It is pinned as intended behaviour

```csharp
// ConfigSyncContractTests.cs:123-135
[Fact]
public void MergePageMarkings_DropsMarkings_AbsentFromIncomingRequest()
{
    ...
    // New save with no page markings — simulates the user deleting the marking
    Dictionary<string, PageMarkingEntity> merged = SiteRepository.MergePageMarkings(
        existingInDb.Values, new Dictionary<string, PageMarking>(), 42);

    Assert.Empty(merged);
}
```

Any fix must **invert** this test, not just add one.

### 6.3 Why this is now *certain* loss, not an edge case

`SaveRequest.Validate()` accepts an empty `pageMarkings` map (`SaveRequest.cs:29-30` only checks
non-null). Probe C:

```
### C. rewrite /save with pageMarkings:{}
  DESERIALIZE -> OK
  VALIDATE     -> OK (null)
```

So `pageMarkings: {}` is a legal request that deletes every page marking for the site and
returns `200`. **That is the exact mechanism of the production wipe** recorded in the live-QA
findings and diagnosed in the dropped guard commit:

> `git show e11059b1` — *"Observed live on production: a 200 /save wiped a property's markings
> (1 page, 268 xpaths -> 0) irrecoverably; the selectors and renderMode survived, which is what
> made it look like a successful save."*

For legacy this required a filter bug to trigger. **For the rewrite it is the normal path.**
`configFromSubmission` builds a `pageMarkings` map with exactly **one** key —
`{ [page.url]: {...} }` from `snapshot.pages[0]` (`main.tsx:856, 866-873`). Under
`MergePageMarkings`, every save therefore:

1. keeps the page just saved,
2. **deletes every other page of the property.**

A property with five marked pages collapses to one on the first rewrite save. And because the
rewrite's candidacy rule is "has a stored `pageMarkings` record"
(`background/index.ts:246, 265`: `candidatePage: entry.pageMarkings.includes(request.pageUrl)`),
the four deleted pages simultaneously stop being candidates — the extension goes inert on them,
which hides the loss.

### 6.4 There is no client-side guard, and no deliberate-deletion door either

- The legacy guard `isDestructiveEmptyPageSync` / `describeConfigSyncPageShrink`
  (dangling commit `e11059b1`, `src/popup/config-sync-guard.ts`) was **never ported**:
  `grep -rn "config-sync-guard\|isDestructiveEmptyPageSync" src/ tests/` returns nothing.
- `/remove` — the *intended* deletion path (`Program.cs:171-211`, `SiteRepository.RemoveAsync`
  at `:289-346`, which correctly preserves all other pages via `RemovePageMarking` at
  `:172-181`) — is implemented client-side at `rest.ts:71-84` and **has zero callers**. Dead code.

So the rewrite has the destructive door wide open and the safe door bricked up.

**Answer to Q5: full-replace is still live on `develop`, pinned by a test, and it is now on a
collision course with D3's per-page save. This is the single highest-severity item in this
report.** Both fixes are required and neither is optional: seed `merged` from `existingByUrl`
server-side, **and** reinstate the client guard (defence in depth, as D2 already directed).

---

## 7. The response direction: four backend-legal shapes that brick a property

`loadConfigSnapshot` and `saveConfigSnapshot` use throwing `.parse()`:

```ts
// src/lynx/rest.ts:46
return { status: "ok", data: LoadResponseSchema.parse(response.body) };
// src/lynx/rest.ts:68
return { status: "ok", data: SaveResponseSchema.parse(response.body) };
```

`LoadResponseSchema === SaveResponseSchema === ConfigSnapshotSchema` (`rest.ts:6-7`), which is
**stricter than the backend's own contract in four places**. The bus catches the throw
(`bus.ts:186-191` → `HANDLER_FAILED`), so nothing crashes — but `config.load` fails with an
opaque code (`main.tsx:1222-1226`, logs `Config load failed · <code>`), *and* the `page.context`
command fails too (`background/index.ts:242`, no try/catch), which means the content script never
learns the page is a candidate. The property becomes silently inert.

I ran the extension's real `LoadResponseSchema` against backend-producible responses:

```
FAIL  J. renderMode:'' (backend emits this for an empty Sites.RenderMode)
      [{"path":"renderMode","message":"Invalid option: expected one of \"rendered\"|\"static\""}]
PASS  K. title==pageUrl echo, renderedHtml:''
FAIL  M. migrated non-positional xpath row (SQL backfill from legacy XpathsJson)
      [{"path":"pageMarkings.<url>.rows.0.xpath","message":"xpath must be a positional /tag[index] path"}]
FAIL  N. row xpath == /html[1]/body[1] (whole-body mark)
      [{"path":"pageMarkings.<url>.rows.0.xpath","message":"document roots are never mark rows"}]
FAIL  O. non-URL pageMarkings key
      [{"path":"pageMarkings./page-a","message":"Invalid key in record"}]
PASS  P. pageType present in the echo
```

Each case, with its backend provenance:

- **J — `renderMode: ""`.** Reproduced against the real `ReconstructSaveRequest`:
  ```
  ### J. /load response shape when RenderMode is empty in the DB
    {"version":1,...,"renderMode":"","renderModeUpdatedAt":"2026-08-14T10:00:00Z",...}
  ```
  `MergeStringState` returns `existingValue ?? string.Empty` (`SiteRepository.cs:440`) or
  `incomingValue ?? string.Empty` (`:442`), and **nothing validates `renderMode` server-side**.
  A body with `"renderMode": null, "renderModeUpdatedAt": "..."` writes `""` (nullable reference
  types are not enforced at runtime). The rewrite's `RenderModeSchema` is
  `z.enum(["rendered","static"])` (`property.ts:6`) and rejects it. **Asymmetry: the extension
  enforces an enum on read that the backend does not enforce on write.** Legacy is safe here —
  it normalises to `static`/`rendered` only (`legacy config.ts:26, 388-393`) — but any other
  writer, or a manual DB edit, poisons the property permanently.
- **M / N — xpath shape.** `PageMarking.Validate()` requires only a non-empty string
  (`PageMarking.cs:33-34`); probe H confirms `/html/body/main` deserializes and validates fine
  server-side. The extension additionally requires a positional `/tag[index]` path and forbids
  the two document roots (`marking.ts:8-9, 30-36`). Legacy generated positional paths
  (`legacy xpath-utilities.ts:314-326`, `legacy content/core.ts:2783-2798` — both
  `${tag}[${index}]`), so M is unlikely from migrated data; **N is the live one** — a legacy row
  marking `/html[1]/body[1]` is legal legacy data and is rejected outright by the rewrite.
- **O — non-URL page key.** `PageUrl` is `NVARCHAR(2048)` with no format constraint
  (`DatabaseInitializer.cs:112`); the extension requires `z.string().url()` keys
  (`config.ts:29`).

**The failure granularity is the whole property.** One bad row anywhere in the response
discards the entire snapshot. There is no per-row quarantine and no `safeParse` fallback. Note
also that `tests/src/lynx/rest.test.ts:42` is titled *"returns config status discriminants
instead of throwing"* but only covers `403`, `404` and a null body — a malformed `200` still
throws, so the test's own claim is not upheld.

**Two things the backend already got right and should stay that way** (worth pinning so a
future refactor does not undo them): `ReconstructSaveRequest` deliberately coerces
`renderModeUpdatedAt`/`selectorsUpdatedAt` to `LastUpdatedAt` and the fingerprint to `""`
(`SiteRepository.cs:232-246`, with a comment naming `ConfigSnapshotSchema`), because the rewrite
requires those non-null; and `RenderedHtml ?? string.Empty` (`:478`) keeps `z.string()` happy —
probe K confirms both.

---

## 8. Selector semantics: the rewrite defeats the backend's merge guard

The backend protects selectors with a newer-wins rule
(`MergeSelectorState` → `ShouldUseIncomingState`, `SiteRepository.cs:413-460`): an incoming
selector set is only adopted when `incomingUpdatedAt >= existingUpdatedAt`.

The rewrite makes that check unconditionally true:

```ts
// src/entrypoints/popup/main.tsx:855, 863-865
const now = new Date().toISOString();
...
    selectors,
    selectorsUpdatedAt: now,                    // ← always "now", changed or not
    submittedSelectorsFingerprint: "",          // ← always blanked
```

and sources the selectors defensively:

```ts
// src/entrypoints/popup/main.tsx:1626
const currentSelectors = store.getState().selectors ?? { inclusionSelectors: [], exclusionSelectors: [] };
```

Two consequences:

1. **If the AI-run selectors never reached the store, the save writes an empty set with a
   fresh timestamp — and the backend's guard hands it the win.** This is the rewrite's version
   of the known live finding *"AI-computed selectors intermittently never reach config.selectors
   so a save persists stale selectors"*, except worse: legacy persisted *stale* selectors, the
   rewrite persists *empty* ones and guarantees they overwrite good ones.
2. **`submittedSelectorsFingerprint` is destroyed on every save.** In legacy this field records
   the fingerprint of the selector set actually submitted to Lynx
   (`legacy popup.ts:8922-8926`: `getSelectorSetFingerprint(normalizedSelectorSet)` written
   alongside `selectors` and `selectorsUpdatedAt`), and it is the persistent half of the
   Send-to-Lynx staleness guard (`C-SAVE-7`). The rewrite hardcodes `""`, so even once
   Send-to-Lynx is built, the "have we already submitted this exact set?" question can only be
   answered from the live `cssInfo` call, never from stored state.

---

## 9. Legacy behaviour worth bringing over (UX and mechanism)

Ordered by how much of the D4/D6 scope they unblock.

1. **Taxonomy cache + offline fallback.** `GET /page-types` fetched into `chrome.storage.local`
   under `pageTypeTaxonomy` with `DEFAULT_PAGE_TYPE_TAXONOMY` as the offline/first-load fallback
   (`legacy remote-network.ts:286-312`, `legacy common/page-type-taxonomy.ts:11-19`). The label
   set is the operator-facing vocabulary; without a fallback the assignment UI is blank on a
   cold start or a network blip. **Caution:** the fallback must be kept in sync with
   `PageTypeTaxonomy.cs` — `how_to` is already newer than some legacy copies.
2. **The Lynx checklist view model** (`legacy common/lynx-checklist.ts:352-406`) — pure,
   testable, and directly reusable. It yields per-type `markedCount`, `missing`,
   `candidateCount`, `candidatePreview` (first 3), `coveredPageTypeCount`, `canSend`, and a
   structured `blockingReason` (`no_candidates` / `missing_page_types` + the offending keys).
   That last one is the difference between "Send is greyed out" and "Send is greyed out because
   *Product* and *Contact* have no marked page."
3. **Candidate URL canonicalisation** (`lynx-checklist.ts:68-87`): strip hash, lowercase host,
   drop default ports, strip trailing slash. Without it the same page arrives from the feed and
   from the tab under two keys and shows as both "marked" and "missing" at once. This also
   matters for `pageMarkings` keys, which the backend compares with `StringComparer.Ordinal`
   (`SiteRepository.cs:158-159`) — an un-canonicalised key silently creates a duplicate row.
4. **Candidate badges** — `marked` / `current` / `duplicate`, with duplicate detection across
   page types (`lynx-checklist.ts:15-17, 398-401`). The CSS is already in the rewrite
   (`theme-components.css:1425-1461`); only the model and markup are missing.
5. **Page titles.** Legacy sends `title` (`legacy config.ts:1243`); the rewrite never does
   (`main.tsx:867-872`). The backend already stores and normalises it, including the nice touch
   of dropping a title identical to the URL (`SiteRepository.cs:467, 483-489`, probe K). A Todo
   list of bare URLs is materially worse to read than one of titles — port this **before**
   building the list, not after.
6. **The Send-to-Lynx `cssInfo` fail-closed guard** (`C-SAVE-7`). The sanitiser and
   order-insensitive set comparison already exist as pure functions
   (`lynx-checklist.ts:450-484`) with the design rationale inline: split on commas, trim,
   collapse whitespace, no case folding; a match on **both** fields disables Send; an empty
   backend or `usesUnfluffify:false` never blocks. The rewrite already has
   `buildCssInfoRequest` wired into services (`services.ts:26, 318`) — only the guard is missing.
7. **The destructive-save guard** (`e11059b1`, `src/popup/config-sync-guard.ts`): refuse a save
   whose filtered page count is zero while the client or server still holds pages; allow a
   partial shrink but never a total wipe, and report both counts in the refusal. Under §6.3 this
   is now a *rewrite* requirement, not a legacy footnote.
8. **Surface the server's reason.** The backend composes a genuinely useful message including
   the JSON path (`Program.cs:285-309`), e.g.
   `The JSON property 'xpaths' could not be mapped ... Path: $.pageMarkings...`. The rewrite
   throws the body away (`services.ts:76-83` keeps it, but `rest.ts:62-63` discards everything
   but the status) and logs `Save failed · error` (`main.tsx:1673`) — not even the HTTP status.
   Threading `{error}` through `SaveConfigResult` is a few lines and turns an unreportable
   support ticket into a self-diagnosing one.

---

## 10. Weaknesses recap (rewrite side, contract-specific)

- `siteId` nullable through the entire save path with no pre-flight guard (§3).
- Single-page `pageMarkings` map against full-replace server semantics (§6.3) — **certain data
  loss on first save**.
- No destructive-save guard; `/remove` client dead (§6.4).
- `selectorsUpdatedAt = now` unconditionally + empty-selector fallback defeats the server's
  newer-wins guard (§8).
- `submittedSelectorsFingerprint` hardcoded `""`, destroying `C-SAVE-7`'s persistent half (§8).
- Throwing `.parse()` on responses, whole-snapshot granularity, four backend-legal shapes reject
  (§7); the rest test's "never throws" claim is not upheld.
- No `GET /version` handshake in either client — contract drift is discoverable only as a `400`
  mid-save.
- `renderedHtml: z.string()` permits `""`, which the backend rejects with a `400`
  (`PageMarking.cs:22-23`) — a validation asymmetry pointing the wrong way.
- Dead/misleading artefacts: `src/types/config.ts` (legacy schema, zero importers),
  `graphql.ts:98-100` (`buildPropertyPageTypesRequest`, zero callers),
  `theme-components.css:1296-1470` (`.page-types__*`, zero consumers),
  `rest.ts:71-84` (`removePageMarking`, zero callers).
- The whole D4 page-type/Todo/Send-to-Lynx surface is absent (§5).

---

## 11. Open questions for the product owner

These are genuine decisions; none is answerable from code.

1. **Cutover shape.** Is a flag day acceptable — freeze editors, back up `dbo.PageMarkings`,
   deploy the Hub, push the rewrite to everyone, resume — or must legacy v1.10.0 keep working
   during a phased rollout? If the latter, the backend needs a legacy-compatibility shim
   (§4.5), which is new backend work and re-opens the `submissionXpaths` question.
2. **Rollback appetite.** The rows migration drops `XpathsJson`/`SubmissionXpathsJson` at boot
   with no down migration (§4.4). Is "restore from backup" an acceptable rollback plan for this
   service, or should the drops be deferred to a later release so the previous build stays
   bootable?
3. **`/save` semantics.** D2 already directed keyed-per-page writes. Confirm the intended
   contract explicitly, because it changes what "delete a page" means: should a save be
   **purely additive per named page** (deletion only via `/remove`), or should there remain a
   way to express "this is the complete set" for a property?
4. **What should the rewrite do when a stored row fails its own schema** (a legacy
   `/html[1]/body[1]` row, a `renderMode` the enum does not know, a non-URL page key)? Options:
   (a) reject the whole property as today, (b) drop the offending rows and warn, (c) accept and
   quarantine them read-only. This is a correctness-vs-availability call, not a technical one.
5. **Should `pageType` become mandatory again?** `C-SAVE-1` assumed it was; `develop` made it
   optional. If the Todo list is to mean anything, an unassigned page has to be visible as
   incomplete — is that enforced at save time (reject), at the UI (block Save), or only
   reported in the checklist?
6. **Candidacy source of truth.** D6 says restore GraphQL `propertyPageTypes`. Confirm the
   Hub's `pageMarkings` keys are *not* to be used as candidacy (they are today —
   `background/index.ts:246, 265`), since that rule is what makes a deleted config record
   permanently un-bootstrappable *and* what makes §6.3's data loss self-concealing.
7. **`/assign_page_types`.** Legacy's assignment submit targets an endpoint that has never
   existed in the Hub (§5.3) and is feature-flagged off. Is that endpoint still planned, or is
   `pageMarkings[url].pageType` on `/save` the permanent home for assignments? The answer
   decides whether the rewrite needs one write path or two.
8. **Selector overwrite policy.** Should a save be allowed to write an **empty** selector set
   over a non-empty stored one (§8)? Legacy's live bug wrote stale selectors; the rewrite would
   write empty ones and win the timestamp race. A "never downgrade to empty" rule is cheap but
   is a product decision about whether clearing selectors is a legitimate operator action.
