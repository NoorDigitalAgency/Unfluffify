# Track 04 — Render-mode inspection

> Parent plan: `.copilot/event-bus-architecture-plan.md` (master spec, track map
> §7, guardrails §8). Foundation references:
> `.copilot/event-bus/track-00-foundation.md`,
> `.copilot/event-bus/track-01-popup-state-channel.md`,
> `.copilot/event-bus/track-02-spinner-authority.md`, and
> `.copilot/event-bus/track-03-activation-lifecycle-content-bootstrap.md`.
>
> Validation uses the WXT command surface: `pnpm lint`, `pnpm check`,
> `pnpm test`, `pnpm build`, `pnpm browser:live <url>`. No `deno task`
> commands.

## Precondition

- Track 0 is complete and green:
  - `45f6eea` — typed bus core foundation
  - `5d31507` — wired realm skeleton
  - `06ce494` — Track 0 completion and popup self-test
- Track 1 is complete and green:
  - `ca4de7c` — popup-view contracts/projection
  - `557cbf9` — broker -> Brain popup-view mirroring
  - `0cf8d8f` — popup `popup.view.get` / `view.popup` routing
  - `3db82ab` — legacy popup snapshot command/port removal
- Track 2 is complete and green:
  - `12daa13` — type spinner bus contracts
  - `770742f` — add spinner state decider
  - `595b846` — mirror spinner state into Brain
  - `9784f93` — project popup busy from Brain
  - `a41f0c8` — complete spinner authority track
- Track 3 is complete and green:
  - `e5f8522` — Track 3 planning/executor doc
  - `c77c68a` — activation contracts + Brain scaffolding
  - `d01c267` — lifecycle/bootstrap mirroring into Brain activation state
  - `44f3edf` — curtain teardown routed through Brain spinner removal
  - `83e009e` — bypass activation lifecycle broker authority
  - `33e251a` — remove broker activation mirror hooks
  - `091dfc7` — route popup bootstrap through tab command
- Part C is complete and green:
  - `4787295` — hybrid extension messaging adoption
  - `9ba4b84` — WXT runtime adoption closeout
- `pnpm verify` passed at the C9 boundary and the Bonliva live render-mode smoke
  still enters `"Starting render-mode inspection"` instead of failing with
  `"No response"`.

## Approval gate

None — wrap-only; this track relocates render-mode inspection orchestration and
state ownership without changing locked marking, silent-highlighting,
reconciliation, XPath, AI submission, or property-lock behavior.

## Goal

Move render-mode inspection authority into the Brain so popup and content stop
owning the cross-cutting inspection workflow. User-visible behavior must stay
unchanged: the popup still offers **Without JavaScript** and **With JavaScript**,
the no-JS hold still survives service-worker restarts and clears on explicit end
or genuine navigation, consent hiding/capture ordering stays the same, and the
Bonliva live flow still reaches the inspection-start state and subsequent capture
paths with the same timing and result payloads as today.

## Current facts (re-verified this session)

- `background.ts:1594-1886`
  `registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION, ...)`
  is the current authoritative orchestrator. It validates `tabId/baseUrl`,
  normalizes `operationId`, owns the no-JS hold clear/set flow, runs the reload,
  uses `runBackgroundTabOperation(...)` with
  `LIFECYCLE_KINDS.RENDER_MODE_INSPECTION`, hides consent before capture on the
  JS-enabled branch, captures via the debugger on the no-JS branch, and performs
  best-effort `renderModeInspectionEnd` cleanup in `finally`.
- `background.ts:1536-1591`
  `registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_END_RENDER_MODE_INSPECTION, ...)`
  is the explicit exit path. It restores JavaScript when the tab is held in
  no-JS mode, clears the no-JS session key and inactivity watch, conditionally
  detaches the debugger, and retries the content-side `renderModeInspectionEnd`
  message.
- `background.ts:1447-1534` still registers the granular render-mode helper
  commands `TAB_BEGIN_RENDER_MODE_INSPECTION`, `TAB_RUN_REVEAL_FREEZE`, and
  `TAB_CAPTURE_RENDER_MODE_HTML`. They remain asserted by
  `tests/background-render-mode-inspection.test.js`,
  `tests/feature-flags.test.js`, and `tests/background-command-router.test.js`.
  They have no popup callers on the active wire and are out of scope for Track 4
  teardown.
