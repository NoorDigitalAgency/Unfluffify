# Remote API Contract

**Status & sourcing model (architect decision, T11 amended).** This document has **two kinds of surfaces**, sourced differently:

- 🟢 **OWNED — DESIGN TARGET.** The **config server** (`/load`, `/save`, `/remove`, page-type/render-mode assists) and the **property-lock** hub are owned by the architect. Their schemas here are the **most-suitable target schema the rewrite defines**; the **backend will be adapted to match**. They are NOT pinned to the current client — where the current shape is legacy, the target is stated and the current shape is shown only as reference.
- 🟠 **LOCKED — CONFORM EXACTLY.** The **AI** (`/get_selectors`), **GraphQL** (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`, `updateScrapingConditions`), and **accounts** surfaces are owned by a separate team. Their schemas are **locked to the current code**: the rewrite conforms to exactly what the client sends/parses today. **No changes are requested from that team, and no verification blocks the rewrite** — these are authoritative as-is.

| Marker | Meaning |
| --- | --- |
| 🟢 **OWNED — DESIGN TARGET** | Config + property-lock. Define the ideal schema; adapt the backend to it. |
| 🟠 **LOCKED — CONFORM EXACTLY** | AI + GraphQL + accounts. Pinned from current code; the rewrite matches it verbatim; no team dependency. |

**Scope note.** Property identity = the backend `siteId` from GraphQL `urlSearchInfo(rawURL)` — **locked to current** (returns `domainId`). Base URL is a **backend attribute the frontend never computes** (register T1); because GraphQL is locked and exposes no base-URL field, the base URL is **sourced from the OWNED config server** as a `baseUrl` attribute on the `/load` response (A.1/A.5) — this is where the register's "base URL is a backend attribute" requirement is satisfied, and it needs no GraphQL change. Legacy behaviors the register corrected away (frontend base-URL normalization via `normalizeBaseUrlFromDomainName`, config-merge, client-minted lock ids) are shown as reference only and are **not** part of the target.

---

## Cross-cutting concerns

### Endpoint resolution (both owners)

Credentials and endpoints are resolved by `resolveBackgroundNetworkCredentials()` (`src/background/network-core.ts`) from the global AI settings store (`getGlobalAiSettings`, `src/common/settings-store.ts`). Four stored fields drive everything:

| Setting field | Storage key | Used for |
| --- | --- | --- |
| `tokenValue` | `globalToken` | Bearer auth on every request |
| `endpointValue` | `globalEndpoint` | AI base (`endpointPreference: "ai"`) |
| `configEndpointValue` | `globalConfigEndpoint` | Config base (`endpointPreference: "config"`) |
| `stageBaseValue` | `globalStageBase` | Stage hostname → GraphQL / accounts endpoints |

- `endpointPreference` selects `endpointValue` (AI) vs `configEndpointValue` (config) as the fallback base.
- Paths are joined with `resolveBackgroundEndpoint(base, path)` = `new URL(path, base).toString()`.
- GraphQL and accounts endpoints are **derived from `stageBaseValue`**, not from a stored URL:
  - `buildGraphqlEndpointFromStageBase(stage)` → `https://api.${stage}/graphql` (`src/common/lynx-live-pages.ts`).
  - `buildValidateEndpointFromStageBase(stage)` → `https://accounts.${stage}/api/account/validate` (`network-core.ts`).
  - `buildLoginEndpointFromStageBase(stage)` → `https://accounts.${stage}/api/account/login`.
  - `normalizeStageBase()` collapses a URL/host to a bare validated hostname.
- Property-lock WSS base = `configEndpointValue || stageBaseValue` (`getPropertyLockConnectionSettings`).

### Auth headers

`createBackgroundJsonHeaders(token)` (`network-core.ts`) produces:

```
Content-Type: application/json
Authorization: Bearer <token>        // omitted when token is empty (e.g. login)
```

### Token rotation via `x-update-token` (both owners)

Every response passes through `maybeUpdateStoredTokenFromResponse(response, currentToken)` (`src/common/lynx-live-pages.ts`):

- Reads response header **`x-update-token`**.
- If present, non-empty, and different from the current token, it persists it via `setGlobalToken()` (`settings-store.ts`) and returns the new token.
- This is a **silent rolling-token refresh**: the server may hand back a fresh JWT on any call, and the client adopts it for subsequent requests. The rewrite must preserve this on **all** authed surfaces (config, AI, GraphQL, accounts).

> The property-lock WebSocket does **not** carry `x-update-token` (no response headers on a WS frame); it authenticates once via a `?token=` query param at connect time (see surface B).

---

# (A) CONFIG backend — 🟢 OWNED — DESIGN TARGET (define ideal; backend adapts)

Base = `configEndpointValue` (fallback `endpointValue`). All bodies are JSON; all authed with the Bearer header; all run responses through the token-rotation hook. **The shapes below are the TARGET the rewrite defines; the backend is adapted to match.** Current client function names (`src/background/remote-network.ts`) are cited only as the reference the target evolves from.

### A.1 `POST /load` — fetch the property config snapshot

`loadRemoteConfigSnapshot()`.

**Request body:**

```json
{ "siteId": 12345 }
```

- `siteId` is the normalized backend site id (`normalizeSiteIdValue` → positive integer). This is the property identity per the register (T1) — **no base URL is sent** in the request.
- **TARGET:** the `/load` **response carries a `baseUrl` attribute** (the property's canonical base URL — see A.5). This is the register's source for "base URL is a backend attribute the frontend never computes" (INV-1.2); it lives on this OWNED surface, so no GraphQL change is needed.

**Response:** a full config-sync payload (see A.5). Stored verbatim into IndexedDB as a transfer payload (`putTransferPayload("load", …)`); the caller returns only a `payloadKey`. Status mapping the client relies on:

| HTTP | Client `status` |
| --- | --- |
| 200 | `"ok"` (payload stored) |
| 401 / 403 | `"auth_error"` |
| 404 | `"not_found"` |
| other non-OK | `"error"` |

> Register alignment: on 200 the payload **fully replaces** the local property config (`replaceServerConfigIntoLocalSnapshot`, `remote-config-sync.ts`) — no stale local field survives. The clean baseline the editor sees (defaults + CSS/AI selectors) is computed from this payload; Discard resets to that computed baseline (T4). The legacy `mergeServerConfigIntoLocalSnapshot` timestamp-merge path is a corrected-away behavior — the rewrite is backend-authoritative + session draft only (T10).

### A.2 `POST /save` — persist the property snapshot

`saveRemoteConfigSnapshot()`. The request body is **not** built inline; it is read from a pre-staged transfer payload by `payloadKey` (the popup/brain assembles a config-sync payload — A.5 — and stores it first). The body shape is therefore the **config-sync payload** (A.5): one property, all locally-marked pages.

**Response status mapping:**

| HTTP | Client `status` |
| --- | --- |
| 200 + JSON object | `"ok"` — response stored as `save-response` transfer payload; local state replaced from it |
| 200 + empty/non-object | `"empty"` |
| 401 / 403 | `"auth_error"` |
| other non-OK | `"error"` (+ `httpStatus`) |

> Register alignment (T4, T8): Save uploads **all** locally-marked pages as one property snapshot, then replaces local state from the server response (backend baseline updated). The "empty `/save`" bug is designed out structurally (backend-authoritative save). The rewrite should send this snapshot directly (Zod-validated) rather than through the current transfer-payload indirection where practical.

### A.3 `POST /remove` — drop one page's marking

`removeRemotePageMarking()`.

```json
{ "siteId": 12345, "url": "https://host/path" }
```

Returns `{ ok, status }`. Skipped unless siteId + url both resolve.

### A.4 Other config-base endpoints (present in client, secondary to the core loop)

| Endpoint | Method | Function | Body | Notes |
| --- | --- | --- | --- | --- |
| `/page-types` | GET | `loadPageTypeTaxonomy` | — | Response written via `writeStoredPageTypeTaxonomy`; `auth_error` on 401/403. |
| `/is_js_rendered` | POST | `requestRenderModeDetection` | staged transfer payload (object) | Render-mode detection assist; returns backend JSON verbatim. |
| `/assign_page_types` | POST | `submitPageTypeAssignments` | staged transfer payload (**array**) | Page-type assignments; array of `{ url, rawHtml, renderedHtml, pageType }` (built by `preparePageTypeAssignmentsSnapshot`, `remote-config-sync.ts`). |

> The `/page-types`, `/is_js_rendered`, and `/assign_page_types` endpoints are config-base (USER-OWNED) but sit **outside** the confirmed core marking loop in the register. Confirm whether they stay in the rewritten scope.

### A.5 Config-sync payload shape (the `/load` response and `/save` body)

Produced by `createConfigSyncPayload()` and parsed by `normalizeConfigSyncPayload()` (`src/common/config.ts`). One object per property:

```jsonc
{
  "version": 1,                          // SERVER_SYNC_VERSION
  "baseUrl": "https://host",             // backend attribute; frontend does NOT normalize/match it (T1)
  "siteId": 12345,                       // positive int | null
  "renderMode": "rendered",              // "rendered" | "static"
  "renderModeUpdatedAt": "<iso|fallback>",
  "selectors": {                         // AiSelectorSet (normalizeAiSelectorSet)
    "exclusionSelectors": ["..."],
    "inclusionSelectors": ["..."]
  },
  "selectorsUpdatedAt": "<iso|fallback>",
  "submittedSelectorsFingerprint": "<hash|''>",
  "pageMarkings": {
    "https://host/page": {
      "timestamp": "<iso>",
      "title": "Page title",             // optional
      "pageType": "product",             // optional
      "renderedHtml": "<html>…",         // sanitized DOM saved as renderedHtml
      "rawHtml": "<html>…",              // JS-disabled capture (static mode only)
      "rows": [                          // TARGET: the single unified exception-row shape
        { "xpath": "/html[1]/body[1]/…", "excluded": true },
        { "xpath": "/html[1]/body[1]/…", "excluded": false, "explicit": true }
      ]
    }
  }
}
```

- **TARGET — ONE row shape everywhere.** A page stores exactly one `rows[]` array of the unified
  exception rows `{ xpath, excluded, explicit? }` — identical to the AI payload's `renderedXPaths` (C.1).
  This **replaces** the current store's `xpaths` + `submissionXpaths` + `includeXpaths` +
  `selectorSuppressedXpaths` split. Everything else (explicit includes = `{excluded:false, explicit:true}`,
  submission rows, suppressed views) is **derived** from `rows[]` by the domain layer's single evaluation
  pass, never stored separately (register T10 marking-derivation). **The backend `/save`/`/load` are
  adapted to this row shape** — this is the resolution of the former "reconcile the split" open item.
- `baseUrl` is a first-class attribute of this payload (the property's canonical base URL; INV-1.2).
- `renderMode` maps lowercase local (`"static"`/`"rendered"`) ↔ the GraphQL `DomainRenderMode` enum (D.4).

---

# (B) PROPERTY-LOCK backend — 🟢 OWNED — DESIGN TARGET (define ideal; backend adapts)

WebSocket hub + independent HTTP reachability probes. The message vocabulary + timing model below are **adopted as the target** (they are a sound design); the one substantive change from the current code is that the **lock identity becomes backend-issued/rotated** (B.1). Current implementation reference: `src/common/property-lock-background.ts` (runtime), `src/common/property-lock.ts` (constants + helpers).

### B.1 Connection keying and URL

`buildPropertyLockWssUrl(endpointBase, token)` (`property-lock.ts`):

```
wss://<host>/property-lock?token=<urlencoded JWT>
```

- Host taken from `configEndpointValue || stageBaseValue`.
- `ws:` only for localhost dev hosts; otherwise `wss:`.
- Auth is the `?token=` query param — **the only place the JWT rides the WS**; no `x-update-token` rotation applies here.

**Session keying:** one socket per `siteId : clientId` pair (`buildConnectionKey`). Each content script opens a long-lived `runtime.Port` named `propertyLock` and supplies its `clientId`; the background maps ports → connection runtimes. Tab ids are used only for local popup↔port lookup, **never** as lock identity.

> ✅ **TARGET (T6) — backend-issued, backend-rotated lock identity.** The current client-minted `clientId` (`createPropertyLockClientId()` + `createUniqueClientIdForSite` collision rotation) is replaced. **Design:** on `subscribe`, the backend issues a lock **`identity`** (returned in the `subscribed` message, B.3); the frontend persists it in the current tab's storage and presents it on subsequent frames. On a lease/handoff, the **backend invalidates the old identity and issues a fresh one** to the new holder — so the previous holder's identity is rejected and it goes passive. The frontend does **no** UUID generation or collision rotation. The `clientId` field in the current message payloads (B.2) becomes this backend-issued identity. The backend is adapted to issue/rotate accordingly.

### B.2 Client → server messages

Sent as JSON frames via `sendToServer`. Base payload (`createClientPayload`): `{ type, siteId, clientId, pageUrl, hasUnsavedChanges }`.

| `type` (constant) | Wire value | Trigger |
| --- | --- | --- |
| `PROPERTY_LOCK_WS_SUBSCRIBE` | `subscribe` | On socket open (claim/subscribe to the property) |
| `PROPERTY_LOCK_WS_HEARTBEAT` | `heartbeat` | Every 30s **only if** interacted within the idle window |
| `PROPERTY_LOCK_WS_ACTIVITY` | `activity` | Debounced editor activity (5s window) |
| `PROPERTY_LOCK_WS_TAKE_LOCK` | `take_lock` | Claim the editor role |
| `PROPERTY_LOCK_WS_RELEASE_LOCK` | `release_lock` | Release editor role (also on tab-close/dispose) |
| `PROPERTY_LOCK_WS_SUGGEST_TAKEOVER` | `suggest_takeover` | Ask current editor to hand off |
| `PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION` | `respond_to_suggestion` | `{ suggestionId, accept, clientId, hasUnsavedChanges, discardUnsaved }` |
| `PROPERTY_LOCK_WS_CONTINUE_EDITING` | `continue_editing` | Same-user "Continue editing here"; `{ …, force, discardPrevious }` |
| `PROPERTY_LOCK_WS_CLIENT_STATUS` | `client_status` | Push current `pageUrl` / `hasUnsavedChanges` |

### B.3 Server → client messages

Parsed in `onWebSocketMessage`; lock state normalized by `normalizeLockStateMessage`.

| `type` | Wire value | Payload fields the client reads |
| --- | --- | --- |
| `PROPERTY_LOCK_WS_SUBSCRIBED` | `subscribed` | `identity`, `name` → stored as `runtime.myIdentity` / `runtime.myName` **(candidate backend-issued lock identity — verify, B.1)** |
| `PROPERTY_LOCK_WS_LOCK_STATE` | `lock_state` | `state`, `editorIdentity`, `editorClientId`, `editorName`, `isEditor`, `isRecentEditor`, `isSameUserEditor`, `otherTabHasUnsavedChanges`, `canContinueHere`, `transferFromName`/`fromName`, `transferToName`/`toName`, `expiresAtUtc`, `secondsRemaining` |
| `PROPERTY_LOCK_WS_DISCONNECT_WARNING` | `disconnect_warning` | `secondsRemaining`, `reason` |
| `PROPERTY_LOCK_WS_INACTIVITY_WARNING` | `inactivity_warning` | (constant present; passed through) |
| `PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION` | `takeover_suggestion` | `suggestionId`, `fromName` |
| `PROPERTY_LOCK_WS_SUGGESTION_PENDING` | `suggestion_pending` | passed through |
| `PROPERTY_LOCK_WS_SUGGESTION_RESPONSE` | `suggestion_response` | `suggestionId` |
| `PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED` | `suggestion_accepted` | `suggestionId` |
| `PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN` | `transfer_countdown` | passed through |
| `PROPERTY_LOCK_WS_ERROR` | `error` | passed through |

**Lock states** (`state` field): `unlocked`, `locked`, `expiry_warning`, `takeover_available`, `transfer` (`disconnected` maps to `locked` client-side).

> **Backend-authoritative timings (T6/T8).** `expiresAtUtc` + `secondsRemaining` come **from the server**; the client only mirrors/displays them. The client-side timing constants below are the current fallback runtimes — treat them as the values the backend is expected to authoritatively drive, not client-owned truth.

### B.4 Timing constants (`property-lock.ts`) — backend-authoritative in the rewrite

| Constant | Value | Meaning |
| --- | --- | --- |
| `PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS` | 30s | Heartbeat cadence (only if interacted < 30 min) |
| `PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS` | 5s | Activity debounce window |
| `PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS` | 30 min | Suppress heartbeat past this idle |
| `PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS` | 70s | Assume lock lost after disconnect |
| `PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS` | 70s | Grace before disposing a client runtime (tab-close bypasses → immediate release) |
| `PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS` | 70s | Off-candidate before editor role released |
| `PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS` | 30s | Recover prior property after cross-property nav |
| `PROPERTY_LOCK_RECONNECT_DELAY_MS` | 2s | Reconnect base (exponential backoff, capped 60s) |
| `PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS` | 5s | Reachability probe timeout |

### B.5 Independent HTTP reachability probes

`checkNetworkConnectivity()` distinguishes "our WS dropped" from "the whole network is down". After a socket close/error it starts a 70s loss watch; when it fires it probes, in order, until one succeeds:

```
PROPERTY_LOCK_NETWORK_CHECK_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://cloudflare.com/cdn-cgi/trace"
]
```

Fetched with `{ cache: "no-store", mode: "no-cors" }` under an `AbortController` (5s). If **none** reach and the socket is still down, the runtime is marked `unavailable` and the editor role is dropped. Connectivity = WS state **AND** these independent probes (register T6).

---

# (C) AI backend — 🟠 LOCKED — CONFORM EXACTLY

Base = `endpointValue` (AI preference). Implemented in `src/background/remote-network.ts` + orchestrated in `src/background/ai-run-orchestrator.ts`. **These shapes are LOCKED to the current code — the rewrite conforms to exactly what the client sends/parses today; no changes are requested from the AI team and nothing here blocks the rewrite.** Where the current parser is lenient (accepts multiple field names), the rewrite preserves that leniency.

### C.1 `POST /get_selectors` — start an AI run

`requestAiRunStartSnapshot()`. Body is the staged `AiRunPayloadSnapshot` (built by `prepareAiRunPayloadSnapshot`, `ai-run-orchestrator.ts`):

```jsonc
{
  "baseUrl": "https://host",
  "renderMode": "rendered",              // "rendered" | "static"
  "defaultExclusionSelectors": [         // immutable-tag blanket list (register T1)
    "IMG","INPUT","NOSCRIPT","SELECT","TITLE","STYLE",
    "SCRIPT","TEMPLATE","IFRAME","VIDEO","SVG"
  ],
  "pages": [
    {
      "url": "https://host/page",
      "renderedHtml": "<html>…",         // ALWAYS present
      "rawHtml": "<html>…",              // ONLY when renderMode === "static" (else omitted)
      "renderedXPaths": [
        { "xpath": "/html[1]/body[1]/…", "excluded": true },
        { "xpath": "/html[1]/body[1]/…", "excluded": false, "explicit": true }
      ]
    }
  ]
}
```

- `renderedXPaths[]` is the **unified exception-row shape** the register mandates everywhere: `{ xpath, excluded: boolean, explicit?: boolean }`. `explicit: true` marks user Alt-inclusions / explicit rows; auto rows omit `explicit` (register T1: auto exceptions are "not special"). Built by `buildAiSubmissionXpaths` (`src/popup/ai-run.ts`).
- `defaultExclusionSelectors` = the immutable blanket list, sent as a **separate** top-level array (register T1: immutable tags ride as `defaultExclusionSelectors`, not as rows).
- `rawHtml` presence is render-mode-gated (`currentRenderMode === "static"`). In static mode the client also runs a background XPath-refinement pass (`refineXPathEntries`) against `rawHtml` before submit.

**Response (locked):** `{ sessionId | id | … }` parsed by `parseAiRunStartResponse` → an opaque session id string. The rewrite matches this lenient parse exactly (no team confirmation needed).

### C.2 `GET /get_selectors/status/:sessionId` — poll status

`requestAiRunStatus()`. Response parsed by `parseAiRunStatusResponse` → `{ sessionId, status }`. The client requires `parsed.sessionId === sessionId`. Status values the client branches on:

| `status` | Client action |
| --- | --- |
| `running` | keep polling |
| `error` | fail the run (`run_error`) |
| (anything else) | treat as done → fetch result |
| HTTP 404 | `notFound` → run no longer exists |

**Poll cadence:** `aiRunPollIntervalMs` default **5s**; overall deadline `aiRunTimeoutMs` default **480s (8 min)** (`AI_RUN_DEFAULT_TIMEOUT_MS` = `8 * 60 * 1000` = 480000 ms, `src/common/bus/contracts/ai-run.ts`). The loop polls first, then sleeps only while `running` (avoids head-of-loop lag). A per-run heartbeat (`refreshAiRunHeartbeat`) persists an AI-run record to session storage each iteration for MV3 resume.

### C.3 `GET /get_selectors/result/:sessionId` — fetch result

`requestAiRunResultSnapshot()`. Response **must** be an object with both arrays or the client rejects it:

```jsonc
{
  "exclusionSelectors": ["css selector", "..."],
  "inclusionSelectors": ["css selector", "..."]
}
```

- Stored as `ai-run-result` transfer payload; normalized by `normalizeAiSelectorSet` into the config's `selectors` (A.5). HTTP 404 → `notFound`.
- **Locked:** the rewrite matches the current parse exactly — the response must be an object carrying both selector arrays or it is rejected; empty/partial handling and 404→`notFound` follow the current client. No team confirmation needed.

> Register alignment (T4): after any marking change, the AI run must re-run before Save enables; the result set seeds the fresh-page baseline and Discard's clean baseline. This is a client-side gate, not part of the AI wire contract.

---

# (D) GraphQL backend — 🟠 LOCKED — CONFORM EXACTLY

Endpoint: `https://api.${stageBase}/graphql` (`buildGraphqlEndpointFromStageBase`). `POST`, JSON `{ query, variables }`, Bearer auth, `x-update-token` rotation applies. **These queries are LOCKED to the current code — the rewrite issues them verbatim and parses exactly what they return today; no schema change is requested and nothing here blocks the rewrite.**

### D.1 `urlSearchInfo` — raw URL → siteId (the property-identity source)

`resolveLivePageSiteId()` (`src/background/live-page-client.ts`), query `URL_SEARCH_INFO_QUERY` (`lynx-live-pages.ts`):

```graphql
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
```

- Variables: `{ url: <raw page URL>, includePageInfo: false }`.
- `domainId` → `siteId` (`normalizeSiteIdValue`, positive int). **This is the authoritative property identity** (register T1): the frontend sends the raw URL and takes the backend's `domainId`. No frontend base-URL normalization/longest-match.
- Error handling: a GraphQL error with `extensions.code === "NotFound"` → `{ ok: true, siteId: null, notFound: true }`.

> ✅ **RESOLVED (T1/INV-1.2) — base URL comes from the OWNED config server, not GraphQL.** `urlSearchInfo` is LOCKED to current (returns only `domainId` + `domainName`), and we do **not** ask the GraphQL team to add anything. Property identity = `domainId` → `siteId`. The register's "base URL is a backend attribute the frontend never computes" (INV-1.2) is satisfied by the **`baseUrl` attribute on the config `/load` response** (A.1/A.5), which is on the OWNED surface we define. The legacy frontend derivation `normalizeBaseUrlFromDomainName()` (`src/background/live-page-client.ts`, ~line 95) is **dropped** — the rewrite reads `baseUrl` from `/load` instead. No GraphQL change, no blocker.

### D.2 `propertyPageTypes` — page-type taxonomy + candidates

`fetchLivePagePropertyPageTypes()`, query `PROPERTY_PAGE_TYPES_QUERY`:

```graphql
query getPropertyPageTypes($domainId: Int!) {
  propertyPageTypes(domainId: $domainId) {
    pageTypes {
      pageType
      pages { url wordsCount }
    }
  }
}
```

- Variables: `{ domainId: <siteId> }`. Normalized by `normalizePropertyPageTypes` (`lynx-checklist.ts`) into `{ key, title, candidates:[{url, wordsCount, duplicate, duplicatePageTypes}] }`. Drives the "is this page a candidate?" check (`getCurrentPageCandidateState`).

### D.3 `cssInfo` — send-to-Lynx staleness guard

`fetchLynxCssInfo()` (`remote-network.ts`), query `CSS_INFO_QUERY`:

```graphql
query cssInfo($url: String!) {
  cssInfo(url: $url) {
    domainId
    domainName
    exclusionCssSelectors
    inclusionCssSelectors
    isJavascriptRenderingEnabled
    usesUnfluffify
  }
}
```

- Variables: `{ url: <page URL> }`. Fetched when the Lynx checklist popover opens; the popup compares **sanitized** selector sets and **fail-closes** the send while this is pending/unavailable. GraphQL `errors[]` non-empty → `{ ok: false }`.

### D.4 `updateScrapingConditions` — publish selectors

`submitSelectorSetGraphqlUpdate()` (`remote-network.ts`), mutation `UPDATE_SCRAPING_CONDITIONS_MUTATION`:

```graphql
mutation updateScrapingConditions(
  $domainId: Int!, $includeCss: String!, $excludeCss: String!, $renderingMode: DomainRenderMode
) {
  updateScrapingConditions(
    domainId: $domainId
    includeCss: $includeCss
    excludeCss: $excludeCss
    renderingMode: $renderingMode
  )
}
```

- Variables: `{ domainId: <siteId>, includeCss, excludeCss, renderingMode }`.
- `renderingMode` is a `DomainRenderMode` enum: local lowercase `"static"`→`STATIC`, `"rendered"`→`RENDERED`; anything else → `null` (omitted semantics). Mapping done client-side.
- Returns `{ ok, status, payload }` (raw GraphQL body passed through).

> **Locked for all of D:** the rewrite uses these exact query strings, arg types (`domainId: Int!`), the `DomainRenderMode` enum mapping, the `cssInfo` field list, and the `updateScrapingConditions` return handling (HTTP-level ok) verbatim from the current client. No GraphQL-team confirmation is required.

---

## Accounts endpoints (auth) — 🟠 LOCKED — CONFORM EXACTLY

`validateAuthToken` (`GET https://accounts.${stage}/api/account/validate`) and `requestAuthLogin` (`POST …/api/account/login`, body `{ email, password }`) live in `network-core.ts`. Token readiness is polled by `createAuthTokenMonitor` (`src/background/auth-token-monitor.ts`) on a **10-minute browser alarm** (MV3 suspension-safe); an invalid token notifies the popup to lock config. The `accounts.${stage}` host is derived from `stageBaseValue` (shared with the GraphQL stage). **Locked to current** — accounts is stage-derived and separate-team-owned; the rewrite conforms exactly (same JWT the config/lock backends consume; same validate/login shapes). No change requested.

---

## Backend-adaptation worklist (🟢 OWNED — the architect's config + lock server adapts to these targets)

These are **design targets to implement server-side**, not confirmations. The rewrite builds to them:

1. **`/load` response** carries a `baseUrl` attribute and per-page `rows[]` of the unified `{ xpath, excluded, explicit? }` shape (A.1/A.5). `baseUrl` is the sole source for INV-1.2 (no GraphQL change).
2. **`/save` body + response** use the same unified `rows[]` snapshot — **no** `xpaths`/`submissionXpaths`/`includeXpaths`/`selectorSuppressedXpaths` split. Submission/suppressed/include views are derived client-side, never stored.
3. **Backend-issued lock identity:** the `subscribed` message returns a backend-generated `identity`; the backend invalidates-old + issues-fresh on lease/handoff; the frontend persists it per tab and mints nothing (B.1).
4. **Backend-authoritative lease timers:** `expiresAtUtc` + `secondsRemaining` on `lock_state` are the source of truth for all countdown windows (B.4); the client only displays them.
5. **Scope decision:** whether `/page-types`, `/is_js_rendered`, `/assign_page_types`, `/remove` remain (they are OWNED and can be redesigned or folded).

## Locked surfaces (🟠 no action required)

AI (C), GraphQL (D), and accounts are **locked to the current code** — the rewrite conforms to the shapes documented above verbatim. There is **no team dependency and no blocker**: `urlSearchInfo` stays as-is (`domainId` + `domainName`; base URL is sourced from the OWNED `/load` instead), the AI start/status/result parses stay lenient-as-current, and the `DomainRenderMode`/`cssInfo`/`updateScrapingConditions` shapes are used verbatim.
