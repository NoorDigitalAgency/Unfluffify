# Unfluffify Event-Bus (Brain) Rearchitecture — Master Plan (WXT baseline)

Last updated: 2026-06-24
Branch: `feat/wxt-port-plan`
Status: APPROVED PLAN — runs as **Part B** of the WXT port program. Part A (WXT
toolchain cutover) must be fully green before Track 0 (Foundation) starts.

This document is the authoritative specification for the event-bus (Brain)
rearchitecture, **adapted to run on the WXT + pnpm + Vitest baseline produced by
Part A** of `.copilot/wxt-port-plan.md`. It is written so a low-context agent can
execute it without inventing architecture, guessing file paths, or making
unresolved product decisions. Where a decision still needs the user, the plan
marks an explicit **APPROVAL GATE** and the executor must stop and ask.

> Provenance: this spec is the WXT-baseline rewrite of the originally approved
> event-bus master plan (commit `31ab189` on `feat/event-bus-architecture`, which
> targeted the legacy Deno/esbuild build). The architecture (bus, envelope,
> transport, Brain, layers, spinner authority, strangler-fig migration, lock
> gates, track map) is unchanged. Only the toolchain bindings (entrypoints,
> bundling, generated manifest, validation commands, live-debug flow) are
> WXT-adapted. See §11 for the full Deno→WXT reconciliation so nothing is lost.

Read these in order before doing anything in Part B:

1. `.copilot/wxt-port-plan.md` (program index; confirms Part A is complete).
2. This file (goal, decisions, target architecture, migration framework, track
   map, guardrails, WXT reconciliation).
3. `.copilot/event-bus/track-00-foundation.md` (full step-by-step for Track 0 on
   the WXT baseline).
4. `.copilot/event-bus/track-template.md` (the per-domain executor-doc template).
5. `.copilot/knowledge.md` (durable domain rules and locked contracts).
6. `.copilot/plan.md` (active plan index).
7. The exact source files and tests named in each track.

---

## 0. Precondition: Part A must be complete

Track 0 builds on the WXT baseline. Do not start until ALL of these hold (they
are the exit criteria of Part A in `.copilot/wxt-port-plan.md`):

- The extension builds and loads from WXT (`pnpm build` → `.output/chrome-mv3/`)
  and `pnpm dev` produces a loadable dev build.
- The legacy Deno/esbuild build (`scripts/build-extension.ts`) and the custom
  packaging path are removed; there is one toolchain (WXT).
- The current runtime modules (`background.ts`, `popup.ts`, `content-loader.ts` /
  `content-main.ts`, `offscreen.ts`, `common/page-motion-freeze-bridge.ts`) run
  unchanged in behavior, wrapped by WXT entrypoints under `entrypoints/`.
- The test suite runs on Vitest (`pnpm test`) and is green; type-check
  (`pnpm check`) and lint (`pnpm lint`) are green.
- `pnpm browser:live <url>` reproduces the live-debug capability (bound popup,
  `state`/`observe`/`exit-preview`, CDP attach).

If any precondition is false, stop and finish Part A first. Track 0 does not fix
toolchain gaps.

---

## 1. Goal

Replace the current entangled, directly-interacting architecture with a
hub-and-spoke event-bus design across all four extension realms (background
service worker, content ISOLATED world, page MAIN world, popup). The end state:

- One **in-realm event bus** per realm exposing a dual primitive: awaitable
  `request(type,payload) -> Promise<reply>` (one authoritative handler) and
  `publish(event) -> Promise<void>` (fan-out to all listeners, resolves when
  every async listener settles).
- A **cross-realm transport** that bridges the four buses over Chrome's native
  messaging, ports, and the existing nonce-protected page-world relay.
- A single **authoritative logical/decision unit (the "Brain")** that lives in
  the background service worker and makes every cross-cutting logical decision,
  split into per-domain deciders.
- **Stateless layers** (popup modes, content modes) that hold no authoritative
  state, never decide cross-cutting logic, never reach across mode boundaries,
  and only execute Brain directives + report events over the bus.
- **Per-layer spinners** whose state (title, message, optional countdown,
  optional elapsed timer) is computed by the Brain's spinner authority and only
  rendered by each visual layer.

The user-visible behavior of the shipped extension must not regress, except where
a per-domain **lock-lifting approval** is explicitly granted (see §4).

This is delivered incrementally (strangler-fig): the bus + Brain skeleton is
stood up alongside the existing code (still wrapped by WXT entrypoints), then one
domain at a time is moved onto it, its wire vocabulary is redesigned, and its
tests are rewritten. The legacy path for a domain is deleted only after its
replacement is green.

---

## 2. Approved decisions (locked for this program)

These were decided with the user during pre-planning. Do not relitigate them; if
implementation reveals a conflict, stop and ask.

1. **Migration posture: incremental strangler-fig.** Stand up the bus + Brain
   beside existing code; migrate one domain at a time; keep the suite green at
   each track boundary. No big-bang rewrite.
2. **Locked contracts: lift selectively, per-domain, with explicit approval.** By
   default every locked behavior (marking taxonomy, target resolution, sync
   semantics, overlay projection, default-exclusion, silent highlighting,
   visibility, page-save reconciliation, XPath calculation, AI submission) and
   `content/core.ts` is **wrap-only**: the rearchitecture changes how layers
   communicate, never what these do. A track that needs to refactor locked logic
   into a stateless layer must pass an APPROVAL GATE first (§4).
