# Track 01 — Popup state channel

> Parent plan: `.copilot/event-bus-architecture-plan.md` (master spec, track map
> §7, guardrails §8). Foundation reference:
> `.copilot/event-bus/track-00-foundation.md`.
>
> Validation uses the WXT command surface: `pnpm lint`, `pnpm check`,
> `pnpm test`, `pnpm build`, `pnpm browser:live <url>`. No `deno task`
> commands.

## Precondition

- Track 0 is complete and green:
  - `45f6eea` — pure bus foundation
  - `5d31507` — wired realm skeleton
  - `06ce494` — dev-only `diag.ping` round-trip
- `pnpm verify` passed at the Track 0 boundary.

## Approval gate

None — wrap-only; this track relocates the popup state delivery channel and does
not change locked behavior.

## Goal

Replace the popup’s legacy background snapshot channel (`ufPopupState:<tabId>`
ports plus `POPUP_GET_TAB_VIEW_STATE`) with Brain-owned popup view projection
delivered over the new bus, while preserving the exact popup-visible lifecycle,
trace, and legacy-spinner snapshot semantics that Track 0 currently exposes. The
user-visible popup behavior must remain unchanged; only the transport/channel
and ownership of the projected view move.

## Current facts (re-verified this session)

- `background/popup-state-broker.ts:createPopupStateBroker()` owns the legacy
  popup snapshot shape via `buildBrokerState(tabId)` and port fan-out via
  `broadcastBrokerState(tabId)`. It serializes `lifecycle`, `spinnerQueue`,
  `activeSpinnerLease`, `traceEnabled`, and `traceEvents`.
- `background.ts:2126-2142` constructs one `popupStateBroker` instance and
  aliases `buildBrokerState`, `broadcastBrokerState`, and `updateLifecycleState`
  into the legacy background module.
- `background.ts:860-869` still serves
  `BACKGROUND_COMMANDS.POPUP_GET_TAB_VIEW_STATE` by returning
  `{ state: buildBrokerState(context.tabId), runtime: getTabRuntimeSnapshot(...) }`.
- `background.ts:2216-2248` still accepts `ufPopupState:<tabId>` ports and pushes
  `WORLD_MESSAGE_TYPES.BACKGROUND_STATE` messages built from `buildBrokerState`.
- `popup/messages.ts:271-285` requests the startup/tab snapshot via
  `requestPopupTabViewState(tabId)` -> `POPUP_GET_TAB_VIEW_STATE`.
- `popup.ts:985-1056` applies the legacy broker snapshot in
  `applyBackgroundStateSnapshot(snapshot)`, mutating `popupBackgroundLifecycle`,
  `state.traceModeEnabled`, `state.traceEvents`, the popup spinner queue, and the
  derived UI busy state.
- `popup.ts:1129-1138` restores startup/tab state via
  `restoreSpinnerQueueFromBackground(tabId)` calling `messages.requestPopupTabViewState`.
- `popup.ts:1150-1180` connects the popup-state port with
  `connectBackgroundStatePort(tabId)` and applies `WORLD_MESSAGE_TYPES.BACKGROUND_STATE`
  messages.
- `popup/layers/layer-host.ts` already subscribes to `view.popup`, but Track 0
  only stores the latest view locally; it does not drive popup state.
- `background/brain/index.ts` already owns the Brain bus/store and publishes
  `view.popup`, but `background/brain/view-projector.ts` currently projects only
  `{ version }`.
- `tests/popup-state-broker.test.js` locks the legacy snapshot shape, targeted
  lifecycle broadcast behavior, and the nav-inspect teardown side effect.
- `tests/popup-background-snapshot.test.js` locks that popup startup/tab restore
  goes through `requestPopupTabViewState` and `applyBackgroundStateSnapshot`.
- `tests/popup-authority-boundary.test.js` locks that popup content requests stay
  routed through `TAB_CONTENT_REQUEST`, not direct `chrome.tabs.sendMessage`.

## Decisions already made

- Track 1 depends only on Track 0 and has no approval gate
  (`.copilot/event-bus-architecture-plan.md:595-600`).
- Track 2 owns the actual spinner-authority migration. Therefore Track 1 must
  preserve the current legacy spinner queue / active lease payload semantics
  inside the new popup view instead of redesigning spinner ownership early.
- Popup tab snapshots must continue to originate from background authority; do
  not reintroduce popup fallback reads or direct storage probes
  (`.copilot/knowledge.md:95-97`).
