# World Decomposition Program

Last updated: 2026-06-10
Status: READY FOR IMPLEMENTATION
Scope: architectural refactor plan only. No implementation has started in this
document commit.

## Program Objective

Decompose the three remaining monoliths into small, single-responsibility
modules, behavior-preservingly, plus a bounded set of hardening slices. This is
the successor program to the completed storage-access-layer refactor. The
cross-world messaging/authority layer and the storage layer are already
modularized and are NOT in scope.

The program has three tracks. Implement them strictly in this order; each track
is gated on the previous track being complete and merged:

| Track | Target monolith(s) | Size | Risk | Why this order |
| --- | --- | --- | --- | --- |
| A. Background | `background.js` | ~4.8k | Low | Smallest, cleanest seams, no marking contract, fully live-validatable on the bonliva fixture |
| B. Popup | `popup.js` (+ `popup/ui.js`) | ~9.4k (+3k) | Medium | Messaging already centralized, shared `state` singleton exists, fully live-validatable on the bonliva fixture |
| C. Content | `content-main.js` (+ `content/core.js`) | ~9.5k (+11.5k) | High | Carries the LOCKED marking contract; only peripheral domains may move; live validation often needs remote-support / property-lock scenarios |

Each track lists its own phases, with exact functions to move, the module each
becomes, tests to create, tests to update, validation, and the exact commit
message.

Track A starts at "## Phase 0" below. Track B starts at "# TRACK B — POPUP
WORLD". Track C starts at "# TRACK C — CONTENT WORLD".

## Program-Wide Shared Rules

The following sections are written once under Track A but apply to ALL THREE
tracks unless a track explicitly overrides them: "How To Use This Document",
"Non-Negotiable Direction", "Established Module Pattern", "Per-Slice Procedure",
"Live-Harness Validation Procedure", and "Commit Slicing Rules". Tracks B and C
add their own module pattern, inventory, phases, and definition of done on top of
these shared rules. The ONE permanent, program-wide invariant is: never edit the
locked marking / silent-highlight / visibility / reconciliation logic or
`content/core.js`, in any track.

# TRACK A — BACKGROUND WORLD

## Track A Objective

Decompose the `background.js` service-worker monolith (~4808 lines) into small,
single-responsibility modules under `background/`, following the pattern already
used by `background/command-router.js`, `background/tab-runtime.js`,
`background/tab-session-store.js`, `background/spinner-operations.js`,
`background/transfer-payload-store.js`, and `background/ai-run-record-store.js`.

This is a behavior-preserving extraction track plus a small, bounded set of
hardening slices (async error reporting, per-tab state consolidation, managed
timeouts).

## How To Use This Document

This plan is intentionally prescriptive. Implement it exactly. Do not redesign,
re-group, rename, or reorder anything. For every slice:

1. Read the named source ranges first.
2. Move the exact function list named in the slice. Do not change the function
   bodies except for import statements they require.
3. Wire the new module back into `background.js` (re-import; call sites stay
   identical).
4. Update the named tests. Add the named new tests.
5. Run the focused validation, then the full validation, then the live-harness
   validation.
6. Update the handoff, commit with the exact message, and push.

If any step does not match what you see in the source (a function moved, a name
differs, a test is missing), STOP and update
`.copilot/handoff-world-decomposition.md` with the discrepancy before
changing code. Do not guess.

Line numbers in this document are anchors captured on 2026-06-10 and will drift
as functions are removed from `background.js`. Always anchor on the exact
function name, and re-run the grep in "Source Search Commands" before editing.

## Non-Negotiable Direction

1. Behavior-preserving only. Do not change runtime behavior, message contracts,
   command names, envelope shapes, network request/response shapes, timeouts,
   retry counts, or storage keys. The first commit of every slice must be a pure
   move plus wiring.
2. HARD PROHIBITION (program-wide): never edit the locked marking/silent-
   highlight/visibility/reconciliation logic, and never edit `content/core.js`,
   in any track. Per-track file scope: Track A edits only `background.js`, files
   under `background/`, and `tests/`. Track B edits only `popup.js`, files under
   `popup/`, and `tests/`. Track C edits only `content-main.js`, the explicitly
   allowed peripheral `content/*` modules it creates, `manifest.json`
   (web_accessible_resources), and `tests/`. If a slice appears to require
   editing a file outside its track scope, or any off-limits marking/visibility
   code, STOP and report.
3. One domain per slice. One commit per slice. Keep diffs reviewable.
4. Every slice must pass, in order: focused `node --test`, full `npm test`, and
   the live-harness validation in "Live-Harness Validation Procedure". A slice is
   not done until all three pass and the handoff is updated.
5. Module conventions (see "Established Module Pattern"):
   - Stateless domains (pure helpers, network calls) become a module that
     exports plain functions.
   - Stateful domains (those that read/write the per-tab `Map`s declared at the
     top of `background.js`) become a factory `createXxx(options)` that receives
     the `Map`s and callback hooks as injected dependencies, mirroring
     `createSpinnerOperations` in `background/spinner-operations.js`.
     `background.js` keeps owning the `Map` instances and wires them in.
6. Do not weaken command source/tab policy (`background/command-router.js`) or
   command-ledger redaction. Do not log or persist tokens, passwords, or other
   credentials.
7. Source-contract tests pin exact import shapes and source regexes. When a
   function moves out of `background.js`, the tests that assert its presence in
   `background.js` source WILL fail. Update them in the same slice. After adding
   an imported symbol to a file, update that file's import-shape assertion too,
   or tests fall into an orphaned-reference state.
8. Do not introduce circular imports. If moving a function would require module A
   to import module B while B already imports A, STOP and report; do not invent a
   new shared module to break the cycle without updating this plan first.

## Protected Existing Contracts

Preserve these exactly. Each is guarded by a test that reads `background.js` (or a
`background/` module) source; keep the guarded behavior true after every slice.

1. Popup must not call `chrome.tabs.sendMessage` directly
   (`tests/popup-authority-boundary.test.js`).
2. Popup tab snapshots flow through `POPUP_GET_TAB_VIEW_STATE`
   (`tests/popup-background-snapshot.test.js`).
3. Same URL in two tabs must not share runtime, spinner, lifecycle, or ledger
   state (`tests/tab-isolation-hardening.test.js`, `tests/tab-runtime.test.js`).
4. Command source/tab policy is enforced per command
   (`tests/background-command-router.test.js`,
   `tests/background-command-hardening.test.js`).
5. Command ledger payloads are redacted when full logging is enabled
   (`tests/background-command-hardening.test.js`).
6. Marking activation, device emulation, render-mode inspection, AI run gating,
   remote support routing, and property-lock routing keep their current behavior
   (`tests/background-marking-activation.test.js`,
   `tests/device-emulation-lifecycle.test.js`,
   `tests/background-render-mode-inspection.test.js`,
   `tests/render-mode-inspection-order.test.js`, `tests/ai-run.test.js`,
   `tests/popup-ai-run-gating.test.js`,
   `tests/background-remote-support-routing.test.js`,
   `tests/property-lock-background.test.js`,
   `tests/world-trace-contract.test.js`, `tests/lifecycle-broker.test.js`).
