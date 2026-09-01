# Unfluffify — Target Architecture (Clean Rewrite)

> **Status:** target design for the big-bang rewrite (`rewrite/reimplementation-plan`).
> **Authority:** this document realizes the verified decisions in the
> [save/lock/feed Q&A amendment](./study/qa-decisions-save-contract.md),
> [decisions log](./decisions-log.md), and [invariant register](./contract-invariants.md), in that
> order. The amendment supersedes older full-snapshot save and client-owned GraphQL descriptions.
> **Delivery model:** clean rewrite in a fresh tree. The current `src/` is **reference/inspiration**
> and a source of isolated reusable snippets only — **no logic, contracts, or module shapes are carried
> over wholesale**. Citations to current files below are for provenance, not for porting.

---

## 1. The Reflex-Arc Doctrine

The system is modeled as a **biological reflex arc**, not a client/server orchestration core. One
central **brain** senses and decides; several peripheral **organs** act autonomously from memory and
report sensations back. Consistency across organs is an emergent **guarantee**, not the product of a
shared presentation engine.

### 1.1 Roles

| Role | What it is | What it does | What it must never do |
|------|-----------|--------------|-----------------------|
| **Brain** | The single highest authority. One per-tab state **snapshot** (folded facts) + one per-tab **signal log**. | **Observes** (folds facts/sensations into the snapshot), **decides** (transition-worthy edges), **emits** discrete, sequenced, provenance-tagged, **consumed-once** signals; **projects** a minimal phase for boot/adoption. | Micro-orchestrate buttons, curtains, copy, timers, or countdowns. It never dictates per-field presentation. |
| **Organ** (popup, content, page-stabilization, property-lock) | An autonomous finite-state machine with a **complete memorized presentation matrix per state** ("muscle memory"). | Runs a deterministic transition table; on each admitted signal it moves at most one edge and renders the **whole** surface for its new state from memory; reports sensations back. | Locally *re-derive* the shared session truth, disagree with a sibling, or move between signals. |

### 1.2 The closed loop, stated as invariants

- **Observation is one-directional and lossy on purpose.** Organs report *sensations* (facts +
  lifecycle events) upward. The brain folds them into its snapshot. **Signals are never
  reconstructed from re-served snapshots** — a level (fact) re-broadcast can never masquerade as a
  new event.
- **Signals are edges, born at the source, with two-layer provenance** (`source` = who, `cause` =
  why). Content can distinguish a *user marking click* from an *internal config-merge reshape*, and
  downstream organs cannot fabricate that distinction.
- **Signals are monotonically sequenced and consumed once.** Every organ keeps a `lastConsumedSeq`
  cursor; push delivery is a latency optimization, the **pull cursor is the correctness path**.
- **Between signals, an organ cannot move.** Level/fact churn (a fingerprint jitter, a re-published
  fact) cannot touch a memorized surface. This is the anti-flicker guarantee.
- **Consistency is a guarantee, not a mandate for a shared core.** The popup and content organs
  always render from one consistent session truth because they consume the **same** sequenced signal
  stream against per-state memories — *not* because they share an orchestration module. There is no
  `PopupState`/`ViewState` dual-bag, no central dictation decider for owned surfaces.

### 1.3 Why "muscle memory"

Each organ owns a frozen constant table: **state → complete presentation**. Entering a state renders
every field that state owns (buttons, disabled/loading bits, curtains, spinners, notices, checkbox
values). Nothing is computed per refresh pass. Overlay states (`inspecting`, `reconciling`) store one
`priorState` field and mechanically return to it — no re-derivation on exit.

---

## 2. The Four MV3 Realms → Organs

| MV3 realm | Extension entrypoint | Organ(s) | Responsibility |
|-----------|---------------------|----------|----------------|
| **Background service worker** | `entrypoints/background.ts` | **Brain** + **orchestration** | The reflex-arc brain: fold snapshot, emit/serve signals, project phase. Orchestration: bootstrap, one command dispatcher with gating middleware, per-tab store, keepalive, remote I/O choke points. |
| **Content script** (ISOLATED world) | `entrypoints/content.content.ts` | **Marking-engine organ** + **content runtime** + **page-stabilization** (controller half) | Target resolution, shadow-flatten XPath, incremental mark store, overlay renderer, silent-highlight; idempotent activation; drives page stabilization. |
| **React side-panel / popup** | `entrypoints/popup/` | **Popup organ** | Renders brain projections + consumes signals into its FSM. **No local re-derivation** of session truth. Also hosts the property-lock and lynx views. |
| **Page MAIN world** | injected via `chrome.scripting` + a `document_start` bridge | **Page-stabilization program** | The one plain-`.js` MAIN-world program: motion freeze/reveal, device emulation hooks, render-mode toggles, closed-shadow detection, SPA-navigation detection. Speaks the PAGE transport (nonce + fixed allow-list). |

