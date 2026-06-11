# Content Main Follow-Up Refactor Plan

Last updated: 2026-06-11
Status: READY FOR IMPLEMENTATION
Scope: successor plan after `.copilot/world-decomposition-plan.md`

## Purpose

The world decomposition program reduced the three original monoliths and created
content-side seams for page telemetry, remote-support client state, and property
lock banner rendering. The remaining editable monolith is still
`content-main.js` at roughly 9k lines, but much of that file is protected
marking, silent-highlighting, visibility, and reconciliation logic. This plan
continues only where the seams are explicit and low enough risk.

This document is intentionally mechanical. A less capable agent should be able to
follow it without inventing module shapes, renaming concepts, or touching locked
logic. If a step does not match the current source, stop and record the mismatch
in `.copilot/handoff-world-decomposition.md` before editing code.

## Current Known State

Current baseline at plan authoring:

- Branch: `main`
- Last reviewed commit: `c6e49c7 refactor(content): extract property lock banner`
- Full validation: `npm test` -> 840 pass / 0 fail
- `remoteSupport`: disabled by default in `common/feature-flags.js`
- `propertyLockCollaboration`: disabled by default in `common/feature-flags.js`
- New content modules already web-accessible:
  - `content/page-telemetry-bridge.js`
  - `content/remote-support-client.js`
  - `content/property-lock-banner.js`

## Program Rules

1. Do not edit `content/core.js`.
2. Do not edit marking, silent-highlighting, visibility, page-save
   reconciliation, XPath, or AI submission behavior unless the user explicitly
   requests a separate high-risk marking-contract plan.
3. Keep one phase per commit.
4. Each phase must run focused validation and then full `npm test`.
5. Live harness debugging is required only when touching core unflagged user
   behavior and the implementation cannot be confidently validated by focused and
   full automated tests. Flag-gated remote-support and property-lock work may
   record live validation as deferred until those features are prioritized.
6. Every new `content/*` module imported by `content-main.js` must be listed in
   `manifest.json` `web_accessible_resources.resources` in the same commit.
7. Do not add `content/*.js` or `common/*.js` wildcards to the manifest.
8. Do not introduce a shared mutable `content/state.js` bucket. If state must
   cross a module boundary, inject narrow getters/setters or a factory object.
9. Do not change message names, payload field names, storage keys, timeouts,
   retry counts, or user-facing copy except where a phase explicitly says so.
10. Do not commit generated browser profiles, screenshots, orchestration runs,
    debug JSON, local secrets, or MCP artifacts.

## Standard Phase Procedure

Run these commands before every phase:

```bash
git status --short --branch
git pull --ff-only
npm test
```

If the tree is dirty before you edit, stop and identify whether the change is
yours. Do not revert user changes.

For each phase:

1. Read the source ranges named by the phase.
2. Search for all named functions and tests before editing.
3. Make the smallest behavior-preserving move.
4. Add or update source-contract and unit tests in the same commit.
5. Add any new `content/*` import to `manifest.json`.
6. Run the focused validation listed for the phase.
7. Run `npm test`.
8. Update `.copilot/handoff-world-decomposition.md` with results.
9. Commit with the exact commit message listed for the phase.
10. Push.

Useful searches:

```bash
rg -n "function initializeRemoteSupportSupportPageViewer|function ensureRemoteSupportSupportPageUi|function renderRemoteSupportSupportPage|function updatePropertyLockBannerMode" content-main.js
rg -n "from \"\./content/|web_accessible_resources|content/.*\.js" content-main.js manifest.json tests/manifest-permissions.test.js
rg -n "readFileSync\(new URL\(\"\.\./content-main\.js\"|contentSource" tests
```

## Stop Conditions

Stop and ask the user before continuing if any of these occur:

1. A phase appears to require edits to `content/core.js`.
2. A phase appears to require changes to marking or silent-highlighting behavior.
3. A focused test fails for a reason that is not a simple source-contract drift
   from the intended move.
4. `npm test` fails after your edits and the failure is not obviously caused by
   the phase.