- Any `content/*` module directly imported by `content-main.ts` must remain
  listed in `manifest.json` and `wxt.config.ts` web-accessible resources; Track 1
  should avoid touching that surface unless new content imports are added.

## Open questions

None.

## Non-goals

- Do not migrate spinner authority, spinner copy, or curtain teardown logic out
  of the broker; Track 2 owns that move.
- Do not change activation, render-mode, AI-run, page-save, property-lock, or
  any locked marking/highlighting behavior.
- Do not redesign popup modes or the large `popup.ts` state object in this track.
- Do not change content/page-world transports or the `diag.ping` diagnostic path
  beyond keeping it compatible.

## New contracts

Add `common/bus/contracts/popup-state.ts` with the compatibility popup-view wire:

- `POPUP_STATE_REQUEST_TYPES.GET = "popup.view.get"`
  - owner: `background`
  - payload: `{}`
  - request options: `tab` is required in the bus request metadata
  - reply: `PopupViewEnvelope`
- `POPUP_STATE_EVENT_TYPES.VIEW_UPDATED = "view.popup"`
  - owner/emitter: `background`
  - payload: `PopupViewEnvelope`

Type shapes:

- `PopupTraceEvent` — mirrors the existing broker trace event row
  `{ at:number; channel:string; event:string; payload:Record<string,unknown>|null }`.
- `PopupLegacySpinnerEntry` — mirrors the serialized broker spinner queue entry
  (same keys as `serializeSpinnerQueue` currently emits).
- `PopupLegacyLifecycleState` — permissive record matching the current broker
  lifecycle payload.
- `PopupViewEnvelope`:
  - `version:number`
  - `tabId:number`
  - `traceEnabled:boolean`
  - `traceEvents: PopupTraceEvent[]`
  - `lifecycle: PopupLegacyLifecycleState | null`
  - `legacySpinnerQueue: PopupLegacySpinnerEntry[]`
  - `legacyActiveSpinnerLease: PopupLegacySpinnerEntry | null`

Decision rule: Track 1 keeps these legacy-shaped fields intact inside
`PopupViewEnvelope` so popup behavior stays unchanged while the delivery channel
changes. Track 2 may rename/split the spinner fields when spinner authority
actually moves.

## Files

- add:
  - `common/bus/contracts/popup-state.ts`
  - `background/brain/deciders/popup-state-decider.ts`
  - `tests/popup-state-decider.test.ts`
  - `tests/popup-view-projector.test.ts`
  - `tests/popup-state-channel.test.ts`
- edit:
  - `background/brain/state-store.ts`
  - `background/brain/view-projector.ts`
  - `background/brain/index.ts`
  - `background/popup-state-broker.ts`
  - `background.ts`
  - `popup/layers/layer-host.ts`
  - `popup/layers/popup-bus-client.ts`
  - `popup.ts`
  - `popup/messages.ts`
  - `tests/popup-state-broker.test.js`
  - `tests/popup-background-snapshot.test.js`
  - `tests/bus-boundary.test.ts`
- delete (only after replacement is green in the same track):
  - the popup-facing `POPUP_GET_TAB_VIEW_STATE` busless command path
  - the popup-facing `ufPopupState:<tabId>` / `WORLD_MESSAGE_TYPES.BACKGROUND_STATE`
    channel in `popup.ts` and the matching background `onConnect` branch

## Implementation phases

1. Add typed popup-state contracts and Brain state fields.
   - files: `common/bus/contracts/popup-state.ts`,
     `background/brain/state-store.ts`, `background/brain/view-projector.ts`
   - steps:
     1. Add the `PopupViewEnvelope` compatibility types and request/event
        constants.
     2. Extend `TabLayerState` with a `popupView` compatibility subtree holding
        `traceEnabled`, `traceEvents`, `lifecycle`, `legacySpinnerQueue`, and
        `legacyActiveSpinnerLease`.
     3. Update `projectViews(state)` so `popupView` returns the full
        compatibility shape instead of just `{ version }`.
   - expected intermediate state: Brain projection can represent the exact
     popup snapshot shape, but no producers/consumers changed yet.
   - focused validation: `pnpm test tests/popup-view-projector.test.ts`
   - rollback rule: delete the new contract file and revert the added
     `popupView` fields.

