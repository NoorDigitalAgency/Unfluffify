# Remote API Contract (pinned from the current client)

**Status:** reverse-engineered from the existing client code. Shapes are pinned to what the client actually sends/parses today. This is the contract the clean rewrite must speak.

**Ownership legend:**

| Marker | Meaning |
| --- | --- |
| 🟢 **USER-OWNED** | Config + property-lock backend. The architect can confirm these directly. |
| 🟠 **SEPARATE TEAM** | AI (`/get_selectors`) and GraphQL (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`, `updateScrapingConditions`) — owned by another team. Every shape here is **pinned-from-client** and must be **VERIFIED WITH AI/GraphQL TEAM** before it is treated as authoritative. |

**Scope note.** The register (T1, T11) is inclusion-centric and treats the backend `siteId` (from GraphQL) as the sole property identity; base URL is a backend attribute the frontend never computes. This document pins the transport contract only. Where a shape looks like a legacy behavior the register corrected away (e.g. frontend base-URL normalization, config-merge), it is called out but is **not** part of the target contract.

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

# (A) CONFIG backend — 🟢 USER-OWNED (confirmable)

Base = `configEndpointValue` (fallback `endpointValue`). Implemented in `src/background/remote-network.ts`. All bodies are JSON; all authed with the Bearer header; all run responses through the token-rotation hook.

### A.1 `POST /load` — fetch the property config snapshot

`loadRemoteConfigSnapshot()`.

**Request body:**

```json
{ "siteId": 12345 }
```

- `siteId` is the normalized backend site id (`normalizeSiteIdValue` → positive integer). This is the property identity per the register (T1) — **no base URL is sent**.

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
      "rawHtml": "<html>…",              // JS-disabled capture (static mode)
      "xpaths": [ /* per-element exception rows, see below */ ],
      "submissionXpaths": [ { "xpath": "/html[1]/body[1]/…", "excluded": true } ]
    }
  }
}
```

- `xpaths[]` are the exclusion/inclusion **exception rows** (register T1: one unified per-element "exception" kind; inclusion-centric model). In the current store an entry also carries `includeXpaths` (explicit Alt inclusions) and `selectorSuppressedXpaths`; `normalizePageMarkings` folds explicit includes back out of `xpaths`. **The wire row the rewrite standardizes on is `{ xpath, excluded, explicit? }`** (see the AI payload, C.1) — align `/save` to emit that same row shape.
- `renderMode` maps lowercase local ↔ `DomainRenderMode` enum on the GraphQL side (D.4).

> ⚠️ Verify with the architect: the exact `/save` body the backend accepts — specifically whether `/save` wants the legacy `xpaths` + `submissionXpaths` split shown here, or the unified `{ xpath, excluded, explicit? }` row the register mandates for the AI payload. The register wants ONE row shape everywhere; the current `/save` code still emits the split. **This is the single most important thing to confirm on the config surface.**

---

# (B) PROPERTY-LOCK backend — 🟢 USER-OWNED

WebSocket hub + independent HTTP reachability probes. Implemented in `src/common/property-lock-background.ts` (runtime) and `src/common/property-lock.ts` (protocol constants + helpers).

### B.1 Connection keying and URL

`buildPropertyLockWssUrl(endpointBase, token)` (`property-lock.ts`):

```
wss://<host>/property-lock?token=<urlencoded JWT>
```

- Host taken from `configEndpointValue || stageBaseValue`.
- `ws:` only for localhost dev hosts; otherwise `wss:`.
- Auth is the `?token=` query param — **the only place the JWT rides the WS**; no `x-update-token` rotation applies here.

**Session keying:** one socket per `siteId : clientId` pair (`buildConnectionKey`). Each content script opens a long-lived `runtime.Port` named `propertyLock` and supplies its `clientId`; the background maps ports → connection runtimes. Tab ids are used only for local popup↔port lookup, **never** as lock identity.

> ⚠️ **Register correction (T6) — the client-generated `clientId` is a corrected-away mechanism.** Today `createPropertyLockClientId()` mints a UUID client-side and the background rotates it on collision (`createUniqueClientIdForSite`). The register mandates that the **BACKEND issues and rotates the lock identity**: on a lease/handoff the backend invalidates the old identity and issues a fresh one to the new holder; the frontend persists the backend-issued identity per tab and does **no** UUID generation/rotation. The rewrite must move identity issuance server-side. **Confirm the backend handshake that returns the issued identity** (candidate today: the `subscribed` message's `identity` field, B.3).

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

# (C) AI backend — 🟠 SEPARATE TEAM — **VERIFY WITH AI/GraphQL TEAM**

Base = `endpointValue` (AI preference). Implemented in `src/background/remote-network.ts` + orchestrated in `src/background/ai-run-orchestrator.ts`. All shapes below are pinned from the client; **none are confirmed by the owning team.**

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

**Response (pinned):** `{ sessionId | id | … }` parsed by `parseAiRunStartResponse` → an opaque session id string. **⚠️ Verify the exact response field name and shape with the AI team.**

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
- **⚠️ Verify** with the AI team: exact result field names, whether the result endpoint can 200 with a partial/empty set, and error envelope.

> Register alignment (T4): after any marking change, the AI run must re-run before Save enables; the result set seeds the fresh-page baseline and Discard's clean baseline. This is a client-side gate, not part of the AI wire contract.

---

# (D) GraphQL backend — 🟠 SEPARATE TEAM — **VERIFY WITH AI/GraphQL TEAM**

Endpoint: `https://api.${stageBase}/graphql` (`buildGraphqlEndpointFromStageBase`). `POST`, JSON `{ query, variables }`, Bearer auth, `x-update-token` rotation applies. All queries below are pinned verbatim from the client; **the owning team must confirm schema, arg types, and response shapes.**

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

> 🚫 **BLOCKER — Register correction (T1), INV-1.2:** the pinned `urlSearchInfo` query currently returns **only** `domainId` + `domainName` — there is **NO** backend base-URL attribute field today. The base URL is currently **DERIVED** frontend-side via `normalizeBaseUrlFromDomainName()` (`src/background/live-page-client.ts`, ~line 95), which the register (INV-1.2) corrects away. The register mandates the base URL is a **backend attribute only** — the frontend must not compute/normalize/match it. Therefore the corrected "base URL is a backend attribute" model has **NO data source** until the GraphQL team **ADDS** a base-URL field to the schema. This is a **schema-ADD request (blocker)**, not a soft confirm — see the Verification checklist. The rewrite cannot drop `normalizeBaseUrlFromDomainName` until that field exists.

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

> ⚠️ **Verify with the GraphQL team** for all of D: schema names (`domainId` Int vs siteId), the `DomainRenderMode` enum values, `cssInfo` field list/types, and the `updateScrapingConditions` return shape (currently the client only checks HTTP-level ok).

---

## Accounts endpoints (auth) — ownership boundary note

`validateAuthToken` (`GET https://accounts.${stage}/api/account/validate`) and `requestAuthLogin` (`POST …/api/account/login`, body `{ email, password }`) live in `network-core.ts`. Token readiness is polled by `createAuthTokenMonitor` (`src/background/auth-token-monitor.ts`) on a **10-minute browser alarm** (MV3 suspension-safe); an invalid token notifies the popup to lock config. The `accounts.${stage}` host is derived from `stageBaseValue` (shared with the GraphQL stage). **Confirm which team owns the accounts service** — it is stage-derived like the GraphQL surface but authenticates the same JWT the USER-owned config/lock backends consume.

---

## Verification checklist (hand to the owning teams)

**🟢 Architect (config + lock):**
1. Exact `/save` body row shape — legacy `xpaths`+`submissionXpaths` split vs the unified `{ xpath, excluded, explicit? }` row the register mandates. **(highest priority)**
2. `/load` response envelope matches A.5 (version, siteId, renderMode, selectors, pageMarkings).
3. Whether `/page-types`, `/is_js_rendered`, `/assign_page_types`, `/remove` stay in scope.
4. **Backend-issued lock identity handshake** (T6): does `subscribed.identity` carry a backend-issued, backend-rotated id the frontend can persist per-tab, replacing the client-minted `clientId`? Confirm invalidate-old + issue-fresh on lease.
5. Confirm `expiresAtUtc`/`secondsRemaining` are the authoritative lease timers.

**🟠 AI team:** C.1 `/get_selectors` start-response field name; C.2 status enum + 404 semantics; C.3 result field names + empty/partial + error envelope.

**🟠 GraphQL team:** D.1–D.4 schema names, `DomainRenderMode` enum, `cssInfo` fields, mutation return shape.
- 🚫 **BLOCKER (schema-ADD request, not a confirm):** `urlSearchInfo` today returns only `domainId` + `domainName`; there is **no** base-URL attribute field. INV-1.2 requires the base URL to be a **backend attribute** the frontend never derives, but the frontend currently derives it via `normalizeBaseUrlFromDomainName` (`src/background/live-page-client.ts`, ~line 95). **The GraphQL team must ADD a base-URL attribute field to the schema** — the corrected model has no data source until they do. The rewrite cannot drop `normalizeBaseUrlFromDomainName` until this field ships (T1).
