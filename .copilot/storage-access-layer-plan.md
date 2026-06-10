# Storage Access Layer Refactor Plan

Last updated: 2026-06-10
Status: IMPLEMENTED
Scope: completed architectural refactor plan; future work should keep the
strict Chrome storage boundary test passing.

## Purpose

Refactor Unfluffify storage access so Chrome storage, IndexedDB-backed config
state, and transient transfer payloads are accessed through managed domain
stores instead of scattered raw calls. This track starts by fixing the two
review findings from the service-worker authority refactor, then continues into
the storage layer.

This document is intentionally prescriptive. A future agent should follow the
steps in order, keep commits small, and avoid inventing alternate storage or
authority patterns. If a step appears wrong, stop and update the handoff with
the contradiction before changing code.

## Review Baseline

Review date: 2026-06-10.

Reviewed commit:

1. `d286355` - merge of the service-worker authority refactor track.

Validation performed during review:

1. `npm test` passed: 707/707.
2. VS Code diagnostics reported no errors in the main refactor files inspected:
   - `background.js`
   - `popup.js`
   - `common/async-messaging.js`
   - `background/command-router.js`
   - `background/tab-runtime.js`
   - `popup/messages.js`
3. Working tree was clean after review.

Review outcome:

1. No blocking functional bug was found in the recent refactor.
2. Two hardening findings must be fixed before storage migration begins:
   - Command authority accepts caller-supplied `tabId` too broadly.
   - Command ledger payload logging can retain sensitive or oversized payload
     data when full debug logging is enabled.
3. Storage access is correct enough today, but not architecturally centralized.
   `common/utilities.js` provides Promise adapters only; it does not own schema,
   key policy, caching, batching, cleanup, or read-modify-write ordering.

## Non-Negotiable Direction

1. Service-worker command authority remains the architectural center for
   tab-scoped workflows.
2. Background command routing must declare source and tab-id trust policy per
   command.
3. Content-origin messages must not be able to spoof another tab by setting
   `message.tabId`.
4. Debug logs and ledgers must not retain raw secrets, passwords, tokens,
   cookies, authorization headers, large HTML, large config payloads, or transfer
   payload bodies.
5. Storage access must move behind small domain stores with explicit keys,
   defaults, normalization, cleanup, and tests.
6. Do not route large payload bodies through runtime messages. Continue using
   storage/cache keys or context-owned fetches for heavy remote config, AI, HTML,
   and selector payloads.
7. Do not change product behavior while migrating storage access. The first
   migration commits should be behavior-preserving wrappers.
8. Direct `chrome.storage.*` calls should eventually exist only inside approved
   storage modules, tests, orchestration scripts, or browser smoke harnesses.
9. Credentials must never be written to `.copilot`, repo memory, logs, command
   ledgers, or handoff docs.
10. Every migration phase must include a focused test command and a final full
    `npm test` before commit.

## Protected Existing Contracts

Preserve these contracts exactly while implementing this track.

1. Popup must not call `chrome.tabs.sendMessage` directly.
   - Guarded by `tests/popup-authority-boundary.test.js`.
2. Popup tab-runtime snapshots must flow through
   `POPUP_GET_TAB_VIEW_STATE`.
   - Guarded by `tests/popup-background-snapshot.test.js`.
3. Same URL in two tabs must not share runtime mode, spinner queue, lifecycle,
   page-world state, or command ledger state.
   - Guarded by `tests/tab-isolation-hardening.test.js` and
     `tests/tab-runtime.test.js`.
4. AI, remote config, rendered HTML, raw HTML, and server config payloads must
   continue to use transfer keys or storage/cache paths for heavy bodies.
5. Current page marking, silent highlighting, save/discard, render-mode
   inspection, property-lock, remote-support, and mobile-emulation contracts are
   not in scope for behavior changes.
6. Existing `common/config.js` normalization and merge semantics remain the
   source of truth for config shape unless a phase explicitly adds queued writes.

## Current Storage Map

This inventory is the starting point. Re-run `rg` before implementation because
line numbers and call sites may move.

Important current call sites:

1. Generic Promise wrappers:
   - `common/utilities.js` exposes `storageGet`, `storageSet`, and
     `storageRemove` over arbitrary storage areas.
2. Tab/session state:
   - `common/utilities.js` owns `getTabState`, `setTabState`,
     `clearTabState`, content-script injected flags, and action icon updates.
   - `background.js` also removes tab-scoped session keys during tab cleanup.
3. Device emulation:
   - `common/emulation.js` stores device emulation state in
     `chrome.storage.session`.
4. Transfer payloads:
   - `background.js` and `popup.js` store large remote config, AI, render-mode,
     and page-type assignment payloads under `remote-config-*` keys in
     `chrome.storage.session`.
5. Global settings and credentials:
   - `popup/helpers.js`, `popup.js`, `content-main.js`,
     `common/property-lock-background.js`, and `common/lynx-live-pages.js` read
     or write `globalToken`, `globalEndpoint`, `globalConfigEndpoint`, and
     `globalStageBase` in `chrome.storage.sync`.