3. **Wire protocol: redesigned.** New cross-realm message/event names and
   payloads are introduced. The old envelope vocabulary
   (`common/message-protocol.ts` names, world-message names, spinner-phase wire
   reasons, storage keys where they are part of the wire) is replaced
   domain-by-domain, and the affected tests are rewritten as part of each track. A
   dual-protocol bridge (§6) lets old and new coexist mid-migration.
4. **Authority model: background SW is the single Brain.** Content and popup get
   thin local relays plus per-mode controllers that only execute Brain commands
   and report events. Page-DOM/marking decisions stay physically local (the DOM
   only exists in content/page) but are *driven by* Brain commands; the local
   executor performs no cross-cutting policy of its own.
5. **Bus API: dual primitive.** `request` (single authoritative handler,
   awaitable, throws a typed `BusError` on a failure reply) plus `publish`
   (fan-out to all subscribers, resolves when all async listeners settle, never
   throws on a listener error — errors are collected and logged).
6. **Spinner authority: the Brain.** The Brain computes spinner state per visual
   layer following the global spinner contract and pushes it. Layers render only
   and never self-decide spinner content.
7. **Page MAIN world stays minimal.** The page-world relay remains a thin,
   nonce-protected conduit for the existing low-level signals only (arm, motion
   paused, lazy-loading suppressed, destroy). No logic moves into the MAIN world.
   The "thin relay between the main world and the bus" is the content
   ISOLATED-world adapter that forwards those signals to/from the bus.
8. **Bundling is the default (WXT).** Part A switched the build to WXT, which
   bundles each entrypoint with Vite and emits sourcemaps that map back to the
   TypeScript. This **supersedes** the historical "every new `content/*` module
   must be a separate web-accessible resource" rule for the bundled content
   entrypoint. New bus/brain/layer modules are imported through the normal ESM
   graph and bundled into the content script; they do **not** need individual
   `web_accessible_resources` entries. Only files loaded into the page world via
   `chrome.runtime.getURL(...)` (cursor SVGs, any injected HTML) remain
   web-accessible, declared in `wxt.config.ts` or placed in `public/`. This means
   the legacy plan's "APPROVAL GATE B (bundled content entry)" is **already
   resolved by the WXT migration** and is removed from Track 0.

### 2a. WXT-baseline decisions (added for Part B)

These follow from the Part A decisions in `.copilot/wxt-port-plan.md` and are
locked here so no track re-decides them:

9. **Validation command surface is pnpm/WXT/Vitest** (see §8.1). Every track uses
   `pnpm lint`, `pnpm check`, `pnpm test` (Vitest), `pnpm build`, and
   `pnpm browser:live <url>` for live validation. No `deno task` commands remain.
10. **Brain modules are plain ESM modules** under the existing folders
    (`common/bus/*`, `background/brain/*`, `popup/layers/*`, `content/layers/*`)
    and are imported by the WXT entrypoints. They are not themselves entrypoints.
11. **WXT entrypoint build constraint.** WXT imports `entrypoints/background.ts`
    and content entrypoints in a Node environment at build time to read their
    options, so no runtime code (chrome APIs, side-effectful imports) may run at
    module top level — it must run inside `defineBackground(main)` /
    `defineContentScript({ main })`. Brain wiring (`createBrain()`,
    `startContentBusClient()`, `startPopupBusClient()`) is therefore invoked from
    inside the entrypoint `main`, exactly where Part A already invokes the legacy
    module bootstrap.

---

## 3. Current facts (verified — re-confirm at execution time)

Cited so the executor does not rely on memory. Line numbers are approximate and
must be re-confirmed with a fresh read. These describe the **post-Part-A WXT
baseline**: the same runtime modules, now wrapped by WXT entrypoints.

### Realms and transport today

- Four realms: background SW (`background.ts`, ~3.5k lines, wrapped by
  `entrypoints/background.ts`), content ISOLATED (`content-main.ts`, ~7.5k lines +
  `content/*`, loaded by `content-loader.ts` via the content entrypoint), page
  MAIN world (`common/page-motion-freeze-control.ts` via
  `chrome.scripting.executeScript` + `common/page-motion-freeze-bridge.ts`
  world:MAIN content script), and popup (`popup.ts`, ~8.4k lines + `popup/*`,
  wrapped by the popup entrypoint).