**Realm ≠ organ 1:1.** The content script hosts three cooperating organs (marking-engine, content
runtime, stabilization controller); the popup realm hosts the popup organ plus the property-lock and
lynx view reducers. Only the brain is singular and central.

---

## 3. Module / Layer Layout

Directory tree with one-line responsibilities. `domain/` is the pure, DOM-free, Zod-validated core
that both the brain and the content organ depend on; everything above it is realm-bound.

```
src/
├── domain/                        # PURE, DOM-free, framework-free contract core (the "spine")
│   ├── schema.ts                  # Zod = SINGLE schema source: types + normalization + runtime validation from one def
│   ├── taxonomy.ts                # page-type taxonomy + immutable-tag blanket list + toggleable-default tags (all CONTRACT constants)
│   ├── visibility.ts              # ONE user-visible policy (live isVisible, submission isVisibleForSubmission, silent-highlight retention)
│   ├── mark-mode.ts               # deriveMarkMode: disabled > passthrough(Space) > include(Alt) > exclude(default); Ctrl breadth, Shift inert
│   ├── boundary.ts                # self-markable predicate + structural-boundary test (rejects shallow shells / landmarks)
│   ├── widening.ts                # Ctrl widening chooser: climb to broadest grouping ancestor with >=2 eligible targets
│   ├── evaluate.ts                # THE single pure pass: "nearest-marked-ancestor decides each node" -> overlay classes + submission rows
│   └── marks.ts                   # minimal canonical mark set model (inclusion-centric: implicit/explicit inclusions + unified exceptions)
│
├── messaging/                     # ONE typed bus for all realm<->realm RPC + events
│   ├── bus.ts                     # typed request/reply + event bus; every inbound command -> EXACTLY ONE reply
│   ├── contracts/                 # Zod-typed message + signal contracts (imports domain/schema.ts)
│   │   ├── signals.ts             # SignalFrame + signal vocabulary (§5)
│   │   ├── commands.ts            # command request/reply types (activation, preview, save, discard, render-mode, capture)
│   │   └── facts.ts               # sensation/fact envelopes reported upward
│   └── transport/
│       ├── background.ts          # SW port hub (assigns tabId to sender frames)
│       ├── content.ts             # ISOLATED-world transport
│       ├── popup.ts               # side-panel transport + cursor-pull client
│       └── page.ts                # MAIN-world PAGE transport: nonce handshake + fixed allow-list (ARM, SET_MOTION_PAUSED, SET_LAZY_LOADING_SUPPRESSED, DESTROY, ...)
│                                  # (property-lock WebSocket is SEPARATE — see property-lock/; only its bg<->popup relay rides this bus)
│
├── background/
│   ├── brain/
│   │   ├── snapshot.ts            # per-tab folded facts (brain's eyes only)
│   │   ├── fold.ts                # sensation -> snapshot fold (sticky facts, popup-authority omit, seq stale-report guard)
│   │   ├── signal-log.ts          # per-tab ring log (128), seq assignment at admission, 250ms double-fire dedupe, persist
│   │   ├── emit.ts                # decide edges -> admit signals -> push (best-effort) + serve pull (correctness)
│   │   └── project.ts             # minimal phase + signalHead projection for boot/adoption ONLY (no per-field dictation)
│   └── orchestration/
│       ├── bootstrap.ts           # SW startup: rehydrate durable facts, re-derive volatile authority
│       ├── dispatch.ts            # ONE command dispatcher + gating middleware (§5.4); one reply per command guaranteed
│       ├── tab-store.ts           # ONE per-tab store (durable slice persisted; volatile slice re-derived)
│       ├── keepalive.ts           # MV3 keep-alive during active work (primary suspension defense)
│       └── remote.ts              # backend I/O choke points (/load, /save, lock HTTP; AI + GraphQL clients composed in)
│
├── content/
│   ├── runtime/
│   │   ├── activate.ts            # idempotent-by-sequence activation; handler composition (never double-arms)
│   │   └── handlers.ts            # inbound command handlers composed into the router
│   └── marking-engine/
│       ├── resolve-target.ts      # O(1) hover target resolution (single hover rect, no recollect)
│       ├── xpath.ts               # positional /tag[index] xpath across FLATTENED open shadow boundaries
│       ├── mark-store.ts          # incremental canonical mark store; branch-scoped recompute only (§6)
│       ├── overlay.ts             # overlay renderer: include/exclude/immutable/CLOSED-SHADOW (distinct) styles
│       └── silent-highlight.ts    # SAME evaluate.ts pass, read-only (no click capture)
│
├── page-stabilization/
│   ├── controller.ts             # ISOLATED-world controller: stabilize() / release() facade
│   ├── freeze-reveal.ts          # exactly one reveal/freeze ritual per page visit; deferred callbacks FLUSHED on resume
│   ├── emulation.ts              # forced mobile 412x960; optional desktop 1920x1080 preview; scale clamp 0.25..1
│   ├── render-mode.ts            # rendered(JS on) -> reload JS-disabled via CDP -> static -> restore; keeps the session device-sim choice (INV-8.8); after reload the popup re-claims the lock + polls the snapshot (INV-9.20)
│   └── page-world.js             # THE one plain-.js MAIN-world program (executeScript + document_start bridge)
│
├── popup/
│   ├── organ/
│   │   ├── machine.ts            # marking-session FSM: transition table (§5.3)
│   │   ├── memory.ts             # frozen state -> complete presentation matrix ("muscle memory")
│   │   └── adopt.ts              # boot adoption from brain projection + cursor replay
│   ├── views/                    # React components render machine memory; zero session re-derivation
│   └── data/                     # non-session data feeds (configs, todo lists, site resolution) — feeds, not authority
│
├── property-lock/
│   ├── client.ts                 # PropertyLockClient: owns BACKEND-ISSUED identity, persisted per-tab; WS + HTTP probes
│   ├── reducer.ts                # lock events -> lock state (one reducer)
│   └── view.ts                   # lock state -> popup lock surface
│
├── lynx-client/
│   ├── api.ts                    # ONE typed API client (/get_selectors + GraphQL: urlSearchInfo, propertyPageTypes, cssInfo, updateScrapingConditions)
│   └── job.ts                    # AI-job FSM (run.started/completed/failed); two Save gates (INV-6.4): sessionRequiresAiRun (save) vs aiRunUpToDate (Run-AI fingerprint; CSS-selector-only edits don't move it)
│
└── storage/                       # three lifetime-tiered Zod-backed repositories
    ├── durable.ts                # survives SW suspension: per-tab state, run records, backend lock identity
    ├── session.ts                # short-lived current marking-session draft, separate from authoritative corpus
    └── settings.ts               # long-lived config: endpoints, feature flags, taxonomy cache, auth token
```