6. Appearance settings:
   - `popup.js` stores theme and theme-mode values in `chrome.storage.sync`.
7. Config state:
   - `common/config.js` uses IndexedDB via `idbGet`, `idbSet`, and `idbRemove`
     from `common/utilities.js`.
8. Page-local flags:
   - `content-main.js`, `content-loader.js`, `content/core.js`, `popup.js`, and
     `popup/ui.js` read `localStorage` or `sessionStorage` for debug overrides,
     property-lock client identity, and reload/inspection local guards.
   - These are not Chrome storage and should be handled separately after the
     Chrome storage domains are centralized.

## Target Storage Ownership Matrix

| Concern | Target module | Storage backend | Owner | Notes |
| --- | --- | --- | --- | --- |
| Raw Chrome callback wrappers | `common/storage-core.js` | `chrome.storage.*` | Shared utility | Promise adapter only, no domain keys. |
| Global AI/config settings | `common/settings-store.js` | `chrome.storage.sync` | Domain store | Owns defaults, normalization, cache invalidation, token redaction helpers. |
| Popup appearance settings | `common/settings-store.js` | `chrome.storage.sync` | Domain store | Theme and theme mode should share the settings cache. |
| Tab state | `background/tab-session-store.js` | `chrome.storage.session` | Background | Owns `tabState:*`, scopes, normalization, cleanup. |
| Script-injected flags | `background/tab-session-store.js` | `chrome.storage.session` | Background | Replaces generic utility helpers gradually. |
| Device emulation state | `common/emulation.js` or `background/device-emulation-store.js` | `chrome.storage.session` | Existing emulation domain | Keep behavior; hide raw storage inside one module. |
| Transfer payloads | `background/transfer-payload-store.js` | `chrome.storage.session` | Background | Owns key generation, read, consume, remove, TTL sweep, size metadata. |
| Config objects | `common/config.js` | IndexedDB | Config domain | Add per-baseUrl write queue later; do not change schema first. |
| Page-local session identity | Future page-local store | `window.sessionStorage` | Content | Out of initial Chrome storage migration. |
| Debug localStorage flags | Future debug settings cleanup | `window.localStorage` | UI/content debug code | Keep as compatibility while centralizing Chrome storage. |

## Target Module APIs

The exact names below should be used unless implementation reveals a direct
conflict. If names change, update this plan and handoff in the same commit.

### `common/storage-core.js`

Purpose: low-level Promise wrappers only. No domain key strings except helper
type checks.

Exports:

```js
export function getStorageAreaName(area);
export function storageGet(area, keys);
export function storageSet(area, items);
export function storageRemove(area, keys);
export function storageClear(area);
export function isChromeStorageArea(value);
export function addStorageChangeListener(listener);
```

Rules:

1. Preserve current `runtime.lastError` rejection behavior from
   `common/utilities.js`.
2. Do not add caching here.
3. Do not normalize domain values here.
4. Keep `common/utilities.js` re-exporting these helpers during migration so old
   imports do not break.
5. Keep `chrome.storage.onChanged` listener registration inside this low-level
   boundary helper or a domain store that owns its cache invalidation.

### `common/settings-store.js`

Purpose: all `chrome.storage.sync` global settings.

Suggested constants:

```js
export const SETTINGS_KEYS = Object.freeze({
  GLOBAL_TOKEN: "globalToken",
  AI_ENDPOINT: "globalEndpoint",
  CONFIG_ENDPOINT: "globalConfigEndpoint",
  STAGE_BASE: "globalStageBase",
  THEME: "globalTheme",
  THEME_MODE: "globalThemeMode"
});
```

Exports:

```js
export async function getGlobalAiSettings(options = {});
export async function getGlobalToken(options = {});
export async function setGlobalToken(tokenValue);
export async function clearGlobalToken();
export async function setAiEndpoint(endpointValue, options = {});
export async function setConfigEndpoint(endpointValue, options = {});
export async function setStageBase(stageBaseValue, options = {});
export async function getThemeSettings();
export async function setThemeSettings(themeValue, themeModeValue);
export function redactSettingsForLog(value);
export function invalidateSettingsCache(keys = null);
export function installSettingsStorageListener();
```

Behavior requirements:

1. `getGlobalAiSettings()` returns all four current values from one
   `chrome.storage.sync.get([...])`, not four separate storage reads.
2. `getGlobalAiSettings({ cached: true })` may return cached values if the
   cache is warm and has not been invalidated.
3. Cache invalidates on `chrome.storage.onChanged` for the `sync` area.
4. Writes update the cache after successful `storageSet`.
5. Endpoint setters preserve current token-reset behavior when endpoint origin
   changes.
6. Stage-base setter preserves current normalization and token reset behavior.
7. `redactSettingsForLog` must always hide token-like values.
8. The module must not import popup UI modules.

