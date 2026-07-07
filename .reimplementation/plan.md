# Unfluffify Reimplementation — Make-Plan

> **Keystone document.** This is the executable build order for a **greenfield, big-bang
> clean rewrite** of the Unfluffify Chrome extension (MV3 · WXT · TypeScript · React
> side-panel).
>
> Read the sibling documents alongside this one — they are the authorities this plan
> executes against:
>
> | Doc | Role |
> |---|---|
> | `contract-invariants.md` | The behavioral spec — every invariant the rewrite must satisfy. |
> | `architecture.md` | The target design — realms, brain, organs, modules, signals. |
> | `remote-api.md` | The remote-API contract — designed target schemas for OWNED surfaces (config/lock; backend adapts), locked schemas for AI/GraphQL/accounts (conform exactly). |
> | `decisions-log.md` | The verified Q&A decisions register (T1–T12), the root source of truth. |
>
> **If this plan and the register (`decisions-log.md`) ever disagree, the register wins.**

---

## 1. Goal

A human editor opens the side-panel on any page of a property they own, and — under a
motion-frozen, mobile-emulated, shadow-flattened capture — marks which regions are
meaningful content (inclusions) versus fluff (exceptions). Those marks, together with the
rendered (and, in static render-mode, raw) HTML, are submitted to the Lynx AI, which
generalizes them into site-wide CSS selectors that the backend stores as scraping
conditions. The outcome we ship is a **reflex-arc extension**: a single authoritative
brain that observes facts and emits sequenced, consumed-once signals; autonomous popup and
content "organs" that render deterministically from those signals; a backend-authoritative
data model; and a branch-scoped marking-derivation engine in which the historical
blank-element and empty-save bugs are **structurally impossible** rather than patched. The
editor experience is identical to today's *intended* behavior plus the decided
improvements (full in-shadow marking, closed-shadow overlay, SPA force-reload,
backend-issued lock identity, corrected inclusion-centric model), with none of the
accidental complexity.

---

## 2. Current facts (why we are rewriting, not refactoring)

Verified against `HEAD` (`main`, commit `28974c2`). Sizes are `wc -l`.

### 2.1 God-files

| File | Lines | Problem |
|---|---:|---|
| `src/content/core.ts` | **14,312** | The content-script monolith: target resolution, classification, XPath/shadow-flatten, overlay, mark store, submission, freeze/reveal, device emulation, render-mode capture, curtain/busy — all fused. |
| `src/popup.ts` | **10,003** | Side-panel UI monolith; `refreshUiInner()` alone (`src/popup.ts:4455`→~6225) is **~1,770 lines** of imperative refresh with dual state bags. |
| `src/content-main.ts` | **7,557** | Second content entrypoint / MAIN-world + runtime glue. |
| `src/background.ts` | **4,301** | Service worker; `browser.runtime.onMessage.addListener` (`src/background.ts:2976`) fronts an **~835-line if-chain** dispatcher. |
| `src/background/brain/index.ts` | **1,033** | Brain core + **7 deciders** under `src/background/brain/deciders/` (activation, session-phase, property-lock, secondary-gates, render-mode, popup-state, spinner-state) already exist, but sit alongside the legacy dictation model. |
| `src/common/config.ts` | **1,474** | Config with hand-written types **and** a separate normalizer — the type-vs-normalizer drift Zod will kill. |

Total in the six god-files: **~38,680 lines.**

### 2.2 Accidental complexity to eliminate

- **Five messaging mechanisms** coexist: `runtime.onMessage` if-chain dispatch
  (`src/background.ts:2976`), `runtime.onConnect` ports (`src/background.ts:2874`), the
  page-world protocol (`src/common/page-world-protocol.ts`), the motion-freeze bridge
  (`src/common/page-motion-freeze-bridge.ts` + `src/entrypoints/page-motion-freeze-bridge.content.ts`),
  and the property-lock WebSocket relay. No single typed bus.
- **Byte-locked freeze pair**: a MAIN-world program duplicated as a `document_start` bridge
  and an `executeScript`-injected copy, kept in sync by a parity test and `@ts` tax.
- **Dual state model**: OLD "dictation" (brain micro-orchestrates buttons/curtains) coexists
  with NEW "signal" model — accidental complexity the register mandates removing.
- **Dual UI state bags** in the popup (legacy `PopupState`/`ViewState`) with local
  re-derivation and flicker on transient churn.
- **~197 test files** (`*.test.ts[x]` / `*.spec.ts`) — coupled to the old contracts; not
  carried over.

### 2.3 Stack (kept) & tag taxonomy (contract)

- Stack: **WXT** (MV3 build) + **TypeScript** + **React** (side-panel) + **IndexedDB** +
  **Vitest**. Kept as-is; **add Zod** as the single schema source.
- Tag lists live in `src/common/constants.ts`:
  - Immutable excluded (permanent blanket, DOM-independent) — the 11-tag set
    `IMG INPUT NOSCRIPT SELECT TITLE STYLE SCRIPT TEMPLATE IFRAME VIDEO SVG`, computed as
    `DEFAULT_EXCLUDED_TAG_SELECTORS \ DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS`
    (`DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS`, `src/common/constants.ts:83`).
  - Toggleable-default boundaries (`DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS`,
    `src/common/constants.ts:67`): `FOOTER FORM LABEL NAV HEADER DIALOG ASIDE BUTTON`.
  - (`LINK` is in neither list; comparisons are case-insensitive.)
  - The AI-submission `defaultExclusionSelectors` blanket = the immutable set
    `IMG INPUT NOSCRIPT SELECT TITLE STYLE SCRIPT TEMPLATE IFRAME VIDEO SVG`.

These **constant values are contract** (T11) and are transcribed verbatim into the rewrite;
none are re-derived.

---

## 3. Decisions already made

Transcribed from `decisions-log.md` (T1–T12). These are **locked**; the implementing agent
does not reopen them. Full statements live in the register and `contract-invariants.md`;
this is the load-bearing summary.

### 3.1 Domain model (T1)