- `background/render-mode-inspector.ts:createRenderModeInspector()` owns the
  reusable helper steps:
  `ensureContentReadyForRenderModeInspectionInBackground`,
  `sendRenderModeInspectionEndWithRetry`,
  `runRenderModeInspectionBeginStep`,
  `runRenderModeHideConsentStep`, and
  `runRenderModeCaptureHtmlStep`. These still talk to content through raw
  message types (`renderModeInspectionBegin`, `hideConsentForInspection`,
  `captureRenderModeInspectionHtml`, `renderModeInspectionEnd`).
- `popup.ts:5792-5864`
  `runRenderModeInspectionReload(javaScriptDisabled)` is the popup entrypoint for
  the **With/Without JavaScript** buttons. It still owns the user-facing spinner
  copy, interprets the background reply shape
  (`reloadResult`, `loadStarted`, `followUpCompleted`, `inspectionSnapshot`),
  stores the inspection snapshot locally, and refreshes UI after follow-up.
- `popup.ts:5867-5929`
  `normalizeRenderModeDebuggerPage(...)` and
  `syncRenderModeDebuggerLifecycle(...)` still own popup-local debugger attach /
  detach decisions for the render-mode section, including the no-JS normalization
  path and consent-hide-on-visible behavior.
- `popup.ts:5992-6111`
  `handleRenderModeSet()` still explicitly ends an existing render-mode inspection
  after a held no-JS page is normalized. It calls
  `messages.requestTabEndRenderModeInspection(...)` and then, only in the held
  case, replays `configUpdated` into content.
- `popup/messages.ts` exports the popup-side runtime wrappers for this domain:
  `requestTabRunRenderModeInspection(...)` and
  `requestTabEndRenderModeInspection(...)`. These still call `requestRuntime(...)`
  with `TAB_RUN_RENDER_MODE_INSPECTION` / `TAB_END_RENDER_MODE_INSPECTION`.
- `common/render-mode-js-state.ts` persists the per-tab no-JS hold in
  `chrome.storage.session` via
  `setRenderModeNoJsHeld`, `clearRenderModeNoJsHeld`,
  `isRenderModeNoJsHeld`, and `listRenderModeNoJsHeldTabIds`.
- `content/render-mode-inspection-handlers.ts:createRenderModeInspectionHandlers()`
  still owns the content-local begin / reveal / capture / end / hide-consent
  behavior. `captureHtml()` must keep snapshot ordering:
  `createCurrentPageSnapshot()` first, `fetchCurrentPageRawHtml(pageUrl)` second,
  and `finishPageInspectionUi()` only after both.
- `content-main.ts:7210-7221` still registers the render-mode content commands on
  the content command router under the legacy names:
  `renderModeInspectionBegin`, `runRenderModeRevealOnce`,
  `captureRenderModeInspectionHtml`, `renderModeInspectionEnd`,
  `hideConsentForInspection`.
- `runRenderModeRevealOnce` is the content-side counterpart of
  `TAB_RUN_REVEAL_FREEZE`, is still called from
  `background/render-mode-inspector.ts`, and remains asserted by
  `tests/content-main-runtime-router-contract.test.js` and
  `tests/render-mode-inspector.test.js`. It is not deleted in this track.
- `background/brain/index.ts`, `background/brain/state-store.ts`, and
  `background/brain/view-projector.ts` currently project only `popupView`,
  `activation`, and `spinners`. There is no render-mode domain state in the Brain
  yet.
- Existing tests locking this domain include:
  - `tests/background-render-mode-inspection.test.js`
  - `tests/popup-render-mode-inspection.test.js`
  - `tests/render-mode-inspection-order.test.js`
  - `tests/render-mode-inspection-handlers.test.js`
  - `tests/render-mode-inspector.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/render-mode-js-state.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/device-emulation-lifecycle.test.js`

## Decisions already made

