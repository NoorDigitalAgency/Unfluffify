# Rewrite Implementation State — what actually exists on `re-write` today

**Tree read:** `/home/rojan/Documents/Git/GitHub/Unfluffify`, branch `re-write`, HEAD `3bdf976f`
(2026-08-14 08:51 +0200), working tree clean.
**Legacy reference tree:** `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`
(worktree of `main`, v1.10.0+3).

All `file:line` citations are relative to the rewrite root unless prefixed `legacy:`.

**Method.** Read `git log --oneline 28974c2a..re-write` (67 commits) and the diffstat of the last
20; read in full `src/popup/App.tsx`, `src/entrypoints/popup/main.tsx`, `src/popup/{view,store,
event-log,signal-cursor}.ts`, `src/popup/organ/{machine,memory}.ts`, `src/entrypoints/
content-loader.content.ts`, all of `src/content/**`, `src/background/**`, `src/lock/**`,
`src/storage/**`, `src/messaging/realms.ts`, `src/lynx/rest.ts`, `wxt.config.ts`, the CSS layer,
and the entrypoints; grepped the whole tree for TODO/stub markers and for every legacy feature
keyword; ran `pnpm test` (green, see §2); diffed the anti-false-done cutover guard against
`8affd8a2`; cross-read `.reimplementation/audit{,-2,-3}.md` and the committed study reports
`legacy-popup-ux.md` / `legacy-content-ux.md` for the legacy baseline.

---

## 1. Headline verdict

The rewrite is **no longer the "marking-only prototype" the three audits describe**. Since
audit #3 (`8affd8a2`, 2026-07-08) roughly 30 further commits wired the whole spine: the typed
bus, storage, the Lynx REST/AI/GraphQL clients, the property-lock WebSocket client, CDP
emulation, render-mode inspection, the offscreen XPath refiner, accounts/login with token
rotation, consent hiding, and the reveal/freeze page ritual are all **reachable and invoked on
the real runtime path** — not merely imported. The cutover guard's own reachability assertions
pass without having been weakened (`git diff 8affd8a2 -- tests/integration/rewrite-cutover.test.ts`
is empty).

What the rewrite is **not** is UX-complete against legacy. It is best described as:

> **A functionally complete operator spine with a deliberately minimal, tester-oriented UI.**
> Every backend-facing capability legacy has, except *Send to Lynx* (the
> `updateScrapingConditions` publish) and the *Lynx page-type checklist / Todo list*, exists
> and runs. Almost every *presentational* legacy affordance — toasts, per-tab action icon,
> theme application, logo, custom cursors, the 10-layer/per-client-rect overlay grammar, page
> toasts, the in-page property-lock banner with takeover buttons, the page-side AI preview with
> focus/copy, the spinner-phase contract, hotkeys — is absent or reduced to a single generic
> equivalent.

Two structural defects found while reading are worth escalating before any parity plan is
written: the **save half-snapshot** (§8.1) and the **synchronous reveal walk** (§8.2).

---

## 2. Gate and size facts (verified, not quoted)

| Fact | Value | Evidence |
|---|---|---|
| Test suite | **58 files / 485 tests, all green**, 10.4s | `pnpm test` run in this session |
| Cutover guard | 9/9 assertions pass; **not weakened** since `8affd8a2` | `git diff 8affd8a2 -- tests/integration/rewrite-cutover.test.ts` → empty |
| Orphaned feature files | **zero** (`PENDING_DELETION_PATHS` is an empty set) | `tests/integration/rewrite-cutover.test.ts:69,265-273` |
| Legacy god-files | all five deleted | guard `:71-77,234-236` |
| Rewrite source | **13,157 lines** TS/TSX/JS under `src/` (excl. CSS) | `find src -name '*.ts*' -o -name '*.js' \| xargs wc -l` |
| Largest files | `entrypoints/popup/main.tsx` 1,799 · `popup/App.tsx` 1,179 · `entrypoints/content-loader.content.ts` 868 | `wc -l` |
| TODO/FIXME/stub markers in `src/` | **zero** (only `.todo-*` CSS class names inherited from the legacy theme, and `placeholder=` form attributes) | grep over `src/**` |
| `@ts-ignore` / `@ts-nocheck` | zero (ratcheted by `tests/no-ts-ignore-guard.test.ts`, `tests/typing-ratchet.test.ts`) | grep + tests |
| Manifest | byte-identical permission set + action shape to legacy (`sidePanel`, `debugger`, `offscreen`, …; **no `default_popup`**, no `options_ui`) | `wxt.config.ts:52-86` vs `legacy:wxt.config.ts:50-85` |

The suite dropped from audit #2's 805 tests to 485 because the ~207 orphaned legacy-era files
and their unit tests were deleted; the remaining tests exercise reachable code.

---

## 3. Runtime map — what is mounted where

Five WXT entrypoints, all on the new tree:

| Entrypoint | Mounts | Evidence |
|---|---|---|
| `src/entrypoints/background.ts` | `startRewriteBackground()` | `:1-6` |
| `src/entrypoints/content-loader.content.ts` | activation gate, freeze/reveal controllers, SPA guard, marking engine, consent sweep, typed command router, `<all_urls>` @ `document_start` | `:21-28,859-868` |
| `src/entrypoints/page-world.content.ts` | `page-world/program.js` (MAIN world, allFrames, `document_start`) + a page-realm bus | `:1-31` |
| `src/entrypoints/popup/main.tsx` | React root, 500 ms poll loop, all popup handlers | `:50-56,482-487` |
| `src/entrypoints/offscreen/main.ts` | `offscreen.refineXpaths` handler over the typed bus | `:1-13` |

`startRewriteBackground` (`src/background/index.ts:62-362`) constructs: the per-tab signal brain
runtime + MV3 alarm keepalive (`:69-81`), the auth-token monitor (`:82-101`), the typed realm bus
(`:102-105`), the CDP render/emulation runtime (`:106-109`), the property-lock runtime
(`:110-133`), and registers **21 bus commands** (`:134-354`) plus `action.onClicked` → side panel
(`:355-361`).