7. Chrome storage access stays inside approved storage/domain modules
   (`tests/storage-access-boundary.test.js`). New `background/` modules that
   touch `chrome.storage` directly are not allowed; route through the existing
   stores (`tab-session-store`, `transfer-payload-store`, `ai-run-record-store`,
   `storage-core`, `settings-store`).

Find every test that pins `background.js` source before starting a slice:

```bash
rg -n 'readFileSync\(new URL\("\.\./background\.js"' tests
```

## Established Module Pattern

### Pattern A: stateless module (pure helpers / network)

```js
// background/<name>.js
import { /* only what the moved functions use */ } from "../common/...";

export function movedHelperA(...) { /* body unchanged */ }
export async function movedNetworkB(...) { /* body unchanged */ }
```

`background.js`:

```js
import { movedHelperA, movedNetworkB } from "./background/<name>.js";
// call sites unchanged
```

### Pattern B: stateful factory module (reads/writes per-tab Maps)

Mirror `createSpinnerOperations`. The module owns no module-level mutable state;
the caller injects the `Map`s and hook callbacks.

```js
// background/<name>.js
export function createXxx(options = {}) {
  const stateByTabId = options.stateByTabId instanceof Map ? options.stateByTabId : new Map();
  const normalizeTabId = typeof options.normalizeTabId === "function" ? options.normalizeTabId : defaultNormalizeTabId;
  const appendTrace = typeof options.appendTrace === "function" ? options.appendTrace : () => {};
  // ...other injected hooks...

  function movedFnA(...) { /* body unchanged, using stateByTabId/hooks */ }
  function movedFnB(...) { /* ... */ }

  return { movedFnA, movedFnB };
}
```

`background.js` keeps the `Map` declarations and wires the factory:

```js
const xxx = createXxx({
  stateByTabId: tabWorldTraceStateByTabId,
  normalizeTabId: normalizeBrokerTabId,
  appendTrace: appendWorldTraceEvent
});
// then call xxx.movedFnA(...) where the inline function used to be called,
// or re-expose: const movedFnA = xxx.movedFnA;
```

When in doubt about a stateful module's shape, open
`background/spinner-operations.js` and copy its structure exactly.

## Current background.js Domain Inventory

Captured 2026-06-10. Re-grep before editing. Grouped by the module each domain
will become.

Top-of-file per-tab state (declared ~lines 164-170), owned by `background.js`,
injected into factory modules:

```
tabLifecycleStateByTabId, tabSpinnerQueueByTabId, popupStatePortsByTabId,
tabWorldTraceStateByTabId, aiComputeLockExpiresAtByTabId,
pageMotionFreezeControlQueueByTarget, WORLD_TRACE_EVENT_LIMIT (=160)
```

| Domain (future module) | Functions (anchor names) | ~Lines |
| --- | --- | --- |
| command-ledger | `looksLikeJwtToken`, `summarizeLargeString`, `redactCommandPayloadValueForLedger`, `redactCommandPayloadForLedger` (+ `LEDGER_*` consts) | 1843-1911 |
| live-page-client | `resolveLivePageSiteId`, `normalizeBaseUrlFromDomainName`, `buildPropertyPageTypesSignature`, `fetchLivePagePropertyPageTypes` | 3464-3663 |
| network-core | `resolveBackgroundEndpoint`, `createBackgroundJsonHeaders`, `resolveBackgroundNetworkCredentials`, `buildValidateEndpointFromStageBase`, `buildLoginEndpointFromStageBase`, `validateAuthToken`, `requestAuthLogin` | 2085-2258 |
| remote-network | `requestAiRunStatus`, `removeRemotePageMarking`, `submitSelectorSetGraphqlUpdate` (+ `UPDATE_SCRAPING_CONDITIONS_MUTATION`), `loadRemoteConfigSnapshot`, `saveRemoteConfigSnapshot`, `requestRenderModeDetection`, `submitPageTypeAssignments`, `requestAiRunStartSnapshot`, `requestAiRunResultSnapshot`, `fetchStaticPageHtmlForBackground` | 2142-2884 |
| remote-config-sync | `collectStoredPageMarkingItems`, `mergeSelectorsIntoConfig`, `getRemoteManagedConfigSignature`, `getNormalizedPageEntrySignature`, `replaceServerConfigIntoLocalSnapshot`, `mergeServerConfigIntoLocalSnapshot`, `preparePageTypeAssignmentsSnapshot` | 2306-3065 |
| world-trace | `ensureTraceState`, `isWorldTraceEnabled`, `appendWorldTraceEvent` (+ `WORLD_TRACE_EVENT_LIMIT`) | 3066-3117 |
| popup-state-broker | `getSpinnerQueueForTab`, `serializeSpinnerQueue`, `buildBrokerState`, `broadcastBrokerState`, `updateLifecycleState`, `clearNavInspectCurtain` + `chrome.runtime.onConnect` port registry | 3255-3464 |
| render-mode-inspector | `normalizeRenderModeOperationId`, `waitForTabLoadStartInBackground`, `waitForTabLoadCompleteInBackground`, `ensureContentReadyForRenderModeInspectionInBackground`, `sendRenderModeInspectionEndWithRetry`, `runRenderModeInspectionBeginStep`, `runRenderModeRevealFreezeStep`, `runRenderModeCaptureHtmlStep` | 401-606 |
| ai-run-orchestrator | `getAiRunCurrentPageEntry`, `isAiRunCurrentPageSnapshotMissing`, `refineAiRunPayloadXpathsInBackground`, `loadAiRunSelectorSetFromPayloadKey`, `runAiCommandForTab`, `setAiComputeLockForTab`, `isAiComputeLockActiveForTab`, `refreshAiRunHeartbeat`, `prepareAiRunPayloadSnapshot` | 607-933, 1984-2084, 2886-2983 |

Functions that STAY in `background.js` (orchestration shell): all
`registerBackgroundCommand(...)` handlers, `handleBackgroundCommandEnvelope`,
`recordBackgroundCommandLedger`, `maybeGetCommandPayloadForLedger`, all
`chrome.tabs`/`chrome.webNavigation`/`chrome.debugger`/`chrome.action`/
`chrome.runtime.onConnect` listeners, content-activation helpers
(`ensureContentMainForTab`, `requestContentActivation`,
`restoreEnabledStateForTab`), tab-lifecycle helpers, device-emulation wrappers,
and the page-motion-freeze-control queue. These may be extracted in a future
track; they are out of scope here.

## Target Module Layout

