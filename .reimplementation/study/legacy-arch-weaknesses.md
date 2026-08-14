# Legacy Unfluffify (v1.10.0 main) — Architecture & Implementation Weakness Catalog

**Scope:** the production LEGACY extension, git worktree of `main` at
`/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`.
All `file:line` citations below are relative to that root. Every claim was verified in source; where the project's own
knowledge base (`.copilot/knowledge.md`) documents the same pain point, the knowledge.md line is cited as corroboration.

**Purpose:** this is the checklist the rewrite will be judged against. Each weakness is phrased as a **testable property**
(a property the rewrite must satisfy, or an experiment that demonstrates the legacy failure), not a vibe.

**Out of scope by ground rule:** the backend data-schema redesign itself (legacy config version 5 `pageMarkings[url].xpaths`
+ `submissionXpaths` vs rewrite version 1 unified `rows`) is deliberate and is NOT flagged. Behavioral/UX consequences of the
legacy schema's *handling* (merges, filters, snapshot assembly) ARE in scope.

---

## Contents

- [A. Communication topology & layering](#a-communication-topology--layering)
- [B. Decision-making scattered across layers](#b-decision-making-scattered-across-layers)
- [C. State management & persistence](#c-state-management--persistence)
- [D. Save/sync data integrity](#d-savesync-data-integrity)
- [E. Lifecycle fragility](#e-lifecycle-fragility)
- [F. God files, coupling, module structure](#f-god-files-coupling-module-structure)
- [G. Error handling & observability](#g-error-handling--observability)
- [H. Structural performance pathologies](#h-structural-performance-pathologies)
- [I. Testability](#i-testability)
- [J. Environment / emulation fidelity](#j-environment--emulation-fidelity)
- [K. Rewrite acceptance checklist (condensed)](#k-rewrite-acceptance-checklist-condensed)

---

## A. Communication topology & layering

### W-01 — At least nine parallel transport mechanisms with no single message contract

**WHAT (testable):** For any given piece of information (e.g. "is marking enabled on tab T"), there must be exactly one
transport and one authoritative reader. In legacy, the same system state flows over: (1) raw
`runtime.sendMessage` envelopes — **88 distinct `type:` string literals** across `src` (grep
`type: "..."` / `message.type === "..."`); (2) the typed `uf-bus` envelope protocol (`src/common/bus/**`, with its own
realms/transports/contracts); (3) per-tab popup-state ports `ufPopupState:<tabId>` (`src/common/world-messaging-contract.ts:9-11`);
(4) a dedicated property-lock port (`src/content/property-lock-port-client.ts`); (5) a page-world `postMessage` relay
(`src/content/page-world-relay.ts`, `src/common/page-world-protocol.ts`); (6) a chrome.storage-backed transfer-payload store
for large payloads with a 5-minute TTL (`src/background/transfer-payload-store.ts:5`); (7) serialized-function injection via
`chrome.scripting.executeScript` for the page-motion freeze control (`.copilot/knowledge.md:298-300`); (8) an offscreen
document for XPath refinement (`src/background.ts:992-1078`); (9) the CDP debugger channel for render-mode HTML capture and
emulation (`src/background.ts:911`, `src/common/emulation.ts:330-376`).

**WHERE:** listed above; the coexistence is admitted in `.copilot/knowledge.md:349-358` (C8: the `@webext-core` envelope
migration was aborted mid-way because wrapped popup→background messages *silently never arrived* in live MV3, so raw and
packaged envelopes now coexist permanently, with content listeners required to unwrap both).

**WHY it hurts:** every new feature must pick (or straddle) a transport; ordering guarantees differ per channel; the same
fact arriving on two channels is the direct precondition for the flip-flop class of bugs (see W-08, W-15). The C8 episode
shows the stack is so entangled that a transport migration could not be completed and was frozen half-done.

**Correct design:** one typed message contract per direction with a single envelope; large payloads by reference through one
blob store; page-world and CDP channels wrapped behind the same contract, not parallel to it.

### W-02 — Background dispatch is a single monolithic if-chain listener

**WHAT (testable):** Message routing must be table-driven and exhaustively enumerable (a test can list all routes). In
legacy, `browser.runtime.onMessage.addListener` in `src/background.ts:2976` first probes the bus bridge, then a command
envelope router, then walks **47 sequential `message.type === "..."` comparisons** (`grep -c 'message.type === "'
src/background.ts` = 47) interleaved with feature-flag checks, spinner wrapping, and inline business logic
(`src/background.ts:2976-3100` and onward for ~1300 lines).

**WHERE:** `src/background.ts:2976-3845`; a second dispatch layer exists in `src/background/command-router.ts`, a third in
`src/content/content-command-router.ts` + `src/content/runtime-message-handler.ts` + `registerContentCommandHandlersOnce`
(`src/content-main.ts:7227-7248`) — routing is itself multi-layered.

**WHY it hurts:** no single place enumerates the API surface; handlers race for the same `sendResponse`; adding a route means
editing a 4300-line file. Return-true-for-async is hand-managed per branch — one mistake silently drops a reply.

**Correct design:** one declarative route table per realm; handler registration checked at build time; dispatch code free of
business logic.

### W-03 — Layering violations: every layer probes and commands every other layer

**WHAT (testable):** The rewrite's layers must have one-directional decision flow (facts up, directives down). In legacy:
the **popup directly interrogates content** (`messages.sendTabMessageToTab(currentTabId, { type: "getInspectionStatus" })`,
`src/popup.ts:5127-5130`) and **writes the background's tab state** based on that probe ("content wins" sync,
`src/popup.ts:5182-5202`); **content writes the shared config database directly** (`config.saveConfigs(configs)` at
`src/content-main.ts:5363`, `config.updateConfig(...)` at `src/content/core.ts:13037`); the **background also writes it**
(`src/background/ai-run-orchestrator.ts:616`); and the **brain simultaneously polls both popup and content** for the same
facts every second (`src/background/brain/heartbeat.ts:46-51`). Three readers and three writers for marking-enabled state;
three writers for the config map.

**WHERE:** as cited; corroborated by the architecture note in `.copilot/knowledge.md:303-307` ("Popup tab-runtime snapshots
must flow through the background command... do not reintroduce popup fallback reads") — a rule that had to be written
because the fallback reads existed.

**WHY it hurts:** the popup deciding for content and then syncing its conclusion into background state is the root cause of
the documented #5/#14 session-collapse family (`.copilot/knowledge.md:606`): a stale popup pass published
`isEnabled:false`, the brain dictated silent mode, content genuinely disabled, and the marking session was destroyed.

**Correct design:** content owns page truth and reports events; background owns session state; popup renders projections
and sends intents. No layer reads another layer's internals synchronously mid-decision.

### W-04 — Broadcast/pull duality: directives are pushed unconditionally, facts are both pushed and re-pulled

**WHAT (testable):** each fact/directive must be either edge-triggered (event) or level-triggered (state) — not both. In
legacy, the brain projects on **every** store mutation, including no-op folds of byte-identical facts
(`src/background/brain/state-store.ts:241-248` — `version += 1` and `scheduleProjection` on every `mutate`), broadcasts
`directive.content` deliberately without dedup (`src/background/brain/index.ts:542-566`), while the popup re-publishes its
full facts on every applied projection — an unbounded publish→fold→project→apply→publish loop (~200 projections/sec
observed) that had to be stopped with a per-tab broadcast dedup cache (`publishProjectedState`,
`src/background/brain/index.ts:567-620`).

**WHERE:** as cited; documented at `.copilot/knowledge.md:468-485`.

**WHY it hurts:** the loop remounted popup inputs mid-typing and spammed the content directive; the fix (dedup cache with a
reset on port reconnect) is a patch over a protocol that structurally permits feedback.

**Correct design:** projections published only on value change (dedup by construction, not by cache); facts published only
on transitions with provenance and sequence (the repo's own unimplemented "reflex-arc" signal doctrine,
`.copilot/knowledge.md:613`).

### W-05 — Heavy payloads historically routed through message hops; the fix is a TTL'd side-channel

**WHAT (testable):** payloads near Chrome messaging limits (renderedHtml, rawHtml, AI payloads, server config snapshots)
must never transit multi-hop runtime messages. Legacy learned this live (`.copilot/knowledge.md:515`) and added
`src/background/transfer-payload-store.ts` (storage-backed, `DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = 5 * 60_000`, line 5) —
but the store is a *keyed mailbox with expiry*, so a slow consumer (heavy page, long AI run) can find its payload expired,
and both old (inline payload) and new (payloadKey) paths coexist in the same functions (`src/popup/remote-config.ts:487-515`
handles both).

**WHY it hurts:** two payload paths double the failure matrix; TTL expiry converts slowness into data loss.

**Correct design:** one by-reference blob channel with explicit ownership/consume semantics and no wall-clock expiry while a
consumer is registered.

---

## B. Decision-making scattered across layers

### W-06 — `toggleEnabled` is derived from five competing sources with hand-ordered precedence latches

**WHAT (testable):** "is marking enabled" must have exactly one writer and one derivation. In legacy
`refreshUiInner` derives it from: (1) background tab state (`extensionEnabledForTab`, `src/popup.ts:5106-5112`); (2) the
popup's own optimistic cache `state.lastPopupEnabled` with a context-currency check (`src/popup.ts:5113-5123`); (3) a live
content probe (`getInspectionStatus`, `src/popup.ts:5127-5137`); (4) four "preserve" overrides
(`preserveEnabledDuringPreviewCloseRestore` / `...UnconfirmedRestore` / `...AiComputeRun` /
`shouldPreserveEnabledDuringReactivation`, `src/popup.ts:5148-5212`); (5) a final force-true for restore/compute windows
(`src/popup.ts:5214-5220`). When the probe disagrees with tab state, the popup *writes its conclusion back into background
state* (`src/popup.ts:5182-5202`), guarded only by `markingPassIsStale()` epoch checks.

**WHERE:** `src/popup.ts:5106-5226`; epoch machinery `src/popup.ts:629, 4467-4471`; doctrine at `.copilot/knowledge.md:609`.

**WHY it hurts:** this is the documented stale-cache desync: interleaved refresh passes published stale enabled=false and
collapsed live sessions (#5/#14, `.copilot/knowledge.md:606`); the "durable doctrine" fix is that *every* popup-initiated
transition must remember to bump an epoch and *every* publish site must remember to check it — an unenforceable discipline
(the `previewActive` publish missed it and caused the N2 CPU-peg storm, `.copilot/knowledge.md:546`).

**Correct design:** enabled-state transitions are events consumed by a single owner; UI reads a projection; no optimistic
local cache that can outlive its truth; no probe-and-write-back.

### W-07 — AI-run phase has two owners with a heuristic handover

**WHAT (testable):** run lifecycle must have one owner. Legacy: the brain owns the AI-run lifecycle, BUT the popup keeps a
mirror (`state.sessionAiRunPhase`, `src/popup/state.ts:36`) that it must publish as POST_AI or "the brain wedges at PRE_AI
post-exit (Save stuck requires_ai_run)" (`.copilot/knowledge.md:604`). The handover back to the popup is a **five-field
pattern match**: `shouldKeepBrainAiRunAuthority` returns authority only when the reported patch has exactly
`aiRunPhase===pre_ai && sessionHasPendingChanges===false && currentDraftDirty===false && previewActive===false &&
previewBlocked===false` (`src/background/brain/index.ts:395-412`); otherwise the popup's phase facts are silently stripped
(`omitPopupAiRunAuthorityFacts`, `:414-426`). Omitting the two preview fields from a discard patch made the discard
un-processable for seconds (`.copilot/knowledge.md:549`).

**WHY it hurts:** authority is negotiated per message by structural pattern matching on field combinations — any reporter
that doesn't know the magic tuple silently loses its fact.

**Correct design:** run lifecycle owned by one component; other layers send *events* (started/completed/discarded), never
phase-level snapshots that need arbitration.

### W-08 — Source arbitration by fact-stripping: content facts conditionally discarded while a popup is connected

**WHAT (testable):** two reporters must never publish the same fact with different meanings. Legacy: popup and content both
publish `isEnabled`/`silentModeActive`; because they *legitimately diverge post-AI*, the brain drops content's copy whenever
a popup port exists (`omitContentMarkingSessionFacts`, `src/background/brain/index.ts:634-646, 672-674`) — else the two
reports re-folded every heartbeat flip-flopped `mainUiHidden` and made Save/Discard intermittently unclickable (comment at
`src/background/brain/index.ts:648-658`).

**WHY it hurts:** whether a fact is believed depends on a connection-count side table (`popupPortCounts`); `brain.disposeTab`
deleting that table corrupts the arbitration (see W-25). The published `silentModeActive` fact ALSO had view-gating bugs —
popup reporting view-local state as page state made the merged fact oscillate (`.copilot/knowledge.md:496-503`).

**Correct design:** rename facts so they cannot collide (page-level vs session-level are different facts), or make one layer
the only reporter of each.

### W-09 — Popup presentation authority is a three-layer override sandwich

**WHAT (testable):** for each UI control there must be a single resolvable authority. Legacy popup button/curtain state is
composed of (1) the brain-projected dictation ("phase pointer", `src/popup/central-state-dictation.ts:70-86`), (2) the
marking-session machine's surface memories applied on top (`overrideDictatedMarkingButtons` /
`overrideDictatedPreviewVisibility`, referenced in the same comment), and (3) "the local derivation underneath covering
pass-through states until P5 retires it" — i.e., three generations of authority coexist in production. The preview sidebar
adds latches (`previewOpenIntent`, `previewSuppressReopen`, `previewItemsLatched`) that must be set on **all three** open
paths or the sidebar shows "No content detected" (`.copilot/knowledge.md:605`).

**WHY it hurts:** a stale lower layer resurfaces the moment an upper latch clears — precisely the N2 root cause: when popup
latches cleared, the stale brain-projected `previewActive:true` "flowed through, resurrecting the torn-down preview (brain
re-folds forever)" (`.copilot/knowledge.md:546`).

**Correct design:** one state machine per surface whose states carry the complete presentation; no fallback layer that can
disagree.

### W-10 — The same business predicate is duplicated across bundles and kept equal by comment/test-pinning

**WHAT (testable):** each rule must exist once. Legacy: `matchesAutoToggleableDefaultExcluded`
(`src/content/core.ts:2226`) is duplicated as `matchesAutoToggleableDefaultSelector` (`src/content-main.ts:4030` — comment
"kept in lockstep with core's..."), and a past divergence required deleting the same walks "from BOTH files"
(`.copilot/knowledge.md:540`). The page-motion freeze logic exists as a byte-identical *pair* whose equality is enforced by
a parity test that `eval`s one copy (`src/common/page-motion-freeze-bridge.ts:19-21`; `.copilot/knowledge.md:210-217`).

**WHY it hurts:** rule drift = marking output drift between the live overlay and the AI submission payload; the freeze pair
freezes refactoring forever (its own ts-suppression budget exists just for it, `.copilot/knowledge.md:219-221`).

**Correct design:** single sources compiled/injected into both contexts by the build, not sibling hand-copies.

### W-11 — Brain projects `SILENT` from level facts; popup-local transitions that forget to republish wedge the UI

**WHAT (testable):** after any local state transition, the projected UI phase must converge without requiring the
transitioning code to hand-publish a compensating fact set. Legacy: Discard cleared local draft state and bumped the epoch
but did not re-assert `isEnabled`, so the brain kept projecting `SESSION_PHASES.SILENT`
(`src/background/brain/deciders/session-phase-decider.ts:183-201`) and the marking UI vanished until toggled off/on; the fix
was to hand-publish a **nine-field** settled-facts patch at the new epoch, several of whose fields are documented as
"LOAD-BEARING" for the W-07 handover heuristic (`.copilot/knowledge.md:549`).

**WHY it hurts:** correctness depends on each transition knowing the full fact vocabulary the brain needs; the failure mode
(brain stays silent because *stale passes publish nothing*) is invisible in code review.

**Correct design:** transitions emit one event; the projection derives everything else.

### W-12 — Popup dirty/save gating logic exists in three places with a sanctioned "identical derivation" exception

**WHAT (testable):** derived UI notices must have a single computation site. Legacy: the page-save notices are computed
popup-locally by a shared pure function (`src/common/page-save-state.ts`) *by explicit exception* to brain authority — the
audit decision (`.copilot/knowledge.md:600`) documents that projecting them would add "report-up→project→reflect latency"
and flicker; meanwhile the same underlying facts (`sessionHasPendingChanges`, `currentDraftDirty`, reconciliation) also feed
`secondary-gates-decider.ts` (brain) and `deriveDictation` successors. The dirty flag itself moved between definitions
(fingerprint compare → deterministic click tracking) leaving decision-dead residue (`aiRunMarkingsFingerprint` "stored,
never compared", `.copilot/knowledge.md:549` PART 4 note).

**WHY it hurts:** three sites computing on the same facts with different latency creates windows where an enabled button has
a non-empty blocked-reason — the handler-level refusal then fires a mute or a wrong toast (the Round-3 mute catch-all bug,
`.copilot/knowledge.md:554`).

**Correct design:** the gate and its rendered reason derive from one function evaluated in one place.

---

## C. State management & persistence

### W-13 — Module-level mutable singletons with hundreds of fields in every realm

**WHAT (testable):** state must be structured, owned, and resettable; no realm should keep a flat mutable bag. Legacy:
popup `state` is one flat object with **~180 fields** (`src/popup/state.ts:8`; `src/types/popup-state.ts` has 180
top-level property lines) spanning view, network caches, fences, latches, timers, and machines. Content `core.state` is a
flat object mixing DOM refs, caches, timers, latches and business flags (**112 fields** in
`src/types/content-state.ts:29`; object at `src/content/core.ts:648-780`). `content-main.ts` adds ~30 more module-level
`let`s (e.g. `silentHighlightEditorActivationPromise/Queued/IdCounter`, `src/content-main.ts:587-589`).

**WHY it hurts:** any function can write any field at any time; the epoch/latch discipline (W-06) exists precisely because
nothing structurally prevents an interleaved async pass from writing a stale field. Reset paths must enumerate fields by
hand (missed fields = the sticky-fact class, W-15).

**Correct design:** per-domain stores with explicit transitions; navigation/session resets that reset whole stores, not
hand-picked fields.

### W-14 — Shared config is whole-map read-modify-write from three realms with per-context-only serialization

**WHAT (testable):** concurrent writers in different JS contexts must not be able to lose each other's writes. Legacy:
`getConfigs()` reads the ENTIRE `configs` map from IndexedDB, callers mutate it in their own memory, `saveConfigs()` writes
the whole map back (`src/common/config.ts:1329-1418`). The write queues are **module-level per JS context**
(`configWriteQueueByBaseUrl`, `configPersistenceQueue`, `src/common/config.ts:35-36`) — popup, background, and content each
have their own copies, and all three realms write (`src/popup.ts:8411`; `src/content-main.ts:5363`;
`src/content/core.ts:13037`; `src/background/ai-run-orchestrator.ts:616`; `src/background/page-data-lifecycle.ts`). Worse,
`getConfigs()` **writes back during reads** whenever normalization changed anything (`src/common/config.ts:1377-1380`).

**WHY it hurts:** read-modify-write races across contexts silently drop pages/selectors — a structural enabler of the
observed "selectors intermittently never reach config.selectors" and half-snapshot classes (see D). A popup pass that read
before a content draft write and saves after it erases the draft.

**Correct design:** one writer realm (background) with keyed sub-document updates (per-baseUrl, per-page), or a real
transactional store; reads never write.

### W-15 — Sticky level-snapshot facts re-served by a 1 s heartbeat: forget one republish and the system fights itself forever

**WHAT (testable):** a stale cached fact must age out or be provably unreachable. Legacy: popup and content each accumulate
every published patch into a module-level merged snapshot (`lastPopupSessionFacts`,
`src/popup/layers/popup-bus-client.ts:66,184`; `lastContentSessionFacts`,
`src/content/layers/content-bus-client.ts:47,233`) which the brain heartbeat re-pulls and re-folds every second
(`src/background/brain/heartbeat.ts:20,46-51`). Documented rule: "Any state teardown that resets a fact's local source
WITHOUT republishing the fact leaves a stale sticky value that the heartbeat re-folds forever"
(`.copilot/knowledge.md:603`) — the #5 oscillation came from exactly one such reset (`clearAiPreviewState()` leaving sticky
`previewActive:true`).

**WHY it hurts:** the failure is a *convention violation*, not a type error; each new teardown path is a new landmine.

**Correct design:** events with once-only consumption; if snapshots are kept, derive them from the live source at pull time
rather than from an accumulate-forever merge.

### W-16 — Five coexisting per-tab state stores in the background with divergent lifetimes and disposal paths

**WHAT (testable):** per-tab state must have one registry with one disposal path. Legacy background keeps:
(1) `tab-session-store.ts` (storage.session, `TAB_STATE_PREFIX`, per-tab write queues, scopes incl. `"initial"`);
(2) `background-tab-state.ts` (four in-memory maps: lifecycle, spinner queue, world-trace, compute locks — line 1-5);
(3) the brain `state-store.ts` (in-memory map + `chrome.storage.session["brain:state-store"]` mirror,
`state-store-persistence.ts:5`); (4) `popup-state-broker.ts` lifecycle state; (5) the signal log ring
(`brain/signal-log.ts` + session-storage persistence). Disposal is split between `disposeTabState`
(`background-tab-state.ts:12-20`), `brain.disposeTab` (`brain/index.ts:1007-1017`), `clearTrackedTabSessionState`
(`background.ts:4058`), and navigation-scoped partial resets (`background.ts:3878-3893`).

**WHY it hurts:** the MV3 stuck-spinner bug came directly from one datum (spinner selection) living in tier 3 (persisted)
while its lifecycle counterpart (queue REMOVE) lived in tier 2 (SW memory) — an idle suspension mid-operation "lost the
REMOVE forever and the popup projected the stuck curtain indefinitely" (`src/background/brain/spinner-authority.ts:22-32`;
`.copilot/knowledge.md:547` fix 2). Ghost tabs projected forever until `pruneTabs` was added (`brain/index.ts:1002-1006`
comment: "three ghosts rejecting every heartbeat, indefinitely").

**Correct design:** a single per-tab session record with one lifetime, persisted atomically, disposed in one place; anything
that must survive SW restart persisted together with the state that interprets it.

### W-17 — `refreshUiInner`: a ~1,900-line non-serialized async pipeline is the popup's main loop

**WHAT (testable):** UI refresh must be either serialized or side-effect-free. Legacy `refreshUiInner`
(`src/popup.ts:4455-6369`, ~1,914 lines) performs network loads, content probes, storage writes, fact publishes, and
tab-state writes; `refreshUi` deliberately does not serialize passes, and passes take 4–8 s on heavy pages
(`.copilot/knowledge.md:606`). Interleaved passes publishing out-of-order facts required: per-pass `seq` stamped at compute
time with documented "two non-negotiable traps" (`.copilot/knowledge.md:438-451`), the marking-session epoch doctrine
(`.copilot/knowledge.md:609`), raise-only latches (`:609-610`), and brain-side seq drops
(`src/background/brain/index.ts:729-741`).

**WHY it hurts:** four separate guard systems exist only to protect the system from its own refresh loop; each live-QA round
found another unguarded publish (previewActive → N2 CPU peg, `.copilot/knowledge.md:546`).

**Correct design:** event-driven targeted updates (the repo's own P5 finding: removing refresh cadence "removed the root
cause... not just guarded", `.copilot/knowledge.md:619-620`); any full refresh must be pure (no writes, no publishes).

### W-18 — Brain session-storage persistence resurrects stale state across SW restarts and navigations

**WHAT (testable):** persisted coordination state must be validated against live reality on rehydrate. Legacy: the brain
persists per-tab state to `chrome.storage.session["brain:state-store"]` and rehydrates it wholesale
(`src/background/brain/index.ts:993-1000`; `state-store-persistence.ts`); a stale preview-open in that key "survives SW
reload/navigation and is self-sustained by the popup republish loop (only content publishing previewActive:false or Discard
clears it)" (`.copilot/knowledge.md:608`). Live QA had to clear the key by hand for a fresh brain.

**WHY it hurts:** persistence multiplied by the sticky-fact loop (W-15) makes wedges *durable*.

**Correct design:** rehydrated state marked provisional until re-confirmed by live layer reports; time-bounded validity.

### W-19 — Emulation, tab, and settings state scattered across storage areas with ad-hoc reconcilers

**WHAT (testable):** each datum has exactly one home. Legacy: device emulation state in storage.session with a
`reconcileDeviceEmulationState` pass every popup refresh (`src/popup.ts:5228-5236`); tab enabled/baseUrl in
storage.session tab records with an extra `"initial"` scope for sticky per-tab session data (70 s countdowns, desktop
preview, cross-property cooldowns — `.copilot/knowledge.md:586-597`); page-type taxonomy in storage.local with a
default fallback that "MUST stay in sync with the backend" by hand (`.copilot/knowledge.md:530`); brain state in
storage.session; configs in IDB. Rules about which module may touch which area are enforced only by a test
(`tests/storage-access-boundary.test.ts`, `.copilot/knowledge.md:310-314`).

**WHY it hurts:** every consumer needs bespoke reconciliation code; the popup runs several reconcilers per refresh pass.

---

## D. Save/sync data integrity

### W-20 — /save is a full-snapshot replace assembled behind a coverage filter that can silently produce an empty page map (DATA LOSS — observed in production)

**WHAT (testable):** a save must never delete every stored page unless the user's state genuinely has none; equivalently:
`payload.pageMarkings` empty while (local pages > 0 or backend pages > 0) must refuse to send. Legacy violates this:
`syncBaseConfigToServer` builds the payload behind `filterPageMarking`; when `propertyPageTypesResult.ok`, the filter is
**replaced** by one keyed solely on `activePageMarkingKeys` derived from the backend-saved marking cache
(`src/popup/remote-config.ts:420-445`); an empty/stale cache yields an empty key set, `includeCurrentPageMarking` defaults
false, so `createConfigSyncPayload` emits `pageMarkings: {}` (`src/common/config.ts:1218-1256`) and the server replaces its
map with nothing. **Observed live on production: a 200 /save wiped a property's markings (1 page, 268 xpaths → 0)
irrecoverably** — selectors/renderMode survived, making it look like a successful save.

**WHERE:** `src/popup/remote-config.ts:420-445`; payload assembly `src/common/config.ts:1218-1270`; the guard fix exists
only as dangling commit `e11059b1` (viewable from the rewrite checkout) — **not on production main**.

**WHY it hurts:** silent, irrecoverable customer-data loss on a green status code.

**Correct design:** delta or keyed-page writes; if full-snapshot is kept, a client-side destructive-write guard (the
e11059b1 predicates) plus a server-side same-property page-count sanity check.

### W-21 — The backend-saved page cache that gates the save filter is itself best-effort and clearable

**WHAT (testable):** any datum used to decide what data to *keep* must be confirmed-fresh at decision time. The
`backendSavedPageMarkings` cache is written from confirmed loads/saves (`src/common/config.ts:290-372`) but the save path
consumes it without freshness verification (`src/popup/remote-config.ts:401-412`); the knowledge base itself mandates
"Empty or partial /load//save responses must not replace local saved page snapshots or clear the backend-saved cache"
(`.copilot/knowledge.md:528`) — a rule that exists because violations occurred.

**Correct design:** decisions about deletion candidates require a fresh authoritative read, not a cache.

### W-22 — AI-computed selectors are persisted only by the popup, after the fact, on the happy path (observed intermittent loss)

**WHAT (testable):** a completed AI run's selector set must be durably persisted by the component that owns the run,
regardless of popup lifetime. Legacy: the background orchestrator prepares/polls the job
(`src/background/ai-run-orchestrator.ts:712+`) but the ONLY write of `config.selectors` happens in the popup after the
long-lived `requestTabRunAi` await resolves (`applyComputedSelectorSet`, `src/popup.ts:8396-8419`, called at
`src/popup.ts:6460` and `:8731`). If the popup closes/reloads mid-run, persistence depends on the resume path
(`maybeResumePersistedAiRun`, `src/popup.ts:6370-6470`), which (a) requires a popup to be reopened on the same tab+siteId,
(b) is deduped per popup session by `aiRunResumeCheckKey` (`:6381-6385`), and (c) **deletes the persisted run record on any
status hiccup** (`clearPersistedAiRunRecord()` on catch/notFound/error, `:6413-6433`) — discarding a possibly completed
result. This matches the live production finding: computed selectors intermittently never reach `config.selectors`, so a
later save persists stale selectors.

**WHY it hurts:** paid AI computation is dropped; the user sees a completed run whose results evaporate; a subsequent save
writes the OLD selectors with a new `selectorsUpdatedAt`.

**Correct design:** the background orchestrator persists results transactionally on completion; the popup only renders.

### W-23 — Save retry loop retries without checking retryability in its generic branch; unknown statuses default to retryable

**WHAT (testable):** 4xx (non-408/425/429) responses must not be retried. Legacy: in `syncBaseConfigToServer`, the
`!response || response.ok !== true` branch retries up to 5 attempts unconditionally (`src/popup/remote-config.ts:470-477`);
only the `response.status === "error"` branch consults `isRetryableHttpStatus` (`:478-485`), and that predicate returns
**true** for unknown/zero statuses (`src/popup.ts:4038-4043`). The thrown-error catch also retries anything
(`:538-545`).

**WHY it hurts:** hammers a failing backend with full config snapshots (multi-MB with renderedHtml), masks real 4xx causes,
and multiplies the destructive-save window (each attempt rebuilds the filter, W-20).

### W-24 — Merge semantics are ad-hoc: JSON.stringify equality, timestamp ties, and a pageMarkings:{} merge on missing payloadKey

**WHAT (testable):** local/remote merge must be a specified, tested function of (local, remote, provenance). Legacy:
`mergePageMarkingsByTimestamp` decides ties via `JSON.stringify(clone) !== JSON.stringify(clone)` deep-compare and a
`preferIncomingOnTimestampTie` flag (`src/common/config.ts:1300-1320`); when a save succeeded but returned no payloadKey the
client merges `{...payload, pageMarkings: {}}` with `preferConfirmedPageMarkings` (`src/popup/remote-config.ts:488-499`);
`getConfigs` runs yet another merge when duplicate-normalized keys collide (`src/common/config.ts:1340-1370`). Three merge
codepaths, one contract.

**WHY it hurts:** each path has its own tie/precedence behavior; the "newer remote replaced local" alert
(`windowRef.alert`, `:531`) shows users see the fallout.

### W-25 — A destructive-data fix was lost by branch surgery (release-integrity weakness)

**WHAT (testable):** production-critical data-safety fixes must be traceable from a protected branch; a reset must not be
able to drop them silently. The destructive-save guard (W-20) was committed, then `main` was reset and the commit left
dangling (`e11059b1` — verified reachable only via `git show`, not any branch). Production today has no guard.

**WHY it hurts:** the highest-severity known data-loss bug is *fixed in no shipping artifact*.

---

## E. Lifecycle fragility

### W-26 — One-shot latches consumed on ATTEMPT, not on success (the consumed reveal-attempt bug)

**WHAT (testable):** for each once-per-visit ritual, a failed attempt must leave the ritual runnable. Legacy:
`consumePageVisitRevealFreezeAttempt` sets `pageVisitRevealFreezeAttemptKey = revealKey` and returns true BEFORE the
reveal/freeze runs (`src/content-main.ts:2180-2189`); every failure after that point (directive flap, navigation check,
throw inside the walk) leaves the key consumed, so `shouldRunSilentHighlightEditorActivation` retriggers but the once-guard
refuses forever — the page never reveals/freezes for that visit. (The rewrite's commit `ef29c3fc` "let the ritual survive an
early attempt" is the counter-fix.) The success-marker (`markSilentHighlightEditorRevealPrepared`, `:2191-2201`) writes the
same key, conflating attempted and completed.

**WHY it hurts:** silent no-reveal pages: lazy content never loaded, silent highlights missing, save-time snapshots capture
un-revealed DOM.

**Correct design:** latch on completion; failures reset the latch with bounded retry.

### W-27 — `brain.disposeTab` is documented known-unsafe for navigation reuse; the safe narrow reset was never built

**WHAT (testable):** there must be a navigation-scoped session reset that clears per-page state while preserving
connection bookkeeping. Legacy has only tab-REMOVAL disposal: `brain.disposeTab` deletes `popupPortCounts`
(`src/background/brain/index.ts:1007-1017`), which "would corrupt foldSessionFacts' `source==='content' &&
popupPortCounts.has(tabId)` omission while the popup stays connected across the navigation"; the needed
`store.dispose(tabId)+projection-cache reset preserving popupPortCounts` was assessed "architecture-sensitive, deferred"
(`.copilot/knowledge.md:552`). Navigation instead does a partial ad-hoc reset (`disposeTabState` + initial.active=false +
`recordEditorActivation(false)`, `src/background.ts:3878-3893`) that touches stores (1),(2) of W-16 but not the brain's
session facts.

**WHY it hurts:** cross-property navigation leaks session state (BUG 3.2/3.3, `.copilot/knowledge.md:552`); the brain can
carry the previous page's folded facts into the new page.

### W-28 — Content activation depended on popup bootstrap; consent hiding was coupled to silent-highlight collection

**WHAT (testable):** consent hiding must run on every configured property page at load with no popup ever opened; the
reveal ritual must be triggered by page lifecycle, not popup lifecycle. Legacy violated both until Round 3:
`tabs.onUpdated(complete)` only activated content when `initial.active` was set, and initial.active was set ONLY by popup
bootstrap (`background.ts` ~1154, documented `.copilot/knowledge.md:553`); consent hiding lived INSIDE
`collectSilentHighlightSources` so non-candidate pages never hid consent (same bullet, FIX 2). The patched flow still leaves
"the brain needs a fold trigger" semantics — directives only flow when something reports facts.

**WHY it hurts:** users clicked consent buttons that mutated the DOM before markings were computed (BUGs 3.1/4/5); ordering
of consent→reveal→silent depended on which realm woke first.

**Correct design:** page-load pipeline owned by content with explicit stages, popup-independent.

### W-29 — MV3 SW restarts are survived by hacks: refcounted keepalive, expiry-grace projections, alarm-based monitors

**WHAT (testable):** every long-lived operation must either persist resumable state or be safely abortable; nothing may
require the SW to stay alive. Legacy: a refcounted 20 s ping keepalive guards AI runs and property-lock sockets
(`src/background/sw-keepalive.ts:1-27`); operations that forgot to hold it wedged spinners (fix: hold for the whole
tab-operation, `.copilot/knowledge.md:547`); a 30 s expiry grace in `projectSurface` fail-opens stuck curtains
(`src/background/brain/spinner-authority.ts:32-49`); `replyWithKeepAlive` wraps each message (`src/background.ts:2955-2974`).
The persistent-profile SW cache additionally serves stale worker code across relaunches (`.copilot/knowledge.md:504-510`).

**WHY it hurts:** keepalive defeats MV3's model and still cannot guarantee survival (browser can kill anyway); every gap
became a live incident (stuck "With JavaScript" curtain).

**Correct design:** operation state persisted at every await-boundary; projections derived from persisted state; no
keepalive dependency for correctness.

### W-30 — Render-mode inspection is a multi-reload cross-realm saga with no durable saga record (observed un-bootstrappable property)

**WHAT (testable):** an interrupted render-mode inspection must be resumable or cleanly restartable, and a property with a
deleted config record must be re-bootstrappable. Legacy: the flow spans popup buttons alternated by a live tab-JS flag
("the same mode cannot be triggered twice": without-JS enabled only while JS runs, with-JS only while no-JS held —
`src/popup.ts:5966-5973`), two tab reloads, a debugger HTML capture (`src/background.ts:911`), no-JS inactivity watchdogs
(`src/background.ts:779-856`), and confirmation = a timestamp write in the popup (`handleRenderModeSet`,
`src/popup.ts:6969-7000`); `renderModeSetDisabled` additionally requires `state.currentConfig` (`src/popup.ts:5974-5979`).
State lives in: tab JS setting, tab state, popup fields (`renderModeTabJsDisabled`), brain render-mode decider — nowhere is
there a saga record that survives a popup close between the two legs. The known live finding — a property whose backend
config record was deleted cannot be re-bootstrapped when only one of the two inspections completes — is the direct
consequence: the half-completed leg leaves the tab held in a mode where only the *other* button is enabled and the config
record needed to enable Set does not exist.

**Correct design:** an explicit background-owned inspection saga (id, leg, tab mode, capture results) that any popup can
resume, cancel, or restart; bootstrap (config-record creation) decoupled from inspection completion.

### W-31 — Navigation teardown is distributed across four uncoordinated handlers

**WHAT (testable):** exactly one component decides what a top-level navigation resets. Legacy: `webNavigation.onCommitted`
triggers both `pageDataLifecycle.handleTopLevelNavigationCommitted` and `disableExtensionOnTopLevelNavigation`
(`src/background.ts:3913-3928`); content separately watches SPA URL changes (`ensureNavigationNotifierInstalled`,
`.copilot/knowledge.md:464-466`) and releases the freeze on its own (`resumeAllPageMotion` wired to history events,
`.copilot/knowledge.md:585`); the popup resets its AI-run mirror only on URL change "beyond the hash"
(`.copilot/knowledge.md:611`) and keeps stale preview state on same-URL refresh (deferred bug, `:552`); the compute-lock
early-return skips the marking disable on same-URL navs (`src/background.ts:3895-3897`).

**WHY it hurts:** each realm has a different definition of "navigation happened," producing the cross-property leak matrix
of LIVE-QA Round 3.

### W-32 — Orphaned content-script instances and extension-context invalidation are handled by convention

**WHAT (testable):** after extension reload, exactly one content instance may answer per tab, and stale instances must
self-terminate. Legacy: reload + re-inject leaves orphaned instances that "ALSO answer `chrome.tabs.sendMessage`" giving
"NONDETERMINISTIC contradictory replies" (`.copilot/knowledge.md:608`); `Extension context invalidated` handling is a
documented convention for property-lock loops (`.copilot/knowledge.md:287-289`) rather than a global lifecycle guard.

**Correct design:** instance generation tokens — background addresses only the current generation; old generations
self-disable on first invalidation signal.

---

## F. God files, coupling, module structure

### W-33 — Four god files hold 57 % of the source; the largest is edit-frozen

**WHAT (testable):** no runtime module so large that its own maintainers forbid editing it. Legacy:
`src/content/core.ts` 14,312 lines, `src/popup.ts` 10,003, `src/content-main.ts` 7,557, `src/background.ts` 4,301 — 36,173
of 63,461 total; hard rule "never edit `src/content/core.ts` or locked marking... logic without a new approved plan"
(`.copilot/knowledge.md:318-320`). `refreshUiInner` alone is ~1,914 lines (`src/popup.ts:4455`).

**WHY it hurts:** the freeze rule is an explicit admission the file is beyond safe modification; every marking fix in the
debug rounds had to be threaded through it anyway (S1-S3, N1-N4, CP7a/b...).

### W-34 — Coupling is worked around with giant hand-rolled deps objects and a type-erased service locator

**WHAT (testable):** module boundaries must be typed interfaces, not 40-field function grab-bags. Legacy:
`RemoteConfigDeps` has ~40 members mixing text tables, config functions, UI toasts and network helpers
(`src/popup/remote-config.ts:62-106`); `createAiRunOrchestrator` takes a comparable options bag
(`src/background/ai-run-orchestrator.ts:220`); the content service registry declares **every factory as
`() => object`** and memoizes 29 type-erased singletons (`src/content/content-main-service-registry.ts:1-60`).

**WHY it hurts:** type safety is discarded exactly at module seams; call-graph analysis and mocking must reconstruct
types by hand; a signature change compiles even when a consumer breaks.

### W-35 — Misplaced and split responsibilities across directories

**WHAT (testable):** module location predicts its runtime realm and single responsibility. Legacy counter-examples:
`src/common/property-lock-background.ts` is 1,360 lines of background-only logic living in `common/` (imported solely by
`src/background.ts`); spinner behavior is split across five modules in three layers (`src/background.ts:2733-2845`,
`src/background/spinner-operations.ts`, `src/background/brain/spinner-authority.ts`,
`src/background/brain/deciders/spinner-state-decider.ts`, `src/common/spinner-contract.ts`); popup render-mode logic is
split between `src/popup/render-mode.ts`, `src/popup/render-mode-inspection.ts`, `src/popup/layers/modes/render-mode-inspection.ts`
and inline popup.ts handlers.

### W-36 — A partially executed architecture migration is frozen in production (reflex-arc half-state)

**WHAT (testable):** one coordination model in shipping code. Legacy ships: the pre-brain raw-message decision paths, the
brain fact-fold/dictation model (P0-P6), AND the beginnings of the signal-frame model (`src/background/brain/signal-log.ts`,
`session-signal-edges.ts`) — while the knowledge base states the target ("signals... never reconstructed downstream from
re-served level snapshots") is NOT implemented: "the signal layer doesn't exist yet" / "the brain is STILL authoritative"
(`.copilot/knowledge.md:613`, `:549` ARCHITECTURE DIRECTION). Popup layer files exist but are "render-only today"
(`src/popup/layers/*`, `.copilot/knowledge.md:549`).

**WHY it hurts:** every bug fix must decide which of three coordination idioms to extend; deciders read facts produced under
different models' assumptions (the load-bearing-fields trap, W-07/W-11).

### W-37 — The byte-locked eval'd module pair blocks tooling and refactoring

**WHAT (testable):** no module whose contents are pinned byte-identical to another and eval'd in tests. Legacy:
`page-motion-freeze-control.ts` / `page-motion-freeze-bridge.ts` must stay byte-identical "modulo stripped @ts- comments,"
the bridge is `eval`'d as plain JS in tests, typing must live before a marker line, and the pair carries a dedicated
ts-suppression budget and lint override (`src/common/page-motion-freeze-bridge.ts:19-21`; `.copilot/knowledge.md:210-221`,
`:257-264`).

---

## G. Error handling & observability

### W-38 — Errors are systematically swallowed into `{ ok:false }` and generic toasts, masking backend bodies

**WHAT (testable):** any user-facing failure surface must carry the underlying cause (status + backend body or error id),
and no error may be dropped without a log. Legacy: `src/background.ts` alone has **73** `.catch(() =>` handlers, nearly all
returning bare `{ ok: false }` or a fixed string (e.g. `catch(() => sendResponse({ ok:false, error: "Unable to clear
cache" }))`, `src/background.ts:3068-3070`); `replyWithKeepAlive` maps ANY task failure to the fallback response with no
logging (`src/background.ts:2955-2974`); `syncBaseConfigToServer` catches all errors and returns `{ ok:false }` with no
reason (`src/popup/remote-config.ts:538-545`); the orchestrator's payload preparation ends in `catch { return { ok: false }; }`
(`src/background/ai-run-orchestrator.ts:707-709`); the user then sees the generic "Unable to save session"
(`src/common/text.ts:438` via `src/popup/page-reconciliation.ts:186-191`).

**WHY it hurts:** the production data-wipe (W-20) presented as a *successful* save; failed saves present with no
distinguishing detail; live diagnosis required CDP fetch hooks because the extension's own surfaces say nothing.

**Correct design:** typed error results with cause chains end-to-end; backend response bodies preserved into the toast/log;
an error ledger queryable from the popup.

### W-39 — Fail-open timers layered over fail-open timers as the standard recovery idiom

**WHAT (testable):** each blocking surface has exactly one owner and one deterministic settle path. Legacy accumulates:
spinner expiry grace 30 s (`spinner-authority.ts:32`), popup-busy fail-open timer (`core.state.popupBusyFailOpenTimer`,
`src/content/core.ts:676`), the one-shot bounded `inspectionSettled` fail-open deadline (`.copilot/knowledge.md:459-461`),
`navigationInspectionCurtainClearBefore` high-water clearing (`brain/index.ts:107-140`), and the AI-run event dedupe window
(250 ms, `signal-log.ts:13`).

**WHY it hurts:** wedges are converted into N-second mystery stalls instead of visible failures; when two timers disagree the
longer one wins the user's time.

### W-40 — Muted refusals: guarded actions silently no-op on gate races

**WHAT (testable):** a user click on an enabled control must either act or explain. Legacy examples (fixed piecemeal only
after live rounds): `handlePreviewLatest`/`handleMarkingPreview` silently returned on re-check refusals
(`.copilot/knowledge.md:554`); exclude-clicks on already-excluded elements resolve to no target with zero feedback
(`.copilot/knowledge.md:106-115`); disabled-toggle clicks are "silent no-op" (`.copilot/knowledge.md:607`).

---

## H. Structural performance pathologies

### W-41 — Full-document scans wired to timers and self-feeding MutationObservers

**WHAT (testable):** periodic/observer-triggered maintenance must be incremental; no code path may re-scan
`document.querySelectorAll("*")` on a timer or in response to its own writes. Legacy: `refreshPageMotionPause()` did a full
document scan + per-element `getComputedStyle` on a 250 ms timer AND on every MutationObserver batch, while re-writing
inline styles that fed the same observer — a self-sustaining loop measured at ~35 % self-time, CPU pegged 97.6 % for 2+
hours with no input (`.copilot/knowledge.md:548`); the observer also rescheduled via rAF up to ~60×/s. Fixed by
"lock once, maintain cheaply" (commit b1b42de + 688a818) but the architecture that allowed it (observer→full-rescan
coupling inside a 14 k-line file) is unchanged; the residual re-asserts ~800 locks every 250 ms (same bullet, "KNOWN
residual COST").

### W-42 — Directive flaps translate 1 Hz state oscillation into full-page O(document) renders

**WHAT (testable):** a repeated identical directive must be a no-op; an oscillating boolean upstream must not drive full
re-renders downstream. Legacy: the stuck `previewActive` oscillation (~1/s) flapped the brain's `silentHighlightActive`
directive, and each edge re-ran `refreshSilentHighlightings` → full O(document) render (~160 ms each, forever)
(`.copilot/knowledge.md:546` N2); the guard added is a special-case skip in the content listener
(`src/content-main.ts:7326-7346`). Level-triggered directives + sticky upstream facts make this class recurrent.

### W-43 — Steady-state chatter: per-second heartbeat pulls, per-mutation projections, 250 ms maintenance timers

**WHAT (testable):** an idle configured page with an open popup must approach zero messages/renders. Legacy idles at: 1 Hz
brain STATE_GET to popup AND content per tab (`heartbeat.ts:20,46-51`), projection scheduling on every fold
(`state-store.ts:241-248`), the 250 ms motion-pause maintenance drain, plus popup countdown/display timers. Pre-P5, heavy
pages ran ~60 full refreshes/min (`.copilot/knowledge.md:619`); post-P5 the poll infrastructure remains.

---

## I. Testability

### W-44 — A large share of the test suite pins source text, not behavior

**WHAT (testable):** tests must fail only when behavior changes. Legacy: **77 of ~202 test files `readFileSync` production
source** and assert regexes/import shapes against it (e.g. `tests/navigation-notifier.test.ts:10` reads
`src/content/core.ts` and matches call-shape regexes like `refreshPageMotionPause(true)` —
`.copilot/knowledge.md:548` documents updating "source-contract regexes" as part of a bug fix). Guard tests exist for
storage boundaries, manifest permissions, import specifier shapes, and even "no setInterval" rules with countdown
exemptions (`.copilot/knowledge.md:467`).

**WHY it hurts:** refactoring identical behavior breaks dozens of tests; conversely the tests cannot catch behavioral
regressions in the pinned code (they match text, not effects). The volume of source-pins is itself a measure of how
un-unit-testable the god files are.

### W-45 — Core behavior is validated only by elaborate live-browser harnesses with documented flakiness

**WHAT (testable):** the critical flows (enable→mark→run AI→preview→exit→save) must be executable in an automated
integration harness deterministically. Legacy requires: trusted CDP input events (untrusted clicks don't exercise the real
path), popup kept in its own focused window (throttling wedges CDP), dialog-safe raw-CDP tooling (Playwright auto-dismisses
`confirm()`), per-frame screencast sampling because "250ms/2s samplers produced FALSE PASSES", SW-cache clears between
builds, and nav through a beforeunload-auto-accepting helper (`.copilot/knowledge.md:106-131, 549, 607, 612, 624`). The
knowledge base is substantially a manual of harness pitfalls.

**WHY it hurts:** verification cost per change is enormous; multiple fixes shipped with "LIVE VERIFICATION PENDING"
(`.copilot/knowledge.md:546`).

### W-46 — Decision logic is embedded in realm entrypoints, so units cannot be isolated

**WHAT (testable):** every decision (gate, filter, merge, phase transition) is a pure function importable without a DOM,
chrome API, or realm bootstrap. Legacy: the save filter is a closure inside `syncBaseConfigToServer`
(`src/popup/remote-config.ts:420-445` — the dangling fix e11059b1 had to *extract* `config-sync-guard.ts` to test it);
enabled-state derivation is inline in refreshUiInner (W-06); marking-target rules live inside core.ts with per-pass cache
context requirements. The brain deciders are the one well-factored counter-example (`src/background/brain/deciders/*` are
pure) — proving the codebase knows the pattern but applies it to <10 % of decisions.

---

## J. Environment / emulation fidelity

### W-47 — Mobile emulation overrides viewport metrics only — no user-agent/client-hints identity

**WHAT (testable):** with emulation on, a UA-sniffing page must serve its mobile experience (server-side and JS-side).
Legacy `src/common/emulation.ts` drives only `Emulation.setDeviceMetricsOverride` via `chrome.debugger`
(`src/common/emulation.ts:330-376`); there is no `Emulation.setUserAgentOverride`/UA-CH spoof anywhere (`grep userAgent`
returns nothing functional). Pages branching on UA serve desktop markup into a mobile viewport, so the "editor-mobile-only"
contract (`.copilot/knowledge.md:586`) captures a DOM that is neither real mobile nor real desktop, and saved
markings/snapshots inherit that hybrid. (The rewrite's commit `489649d8` "spoof a mobile identity, not just a mobile
viewport" addresses exactly this.)

**Also:** debugger-based emulation shows Chrome's "is debugging this browser" infobar for the whole session, and a DevTools
attach/detach silently clears the desktop-preview state (`.copilot/knowledge.md:587`).

### W-48 — Blocking `window.confirm`/`alert` inside long async flows

**WHAT (testable):** no native modal dialogs in the popup's async pipelines. Legacy uses `window.confirm` for discard,
transfer, cache-clear and unregister flows and `window.alert` for merge notices
(`src/popup.ts:7233, 7242, 7492, 7625, 7932, 7982`, `src/popup/remote-config.ts:531`, `src/popup.ts:5731`). Dialogs freeze
the popup event loop mid-pipeline (facts stop publishing, heartbeat pulls hit a frozen realm), reorder around slow
roundtrips (the #5 fix moved `confirm()` BEFORE the roundtrip, `.copilot/knowledge.md:546` item #5), and break automation
(auto-dismiss pitfalls, `:549`).

### W-49 — Consent handling is a hand-curated selector allowlist with live-smoke-only validation

**WHAT (testable):** consent-hiding changes must be validated against a fixture corpus, and the matcher must be shared with
the submission pipeline. Legacy `REMOVABLE_ELEMENT_SELECTORS` is a precision allowlist whose safe evolution depends on
re-running live AI-submission smokes on three named properties (`.copilot/knowledge.md:582`), and hiding runs both in core
marking (mutation-observer re-runs, un-debounced — `.copilot/knowledge.md:581`) and in the inspection/save paths.

---

## K. Rewrite acceptance checklist (condensed)

Each row is the testable property the rewrite must demonstrably satisfy (legacy fails every one).

| # | Property | Legacy failure evidence |
|---|----------|------------------------|
| 1 | One transport per direction; enumerable route table | W-01/W-02: 9 mechanisms; 88 raw type strings; 47-branch if-chain |
| 2 | Facts flow up, directives flow down; no cross-layer probes or write-backs | W-03: popup probes content + writes tab state (popup.ts:5127-5202) |
| 3 | Every fact/directive is either an event (once-consumed) or deduped-by-construction state | W-04/W-15: sticky snapshots re-folded at 1 Hz; feedback loop patched by cache |
| 4 | One owner per decision: enabled-state, AI-run phase, curtain, preview visibility | W-06..W-11: 5-source toggle, 5-field authority handover, 3-layer override sandwich |
| 5 | Every business predicate exists once (no lockstep twins, no byte-locked pairs) | W-10/W-37 |
| 6 | Config writes are keyed and single-writer; reads never write; concurrent realms cannot lose updates | W-14 |
| 7 | A save can never delete all pages while any exist locally or remotely; save payload provenance is auditable | W-20/W-21 (production data wipe; guard exists only as dangling e11059b1) |
| 8 | AI-run results are persisted by the run's owner, popup-independent, before any UI step | W-22 |
| 9 | No retry on non-retryable statuses anywhere; unknown ≠ retryable | W-23 |
| 10 | One merge function with specified tie semantics | W-24 |
| 11 | Once-per-visit rituals latch on success, not attempt; failures retry bounded | W-26 |
| 12 | Navigation reset is one operation resetting all per-page state and nothing else | W-27/W-31 |
| 13 | Consent hiding + page pipeline run popup-independent, in contract order | W-28 |
| 14 | Correctness survives SW suspension at any await point without keepalive | W-29/W-16 |
| 15 | Render-mode inspection is a resumable saga; deleted-record properties re-bootstrap | W-30 |
| 16 | Stale content-script generations self-terminate; single responder per tab | W-32 |
| 17 | No module > ~1,500 lines; no function > ~200; no edit-frozen files | W-33 |
| 18 | Typed module seams (no `object` service locators, no 40-field deps bags) | W-34 |
| 19 | One coordination model, fully migrated | W-36 |
| 20 | Errors carry causes end-to-end; no generic mask toasts; refusals always explain | W-38/W-40 |
| 21 | Blocking surfaces have one owner + deterministic settle; no stacked fail-open timers | W-39 |
| 22 | No full-document scans on timers/observer echoes; identical directives are no-ops; idle ≈ zero traffic | W-41..W-43 |
| 23 | Tests assert behavior; core flows automatable deterministically; decisions are pure functions | W-44..W-46 |
| 24 | Mobile emulation includes identity (UA/UA-CH), not just metrics | W-47 |
| 25 | No native blocking dialogs in async flows | W-48 |

---

## Appendix: primary evidence index

- Giant-file line counts: `wc -l` — core.ts 14,312; popup.ts 10,003; content-main.ts 7,557; background.ts 4,301 (of 63,461 total).
- `refreshUiInner` boundaries: `src/popup.ts:4455` (to ~6369); non-serialized: `.copilot/knowledge.md:441-443, 606`.
- Destructive save: `src/popup/remote-config.ts:420-445`, `src/common/config.ts:1218-1270`; fix `git show e11059b1` (dangling).
- Selector-loss: `src/popup.ts:8396-8419` (only write), `src/popup.ts:6370-6470` (fragile resume), `src/background/ai-run-orchestrator.ts` (no selector write).
- Consumed reveal latch: `src/content-main.ts:2180-2189`.
- disposeTab unsafe: `src/background/brain/index.ts:1007-1017`; `.copilot/knowledge.md:552`.
- Sticky facts: `src/popup/layers/popup-bus-client.ts:66,184`; `src/content/layers/content-bus-client.ts:47,233`; heartbeat `src/background/brain/heartbeat.ts:20,46-51`; doctrine `.copilot/knowledge.md:603`.
- Projection feedback loop + dedup patch: `src/background/brain/state-store.ts:241-248`; `src/background/brain/index.ts:542-620`; `.copilot/knowledge.md:468-485`.
- Spinner split-persistence bug: `src/background/brain/spinner-authority.ts:22-49`; `.copilot/knowledge.md:547`.
- CPU-peg feedback loops: `.copilot/knowledge.md:546, 548`; storm-breaker `src/content-main.ts:7326-7346`.
- Emulation metrics-only: `src/common/emulation.ts:330-376`.
- Swallowed errors: 73 × `.catch(() =>` in `src/background.ts`; `replyWithKeepAlive` `src/background.ts:2955-2974`; "Unable to save session" `src/common/text.ts:438`.
- Source-pinning tests: 77/202 files `readFileSync` src (e.g. `tests/navigation-notifier.test.ts:10`).
