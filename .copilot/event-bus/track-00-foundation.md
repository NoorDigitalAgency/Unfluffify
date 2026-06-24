# Track 0 — Foundation (WXT baseline)

Parent plan: `.copilot/event-bus-architecture-plan.md`.
Precondition: **Part A of `.copilot/wxt-port-plan.md` is complete and green** (see
master plan §0). The extension already builds/loads via WXT, the suite runs on
Vitest, and the current runtime modules are wrapped by `entrypoints/*` with
behavior unchanged.
Status: ready to execute. No domain logic moves in this track.

This track stands up the bus, the wire envelope, the cross-realm transport, the
Brain skeleton (store + projection + spinner-authority shells), the empty layer
hosts, and the legacy bridge. After this track the extension behaves exactly as
before: every existing message still flows through the legacy listeners; the new
buses exist, pass a round-trip self-test, and route only new-protocol
(`p:"uf-bus/1"`) envelopes, of which there are none yet in production paths.

## Approval gate

None for Track 0. (The original plan's optional bundling gate, GATE B, does not
exist here: WXT bundles the content entry by default per master plan §2.8.)

## Goal

Provide a typed, realm-agnostic event bus with `request`/`publish` primitives, a
chrome-backed transport per realm, a page-relay transport adapter, an
authoritative-but-empty Brain (state store + pure projection + spinner-authority
shell), empty popup/content layer hosts, and a dual-protocol legacy bridge. Prove
correctness with a cross-realm round-trip self-test behind a dev-only diagnostic.
No production behavior changes.

## Current facts (re-verify with a fresh read before editing)

- `common/message-protocol.ts` — legacy envelope (`createRequestEnvelope`,
  `isRequestEnvelope`, `isReplyEnvelope`, `MESSAGE_*`). Stays intact this track.
- `common/async-messaging.ts` — `requestRuntime/requestTab/requestContent`. Stays
  intact this track.
- `common/world-messaging-contract.ts` — `WORLD_MESSAGE_TYPES`,
  `buildPopupStatePortName` (`ufPopupState:` prefix). Stays intact this track.
- `common/spinner-contract.ts` — `SPINNER_PHASE_REGISTRY`,
  `SPINNER_OPERATION_KINDS`, `SPINNER_TIMER_MODES`, phase definitions. Reused by
  `spinner-authority.ts`.
- `content/page-world-relay.ts` — `requestPageWorldCommand(command,payload,opts)`,
  `isPageWorldRelayReady()`, `initializePageWorldRelay()`. Reused by
  `page-relay-transport.ts`.
- `background.ts` master `chrome.runtime.onMessage` listener and
  `chrome.runtime.onConnect` port listener. These are now installed from inside
  `entrypoints/background.ts` → `defineBackground(main)` (Part A). Track 0 adds an
  EARLY new-protocol branch that returns before legacy handling; it must not change
  any legacy branch.
- `popup.ts` connects `ufPopupState:<tabId>` and has an `onMessage.addListener`.
  Invoked from the popup entrypoint (`entrypoints/popup/main.ts`). Track 0 adds the
  popup bus client but does NOT remove these.
- `content-main.ts:main()` is the content boot, called by `content-loader.ts`,
  which is called by the content entrypoint (`entrypoints/content.ts` →
  `defineContentScript({ main })`). Track 0 adds the content bus client bootstrap
  near the top of `content-main.ts:main()` without altering existing init order.
- Build: **WXT (Vite)**, bundled entrypoints. New ESM modules imported by the
  content entrypoint are bundled in — **no `web_accessible_resources` entry is
  needed** for them (master plan §2.8). Tasks are `package.json` scripts run with
  pnpm.
- Tests live in `tests/`; **Vitest** runner. Boundary tests already exist
  (`tests/background-decomposition-boundary.test.*`,
  `tests/content-decomposition-boundary.test.*`); add a new bus boundary test.

### WXT entrypoint build constraint (critical)

WXT imports `entrypoints/background.ts` and content entrypoint files in a Node
environment at build time to read their options. **No runtime code (chrome APIs,
side-effectful module init) may execute at module top level** — it must run inside
`defineBackground(main)` / `defineContentScript({ main })`. Therefore every Track 0
bootstrap call (`createBrain()`, `startContentBusClient()`, `startPopupBusClient()`)
is invoked from inside the entrypoint `main`, in the exact place Part A already
invokes the legacy module bootstrap. Do not add top-level bus construction in an
entrypoint file. (`background` `main()` cannot be async; content `main(ctx)` may be
async.)