| New file | Pattern | Exports (the moved functions) |
| --- | --- | --- |
| `background/command-ledger.js` | A | `redactCommandPayloadForLedger` (+ `LEDGER_*` for tests) |
| `background/live-page-client.js` | A | `resolveLivePageSiteId`, `normalizeBaseUrlFromDomainName`, `buildPropertyPageTypesSignature`, `fetchLivePagePropertyPageTypes` |
| `background/network-core.js` | A | `resolveBackgroundEndpoint`, `createBackgroundJsonHeaders`, `resolveBackgroundNetworkCredentials`, `buildValidateEndpointFromStageBase`, `buildLoginEndpointFromStageBase`, `validateAuthToken`, `requestAuthLogin` |
| `background/remote-network.js` | A | the 10 remote-network functions listed above (imports from `network-core`) |
| `background/remote-config-sync.js` | A | the 7 remote-config-sync functions listed above |
| `background/world-trace.js` | B | `createWorldTrace` → `{ ensureTraceState, isWorldTraceEnabled, appendWorldTraceEvent }` |
| `background/popup-state-broker.js` | B | `createPopupStateBroker` → `{ getSpinnerQueueForTab, serializeSpinnerQueue, buildBrokerState, broadcastBrokerState, updateLifecycleState, clearNavInspectCurtain }` |
| `background/render-mode-inspector.js` | A | the 8 render-mode-inspector functions (inject `sendContentMessageToTab`) |
| `background/ai-run-orchestrator.js` | B | `createAiRunOrchestrator` → the 9 AI functions (inject `aiComputeLockExpiresAtByTabId` + collaborators) |

Hardening modules (after extraction): `background/async-tasks.js`,
`background/background-tab-state.js`, `background/managed-timeouts.js`.

## Per-Slice Procedure (apply to every extraction phase)

1. Re-grep the function map (see "Source Search Commands"). Confirm the exact
   function names still exist in `background.js`.
2. Create the new module file. Add ONLY the imports the moved functions use
   (copy the relevant import lines from the top of `background.js`; if the
   function used a symbol already imported in `background.js`, import the same
   symbol from the same source in the new module).
3. Move the named functions verbatim into the module. For Pattern A, export
   them. For Pattern B, wrap them in the `createXxx` factory and export the
   factory.
4. In `background.js`: delete the moved function bodies; add the import (Pattern
   A) or the `createXxx({...})` wiring (Pattern B). Every call site keeps the
   same function name (for Pattern B, alias the returned methods to the old
   names, e.g. `const appendWorldTraceEvent = worldTrace.appendWorldTraceEvent;`)
   so no call site changes.
5. Run `get_errors` on `background.js` and the new module. Resolve any
   unresolved-reference error by importing the missing symbol from the module
   that now owns it. If that creates a cycle, STOP and report.
6. Create the new focused test named in the slice (unit-test the module's public
   functions with mocks; do not hit the network or real `chrome`).
7. Update every test the slice names as "tests to update" so its `background.js`
   source assertions point at the new module source instead, and so import-shape
   assertions match.
8. Extend `tests/background-decomposition-boundary.test.js` (created in Phase 1)
   with this slice's entries: assert `background.js` imports from the new module
   and no longer defines the moved function names.
9. Focused validation: `node --test <the slice's test files>`.
10. Full validation: `npm test`. Must be 0 failures.
11. Live-harness validation: run "Live-Harness Validation Procedure" exercising
    the flow named in the slice. If the harness/MCP environment is unavailable,
    STOP and report in the handoff; do not silently skip.
12. Update `.copilot/handoff-world-decomposition.md`: files changed, tests
    run, focused/full/live results, phase status, next exact step.
13. Commit with the slice's exact message and push.

## Phase 0: Baseline And Boundary Guard

Goal: clean baseline + the growing structural guard test.

Steps:

1. `git status --short` (must be clean), `git fetch origin`, `git pull --ff-only`.
2. `npm ci` if needed. Run `npm test`; record the pass count. If baseline fails,
   STOP and record it in the handoff.
3. Create `tests/background-decomposition-boundary.test.js`. It reads
   `background.js` source and asserts the invariants that will grow per slice:
   - `background.js` imports from each already-created `background/` module.
   - For each function moved out so far, `background.js` source does NOT contain
     its definition (`function NAME(` / `async function NAME(`).
   In Phase 0 it asserts only the pre-existing modules
   (`command-router`, `tab-runtime`, `tab-session-store`, `spinner-operations`,
   `transfer-payload-store`, `ai-run-record-store`) are imported. Each later
   phase adds its module + moved-function assertions.
4. `node --test tests/background-decomposition-boundary.test.js`, then `npm test`.

Commit: `test(background): add decomposition boundary guard`

## Phase 1: command-ledger module

Pattern A. Lowest risk (pure functions).

Move into `background/command-ledger.js`: `looksLikeJwtToken`,
`summarizeLargeString`, `redactCommandPayloadValueForLedger`,
`redactCommandPayloadForLedger`, and the `LEDGER_SENSITIVE_KEY_PATTERN`,
`LEDGER_BODY_KEY_PATTERN`, `LEDGER_MAX_STRING_LENGTH`,
`LEDGER_MAX_ARRAY_PREVIEW`, `LEDGER_MAX_OBJECT_KEYS` constants. Export
`redactCommandPayloadForLedger` (and the constants, for tests).

Keep in `background.js`: `maybeGetCommandPayloadForLedger` and
`recordBackgroundCommandLedger`, importing `redactCommandPayloadForLedger`.

Tests to create: `tests/command-ledger.test.js` — feed payloads containing
`tokenValue`, `globalToken`, `password`, `headers.Authorization`,
`headers.Cookie`, `payloadKey`, `renderedHtml`, `pages:[{rawHtml}]`, a JWT-shaped
string, an over-long string, a circular reference; assert sensitive keys become
`[redacted]`, `payloadKey` becomes `[redacted:payload-key]`, body keys are
summarized/omitted, depth/array/object caps hold, output is JSON-serializable.

Tests to update: `tests/background-command-hardening.test.js` — re-point the
redaction-shape assertions (`LEDGER_SENSITIVE_KEY_PATTERN`,
`function redactCommandPayloadForLedger`, the `payloadKey` branch) to read
`background/command-ledger.js`; keep the assertion that
`maybeGetCommandPayloadForLedger` returns
`redactCommandPayloadForLedger(message.payload)` in `background.js`.

Boundary guard: assert `background.js` imports `redactCommandPayloadForLedger`
from `./background/command-ledger.js` and no longer defines
`function redactCommandPayloadForLedger(`.

Live flow: load extension, open the popup against the bonliva tab, enable
marking; confirm no console errors and that a command still completes (the ledger
path runs on every command).

Commit: `refactor(background): extract command ledger redaction`

## Phase 2: live-page-client module