The surface is a **Chrome side panel**, as in legacy: `action` carries only `default_title`
(`wxt.config.ts:7-9,57`) and the click handler binds `popup.html` to the tab's side panel
(`src/background/index.ts:32-43,359-361`). Tab binding is by **500 ms polling** of
`tabs.query({active:true})` (`main.tsx:294-298,482-487`), not by `tabs.onActivated`/`onUpdated`
listeners as legacy used (`legacy:popup.ts:9699-9833`); functionally equivalent for a panel that
must follow the active tab, with a ≤500 ms lag.

---

## 4. Popup — every view, control and string that exists today

### 4.1 View model

Five views resolved from one pure function: `loading | configuration | render-mode | marking |
silent` (`src/popup/view.ts:13`, resolver `:60-76`, wired `main.tsx:194-205`). Resolution order:
settings-unread → `loading`; `!configurationComplete` → `configuration` **locked**; lock release
snaps back to the session view; explicit request honoured; otherwise render-mode-unset →
`render-mode`, else silent/marking. This reproduces legacy's three-view model
(`legacy:popup.ts:5836-5847`) with legacy's intra-Marking flags (`renderModeSectionVisible`,
`mainUiHidden`, `silentModeActive`) promoted to first-class views. `configurationComplete` =
three endpoints stored + a token held + token not rejected (`main.tsx:185-192`) — the same
predicate as legacy (`legacy:popup.ts:5633-5637`).

### 4.2 Control inventory (status per control)

| # | Control / element | id | View | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Header title + broom icon (**no logo image**) | — | all | IMPLEMENTED (reduced) | `App.tsx:436-444` |
| 2 | State-name readout (`silent`, `pre_ai_dirty`, …) + `· idle` / `· marking suspended` | — | all | IMPLEMENTED (rewrite-only tester affordance) | `App.tsx:440-444` |
| 3 | Connection settings (gear) | `config-header-open` | non-config | IMPLEMENTED | `App.tsx:463` |
| 4 | Back to marking (arrow) | `config-header-back` | config | IMPLEMENTED, disabled until setup complete | `App.tsx:451-457` |
| 5 | Page URL readout (`title`=full URL) | `page-url-readout` | all | IMPLEMENTED | `App.tsx:475-483` |
| 6 | Property-lock strip: icon, status text, `status/role/site` detail, countdown | — | all | PARTIAL — no takeover/accept/reject/continue buttons | `App.tsx:488-521` |
| 7 | Refresh | `lock-refresh` | all | IMPLEMENTED (re-pulls signals, lock, content status, auth, config) | `App.tsx:511`, `main.tsx:1176-1193` |
| 8 | "No content script on this tab" alert | `data-content-unreachable` | all | IMPLEMENTED (rewrite-only) | `App.tsx:523-528` |
| 9 | Setup-problem alert (unreadable / unconfigured / signed_out / unreachable) | `data-setup-required` | all | IMPLEMENTED (rewrite-only, 4 distinct strings) | `App.tsx:530-544` |
| 10 | Enable marking checkbox | `toggle-enabled` | marking+silent | IMPLEMENTED; disabled on lock block or unset render mode | `App.tsx:566-574` |
| 11 | Desktop preview checkbox | `desktop-preview-enabled` | silent only | IMPLEMENTED | `App.tsx:590-595`, `main.tsx:1159-1174` |
| 12 | Render mode row + edit button | `render-mode-open` | marking+silent | IMPLEMENTED | `App.tsx:606-614` |
| 13 | Run AI | `compute` | marking | IMPLEMENTED | `App.tsx:624-633`, `main.tsx:1506-1595` |
| 14 | Save | `page-save` | marking | IMPLEMENTED | `App.tsx:635-644`, `main.tsx:1597-1678` |
| 15 | Discard | `page-revert` | marking | IMPLEMENTED | `App.tsx:646-656`, `main.tsx:1708-1727` |
| 16 | "Content list" | `marking-preview` | marking | **VESTIGIAL** — only flips popup state; no page-side preview and no exit control (§8.3) | `App.tsx:658-668`, `main.tsx:1680-1706` |
| 17 | Run countdown `M:SS` | `data-run-countdown` | marking+silent | IMPLEMENTED (from `run.started.deadlineAt`) | `App.tsx:553-557`, `memory.ts:37-50` |
| 18 | Blocked-reason hint line | `data-blocked-reason` | marking+silent | IMPLEMENTED | `App.tsx:681-691` |
| 19 | Diagnostics "Status" card: Base URL, Account, Config, Content script, Marked rows, AI selectors, Run session | `data-stat` | all | IMPLEMENTED (**rewrite-only**, no legacy analogue) | `App.tsx:695-739` |
| 20 | Render-mode step 1: With/Without JavaScript loads | `render-mode-with-js`, `render-mode-without-js` | render-mode | IMPLEMENTED | `App.tsx:776-797`, `main.tsx:1314-1349` |
| 21 | Render-mode view narration + "load JS back" warning | `data-render-mode-view` | render-mode | IMPLEMENTED | `App.tsx:250-254,798-807` |
| 22 | Render-mode step 2: two radios (`rendered`/`static`), keyboard-reachable | `render-mode-rendered`, `render-mode-static` | render-mode | IMPLEMENTED | `App.tsx:821-841` |
| 23 | Set / Confirm render mode (CTA commits the pick) | `render-mode-set` | render-mode | IMPLEMENTED | `App.tsx:848-856`, `main.tsx:1121-1137` |
| 24 | Cancel (only once a mode exists) | `render-mode-cancel` | render-mode | IMPLEMENTED | `App.tsx:861-869` |
| 25 | "not saved yet" local-vs-backend provenance badge | `data-render-mode-source` | render-mode | IMPLEMENTED (**rewrite-only**) | `App.tsx:758-760` |
| 26 | Marked rows list (index + classification + xpath) | — | marking | PARTIAL — **read-only**, `aria-disabled`, no click-to-focus | `App.tsx:875-910` |
| 27 | AI selectors list with include/exclude badges | `data-selector-kind` | silent | IMPLEMENTED | `App.tsx:915-945` |
| 28 | Connection fields ×3 (config endpoint, AI endpoint, stage base) | `settings-configEndpoint` etc. | config | PARTIAL — single form + one Save; legacy had per-field Set/Change/Cancel + per-field notices | `App.tsx:963-980` |
| 29 | Save connection | `settings-save` | config | IMPLEMENTED (disabled unless loaded ∧ dirty) | `App.tsx:993-1001` |
| 30 | Settings status line (unread/Saving…/Unsaved changes/Saved/Nothing stored) | — | config | IMPLEMENTED | `App.tsx:981-992` |
| 31 | Email + password + Sign in | `account-email`, `account-password`, `account-login` | config | IMPLEMENTED (Enter submits; password never persisted) | `App.tsx:1052-1100`, `main.tsx:1420-1457` |
| 32 | Check token | `token-validate` | config | IMPLEMENTED | `App.tsx:1026-1035`, `main.tsx:1478-1504` |
| 33 | Sign out | `account-logout` | config | IMPLEMENTED | `App.tsx:1036-1045`, `main.tsx:1459-1476` |
| 34 | Auth message alert | `data-auth-message` | config | IMPLEMENTED | `App.tsx:1104-1112` |
| 35 | Continue (leaves config only when complete) | `configuration-continue` | config | IMPLEMENTED | `App.tsx:1124-1132` |
| 36 | Activity log panel (40 entries, newest first, tone-coloured, counter-keyed) | `data-event-log` | all | IMPLEMENTED (**rewrite-only**; replaces legacy toasts) | `App.tsx:1138-1163`, `popup/event-log.ts` |
| 37 | Busy curtain (spinner + title + hint + timer) | `.ui-curtain` | all | PARTIAL — one generic curtain, no phase contract (§6) | `App.tsx:1165-1174` |
| 38 | Loading view (spinner + "Starting Unfluffify") | `.popup-loading-view` | loading | IMPLEMENTED | `App.tsx:421-430` |
| 39 | Debug handle `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` | — | — | IMPLEMENTED (**rewrite-only**, always on) | `main.tsx:1729-1755,1789-1791` |