### 3.1 The pure domain spine

`domain/` has **no DOM, no Chrome, no React** dependency, so it is trivially unit-testable and shared
identically by the brain (for gating/validation) and the content organ (for evaluation). Its
lynchpin is `evaluate.ts`: a **single pure pass** over the flattened DOM model that produces **both**
the overlay classification **and** the submission rows from **one** "nearest-marked-ancestor decides
each node" traversal. There is no second pass, no parity audit, no prune-on-toggle, no scoped-splice.

`schema.ts` is the **single Zod schema source** — types, normalization, and runtime validation all
derive from one definition. This kills the type-vs-normalizer drift that today lives across
`common/config.ts` and its hand-written normalizers.

---

## 4. Data Authority, MV3 Suspension, Marking-Derivation

### 4.1 Data authority — backend-authoritative + session working draft

- **Hub state is authoritative** for saved data. The background retains the complete validated
  `/load` corpus and atomically adopts full mutation responses. A current marking-session draft is
  an isolated overlay; popup memory is never authority.
- **Save is a singular partial upsert.** It sends only the current page plus domain selectors; the
  Hub preserves absent pages and returns the full snapshot. The full stored corpus is assembled only
  for AI, with the live current page overlaid.
- **Property identity = `(environmentKey, siteId)`** from Hub-delegated GraphQL. Candidate storage
  uses GraphQL-derived relative `pageKey`; the observed URL origin is informational.
- **Lock authority is a backend-issued fencing token**, distinct from per-editor session identity.
  Grant/transfer/takeover rotates it; every mutation validates it. Renewal requires visible,
  focused, non-idle presence and all deadlines remain backend-authoritative.

### 4.2 MV3 suspension policy