Pattern A. Move `resolveLivePageSiteId`, `normalizeBaseUrlFromDomainName`,
`buildPropertyPageTypesSignature`, `fetchLivePagePropertyPageTypes` into
`background/live-page-client.js`. Import the GraphQL query constants/helpers they
use from `common/lynx-live-pages.js` (copy the exact symbols they reference).

Tests to create: `tests/live-page-client.test.js` — mock `fetch`; assert
`resolveLivePageSiteId` returns `{ siteId, baseUrl }` for a found result and
handles NotFound; `buildPropertyPageTypesSignature` is deterministic and
order-stable; `normalizeBaseUrlFromDomainName` strips `www` and yields the
canonical base URL.

Tests to update: any test from the `rg` list that asserts these names in
`background.js` source (search `rg -n 'resolveLivePageSiteId|fetchLivePagePropertyPageTypes' tests`).

Boundary guard: extend with the new module + four moved names.

Live flow: open popup on bonliva (siteId 5542, homepage candidate); confirm
page-type/Live-Page resolution still works (candidate state shows correctly).

Commit: `refactor(background): extract live-page client`

## Phase 3: network-core module

Pattern A. Move `resolveBackgroundEndpoint`, `createBackgroundJsonHeaders`,
`resolveBackgroundNetworkCredentials`, `buildValidateEndpointFromStageBase`,
`buildLoginEndpointFromStageBase`, `validateAuthToken`, `requestAuthLogin` into
`background/network-core.js`. Import credential reads from
`common/settings-store.js` (copy the exact symbols used).

Tests to create: `tests/background-network-core.test.js` — mock `fetch` and
settings; assert endpoint/header construction, credential resolution precedence
(options over stored; AI vs config endpoint), `validateAuthToken` maps 401/403 to
invalid, `requestAuthLogin` parses the login response. Never use a real token.

Tests to update: from `rg -n 'validateAuthToken|requestAuthLogin|resolveBackgroundNetworkCredentials' tests`.

Boundary guard: extend.

Live flow: in the popup, perform a token validation / login round-trip against
the stage base `a.lynxdev.se` using a token typed at runtime (do not store it);
confirm success/failure surfaces correctly.

Commit: `refactor(background): extract network core and auth`

## Phase 4: remote-network module

Pattern A. Move `requestAiRunStatus`, `removeRemotePageMarking`,
`submitSelectorSetGraphqlUpdate` (+ `UPDATE_SCRAPING_CONDITIONS_MUTATION`),
`loadRemoteConfigSnapshot`, `saveRemoteConfigSnapshot`,
`requestRenderModeDetection`, `submitPageTypeAssignments`,
`requestAiRunStartSnapshot`, `requestAiRunResultSnapshot`,
`fetchStaticPageHtmlForBackground` into `background/remote-network.js`. Import
endpoint/header/credential helpers from `./network-core.js` and payload helpers
from `./transfer-payload-store.js`.

Tests to create: `tests/background-remote-network.test.js` — mock `fetch` and the
transfer-payload store; assert each call uses the right method/endpoint and
stores/returns the right payload key; assert error statuses map to the documented
result shapes.

Tests to update: `tests/ai-run.test.js`, `tests/popup-marking-refresh.test.js`,
`tests/selector-suppression.test.js` where they assert these names in
`background.js` source.

Boundary guard: extend.

Live flow: open popup on bonliva; run a remote config load and a render-mode
detection (Config endpoint `https://unfluffify.lynxdev.se`, AI endpoint
`https://unfluffify.dnscdn.se:8443`); confirm both complete.

Commit: `refactor(background): extract remote network client`

## Phase 5: remote-config-sync module

Pattern A. Move `collectStoredPageMarkingItems`, `mergeSelectorsIntoConfig`,
`getRemoteManagedConfigSignature`, `getNormalizedPageEntrySignature`,
`replaceServerConfigIntoLocalSnapshot`, `mergeServerConfigIntoLocalSnapshot`,
`preparePageTypeAssignmentsSnapshot` into `background/remote-config-sync.js`.
Import `configStore` helpers from `common/config.js` and payload helpers from
`./transfer-payload-store.js`. If any of these call a remote-network function,
import it from `./remote-network.js` (one-directional; no cycle).

Tests to create: `tests/background-remote-config-sync.test.js` — assert
replace/merge snapshot behavior preserves the config-merge contract (timestamp
precedence, backend-saved markings update, current-page replacement detection)
using in-memory config + payload mocks.

Tests to update: from
`rg -n 'replaceServerConfigIntoLocalSnapshot|mergeServerConfigIntoLocalSnapshot|preparePageTypeAssignmentsSnapshot' tests`.

Boundary guard: extend.

Live flow: on bonliva, load remote config then save the current page; confirm the
saved/marked state reconciles correctly.

Commit: `refactor(background): extract remote config sync`

## Phase 6: world-trace module

Pattern B. Move `ensureTraceState`, `isWorldTraceEnabled`,
`appendWorldTraceEvent` (+ `WORLD_TRACE_EVENT_LIMIT`) into
`background/world-trace.js` as `createWorldTrace({ traceStateByTabId,
normalizeTabId, isFeatureEnabled, isDebugFlagEnabled, eventLimit })`. In
`background.js`, keep `tabWorldTraceStateByTabId`; wire
`const worldTrace = createWorldTrace({...})` and alias
`const appendWorldTraceEvent = worldTrace.appendWorldTraceEvent;` (and the other
two) so call sites are unchanged.

Tests to create: `tests/world-trace.test.js` — unit-test the factory: trace
state is per-tab, the event cap is enforced, enablement honors the injected flag
hooks.

Tests to update: `tests/world-trace-contract.test.js`.

Boundary guard: extend (module imported; three names no longer defined in
`background.js`).

Live flow: smoke (enable marking on bonliva, no console errors). Trace is a
diagnostic; confirm it does not throw.

Commit: `refactor(background): extract world trace store`

## Phase 7: popup-state-broker module

Pattern B. HIGH RISK (drives live popup UI over ports). Move
`getSpinnerQueueForTab`, `serializeSpinnerQueue`, `buildBrokerState`,
`broadcastBrokerState`, `updateLifecycleState`, `clearNavInspectCurtain` into
`background/popup-state-broker.js` as `createPopupStateBroker({
lifecycleStateByTabId, spinnerQueueByTabId, popupStatePortsByTabId,
normalizeTabId, appendTrace, serializeSpinnerQueue })`. Keep the
`chrome.runtime.onConnect` listener and the `Map` declarations in
`background.js`; the listener calls the broker's `buildBrokerState` /
`broadcastBrokerState`. Alias returned methods to old names.

Tests to create: `tests/popup-state-broker.test.js` — factory unit tests:
lifecycle update broadcasts to the right tab's ports only; terminal lifecycle
clears the nav-inspect curtain; broker state shape is preserved.

Tests to update: `tests/lifecycle-broker.test.js`.

Boundary guard: extend.