### 4.3 Popup state machine

12 states (`boot, silent, locked, silent_preview, pre_ai_clean, pre_ai_dirty, running,
preview_open, exit_restoring, post_ai_clean, inspecting, reconciling` —
`src/popup/organ/machine.ts:3-15`) with a **frozen presentation matrix** per state
(`src/popup/organ/memory.ts:55-260`) covering: mainUiHidden, silentModeActive, four button
disabled flags + four blocked reasons, curtain visibility/text, temporarily-disabled overlay,
rows, selectors, toggle value, desktop-preview value, countdown, lock banner. This is a faithful
re-encoding of legacy's `MARKING_SESSION_SURFACE_MEMORY`
(`legacy:popup/marking-session-machine.ts:401-512`) — the state names and the button matrix line
up one-for-one with the study's legacy table, including `requires-ai-run` gating Save and
`ai-up-to-date` gating a second Run AI.

Absent from the rewrite matrix vs legacy: `silent_exit_restoring`, and the **30 s overlay
fail-open** for `inspecting`/`reconciling` (`legacy:marking-session-machine.ts:63`) — a wedged
overlay in the rewrite has no timer that releases it.

---

## 5. Content script — every in-page behaviour that exists today

| Behaviour | Status | Evidence / notes |
|---|---|---|
| Consent / cookie / interstitial hiding | **IMPLEMENTED, and better-specified than legacy** — 28 high-precision selectors, hides via `opacity/visibility/pointer-events !important` + attribute marker, closes native `<dialog open>` (top layer), injects a `pointer-events` bypass style, idempotent, `MutationObserver`-driven, restorable | `src/content/consent.ts:27-178`; wiring `content-loader:361-391`; 12 tests incl. a guard that no generic word ("banner", "notice", "cmp") enters the list (`tests/src/content/consent.test.ts:222`) |
| Runs consent on page load without a popup | IMPLEMENTED — `page.context` probe at `document_start`, gated only on "is this a property" | `content-loader:408-444`; background answer `src/background/index.ts:203-271` |
| Reveal/freeze page ritual, once per visit | **PARTIAL / likely ineffective** — one-per-visit latch, load-event wait, 8 s timeout, re-armed per navigation, all correct; but the walk itself is fully synchronous (§8.2) | `content-loader:446-527`; `src/content/stabilization/reveal.ts:17-32` |
| Motion freeze (timers, rAF, IO/RO, lazy-load listeners) in MAIN world | IMPLEMENTED — real 388-line page-world program with nonce-gated ARM/SET_MOTION_PAUSED/SET_LAZY_LOADING_SUPPRESSED/DESTROY, queue-and-flush, and full restore | `src/page-world/program.js:93-235,265-388`; 15 tests |
| Closed-shadow instrumentation (`attachShadow` hook) | IMPLEMENTED and installed at page-world load | `program.js:39-51`; bridge consumer `marking/dom-view.ts:169-171,254-278` |
| SPA URL watcher (history patch + popstate/hashchange) | IMPLEMENTED — deactivates marking, resets the ritual, re-probes context, emits `session.navigated` | `content-loader:641-687` |
| SPA hard-reload guard | **INERT** — `spaGuard` is armed by the ritual and its reload callback checks `location.href !== url`, which is never true when called after the navigation | `content-loader:24-28,648`; `stabilization/spa-guard.ts:14-21` |
| Marking overlay | PARTIAL — one fixed root + 11 layers, but only layers 2–6 (classifications), 7 (silent) and 10 (hover) are used; **one box per element bounding rect**, not per client rect | `marking/renderer.ts:33-40,51-147` |
| Overlay classification visuals | PARTIAL — 5 flat inline styles: implicit-include green, explicit-include **blue**, exception red, immutable grey, closed-shadow purple dashed | `renderer.ts:11-32` — legacy used dark-green explicit include, candy-striped immutables, animated marching-dash AI content, ghost variants (`legacy content-ux §3`) |
| Hover feedback | IMPLEMENTED — cyan 2 px box (legacy: amber) | `renderer.ts:109-127` |
| Live overlay freshness | IMPLEMENTED — Mutation/Resize/Intersection observers + scroll/resize listeners, rAF-batched, extension-UI mutations ignored | `marking/engine.ts:184-239` |
| Exclude click / Alt-include / Shift widen / Space passthrough | IMPLEMENTED — capture-phase document listeners; mode re-derived from the click's own `altKey`; passthrough resets on blur/visibilitychange | `content-loader:221-236,543-603` |
| Right-click (contextmenu) toggle | ABSENT (legacy toggled on contextmenu too, `legacy:core.ts:9711-9717`) | grep: no `contextmenu` listener |
| Custom cursors (include/exclude SVG, progress, passthrough) | **ABSENT** — the SVGs ship (`src/public/cursors/*.svg`) and are web-accessible (`wxt.config.ts:71-79`) but **no code references them** | grep `cursors/` → CSS-free, code-free |
| Click-acknowledgement pulse, ghost rects, `data-uf-mark-id` correlation, scroll-hide (`uf-scrolling`) | ABSENT | grep |
| Paint reachability | IMPLEMENTED — composed hit testing + per-point reachability at the clicked coordinates | `marking/hit-testing.ts`, `marking/paint-reachability.ts`, engine `:284-304`; 27 DOM-bridge tests |
| Shadow-flattened capture (open shadow inlined, closed-shadow subtrees stripped) | IMPLEMENTED | `dom-view.ts:294-310`, `marking/submit.ts:27-58` |
| Silent highlighting | PARTIAL — real overlay pass driven by stored selectors, but **only while the popup is open** (the 500 ms poll pushes `applySilentSelectors`); no tooltip annotation, no click-to-copy, no anti-blink choreography | `content-loader:749-777`; driver `main.tsx:516-539`; legacy ran it on page load and annotated every node (`legacy content-ux §9`) |
| Selector seeding of a clean marking session | IMPLEMENTED — defaults, then AI selectors laid over, once, marked `explicit` | `domain/selector-seed.ts:28-41`, engine `:270-283`, activation `content-loader:734-737` |
| Unsaved-changes navigation gate (`beforeunload`) | IMPLEMENTED, armed only while dirty | `content-loader:106-123` |
| In-page directive surface (curtain + banner) | PARTIAL — a fixed root renders one scrim + one bottom banner with plain inline styles; **`pointer-events:none` is inherited, so the curtain does not block input** (legacy blocked 22 event types) | `content-loader:296-351`; legacy `legacy:core.ts:5390-5440` |
| In-page property-lock banner with mode-specific copy + buttons | ABSENT — only the generic banner text above | legacy `legacy:property-lock-banner.ts:60-287` |
| Page toasts / marking toasts | ABSENT | grep: no toast element anywhere in `src/` |
| Page-motion pause indicator pill, inspection notice card, "Calculating markings…" narration | ABSENT | grep |
| Page-side AI preview (clickable elements, focus flash, scrollIntoView, copy) | ABSENT | §8.3 |
| Hotkeys Ctrl/Cmd+E (toggle marking), Ctrl/Cmd+M (toggle simulation) | ABSENT | grep: only Space/Alt/Shift modifiers exist |