- **Primary:** keep-alive mechanisms during active work (`orchestration/keepalive.ts`).
- **Fallback:** persist **durable** facts (per-tab state, run records, backend lock identity via
  `storage/durable.ts`), rehydrate on wake, and **re-derive volatile authority** (spinner selection,
  leases, connection runtimes) rather than persisting it.
- **Idempotency:** cross-realm messages are **idempotent-by-sequence**. A lost wake is a safe replay:
  the signal cursor dedupes (`seq <= lastConsumedSeq` ignored) and command dispatch is idempotent per
  command sequence. Every command returns exactly one reply, never dropped.

### 4.3 Marking-derivation model (inclusion-centric)

- Store a **minimal canonical mark set**: implicit inclusions (computed content baseline — visible,
  markable, direct-text; **not stored**), explicit inclusions (user Alt rescue — **stored**), and a
  single unified kind of **exception** (per-element exclusion rows carving holes out of the inclusion
  baseline). There is **no "implicit exclusion"** concept.
- Auto-created exceptions (default taxonomy + CSS/AI selectors at initial/branch recalculation) are
  ordinary rows — **not special**, indistinguishable from user-authored ones once created.
- **Immutable excluded tags** (`IMG INPUT NOSCRIPT SELECT TITLE STYLE SCRIPT TEMPLATE IFRAME VIDEO
  SVG`) are a **separate, permanent, DOM-independent blanket rule** — never included, markable, or a
  row. On the wire they ride as `defaultExclusionSelectors`.
- Wire rows are `{ xpath, excluded: boolean, explicit?: boolean }`. Submission = enumerated
  visible-text includes + **shallow-boundary** excludes; `/html[1]` and `/html[1]/body[1]` are never
  rows.
- **Derivation is branch-scoped and action-triggered only** (§6).

---

## 5. The Signal / Event Model (re-derived clean)

The vocabulary below is **re-derived** from the verified invariants. The old
[`reflex-arc-plan.md`](../.copilot/architecture/reflex-arc-plan.md) Phase-1 tables are **reference
only**; do not transcribe them verbatim. Contracts live in `messaging/contracts/signals.ts`
(Zod-validated, imports `domain/schema.ts`).

### 5.1 Frame shape

```ts
type SignalFrame = Readonly<{
  kind: "uf-signal/1";
  tabId: number;
  seq: number;                 // per-tab monotonic; assigned by the BRAIN at admission
  name: SignalName;            // vocabulary in 5.2
  source: "brain" | "content" | "popup";   // provenance layer 1 — who
  cause: string;               // provenance layer 2 — why (e.g. "user-marking-edit", "config-out-of-scope", "navigation")
  at: number;                  // Date.now() at emission
  payload: Readonly<Record<string, string | number | boolean>>;   // small, flat
}>;
```

### 5.2 Signal vocabulary (complete)

| name | born at (source / cause) | payload | consumers |
|------|--------------------------|---------|-----------|
| `marking.enabled` | brain / `activate-ok` | `{ baseUrl }` | popup, content |
| `marking.disabled` | brain / `deactivate-ok` \| `navigation` \| `config-out-of-scope` | `{ baseUrl, cause }` | popup, content |
| `markings.changed` | content / **`user-marking-edit` ONLY** | `{ pageUrl, markedCount }` | brain → popup |
| `run.started` | brain / `run-start-accepted` | `{ sessionId, deadlineAt }` | popup, content |
| `run.completed` | brain / `run-completed` | `{ sessionId }` | popup |
| `run.failed` | brain / `run-failed` \| `run-timeout` | `{ sessionId, reason }` | popup, content |
| `preview.opened` | brain / `show-preview-ok` | `{ origin: "post_ai" \| "marking" \| "silent" }` | popup, content |
| `preview.exit.requested` | popup / `user-exit-click` | `{ restore: boolean }` | brain → content |
| `preview.exited` | content / `exit-routine` (single return point) | `{ restored: boolean, pageUrl }` | brain → popup |
| `session.saved` | brain / `save-confirmed` (server ack) | `{ pageUrl }` | popup, content |
| `session.discarded` | popup / `user-discard` | `{}` | brain → content |
| `session.navigated` | content / `navigation` | `{ fromUrl, toUrl }` | brain → popup |
| `inspection.started` / `inspection.ended` | content / `render-mode` \| `page-inspection` | `{ kind }` | brain → popup |
| `reconciliation.started` / `reconciliation.ended` | brain / `save-lifecycle` | `{ reason }` | popup |