### `background/tab-session-store.js`

Purpose: background-owned access to tab-scoped `chrome.storage.session` keys.

Exports:

```js
export function getTabStateKey(tabId, scope = null);
export function getScriptInjectedKey(tabId);
export function normalizeTabSessionState(value);
export async function getTabState(tabId, scope = null, options = {});
export async function setTabState(tabId, state, scope = null);
export async function clearTabState(tabId, options = {});
export async function clearTabStateScope(tabId, scope = null);
export async function isScriptInjected(tabId);
export async function setScriptInjected(tabId, injected);
export async function clearScriptInjected(tabId);
export async function clearTrackedTabSessionState(tabId, options = {});
export function queueTabSessionWrite(tabId, work);
```

Behavior requirements:

1. Normalize tab IDs before constructing keys.
2. Preserve current baseUrl normalization from `utils.getTabState` and
   `utils.setTabState`.
3. Preserve existing scope naming: no scope, `initial`, and `restore`.
4. Scope cleanup must not remove unrelated tab/session keys.
5. Per-tab writes must be queued so overlapping read-modify-write operations do
   not drop fields.
6. `common/utilities.js` can temporarily delegate to this module only where the
   import graph permits it. If direct import would create a cycle, keep a thin
   compatibility wrapper until call sites migrate.

### `background/transfer-payload-store.js`

Purpose: managed large-payload handoff through `chrome.storage.session`.

Exports:

```js
export const TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-";
export function buildTransferPayloadKey(scope = "payload");
export function parseTransferPayloadKey(key);
export async function putTransferPayload(scope, payload, options = {});
export async function getTransferPayload(payloadKey, options = {});
export async function consumeTransferPayload(payloadKey, options = {});
export async function removeTransferPayload(payloadKey);
export async function sweepStaleTransferPayloads(options = {});
export function summarizeTransferPayloadForLog(payload);
```

Behavior requirements:

1. Preserve current key prefix `remote-config-` so old popup/background code can
   interoperate during migration.
2. Preserve current 5 minute stale-key sweep initially.
3. `consumeTransferPayload` must read and remove in one helper call.
4. Failed reads should not silently remove valid payloads unless the caller asks
   for `removeInvalid: true`.
5. `summarizeTransferPayloadForLog` must omit bodies and report only safe shape
   metadata such as `{ type, keys, byteEstimate }`.
6. Tests must cover missing keys, invalid keys, stale sweep, consume-remove,
   and two simultaneous payloads with different keys.

### `background/command-ledger-redaction.js`

Purpose: safe payload summaries for command runtime diagnostics.

Exports:

```js
export function redactCommandPayloadForLedger(payload, options = {});
export function isSensitiveLedgerKey(key);
```

Behavior requirements:

1. Only called when debug payload logging is enabled.
2. Recursively clone plain objects up to a bounded depth.
3. Redact keys matching, case-insensitively:
   - `token`
   - `password`
   - `secret`
   - `authorization`
   - `cookie`
   - `jwt`
   - `payloadKey`
4. Omit or summarize large-body keys matching, case-insensitively:
   - `html`
   - `rawHtml`
   - `renderedHtml`
   - `pageMarkings`
   - `pages`
   - `config`
   - `payload`
5. Cap strings to a safe length, for example 200 characters.
6. Cap arrays to a safe length, for example 20 entries plus an omitted count.
7. Return only JSON-serializable values.

## Phase 0: Baseline And Branch Setup

Goal: start from a clean, current baseline.

Steps:

1. Confirm branch and tree:
   - `git status --short`
   - `git rev-parse --abbrev-ref HEAD`
2. Fetch and fast-forward before implementation:
   - `git fetch origin`
   - `git pull --ff-only`
3. Create the implementation branch:
   - `git switch -c refactor/storage-access-layer`
4. Install dependencies if needed:
   - `npm ci`
5. Run baseline tests:
   - `npm test`
6. Run focused authority/storage discovery commands:
   - `rg -n --glob '!.tmp/**' 'chrome\.storage|utils\.storage(Get|Set|Remove|Clear)|localStorage|sessionStorage|storage\.onChanged' .`
   - `rg -n --glob '!.tmp/**' 'registerBackgroundCommand|dispatchBackgroundCommand|getMessageTabId|maybeGetCommandPayloadForLedger' background.js background/command-router.js background/tab-runtime.js`
7. If any baseline test fails before edits, stop and update
   `.copilot/handoff-storage-access-layer.md` before implementation.

Commit expectation:

1. No code commit is required for Phase 0 unless documentation is updated.
2. Suggested message if documentation changes:
   - `docs(storage): record baseline before access-layer work`

## Phase 1: Harden Background Command Source And Tab Policy

Goal: fix review finding 1 before storage work. Command handlers must declare
which sources may call them and how tab IDs are trusted.

Files to edit:

1. `background/command-router.js`
2. `background.js`
3. `tests/background-command-router.test.js`
4. `tests/tab-isolation-hardening.test.js`
5. Add `tests/background-command-source-policy.test.js` if the existing tests
   become crowded.

Implementation steps:

1. Extend command registration to accept options:

```js
registerBackgroundCommand(type, handler, {
  allowedSources: ["popup"],
  tabIdPolicy: "message",
  requireTab: true
});
```

2. Preserve compatibility by allowing `registerBackgroundCommand(type, handler)`
   to default to the existing popup/background command behavior:
   - `allowedSources: ["popup", "background"]`
   - `tabIdPolicy: "message-or-sender"`
   - `requireTab: false`
3. Add explicit option values:
   - `tabIdPolicy: "message"`: use normalized `message.tabId` only.
   - `tabIdPolicy: "sender"`: use normalized `sender.tab.id` only.
   - `tabIdPolicy: "message-or-sender"`: use message tabId first, then sender tabId.
   - `tabIdPolicy: "sender-or-message"`: use sender tabId first, then message tabId.
   - `tabIdPolicy: "none"`: command is not tab-scoped.
4. Add a resolver in `background/command-router.js`:

```js
export function resolveBackgroundCommandRoute(message, sender, registration) {
  return {
    ok: true,
    source,
    tabId,
    frameId,
    tabIdSource,
    policy
  };
}
```

5. The resolver must reject:
   - invalid envelope
   - unregistered command
   - source not in `allowedSources`
   - missing tab when `requireTab` is true
   - content/page source attempting to use `message.tabId` under a sender-only
     policy
6. Add `source`, `tabIdSource`, and `policy` fields to command context.
7. Update all current background command registrations in `background.js` to be
   explicit. Use these policies unless a code read proves otherwise:
   - `TAB_BOOTSTRAP_CONTENT`: popup, message, require tab.
   - `TAB_CONTENT_REQUEST`: popup, message, require tab.
   - `POPUP_GET_TAB_VIEW_STATE`: popup, message, require tab.
   - `TAB_ACTIVATE_MARKING`: popup, message, require tab.
   - `TAB_DEACTIVATE_MARKING`: popup, message, require tab.
   - `TAB_APPLY_POST_SAVE_TRANSITION`: popup, message, require tab.
   - `TAB_APPLY_LOCAL_DISCARD`: popup, message, require tab.
   - `TAB_SHOW_AI_PREVIEW`: popup, message, require tab.
   - `TAB_CLOSE_AI_PREVIEW`: popup, message, require tab.
   - `TAB_SET_AI_PREVIEW_EXPANDED_MODE`: popup, message, require tab.
   - `TAB_FOCUS_PREVIEW_ELEMENT`: popup, message, require tab.
   - `TAB_BEGIN_RENDER_MODE_INSPECTION`: popup, message, require tab.
   - `TAB_RUN_REVEAL_FREEZE`: popup/background, message, require tab.
   - `TAB_CAPTURE_RENDER_MODE_HTML`: popup/background, message, require tab.
   - `TAB_END_RENDER_MODE_INSPECTION`: popup/background, message, require tab.
   - `TAB_RUN_RENDER_MODE_INSPECTION`: popup, message, require tab.
   - `TAB_RUN_AI`: popup, message, require tab.
8. Update `handleBackgroundCommandEnvelope` so ledger recording uses the
   resolved command context tab ID, not `getMessageTabId(message, sender)`.
   One acceptable shape:

```js
const dispatch = dispatchBackgroundCommand(message, sender, options);
dispatch.then(({ reply, context }) => {
  recordBackgroundCommandLedger(context, reply, startedAt);
  sendResponse(reply);
});
```

   If changing the return shape is too disruptive, add a new helper
   `dispatchBackgroundCommandWithContext` and keep old `dispatchBackgroundCommand`
   returning only the reply for existing tests.
9. Keep popup debug-tab behavior working. A popup request for tab 9502 while the
   popup sender tab is 9501 must still resolve tab 9502 when the command policy
   is `source: popup`, `tabIdPolicy: message`.
10. Add tests:
   - Popup source may target the requested tab for `POPUP_GET_TAB_VIEW_STATE`.
   - Content source with sender tab 1 and message tab 2 is routed to sender tab
     1 for a sender-policy command.
   - Content source with no sender tab fails a sender-policy tab command.
   - Content source is rejected for popup-only commands.
   - Missing source or invalid source returns `invalid_message` or
     `handler_failed` with a deterministic code documented in the test.
   - Ledger entry is recorded under the resolved tab, not a spoofed
     `message.tabId`.

Validation commands:

1. `node --test tests/background-command-router.test.js tests/tab-isolation-hardening.test.js tests/background-command-source-policy.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `fix(background): enforce command source tab policy`

## Phase 2: Redact Command Ledger Payloads

Goal: fix review finding 2. Debug command ledgers may keep useful shape data,
but they must never retain raw secrets or large bodies.

Files to edit:

1. Add `background/command-ledger-redaction.js`.
2. Edit `background.js`.
3. Edit `background/tab-runtime.js` only if payload normalization belongs there
   after a code read.
4. Add `tests/command-ledger-redaction.test.js`.
5. Update `tests/background-command-router.test.js` or `tests/tab-runtime.test.js`
   if they assert payload shape.

Implementation steps:

1. Add `redactCommandPayloadForLedger(payload, options = {})` as described in
   the target API section.
2. Replace `maybeGetCommandPayloadForLedger` in `background.js` so it returns:
   - `undefined` when `fullWorldMessagingLogging` is disabled.
   - a redacted summary when enabled.
3. Make the redactor defensive:
   - handle circular references by returning `"[circular]"`
   - handle functions as `"[function]"`
   - handle `undefined` as omitted fields in objects
   - cap depth and array length
4. Add a small `byteEstimate` helper only for summaries if needed. Do not
   serialize huge bodies repeatedly in hot paths.
5. Redact these examples exactly in tests:

```js
{
  tokenValue: "abc",
  globalToken: "abc",
   ["password"]: "<placeholder-password>",
  headers: { Authorization: "Bearer abc", Cookie: "x=y" },
  payloadKey: "remote-config-save-request:123:abc",
  renderedHtml: "<html>...",
  pages: [{ rawHtml: "..." }]
}
```

Expected redacted values may be strings such as `"[redacted]"` and
`"[omitted]"`; choose one convention and test it.

6. Keep command ledger capped at 50 entries per tab.
7. Do not remove the ability to inspect command type, duration, status, error
   code, and small non-sensitive scalar metadata.

Validation commands:

1. `node --test tests/command-ledger-redaction.test.js tests/tab-runtime.test.js tests/background-command-router.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `fix(background): redact command ledger payloads`

## Phase 3: Add Storage Access Inventory Guard

Goal: lock the current storage surface before migrating it. This makes the
remaining work measurable and prevents new raw storage access while the refactor
is in progress.

Files to add or edit:

1. Add `tests/storage-access-boundary.test.js`.
2. Add or update `.copilot/handoff-storage-access-layer.md` with the current
   inventory output.

Implementation steps:

1. The test should recursively scan JavaScript files excluding:
   - `.tmp/**`
   - `node_modules/**`
   - `tests/**` unless the test explicitly allows test fixtures
   - `orchestration/**`
   - `scripts/**`
2. Initially classify raw access into allowlist buckets instead of failing all
   current call sites.
3. Use comments in the test to explain each bucket:
   - approved wrapper modules
   - current migration debt
   - page-local storage flags
   - smoke/orchestration access
4. Assert that every raw storage call appears in exactly one bucket.
5. Add a TODO list in the test, ordered by migration phase, so deleting a bucket
   is straightforward.
6. The test should fail if a new raw `chrome.storage` call appears outside the
   allowlist.
7. The test should separately track `localStorage` and `sessionStorage` calls,
   but do not force their removal in the first Chrome storage track.

Validation commands:

1. `node --test tests/storage-access-boundary.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `test(storage): guard raw storage access inventory`

## Phase 4: Extract Low-Level Storage Core

Goal: move raw Chrome storage Promise adapters out of `common/utilities.js`
without changing call-site behavior.

Files to add or edit:

1. Add `common/storage-core.js`.
2. Edit `common/utilities.js` to import and re-export wrappers.
3. Add `tests/storage-core.test.js` or extend `tests/utilities-runtime.test.js`.
4. Update `tests/storage-access-boundary.test.js` allowlist.

Implementation steps:

1. Copy current `storageGet`, `storageSet`, and `storageRemove` behavior from
   `common/utilities.js` into `common/storage-core.js`.
2. Keep lastError behavior identical.
3. Re-export from `common/utilities.js`:

```js
export { storageGet, storageSet, storageRemove } from "./storage-core.js";
```

4. Do not change any call site in this phase except imports needed for tests.
5. Add tests for:
   - get success
   - set success
   - remove success
   - lastError rejection
   - thrown storage call rejection
   - extension-context invalidated message still rejects consistently
6. Update storage boundary test so `common/storage-core.js` is the only approved
   raw Chrome storage wrapper file for these generic calls.

Validation commands:

1. `node --test tests/storage-core.test.js tests/utilities-runtime.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): extract chrome storage core wrappers`

## Phase 5: Transfer Payload Store

Goal: centralize `remote-config-*` session payload keys and lifecycle before
moving settings or tab state.

Files to add or edit:

1. Add `background/transfer-payload-store.js`.
2. Edit `background.js` transfer payload helper functions.
3. Edit `popup.js` only where it creates or consumes transfer payloads and can
   safely use a background command or helper without creating import cycles.
4. Add `tests/transfer-payload-store.test.js`.
5. Update `tests/storage-access-boundary.test.js`.

Implementation steps:

1. Move these concepts out of `background.js`:
   - `TRANSFER_PAYLOAD_KEY_PREFIX`
   - `TRANSFER_PAYLOAD_MAX_AGE_MS`
   - `buildRemoteConfigPayloadKey`
   - `sweepStaleTransferPayloads`
2. Keep exported compatibility aliases if old names are still referenced during
   migration.
3. Replace background reads like this:

```js
const payload = await consumeTransferPayload(requestPayloadKey, {
  expectedType: "object"
});
```

4. Use `getTransferPayload` only when a caller must read without removing.
5. Use `consumeTransferPayload` for AI result, save response, render-mode
   response, and any one-shot payload.
6. Keep popup-created payload keys compatible until popup writes are migrated.
7. Add result objects with deterministic reasons:
   - `missing_key`
   - `not_found`
   - `invalid_payload`
   - `storage_failed`
8. Add tests:
   - key format parse
   - put/read/remove
   - consume removes after successful read
   - consume missing returns deterministic failure
   - stale sweep removes old keys only
   - non-transfer session keys survive sweep
9. Do not change the 5 minute TTL unless a test or product requirement demands
   it.

Validation commands:

1. `node --test tests/transfer-payload-store.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/render-mode-inspection-order.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): centralize transfer payload store`

## Phase 6: Settings Store Read Path

Goal: centralize reads for global settings and reduce repeated sync-storage
round trips.

Files to add or edit:

1. Add `common/settings-store.js`.
2. Edit `popup/helpers.js` first.
3. Edit `content-main.js` settings reads after popup helper tests pass.
4. Edit `common/property-lock-background.js` settings reads.
5. Edit `tests/storage-access-boundary.test.js`.
6. Add `tests/settings-store.test.js`.

Implementation steps:

1. Implement `getGlobalAiSettings()` as one batched `storageGet` call for:
   - `globalToken`
   - `globalEndpoint`
   - `globalConfigEndpoint`
   - `globalStageBase`
2. Preserve current return shape used by `popup/helpers.js`:

```js
{
  tokenValue: "",
  endpointValue: "",
  configEndpointValue: "",
  stageBaseValue: ""
}
```

3. Replace `popup/helpers.js::loadGlobalAiSettings()` with a delegation to the
   settings store.
4. Replace `content-main.js::loadGlobalAiSettingsForContent()` with the same
   store read. Do not change content behavior yet.
5. Replace property-lock background settings read with the same store read or a
   narrower `getPropertyLockConnectionSettings()` helper if that keeps call-site
   intent clearer.
6. Add optional cache support only after uncached read tests pass.
7. If cache is added in this phase:
   - install one `chrome.storage.onChanged` listener per context
   - invalidate only changed keys
   - update cache after writes
   - provide `invalidateSettingsCache()` for tests
8. Add tests:
   - reads all global settings in one storage call
   - normalizes missing values to empty strings
   - cache returns warm values when enabled
   - onChanged invalidates sync keys
   - redaction hides token values

Validation commands:

1. `node --test tests/settings-store.test.js tests/popup-marking-refresh.test.js tests/property-lock.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): add global settings store`

## Phase 7: Settings Store Write Path

Goal: move global settings writes behind the settings store while preserving
token-reset behavior and UI semantics.

Files to edit:

1. `popup.js`
2. `common/lynx-live-pages.js`
3. `common/settings-store.js`
4. `tests/settings-store.test.js`
5. Existing popup/config tests that cover endpoint changes and login.

Implementation steps:

1. Move theme read/write helpers from `popup.js` into `common/settings-store.js`
   if they use `chrome.storage.sync` keys.
2. Replace endpoint setters in `popup.js`:
   - `handleConfigEndpointSet`
   - `handleEndpointSet`
   - `handleStageBaseSet`
3. Store setters must preserve the existing rule:
   - if endpoint origin changes and token exists, clear token
   - if stage base changes and token exists, clear token
4. Replace login token persistence in `popup.js` with `setGlobalToken` or a
   combined `saveLoginSettings({ stageBase, token })` helper.
5. Replace logout token clearing with `clearGlobalToken`.
6. Replace `maybeUpdateStoredTokenFromResponse` write in
   `common/lynx-live-pages.js` with the settings store helper.
7. Keep UI refresh and toast behavior in `popup.js`; do not move UI logic into
   the settings store.
8. Add tests:
   - config endpoint same origin preserves token
   - config endpoint changed origin clears token
   - AI endpoint changed origin clears token
   - stage base change clears token
   - theme settings normalize to existing defaults
   - login write stores stage base and token
   - logout clears only token, not endpoints

Validation commands:

1. `node --test tests/settings-store.test.js tests/popup-marking-refresh.test.js tests/feature-flags.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): route global settings writes through store`

## Phase 8: Background-Owned Credentials For Network Commands

Goal: reduce token passing through popup/content runtime messages. Background
network handlers should read credentials from the settings store unless an
explicit override is required.

Files to edit:

1. `background.js`
2. `popup.js`
3. `popup/messages.js` if command payloads can shrink.
4. `content-main.js` only for content-origin credential reads.
5. `tests/ai-run.test.js`
6. Remote config, auth, and live-page tests.

Implementation steps:

1. Inventory all runtime messages carrying `tokenValue`:
   - auth validation
   - login
   - remote config load/save
   - selector update
   - page type assignments
   - AI start/status/result
   - property-lock and live-page lookups
2. Classify each message:
   - `requires_user_input_secret`: login password remains popup-provided for the
     login request only.
   - `can_read_background_settings`: background reads token/endpoints itself.
   - `requires_explicit_override`: tests or manual operations may pass an
     override payload.
3. Start with AI run command `TAB_RUN_AI`:
   - Popup sends page/base/render-mode/site intent, not `tokenValue`.
   - Background reads `endpointValue` and `tokenValue` via settings store.
   - Keep an optional test-only override if needed, but gate and redact it.
4. Then migrate remote config load/save:
   - Popup sends siteId and payloadKey only.
   - Background reads config endpoint and token.
5. Then migrate live-page and page-type assignment calls.
6. Do not move login password into storage. Login still accepts password from
   popup for the immediate request and never persists password.
7. Update command ledger redaction tests to prove token no longer appears in
   common command payloads.
8. Add tests that background handlers call settings store when token is omitted.

Validation commands:

1. `node --test tests/ai-run.test.js tests/popup-ai-run-gating.test.js tests/popup-marking-refresh.test.js tests/settings-store.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(background): read credentials from settings store`

## Phase 9: Tab Session Store

Goal: centralize tab-scoped session state and script-injected flags.

Files to add or edit:

1. Add `background/tab-session-store.js`.
2. Edit `common/utilities.js` compatibility helpers.
3. Edit `background.js` tab cleanup and tab-state call sites.
4. Edit `common/emulation.js` only if moving device state in this phase is safe;
   otherwise leave it to Phase 10.
5. Add `tests/tab-session-store.test.js`.
6. Update `tests/storage-access-boundary.test.js`.

Implementation steps:

1. Move key construction and normalization for:
   - `tabState:<tabId>`
   - `tabState:initial:<tabId>`
   - `tabState:restore:<tabId>`
   - `scriptInjected:<tabId>`
2. Preserve existing public behavior of:
   - `utils.getTabState`
   - `utils.setTabState`
   - `utils.clearTabState`
   - `utils.isScriptInjected`
   - `utils.injectContentScript`
3. Add per-tab write queue:

```js
const tabSessionWriteQueueByTabId = new Map();
export function queueTabSessionWrite(tabId, work) { ... }
```

4. Use the queue for read-modify-write operations such as `setTabState` when it
   merges existing state.
5. Ensure `clearTrackedTabSessionState` removes only the target tab keys.
6. Replace the direct `chrome.storage.session.set` in the debugger detach path
   with the device/session store helper or `storage-core` wrapper.
7. Keep `chrome.storage.onChanged` action-icon listener working, but consider
   moving key parsing into the tab session store:

```js
export function parseTabStateStorageKey(key) { ... }
```

8. Add tests:
   - key construction for scopes
   - baseUrl normalization
   - set/get/clear no-scope state
   - set/get/clear initial scope
   - clearing tab 1 does not remove tab 2
   - queued writes preserve independent fields
   - script-injected flag set/clear

Validation commands:

1. `node --test tests/tab-session-store.test.js tests/device-emulation-lifecycle.test.js tests/background-marking-activation.test.js tests/tab-isolation-hardening.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): centralize tab session state`

## Phase 10: Device Emulation Storage Boundary

Goal: hide device emulation session storage behind its domain and remove raw
session storage writes from background paths.

Files to edit:

1. `common/emulation.js`
2. `background.js`
3. `tests/device-emulation-lifecycle.test.js`
4. `tests/storage-access-boundary.test.js`

Implementation steps:

1. Keep device emulation state in `common/emulation.js` unless an import cycle
   forces a new module.
2. Add explicit helper if missing:

```js
export async function setDeviceEmulationEnabled(tabId, enabled);
export async function clearDeviceEmulationState(tabId);
```

3. Replace background direct storage writes for device emulation with those
   helpers.
4. Ensure existing operation queue in `common/emulation.js` still serializes
   debugger operations.
5. Add tests for direct helper behavior and debugger detach behavior.

Validation commands:

1. `node --test tests/device-emulation-lifecycle.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `refactor(storage): isolate device emulation state`

