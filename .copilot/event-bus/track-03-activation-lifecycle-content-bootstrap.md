# Track 03 — Activation + lifecycle + content bootstrap

> Parent plan: `.copilot/event-bus-architecture-plan.md` (master spec, track map
> §7, guardrails §8). Foundation references:
> `.copilot/event-bus/track-00-foundation.md`,
> `.copilot/event-bus/track-01-popup-state-channel.md`, and
> `.copilot/event-bus/track-02-spinner-authority.md`.
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
- `pnpm verify` passed at the Track 2 boundary.

## Approval gate

None — wrap-only; this track relocates activation/lifecycle/bootstrap authority
and does not change locked marking, AI, render-mode, or property-lock behavior.

## Goal

Move activation state, lifecycle event authority, and content-bootstrap truth
into the Brain so popup/content no longer decide or bootstrap the navigation
inspection curtain locally. User-visible behavior must stay unchanged: content
activation retries, reload/devtools reinjection restore, lifecycle-driven
curtain teardown, content-ready reporting, and the render-mode/marking curtain
timing must match current behavior while the Brain becomes the single
authoritative owner of activation/lifecycle state.

## Current facts (re-verified this session)

- `background.ts:403-429` `ensureContentMainForTab(tabId)` owns the current
  content-bootstrap retry loop: send `activateContentMain`, force inject on
  failure, retry up to 5 times, then return `{ ok:false, error }`.
- `background.ts:3318-3367` `restoreEnabledStateForTab(tabId, tabState, attempt)`
  owns developer-console/navigation reinjection restore. It starts an
  activation lifecycle event, sends `setEnabled`, retries four more times when
  the page is not locked, and only clears reload-restore state after success.
- `background.ts:2647-2651` still accepts the legacy
  `WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT` message directly and routes it to
  `popupStateBroker.updateLifecycleState`.
- `background/popup-state-broker.ts` remains the current owner of
  per-tab lifecycle snapshots and the terminal lifecycle -> navInspect curtain
  clear side effect, which Track 3 must relocate without changing the terminal
  clear contract locked by `tests/lifecycle-broker.test.js`.
- `content-main.ts:691-728` `emitLifecycleEvent(event)` is the current content
  lifecycle emitter. It normalizes `reason`/`source`, includes
  `contentMode`, `markingEnabled`, and `pageUrl`, and sends the legacy runtime
  message `WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT`.
- `content-main.ts:7307-7308` emits
  `{ kind: CONTENT_READY, phase: FINISHED, message: "" }` when content main is
  ready, and multiple other callsites emit activation/render-mode lifecycle
  updates through the same helper.
- `popup.ts:3150-3191` `beginNavigationInspectionOverlay` /
  `endNavigationInspectionOverlay` still own popup-local `navInspect` spinner
  bootstrap/teardown and render-mode settle guards, even though Track 2 moved
  spinner rendering authority to the Brain.
- `popup.ts:3681-3698` still sends the legacy runtime message
  `activateContentForTab` during popup refresh when the tab becomes in-scope and
  the initial tab state was not yet activated.
- `background/tab-runtime.ts` still owns separate runtime bookkeeping for
  `contentReady`, `mode`, `operation`, `lifecycle`, and `spinnerQueue`.
- `background/brain/state-store.ts` currently stores only `popupView` legacy
  snapshot fields plus `spinners.{popup,pageCurtain,banner}`; it has no
  authoritative activation/content-bootstrap domain yet.
- `background/brain/view-projector.ts` currently projects
  `contentDirective: { version }` only, so content-layer Brain directives do not
  yet carry activation/lifecycle/bootstrap state.
- `popup/layers/layer-host.ts` and `content/layers/layer-host.ts` are already
  subscribed to `view.popup`, `directive.content`, and `spinner.set/clear`; they
  remain render-only and must not grow decision logic.
- Current tests locking this domain include:
  - `tests/lifecycle-broker.test.js`
  - `tests/content-activation-order.test.js`
  - `tests/background-marking-activation.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/popup-marking-refresh.test.js`
  - `tests/device-emulation-lifecycle.test.js`
  - `tests/bus-boundary.test.ts`

## New contracts

Add `common/bus/contracts/activation.ts` for the typed Track 3 domain wire.

- `ACTIVATION_REQUEST_TYPES.ENSURE_CONTENT_READY = "activation.ensureContentReady"`
  - authoritative owner: `background`
  - caller realms during Track 3: `background` wrappers first; later tracks may
    reuse it from popup/content helpers instead of ad hoc legacy activation
    calls
  - payload: `ActivationEnsureContentReadyPayload`
    `{ reason:string; allowReinject?:boolean }`
  - reply: `ActivationEnsureContentReadyReply`
    `{ ok:boolean; tabId:number; contentReady:boolean; attempts:number; error?:string }`
