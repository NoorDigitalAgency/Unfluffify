# Remote API Contract

**Status & sourcing model (architect decision, T11 amended).** Apply the later binding
[`study/qa-decisions-save-contract.md`](./study/qa-decisions-save-contract.md) first. It changes
the config save shape, makes the Hub the delegated GraphQL caller, adds fencing/idempotency, and
supersedes conflicting historical descriptions below. This document has **two kinds of surfaces**:

- 🟢 **OWNED — DESIGN TARGET.** The **config server** (`/load`, `/save`, `/remove`, page-type/render-mode assists) and the **property-lock** hub are owned by the architect. Their schemas here are the **most-suitable target schema the rewrite defines**; the **backend will be adapted to match**. They are NOT pinned to the current client — where the current shape is legacy, the target is stated and the current shape is shown only as reference.
- 🟠 **LOCKED — CONFORM EXACTLY.** The **AI** (`/get_selectors`), **GraphQL** (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`, `updateScrapingConditions`), and **accounts** surfaces are owned by a separate team. Their schemas are **locked to the current code**: the rewrite conforms to exactly what the client sends/parses today. **No changes are requested from that team, and no verification blocks the rewrite** — these are authoritative as-is.

| Marker | Meaning |
| --- | --- |
| 🟢 **OWNED — DESIGN TARGET** | Config + property-lock. Define the ideal schema; adapt the backend to it. |
| 🟠 **LOCKED — CONFORM EXACTLY** | AI + GraphQL + accounts. Pinned from current code; the rewrite matches it verbatim; no team dependency. |

**Scope note.** Identity is `(environmentKey, siteId)`. The Hub invokes the locked GraphQL
queries using the exact delegated client JWT and a registered stage endpoint. GraphQL owns
`siteId` and canonical property facts; observed URL origins are informational. Candidate storage
uses the GraphQL-derived relative `pageKey`, not a full observed URL.

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
- GraphQL and accounts endpoints are **derived from `stageBaseValue`**, not from a stored URL. For
  Hub-owned GraphQL calls, `stageBaseValue` is normalized and resolved through a deployment
  allowlist/registry; arbitrary endpoints are rejected:
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

# (A) HUB config/context backend — 🟢 OWNED — DESIGN TARGET

Base = `configEndpointValue` (fallback `endpointValue`). All bodies are JSON; all authed with the Bearer header; all run responses through the token-rotation hook. **The shapes below are the TARGET the rewrite defines; the backend is adapted to match.** Current client function names (`src/background/remote-network.ts`) are cited only as the reference the target evolves from.

### A.1 Common mutation envelope

Every Hub mutation is runtime-validated and carries:

```jsonc
{
  "operationId": "client-generated-idempotency-key",
  "environmentKey": "registered.stage.example",
  "siteId": 12345,
  "editorSessionId": "per-tab/window/browser-session-id",
  "lockToken": "opaque-backend-fence",
  "expectedPropertyRevision": 42,
  "expectedFeedRevision": 9
}
```

`siteId` is a required positive integer. Duplicate `operationId` delivery returns the recorded
result. A stale fence or revision fails without mutation.

### A.2 `POST /context` — resolve property and complete candidate feed

Request adds the observed URL and normalized configured stage. The Hub derives the registered
GraphQL endpoint, delegates the exact client JWT to `urlSearchInfo` and `propertyPageTypes`,
canonicalizes relative `pageKey` values, validates completeness/duplicates, and returns typed
context plus membership and assignment fingerprints. It forwards any rotated JWT.

GraphQL payload classification wins over HTTP status. Auth/permission/NotFound/partial/malformed
outcomes never masquerade as an empty feed and never trigger reconciliation.

### A.3 `POST /load` — fetch the complete authoritative snapshot

Request: `{ "environmentKey": "…", "siteId": 12345 }`. Response is the full property snapshot
defined in A.8. A valid response atomically replaces the background baseline; 404 clears it;
transport/auth/schema failures preserve the prior baseline.

### A.4 `POST /save` — partial upsert of exactly one page

The request is the A.1 envelope plus:

```jsonc
{
  "page": {
    "pageKey": "/path?query#fragment",
    "title": "Page title",
    "pageType": "product",
    "renderedHtml": "<html>…",
    "rawHtml": "<html>…",
    "rows": [
      { "xpath": "/html[1]/body[1]/…", "excluded": true },
      { "xpath": "/html[1]/body[1]/…", "excluded": false, "explicit": true }
    ]
  },
  "selectors": {
    "exclusionSelectors": ["…"],
    "inclusionSelectors": ["…"]
  },
  "renderMode": "rendered"
}
```

There is no `pageMarkings` map. The Hub refreshes/reconciles the feed, upserts only `page`,
preserves all absent pages, assigns timestamps, and returns A.8. Save never performs implicit
deletion. For the extension, a successful Save response is a commit acknowledgement only: it
invalidates cached property authority and immediately issues a distinct `POST /load`. Only that
Load response may complete-replace local configuration. The Save response body is never adopted as
local authority, even when the Hub includes the full snapshot for protocol compatibility.

### A.5 `POST /remove` — explicit one-page deletion

The request is the A.1 envelope plus `{ "pageKey": "/path?query#fragment" }`. It refreshes the
feed, deletes only that stored marking, and returns A.8 with explicit mutation metadata.

### A.6 `POST /page-types/reconcile` — apply a validated complete feed

The request carries the A.1 envelope and accepted feed revision/fingerprints. The Hub itself
refetches the feed with the delegated JWT; it never trusts a client-supplied candidate list or
conflict flag. Response metadata lists `removedPageKeys` and relabels. Cross-type duplicate keys
persist `candidate_feed_conflict` and perform no mutation.

### A.7 `POST /publish` — Hub-owned Send to Lynx

The request carries the A.1 envelope and expected normalized saved-selector fingerprint. The Hub
refreshes/validates context, lock, Todo completeness, `cssInfo`, and fingerprint, then performs
the locked `updateScrapingConditions` mutation with the exact delegated JWT. Only definitive
success advances `submittedSelectorsFingerprint`. Ambiguous outcomes are recorded as
`publication_unknown` under the same operation id.

The additional request field is:

```jsonc
{
  "expectedSelectorsFingerprint": "<64-character lowercase SHA-256>"
}
```

Fingerprint bytes are the compact UTF-8 JSON
`{"exclusionSelectors":[...],"inclusionSelectors":[...]}` after both saved-selector lists are
trimmed, emptied values dropped, deduplicated case-sensitively, and ordinally sorted. It is computed
before the immutable exclusion blanket is appended to the Lynx payload. The canonical fixture
`{"exclusionSelectors":["footer","header"],"inclusionSelectors":["main"]}` hashes to
`2c3af722ce277a71d3242dcf650683d9298863820dd71ab92e381c2a0a466035`.

If the refreshed feed changed, the response is the reconciled full snapshot with operation status
`reconciliation_required`; the client adopts it and uses a fresh operation. A GraphQL selector-set
match may definitively resolve the publication without re-sending. A transport loss, malformed
mutation response, or partial data plus errors returns `publication_unknown` while the authority
journal keeps that operation pending. Only the same operation/fence/revisions may retry; it verifies
`cssInfo` first and otherwise resends the identical replace-state payload.

### A.8 Complete Hub response snapshot

Every successful save/remove/reconcile/publish response contains the complete snapshot below.
Mutation responses remain useful for server reconciliation and protocol diagnostics, but the
extension's post-Save configuration authority is deliberately Load-only as defined in A.3/A.4.

```jsonc
{
  "version": 2,
  "environmentKey": "registered.stage.example",
  "siteId": 12345,
  "baseUrl": "<GraphQL-authoritative informational value>",
  "propertyRevision": 43,
  "feedRevision": 9,
  "membershipFingerprint": "…",
  "assignmentFingerprint": "…",
  "renderMode": "rendered",
  "renderModeUpdatedAt": "<server ISO timestamp>",
  "selectors": { "exclusionSelectors": ["…"], "inclusionSelectors": ["…"] },
  "selectorsUpdatedAt": "<server ISO timestamp>",
  "submittedSelectorsFingerprint": "<last definitively published hash>",
  "pages": {
    "/path?query#fragment": {
      "timestamp": "<server ISO timestamp>",
      "title": "Page title",
      "pageType": "product",
      "renderedHtml": "<html>…",
      "rawHtml": "<html>…",
      "rows": [{ "xpath": "/html[1]/body[1]/…", "excluded": true }]
    }
  },
  "reconciliation": {
    "revision": 9,
    "feedFingerprint": "…",
    "removedPageKeys": [],
    "relabelledPages": []
  },
  "operation": { "operationId": "…", "status": "committed" }
}
```

The unified `rows[]` shape remains the only stored marking row. All timestamps are server-owned.
Selectors are compared after semantic normalization; no calculation-basis fingerprint exists.

---

# (B) PROPERTY-LOCK backend — 🟢 OWNED — FENCED DESIGN TARGET

WebSocket hub + independent HTTP reachability probes. The binding target separates the
client-created `editorSessionId` from the backend-issued/rotated fencing `lockToken`, scopes the
lease by `(environmentKey, siteId)`, and qualifies renewal by real focused/non-idle presence.
Current implementation references remain useful only as migration evidence.

### B.1 Connection keying and URL

`buildPropertyLockWssUrl(endpointBase, token)` (`property-lock.ts`):

```
wss://<host>/property-lock?token=<urlencoded JWT>
```

- Host taken from `configEndpointValue || stageBaseValue`.
- `ws:` only for localhost dev hosts; otherwise `wss:`.
- Auth is the `?token=` query param — **the only place the JWT rides the WS**; no `x-update-token` rotation applies here.

**Session keying:** a lease is `(environmentKey, siteId)` and each contender supplies a distinct
`editorSessionId`. The Hub returns an opaque `lockToken` to the holder. All REST and WS mutations
present that fence. Grant, same-user transfer, and takeover rotate it; the prior token is rejected.
The client may create session/operation correlation ids, but never lock authority.

### B.2 Client → server messages

Sent as JSON frames via `sendToServer`. Target base payload:
`{ type, environmentKey, siteId, editorSessionId, lockToken?, pageKey?, hasUnsavedWork,
visible, focusedWindow, browserIdle, lastActivityAt }`. `hasUnsavedWork` is metadata only; no
draft content crosses the boundary.

| `type` (constant) | Wire value | Trigger |
| --- | --- | --- |
| `PROPERTY_LOCK_WS_SUBSCRIBE` | `subscribe` | On socket open (claim/subscribe to the property) |
| `PROPERTY_LOCK_WS_HEARTBEAT` | `heartbeat` | At backend cadence; renewal only for visible + focused-window + non-idle presence |
| `PROPERTY_LOCK_WS_ACTIVITY` | `activity` | Debounced editor activity (5s window) |
| `PROPERTY_LOCK_WS_TAKE_LOCK` | `take_lock` | Claim the editor role |
| `PROPERTY_LOCK_WS_RELEASE_LOCK` | `release_lock` | Release editor role (also on tab-close/dispose) |
| `PROPERTY_LOCK_WS_SUGGEST_TAKEOVER` | `suggest_takeover` | Ask current editor to hand off |
| `PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION` | `respond_to_suggestion` | `{ suggestionId, accept, editorSessionId, hasUnsavedWork, discardUnsaved }` |
| `PROPERTY_LOCK_WS_CONTINUE_EDITING` | `continue_editing` | Same-user "Continue editing here"; `{ …, force, discardPrevious }` |
| `PROPERTY_LOCK_WS_CLIENT_STATUS` | `client_status` | Push current `pageKey`, qualifying-presence fields, and `hasUnsavedWork` |

### B.3 Server → client messages

Parsed in `onWebSocketMessage`; lock state normalized by `normalizeLockStateMessage`.

| `type` | Wire value | Payload fields the client reads |
| --- | --- | --- |
| `PROPERTY_LOCK_WS_SUBSCRIBED` | `subscribed` | `editorSessionId`, `lockToken`, holder name, property/environment revision |
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

### B.4 Timing constants — backend-authoritative target

| Constant | Value | Meaning |
| --- | --- | --- |
| `PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS` | 30s current default | Transport cadence; a hidden/background/idle page does not renew |
| `PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS` | 5s | Activity debounce window |
| `PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS` | 30 min current default | Ordinary inactivity policy after qualifying presence is lost |
| `PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS` | 70s | Assume lock lost after disconnect |
| `PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS` | 70s | Grace before disposing a client runtime (tab-close bypasses → immediate release) |
| `PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS` | 70s | Off-candidate before editor role released |
| `PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS` | **10 min** | Candidate removal/conflict grace before ordinary inactivity countdown |
| `PROPERTY_CONTEXT_RECOVERY_POLL_MS` | **15s** | Client-driven Hub context refresh while focused or inside recovery grace |
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

Dropping transport does not itself prove transfer. A stale-but-untransferred lease may be
reacquired by the same `editorSessionId` with its draft. Only an authoritative rotated fence
destroys the old session's unsaved work. Same-user `Continue here` warns when the holder reports
unsaved work (or that report is stale/unknown), then transfers destructively on confirmation.

---

# (C) AI backend — 🟠 LOCKED — CONFORM EXACTLY

Base = `endpointValue` (AI preference). Implemented in `src/background/remote-network.ts` + orchestrated in `src/background/ai-run-orchestrator.ts`. **These shapes are LOCKED to the current code — the rewrite conforms to exactly what the client sends/parses today; no changes are requested from the AI team and nothing here blocks the rewrite.** Where the current parser is lenient (accepts multiple field names), the rewrite preserves that leniency.

### C.1 `POST /get_selectors` — start an AI run

The AI service has **no property or page memory**. Every call is a complete,
self-contained calculation: the request carries the latest loaded corpus for
every candidate page in the property plus the active current-page projection.
The returned session id is only an ephemeral asynchronous-job handle for the
status/result calls below. It must never be interpreted as server-side property
state, a reusable corpus, or a remotely persisted draft.

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

**Poll cadence:** `aiRunPollIntervalMs` default **5s**; overall deadline `aiRunTimeoutMs` default **480s (8 min)** (`AI_RUN_DEFAULT_TIMEOUT_MS` = `8 * 60 * 1000` = 480000 ms, `src/common/bus/contracts/ai-run.ts`). The loop polls first, then sleeps only while `running` (avoids head-of-loop lag). A per-run heartbeat (`refreshAiRunHeartbeat`) keeps an active-session continuation record in extension session storage so an MV3 worker restart can resume polling. That record is not AI/backend persistence and is retired on Save, Discard, marking disable, page navigation, or session replacement. Generation fencing prevents a late poll or result from recreating a retired record.

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

> Register alignment (T4): after any marking change, the AI run must re-run before Save enables. The result set is an active-session suggestion only. It does not seed Discard or a future marking session. Save commits the accepted result; only the subsequent distinct Load can make the backend's newest complete shape the authoritative selector baseline for Discard or a later enable. This is a client-side lifecycle gate, not AI-side persistence.

---

# (D) GraphQL backend — 🟠 LOCKED SCHEMA, HUB-DELEGATED CALLER

Endpoint: `https://api.${stageBase}/graphql` (`buildGraphqlEndpointFromStageBase`). `POST`, JSON
`{ query, variables }`, Bearer auth, `x-update-token` rotation applies. Query/mutation schemas are
locked to current, but the **Hub is now the caller** for property context, reconciliation, and
publication. Each Hub request derives the endpoint through its environment registry and forwards
the exact JWT supplied by the extension. It never stores/logs that JWT or substitutes a service
credential.

The Hub classifies the GraphQL payload before HTTP status. Authorization payloads may arrive as
HTTP 500; data plus errors is an invalid partial response; failed/ambiguous responses never mean an
empty candidate feed. Any `x-update-token` is returned to the extension background for adoption.

### D.1 `urlSearchInfo` — raw URL → siteId (the property-identity source)

The Hub context resolver invokes the existing `URL_SEARCH_INFO_QUERY`:

```graphql
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
```

- Variables: `{ url: <raw page URL>, includePageInfo: false }`.
- `domainId` → `siteId` (`normalizeSiteIdValue`, positive int). Combined with the registered
  environment, this is authoritative property identity. No frontend origin normalization or
  longest-match establishes membership.
- Error handling: a GraphQL error with `extensions.code === "NotFound"` → `{ ok: true, siteId: null, notFound: true }`.

> `domainName`/canonical GraphQL property information is authoritative context, but observed URL
> origins remain informational. Candidate identity is the feed URL canonicalized to relative
> path+query+fragment. The extension does not derive a deterministic base URL from the observed host.

### D.2 `propertyPageTypes` — page-type taxonomy + candidates

The Hub invokes `PROPERTY_PAGE_TYPES_QUERY` and validates it as a complete property-wide feed:

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

- Variables: `{ domainId: <siteId> }`. The Hub canonicalizes page keys, produces membership and
  assignment fingerprints, silently excludes empty page types from user workflow, and persists a
  property block when one key appears under different types. The extension consumes the validated
  canonical feed rather than independently deciding conflicts.

### D.3 `cssInfo` — send-to-Lynx staleness guard

The Hub publication workflow invokes `CSS_INFO_QUERY`:

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

The Hub publication workflow invokes `UPDATE_SCRAPING_CONDITIONS_MUTATION`:

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
- `renderingMode` is a `DomainRenderMode` enum: local lowercase `"static"`→`STATIC`,
  `"rendered"`→`RENDERED`; anything else → `null` (omitted semantics). The Hub applies the same
  locked mapping.
- Only definitive payload success advances the Hub's submitted-selector fingerprint. Ambiguous
  transport is retained under the same idempotent publication operation, never reported as success.

> **Locked for all of D:** query strings, argument types, enum mapping, and field lists stay exact.
> HTTP-level `ok` alone is **not** success; the Hub must classify the GraphQL payload as specified in
> D13–D24.

---

## Accounts endpoints (auth) — 🟠 LOCKED — CONFORM EXACTLY

`validateAuthToken` (`GET https://accounts.${stage}/api/account/validate`) and `requestAuthLogin` (`POST …/api/account/login`, body `{ email, password }`) live in `network-core.ts`. Token readiness is polled by `createAuthTokenMonitor` (`src/background/auth-token-monitor.ts`) on a **10-minute browser alarm** (MV3 suspension-safe); an invalid token notifies the popup to lock config. The `accounts.${stage}` host is derived from `stageBaseValue` (shared with the GraphQL stage). **Locked to current** — accounts is stage-derived and separate-team-owned; the rewrite conforms exactly (same JWT the config/lock backends consume; same validate/login shapes). No change requested.

---

## Backend-adaptation worklist (🟢 OWNED — the architect's config + lock server adapts to these targets)

These are **design targets to implement server-side**, not confirmations. The rewrite builds to them:

1. Implement `/context` as the sole property/feed resolver, with registered stages, exact-JWT
   delegation, payload-first error classification, canonical relative page keys, and feed fingerprints.
2. Implement complete `/load`, structurally singular partial-upsert `/save`, explicit `/remove`,
   fenced reconciliation, and full Hub responses using unified `rows[]`; ensure the client treats
   Save as commit-only and performs a distinct Load for complete local replacement.
3. Assign all timestamps server-side; preserve absent pages and submitted fingerprints; provide
   explicit shrink/relabel proof.
4. Implement backend-issued/rotated `lockToken`, distinct `editorSessionId`, qualifying-presence
   renewal, destructive same-user transfer, and 10-minute suspended recovery grace.
5. Make every mutation fenced, revision-checked, and idempotent by `operationId`.
6. Implement Hub-owned `/publish` around locked `cssInfo`/`updateScrapingConditions` calls and advance
   publication state only after definitive success.

## Locked surfaces (🟠 no action required)

AI (C), GraphQL schema (D), and accounts are **locked to the current code**. There is no schema-team
dependency. The owned Hub now calls the GraphQL property/publication surfaces with delegated client
authority; the extension calls the Hub for those workflows.
