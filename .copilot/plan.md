# Unfluffify Active Architecture Plan

Last updated: 2026-06-27

## Objective

Keep the active architecture index aligned with the repository's finalized WXT
runtime. The extension now ships from the WXT-native `src/` tree, public assets
come from `src/public/`, the popup UI is React/JSX, and no new content/runtime
refactor track is approved beyond the paused post-H3 state.

## Read this first before changing code

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. `.github/skills/*/SKILL.md` relevant to the task

The completed WXT-migration, type-safety, post-WXT cleanup, and final
WXT-finalization (test cleanup, TS port, React UI port, Preact removal, logo
fix, extensionless imports, lint pass) plan/progress docs were removed from the
workspace; their durable outcomes live in `.copilot/knowledge.md`. Use git
history if earlier rationale is needed.

There are two open implementation plans below: **Dev/Live-Browser Tooling
Hardening**, opened 2026-06-27 after a live migration-regression sweep, and
**Brain-Centralized Deterministic System State**, opened 2026-06-28.

---

## Open Implementation Plan: Dev/Live-Browser Tooling Hardening (2026-06-27)

### Goal

Make the post-migration developer/test tooling (`pnpm dev*` and
`pnpm browser:live`) work reliably on headless and non-interactive hosts, and
record the live-runtime verification status of the JS->TS + vanilla->WXT
migrations so a future agent does not re-derive it.

### Investigation summary (what was actually observed on 2026-06-27)

A live sweep was run against `https://www.bonliva.se/` with `pnpm dev:no-browser`
plus `pnpm browser:live` (managed Playwright-MCP Chromium), inspecting popup,
background service worker, and content-script consoles over CDP
(`http://127.0.0.1:9222`).

**Runtime verdict: the migrated runtime is clean on every testable surface.**

- Background SW boot logs only `console.info "Unfluffify background worker ready"`;
  no errors/warnings/exceptions.
- Popup loads on the gated Configuration view; `__UNFLUFFIFY_POPUP_DEBUG__
  .getViewState()` returns full state; no console/page errors. Endpoint inputs +
  "Set" handlers persist values with no handler errors.
- Content script (`content-scripts/content-loader.js`) injects at
  `document_start` on the target with no errors; MAIN-world freeze bridge present.
- Popup fonts/icons/styles load (the earlier `fonts.css` /
  `materialdesignicons.min.css` 404s and `Bus publish listener rejected` noise
  were already fixed in commit `2698449`). The only console errors are the target
  site's own third-party `cdn.acsbapp.com/config/...` 404 (not extension-related).
- Static sweep: every `utils.getExtensionResourceUrl(...)` target
  (`offscreen.html`, `popup.html`, `assets/materialdesignicons-webfont.woff2`,
  `cursors/exclude.svg`, `cursors/include.svg`) is bundled or web-accessible; the
  only raw `chrome.*` usage is the sanctioned `common/storage-core.ts` seam and
  the locked `common/page-motion-freeze-bridge.ts`.

No new extension-code runtime regression from the migrations surfaced. The two
real findings are tooling/environment issues, and the deep functional flows are
unverified because they are gated behind real backend credentials.

### Current facts (verified)

- `scripts/launch-test-browser.mjs` has **no** headless/`$DISPLAY`/Xvfb handling
  (confirmed by grep). On a headless host the managed Chromium dies with
  `Missing X server or $DISPLAY` during popup binding. Wrapping the whole command
  in `xvfb-run -a --server-args="-screen 0 1280x900x24" pnpm browser:live <url>
  --no-build` makes it reach `live test browser ready` and bind the popup
  (`debugTabId`) successfully.
- `web-ext.config.ts` sets `disabled: UNFLUFFIFY_NO_BROWSER==='1'` and
  `chromiumArgs: ['--user-data-dir=./.wxt/browser-profile']`; it has no headless
  handling either.
- A 2026-06-27 recheck found `pnpm dev:no-browser` stayed resident after the
  initial build in both `script -qec 'pnpm dev:no-browser' /dev/null` and
  `bash -lc 'exec </dev/null; pnpm dev:no-browser'` launches. When `3000` was
  already occupied, WXT moved to `3001` instead of exiting. The earlier
  non-interactive exit report is not reproducible in the current repo/runtime,
  so this plan does **not** justify a dev-config change.

### Decisions already made (constraints)

- Browser/live validation must keep using only `pnpm browser:live` and the
  managed Playwright-MCP Chromium bound to `.wxt/browser-profile`; never the OS
  Chrome (`.github/instructions/browser-launch.instructions.md`).
- Committed `.vscode/mcp.json`, `.mcp.json`, `.vscode/browser-mcp.config.json`
  stay placeholdered and non-launchable.
- Do not touch locked marking/highlighting/property-lock contracts or the
  storage/browser seams while fixing tooling.

### Resolved questions (2026-06-27)

1. Headless strategy: option (a) was chosen. `scripts/launch-test-browser.mjs`
   now auto-detects missing `DISPLAY`/`WAYLAND_DISPLAY` on Linux and
   self-relaunches through
   `xvfb-run -a --server-args="-screen 0 1280x900x24"` when available; if not,
   it prints that exact manual wrapper command and stops before Chromium launch.
2. Dev-server persistence: the current repo/runtime keeps `pnpm dev:no-browser`
   alive in both TTY and `/dev/null` launches, so no dev-config change is part
   of this plan.

### Non-goals

- No extension runtime/behavior changes; this plan is tooling + docs only.
- Do not change `wxt.config.ts` manifest contract, WARs, or popup bundling.
- Do not modify locked contracts or seams.

### Implementation phases

**Phase 1 - Diagnose dev-server exit (no code change yet).**

- Run `script -qec 'pnpm dev:no-browser' /dev/null` (TTY) and, separately,
  `pnpm dev:no-browser < /dev/null` (non-TTY); compare whether the Vite server on
  `:3000` persists.
- Expected outcome: a definitive root cause (TTY/stdin-EOF vs runner config).
- Validation: `curl -sf http://localhost:3000/` succeeds while the command runs.
- Fallback: if it persists under a TTY, the fix is documentation only (note that
  `pnpm dev` needs an interactive terminal / `--watch`-style invocation), not a
  config change.

