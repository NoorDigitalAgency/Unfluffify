# Service Worker Authority Refactor Plan

Last updated: 2026-06-09
Status: READY FOR IMPLEMENTATION
Scope: architectural refactor plan only; no implementation has started in this
document commit.

## Purpose

Refactor Unfluffify so the Manifest V3 service worker is the command
headquarters for tab-scoped extension behavior, while popup, content script, and
page-world scripts become focused executors with clear ownership boundaries.

This document is intentionally prescriptive. A future agent should follow the
steps in order, commit each safe slice, and avoid inventing alternate flows. If a
step appears wrong, stop and document the contradiction before changing code.

## Non-Negotiable Direction

1. The service worker owns command authority.
2. The popup owns only popup UI rendering, popup-local view state, user input,
   and display of service-worker state snapshots.
3. Content scripts own page DOM marking/highlighting UI, consent removal,
   one-on-the-page UI, page inspection UI, and DOM-specific logic.
4. Page-world scripts own only low-level page-world functions that they expose
   on request. They do not decide extension mode.
5. Popup and content communicate with the service worker by acknowledged
   two-way messages.
6. Page-world scripts communicate with the service worker only through a small
   content-layer relay.
7. Every command and state transition is tab-scoped. Same URL in two tabs must
   never share mode, spinner, lifecycle, content-ready, or page-world state.
8. Cross-layer coordination must be deterministic request/response or explicit
   event delivery. Do not add polling or observers for cross-layer authority.
9. Spinners are async operation lifetimes. If an operation needs a spinner, the
   operation itself must be async and awaited inside a spinner wrapper.
10. The 11 protected always-on product behaviors listed below must survive every
    phase.

## Protected 11 Always-On Behaviors

These behaviors are core product surface, not optional experiments. They are not
behind feature flags and must not be broken during the refactor. Every phase must
run or preserve tests that protect the behavior it touches.

1. Tab-scoped content bootstrap and extension activation.
   - Content loader must activate content-main only for the target tab/frame.
   - Activation state must not leak between tabs with the same URL.

2. Base URL scoping and per-tab session state.
   - A tab can only operate within its current normalized base URL.
   - Per-tab state keys remain tab-scoped, not URL-global or property-global.

3. Marking mode activation and deactivation.
   - Enable marking runs the existing content activation path.
   - Disable marking clears marking UI and preserves required save/discard
     safety rules.

4. Marking overlay rules and interactions.
   - Click, Shift parent selection, Alt explicit include, Space page pass-through,
     default exclusions, immutable exclusions, and local draft sync keep the
     locked 052c-derived contract from MARKING_AND_HIGHLIGHTING_LOGIC.md.

5. Silent highlighting mode and overlay rendering.
   - Silent highlighting remains available outside active marking.
   - Existing selector overlay layers and no-blink behavior remain intact.

6. Consent removal.
   - Consent UI hiding remains content-owned and runs before save/reveal paths
     that depend on it.
   - Consent hiding must keep using the high-precision selector contract.

7. Page reveal, page motion freeze, and lazy-loading stopping.
   - Reveal must still perform the bounded scroll walk and return to the saved
     scroll position.
   - Freeze must still pause page motion after reveal.
   - Lazy-loading stopping/suppression must still activate during reveal when
     needed and must always restore/clear at the end of the promise lifetime.
   - This includes the page-world lazy-loading suppression bridge, not just CSS
     animation freezing.

8. Mobile simulation contract for marking and submission.
   - Fresh supported tab sessions still default to mobile simulation.
   - Active marking still forces mobile simulation while the editor tab is in
     marking mode.
   - User-disabled mobile simulation remains a per-session choice outside active
     marking.

9. Local drafts, page-save reconciliation, save, and discard.
   - Local marking edits remain session-local until Save Session.
   - Discard reloads confirmed backend state and clears live local draft state.
   - Save remains blocked when AI freshness or reconciliation requires it.

10. AI selector run, result application, and stored evidence usage.
    - AI payloads continue to use stored raw/rendered HTML and XPath evidence.
    - Large payloads must not be routed through unnecessary runtime-message hops.
    - Run AI remains async with status/heartbeat handling.

11. Inspection and review surfaces.
    - Manual render-mode inspection/capture, Preview Contents, Send to Lynx, and
      related mode gates keep their current allowed/blocked surfaces.
    - Marking-mode Preview and silent-mode Preview/Send behavior must remain as
      documented.

If a future implementer believes one protected item should be split or renamed,
they may update this document only after preserving the exact behavior in tests.