## Phase 11: Config Store Write Queue

Goal: improve the existing IndexedDB config store by preventing concurrent
read-modify-write losses without changing config schema or marking semantics.

Files to edit:

1. `common/config.js`
2. Existing config/marking tests.
3. Add `tests/config-store-queue.test.js` if no existing test fits.

Implementation steps:

1. Add an internal queue by normalized base URL:

```js
const configWriteQueueByBaseUrl = new Map();
function queueConfigWrite(baseUrl, work) { ... }
```

2. Use the queue in `updateConfig(baseUrl, updater)`.
3. Keep `getConfigs`, `saveConfigs`, and `ensureConfig` behavior unchanged at
   first.
4. If `ensureConfig` writes defaults, ensure concurrent default creation does
   not overwrite a newer queued update.
5. Add tests:
   - two concurrent `updateConfig` calls on the same base URL preserve both
     changes
   - concurrent updates on different base URLs do not block each other longer
     than necessary
   - normalization/merge tests still pass
6. Do not alter page-marking merge precedence or timestamp behavior.

Validation commands:

1. `node --test tests/config-store-queue.test.js tests/selector-suppression.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js`
2. `npm test`

Commit expectation:

1. Suggested message:
   - `fix(config): queue per-property config writes`

## Phase 12: Remove Remaining Raw Chrome Storage Debt