1. This is a wrap-only track with no lock-lift: do not change render-mode UX,
   button copy, response payload fields, storage keys, timeout values, consent
   hide semantics, property-lock follow-up timing, or the JS/no-JS hold rules.
2. Popup and background legacy callsites may become thin wrappers during the
   track, but the domain’s authoritative orchestration must move into a new
   Brain decider and typed bus contracts before legacy domain wires are deleted.
3. The no-JS hold remains persisted through `common/render-mode-js-state.ts`; do
   not rename `renderModeNoJsHeld:*` keys or move that persistence into a new
   store in this track.
4. Content-side DOM work remains in content executors that wrap the existing
   `content/render-mode-inspection-handlers.ts` helper. Do not move page/DOM
   logic into the background or page MAIN world.
5. Live validation for this track must use the committed launcher
   (`pnpm browser:live <target-url>`) against `.output/chrome-mv3`.

## Open questions

None. The master plan already classifies Track 4 as wrap-only and the current
repo state gives one deterministic next path.

## Non-goals

1. Do not change `content/core.ts`.
2. Do not redesign auto-detect endpoint logic in
   `popup/render-mode-inspection.ts`; keep its current snapshot consumption and
   retry rules intact.
3. Do not change device-emulation ownership or debugger semantics outside the
   render-mode-specific orchestration that currently lives in popup/background.
4. Do not migrate unrelated popup AI preview, page-save, property-lock, or
   activation commands in this track.
5. Do not remove `common/render-mode-js-state.ts` or change the no-JS hold
   inactivity timeout/observer behavior.

## New contracts

Add `common/bus/contracts/render-mode.ts` for the typed Track 4 wire.

- `RenderModeSnapshotPayload`
  `{ pageUrl:string; renderedHtml:string; rawHtml:string; renderMode:string; hiddenCount:number }`
  mirrors the current runtime `inspectionSnapshot` shape without reusing the
  existing `RenderModeInspectionSnapshot` names already defined in
  `types/render-mode.ts` and `types/popup-state.ts`.
- `RENDER_MODE_REQUEST_TYPES.RUN_INSPECTION = "renderMode.runInspection"`
  - authoritative owner: `background`
  - caller realm: `popup`
  - payload: `RenderModeRunInspectionPayload`
    `{ baseUrl:string; javaScriptDisabled:boolean; operationId:string }`
  - reply: `RenderModeRunInspectionReply`
    `{ ok:boolean; tabId:number; operationId:string; loadStarted:boolean; reloadResult:{ ok:boolean; error?:string } | null; followUpCompleted:boolean; followUpError:string; inspectionSnapshot: RenderModeSnapshotPayload | null; endAcknowledged:boolean; runtime?: Record<string, unknown>; state?: Record<string, unknown> }`
- `RENDER_MODE_REQUEST_TYPES.END_INSPECTION = "renderMode.endInspection"`
  - authoritative owner: `background`
  - caller realm: `popup`
  - payload: `RenderModeEndInspectionPayload`
    `{ operationId:string }`
  - reply: `RenderModeEndInspectionReply`
    `{ ok:boolean; tabId:number; operationId:string; endAcknowledged:boolean; runtime?: Record<string, unknown>; state?: Record<string, unknown> }`
- `RENDER_MODE_REQUEST_TYPES.CONTENT_BEGIN = "renderMode.contentBegin"`
  - authoritative owner: `content`
  - caller realm: `background`
  - payload: `{ operationId:string }`
  - reply: `{ ok:boolean; error?:string }`
- `RENDER_MODE_REQUEST_TYPES.CONTENT_HIDE_CONSENT = "renderMode.contentHideConsent"`
  - authoritative owner: `content`
  - caller realm: `background`
  - payload: `Record<never, never>`
  - reply: `{ ok:boolean; hiddenCount:number; error?:string }`
- `RENDER_MODE_REQUEST_TYPES.CONTENT_CAPTURE_HTML = "renderMode.contentCaptureHtml"`
  - authoritative owner: `content`
  - caller realm: `background`
  - payload: `{ baseUrl:string; operationId:string }`
  - reply: `RenderModeSnapshotPayload & { ok:boolean; error?:string }`