- **Property identity = backend `siteId`** from a GraphQL lookup of the raw URL. **No**
  frontend base-URL normalization / longest-match. Base URL is a **backend attribute only**.
- **Inclusion-centric marking.** Only inclusions split implicit/explicit:
  - *implicit inclusion* = computed content baseline (visible ∧ markable ∧ direct-text), **not stored**;
  - *explicit inclusion* = user Alt-rescue, **stored**.
- **No "implicit exclusion."** All exclusions are **one unified kind of exception** (per-element
  rows) carving holes out of the inclusion baseline — authored by user toggle *or* automatically
  at initial/branch recalculation (default taxonomy + CSS/AI selectors). Auto rows are **not special**.
- **Immutable excluded-tags** are a separate permanent DOM-independent blanket rule (never
  included/markable/a-row); they ride the wire as `defaultExclusionSelectors`.
- **Wire rows** are `{ xpath, excluded: boolean, explicit?: boolean }`.
- **Re-derivation is BRANCH-SCOPED + ACTION-TRIGGERED ONLY** — runs at (1) initial calculation
  and (2) the exact branch just toggled. **No global/periodic re-derivation.** (This makes the
  blank-element bug structurally impossible.)

### 3.2 Marking interaction (T2)

- `deriveMarkMode` precedence: **disabled > passthrough(Space) > include(Alt) > exclude(default)**.
  Shift is an orthogonal breadth modifier; click reads `event.altKey`; blur/visibility/navigation reset latches.
- **Exclude DRILLS** to nearest self-markable, past excluded ancestors. **Include (Alt) REACHES IN**,
  closed boundary, always submits included even when hidden/nested. Include/exclude mutually
  exclusive per element. **Space passthrough** is the only path to hidden content (Space-expand + Alt-include).
- **Self-markable** = visible ∧ ¬immutable ∧ ¬chrome ∧ (owns-direct-text ∨ structural-boundary);
  structural boundaries reject shallow shells (first ~2 levels under body / multiple landmarks).
- **Shift widening (corrected):** a grouping ancestor qualifies iff it has **≥2 eligible-target
  descendants**, **regardless of width** (full-width rejection removed). Shift **CLIMBS** through
  qualifying groups to the broadest, **stopping before** non-qualifying ancestors / page shells.

### 3.3 Submission (T3)

- Submission = enumerated visible-text includes + **shallow-boundary excludes** (descendant under a
  submitted excluded ancestor omitted unless explicitly included; `/html[1]` and `/html[1]/body[1]`
  never rows).
- XPaths **purely positional** (`/tag[index]`, no id/class), computed **after** marking sync against
  the **same sanitized DOM** saved as `renderedHtml`, continuous through flattened open shadow boundaries.
- Visibility geometry: page-**height** counts (below-fold included), mobile-**width** clips; CSS-clamp
  with visible preview → included; `display:none`/`visibility:hidden`/`opacity:0`/zero-area/
  interaction-gated → excluded. **One shared "user-visible" definition** across live `isVisible`, save
  `isVisibleForSubmission`, and silent-highlight retention.
- Shadow DOM **flattened** (Googlebot parity): OPEN roots inlined (no template wrapper); CLOSED shadow
  roots skipped from capture — the host is rendered with a **DISTINCT closed-shadow overlay** (a new
  category, visually separate from immutable) so the editor sees an unreachable region (INV-5.11, §3.9);
  extension's own shadow root never captured.

### 3.4 Session lifecycle (T4)

- **AI-fresh gate**: any marking change re-requires a Run AI before Save enables; marking cannot be
  disabled until Save or Discard.
- **Save** uploads all locally-marked pages as **one property snapshot** to `/save`, then replaces
  local state from the server response; saved lands in **SILENT**.
- **Fresh session**: every enable re-seeds from defaults+selectors (never starts dirty); any
  navigation/reload disables marking.
- **Discard (corrected)**: returns to the **CLEAN, freshly-COMPUTED baseline** (defaults + CSS/AI
  selectors from `/load`) — **not** a saved user-markings draft. Marking stays **active + clean**.

### 3.5 Reveal/freeze + emulation (T5)

- **Exactly one** reveal/freeze ritual per page visit; page-content-only (ext UI keeps its own timers);
  scroll top→bottom with ≤1 lazy expansion (suppress at 50% of initial height), freeze at absolute
  bottom, restore scroll under freeze; deferred timer/rAF callbacks **flushed** on resume.
- Silent-highlight **and** reveal/freeze activate **only after REAL editor activation** (never passive
  page-load); same freeze active in both marking and silent modes.
- Device emulation forced **mobile 412×960** (submission viewport); desktop preview 1920×1080 a
  distinct feature-gated toggle; scale clamped 0.25..1; must be active for Save.
- Render-mode inspection: capture rendered (JS on) → reload JS-disabled via CDP → capture static →
  restore JS; no-JS hold always cleared on end/nav/inactivity.

### 3.6 Property lock (T6)

- **Backend-issued lock identity** persisted per-tab. On lease/handoff the backend **invalidates the
  old identity and issues a fresh one**. **No** frontend UUID generation/rotation.
- Immediate editor claim on landing on an eligible candidate; first grantee is editor; all other
  clients passive.
- **Backend-authoritative timings** (mirrored/displayed by client): heartbeat 30s (if interacted <30min);
  connection-loss 70s; off-candidate 70s; cross-property cooldown 30s; port-disconnect dispose grace 70s
  (tab close → immediate release); passive-observer release 60s. Connectivity = WS state + independent
  HTTP reachability probes.

### 3.7 Authority & presentation (T7, T10, T11)