5. A new content module would need to import `content-main.js`.
6. A module cycle appears.
7. You need live validation for a core unflagged workflow and cannot complete it
   without manual help.

# PRE PHASE - Reconcile Plan, Handoff, and Scope

The pre phase is documentation and safety setup before any code refactor. It
exists because the completed Track C work intentionally narrowed some original
plan scope after remote-support/property-lock live validation was deprioritized.

## PRE0 - Verify Current Baseline

Goal: prove that the next implementation starts from a clean and understood
state.

Files to read:

- `.copilot/world-decomposition-plan.md`
- `.copilot/handoff-world-decomposition.md`
- `.copilot/knowledge.md`
- `common/feature-flags.js`
- `manifest.json`
- `tests/manifest-permissions.test.js`

Commands:

```bash
git status --short --branch
git log --oneline -8
npm test
rg -n "remoteSupport:|propertyLockCollaboration:" common/feature-flags.js
rg -n "content/page-telemetry-bridge.js|content/remote-support-client.js|content/property-lock-banner.js" manifest.json
```

Expected results:

- `git status --short --branch` shows `## main...origin/main` and no file
  changes.
- Recent history includes:
  - `c6e49c7 refactor(content): extract property lock banner`
  - `60ee4df refactor(content): extract remote support client`
  - `0e8bf99 refactor(content): extract page telemetry bridge`
- `npm test` passes with 0 failures.
- `remoteSupport` is `false`.
- `propertyLockCollaboration` is `false`.
- All three extracted content modules are in `web_accessible_resources`.

If any expected result differs, update the handoff with the discrepancy and stop.

## PRE1 - Correct Documentation Drift

Goal: make the repository documents say one consistent thing.

Required document state:

1. `.copilot/world-decomposition-plan.md` is historical and complete. It must no
   longer claim implementation has not started.
2. `.copilot/handoff-world-decomposition.md` is current. It must say Track A,
   Track B, and the implemented Track C peripheral slices are complete.
3. The handoff must record:
   - `c6e49c7 refactor(content): extract property lock banner`
   - `60ee4df refactor(content): extract remote support client`
   - `0e8bf99 refactor(content): extract page telemetry bridge`
   - current `npm test` result
4. The handoff must point to this file as the next active plan.
5. `.copilot/knowledge.md` must not say `.copilot/world-decomposition-plan.md` is
   the next active architecture track. It should point to this plan instead.
6. The old Track C live-gate wording should be treated as historical. The active
   policy is:
   - core unflagged behavior requires live validation when confidence is not high
   - flag-gated remote-support/property-lock work may defer live validation until
     those features are prioritized

Validation:

```bash
rg -n 'No implementation has started|Commit:  pending|Commit and push Track C|next architecture track is `\.copilot/world-decomposition-plan\.md`' \
   .copilot/world-decomposition-plan.md \
   .copilot/handoff-world-decomposition.md \
   .copilot/knowledge.md
```

Expected result:

- No stale line implies the completed world-decomposition work still needs to be
  committed or is still the next active architecture track.

Commit message if PRE1 is committed separately:

```text
docs(copilot): add content follow-up refactor plan
```

# ACTUAL REFACTOR PLAN

The actual refactor plan starts only after PRE0 and PRE1 are complete.

## Track D - Remote Support Content Follow-Up

Risk: medium, but feature-gated by `FEATURE_FLAGS.remoteSupport === false`.
Live validation may be deferred unless the user reprioritizes remote support.

### Phase D0 - Remote Support Client Runtime Dependency Injection

Why this phase exists:

`content/remote-support-client.js` still calls `chrome.runtime.sendMessage`
directly. That is behavior-preserving, but it makes the module less testable and
less consistent with the dependency-injection style used by the other extracted
content modules.

Files:

- `content/remote-support-client.js`
- `content-main.js`
- `tests/content-remote-support-client.test.js`

Do not edit:

- `background.js`
- `common/remote-support.js`
- `remote-support-offscreen.js`
- `remote-support-viewer.js`

Steps:

1. Open `content/remote-support-client.js`.
2. Find `syncSessionStateFromBackground`.
3. Replace the direct call:

   ```js
   const response = await chrome.runtime.sendMessage({
     type: "getRemoteSupportState"
   });
   ```

   with:

   ```js
   const response = await deps.requestRemoteSupportState();
   ```

4. Do not change error handling. Keep the existing `try/catch` and ignore
   transient failures exactly as-is.
5. Open `content-main.js`.
6. Find `createRemoteSupportClient({ ... })` inside `getRemoteSupportClient()`.
7. Add one dependency:

   ```js
   requestRemoteSupportState: () => chrome.runtime.sendMessage({
     type: "getRemoteSupportState"
   }),
   ```

8. Open `tests/content-remote-support-client.test.js`.
9. Extend `createClientDeps` so it accepts `stateResponses = []` and
   `stateRequests = []`.
10. Add a default dependency:

   ```js
   async requestRemoteSupportState() {
     stateRequests.push("getRemoteSupportState");
     return stateResponses.length ? stateResponses.shift() : { ok: true, state: null };
   }
   ```

11. Add a test named exactly:

   ```text
   remote support client syncs initial state through injected runtime request
   ```

12. In that test:
   - install the DOM harness
   - create the client with `stateResponses: [{ ok: true, state: { active: true, mode: "being_supported", role: "requester", includePayloads: true } }]`
   - call `await client.syncSessionStateFromBackground()`
   - assert one state request was recorded
   - assert mode is `being_supported`
   - assert role is `requester`
   - assert include payloads is `true`

Focused validation:

```bash
npm test -- tests/content-remote-support-client.test.js tests/content-decomposition-boundary.test.js
```

Full validation:

```bash
npm test
```

Live validation:

- Deferred by policy while `remoteSupport` is false.

Commit message:

```text
refactor(content): inject remote support state request
```

### Phase D1 - Remote Support Viewer Transport Module

Why this phase exists:

`content-main.js` still owns the support-page viewer port, ready waiters,
pending request map, and frame/video transport glue. This is a coherent domain
that can move without touching marking logic.

New module:

- `content/remote-support-viewer-client.js`

Files:

- `content-main.js`
- `content/remote-support-viewer-client.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/manifest-permissions.test.js`
- Add `tests/content-remote-support-viewer-client.test.js`

Functions/state to move from `content-main.js` into the new module:

- `getRemoteSupportSupportPageViewerOrigin`
- `resolveRemoteSupportSupportPageViewerWaiters`
- `clearRemoteSupportSupportPageViewerPendingRequests`
- `syncRemoteSupportSupportPageViewerVisibility`
- `updateRemoteSupportSupportPageViewerVideoState`
- `isRemoteSupportFrameBitmap`
- `closeRemoteSupportFrameBitmap`
- `resetRemoteSupportSupportPageViewerConnection`
- `handleRemoteSupportSupportPageViewerPortMessage`
- `initializeRemoteSupportSupportPageViewer`
- `waitForRemoteSupportSupportPageViewerReady`
- `sendRemoteSupportSupportPageViewerRequest`

State to move into the new factory module:

- `remoteSupportSupportPageViewerPort`
- `remoteSupportSupportPageViewerReady`
- `remoteSupportSupportPageViewerReadyWaiters`
- `remoteSupportSupportPageViewerRequestId`
- `remoteSupportSupportPageViewerPendingRequests`
- `remoteSupportSupportPageViewerIntrinsicWidth`
- `remoteSupportSupportPageViewerIntrinsicHeight`
- `remoteSupportSupportPageViewerVideoActive`

Factory shape:

```js
export function createRemoteSupportViewerClient(deps) {
  // moved state here
  // moved functions here
  return {
    getIntrinsicHeight,
    getIntrinsicWidth,
    isVideoActive,
    initializeViewer,
    resetConnection,
    sendRequest,
    syncVisibility,
    updateVideoState
  };
}
```

Dependency object from `content-main.js` must include only these hooks/values:

```js
{
  getViewerOrigin,
  getViewerFrame,
  getViewerElement,
  onFrameMessage,
  renderFrame,
  sendRuntimeMessageSafely,
  updateStateFromBackground,
  REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH,
  REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS
}
```