- `RENDER_MODE_REQUEST_TYPES.CONTENT_END = "renderMode.contentEnd"`
  - authoritative owner: `content`
  - caller realm: `background`
  - payload: `{ operationId:string }`
  - reply: `{ ok:boolean; error?:string }`
- `RENDER_MODE_EVENT_TYPES.INSPECTION_RECORDED = "renderMode.inspectionRecorded"`
  - owner/emitter: `background`
  - payload: `{ operationId:string; baseUrl:string; javaScriptDisabled:boolean; noJsHeld:boolean; followUpCompleted:boolean; snapshotPageUrl:string; }`
  - use: mirror the authoritative render-mode inspection result into Brain state
    and projected popup/content state.
- `RENDER_MODE_EVENT_TYPES.NO_JS_HOLD_CHANGED = "renderMode.noJsHoldChanged"`
  - owner/emitter: `background`
  - payload: `{ held:boolean; operationId:string; reason:string }`
  - use: keep the Brain projection aligned with explicit end, inactivity restore,
    and inspection-start clear/set transitions.

Add typed state shapes in `background/brain/state-store.ts`:

- `renderMode.inspecting:boolean`
- `renderMode.javaScriptDisabled:boolean`
- `renderMode.noJsHeld:boolean`
- `renderMode.operationId:string`
- `renderMode.baseUrl:string`
- `renderMode.lastSnapshotPageUrl:string`
- `renderMode.followUpCompleted:boolean`
- `renderMode.lastError:string`

Add typed projections in `background/brain/view-projector.ts`:

- popup view gains a read-only `renderMode` block with the fields above so popup
  can render from Brain-owned inspection state instead of inferring it from
  scattered local flags.
- content directive gains a read-only `renderMode` block containing only the
  fields content executors need (`inspecting`, `operationId`, `noJsHeld`,
  `javaScriptDisabled`).

No new type may reuse a legacy `BACKGROUND_COMMANDS.*`,
`renderModeInspection*`, or `hideConsentForInspection` string.

## Files

- add:
  - `common/bus/contracts/render-mode.ts`
  - `background/brain/deciders/render-mode-decider.ts`
  - `popup/layers/modes/render-mode-inspection.ts`
  - `content/layers/modes/render-mode-inspection-executor.ts`
  - `tests/render-mode-decider.test.ts`
  - `tests/popup-render-mode-layer.test.ts`
  - `tests/content-render-mode-executor.test.ts`
- edit:
  - `common/bus/contracts/index.ts`
  - `background/brain/index.ts`
  - `background/brain/state-store.ts`
  - `background/brain/view-projector.ts`
  - `background.ts`
  - `background/render-mode-inspector.ts`
  - `popup.ts`
  - `popup/messages.ts`
  - `popup/layers/popup-bus-client.ts`
  - `popup/layers/layer-host.ts`
  - `content-main.ts`
  - `content/render-mode-inspection-handlers.ts`
  - `content/layers/content-bus-client.ts`
  - `content/layers/layer-host.ts`
  - `tests/background-render-mode-inspection.test.js`
  - `tests/popup-render-mode-inspection.test.js`
  - `tests/render-mode-inspection-order.test.js`
  - `tests/render-mode-inspector.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/device-emulation-lifecycle.test.js`
- delete (only after the replacement is green):
  - the legacy render-mode-specific background command wire:
    `BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION` and
    `BACKGROUND_COMMANDS.TAB_END_RENDER_MODE_INSPECTION`
  - the legacy render-mode plain content command names:
    `renderModeInspectionBegin`, `captureRenderModeInspectionHtml`,
    `renderModeInspectionEnd`, `hideConsentForInspection`
  - the popup-local debugger-lifecycle ownership in
    `syncRenderModeDebuggerLifecycle(...)` once the projected render-mode state
    has replaced it

## Implementation phases

### Phase 1 — Add the typed render-mode contracts and Brain state

- exact files to edit:
  - add `common/bus/contracts/render-mode.ts`
  - edit `common/bus/contracts/index.ts`
  - edit `background/brain/state-store.ts`
  - edit `background/brain/view-projector.ts`
  - add `tests/render-mode-decider.test.ts` with state/projection coverage only
