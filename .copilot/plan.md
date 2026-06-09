# Unfluffify Feature-Flag Stabilization Plan

Last updated: 2026-06-09

## Objective

Stabilize the extension by putting every non-core or conflict-prone feature
behind exactly one feature flag and leaving those flags disabled for now. The
active product surface must stay small, predictable, and centered on the current
core workflow.

This is the active plan. Previous main-plan and hotfix-plan work is backlogged in
`.copilot/backlog.md`.

## Successor Architecture Refactor

The next planned architecture track is the service-worker authority refactor.
Use these documents before making implementation changes:

1. `.copilot/service-worker-authority-refactor-plan.md`
2. `.copilot/handoff-service-worker-authority-refactor.md`

This refactor explicitly protects the 11 always-on core features, including
reveal/freeze and lazy-loading stopping/restoration.

Current implementation checkpoint status (branch `refactor/service-worker-authority`):

1. Phase 0 complete and pushed (`bb90fc3`).
2. Phase 1 complete and pushed (`76693d0`).
3. Phase 2 complete and pushed (`25923df`).
4. Phase 3 complete and pushed (`241bbc1`).
5. Phase 4 complete and pushed (`3f3c17b`).
6. Phase 5 complete and pushed (`f9651a0`).
7. Phase 6A implemented and verified in working tree; checkpoint commit/push is
   pending in this session.
8. Next strict phase after Phase 6A push: Phase 6B (marking activation
   orchestration in background).

## Debug Continuation Plan (Cross-Environment)

Status as of 2026-06-09:

1. Spinner/blocking diagnostics are now standardized across popup, background,
   and content lifecycle paths.
2. The diagnostic gate is now a build-time feature flag:
   `FEATURE_FLAGS.ufDebugSpinnerQueue = true`.
3. Legacy manual override remains supported:
   `localStorage.ufDebugSpinnerQueue = "1"`.
4. Popup blocker logging dedupe no longer keys on countdown text, so timer
   ticks do not spam logs.
5. Background spinner broker now persists and echoes metadata:
   `reason`, `source`, `startedAt`, and per-event `key`.

Implementation commits already applied:

- `60a780b` — gates spinner diagnostics with feature flags and reduces blocker
  log spam.

Scope boundary:

1. This debug work is observability-only and must not change marking-contract
   behavior, save semantics, selector precedence, or core user flows.
2. If a debug change appears to alter business behavior, treat it as a blocker
   and revert/fix before continuing to new phases.

### Cross-Environment Resume Checklist

Run this checklist first on any machine before continuing development.

1. Confirm branch and revision:
   - `git rev-parse --abbrev-ref HEAD` should be `main`.
   - `git log --oneline -n 1` should include `60a780b` or a descendant.
2. Sync the latest changes:
   - `git fetch origin`
   - `git pull --ff-only`
3. Install dependencies exactly from lockfile:
   - `npm ci`
4. Run baseline tests:
   - `npm test`
5. If tests fail in a new environment, do not start feature edits until the
   environment-specific failure is isolated and documented.

### Debug Signal Contract (Must Stay Stable)

If further debug work is required, preserve these contracts exactly.

1. Popup busy curtain debug payload must include:
   - `message`, `reason`, `source`, `spinnerKey`, `timerText`
2. Popup blocker dedupe signature must include:
   - `message`, `reason`, `source`, `spinnerKey`
   - and must exclude `timerText`.
3. Content lifecycle debug events must normalize `reason` and `source` before
   trace emission.
4. Background spinner serialization must preserve `reason`, `source`, and
   `startedAt` for snapshots.

### Quick Validation Commands

Use these commands for fast confidence after any debug-related edit.

1. Focused contracts:
   - `npm test -- tests/feature-flags.test.js tests/popup-marking-refresh.test.js tests/world-trace-contract.test.js`
2. Full regression sweep:
   - `npm test`

Expected current baseline:

1. Focused contracts pass.
2. Full suite passes.
3. No repeated popup blocker logs triggered solely by countdown timer updates.

### Manual Browser Verification (Any Host)