## New contracts (Track 0 only)

Add `common/bus/contracts/index.ts` with realm + diagnostic types only. Domain
contracts are added by their own tracks.

- `REALMS = { BACKGROUND:"background", CONTENT:"content", POPUP:"popup",
  PAGE:"page" }` (frozen).
- Diagnostic round-trip type names (dev-only, gated so production never sends
  them): `diag.ping` (request, payload `{ nonce:string }`, reply
  `{ nonce:string; realm:Realm }`) and `diag.echo` (event, payload
  `{ nonce:string }`).

## Files

Add:

- `common/bus/envelope.ts`
- `common/bus/bus-errors.ts`
- `common/bus/realms.ts`
- `common/bus/bus.ts`
- `common/bus/contracts/index.ts`
- `common/bus/transport/transport-types.ts`
- `common/bus/transport/legacy-bridge.ts`
- `common/bus/transport/background-transport.ts`
- `common/bus/transport/popup-transport.ts`
- `common/bus/transport/content-transport.ts`
- `common/bus/transport/page-relay-transport.ts`
- `background/brain/state-store.ts`
- `background/brain/view-projector.ts`
- `background/brain/spinner-authority.ts`
- `background/brain/index.ts`
- `popup/layers/popup-bus-client.ts`
- `popup/layers/layer-host.ts`
- `popup/layers/spinner-layer.ts`
- `content/layers/content-bus-client.ts`
- `content/layers/layer-host.ts`
- `content/layers/spinner-layer.ts`
- tests: `tests/bus-core.test.ts`, `tests/bus-envelope.test.ts`,
  `tests/bus-transport-routing.test.ts`, `tests/bus-boundary.test.ts`,
  `tests/brain-state-store.test.ts`, `tests/spinner-authority.test.ts`
  (use the suite's Vitest extension; match the existing `tests/` file convention
  Part A settled on — `.test.ts` with `import { describe, it, expect } from "vitest"`).

Edit:

- `entrypoints/background.ts` — inside `defineBackground(main)`, construct the
  Brain (`createBrain()`, Phase 0.9) where Part A bootstraps the background module.
  Keep a module reference. (The new-protocol inbound branch is added in
  `background.ts`'s master listener, Phase 0.6, since that listener is owned by the
  existing module, not the thin entrypoint wrapper.)
- `background.ts` — add the new-protocol inbound branch in the master
  `chrome.runtime.onMessage` listener and the `ufBus:` branch in
  `chrome.runtime.onConnect` (Phase 0.6).
- `content-main.ts` — call `startContentBusClient()` near the top of `main()` and
  add the new-protocol branch in the content `chrome.runtime.onMessage` listener
  (Phase 0.6).
- `popup.ts` — call `startPopupBusClient(tabId)` during popup init (Phase 0.6).
- `wxt.config.ts` — **no manifest edits required** for bus modules (bundled). Only
  touch it if Phase 0.7 finds a NEW `chrome.runtime.getURL(...)` page-world asset
  (there are none in Track 0).

Delete: none this track.

## Steps (in execution order)

### Phase 0.1 — Envelope + errors + realms (pure, no chrome)

1. Create `common/bus/realms.ts`: export `REALMS` (frozen) and a `Realm` type;
   helpers `isRealm(v)` and `normalizeTarget(v): BusTarget`.
2. Create `common/bus/bus-errors.ts`: `BUS_ERROR_CODES` (`TIMEOUT`, `NO_HANDLER`,
   `DUPLICATE_HANDLER`, `HANDLER_FAILED`, `TRANSPORT_FAILED`, `INVALID_ENVELOPE`,
   `UNREACHABLE_REALM`) and `class BusError extends Error` with `{ code, details }`.
3. Create `common/bus/envelope.ts` exactly per master plan §5.2: `BUS_PROTOCOL`,
   `BusKind`, `BusEnvelope`, plus:
   - `makeRequestEnvelope(type, payload, { src, dst, tab, frame, id })`
   - `makeEventEnvelope(type, payload, { src, dst, tab, frame, id })`
   - `makeReplyEnvelope(request, ok, body)` where body is `result` or
     `{ code, error }`
   - `isBusEnvelope(v)`, `isBusRequest(v)`, `isBusReply(v)`, `isBusEvent(v)`
   - `newId()` (crypto.randomUUID with counter fallback, mirror
     `message-protocol.ts:nextRequestId`).
   - Validation: every guard checks `v.p === BUS_PROTOCOL` first.