- exact functions/types/tests to touch:
  - new `RenderMode*Payload/Reply` and `RenderModeSnapshotPayload` types
  - `TabLayerState["renderMode"]`
  - `projectViews(...)` popup/content projection output
  - tests proving the new render-mode projection defaults are stable
- step-by-step edits:
  1. Add `common/bus/contracts/render-mode.ts` with the request/event constants
     and shapes listed above.
  2. Re-export the new contract module from `common/bus/contracts/index.ts`.
  3. Extend `TabLayerState` with a `renderMode` block and create an initial
     zeroed render-mode state factory.
  4. Extend `projectViews(...)` so popup/content receive cloned read-only
     `renderMode` state.
  5. Add/extend tests to lock the state defaults and projection shape.
- expected intermediate state:
  - the repo compiles with an inert render-mode Brain slice
  - no runtime behavior changes yet
- focused validation command:
  - `pnpm test tests/render-mode-decider.test.ts tests/bus-boundary.test.ts`
- rollback or fallback rule:
  - revert the new contract export and the `renderMode` state block only; no
    legacy behavior depends on it yet

### Phase 2 — Add the background render-mode decider and mirror legacy command results into it

- exact files to edit:
  - add `background/brain/deciders/render-mode-decider.ts`
  - edit `background/brain/index.ts`
  - edit `background.ts`
  - edit `background/render-mode-inspector.ts`
  - edit `tests/render-mode-decider.test.ts`
  - edit `tests/background-render-mode-inspection.test.js`
- exact functions/types/tests to touch:
  - `createBrain()` decider registration
  - a new render-mode decider API for `recordInspectionResult`,
    `recordNoJsHoldState`, and `getRenderModeSnapshot`
  - legacy background command blocks become thin wrappers that call the new
    decider mutators around the existing helper/orchestration
- step-by-step edits:
  1. Implement `render-mode-decider.ts` with store mutators only; do not delete
     the existing background command handlers yet.
  2. Register the decider in `createBrain()` and expose minimal getters/mutators
     parallel to the activation/spinner slices.
  3. Update the existing render-mode background command handlers so every clear,
     set, success, failure, and explicit end path also updates the Brain
     `renderMode` slice.
  4. Update tests to prove Brain state tracks no-JS hold clear/set and follow-up
     completion without changing the command reply shape.
- expected intermediate state:
  - background commands still exist
  - Brain now mirrors authoritative render-mode inspection state
- focused validation command:
  - `pnpm test tests/render-mode-decider.test.ts tests/background-render-mode-inspection.test.js tests/device-emulation-lifecycle.test.js`
- rollback or fallback rule:
  - revert only the decider registration and mirror calls; the old command path
    remains intact

### Phase 3 — Add popup/content bus executors and switch the domain wire to typed bus requests

- exact files to edit:
  - add `popup/layers/modes/render-mode-inspection.ts`
  - add `content/layers/modes/render-mode-inspection-executor.ts`
  - edit `popup/layers/popup-bus-client.ts`
  - edit `popup/layers/layer-host.ts`
  - edit `content/layers/content-bus-client.ts`
  - edit `content/layers/layer-host.ts`
  - edit `popup.ts`
  - edit `content-main.ts`
  - edit `content/render-mode-inspection-handlers.ts`
  - add `tests/popup-render-mode-layer.test.ts`
  - add `tests/content-render-mode-executor.test.ts`
- exact functions/types/tests to touch:
  - popup wrapper around `bus.request(RENDER_MODE_REQUEST_TYPES.RUN_INSPECTION|END_INSPECTION, ...)`
  - content-side bus handlers that call the existing
    `createRenderModeInspectionHandlers(...)` methods
  - `runRenderModeInspectionReload(...)`, `handleRenderModeSet()`, and debugger
    lifecycle code in `popup.ts` to delegate to the popup layer module
  - content command registration in `content-main.ts` so the new bus executor is
    the active path before legacy command deletion