## Current Architecture Snapshot

The current code already has useful seams, but authority is distributed.

Important files:

1. Service worker: background.js
   - Already owns tab state, content activation, spinner broker, lifecycle state,
     page-world freeze executeScript relay, AI persistence, remote support, and
     property lock background handlers.
   - Problem: it is a large message switch plus many direct workflows; it is not
     yet a formal command router or tab runtime authority.

2. Popup: popup.js, popup/messages.js, popup/ui.js, popup/state.js
   - Already owns popup view state and user input.
   - Problem: popup directly orchestrates many workflows and sends direct tab
     messages to content. It owns spinner queue mechanics that should become
     background operation state.

3. Content loader: content-loader.js
   - Already idempotently imports content-main.js on activateContentMain.
   - Problem: activation is still treated as a utility message rather than a
     first-class service-worker command.

4. Content: content-main.js and content/core.js
   - Owns marking/highlighting logic, consent removal, reveal/freeze, page UI,
     silent highlighting, snapshots, and many runtime message calls.
   - Problem: content sometimes makes mode decisions and sometimes asks
     background for work. It needs a command executor boundary.

5. Page world: common/page-motion-freeze-bridge.js and
   common/page-motion-freeze-control.js
   - Already performs page-world timer, rAF, and lazy-loading interception.
   - Problem: the direct background executeScript path should become a small,
     explicit page-world command relay through content, unless a temporary
     compatibility step says otherwise.

6. Messaging utilities: common/utilities.js and popup/messages.js
   - Already have Promise wrappers, but they resolve many failures as values and
     do not enforce a shared envelope, timeout, or failure rejection model.