Use one staging page and verify logs in both popup and page consoles.

1. Keep feature flag default enabled (`ufDebugSpinnerQueue: true`).
2. Trigger a blocking flow (for example, page inspection or AI run).
3. Confirm popup logs include `[popup-blocker]` entries with `reason/source`.
4. Confirm page logs include `[page-blocker]` entries with normalized
   `reason/source` and lifecycle context.
5. Confirm timer text can change without generating repeated blocker logs when
   all non-timer fields remain unchanged.

### Known Portability Notes

1. `ufDebugSpinnerQueue` is now environment-stable by default because it is
   feature-flag-driven, not storage-dependent.
2. LocalStorage override is best-effort and should be treated as a temporary
   diagnostic control, not a source of truth.
3. `manifest.json` now exposes `common/feature-flags.js` as a web-accessible
   resource for content-side debug gating.

### Next Debug Backlog (Only If User Requests)

1. Add a small runtime counter metric for deduped popup blocker log skips
   (diagnostic-only, no user-facing behavior change).
2. Add a smoke test that asserts countdown updates do not emit additional
   blocker logs when signature fields are unchanged.
3. Consider consolidating popup/page debug-gate checks into one shared helper to
   reduce drift risk.

## Synced Session Plan (Acapedia Collaborative Regression)

Sync source: `/memories/session/plan.md`
Sync timestamp: 2026-06-09
Sync intent: keep repository plan and session-memory plan aligned so work can
resume in another environment without missing diagnostics context.

### Completion Snapshot

Status values:

- DONE: implemented and validated.
- READY: plan finalized, pending collaborative execution.
- BLOCKED: requires user decision or environment prerequisites.

Current state:

1. Spinner diagnostic instrumentation and gating: DONE.
2. Collaborative Acapedia issue-discovery execution: READY.
3. Live write actions (AI run, Send to Lynx): BLOCKED until explicit user
   approval in-session.

Spinner track marked done with evidence:

1. Popup blocker dedupe no longer includes timer text.
2. Spinner diagnostics are feature-flag gated through
   `FEATURE_FLAGS.ufDebugSpinnerQueue` with legacy storage override retained.
3. Popup/page/background diagnostics now preserve or emit structured reason
   metadata (`reason`, `source`, `spinnerKey` or `key`, `startedAt` where
   applicable).
4. Validation passed:
   - Focused contracts:
     `npm test -- tests/feature-flags.test.js tests/popup-marking-refresh.test.js tests/world-trace-contract.test.js`
   - Full suite:
     `npm test`
   - Last known full-suite baseline: 648/648 pass.
5. Implementation commit:
   - `60a780b` (`feat(debug): gate spinner diagnostics and reduce blocker log spam`).

### Collaborative Acapedia Plan (Synced)

#### Phase 1 - Issue Discovery And Logging Baseline (READY)

Goals:

1. Capture all regressions and blockers before any new fixes.
2. Capture explicit reason logs for every blocking spinner/curtain.

Procedure:

1. Confirm branch/build and run `npm test` once to set baseline.
2. Open `https://acapedia.no/` and bind popup to page tab.
3. Enable and capture logs from popup console, page console, and service worker
   console.
4. Build a live issue register with per-issue evidence:
   - reproduction step
   - expected vs observed
   - relevant logs
   - network signal (if applicable)
   - screenshot/evidence id
   - blocker severity
5. For each blocking spinner/curtain, capture:
   - surface (`popup`, `page`, `background-brokered`)
   - key/spinner id (if available)
   - visible message
   - reason/source
   - tab id
   - start time and clear behavior
6. Do not fix during this phase; stop after first complete issue list.

Spinner evidence checklist for this phase:

1. Popup blocker logs include `[popup-blocker]` with reason/source.
2. Page blocker logs include `[page-blocker]` with normalized reason/source.
3. Timer countdown updates do not produce duplicate blocker logs when signature
   fields are unchanged.

#### Phase 2 - Collaborative Environment Setup (READY)

Prerequisites:

1. User enters credentials/JWT manually; no secrets persisted in plan, memory,
   or logs.
2. User confirms whether live backend writes are allowed.

Procedure:

1. Configure endpoints in popup UI as needed:
   - Configuration Endpoint: `https://unfluffify.lynxdev.se`
   - AI Endpoint: `https://unfluffify.dnscdn.se:8443`
   - Stage Base: `a.lynxdev.se`
2. Confirm login state before moving forward.
3. If auth fails, record as issue and pause for user direction.

#### Phase 3 - Core Popup And Configuration Smoke (READY)

Checks:

1. Popup opens and configuration/login views are reachable.
2. Optional disabled extras remain absent/inert.
3. Any blocking curtain has reason/source evidence.

#### Phase 4 - Page Detection, Mobile Emulation, Manual Render Mode (READY)

Checks:

1. Default mobile simulation remains active.
2. Manual render-mode controls are present and functional.
3. Inspecting/navigation spinner transitions show reasoned logs.
4. Auto-detection endpoint path remains inactive while disabled.

#### Phase 5 - Marking Workflow On Acapedia (READY)

Checks:

1. Marking mode enables and reveal/freeze path behaves.
2. Overlays and marking state changes work.
3. Property-lock disabled collaboration surfaces do not block core marking.
4. Spinner reason logs captured for inspection/reveal/lazy-settle paths.

#### Phase 6 - Preview Lists And Todo List (READY)

Checks:

1. Marking preview list path works.
2. Silent preview list path works when data exists.
3. Todo List state matches candidate/page-type status.
4. `previewExpandedStates` disabled feature remains non-activatable.

#### Phase 7 - AI Run And Send To Lynx (BLOCKED pending user approval)

Checks when approved:

1. AI run lifecycle logs and blocker reasons are captured.
2. AI outputs flow into preview paths correctly.
3. Send to Lynx request/response and blocker evidence captured.

If not approved:

1. Record these paths as intentionally not executed.
2. Validate only readiness/gating state.

#### Phase 8 - Triage And Fix Planning (READY after issue capture)

Rules:

1. Group issues by layer (popup/content/background/network/feature flags).
2. Prioritize blockers first.
3. Propose one focused fix plan per issue.
4. User selects fix target before implementation.

### Cross-Environment Handoff Guardrails

Before resuming on another machine:

1. Pull latest `main` and verify commit ancestry includes `60a780b`.
2. Run focused debug contracts and full suite.
3. Preserve this synced phase ordering; do not jump to fixes before Phase 1
   evidence capture.
4. Keep secrets out of repo files, memory notes, screenshots, and transcripts.

## Confirmed Core Features

These features must remain unflagged and usable throughout this work:

1. Configurations and login.
2. Rendering mode selection, including Without JavaScript and With JavaScript
   inspection modes.
3. Reveal/freeze round.
4. Lazyloading stopping.
5. Always-on mobile mode.
6. Marking mode.
7. Preview list from marking mode.
8. Preview list from silent highlighting mode.
9. Todo List.
10. AI run.
11. Send to Lynx.

If an implementation step would hide, disable, shortcut, or rewrite any item in
this list, stop and ask the user before continuing.

## Marking Contract Lock

Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-rules contract change.

052c-derived marking restoration completed and is treated as a locked contract.

AI-submission behavior must continue to submit every stored excluded XPath row as excluded, with existing immutable/default handling rules preserved.

## Feature Flags To Add

All flags default to `false`. `false` means the feature is disabled and hidden or
blocked. Each feature has exactly one owning flag.

