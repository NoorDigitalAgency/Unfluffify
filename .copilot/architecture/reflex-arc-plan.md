# THE REFLEX-ARC PLAN (MAIN PLAN — muscle-memory machines per layer)

Status: ARCHITECT-APPROVED master plan (@Sojaner, 2026-07-03). This document is
the single authority for the remaining #5/#14-family work and the target
architecture. It is written to be executed MECHANICALLY: every phase lists its
exact states, signals, memories, file-level work items, tests, acceptance
gates, and deletions. Where an executor finds a divergence between this plan
and the code, apply the smallest behavior-preserving correction and record a
`DECISION:` line in this file under the phase.

ARCHITECT DECISIONS (QA round, recorded verbatim intent):
- D-SAVE: `saved` lands in SILENT (keep the shipped post-save contract).
- D-BUS: NATIVE signal frames immediately (no bridge phase): sequenced,
  provenance-tagged, consumed-once frames on the existing uf-bus.
- D-SCOPE: EVERYTHING in this plan — popup surfaces AND content overlays
  (curtains, spinners, inspection tint, freeze narration) become layer
  machine memories.
- D-ROLLOUT: DIRECT replacement per phase (no feature flag). Safety comes
  from phase discipline: each phase is independently shippable, full-gate
  green, and live-verified with the per-frame harness BEFORE the next starts.
  Rollback = git revert of the phase commit.

---

## 0. DOCTRINE (the model everything below implements)

- The BRAIN is the high-level authority: it OBSERVES (folds facts/levels),
  DECIDES, and EMITS DISCRETE SIGNALS. It never orchestrates mid-routine and
  never dictates per-field presentation.
- Each LAYER (popup, content) runs MECHANICAL, DETERMINISTIC, locally
  orchestrated routines: finite state machines with predefined transition
  tables ("I am in state A, this signal puts me in state E") and COMPLETE
  memorized presentations per state (buttons, lists, curtains, spinners,
  notices). Between signals a machine cannot move; level churn cannot touch
  a memorized surface.
- Layers keep MINIMAL short-term state (machine state + the few latches their
  routines need) and report SENSATIONS (facts + lifecycle signals) upward.
- SIGNALS are EVENTS born at the source with PROVENANCE (content can tell a
  user marking click from an internal config-merge reshape; downstream
  cannot), monotonically SEQUENCED, and CONSUMED ONCE (cursor). Signals are
  never reconstructed from re-served level snapshots. Levels (SessionFacts)
  remain for the brain's observation only.

Live-proven motivations (2026-07-03 session, see HANDOFF.md round log):
interleaved-pass stomps, dictation echo loops (previewBlocked), level-derived
false signals ('markings-changed' from a content config-merge reshape,
round-11), curtain re-asserts mid-preview (round-7 frames). Each is a class
this architecture removes rather than patches.

---

## 1. PHASE 1 — NATIVE SIGNAL SYSTEM (uf-bus signal frames + brain emitter)

### 1.1 Contract (new file `src/common/bus/contracts/signals.ts`)

```ts
export type SignalScope = "tab";              // room for "global" later
export type SignalSource = "brain" | "content" | "popup";

export type SignalFrame = Readonly<{
  kind: "uf-signal/1";
  tabId: number;
  seq: number;              // per-tab monotonic, assigned by the BRAIN store
  name: SignalName;         // the vocabulary below
  source: SignalSource;     // who caused it (provenance layer 1)
  cause: string;            // provenance layer 2, e.g. "user-click",
                            // "config-merge", "run-completed", "navigation"
  at: number;               // Date.now() at emission
  payload: Readonly<Record<string, string | number | boolean>>; // small, flat
}>;

export const SIGNAL_REQUEST_TYPES = Object.freeze({
  EMIT: "signal.emit",          // layer -> brain (brain assigns seq, persists)
  PULL: "signal.pull",          // layer -> brain {afterSeq} -> frames[]
} as const);
export const SIGNAL_EVENT_TYPES = Object.freeze({
  EMITTED: "signal.emitted",    // brain -> layers (push of one frame)
} as const);
```

Rules (enforced by the store, tested in 1.4):
- The brain owns the per-tab signal LOG (ring buffer, last 128 frames,
  persisted in the brain state-store so popup reconnects can catch up).
- Every frame gets `seq = last+1` at ADMISSION (even brain-born frames).
- Push (`signal.emitted`) is best-effort latency; the PULL cursor is the
  correctness path: consumers keep `lastConsumedSeq` and pull
  `{afterSeq: lastConsumedSeq}` on every heartbeat/reconnect. A consumer
  MUST ignore any frame with `seq <= lastConsumedSeq` (dedupe) and MUST apply
  frames in seq order.
- Heartbeats NEVER re-serve a frame as new: pull is explicit-cursor only.
- Emission is EDGE-ONLY at the source. The brain additionally dedupes
  identical consecutive (name, cause, payload) frames within 250ms
  (double-fire guard for double-wired call sites).