- Expected state: pure modules, no chrome import.
- Focused validation: `pnpm check`.
- Rollback: delete the three files.

### Phase 0.2 — Bus core (pure, transport injected)

1. Create `common/bus/bus.ts` implementing `Bus` per master plan §5.3 with
   `createBus({ realm, transport, logger })`:
   - Internal maps: `handlers: Map<string, RequestHandler>` and
     `listeners: Map<string, Set<EventListener>>`.
   - `registerHandler(type, h)`: throw `BusError(DUPLICATE_HANDLER)` if present;
     return an unsubscribe that deletes it.
   - `subscribe(type, l)`: add to the set; return unsubscribe.
   - `request(type, payload, opts)`:
     - Resolve `dst`: `opts.target` || (local handler exists ? realm :
       transport-resolved owner). For Track 0 there is no contract owner table, so:
       if a local handler exists use local; else `dst = opts.target` or throw
       `BusError(NO_HANDLER)` when neither local handler nor target given.
     - If `dst === realm` (local): call handler, wrap result as resolved value;
       map thrown errors to `BusError(HANDLER_FAILED)`.
     - Else: build a request envelope and `transport.send`; await the reply
       envelope; resolve `result` or throw `BusError` from the failure reply.
     - Apply `opts.timeoutMs` with a `Promise.race` rejecting `BusError(TIMEOUT)`.
   - `tryRequest(...)`: same routing, catch and return `BusReply` union.
   - `publish(type, payload, opts)`:
     - Run all local listeners for `type`, collecting promises.
     - If `opts.target !== realm`: build an event envelope (`dst` = `opts.target`
       || "broadcast") and `transport.send` (fire-and-forget but awaited as part of
       allSettled).
     - `await Promise.allSettled([...localPromises, transportPromise])`; route
       rejections to `logger`; resolve `void`.
   - Inbound: `transport.onInbound(async (env) => ...)`:
     - request -> find local handler; if none, reply `BusError(NO_HANDLER)`
       envelope; else call handler and reply success/failure envelope.
     - event -> run local listeners (allSettled), return `void`.
- Expected state: a fully unit-testable bus with a fake transport.
- Focused validation: write `tests/bus-core.test.ts` first (TDD) covering:
  duplicate handler throw; local request happy path; local request failure maps to
  BusError; remote request via fake transport; publish fan-out to multiple
  listeners; publish settles after async listeners; listener rejection does not
  reject publish; timeout. Run `pnpm test tests/bus-core.test.ts`.
- Rollback: delete `bus.ts` + its test.

### Phase 0.3 — Transport interface + page-relay transport

1. Create `common/bus/transport/transport-types.ts` per master plan §5.4.
2. Create `common/bus/transport/page-relay-transport.ts`:
   - `createPageRelayTransport()` returning a partial transport used by the content
     transport for `dst:"page"` only.
   - On `send(env)` where `env.dst==="page"`: require `isPageWorldRelayReady()`;
     map `env.t` to one of the four `PAGE_WORLD_COMMANDS`; reject otherwise with
     `BusError(UNREACHABLE_REALM)`; call `requestPageWorldCommand` and wrap the
     result into a reply envelope.
   - It has no `onInbound` of its own (page never initiates bus traffic).
- Expected state: page relay reachable only for the four allowed commands.
- Focused validation: `pnpm check`.
- Rollback: delete both files.

### Phase 0.4 — Realm transports (chrome-backed)

1. `background-transport.ts`: `createBackgroundTransport()`:
   - `start()` installs nothing global by itself; instead it exports an
     `inbound(env, sender): Promise<BusEnvelope|void>` that `background.ts` calls
     from its master listener's new-protocol branch (Phase 0.6).
   - `send(env)`:
     - `dst==="content"`: `chrome.tabs.sendMessage(env.tab, env, { frameId:
       env.frame })` via a promise wrapper; for events, no reply expected.
     - `dst==="popup"`: post to every `ufBus:<tab>` port in the registry; for a
       request, await the correlated reply (match `id`).
     - `dst==="broadcast"`: send to the addressed content tab (if `env.tab`) and
       all popup ports.
   - Maintains a `Map<number, Set<Port>>` popup port registry, populated by a
     `registerPopupPort(tabId, port)` the background `onConnect` branch calls for
     `ufBus:` ports (Phase 0.6).