- Cross-realm wire today:
  - Envelope request/reply protocol: `common/message-protocol.ts`
    (`createRequestEnvelope`, `createSuccessEnvelope`, `createFailureEnvelope`,
    `isRequestEnvelope`, `isReplyEnvelope`, `MESSAGE_SOURCES`, `MESSAGE_TARGETS`,
    `MESSAGE_ERROR_CODES`).
  - Async send helpers: `common/async-messaging.ts` (`requestRuntime`,
    `requestTab`, `requestContent`, `requestWithChromeCallback`,
    `MessageRequestError`).
  - World messages (popup state + spinner + lifecycle):
    `common/world-messaging-contract.ts` (`WORLD_MESSAGE_TYPES`,
    `LIFECYCLE_KINDS`, `LIFECYCLE_PHASES`, `CONTENT_MODES`, `SPINNER_KEYS`,
    `buildPopupStatePortName`, `isCurtainBearingLifecycleKind`,
    `isLifecycleTerminalPhase`).
  - Spinner contract: `common/spinner-contract.ts` (`SPINNER_OPERATION_KINDS`,
    `SPINNER_OPERATION_PHASES`, `SPINNER_TIMER_MODES`, `SPINNER_RECOVERY_POLICIES`,
    `SPINNER_PHASE_REGISTRY`, `SPINNER_REASON_PHASE_ALIASES`,
    `createSpinnerOperationLease`).
  - Page-world relay: `content/page-world-relay.ts` (`initializePageWorldRelay`,
    `requestPageWorldCommand`, `isPageWorldRelayReady`) over
    `common/page-world-protocol.ts` (`PAGE_WORLD_COMMANDS`,
    `PAGE_WORLD_RELAY_CHANNEL`, `PAGE_WORLD_RELAY_MESSAGE_KINDS`,
    `isPageWorldRelayCommand`).

### Background authority today

- `background/command-router.ts:registerBackgroundCommand(type, handler,
  options)` registers one handler per command type into a module
  `Map<string,{handler,options}>`; dispatch validates via `isRequestEnvelope` and
  returns `createSuccessEnvelope`/`createFailureEnvelope`. ~17 commands are
  registered in `background.ts`.
- `background/popup-state-broker.ts:createPopupStateBroker(options)` owns per-tab
  `lifecycleStateByTabId`, `spinnerQueueByTabId`, `popupStatePortsByTabId`;
  exposes `updateLifecycleState(tabId,event)` and pushes
  `WORLD_MESSAGE_TYPES.BACKGROUND_STATE` snapshots over `ufPopupState:<tabId>`
  ports. Curtain teardown is a side effect inside `updateLifecycleState` (terminal
  curtain-bearing lifecycle clears the `navInspect` spinner).
- `background/spinner-operations.ts:createSpinnerOperations(options)` owns the
  per-tab spinner queue map, normalizes entries via `createSpinnerOperationLease`,
  and broadcasts state. Six global state Maps live in
  `background/background-tab-state.ts`.
- `background/ai-run-orchestrator.ts` runs the AI pipeline state machine and
  drives AI_RUN spinner phases.
- Master `chrome.runtime.onMessage` listener in `background.ts` is the single
  inbound funnel; it dispatches commands, world spinner messages, lifecycle
  events, and legacy fall-through messages. Port listener
  (`chrome.runtime.onConnect`) handles `ufPopupState:<tabId>` connections. After
  Part A, this listener is registered from inside `defineBackground(main)` (same
  code, invoked from the entrypoint).

### Popup today

- `popup.ts` imports `buildPopupStatePortName`; connects
  `chrome.runtime.connect({ name: buildPopupStatePortName(tabId) })` and updates
  UI on `WORLD_MESSAGE_TYPES.BACKGROUND_STATE`. Also an
  `chrome.runtime.onMessage.addListener` for push messages. Invoked from the popup
  entrypoint after Part A.
- `popup/state.ts` holds a single mutable `state` object mixing immutable config,
  mutable session state, UI transients, timer handles, remote async state, and
  feature flags. `refreshUi()` recomputes derived gates (`isMarkingEnabled`,
  `canSaveNow`, preview-allowed, etc.) from many fields each call.
- `popup/spinner.ts` owns the popup spinner queue (`pushSpinner`, `popSpinner`,
  `runWithSpinner`) and syncs entries to background; `popup/ui.ts` renders.
- Popup modes (implicit, gated by `state` fields): configuration, marking, preview
  (Show Content List), render-mode detection overlay, silent (extension disabled
  but render-ready), AI-run-in-marking. No central router.

### Content today

- `content-loader.ts` dedups and lazy-imports `content-main.ts:main()`. After Part
  A, the content entrypoint calls into this loader.
- `content/runtime-message-handler.ts:handleRuntimeMessage(...)` handles ~30
  message types; `content/content-command-router.ts:dispatchContentCommand(...)`
  routes registered handlers; `content/content-main-service-registry.ts`
  lazy-creates ~22 handler services.
- `content-main.ts` holds ~50 mutable globals (`aiPreviewState`,
  `propertyLockState`, `renderModeInspectionActive`, etc.), emits lifecycle events
  via `emitLifecycleEvent(...)` (`WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT`), and owns
  mode transitions inline.
- `content/core.ts` (LOCKED, ~12.8k lines) is the marking engine + DOM mutation +
  page-motion freeze coordination. Public surface: `state` object and ~40 exported
  functions (`enableForBaseUrl`, `disable`, `pausePageMotion`, `syncPageMarkings`,
  `renderHighlightsInner`, `refreshFromTabState`, etc.).

### Build and validation today (post Part A)

- Build: **WXT** (Vite). `pnpm build` emits `.output/chrome-mv3/`; `pnpm dev`
  emits a loadable dev build. Manifest is generated by `wxt.config.ts` +
  entrypoint options. Content scripts are bundled; new ESM modules imported by the
  content entrypoint need NO individual `web_accessible_resources` entry.
