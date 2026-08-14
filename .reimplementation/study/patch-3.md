# Patch 3 — The legacy test suite as spec corpus and regression net

**Gap filled:** the nine study reports cite 11 test paths total, six of them rewrite guard tests. The
verdict table quotes "58 files / 485 tests green" without ever asking what those 485 do *not* cover.
This report is the document from which the sentence *"slice Pn is proven by test X"* can be written.

**Method.** Both `tests/` trees were listed in full and counted. Every legacy test named by the
completeness critic was read end-to-end (plus the neighbours that turned out to be the real
counterparts). For each, the rewrite was searched **by subject, not by name** — the rewrite renames
almost everything, so `core-visibility` maps to `src/domain/visibility.ts` + `dom-view.ts`, not to a
file called `visibility`. Where I claim NONE, I grepped the rewrite source for the *behaviour* and
confirmed the behaviour is either absent or present-but-unpinned; both cases are stated explicitly,
because they are different risks.

Paths: legacy = `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`,
rewrite = `/home/rojan/Documents/Git/GitHub/Unfluffify`. Legacy paths below are written `legacy:tests/...`,
rewrite paths bare.

---

## 1. The two corpora, measured

| | legacy (`main`, v1.10.0+3) | rewrite (`re-write`) |
|---|---|---|
| files under `tests/` | 203 (197 `*.test.ts` + 6 kit/fixture) | 64 (58 `*.test.ts` + 6 kit/fixture) |
| total test-file lines | 38,010 | 12,989 |
| `it(`/`test(` blocks | 1,194 | 485 |
| files that read source text with `readFileSync` | 81 (41%) | 17 (29%) |
| files asserting regexes against source text | 73 (37%) | 6 (build/manifest/entrypoint guards only) |
| build/structure/meta guard tests | ~60 | 50 of 485 |
| orchestration-harness tests | 34 | 27 |
| ⇒ behavioural tests (approx.) | ~1,100 | ~408 |

Both suites run on the same runner (`vitest run`; legacy `package.json:17`, rewrite `package.json:17`),
so the corpora are directly comparable and legacy tests are mechanically runnable once their imports
are repointed.

The headline ratio is **1,194 → 485**, but the honest ratio is worse for *behaviour* and better for
*portability*, and both corrections matter:

- **Worse for behaviour.** 50 of the rewrite's 485 are build/structure guards (`tests/a1-bootstrap.test.ts`
  5, `tests/manifest-permissions.test.ts` 5, `tests/package-test-script.test.ts` 8,
  `tests/integration/rewrite-cutover.test.ts` 9, `tests/theme-colors.test.ts` 5, `tests/typing-ratchet.test.ts` 1,
  `tests/no-ts-ignore-guard.test.ts` 1, plus 16 others). Another 27 test the orchestration harness
  (`tests/orchestration-{bus,rpc,runner,property-lock-scenario}.test.ts`), which is developer tooling,
  not product. That leaves ~408 tests for the whole product.
- **Better for portability.** 73 of legacy's 197 files assert *regexes against god-file source text* —
  e.g. `legacy:tests/background-render-mode-inspection.test.ts:40-51` matches a 12-line regex against
  `src/background.ts` to prove the reload/capture/end ordering. Those tests died with the god files
  (`tests/integration/rewrite-cutover.test.ts:234` asserts `src/background.ts`, `src/content-main.ts`,
  `src/content/core.ts`, `src/popup.ts`, `src/common/config.ts` are deleted). **Their subjects survive;
  their bodies do not.** Any port plan that counts files will over-estimate the work by ~40% and
  under-estimate the design work by 100%, because those subjects need *new* tests written against real
  seams rather than copied.

### 1.1 Three classes of legacy test, and what each is worth

| class | example | count | portability |
|---|---|---|---|
| **A — pure-logic, harness-driven** | `legacy:tests/core-visibility.test.ts` builds a fake DOM (`installVisibilityDom`, lines 24-250) and calls real exports | ~60 files | **High.** Subject and often assertions port directly onto `src/domain/*`. This is the corpus's real value. |
| **B — module-with-injected-deps** | `legacy:tests/explicit-marking-handler.test.ts:32-71` injects 12 deps into `createExplicitMarkingHandler` | ~55 files | **Medium.** Behaviour ports; the seam is different (rewrite uses a pure `store.toggle` + `evaluate` pass). |
| **C — source-regex wiring pins** | `legacy:tests/content-activation-order.test.ts:39-56` slices `core.ts` by string index and regex-matches the slice | ~73 files | **Low as code, high as spec.** Each one names an ordering invariant that must be re-proved behaviourally. |

A class-C test is the *only* written record of several orderings (see §4.7, §4.8). Deleting them
without transcribing the invariant loses the contract.

---

## 2. The mapping table

Legacy test → contract(s) it pins → rewrite counterpart by subject. `C-*` IDs are from
`.reimplementation/study/legacy-locked-contracts.md`.