**Phase 2 - Headless live-browser support in `scripts/launch-test-browser.mjs`.**

- Edit `scripts/launch-test-browser.mjs`: if `process.env.DISPLAY` is empty and
  an `Xvfb`/`xvfb-run` binary is available, start (or wrap with) a virtual
  display before launching the MCP Chromium; log the chosen path. Otherwise keep
  current behavior and print an actionable hint pointing at `xvfb-run`.
- Keep `.temp/browser-mcp.config.json` generation, the single launcher-owned MCP
  client, deterministic-id cross-check, and popup `debugTabId` binding unchanged.
- Validation: on a host with no `$DISPLAY`, `pnpm browser:live <url> --no-build`
  reaches `live test browser ready` without manual `xvfb-run`.

**Phase 3 - Docs/skills/knowledge alignment.**

- Update `.github/skills/live-browser/SKILL.md`,
  `.github/skills/live-round/SKILL.md`, and
  `.github/instructions/browser-launch.instructions.md` with the headless
  requirement/behavior and the verified `xvfb-run` fallback command.
- Add a `.copilot/knowledge.md` fact for headless live-browser runs and the
  non-TTY dev-server caveat (per Phase 1 result).
- Validation: `git --no-pager diff --check`.

**Phase 4 - Gated-flow verification (requires user-supplied config).**

- The AI content detection, marking, content-list, save / Send-to-Lynx,
  render-mode inspection, and property-lock flows are gated behind a real
  Configuration Endpoint + AI Endpoint + Stage Base + login and were NOT
  exercised live. Once the user supplies a staging config/credentials, drive the
  flow per `live-round` and capture popup/SW/content console + page
  errors via CDP. Do not fabricate credentials.

#### 2026-06-27 live verification result

- Live config/login was provided and exercised on `https://www.bonliva.no/`.
- The popup authenticated successfully, render mode was manually verified and
  set to **Static**, marking mode enabled, and AI content detection produced the
  Detected Content preview and the local-sync toast
  `Selectors computed locally — Save to sync`.
- After exiting preview, the flow did **not** reach a saveable/sendable state.
  The popup remained stuck with:
  - `busyReason: "tab-run-ai-preparing"`
  - `busySource: "background-command-router"`
  - `busyOperationKind: "ai-run"`
  - `busyOperationPhase: "preparing-page"`
  - `aiRunPhase: "starting"`
  - countdown visible, `busyMessage: "Preparing page content for AI..."`
- In that stuck state, `compute`, `Show Content List`, `Save Session`, and
  `Send to Lynx` stayed disabled, while `syncSaveStatusText` still reported
  `Selectors computed locally ...`. No page types were recorded as marked, so
  the full Send-to-Lynx flow could not be completed live.
- Treat this as the current blocker for Phase 4 completion. It is no longer a
  missing-config issue; it is a runtime/button-state issue after the AI preview
  flow on the configured site.

### Test matrix

- Tooling phases: targeted manual runs of `pnpm dev:no-browser` and
  `pnpm browser:live <url> --no-build`, plus existing
  `tests/playwright-mcp-config.test.ts`.
- Repo guard (after any script/config edit): `pnpm lint`, `pnpm check`,
  `pnpm test`, `pnpm build`.
- Docs-only edits: `git --no-pager diff --check`.

### Regression risks

- Highest risk: breaking the proven launcher flow (profile-lock, deterministic
  id, popup binding). Protect by leaving the MCP-client/config/binding logic
  untouched and only gating the display setup ahead of launch.
- Risk: a dev-config change that "fixes" a non-TTY-only artifact and regresses
  normal interactive `pnpm dev`. Protect with Phase 1 TTY-vs-non-TTY diagnosis
  before any config edit.

### Acceptance criteria

- `pnpm browser:live <url> --no-build` reaches `live test browser ready` on a
  headless host without a manual `xvfb-run` wrapper (or the requirement is
  clearly documented if option (c) is chosen).
- The dev-server-exit root cause is documented, and `pnpm dev`'s expected
  lifecycle on interactive vs non-interactive hosts is stated in the skills.
- `.copilot/knowledge.md` and the two browser/dev skills reflect the headless
  and non-TTY realities.
- Repo validation (`pnpm lint && pnpm check && pnpm test && pnpm build`) stays
  green.

### Todo chain

1. Phase 1 dev-server-exit diagnosis (TTY vs non-TTY).
2. Phase 2 headless launcher support.
3. Phase 3 docs/skills/knowledge updates.
4. Phase 4 gated-flow verification once credentials are provided.
5. Follow-up fix for the post-preview AI/button-state blocker before retrying
   the full save / Send-to-Lynx flow.

---

## Completed Implementation Plan: Brain-Centralized Deterministic System State (2026-06-28)

Status: COMPLETE for the initial slice. Phases 0-7 shipped in `eeb2898`
(`feat(brain): centralize popup session dictation`). The remaining eligible
non-performance-critical state surfaces are tracked in the follow-up plan below.

### Goal

Make every fixed, predictable, cross-cutting system state — the marking-mode
button matrix, the spinner/busy curtain, readiness, preview, save/discard, and
reconciliation states — owned and decided by the background brain. Each layer
(content, popup) stops deciding these states locally; instead each layer reports
raw facts up to the brain, the brain decides one named state, and the brain
dictates to every layer which predefined state to render. Single source of truth:
deterministic, centrally controlled, in sync across layers. Out of scope:
layer-local rendering (content marking/silent-highlight/visibility DOM); the
brain dictates intent, the layer owns the pixels.

### Current facts (verified)

- Popup is the sole author of the button matrix today: `src/popup.ts:5033-5263`
  (`toggleEnabledDisabled`, `computeButtonDisabled`, `markingPreviewDisabled`) and
  `src/common/page-save-state.ts:42-114` (`buildPageSaveUiState` →
  `pageSaveDisabled`/`pageRevertDisabled`).