- Commands (`package.json` scripts): `pnpm lint` (`eslint .`), `pnpm check`
  (`wxt prepare && tsc --noEmit`), `pnpm test` (`vitest run`), `pnpm build`
  (`wxt build`), `pnpm zip` (`wxt zip`), `pnpm verify`
  (`pnpm lint && pnpm check && pnpm test && pnpm build`).
- Tests live in `tests/` and run on **Vitest** (migrated from Deno test in Part
  A). Boundary tests already exist (`tests/background-decomposition-boundary.test.*`,
  `tests/content-decomposition-boundary.test.*`); Track 0 adds a bus boundary
  test.
- Live browser: `pnpm browser:live <url>` builds the WXT dev output and drives the
  repo MCP Chromium (see `.github/skills/launch-test-browser`), loading
  `.output/chrome-mv3/` (or the dev output dir configured in `wxt.config.ts`).

---

## 4. Lock-lifting approval gates

Default is wrap-only. The following domains contain locked behavior. Each has an
APPROVAL GATE that the executor MUST pass (ask the user a deterministic
multiple-choice question and get a yes) before refactoring locked internals
rather than merely wrapping them. Wrapping (calling existing locked functions
behind a bus-driven executor without changing their inputs/outputs/behavior)
never needs a gate.

- **GATE M — Marking engine internals** (`content/core.ts`, marking taxonomy,
  target resolution, sync semantics, overlay projection, default exclusions).
  Required before Track 8 changes anything inside `core.ts` or marking rules.
- **GATE S — Silent highlighting** (`content/silent-highlight-rules.ts`, silent
  collection/visibility). Required before Track 9 changes silent internals.
- **GATE X — XPath + AI submission** (`content/submission-rules.ts`,
  `content/*-xpaths-handler.ts`, AI payload construction). Required before any
  track changes XPath/submission internals.
- **GATE R — Page-save reconciliation semantics**. Required before Track 7 changes
  reconciliation behavior rather than relocating its triggers.
- **GATE P — Property lock semantics** (countdowns, recovery cooldowns, release
  protocol). Required before Track 10/11 changes lock behavior.

The default for every track is: **relocate orchestration and communication only;
do not change the locked behavior**. Each locked track's executor doc will open
with its gate and the exact wording of the question to ask.

> Note: there is no APPROVAL GATE B in this WXT-baseline plan. The legacy plan's
> bundling gate is resolved — WXT bundles the content entry by default
> (decision §2.8).

---

## 5. Target architecture specification

### 5.1 Module layout (new)

These are plain ESM modules, imported by the WXT entrypoints. They are NOT
entrypoints themselves. (`entrypoints/*` wrappers were created in Part A and call
into the existing runtime modules; Track 0 wires the bus/Brain bootstrap into
those same entrypoint `main` functions.)

```
common/bus/
  envelope.ts            # BusEnvelope wire format + guards + id helpers
  bus.ts                 # in-realm Bus: request/tryRequest/registerHandler/publish/subscribe
  bus-errors.ts          # BusError + BUS_ERROR_CODES
  realms.ts              # REALMS, REALM ids, target helpers
  contracts/             # typed request/event registries, split by domain
    index.ts
    activation.ts spinner.ts ai-run.ts render-mode.ts config.ts
    page-save.ts marking.ts silent.ts preview.ts property-lock.ts emulation.ts
  transport/
    transport-types.ts        # Transport interface
    background-transport.ts    # binds bg bus <-> chrome.runtime/tabs + ports
    popup-transport.ts         # binds popup bus <-> ufBus:<tabId> port
    content-transport.ts       # binds content bus <-> chrome.runtime + page relay
    page-relay-transport.ts    # thin adapter over content/page-world-relay
    legacy-bridge.ts           # dual-protocol coexistence during migration

background/brain/
  index.ts               # composition root; wires deciders + transport + store
  state-store.ts         # authoritative per-tab LayerState; ONLY writer
  view-projector.ts      # LayerState -> per-layer view snapshots (pure)
  spinner-authority.ts   # LayerState -> per-layer SpinnerState (pure)
  deciders/
    activation-decider.ts marking-mode-decider.ts silent-mode-decider.ts
    ai-run-decider.ts render-mode-inspection-decider.ts remote-config-decider.ts
    page-save-reconciliation-decider.ts property-lock-decider.ts
    emulation-decider.ts

popup/layers/
  popup-bus-client.ts    # bus + transport bootstrap; user-gesture -> intent
  layer-host.ts          # subscribes to view; routes to the active mode renderer
  spinner-layer.ts       # render-only popup curtain spinner
  modes/
    configuration-mode.ts marking-mode.ts silent-mode.ts
    content-preview-mode.ts render-mode-detection-mode.ts

content/layers/
  content-bus-client.ts  # bus + transport bootstrap; DOM event -> event publish
  layer-host.ts          # routes Brain directives to the addressed mode executor
  spinner-layer.ts       # render-only page curtain / inspection spinner
  modes/
    marking-executor.ts            # wraps content/core.ts (locked) behind adapter
    silent-executor.ts
    ai-preview-executor.ts
    render-mode-inspection-executor.ts
    reconciliation-executor.ts
    property-lock-banner-executor.ts
```

