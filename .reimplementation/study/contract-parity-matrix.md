# Current contract parity matrix

Audit baseline: extension `b39295d8` on `re-write`; legacy contract register
`study/legacy-locked-contracts.md` (v1.10.0 / `main` lineage). This is the single verdict table for all
112 locked `C-*` identifiers. A legacy citation points to the exact register entry, which in turn pins
the legacy source/decision lines. A rewrite citation points to current implementation or behavioral-test
evidence. Line evidence is immutable relative to the audit baseline.

Verdicts are deliberately strict: **PASS** means the observable contract is implemented (including an
approved D13–D24 redesign); **PARTIAL** means the core behavior exists but a named clause is weaker;
**FAIL** means an observable rule is absent or inverted. Every FAIL is assigned to a concrete ledger
slice below.

## Matrix

| Contract | Verdict | Legacy evidence | Rewrite evidence and disposition |
|---|---|---|---|
| C-META-1 | PASS | `study/legacy-locked-contracts.md:21` | Exact taxonomies and focused behavior pins: `src/domain/constants.ts:14`, `tests/src/domain/taxonomy.test.ts:15`. |
| C-META-2 | PARTIAL | `study/legacy-locked-contracts.md:26` | Changes are pinned in the parity ledger and focused tests (`parity-plan.md:270`, `tests/src/content/marking/dom-bridge.test.ts:725`), but the legacy four-document same-commit ritual is replaced by this rewrite ledger. |
| C-META-3 | PASS | `study/legacy-locked-contracts.md:30` | Lock changes have named slices and focused protocol tests: `parity-plan.md:321`, `tests/src/lock/lock.test.ts:278`. |
| C-MARK-1 | PARTIAL | `study/legacy-locked-contracts.md:35` | Explicit/unexclude rows win, but structural refresh still calls `mergeDefaultExclusions`: `src/content/marking/engine.ts:143`, `src/content/marking/engine.ts:164`. New nodes can therefore be seeded after the initial pass. |
| C-MARK-2 | PASS | `study/legacy-locked-contracts.md:47` | Classification precedence is centralized: `src/domain/evaluate.ts:47`; selector precedence is pinned at `tests/src/domain/selector-seed.test.ts:20`. |
| C-MARK-3 | PASS | `study/legacy-locked-contracts.md:50` | Session rows are dropped on disable/navigation/save/discard: `tests/src/popup/organ.test.ts:176`, `tests/src/popup/organ.test.ts:183`, `tests/src/popup/organ.test.ts:191`, `tests/src/popup/organ.test.ts:198`. |
| C-MARK-4 | PASS | `study/legacy-locked-contracts.md:59` | Immutable taxonomy is case-insensitive and never emits per-page rows: `src/domain/taxonomy.ts:7`, `src/domain/evaluate.ts:51`, `tests/src/domain/evaluate.test.ts:76`. |
| C-MARK-5 | PASS | `study/legacy-locked-contracts.md:66` | Exact toggleable set and `LINK` omission: `src/domain/constants.ts:52`, `tests/src/domain/taxonomy.test.ts:35`, `tests/src/domain/taxonomy.test.ts:52`. |
| C-MARK-6 | PASS | `study/legacy-locked-contracts.md:69` | Collection is taxonomy-only after hidden/chrome/immutable/closed guards: `src/content/marking/engine.ts:97`; full-width footer regression: `tests/src/content/marking/dom-bridge.test.ts:776`. |
| C-MARK-7 | PASS | `study/legacy-locked-contracts.md:75` | Generated and user exclusions share `exception` and one renderer path: `src/domain/evaluate.ts:57`, `src/content/marking/renderer.ts:54`. |
| C-MARK-8 | PASS | `study/legacy-locked-contracts.md:82` | Exact-boundary unmark preserves independent descendant exclusions, clears only dependent include punches, and retains a visible textual leaf: `src/content/marking/store.ts:18`, `src/domain/evaluate.ts:64`; golden proof at `tests/src/content/marking/marking.test.ts:337`. Landed in `9e95b1e2`. |
| C-MARK-9 | PASS | `study/legacy-locked-contracts.md:91` | First exclude-click on an existing generated exclusion writes `{excluded:false}`: `src/content/marking/store.ts:18`, pinned at `tests/src/content/marking/marking.test.ts:312`. |
| C-MARK-10 | PASS | `study/legacy-locked-contracts.md:94` | The renderer preserves the complete classification map while collapsing nested exception boxes below their nearest projected boundary: `src/content/marking/renderer.ts:171`, `src/content/marking/renderer.ts:287`; DOM proof at `tests/src/content/marking/dom-bridge.test.ts:413`. Landed in `9e95b1e2`. |
| C-MARK-11 | PASS | `study/legacy-locked-contracts.md:100` | The approved unified-row schema preserves the observable data: `src/storage/config.ts:11`, `src/domain/schema/marking.ts:8`; D14 authority is pinned at `tests/src/background/property-snapshot-authority.test.ts:51`. |
| C-MARK-12 | PASS | `study/legacy-locked-contracts.md:107` | The bridge identifies visible empty block candidates (`src/content/marking/dom-view.ts:77`), evaluation emits lifecycle-only explicit exclusion rows without an overlay (`src/domain/evaluate.ts:62`, `src/domain/evaluate.ts:134`), and target conversion suppresses them. Refresh/removal proof: `tests/src/content/marking/dom-bridge.test.ts:296`. Landed in `2c73af7b`. |
| C-MARK-13 | PASS | `study/legacy-locked-contracts.md:113` | Both selector seed directions stamp `explicit:true`: `src/domain/selector-seed.ts:28`, `tests/src/domain/selector-seed.test.ts:41`. |
| C-MARK-14 | PARTIAL | `study/legacy-locked-contracts.md:120` | Dirty/session one-shot gating exists (`src/entrypoints/content-loader.content.ts:1357`), but there is no dedicated `selectorSuppressedXpaths` authority beyond retained unexclude rows. |
| C-MARK-15 | PASS | `study/legacy-locked-contracts.md:125` | Exclude normalization removes overlaps/descendants and converts generated ancestors: `src/content/marking/store.ts:23`, `src/content/marking/store.ts:78`, pinned at `tests/src/content/marking/marking.test.ts:161`. |
| C-MARK-16 | PASS | `study/legacy-locked-contracts.md:131` | Include normalization and closed-boundary targeting: `src/content/marking/store.ts:23`, `src/content/marking/resolve.ts:28`, `tests/src/content/marking/marking.test.ts:55`. |
| C-MARK-17 | PASS | `study/legacy-locked-contracts.md:137` | Toggle writes one mutually exclusive row and removes the old exact row: `src/content/marking/store.ts:23`, `src/content/marking/store.ts:31`. |
| C-FSM-1 | PASS | `study/legacy-locked-contracts.md:142` | Mode precedence and event-time modifiers are centralized in content; navigation clears the session: `src/entrypoints/content-loader.content.ts:1114`, `tests/src/popup/organ.test.ts:183`. |
| C-FSM-2 | PASS | `study/legacy-locked-contracts.md:151` | Space passthrough redraw and reset paths: `src/entrypoints/content-loader.content.ts:1114`, `tests/src/content/marking/dom-bridge.test.ts:628`. |
| C-FSM-3 | PASS | `study/legacy-locked-contracts.md:155` | Content memory owns complete blocked presentation and interaction state: `src/content/organ/memory.ts:17`, `tests/src/content/organ.test.ts:101`. |
| C-TGT-1 | PASS | `study/legacy-locked-contracts.md:166` | Composed hit-testing pierces pointer-suppressed nodes; the bridge omits extension/immutable subtrees: `src/content/marking/hit-testing.ts:45`, `src/content/marking/dom-view.ts:235`, `tests/src/content/marking/dom-bridge.test.ts:168`. |
| C-TGT-2 | PARTIAL | `study/legacy-locked-contracts.md:171` | Paint reachability and retained-include ghosts exist (`src/content/marking/renderer.ts:103`, `src/content/marking/renderer.ts:227`), but collapsed textual wrappers have no descendant-geometry fallback. |
| C-TGT-3 | PASS | `study/legacy-locked-contracts.md:179` | Exclude drills and include reaches through one resolver: `src/content/marking/resolve.ts:28`, `src/content/marking/resolve.ts:49`, `tests/src/content/marking/marking.test.ts:27`. |
| C-TGT-4 | PASS | `study/legacy-locked-contracts.md:186` | Four-step priority and across-gap golden fixture: `src/domain/widening.ts:67`, `tests/src/domain/widening.test.ts:56`, `tests/src/content/marking/dom-bridge.test.ts:725`. |
| C-TGT-5 | PASS | `study/legacy-locked-contracts.md:189` | Page-shell/root stops, width independence, and descendants-only floor: `src/domain/widening.ts:54`, `tests/src/domain/widening.test.ts:109`, `tests/src/domain/widening.test.ts:124`. The approved F2 tradeoff remains documented. |
| C-TGT-6 | PARTIAL | `study/legacy-locked-contracts.md:210` | Core self-markability is centralized (`src/domain/boundary.ts:67`), but the leaf/direct-descendant toggleable-boundary distinction depends on hit ordering instead of an explicit predicate. |
| C-TGT-7 | PASS | `study/legacy-locked-contracts.md:215` | Mobile-width/page-height geometry and visible CSS clamps: `src/domain/visibility.ts:32`, `src/domain/visibility.ts:66`, `tests/src/domain/visibility.test.ts:27`. |
| C-TGT-8 | PASS | `study/legacy-locked-contracts.md:223` | `aria-hidden` and sr-only metadata are ambiguous until the composed multi-point paint check resolves them (`src/content/marking/dom-view.ts:180`, `src/content/marking/paint-reachability.ts:37`, `src/domain/visibility.ts:77`); visible-prose proof at `tests/src/content/marking/dom-bridge.test.ts:276`. Landed in `2c73af7b`. |
| C-SHDW-1 | PARTIAL | `study/legacy-locked-contracts.md:229` | Open roots flatten recursively (`src/content/marking/dom-view.ts:36`), but a closed-shadow host is serialized as empty (`src/content/marking/dom-view.ts:361`), dropping the host and light DOM rather than only skipping the closed root. |
| C-SHDW-2 | PASS | `study/legacy-locked-contracts.md:235` | Flattened children share continuous positional indices: `src/content/marking/dom-view.ts:208`, `tests/src/domain/xpath.test.ts:14`, `tests/src/content/marking/marking.test.ts:94`. |
| C-SHDW-3 | PASS | `study/legacy-locked-contracts.md:240` | Bridge enumeration descends open roots and page-world instruments closed hosts: `src/content/marking/dom-view.ts:208`, `src/page-world/program.js:39`, `tests/src/content/marking/dom-bridge.test.ts:193`. |
| C-SUB-1 | PARTIAL | `study/legacy-locked-contracts.md:249` | Extension and automation roots cannot shift capture XPaths (`tests/src/content/marking/dom-bridge.test.ts:216`, `tests/src/content/marking/dom-bridge.test.ts:234`); the consent bypass style is still serialized and there is no separately named shallow-boundary store. |
| C-SUB-2 | PASS | `study/legacy-locked-contracts.md:253` | The unified walk implements explicit rescue, excluded-ancestor suppression, immutable tags, implicit positive/negative rows, root rejection, and lifecycle-only silent-whitespace exclusions (`src/domain/evaluate.ts:102`, `src/domain/evaluate.ts:122`); DOM/submission proof at `tests/src/content/marking/dom-bridge.test.ts:296`. |
| C-SUB-3 | PASS | `study/legacy-locked-contracts.md:267` | Full positive and negative ground truth comes from the one evaluation walk: `src/domain/evaluate.ts:108`, `tests/src/content/marking/marking.test.ts:435`. |
| C-SUB-4 | PASS | `study/legacy-locked-contracts.md:270` | Positional schema plus capture alignment guard: `src/domain/schema/marking.ts:5`, `tests/src/content/marking/marking.test.ts:459`. |
| C-SUB-5 | PASS | `study/legacy-locked-contracts.md:272` | Full authoritative corpus overlay, static raw HTML, and raw-DOM refinement: `src/storage/property-snapshot-authority.ts:81`, `src/offscreen/xpath-refinement.ts:114`, `tests/src/background/startup.test.ts:144`. |
| C-SUB-6 | PASS | `study/legacy-locked-contracts.md:278` | `ai-run-started` is reported before capture/refinement (`src/entrypoints/popup/main.tsx:1934`); polling remains 5s (`src/lynx/ai-job.ts:106`). |
| C-SUB-7 | PASS | `study/legacy-locked-contracts.md:284` | The exported timing authority (`src/lynx/ai.ts:7`) drives popup deadline, durable run deadline, and poller defaults (`src/entrypoints/popup/main.tsx:1938`, `src/background/services.ts:308`, `src/lynx/ai-job.ts:107`); `tests/src/lynx/ai-timing-authority.test.ts:14` rejects numeric duplicates. Landed in `cdc7b40a`. |
| C-PERF-1 | PASS | `study/legacy-locked-contracts.md:290` | One activation path reveals/freezes before first overlay and blocks through content memory: `src/entrypoints/content-loader.content.ts:1350`, `tests/src/content/organ.test.ts:72`. |
| C-PERF-2 | PASS | `study/legacy-locked-contracts.md:294` | Toggle evaluates/renders only its branch; structural mutations use the full path: `src/content/marking/engine.ts:373`, `src/content/marking/engine.ts:250`, `tests/src/content/marking/dom-bridge.test.ts:676`. |
| C-PERF-3 | PASS | `study/legacy-locked-contracts.md:301` | Per-pass weak caches and geometry-only scroll work: `src/content/marking/dom-view.ts:19`, `src/content/marking/engine.ts:199`, `tests/src/content/marking/dom-bridge.test.ts:340`, `tests/src/content/marking/dom-bridge.test.ts:587`. |
| C-PERF-4 | PARTIAL | `study/legacy-locked-contracts.md:310` | Branch splice exists (`src/domain/evaluate.ts:146`) but legacy's pending-toggle/fingerprint/parity guards and trailing full audit are not ported. |
| C-PERF-5 | PARTIAL | `study/legacy-locked-contracts.md:322` | Scroll repositions only (`src/content/marking/engine.ts:217`) and XPath maps are pass-local; nested default projection still lacks collapse (C-MARK-10/G2a). |
| C-PERF-6 | PASS | `study/legacy-locked-contracts.md:326` | Page-world freeze gates registered callbacks/tokens and has no periodic DOM sweep: `src/page-world/program.js:93`, `src/page-world/program.js:265`. |
| C-FRZ-1 | PASS | `study/legacy-locked-contracts.md:337` | One joined visit ritual, paint-yielding expansion, and absolute-bottom freeze: `src/content/stabilization/reveal.ts:20`, `tests/src/content/stabilization/stabilization.test.ts:61`, `tests/src/content/stabilization/stabilization.test.ts:127`. |
| C-FRZ-2 | PASS | `study/legacy-locked-contracts.md:348` | Reasoned freeze controller and navigation-only visit release: `src/content/stabilization/freeze.ts:3`, `tests/src/content/stabilization/stabilization.test.ts:21`, `tests/src/content/stabilization/stabilization.test.ts:408`. |
| C-FRZ-3 | PARTIAL | `study/legacy-locked-contracts.md:354` | CSS/timer/rAF/observer/event freezing exists (`src/page-world/program.js:93`, `src/entrypoints/content-loader.content.ts:660`), but generic media/SVG/Web-Animation computed-value locking is thinner than legacy. |
| C-FRZ-4 | PARTIAL | `study/legacy-locked-contracts.md:362` | Semantic hiding remains hidden (`src/domain/visibility.ts:50`), but the rewrite does not explicitly normalize every Webflow/blur/transform motion-only hiding form. |
| C-FRZ-5 | PASS | `study/legacy-locked-contracts.md:367` | Extension-owned freeze pill with scoped font/presentation: `src/entrypoints/content-loader.content.ts:923`, pinned by `tests/src/content/organ.test.ts:72`. |
| C-FRZ-6 | PASS | `study/legacy-locked-contracts.md:371` | Editor preparation is blocking and complete-memory-owned: `src/content/organ/memory.ts:43`, `tests/src/content/organ.test.ts:72`. |
| C-FRZ-7 | PASS | `study/legacy-locked-contracts.md:374` | Inspection reload/capture is explicit and render-mode confirmation gated: `src/entrypoints/popup/main.tsx:1300`, `tests/src/popup/app.test.ts:491`, `tests/src/popup/entrypoint.test.ts:715`. |
| C-LIFE-1 | PASS | `study/legacy-locked-contracts.md:385` | Consent sweep starts from managed context and watches later DOM growth: `src/entrypoints/content-loader.content.ts:965`, `tests/src/content/consent.test.ts:176`. |
| C-LIFE-2 | PASS | `study/legacy-locked-contracts.md:392` | Precision selector allowlist and negative vocabulary pin: `src/content/consent.ts:3`, `tests/src/content/consent.test.ts:222`. |
| C-LIFE-3 | PASS | `study/legacy-locked-contracts.md:399` | Candidate/render-mode generation owns the one visit ritual: `src/entrypoints/content-loader.content.ts:408`, `tests/src/content/stabilization/stabilization.test.ts:390`. |
| C-LIFE-4 | PASS | `study/legacy-locked-contracts.md:403` | Silent overlays are content-memory presentation independent of reveal completion: `src/content/organ/memory.ts:17`, `src/content/marking/engine.ts:395`. |
| C-LIFE-5 | PASS | `study/legacy-locked-contracts.md:411` | Stable signal-derived content state is table-driven and returns mechanically: `src/content/organ/machine.ts:20`, `tests/src/content/organ.test.ts:42`. |
| C-LIFE-6 | PASS | `study/legacy-locked-contracts.md:415` | Busy/result-affecting phases project a real input block: `src/entrypoints/content-loader.content.ts:814`, `tests/src/popup/app.test.ts:1028`. |
| C-LIFE-7 | PASS | `study/legacy-locked-contracts.md:419` | Background lifecycle resolves page context without requiring an open panel: `src/background/lock-browser-lifecycle.ts:51`, `tests/src/background/lock-browser-lifecycle.test.ts:25`. |
| C-LIFE-8 | PASS | `study/legacy-locked-contracts.md:423` | Page-visit freeze is retained through marking-off and silent lifecycles: `src/entrypoints/content-loader.content.ts:436`, `tests/src/popup/entrypoint.test.ts:433`. |
| C-SIL-1 | PASS | `study/legacy-locked-contracts.md:429` | Layer grammar, keyed rects, hidden-explicit ghosts, and repaint behavior: `src/content/marking/renderer.ts:38`, `src/content/marking/renderer.ts:227`, `tests/src/content/marking/dom-bridge.test.ts:449`. |
| C-SIL-2 | PASS | `study/legacy-locked-contracts.md:435` | Root and layers are pointer-transparent: `src/content/marking/renderer.ts:183`, `tests/src/content/marking/marking.test.ts:400`. |
| C-POP-1 | PASS | `study/legacy-locked-contracts.md:439` | State-complete popup memory and dirty-during-preview guards: `src/popup/organ/memory.ts:41`, `tests/src/popup/organ.test.ts:29`, `tests/src/popup/organ.test.ts:36`. |
| C-POP-2 | PASS | `study/legacy-locked-contracts.md:461` | Save gates are state-machine facts, with intervening-dirty races pinned: `tests/src/popup/entrypoint.test.ts:1107`, `tests/src/popup/entrypoint.test.ts:1268`. |
| C-POP-3 | PASS | `study/legacy-locked-contracts.md:467` | Silent and marking preview origins exit exactly, and publication stays silent-only: `tests/src/popup/entrypoint.test.ts:1489`, `tests/src/popup/organ.test.ts:42`, `tests/src/popup/app.test.ts:921`. |
| C-POP-4 | PASS | `study/legacy-locked-contracts.md:475` | Draft rows are session-local; canonical feed drives saved coverage: `src/domain/todo.ts:21`, `tests/src/popup/organ.test.ts:205`, `tests/src/domain/todo.test.ts:24`. |
| C-POP-5 | PASS | `study/legacy-locked-contracts.md:481` | Current row/type presentation is covered in the Todo projection/UI: `src/popup/App.tsx:936`, `tests/src/popup/app.test.ts:829`. |
| C-POP-6 | PASS | `study/legacy-locked-contracts.md:484` | Quiet 15s refresh and suspension recovery are explicit: `src/entrypoints/popup/main.tsx:78`, `tests/src/popup/todo-recovery.test.ts:6`. |
| C-POP-7 | PASS | `study/legacy-locked-contracts.md:488` | Content reports facts; popup consumes brain signals rather than issuing redundant truth writes: `src/entrypoints/popup/main.tsx:849`, `tests/src/popup/entrypoint.test.ts:1800`. |
| C-POP-8 | PASS | `study/legacy-locked-contracts.md:491` | Singular save adopts authoritative baseline; discard clears only the live draft: `src/background/index.ts:427`, `tests/src/background/property-snapshot-authority.test.ts:51`, `tests/src/popup/organ.test.ts:198`. |
| C-POP-9 | PASS | `study/legacy-locked-contracts.md:495` | Popup copy derives locally from complete machine memory: `src/popup/organ/memory.ts:41`, `tests/src/popup/organ.test.ts:140`. |
| C-SPIN-1 | PASS | `study/legacy-locked-contracts.md:502` | Busy edges are brain-decided signals and content consumes them: `src/background/brain/decide.ts:47`, `tests/src/background/brain.test.ts:560`. |
| C-SPIN-2 | PASS | `study/legacy-locked-contracts.md:507` | Cross-realm messages carry reason/phase codes; content/popup copy is local: `src/content/organ/memory.ts:17`, `src/popup/organ/memory.ts:41`. |
| C-SPIN-3 | PASS | `study/legacy-locked-contracts.md:513` | No popup spinner module/state exists; operations use brain facts and keepalive leases: `src/background/rewrite-brain-runtime.ts:70`, `tests/src/background/brain.test.ts:271`. |
| C-SPIN-4 | PASS | `study/legacy-locked-contracts.md:516` | One complete content presentation owns the curtain: `src/entrypoints/content-loader.content.ts:814`, `tests/src/content/organ.test.ts:101`. |
| C-SPIN-5 | PASS | `study/legacy-locked-contracts.md:522` | Deterministic ended/failed facts settle the state machine: `src/background/brain/decide.ts:55`, `tests/src/content/organ.test.ts:42`. |
| C-SPIN-6 | PASS | `study/legacy-locked-contracts.md:527` | Durable facts rehydrate and long operations hold MV3 keepalive: `src/background/rewrite-brain-runtime.ts:62`, `tests/src/background/startup.test.ts:144`. |
| C-SPIN-7 | PASS | `study/legacy-locked-contracts.md:530` | Countdown clocks remain presentation timers while state deadlines are authoritative: `src/lock/view.ts:20`, `tests/src/lock/lock.test.ts:399`. |
| C-LOCK-1 | PASS | `study/legacy-locked-contracts.md:536` | Background owns environment-scoped editor sessions and candidate claims: `src/background/lock-runtime.ts:98`, `tests/src/background/services.test.ts:366`. |
| C-LOCK-2 | PASS | `study/legacy-locked-contracts.md:545` | Same-user continuation is fenced, explicit, and destructive when required: `src/lock/client.ts:376`, `tests/src/lock/lock.test.ts:278`. |
| C-LOCK-3 | PASS | `study/legacy-locked-contracts.md:550` | Backend deadlines are mirrored; presence/idle gates heartbeat: `src/lock/client.ts:136`, `tests/src/lock/lock.test.ts:118`, `tests/src/lock/lock.test.ts:439`. |
| C-LOCK-4 | PASS | `study/legacy-locked-contracts.md:562` | Inspection reload state is a distinct reconnect posture: `src/lock/view.ts:48`, `tests/src/lock/copy.test.ts:8`. |
| C-LOCK-5 | PASS | `study/legacy-locked-contracts.md:566` | WebSocket and bounded HTTP reachability are combined: `src/lock/reachability.ts:19`, `tests/src/lock/lock.test.ts:151`. |
| C-LOCK-6 | PASS | `study/legacy-locked-contracts.md:568` | Takeover suggestion/accept/reject/transfer states and actions are typed: `src/lock/client.ts:365`, `tests/src/lock/lock.test.ts:356`. |
| C-LOCK-7 | PASS | `study/legacy-locked-contracts.md:573` | Durable background baseline is not replaced on ambiguous failure; transfer is authoritative: `src/background/services.ts:190`, `tests/src/background/services.test.ts:1155`. |
| C-LOCK-8 | PASS | `study/legacy-locked-contracts.md:579` | Lifecycle separates terminal tab loss from reconnectable detach: `src/background/lock-browser-lifecycle.ts:51`, `tests/src/background/services.test.ts:1246`. |
| C-LOCK-9 | PASS | `study/legacy-locked-contracts.md:583` | Lock copy projects authoritative deadlines independent of a fresh socket view: `src/lock/copy.ts:20`, `tests/src/lock/lock.test.ts:399`. |
| C-LOCK-10 | PASS | `study/legacy-locked-contracts.md:586` | Candidate suspension blocks editing without deleting silent presentation/draft: `src/background/page-context-runtime.ts:61`, `tests/src/background/page-context-runtime.test.ts:107`. |
| C-EMU-1 | PASS | `study/legacy-locked-contracts.md:592` | Fresh bind applies mobile; editor forces mobile and marking-off preserves posture: `src/entrypoints/popup/main.tsx:1039`, `tests/src/popup/entrypoint.test.ts:315`, `tests/src/popup/entrypoint.test.ts:433`. |
| C-EMU-2 | PASS | `study/legacy-locked-contracts.md:598` | Tab-lifecycle desktop preference is visible, persistent, silent-only, and forced back to mobile for marking: `src/popup/App.tsx:810`, `src/entrypoints/popup/main.tsx:1046`, `tests/src/popup/organ.test.ts:213`. |
| C-SAVE-1 | PASS | `study/legacy-locked-contracts.md:605` | Save schema requires candidate page type: `src/storage/config.ts:68`, `src/entrypoints/popup/main.tsx:2084`. |
| C-SAVE-2 | PASS | `study/legacy-locked-contracts.md:610` | Hub context supplies the dynamic canonical page-type feed; no client enum decides candidacy: `src/lynx/context.ts:9`, `src/domain/todo.ts:21`. |
| C-SAVE-3 | PASS | `study/legacy-locked-contracts.md:615` | Superseding D15 adopts only the validated full authoritative response: `src/background/index.ts:443`, `src/storage/property-snapshot-authority.ts:26`. |
| C-SAVE-4 | PASS | `study/legacy-locked-contracts.md:618` | Ambiguous/invalid responses preserve local; shrink needs proof: `src/background/services.ts:190`, `tests/src/background/property-authority.test.ts:140`, `tests/src/background/property-snapshot-authority.test.ts:78`. |
| C-SAVE-5 | PASS | `study/legacy-locked-contracts.md:621` | Default rows seed before first read-only render and remain valid run/save input: `tests/src/content/marking/dom-bridge.test.ts:756`, `tests/src/content/marking/marking.test.ts:435`. |
| C-SAVE-6 | PASS | `study/legacy-locked-contracts.md:623` | Successful save returns/adopts the full response and ends the live draft: `src/background/index.ts:443`, `tests/src/popup/organ.test.ts:191`. |
| C-SAVE-7 | PASS | `study/legacy-locked-contracts.md:628` | Hub-owned publication fails closed on authority/completeness/cssInfo and adopts its result: `src/domain/publication.ts:39`, `src/background/index.ts:464`, `tests/src/domain/publication.test.ts:74`. |
| C-BRAIN-1 | PASS | `study/legacy-locked-contracts.md:637` | Facts fold, brain decides, organs consume complete memory: `src/background/brain/decide.ts:12`, `src/content/organ/machine.ts:20`, `tests/src/background/brain.test.ts:315`. |
| C-BRAIN-2 | PASS | `study/legacy-locked-contracts.md:643` | Partial fact patches preserve omitted durable facts and reset paths publish explicit outcomes: `tests/src/background/brain.test.ts:51`, `tests/src/popup/organ.test.ts:198`. |
| C-BRAIN-3 | PASS | `study/legacy-locked-contracts.md:647` | Sequenced facts/signals and serialized popup cursor reject stale replay: `src/messaging/rewrite-signals.ts:17`, `tests/src/popup/signal-cursor.test.ts:49`. |
| C-BRAIN-4 | PASS | `study/legacy-locked-contracts.md:651` | Retired directive path is absent; projection delivery is signal/cursor based and consumed once: `src/background/rewrite-brain-runtime.ts:62`, `tests/src/background/brain.test.ts:462`. |
| C-BRAIN-5 | PASS | `study/legacy-locked-contracts.md:655` | Stale async run/save/preview results are generation/session checked: `tests/src/popup/entrypoint.test.ts:982`, `tests/src/popup/entrypoint.test.ts:1426`. |
| C-BRAIN-6 | PASS | `study/legacy-locked-contracts.md:660` | Post-AI dirty transitions return to pre-AI dirty rather than wedging controls: `tests/src/popup/organ.test.ts:29`, `tests/src/popup/entrypoint.test.ts:1711`. |
| C-BRAIN-7 | PASS | `study/legacy-locked-contracts.md:664` | Discard is a brain-derived edge and clears to a clean live-session state: `src/background/brain/decide.ts:73`, `tests/src/popup/organ.test.ts:198`. |
| C-BRAIN-8 | PASS | `study/legacy-locked-contracts.md:670` | Popup owns preview origin/items and exit restores exact state: `src/popup/organ/memory.ts:41`, `tests/src/popup/organ.test.ts:42`. |
| C-BRAIN-9 | PASS | `study/legacy-locked-contracts.md:674` | Page marking/silent state derives from facts, not the selected popup view: `src/entrypoints/popup/main.tsx:849`, `tests/src/popup/view.test.ts:102`. |
| C-BRAIN-10 | PASS | `study/legacy-locked-contracts.md:676` | AI completion is durable and rehydrated into post-AI state: `src/background/services.ts:296`, `tests/src/popup/organ.test.ts:65`. |
| C-BRAIN-11 | PASS | `study/legacy-locked-contracts.md:679` | Navigation is a distinct brain edge and tab lifecycle cleanup is background-owned: `src/background/brain/decide.ts:16`, `src/background/lock-browser-lifecycle.ts:51`. |
| C-BRAIN-12 | PASS | `study/legacy-locked-contracts.md:684` | Shipped content command router preserves the activation reply contract: `src/entrypoints/content-loader.content.ts:1468`, `tests/src/popup/entrypoint.test.ts:583`. |
| C-BRAIN-13 | PASS | `study/legacy-locked-contracts.md:687` | Typed realm bus and storage repositories enforce the boundary: `src/messaging/realms.ts:1`, `src/storage/repositories/config.ts:18`, `tests/src/domain/import-boundary.test.ts:19`. |