Live flow: on bonliva, trigger a navigation that starts inspection; confirm the
popup curtain/spinner appears and clears correctly, and that closing/reopening
the popup re-syncs state over the port.

Commit: `refactor(background): extract popup state broker`

## Phase 8: render-mode-inspector module

Pattern A (inject `sendContentMessageToTab`). Move
`normalizeRenderModeOperationId`, `waitForTabLoadStartInBackground`,
`waitForTabLoadCompleteInBackground`,
`ensureContentReadyForRenderModeInspectionInBackground`,
`sendRenderModeInspectionEndWithRetry`, `runRenderModeInspectionBeginStep`,
`runRenderModeRevealFreezeStep`, `runRenderModeCaptureHtmlStep` into
`background/render-mode-inspector.js`. Because these call
`sendContentMessageToTab` and tab-runtime updates, export a factory-free module
that imports `sendContentMessageToTab`... NOTE: `sendContentMessageToTab` stays
in `background.js`. To avoid a cycle, pass it in: export
`createRenderModeInspector({ sendContentMessageToTab, updateTabRuntime,
startTimeoutMs, loadTimeoutMs })` (Pattern B shape, but with function injection,
no Map). Alias the returned steps to old names in `background.js`.

Tests to create: `tests/render-mode-inspector.test.js` — inject a fake
`sendContentMessageToTab`; assert the begin/reveal/capture/end sequence, retry
count for end, and timeout handling.

Tests to update: `tests/background-render-mode-inspection.test.js`,
`tests/render-mode-inspection-order.test.js`.

Boundary guard: extend.

Live flow: on bonliva, run a full render-mode inspection from the popup; confirm
the page freezes/reveals, HTML is captured, and the end step tears down the
inspection UI.

Commit: `refactor(background): extract render-mode inspector`

## Phase 9: ai-run-orchestrator module

Pattern B. HIGHEST RISK. Move `getAiRunCurrentPageEntry`,
`isAiRunCurrentPageSnapshotMissing`, `refineAiRunPayloadXpathsInBackground`,
`loadAiRunSelectorSetFromPayloadKey`, `runAiCommandForTab`,
`setAiComputeLockForTab`, `isAiComputeLockActiveForTab`, `refreshAiRunHeartbeat`,
`prepareAiRunPayloadSnapshot` into `background/ai-run-orchestrator.js` as
`createAiRunOrchestrator({ aiComputeLockExpiresAtByTabId, sendContentMessageToTab,
configStore, ...remote-network/remote-config-sync/transfer-payload/
ai-run-record-store collaborators })`. Inject every collaborator the moved
functions call; do not import `background.js`. Keep the `TAB_RUN_AI` handler in
`background.js` calling `aiRun.runAiCommandForTab`.

Tests to create: `tests/ai-run-orchestrator.test.js` — inject fakes; assert the
run loop: compute-lock set, snapshot-capture branch, prepare/refine, start, poll
to completion/timeout, result load; assert each documented error reason; assert
heartbeat refreshes the lock and persists the record.

Tests to update: `tests/ai-run.test.js`, `tests/popup-ai-run-gating.test.js`.

Boundary guard: extend.

Live flow: on bonliva, run AI selector computation end-to-end from the popup with
a runtime-provided token; confirm the run starts, polls, completes, and applies
selectors, and that Save/Preview gating reflects the result.

Commit: `refactor(background): extract ai run orchestrator`

## Phase 10: async error reporting (hardening)

Goal: replace silent fire-and-forget rejections with observable failures.

1. Create `background/async-tasks.js` exporting
   `runBackgroundTask(label, work, { tabId, appendTrace } = {})`: awaits `work`
   (a promise or thunk), and on rejection calls `appendTrace(tabId, "task",
   "error", { label, message })` (when provided) and `console.warn(...)`; never
   rethrows. Returns the settled result or `undefined` on error.
2. Find fire-and-forget swallows: `rg -n '\.catch\(\(\) => \{\}\)' background.js`.
   For each, wrap the originating call with `runBackgroundTask("<call-name>",
   ...)` instead of the empty catch, preserving the exact scheduling (do not
   await where the original did not await).
3. Tests: `tests/background-async-tasks.test.js` — success passes through;
   rejection is reported via the injected `appendTrace` and does not throw.
4. Do not change any behavior other than error visibility.

Live flow: smoke (enable marking, run inspection on bonliva); confirm no behavior
change and that an induced failure is now traced rather than silent.

Commit: `refactor(background): report background task failures`

## Phase 11: per-tab state consolidation (hardening)

Goal: one owner for the per-tab `Map`s.

1. Create `background/background-tab-state.js` that constructs and exports the
   six `Map`s (`tabLifecycleStateByTabId`, `tabSpinnerQueueByTabId`,
   `popupStatePortsByTabId`, `tabWorldTraceStateByTabId`,
   `aiComputeLockExpiresAtByTabId`, `pageMotionFreezeControlQueueByTarget`) and a
   `disposeTabState(tabId)` that deletes the tab's entry from all per-tab Maps.
2. In `background.js`, import the Maps from this module (delete the local
   declarations) and replace the per-Map deletions in the `chrome.tabs.onRemoved`
   cleanup with a single `disposeTabState(tabId)` call, preserving identical
   cleanup semantics.
3. Tests: `tests/background-tab-state.test.js` — `disposeTabState` removes the
   tab from every per-tab Map and leaves other tabs untouched.

Live flow: open two bonliva tabs, enable marking in both, close one; confirm the
other keeps working and no state leaks (tab-isolation contract).

Commit: `refactor(background): consolidate per-tab state ownership`

## Phase 12: managed timeouts (hardening, optional last)

Goal: trackable, cancellable timeouts for render-mode + AI polling watchdogs.

1. Create `background/managed-timeouts.js` exporting `createManagedTimeoutGroup()`
   → `{ set(fn, ms), clear(handle), clearAll() }` over `setTimeout`/
   `clearTimeout`.
2. In `render-mode-inspector` and `ai-run-orchestrator`, replace ad-hoc
   `setTimeout` watchdog/poll handles with a group, calling `clearAll()` on
   terminal/cleanup paths. Preserve identical timing values.
3. Tests: `tests/background-managed-timeouts.test.js` — `set` schedules,
   `clearAll` cancels all pending, timing values unchanged.

Live flow: run inspection and an AI run on bonliva; confirm timeouts still fire
and cleanup cancels pending timers (no late callbacks after teardown).

Commit: `refactor(background): add managed timeout groups`

## Boundary Guard Test

`tests/background-decomposition-boundary.test.js` grows each phase and is the
single structural contract for the track. Final state asserts:

1. `background.js` imports from every `background/` module created by this track.
2. None of the moved function names are defined in `background.js` source.
3. No new `background/` module reads `chrome.storage` directly (route through the
   approved stores) — mirror the spirit of `tests/storage-access-boundary.test.js`.

## Live-Harness Validation Procedure