- `ACTIVATION_EVENT_TYPES.LIFECYCLE_REPORTED = "activation.lifecycleReported"`
  - owner/emitter during Track 3: `content` (published through the content bus
    client whenever legacy `emitLifecycleEvent` would have fired)
  - payload: `ActivationLifecycleReportedPayload`
    `{ kind:string; phase:string; message:string; busy?:boolean; operationId?:string; reason:string; source:string; contentMode:string; markingEnabled:boolean; pageUrl:string }`
- `ACTIVATION_EVENT_TYPES.CONTENT_READY = "activation.contentReady"`
  - owner/emitter: `content`
  - payload: `ActivationContentReadyPayload`
    `{ pageUrl:string; contentMode:string; markingEnabled:boolean }`
- `ACTIVATION_EVENT_TYPES.RESTORE_REQUESTED = "activation.restoreRequested"`
  - owner/emitter during Track 3: `background` tab-update/reload restore paths
  - payload: `ActivationRestoreRequestedPayload`
    `{ baseUrl:string; pageType:string; operationId:string; performInitialReveal:boolean }`

Add typed state shapes in `background/brain/state-store.ts`:

- `activation.contentReady:boolean`
- `activation.bootstrapStatus:"idle" | "bootstrapping" | "ready" | "failed"`
- `activation.restorePending:boolean`
- `activation.lastError:string`
- `activation.lastLifecycle: ActivationLifecycleSnapshot | null`
- `activation.lastContentPageUrl:string`

Add typed projections:

- popup view gains a read-only activation snapshot block for parity assertions
  and to let popup-side refresh paths observe Brain-owned lifecycle state
  without re-reading legacy globals
- content directive gains an `activation` block that is the single Brain-owned
  input for content bootstrap/restore executors

No new type may reuse a legacy `WORLD_MESSAGE_TYPES.*` string.

## Files

- add:
  - `common/bus/contracts/activation.ts`
  - `background/brain/deciders/activation-decider.ts`
  - `tests/activation-decider.test.ts`
- edit:
  - `common/bus/contracts/index.ts`
  - `background/brain/index.ts`
  - `background/brain/state-store.ts`
  - `background/brain/view-projector.ts`
  - `background.ts`
  - `content-main.ts`
  - `popup.ts`
  - `background/popup-state-broker.ts`
  - `tests/lifecycle-broker.test.js`
  - `tests/content-activation-order.test.js`
  - `tests/background-marking-activation.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/popup-marking-refresh.test.js`
  - `tests/device-emulation-lifecycle.test.js`
  - `tests/bus-boundary.test.ts`
- delete (only after the replacement is green):
  - direct popup-local `beginNavigationInspectionOverlay` /
    `endNavigationInspectionOverlay` authority
  - the direct background `WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT` authority path
    once the bus event replacement is live

## Steps (in execution order)

1. Add the activation contracts and Brain state scaffolding.
   - expected intermediate state: typed activation contracts exist, the Brain
     store/projector can represent activation state, and focused projection tests
     cover the new shapes; runtime behavior is unchanged.
   - focused validation:
     `pnpm test tests/activation-decider.test.ts tests/bus-boundary.test.ts tests/lifecycle-broker.test.js`
   - rollback rule: remove `common/bus/contracts/activation.ts`, undo the new
     store/projector fields, and delete any unused test scaffolding.
2. Add the activation decider and route legacy lifecycle/bootstrap updates into
   Brain mutators without deleting the legacy message path yet.
   - expected intermediate state: lifecycle events, content-ready reports, and
     ensure-content bootstrap results are mirrored into Brain activation state;
     popup/content behavior is still driven by the legacy path for safety.
   - focused validation:
     `pnpm test tests/activation-decider.test.ts tests/lifecycle-broker.test.js tests/content-activation-order.test.js tests/device-emulation-lifecycle.test.js`
   - rollback rule: revert the decider registration and restore direct legacy
     broker writes while keeping the contracts/tests from step 1.
3. Move reload/devtools restore and popup in-scope bootstrap onto the Brain
   activation request/event path.
   - expected intermediate state: `ensureContentMainForTab`,
     `restoreEnabledStateForTab`, and the popup in-scope activation path speak
     the typed activation contract, while their retry/timeout behavior stays
     identical.
   - focused validation:
     `pnpm test tests/background-marking-activation.test.js tests/content-activation-order.test.js tests/device-emulation-lifecycle.test.js`
   - rollback rule: restore the direct `activateContentMain` /
     `activateContentForTab` / `setEnabled` legacy wrappers first.
