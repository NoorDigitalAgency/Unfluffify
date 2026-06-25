# Track 02 — Spinner authority

> Parent plan: `.copilot/event-bus-architecture-plan.md` (master spec, track map
> §7, guardrails §8). Foundation references:
> `.copilot/event-bus/track-00-foundation.md` and
> `.copilot/event-bus/track-01-popup-state-channel.md`.
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
- `pnpm verify` passed at the Track 1 boundary.

## Approval gate

None — wrap-only; this track relocates spinner/cursor authority and render
transport without changing the locked marking, AI, or lifecycle behavior.

## Goal

Move spinner authority out of the popup-local queue and background spinner queue
edge adapters into the Brain’s `state.spinners.*` projection, so popup/content
spinner layers render from one authoritative source while user-visible spinner
timing, copy, blocking surfaces, page-busy mirror behavior, and the navigation
inspection curtain stay unchanged.

## Current facts (re-verified this session)

- `background/brain/state-store.ts:createInitialTabState()` already has
  `spinners.popup`, `spinners.pageCurtain`, and `spinners.banner` selection
  slots, but no current migration path writes authoritative selections into
  them outside tests.
- `background/brain/spinner-authority.ts:phaseToSpinnerState()` already maps
  `{ kind, phase, startedAt, deadlineAt, operationId }` into render-ready
  `SpinnerState` using `common/spinner-contract.ts`.
- `background/brain/index.ts:publishSpinnerSurface()` already publishes
  `spinner.set` / `spinner.clear` for popup/content surfaces from
  `projectSpinners(state)`, but today those publishes are effectively inert
  because production code does not mirror the legacy queues into
  `state.spinners.*`.
- `background/spinner-operations.ts:createSpinnerOperations()` remains the
  authoritative background queue owner for service-worker and content/popup
  spinner updates. Its mutators are `setBackgroundSpinnerEntry`,
  `updateBackgroundSpinnerEntry`, `removeBackgroundSpinnerEntry`,
  `clearBackgroundSpinnerQueue`, and `withTabSpinner`.
- `background.ts:2159-2182` exposes those mutators through
  `setBackgroundSpinnerEntry`, `removeBackgroundSpinnerEntry`,
  `clearBackgroundSpinnerQueue`, and `withBackgroundTabSpinner`.
- `background.ts:2606-2645` still accepts legacy
  `WORLD_MESSAGE_TYPES.SPINNER_SET`, `SPINNER_REMOVE`, and `SPINNER_CLEAR`
  messages and routes them into `spinner-operations.ts`.
- `popup.ts:getSpinnerDeps()` still treats the popup-local `popupSpinnerQueue`
  as authoritative for optimistic UI behavior, busy state, and page-busy mirror
  synchronization through `popup/spinner.ts`.
- `popup.ts:getActiveSpinnerSnapshotForSurface()`,
  `setUiBusyFromCurrentSpinner()`, `syncPageBusyFromPopupSpinner()`, and
  `syncUiBusyFromBrokerState()` still derive popup/page blocking from the local
  queue plus lifecycle fallback, not from Brain-published `SpinnerState`.
- `popup.ts:beginNavigationInspectionOverlay()` / `endNavigationInspectionOverlay()`
  still own the explicit `navInspect` curtain behavior on the popup side.
- `popup/layers/layer-host.ts` and `content/layers/layer-host.ts` already render
  `spinner.set` / `spinner.clear`, and `tests/bus-boundary.test.ts` locks that
  those render-only layer modules do not import `common/spinner-contract`.
- `tests/background-spinner-operations.test.js` locks deterministic background
  queue metadata, progress updates, transient clears, and `withTabSpinner`
  teardown.
- `tests/popup-spinner.test.js` locks popup optimistic queue behavior,
  watchdogs, background sync calls, and the current “latest blocking surface”
  selection behavior.
- `tests/spinner-authority.test.ts` locks `phaseToSpinnerState()` mapping for
  countdown, elapsed, and none-timer phases.