2. Add the popup-state decider and make the legacy broker feed Brain state
   instead of being the popup-facing source of truth.
   - files: `background/brain/deciders/popup-state-decider.ts`,
     `background/brain/index.ts`, `background/popup-state-broker.ts`,
     `background.ts`
   - steps:
     1. Create `popup-state-decider.ts` with pure helpers:
        - `buildPopupViewFromBrokerState(brokerState, version)` -> `PopupViewEnvelope`
        - `updatePopupViewFromBrokerState(store, tabId, brokerState, reason)`
        - `getPopupView(store, tabId)` for the request handler
     2. Register `POPUP_STATE_REQUEST_TYPES.GET` in `background/brain/index.ts`
        so the Brain is the single authoritative handler for startup snapshot
        requests.
     3. In `background/popup-state-broker.ts`, keep `buildBrokerState()` exactly
        behavior-compatible, but whenever broker state changes
        (`updateLifecycleState`, later `broadcastBrokerState` call sites), invoke
        the decider/store updater so Brain state mirrors the legacy broker
        snapshot.
     4. In `background.ts`, after creating `popupStateBroker`, seed the Brain
        store from `buildBrokerState(tabId)` for any tab that already has
        lifecycle/spinner runtime state.
   - expected intermediate state: Brain now owns a typed popup view that mirrors
     the broker snapshot; popup is still consuming the legacy wire.
   - focused validation: `pnpm test tests/popup-state-decider.test.ts tests/popup-state-broker.test.js`
   - rollback rule: remove the decider and stop mirroring broker state into the
     Brain store.

3. Move the popup startup/update channel onto the bus while reusing the existing
   snapshot-application logic.
   - files: `popup/layers/popup-bus-client.ts`, `popup/layers/layer-host.ts`,
     `popup.ts`, `popup/messages.ts`, `background.ts`
   - steps:
     1. Add `requestPopupView(tabId)` to `popup-bus-client.ts` using
        `bus.request(POPUP_STATE_REQUEST_TYPES.GET, {}, { target: REALMS.BACKGROUND, tab })`.
     2. Change `startPopupLayerHost(...)` so it accepts a callback (from
        `popup.ts`) that applies an incoming `PopupViewEnvelope` to the existing
        popup state/UI path. Do not let the layer import `popup.ts`; pass the
        dependency in.
     3. Extract a compatibility adapter in `popup.ts` from
        `applyBackgroundStateSnapshot(snapshot)` that can consume both the old
        broker shape and the new `PopupViewEnvelope` without behavior changes.
        Decision rule: keep field names separate; map
        `legacySpinnerQueue -> spinnerQueue` and
        `legacyActiveSpinnerLease -> activeSpinnerLease` at the adapter boundary.
     4. Replace `restoreSpinnerQueueFromBackground(tabId)` and the init/tab-switch
        bootstrap calls to use `requestPopupView(tabId)` through the popup bus
        client instead of `messages.requestPopupTabViewState`.
     5. Remove `connectBackgroundStatePort(tabId)` usage and delete the popup-side
        `WORLD_MESSAGE_TYPES.BACKGROUND_STATE` listener once the layer host is
        receiving `view.popup` updates from the bus.
   - expected intermediate state: popup startup restore and live updates now come
     only from the bus, but the visible state/UI behavior is unchanged because
     the compatibility adapter reuses the old application path.
   - focused validation: `pnpm test tests/popup-state-channel.test.ts tests/popup-background-snapshot.test.js tests/popup-bus-client.test.ts`
   - rollback rule: restore `requestPopupTabViewState` + port connect usage and
     keep the layer host as a no-op.

4. Delete the popup-facing legacy wire for this domain.
   - files: `background.ts`, `popup/messages.ts`, `popup.ts`,
     `tests/popup-background-snapshot.test.js`, `tests/popup-state-broker.test.js`
   - steps:
     1. Remove `BACKGROUND_COMMANDS.POPUP_GET_TAB_VIEW_STATE` registration and
        constant usage.
     2. Remove the `ufPopupState:<tabId>` popup-facing `onConnect` branch and the
        popup-side `connectBackgroundStatePort` function.
     3. Rewrite source-contract tests to assert the new bus-based bootstrap path:
        popup bootstrap requests `popup.view.get`, and popup no longer imports or
        calls `requestPopupTabViewState`.
     4. Keep `background/popup-state-broker.ts` only as an internal compatibility
        adapter until Track 2 deletes or internalizes it further.
   - expected intermediate state: no popup-facing legacy channel remains for
     popup state; the Brain bus is the only delivery path.
   - focused validation: `pnpm test tests/popup-background-snapshot.test.js tests/popup-state-channel.test.ts tests/popup-state-broker.test.js`
   - rollback rule: restore the deleted legacy command/port branch first, then
     remove the bus request wiring.