| Flag | Disabled feature | Core behavior that must remain |
|------|------------------|--------------------------------|
| `remoteSupport` | Remote Support request/join/viewer/offscreen/support page. | Configuration/login, marking, AI, and Send to Lynx. |
| `desktopPreview` | Preview in desktop mode, desktop emulation, persisted `desktopPreviewEnabled`. | Always-on mobile mode and normal preview lists. |
| `deviceEmulationToggle` | Manual mobile/desktop switching and Ctrl/Cmd+M page hotkey. | Default mobile emulation stays on. |
| `traceDiagnostics` | Trace Mode checkbox, trace event panel, cross-world trace toggles. | Normal messaging and non-trace logs. |
| `renderModeAutoDetection` | Endpoint-driven `/is_js_rendered` auto detection. | Manual render-mode selection and Without/With JavaScript inspection. |
| `appearanceCustomization` | Theme/appearance controls inside Extras. | Required configuration fields and login. |
| `cacheAndUnregisterTools` | Clear-domain-cache and unregister/reload debug tools. | Normal configuration and page workflows. |
| `propertyLockCollaboration` | Nonessential collaborative lock UX such as takeover/suggestion surfaces. | Minimal lock guards needed to protect marking/save integrity. |
| `previewExpandedStates` | Extra Preview sidebar `Show all states` toggle. | Marking preview list and silent highlighting preview list. |

## Implementation Principles

1. Add the central flag source first, then wire one feature at a time.
2. Never rely on UI hiding alone. Any side-effectful feature needs handler and
   runtime-message guards too.
3. Prefer forcing disabled state to simply hiding state when stale persisted data
   can re-enable a feature, especially for desktop preview.
4. Keep disabled-feature responses explicit: return `{ ok: false,
   reason: "feature_disabled", feature: "flagName" }` where a message expects a
   response.
5. Do not remove code in the first pass unless it is dead documentation-only
   cleanup. Gate behavior first; removal can be a later cleanup.
6. Do not change manifest permissions yet. Permission tightening is a separate
   follow-up after the disabled build is verified.
7. Keep tests focused. Add or update tests around guards and view state instead
   of broad refactors.

## Safe Work Order

Complete the phases in order. Do not skip ahead.

### Phase 0 - Baseline And Guardrails

Goal: prove the workspace is stable before editing runtime code.

Tasks:

1. Confirm no unrelated dirty files. If unrelated user changes exist, leave them
   untouched and work around them.
2. Run `npm test` once and record whether it passes. If it fails before any
   feature-flag code edits, record the failing tests and continue only with
   targeted changes that do not depend on those failures.
3. Re-read `.copilot/knowledge.md` sections for Marking and Highlighting Rules,
   AI Submission Rules, and Page Save and Candidate Completion.
4. Re-read this plan before starting each phase.

Acceptance:

- Baseline status is known.
- No source files are changed in Phase 0 except optional plan notes.

### Phase 1 - Central Flag Module

Goal: create a single source of truth for all feature flags.

Files:

- Add `common/feature-flags.js`.
- Add `tests/feature-flags.test.js`.

Implementation:

1. Export a frozen `FEATURE_FLAGS` object with all nine flags set to `false`.
2. Export `isFeatureEnabled(flagName)` that returns `true` only when the exact
   flag exists and is `true`.
3. Export `getFeatureFlags()` that returns a shallow frozen copy or safe readonly
   object for view state use.
4. Export `FEATURE_DISABLED_REASON = "feature_disabled"`.
5. Do not read flags from Chrome storage in this pass. These are build-time
   constants for stabilization.

Test requirements:

1. Every confirmed flag exists and defaults to `false`.
2. Unknown flags return disabled.
3. `getFeatureFlags()` cannot be used to mutate the source flags.

Acceptance:

- `node --test tests/feature-flags.test.js` passes.
- No product behavior changes yet except the new module and tests.

### Phase 2 - Popup View-State Plumbing

Goal: make the popup aware of flags without changing core flows.

Files:

- `popup.js`
- `popup/ui.js`

Implementation:

1. Import the flag helpers in `popup.js`.
2. Add `featureFlags` to the popup view state generated by `refreshUi`.
3. In `popup/ui.js`, read flags from `view.featureFlags || {}` and default all
   missing flags to disabled.
4. Do not change the confirmed core controls in this phase.
5. Add a small local helper in `popup/ui.js`, for example
   `isPopupFeatureEnabled(view, flagName)`, so individual render sections do not
   duplicate flag lookup logic.

Test requirements:

1. Add or update a popup view-state test that proves missing flags are treated
   as disabled.
2. Confirm core controls still render when the optional flags are disabled.

Acceptance:

- Focused popup tests pass.
- The popup can render with disabled flags and without `featureFlags` present.

### Phase 3 - Disable Low-Risk UI-Only Extras

Goal: remove optional UI clutter first, with minimal runtime risk.

Flags in this phase:

- `appearanceCustomization`
- `traceDiagnostics` UI only
- `previewExpandedStates` UI only

Files:

- `popup/ui.js`
- `popup.js` only if view-state fields need forced defaults.

Implementation:

1. Hide the appearance subsection when `appearanceCustomization` is disabled.
   Do not hide endpoint fields, stage base, or login.
2. Hide the Trace Mode diagnostics subsection when `traceDiagnostics` is
   disabled.
3. Force `traceModeEnabled` to `false` in view state when `traceDiagnostics` is
   disabled.
4. Hide the Preview sidebar `Show all states` checkbox when
   `previewExpandedStates` is disabled.
5. Force `previewShowAllCategories` to `false` when `previewExpandedStates` is
   disabled.
6. Keep the preview sidebar list, Exit Preview action, row focus, and preview
   title working.

Handler guards:

1. In `popup.js`, make `handlePreviewShowAllCategoriesChange` return
   immediately when `previewExpandedStates` is disabled.
2. In `popup.js`, make `handleTraceModeToggle` return immediately when
   `traceDiagnostics` is disabled.

Test requirements:

1. Disabled trace UI is absent and handler cannot enable trace state.
2. Disabled preview-expanded UI is absent and the normal preview list still
   renders.
3. Configuration/login fields still render.

Acceptance:

- Core preview entry points still work in tests.
- Trace cannot be enabled from the popup when disabled.

### Phase 4 - Disable Desktop Preview And Manual Device Switching

Goal: keep the extension always mobile while removing paths that switch to
desktop or disable emulation.

Flags in this phase:

- `desktopPreview`
- `deviceEmulationToggle`

Files:

- `popup.js`
- `popup/ui.js`
- `popup/helpers.js`
- `common/emulation.js`
- `background.js`
- `content-main.js`

Implementation:

1. Hide the desktop-preview checkbox and explanatory note when `desktopPreview`
   is disabled.
2. In `popup.js`, force `nextViewState.desktopPreviewVisible = false`,
   `nextViewState.desktopPreviewEnabled = false`, and any desktop-preview
   disabled/loading state to a harmless default when `desktopPreview` is
   disabled.
3. In `popup.js`, prevent `persistDesktopPreviewEnabled(tabId, true)` from
   writing `true` when `desktopPreview` is disabled. It may write `false` to
   clean stale state.
4. In `background.js`, ignore or normalize incoming tab-state updates that try
   to set `desktopPreviewEnabled: true` when `desktopPreview` is disabled.
5. In `common/emulation.js`, reject `desktop` mode and reject `enabled:false`
   updates when the relevant flags are disabled. Keep
   `ensureDefaultMobileDeviceEmulation(tabId)` working.
6. In `content-main.js`, gate `toggleDeviceEmulationFromPage()` and the
   Ctrl/Cmd+M keydown branch behind `deviceEmulationToggle`.
7. In popup handlers, prevent manual device toggles from disabling mobile or
   selecting desktop while `deviceEmulationToggle` is disabled.

Test requirements:

1. Existing always-mobile tests still pass.
2. Add or update tests so a disabled desktop-preview flag prevents
   `desktopPreviewEnabled` from becoming true.
3. Add or update tests so manual emulation disable/desktop requests fail or
   normalize back to mobile when disabled.
4. Add a content hotkey test if a suitable harness already exists; otherwise
   record the manual test in the final implementation notes.

Acceptance:

- Opening a supported page still applies mobile simulation by default.
- Ctrl/Cmd+M cannot disable mobile simulation.
- Desktop preview cannot be persisted, shown, or applied.

### Phase 5 - Disable Remote Support

Goal: block Remote Support at every layer while preserving unrelated runtime
messages.