- `tests/popup-marking-refresh.test.js`, `tests/popup-render-mode.test.js`, and
  `tests/lifecycle-broker.test.js` lock user-visible spinner-related popup and
  lifecycle behavior.

## Open questions

None.

## Non-goals

- Do not redesign spinner copy, timer durations, phase registry entries, or
  surface semantics in `common/spinner-contract.ts`.
- Do not change locked marking/render-mode/AI/property-lock behavior; this
  track only changes where spinner state is owned and projected.
- Do not delete `popup-state-broker.ts`; it still owns popup lifecycle/trace
  compatibility for non-spinner fields.

## New contracts

Add `common/bus/contracts/spinner.ts` for the existing bus event names and
render payload shapes:

- `SPINNER_EVENT_TYPES.SET = "spinner.set"`
  - owner/emitter: `background`
  - payload: `SpinnerSetPayload`
- `SPINNER_EVENT_TYPES.CLEAR = "spinner.clear"`
  - owner/emitter: `background`
  - payload: `SpinnerClearPayload`

Type shapes:

- `SpinnerSurface = "popup" | "pageCurtain" | "banner"`
- `SpinnerViewState`
  - `title:string`
  - `message:string`
  - `timerMode:SpinnerTimerMode`
  - `deadlineAt:number`
  - `startedAt:number`
  - `blockSurfaces:SpinnerBlockSurfaces`
  - `operationKind:string`
  - `operationPhase:string`
  - `operationId?:string`
- `SpinnerSetPayload = { surface: SpinnerSurface; state: SpinnerViewState }`
- `SpinnerClearPayload = { surface: SpinnerSurface }`

Track 2 does **not** add a new popup/content request type up front. The first
migration slices feed the Brain from the still-live legacy queue adapters;
deleting those adapters happens only after the Brain publishes the same
spinner states behavior-safely.

## Files

- add:
  - `common/bus/contracts/spinner.ts`
  - `background/brain/deciders/spinner-state-decider.ts`
  - `tests/spinner-state-decider.test.ts`
- edit:
  - `background/brain/index.ts`
  - `background/spinner-operations.ts`
  - `background.ts`
  - `popup.ts`
  - `popup/spinner.ts`
  - `popup/layers/layer-host.ts`
  - `content/layers/layer-host.ts`
  - `tests/background-spinner-operations.test.js`
  - `tests/popup-spinner.test.js`
  - `tests/spinner-authority.test.ts`
  - `tests/popup-marking-refresh.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/lifecycle-broker.test.js`
- delete (only after replacement is green):
  - popup-local authoritative spinner queue decisions in `popup.ts` /
    `popup/spinner.ts`
  - legacy direct spinner queue ownership in `background/spinner-operations.ts`
    (after it becomes a thin Brain-fed adapter or is fully removed)

## Steps (in execution order)

1. Add typed spinner bus contracts and convert the Brain/layer host wiring to
   use them explicitly.
   - expected intermediate state: no behavior change; spinner layer traffic has
     typed payloads/constants, and boundary tests stay green.
   - focused validation: `pnpm test tests/popup-layer-host.test.ts tests/content-layer-host.test.ts tests/bus-boundary.test.ts tests/spinner-authority.test.ts`
   - rollback rule: delete `common/bus/contracts/spinner.ts` and revert the
     constant/type imports.
2. Add a pure spinner-state decider that derives `state.spinners.*`
   selections from the legacy serialized queue shape.
   - expected intermediate state: pure helper exists with focused regression
     coverage, but production code does not use it yet.
   - focused validation: `pnpm test tests/spinner-state-decider.test.ts tests/spinner-authority.test.ts`
   - rollback rule: delete the decider/test and revert any unused imports.
3. Mirror background spinner queue mutations into the Brain store.
   - expected intermediate state: every background spinner queue mutation also
     updates `state.spinners.popup/pageCurtain/banner`, so the existing spinner
     layers receive Brain-authored `spinner.set` / `spinner.clear` updates while
     popup local queue authority still exists as compatibility scaffolding.
   - focused validation: `pnpm test tests/background-spinner-operations.test.js tests/spinner-state-decider.test.ts tests/popup-layer-host.test.ts tests/content-layer-host.test.ts`
   - rollback rule: remove the Brain mirror callback and leave the old queue
     path authoritative.