5. Final validation and live-check prep.
   - files: none or small follow-up fixes only
   - steps:
     1. Run focused tests for any failing adapter/projection contract.
     2. Run full validation.
     3. Because Track 1 changes user-visible popup startup/update behavior but not
        the deeper marking contract, live validation is optional-but-recommended
        before Track 2 if a target URL is available; otherwise defer live to the
        first Track 2/3 slice that already needs it.
   - expected intermediate state: branch is ready for Track 1 commit(s) with the
     popup-state channel fully migrated.
   - focused validation: `pnpm verify`
   - rollback rule: revert the legacy-wire deletion commit first.

## Test matrix

- Unit
  - `tests/popup-state-decider.test.ts`
    - converts broker snapshot shape into `PopupViewEnvelope`
    - stores versioned popup view state by tab
    - returns a request reply for `popup.view.get`
  - `tests/popup-view-projector.test.ts`
    - projects the full compatibility popup view, including trace/lifecycle and
      legacy spinner fields
- Source-contract / boundary
  - rewrite `tests/popup-background-snapshot.test.js`
    - popup bootstrap no longer calls `messages.requestPopupTabViewState`
    - popup bus bootstrap requests `popup.view.get`
  - extend `tests/bus-boundary.test.ts`
    - popup layer host still imports no sibling layer and no legacy background
      snapshot message constants
  - keep `tests/popup-authority-boundary.test.js` green
- Integration / behavior parity
  - rewrite `tests/popup-state-broker.test.js`
    - broker still builds the same compatibility state shape
    - broker updates still mirror into Brain projection hooks
  - add `tests/popup-state-channel.test.ts`
    - popup bus startup request reaches background handler
    - `view.popup` updates apply the same compatibility snapshot semantics
    - tab switch uses the bus request path, not the old runtime command
- Full validation
  - `pnpm lint`
  - `pnpm check`
  - `pnpm test`
  - `pnpm build`
- Live/manual
  - Optional at Track 1 end if a URL is available:
    `pnpm browser:live <target-url>`
  - Manual acceptance:
    - popup opens on a supported page and shows the same startup state as before
    - switching tabs updates popup lifecycle/trace state without using the old
      popup-state port

## Regression risks

- **Half-migrated dual delivery:** popup could apply both the bus view and the
  legacy port snapshot, causing duplicate state churn. Detection: source-contract
  test proving the old port/bootstrap calls are removed; live popup logs should
  show only one state-application path.
- **Spinner ownership drift before Track 2:** accidentally redesigning the queue
  or active lease shape here would change busy/UI behavior. Protection: keep the
  exact legacy serialized fields inside `PopupViewEnvelope` and lock them with
  projector/decider tests.
- **Trace diagnostics loss:** the popup trace panel could stop updating if the
  new view omits `traceEnabled`/`traceEvents`. Detection: unit projection tests
  plus live/manual trace-mode check when available.
- **Stale startup snapshot:** tab-switch/open could race before the first
  `view.popup` event. Protection: keep an explicit `popup.view.get` request for
  bootstrap, then use `view.popup` only for push updates.
- **Background compatibility breakage:** deleting `popup-state-broker` too early
  would break Track 2’s spinner migration seam. Protection: keep the broker as
  an internal adapter this track; only remove popup-facing command/port wire.

## Acceptance criteria

- The popup no longer uses `requestPopupTabViewState()` or
  `connectBackgroundStatePort()` for startup/tab-switch state.
- Background no longer registers `POPUP_GET_TAB_VIEW_STATE` or serves
  `WORLD_MESSAGE_TYPES.BACKGROUND_STATE` to popup state ports.
- The Brain is the single authoritative handler for `popup.view.get`, and
  `view.popup` carries the full compatibility popup view.
- Popup-visible lifecycle, trace panel state, and legacy spinner snapshot
  semantics remain unchanged.
- `tests/popup-state-broker.test.js`, `tests/popup-background-snapshot.test.js`,
  and the new Track 1 tests are green.
- `pnpm verify` passes at the Track 1 boundary.

## Rollback rule

- Revert the legacy-wire deletion commit first (restoring
  `POPUP_GET_TAB_VIEW_STATE` and the popup-state port path), then revert the
  Brain decider/projection commits if needed.
- Never leave both the legacy popup-state wire and the new bus-based popup view
  applying authoritatively to the popup at the same time.