Goal: make the boundary test strict for Chrome storage.

Files to edit:

1. Remaining files reported by `tests/storage-access-boundary.test.js`.
2. Storage modules created in previous phases.
3. `.copilot/handoff-storage-access-layer.md`.

Implementation steps:

1. Run:
   - `rg -n --glob '!.tmp/**' 'chrome\.storage|utils\.storage(Get|Set|Remove|Clear)|storage\.onChanged' .`
2. For each remaining raw call, classify:
   - approved storage module
   - test fixture
   - orchestration/smoke harness
   - real migration debt
3. Migrate any real debt to the correct store.
4. Tighten `tests/storage-access-boundary.test.js` so real source files fail on
   raw `chrome.storage.*` outside approved modules.
5. Keep separate tracking for `localStorage` and `sessionStorage`; do not fail
   page-local calls in this Chrome storage phase unless the user asks.
6. Update `README.md` architecture notes only if the storage layer is now a
   stable developer-facing contract.
7. Update `.copilot/knowledge.md` with one short architecture decision if the
   storage layer is complete.

Validation commands:

1. `node --test tests/storage-access-boundary.test.js tests/settings-store.test.js tests/transfer-payload-store.test.js tests/tab-session-store.test.js`
2. `npm test`
3. `git status --short`

Commit expectation:

1. Suggested message:
   - `refactor(storage): enforce managed storage boundaries`

## Commit Slicing Rules

Use these commit boundaries. Do not combine unrelated phases unless the diff is
tiny and tests make the boundary obvious.

1. Phase 1: command source/tab policy fix.
2. Phase 2: ledger redaction fix.
3. Phase 3: inventory guard only.
4. Phase 4: low-level storage core extraction only.
5. Phase 5: transfer payload store.
6. Phase 6: settings read store.
7. Phase 7: settings write migration.
8. Phase 8: background credential ownership.
9. Phase 9: tab session store.
10. Phase 10: device emulation storage isolation.
11. Phase 11: config write queue.
12. Phase 12: strict boundary cleanup.

Each implementation commit must include:

1. Focused tests for the phase.
2. `npm test` unless explicitly documented as infeasible.
3. Handoff update with:
   - files changed
   - tests run
   - current phase status
   - next exact command for a future implementer

## Source Search Commands

Use these when resuming or auditing progress.

```bash
rg -n --glob '!.tmp/**' 'chrome\.storage|utils\.storage(Get|Set|Remove|Clear)|storage\.onChanged' .
rg -n --glob '!.tmp/**' 'localStorage|sessionStorage' .
rg -n --glob '!.tmp/**' 'globalToken|globalEndpoint|globalConfigEndpoint|globalStageBase|tokenValue|password' .
rg -n --glob '!.tmp/**' 'remote-config-|payloadKey|buildRemoteConfigPayloadKey|sweepStaleTransferPayloads' .
rg -n --glob '!.tmp/**' 'getTabState|setTabState|clearTabState|SCRIPT_INJECTED_PREFIX|TAB_STATE_PREFIX' .
```

## Definition Of Done

This track is complete when all of these are true:

1. Command router enforces source and tab-id policy per registered command.
2. Command ledger payloads are redacted/summarized when debug payload logging is
   enabled.
3. Raw Chrome storage wrappers live in `common/storage-core.js`.
4. Global settings reads and writes live in `common/settings-store.js`.
5. Transfer payload lifecycle lives in `background/transfer-payload-store.js`.
6. Tab session state lives in `background/tab-session-store.js` or an equivalent
   approved domain store.
7. Device emulation storage is hidden behind its domain helpers.
8. Config store read-modify-write operations are queued per base URL.
9. Storage boundary tests fail on new unmanaged raw `chrome.storage` access in
   real source files.
10. `npm test` passes.
11. `.copilot/handoff-storage-access-layer.md` records final phase completion
    and any residual out-of-scope page-local storage items.