- Inputs are hybrid: content owns `markingEnabled` (`getInspectionStatus`,
  popup.ts:2965,4330), draft/pending (`getPageDraftStatus`, popup.ts:2966),
  preview (`previewActive`/`previewBlocked`, set popup.ts:7353, cleared via
  `aiPreviewClosed`), and page-save reconciliation pending
  (`applyDraftStatusToPopupState`, popup.ts:2876-2885, from
  `src/content/page-draft-status-handler.ts:81-88`); brain owns
  readiness/render-mode + spinner curtain
  (`src/background/brain/view-projector.ts:93-136`, `brain/index.ts:44-57`);
  popup owns ephemerals `aiRunMarkingsFingerprint`→`aiRunUpToDate`
  (popup.ts:2190-2203), `aiRequestInFlight`→`aiBusy` (popup.ts:4874),
  `previewRestorePending` (popup.ts:2996, 1s fallback
  `AI_PREVIEW_RESTORE_FALLBACK_MS` popup.ts:560). Centralization must add a
  brain ingestion path for reconciliation instead of assuming it is already
  background-owned.
- Brain already centralizes lifecycle/activation/render-mode/spinner:
  `src/background/brain/state-store.ts` (`TabLayerState`), `brain/index.ts`
  (`createBrain`, `publishProjectedState` → `view.popup` + `directive.content` +
  spinner surfaces), `brain/view-projector.ts` (`projectViews`),
  `brain/deciders/*`.
- Popup consumes the brain envelope at `src/popup/layers/layer-host.ts:32-36`
  (`VIEW_UPDATED` → `applyPopupView`). Dictation envelope to extend:
  `src/common/bus/contracts/popup-state.ts` (`PopupViewEnvelope`).
- Live-verified on bonliva.no: Fresh/Running-AI/ready-to-save rows match; the
  AI-auto-preview + Exit-Preview path can stick (content `previewBlocked` never
  unblocks; popup `previewRestorePending` never clears) — fix as part of
  centralization, do not bake in.
- Approved contract: `.copilot/knowledge.md` "Popup Preview Exit Contract".
- Heavy popup source-contract tests encode the current matrix:
  `tests/popup-marking-refresh.test.ts:227,246`, `tests/page-save-state.test.ts`,
  `tests/popup-ai-run-gating.test.ts` (migrate, do not delete).
- Locked: `src/content/core.ts` + marking/highlight/visibility/reconciliation
  logic (content fact-reporting must be an additive thin reporter, not a core
  edit).

### Decisions already made

Repository constraints: no edits to locked content core; popup→background keeps
the raw runtime-message shape (knowledge C8); popup/brain snapshot reads now
flow through `requestPopupView(...)` using `POPUP_STATE_REQUEST_TYPES.GET`
(`popup.view.get`), not the older snapshot path; gate is `pnpm lint && pnpm
check && pnpm test && pnpm build` + live `pnpm browser:live <target-url>`; the
Enable/Disable toggle stays enabled-with-confirm in the pending-save state
(user-accepted) — dictation must reproduce "enabled" there, discard-confirm
stays in the popup action handler.

**[ASSUMED]** (confirm in Open questions): A1 master `SessionPhase` + derived
per-surface dictations; A2 brain = sole decider, popup = pure renderer (end
state, migrated behind a flag with a parity bridge); A3 facts flow up, brain
dictates down, direct popup↔content queries removed only after parity; A4
centralize intent only; A5 first slice = the 5-button matrix driven by
`SessionPhase`; A6 persist this plan into `.copilot/plan.md` after approval.

### Open questions (recommended answer first)

1. Model shape — (1) **[ASSUMED]** master phase + derived per-surface dictations;
   (2) single machine only; (3) independent per-element enums.
2. Target authority — (1) **[ASSUMED]** brain sole decider / popup pure renderer;
   (2) permanent hybrid.
3. Fact routing — (1) **[ASSUMED]** all facts through the brain, remove direct
   popup↔content queries after parity; (2) keep direct queries, mirror into brain.
4. Stuck preview-restore — (1) **[ASSUMED]** behavior-preserving migration first,
   fix the handshake centrally in a follow-up phase; (2) fix in the same phase.
5. Rollout switch — (1) **[ASSUMED]** feature flag `centralStateDictation`;
   (2) direct cutover once parity passes.

### Non-goals

No change to content marking/silent/visibility rendering; no change to AI
payload/GraphQL/server-sync/storage; no change to the approved button-state
semantics (who-decides refactor, not what); no edit to locked content core or the
frozen page-motion pair; no implementation in the planning task.

### Implementation phases

- Phase 0 — Contracts (types only): new
  `src/common/bus/contracts/session-state.ts` with `SESSION_PHASES`/`SessionPhase`
  (`LOADING, OUT_OF_SCOPE, RENDER_MODE_INSPECTION, SILENT, MARKING_FRESH,
  MARKING_DIRTY, COMPUTING_AI, PREVIEW_OPEN, PREVIEW_RESTORING, READY_TO_SAVE,
  SAVING, SAVED, DISCARDING, RECONCILIATION_PENDING, PROPERTY_LOCK_BLOCKED`),
  `ButtonId`, `ButtonDictation` (shown/hidden + enabled/disabled + loading),
  `CurtainOperation`/`CurtainDictation`, `SessionFacts`, `SessionDictation`, and
  `SESSION_REPORT_TYPES`/`SESSION_EVENT_TYPES`. Validate `pnpm check`.
- Phase 1 — Pure deciders:
  `src/background/brain/deciders/session-phase-decider.ts`
  (`decideSessionPhase(facts)` total function, documented precedence) +
  `dictation-decider.ts` (`deriveDictation(phase, facts)` reproducing
  popup.ts:5033-5263 + page-save-state.ts exactly). Exhaustive unit tests
  `tests/session-phase-decider.test.ts`, `tests/dictation-decider.test.ts`.
- Phase 2 — Ingestion + projection (additive, popup still authoritative): extend
  `TabLayerState` (`sessionFacts`, `sessionDictation`), recompute on `mutate`;
  project `sessionPhase`/`buttons`/`curtains` in `view-projector.ts`; extend
  `PopupViewEnvelope` (optional fields); register `SESSION_REPORT_TYPES` handlers
  in `brain/index.ts`; add thin content + popup fact reporters.
- Phase 3 — Parity: `tests/dictation-parity.test.ts` (brain dictation == legacy
  popup matrix over a fact corpus) + live CDP walk on bonliva.no.