- **Reflex-arc doctrine**: the brain FOLDS observed facts/sensations into a **per-tab state snapshot**
  (brain's own observation + deciding) and emits **sequenced, consumed-once** signals as the cross-realm
  contract. Facts drive the brain; signals drive the organs.
- Consistency across popup/content (marking-enabled, curtain, gate) is a **GUARANTEE, not a shared
  orchestration core**: each layer is an autonomous FSM organ with a **complete per-state presentation
  matrix**; kept consistent by the brain's signals.
- **One reply per command** (success or structured failure), never dropped; no flicker on transient
  churn; every block self-explains; enabled controls carry an empty blocked-reason.

### 3.8 Delivery, stack, data authority, derivation (T9, T10)

- **Big-bang clean rewrite** in a fresh tree; old code = **reference/inspiration + isolated reusable
  snippets only**; **no logic/architecture/contracts carried over wholesale**.
- **Keep** WXT/TS/React/IndexedDB/Vitest; **add Zod** as the single schema source (types +
  normalization + runtime validation from one definition).
- **MV3 suspension**: PRIMARY = keep-alive during active work; FALLBACK = persist **durable** facts
  (per-tab state, run records, backend lock identity) + rehydrate + **re-derive volatile** authority
  (spinner selection, leases, connection runtimes); cross-realm messages **idempotent-by-sequence**.
- **Data authority**: backend-authoritative + session working draft; local fully sourced on `/load`,
  fully replaced by the `/save` response; timestamp-merge only **within** one editing session.
- **Marking derivation**: store a **minimal canonical mark set** → one pure evaluation pass
  ("nearest-marked-ancestor decides each node") → derive **both** overlay classification **and**
  submission rows; branch-scoped incremental recompute; **delete** prune-on-toggle + scoped-splice +
  parity audit.

### 3.9 Messaging & internals (T11, T8)

- **ONE typed bus** for all realm-to-realm RPC + events (bg/content/popup/page transports); legacy
  popup→background request protocol migrated onto it + deleted. Property-lock WebSocket stays separate
  (talks to the remote hub) but its bg↔popup **state relay moves onto the bus**. Page-world (MAIN)
  relay = a PAGE bus transport keeping its **nonce handshake + fixed allow-list** (`ARM`,
  `SET_MOTION_PAUSED`, `SET_LAZY_LOADING_SUPPRESSED`, `DESTROY`).
- **`content/core.ts` split**: extract page-stabilization (freeze/reveal/emulation/render-mode),
  curtain/busy presentation, and snapshot capture into own subsystems; the marking engine keeps only
  target-resolution + classification + xpath/shadow-flatten + overlay + mark store + submission.
- **Page-world**: ONE plain-`.js` MAIN-world program for both `executeScript` injection **and**
  `document_start` bridge (drop the byte-locked TS pair + parity test) — **after a quick MV3/CSP check
  confirms it's allowed** (open question 4.2).
- **Closed shadow roots** (T8): host treated as excluded/unmarkable/uncaptured with a **DISTINCT overlay
  style** (new category). **SPA nav**: detect non-navigating URL changes (pushState/replaceState/
  hashchange) and **force a full reload** while the extension is active on the page.

### 3.10 Ownership & API sourcing (T11, amended)

- **USER owns** the config + property-lock backend (REST `/load`, `/save`, `/remove`; lock WS/HTTP). These
  are **DESIGN TARGETS**: the rewrite defines the ideal schema — unified `rows[]` `{xpath,excluded,explicit?}`,
  a `baseUrl` attribute on `/load`, backend-issued/rotated lock identity, backend-authoritative lease timers —
  and the **backend is adapted to match**. (This resolves the former `/save` split and base-URL items.)
- **AI (`/get_selectors`) + GraphQL (`urlSearchInfo`, `propertyPageTypes`, `cssInfo`,
  `updateScrapingConditions`) + accounts are LOCKED to the current code** — the rewrite conforms to exactly
  what the client sends/parses today. **No team dependency, no verification blocks the rewrite.** Base URL is
  NOT sourced from GraphQL (it comes from the owned `/load`).

---

## 4. Open questions / external dependencies

These are the only genuinely unresolved items. Everything else is decided.

| # | Item | Owner | Resolution path | Blocks |
|---|---|---|---|---|
| 4.1 | **Config + property-lock backend adaptation (OWNED work, not a blocker to design).** The rewrite builds to the designed target schema: `/load` returns a `baseUrl` attribute + unified `rows[]`; `/save` accepts/returns the same; the lock hub issues + rotates the lock `identity`; lease timers are backend-authoritative. The AI/GraphQL/accounts surfaces are **locked to current** and need no action. | USER | Implement the target schema on the config/lock server (adapt it) ahead of P10 integration; P4 builds the client against the target with mocked transport in the meantime. | P10 (integration/cutover), not the design. |
| 4.2 | **MV3/CSP feasibility of a single plain-`.js` page-world program** serving both `executeScript` injection and the `document_start` bridge. | User / us | Quick spike: manifest a `world: "MAIN"` `document_start` content script that is *also* referenced by `chrome.scripting.executeScript({ files })`; confirm CSP + WXT bundling allow one shared `.js` source. | P5 (page-world program shape). |
| 4.3 | **SPA force-reload scope** — the register notes it applies *while the extension is active on the page* (editor or silent-highlight active); confirm it must not fire when the extension is fully inactive. | User | Confirm during P5/P6 wiring; default to the register's "active-only" reading. | Low — default is safe. |

**AI/GraphQL/accounts are locked to current** — build P4 directly against the documented shapes (no
"unconfirmed schema" gating). The only remote work that gates *cutover* (not design) is the OWNED
config/lock backend adaptation in 4.1.

---

## 5. Non-goals

The implementing agent must **not**:

- **Carry over old logic, architecture, or contracts wholesale.** Old code is reference only. No
  copy-paste of `core.ts`/`popup.ts`/`background.ts` logic; only isolated, self-contained,
  clearly-reusable snippets (e.g., a math helper) with a comment citing the source.
- **Change behavior beyond the decided improvements.** The intended behavioral contract
  (`contract-invariants.md`) is preserved exactly. The only behavior changes are the register's decided
  improvements (full in-shadow marking + deep-capture, SVG-immutable, CSS-clamp-include, closed-shadow
  overlay, backend-issued lock identity, SPA force-reload, corrected inclusion-centric model, two bugs
  designed out).
- **Do a strangler / incremental migration.** This is a **fresh-tree big-bang**. No dual-running of old
  and new modules, no compatibility shims for the deleted protocols.
- **Reintroduce corrected-away behaviors**: frontend base-URL normalization/longest-match; "implicit
  exclusion"; global/periodic re-derivation; full-width Shift-widening rejection; discard-to-saved-draft;
  frontend UUID lock rotation; the five-mechanism messaging; the byte-locked freeze pair; dual UI state bags.
- **Re-derive constant values.** Tag taxonomies, device presets, and timings are contract.

---

## 6. Implementation phases (greenfield build order)

Each phase names the **modules/dirs to create**, their **public interfaces/key types**, the **tests to
write**, the **expected intermediate state**, a **focused validation command**, and a **fallback**.
Build strictly bottom-up: pure domain first, I/O boundaries next, realms last, integration last.

> All new source lives under `src/` in the fresh tree. Directory names below are prescriptive.
> Every module's runtime shape is a **Zod schema** in `src/domain/schema/`; TypeScript types are
> `z.infer` of those schemas — never hand-written duplicates.

---

### P0 — Repo skeleton + Zod domain schema + pure `domain/`

**Create:**
- `src/domain/schema/` — Zod schemas: `property.ts` (siteId, baseUrl backend-attr, renderMode),
  `marking.ts` (`MarkRow = { xpath, excluded, explicit? }`, `CanonicalMarkSet`, immutable/toggleable tag
  enums from constants), `submission.ts` (`AiRunPayloadSnapshot` = `{ baseUrl, renderMode,
  defaultExclusionSelectors, pages[] }`; per-page `{ url, renderedHtml, rawHtml?, renderedXPaths[] }`),
  `signals.ts` (brain→organ signal vocabulary), `facts.ts` (per-tab fact snapshot).
- `src/domain/constants.ts` — verbatim transcription of `src/common/constants.ts` values (immutable,
  toggleable, device presets, prefixes) as the single contract source.
- `src/domain/taxonomy.ts` — `isImmutableTag(tag)`, `isToggleableDefaultTag(tag)`,
  `isDefaultExcluded(tag)` (case-insensitive).
- `src/domain/mark-mode.ts` — `deriveMarkMode(input): 'disabled'|'passthrough'|'include'|'exclude'`
  (precedence disabled > passthrough(Space) > include(Alt) > exclude(default)).
- `src/domain/boundary.ts` — `isSelfMarkable(node, ctx)`, `isStructuralBoundary(node, ctx)` (reject
  shallow shells: first ~2 levels under body / multiple landmarks).
- `src/domain/widening.ts` — `chooseWidenTarget(node, ctx)`: grouping ancestor qualifies iff ≥2
  eligible-target descendants, **regardless of width**; **climbs** to broadest qualifying, stops before
  non-qualifying / shell.
- `src/domain/evaluate.ts` — the **one pure pass**: `evaluate(canonicalMarks, domView): { overlay:
  Map<node,Classification>, rows: MarkRow[] }` via **nearest-marked-ancestor**; branch-scoped
  incremental variant `evaluateBranch(prev, toggledBranch)`.
- `src/domain/visibility.ts` — the **single** `isUserVisible(node, geometry)` policy (page-height counts,
  mobile-width clips, CSS-clamp include, display:none/visibility:hidden/opacity:0/zero-area/interaction-gated exclude).
- `src/domain/xpath.ts` — pure positional `/tag[index]` builder over a **sanitized, shadow-flattened**
  node view (never `/html[1]`, never `/html[1]/body[1]` as rows).

**Key types (all `z.infer`):** `Property`, `MarkRow`, `CanonicalMarkSet`, `AiRunPayloadSnapshot`,
`BrainSignal`, `TabFacts`, `Classification` (`implicit-include | explicit-include | exception |
immutable | closed-shadow`).

**Tests (Vitest, exhaustive — this is where correctness lives):**
- `taxonomy.test.ts` — every immutable/toggleable tag, case-insensitivity, `LINK` in neither.
- `mark-mode.test.ts` — full precedence truth table incl. latch resets.
- `boundary.test.ts` — self-markable predicate incl. shallow-shell rejection.
- `widening.test.ts` — ≥2-descendant qualification, width-independence (regression against old
  full-width rejection), climb-to-broadest, stop-before-shell.
- `evaluate.test.ts` — nearest-marked-ancestor for include/exclude/passthrough; **branch-scoped
  recompute never touches sibling branches** (the blank-element structural guarantee); shallow-boundary
  exclude row set.
- `visibility.test.ts` — one policy across all three call sites; CSS-clamp include; each hidden mode.
- `xpath.test.ts` — positional continuity through flattened open shadow; closed-shadow skip; root exclusion.

**Expected intermediate state:** no extension yet; `pnpm test` green on pure domain; zero DOM/browser deps
in `src/domain/` (enforce with an import-lint rule).

**Focused validation:** `pnpm test src/domain` && `pnpm check`.

**Fallback:** if a predicate is ambiguous, consult `contract-invariants.md` then `decisions-log.md`; do
**not** guess — the pure layer must be exact.

---

### P1 — Messaging bus + realms/transports

**Create:**
- `src/messaging/bus.ts` — `defineBus<Contract>()` typed RPC+event bus; `request(cmd, payload)` returns
  **exactly one** reply (`{ ok, data } | { ok:false, failure }`); `emit(event)`; `on(event, handler)`.
- `src/messaging/contract.ts` — Zod-validated command/event contract (single source; all payloads validated).
- `src/messaging/transports/` — `runtime.ts` (bg↔popup↔content via `runtime`/ports), `page.ts` (MAIN-world
  PAGE transport with **nonce handshake + fixed allow-list** `ARM | SET_MOTION_PAUSED |
  SET_LAZY_LOADING_SUPPRESSED | DESTROY`; relay replies match nonce + originating command).

**Key interfaces:** `Bus.request`, `Bus.emit`, `Bus.on`, `Transport` (`send`, `receive`), `PageNonce`.

**Tests:** `bus.test.ts` (one-reply-per-command incl. structured failure; idempotent-by-sequence replay),
`transports/page.test.ts` (nonce match, allow-list rejection of unknown commands).

**Expected intermediate state:** bus usable in isolation; no realm wired yet.

**Focused validation:** `pnpm test src/messaging`.

**Fallback:** if MV3 port semantics bite, keep the bus API stable and swap the runtime transport internals only.

---

### P2 — Storage repositories + config

**Create:**
- `src/storage/repositories/` — `tab-state.ts`, `run-records.ts`, `lock-identity.ts`, `config.ts`
  (IndexedDB + `chrome.storage` where durable). Each exposes a narrow repo interface; all reads/writes
  validate through the P0 Zod schemas.
- `src/storage/config.ts` — config load/normalize/validate from **one Zod schema** (replaces the drift
  between old `src/common/config.ts` types and its normalizer).

**Key interfaces:** `TabStateRepo`, `RunRecordRepo`, `LockIdentityRepo`, `ConfigRepo` (`load`, `save`,
`clear`), using the storage prefixes from `domain/constants.ts` (`tabState:`, `deviceEmulation:`,
`scriptInjected:`, `spinnerQueue:`).

**Tests:** repo round-trip tests (fake-indexeddb), schema-rejection tests (malformed persisted blob →
structured error, not crash).

**Expected intermediate state:** durable-fact persistence available for P3 fallback path.

**Focused validation:** `pnpm test src/storage`.

**Fallback:** if IndexedDB flakiness in test, use `fake-indexeddb`; keep repo interface unchanged.

---

### P3 — Background brain (fold snapshot + signals + projection) + MV3 keepalive/persistence

**Create:**
- `src/background/brain/fold.ts` — `fold(prevFacts, sensation): TabFacts` (pure fact folding).
- `src/background/brain/decide.ts` — deciders re-derived cleanly from invariants (activation,
  session-phase, property-lock, secondary-gates, render-mode, popup-state, spinner-state) — **reference**
  the existing 7 deciders under `src/background/brain/deciders/` for structure only, not logic.
- `src/background/brain/signals.ts` — emit **sequenced, consumed-once, provenance-tagged** signals; no
  micro-orchestration of buttons/curtains/copy.
- `src/background/brain/project.ts` — project per-organ view state from facts.
- `src/background/keepalive.ts` — PRIMARY keep-alive during active work.
- `src/background/persistence.ts` — persist **durable** facts (tab state, run records, lock identity) +
  rehydrate + **re-derive volatile** authority (spinner selection, leases, connection runtimes) on wake.
- `src/background/index.ts` — wires the brain onto the P1 bus (replaces the ~835-line `onMessage` if-chain).

**Key interfaces:** `Brain.observe(sensation)`, `Brain.snapshot(tabId): TabFacts`, `Brain.emit()`,
`rehydrate()`, `reDeriveVolatile()`.

**Tests:** `fold.test.ts` (fact folding), `signals.test.ts` (sequence monotonic, consumed-once,
provenance), `persistence.test.ts` (durable survives suspend; volatile re-derived; **idempotent-by-sequence
replay after simulated wake**), decider unit tests per gate.

**Expected intermediate state:** brain runs headless in tests; emits correct signals for scripted
sensations; no organ consuming yet.

**Focused validation:** `pnpm test src/background`.

**Fallback:** if keep-alive proves unreliable in real MV3, the persist+re-derive+idempotent path is the
designed safety net — verify it independently in P10 live.

---

### P4 — Lynx-client (config + lock = OWNED design target; AI + GraphQL + accounts = LOCKED) + AI-job state machine

**Create:**
- `src/lynx/rest.ts` — `/load`, `/save`, `/remove` (**OWNED — design target**: `/load` returns a `baseUrl`
  attribute + unified `rows[]`; backend adapted to match). `/save` uploads **all** locally-marked pages as
  one property snapshot (unified `rows[]`), returns the new baseline. **Remote-layer obligation (INV-6.5,
  last clause):** ordinary config syncs **never** upload local draft page markings — **only `/save` does**.
- `src/lynx/ai.ts` — `/get_selectors` (**LOCKED** to current code; conform exactly).
- `src/lynx/graphql.ts` — `urlSearchInfo` (→ siteId; **baseUrl comes from `/load`**, not here),
  `propertyPageTypes`, `cssInfo`, `updateScrapingConditions` (**LOCKED**; conform exactly).
- `src/lynx/ai-job.ts` — AI-job FSM: `idle → running → fresh → stale-on-edit`; enforces the **AI-fresh
  gate** (any marking change re-requires Run AI before Save enables). **Two DISTINCT Save gates (INV-6.4):**
  `sessionRequiresAiRun` is the composite **save** gate (pending changes + page-controls visibility +
  reconciliation state + AI-run requirement); `aiRunUpToDate` is the separate **Run-AI fingerprint** that
  only disables *Run AI* while the last output still matches the current include/exclude XPaths. A
  **CSS-selector-only edit does NOT move `aiRunUpToDate`** — so it must neither wrongly re-enable Run AI nor
  wrongly leave Save enabled. Keep the two gates separate; never collapse them into one fingerprint.

**Key types:** `LoadResponse`, `SaveResponse`, `GetSelectorsRequest/Response`, GraphQL op types — all Zod,
all from `remote-api.md`.

**Tests:** `rest.test.ts` (load→seed, save→replace-local-from-response), `ai-job.test.ts` (fresh-gate
transitions; edit drops to stale; **`css-selector-only-edit-two-gates` — a CSS-selector-only edit does not
move `aiRunUpToDate` and neither wrongly re-enables Run AI nor wrongly leaves Save enabled**, INV-6.4);
**`ordinary-sync-never-uploads-draft-markings` — ordinary config syncs never upload local draft page
markings; only `/save` does** (INV-6.5); GraphQL/AI tests run against the **locked** current shapes
(no skip — the schemas are fixed, not pending).

**Expected intermediate state:** client callable with mocked transport; property identity resolved from
`siteId` (never frontend-normalized).

**Focused validation:** `pnpm test src/lynx`.

**Fallback:** if AI/GraphQL schemas differ on verification (4.1), only `src/lynx/ai.ts` + `graphql.ts`
change; the FSM and REST paths are insulated.

---

### P5 — Page-stabilization (freeze/reveal/emulation/render-mode) + one page-world program

**Create:**
- `src/content/stabilization/freeze.ts` — motion freeze (page-content-only; per-subsystem resume; deferred
  timer/rAF **flush** on resume; lift only on navigation).
- `src/content/stabilization/reveal.ts` — **exactly one** reveal ritual per page visit; scroll top→bottom
  with ≤1 lazy expansion (suppress at 50% initial height); freeze at absolute bottom; restore scroll. The
  **sweep is SKIPPED when there's no vertical scroll room or activation goes stale** (INV-7.1).
- `src/content/stabilization/emulation.ts` — forced mobile 412×960; desktop preview toggle; scale clamp
  0.25..1; reconcile on load; re-clear after nav if debugger detached.
- `src/content/stabilization/render-mode.ts` — capture rendered (JS on) → CDP reload JS-disabled → capture
  static → restore JS; no-JS hold always cleared on end/nav/inactivity. **Render-mode inspection must NOT
  clear an existing session device-simulation choice** (INV-8.8). After a render-mode inspection **reload**,
  the popup explicitly **re-claims the property lock**, then polls the snapshot until connected/inactive
  (INV-9.20; the property-lock half lives in P9).
- `src/content/stabilization/spa-guard.ts` — detect pushState/replaceState/hashchange and **force full
  reload while the extension is active** (editor or silent-highlight).
- `src/page-world/program.js` — **ONE plain-`.js` MAIN-world program** for both `executeScript` injection
  and `document_start` bridge (allow-list + nonce). **Gate on open question 4.2** — spike the MV3/CSP check
  first.

**Key interfaces:** `Freeze.pause/resume/lift`, `Reveal.run(): Promise<void>`, `Emulation.apply/clear`,
`RenderMode.inspect(): { renderedHtml, rawHtml? }`, `SpaGuard.arm`.

**Tests:** freeze/resume flush unit tests; reveal one-ritual + single-lazy-expansion tests; **reveal sweep
is SKIPPED when there's no vertical scroll room or activation goes stale** (INV-7.1); emulation
clamp/reconcile tests; render-mode capture-then-restore tests; **`render-mode-preserves-device-simulation`
— inspection does not clear an existing session device-sim choice** (INV-8.8);
**`render-mode-reload-reclaims-lock` — after a render-mode reload the popup re-claims the lock and polls the
snapshot until connected/inactive** (INV-9.20, handshake shared with P9); spa-guard fires only while active.

**Expected intermediate state:** stabilization drivable in a test harness against a jsdom/fixture page;
page-world program loads under real CSP (verified by the 4.2 spike).

**Focused validation:** `pnpm test src/content/stabilization` + a manual CSP smoke via `pnpm build`.

**Fallback:** if 4.2 says one `.js` source is disallowed, keep two thin generated copies from **one TS
source** (build-time emit) rather than reviving the byte-locked hand-maintained pair.

---

### P6 — Content marking-engine (resolution, shadow-flatten xpath, incremental store, overlay, silent-highlight)

**Create:**
- `src/content/marking/resolve.ts` — hover/click target resolution (O(1) single hover rect; reads
  `event.altKey`); exclude-drills / include-reaches-in per P0 predicates.
- `src/content/marking/flatten.ts` — shadow-flatten DOM view (OPEN inlined, CLOSED skipped, ext shadow
  never captured) feeding `domain/xpath.ts`.
- `src/content/marking/store.ts` — **minimal canonical mark set**; **branch-scoped incremental** apply of a
  toggle (calls `domain/evaluate.evaluateBranch`); no prune-on-toggle, no scoped-splice, no parity audit.
- `src/content/marking/overlay.ts` — overlay classes for each `Classification` incl. the **DISTINCT
  closed-shadow overlay** (new category); silent overlays never capture page clicks.
- `src/content/marking/silent-highlight.ts` — retention via the shared `isUserVisible`; activates only
  after **real editor activation**.
- `src/content/marking/submit.ts` — build `AiRunPayloadSnapshot` from the pure `evaluate` rows against the
  sanitized `renderedHtml` DOM. **Consent UI is hidden before saving (INV-5.14):** consent UI is never
  stored/submitted as dedicated rows; its text is handled by the ordinary invisible-textual rule
  (`isUserVisible`), never as dedicated consent rows.

**Key interfaces:** `MarkingEngine.toggle(node, mode, shift)`, `.canonicalSet()`, `.classification(node)`,
`.buildSubmission(): AiRunPayloadSnapshot`.

**Tests:** resolution (drill/reach-in), flatten (open inline / closed skip / ext-shadow exclusion),
incremental store (**toggle affects only its branch** — blank-element regression), overlay category
mapping incl. closed-shadow, submission shape parity with P0 golden rows, **`consent-ui-hidden-before-save`
— consent UI is never a dedicated row; its text rides the ordinary invisible-textual rule** (INV-5.14).

**Expected intermediate state:** full marking round-trip in a fixture DOM: mark → classify → overlay →
submission snapshot, all from the one pure pass.

**Focused validation:** `pnpm test src/content/marking`.

**Fallback:** if resolution ambiguity, defer to `contract-invariants.md` §marking; never re-derive globally.

---

### P7 — Content runtime + activation

**Create:**
- `src/content/runtime.ts` — content entrypoint; consumes brain signals off the bus; drives an autonomous
  content FSM (complete per-state presentation matrix); reports sensations back. **State-matrix exception
  (INV-10.6):** the `editor_preparing` reconciliation reason **must NEVER raise the temporarily-disabled
  overlay** (unlike `post_ai`/`saving`/`syncing`, which do); encode `editor_preparing` as an explicit
  exempt reason in the presentation matrix (mirror the same exception in the P8 popup matrix).
- `src/content/activation.ts` — real-editor-activation gate that arms stabilization (P5) + silent-highlight
  (P6); disables on any navigation/reload.

**Key interfaces:** `ContentOrgan` (FSM: `states`, `transition(signal)`, `render(state)`),
`Activation.arm/disarm`.

**Tests:** content-FSM transition-table tests (every state reachable; illegal transitions rejected);
activation arms only on real activation, disarms on nav; **`editor-preparing-no-temp-disabled-overlay` —
`editor_preparing` never raises the temporarily-disabled overlay, unlike `post_ai`/`saving`/`syncing`**
(INV-10.6).

**Expected intermediate state:** content organ responds to scripted brain signals end-to-end in a harness.

**Focused validation:** `pnpm test src/content/runtime`.

**Fallback:** if signal ordering surprises, fix in P3 emit sequencing — organ stays a pure consumer.

---

### P8 — Popup organs

**Create:**
- `src/popup/App.tsx` + `src/popup/organ/` — one store per organ + derived selectors (no dual
  `PopupState`/`ViewState`; no local re-derivation). Renders from brain projection; every block
  self-explains; enabled controls carry empty blocked-reason. **State-matrix exception (INV-10.6):**
  `editor_preparing` never raises the temporarily-disabled overlay (mirrors the P7 content matrix).
- `src/popup/store.ts` — single store fed by projected signals.

**Key interfaces:** `PopupOrgan` FSM (states + presentation matrix), `useProjection()` selector hooks.

**Tests:** React Testing Library — each popup state renders the correct matrix; no flicker on transient
churn (state changes only on genuine transitions); curtain narration present for every block;
**`editor-preparing-no-temp-disabled-overlay` — `editor_preparing` is an exempt reconciliation reason and
never raises the temporarily-disabled overlay** (INV-10.6).

**Expected intermediate state:** popup renders correctly from scripted projections; no direct backend calls.

**Focused validation:** `pnpm test src/popup`.

**Fallback:** none needed; popup is a pure projection consumer.

---

### P9 — Property-lock client

**Create:**
- `src/lock/ws.ts` — property-lock WebSocket (separate from the bus; talks to the remote hub); its
  **bg↔popup state relay rides the bus**.
- `src/lock/identity.ts` — persist **backend-issued** identity per-tab; on lease/handoff, adopt the
  backend's **fresh** identity and drop the old (no frontend generation/rotation). **Render-mode reload
  re-claim (INV-9.20):** after a render-mode inspection reload re-injects the content script, the popup
  explicitly **re-claims the lock**, then **polls the snapshot until connected/inactive** — the render-mode
  half of this handshake lives in P5.
- `src/lock/timings.ts` — mirror **backend-authoritative** deadlines (heartbeat 30s, connection-loss 70s,
  off-candidate 70s, cross-property cooldown 30s, dispose grace 70s, passive-release 60s); connectivity =
  WS state + independent HTTP probes.

**Key interfaces:** `LockClient.claim/release/heartbeat`, `LockIdentity.adopt(fresh)`, `Timings.mirror(state)`.

**Tests:** identity-rotation tests (old invalidated → passive on backend handoff), claim/passivity tests,
timing-mirror tests (client never *computes* deadlines), reconnect vs terminal ("Extension context
invalidated") tests, **`render-mode-reload-reclaims-lock` — post-reload the popup re-claims the lock and
polls the snapshot until connected/inactive** (INV-9.20, paired with the P5 render-mode half).

**Expected intermediate state:** lock client drivable against a mocked hub; editor/passive transitions correct.

**Focused validation:** `pnpm test src/lock`.

**Fallback:** if hub protocol differs, only `ws.ts` framing changes; identity/timing policy is insulated.

---

### P10 — Integration + golden-page acceptance + cutover

**Create:**
- `tests/integration/` — cross-realm flows on the bus (activate → capture → mark → run AI → save →
  silent; discard-to-clean-baseline; SPA force-reload; MV3 suspend/resume idempotent replay).
- `tests/golden/` — golden-page regression: real captured fixtures → `AiRunPayloadSnapshot` byte-stable
  (submission rows, xpaths, visibility).

**Steps:**
1. Wire all realms on the P1 bus; delete every reference to old protocols (nothing to delete in a fresh
   tree — assert **no** legacy module names exist).
2. Run the full matrix (§7).
3. Live-validate via `pnpm build` + `pnpm browser:live <target-url>` against `.output/chrome-mv3`.
4. Cutover: this fresh tree **is** the shipped extension (big-bang). Bump version, commit to
   `rewrite/reimplementation-plan`.

**Focused validation:** `pnpm lint && pnpm check && pnpm test && pnpm build`, then live.

**Fallback:** if a golden mismatch appears, it is a bug in a pure module (P0/P6) — fix there, never patch at
the integration seam.

---

## 7. Test matrix

| Layer | Kind | Command | Covers |
|---|---|---|---|
| Pure domain | Vitest unit (exhaustive) | `pnpm test src/domain` | taxonomy, mark-mode, boundary, widening, evaluate (branch-scoped), visibility, xpath |
| Messaging | Vitest unit | `pnpm test src/messaging` | one-reply-per-command, idempotent-by-sequence, nonce/allow-list |
| Storage | Vitest unit (fake-indexeddb) | `pnpm test src/storage` | repo round-trip, schema rejection |
| Brain | Vitest unit | `pnpm test src/background` | fold, signal sequencing/consumed-once, persist+re-derive, deciders |
| Lynx | Vitest unit | `pnpm test src/lynx` | REST seed/replace, AI-fresh gate; AI/GraphQL **skipped-flagged** pending 4.1 |
| Stabilization | Vitest + CSP smoke | `pnpm test src/content/stabilization` | freeze/flush, one-reveal, emulation clamp, render-mode, spa-guard |
| Marking | Vitest unit | `pnpm test src/content/marking` | resolution, flatten, incremental store, overlay categories, submission |
| Content/Popup organs | Vitest + RTL | `pnpm test src/content/runtime src/popup` | FSM transition tables, presentation matrix, no-flicker |
| Lock | Vitest unit | `pnpm test src/lock` | identity rotation, claim/passivity, timing mirror, reconnect/terminal |
| Contract / golden-page | Regression against real captures | `pnpm test tests/golden` | `AiRunPayloadSnapshot` byte-stability |
| Integration | Cross-realm | `pnpm test tests/integration` | activate→mark→run→save→silent, discard, SPA reload, suspend replay |
| Live / manual | Real browser | `pnpm build` + `pnpm browser:live <url>` | reveal/freeze fidelity, emulation, closed-shadow overlay, lock claim |
| Full gate | All | `pnpm lint && pnpm check && pnpm test && pnpm build` | everything before cutover |

---

## 8. Regression risks & mitigations

| Risk | Historical failure | Structural mitigation |
|---|---|---|
| **Seed-then-step-aside / blank-element** | Global/periodic re-derivation re-applied over user decisions, blanking marked elements. | **Branch-scoped + action-triggered only** re-derivation (`domain/evaluate.evaluateBranch`); no global rebuild exists. Tested: a toggle touches only its branch. |
| **Empty `/save`** | Save uploaded an empty snapshot on an authority race. | Backend-authoritative save + one-reply-per-command + `/save` replaces local from response. Integration test asserts non-empty snapshot. |
| **Post-discard authority race** | Discard restored a stale draft / raced backend. | Discard → **clean freshly-computed baseline** from `/load`, stays active+clean; single-authority brain. |
| **Visibility fidelity → wrong ground truth** | Divergent visibility rules across live/save/highlight. | **One** `isUserVisible` policy shared by all three call sites; golden-page byte-stability. |
| **MV3 suspension** | Lost service-worker state mid-session. | Keep-alive primary + **persist-durable / re-derive-volatile / idempotent-by-sequence** fallback; replay test after simulated wake. |
| **Reveal/freeze edge-trigger + SPA reload** | Multiple/zero rituals; SPA route change with stale capture. | Exactly-one reveal per visit; spa-guard forces full reload while active; unit + live tests. |
| **Closed shadow** | Host silently unmarkable with no editor cue. | Distinct closed-shadow overlay category; flatten skips closed roots; overlay-mapping test. |
| **AI/GraphQL sourcing** | AI/GraphQL/accounts are separate-team-owned. | **Locked to current code** — the rewrite conforms to exactly what exists (low drift risk), isolated in `src/lynx/ai.ts`+`graphql.ts`; no verification gate. The OWNED config/lock backend is adapted to the designed target (4.1) — both ends under our control. |

---

## 9. Acceptance criteria

**Per-phase** (observable):

- **P0**: `pnpm test src/domain` green; `src/domain/` has zero DOM/browser imports; branch-scoped evaluate
  proven to leave sibling branches untouched.
- **P1**: every bus command yields exactly one reply; a replayed (duplicate-sequence) command is a no-op.
- **P2**: a malformed persisted blob surfaces a structured error, never a crash.
- **P3**: after a simulated suspend/resume, durable facts survive and volatile authority is re-derived
  identically; signals are monotonic and consumed-once.
- **P4**: `/load` seeds local state; `/save` replaces it from the response; a marking edit drops Save until
  Run AI re-runs. Property identity comes only from `siteId`.
- **P5**: exactly one reveal/freeze per visit; page-world program loads under real CSP; SPA URL change
  forces a reload only while the extension is active.
- **P6**: marking a node classifies + overlays + submits from the one pure pass; closed-shadow host shows
  the distinct overlay; toggling one branch never blanks another.
- **P7/P8**: popup and content always render from one consistent state; no flicker on transient churn;
  every block self-explains; enabled controls carry empty blocked-reason.
- **P9**: on backend handoff the old identity goes passive and the fresh backend-issued identity holds the
  lock; client never computes a deadline.

**Overall**:

- The golden-page suite produces byte-stable `AiRunPayloadSnapshot`s matching the contract in
  `contract-invariants.md` / `remote-api.md`.
- `pnpm lint && pnpm check && pnpm test && pnpm build` all pass; `pnpm browser:live` shows the full editor
  loop (activate → mark → run AI → save → silent) with correct freeze, emulation, overlays, and lock claim.
- No legacy module/protocol names exist in the tree (five-mechanism messaging, byte-locked freeze pair,
  dual UI bags all absent).

---

## 10. Todo chain

One executable todo per phase (each runnable without rereading the whole plan):

1. **P0 — Domain core**: create `src/domain/` (schema, constants, taxonomy, mark-mode, boundary, widening,
   evaluate, visibility, xpath) + exhaustive Vitest; gate: `pnpm test src/domain` green, zero browser imports.
2. **P1 — Bus**: create `src/messaging/` (bus, contract, runtime + page transports w/ nonce+allow-list);
   gate: one-reply + idempotent-replay tests green.
3. **P2 — Storage**: create `src/storage/` repositories + Zod config; gate: round-trip + schema-rejection tests green.
4. **P3 — Brain**: create `src/background/` (fold, decide, signals, project, keepalive, persistence, index on
   the bus); gate: signal-sequencing + suspend-replay tests green.
5. **P4 — Lynx client**: create `src/lynx/` (rest, ai [flagged], graphql [flagged], ai-job FSM); gate: REST +
   AI-fresh-gate tests green; AI/GraphQL tests skipped-flagged pending 4.1.
6. **P5 — Stabilization + page-world**: create `src/content/stabilization/` + `src/page-world/program.js`
   (after the 4.2 CSP spike); gate: reveal/freeze/emulation/render-mode/spa-guard tests + CSP smoke green.
7. **P6 — Marking engine**: create `src/content/marking/` (resolve, flatten, store, overlay, silent-highlight,
   submit); gate: branch-scoped store + overlay-category + submission golden tests green.
8. **P7 — Content runtime**: create `src/content/runtime.ts` + `activation.ts`; gate: content-FSM transition
   tests green.
9. **P8 — Popup organs**: create `src/popup/` (App, organ store, selectors); gate: RTL matrix + no-flicker tests green.
10. **P9 — Lock client**: create `src/lock/` (ws, identity, timings); gate: identity-rotation + timing-mirror tests green.
11. **P10 — Integration + cutover**: create `tests/integration/` + `tests/golden/`; wire all realms; run full
    matrix; `pnpm build` + `pnpm browser:live`; commit to `rewrite/reimplementation-plan`. Gate: full matrix
    + live loop green; no legacy names in tree.