| # | legacy test (tests / lines) | contracts pinned | rewrite counterpart by subject | verdict |
|---|---|---|---|---|
| 1 | `core-hover-performance` (3 / 287) | C-PERF-3, C-PERF-5, C-TGT-1 | — | **NONE. Behaviour absent.** `src/content/marking/engine.ts:312-317` re-resolves on every mousemove; `src/entrypoints/content-loader.content.ts:565-569` binds it uncapped. |
| 2 | `core-visibility` (87 / 3,043) | C-TGT-1..8, C-SHDW-1..3, C-MARK-1,2,6,8,10,12, C-SUB-1,2 | `tests/src/domain/visibility.test.ts` (4), `evaluate.test.ts` (8), `widening.test.ts` (4), `boundary.test.ts` (3), `xpath.test.ts` (4), `taxonomy.test.ts` (3), `src/content/marking/marking.test.ts` (20), `dom-bridge.test.ts` (27) | **PARTIAL (73 vs 87, different depth).** Subjects with no counterpart: silent-whitespace exclusions (C-MARK-12), fixed-box-outside-viewport, horizontal-clip carousel, ghost-bucket for definitively-hidden AI rows, sync-abort atomicity. |
| 3 | `core-motion-pause` (25 / 1,539) | C-FRZ-1..4, C-FRZ-6, C-PERF-6, C-LIFE-8 | `tests/src/content/stabilization/stabilization.test.ts` (20, of which 8 reveal), `tests/src/page-world/program.test.ts` (15), `tests/page-motion-freeze-bridge.test.ts` (3) | **PARTIAL.** Reveal ritual + page-world timer bridge are well covered. **C-FRZ-3 and C-FRZ-4 have no implementation at all** (see §4.3) — nothing to test. |
| 4 | `core-scheduling` (35 / 1,145) | C-PERF-1..5, C-FSM-2, C-FSM-3, C-MARK-9, C-MARK-14, C-LIFE-1, C-LIFE-6 | rAF coalescing only, indirectly, via `src/content/marking/engine.ts:194-199`; no test asserts it | **NONE for 30+ of 35.** No debounce, no idle-callback deferral, no draft-persist flush-on-disable, no URL-watcher draft policy, no cache-key versioning, no branch-scoped-rebuild guard, no scroll-verdict suspension. |
| 5 | `content-marking-machine` (8 / 161) | C-FSM-3, C-BRAIN-7, C-LIFE-4 | `tests/src/popup/organ.test.ts` (15) + `src/popup/organ/machine.ts` | **PARTIAL / relocated.** The FSM moved popup-side. Content has no machine; the equivalent (exit destination memorised at entry) is now popup `priorState` (`src/popup/organ/machine.ts:41-44,154-157`). The *content-side* re-entrancy guards ("undefined steps are held", `legacy:...:57-73`) have no counterpart. |
| 6 | `content-overlay-memory` (4 / 51) | C-FSM-3, C-LIFE-6, C-FRZ-6 | `src/popup/organ/memory.ts` MATRIX + `tests/src/popup/app.test.ts` (50) | **PARTIAL.** Rewrite has a per-state presentation matrix with curtain text, and it is frozen-by-construction via `Readonly`. What is missing is the *content-side* curtain contract: `src/entrypoints/content-loader.content.ts:320-334` renders whatever text the directive carries, untested. |
| 7 | `content-activation-order` (11 / 262) | C-PERF-1, C-LIFE-1, C-LIFE-3, C-LIFE-7, C-FRZ-7, C-SUB-1 | `tests/c4-content-entrypoint.test.ts` (7), `src/content/activation.ts` | **PARTIAL.** Activation/deactivation/stale-URL rejection covered. **No test that consent hiding runs before and independently of everything else** (C-LIFE-1), and none that the restore path does not re-run reveal. |
| 8 | `consent-selector-precision` (3 / 60) | C-LIFE-2 | `tests/src/content/consent.test.ts:222` | **YES — genuine, tighter counterpart.** The rewrite test folds forbidden-token and `:not(body):not(html)` into one loop over `CONSENT_OVERLAY_SELECTORS`. **Missing: the required-token half** (`legacy:...:8-24` asserts `[role='alertdialog' i]`, `[aria-modal='true' i]`, `dialog[open]`, gdpr/interstitial are *present*). |
| 9 | `collect-ai-submission-xpaths` (1 / 193) | C-SUB-1, C-SUB-2, C-PERF-3, C-PERF-5 | `tests/golden/ai-snapshot.test.ts` (1), `tests/src/domain/evaluate.test.ts` (8); nearer legacy analogue is `legacy:tests/submission-rules.test.ts` (19) | **PARTIAL.** Row semantics partly covered by `evaluate`. The memoisation counting (`visibleCalls.get(...) === 1`) has no counterpart because the rewrite's evaluate pass is a single walk — arguably obsolete by construction, but unproven. |
| 10 | `default-exclusions-handler` (1 / 16) | — (pins a handler nothing calls) | — | **DO NOT PORT.** `getDefaultExclusions` is handled at `legacy:src/content/runtime-message-handler.ts:206` and **sent by nobody** (repo-wide grep: only the handler and its own tests). Dead code with a test. |
| 11 | `explicit-marking-handler` (5 / 176) | C-MARK-15, C-MARK-16, C-MARK-17, C-MARK-8, C-TGT-3 | `tests/src/content/marking/marking.test.ts:130-378` (7 relevant) | **YES.** Normalisation (descendant pruning, include/exclude mutual exclusion, toggleable-ancestor conversion) is covered on the new unified-row model. Not covered: the *ordering* of side-effects (`touchTimestamp → normalize → render → snapshot → notify → persist`), which legacy asserts as an exact array (`legacy:...:98-106`). |
| 12 | `describe-xpaths-handler` (2 / 39) | — (pins a handler nothing calls) | — | **DO NOT PORT as-is.** `describeXPathsOnPage` is handled at `legacy:src/content/runtime-message-handler.ts:235` and sent by nobody. But see §5 — the *capability* (human-readable labels in the preview sidebar) is a UX gap in the rewrite. |
| 13 | `dirty-baseline` (6 / 86) | C-MARK-14, C-SAVE-1, C-BRAIN-5 | `src/entrypoints/content-loader.content.ts:64-66`; `tests/src/popup/entrypoint.test.ts:1414,1482` | **PARTIAL.** The *rule* (only an operator toggle dirties; a re-sync/AI apply must not) is preserved by construction — `isUserMarkingDirty()` counts `userToggleCount` only. Two popup tests assert the seeded/clean cases. No test asserts per-page scoping, or that a background re-render leaves it clean. |
| 14 | `device-emulation-lifecycle` (8 / 311) | C-EMU-1, C-EMU-2 | `tests/src/background/render-emulation-runtime.test.ts` (5), `tests/src/content/stabilization/stabilization.test.ts:104-260` (8) | **PARTIAL.** onDetach re-establishment is covered *better* than legacy. **Session persistence of the operator's disable choice is gone**: `src/background/render-emulation-runtime.ts:58` holds postures in an in-memory `Map`, where legacy persisted `DEVICE_EMULATION_PREFIX${tabId}` in `storage.session` (`legacy:...:234-284`). MV3 worker death loses it. |
| 15 | `background-page-data-lifecycle` (6 / 220) | C-SAVE-4, C-SAVE-6, C-BRAIN-11, C-LIFE-7 | — | **NONE. Subsystem absent.** The rewrite registers no `webNavigation` listener at all (grep for `webNavigation`/`onCommitted`/`onUpdated` over `src/` returns nothing). There is no per-navigation `/load`, no in-flight dedupe, no stale-siteId re-validation, no 404 wipe-plus-notify. |
| 16 | `background-render-mode-inspection` (7 / 94) | C-FRZ-7, C-EMU-1 | `tests/src/content/stabilization/stabilization.test.ts:230,247`; `tests/src/background/startup.test.ts:192` | **PARTIAL.** JS-off reload + CDP restore covered. **The 30-second inactivity watchdog that restores JavaScript after a no-JS hold has no counterpart** — `alarms` is used in the rewrite only by the auth-token monitor (`src/background/index.ts:72-98`). A tab left in the no-JS posture stays there. |
| 17 | `brain-projection-dedup` (1 / 84) | **C-BRAIN-4** | — | **NONE, and the rewrite does the opposite.** `src/background/lock-runtime.ts:118-124` `publishDirectiveIfChanged` **dedupes `directive.content`**, keyed `${tabId}:${siteId}`, cleared only on lock release (`:133`). C-BRAIN-4 says the content directive must *never* be deduped precisely so a reloaded content script re-receives it. |
| 18 | `config-store-queue` (3 / 252) | C-SAVE-4 (and the live half-snapshot wipe) | `tests/src/background/services.test.ts:189,214` | **PARTIAL, and pointed at the wrong blob.** The rewrite queues *settings* writes (`src/background/services.ts:127-131`) and tests it well. `createConfigRepo` (`src/storage/repositories/config.ts:18-37`) and `localPropertyRepo` have **no queue**; `applyBackendLoad` (`src/background/services.ts:164-192`) is an unserialised read-modify-write. |
| 19 | `command-ledger` (3 / 87) | (operational hygiene; supports C-SUB-6 "heavy payloads must not ride runtime messages") | — | **NONE. Subsystem absent.** No redaction helper anywhere in the rewrite (grep `redact`/`ledger` over `src/` and `tests/`: zero hits). |
| 20 | `storage-access-boundary` (2 / 203) | **C-BRAIN-13 (locked)** | `tests/src/domain/import-boundary.test.ts` (1) guards `src/domain` against DOM/browser imports; nothing guards storage | **NONE for the storage half.** Today the rewrite is *compliant by accident* — zero `chrome.storage`/`browser.storage`/`localStorage` hits outside `src/storage`. Nothing keeps it that way. |