Flag in this phase:

- `remoteSupport`

Files:

- `popup.js`
- `popup/ui.js`
- `background.js`
- `content-main.js`
- `remote-support-offscreen.js` only if it has an entrypoint that can start
  without a background guard.
- `remote-support-viewer.js` only if it has an entrypoint that can start without
  a background guard.

Implementation:

1. Hide the Remote Support section in configuration extras.
2. Force remote-support view-state fields to inactive defaults when the flag is
   disabled.
3. Guard all popup remote-support handlers. A disabled handler should close any
   transient popover/state and return without sending runtime messages.
4. In `background.js`, find the central remote-support message handling path by
   searching `REMOTE_SUPPORT_MESSAGE_TYPES`. Add one guard before dispatch so all
   remote-support messages return `{ ok: false, reason: "feature_disabled",
   feature: "remoteSupport" }`.
5. Ensure any existing remote-support state is treated as inactive when disabled.
6. In `content-main.js`, gate support-page detection and support-page message
   handlers so the page does not inject or sync remote-support controls while the
   flag is disabled.
7. Do not remove remote-support permissions or manifest resources in this phase.

Test requirements:

1. Existing remote-support tests should be updated to expect disabled responses
   when flags are false, or split so legacy enabled behavior is only tested by
   explicitly overriding the flag in a controlled test seam.
2. Add a background-message guard test for at least one requester message and one
   supporter/join message.
3. Add a popup render test proving the Remote Support section is absent.

Acceptance:

- No UI can start Remote Support.
- Runtime messages cannot start or join a Remote Support session.
- Core configuration/login and marking still work.

### Phase 6 - Disable Render-Mode Auto Detection

Goal: keep manual render-mode selection while stopping endpoint-driven detection.

Flag in this phase:

- `renderModeAutoDetection`

Files:

- `popup.js`
- `background.js`

Implementation:

1. In `shouldAutoDetectRenderMode(sourceConfig)`, return `false` immediately
   when `renderModeAutoDetection` is disabled.
2. In `maybeAutoDetectRenderMode(pageUrl)`, ensure disabled auto-detection falls
   back to `config.getConfigRenderMode(state.currentConfig)` or
   `RENDER_MODE_UNDETERMINED` exactly as the manual flow expects. Do not call
   `detectRenderModeViaEndpoint`.
3. In `background.js`, guard the `requestRenderModeDetection` runtime message so
   direct callers receive `{ ok: false, reason: "feature_disabled", feature:
   "renderModeAutoDetection" }`.
4. Do not remove or disable `renderModeInspectionBegin`,
   `runRenderModeRevealOnce`, `captureRenderModeInspectionHtml`, or
   `renderModeInspectionEnd`. Those are part of the manual Without/With
   JavaScript inspection workflow.

Test requirements:

1. Auto detection does not call the endpoint when disabled.
2. Manual render-mode Set still works.
3. The Without JavaScript and With JavaScript inspection buttons remain visible
   and keep their existing order.

Acceptance:

- `/is_js_rendered` is not requested when the flag is disabled.
- Manual render-mode confirmation still gates marking, AI, and Send to Lynx.

### Phase 7 - Disable Cache/Unregister Tools

Goal: remove destructive/debug maintenance actions from the active product
surface.

Flag in this phase:

- `cacheAndUnregisterTools`

Files:

- `popup/ui.js`
- `popup.js`
- `background.js`

Implementation:

1. Search for clear-cache and unregister/reload actions by these strings:
   `clearingCacheAndReloading`, `unregisteringTabAndReloading`, `clearDomain`,
   `unregister`, and `browsingData`.
2. Hide the corresponding menu actions when `cacheAndUnregisterTools` is
   disabled.
3. Guard popup handlers so they return without queueing spinners or sending
   runtime messages when disabled.
4. Guard background runtime messages that clear browsing data or unregister the
   tab, returning a disabled-feature response.
5. Do not remove normal reload/navigation behavior.

Test requirements:

1. Disabled actions are absent from menus.
2. Direct handler/runtime calls cannot clear cache or unregister a tab.

Acceptance:

- No disabled destructive action is reachable from UI or runtime messages.

### Phase 8 - Disable The Property-Lock Mechanism Completely

Goal: remove every active property-lock behavior while the feature is disabled.
Do not merely hide the UI. The current lock mechanism is not stable enough to run
invisibly: hidden locks, cooldowns, banners, stale recovery state, or background
WebSocket activity can block users without an obvious reason when the visible UI
is absent.

Flag in this phase:

- `propertyLockCollaboration`

Files:

- `popup.js`
- `popup/ui.js`
- `background.js`
- `content-main.js`
- `common/property-lock-background.js`
- `common/property-lock.js` only if a shared disabled-state helper is needed
- property-lock-focused tests and feature-flag source-contract tests

Implementation:

1. Treat `propertyLockCollaboration === false` as an inactive-lock contract:
   property-lock state must normalize to unlocked/inactive, no lock may block
   marking, saving, preview, configuration, render-mode inspection, or page
   interaction, and no hidden lock warning should be shown.
2. In `popup.js`, add a small feature gate/helper for the property-lock flag and
   use it before every popup-side lock operation. When disabled, it must:
   reset lock state to the inactive defaults, clear off-candidate/recovery
   refresh timers, set all `propertyLock*Visible` action fields to false, and
   make `isPropertyLockBlockingEditing()` return false.
3. In `popup.js`, skip property-lock reads and writes when disabled: do not call
   `fetchPropertyLockState`, `refreshPropertyLockSnapshot`,
   `sendPropertyLockCommand`, `persistPropertyLockRecoveryMetadata`, or any
   recovery/off-candidate timer path. Stored recovery metadata read from initial
   tab state must be ignored while disabled and cleared or normalized to empty
   values on the next relevant tab-state write.
4. In `popup/ui.js`, hide the entire property-lock indicator and every lock
   action when the flag is disabled. The UI gate is only the visual layer; popup
   handlers must also be blocked as described above.
5. In `background.js`, guard every runtime message in
   `PROPERTY_LOCK_MESSAGE_TYPES`. Direct callers must receive
   `{ ok: false, reason: "feature_disabled", feature: "propertyLockCollaboration" }`
   instead of reaching `handlePropertyLockBackgroundMessage`.
6. In `background.js`, avoid initializing property-lock background runtime while
   disabled. `initPropertyLockBackground()` must not register active
   `chrome.runtime.onConnect` listeners for the property-lock port when the flag
   is false, and tab-removal cleanup must be a harmless no-op or disabled guard.
7. In `common/property-lock-background.js`, add defensive disabled handling so a
   property-lock port or imported handler cannot create WebSocket runtimes,
   reconnect timers, heartbeat timers, network checks, or lock state if it is
   reached unexpectedly. Existing active runtimes must be disposed when disabled.
8. In `content-main.js`, skip the mechanism at startup and during navigation:
   do not call `runPropertyLockSync`, do not connect the property-lock port, do
   not send draft/activity/take/release/suggest/respond/continue messages, and
   do not fetch lock snapshots from the background while disabled.
9. In `content-main.js`, neutralize all page-facing lock effects while disabled:
   remove or keep hidden the lock banner, clear countdown timers, clear recovery
   release timers, make `isPropertyLockInteractionBlocked()` and
   `checkPropertyLockBlocksMarking()` return nonblocking results, and avoid
   lock-related toasts.
10. In `content-main.js`, ignore persisted lock recovery and off-candidate
    metadata while disabled. Clear in-memory values such as recovery site/base
    URL/client/deadline and off-candidate deadline, and write empty tab-state
    values only through the existing tab-state utilities if a cleanup write is
    needed.
11. Preserve core marking/save behavior by absence of property-lock blocking,
    not by keeping partial lock protection alive. Do not change default-exclusion
    taxonomy, target resolution, sync semantics, overlay projection, Todo List,
    candidate checks, AI submission rows, manual render-mode inspection, or
    marking entry rules.