Use the documented Playwright/MCP debug harness. Endpoints and fixtures:

- Config endpoint: `https://unfluffify.lynxdev.se`
- AI endpoint: `https://unfluffify.dnscdn.se:8443`
- Stage base: `a.lynxdev.se`
- Fixture page: `https://www.bonliva.no/` → siteId 5542, candidate pageType
  `homepage` (stored config key normalizes to `https://bonliva.no`).
- Provide any JWT manually at runtime. Never store tokens in the repo, memory,
  logs, or these docs.

Steps:

1. Load the unpacked extension (ID `poibphcdecdbdcafahkacjbflalafmjh`) in the
   MCP/Playwright Chromium using `.vscode/browser-mcp.config.json`
   (`browserName: "chromium"`, bundled Chromium `executablePath`,
   `ignoreDefaultArgs: ["--disable-extensions"]`).
2. Navigate to the fixture page. In the page context set
   `localStorage.ufDebugSpinnerQueue = "1"` and reload so `content-loader.js`
   writes `document.documentElement.dataset.ufDebugTabId`.
3. Read the tab id from `dataset.ufDebugTabId`, then open
   `chrome-extension://<EXT_ID>/popup.html?debugTabId=<tabId>` so popup commands
   target the fixture tab.
4. Exercise the exact flow named in the slice (marking, render-mode inspection,
   remote-config load/save, AI run, etc.). Watch the service-worker and page
   consoles for errors.
5. Pass criteria: the slice's flow behaves identically to pre-change, with no new
   console errors and no regressions in the protected contracts.
6. If extension load or injection fails: restart MCP/browser, clear stale profile
   lock files, retry once. If still blocked, STOP and record the blocker in the
   handoff; do not mark the slice done.

## Commit Slicing Rules

1. One phase per commit. Do not combine phases.
2. Each commit includes: the module move + wiring, the new focused test(s), the
   updated source-contract tests, and the boundary-guard extension.
3. Each commit must have a green focused run, a green `npm test`, and a recorded
   live-harness result before push.
4. Use the exact commit messages above.

## Source Search Commands

```bash
# Re-map background.js functions before each slice:
rg -n '^(async function|function) [A-Za-z0-9_]+|^registerBackgroundCommand\(' background.js

# Find tests that pin background.js source:
rg -n 'readFileSync\(new URL\("\.\./background\.js"' tests

# Find fire-and-forget swallows (Phase 10):
rg -n '\.catch\(\(\) => \{\}\)' background.js

# Confirm no direct chrome.storage entered a new background module:
rg -n 'chrome\.storage\.' background/
```

## Track A Definition Of Done

Track A is complete when all of these are true:

1. Every module in "Target Module Layout" exists, with the named functions moved
   and `background.js` importing/wiring them; no call site behavior changed.
2. `background.js` no longer defines any moved function (enforced by
   `tests/background-decomposition-boundary.test.js`).
3. Hardening phases 10-12 are implemented (async reporting, state consolidation,
   managed timeouts) with their tests green.
4. No new `background/` module accesses `chrome.storage` directly.
5. `npm test` passes with 0 failures.
6. Every slice has a recorded live-harness validation result in the handoff.
7. `.copilot/handoff-world-decomposition.md` records final phase completion and
   any deferred items.
8. The locked marking/visibility logic and `content/` files were never edited by
   this track.

# TRACK B — POPUP WORLD

Start Track B only after Track A is complete, merged to `main`, and green.

## Track B Objective

Decompose `popup.js` (~9392 lines) into single-responsibility modules under
`popup/`, following the pattern already used by `popup/messages.js`,
`popup/state.js`, `popup/ui.js`, `popup/helpers.js`, `popup/ai-run.js`,
`popup/render-mode.js`, `popup/emulation.js`, `popup/chrome-helpers.js`, and
`popup/telemetry.js`. Behavior-preserving extraction plus one timer-manager
hardening slice.

## Track B Module Pattern (Pattern P: shared-singleton import)

Popup already centralizes mutable state in the `popup/state.js` singleton and
routing in `popup/messages.js`. Unlike background, popup needs NO factory: each
extracted module imports the SAME singletons that `popup.js` imports, so
mutations stay shared. Mirror these exact `popup.js` imports in every extracted
module (only import what the moved functions use):

```js
import * as stateModule from "./state.js";   // popup.js line 88
import * as uiModule from "./ui.js";         // popup.js line 31
import * as messages from "./messages.js";   // popup.js line 76
import * as helpers from "./helpers.js";     // popup.js line 77
import * as utils from "../common/utilities.js"; // popup.js line 75
import * as config from "../common/config.js";   // popup.js line 22
```

Note the path prefix changes from `./popup/...` (in `popup.js` at repo root) to
`./...`/`../common/...` (inside a `popup/` module). Access state as
`stateModule.state` exactly as `popup.js` does. Do not snapshot or clone state
into a module-local variable; always read/write through `stateModule.state`.

Reuse the generic "Per-Slice Procedure" above, substituting `popup.js` for
`background.js` and `tests/popup-decomposition-boundary.test.js` for the
background boundary guard.

HARD RULES for Track B (in addition to the Non-Negotiable Direction):
1. Do not reintroduce direct `chrome.tabs.sendMessage` / raw
   `chrome.runtime.sendMessage` in popup code; all routing stays through
   `popup/messages.js` (guarded by `tests/popup-authority-boundary.test.js`).
2. Do not change view-state shape consumed by `popup/ui.js`; extracted modules
   still call `uiModule.setViewState(...)` exactly where `popup.js` did.
3. Keep the locked marking-refresh contract behavior identical
   (`tests/popup-marking-refresh.test.js`).

## Track B Current popup.js Domain Inventory

Captured 2026-06-10. Re-grep before editing
(`rg -n '^(async function|function) [A-Za-z0-9_]+' popup.js`).

| Domain (future module) | Functions (anchor names) | ~Lines |
| --- | --- | --- |
| spinner | `currentSpinnerMessage`, `currentSpinnerSnapshot`, `normalizeSpinnerReason`, `armSpinnerWatchdog`, `pushSpinner`, `runWithSpinner` (+ pop/clear helpers nearby) | 854-1505 |
| site-resolution | `fetchPropertyPageTypesFromGraphql`, `ensurePropertyPageTypes`, `resolveSiteIdFromGraphql`, `mergeConfigEntriesForResolvedBaseUrl`, `ensureBaseUrlSiteId` | 1648-2505 |
| remote-config | `scheduleRemoteConfigRetry`, `loadRemoteConfigForCurrentPage`, `syncBaseConfigToServer` | 3328-3755 |
| render-mode-inspection | `maybeAutoDetectRenderMode`, `detectRenderModeViaEndpoint`, `completeRenderModeInspectionReloadFollowUp` (+ the popup-side wait-for-load helpers in 3339-4102) | 2225-4102 |
| page-reconciliation | `hasCurrentPagePendingChanges`, `handlePageSave`, `handlePageRevert` | 1942-8162 |
| property-lock-ui | `isPropertyLockCollaborationEnabled`, `resetDisabledPropertyLockState`, `resetPropertyLockState`, `clearPropertyLockTransientState`, `clearPropertyLockOffCandidateRefreshTimer`, `syncPropertyLockOffCandidateRefreshTimer`, `persistPropertyLockRecoveryMetadata`, `applyPropertyLockState`, `queueEditorBootstrapOnLockTransition`, `applyPropertyLockConnectionStatus`, `applyPropertyLockServerMessage`, `isPropertyLockBlockingEditing`, `buildPropertyLockViewState`, `fetchPropertyLockState`, `refreshPropertyLockSnapshot`, `sendPropertyLockCommand`, `reconcilePropertyLockAfterCommand` | 164-770 |
| remote-support-ui | `syncRemoteSupportViewState`, `handleRemoteSupportRequest`, `handleRemoteSupportJoinCodeInput`, `handleRemoteSupportJoin` | 6497-7090 |