### 2.1 Neighbours the critic did not name but that belong in the same triage

| legacy test | contracts | rewrite counterpart | verdict |
|---|---|---|---|
| `submission-rules` (19 / 256) | C-SUB-2 (a)–(j) in full | `tests/src/domain/evaluate.test.ts` (8) + `tests/golden/ai-snapshot.test.ts` (1) | **PARTIAL — the closest real analogue to #9.** Legacy enumerates all ten row rules as separate cases; the rewrite covers roughly five. |
| `marking-rules` (11 / 335) | C-MARK-4,5,6,13; C-TGT-4,5,6; C-SHDW-2 | `tests/src/domain/{taxonomy,widening,boundary,selector-seed}.test.ts` (18) | **YES, well covered.** Selector seeding (`selector-seed.test.ts`, 8 tests) is a genuine improvement on legacy's 1. |
| `silent-highlight-rules` (9 / 234) | C-SIL-1, C-SIL-2, C-PERF-3 | `tests/src/content/marking/marking.test.ts:384,401` (2) | **PARTIAL.** Retention rules covered; **settle-after-movement, max-settle timeout, and forced-repaint-on-unchanged-render-key have no counterpart.** |
| `shadow-xpath` (4) + `shadow-deep-capture` (4) | C-SHDW-1..3 | `tests/src/content/marking/dom-bridge.test.ts` (27) + `tests/src/domain/xpath.test.ts` (4) | **YES — better than legacy.** |
| `runtime-message-handler` (15 / 334) | routing surface | `src/content/command-router.ts` — **no dedicated test file** | **PARTIAL.** Gating is exercised only indirectly at `tests/c4-content-entrypoint.test.ts:489`. |
| `focus-handler` (3) | preview→page focus sync | — | **NONE. Feature absent** (`src/types/content-state.ts:38` declares `focusElement` but nothing implements it). |
| `marking-cursor` (2) | marking-mode cursor UX | — | **NONE. Feature absent.** `src/public/cursors/{exclude,include}.svg` ship but are referenced by nothing. |
| `invisible-xpaths-handler` | — | — | **DO NOT PORT.** `filterInvisibleXpathsOnPage` is another handler with no sender. |

---

## 3. What the 485 do not cover — by risk

Ranked by "what breaks in production if this is wrong, and would anything go red?"

1. **Nothing goes red if hover becomes O(page) per mousemove.** (§4.1)
2. **Nothing goes red if the page keeps animating under the operator's cursor.** (§4.3)
3. **Nothing goes red if a reloaded content script never receives its directive.** (§4.6)
4. **Nothing goes red if two concurrent config writes lose each other** — the exact shape of the
   known production incident. (§4.5)
5. **Nothing goes red if a module starts writing `chrome.storage` directly** — C-BRAIN-13 is a
   *locked* contract with an *empty* enforcement. (§4.9)
6. **Nothing goes red if a tab is stranded with JavaScript disabled.** (§4.4)
7. **Nothing goes red if the marking overlay repaints on every scroll frame** — no scheduling test
   exists at all. (§4.2)

---

## 4. Subject-by-subject detail

### 4.1 Hover performance — `core-hover-performance` → NONE

**Legacy behaviour.** Three tests over six extracted functions (`legacy:tests/core-hover-performance.test.ts:29-48`
transpiles `buildHoverHighlightOptionsKey`, `getHoverTargetBoundsKey`, `invalidateHoverHighlightCache`,
`rememberHoverHighlight`, `canReuseHoverHighlight`, `updateHoverHighlight` out of `core.ts` and runs
them in a VM). They pin:

- reuse survives only for an *identical probe stack* and only until a real render or a disconnect
  (`:95-112`);
- `updateHoverHighlight` called twice at the same point does `getMarkableTarget` **once**
  (`:182-188` — `getMarkableTargetCalls === 1`, `drawCalls === 1`);
- a changed target *rect* (`:190-196`) or a changed `state.lastRenderAt` (`:198-202`) re-runs it;
- **the deeper point stack is part of the key**: same top probe, different child probe ⇒ recompute
  (`:205-286`, `drawTargets` `["A","B"]`).

That last one is subtle and expensive to rediscover: caching on the topmost `elementsFromPoint` hit
alone is wrong for the pointer-events-suppressed accordion case (C-TGT-1).

**Rewrite status.** `src/content/marking/engine.ts:312-317`:

```ts
hoverAtPoint(x: number, y: number): void {
  const node = this.resolveAtPoint(x, y, "exclude");
  ...
}
```

`resolveAtPoint` (`:283-304`) does, per call: a composed hit test, a `composedContains` filter, an
`isPaintReachableAt` filter per hit, `store.currentEvaluation()`, and a `toCandidate` map over every
hit. `src/entrypoints/content-loader.content.ts:565-569` binds this to `mousemove` with capture and
**no rAF, no throttle, no cache**.

**Weakness.** This is a per-mousemove full resolution pass, uncapped. Legacy's whole `C-PERF-3`/`C-PERF-5`
family exists because this exact path was the CPU storm. The rewrite has re-created the pre-optimisation
shape, and there is no test that would notice.

**Must port:** yes — as a *new* test against `MarkingEngine`, asserting call counts of an injected
resolution hook. Subject, not body.

### 4.2 Scheduling — `core-scheduling` → NONE for ~30 of 35

**Legacy behaviour** (35 tests, 1,145 lines). The load-bearing ones:

| legacy line | invariant | rewrite |
|---|---|---|
| `:355` | snapshot saves debounced — only the latest timer survives | none |
| `:368` | snapshot generation deferred to `requestIdleCallback` when available | none |
| `:378` | draft persistence debounced; rapid toggles replace the pending write | none |
| `:391`,`:415`,`:426` | explicit toggles coalesce into one rAF frame; `setTimeout` fallback; cancellable | `engine.ts:194-199` does rAF coalescing — **untested** |
| `:463`,`:483` | `disable()` flushes a pending draft persist using the *pre-clear* base URL | none |
| `:492`,`:524` | URL watcher: same-base same-document change discards the draft cache | `src/content/stabilization/spa-guard.ts` covered at `stabilization.test.ts:261`, but for *reload forcing*, not draft policy |
| `:579` | user-driven toggles draw **synchronously** (issue #6) | none |
| `:592` | marking UI scheduling uses extension-owned timers during motion pause | none — and the page-world bridge would swallow them |
| `:609` | hover reuses the last probe result | see §4.1 |
| `:765` | render cache keys include selector + entry fingerprints before reuse | none |
| `:783`,`:808`,`:843` | CP7/CP7a/CP7b: selector invariance under toggles; version-gated caches; branch-scoped rebuild is single-toggle-gated with a trailing FULL backstop | `evaluate.test.ts:117,134,153` cover branch recompute *correctness*; **nothing covers the guards or the backstop** |
| `:905` | auto-seed does not re-run once the operator owns the baseline (C-MARK-14) | `selector-seed.test.ts` covers seeding, `content-loader.content.ts:735` implements the guard — **untested** |
| `:954` | first exclude-click on a default boundary unmarks it, no 2-click promote (C-MARK-9) | `marking.test.ts:310` covers the toggle-off case |
| `:967` | curtain shows a single spinner; page-inspection notice hides under popup-busy (C-LIFE-6) | none |
| `:998` | **consent hiding runs on every resolved property page, decoupled from the silent directive** (C-LIFE-1) | implemented `content-loader.content.ts:361-386` — **untested** |
| `:1041` | S3: mid-scroll paint verdicts are not persisted | none — the rewrite has no scroll-phase concept |
| `:1092` | popup-busy overlay independent from reveal/freeze UI | none |

**Weakness.** The rewrite's only scheduling primitive is `scheduleRender`'s rAF coalescing, and even
that is unpinned. There is no debounce anywhere in the content tree (grep for `setTimeout(` in
`src/content/` + the content entrypoint returns exactly two hits: the rAF fallback and the 8-second
ritual-ready timeout at `content-loader.content.ts:526`). Every write is immediate. That is defensible
as a simplification — but it is a *decision*, and nothing records or defends it.

### 4.3 Motion pause — `core-motion-pause` → PARTIAL, with two contracts unimplemented

**Legacy behaviour.** 25 tests, 1,539 lines. Split into three groups:

1. **Reveal ritual (C-FRZ-1)** — `:727-1253`: scroll top→bottom→reserved point; bottom-scroll settles;
   dwell at the goal; pages without scroll room; repeat bottom scrolls while lazy growth continues;
   **the freeze engages at the ABSOLUTE BOTTOM, before the return scroll** (`:866`); an aborted reveal
   never releases a lock it did not engage (`:905`); **concurrent warmups JOIN the in-flight ritual**
   (`:939`); lazy-load suppression restored in `finally` on success (`:963`), retained until motion
   resumes (`:1033`), restored on throw (`:1095`).
2. **Motion normalisation (C-FRZ-4)** — `:1253`, `:1295`, `:1322`: scroll-reveal candidates are forced
   to `opacity:1 !important`, `transform:none !important`, `filter:none !important`, tagged with
   `PAGE_MOTION_LOCK_ATTR`, **restored exactly on resume**, and **stripped from sanitized snapshots**;
   attribute-driven Webflow reveals (`data-w-id`) are normalised too; **semantically hidden carousel
   slides and `aria-hidden` modals stay hidden**.
3. **Lock discipline (C-FRZ-2, C-PERF-6)** — `:1361` the freeze is a page-visit lock held through phase
   transitions until navigation; `:574` maintenance refresh skips the full-document scan (the post-AI
   CPU-storm guard); `:626` incremental discovery locking; `:659` extension-owned UI is skipped.

**Rewrite status.**

- Group 1: **covered, and covered well.** `tests/src/content/stabilization/stabilization.test.ts:38,61,82,277,307,325,342,362`
  plus `src/content/stabilization/reveal.ts:17-52` (a 53-line pure function, injected `scrollTo`/
  `suppressLazyLoading`/`freezeAtBottom`). `:277` asserts top→half→bottom→restore with the freeze at
  the bottom. `:362` covers the ownership case. This is a straight improvement over legacy: the same
  contract, testable without a DOM.
- Group 2: **not implemented.** `src/content/stabilization/freeze.ts` is 33 lines — a `Set<FreezeReason>`
  plus a deferred-callback queue. It touches no DOM. Grep for `opacity|animation|transition|getAnimations|transform`
  over `src/content/` returns only consent hiding (`src/content/consent.ts:59,113`) and visibility
  reads (`dom-view.ts:90,143`). **There is no motion normalisation, no motion lock attribute, no
  snapshot stripping of freeze artefacts, and therefore no possibility of the C-FRZ-4 regression.**
- Group 3: partially — `freeze.ts:7-9` correctly makes every `pause(reason)` also hold `"page-visit"`
  (C-FRZ-2), and `stabilization.test.ts:21` proves it. The maintenance/CPU-storm half (C-PERF-6) does
  not apply because there is no sweep.

**Weakness.** C-FRZ-3 (freeze CSS animations/Web Animations/SVG/media) and C-FRZ-4 (reveal
normalisation vs semantic hiding) are **locked contracts with zero implementation**. The page-world
program does freeze *timers* (`tests/src/page-world/program.test.ts:34,106,281`), which handles
JS-driven animation, but not CSS animation, not `element.animate()`, not autoplay media, and it does
not normalise a `opacity:0; transform:translateY(32px)` scroll-reveal that never fired because the
element never entered the viewport. On a Webflow/AOS property the operator will be marking invisible
content. This is the single largest behavioural hole the test corpus exposes.

### 4.4 Render-mode inspection — `background-render-mode-inspection` → PARTIAL

**Legacy behaviour.** All seven tests are class-C source-regex pins against `src/background.ts`. Their
*subjects*:

- only granular helper commands are tab-scoped; `TAB_RUN_RENDER_MODE_INSPECTION` was deliberately
  removed (`:12-19`);
- `executeRenderModeInspection` orders: begin-step → wait for load start → reload with JS control →
  (JS off: debugger capture) / (JS on: hide-consent step **then** capture step) → end-with-retry →
  clear the no-JS hold (`:39-52`);
- the end path restores JavaScript, detaches the debugger, clears the inactivity watch, and records
  `{inspecting:false, noJsHeld:false}` (`:54-65`);
- **a 30-second `alarms`-backed inactivity watchdog restores JavaScript** if the operator wanders off
  while a no-JS hold is active (`:67-81`);
- consent hiding is a **separate step** from HTML capture (`:83-93`).

**Rewrite status.** The reload + CDP JS control is implemented and tested
(`tests/src/content/stabilization/stabilization.test.ts:230,247`; served over the bus at
`tests/src/background/startup.test.ts:192`). The consent-before-capture ordering is implicitly
satisfied because consent hiding is unconditional and continuous (`content-loader.content.ts:361`).

**Weakness.** **No inactivity watchdog.** `alarms` appears in the rewrite only for the auth-token
monitor (`src/background/index.ts:72-98`). If the operator opens Render Mode with JavaScript off and
then switches tabs, the property stays JS-disabled indefinitely; the only recovery is another explicit
action. Legacy treated this as important enough to add an `alarms` permission for.

### 4.5 Config writes — `config-store-queue` → PARTIAL, aimed at the wrong blob

**Legacy behaviour.** Three tests (`legacy:tests/config-store-queue.test.ts:127,173,214`) that hold the
first IndexedDB `set` open with a deferred gate and prove:

- two `updateConfig` calls on the **same** base URL serialise — the second must not start until the
  first finishes, and both mutations survive;
- two on **different** base URLs both survive;
- `ensureConfig`'s default-creation write does **not** clobber a concurrently queued newer update.

This is the test that exists because of the production incident where a 200 `/save` wiped all page
markings via a half-snapshot write.

**Rewrite status.** `src/background/services.ts:117-131` implements exactly this pattern — a single
promise chain — **for the settings blob**, with two good tests (`tests/src/background/services.test.ts:189`
"serializes concurrent settings writes so neither loses the other's field", `:214` "keeps a rotation and
an endpoint save from losing each other"). The comment at `services.ts:118-120` even states the
rationale correctly.

**Weakness.** The same reasoning was not applied one level over. `createConfigRepo`
(`src/storage/repositories/config.ts:18-37`) is a bare get/set. `applyBackendLoad`
(`src/background/services.ts:164-192`) reads `localPropertyRepo`, then writes it — unserialised, and
called from load, save, and render-mode-remember paths. `rememberRenderMode` (`:204-217`) is the same
shape. Two navigations racing in one tab, or a load and a save overlapping, will lose one writer's
field, and the settings test proves the team already knows this failure mode exists.

### 4.6 Brain projection dedup — `brain-projection-dedup` → NONE, and inverted

**Legacy behaviour.** One test, 84 lines, pinning **C-BRAIN-4**: reporting byte-identical facts three
times produces **one** `POPUP_STATE_EVENT_TYPES.VIEW_UPDATED` but **three** `directive.content`
broadcasts, and a real fact change resumes popup broadcasting
(`legacy:tests/brain-projection-dedup.test.ts:63-82`). The comment states the reason: *"content has no
pull"* — content is a push-only subscriber, so a freshly reloaded content script must still receive the
current directive.

**Rewrite status.** `src/background/brain/project.ts` is 46 lines and has no dedup at all; it is a pure
`facts → phase` function. The directive push lives in `src/background/lock-runtime.ts:118-124`:

```ts
const publishDirectiveIfChanged = (key: string, tabId: number, directive: unknown): void => {
  const serialized = JSON.stringify(directive);
  if (publishedDirectives.get(key) === serialized) {
    return;
  }
  ...
};
```

`key` is `${tabId}:${siteId}` (`:143`) and the cache is cleared only in `releaseKey` (`:133`), i.e. on
lock release or active-key change — **not** on content-script reload, not on same-URL navigation, not
on render-mode inspection reload.

**Weakness.** This is C-BRAIN-4 exactly backwards. A same-URL reload (which render-mode inspection
performs deliberately) re-instantiates the content script with an empty directive while the background
believes the directive is already delivered. The popup's own `composeContentDirective` push
(`src/entrypoints/popup/main.tsx:674-707`) papers over this **only while the popup is open** — and
C-LIFE-7 explicitly requires content to work with the popup never opened. Nothing tests either half.

### 4.7 Activation order — `content-activation-order` → PARTIAL

**Legacy behaviour.** Class-C, but the subjects are contracts:

- `:39` `refreshFromTabState` restores an enabled page **without re-running reveal/freeze** — the
  regression it guards is a second reveal on every popup refresh;
- `:58` `main()` restores tab state, *then* refreshes highlight state, with no initial reveal;
- `:94` the mutation observer re-runs `hideConsentElements()` on late childList insertions (C-LIFE-1);
- `:112` manual page enable **awaits** activation reveal before refreshing highlights, and on failure
  disables, releases the property lock, toasts, and writes `enabled:false` back to tab state;
- `:133` editor reveal waits for render-mode inspection to clear **and** a confirmed render mode
  (C-FRZ-7 / C-LIFE-3);
- `:151` `setEnabled` may request an initial reveal, but only by *consuming* a per-page-visit attempt
  token (`consumePageVisitRevealFreezeAttempt`);
- `:239` every async content message branch answers `{ok:false}` when the delegated work rejects.

**Rewrite status.** `src/content/activation.ts` is a 50-line gate (armed / pageUrl / silentHighlightArmed
/ stabilizationArmed). `tests/c4-content-entrypoint.test.ts` covers registration without legacy
loading (`:74`), engine reuse and overlay disposal (`:116`), pause/resume without clearing dirty (`:278`),
**stale activation rejection by pageUrl** (`:348`), same-document URL deactivation (`:392`), and
directive gating of data-affecting commands (`:489`). The once-per-visit reveal token is covered
behaviourally at `stabilization.test.ts:307,325`.

**Weakness.** Three subjects unproven: (a) consent hiding runs unconditionally and *first*, before any
directive can bail out — the code says so in a comment at `content-loader.content.ts:354-360` and
nothing tests it; (b) the failure path of enable (disable + lock release + operator-visible toast);
(c) the async-rejection contract for command handlers — `src/content/command-router.ts` has no test
file of its own.

### 4.8 Page-data lifecycle — `background-page-data-lifecycle` → NONE

**Legacy behaviour.** Six tests, and unusually for a background test, five of them are *behavioural*
(`createPageDataLifecycleLoader` takes injected deps):

- `:62` three concurrent loads for one navigation collapse into **exactly one** `/load`;
- `:101` one load per committed navigation, reused for popup refresh; call order `["load","replace","content"]`;
- `:123` a **stale cached siteId is re-validated against the backend**, the load uses the corrected id,
  and the local cache is updated (`configs[...].siteId === 60`);
- `:152` when re-validation is unavailable the cached siteId is kept — an offline backend must not
  break navigation loads;
- `:177` a backend 404 becomes wipe-plus-notify: `["load","clear-missing","clear-reconciliation","content","content"]`
  with the final message `{type:"configUpdated", baseUrl, forceReloadPageEntry:true}`.

**Rewrite status.** The subsystem does not exist. The rewrite registers no `webNavigation` listener
anywhere. Property data is loaded when the popup asks (`tests/src/background/startup.test.ts:377`
"reads a property's stored config back over the bus"), and the backend-authority rules live in
`services.ts:164-192` with good tests (`tests/src/background/property-authority.test.ts`, 9 tests).

**Weakness.** This is an architectural choice (popup-driven rather than navigation-driven), and it is
defensible. But it collides with **C-LIFE-7** — content must activate and silently highlight on any
configured property page *with the popup never opened*. Without a navigation-driven load there is no
moment at which the background learns a tab landed on a property. The dedupe and stale-siteId
re-validation tests have no counterpart because there is nothing to dedupe. If C-LIFE-7 is honoured
later, all five behaviours come back with it, and legacy's test file is the specification.

### 4.9 Storage boundary — `storage-access-boundary` → NONE (a locked contract with no guard)

**Legacy behaviour.** Two tests (`legacy:tests/storage-access-boundary.test.ts:134,188`) that walk the
whole repo, regex every source line for `chrome.storage.`/`wxt/utils/storage`/`storage{Get,Set,Remove,Clear}(`
and for `window.{local,session}Storage`, and require **every** hit to fall in exactly one declared
bucket. The migration-debt bucket is asserted **empty** (`:185`), so any new raw access fails the build.
This is the enforcement clause of **C-BRAIN-13**, and the contract text names the test file by path.

**Rewrite status.** The rewrite is currently *clean*: grep for `chrome.storage|browser.storage|storage.local|storage.session`
over `src/` returns nothing, and `localStorage|sessionStorage` returns nothing. Persistence goes through
`KeyValueStore` (`src/storage/repositories/key-value.ts:23-28`) with an IndexedDB implementation
(`:50-90`) chosen in `src/background/services.ts:38-41`. `tests/src/domain/import-boundary.test.ts`
guards `src/domain` against DOM/browser/React imports — a different, narrower boundary.

**Weakness.** The property is held by discipline, not by a test. C-BRAIN-13 is one of the study's
*locked* contracts and its stated enforcement mechanism does not exist in the rewrite. This is the
cheapest gap on the list to close — it is a ~40-line repo walk with a per-file allowlist, and the
allowlist starts at `["src/storage/repositories/key-value.ts"]`.

### 4.10 Command ledger — NONE

**Legacy behaviour.** `redactCommandPayloadForLedger` (`legacy:tests/command-ledger.test.ts:11-87`)
redacts `tokenValue`/`globalToken`/`password`/`payloadKey`, `Authorization`/`Cookie` headers, JWT-shaped
strings, and summarises `renderedHtml`/`rawHtml` to `[redacted:renderedHtml:<len>]`; caps object keys
and array previews; survives circular references; returns `undefined` for non-objects.

**Rewrite status.** No such helper. `console.debug`/`console.error` calls pass raw values (e.g.
`src/background/services.ts:141-143` logs a token-persist error object).

**Weakness.** Low product risk, real support risk: the rewrite has a popup event log
(`src/popup/event-log.ts`) that operators can read, and nothing prevents a JWT or a 300 KB
`renderedHtml` from landing in it. Not a cutover blocker.

---

## 5. UX elements the test corpus says to bring over

These are behaviours that *only* the legacy tests record — no source file in the rewrite implements them.

1. **Marking cursors.** `legacy:tests/marking-cursor.test.ts:13` — the exclude cursor must never fall
   back to the browser's `not-allowed` glyph; `:21` — cursor images are pre-warmed with GC-held
   references so the first hover does not flash. The rewrite **ships** `src/public/cursors/exclude.svg`
   and `include.svg` and references neither (grep over `src/` for `cursors/`: zero hits outside the
   asset directory).
2. **Preview-sidebar focus.** `legacy:tests/focus-handler.test.ts:45,60` — clicking a preview row
   focuses the element in the page and syncs the preview xpath; clearing resets it. The rewrite's rows
   are inert: `src/popup/App.tsx:896` renders `<div className="preview-sidebar__item-button" aria-disabled="true">`.
3. **Human-readable row labels.** `legacy:tests/describe-xpaths-handler.test.ts:6` — a row shows the
   element's text label, and only for *visible* elements. The rewrite shows the raw XPath
   (`src/popup/App.tsx:901`). The legacy handler is dead code, but the capability is what the sidebar
   needs to be usable; port the *idea*, not the handler.
4. **Motion-pause indicator.** C-FRZ-5, exercised through `legacy:tests/core-motion-pause.test.ts:496`
   ("shows an indicator"). No rewrite counterpart — consistent with §4.3, since there is no motion pause.
5. **Curtain copy per state.** `legacy:tests/content-overlay-memory.test.ts:32` pins the exact page-side
   copy: compute-lock shows `PopupText.overlay.computingSelectors` **and blocks page input**; restoring
   shows `ContentText.marking.pageInspection` and **does not** block input; silent/marking/preview show
   no curtain. The rewrite's page curtain (`src/entrypoints/content-loader.content.ts:320-334`) renders
   whatever text arrives and always uses the same inline styling; the input-blocking distinction is
   carried only by `markingEditsBlocked`, and no test pins the pairing.
6. **Enable-failure recovery.** `legacy:tests/content-activation-order.test.ts:112-123` — a failed
   enable disables marking, releases the property lock, shows `"Unable to activate on this page"`, and
   writes `enabled:false` back to tab state. No rewrite counterpart.

---

## 6. Must port before cutover

Ordered. "Port" here means *the subject must be proven by a rewrite test*; for class-C legacy tests the
body cannot be copied.

**Tier 1 — a locked contract is unenforced or inverted. Do not cut over without these.**

| # | new test | proves | replaces |
|---|---|---|---|
| 1 | storage-access boundary walk over `src/`, allowlist = `src/storage/**` | **C-BRAIN-13** | `legacy:tests/storage-access-boundary.test.ts` |
| 2 | directive push is **not** deduped; a re-activated content script re-receives the current directive | **C-BRAIN-4** | `legacy:tests/brain-projection-dedup.test.ts` |
| 3 | concurrent `configRepo`/`localPropertyRepo` read-modify-writes both survive | C-SAVE-4 + the production wipe incident | `legacy:tests/config-store-queue.test.ts` |
| 4 | hover resolution is cached per probe-stack and invalidated on render/geometry change | C-PERF-3, C-PERF-5 | `legacy:tests/core-hover-performance.test.ts` |
| 5 | consent hiding runs on every property page before any directive gate, and re-runs on late insertions | **C-LIFE-1** | `legacy:tests/core-scheduling.test.ts:998` + `content-activation-order.test.ts:94` |
| 6 | required consent selectors are **present** (`dialog[open]`, `aria-modal`, `alertdialog`, gdpr, interstitial) | C-LIFE-2 | `legacy:tests/consent-selector-precision.test.ts:8` |

**Tier 2 — behaviour exists but is unpinned; a refactor can silently break it.**

| # | new test | proves | replaces |
|---|---|---|---|
| 7 | auto-seed does not re-run once the operator owns the baseline | C-MARK-14 | `legacy:tests/core-scheduling.test.ts:905` |
| 8 | branch-scoped rebuild falls back to FULL on >1 pending toggle / fingerprint change / stale stash, and a trailing FULL always runs | C-PERF-4 | `legacy:tests/core-scheduling.test.ts:843` |
| 9 | silent-highlight redraw settles after movement, has a max-settle timeout, and force-repaints on a full active refresh | C-SIL-1 | `legacy:tests/silent-highlight-rules.test.ts:39-78` |
| 10 | submission row rules (a)–(j) enumerated one test per rule | C-SUB-2 | `legacy:tests/submission-rules.test.ts` (19) |
| 11 | `command-router` gating: baseUrl mismatch, missing config, non-editor lock, reconciliation, edits-blocked; async rejection ⇒ `ok:false` | routing surface | `legacy:tests/runtime-message-handler.test.ts` + `content-activation-order.test.ts:239` |
| 12 | emulation posture survives an MV3 worker restart, and a disabled choice is preserved for the session | C-EMU-1 | `legacy:tests/device-emulation-lifecycle.test.ts:234-284` |
| 13 | a no-JS hold is released by an inactivity watchdog | C-FRZ-7 operational half | `legacy:tests/background-render-mode-inspection.test.ts:67` |

**Tier 3 — needs an implementation decision first (see §7); write the test with the feature.**

| # | subject | contract | source |
|---|---|---|---|
| 14 | motion normalisation vs semantic hiding | **C-FRZ-4** | `legacy:tests/core-motion-pause.test.ts:1253,1295,1322` |
| 15 | CSS-animation / Web-Animations / media freeze | **C-FRZ-3** | `legacy:tests/core-motion-pause.test.ts:496` |
| 16 | silent-whitespace generated exclusions | **C-MARK-12** | `legacy:tests/core-visibility.test.ts:2337,2370,2411` |
| 17 | per-navigation page-data load with in-flight dedupe and stale-siteId re-validation | C-LIFE-7, C-SAVE-4 | `legacy:tests/background-page-data-lifecycle.test.ts` |
| 18 | scheduling policy (debounce / idle / synchronous user draws) | C-PERF-1, C-PERF-2 | `legacy:tests/core-scheduling.test.ts:355-579` |

**Do not port** (dead handlers with tests, confirmed by repo-wide sender grep):
`legacy:tests/default-exclusions-handler.test.ts`, `legacy:tests/describe-xpaths-handler.test.ts`,
`legacy:tests/invisible-xpaths-handler.test.ts` — all three pin branches in
`legacy:src/content/runtime-message-handler.ts:206,230,235` whose message types
(`getDefaultExclusions`, `filterInvisibleXpathsOnPage`, `describeXPathsOnPage`) are sent by nothing in
the repository. Port the *capability* of `describeXPaths` only (§5.3).

---

## 7. Per-slice: which test proves it

The sentence the critic asked for, per slice, with the honest gap named.

| slice | primary proof today | strongest gap |
|---|---|---|
| **P0** pure domain | `tests/src/domain/{visibility,evaluate,widening,boundary,xpath,taxonomy,selector-seed}.test.ts` — 34 tests; `import-boundary.test.ts` guards the layer | 34 tests replace legacy's 87+11+19. Missing: silent-whitespace (C-MARK-12), full C-SUB-2 enumeration, fixed/off-viewport visibility cases |
| **P1** messaging bus | `tests/src/messaging/{bus,contracts}.test.ts` + `transports/{page,runtime}.test.ts` — 32 tests | No test for the C-BRAIN-13 messaging-shape clause (raw runtime shape popup/content→background) |
| **P2** storage | `tests/src/storage/repositories.test.ts` — 12 tests (schema validation, wrong-key rejection, baseline/draft separation) | **No write serialisation for config/local-property; no storage-access boundary** |
| **P3** brain | `tests/src/background/brain.test.ts` — 15 tests (fold, signals, persistence, cursor, born-at-source) | **No projection/directive dedup asymmetry (C-BRAIN-4)** |
| **P4** lynx clients | `tests/src/lynx/{accounts,ai-graphql,ai-job,rest,token-rotation}.test.ts` — 34; `services.test.ts` — 21 | Settings queue proven; AI-run start-UX ordering (C-SUB-6) and timeout single-source (C-SUB-7) unproven |
| **P5** stabilization | `tests/src/content/stabilization/stabilization.test.ts` — 20; `tests/src/page-world/program.test.ts` — 15 | **C-FRZ-3 and C-FRZ-4 unimplemented**; no inactivity watchdog; emulation posture not durable |
| **P6** marking engine | `tests/src/content/marking/{marking,dom-bridge}.test.ts` — 47; `tests/golden/ai-snapshot.test.ts` — 1 | **No hover cache, no render scheduling policy, no CP7b guard coverage, no silent-highlight settle** |
| **P7** content runtime | `tests/c4-content-entrypoint.test.ts` — 7 | **No `command-router` test file; consent wiring untested; enable-failure path untested** |
| **P8** popup organs | `tests/src/popup/{app,entrypoint,organ,view,signal-cursor,event-log}.test.ts` — 114 | Best-covered slice. Page-side curtain contract (C-FSM-3 / C-LIFE-6) is popup-only |
| **P9** property lock | `tests/src/lock/lock.test.ts` — 10; `tests/src/background/property-authority.test.ts` — 9; `tests/orchestration-property-lock-scenario.test.ts` — 5 | Directive dedup lives here (`lock-runtime.ts`) and is untested |
| **P10** cutover | `tests/integration/rewrite-cutover.test.ts` — 9; `tests/build-artifact-parity.test.ts`; `tests/manifest-permissions.test.ts` | These prove *structure*, not *behaviour parity*. There is no test whose failure means "the rewrite behaves differently from production" |

That last row is the summary of this whole report: **the rewrite's cutover gate checks that the old
files are gone, not that the new ones do what the old ones did.**

---

## 8. Weaknesses in the legacy corpus itself (do not import these)

1. **37% of files regex source text.** `legacy:tests/background-render-mode-inspection.test.ts:48` is a
   single `assert.match` with a 400-character regex over `src/background.ts`. It fails on whitespace.
   It passes on a semantically broken reorder that happens to keep the token sequence. Porting the
   *style* would re-import the rewrite's worst possible future.
2. **Tests that pin dead code.** Three of the twenty named tests (§6) protect handlers no one calls.
   They contribute to the 1,194 and to nothing else.
3. **`core-visibility` is 3,043 lines in one file.** 87 tests across ~8 distinct subjects
   (visibility, shadow, widening, default-layer projection, sync, submission geometry, snapshot
   xpaths, whitespace). The rewrite's split into `src/domain/*` + one test file per module is
   materially better; keep it.
4. **VM-transpilation harnesses.** `legacy:tests/core-hover-performance.test.ts:29-48` and
   `collect-ai-submission-xpaths.test.ts:71-86` extract functions from a god file by brace-counting and
   run them through `ts.transpileModule` into `runInNewContext`. This existed only because the code was
   untestable. The rewrite has real modules; the counterparts should be ordinary imports.

---

## 9. Product-owner questions

These are genuine product decisions, not code questions.

1. **Motion freeze (C-FRZ-3/C-FRZ-4) — is it in scope for v2.0, or is timer-freezing enough?** The
   rewrite freezes JS timers and lazy-load observers but does nothing to CSS animation or to
   scroll-reveal elements that never entered the viewport. On animation-heavy properties (Webflow, AOS)
   the operator will mark a page whose content is at `opacity:0`. Restoring the legacy behaviour is a
   substantial, risky module (it writes `!important` inline styles to arbitrary customer DOM and must
   restore them exactly). The alternative is to accept it and tell editors to scroll manually. Which?

2. **Does content still have to work with the popup never opened (C-LIFE-7)?** The rewrite has no
   `webNavigation` listener; property data and directives flow from the popup. If C-LIFE-7 stands, the
   navigation-driven page-data lifecycle (and its dedupe / stale-siteId revalidation / 404 wipe rules)
   must be rebuilt. If it does not, C-LIFE-1 (consent hiding on all property pages) has to be re-scoped
   too, since today it is triggered by the same directive path.

3. **Silent-whitespace generated exclusions (C-MARK-12) — keep or drop?** Legacy silently excludes
   visible renderable blocks with no text, hides them from marking UI and include targeting, and drops
   the rows when text appears (`legacy:tests/core-visibility.test.ts:2337,2370,2411`). The rewrite has
   no such concept. This changes what the AI receives on every page. Was it dropped deliberately as
   part of the unified-row redesign, or overlooked?

4. **Preview sidebar: identifiers or content?** Legacy showed element text labels and let the operator
   click a row to focus that element in the page. The rewrite shows raw XPaths in inert rows. Restoring
   labels needs a content round-trip per preview open; restoring focus needs a page-side handler. Are
   both required for editor acceptance, or is the XPath list sufficient for v2.0?

5. **How long may a tab stay JavaScript-disabled?** Legacy auto-restored after 30 seconds of tab
   inactivity, at the cost of an `alarms` permission and a reload the operator did not ask for. The
   rewrite holds the state until told otherwise. Which behaviour do editors want — a page that quietly
   heals itself, or one that stays exactly as they left it?

6. **What is the cutover bar?** `tests/integration/rewrite-cutover.test.ts` currently gates on structure
   (god files deleted, no orphan modules, one entrypoint boots). Should the gate additionally require
   the Tier-1 list in §6 to be green, and should a live smoke run against the three reference properties
   (bonliva 117 / prowork 76 / vitec-pyramid 57 included-visible counts, named in C-LIFE-2) be a
   release condition rather than a manual step?