**Provenance rules that make the design safe:**
- `markings.changed` has **exactly one birthplace** — the content organ's sole user-edit commit path,
  tagged `user-marking-edit`. Internal reshapes (config merge, post-run snapshot, restore reseed) tag
  `internal` and **never** emit it. The popup owns **no** dirty edge-detection.
- Paired edges (`inspection.*`, `reconciliation.*`) are emitted through **one wrapped store mutation**
  (the choke point every dictation rewrite funnels through) so a closing edge can never be silently
  dropped. Each carries a per-cycle `dedupeKey` so the 250 ms window can only drop a true double-fire.

### 5.3 Popup organ FSM (transition sketch)

States: `boot`, `silent`, `silent_preview`, `pre_ai_clean`, `pre_ai_dirty`, `running`,
`preview_open`, `exit_restoring`, `post_ai_clean`, plus overlay states `inspecting`, `reconciling`.

```
boot ──(adoption)──▶ [projected phase]
silent ──marking.enabled──▶ pre_ai_clean
silent ──preview.opened{silent}──▶ silent_preview ──preview.exited──▶ silent
pre_ai_clean ──markings.changed──▶ pre_ai_dirty
pre_ai_dirty ──run.started──▶ running
pre_ai_dirty ──session.discarded──▶ pre_ai_clean
running ──run.completed(+preview.opened)──▶ preview_open
running ──run.failed──▶ pre_ai_dirty
preview_open ──preview.exit.requested──▶ exit_restoring
exit_restoring ──preview.exited{restored:true}──▶ post_ai_clean
exit_restoring ──preview.exited{restored:false}──▶ silent
post_ai_clean ──{markings.changed | run.started | session.saved | session.discarded | marking.disabled | preview.opened}──▶ ...
session.saved ──▶ silent            (D-SAVE: saved lands in SILENT)
session.discarded ──▶ pre_ai_clean  (returns to the CLEAN computed baseline)
* ──inspection.started──▶ inspecting  (stores priorState) ──inspection.ended──▶ priorState
* ──reconciliation.started──▶ reconciling (stores priorState) ──reconciliation.ended──▶ priorState
```

Each state carries a **complete** frozen memory row in `popup/organ/memory.ts` (all button
disabled/loading bits, `mainUiHidden`/`silentModeActive`, preview posture, curtain content + timer,
save/notice text, toggle checkbox value). The `running` curtain narrates from memory
("Computing selectors" / "Waiting for AI results") with a machine-owned countdown fed from
`run.started`'s `deadlineAt`.

### 5.4 Consumption via a sequence cursor

Every organ:
1. holds `lastConsumedSeq`;
2. applies push (`signal.emitted`) frames when they arrive **in order**, else ignores;
3. on heartbeat/reconnect **pulls** `{ afterSeq: lastConsumedSeq }` and applies missed frames once,
   in seq order;
4. **ignores** any frame with `seq <= lastConsumedSeq` (dedupe).

Boot: `adopt.ts` seeds the machine from the brain's projected phase + the snapshot's signal-log head
`seq`, then the cursor pull replays anything missed. **No level snapshot is ever converted into a
signal.**

### 5.5 Command gating middleware

`orchestration/dispatch.ts` wraps every inbound command in one middleware. Data-affecting content
commands are gated on: **baseUrl-match ∧ config-present ∧ lock-permits-marking ∧
not-reconciliation-pending**, plus an activity ping on success. Page-world commands ride the fixed
allow-list behind the nonce handshake; the relay reply matches the nonce + originating command. Every
command produces **exactly one** reply (success or structured failure), never dropped — an enabled
control carries an empty blocked-reason; every block self-explains.

---

## 6. Branch-Scoped Derivation

Re-derivation runs at **exactly two moments**:

1. the **initial calculation** on a fresh enable (defaults + CSS/AI selectors from `/load`), and
2. the **exact branch a user just toggled**, incorporating that toggle.

There is **no** global, periodic, or config-merge-triggered re-derivation. A branch recompute walks
only the subtree rooted at the toggled boundary, re-running `domain/evaluate.ts` on that branch and
splicing the resulting overlay classes + submission rows. Overlay and submission are always the
product of the **same** pass, so they cannot disagree.

**Discard** returns to the **clean, freshly-computed baseline** (the same defaults + selector seed a
fresh enable produces from the `/load` config) — **not** a saved user-markings draft. Marking stays
active and clean.

---

## 7. The Closed Loop (diagram-in-text)