4. Move navigation-inspection curtain bootstrap/teardown to Brain-projected
   activation/lifecycle state and render-only layer behavior.
   - expected intermediate state: popup no longer decides when to push/pop the
     navInspect curtain locally; Brain lifecycle state plus Track 2 spinner
     authority produce the same visible curtain timing and settle-guard behavior.
   - focused validation:
     `pnpm test tests/popup-render-mode.test.js tests/popup-marking-refresh.test.js tests/lifecycle-broker.test.js`
   - rollback rule: restore popup-local overlay helpers before reverting Brain
     activation state projection.
5. Delete the remaining legacy lifecycle/curtain authority and finish the track.
   - expected intermediate state: the Brain is the only authoritative owner of
     activation/lifecycle/bootstrap state; popup/content layers are thin and the
     direct legacy lifecycle path is gone.
   - focused validation:
     `pnpm test tests/activation-decider.test.ts tests/lifecycle-broker.test.js tests/popup-render-mode.test.js tests/popup-marking-refresh.test.js tests/background-marking-activation.test.js tests/content-activation-order.test.js tests/device-emulation-lifecycle.test.js`
   - rollback rule: revert the legacy-deletion commit first so the old path
     resumes immediately, then revert the Brain activation slices if needed.

## Tests

- add/rewrite:
  - `tests/activation-decider.test.ts`
    - `activation.ensureContentReady` normalizes replies and writes the Brain
      state only through store mutators
    - lifecycle/content-ready events update the Brain activation snapshot
    - duplicate activation handler registration is not allowed
  - `tests/lifecycle-broker.test.js`
    - update source-contract assertions so the curtain teardown is still gated on
      curtain-bearing terminal lifecycle kinds, but the authoritative write path
      is the Track 3 activation decider/store instead of popup-local helpers
  - `tests/content-activation-order.test.js`
    - preserve current restore ordering: content refresh before highlight
      refresh, no reveal/freeze on restore-only paths
  - `tests/background-marking-activation.test.js`
    - preserve requested-tab routing, retry/error handling, and lock reporting
      while activation requests move to the Brain contract
  - `tests/popup-render-mode.test.js`
    - preserve in-scope nav curtain bootstrap and hold-until-first-inspection
      behavior with Brain authority
  - `tests/popup-marking-refresh.test.js`
    - remove assertions that require popup-local authority once the Brain
      projection owns the nav curtain, but keep the user-visible timing contract
  - `tests/device-emulation-lifecycle.test.js`
    - preserve reload completion -> request content activation -> restore enabled
      state ordering

## Validation

- focused: `pnpm test <files>` while iterating.
- full (before each commit + at track end):
  ```bash
  pnpm lint
  pnpm check
  pnpm test
  pnpm build
  ```
- live (required for this track):
  ```bash
  pnpm browser:live <target-url>
  ```
  Use the committed launcher only, and reload the unpacked extension/service
  worker after each rebuild before observing.

## Acceptance criteria (observable)

- The Track 3 activation/lifecycle state is authored only through
  `background/brain/deciders/activation-decider.ts` + `state-store.ts`; no
  popup/content layer module owns authoritative activation or curtain state.
- Content bootstrap retries, reload/devtools restore, content-ready reporting,
  and lifecycle-driven nav curtain teardown behave the same as before in the
  focused tests and live browser checks.
- `popup.ts` no longer owns the authoritative `navInspect` bootstrap/teardown
  path; it only renders/proxies Brain state.
- The direct legacy `WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT` authority path is
  deleted or reduced to a thin compatibility bridge, and the suite is green.
- `pnpm verify` passes; required live validation shows unchanged activation and
  render-mode curtain behavior.

## Regression risks + detection

- Half-migrated dual authority between popup-local overlay helpers and Brain
  activation state. Detection: `tests/popup-render-mode.test.js`,
  `tests/popup-marking-refresh.test.js`, and grep for
  `beginNavigationInspectionOverlay` / `endNavigationInspectionOverlay`.
- Reload/devtools restore timing drift that reruns reveal/freeze or drops lock
  handling. Detection: `tests/content-activation-order.test.js`,
  `tests/device-emulation-lifecycle.test.js`, and
  `tests/background-marking-activation.test.js`.
- Content bootstrap retry regressions that stop reinjection from recovering
  background-driven commands. Detection: `tests/background-marking-activation.test.js`
  and `tests/ai-run.test.js` / `tests/render-mode-inspector.test.js` if edited.
- Legacy-name collisions between new activation contracts and old message types.
  Detection: `tests/bus-boundary.test.ts` plus focused grep for the new string
  constants.
- Terminal lifecycle curtain clear drift. Detection:
  `tests/lifecycle-broker.test.js` and live render-mode inspection smoke.

## Rollback rule

- Revert the legacy-deletion slice first so the direct popup/background
  lifecycle/bootstrap path becomes authoritative again.
- Then revert the Brain activation state / contract slices if needed.
- Never leave the tree with both popup-local overlay helpers and Brain
  activation state independently deciding the visible navInspect curtain.