- Phase 4 — Flip popup behind `centralStateDictation` flag: `applyPopupView` /
  `popup.ts` read button+curtain dictation instead of local derivation; keep the
   flag registered in `src/common/feature-flags.ts` and the exact allowed set
   updated in `tests/feature-flags.test.ts` before rollout validation, otherwise
   the repo will hard-disable the unknown flag.
   Also,
   discard-confirm handler. Before the flag can be considered complete, inventory
   and gate every direct `uiModule.setViewState` write of button/curtain
   authority fields (for example `updateAiRunCountdownState`, popup.ts:2391-2408,
  and `beginPreviewRestorePending`, popup.ts:2996-3012) so no countdown,
  preview-restore, or similar imperative path can bypass brain dictation.
  Validate flag on/off.
- Phase 5 — Remove popup-local decision + direct content decision queries; make
  dictation default; migrate popup-matrix source-contract tests to target the
  brain deciders. As part of removal, delete or permanently gate every direct
  `uiModule.setViewState` writer that still sets button-disabled/visible/loading
  or curtain-authority fields. Full `pnpm verify`.
- Phase 6 — Unify spinner/curtain naming into `SessionDictation` on top of
  `spinner-authority`.
- Phase 7 — Knowledge + guardrail: add "Brain-Centralized System State" to
  `.copilot/knowledge.md`; instruction that button/curtain logic lives in brain
  deciders, never re-added to popup. Optional Q4 follow-up: fix preview-restore
  handshake with regression tests.

### Test matrix

Unit (phase/dictation deciders, exhaustive); source-contract (new `session-state`
shape; migrated popup-matrix assertions now on brain deciders); parity
(`dictation-parity` brain==legacy); integration (brain projects dictation, popup
applies it); live (`pnpm browser:live https://bonliva.no` walk of all phases +
Running-AI curtain + Exit-Preview). Gate: `pnpm lint && pnpm check && pnpm test &&
pnpm build`.

### Regression risks

Locked content core (additive reporter only) — HIGH; heavy popup source-contract
tests must move not delete — HIGH; post-save silent transition
(`applyPostSaveSilentTransition`, popup.ts:7156) + Preview Exit Contract must be
reproduced; spinner authority + MV3 handler-registration ordering — MEDIUM; the
known stuck preview-restore must not be frozen in as correct (Q4).

### Acceptance criteria

`decideSessionPhase` total (every fact set → exactly one phase, property test);
`deriveDictation` reproduces the approved contract rows exactly (parity green);
with the flag on the popup sets zero button-disabled flags locally, and no
imperative popup path (`uiModule.setViewState` writes such as AI countdown or
preview-restore) can still override button/curtain authority; live walk on
bonliva.no shows all three layers agreeing on every phase; no locked-core edits,
`tests/manifest-permissions.test.ts` + `tests/storage-access-boundary.test.ts`
stay green.

### Todo chain

phase-0-contracts → phase-1-deciders → phase-2-ingestion → phase-3-parity →
phase-4-flip → phase-5-remove → {phase-6-spinner, phase-7-knowledge}.

## Completed Implementation Plan: Brain-Centralized Deterministic State Coverage Follow-up (2026-06-28)

Status: COMPLETE. Phases 8-11 landed (AI-run lifecycle centralization,
property-lock/state dictation, secondary gates centralization, and parity
cleanup), and the validation gate (`pnpm lint && pnpm check && pnpm test &&
pnpm build`) is green. The detailed section below is preserved as the original
execution blueprint and pre-implementation investigation snapshot.

This plan migrated the post-push semantic-review findings into an
implementation sequence. Planning and future implementation should stay
`codebase-memory-mcp`-first to keep discovery fast and token-light. Project id:
`home-rojan-Documents-Git-GitHub-Unfluffify`.

### Goal

Extend brain-owned deterministic state beyond the shipped 5-button matrix and
curtain so the remaining popup-owned predictable state/action surfaces — AI-run
countdown/deadline lifecycle, property-lock warnings/countdowns, save/revert and
preview action gating, navigation-inspection overlay lifecycle, Lynx checklist
gating, and desktop preview toggle/gating — are projected by the brain instead
of re-derived imperatively inside `popup.ts`. Out of scope: performance-critical
marking-mode and silent-highlighting DOM/render loops.

### MCP-first workflow

1. Start each phase with `codebase-memory-mcp-search_graph` on the project id
   above, using the phase's symbol names/keywords until the exact qualified names
   are found.
2. For each target symbol, call
   `codebase-memory-mcp-get_code_snippet(..., include_neighbors: true)` before
   opening raw files.
3. Run `codebase-memory-mcp-trace_path(..., mode: "calls")` from the target
   symbols and their caller roots to map authority boundaries before editing.
4. Only then use `view`/`rg` for exact surrounding source-contract lines and
   tests.

### Current facts (verified)

- Current brain authority stops at `SessionPhase` + `SessionDictation`:
  `src/background/brain/deciders/session-phase-decider.ts`,
  `src/background/brain/deciders/dictation-decider.ts`,
  `src/background/brain/view-projector.ts`, and
  `src/popup/central-state-dictation.ts`.
- AI-run countdown/deadline is still popup-owned even though the background
  orchestrator already owns persisted run records, heartbeats, and compute-lock
  timing: `src/background/ai-run-orchestrator.ts` (`runAiCommandForTab`,
  `refreshAiRunHeartbeat`) versus popup-local
  `loadPersistedAiRunRecord`/`updateAiRunCountdownState`/`handleComputeSelectors`
  in `src/popup.ts`.
- Property-lock warnings remain popup-owned timer/view composition:
  `src/popup/property-lock-ui.ts` (`syncPropertyLockOffCandidateRefreshTimer`,
  `applyPropertyLockServerMessage`, `buildPropertyLockViewState`) still selects
  warning/countdown branches locally from popup clock state.
- Save/revert/preview guards remain duplicated in popup handlers even after
  central button dictation: `src/popup.ts` (`handleComputeSelectors`,
  `handleMarkingPreview`) plus busy/preview protections in
  `src/popup/page-reconciliation.ts`.