```
                          ┌──────────────────────────────────────────────┐
                          │                  BRAIN (SW)                    │
                          │  fold.ts ─▶ snapshot.ts   (observe)            │
   sensations (facts,     │       │                                        │
   lifecycle events)      │       ▼                                        │
   ────────────────────▶  │   decide edges ─▶ emit.ts ─▶ signal-log.ts     │
        (upward)          │                     (seq, dedupe, persist)     │
                          │                         │                       │
                          │        push (best-effort)│ + serve pull (cursor)│
                          └─────────────────────────┼───────────────────────┘
                                                     │  sequenced, consumed-once
                                                     │  SIGNALS (downward)
              ┌──────────────────────────────────────┼───────────────────────────────┐
              ▼                                        ▼                                ▼
   ┌────────────────────┐              ┌────────────────────────┐        ┌────────────────────────┐
   │  POPUP organ        │              │  CONTENT organs         │        │  PAGE-STABILIZATION     │
   │  machine.ts + memory│              │  marking-engine +       │        │  page-world.js          │
   │  (render whole state│              │  runtime + stabilization│        │  (freeze/reveal/emul/   │
   │   from memory)      │              │  (evaluate.ts, overlay) │        │   render-mode)          │
   └─────────┬──────────┘              └───────────┬────────────┘        └───────────┬────────────┘
             │                                      │                                  │
             └───── report sensations upward ───────┴──────────────────────────────────┘
                          (user-marking-edit, navigation, exit-routine, inspection edges…)
```

**Read it as a reflex arc:** stimulus (user action / page event) → afferent sensation to the brain →
brain folds + decides + fires a sequenced signal → efferent signal to each organ → each organ
contracts its "muscle" (renders its memorized state) → the resulting new facts are sensed again. The
loop is closed and single-authority; no two organs negotiate directly.

---

## 8. How the Two Known Bugs Are Impossible by Construction

### Bug 1 — Empty `/save` (blank submission)

**Old cause:** an illegitimate **global** re-derivation (a config-merge / full rebuild) re-applied
over the user's decisions and could produce a blank element set that then flowed into `/save`.

**Structural prevention:**
- Derivation is **branch-scoped + action-triggered only** (§6). There is **no global re-derivation
  code path** to invoke, so a full rebuild cannot silently blank the marks.
- **Backend-authoritative save** (§4.1): `/save` uploads the canonical mark set the session actually
  holds and is replaced by the server response; there is no separate presentation-derived state that
  could diverge from what is submitted.
- Overlay and submission come from **one** `evaluate.ts` pass — the thing the editor sees is the thing
  that is saved.

### Bug 2 — Post-discard authority race (session collapse / interleaved stale pass)

**Old cause:** interleaved refresh passes and level-derived false signals let a stale presentation
pass stomp the settled post-exit / post-discard state, collapsing the surface.

**Structural prevention:**
- **Single-authority reflex arc** (§1): the brain is the only authority; organs never independently
  re-derive the session truth, so there is no second writer to race.
- **Consumed-once sequenced signals** (§5.4): a replayed or late frame with `seq <= lastConsumedSeq`
  is ignored; the machine only moves on genuine forward edges.
- **Provenance** (§5.2): `markings.changed` is born **only** at the user-edit commit path; an internal
  reshape after discard/exit cannot manufacture a dirtying signal.
- **Discard returns to the clean computed baseline** (§6) and stays active + clean — a well-defined
  terminal, not a race between "restore saved draft" and "recompute".
- **One reply per command** (§5.5) + **branch-scoped derivation**: no periodic refresh re-derives the
  owned surfaces, so there is no stale pass to interleave.

Standard test coverage is sufficient for both; no special pinned regression tests are mandated — the
classes are removed at their source, not patched.

---

## 9. Reference Provenance (not for porting)

These current files informed the target and hold reusable snippets, but their logic/contracts are
**not** carried over: `src/common/xpath-utilities.ts` (positional-xpath refinement idea),
`src/common/page-type-taxonomy.ts` (taxonomy constants → `domain/taxonomy.ts`),
`src/common/selector-set.ts` (selector normalization → `domain/schema.ts`),
`src/background/brain/*` (brain shape → rebuilt as `background/brain/{snapshot,fold,emit,project}.ts`),
`src/common/bus/*` (bus shape → rebuilt as `messaging/`), `src/content/*` and `src/content-main.ts`
(marking engine → rebuilt as `content/marking-engine/*`), `src/popup/marking-session-machine.ts`
(FSM shape → rebuilt as `popup/organ/machine.ts`).