---

## 6. Implementation-status matrix — flows and subsystems

Legend: **IMPLEMENTED** (works end-to-end on the live path) · **PARTIAL** · **STUBBED** (code
exists, produces no behaviour) · **ABSENT**.

### 6.1 Operator flows

| Flow | Status | What exists | What is missing |
|---|---|---|---|
| **Activation / enable marking** | IMPLEMENTED | Lock re-check → emulation assert → `activateContentMain` with selector seed → rows adopted → `marking.enabled` signal; refusals logged with reasons (`main.tsx:920-1004`) | No hotkey; no "Calculating markings…" narration; disable-confirm exists but only when dirty (`main.tsx:936-940,1150-1157`) |
| **Render mode** | IMPLEMENTED | Two CDP-driven loads to compare (`renderMode.inspect` → `Emulation.setScriptExecutionDisabled` + reload, `render-emulation-runtime.ts:218-235`), pick ≠ commit, `Set` CTA, Cancel, JS always restored on exit (`main.tsx:1097-1148`), backend/local provenance, restore of a stored mode on open (`main.tsx:1218-1264`) | Legacy's 3-step wizard copy ("What did you observe?"), the inspection spinner phases, the alternating enable/disable of the two buttons, and the "Undetermined" pill |
| **Marking session** | IMPLEMENTED | 12-state machine, dirty edge driven by a monotonic **operator-toggle count** (not row count) (`decide.ts:40-46`, `content-loader:31-35`), rows never persisted, rows dropped on disable/navigate/save/discard (`machine.ts:185-198`) | Preview sub-flow (below); overlay fail-open timers |
| **AI run** | IMPLEMENTED | Capture → offscreen XPath refinement → `POST /get_selectors` → poll status/result with 480 s deadline + run-record heartbeats (`services.ts:267-316`, `lynx/ai-job.ts`) → selectors land in state → content marked clean → `run.completed` | No resume of an interrupted run after popup reopen (legacy `maybeResumePersistedAiRun`); run records are written (`runRecordRepo`) but never read back |
| **Save** | PARTIAL (works, but see §8.1) | Two-gate save: pause interactions → `reconciliation.started` → dirty re-check → `POST /save` → dirty re-check → deactivate + `session.saved` (`main.tsx:1597-1678`) | Sends **only the current page's markings** (§8.1); no retry/backoff ladder (legacy did 5 attempts); no "Problem connecting to server. Retrying…" narration |
| **Discard** | IMPLEMENTED | `resetContentMain` → `session.discarded` → back to `pre_ai_clean` | No confirm dialog on the Discard button itself (legacy confirmed; the rewrite only confirms when *turning marking off*) |
| **Preview / content list** | **PARTIAL–VESTIGIAL** | Popup state transitions only | §8.3 |
| **Property lock** | PARTIAL | Real WS client with backend-issued identity adoption + persistence, claim/heartbeat/activity/client_status/release, per-tab client lifecycle, directive publication to content, five distinct statuses (`ok/not_configured/not_candidate/signed_out/unavailable`) with distinct copy (`lock-runtime.ts:34-40,184-247`) | **No collaboration UI**: `suggestTakeover`, `respondToSuggestion`, `continueEditing` exist on the client (`lock/client.ts:124-132`) and are called by **nothing**; the reducer folds 7 message kinds but the view collapses them to 5 strings (`lock/view.ts:10-49`); no reconnect/backoff after `close` |
| **Accounts** | IMPLEMENTED | Login (password never stored, dropped on success), logout, manual validate, background alarm monitor every 10 min with a cached verdict the popup adopts, silent `x-update-token` rotation queued behind a serialized settings writer (`services.ts:118-145,321-349`, `auth-token-monitor.ts`) | No "Login expired" force-navigation toast; endpoint changes do **not** clear the token (legacy did) |
| **Send to Lynx** (publish selectors via `updateScrapingConditions`) | **ABSENT** | `buildUpdateScrapingConditionsRequest` and `buildCssInfoRequest` are written, tested, and exported on `services.lynx` (`services.ts:317-319`, `lynx/graphql.ts:42-129`) — **no caller anywhere** | The whole second half of the legacy product loop: the checklist popover, the cssInfo staleness gate, the publish mutation, the submitted-fingerprint stamp |
| **Lynx checklist / Todo list (page-type coverage)** | **ABSENT** | `buildPropertyPageTypesRequest` exists and is tested; no caller | The Todo card, progress pill, per-page-type subsections, candidate links that navigate the tab, auto-collapse memory, the modal checklist |
| **Options / settings page** | ABSENT in both trees (config lives in the panel) | — | — |
| **Badge / action icon states** | **ABSENT** | Both icon sets ship (`src/public/icons/{default,active}/*`) | No `action.setIcon` call anywhere — the toolbar icon never reflects "active on this tab" as legacy's `updateActionForTab` did |
| **Theming** | **STUBBED** | The full 16-theme catalog CSS is present and byte-identical to legacy (`src/theme-color.css`, 265 lines, 17 `[data-theme]` blocks) | Nothing ever stamps `data-theme` / `data-theme-mode` on `<html>`, so the panel renders on the `:root` indigo fallback — legacy production forced `nordic` |
| **Toasts** | ABSENT (replaced by the Activity log) | — | ~40 legacy toast strings have no equivalent |
| **Confirm dialogs** | PARTIAL | Exactly one: "Turning marking off discards your unsaved markings. Continue?" (`main.tsx:1150-1157`) | Legacy had 8 (discard, navigate-away, cache clear, unregister, lock-transfer save/discard, candidate-change alert…) |