The page MAIN world keeps its current files unchanged in scope
(`common/page-motion-freeze-bridge.ts`, `common/page-motion-freeze-control.ts`,
wrapped by the `entrypoints/page-motion-freeze-bridge.content.ts` world:MAIN
entrypoint created in Part A); `transport/page-relay-transport.ts` is the only new
content-side adapter that treats the relay as bus transport.

### 5.2 Wire envelope (new) — `common/bus/envelope.ts`

```ts
export const BUS_PROTOCOL = "uf-bus/1";
export type BusKind = "request" | "reply" | "event";
export type Realm = "background" | "content" | "popup" | "page";
export type BusTarget = Realm | "broadcast";

export type BusEnvelope = {
  p: typeof BUS_PROTOCOL;   // protocol tag — legacy bridge uses this to route
  k: BusKind;               // request | reply | event
  id: string;               // correlation id (request<->reply) or event id
  t: string;                // type, "domain.action" or "domain.event"
  src: Realm;               // source realm
  dst: BusTarget;           // destination realm or "broadcast"
  tab: number | null;       // tab scope (null = realm-global)
  frame: number;            // frame id (0 = top)
  payload: unknown;         // request/event body
  ok?: boolean;             // reply only
  code?: string;            // failure reply only
  error?: string;           // failure reply only
};
```

The `p: "uf-bus/1"` tag is the migration switch: any inbound chrome message with
`p === BUS_PROTOCOL` is owned by the new transport; everything else continues to
the legacy listener untouched. Type names use the `domain.action` / `domain.event`
convention (e.g. `aiRun.start`, `activation.finished`, `spinner.set`). No new type
name may collide with a still-live legacy `WORLD_MESSAGE_TYPES` or command type
during migration.

### 5.3 Bus API (new) — `common/bus/bus.ts`

```ts
export type BusReplyOk<R>  = { ok: true; result: R };
export type BusReplyErr    = { ok: false; code: string; error: string; details: Record<string, unknown> };
export type BusReply<R>    = BusReplyOk<R> | BusReplyErr;

export type RequestMeta = { type: string; src: Realm; tab: number | null; frame: number; id: string };
export type EventMeta   = RequestMeta;

export type RequestHandler<P, R> = (payload: P, meta: RequestMeta) => Promise<R> | R;
export type EventListener<P>     = (payload: P, meta: EventMeta) => Promise<void> | void;
export type Unsubscribe          = () => void;

export type RequestOptions = { target?: BusTarget; tab?: number | null; frame?: number; timeoutMs?: number };
export type PublishOptions = { target?: BusTarget; tab?: number | null; frame?: number };

export interface Bus {
  // Awaitable, single authoritative handler. Throws BusError on failure reply or timeout.
  request<P, R>(type: string, payload: P, opts?: RequestOptions): Promise<R>;
  // Same routing, but resolves to a BusReply union and never throws on a failure reply.
  tryRequest<P, R>(type: string, payload: P, opts?: RequestOptions): Promise<BusReply<R>>;
  // Register THE one authoritative handler for a request type in this realm. Throws if already registered.
  registerHandler<P, R>(type: string, handler: RequestHandler<P, R>): Unsubscribe;
  // Fan-out to all local + remote subscribers. Resolves when every async listener settles. Never throws on listener error.
  publish<P>(type: string, payload: P, opts?: PublishOptions): Promise<void>;
  // Add one of many listeners for an event type.
  subscribe<P>(type: string, listener: EventListener<P>): Unsubscribe;
}
```

Semantics (exact):

- **Routing.** If `opts.target` is undefined: a `request` is delivered to the
  local handler if one is registered for `type`, else handed to the transport with
  `dst` resolved from the type's declared owner realm (see contracts). `publish`
  always emits locally to subscribers AND hands to the transport with
  `dst: "broadcast"` unless `opts.target` narrows it.
- **request failure.** A failure reply (`ok:false`) or a timeout rejects the
  returned promise with `BusError` carrying `code`, `error`, `details`.
  `tryRequest` resolves with the `BusReply` instead.
- **publish settle.** `publish` runs all matched listeners, awaits
  `Promise.allSettled`, and resolves `void`. Listener rejections are caught,
  collected, and routed to the bus logger; they never reject `publish`.
- **single handler.** `registerHandler` throws synchronously if a handler for
  `type` already exists in this realm (enforces the "one authoritative decision"
  rule). `subscribe` allows many.
- **no transport knowledge.** The `Bus` class never imports chrome APIs. The
  transport is injected at construction: `createBus({ realm, transport, logger })`.

### 5.4 Transport — `common/bus/transport/*`

```ts
export interface Transport {
  // Deliver an outbound envelope to remote realm(s). Returns a reply for requests.
  send(env: BusEnvelope): Promise<BusEnvelope | void>;
  // Register the bus's inbound handler. Transport calls it for every inbound envelope.
  onInbound(handler: (env: BusEnvelope) => Promise<BusEnvelope | void>): void;
  // Lifecycle.
  start(): void;
  stop(): void;
}
```

Concrete transports:

- `background-transport.ts`: owns `chrome.runtime.onMessage` (new-protocol branch
  only), `chrome.tabs.sendMessage` for content delivery, and the `ufBus:<tabId>`
  port registry for popup delivery. Resolves request replies via the chrome
  callback. Broadcast events fan out to the addressed content tab and all
  connected popup ports.
- `popup-transport.ts`: connects `chrome.runtime.connect({ name: "ufBus:"+tabId })`,
  sends via the port + `chrome.runtime.sendMessage` for request/reply, receives
  inbound over the port.
- `content-transport.ts`: owns `chrome.runtime.onMessage` (new-protocol branch)
  and `chrome.runtime.sendMessage` to reach the Brain; composes
  `page-relay-transport` for `dst: "page"` envelopes.
- `page-relay-transport.ts`: maps the four allowed page-world commands onto
  `requestPageWorldCommand`; rejects any other `dst:"page"` type. Page world is
  never a bus host — it only answers the four relay commands. This satisfies
  decision §2.7 (page stays minimal).

### 5.5 Brain — `background/brain/*`

- `state-store.ts` owns `Map<number, TabLayerState>` and is the ONLY module that
  mutates it. It exposes typed read selectors and typed mutators; every mutator
  records a reason and bumps a per-tab `version`. After any mutation it triggers a
  projection+publish cycle (debounced per tab within a microtask).
- `TabLayerState` (authoritative): `{ tabId, url, baseUrl, contentMode, activation,
  aiRun, renderModeInspection, config, pageSave, propertyLock, emulation,
  spinners:{ popup, pageCurtain, banner }, version }`. Exact field shapes are
  defined per-track as each domain migrates; Track 0 defines only the envelope, the
  empty store, and the `version`/projection mechanics.
- `view-projector.ts` (pure): `TabLayerState -> { popupView, contentDirective }`.
  No side effects. The popup view is the entire render input for the popup; the
  content directive is the entire command input for the content layer host.
- `spinner-authority.ts` (pure): `TabLayerState -> { popup, pageCurtain, banner }`
  spinner states, each `SpinnerState | null`, derived from the active operation
  using `common/spinner-contract.ts` (title, message, timerMode, deadlineAt).
- `deciders/*`: each registers the authoritative `request` handlers + `subscribe`
  listeners for its domain, calls store mutators, and never writes the store except
  through `state-store` mutators. Deciders never talk to chrome directly; they use
  the bus.
- `index.ts`: constructs the background bus with `background-transport`, the store,
  and registers every decider. It also installs the legacy bridge during migration.

### 5.6 Layers (popup + content)

- A layer holds NO authoritative state. Its only inputs are (a) the brain view /
  directive it is told to render/execute, and (b) local DOM/user events it
  publishes as bus events. It exposes no state to other layers.
- `popup/layers/layer-host.ts` subscribes to `view.popup`, diffs the incoming
  `popupView`, and calls exactly one mode renderer (`modes/<mode>.ts`) plus
  `spinner-layer.ts`. Mode renderers are pure `render(view, emit)` functions: they
  draw DOM and translate user gestures into `emit(intentType, payload)` (a
  `bus.publish` to the Brain). No mode reads another mode's DOM or state.
- `content/layers/layer-host.ts` subscribes to `directive.content`, and routes each
  directive to exactly one mode executor. Executors call the locked engines (e.g.
  `marking-executor` calls `content/core.ts`) but contain no cross-cutting policy.
  They publish domain events (e.g. `activation.finished`) back to the Brain.
- `spinner-layer.ts` (both realms) subscribes to `spinner.set`/`spinner.clear` for
  its surface and renders only. It never computes title/message/timers.

### 5.7 Spinner authority flow

1. A decider mutates `state.spinners.<surface>` (via store) to a `{ kind, phase }`
   selection.
2. `spinner-authority.ts` projects that to a full `SpinnerState`
   `{ title, message, timerMode, deadlineAt, startedAt, blockSurfaces }` using
   `SPINNER_PHASE_REGISTRY`.
3. The Brain publishes `spinner.set` (or `spinner.clear`) addressed to the owning
   realm/surface.
4. The layer's `spinner-layer.ts` renders. Countdown/elapsed tick locally off
   `deadlineAt`/`startedAt`; no logic, just formatting.

This replaces: popup `popup/spinner.ts` queue authority, background
`spinner-operations.ts` queue authority, and the lifecycle->curtain side effect in
`popup-state-broker.ts`. All three become render-only or Brain-internal.

---

## 6. Migration framework (strangler-fig)

### 6.1 Coexistence

- Track 0 introduces the bus, transport, Brain skeleton, and the
  `legacy-bridge.ts`. After Track 0, no domain has moved yet: the bridge simply
  ensures new-protocol envelopes (`p:"uf-bus/1"`) are routed to the new buses while
  every existing message continues through the legacy listeners untouched.
- Each domain track then: (1) adds the domain's contracts; (2) adds the decider;
  (3) converts the domain's popup/content code paths into stateless layers that
  speak the new wire; (4) rewrites that domain's tests to the new contract; (5)
  deletes the legacy handlers/messages for that domain; (6) validates.
- A domain is "migrated" only when its legacy wire is deleted and the suite is
  green. Two domains may not be half-migrated across a commit boundary: each commit
  must leave the build green and the suite passing.

### 6.2 Per-track commit discipline