- step-by-step edits:
  1. Add popup bus-client helpers for `renderMode.runInspection` and
     `renderMode.endInspection`.
  2. Add a popup layer module that translates the bus reply back into the exact
     shape `popup.ts` already expects, so popup UI logic can stay behavior-stable
     while the wire changes underneath it.
  3. Add content bus handlers for `CONTENT_BEGIN`, `CONTENT_HIDE_CONSENT`,
     `CONTENT_CAPTURE_HTML`, and `CONTENT_END` that call the existing content
     render-mode handlers.
  4. Update `popup.ts` to delegate its render-mode reload and explicit-end paths
     through the popup layer module instead of the legacy runtime-message wrappers.
  5. Update source-contract tests so they assert the new bus request usage and
     forbid reintroducing direct legacy render-mode message names into popup
     orchestration.
- expected intermediate state:
  - popup/content domain traffic for render-mode inspection now travels through
    typed bus requests, but the legacy handlers still exist as compatibility
    shims until phase 4
- focused validation command:
  - `pnpm test tests/popup-render-mode-layer.test.ts tests/content-render-mode-executor.test.ts tests/popup-render-mode-inspection.test.js tests/render-mode-inspection-order.test.js tests/render-mode-inspection-handlers.test.js tests/content-main-runtime-router-contract.test.js`
- rollback or fallback rule:
  - restore popup/messages legacy wrappers in `popup.ts` first, then remove the
    new popup/content executor modules

### Phase 4 — Delete the legacy render-mode wire and finish the track