Mechanical wiring steps:

1. Create `content/remote-support-viewer-client.js`.
2. Move the state variables listed above into the factory.
3. Move the functions listed above into the factory with names preserved where
   possible.
4. In `content-main.js`, add:

   ```js
   import { createRemoteSupportViewerClient } from "./content/remote-support-viewer-client.js";
   ```

5. Add `let remoteSupportViewerClient = null;` near the other remote-support
   support-page state.
6. Add `getRemoteSupportViewerClient()` in `content-main.js`.
7. Recreate old function names in `content-main.js` as thin delegates only where
   existing call sites still use them. Example:

   ```js
   function sendRemoteSupportSupportPageViewerRequest(requestType, payload = {}) {
     return getRemoteSupportViewerClient().sendRequest(requestType, payload);
   }
   ```

8. Do not move `ensureRemoteSupportSupportPageUi` yet.
9. Do not move `renderRemoteSupportSupportPage` yet.
10. Add `content/remote-support-viewer-client.js` to `manifest.json`.
11. Update `tests/content-decomposition-boundary.test.js` to assert the import.
12. Add source guards that `content-main.js` no longer defines the moved viewer
    transport internals.
13. Add unit tests for the new factory:
    - ready message resolves waiters
    - request timeout resolves `{ ok:false, error:"Remote support viewer timed out" }`
    - transport event forwards via `sendRuntimeMessageSafely`
    - video-state message updates active/width/height

Focused validation:

```bash
npm test -- tests/content-remote-support-viewer-client.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-remote-support-client.test.js
```

Full validation:

```bash
npm test
```

Live validation:

- Deferred by policy while `remoteSupport` is false.
- If the user reprioritizes remote support before this phase, run the manual
  remote-support live harness after automated tests.

Commit message:

```text
refactor(content): extract remote support viewer client
```

### Phase D2 - Remote Support Support-Page UI Module

Why this phase exists:

After D1, the remaining `/support` page UI functions in `content-main.js` form a
separate surface: state normalization, styles, fullscreen controls, frame render,
and page initialization.

New module:

- `content/remote-support-support-page.js`

Files:

- `content-main.js`
- `content/remote-support-support-page.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/manifest-permissions.test.js`
- Add `tests/content-remote-support-support-page.test.js`

Functions to move:

- `createRemoteSupportSupportPageState`
- `normalizeRemoteSupportSupportPageState`
- `isRemoteSupportSupportPage`
- `ensureRemoteSupportSupportPageStyles`
- `buildRemoteSupportSupportPageStatusText`
- `buildRemoteSupportSupportPageSurfaceText`
- `getRemoteSupportSupportPageSurfaceRect`
- `handleRemoteSupportSupportPageEnd`
- `dismissRemoteSupportSupportPageError`
- `syncRemoteSupportSupportPageDockState`
- `syncRemoteSupportSupportPageFullscreenState`
- `toggleRemoteSupportSupportPageFullscreen`
- `ensureRemoteSupportSupportPageUi`
- `syncRemoteSupportSupportPageFrame`
- `scheduleRemoteSupportSupportPageFrameRender`
- `renderRemoteSupportSupportPage`
- `applyRemoteSupportSupportPageState`
- `refreshRemoteSupportSupportPageState`
- `initializeRemoteSupportSupportPage`

State to move into the new factory module:

- `remoteSupportSupportPageTabId`
- `remoteSupportSupportPageState`
- `remoteSupportSupportPageLastFrame`
- `remoteSupportSupportPageRenderedFrame`
- `remoteSupportSupportPageElements`
- `remoteSupportSupportPageFullscreenActive`

Factory shape:

```js
export function createRemoteSupportSupportPage(deps) {
  // moved state here
  return {
    applyState,
    getTabId,
    handleFrameMessage,
    initialize,
    isSupportPage,
    refreshState,
    render,
    sendViewerRequest
  };
}
```

Dependencies:

```js
{
  isRemoteSupportFeatureEnabled,
  getViewerClient,
  sendRuntimeMessageSafely,
  formatRemoteSupportCountdown,
  normalizeRemoteSupportDockState,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE,
  REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR,
  REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID,
  REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID,
  REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID,
  REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID,
  REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_FRAME_ID
}
```

Do not move message listener branches yet. Instead, delegate from them:

```js
if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportFrame") {
  getRemoteSupportSupportPage().handleFrameMessage(message);
  sendResponse({ ok: true });
  return;
}
```

Focused validation:

```bash
npm test -- tests/content-remote-support-support-page.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/property-lock-render-mode.test.js tests/page-telemetry.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract remote support support page
```

## Track E - Property Lock Content Follow-Up

Risk: medium to high, but feature-gated by
`FEATURE_FLAGS.propertyLockCollaboration === false`. Live validation may be
deferred unless the user reprioritizes property-lock collaboration.

### Phase E0 - Property Lock Banner Mode Operation

Why this phase exists:

`content/property-lock-banner.js` now renders the banner, but
`updatePropertyLockBannerMode` still lives in `content-main.js`. This is the
remaining planned C3 scope. Move it as an operation while keeping state ownership
in `content-main.js`.

New module:

- `content/property-lock-banner-mode.js`

Files:

- `content-main.js`
- `content/property-lock-banner-mode.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/manifest-permissions.test.js`
- `tests/property-lock.test.js`
- `tests/property-lock-render-mode.test.js`
- Add `tests/property-lock-banner-mode.test.js`

Function to move:

- `updatePropertyLockBannerMode`

Factory is not required. Export one operation:

```js
export function updatePropertyLockBannerMode(deps) {
  // moved body here, using deps accessors and mutators
}
```

Required deps from `content-main.js`:

```js
{
  isPropertyLockCollaborationEnabled,
  clearPropertyLockBannerCountdown,
  restartPropertyLockBannerCountdown,
  clearPropertyLockCrossPropertyWarning,
  clearPropertyLockOffCandidateWarning,
  getPropertyLockRecoveryDeadlineAt,
  getPropertyLockOffCandidateDeadlineAt,
  getPropertyLockState,
  getPropertyLockBannerMode,
  setPropertyLockBannerMode,
  getPropertyLockBannerCountdownValue,
  setPropertyLockBannerCountdownValue,
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS
}
```

Mechanical steps:

1. Create `content/property-lock-banner-mode.js`.
2. Copy the current body of `updatePropertyLockBannerMode` into the exported
   operation.
3. Replace direct variable reads/writes with deps calls.
4. In `content-main.js`, import the operation as
   `updatePropertyLockBannerModeOperation`.
5. Keep a wrapper named `updatePropertyLockBannerMode()` in `content-main.js`:

   ```js
   function updatePropertyLockBannerMode() {
     return updatePropertyLockBannerModeOperation(createPropertyLockBannerModeDeps());
   }
   ```

6. Add `createPropertyLockBannerModeDeps()` near
   `createPropertyLockBannerDeps()`.
7. Add the new module to `manifest.json`.
8. Update source-contract tests so mode-case assertions read from the new module.
9. Add unit tests for at least these cases:
   - disabled feature sets mode to `no_banner` and clears countdown
   - recovery deadline sets `editor_cross_property_countdown`
   - unlocked state sets `no_banner`
   - editor expiry warning sets `editor_inactivity_warning`
   - passive locked state sets `passive_locked`

Focused validation:

```bash
npm test -- tests/property-lock-banner-mode.test.js tests/property-lock.test.js tests/property-lock-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract property lock banner mode
```

### Phase E1 - Property Lock Port Lifecycle Client

Why this phase exists:

The property-lock connect/reconnect/port lifecycle code is a debugging and
stability hotspot. It can be extracted before the full state machine by isolating
port ownership and reconnect timers.

New module:

- `content/property-lock-port-client.js`

Files:

- `content-main.js`
- `content/property-lock-port-client.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/manifest-permissions.test.js`
- Add `tests/property-lock-port-client.test.js`
- Existing `tests/property-lock.test.js`

Move only port lifecycle code in this phase. Do not move banner mode, warning
state, or server-message mode decisions.