### 6.2 Subsystems

| Subsystem | Status | Notes |
|---|---|---|
| `domain/**` (pure spine) | IMPLEMENTED — 850 lines, statically DOM/Chrome/React-free (enforced by `tests/src/domain/import-boundary.test.ts`); single-pass `evaluate` + `evaluateBranch`, unified `rows[]`, width-independent Shift-climb, Zod invariants | The audit-1 `visibility.ts` dead-branch bug is fixed |
| `messaging/**` (typed bus) | IMPLEMENTED — one contract (`realms.ts:112-249`) with 21 commands + 2 events, runtime/tabs/page transports, idempotent-by-seq replay, exactly-one-reply; no raw `uf.*` envelopes remain on the live path (guard-asserted) | The **server-side consumed-once cursor is unused**: `signals.consume` / `organId` are registered (`background/index.ts:134-157`) but the popup pulls with its own local cursor (`popup/signal-cursor.ts`) and never calls consume |
| `storage/**` | PARTIAL — repos for tab state, config, run records, lock identity, local property, settings over an IndexedDB (worker) / memory (test) KV store | Everything lives in **one IndexedDB store**; there is no chrome.storage tiering and no sync-storage anything, so nothing is shared across profiles/instances |
| MV3 persistence | **PARTIAL / effectively dead** — `persistDurableFacts` is called on every fact and signal (`background/index.ts:130,146,172`), but `rehydrateDurableFacts` is exposed on `services.persistence` (`services.ts:229-230`) and **called by nobody**; a suspended worker therefore wakes with empty brains | Grep confirms zero callers |
| `lynx/**` | IMPLEMENTED — REST `/load` `/save` `/remove`, AI start/status/result, GraphQL builders + error-code reading, accounts login/validate, header-preserving transport with token rotation | `/remove` (`rest.ts:71-84`) has no caller; `cssInfo` + `updateScrapingConditions` + `propertyPageTypes` have no callers |
| `lock/**` | PARTIAL (see 6.1) | Client, reducer (10 server message types parsed, 7 folded), timings mirror, view projector, identity adoption |
| Emulation | IMPLEMENTED **and beyond legacy** — CDP metrics override **plus** UA + `userAgentMetadata` client-hint spoofing derived from the browser's own Chrome version, posture re-assertion on debugger detach, one self-terminating reload to make a spoofed identity real | `render-emulation-runtime.ts:46-237`, `content/stabilization/emulation.ts:36-133` |
| Offscreen | IMPLEMENTED — document created on demand, XPath refinement over the bus | `background/index.ts:45-58,273-277`, `entrypoints/offscreen/main.ts` |
| Keepalive | IMPLEMENTED — alarm-backed, reason-counted, 30 s holds | `background/keepalive.ts` |
| Live-QA harness | IMPLEMENTED — `scripts/launch-test-browser.mjs` drives a pinned `@playwright/mcp@0.0.78` Chromium, loads the unpacked build, opens `popup.html?debugTabId=<tab>` as a second tab, and reads `__UNFLUFFIFY_POPUP_DEBUG__` | `main.tsx:274-278` honours `debugTabId` **in production builds**, not behind `__UF_DEBUG_BUILD__` |

---

## 7. What the rewrite has that legacy does not

1. **Mobile *identity* spoofing** — legacy emulation was viewport-only; the rewrite sends
   `Emulation.setUserAgentOverride` with a Pixel-7/Android-13 UA derived from the browser's own
   Chrome version plus matching `userAgentMetadata` client hints, refuses to invent a version it
   did not read, and restores the real UA for desktop (`stabilization/emulation.ts:51-127`,
   commit `489649d8`).