7. Tests: tests/*.js
   - There are strong pure logic tests for marking and support logic.
   - There are also many source-shape regex tests. Those are acceptable only for
     structural invariants that cannot be exercised otherwise; most should be
     converted to functional or contract tests during this refactor.

## Target Authority Matrix

Use this matrix when deciding where code belongs.

| Concern | Authority | Executor | Notes |
| --- | --- | --- | --- |
| User clicked popup button | Popup collects intent | Popup sends command to SW | Popup does not decide mode. |
| Current tab mode | Service worker | Content executes view changes | Stored in tab runtime. |
| Popup busy state | Service worker | Popup renders snapshot | Popup does not own spinner truth. |
| Page inspection UI | Service worker commands | Content renders/removes | Content owns DOM UI. |
| Marking overlays | Service worker commands mode | Content owns logic/render | Marking rules stay in content. |
| Silent highlighting | Service worker commands mode | Content owns logic/render | Content reports result. |
| Consent removal | Service worker commands timing | Content executes | Consent selector logic stays content. |
| Page reveal/freeze | Service worker commands operation | Content orchestrates DOM walk and page relay | Lazy-loading stopping is protected. |
| Page-world timer/lazy suppression | Service worker commands | Page world executes through content relay | Page world has no authority. |
| Tab state/session state | Service worker | Service worker storage helpers | Keyed by tabId. |
| AI/network/backend work | Service worker unless content DOM snapshot is needed | SW and content cooperate by command | Avoid large payload hops. |
| Remote support/property lock optional flows | Existing feature-gated modules | Keep isolated | Do not destabilize unless a phase touches them. |

## Message Protocol Requirements

Create one centralized async message system before moving workflows.

### Envelope

All request messages crossing layers must use this shape or a documented adapter
that converts to this shape:

```js
{
  id: "uuid-or-monotonic-id",
  type: "command-or-query-name",
  source: "popup" | "background" | "content" | "page",
  target: "background" | "content" | "page" | "popup",
  tabId: 123,
  frameId: 0,
  expectsReply: true,
  payload: {}
}
```

Rules:

1. `id` is required when `expectsReply` is true.
2. `type` is required and must be one of the exported command constants.
3. `tabId` is required for any tab-affecting command.
4. `frameId` defaults to 0 for content/page commands unless the command is
   explicitly all-frame capable.
5. `payload` must be JSON-serializable. Large payloads must use storage/cache
   keys instead.

### Reply

All successful replies:

```js
{
  id: "same-id",
  ok: true,
  result: {}
}
```

All failures:

```js
{
  id: "same-id",
  ok: false,
  code: "timeout|runtime_error|feature_disabled|invalid_tab|content_unavailable|handler_failed",
  error: "Human readable reason",
  details: {}
}
```

The centralized Promise wrapper must reject when:

1. Chrome reports `runtime.lastError`.
2. The send operation throws.
3. Timeout wins the race.
4. The response is missing when a reply is expected.
5. The response has `ok: false`.

The wrapper resolves only when the response has `ok: true`. It returns
`response.result` by default unless a caller requests the full envelope.

### Timeout Behavior

The wrapper accepts `timeoutMs`.

1. If `timeoutMs` is missing or 0, do not create a timeout.
2. If `timeoutMs` is positive, race the Chrome response against a timeout.
3. On timeout, reject with a structured error carrying:
   - `code: "timeout"`
   - message type
   - tabId/frameId when known
   - timeoutMs
4. Do not leave timers active after response or rejection.

### Registration

Create handler registration helpers instead of adding new giant if/else blocks.

Expected API shape:

```js
registerCommandHandlers("background", {
  [COMMANDS.TAB_ACTIVATE_MARKING]: async (context, payload) => { ... }
});
```

Handler context should include:

1. `message`
2. `sender`
3. `tabId`
4. `frameId`
5. `requestId`
6. helper methods for success/failure replies

## Command Names

Use exported constants. Do not add ad-hoc string message names for new work.

Initial command groups:

1. Background tab commands
   - `TAB_BOOTSTRAP_CONTENT`
   - `TAB_ACTIVATE_MARKING`
   - `TAB_DEACTIVATE_MARKING`
   - `TAB_ENTER_SILENT_HIGHLIGHTING`
   - `TAB_REFRESH_SILENT_HIGHLIGHTING`
   - `TAB_RUN_REVEAL_FREEZE`
   - `TAB_HIDE_CONSENT`
   - `TAB_CAPTURE_RENDER_MODE_HTML`
   - `TAB_BEGIN_RENDER_MODE_INSPECTION`
   - `TAB_END_RENDER_MODE_INSPECTION`

2. Content executor commands
   - `CONTENT_ACTIVATE_MAIN`
   - `CONTENT_GET_STATUS`
   - `CONTENT_APPLY_MARKING_MODE`
   - `CONTENT_APPLY_SILENT_MODE`
   - `CONTENT_HIDE_CONSENT`
   - `CONTENT_RUN_REVEAL_FREEZE`
   - `CONTENT_CAPTURE_HTML`
   - `CONTENT_CAPTURE_AI_SNAPSHOT`
   - `CONTENT_APPLY_AI_PREVIEW`
   - `CONTENT_CLEAR_AI_PREVIEW`

3. Page-world commands
   - `PAGE_WORLD_ARM`
   - `PAGE_WORLD_SET_MOTION_PAUSED`
   - `PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED`
   - `PAGE_WORLD_DESTROY`
   - `PAGE_WORLD_ENABLE_TELEMETRY`
   - `PAGE_WORLD_DISABLE_TELEMETRY`

4. Popup snapshot/events
   - `POPUP_GET_TAB_VIEW_STATE`
   - `POPUP_STATE_UPDATED`
   - `POPUP_OPERATION_FAILED`

Names can be adjusted, but the authority direction must not change.

## Phase 0: Baseline And Guardrails

Goal: prepare a safe branch and baseline before architectural edits.

Steps:

1. Start clean.
   - Run `git status --short`.
   - If dirty, inspect every file. Do not overwrite user changes.

2. Sync main.
   - Run `git fetch origin`.
   - Run `git pull --ff-only`.

3. Create implementation branch.
   - `git switch -c refactor/service-worker-authority`

4. Install dependencies if needed.
   - `npm ci`

5. Run baseline tests.
   - `npm test`
   - Also run focused core guard suite:
     `node --test tests/core-visibility.test.js tests/core-motion-pause.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`

6. Record baseline in the handoff if failures exist.
   - If tests fail before edits, do not start implementation until the failures
     are documented as pre-existing or fixed.

7. Add a temporary implementation checklist in the handoff document if the work
   spans sessions.

Commit expectation:

- No code commit in Phase 0 unless docs or tests are updated.
- Commit message style if needed: `docs(refactor): record service-worker authority baseline`.

## Phase 1: Central Async Messaging Core

Goal: introduce the centralized request/reply wrapper without changing existing
workflow ownership yet.

Files to add or edit:

1. Add `common/message-protocol.js`.
2. Add `common/async-messaging.js`.
3. Add `tests/async-messaging.test.js`.
4. Update `common/utilities.js` only by delegating existing helpers to the new
   wrapper where behavior remains compatible.

Implementation steps:

1. Define exported constants and helpers in `common/message-protocol.js`:
   - `MESSAGE_SOURCES`
   - `MESSAGE_TARGETS`
   - `MESSAGE_ERROR_CODES`
   - `createRequestEnvelope(type, payload, options)`
   - `createSuccessEnvelope(request, result)`
   - `createFailureEnvelope(request, code, error, details)`
   - `isRequestEnvelope(value)`
   - `isReplyEnvelope(value)`

2. Implement error class in `common/async-messaging.js`:
   - `class MessageRequestError extends Error`
   - fields: `code`, `type`, `tabId`, `frameId`, `timeoutMs`, `details`

3. Implement request wrappers:
   - `requestRuntime(message, options = {})`
   - `requestTab(tabId, message, options = {})`
   - `requestContent(tabId, message, options = {})` as a named alias around
     `requestTab` with `frameId: 0` default.
   - `requestWithChromeCallback(startSend, message, options)` internal helper.

4. Implement timeout racing:
   - Create timeout only when `timeoutMs > 0`.
   - Clear timeout in every settle path.
   - Reject with `MessageRequestError` on timeout.

5. Implement failure normalization:
   - Chrome `runtime.lastError` rejects.
   - Missing response rejects when `expectsReply !== false`.
   - Response `{ ok: false }` rejects.
   - Response success resolves with `result` unless `options.fullResponse` is
     true.

6. Preserve existing compatibility initially:
   - Do not convert every call site in this phase.
   - Existing `utils.sendRuntimeMessage` may continue returning old response
     objects until callers are migrated.
   - Add a TODO comment only in the wrapper file, not scattered across callers.

Tests to add:

1. Runtime success resolves result.
2. Runtime `{ ok: false }` rejects with code and message.
3. Runtime `lastError` rejects.
4. Timeout rejects and clears timer.
5. Missing response rejects when reply expected.
6. `expectsReply: false` resolves when Chrome reports no error.
7. Tab message success includes tabId/frameId in error context on failure.

Commands:

1. `node --test tests/async-messaging.test.js tests/utilities-runtime.test.js`
2. `npm test`

Commit expectation:

- Commit only this messaging foundation.
- Suggested message: `feat(messaging): add acknowledged async request wrapper`.

## Phase 2: Background Command Router And Tab Runtime

Goal: make the service worker the formal command headquarters without moving all
workflows yet.

Files to add or edit:

1. Add `background/command-router.js`.
2. Add `background/tab-runtime.js`.
3. Add `tests/background-command-router.test.js`.
4. Edit `background.js` to use the router for new and migrated commands.

Implementation steps:

1. Create `TabRuntime` records keyed only by normalized tabId:

```js
{
  tabId,
  contentReady: false,
  contentSessionId: "",
  mode: "idle" | "silent" | "marking" | "inspection",
  operation: null,
  spinnerQueue: new Map(),
  lifecycle: null,
  pageWorld: { ready: false, nonce: "" },
  lastKnownContentState: null
}
```

2. Export helpers from `background/tab-runtime.js`:
   - `normalizeTabId(value)`
   - `getTabRuntime(tabId)`
   - `deleteTabRuntime(tabId)`
   - `updateTabRuntime(tabId, patch)`
   - `getTabRuntimeSnapshot(tabId)`

3. Move existing tab-scoped maps gradually into `TabRuntime`.
   - Do not move all maps in one commit.
   - First migrate only new command router state and keep old maps bridged.

4. Create command router:
   - `registerBackgroundCommand(type, handler)`
   - `dispatchBackgroundCommand(message, sender)`
   - `createCommandContext(message, sender)`

5. Keep legacy `chrome.runtime.onMessage` branches working.
   - New router should be called first only for known command-envelope types.
   - Existing branches remain until each workflow migrates.

6. Add command ledger per tab:
   - Store last 50 command summaries per tab.
   - Fields: id, type, startedAt, finishedAt, durationMs, status, errorCode.
   - Gate payload logging behind `DEBUG_FLAGS.fullWorldMessagingLogging`.

Tests to add:

1. Unknown command returns/rejects clear `handler_not_found`.
2. Missing tabId for tab command fails.
3. Two tab IDs with same URL produce separate runtimes.
4. Command ledger records success and failure separately per tab.
5. Deleting one tab runtime does not affect another tab runtime.

Commands:

1. `node --test tests/background-command-router.test.js`
2. `npm test`

Commit expectation:

- Suggested message: `feat(background): add tab-scoped command router`.

## Phase 3: Service-Worker Spinner Authority

Goal: make spinners async operation wrappers owned by the service worker.

Files to add or edit:

1. Add or extract `background/spinner-operations.js`.
2. Edit background spinner helpers currently in `background.js`.
3. Edit popup spinner rendering code only after background wrapper exists.
4. Add `tests/background-spinner-operations.test.js`.

Implementation steps:

1. Extract background spinner queue helpers without behavior change:
   - `getSpinnerQueueForTab`
   - `serializeSpinnerQueue`
   - `setBackgroundSpinnerEntry`
   - `removeBackgroundSpinnerEntry`
   - `clearBackgroundSpinnerQueue`

2. Add `withTabSpinner(tabId, descriptor, work)`:

```js
export async function withTabSpinner(tabId, descriptor, work) {
  const key = descriptor.key || crypto.randomUUID();
  await setSpinner(tabId, key, descriptor);
  try {
    return await work({ key, update: (patch) => updateSpinner(tabId, key, patch) });
  } finally {
    await removeSpinner(tabId, key);
  }
}
```

3. Spinner descriptor fields:
   - `key`
   - `message`
   - `owner`
   - `reason`
   - `source`
   - `persistent`
   - `startedAt`

4. Rules:
   - `work` must be a function returning a Promise.
   - Spinner set/update/remove must be awaited.
   - Removal must happen in `finally`.
   - Failure must rethrow after cleanup.
   - Popup must render background snapshots; popup must not be authoritative.

5. Keep popup fail-open watchdog temporarily.
   - Do not remove it until all popup-owned spinners have migrated.
   - Mark it as compatibility fallback in comments.

6. First migration candidate:
   - Migrate one low-risk popup command that already goes through background,
     not marking enable yet.
   - Confirm popup displays spinner from broker state.

Tests to add:

1. Successful work removes spinner.
2. Failed work removes spinner and rethrows.
3. Spinner update resets started/progress metadata as expected.
4. Two tabs using same key do not conflict.
5. Persistent spinner survives popup disconnect but not tab cleanup.

Commands:

1. `node --test tests/background-spinner-operations.test.js tests/world-trace-contract.test.js`
2. `npm test`

Commit expectation:

- Suggested message: `feat(background): centralize async spinner operations`.

## Phase 4: Content Command Executor Boundary

Goal: make content-main a command executor with explicit command handlers while
keeping marking/highlighting logic in content.

Files to add or edit:

1. Add `content/content-command-router.js`.
2. Edit `content-main.js` to register handlers.
3. Add `tests/content-command-router.test.js`.

Implementation steps:

1. Create content command registry:
   - `registerContentCommand(type, handler)`
   - `dispatchContentCommand(message, sender)`
   - Normalize replies into the shared envelope.

2. Register handlers for existing message types without changing behavior:
   - `activateContentMain`
   - `getInspectionStatus`
   - `setEnabled`
   - `runRenderModeRevealOnce`
   - `hideConsentForInspection`
   - `captureRenderModeInspectionHtml`

3. Do not rename all message strings at once.
   - First wrap old names in the router.
   - Later phases replace callers with exported constants.

4. Enforce content ownership:
   - Consent removal implementation remains in `content/core.js`.
   - Marking rules remain in `content/core.js` and pure content modules.
   - Page inspection UI remains in content.

5. Add handler context:
   - tabId from sender when available
   - frameId
   - pageUrl
   - current content mode
   - helper `replyOk(result)` / `replyFail(code, error)`

Tests to add:

1. Unknown command fails with `handler_not_found`.
2. Handler async success returns success envelope.
3. Handler thrown error returns failure envelope.
4. `setEnabled` still blocks when property lock says interaction blocked.
5. `setEnabled` still clears silent highlighting before marking enable.

Commands:

1. `node --test tests/content-command-router.test.js tests/content-activation-order.test.js`
2. Focused core guard suite from Phase 0.
3. `npm test`

Commit expectation:

- Suggested message: `feat(content): route page commands through executor`.

## Phase 5: Page-World Relay Through Content

Goal: route page-world requests through a small content relay so page-world code
only executes service-worker-requested functions and replies.

Files to add or edit:

1. Add `common/page-world-protocol.js`.
2. Add `content/page-world-relay.js`.
3. Edit `common/page-motion-freeze-bridge.js` carefully.
4. Edit `common/page-motion-freeze-control.js` only if keeping byte-identical
   contract requires it.
5. Edit `content/core.js` reveal/freeze calls only after relay tests exist.
6. Add or update page-world relay tests.

Implementation steps:

1. Define page-world command constants:
   - `PAGE_WORLD_ARM`
   - `PAGE_WORLD_SET_MOTION_PAUSED`
   - `PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED`
   - `PAGE_WORLD_DESTROY`

2. Build content relay:
   - Generate a per-content-session nonce.
   - Send `window.postMessage` requests with nonce and request id.
   - Listen for replies with matching nonce and id.
   - Timeout and reject if page world does not reply.
   - Keep allowed command list small.

3. Update page-world bridge:
   - At document_start, arm the page-world handler.
   - Accept only requests with the active nonce/session.
   - Execute only known command names.
   - Reply with success/failure envelope.

4. Convert freeze/lazy-loading suppression:
   - Content must no longer directly rely on background `pageMotionFreezeControl`
     as the final architecture.
   - Transitional step allowed: keep background direct executeScript as fallback
     while relay stabilizes.
   - Final flow should be:
     service worker command -> content relay -> page world function -> reply ->
     content -> service worker.

5. Protect lazy-loading stopping explicitly:
   - `PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED true` must be acknowledged before
     reveal continues into the lazy-load phase when the reveal code requires it.
   - `PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED false` must run in `finally` even
     if reveal is cancelled, times out, or fails.
   - Add a regression test that fails if restore is not in a finally path.
   - Add a functional test that the suppress command and restore command are
     both sent in order.

Tests to add/update:

1. Relay accepts only matching nonce.
2. Relay rejects unknown command.
3. Relay timeout rejects clearly.
4. Lazy-loading suppression sends true before the relevant reveal scroll phase.
5. Lazy-loading suppression sends false in finally on success.
6. Lazy-loading suppression sends false in finally on thrown/cancelled reveal.
7. Existing `tests/page-motion-freeze-bridge.test.js` still passes.
8. Existing `tests/core-motion-pause.test.js` still passes.

Commands:

1. `node --test tests/page-motion-freeze-bridge.test.js tests/page-motion-bridge-isolation.test.js tests/core-motion-pause.test.js`
2. Focused core guard suite from Phase 0.
3. `npm test`

Commit expectation:

- Suggested message: `feat(page-world): relay motion commands through content`.

## Phase 6: Migrate Popup Workflows To Background Commands

Goal: popup becomes an intent sender and UI renderer. Background orchestrates.

Migration order is mandatory. Do not skip ahead.

### 6A: Popup state snapshot only

1. Add background command `POPUP_GET_TAB_VIEW_STATE` or equivalent.
2. Popup startup requests one tab-scoped snapshot from background.
3. Snapshot includes:
   - active tab
   - content ready
   - current mode
   - spinner/lifecycle state
   - tab state
   - feature/debug flags
4. Popup still calculates display-only derived view state.
5. Popup does not send content commands in this step.

Tests:

1. Snapshot for tab A does not include tab B state.
2. Popup applies snapshot without mutating background.

Commit: `feat(popup): load tab view state from background`.

### 6B: Marking activation

1. Add background command `TAB_ACTIVATE_MARKING`.
2. Popup Enable handler sends only this command with required user intent:
   - selected baseUrl
   - pageType
   - current tabId
3. Background validates:
   - tabId exists
   - tab URL is allowed
   - desktop preview is not blocking marking
   - property lock permits editing when enabled
   - mobile simulation is ready or commanded
4. Background wraps operation in `withTabSpinner`.
5. Background commands content:
   - bootstrap content
   - apply mobile simulation if needed
   - content activate marking with `performInitialReveal: true`
6. Content executes existing `core.enableForBaseUrl` path.
7. Content emits lifecycle events.
8. Background updates tab runtime mode after acknowledged content success.
9. Popup renders result from background state.

Do not change marking rules in this phase.

Tests:

1. Popup Enable handler does not call `chrome.tabs.sendMessage` directly.
2. Background activation sends content command to the requested tabId only.
3. Two same-URL tabs activate independently.
4. Failed mobile simulation removes spinner.
5. Failed content activation removes spinner and reports clear reason.
6. Existing marking activation order tests still pass.

Commands:

1. `node --test tests/content-activation-order.test.js tests/background-command-router.test.js tests/background-spinner-operations.test.js`
2. Focused core guard suite from Phase 0.
3. `npm test`

Commit: `feat(background): orchestrate marking activation`.

### 6C: Marking deactivation

1. Add background command `TAB_DEACTIVATE_MARKING`.
2. Popup Disable handler sends only this command.
3. Background validates save/discard safety rules before deactivation.
4. Background commands content deactivate.
5. Background clears tab mode and spinners.

Tests:

1. Deactivation blocked when save/discard contract blocks it.
2. Content receives command only for target tab.
3. Spinner cleanup happens on failure.

Commit: `feat(background): orchestrate marking deactivation`.

### 6D: Render-mode inspection

1. Add background commands:
   - `TAB_BEGIN_RENDER_MODE_INSPECTION`
   - `TAB_RUN_REVEAL_FREEZE`
   - `TAB_CAPTURE_RENDER_MODE_HTML`
   - `TAB_END_RENDER_MODE_INSPECTION`
2. Popup render-mode UI sends one high-level command.
3. Background orchestrates reload, content-ready wait, reveal/freeze, capture,
   consent hiding, and final state update.
4. Content executes reveal/freeze/capture only on command.
5. Page-world lazy-loading suppression remains protected.

Tests:

1. Reveal/freeze runs after content-ready acknowledgement.
2. Capture does not run if reveal fails.
3. Consent hiding order remains after capture where current contract requires it.
4. Lazy-loading suppression restore still happens on failure.

Commit: `feat(background): orchestrate render-mode inspection`.

### 6E: AI run

1. Add background command `TAB_RUN_AI`.
2. Popup Run AI sends intent only.
3. Background owns spinner/countdown operation state.
4. Content provides DOM snapshots only when explicitly commanded.
5. Large payloads use storage/cache keys, not direct multi-hop runtime payloads.

Tests:

1. AI run starts spinner before payload preparation.
2. Current page unsaved local markings are captured before AI request.
3. Large payload path uses storage key.
4. Failure cleans compute lock/spinner.

Commit: `feat(background): orchestrate ai run command`.

### 6F: Save, discard, preview, and send surfaces

Migrate in this order:

1. Save Session.
2. Discard Session.
3. Preview Contents in marking mode.
4. Silent Preview Contents.
5. Send to Lynx.

Each migration must preserve the documented mode gates from
MARKING_AND_HIGHLIGHTING_LOGIC.md.

Commit in separate slices when possible.

## Phase 7: Remove Direct Popup-To-Content Authority

Goal: prevent regression into distributed authority.

Steps:

1. Add an architecture guard test that scans popup files for direct
   `chrome.tabs.sendMessage` usage.
2. Allowlist only the centralized messaging module during migration.
3. After migration, remove the allowlist for popup direct tab messaging.
4. Make popup/messages.js runtime-only or delete it if no longer needed.
5. Update README architecture note to:
   `Popup <-> Service Worker <-> Content <-> Page World`.

Tests:

1. Popup files cannot call `chrome.tabs.sendMessage` outside the approved helper.
2. Popup handlers for core workflows call background commands only.
3. Existing full suite passes.

Commit: `refactor(popup): remove direct content orchestration`.

## Phase 8: Test Suite Upgrade

Goal: reduce fragile source-shape tests and replace them with behavioral guards.

Classification rules:

1. Keep source-shape tests only for structural constraints, such as:
   - page-motion bridge byte identity
   - manifest/web-accessible resource allowlist
   - forbidden imports or forbidden direct messaging
   - documented architecture boundaries

2. Replace source-shape tests when they only assert syntax shape, such as:
   - `assert.match(source, /function name/)`
   - `assert.match(source, /if \(message.type === .../)`
   - tests that pass after renaming without proving behavior

3. Preferred replacements:
   - pure function tests
   - fake Chrome API tests
   - command router tests
   - tab runtime reducer tests
   - content command handler tests
   - page-world relay tests

Implementation steps:

1. Create a test inventory document or section in the handoff listing:
   - keep
   - replace
   - delete after replacement
2. Convert tests one feature at a time.
3. Never delete a source-shape test until the replacement behavioral test fails
   on the old broken behavior or clearly guards the same regression.
4. Prefer Node's built-in `node:test` unless a DOM harness is already available.
5. Do not add jsdom or another dependency without a separate explicit commit and
   justification.

Commands:

1. Run replacement test directly.
2. Run related focused suite.
3. Run `npm test` before deleting old tests.

Commit pattern:

- `test(messaging): replace source-shape guard with behavior test`
- `test(background): add tab isolation command coverage`

## Phase 9: Tab Isolation Hardening

Goal: prove no command leaks across tabs.

Tests to add:

1. Two tab runtimes with the same URL have separate modes.
2. Spinner in tab A is invisible to tab B.
3. Content lifecycle event from tab A updates only tab A.
4. Page-world command for tab A cannot resolve against tab B.
5. Property/site ID shared by two tabs does not merge tab UI state.
6. Popup bound to debugTabId only reads that tab runtime.
7. Tab removal deletes only that tab runtime.

Implementation notes:

1. Shared property-lock state can remain property-scoped, but tab UI/mode state
   must remain tab-scoped.
2. Any helper accepting URL/baseUrl/propertyId must also accept tabId when it
   affects UI mode, spinners, lifecycle, or content activation.

Commit: `test(background): guard tab-scoped command isolation`.

## Phase 10: Cleanup And Documentation

Goal: remove migration shims and leave a clean codebase.

Steps:

1. Remove old direct popup-to-content helpers.
2. Remove legacy message names that have command constants replacements.
3. Remove temporary compatibility comments and allowlists.
4. Update README architecture notes.
5. Update MARKING_AND_HIGHLIGHTING_LOGIC.md only if behavior changed. It should
   not change for this refactor unless a protected contract had to be clarified.
6. Update `.copilot/knowledge.md` with verified architecture lessons.
7. Run full validation.

Final validation commands:

1. `npm test`
2. Focused core guard suite from Phase 0.
3. Messaging/router focused tests.
4. If live browser environment is available, run the existing headed extension
   smoke from `.copilot/handoff-core-hotfix.md` for marking enable, render-mode
   inspection, silent highlighting, and spinner cleanup.

Final commit:

- Suggested message: `refactor: centralize tab command authority in service worker`.

## Implementation Workflow Rules

Use this workflow for every phase.

1. Start from a clean tree.
   - `git status --short`

2. Sync before work.
   - `git fetch origin`
   - `git pull --ff-only`

3. Use a branch for implementation.
   - `git switch -c refactor/service-worker-authority` if not already on it.

4. Make one conceptual change per commit.
   - Messaging foundation is one commit.
   - Router foundation is one commit.
   - Each workflow migration is one commit or smaller.

5. Do not mix refactor and behavior changes.
   - If behavior must change, write that down and add a failing test first.

6. Run focused tests before full tests.
   - Use the phase-specific tests above.

7. Run `npm test` before every push unless the commit is docs-only.
   - For docs-only, run `git diff --check` at minimum.

8. Inspect diff before commit.
   - `git diff --stat`
   - `git diff --check`
   - `git diff -- <files>` for touched files.

9. Commit style.
   - Use existing conventional style:
     - `feat(scope): ...`
     - `refactor(scope): ...`
     - `test(scope): ...`
     - `docs(scope): ...`
   - Keep message specific and short.

10. Push after each stable commit.
    - `git push -u origin <branch>` first time.
    - `git push` after that.

11. Never push failing tests unless the commit is explicitly a failing-test
    checkpoint and the user approved that checkpoint. Default is no failing
    pushes.

12. If interrupted, update the handoff before stopping.
    - State exact commit.
    - State tests run.
    - State next step.
    - State blockers.

## Do Not Do These Things

1. Do not move marking rules out of content/core.js or pure content modules as
   part of authority refactor.
2. Do not change the 052c-derived marking contract.
3. Do not make popup the owner of any tab mode.
4. Do not let content command another tab.
5. Do not add cross-layer polling to wait for state.
6. Do not use URL/baseUrl/propertyId as a substitute for tabId in mode state.
7. Do not route heavy HTML/AI payloads through multiple runtime messages.
8. Do not delete source-shape tests before behavioral replacements exist.
9. Do not remove popup spinner watchdog until service-worker spinner authority
   covers every spinner-producing operation.
10. Do not remove the existing page-motion bridge until lazy-loading suppression
    success and cleanup are functionally covered.

## Acceptance Criteria For The Whole Refactor

The refactor is complete only when all are true:

1. Popup sends high-level intents to background for core workflows.
2. Background owns tab runtime, command routing, lifecycle, and spinner state.
3. Content exposes a small command executor boundary.
4. Page-world commands go through the content relay or an explicitly documented
   temporary compatibility path.
5. The protected 11 always-on behaviors pass focused tests.
6. Lazy-loading stopping is tested for activation and cleanup.
7. Same URL in two tabs has isolated mode, spinner, lifecycle, and page-world
   command state.
8. Most source-shape tests that guarded behavior have been replaced by behavior
   tests.
9. Full `npm test` passes.
10. README and `.copilot/knowledge.md` reflect the new authority model.