Candidate functions to move after rereading current source:

- `clearPropertyLockReconnectTimer`
- `schedulePropertyLockReconnect`
- `connectPropertyLockPort`
- `disconnectPropertyLockPort`
- `handlePropertyLockPortDisconnect`
- port send helper if it only depends on the current port and reconnect hook

Expected factory shape:

```js
export function createPropertyLockPortClient(deps) {
  let port = null;
  let reconnectTimer = 0;
  return {
    clearReconnectTimer,
    connect,
    disconnect,
    getPort,
    hasPort,
    postMessage,
    scheduleReconnect
  };
}
```

Stop if moving these functions requires touching page marking, save
reconciliation, or `content/core.js`.

Focused validation:

```bash
npm test -- tests/property-lock-port-client.test.js tests/property-lock.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract property lock port client
```

### Phase E2 - Property Lock Server Message State Machine

Why this phase exists:

`applyPropertyLockServerMessage` and nearby warning-state helpers are the core of
property-lock debugging. Extracting them behind explicit deps makes state
transitions testable without a browser page.

New module:

- `content/property-lock-state-machine.js`

Files:

- `content-main.js`
- `content/property-lock-state-machine.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/manifest-permissions.test.js`
- Add `tests/property-lock-state-machine.test.js`
- Existing `tests/property-lock.test.js`
- Existing `tests/property-lock-render-mode.test.js`

Candidate functions to move after rereading current source:

- `applyPropertyLockServerMessage`
- `startPropertyLockOffCandidateWarning`
- `clearPropertyLockOffCandidateWarning`
- `startPropertyLockCrossPropertyWarning`
- `clearPropertyLockCrossPropertyWarning`
- `persistPropertyLockOffCandidateDeadline`
- `persistPropertyLockRecoveryState`
- `normalizePropertyLockRecoveryTabState`

Rules:

1. Keep `content-main.js` owning the actual DOM and core interactions.
2. Inject callbacks for rendering, toasts, sending messages, persistence, and
   current render-mode inspection state.
3. Do not change countdown durations.
4. Do not change release timing.
5. Do not change any `PROPERTY_LOCK_*` message type.

Focused validation:

```bash
npm test -- tests/property-lock-state-machine.test.js tests/property-lock.test.js tests/property-lock-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Live validation:

- Deferred while `propertyLockCollaboration` is false.
- If the user reprioritizes property lock, run the existing property-lock smoke
  harness after automated validation.

Commit message:

```text
refactor(content): extract property lock state machine
```

# Track F - Large Protected Content Areas

Do not start Track F without a fresh user approval. This track touches or borders
protected marking/silent-highlight behavior.

Possible future modules, all requiring a separate high-risk plan:

1. `content/ai-preview-client.js`
   - AI preview state and click-target handling.
   - Risk: intersects marking enablement and saved selector state.
2. `content/page-toast.js`
   - Page toast DOM/style helper.
   - Risk: low, but it is shared by marking, property-lock, and save flows.
3. `content/render-mode-inspection-client.js`
   - Render-mode inspection session storage, watchdog, raw HTML fetch, and
     message handlers.
   - Risk: medium to high because it controls motion pause and editor reveal.
4. `content/silent-highlight-overlay.js`
   - Only with explicit marking-contract approval.
   - Risk: high. Do not move casually.

Before any Track F implementation, create a new dedicated plan with:

- exact functions
- exact tests
- live validation procedure
- rollback criteria
- explicit user approval

# Completion Criteria For This Follow-Up Program

The follow-up program is complete when either:

1. Tracks D and E are implemented and pushed with green focused/full validation,
   and flag-gated live validation is either passed or explicitly deferred, or
2. The user chooses to stop after PRE and documentation cleanup, leaving D/E as
   backlog.

At completion:

```bash
git status --short --branch
npm test
rg -n "content/remote-support-viewer-client.js|content/remote-support-support-page.js|content/property-lock-banner-mode.js|content/property-lock-port-client.js|content/property-lock-state-machine.js" manifest.json
```

Expected:

- clean tree
- full tests pass
- every imported content module is web-accessible