2. **Posture re-assertion on debugger detach** — dismissing Chrome's debugging bar silently
   returned a legacy tab to desktop mid-session; the rewrite re-applies the held posture unless
   the detach reason is terminal (`render-emulation-runtime.ts:62-79`).
3. **Reload-to-make-identity-real, gated on there being nothing to lose** (`allowReload` is only
   true while marking is off — `main.tsx:612-626`).
4. **Render-mode provenance** — the popup distinguishes a backend-confirmed mode from a locally
   held one and says "not saved yet" (`App.tsx:756-760`); the backend-authority rule lives in one
   place (`services.ts:156-219`) and a 404 is the *only* answer that lets a local render mode
   survive.
5. **A confirmed-vs-default render mode test** — `isRenderModeConfirmed` refuses to adopt the
   schema default as a decision (`storage/config.ts:40-58`).
6. **Operator-toggle-count dirtiness** — dirty is a monotonic count of operator toggles, immune to
   pages that mutate their own DOM (`decide.ts:35-46`).
7. **Serialized settings writer** — concurrent endpoint save / login / silent token rotation
   cannot lose each other's field (`services.ts:118-145`, tested).
8. **Signed-out is a named lock state**, not "unavailable", and the backend is not asked at all
   without a token (`lock-runtime.ts:191-194`).
9. **Content-script-unreachable is a named popup state** with the actual fix in the copy
   (`App.tsx:523-528`).