2. `popup-transport.ts`: `createPopupTransport(tabId)`:
   - `start()` connects `chrome.runtime.connect({ name: "ufBus:"+tabId })`, listens
     for inbound envelopes on the port, and resolves correlated replies.
   - `send(env)`: requests go via `chrome.runtime.sendMessage(env, cb)` (so the
     Brain replies through the callback); events go over the port.
3. `content-transport.ts`: `createContentTransport()`:
   - `start()` exports an `inbound(env,sender)` for `content-main.ts` to call from a
     new-protocol branch of the content `onMessage` listener.
   - `send(env)`: `dst==="background"` via `chrome.runtime.sendMessage`;
     `dst==="page"` delegates to `page-relay-transport`.
- Expected state: each realm can send/receive new-protocol envelopes; no legacy
  path touched.
- Focused validation: `pnpm check`; `tests/bus-transport-routing.test.ts` with a
  fake chrome (a small `globalThis.chrome` stub / Vitest `vi.stubGlobal`) asserting
  envelope routing per `dst`. Run `pnpm test tests/bus-transport-routing.test.ts`.
- Rollback: delete the three files + test.

### Phase 0.5 — Legacy bridge

1. `common/bus/transport/legacy-bridge.ts`: `createLegacyBridge()` exposing
   `isBusMessage(message)` = `message?.p === BUS_PROTOCOL`. This is the single
   predicate the realm listeners use to decide new-vs-legacy. No translation of
   legacy messages happens in Track 0 — the bridge only classifies. (Later tracks
   may add per-domain translation here if a half-migrated domain needs it.)
- Focused validation: `pnpm check`.
- Rollback: delete file.

### Phase 0.6 — Wire transports into the realm listeners (no legacy change)

1. `background.ts`:
   - Where Part A bootstraps the background module (inside
     `defineBackground(main)`), construct `const brain = createBrain()` (Phase 0.9),
     which internally builds the background bus + transport. Keep a module reference.
   - In the master `chrome.runtime.onMessage` listener, add as the FIRST check:
     `if (legacyBridge.isBusMessage(message)) { brain.transport.inbound(message,
     sender).then(sendResponse); return true; }`. Everything below is unchanged.
   - In `chrome.runtime.onConnect`, add: `if (port.name.startsWith("ufBus:")) {
     brain.registerPopupPort(tabIdFromPortName(port), port); return; }` BEFORE the
     existing `ufPopupState:` handling. Do not alter the `ufPopupState:` branch.
2. `content-main.ts`: in `main()`, after the existing `state.initialized` guard and
   before the page-world relay init, call `startContentBusClient()` (Phase 0.9). In
   the content `chrome.runtime.onMessage` listener add the same FIRST new-protocol
   branch delegating to the content transport `inbound`.
3. `popup.ts`: during popup init (where the `ufPopupState:` port is set up), also
   call `startPopupBusClient(tabId)` (Phase 0.9). Do not remove the `ufPopupState:`
   connection.
- Expected state: new-protocol envelopes route to the new buses; all legacy traffic
  is byte-for-byte unchanged. Production sends zero new-protocol messages yet.
- Focused validation: `pnpm check`; run the full suite to prove no legacy
  regression: `pnpm test`.
- Rollback: revert the three listener edits.

### Phase 0.7 — Manifest / web-accessible resources (WXT)

Under WXT, the manifest is generated from `wxt.config.ts` + entrypoint options, and
the content entry is bundled. **Track 0 adds no `web_accessible_resources` entries**
because every new bus/brain/layer module is imported through the normal ESM graph
and bundled into the content script (master plan §2.8, guardrail §8.2.7).

1. Confirm no new `chrome.runtime.getURL(...)` page-world asset was introduced
   (Track 0 introduces none). If a future phase ever does, add it to the
   `web_accessible_resources` block in `wxt.config.ts` (MV3 object form
   `{ matches, resources }`) or place it under `public/`.
2. Re-run the WAR/manifest test (the Part A successor of
   `tests/manifest-permissions.test.js`, which now reads the WXT-generated manifest
   in `.output/chrome-mv3/manifest.json` or asserts against `wxt.config.ts`). It
   must stay green; no new `getURL` was added.
- Focused validation: `pnpm build`; `pnpm test <manifest-permissions test>`.
- Rollback: n/a (no manifest change expected).

### Phase 0.8 — Brain skeleton (store + projection + spinner-authority shells)

