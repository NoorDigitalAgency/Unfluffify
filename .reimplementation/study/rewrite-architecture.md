# Rewrite Architecture — How It Works and How Sound It Is

**Scope:** branch `re-write` at `/home/rojan/Documents/Git/GitHub/Unfluffify` (HEAD `5c21aaaf`, 2026-08-07), judged against the intended contract in `.reimplementation/` (plan.md, architecture.md, contract-invariants.md, remote-api.md, decisions-log.md) and against the question this report is a foundation for: **did the rewrite solve the legacy's entanglement problem?**

**Method:** all nine `.reimplementation/` docs read in full; every directory named in the task read at source level (domain, background, messaging, content, popup, storage, lock, lynx, offscreen, page-world, entrypoints); claims verified by grep for actual live-path callers, not doc claims. Gates re-run: `pnpm test` → **58 files / 485 tests, all green, 8.1s**.

**Headline verdict:** the rewrite is a genuinely clean-room, much smaller (~13,100 non-test lines vs legacy's ~38,700 in six god-files alone), largely well-factored extension whose *lower layers honor the contract impressively* — the pure domain spine, the popup FSM+memory matrix, the typed bus, the page-world program, token rotation, and backend-authoritative local data are all real and correct. But the *authority model at the top is inverted*: the *popup entrypoint* (`src/entrypoints/popup/main.tsx`, **1,800 lines, ~45 module-level mutable variables**) has become the system's de-facto orchestrator. It births most of the brain's signal vocabulary itself, composes and dictates the content organ's curtain/banner surface, keeps a parallel state stash outside the FSM, and re-derives session truth from content status. The brain is reduced to a sequencing service plus a fold path that only decides 4 of 16 signals in practice. This is the legacy's "dictation model + dual state bags" pattern re-growing in a new host — smaller, better-commented, and with far better seams, but the same disease. Several contract-critical behaviors (multi-page save snapshot, discard-to-selector-seeded-baseline, static-mode rawHtml capture, SW-restart rehydration, lock heartbeat while popup closed) are missing or deviate in ways that matter for data integrity.

---

## 1. What the contract intended (compressed)

The `.reimplementation/` docs specify a **reflex arc**:

- One **brain** per tab in the SW: `fold(sensation) → snapshot` → `decide(prev, next) → sequenced, provenance-tagged, consumed-once signals` → minimal `project()` for boot/adoption only. The brain never micro-orchestrates buttons/curtains/copy (architecture.md §1.1, INV-10.1).
- **Organs** (popup, content, stabilization, lock) are autonomous FSMs with complete per-state frozen presentation matrices; between signals an organ cannot move; organs report *sensations* up, never re-derive shared session truth (INV-10.2–10.4).
- Signals: 16-name vocabulary with fixed birthplaces (`markings.changed` born *only* at the user-edit commit path; `run.*`/`session.saved`/`reconciliation.*` born at the brain) (architecture.md §5.2). Delivery: push best-effort, **pull cursor is the correctness path**; every organ keeps `lastConsumedSeq` (§5.4).
- One typed bus for all realm RPC (INV-10.14); command gating middleware (baseUrl-match ∧ config-present ∧ lock-permits ∧ ¬reconciliation) + one reply per command (INV-10.9/10.10); page world behind nonce + 4-command allow-list (INV-10.12/13).
- Data: backend-authoritative; `/save` uploads **all** locally-marked pages as one snapshot and the response replaces local state (INV-6.5); discard → clean *defaults + CSS/AI-selector* baseline, marking stays active (INV-6.6); branch-scoped derivation only (INV-4.x).
- MV3: keepalive primary; **persist durable facts + rehydrate + re-derive volatile** fallback; idempotent-by-sequence replay (INV-10.11).

Three prior audits (audit.md ≈28% shape-only, audit-2.md ≈37% thin cutover, audit-3.md red gate) documented repeated false "done" claims. Since audit-3 (`8affd8a2`), **41 commits** of wiring/porting work landed (2026-07-08 → 2026-08-07). This report describes the tree those commits produced.

---

## 2. How the shipped rewrite actually works

### 2.1 Realms and entrypoints

| Entrypoint | Size | Role |
|---|---:|---|
| `src/entrypoints/background.ts` (3 lines) → `src/background/index.ts` (362) | wiring | Constructs services, brain runtime, lock runtime, emulation runtime, auth monitor, and registers ~25 bus command handlers. |
| `src/entrypoints/content-loader.content.ts` | **868** | The whole content organ runtime: activation, marking listeners, page ritual, consent sweeps, directive rendering, command router registration. |
| `src/entrypoints/popup/main.tsx` | **1,800** | The popup organ *plus* the system's orchestration: signal emit/pull, lock/emulation/config/auth/settings/AI/save/preview flows, content directive composition. |
| `src/entrypoints/page-world.content.ts` | 34 | MAIN world; imports the one plain-`.js` `src/page-world/program.js` (388 lines) at `document_start`. |
| `src/entrypoints/offscreen/main.ts` | 24 | Offscreen document exposing `offscreen.refineXpaths` over the bus. |

The five legacy god-files are gone; the cutover guard (`tests/integration/rewrite-cutover.test.ts`) asserts god-files-deleted + feature-subsystem reachability from entrypoints and passes honestly (it was not weakened — it still lists `src/messaging`, `src/storage`, `src/lynx/{rest,ai,graphql}.ts`, `src/lock/client.ts`, `src/content/stabilization`, `src/background/persistence.ts` as REQUIRED_REACHABLE_FEATURES).

### 2.2 The messaging layer — real, typed, single

`src/messaging/bus.ts:115-397` implements `defineBus(contract, {realm, transport})`: Zod-validated request/response per command, exactly-one-reply (structured `BusFailure` on no-handler/invalid-payload/handler-throw/invalid-response), and an **idempotent reply cache** keyed `source:sourceInstance:seq` capped at 128 (`bus.ts:59,137-201`) so a replayed sequence returns the cached reply. The application contract lives in one place, `src/messaging/realms.ts:112-249`: ~22 commands (`signals.pull/emit/consume`, `command.dispatch`, `ai.run`, `config.load/save`, `renderMode.remember/inspect`, `lock.directive`, `emulation.apply/clear`, `page.context`, `settings.*`, `accounts.*`, `offscreen.refineXpaths`) + 2 events (`fact.reported`, `signal.emitted`).

Transports: `runtime.ts` (chrome.runtime sendMessage/onMessage, with sender-tab stamping into `sourceInstance` as `tab:<id>:frame:<n>` — `transports/runtime.ts:47-62` — which is how the background attributes content facts to tabs), `tabs.ts` (background/popup → content via `tabs.sendMessage`; `onReceive` is a no-op, so this direction is request/reply only), and `page.ts` (window.postMessage framing for the MAIN world).

**Caveat:** the *per-command* payloads of content commands ride `command.dispatch` whose payload is `z.unknown()` (`messaging/contracts/commands.ts`); the content handlers re-parse by hand (`payloadObject()` in `content-loader.content.ts:80-84`). The bus is typed at the envelope, not per content command — weaker than the contract's "Zod-typed command contracts" but contained.

### 2.3 The brain — a correct core, mostly bypassed

`src/background/rewrite-brain.ts` is per-tab: `fold` (`brain/fold.ts:45-62`, Zod-parsed sensation patch over previous facts; page-URL change force-clears `markingEnabled` and `reconciliationPending`) → `decideSignals(prev, next)` (`brain/decide.ts:10-132`, covering the full 16-name vocabulary as fact-edge detectors) → `signalLog.append` (`brain/signals.ts:24-41`: monotonic per-tab `seq`, ring capped at 128 entries) → `project()` (`brain/project.ts:11-46`: minimal `{phase, signalHead, canEdit, blockedReason}` — correctly *not* per-field dictation).

**But there are two signal production paths**, and the second dominates:

1. **Fold-decided** (contract-conformant): `bus.on("fact.reported")` → `brain.observe(sensation)` → decide → append (`background/index.ts:158-179`). In the live path, facts arrive only from (a) content's `marking-toggle` sensation carrying a monotonic `markingToggleSeq` (`content-loader.content.ts:243-248,562-563`), (b) content `activity-ping`s, and (c) lock-runtime lock-role observations (`index.ts:110-133`). So the brain genuinely *decides* only: `markings.changed` (from the toggle counter — a well-designed single-producer edge, `decide.ts:35-46`, commits `e5962c33`/`f485b7e9`), `marking.enabled/disabled` (from folded `markingEnabled`), and `session.navigated` (from folded `pageUrl` change). **4 of 16.**
2. **Source-emitted** (dominant): `bus.onCommand("signals.emit")` → `brain.emitSourceSignal(signal)` (`rewrite-brain.ts:24-37`) — appends the caller's signal to the log **without folding any fact and without any decision**; it even fabricates default facts if none exist. The popup uses this for `run.started/completed/failed`, `preview.opened`, `session.saved`, `session.discarded`, `reconciliation.started/ended`, `marking.enabled/disabled` (`main.tsx:1531,1584,1671,1638,1676,1724,984-1001`); content uses it for `session.navigated` on SPA URL change (`content-loader.content.ts:662-666`).

Consequence: the brain's `runPhase`, `previewActive`, `savedSeq`, `discardedSeq`, `inspectionPending`, `reconciliationPending` facts are **never populated in the live path** — `decide.ts`'s edges for run/preview/save/discard/inspection/reconciliation are exercised only by unit tests. The architecture doc's table of birthplaces ("`run.started` born at brain / `run-start-accepted`", "`session.saved` born at brain / `save-confirmed`") is inverted: those signals are born at the popup, tagged `source:"popup", cause:"popup-entrypoint"`, and the popup then *consumes back its own emissions* (`emitPopupSignal`, `main.tsx:435-455`). Nothing enforces the vocabulary's birthplace column — `signals.emit` accepts any name from any realm.

There is one further breach of "signals are born at the source, never fabricated": when `signals.emit` fails (background unreachable), the popup **manufactures a local `BrainSignal` with `source:"brain"` and a locally invented seq** and dispatches it into its own FSM (`nextSignal`, `main.tsx:260-272`; fallback at `main.tsx:454`). That signal exists in no log and can never be replayed or deduped by anyone else.

### 2.4 Signal delivery — pull-only, popup-only

- The **push channel does not exist**: `signal.emitted` is declared in the contract but the background never emits it (the only emitter is a bootstrap self-targeted frame in `entrypoints/offscreen/main.ts:14-23`, which looks like reachability-gate appeasement). Delivery is the popup's **500 ms `setInterval` poll** (`main.tsx:482-487`) calling `signals.pull {tabId, afterSeq}`.
- The **server-side consumed-once cursor is dead**: `pullForOrgan`/`markConsumed`/`signals.consume` are fully implemented (`brain/signals.ts:54-60`, `index.ts:134-157`) but no caller ever passes `organId` or calls `signals.consume`. The only cursor is the popup's in-memory `createSignalCursor()` (`popup/signal-cursor.ts`) — correctly serialized against concurrent pull/emit interleaving (commit `bc9c6a7f`), but reset on every tab rebind and lost on popup close.
- **Content consumes no signals at all.** The content organ is driven exclusively by *commands* (`command.dispatch`) and by the **`directive.content` state push** — see §2.6. The contract's "popup and content consume the same sequenced stream" consistency guarantee is not what ships; consistency is instead achieved by the popup pushing a composed directive at content.

### 2.5 The popup — a faithful organ wrapped in an unfaithful orchestrator

The organ itself is contract-true:

- `popup/organ/machine.ts:72-221`: pure `transitionPopupState(state, signal)` over 12 states (`boot silent locked silent_preview pre_ai_clean pre_ai_dirty running preview_open exit_restoring post_ai_clean inspecting reconciling`), with seq-dedupe at the top (`signal.seq <= state.lastConsumedSeq → no move`, line 73), `priorState` overlay returns, `runDirtyDuringRun`/`reconciliationDirty` edge handling, run-session-id matching.
- `popup/organ/memory.ts:55-260`: a frozen complete presentation matrix per state (buttons + blocked reasons + curtain + toggle posture), with the `editor_preparing` exemption encoded exactly as INV-10.6 demands (`memory.ts:276-288`: curtain text "Preparing page content", `temporarilyDisabledOverlay:false`).
- `popup/store.ts`: one store, dispatch = transition, `getPresentation()` = `memoryFor(state)`. `popup/view.ts` resolves the 5 views (loading/configuration/render-mode/marking/silent) as a single value — a real improvement over legacy's three contradictory flags.
- `popup/event-log.ts` and `popup/signal-cursor.ts` are small and careful (counter-keyed log entries; serialized cursor).

But the **entrypoint** `entrypoints/popup/main.tsx` (1,800 lines) is where the session actually lives:

- **~45 module-level `let` variables** parallel to the FSM: `boundTabId/Key/Url`, `activeRunSessionId`, `lastSubmissionSnapshot/Key`, `preLockPopupState`, `activeSiteId`, `confirmedRenderMode`, `pendingRenderMode`, `renderModeView/Detail/Busy/Source`, `configStatus`, `loadedSelectors`, `contentActive/Dirty/Reachable`, `lockStatus/Role`, auth/settings state, etc. (`main.tsx:53-130`). This is a second state bag by construction.
- **It orchestrates the AI run** (`runAi`, `main.tsx:1506-1595`): emits `run.started` (with a popup-minted `local-run-N` session id and popup-computed `deadlineAt`), captures the submission from content, calls `ai.run`, then emits `run.completed`/`run.failed` and sends `markContentMainClean` to content. The brain observes none of it as facts.
- **It orchestrates Save** (`saveSession`, `main.tsx:1597-1678`): re-checks its own matrix button, pauses content interactions, emits `reconciliation.started`, posts `config.save`, emits `session.saved` + `reconciliation.ended`, deactivates content, all with hand-sequenced early-exits.
- **It composes the content organ's surface**: `composeContentDirective` (`main.tsx:675-708`) merges the lock runtime's directive with *the popup's own presentation* (curtain text/visibility, banner, blockedReason, `markingEditsBlocked`, `blockOwner`) and pushes it to content on **every lock refresh — i.e. every 500 ms poll tick** (`main.tsx:829`). This is precisely the per-field dictation the doctrine forbids the brain from doing — relocated into the popup.
- **It keeps a shadow FSM**: `preLockPopupState` stashes the state when the lock blocks editing, and `settlePreLockAiRun` (`main.tsx:738-770`) *hand-constructs* post-run states (`name:"post_ai_clean"`, `name:"pre_ai_dirty"`) outside the transition table, then `applyLockPresentation` (`main.tsx:794-817`) `store.reset()`s to `locked` and back. INV-10.4 ("no dual state bags, no local re-derivation") is violated in form and substance.
- **It re-derives session truth from content**: `reconcileContentStatus` (`main.tsx:877-918`) polls `getContentMainStatus` and, if content says active while the store says silent, *emits `marking.enabled` itself*; it relays content's toggle count as a fact (good) but also sets `contentDirty` locally on `markings.changed` (`main.tsx:311`).
- **Boot adoption does not exist**: `project()` is implemented but has no live consumer; there is no `adopt.ts`. On every bind the popup resets to `silent` (`main.tsx:365`) and reconstitutes state from content status + lock polling.

### 2.6 The content organ — autonomous where the contract wanted it, dictated where it didn't

`content-loader.content.ts` registers one bus handler, `command.dispatch` → `createContentCommandRouter` (`content/command-router.ts:176-208`). The router is a genuine implementation of INV-10.9/10.10:

- **Gating middleware** (`command-router.ts:99-122`): data-affecting commands (`activateContentMain`, `captureSubmissionSnapshot`, `resetContentMain`) require baseUrl-match ∧ configPresent ∧ lockRole==="editor" ∧ ¬reconciliationPending, plus directive-block for activate/capture; **one structured reply per command** with self-explaining failure codes; **activity ping on success** (`command-router.ts:196-198` → `fact.reported reason:"activity-ping"` → background forwards to lock runtime, `index.ts:176-178`).
- **`directive.content`** is the write path for the popup/lock-composed surface: `mergeContentDirective` (`command-router.ts:141-174`) implements a small block-owner arbitration (lock vs popup) so a lock block can't be lifted by a popup patch; `applyContentDirective` pauses/resumes marking listeners and renders a curtain/banner into a dedicated fixed-position root (`content-loader.content.ts:296-351`).

Autonomous content behaviors (good, and contract-per-spirit):

- **Consent hiding** (`content/consent.ts`, sweeps at `content-loader.content.ts:353-390`): high-precision selector list (28 entries, each justified; explicit warning against generic words), hidden-not-removed via three `!important` inline properties + attribute marker, native `<dialog open>` closed to escape the top layer, an `aria-hidden` pointer-events bypass style, and a MutationObserver re-sweep for late-mounted CMPs. Gated on exactly one thing: "is this a property page" (via `page.context`), independent of candidacy/marking — matching the legacy durable contract and INV-5.14's spirit.
- **The reveal/freeze page ritual** (`content-loader.content.ts:446-527` + `stabilization/reveal.ts` + `page-world/program.js`): one ritual per visit, latched **only on a real run** (a skip or failure keeps the attempt available — the exact bug class fixed in `ef29c3fc`), waits for `load` with an 8 s timeout, walks top→half→bottom with lazy-suppression, freezes at bottom via page-world `SET_MOTION_PAUSED`, restores scroll under the freeze. Trigger: page-load probe `page.context` (property ∧ renderModeSet ∧ (candidatePage ∨ property-has-no-page-records)) or marking activation or post-render-mode `preparePageVisit`.
- **SPA guard** (`stabilization/spa-guard.ts` + history patches in `program.js:64-83`): while marking is active, a non-navigating URL change forces `location.assign` reload (INV-7.9); URL changes also flow up as `session.navigated` source signals and deactivate marking (INV-6.7).
- **Marking**: real DOM engine (`content/marking/engine.ts`) — composed-tree hit testing with pointer-events piercing and open-shadow `elementsFromPoint` recursion (`hit-testing.ts`), per-point paint-reachability (`paint-reachability.ts`), an 11-layer overlay renderer with hover + silent-highlight layers (`renderer.ts:33,73`), Mutation/Resize/Intersection observers + scroll/resize rescheduling with extension-UI-only mutation filtering (`engine.ts:201-239`), Shift-widening wired through the pure `chooseWidenTarget`, one-time selector seeding (`selector-seed.ts`, guarded by `selectorsSeeded` + not-dirty at `content-loader.content.ts:735-737`), and `buildSubmission` producing the Zod-validated `AiRunPayloadSnapshot` from the same evaluation pass that painted the overlay.
- **Dirty definition**: a monotonic operator-toggle counter, never a row count (`content-loader.content.ts:31-35`) — the correct fix for dynamic pages, and the sole feeder of the brain-decided `markings.changed`.
- **beforeunload gate** armed exactly while dirty (`content-loader.content.ts:105-123`).

### 2.7 The pure domain spine — the strongest layer

- `domain/evaluate.ts:135-179`: the single nearest-marked-ancestor walk producing overlay classes **and** submission rows in one pass; shallow-boundary excludes (`submittedExcludedAncestor` suppression), hidden-text exclusion rows, document-root rejection; `evaluateBranch` splices a subtree recomputation into a previous result (branch-scoped derivation, INV-4.1-4.3). The store's `toggle` (`marking/store.ts`) uses `evaluateBranch` except when a toggle removes an excluded ancestor (falls back to a full `evaluate` — a defensible correctness choice; the "global" pass is still action-triggered, so INV-4.1's "no global/periodic re-derivation" is honored in spirit: nothing re-derives outside a user action).
- `domain/schema/marking.ts`: positional-xpath regex + root-rejection refinement on every `MarkRow`; unified `{xpath, excluded, explicit?}` everywhere. `domain/schema/submission.ts` enforces `defaultExclusionSelectors` exactly equal to the 11-tag immutable list and **rawHtml iff static** at parse time.
- `domain/constants.ts`: verbatim taxonomy transcription; `taxonomy.ts` case-insensitive; `visibility.ts` one `isUserVisible` with the clamp-preview discrimination **fixed** (the audit-1 dead-code bug is gone: clamp-preview → visible, clipped overflow without preview → invisible, `visibility.ts:76-88`); `widening.ts` width-independent ≥2-eligible-descendants climb with shell stops; `boundary.ts` self-markable + shell rejection; `xpath.ts` composed-tree positional builder that skips extension UI and returns `null` inside closed shadow.
- Statically pure: no DOM/Chrome/React imports (spot-checked; the guard test also asserts it).