- Navigation inspection overlay lifecycle is still popup-local spinner
  orchestration: `src/popup.ts` (`beginNavigationInspectionOverlay` and related
  settle-poll cleanup).
- Lynx checklist gating remains popup-local:
  `src/common/lynx-checklist.ts` (`buildLynxChecklistViewModel`) +
  `src/popup.ts` (`setLynxChecklistViewState`).
- Desktop preview toggle/gating remains popup-local:
  `src/popup.ts` (`handleDesktopPreviewEnabledToggle`) still re-derives
  enablement, spinner copy, and marking-mode coupling inside the handler.

### Decisions already made

- Preserve current behavior and copy; this is an authority migration, not a
  product-logic rewrite.
- Keep `centralStateDictation` on. If short-lived bridges are still required,
  keep them local and explicitly transitional like the shipped popup dictation
  bridges.
- Countdown/timer surfaces should be self-operated renderers: the brain projects
  a timer type plus absolute/remaining time data, while popup/content countdown
  widgets own local ticking and `mm:ss` formatting without owning the mode
  selection.
- Keep performance-critical marking/silent-highlighting DOM decisions local.
  Centralize only predictable action/state surfaces.
- Extend the existing session-state/reporting contract rather than introducing a
  parallel popup-only control channel.
- For migrated action handlers, brain projections become the primary availability
  source of truth; handlers keep only irreversible safety checks such as active
  tab/config existence and stale-roundtrip revalidation where necessary.

### Non-goals

No rewrite of locked content core, property-lock protocol, AI network/orchestrator
behavior, checklist semantics, or desktop emulation behavior. No work on
marking-mode or silent-highlighting hot paths.

### Implementation phases

- Phase 8 — Brain-own AI-run lifecycle:
  - Start with `codebase-memory-mcp-search_graph` /
    `codebase-memory-mcp-trace_path` on `runAiCommandForTab`,
    `refreshAiRunHeartbeat`, `loadPersistedAiRunRecord`,
    `updateAiRunCountdownState`, and `handleComputeSelectors`.
  - Introduce explicit projected AI lifecycle facts (status, deadline/resume
    expiry, preview linkage) sourced from background/orchestrator state instead
    of popup timers.
  - Project timer type + deadline/remaining-time fields from the brain envelope;
    the popup countdown self-operates its ticks locally, formats `mm:ss`, and no
    longer owns AI lifecycle mode selection.
  - Remove popup-local AI countdown-driven button gating, keeping only immediate
    transition bridges if a roundtrip still exists.
  - Tests: `tests/ai-run-orchestrator.test.ts`,
    `tests/popup-ai-run-gating.test.ts`, and popup view-projection coverage.
- Phase 9 — Property-lock state dictation:
  - Start with `codebase-memory-mcp-search_graph` /
    `codebase-memory-mcp-trace_path` on `buildPropertyLockViewState`,
    `applyPropertyLockServerMessage`,
    `syncPropertyLockOffCandidateRefreshTimer`, and the property-lock banner
    flow.
  - Split property-lock raw facts from popup view composition: background/brain
    owns countdown timestamps + active mode enum; popup/content render projected
    tone/icon/text/button surfaces.
  - Move warning countdown authority out of popup mode selection. If a 1 Hz local
    repaint remains necessary, it must derive purely from projected timer
    type/deadline fields, self-tick locally, and render `mm:ss` without
    reintroducing popup-owned warning branches.
  - Add a property-lock decider/projector so popup no longer derives
    blocking/warning branches from local state bags.
  - Tests: `tests/popup-property-lock-ui.test.ts`, property-lock banner tests,
    and popup view projector coverage.
- Phase 10 — Secondary action/gating surface centralization:
  - Start with `codebase-memory-mcp-search_graph` /
    `codebase-memory-mcp-trace_path` on `handleComputeSelectors`,
    `handleMarkingPreview`, `handleDesktopPreviewEnabledToggle`,
    `beginNavigationInspectionOverlay`, `setLynxChecklistViewState`, and
    `buildLynxChecklistViewModel`.
  - Promote save/revert/preview handler availability, navigation-inspection
    overlay lifecycle, Lynx checklist send blocking, and desktop preview
    enable/disable visibility into projected brain state.
  - Shrink popup handlers so they consume projected allow/deny reasons and keep
    only irreversible checks (active tab presence, required ids, missing config
    fetches).
  - Reuse `SessionFacts` / `PopupViewEnvelope` when fields are session-scoped;
    add new typed view sections only when a surface is not part of the 5-button
    matrix.
  - Tests: `tests/popup-page-reconciliation.test.ts`,
    `tests/popup-state-decider.test.ts`, checklist tests, and targeted popup
    source-contract suites.
- Phase 11 — Parity cleanup and knowledge lock:
  - Delete remaining long-lived popup-local authority branches for the migrated
    surfaces.
  - Update `.copilot/knowledge.md` / guardrails only if new durable authority
    boundaries are established.
  - Run full validation (`pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`)
    once all follow-up phases land.

### Test matrix

Unit for any new decider/projector helpers; integration for popup consumption of
projected AI/property-lock/auxiliary view state; regression coverage in
`tests/popup-ai-run-gating.test.ts`, `tests/ai-run-orchestrator.test.ts`,
`tests/popup-property-lock-ui.test.ts`,
`tests/popup-page-reconciliation.test.ts`, and checklist/desktop-preview
targets; source-contract coverage must preserve regex-sensitive helper names/DI
param names. Final gate: `pnpm verify`. Use live browser only if automation and
source review cannot prove overlay/countdown parity.

### Regression risks

AI-run resume/heartbeat state is split between background and popup today, so
double-owning deadline state can reintroduce stale `computing_ai` or resume
regressions. Property-lock UI couples time-based copy to collaboration protocol
state; centralize the mode selection before simplifying timers. Handler gating
currently duplicates checks to protect against one-roundtrip stale state; do not
delete those revalidations until projected state carries every required input.
Checklist/desktop-preview surfaces mix session and config state, so centralize
authority without inventing new semantics.

### Acceptance criteria