### 1.2 Signal vocabulary (complete; do not invent others without a DECISION)

| name                        | emitter (source/cause)                                   | payload                    | consumers |
|-----------------------------|----------------------------------------------------------|----------------------------|-----------|
| `marking.enabled`           | brain / "activate-command-ok" (TAB_ACTIVATE_MARKING ack) | {baseUrl}                  | popup, content |
| `marking.disabled`          | brain / "deactivate-command-ok" or "navigation"          | {baseUrl, cause}           | popup, content |
| `markings.changed`          | content / "user-marking-edit" ONLY (see 3.2)             | {pageUrl, markedCount}     | brain->popup |
| `run.started`               | brain / "run-start-accepted" (orchestrator)              | {sessionId, deadlineAt}    | popup, content |
| `run.completed`             | brain / "run-completed" (orchestrator)                   | {sessionId}                | popup |
| `run.failed`                | brain / "run-failed|run-timeout" (orchestrator)          | {sessionId, reason}        | popup, content |
| `preview.opened`            | brain / "show-preview-ok" (TAB_SHOW_AI_PREVIEW ack)      | {origin: "post_ai"|"marking"|"silent"} | popup, content |
| `preview.exit.requested`    | popup / "user-exit-click"                                | {restore: boolean}         | brain->content |
| `preview.exited`            | content / "exit-complete" (exitAiPreviewMode return)     | {restored: boolean}        | brain->popup |
| `session.saved`             | brain / "save-confirmed" (server ack path)               | {pageUrl}                  | popup, content |
| `session.discarded`         | popup / "user-discard"                                   | {}                         | brain->content |
| `session.navigated`         | content / "navigation" (emitNavigationChangeIfUrlChanged)| {fromUrl, toUrl}           | brain->popup |
| `inspection.started/ended`  | content / "render-mode|page-inspection"                  | {kind}                     | brain->popup |
| `reconciliation.started/ended` | brain / "save-lifecycle"                              | {reason}                   | popup |

Mapping to the SHIPPED popup machine signals (src/popup/marking-session-machine.ts):
`marking-enabled|disabled` <- `marking.enabled|disabled`; `markings-changed` <-
`markings.changed`; `run-started` <- `run.started`; `run-failed` <-
`run.failed`; `post-ai-preview-opened` <- `preview.opened{origin:post_ai}`;
`preview-opened` <- `preview.opened{origin:marking|silent}`; `exit-clicked` <-
local echo of `preview.exit.requested`; `exit-settled` <- `preview.exited`;
`saved` <- `session.saved`; `discarded` <- `session.discarded`; `navigated` <-
`session.navigated`.

### 1.3 Work items
- `src/common/bus/contracts/signals.ts` — the contract above.
- `src/background/brain/signal-log.ts` — per-tab ring log + seq assignment +
  250ms dedupe + persistence in the brain state-store (`signals:<tabId>`).