10. **Diagnostics card + Activity log + `__UNFLUFFIFY_POPUP_DEBUG__`** — a tester cockpit legacy
    never had (legacy's trace panel was flag-off in production).
11. **Native `<dialog open>` handling in consent hiding** — legacy could not defeat the top layer;
    the rewrite calls `close()` while leaving the subtree intact (`consent.ts:118-126`).
12. **A machine-checked anti-false-done gate** (`tests/integration/rewrite-cutover.test.ts`) that
    asserts feature reachability, no raw envelopes, no orphaned files, and a 16-signal brain.

---

## 8. Defects and risks found while reading

### 8.1 Save writes a half-snapshot — every other page of the property is dropped (HIGH)

`configFromSubmission` builds the `/save` body with a `pageMarkings` map containing **only the
page just captured**:

```ts
// src/entrypoints/popup/main.tsx:866-873
pageMarkings: {
  [page.url]: { timestamp: now, renderedHtml: page.renderedHtml, rawHtml: page.rawHtml, rows: page.renderedXPaths },
},
```

and `loadPropertyConfig` keeps only `config.selectors` from the loaded snapshot, discarding
`config.pageMarkings` entirely (`main.tsx:1250-1253`). The background `config.save` handler posts
the snapshot verbatim (`background/index.ts:300-309` → `lynx/rest.ts:49-69`), and the owned-API
contract states the payload is a full property snapshot that **replaces** the record: *"Save
uploads **all** locally-marked pages as one property snapshot"* and *"on 200 the payload fully
replaces the local property config"* (`.reimplementation/remote-api.md:86,90,101`).

So marking page B and saving replaces the property record with a map holding page B alone —
structurally the same failure as the legacy live finding *"a 200 /save once wiped all page
markings (half-snapshot write)"*, and the same class of bug as the dropped guard in dangling
commit `e11059b1`. Nothing in the tree merges the previously stored pages back in, and no test
covers multi-page save. (If the backend is later specified to merge by URL key, this becomes a
non-issue — but the contract currently says replace, so this needs an explicit decision.)

### 8.2 The reveal walk is synchronous, so it probably reveals nothing (HIGH)

`runReveal` performs `scrollTo("top") → scrollTo("half") → suppressLazyLoading() →
scrollTo("bottom") → freezeAtBottom() → scrollTo("restore")` with **no awaits between the steps**
(`src/content/stabilization/reveal.ts:21-31`). All six calls run in one task; the browser never
paints, never fires scroll events to the page, and never runs IntersectionObserver callbacks in
between — so lazy images and scroll-linked content have no opportunity to load before the freeze.
Legacy's ritual walked with settle-sampling and explicit waits (`legacy content-ux §6`).

Relatedly, `expandedScrollHeight` is passed the *same* live expression as `initialScrollHeight`
(`content-loader:179-180`), so the reported `lazyExpansions` can only ever be `0` — the
"at most one lazy expansion per ritual" cap in the contract is unobservable. The ritual's
bookkeeping (once-per-visit, load-event wait, timeout, navigation reset) is correct and
well-tested; it is the walk itself that is inert.

### 8.3 "Content list" is a one-way door with nothing behind it (MEDIUM)

Clicking `marking-preview` emits `preview.opened` and moves the popup to `preview_open`
(`main.tsx:1680-1706`, `machine.ts:159-176`). Nothing else happens: no content command is sent,
no page-side preview exists, and **no control anywhere emits `preview.exit.requested` or
`preview.exited`** (grep: those names appear only in `machine.ts`, `decide.ts`, `signals.ts` and
the fact schema). The only ways out of `preview_open` are an edit, a save, a discard, a navigation
or turning marking off. In that state Run AI is disabled and the button that got you there is
still enabled. Legacy's preview was a whole surface: a "Detected Content" sidebar with per-item
focus, page-side click-to-copy, a yellow focus flash, four item categories and an Exit control
(`legacy popup-ux §10`, `legacy content-ux §10`).

### 8.4 Silent highlighting requires an open popup (MEDIUM)

Stored selectors are painted only by `refreshSilentSelectorPreview`, which runs inside the
popup's 500 ms poll (`main.tsx:509,516-539`). Close the panel and the page shows nothing; legacy
painted silent highlights on every property page load, popup or not
(`legacy content-ux §9`, §13 step 2).

### 8.5 MV3 wake loses all brain state (MEDIUM)

Facts are persisted on every observation (`background/index.ts:130,146,172`) but
`rehydrateDurableFacts` has no callers. After a worker suspension the per-tab brains restart from
`null`, the signal log restarts at seq 0, and the popup's cursor (which survives in the panel) is
ahead of the brain's — so the first signals after a wake are silently filtered out by
`brainSignals.claim` (`popup/signal-cursor.ts:31-37`). The popup's `reconcileContentStatus` path
(`main.tsx:877-918`) partly compensates by re-deriving from the content script.

### 8.6 The in-page curtain does not block input (LOW–MEDIUM)

`directiveRoot` sets `pointer-events: none` and the curtain child does not override it
(`content-loader:296-335`), so the "Property locked" / busy scrim is decorative. Legacy installed
a capture-phase blocker over 22 event types (`legacy:core.ts:5390-5440`). Marking clicks are
separately suppressed (listeners are removed while blocked, `content-loader:620-627`), but page
interaction is not.

### 8.7 Smaller observations

- **`debugTabId` is honoured in production builds** (`main.tsx:274-278`); `__UF_DEBUG_BUILD__` is
  declared (`wxt.config.ts:41`, `src/types/globals.d.ts:6-13`) but referenced by no code, so the
  debug gate is currently unused.
- **`main.tsx` holds 43 module-level `let`s** (grep `^let `), several of them session state
  (`confirmedRenderMode`, `pendingRenderMode`, `desktopPreviewEnabled`, `appliedEmulationMode`,
  `loadedSelectors`, `contentActive`…). This is the shape that produced legacy's documented
  `toggleEnabled` stale-cache desync. It is mitigated here — the *rendered* surface comes from the
  organ's frozen matrix (`store.getPresentation()`), and these variables feed only `diagnostics`
  and the imperative handlers — but every rebind must remember to reset each one by hand
  (`bindToTab`, `main.tsx:338-367`, resets 15 of them).
- **`contentRows` only ever carries `included`/`excluded`** (`content-loader:125-130`) while the
  popup renders four classifications (`App.tsx:188-200`), so "Immutable"/"Closed shadow" rows are
  unreachable UI.
- **No retry ladder on save** and **no 30 s fail-open** on the `inspecting`/`reconciling` overlay
  states — both existed in legacy.
- **`/remove`, `cssInfo`, `propertyPageTypes`, `updateScrapingConditions`, `signals.consume`,
  `pullForOrgan`, `runRecordRepo` reads, `restoreConsentOverlays`** are all implemented + tested
  but have no production caller. They are not dead-by-accident so much as *built ahead of the UI
  that would use them* — worth listing explicitly in any parity plan so they are either wired or
  deleted.

---

## 9. Test coverage — what is pinned vs what is not

485 tests across 58 files. Density by area (`it(` counts):

| Area | Tests | Depth |
|---|---|---|
| Popup App surface | 50 | Every control id, per-view scoping, gating, tones, blocked reasons, curtain kinds |
| Popup entrypoint (flows) | 20 | Mobile posture on bind, render-mode confirmation, discard confirm, AI+preview+save over the typed bus, stale-snapshot rebinding, five distinct dirty-race scenarios, startup reconciliation, seeded-session non-dirtiness, navigation |
| Popup view resolution | 16 | All precedence rules |
| Popup FSM + store | 15 | Dirty-during-reconciliation, stale run ids, rows-never-outlive-session |
| DOM bridge / marking DOM | 27 | Pierce-through, shadow flattening, closed-shadow, xpath indexing, paint reachability, layered overlays |
| Marking domain rules | 20 | Drill/reach-in, boundary removal, branch evaluation, submission snapshots |
| Stabilization | 20 | Freeze scopes, one-ritual-per-visit, UA spoofing + client hints, JS-off reload, SPA guard |
| Background services | 21 | Endpoint routing, token rotation, serialized writes, AI job, site lookup error discrimination, lock lifecycle |
| Background startup | 9 | Side panel, brain mount, lock directive, emulation, settings round-trip, config load, auth alarm |
| Brain | 15 | Fold/decide/project, consumed-once, toggle-vs-row dirtiness, born-at-source |
| Consent | 12 | Hiding, dialog close, bypass style, idempotence, restore, selector-safety guard |
| Lock | 10 | Frames, identity adoption, reducer, view |
| Lynx (rest/ai/graphql/accounts/rotation) | 34 | Status discrimination, job polling gates, rotation |
| Messaging + transports | 32 | Idempotent replay, one-reply, page nonce/allow-list |
| Storage repos | 10 | Validation, error codes |
| Page-world program | 15 | Timer bridge, gating, restore |
| Build/packaging/manifest/guards | ~30 | Manifest permissions, artifact parity, zip, ts-suppression ratchet, MCP pinning, cutover guard |

**Untested / unpinned behaviours** (no test asserts them):

- Multi-page `/save` composition (§8.1) — no test constructs a config with two pages.
- The reveal walk's *effect* — tests assert the call order of injected callbacks, never that the
  page yields between scrolls (§8.2).
- Preview open→exit round trip (no exit path exists to test).
- Silent highlighting without a popup.
- MV3 suspend/resume rehydration.
- Any visual/CSS assertion beyond `tests/theme-colors.test.ts` (which checks token definitions,
  not that a theme is ever applied).
- Property-lock takeover/suggestion/transfer flows end-to-end (the reducer is tested; no runtime
  drives them).

---

## 10. Reconciliation with the three audits

| Audit finding (2026-07-07/08) | State on 2026-08-14 |
|---|---|
| Cutover not shipped (#1) | Done — all entrypoints on the new tree, god-files deleted |
| Thin cutover, 45/252 files reachable, 207 orphans (#2) | Resolved — orphan list is empty and the guard enforces it |
| Run AI / Save / Load dead | Live (`background/index.ts:278-309`, `main.tsx:1506-1678`) |
| Property lock dead | Live but UI-incomplete (§6.1) |
| Render-mode inspection dead | Live (`render-emulation-runtime.ts:218-235`) |
| Device emulation dead | Live **and extended** with identity spoofing |
| Stabilization dead | Wired; ritual runs on page load; walk itself is inert (§8.2) |
| Offscreen refinement lost | Restored (`entrypoints/offscreen/main.ts`) |
| Raw `chrome.runtime` envelopes on the live path | Gone — typed bus only (guard-asserted) |
| Brain decides 5/16 signals | All 16 decided (`decide.ts`), guard-asserted |
| MV3 persistence unreachable | Half-fixed: persists, never rehydrates (§8.5) |
| Marking: no hover, flat overlay, no observers | Fixed: hover, 11-layer root, Mutation/Resize/Intersection + scroll observers |
| Popup cockpit empty | Fixed: rows, selectors, lock banner, toggles, countdown all populate |
| Suite red (#3) | Green, 485/485, guard unweakened |

The audits' *definition of done* is now satisfied except its last clause — **"witnessed
live-browser run of the full lifecycle on a real property"** — which no artifact in the tree
evidences. `.reimplementation/study/RESUME.md` records the harness (`pnpm browser:live`) and the
recent commits show it being hardened, but there is no captured live-run record for the current
HEAD.

---

## 11. Summary matrix (one line per user-visible feature)

| Feature | Status |
|---|---|
| Side-panel surface, tab following, per-tab binding | IMPLEMENTED |
| Loading view | IMPLEMENTED |
| Configuration view (3 endpoints + sign-in + Continue) | PARTIAL (single-form; no per-field Set/Change) |
| Render-mode view (compare loads, pick, Set/Cancel) | IMPLEMENTED |
| Marking view (toggle, Run AI, Save, Discard, rows) | IMPLEMENTED |
| Silent view (toggle, desktop preview, selectors list) | IMPLEMENTED |
| Content list / preview | VESTIGIAL |
| Todo list / page-type coverage | ABSENT |
| Lynx checklist modal + Send to Lynx publish | ABSENT |
| Property-lock strip (status/role/site/countdown/Refresh) | PARTIAL |
| Property-lock collaboration actions (take over, suggest, accept/reject, continue here) | ABSENT |
| Accounts: sign in / out / check token / rotation / expiry monitor | IMPLEMENTED |
| Connection settings persistence | IMPLEMENTED |
| Diagnostics card + Activity log + debug handle | IMPLEMENTED (rewrite-only) |
| Busy curtain | PARTIAL (one generic curtain, no phase contract) |
| Toasts | ABSENT |
| Confirm dialogs | PARTIAL (1 of 8) |
| Themes (16-theme catalog) | STUBBED (CSS present, never applied) |
| Logo / branding in header | ABSENT |
| Browser-action icon states | ABSENT |
| Options page | ABSENT (as in legacy) |
| Consent hiding | IMPLEMENTED (improved) |
| Reveal/freeze ritual | PARTIAL (bookkeeping right, walk inert) |
| Page-motion freeze (MAIN world) | IMPLEMENTED |
| Marking overlay + hover + live refresh | PARTIAL (flat rects, reduced grammar) |
| Custom cursors | ABSENT |
| Click ack pulse / ghosts / AI marching dashes / scroll-hide | ABSENT |
| Silent highlighting | PARTIAL (popup-gated, no tooltips/copy) |
| Marking interactions (exclude/Alt-include/Shift-widen/Space-passthrough) | IMPLEMENTED |
| Right-click toggle, hotkeys (Ctrl+E / Ctrl+M) | ABSENT |
| beforeunload unsaved gate | IMPLEMENTED |
| In-page curtain / banner | PARTIAL (decorative, non-blocking) |
| In-page property-lock banner | ABSENT |
| Page-side AI preview (focus, flash, copy) | ABSENT |
| Mobile emulation | IMPLEMENTED (beyond legacy) |
| Desktop preview | IMPLEMENTED |
| AI run + async job polling | IMPLEMENTED |
| AI run resume after popup reopen | ABSENT |
| Save (single page) | IMPLEMENTED |
| Save (whole-property snapshot) | **BROKEN** (§8.1) |
| Discard | IMPLEMENTED |
| MV3 durable-fact rehydration | STUBBED |
| Typed bus, storage repos, Lynx clients, offscreen | IMPLEMENTED |

---

## 12. Open questions for the product owner

These are decisions code cannot answer:

1. **Does `/save` replace or merge on the backend?** The owned-API contract says the payload
   fully replaces the property record, but the client sends one page. Either the client must
   assemble the whole property snapshot, or the backend must merge by page URL. This is the
   single highest-risk item in the tree.
2. **Should the tester cockpit ship?** The Diagnostics card, raw state names in the header, the
   Activity log and `__UNFLUFFIFY_POPUP_DEBUG__` have no legacy analogue. Keep for editors, hide
   behind `__UF_DEBUG_BUILD__`, or drop?
3. **Is "Content list" / preview a required product surface, or was it legacy scope to retire?**
   If required, it needs the page-side focus/copy surface and an Exit control; if not, the button
   and the four preview states should be deleted rather than left vestigial.
4. **Is "Send to Lynx" (the `updateScrapingConditions` publish + cssInfo staleness gate) in scope
   for the rewrite?** Without it the rewrite can mark and save but cannot publish selectors to
   Lynx, so the operator loop does not close.
5. **Is the Todo list / page-type coverage checklist in scope?** It drove which pages editors
   marked and what "done" meant for a property.
6. **How much property-lock collaboration UX must return?** The transport supports takeover,
   suggestion and transfer today; the question is whether editors need the buttons and the
   in-page banner, or whether "someone else is editing" is enough.
7. **Should silent highlighting run with the panel closed** (legacy behaviour, more work in the
   content script) or only while the panel is open (current behaviour, cheaper)?
8. **Theme policy:** legacy shipped 16 themes behind a production-off flag and forced `nordic`.
   Should the rewrite stamp `nordic`, expose the picker, or stay on the indigo fallback?
9. **Does the toolbar icon need to reflect per-tab activity** (legacy's active/default icon
   swap), or is the panel itself sufficient signal?
10. **Toasts vs the Activity log:** is a persistent, scrollable event feed an acceptable —
    or preferable — replacement for ~40 transient toasts, or do both need to exist?
11. **Should a page reload be acceptable on popup open** to make the spoofed mobile identity real
    (current behaviour when the document was loaded under a desktop UA)?
12. **Interrupted AI runs:** must a run survive closing and reopening the panel (legacy resumed
    from a persisted record), or is a lost run acceptable given the 8-minute ceiling?