Functions that STAY in `popup.js` (orchestration shell): `init()`,
`refreshUi()` / `refreshUiInner()` (the main refresh loop), the top-level event
listeners (click, keydown shortcuts, `chrome.tabs.onActivated`,
`chrome.runtime.onMessage`, storage change), the gating predicates used by
`refreshUiInner`, theme/appearance, marking-control handlers, device-emulation
toggles, AI-run gating, and the Lynx checklist handlers. These may be extracted
in a later track; out of scope here.

## Track B Target Module Layout

| New file | Exports (moved functions) | Imports it needs |
| --- | --- | --- |
| `popup/spinner.js` | the 6 spinner functions | `stateModule`, `uiModule` |
| `popup/site-resolution.js` | the 5 site-id/page-type functions | `stateModule`, `messages`, `config`, `utils`, `../common/lynx-live-pages.js` symbols |
| `popup/remote-config.js` | `scheduleRemoteConfigRetry`, `loadRemoteConfigForCurrentPage`, `syncBaseConfigToServer` | `stateModule`, `messages`, `config`, `uiModule` |
| `popup/render-mode-inspection.js` | the render-mode detection/inspection functions | `stateModule`, `messages`, `uiModule`, `./render-mode.js` |
| `popup/page-reconciliation.js` | `hasCurrentPagePendingChanges`, `handlePageSave`, `handlePageRevert` | `stateModule`, `messages`, `config`, `uiModule` |
| `popup/property-lock-ui.js` | the 17 property-lock functions | `stateModule`, `messages`, `uiModule`, `../common/property-lock.js` symbols |
| `popup/remote-support-ui.js` | the 4 remote-support functions | `stateModule`, `messages`, `uiModule` |
| `popup/timers.js` (hardening) | `createPopupTimerGroup()` | none |

## Track B Phases

Order: lowest coupling first; biggest/most-coupled (property-lock,
remote-support) last; hardening last.

1. Phase B0 - Baseline + `tests/popup-decomposition-boundary.test.js`
   (Phase-0 shape: asserts the pre-existing popup modules are imported; grows per
   slice to assert each new module is imported and the moved names are no longer
   defined in `popup.js`). Commit: `test(popup): add decomposition boundary guard`.
2. Phase B1 - `popup/spinner.js`. Tests: create `tests/popup-spinner.test.js`
   (queue push/pop, watchdog arm/clear, reason normalization with mocks); update
   any popup source-pinning test referencing spinner functions. Commit:
   `refactor(popup): extract spinner queue`.
3. Phase B2 - `popup/site-resolution.js`. Tests: create
   `tests/popup-site-resolution.test.js` (mock messages/config/graphql; assert
   site-id resolution, page-type fetch, config-entry merge for resolved base
   URL). Commit: `refactor(popup): extract site and page-type resolution`.
4. Phase B3 - `popup/remote-config.js`. Tests: create
   `tests/popup-remote-config.test.js` (mock messages/config; assert load/save
   flows, retry scheduling/backoff). Update `tests/popup-marking-refresh.test.js`
   reads that reference these names. Commit:
   `refactor(popup): extract remote config sync`.
5. Phase B4 - `popup/render-mode-inspection.js`. Tests: create
   `tests/popup-render-mode-inspection.test.js`; update
   `tests/render-mode-inspection-order.test.js` and
   `tests/background-render-mode-inspection.test.js` reads of popup source.
   Commit: `refactor(popup): extract render-mode inspection`.
6. Phase B5 - `popup/page-reconciliation.js`. Tests: create
   `tests/popup-page-reconciliation.test.js` (pending-change detection,
   save/revert gating); update `tests/popup-marking-refresh.test.js` reads.
   Commit: `refactor(popup): extract page save reconciliation`.
7. Phase B6 - `popup/property-lock-ui.js` (HIGH RISK; ~200-line view builder and
   17 functions touching property-lock state + timers). Tests: create
   `tests/popup-property-lock-ui.test.js`; update `tests/property-lock.test.js`
   popup-source reads. Commit: `refactor(popup): extract property lock UI`.
8. Phase B7 - `popup/remote-support-ui.js`. Tests: create
   `tests/popup-remote-support-ui.test.js`; update popup-source reads that
   reference these names. Commit: `refactor(popup): extract remote support UI`.
9. Phase B8 - HARDENING: `popup/timers.js` `createPopupTimerGroup()` and migrate
   the scattered `state` timers (`refreshTimer`, `aiRunPollTimer`,
   `propertyPageTypesRefreshTimer`, `toastTimer`, property-lock off-candidate
   timer) to grouped, cancellable timers with identical intervals. Tests:
   `tests/popup-timers.test.js`. Commit: `refactor(popup): group popup timers`.

## Track B Tests To Watch

Popup source is pinned heavily in `tests/popup-marking-refresh.test.js` (~20
reads), plus `tests/preview-tooltip.test.js`,
`tests/render-mode-inspection-order.test.js`, `tests/lifecycle-broker.test.js`,
`tests/background-render-mode-inspection.test.js`,
`tests/popup-ai-run-gating.test.js`, `tests/popup-authority-boundary.test.js`,
`tests/popup-background-snapshot.test.js`. Before each slice run
`rg -n 'readFileSync\(new URL\("\.\./popup\.js"' tests` and update every test
whose assertion targets a moved function so it reads the new module source.

## Track B Live Validation

Use the same bonliva debug harness (popup `?debugTabId=N`). Popup flows are fully
live-validatable: spinner overlay, site-id/page-type resolution, remote-config
load/save, render-mode inspection, page save/revert, property-lock banner
mirroring (needs an editor lock), remote-support request/join (needs a session).
For property-lock and remote-support slices, run the matching live scenario; if
unavailable, mark BLOCKED and stop (do not skip).

## Track B Definition Of Done