- `src/background/brain/index.ts` — handle `signal.emit` (admit + push
  `signal.emitted` to the tab's popup port + content bus) and `signal.pull`.
  Brain-born emissions: wire the FOUR brain causes in this phase only where
  the events already exist as discrete code paths:
  * TAB_ACTIVATE_MARKING / TAB_DEACTIVATE_MARKING success replies
    (src/background.ts command handlers) -> `marking.enabled|disabled`.
  * ai-run-orchestrator completion/failure choke points (the existing
    clearPersistedAiRunRecord sites at orchestrator lines ~554/875/1035) ->
    `run.completed|failed`; run-start acceptance (refreshAiRunHeartbeat first
    persist) -> `run.started`.
  * TAB_SHOW_AI_PREVIEW success reply -> `preview.opened` (origin from the
    requesting command payload; popup passes it).
  * TAB_CLOSE_AI_PREVIEW ack + content `aiPreviewClosed` runtime push ->
    `preview.exited{restored}` (emit ONCE per close: key on the restore token
    when present, else on the content push; the brain dedupes the pair).
- `src/popup/bus-client.ts` (popup-bus-client) + content bus client — consumer
  plumbing: `onSignal(frame)` callback + cursor pull on heartbeat/reconnect.
- Popup: `signalMarkingSession(...)` gains a twin `consumeSignalFrame(frame)`
  that maps vocabulary->machine signals (table in 1.2) and calls the existing
  transition function. THE LOCAL CALL SITES STAY during this phase (double
  wiring is safe: the machine ignores non-transitions, and the brain dedupe +
  seq cursor prevent double moves for the same event).
- Trace: `logWorldTrace("signal", frame)` on admit/consume (flag-gated).

### 1.4 Tests (new `tests/signal-log.test.ts`, `tests/signal-consume.test.ts`)
- seq monotonic per tab; pull-after returns only newer; ring truncation.
- consecutive-duplicate dedupe window; distinct causes not deduped.
- consumer cursor: replayed push frames ignored; out-of-order pull applied
  in order; reconnect catch-up applies missed frames once.
- popup mapping table: every vocabulary name maps to the machine signal from
  1.2 (source-contract on the mapping object).
- brain emit wiring: source-contracts on the four choke points.

### 1.5 Acceptance
- Full gate green. Live (bonliva.no, run-flow2 full PASS): the trace shows
  every lifecycle event exactly once with correct seq/cause; the popup machine
  transitions identically whether the local call site or the frame arrives
  first (dedupe proof in trace).

---

## 2. PHASE 2 — POPUP OWNS ITS FULL SURFACE FROM MEMORY

Goal: the popup session machine's memory covers EVERY field the popup renders
for the marking-session surface, INCLUDING curtains and spinners. The brain
stops dictating presentation to the popup entirely (dictation reduces to
{phase} + signals). Direct replacement (D-ROLLOUT).

### 2.1 The popup machine (extend `src/popup/marking-session-machine.ts`)

States (shipped 8 + boot stay; add the busy sub-states as EXPLICIT states so
curtains are memories, not projections):

| state             | entered by signal                          | exits by signal |
|-------------------|--------------------------------------------|-----------------|
| boot              | (adoption once, 2.4)                       | any             |
| silent            | marking.disabled, session.saved, session.navigated, exit(silent) | marking.enabled, preview.opened(silent) |
| silent_preview    | preview.opened{origin:silent}              | preview.exited -> silent |
| pre_ai_clean      | marking.enabled, session.discarded         | markings.changed, run.started, marking.disabled |
| pre_ai_dirty      | markings.changed                            | run.started, session.saved(silent), session.discarded, marking.disabled |
| running           | run.started                                 | run.completed -> preview_open (with preview.opened), run.failed -> pre_ai_dirty |
| preview_open      | preview.opened{post_ai|marking}             | preview.exit.requested -> exit_restoring |
| exit_restoring    | preview.exit.requested                      | preview.exited{restored:true} -> post_ai_clean, {restored:false} -> silent |
| post_ai_clean     | preview.exited{restored:true}               | markings.changed, preview.opened, run.started, session.saved, session.discarded, marking.disabled |
| inspecting        | inspection.started                          | inspection.ended -> returns to the REMEMBERED prior state |
| reconciling       | reconciliation.started                      | reconciliation.ended -> remembered prior state |

`inspecting`/`reconciling` are overlay states: the machine stores
`priorState` (one field) and returns to it — mechanical, no re-derivation.

### 2.2 The memory matrix (COMPLETE — every popup-owned field per state)

Fields owned by the machine after this phase (one table constant,
`MARKING_SESSION_STATE_MEMORY`, frozen):
- Buttons: computeButtonDisabled, computeButtonLoading,
  markingPreviewVisible, markingPreviewDisabled, pageSaveDisabled,
  pageRevertDisabled, toggleEnabledDisabled.
- Mode: mainUiHidden, silentModeActive.
- Preview posture: previewActive, previewBlocked, previewBlockedMessage
  (items/pending stay with the shipped preview single-writer, which becomes a
  sub-routine of this machine — same module, same latch).
- Curtain (sessionCurtain*): visible, message, note, timerText, operation,
  phase — CONTENT FROM MEMORY: running -> "Computing selectors"/"Waiting for
  AI results" + countdown timer fed by the machine's own timer from
  run.started payload deadlineAt; exit_restoring -> restore narration;
  inspecting -> inspection narration; reconciling -> sync narration; all
  other states -> hidden.
- Save/notice texts: pageSaveBlockedReason + the status notice per state
  (pre_ai_dirty -> requires-run text; post_ai_clean -> resolvable text;
  running/exit_restoring -> busy).
- Spinner queue: pushSpinner/runWithSpinner remain ONLY for popup-local
  synchronous operations (config edits, login); ALL session-lifecycle spinners
  move into the curtain memories (delete their pushSpinner call sites, list
  in 2.5).

Exact matrix values: transcribe the CURRENT decider outputs per state (the
dictation-decider truth table is the source; this phase writes those outputs
down as constants — no behavior redesign, D-SAVE keeps saved->silent).

### 2.3 Wiring changes (popup.ts)
- `overrideDictatedMarkingButtons` becomes `applyMarkingSessionMemory(patch)`:
  applies the FULL memory (all 2.2 fields) for every machine state (no more
  null pass-through states; silent memories included).
- `applyCentralSessionDictation` stops applying per-field dictation for the
  owned fields; it feeds ONLY: (a) boot adoption, (b) the signal cursor pull
  trigger. Curtain fields from dictation are ignored for the session surface.
- refreshUiInner: delete the pass-local computation of every owned field
  (toggleEnabled folding block, readiness force-disable VIEW mutations — the
  epoch-gated WRITES to tabState/setEnabled stay, they are observation-channel
  protections, not presentation), and delete nextViewState's owned-field
  entries; the memory application at the write site covers them.
- The machine's countdown timer: one interval owned by the machine, started
  on run.started, cleared on run.completed/failed (replaces
  startAiRunCountdownTimer's view writes).

### 2.4 Adoption (reconnect) — extend `adoptMarkingSessionState`
Inputs (from the brain snapshot + first pull): phase, aiRunPhase,
previewActive/restorePending, runInFlight, dirty + `lastConsumedSeq` from the
snapshot's signal log head. After adoption the cursor pull replays anything
missed. Delete the level-based mirrors the adoption previously needed
(sessionAiRunPhase stays as a published FACT for brain observation, but the
machine no longer reads it after boot).

### 2.5 Deletions (this phase's cleanup list)
- dictation-decider: button/curtain derivation for popup consumption (the
  decider keeps computing PHASE; `deriveDictation`'s buttons/curtain outputs
  are removed with their tests updated to the machine's memory tests).
- central-state-dictation.ts: per-field patch fields for owned surfaces.
- popup.ts: preserveEnabledDuringAiComputeRun / ...UnconfirmedRestore toggle
  FOLDING (the enabled-authority latches from tonight remain for the PUBLISH
  channel; the VIEW no longer derives from them), readiness-gate view flips,
  aiRun spinner view writes, `overrideDictatedPreviewVisibility` (absorbed:
  preview posture is machine memory).
- Session-lifecycle pushSpinner sites: enabling/disabling marking, run wait,
  preview open/exit, save/discard (list them by grep `pushSpinner(` and keep
  only non-session ones).

### 2.6 Tests
- Machine: full transition table test (every cell), overlay prior-state
  return, countdown memory lifecycle, adoption+cursor replay.
- Memory: per-state complete-field snapshot tests (deepEqual whole matrices).
- Source contracts: refreshUiInner contains NO assignments to owned fields;
  the write site applies `applyMarkingSessionMemory`; dictation-decider no
  longer exports button truth.
- Update/replace: popup-central-state-dictation.test.ts,
  popup-marking-refresh.test.ts button assertions, popup-mode-sync.test.ts,
  popup-ai-run-gating tests — rewrite against memories (mechanical: assert
  the matrix constants instead of derivations).

### 2.7 Acceptance
Full gate + live run-flow2 on bonliva.no AND bonliva.se/lediga-jobb: all four
user criteria PASS with ZERO transitions of owned fields between signals
(the 100ms sampler asserts: between consecutive machine transitions in the
trace, owned fields are CONSTANT). Frames reviewed at every transition.

---

## 3. PHASE 3 — CONTENT: PROVENANCE + CONTENT MACHINES (incl. overlays)

### 3.1 Draft provenance (kills the false `markings.changed` — round-11)
- content-main draft mutations get a cause parameter end-to-end:
  `user-marking-edit` (handleClick mark/unmark, include/exclude popover) vs
  `internal` (configUpdated merge/reseed `handleEnabledSameBaseUpdate`,
  post-run snapshot reshapes, restore reseeds).
- `notifyDraftStatus`/draft-status responses carry `cause`; content emits
  `markings.changed` (signal.emit) ONLY for `user-marking-edit`. The popup
  DELETES its dirty-edge detection in applyDraftStatusToPopupState (frame
  consumption replaces it).
- Fingerprint hardening stays as observation hygiene but no longer drives
  any machine.

### 3.2 Content marking/preview machines (formalize what half-exists)
- `content/marking-machine.ts`: states silent | marking | preview |
  compute_lock | restoring; transitions on the SAME vocabulary (consumed via
  the content bus client); aiPreviewState becomes the machine's state record
  (previousEnabled/restoreMarkingOnExit fold into the state + payload).
  exitAiPreviewMode becomes the `restoring` routine, emitting
  `preview.exited{restored}` at its single return points.
- Overlay memory (D-SCOPE): `content/overlay-memory.ts` — per-state page
  overlay content: inspection tint + "Preparing page content", pageCurtain
  busy card content per running/reconciling, marking-temporarily-disabled
  class policy (previewing/restoring only), freeze narration. The overlay
  renderer (layer-host/spinner-layer/content-bus-client pageCurtain path)
  renders THE MACHINE STATE's memory; brain spinner broadcasts reduce to
  state vocabulary (surface names), not content.
- The page-visit freeze lock (d969019) is already reflex-arc-shaped: leave
  as-is; reference it as the pattern.
- configUpdated out-of-scope branch: `deps.disable()` becomes a
  `marking.disabled{cause:"config-out-of-scope"}` emission + machine
  transition (no silent hard-disable outside the machine).

### 3.3 Tests
- Provenance: user-edit vs internal-merge produce/inhibit the signal
  (unit on the handler deps); popup no longer edge-detects (source contract).
- Content machine transition table + overlay memory snapshots.
- The LOCKED reveal/freeze behavior is NOT redesigned here (its warmup abort
  race remains a separate architect-directed item; the machine only wraps
  the existing routines' entry/exit).

### 3.4 Acceptance
Live: mark/unmark drives pre_ai_dirty exactly once per user action; the
post-exit config merge produces NO signal (trace-proven — the round-11
+45s scenario re-run 3x on .no and once on .se with zero false transitions);
overlays render only their state memories (frame review).

---

## 4. PHASE 4 — BRAIN SLIMMING + SPINNER MATRIX ORCHESTRATION COMPLETION

The final leg of the program's core concept: brain = pure signal authority +
surface names; every layer renders spinners/curtains from its memorized
matrix. Ordered steps (architect-approved order, 2026-07-03):

STATUS 2026-07-03: ALL SIX STEPS SHIPPED (each gate-green + review-pushed):
4.0=2573d66, 4.5=74b4c6c+0eafd74, 4.1+4.2a=52ca991 (spinner wire reduced to
{kind, phase, startedAt, deadlineAt, operationId, reason?, spinnerKey?};
layers resolve presentation locally), 4.2b=ca7075f (deriveDictation DELETED;
dictation = {phase} — signalHead deferred until a consumer exists),
4.3=1d54697 (src/popup/spinner.ts deleted; popup ops hold brain broker
LEASES; navInspect single-writer = brain lifecycle selection),
4.4=b905ff0 (machineOwnsPreviewRoutine()/resolveContentExitDestination are
the routine readers; aiPreviewState = presentation data only).
LIVE ACCEPTANCE PASSED 2026-07-03 evening (scripted headless-new harness,
both properties, P4 build): (1) ritual — bottom-exact walk (maxY+viewport
== scrollHeight), ZERO uncontrolled expansions, return-to-top; (2) toggle
silent<->marking = single atomic machine-row delta, no oscillation; (3) AI
run — running row locks everything, curtain "Computing selectors"/"Waiting
for AI results" from machine memory, COUNTDOWN 8:00 == the actual timeout
constant, live ticks; (4) preview 129/82 items latched stable; (5) exit —
post-AI row atomic (Save/Discard/Show enabled), page marking restored,
machine pause released, no clear-post-ai regression, no failed-exit toast;
(6) save — marking->silent atomic, post-save inspection narrated itself
and cleared; (7) silent preview opens/exits fully in SILENT posture.
OBSERVATION (non-blocking): the phase POINTER (sessionCurtainPhase) can
flap for ~2s during exit settles (preview_open<->ready_to_save fold churn)
— no surface renders from it (machine memories held stable throughout);
P5's refresh reduction shrinks the churn at its source. PHASE 4 = CLOSED.

- 4.0 AI-RUN TIMEOUT SYNC (architect step): ONE source of truth for the AI
  run timeout minutes shared by (a) the ACTUAL run timeout/abort deadline
  and (b) every spinner countdown/narration that displays it. Today they
  diverge: the run's real deadline (deadlineAt, ~14min observed on .se)
  drives the machine countdown, while the compute-preparing fallback shows a
  hardcoded "Up to 8:00" and PopupText.overlay.computingSelectorsNote says
  "up to 8 minutes". Define the timeout constant once (shared contract),
  derive deadlineAt AND all displayed copy/countdown fallbacks from it.
- 4.1 CONTENT RENDERER SWAP: the page overlay renderer (spinner-layer /
  content-bus-client pageCurtain path / marking-paused class) consumes
  resolveContentOverlayMemory(machine state) — content/overlay-memory.ts is
  already written and tested. MUST land together with 4.2 (the
  marking-paused class is currently brain-composed; the reconciliation
  saving/syncing pauses stay separate from the previewing/restoring class
  policy).
- 4.2 BRAIN BROADCAST REDUCTION: spinner-authority projection reduces to
  surface vocabulary (which surfaces are engaged per state); ALL text/timer
  content is layer memory. deriveDictation is DELETED;
  `session.dictationUpdated` carries {phase, signalHead:seq} only.
  IMPLEMENTATION MAP (recon 2026-07-03): the per-(kind,phase) spinner
  DEFINITIONS (title/note/timerMode/blockSurfaces/maxDurationMs) already
  live in the SHARED contract common/spinner-contract.ts —
  brain/spinner-authority.phaseToSpinnerState composes display strings from
  it at projection time (plus one inline "Computing selectors" in
  projectAiRunSelection). The reduction: publishSpinnerSurface ships only
  {kind, phase, startedAt, deadlineAt, operationId, reason?, spinnerKey?};
  each layer resolves the CONTENT locally — popup via its machine surface
  memory first, then getSpinnerPhaseDefinition; content via
  resolveContentOverlayMemory(machine state) first, then the definition
  table. Keep the pageCurtain re-broadcast cadence + the page-block
  fail-open watchdog contract unchanged (content-bus-client renderer).
- 4.3 POPUP OLD-PLUMBING DELETION (deferred P2 cleanup): pushSpinner call
  sites + superseded dictation derivations are REMOVED (not overridden);
  the machine matrix is the popup's sole spinner authority.
- 4.4 aiPreviewState READER SWAP: facts/response builders read the content
  machine record instead of the loose active/mode/previousEnabled/
  restoreMarkingOnExit flags.
- 4.5 SIGNAL HYGIENE: the bare RESULTS_APPLIED publisher (missing sessionId
  -> dedupeKey "" -> run.completed admitted twice) is enriched or dropped at
  the subscription.
- The fold pipeline keeps: sticky facts, popup-authority
  (omitContentMarkingSessionFacts), the seq stale-report guard — these protect
  OBSERVATION and stay permanently (as do the popup's epoch/latch publish
  guards from 2026-07-03).
- Deletions: dictation-decider button/curtain code + tests (replaced in P2),
  view-projector fields consumed by no one, VIEW_UPDATED storm triggers that
  existed only to re-derive presentation.

Acceptance: gate + live full-flow on both properties; trace shows dictation
payloads reduced to phase+seq; no VIEW_UPDATED-driven re-renders of machine
surfaces; the displayed run countdown always equals the actual timeout.

---

## 5. PHASE 5 — POPUP REFRESH REDUCTION

STATUS 2026-07-03 evening: SHIPPED (5fa4486) + LIVE-MEASURED on
bonliva.se/lediga-jobb (heavy, headed session). The spinner SET/CLEAR
handler applies buildProjectedBusyViewState() as a TARGETED patch (the
single busy-view builder; refreshUiInner assigns the same builder and
records the aux flags the repaint reuses); stabilizePreviewViewState +
getPreviewItemsSignature/lastPreviewItemsSignature DELETED — the item
latch is the only continuity mechanism, with the identical-push skip now
an explicit canonical content-equality check. MEASUREMENTS (SW message
spy, popup-origin traffic): idle-marking window — ZERO refresh passes
after the enable transition settled; full run + preview open + 248-item
hydration — ~21 popup messages total over 95s; preview-open idle 122s —
ONE message (the designed periodic candidate poll). Old world: ~60
passes/min. Target <10/min: passed by an order of magnitude. BONUS FIX:
the "Saving page changes" PAGE_SAVE spinner now actually renders — the
targeted repaint catches broadcasts the full-refresh race used to
swallow. Flows verified post-change: run posture + countdown ticking,
248 items latched (no oscillation), exit -> post-AI row, save ->
atomic marking->silent. The formal run-flow2 four-criteria matrix rides
with P6 (it is P6's closure protocol).

- refreshUiInner shrinks to: data fetches (configs, site resolution, todo
  lists, draft status probe as a FEED, preview probe as a FEED), fact
  publishing (with the epoch guards), and non-session UI (config forms,
  device emulation, checklist).
- The 1s re-derivation cadence for session surfaces ends; refresh runs on:
  popup open, tab/url change, explicit user actions, signal-triggered
  data needs (e.g. post_ai_clean entry refreshes draft status once).
- Deletions: the re-entry guarded VIEW_UPDATED->refreshUi loop for session
  surfaces; stabilizePreviewViewState signature bookkeeping (the machine's
  latch is the only continuity mechanism).

Acceptance: live CPU/trace comparison (pass count per minute drops from ~60
to <10 on the heavy page); all four criteria PASS in run-flow2 on both
properties, 7-minute windows, frames reviewed.

---

## 6. PHASE 6 — FINALIZATION OF #5/#14

- Full QA matrix: bonliva.no (light) + bonliva.se/lediga-jobb (heavy) + one
  sove.se product page (small): fresh-session flow, leftover-session flow,
  silent-preview flow, discard flow, save flow, navigation-away flow — each
  via run-flow2 (+ manual click-through by @Sojaner for feel).
- FINDING-3 closure check: lost aiPreviewStateChanged push no longer matters
  (probe FEEDS + machine memory make the push purely latency-reducing);
  content-side genuine-empty runs render the memorized settled-empty state.
- The user acceptance (verbatim): C1 loading shows; C2 hydrates, STAYS,
  two-sided clicking works; C3 exit -> Save/Discard and STAYS indefinitely;
  C4 no unrecoverable states. 100% on the heavy page.
- Then: `/review-push` round per repo convention, close #5/#14, update
  knowledge.md doctrine bullets, archive this plan's status section.

---

## 7. MECHANICAL EXECUTION RULES (learned this session — follow, do not re-derive)

1. After ANY popup.ts shape change run the FULL `pnpm test` (locked
   source-contract regexes backtrack or break silently on shapes; never run
   only touched files).
2. Test VM extraction (`extractFunctionSource`) cannot parse inline OBJECT
   return types — name such types (`type X = ...; function f(): X`).
3. Every settle/close path is called TWICE (runtime settle + content's
   token-less push): all close-side latches must be idempotent and
   raise-only.
4. Feeds may claim "settled" only from snapshots that SHOW the open surface
   (mode/active checks) — stale pre-open responses otherwise arm empty states.
5. Live reset protocol: full navigation only (chrome.tabs.update / goto);
   never tabs.reload after runtime.reload (orphaned content instances);
   recreate the popup tab after every runtime reload; restart CDP observers;
   `pkill -f` patterns must not match your own command line; never delete
   profile `Default/Local Extension Settings/<ext-id>` (extension auth).
6. Acceptance is per-frame: `.copilot/qa-scripts/run-flow2.mjs` (100ms
   change-only sampling + popup screencast + two-sided click test + >=6-min
   post-exit windows). 250ms/short-window sampling produced false passes.
   Harness quirks: page-side clicks must target non-anchor `.uf-rect`
   elements; narrated curtains are legitimate transients for C4 checks;
   heavy-page AI runs can exceed 6 minutes (use resume mode).
7. Commit per phase (conventional message + Copilot co-author trailer), push,
   reindex the code graph, update this file's phase status + HANDOFF.md.

## 8. PHASE STATUS

- P0 (foundation, SHIPPED 2026-07-03: 171b05c + 2b780d9): epoch publish
  gating, raise-only restore latch, durable reopen guard, previewBlocked echo
  fix, silent-preview discriminator, criterion-4 trap fixes, preview
  single-writer + open-snapshot settled guard, popup machine v1 (8 states /
  12 signals / button memories), per-frame harness. Live: C1/C2/C4 PASS on
  both properties incl. heavy-page pressure; C3 core fixed (exit collapse
  gone over 6-7 min windows); residual button-surface noise = P1-P4 scope.
- P1 signal system: SHIPPED (2026-07-03). contracts/signals.ts, brain
  signal-log (ring/seq/dedupe/persist via signal-log-persistence), EMIT/PULL
  handlers + EMITTED push to both realms, ai-run-event emitter hook,
  activate/deactivate command emitters, popup consumption (vocabulary->machine
  mapping, gap-safe push handler, throttled cursor pull) + popup-borne
  exit-requested/saved/discarded emissions, content consumer plumbing.
  LIVE ACCEPTANCE (bonliva.no): full lifecycle admitted in order
  (marking.enabled seq1 -> run.started -> run.completed -> preview.opened ->
  preview.exit.requested -> preview.exited seq7); C1/C2/C4 PASS; the C3 flag
  at +43s is the DOCUMENTED P3 residual (false markings-changed from the
  content config-merge reshape — the machine consumed the signal it was
  given). Tests: signal-log + popup-signal-consume (1094/1094 gate).
  DECISION: preview.exited derives from the single ai-run EXITED event (one
  emitter; no ack+push pair needed — dedupeKey machinery stands ready).
  DECISION: run started/completed/failed dedupe on `session:<id>` — the live
  trace caught RESULTS_APPLIED published twice >250ms apart (two layers
  republish the same run event); run signals are once-per-session.
- P2 popup full-surface memory: SHIPPED (2026-07-03). Machine extended with
  inspecting/reconciling OVERLAY states (priorState memory; session signals
  transition the prior underneath; brain-edge emitters from P2a). FULL
  surface memories per state: 7 button bits incl. toggle lock + visibility,
  mode (mainUiHidden/silentModeActive), pageSaveBlockedReason, and
  session-curtain content — the running curtain narrates from memory
  ("Computing selectors"/"Waiting for AI results" + machine-owned countdown
  from run.started deadlineAt). applyMarkingSessionMemory supersedes the
  dictated values at both patch entry points; boot adoption can land inside
  the inspecting overlay. LIVE ACCEPTANCE (.no): memory curtain observed
  rendering during the run; C1/C2 + two-sided PASS; owned fields stable
  between transitions; the +44s flag is the documented P3 residual (now via
  the interim markings-changed source).
  DECISION: run-curtain sub-phase message variance (spinner-authority texts)
  collapses into the stable memory narration per D-SCOPE.
  DECISION: 'markings-changed' interim source = the sessionHasPendingChanges
  false->true edge in the refresh pass (the draft-dirty edge alone missed
  plain mark clicks — live-caught); replaced by content provenance in P3.
  DEFERRED to P4 cleanup: deleting the popup-side spinner-lifecycle
  pushSpinner call sites and the now-superseded dictation field derivations
  (they are overridden, not yet removed).
- P3 content provenance + machines + overlays: IN PROGRESS (2026-07-03).
  §3.1 provenance SHIPPED: 'markings.changed' is born at content's sole
  user-edit commit path (core markUserMarkingEdit -> bus-client reporter ->
  signal.emit; the background transport stamps the tab from the sender), and
  BOTH popup level-edge detectors are deleted — no internal draft reshape can
  manufacture the signal. LIVE: full chain proven in 73ms (toggle.mutation ->
  reporter -> emit -> brain admit seq10 cause "user-marking-edit" -> machine
  pre_ai_clean->pre_ai_dirty with memory saveReason flip).
  HARDENING SHIPPED alongside (live wedge, twice observed): phase-edge
  signals (inspection.*/reconciliation.*) moved from the foldSessionFacts
  inline emitters to the store's WRAPPED MUTATE (session-signal-edges.ts) —
  the one choke point every dictation rewrite funnels through; a rewrite
  outside the fold (clearNavigationInspectionCurtainDraft via the lifecycle
  mirror) had dropped the phase silently, inspection.ended was never born,
  and the popup sat behind the "Inspecting the page" overlay memory until
  navigation. Pair members carry per-cycle payload+dedupeKey so the 250ms
  admission window can only drop a true double-fire, never a closing edge.
  Popup overlays gained the fail-open parachute (30s deadline ->
  "overlay-timeout" -> return to prior + repaint), mirroring the page-blocker
  watchdog idiom.
  FINDING (explains every earlier "marks registered" pass): harness mark
  clicks landed on already-saved-excluded job cards — exclude-mode resolution
  on an excluded element is a designed no-op, so NO user edit ever happened;
  pre-P3 passes rode the auto-seeded draft's dirty level. The harness planner
  now skips elements covered by existing mark rects (run-flow2 planner).
  SURFACE EXTENSION from acceptance r2 (PASS except one 2.2s flap): the
  toggle CHECKBOX VALUE joined the per-state memory (toggleChecked —
  marking-session states true, silent false, boot/overlays null): a
  transient isEnabled fact flap at +40s post-exit blinked the checkbox while
  every machine-owned field held; value flaps now render from memory.
  §3.2: configUpdated out-of-scope emission SHIPPED (handler dep
  reportMarkingDisabled -> marking.disabled{cause:"config-out-of-scope"}).
  CONTENT MACHINE INTEGRATION SHIPPED (2026-07-03 afternoon): the machine
  (content/marking-machine.ts — silent|marking|preview|compute_lock|
  restoring with exit destinations memorized at entry) steps at content's
  routine boundaries: beginAiPreviewMode (compute-lock/preview entry with
  pre-disable enabledAtEntry capture), exitAiPreviewMode (exit-begun +
  exit-settled at BOTH return points), URL-change teardown (navigated), and
  core enable/disable completions via setMarkingLifecycleReporter (the
  marking-edit provenance pattern). 'preview.exited' has its SINGLE
  BIRTHPLACE at the exit routine's return points (payload
  {restored, pageUrl}, cause "exit-routine"); the brain's EXITED ai-run
  mapping is DELETED (the event still folds run state). LIVE: admitted 3.4s
  after the exit click — after the restore actually settled — and the full
  .no acceptance PASSED on the relocated signal (C3 Save/Discard 1.03s,
  held, 2 post-exit transitions). content/overlay-memory.ts SHIPPED (frozen
  per-state page-overlay inventory: curtain contents from established copy,
  marking-paused class policy = previewing/restoring only). REMAINING §3.2:
  the renderer swap (spinner-layer/pageCurtain path consuming the overlay
  memory; brain broadcasts reduce to surface names) and the reader swap
  (facts/response builders reading the machine instead of aiPreviewState's
  loose flags). The reconciling POPUP overlay memory narrates ("Server sync
  pending" curtain) — a 45s heavy-page reconciliation with the old
  hidden-curtain memory read as the criterion-4 dead state.
  §3.4 acceptance: CLOSED (2026-07-03). bonliva.no 3x PASS (r3/r4/r5,
  per-frame, ~1500-1900 frames each, full 6-min windows, zero degrades,
  zero post-exit markings.changed) + bonliva.se/lediga-jobb PASS (se7,
  3961 frames, all criteria, Save/Discard in 1.17s and held). FINDING-3
  RESOLVED: content proven airtight (atomic snapshot; blocked main thread
  stalls probes; probe timeout cannot settle), so "No content detected"
  became a CONFIRMED verdict (popup resolveOpenPreviewItems: a settled-empty
  feed only arms a candidate — the surface keeps loading; confirmation
  requires qualifying observations sustained 3s; any items/pending/uncertain
  feed clears the candidate; latch READS never step the window). se7 hit
  the same transient empty observation post-open and the surface held
  loading until the list hydrated and stayed. Shipped in 0e4797f together
  with THE REVEAL/FREEZE CONTRACT (see HANDOFF + knowledge.md): the heavy
  page now freezes at ~7.4k px (was 12.5k-29k), which also cut the .se AI
  run from ~8min to ~71s.
  STILL NOTED for P4 cleanup: one RESULTS_APPLIED publisher omits sessionId
  (dedupeKey "" -> run.completed admitted twice; harmless downstream — maps
  to no transition) — enrich or drop the bare publisher at the subscription.
  Bonus validation: the product AI-run timeout exercised run-failed live
  (machine running->pre_ai_dirty, curtain cleared, requires_ai_run, Run AI
  re-enabled). Harness preview-open budget is 10min for all runs.
- P4 brain slimming: NOT STARTED
- P5 refresh reduction: NOT STARTED
- P6 finalization (#5/#14 closure + review-push): NOT STARTED