### 2.8 Background services, lock, emulation, auth, storage

- `background/services.ts` is the single I/O composition point: one `JsonTransport` (fetch, endpoint routed by path — AI/GraphQL/accounts/config, `services.ts:56-84`) wrapped by `withTokenRotation` (`lynx/token-rotation.ts:30-45`) so **every** authed response adopts `x-update-token` — the audit-1 "rotation structurally impossible" defect is fixed. Settings writes are serialized through one queue so a rotation can't lose a concurrent endpoint save (`services.ts:120-133`).
- **Backend-authoritative local data** (`services.ts applyBackendLoad`, commit `bd7e64cf`): a 200 *and* a 404 both clear the local config mirror; the render mode survives only a 404 (nowhere else for the operator's pre-config choice to live); transport/auth failures change nothing. `renderMode.remember` refuses storage when a backend config exists. This is a clean, well-reasoned realization of INV-1.7/6.5's authority rule.
- **AI run** (`services.ts runAiJob`): start → `pollAiJob` (5 s interval, 480 s deadline, heartbeat run-records persisted per iteration) → result parsed into a `SelectorSet`. The locked wire shapes in `lynx/ai.ts` (session_id-only start parse, status running/done/error, result = both selector arrays) match remote-api.md §C.
- **Property lock**: `lock/client.ts` is a real WS client — queues frames until `subscribed`, adopts the **backend-issued identity** (`identity.ts adoptLockIdentity`) and persists it per tab+site via `lockIdentityRepo` (INV-9.1/9.2 honored; the frame's `clientId` field carries the backend identity, `ws.ts buildClientFrame`); reducer covers all 10 server message types; `timings.ts mirrorBackendTimings` displays but never computes deadlines (INV-9.6). `background/lock-runtime.ts` keys clients per tab:site, claims on first directive, forwards lock-state changes as directives to content and as lock-role facts to the brain, and dedupes directive pushes by serialized content (`lock-runtime.ts:118-125`).
- **Emulation** (`background/render-emulation-runtime.ts` + `stabilization/emulation.ts`): CDP metrics override 412×960 / 1920×1080, scale clamp 0.25..1, plus **mobile identity spoofing** (UA rewritten to the same Chrome build's Android form + userAgentData client hints; desktop restores the real UA — `489649d8`), posture *held* per tab and re-asserted on non-terminal debugger detach (`render-emulation-runtime.ts:62-79`), identity-staleness detection with an optional reload only while nothing would be lost (`allowReload` guarded by the popup on "no active session"). Render-mode inspection is a deliberate redesign: `renderMode.inspect` just reloads the tab with JS on/off; the operator compares and commits via CTA (`690fe7d8`) — no automated capture verdict.
- **Auth**: `auth-token-monitor.ts` polls validity on a 10-minute browser alarm (MV3-safe), caches a verdict served to the popup via `accounts.status`; only a definitive 401 flips to invalid. Login stores the JWT background-side; the popup never holds it (`realms.ts:172-178` comment, `settings.load` returns `hasToken` boolean only) — a real security improvement.
- **Storage**: one `KeyValueStore` abstraction (IndexedDB, memory fallback) under typed repos (`tab-state`, `run-records`, `lock-identity`, `local-property`, `config`, `settings`), all reads through `parseStoredValue` (malformed blob → structured error, not crash).

### 2.9 The page-world program — one file, nonce-armed, real

`src/page-world/program.js` is the single plain-`.js` MAIN-world program (INV the plan's §P5 wanted): timer/rAF bridge that queues callbacks while paused and **flushes on resume** (`program.js:265-283`), interval gating, Intersection/ResizeObserver and scroll/wheel/touchmove listener gating for lazy suppression, closed-shadow `attachShadow` instrumentation (tags hosts `data-uf-closed-shadow-host` so the ISOLATED world can classify/skip them), history patches emitting `uf-page-url-changed/1`, and a message handler enforcing the 4-command allow-list + ARM-nonce session (`program.js:324-387`). `DESTROY` restores everything. The submission strips closed-shadow hosts from captured HTML (`marking/submit.ts stripUncapturableHtml`).

---

## 3. Contract conformance — matches

| Contract item | Status | Evidence |
|---|---|---|
| Pure domain spine, single-pass evaluate, branch-scoped recompute | ✅ | `domain/evaluate.ts:135-179`; store splice `marking/store.ts` |
| Unified `rows[]` `{xpath,excluded,explicit?}`; no xpaths/submissionXpaths split anywhere | ✅ | `domain/schema/marking.ts:28-40`; `storage/config.ts` PageMarkingSnapshot.rows |
| Taxonomy verbatim, immutable/toggleable disjoint, LINK absent | ✅ | `domain/constants.ts:35-75` |
| One `isUserVisible`, clamp-include fixed | ✅ | `domain/visibility.ts:47-90` (audit-1 §7 bug gone) |
| Width-independent Shift climb | ✅ | `domain/widening.ts:44-88`, wired at `marking/engine.ts:297-303` |
| Popup FSM + frozen per-state matrix + `editor_preparing` exemption + seq dedupe | ✅ | `organ/machine.ts:72-221`, `organ/memory.ts:55-301` |
| One typed bus; idempotent-by-sequence replies; exactly-one-reply | ✅ | `messaging/bus.ts:137-202`; no raw `chrome.runtime` app envelopes remain (audit-2's `uf.rewriteBrain.*` raw protocol is disabled — `index.ts:70` passes a no-op `addMessageListener`) |
| Page-world: ONE plain-.js program, nonce + 4-command allow-list, deferred callbacks flushed | ✅ | `page-world/program.js:5-14,324-387,265-283` |
| Content command gating + activity ping + self-explaining blocks | ✅ | `content/command-router.ts:99-122,196-198` |
| `markings.changed` single producer, born of user toggles only; seeds never dirty | ✅ | `decide.ts:35-46`, `content-loader.content.ts:31-35,243-248`; seeds ride `getContentMainStatus`/`store.setContentRows` (display-only, `popup/store.ts`) |
| Token rotation on all authed surfaces | ✅ | `lynx/token-rotation.ts`, `services.ts:141-150` |
| Backend-issued, persisted lock identity; backend-authoritative timings mirrored | ✅ | `lock/client.ts:69-83`, `lock/identity.ts`, `lock/timings.ts` |
| Backend-authoritative property data (200 and 404 both clear local; render-mode 404 exemption) | ✅ | `services.ts applyBackendLoad`; `storage/repositories/local-property.ts` |
| Locked AI/GraphQL wire shapes | ✅ | `lynx/ai.ts`, `lynx/graphql.ts` (queries verbatim vs remote-api.md §C/§D) |
| SPA force-reload while active; nav disables marking; latches reset on blur/visibility | ✅ | `spa-guard.ts`, `content-loader.content.ts:641-667,574-599` |
| Consent hidden, never rows | ✅ | `content/consent.ts` (hidden-not-removed keeps XPaths stable) |
| Closed shadow: skipped from capture, distinct overlay category | ✅ | `program.js:39-50`, `evaluate.ts classifyNode`, `renderer.ts` purple dashed style, `submit.ts stripUncapturableHtml` |

## 4. Contract conformance — deviations and gaps

Ordered by severity.

### 4.1 Authority inversion: the popup is the orchestrator (doctrine violation)

As detailed in §2.3/§2.5: 12 of 16 signal names are born at the popup via `signals.emit` (bypassing fold/decide); the popup composes and pushes the content organ's full presentation surface every 500 ms (`main.tsx:675-708,829`); `preLockPopupState`+`settlePreLockAiRun` is a second state bag with hand-built FSM states (`main.tsx:65,738-770`); `store.reset()` moves the organ between signals (`main.tsx:794-817,365`); offline fallback fabricates `source:"brain"` signals (`main.tsx:260-272,454`). This violates INV-10.1/10.2/10.3/10.4 and §5.2's birthplace column. **The reflex arc exists as machinery, but the loop actually closed in production is: popup polls everything → popup decides → popup dictates.** The brain is a sequencing/log service plus a navigation/marking-edge detector.

### 4.2 Save uploads one page and discards the response (INV-6.5)

`configFromSubmission` (`main.tsx:854-875`) builds the `/save` body with **exactly one page** (the current page) under `pageMarkings`, `submittedSelectorsFingerprint:""`, and the save response is used only for its status — `saveConfigSnapshot` parses the returned snapshot (`lynx/rest.ts:52-70`) but `config.save`'s handler drops it (`index.ts:300-309`). The contract requires "all locally-marked pages as one property snapshot… response fully replaces local state". In the rewrite's session model markings never persist locally (`f26d4230`), so "all locally-marked pages" is arguably just the current page — but if the OWNED backend implements the documented full-replace semantics, **saving page B destroys the stored markings of pages A, C…** — the exact half-snapshot wipe class observed live on legacy production. Nothing in the tree reconciles this; it is a product-level decision waiting to bite (see open questions).

### 4.3 Static render mode cannot produce a valid submission

`AiRunPayloadSnapshotSchema` requires `rawHtml` **iff** `renderMode==="static"` (`domain/schema/submission.ts:34-49`). No code anywhere fetches static page HTML (grep: the only `fetch(` is the JSON transport, `services.ts:71`; `rawHtml` is only threaded through if a caller supplies it, and `captureSubmission` in `main.tsx:833-852` never does). Therefore **Run AI and Save on a static-mode property always fail at capture** (the Zod parse throws inside `buildSubmission`). Legacy's `fetchStaticPageHtml` equivalent was never ported. INV-8.6/2.12 unmet.

### 4.4 SW-restart story is write-only; seq reset can silently starve the popup

`persistDurableFacts` runs after every observe/emit (`index.ts:129-131,146-148,171-173`), but `rehydrateDurableFacts` has **zero live callers** — `getBrain(tabId)` always constructs `createRewriteBrain(tabId)` with `initialFacts=null` (`rewrite-brain-runtime.ts:62-69`), so after an MV3 suspension both the facts *and the seq counter* restart at 0 (the persisted `lastSignalSeq` exists precisely to seed `startSeq`, `rewrite-brain.ts:11`, and is unused). Because the popup's cursor survives (it lives in the popup window), a post-restart brain re-issues seqs 1..N which the cursor's `claim(seq <= consumedThrough)` **silently discards** until the new counter overtakes the old one — dropped `marking.enabled`, dropped `markings.changed`, a popup that stops moving with no error. INV-10.11's rehydrate half is unimplemented, and the failure mode it creates is worse than amnesia: *misordered amnesia*.

### 4.5 Lock lifecycle is popup-tethered and non-resilient (§9 mostly unmet)

Heartbeats are sent only inside `lock.directive` handling (`lock-runtime.ts:232`), which only the popup's 500 ms poll invokes — **close the popup and heartbeats stop**; the editor lock silently lapses server-side while the operator marks on. There is no reconnect/backoff (socket close marks the client terminally closed, `lock/client.ts:89-95`; recovery only happens because the next directive poll builds a fresh client, `lock-runtime.ts:147-155` — again popup-tethered). Unimplemented: HTTP reachability probes (`isNetworkReachable` has no callers), off-candidate 70 s, cross-property 30 s cooldown, port-disconnect grace, tab-close immediate release, passive-release countdown UI, takeover/continue-editing UI (client methods exist, `client.ts:124-131`, nothing calls them), render-mode-reload re-claim beyond a directive refresh. INV-9.3 (claim on candidacy, not popup-open) is also inverted: claiming happens on the first *popup* directive, not on landing on a candidate page.

### 4.6 Discard does not restore the selector-seeded baseline (INV-6.6)

`discardMarkings` → `resetContentMain` → `resetMarking()` rebuilds the engine with **defaults only** (`content-loader.content.ts:689-707`); `selectorsSeeded` is cleared but `loadedSelectors` are never re-sent (the popup doesn't pass them on reset, `main.tsx:1708-1727`). The contract's discard baseline is "the same defaults + CSS/AI-selector seed a fresh enable produces". Post-discard the operator sees a page missing the AI-selector exceptions until they toggle marking off/on. (Marking does stay active and clean — that half is honored.)

### 4.7 The INV-6.4 two-gate machinery is dead code

`lynx/ai-job.ts`'s `sessionRequiresAiRun` / `aiRunUpToDate` split — called out by the audits as the subtlest spec point — has no live importer (grep: self-references only). Save gating is the popup matrix (save enabled only in `post_ai_clean`/`preview_open`), which approximates the composite gate but has no Run-AI fingerprint: there is no notion of "output still matches current XPaths", and no CSS-selector editing surface at all (so the CSS-selector-only-edit nuance is currently unreachable).

### 4.8 Preview is a stub

`preview.opened` moves the popup FSM, but nothing implements a content-side preview posture; `preview.exit.requested`/`preview.exited` are emitted by no one in the live path, so `preview_open`/`silent_preview`/`exit_restoring` can only be left via save/discard/disable/navigation. INV-6.10's two entry points and exit-to-origin do not exist yet (silent *highlighting* does; the preview *mode* doesn't).

### 4.9 Other notable gaps/deviations

- **Candidacy source changed**: "candidate page" = has a stored `pageMarkings` record in the `/load` config (`index.ts:222-267`), not the GraphQL `propertyPageTypes` feed (INV-1.4). `buildPropertyPageTypesRequest` exists unused. Todo list / candidate badges / send-to-Lynx (cssInfo staleness guard, updateScrapingConditions) have no popup surface — builders exist (`lynx/graphql.ts`), nothing calls them.
- **`page.context` cache staleness**: per-origin cache lives for the worker lifetime (`index.ts:196-262`); a save that creates the property's first page record won't refresh `candidatePage`/`hasPageRecords` until the SW recycles.
- **AI run vs MV3**: `ai.run` is one bus request that can poll for up to 8 minutes inside the SW with **no keepalive acquisition** (`index.ts:278-283`; keepalive wraps only `signals.emit` and legacy-runtime observe). Run records are heartbeated to storage but nothing resumes an interrupted run after SW death; the popup, awaiting the bus reply, gets a transport failure.
- **`emitSourceSignal` fabricates facts**: emitting into a tab with no observed facts synthesizes a default snapshot (`rewrite-brain.ts:27-35`) which is then persisted — persisted "durable facts" can be fiction.
- **Reveal sweep is skeletal** relative to INV-7.1/7.5: `runReveal` does top→half→bottom scroll + one lazy expansion accounting (`stabilization/reveal.ts`), but there is no motion-styling normalization pass (data-w-id/entrance hooks), no per-subsystem freeze-scope CSS, no restore of hover/media/Web-Animations on release (the page-world timer bridge is the only stabilizer). Freeze mechanics *are* excluded from capture only insofar as extension UI is skipped; there is no pause-class stripping because there is no pause class.
- **Emulation posture is popup-held**: `desiredEmulationMode()`/`ensureSessionEmulation` live in the popup (`main.tsx:608-639`); a tab whose popup never opens is never emulated, and INV-8.4's "must be active for Save" is enforced by the popup calling `applySessionEmulation` before capture (`main.tsx:839`), which is right, but self-heal after nav depends on the popup being open.
- **`LockStatus "not_configured"`** is declared (`realms.ts:30`) but produced nowhere.
- **Session-draft machinery is dead**: `storage/session.ts` (baseline/draft/replaceBaselineFromSave) has no live importer — consistent with the "never persist markings" redesign but leaves INV-1.7's within-session timestamp-merge with no implementation (probably fine: single-page sessions have nothing to merge).

---

## 5. Entanglement check — the newest ~15 commits

The post-audit work (2026-08-03 → 08-07) is where legacy-style entanglement measurably re-enters, and almost all of it lands in the two entrypoint files:

- `f182855b` "operator surface for running a marking session": +251 lines to `main.tsx` — Run/Save/Preview orchestration in the popup.
- `e0a78987` auth: +169 more to `main.tsx` (login/logout/validate state machine as module lets).
- `9640815f`/`0adea4b6`/`2518108c`/`690fe7d8` render mode: pending/confirmed/view/busy/source — five more module-level state axes in `main.tsx`.
- `7b2c32fb`/`ed3d73f9`/`ef29c3fc` consent + ritual + emulation-hold: mostly clean *content*-side behavior, but each also grew `main.tsx` (+68, +21).
- Countervailing good commits: `e5962c33` ("give markings.changed a single producer") and `f485b7e9` (toggle counter) actually *removed* a dual-producer hazard; `bc9c6a7f` (cursor serialization) fixed a real double-consume; `bd7e64cf` (backend authority rule in services, "the rule lives in services, not here and not in the popup") is the right instinct applied in the right layer.

Trajectory: `main.tsx` went from a thin mount to 1,800 lines in ~3 weeks, accreting one `let` per feature. That is exactly how legacy's `popup.ts` reached 10,003 lines. The organ files (`machine.ts`, `memory.ts`, `store.ts`, `view.ts`) have stayed clean and small — the rot is confined to the entrypoint, which is both the bad news (it's the coordination layer, the very thing the rewrite existed to fix) and the good news (the seams to push logic down into the brain still exist and are tested).

Similarly `content-loader.content.ts` (868 lines) fuses activation + ritual + consent + directive rendering + listeners + router registration — smaller and far more legible than `content-main.ts` (7,557), with the heavy machinery properly extracted into `content/marking/*` and `content/stabilization/*`, but it is the file that will absorb every future content behavior unless split.

---

## 6. New architectural risks (not present in legacy)

1. **Seq-reset signal starvation after SW restart** (§4.4) — new failure mode created by half-implementing persistence.
2. **Signal-log truncation vs pull-only delivery**: the ring keeps 128 entries (`signals.ts:19`); a popup closed through a burst (>128 signals, e.g. long marking sessions with many toggles each deciding `markings.changed`) reopens, pulls `afterSeq`, and the truncated gap is silently unfetchable. With no server-side consumed-once cursor and no snapshot adoption, the popup reconstructs from content status — which works today only because `reconcileContentStatus` exists (i.e., because of the re-derivation that violates the doctrine). The two defects currently prop each other up.
3. **500 ms poll as the system heartbeat**: lock heartbeats, directive pushes, config loads, emulation re-assertions, and signal delivery all hang off the popup's interval. The popup being open is a hidden liveness requirement for correctness (locks, especially). Directive pushes to content on every tick are also a mild churn/perf concern (mitigated by `publishDirectiveIfChanged` on the lock runtime side, but the popup path `main.tsx:829` sends unconditionally).
4. **Per-tab brain map never pruned** (`rewrite-brain-runtime.ts:54`): unbounded across tab churn within a worker lifetime (bounded in practice by SW recycling — which itself wipes the logs; the two problems cancel unattractively).
5. **`page.context` per-origin cache staleness** after save/config change (§4.9).
6. **Popup binding key = `tabId|url`**: signals whose payload `pageUrl` differs from the bound URL are dropped (`signalMatchesBinding`, `main.tsx:321-336`) — correct for navigation hygiene, but any producer that fills `pageUrl` inconsistently (several emit sites pass `baseUrl:""` and varying pageUrl) risks silently filtered signals; the filter list of "must-match" names is hand-maintained.
7. **8-minute `ai.run` inside one bus request without keepalive** (§4.9): MV3 lifetime roulette.
8. **Consent selector breadth**: `[class*='modal']`/`[class*='popup']` hide *any* matching element on every property page (not only consent) — legacy-derived, deliberately curated, but hiding runs on all property pages at document_start; a false positive suppresses real content from capture. The file's own comment fences this well; the risk is list drift.

---

## 7. Soundness assessment

**What the rewrite got structurally right (and legacy never had):**
- A pure, exhaustively-tested domain core that both the overlay and the wire payload flow through — the blank-element and overlay/submission-divergence bug classes are genuinely designed out (one pass, seed-once-then-step-aside, rows as the only stored truth).
- One schema source (Zod) end-to-end; wire, storage, and messages all parse at the boundary; malformed data is a structured error.
- One bus, one command dispatch with real gating, one page-world program behind a nonce; five legacy messaging mechanisms are actually gone.
- Backend-authoritative data with the authority rule in exactly one place (`services.property`), and a serialized settings writer that makes token rotation race-free.
- Size and legibility: ~13k lines, of which the two entrypoints are the only files over 400; the code carries unusually good intent-comments.

**What it got wrong, in one sentence:** the *coordination* layer was never moved into the brain — the popup entrypoint reimplemented legacy's `refreshUiInner()`-style imperative orchestration (poll → derive → dictate) on top of otherwise-sound organs, so the doctrine's central promise ("consistency is a guarantee from one signal stream, not a shared orchestration core") is not what ships.

**Is entanglement solved?** Partially. The *vertical* entanglement (marking logic fused with capture fused with freeze fused with UI in one 14k-line file) is solved — layers are real, testable, and replaceable. The *horizontal* entanglement (who decides, who owns state, who moves whom) has migrated from background+popup dual bags to a popup-centric single orchestrator with a shadow state bag. That is *less* entangled than legacy (one orchestrator instead of two mutually-negotiating ones; a real FSM underneath; signals at least logged and sequenced centrally), but it is not the reflex arc, and the last three weeks of commits show the same accretion dynamics that created legacy.

**The highest-leverage corrections, in order:**
1. Move the run/save/preview/reconciliation lifecycles into the brain: popup reports *facts* (`runRequested`, `saveConfirmed`…), the fold sets `runPhase`/`savedSeq`, `decide.ts` (already written and tested for all 16 signals!) births the vocabulary. Most of the machinery exists unexercised.
2. Wire `rehydrateDurableFacts` into `getBrain` (seed `startSeq` from `lastSignalSeq`) — small change, kills the seq-reset starvation.
3. Move `composeContentDirective` into the background (the lock runtime already builds 80% of it) so the content surface has one dictator, and push it on state change rather than per poll tick.
4. Give the lock runtime its own heartbeat alarm and reconnect policy independent of popup polling; release on `tabs.onRemoved`.
5. Implement the static-HTML fetch (or forbid Run AI on static properties explicitly) and decide the `/save` multi-page semantics with the backend before any production cutover.

---

## 8. File map (as-built, for orientation)

```
src/domain/            pure spine: constants, taxonomy, boundary, widening, visibility,
                       xpath, evaluate (+evaluateBranch), selector-seed, schema/{marking,
                       property, submission, facts, signals}
src/messaging/         contract.ts (frame), realms.ts (application contract), bus.ts,
                       contracts/{commands,facts,signals}, transports/{runtime,tabs,page},
                       rewrite-signals.ts (emit/pull helpers)
src/background/        index.ts (all wiring + handlers), rewrite-brain(.ts/-runtime.ts),
                       brain/{fold,decide,signals,project}, services.ts (I/O composition),
                       persistence.ts (persist used / rehydrate unused), lock-runtime.ts,
                       render-emulation-runtime.ts, keepalive.ts, auth-token-monitor.ts
src/content/           activation.ts (gate), command-router.ts (gating+directives),
                       consent.ts, marking/{engine, dom-view, hit-testing,
                       paint-reachability, resolve, store, renderer, overlay,
                       silent-highlight, submit, flatten}, stabilization/{freeze, reveal,
                       spa-guard, emulation, render-mode}
src/popup/             App.tsx (views/1179), organ/{machine,memory}, store.ts, view.ts,
                       event-log.ts, signal-cursor.ts
src/lock/              client.ts (WS), ws.ts (frames), reducer.ts, view.ts, timings.ts,
                       identity.ts
src/lynx/              transport.ts, token-rotation.ts, rest.ts (/load /save /remove),
                       ai.ts, ai-job.ts (gates: DEAD), graphql.ts, accounts.ts
src/storage/           repositories/{key-value, tab-state, run-records, lock-identity,
                       local-property, config}, config.ts (snapshot schema), settings.ts,
                       session.ts (DEAD), durable.ts
src/page-world/program.js   one MAIN-world program (nonce, allow-list, timer bridge,
                            closed-shadow tagger, history bridge)
src/offscreen/xpath-refinement.ts + entrypoints/offscreen/main.ts
```

Signal flow as shipped (contrast with architecture.md §7):

```
content toggle ─fact(markingToggleSeq)→ brain.fold → decide → markings.changed ┐
content nav    ─signals.emit(session.navigated)────────────────────────────────┤ signal log (ring 128)
POPUP          ─signals.emit(run.*, session.saved/discarded, preview.opened,   │
                reconciliation.*, marking.enabled/disabled)─────────────────────┘
                                        ▲
popup 500ms poll ── signals.pull(afterSeq) ── local cursor ── FSM ── memory matrix ── React
popup 500ms poll ── lock.directive ── lock runtime (WS client, heartbeat) 
popup            ── composeContentDirective(presentation+lock) ──▶ content directive surface
lock runtime     ── onStateChange ──▶ directive push + lock-role fact → brain.fold
```

## 9. Cross-references for the parent investigation

- Legacy live findings map onto the rewrite as follows: the **destructive /save** class is *not* structurally prevented here — §4.2 shows the rewrite posts single-page snapshots and ignores the response; whether that wipes siblings is now purely a backend-semantics question. The **selectors-never-reach-config** class is structurally different (selectors live only in memory + backend; the save body carries the popup's current selector set — `main.tsx:1626-1630` — so a run whose `run.completed` was consumed will be saved; a popup closed between run and save loses the selectors entirely since nothing persists them). The **cannot-re-bootstrap-deleted-property** class is addressed differently: render-mode choice is locally storable pre-config (`renderMode.remember`) and the inspection is operator-judged, so a deleted config no longer requires two automated inspections — a genuine improvement.
- The dangling legacy guard commit `e11059b1` (destructive-save guard) has no analogue in the rewrite; if the owned backend keeps full-replace semantics, an equivalent guard (refuse a save whose snapshot would shrink the property's page set) is needed here too.