- One track may span multiple commits, but every commit type-checks (`pnpm check`),
  passes the suite (`pnpm test`), and builds (`pnpm build`). Lint must pass
  (`pnpm lint`).
- Each commit message: `feat(bus): <track>.<phase> <summary>` or
  `refactor(bus): ...`. Include the Co-authored-by trailer.
- After each track: update this file's status, `.copilot/plan.md` index, and
  `.copilot/knowledge.md` if a durable rule changed.

### 6.3 Rollback rule (global)

If a track's migration causes a behavior regression that automated tests do not
catch and live validation reveals, revert the domain's legacy-deletion commit (the
bridge keeps the legacy path runnable) and re-open the track. Never leave the tree
with both paths writing the same authoritative state.

---

## 7. Track map

Tracks run in this order. Each has a dedicated executor doc under
`.copilot/event-bus/` created at the start of the track from
`.copilot/event-bus/track-template.md` (Track 0's doc is written now; later docs
are authored immediately before the track begins, so they reflect the exact APIs
that Track 0 finalized). Dependencies are strict: do not start a track until all
its predecessors are green.

| Track | Name | Migrates | Lock gate | Depends on |
|------|------|----------|-----------|-----------|
| 0 | Foundation | bus, envelope, transport, Brain skeleton, legacy bridge, spinner-authority skeleton, layer hosts (empty) | none | Part A complete |
| 1 | Popup state channel | `popup-state-broker` snapshot push -> Brain view projection + popup `layer-host` | none | 0 |
| 2 | Spinner authority | popup `spinner.ts` + background `spinner-operations.ts` + curtain side effect -> Brain spinner-authority + render-only spinner layers | none | 0,1 |
| 3 | Activation + lifecycle + content bootstrap | lifecycle events + activation decisions + curtain bootstrap | none | 0,1,2 |
| 4 | Render-mode inspection | render-mode-inspection decider + content/popup executors | none (wrap) | 0,1,2,3 |
| 5 | AI run | ai-run-orchestrator -> ai-run-decider + executors; compute-lock as Brain state | GATE X if XPath/submission internals touched | 0,1,2,3 |
| 6 | Remote config + site resolution | remote-config-decider + popup config layer | none (wrap) | 0,1,2 |
| 7 | Page save + reconciliation | page-save-reconciliation-decider + executors | GATE R | 0,1,2,3,6 |
| 8 | Marking mode | marking-mode-decider + content marking-executor wrapping `core.ts` | GATE M | 0..3,7 |
| 9 | Silent mode | silent-mode-decider + content silent-executor | GATE S | 0..3,8 |
| 10 | Content/AI preview | preview decider + executors | none (wrap) | 0..3,5,8 |
| 11 | Property lock | property-lock-decider + banner executor + popup property-lock layer | GATE P | 0..3 |
| 12 | Emulation/device | emulation-decider | none | 0,1,2 |
| 13 | Legacy teardown | delete `message-protocol.ts` legacy paths, `async-messaging` legacy callers, dual bridge, old state Maps, `popup/state.ts` residue | none | all |

Tracks 4–12 may be reordered among themselves by dependency as long as the
predecessor column is honored; the recommended execution order is numeric. Each
locked track (5/7/8/9/11) MUST open with its approval gate before code.

For each track, the executor doc must contain: Goal; Current facts (re-verified);
Exact files to add/edit/delete; Step-by-step edits in order; New contracts (type
names + payload shapes); Tests to add/rewrite (named); Focused validation command;
Full validation; Acceptance criteria (observable); Regression risks + detection;
Rollback rule. Use `.copilot/event-bus/track-template.md` and the
`autonomous-implementation-plan` skill standards.

---

## 8. Global validation, guardrails, acceptance

### 8.1 Validation per commit (WXT command surface)

```bash
pnpm lint     # eslint .
pnpm check    # wxt prepare && tsc --noEmit
pnpm test     # vitest run
pnpm build    # wxt build  (-> .output/chrome-mv3/)
```

For tracks touching user-visible runtime behavior (3,4,5,7,8,9,10,11,12) also run
live validation against the WXT dev output:

```bash
pnpm dev                       # or: pnpm build  (loadable .output/chrome-mv3)
pnpm browser:live <target-url> # see .github/skills/launch-test-browser
```

Reload the unpacked extension/service worker after a rebuild before observing.

### 8.2 Guardrails (non-negotiable)

1. Do not change locked behavior without the matching approval gate (§4).
2. Do not edit `content/core.ts` before GATE M is granted; before that, the
   marking-executor only calls existing exported `core` functions.
3. Exactly one authoritative `request` handler per type per realm. Cross-cutting
   decisions live only in `background/brain/deciders/*`.
4. Layers are stateless: a popup/content layer module must not hold authoritative
   state, must not import another layer, and must not read chrome storage or make
   product decisions. Its only state is local render scaffolding.
5. The page MAIN world stays minimal — only the four relay commands cross.
6. Every commit is green (`pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`).
7. Bus/brain/layer modules are imported through the normal ESM graph and bundled
   into the WXT content entry; they do NOT need `web_accessible_resources` entries.
   Only `chrome.runtime.getURL(...)` page-world assets remain web-accessible
   (declared in `wxt.config.ts` or placed in `public/`).