1. Every module in "Track B Target Module Layout" exists; `popup.js` imports them
   and no longer defines the moved functions (enforced by
   `tests/popup-decomposition-boundary.test.js`).
2. All routing still flows through `popup/messages.js` (no direct
   `chrome.tabs.sendMessage` / raw runtime sends).
3. The popup timer-manager hardening slice is implemented and green.
4. `npm test` passes with 0 failures.
5. Every slice has a recorded live result (or a recorded BLOCKED reason for
   property-lock / remote-support live scenarios).

# TRACK C — CONTENT WORLD (CONSERVATIVE, GUARDRAILED)

Start Track C only after Tracks A and B are complete, merged, and green.

## Track C HARD GUARDRAIL (read twice)

OFF-LIMITS — NEVER move, edit, or refactor in this track:

1. Anything in `content/core.js` (visibility, hit-testing, inclusion/exclusion,
   reconciliation, snapshot generation, motion-freeze, selector building, timer
   capture). Do not edit `content/core.js` at all.
2. In `content-main.js`: marking activation, silent highlighting, AI preview,
   config / site-id sync, page save / AI submission, consent management, and the
   render-mode inspection internals that call `core.warmup*` / core marking.
3. The locked marking / silent-highlight / visibility / reconciliation contract
   described in `MARKING_AND_HIGHLIGHTING_LOGIC.md` and `.copilot/knowledge.md`.

If a candidate function reads from or calls into core marking/visibility
computation, it is OFF-LIMITS. When unsure, STOP and record the doubt in the
handoff rather than moving it.

## Track C CRITICAL RUNTIME FOOTGUN (web_accessible_resources)

`content-main.js` is loaded via `import(chrome.runtime.getURL("content-main.js"))`
and every `content/*` module it statically imports MUST be listed in
`manifest.json` `web_accessible_resources.resources`. Every new content module
created in this track MUST be added to that allowlist in the SAME slice, and
`tests/manifest-permissions.test.js` updated to expect it. Omitting this does not
fail unit tests but silently breaks the content script at runtime (this exact
class of bug previously broke the page-telemetry bridge — see `.copilot/
knowledge.md`). Because of this, the live-harness check is MANDATORY for every
Track C slice.

## Track C Module Pattern

Mirror `content-main.js` imports for the symbols the moved functions use (paths
become `./core.js`, `../common/...`, etc. inside a `content/` module). For
functions that read content-main's module-level state globals (e.g. property-lock
banner reads `propertyLock*` state), prefer passing the needed accessors/values
as function parameters (function injection) rather than exporting the whole state
object; if that is impractical for a behavior-preserving move, STOP and record it
— do not invent a shared mutable content-state module without updating this plan.

## Track C Allowed Domains (the ONLY functions that may move)

Captured 2026-06-10. Re-grep before editing.

| Domain (future module) | Functions (anchor names) | ~Lines |
| --- | --- | --- |
| page-telemetry-bridge | `handlePageTelemetryWindowMessage`, `syncPageTelemetryControl`, `ensurePageTelemetryBridge` | 1034-1300 |
| remote-support-client | `initializeRemoteSupportSupportPageViewer`, `sendRemoteSupportSupportPageViewerRequest`, `quietRemoteSupportVideos`, `startRemoteSupportMediaQuieting`, `stopRemoteSupportMediaQuieting`, `applyRemoteSupportSessionState`, `ensureRemoteSupportSupportPageUi`, `renderRemoteSupportSupportPage`, `initializeRemoteSupportSupportPage` | 590-2160 |
| property-lock-banner | `updatePropertyLockBannerMode`, `renderPropertyLockBanner` | 7603-7900 |

Nothing else in `content-main.js` or anything in `content/core.js` may move in
this track.

## Track C Phases

1. Phase C0 - Baseline + `tests/content-decomposition-boundary.test.js`
   (asserts `content-main.js` imports the new modules and no longer defines the
   moved names) + a manifest-allowlist assertion that every `content/*` module
   imported by `content-main.js` is web-accessible. Commit:
   `test(content): add decomposition boundary guard`.
2. Phase C1 - `content/page-telemetry-bridge.js`. Steps: move the 3 functions;
   add `content/page-telemetry-bridge.js` to `web_accessible_resources`; update
   `tests/manifest-permissions.test.js`; update `tests/page-telemetry.test.js`
   source reads. Live: active being_supported session shows page telemetry still
   streams. Commit: `refactor(content): extract page telemetry bridge`.
3. Phase C2 - `content/remote-support-client.js`. Steps: move the 9 functions;
   add to `web_accessible_resources`; update `tests/manifest-permissions.test.js`
   and any content source-pinning test referencing these names. Live: remote
   support viewer/support-page + media quieting work in a live session. Commit:
   `refactor(content): extract remote support client`.
4. Phase C3 - `content/property-lock-banner.js`. Steps: move the 2 functions
   (inject the property-lock state values they read); add to
   `web_accessible_resources`; update `tests/manifest-permissions.test.js`. Live:
   property-lock editor session shows the banner/modals render and update. Commit:
   `refactor(content): extract property lock banner`.

## Track C Validation Gating

Unit/source tests are the primary STRUCTURAL gate. The matching live scenario is
a REQUIRED gate and MUST run because of the web-accessible-resources footgun.
Live scenarios: page-telemetry and remote-support need an active
`being_supported` session; property-lock-banner needs a property-lock editor
session. These depend on the orchestration harness (currently paused/flaky), so
Track C slices may BLOCK. If the live scenario is unavailable, record the slice
as BLOCKED in the handoff and STOP. NEVER mark a Track C slice done on unit tests
alone, and NEVER skip the manifest/web-accessible update.

## Track C Definition Of Done

1. The three allowed modules exist; `content-main.js` imports them and no longer
   defines the moved functions (enforced by
   `tests/content-decomposition-boundary.test.js`).
2. Each new `content/*` module is in `web_accessible_resources` and
   `tests/manifest-permissions.test.js` is green.
3. `content/core.js` and all locked marking/visibility/reconciliation logic were
   never edited.
4. `npm test` passes with 0 failures.
5. Each slice has a recorded live result, or a recorded BLOCKED reason.

# Program Definition Of Done

The whole program is complete when:

1. Track A, Track B, and Track C definitions of done are all satisfied, OR
   remaining Track C slices are explicitly BLOCKED with a recorded reason in the
   handoff.
2. `background.js`, `popup.js`, and `content-main.js` no longer define their
   moved functions (enforced by the three boundary-guard tests).
3. No new module accesses `chrome.storage` directly outside the approved stores.
4. Every new `content/*` module is web-accessible and
   `tests/manifest-permissions.test.js` is green.
5. `npm test` passes with 0 failures.
6. The locked marking / silent-highlight / visibility / reconciliation logic and
   `content/core.js` were never edited anywhere in the program.
7. `.copilot/handoff-world-decomposition.md` records final status for all three
   tracks.