Popup no longer decides AI-run countdown/deadline mode or property-lock warning
mode; it only renders projected state plus self-operated local ticking from
projected timer type/time fields, formatted as `mm:ss`, where a visual
second-by-second countdown is still required. Save/revert/preview,
navigation inspection, checklist send, and desktop preview controls are all
explainable from brain-projected state or explicitly documented as
performance-critical exceptions. No remaining long-lived `uiModule.setViewState`
authority writes exist for these migrated surfaces inside `popup.ts`. Full
validation passes after the implementation series.

### Todo chain

brain-followup-ai-run -> brain-followup-property-lock ->
brain-followup-secondary-gates -> brain-followup-cleanup (COMPLETE).

## Current state

1. The shipped runtime is WXT-native end to end:
   - source code lives under `src/`
   - entrypoints live under `src/entrypoints/`
   - shared types live under `src/types/`
   - stable public assets live under `src/public/`
   - `wxt.config.ts` is the sole manifest source of truth
2. The popup UI is React/JSX (`src/popup/ui.tsx`); Preact is fully removed.
   Relative imports under `src/**` are extensionless except the locked
   page-motion freeze pair.
3. The public workflow is pnpm/Node-only:
   - validation: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`,
     `pnpm verify`
   - packaging: `pnpm zip`, `node ./scripts/package-extension.mjs`
   - live browser: `pnpm browser:live <target-url>`
   - orchestration: `pnpm orchestrate:*`
   - tests: all automated coverage lives under `tests/`
4. The WXT migration, post-WXT cleanup/type-safety finalization, and the final
   WXT-finalization pass are complete and merged to `main`; their durable
   outcomes are captured in `.copilot/knowledge.md`.
5. Event-bus Tracks 0-4 and Part C native WXT adoption are complete.
6. Track H remains paused after H3 by design. Do not resume deeper
   `content-main` extraction unless a new written plan is approved.

---

## Open Implementation Plan: Eliminate Non-Backend Polling (2026-06-28)

### Goal

Make every runtime state transition event-based, predictable, and
deterministic. Remove every timer that exists only to repeatedly re-read a value
to detect a change. The only polling that may remain is polling a backend server
that offers no push channel, plus any single poll that genuinely cannot be made
event-based without breaking functionality. Each converted site must route its
state-change detection through an existing event/observer/bus seam (preferably
the brain `SessionFacts` bus) or a single deterministic deadline/one-shot timer.

### Approved decisions (2026-06-28, user)

1. Keep backend-server polls and any poll that genuinely cannot be event-based
   without breaking behavior. Convert everything else that can be safely made
   event-based.
2. AI run readiness: keep the background backend poll
   (`executeAiRunWithStatusPolling`). Convert the popup mirror
   (`continueAiRunPolling`) to subscribe to a background-pushed status event.
3. Editing the locked `src/content/core.ts` polls is approved for this plan,
   provided marking / visibility / reconciliation behavior is preserved and
   covered by regression tests.
4. SPA URL detection is replaced with a `history.pushState`/`replaceState`
   patch plus `popstate`/`hashchange` listeners (in-page, deterministic).

### Current facts (verified)

- Event seam already exists: layers publish `SessionFactsPatch` over the bus
  (`src/popup/layers/popup-bus-client.ts:publishPopupSessionFacts`,
  `src/popup.ts:publishCurrentTabSessionFacts`), the background brain folds them
  via `applySessionFactsPatch` (`src/background/brain/index.ts`,
  `src/background/brain/deciders/session-phase-decider.ts`) and pushes dictation
  back. `SessionFacts` is defined in
  `src/common/bus/contracts/session-state.ts`.
- Inspection status today is request/response only:
  `src/content/inspection-status.ts:createInspectionStatusResolver().resolve()`
  is returned through `getInspectionStatus` in
  `src/content/runtime-message-handler.ts`; the popup polls it via
  `src/popup.ts:scheduleNavigationInspectionSettlePoll` (350ms then 500-2000ms
  backoff, 30 attempts) and `src/popup.ts:scheduleStaleInspectionBusyClear`
  (150ms then 400ms retries). These polls drive the stuck "Inspecting page..." /
  "Working... controls are temporarily blocked." curtain.
- Background AI poll (EXEMPT, keep): `executeAiRunWithStatusPolling` in
  `src/background/ai-run-orchestrator.ts` using `AI_RUN_POLL_INTERVAL_MS`
  (`src/popup/ai-run.ts`).
- `src/background/sw-keepalive.ts` is a refcounted MV3 keepalive ping, not a
  state poll. Keep it.

### Polling sites and disposition

KEEP (backend / unreplaceable):

- `src/background/ai-run-orchestrator.ts` `executeAiRunWithStatusPolling`
  (backend AI readiness) — EXEMPT. Already background; keeps the SW alive via
  `sw-keepalive` for the duration of an in-flight run.
- `src/background/sw-keepalive.ts` keepalive ping — not polling. KEEP.

RELOCATE to background `chrome.alarms` (MV3 suspension-safe) — added 2026-06-28
after the "can any poll move to background safely" review:

- `src/popup.ts` token validation
  (`TOKEN_VALIDATION_INTERVAL_MS`, ~10min `popupTimers.setInterval`,
  `state.tokenValidationTimer`) -> background `chrome.alarms` periodic alarm. The
  stored token is global, so this has no popup-view coupling. Background
  validates and, on invalid, pushes a `tokenInvalid` event the popup renders as
  the existing toast + refresh. Removes the popup interval.
- `src/popup.ts` property page types refresh
  (`PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS`, ~120s `popupTimers.setInterval`,
  `schedulePropertyPageTypesRefresh`) -> background `chrome.alarms` keyed by the
  popup-registered active property (`siteId` + `stageBase`). Background runs the
  `ensurePropertyPageTypes` backend fetch + change detection and pushes a
  `propertyPageTypesChanged` event the popup folds into its existing change
  notice flags. Removes the popup interval.

Why `chrome.alarms` is the suspension-safe choice: MV3 service workers suspend
after ~30s idle, which would kill a background `setInterval`. A `chrome.alarms`
period survives suspension because the alarm wakes the worker, runs one fetch,
then lets it idle again — no keepalive required for these periodic backend
checks. The repo already holds the `alarms` permission (`wxt.config.ts`) and a
working alarms pattern in `src/background/tab-inactivity-observer.ts`. Relocating
these two also removes their popup-lifetime coupling so a closed popup no longer
silently stops the checks. NOTE: do not relocate periodic checks that must run
continuously within a tight window onto bare background `setInterval`; either
keep them event/alarm-driven or hold a `sw-keepalive` ref only for a bounded
in-flight operation (as the AI run poll already does).

CONVERT (phases below):

- P1 popup `scheduleNavigationInspectionSettlePoll` +
  `scheduleStaleInspectionBusyClear` -> content-emitted inspection-settled fact.
- P2 popup `continueAiRunPolling` -> background-pushed AI status event.
- P3 popup curtain countdown (`src/popup/ui.tsx:syncBlockingCurtainCountdownTimer`),
  popup property-lock off-candidate refresh
  (`src/popup/property-lock-ui.ts:syncPropertyLockOffCandidateRefreshTimer`),
  content property-lock banner countdown
  (`src/content/property-lock-banner.ts`) -> single deadline timer for expiry
  detection; visible seconds may keep a display-only clock tick (not a state
  poll) where a number must visibly decrement.
- P4 content URL watchers (`src/content-main.ts:silentHighlightingUrlTimer`,
  `src/content/core.ts:state.urlCheckTimer`) -> history API patch +
  popstate/hashchange.
- P5 content page-motion-pause refresh
  (`src/content/core.ts:pauseState.refreshTimer`, 250ms) -> driven by the
  existing mutation observer + scroll/resize listeners.
- P6 content completion polls:
  `src/content/core.ts:pollUntilRendered` -> render-scheduler completion
  callback/promise; `pollUntilSettled` -> `scrollend` event + bounded fallback;
  `waitForPageInspectionDelay` -> single `setTimeout(resolve, delay)`.
- P7 content silent-highlight position settle sampler
  (`src/content-main.ts:runSilentHighlightSettledRepositionSample`, recursive
  120ms) -> ResizeObserver + transitionend/animationend driven reposition.

KEEP (not polling — one-shot deadlines, debounces, watchdogs): everything the
inventory classified DEADLINE / DEBOUNCE / WATCHDOG / ONE-SHOT-DELAY (e.g.
`aiComputeLockReleaseTimer`, `popupBusyFailOpenTimer`, render-mode watchdog,
toast hide timers, snapshot/draft/render debounces, bus/tab-op timeouts).

### Non-goals

- Do not change marking/highlighting/visibility/reconciliation contracts; only
  swap the trigger mechanism (timer -> event) while keeping observable behavior.
- Do not remove the background AI backend poll, the property-page-types backend
  poll, or the SW keepalive.
- Do not change UI copy, button-state matrix, or curtain semantics; only change
  what makes the curtain clear/expire.
- Do not introduce new broad catch blocks or silent fallbacks.

### Implementation phases

Each phase is independently shippable and ends with full validation +
review-push. Order is by value and risk (P1 first; it also fixes the reported
stuck spinner).

**P1 — Inspection-settled event (fixes stuck spinner; removes 2 popup polls)**

- Add a content-side notification: when the page-inspection lifecycle reaches a
  terminal settled state (the same condition `inspection-status.ts:resolve()`
  reports as `pending === false`), publish an inspection fact over the bus to the
  brain and/or a direct `inspectionSettled` message to the popup, instead of
  waiting to be polled. Emit at the existing completion points
  (`finishPageInspectionUi` / reconciliation clear in `content-main.ts` /
  `core.ts`).
- Files: `src/common/bus/contracts/session-state.ts` (add fact field or a new
  report type), `src/content/inspection-status.ts` (expose an
  emit-on-change hook), `src/content-main.ts` (call the emit at settle points),
  `src/popup.ts` (subscribe; clear `navInspect` overlay on the event; delete
  `scheduleNavigationInspectionSettlePoll`, `scheduleStaleInspectionBusyClear`
  and their timers/maps), plus a bounded one-shot safety deadline (keep existing
  watchdog, not a poll).
- Expected state: navigating/reload clears the "Inspecting page..." curtain on
  the content event; no 350ms/500-2000ms/150ms/400ms polling remains.
- Tests: `tests/popup-*` inspection/curtain tests; add a regression asserting the
  curtain clears on the inspection-settled event and that no settle-poll timer is
  scheduled. Add a content test that the emit fires once on settle.
- Validation: focused tests, then `pnpm lint && pnpm check && pnpm test && pnpm build`.
- Rollback: if the event path regresses, the existing render-mode watchdog
  deadline still force-clears; revert popup subscription edit.

**P2 — AI status push (removes popup `continueAiRunPolling`)**

- Background already polls the backend; have it publish `aiRunStatusChanged`
  (status running/done/error + result-ready) to the popup. Popup subscribes and
  updates AI run UI reactively; delete `continueAiRunPolling` and
  `state.aiRunPollTimer`.
- Files: `src/background/ai-run-orchestrator.ts` (publish on each status
  transition), bus contract, `src/popup.ts` / `src/popup/ai-run.ts` (subscribe,
  remove loop).
- Tests: `tests/ai-run-orchestrator.test.ts` (asserts a status event is
  published on transition), popup AI-run test (reacts to event, no poll timer).

**P3 — Deadline-driven expiry (removes 1s re-derive timers)**

- Replace the 1s re-derive timers with one-shot timers scheduled at the known
  `deadlineAt`; on fire, clear/expire and refresh once. Keep a display-only
  seconds clock only where a visible countdown number must tick.
- Files: `src/popup/ui.tsx`, `src/popup/property-lock-ui.ts`,
  `src/content/property-lock-banner.ts`.
- Tests: property-lock UI tests assert expiry fires on the deadline timer and no
  1s re-derive interval is created.

**P4 — Event-based SPA URL detection (removes 2 800ms URL polls)**

- Add a single in-page navigation notifier that patches `history.pushState`/
  `replaceState` to dispatch a custom event, plus `popstate`/`hashchange`
  listeners; route both content URL watchers through it. Remove
  `silentHighlightingUrlTimer` and `state.urlCheckTimer`.
- Files: `src/content-main.ts`, `src/content/core.ts` (approved), a shared
  helper in `src/content/` for the history patch.
- Tests: content URL-watcher tests fire on pushState/replaceState/popstate/
  hashchange; assert no 800ms interval is created.

**P5 — Event-based page-motion-pause (removes 250ms refresh)**

- Drive `refreshPageMotionPause()` from the existing mutation observer and
  scroll/resize listeners instead of a 250ms interval.
- Files: `src/content/core.ts` (approved).
- Tests: pause re-applies on a simulated mutation/scroll without an interval.

**P6 — Completion as promises/events (removes render/scroll/delay polls)**

- `pollUntilRendered` -> resolve from the render scheduler's existing
  completion path; `pollUntilSettled` -> `scrollend` + bounded fallback;
  `waitForPageInspectionDelay` -> single `setTimeout(resolve, delay)`.
- Files: `src/content/core.ts` (approved).
- Tests: completion resolves on the event; delay resolves once.

**P7 — Position settle via observers (removes recursive 120ms sampler)**

- Reposition silent-highlight overlays on ResizeObserver +
  transitionend/animationend instead of the recursive 120ms position sampler.
- Files: `src/content-main.ts`.
- Tests: reposition fires on observer/transition events; no recursive sampler.

**P8 — Relocate global backend polls to background `chrome.alarms`
(suspension-safe)**

- Token validation: add a background periodic `chrome.alarms` alarm that runs
  the token validation backend check; on invalid, publish a `tokenInvalid`
  event. Popup subscribes, shows the existing toast, and refreshes. Delete the
  popup `state.tokenValidationTimer` interval and `TOKEN_VALIDATION_INTERVAL_MS`
  popup scheduling.
- Property page types: add a background periodic `chrome.alarms` alarm keyed by
  the active property the popup registers with the background (on property
  change). The alarm runs `ensurePropertyPageTypes` change detection in the
  background and publishes `propertyPageTypesChanged`. Popup subscribes and sets
  the existing change-notice flags. Delete `schedulePropertyPageTypesRefresh`'s
  popup interval. If active-property registration proves too invasive, fall back
  to keeping this one popup-scoped as a documented backend poll and ship only
  the token-validation relocation.
- Files: new `src/background/*` alarm owner(s) modeled on
  `src/background/tab-inactivity-observer.ts`, bus contract additions for
  `tokenInvalid` / `propertyPageTypesChanged`, `src/popup.ts` (register active
  property, subscribe to events, remove the two intervals).
- Reuse `src/common/browser.ts` for alarm APIs; keep storage access behind the
  approved domain/storage modules.
- Tests: a background alarm test (alarm fires -> backend check -> event
  published), a popup test (event -> toast/notice flags, no interval scheduled),
  and extend the source-contract guard so no popup `setInterval` remains for
  these two.
- Validation: focused tests, then `pnpm lint && pnpm check && pnpm test && pnpm build`.
- Rollback: if alarms misbehave on a host, revert to the popup-scoped interval
  for the affected check (token first); the bus events are additive.
- Suspension note: alarms wake the SW, so suspension cannot stop these checks;
  do not replace them with a background `setInterval`.

### Test matrix

- Unit/contract: per-phase tests above plus existing
  `tests/popup-central-state-dictation.test.ts`,
  `tests/ai-run-orchestrator.test.ts`.
- Source-contract guard: add a focused test asserting that, outside the approved
  backend polls (AI run orchestrator) and `sw-keepalive`, no `setInterval` and no
  self-rescheduling `setTimeout` poll remains in the converted files.
- Full: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` each phase.
- Live: `pnpm browser:live <target-url>` to confirm the curtain clears on
  reveal/freeze and SPA navigation still resets silent highlighting.

### Regression risks

- Curtain could get stuck if the inspection-settled event is missed: keep the
  existing render-mode/bus watchdog deadline as a non-poll safety net.
- SPA navigation reset could be missed if a site mutates the URL by means other
  than history/popstate/hashchange: covered by keeping the property-lock banner
  and silent-highlight reset reachable from the same notifier; if a real site
  regresses, this URL watcher is the one candidate to treat as an unreplaceable
  exception per decision 1.
- Editing `core.ts` risks marking behavior: preserve exact call sites; only
  change the trigger; rely on marking regression tests.

### Acceptance criteria

- After reveal/freeze and after SPA navigation, the popup "Inspecting page..." /
  "Working..." curtain clears from a content event, not a poll.
- No `setInterval` or self-rescheduling `setTimeout` poll remains in the
  converted files except the approved backend polls and `sw-keepalive`.
- All AI-run, property-lock, marking, and silent-highlight behaviors remain
  observably unchanged under the full test suite and a live round.

## Guardrails

1. Do not change locked marking/highlighting/property-lock contracts without an
   explicit new plan.
2. Keep Chrome storage access behind the approved storage/domain modules guarded
   by `tests/storage-access-boundary.test.ts`.
3. Keep the WXT/browser seams intact:
   - `common/browser.ts` remains the browser-compatible extension API seam
   - `common/storage-core.ts` remains the storage seam
   - generated manifest output must keep stable WAR/icon/cursor paths
4. For browser/live validation, use only `pnpm browser:live <target-url>` and
   the managed Playwright MCP Chromium.

## Marking Contract Lock

The 052c-derived marking restoration is complete and remains a
locked compatibility contract. Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking contract change.

Key reminders for any future work in this area:

1. Keep silent-highlighting and marking behavior aligned with
   `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Keep selector/default precedence and overlay projection behavior unchanged
   unless the task explicitly authorizes a contract change.
3. Keep AI submission behavior aligned with the locked contract: submit every stored excluded XPath row as excluded.

## Validation policy

1. Source changes: iterate with focused tests, then run `pnpm lint`,
   `pnpm check`, `pnpm test`, and `pnpm build`.
2. Docs-only changes: run `git --no-pager diff --check`.
3. Live validation is required for core unflagged browser behavior when tests
   and source review are not enough.

## Model recommendation

Use a strong reasoning model for non-trivial runtime changes. Do not let a
low-context executor infer new product behavior, reopen retired architecture
tracks, or continue the paused Track H work by continuity alone.