8. Do not enable `remoteSupport` or `propertyLockCollaboration` feature flags as
   part of any track.
9. Do not commit generated browser profiles, screenshots, debug JSON,
   orchestration output, tokens, or secrets.

### 8.3 Program-level acceptance criteria

The program is complete when ALL hold:

1. Every cross-cutting decision is made by a `background/brain/deciders/*` module;
   grep shows no decision logic (mode gating, can-save, preview-allowed, curtain
   teardown, spinner content) in `popup/*` or `content/*` layer modules.
2. `popup/layers/*` and `content/layers/*` modules hold no authoritative state and
   import no sibling layer (enforced by a boundary test).
3. There is exactly one `registerHandler` per request type per realm (enforced by
   the bus throwing on duplicate + a contract test).
4. Spinner title/message/timer for every surface is produced only by
   `background/brain/spinner-authority.ts`; layers render `SpinnerState` verbatim
   (enforced by a test asserting layers never import `spinner-contract`'s phase
   registry).
5. The legacy `common/message-protocol.ts` envelope, the legacy world-message
   spinner/lifecycle wire, and `popup/state.ts` authoritative fields are deleted;
   `common/async-messaging.ts` legacy request helpers are removed or reduced to
   transport internals.
6. The page MAIN world still carries only the four relay commands.
7. `pnpm verify` passes and the 11 always-on core features plus the locked
   marking/silent/visibility/reconciliation/XPath/AI-submission behaviors are
   unchanged (live-validated where §8.1 requires it).

---

## 9. Per-track executor doc

When starting a track, create `.copilot/event-bus/track-NN-<name>.md` by copying
`.copilot/event-bus/track-template.md` and filling every section. Keep each doc
concrete enough that a weak agent can execute it with no design decisions. If any
step needs hidden reasoning, split it or add an approval gate.

---

## 10. Model capability recommendation

- Track 0 (Foundation) and the transport/bus contracts: use a high-capability
  model. The bus/transport correctness is the keystone; everything depends on its
  exact shapes.
- Domain tracks: a mid model may execute a track by following its executor doc
  literally, but locked tracks (5/7/8/9/11) require a high-capability model and the
  user present for the approval gate and live validation.
- Never let an executor infer scope beyond its track doc, redesign the bus API, or
  lift a lock without its gate.

---

## 11. Deno → WXT reconciliation (so nothing is lost)

This table records every place the original (Deno/esbuild) event-bus plan differs
from this WXT-baseline plan. If you are cross-referencing the original commit
`31ab189`, use this to translate.

| Concern | Original (Deno/esbuild) | This plan (WXT baseline) |
|---|---|---|
| Build | `scripts/build-extension.ts`, esbuild `bundle:false`, 1:1 `.ts`→`.js` | WXT (Vite), bundled entrypoints, `pnpm build` → `.output/chrome-mv3/` |
| Entrypoints | root `background.ts` / `content-loader.ts` / `popup.html` loaded directly by manifest | `entrypoints/*` wrappers (created in Part A) that import the same runtime modules |
| Background bootstrap | top-level code in `background.ts` runs on load | runtime code must be inside `defineBackground(main)`; bus bootstrap invoked there |
| Content bootstrap | `content-loader.ts` is the manifest content script | content entrypoint `defineContentScript({ main })` calls the loader; `main` may be async |
| Page MAIN world | `common/page-motion-freeze-bridge.ts` as a manifest `world:MAIN` content script | `entrypoints/page-motion-freeze-bridge.content.ts` (`world: "MAIN"`) wrapping the same module |
| Offscreen | `offscreen.html` + `offscreen.ts` | unlisted page entrypoint `entrypoints/offscreen.html` (+ `main.ts`) |
| Manifest | hand-written `manifest.json` | generated from `wxt.config.ts` + entrypoint options |
| New content modules | each must be listed in `manifest.json` `web_accessible_resources` | bundled into the content entry; no per-module WAR; only `getURL` page assets stay web-accessible |
| Bundling gate | APPROVAL GATE B to switch to a bundled content entry | resolved — WXT bundling is the default; no GATE B |
| Type-check | `deno task check` (`tsc --noEmit`) | `pnpm check` (`wxt prepare && tsc --noEmit`) |
| Lint | `deno task lint` | `pnpm lint` (`eslint .`) |
| Test runner | `deno task test` (Deno test over `tests/*.js`) | `pnpm test` (Vitest; suite migrated in Part A) |
| Release build | `deno task build:release` | `pnpm build` (`wxt build`) |
| Package/zip | `scripts/package-extension.mjs` | `pnpm zip` (`wxt zip`) |
| Verify-all | `deno task verify` | `pnpm verify` (`lint && check && test && build`) |
| Live browser | `deno task browser:live <url>` (loads `dist/extension-dev`) | `pnpm browser:live <url>` (loads `.output/chrome-mv3`); launcher adapted in Part A |
| Auto-imports | n/a | WXT auto-imports disabled (`imports: false`) to preserve the explicit-import codebase style |

Everything else (bus semantics, envelope, transport interface, Brain store /
projection / spinner authority, layer rules, strangler-fig framework, lock gates,
track map, acceptance) is identical to the originally approved program.