- exact files to edit:
  - `background.ts`
  - `popup/messages.ts`
  - `content-main.ts`
  - `tests/background-render-mode-inspection.test.js`
  - `tests/background-command-router.test.js` (preserve surviving granular-step command coverage)
  - `tests/feature-flags.test.js` (preserve surviving granular-step command coverage)
  - `tests/popup-render-mode-inspection.test.js`
  - `tests/render-mode-inspector.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
- exact functions/types/tests to touch:
  - remove `TAB_RUN_RENDER_MODE_INSPECTION` / `TAB_END_RENDER_MODE_INSPECTION`
    command registration and their popup runtime wrappers
  - remove the old plain content command names for begin/capture/end/hide-consent
  - preserve the three granular-step background commands
    (`TAB_BEGIN_RENDER_MODE_INSPECTION`, `TAB_RUN_REVEAL_FREEZE`,
    `TAB_CAPTURE_RENDER_MODE_HTML`) and keep their assertions green in
    `tests/background-render-mode-inspection.test.js`,
    `tests/feature-flags.test.js`, and `tests/background-command-router.test.js`
  - preserve `runRenderModeRevealOnce` on the content command router as the
    still-live counterpart of `TAB_RUN_REVEAL_FREEZE`, and keep its assertions
    green in `tests/content-main-runtime-router-contract.test.js` and
    `tests/render-mode-inspector.test.js`
  - ensure `content-main-runtime-router-contract` inventory no longer expects the
    deleted plain render-mode names in the legacy router
- step-by-step edits:
  1. Delete the legacy background command registrations after popup has switched
     to the bus request path.
  2. Delete the now-unused popup message wrappers for those command names.
  3. Delete the legacy content command registrations for the same domain once the
     content bus handlers are proven green.
  4. Rewrite the source-contract tests so they lock the new bus contract and make
     the deleted names a regression failure.
- expected intermediate state:
  - Brain is the only authoritative owner of render-mode inspection orchestration
  - popup/content are thin executors
  - legacy domain wires for render-mode inspection are gone
- focused validation command:
  - `pnpm test tests/background-render-mode-inspection.test.js tests/background-command-router.test.js tests/feature-flags.test.js tests/popup-render-mode-inspection.test.js tests/render-mode-inspector.test.js tests/popup-render-mode.test.js tests/content-main-runtime-router-contract.test.js tests/device-emulation-lifecycle.test.js`
- rollback or fallback rule:
  - revert the legacy-deletion commit first so the old wire returns immediately,
    then back out the popup/content executor adoption if needed

## Test matrix

- unit / decider:
  - `tests/render-mode-decider.test.ts`
  - `tests/render-mode-inspector.test.js`
  - `tests/popup-render-mode-inspection.test.js`
  - `tests/render-mode-js-state.test.js`
- source-contract / boundary:
  - `tests/background-render-mode-inspection.test.js`
  - `tests/render-mode-inspection-order.test.js`
  - `tests/render-mode-inspection-handlers.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/bus-boundary.test.ts`
- integration / behavior:
  - `tests/device-emulation-lifecycle.test.js`
  - any new popup/content layer tests added in phases 3-4
- full validation before each commit and at track end:
  ```bash
  pnpm lint
  pnpm check
  pnpm test
  pnpm build
  ```
- live/manual validation (required for this user-visible track):
  ```bash
  pnpm browser:live https://bonliva.se
  ```
  Required live checks:
  1. popup binds to the Bonliva tab and shows the render-mode buttons
  2. **Without JavaScript** enters the `"Starting render-mode inspection"` state
     instead of failing with `"No response"`
  3. explicit **With JavaScript** and **Set** still normalize a held no-JS page
     and clear the hold correctly
  4. the page remains inspectable after the no-JS reload, and explicit end still
     restores JavaScript

## Regression risks

1. **Half-migrated dual authority** between the legacy background command path and
   the new Brain render-mode decider.
   - detection: `tests/render-mode-decider.test.ts`,
     `tests/background-render-mode-inspection.test.js`, and a grep check for both
     legacy and new paths writing the same render-mode state.
2. **No-JS hold drift** where the Brain projection, storage key, and popup state
   disagree.
   - detection: `tests/render-mode-js-state.test.js`,
     `tests/device-emulation-lifecycle.test.js`, and live **With/Without
     JavaScript** checks on Bonliva.
3. **Consent/capture ordering regressions** that change saved HTML or render-mode
   detection.
   - detection: `tests/render-mode-inspection-order.test.js` and
     `tests/popup-render-mode-inspection.test.js`.
4. **Debugger/device-emulation cleanup drift** that leaves the debugger attached
   or detaches it while device emulation still needs it.
   - detection: `tests/background-render-mode-inspection.test.js`,
     `tests/popup-render-mode.test.js`, and live Set/exit checks.
5. **Legacy-name collisions** where deleted plain render-mode command names remain
   reachable alongside the new bus contract.
   - detection: `tests/content-main-runtime-router-contract.test.js` and
     `tests/background-render-mode-inspection.test.js`.

## Acceptance criteria

1. The domain’s cross-cutting render-mode inspection decisions are made only by
   `background/brain/deciders/render-mode-decider.ts`; popup/content layer
   modules do not decide when to clear/set the no-JS hold, hide consent, or end
   the inspection.
2. Popup uses typed bus requests for render-mode inspection start/end instead of
   `TAB_RUN_RENDER_MODE_INSPECTION` / `TAB_END_RENDER_MODE_INSPECTION`.
3. Content executes begin / capture / end / hide-consent through bus handlers or
   thin executors rather than legacy plain render-mode command names.
4. The no-JS hold still persists under `renderModeNoJsHeld:*` and the same
   explicit end / inactivity / navigation restore rules remain observable.
5. `pnpm verify` passes, and live Bonliva validation shows unchanged
   render-mode inspection behavior, including the previously fixed
   `"Starting render-mode inspection"` path.

## Rollback rule

- Revert the legacy-deletion phase first so the old render-mode wire becomes
  runnable again immediately. Then revert popup/content executor adoption, then
  revert the Brain render-mode decider and contract additions. Never leave the
  tree with both the legacy background command path and the new Brain path
  mutating authoritative render-mode state in parallel.

## Todo chain

1. `eventbus-track4-contracts` — add render-mode bus contracts and Brain state
   scaffolding.
2. `eventbus-track4-decider` — add the render-mode decider and mirror the legacy
   background command results into it.
3. `eventbus-track4-executors` — route popup/content render-mode traffic through
   typed bus executors while preserving reply shapes.
4. `eventbus-track4-teardown` — delete the legacy render-mode wire, run full
   validation plus live Bonliva regression, then close the track docs.