## FAIL remediation slices

| Slice | Contracts | Implementation and proof |
|---|---|---|
| **G2a — exact boundary truth and collapsed projection** | C-MARK-8, C-MARK-10 | **Landed in `9e95b1e2`.** Unmark now changes only the exact boundary, preserves descendant excludes, cleans dependent include punches, retains textual leaf boundaries, and collapses ordinary descendant projection below an excluded boundary. |
| **G2b — generated whitespace and accessibility reality** | C-MARK-12, C-TGT-8 | **Landed in `2c73af7b`.** Silent-whitespace rows now live only in evaluation/submission, disappear on refresh when stale, and stay out of overlays/targeting; ambiguous a11y metadata is resolved by composed paint reachability. |
| **G2c — AI timing authority** | C-SUB-7 | **Landed in `cdc7b40a`.** One exported timeout/poll definition now drives popup deadline, durable run deadline, and poll defaults; a source guard rejects numeric duplicates. |

## Fail-open / fail-closed API audit

The closed choice is applied by effect, not HTTP verb: ambiguous reads may preserve and display the
last valid state; anything that can mutate property, ownership, publication, or billed AI state is
fail-closed.

| Call site | Effect posture | Evidence |
|---|---|---|
| Hub `/context` | Display may fail open to the last valid context; candidacy loss requires a definitive typed answer. | `src/background/page-context-runtime.ts:61`; `tests/src/background/page-context-runtime.test.ts:67` |
| Config `/load` | Preserve the last valid authoritative baseline on auth/transport/invalid; clear only a genuine not-found. | `src/background/services.ts:190`; `tests/src/background/property-authority.test.ts:123` |
| Static HTML fetch | Fail closed for Run AI/Save because missing raw source changes the written ground truth. | `src/background/static-html.ts:12`; `tests/src/background/static-html.test.ts:45` |
| AI `/get_selectors` start/status/result | Fail closed; no selectors or success state is invented. Resume exposes only a scope-matching durable result. | `src/background/services.ts:287`; `tests/src/background/services.test.ts:444` |
| Config `/save` | Fail closed on environment, fence, revision, payload, or integrity mismatch; adopt only a full valid response. | `src/background/index.ts:427`; `tests/src/background/startup.test.ts:678` |
| Hub `/publish` | Fail closed on authority/completeness/cssInfo/unknown; submitted fingerprint advances only on definitive success. | `src/background/index.ts:464`; `tests/src/popup/app.test.ts:973` |
| Lock action/heartbeat | Fail closed for mutation authority and renewal presence; network uncertainty never fabricates transfer. | `src/background/index.ts:268`; `tests/src/background/lock-browser-lifecycle.test.ts:113`; `tests/src/lock/lock.test.ts:627` |
| Account login/token validation | Login fails closed; validation transport error preserves the stored session but displays uncertainty rather than signing out. | `src/background/index.ts:525`; `tests/src/background/auth-token-monitor.test.ts:131` |

## Totals

- PASS: 101
- PARTIAL: 11
- FAIL: 0
- Inventory: 112 / 112