1. `background/brain/state-store.ts`: `createStateStore()`:
   - `Map<number, TabLayerState>`; `TabLayerState` Track-0 shape:
     `{ tabId, version, spinners: { popup: null, pageCurtain: null, banner: null } }`.
     (Domain fields are added by their tracks.)
   - `get(tabId)`, `getOrInit(tabId)`, `mutate(tabId, reason, fn)` (the ONLY
     mutator; bumps `version`, then schedules a microtask projection callback),
     `forEachTab(cb)`, `dispose(tabId)`.
   - `onProjection(cb)`: register the projection trigger (the Brain wires it to
     view-projector + publish).
2. `background/brain/view-projector.ts`: pure `projectViews(state):
   { popupView, contentDirective }`. Track-0: returns empty
   `{ popupView: { version }, contentDirective: { version } }`.
3. `background/brain/spinner-authority.ts`: pure `projectSpinners(state):
   { popup, pageCurtain, banner }`. Track-0: returns the three `null`s. Include the
   helper `phaseToSpinnerState(kind, phase, { startedAt, deadlineAt })` that reads
   `SPINNER_PHASE_REGISTRY` and returns
   `{ title, message, timerMode, deadlineAt, startedAt, blockSurfaces }`; unit test
   it now so later tracks rely on it.
- Focused validation: `tests/brain-state-store.test.ts` (mutate bumps version,
  projection fires once per microtask, dispose), `tests/spinner-authority.test.ts`
  (`phaseToSpinnerState` maps a known phase like `AI_RUN/REMOTE_WAIT` to countdown
  with the registry title/message). Run `pnpm test tests/brain-state-store.test.ts
  tests/spinner-authority.test.ts`.
- Rollback: delete the three files + tests.

### Phase 0.9 — Brain composition + content/popup bus clients

1. `background/brain/index.ts`: `createBrain()`:
   - builds `transport = createBackgroundTransport()`, `bus = createBus({ realm:
     REALMS.BACKGROUND, transport, logger })`, `store = createStateStore()`.
   - wires `store.onProjection` -> `projectViews` + `projectSpinners` ->
     `bus.publish("view.popup", popupView, { target:"popup", tab })`,
     `bus.publish("directive.content", contentDirective, { target:"content", tab })`,
     and per-surface `spinner.set`/`spinner.clear`. (Track 0 publishes empty/null
     payloads only; harmless.)
   - registers the dev-only `diag.ping` handler returning
     `{ nonce, realm:"background" }`.
   - returns `{ bus, store, transport, registerPopupPort }`.
2. `content/layers/content-bus-client.ts`: `startContentBusClient()` builds
   `createContentTransport()` + `createBus({ realm: CONTENT, ... })`, starts the
   content `layer-host` (Phase 0.10), and registers a dev-only `diag.ping` handler
   returning `{ nonce, realm:"content" }`. Idempotent (guard against double-start).
3. `popup/layers/popup-bus-client.ts`: `startPopupBusClient(tabId)` builds
   `createPopupTransport(tabId)` + `createBus({ realm: POPUP, ... })`, starts the
   popup `layer-host`, and registers a dev-only `diag.ping` handler returning
   `{ nonce, realm:"popup" }`. Idempotent.
- Focused validation: `pnpm check`.
- Rollback: delete files; remove the `start*` calls added in Phase 0.6.

### Phase 0.10 — Empty layer hosts + spinner layers

1. `popup/layers/layer-host.ts`: `startPopupLayerHost(bus)` subscribes to
   `view.popup` and, Track-0, does nothing but store the latest view on a local
   variable and call `renderSpinnerLayer`. No mode renderers yet.
2. `popup/layers/spinner-layer.ts`: `renderPopupSpinner(state)` subscribes to
   `spinner.set`/`spinner.clear` for the `popup` surface and renders into the
   existing popup curtain DOM hook — Track-0: a no-op render that only validates the
   `SpinnerState` shape. It must NOT touch `popup/spinner.ts` yet (that is Track 2).
3. `content/layers/layer-host.ts` + `content/layers/spinner-layer.ts`: mirror shells
   for the content realm; Track-0 no-ops.
- Focused validation: `pnpm check`.
- Rollback: delete files.

### Phase 0.11 — Cross-realm round-trip self-test (dev-only)

1. Behind a dev/diagnostic guard (reuse the existing trace/diagnostics flag
   mechanism, e.g. `world-trace`/`traceDiagnostics`; do NOT add a new always-on
   path), add a one-shot self-test that, when the flag is on, has the popup bus
   `request("diag.ping", { nonce }, { target:"background" })` and asserts the reply
   `{ realm:"background" }`, and `request(... target:"content", tab })` reaching
   content. Log pass/fail via the existing trace logger only.