12. If any remaining property-lock code must stay imported for constants or
    tests, keep it passive: pure constants and normalizers are acceptable; active
    listeners, timers, WebSockets, DOM banners, runtime messages, state writes,
    and blocking guards are not.

Test requirements:

1. Add source-contract tests proving popup state building ignores property-lock
   blockers, recovery metadata, off-candidate timers, and action handlers while
   `propertyLockCollaboration` is disabled.
2. Add background tests proving every `PROPERTY_LOCK_MESSAGE_TYPES` message and
   property-lock port path is blocked or inert with the disabled-feature
   response and no WebSocket/runtime creation.
3. Add content tests proving startup, navigation, URL-change, draft-status,
   banner, interaction-blocking, recovery, off-candidate, and command paths do
   not call `runPropertyLockSync`, connect ports, send lock messages, persist
   lock metadata, or block marking while disabled.
4. Keep existing marking, save, AI submission, Todo List, candidate, and manual
   render-mode inspection tests passing.

Acceptance:

- With `propertyLockCollaboration` disabled, property lock is fully inert:
  no UI, no hidden blocking, no WebSocket/port activity, no timers, no recovery
  cooldowns, no persisted lock metadata effects, and no direct runtime command
  side effects.
- Marking, saving, preview, manual render-mode inspection, Todo List, candidate
  checks, and AI submission continue to work as though no property lock exists.

### Phase 9 - Final Cross-Feature Verification

Goal: prove disabled features do not leak back in and core features still work.

Required automated checks:

1. `npm test`
2. Focused tests touched by the implementation.
3. `node --test tests/feature-flags.test.js`

Required source checks:

1. Search for each flag name and confirm it has UI and handler/runtime coverage
   where applicable.
2. Search for `desktopPreviewEnabled` and confirm disabled state is forced false.
3. Search for `requestRenderModeDetection` and confirm both popup and background
   guards exist.
4. Search for `REMOTE_SUPPORT_MESSAGE_TYPES` and confirm one central disabled
   guard exists.
5. Search for `TRACE_SET` / `ufTraceSet` and confirm disabled trace cannot be
   enabled.

Manual smoke checklist:

1. Open popup on a supported page.
2. Confirm configuration and login view is usable.
3. Confirm render-mode manual controls show Without JavaScript and With
   JavaScript inspection modes.
4. Confirm supported page defaults to mobile simulation.
5. Confirm marking can be enabled.
6. Confirm reveal/freeze/lazyload stopping still runs where expected.
7. Confirm Todo List renders.
8. Confirm AI run can start from a valid marked setup.
9. Confirm marking preview list can open after a fresh AI result.
10. Confirm silent preview list can open from saved selectors.
11. Confirm Send to Lynx remains visible and guarded in silent highlighting mode.
12. Confirm Remote Support, desktop preview, manual device toggle, Trace Mode,
    Appearance, cache/unregister tools, render auto detection, property-lock
    collaboration extras, and Preview `Show all states` are absent or blocked.

Acceptance:

- All automated checks pass, or any pre-existing failures are clearly documented.
- Every disabled feature is blocked at UI and side-effect layers.
- Every confirmed core feature remains reachable.

## Implementation Stop Conditions

Stop and ask the user before continuing if any of these happen:

1. A core feature from the confirmed list must be modified to implement a flag.
2. A feature cannot be disabled without deleting or rewriting large subsystems.
3. Property-lock paths cannot be safely classified as core protection versus
   collaboration UX.
4. Tests fail in a way that suggests marking, AI payloads, render-mode manual
   flow, or Send to Lynx changed unexpectedly.
5. A live backend write would be required to verify a step and the user has not
   approved it.

## Completion Definition

The stabilization implementation is complete only when:

1. All nine flags exist and default to disabled.
2. Each disabled feature is hidden from UI and blocked in handlers/runtime paths.
3. The 11 confirmed core features remain unflagged and usable.
4. `npm test` passes or pre-existing failures are documented with exact failing
   tests.
5. The final implementation notes list every changed file and every flag's
   enforcement point.