4. Move popup busy/page-busy derivation onto Brain spinner state while keeping
   optimistic behavior intact.
   - expected intermediate state: popup UI busy state and page-busy mirror no
     longer depend on the popup-local queue as the source of truth.
   - focused validation: `pnpm test tests/popup-spinner.test.js tests/popup-marking-refresh.test.js tests/popup-render-mode.test.js`
   - rollback rule: restore queue-based popup busy derivation and retain the
     mirrored Brain state for rendering only.
5. Remove the remaining popup/background legacy spinner authority paths once
   the Brain path is green and behavior-equivalent.
   - expected intermediate state: the Brain is the only authoritative spinner
     owner; popup/content layers render verbatim; legacy queue authors become
     thin publishers or are deleted.
   - focused validation: `pnpm test tests/popup-spinner.test.js tests/background-spinner-operations.test.js tests/lifecycle-broker.test.js tests/popup-marking-refresh.test.js`
   - rollback rule: revert the legacy-deletion commit first, then any Brain
     authority slices if needed.

## Tests

- add/rewrite:
  - `tests/spinner-state-decider.test.ts`
    - blocking legacy lease maps to popup + page-curtain selections
    - non-blocking legacy lease maps to banner selection
    - later queue entries win per surface
  - `tests/background-spinner-operations.test.js`
    - queue mutations call the Brain mirror hook with the expected serialized
      queue snapshot
  - `tests/popup-spinner.test.js`
    - popup busy/page-busy behavior stays unchanged once Brain spinner state
      becomes authoritative
  - `tests/popup-layer-host.test.ts` / `tests/content-layer-host.test.ts`
    - continue proving render-only spinner layer behavior with typed event names

## Validation

- focused: `pnpm test <files>` while iterating.
- full (before each commit + at track end):
  ```bash
  pnpm lint
  pnpm check
  pnpm test
  pnpm build
  ```
- live: not required by the master plan for Track 2, but if a later slice makes
  popup/page blocking behavior uncertain and automated coverage is insufficient,
  defer live validation to the first Track 3/4 slice that already requires it.

## Acceptance criteria (observable)

- Spinner title/message/timer/blocking surfaces are projected only from
  `background/brain/spinner-authority.ts` plus the new Track 2 decider path;
  popup/content layer modules remain render-only.
- Popup/content spinner layers consume typed `spinner.set` / `spinner.clear`
  payloads and never import the phase registry directly.
- The popup/local/background legacy spinner authority paths are deleted or
  reduced to thin compatibility publishers, and the suite is green.
- `pnpm verify` passes with no user-visible spinner regressions in focused
  popup/background tests.

## Regression risks + detection

- Half-migrated dual authority (legacy queue and Brain both writing conflicting
  spinner truth). Detection: `tests/background-spinner-operations.test.js`,
  `tests/popup-spinner.test.js`, and source grep for remaining mutators.
- Surface drift (`popup` vs `pageCurtain` vs `banner`). Detection:
  `tests/spinner-state-decider.test.ts`,
  `tests/content-layer-host.test.ts`, and `tests/popup-layer-host.test.ts`.
- Navigation inspection curtain regression. Detection:
  `tests/lifecycle-broker.test.js` and `tests/popup-marking-refresh.test.js`.
- Page-busy mirror regressions from changing popup queue ownership. Detection:
  `tests/popup-render-mode.test.js` and `tests/popup-spinner.test.js`.
- Legacy-name collisions or untyped hardcoded event strings lingering.
  Detection: focused grep plus `tests/bus-boundary.test.ts`.

## Rollback rule

- Revert the legacy-deletion slice first so the old popup/background spinner
  authority resumes immediately.
- Then revert the Brain mirror / decider slices if needed.
- Never leave both the popup-local queue and Brain state independently deciding
  visible spinner state for the same surface.