2. This must be inert in production (flag off). It exists to let live validation
   confirm the transport works end to end.
- Focused validation: `pnpm check`; live: `pnpm dev` + `pnpm browser:live <url>`
  with the diagnostics flag on; confirm the trace shows `diag.ping` round-trips for
  background and content. (If the flag harness is not available, mark live as
  deferred and rely on `tests/bus-transport-routing`.)
- Rollback: remove the self-test block.

## Tests (add this track)

Use the suite's Vitest conventions (`import { describe, it, expect } from "vitest"`).

- `tests/bus-envelope.test.ts` — envelope guards, id generation, protocol tag.
- `tests/bus-core.test.ts` — all bus semantics from Phase 0.2.
- `tests/bus-transport-routing.test.ts` — `dst` routing with a fake chrome stub for
  each realm transport; page-relay rejects non-allowed commands.
- `tests/brain-state-store.test.ts` — store mutate/version/projection/dispose.
- `tests/spinner-authority.test.ts` — `phaseToSpinnerState` mapping for a countdown
  phase, an elapsed phase, and a none phase.
- `tests/bus-boundary.test.ts` — NEW boundary test asserting:
  - `common/bus/bus.ts` imports no chrome API (string scan: no `chrome.`).
  - `popup/layers/*` and `content/layers/*` import no sibling layer and do not
    import `common/spinner-contract` phase registry (enforces render-only).
  - exactly one `registerHandler` per type is provable by the bus throwing
    `DUPLICATE_HANDLER` (unit-level assertion).

## Validation

- Focused (run incrementally per phase): the specific test file(s) for the phase,
  e.g. `pnpm test tests/bus-core.test.ts`.
- Full (required before commit and at track end):
  ```bash
  pnpm lint
  pnpm check
  pnpm test
  pnpm build
  ```
- Live (Phase 0.11, optional/deferred): `pnpm dev` + `pnpm browser:live <url>`.

## Acceptance criteria (observable)

1. `pnpm verify` passes with all new tests green.
2. The full pre-existing suite still passes unchanged in count except for the added
   test files (no legacy test rewrites in Track 0).
3. `common/bus/bus.ts` contains no `chrome.` reference (boundary test).
4. A duplicate `registerHandler(type)` throws `BusError(DUPLICATE_HANDLER)`.
5. With diagnostics on, a `diag.ping` request from popup reaches the background
   Brain and returns `{ realm:"background" }`, and a `target:"content"` ping reaches
   content (live or via routing test).
6. No production code path emits a `p:"uf-bus/1"` envelope yet (grep: new
   `publish`/`request` calls exist only in diagnostics + tests).
7. The WXT-generated manifest adds no new `web_accessible_resources` entries; the
   manifest-permissions test is green; bus modules are bundled into the content
   entry, not separately listed.

## Regression risks + detection

1. **Master listener ordering.** Adding the new-protocol branch could shadow a
   legacy message if a legacy message accidentally has `p`. Detection: the full
   suite + a unit assertion that `isBusMessage` is false for a sample of legacy
   envelopes (`createRequestEnvelope(...)`).
2. **Port name collision.** `ufBus:` vs `ufPopupState:` — ensure the `onConnect`
   branch matches `ufBus:` strictly before the legacy prefix. Detection: routing
   test + manual check that `ufPopupState:` still connects (Track 1 depends on it).
3. **Double-start of bus clients.** Content/popup may init twice. Detection:
   idempotency guard + a test that calling `startContentBusClient()` twice registers
   handlers once.
4. **WXT build-time entrypoint execution.** If bus bootstrap is placed at an
   entrypoint module's top level instead of inside `main`, WXT will execute chrome
   APIs in Node at build time and the build fails. Detection: `pnpm build`; keep all
   bootstrap inside `defineBackground(main)` / `defineContentScript({ main })`.
5. **Bundle reachability.** A bus module that fails to import (typo/path) breaks the
   bundled content entry. Detection: `pnpm build` + live load smoke (`pnpm
   browser:live`).

## Rollback rule

Track 0 adds only new files plus three additive listener branches and three
`start*` calls (all inside existing modules invoked by the Part A entrypoints). If
anything regresses, revert the `background.ts`, `content-main.ts`, and `popup.ts`
edits first (this fully detaches the new buses from production), then the new files.
The legacy system is untouched and remains fully functional without the new modules.
