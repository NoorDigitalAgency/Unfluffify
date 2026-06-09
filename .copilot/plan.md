# Unfluffify Feature-Flag Stabilization Plan

Last updated: 2026-06-09

## Objective

Stabilize the extension by putting every non-core or conflict-prone feature
behind exactly one feature flag and leaving those flags disabled for now. The
active product surface must stay small, predictable, and centered on the current
core workflow.

This is the active plan. Previous main-plan and hotfix-plan work is backlogged in
`.copilot/backlog.md`.

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

### Phase 8 - Disable Property-Lock Collaboration UI Carefully

Goal: hide nonessential collaboration UX without breaking core save/marking
protection.

Flag in this phase:

- `propertyLockCollaboration`

Files:

- `popup.js`
- `popup/ui.js`
- `background.js`
- `content-main.js`

Implementation:

1. First classify every property-lock path as either core protection or
   collaboration UX.
2. Core protection must stay: any guard that prevents unsafe marking/save when a
   lock blocks editing, and any local release needed to avoid stale editor state.
3. Collaboration UX should be disabled: takeover prompts, suggestions,
   collaborative banners not required for safety, and optional remote lock
   controls.
4. Hide disabled collaboration UI in the popup.
5. Guard disabled collaboration handlers in popup/content/background.
6. Do not change the Todo List, candidate checks, or marking entry rules in this
   phase.
7. If a path cannot be confidently classified, leave it enabled as core
   protection and record it for user review instead of risking marking safety.

Test requirements:

1. Existing tests that ensure locked editing is blocked must still pass.
2. Add tests proving disabled collaboration actions cannot be triggered.

Acceptance:

- Marking/save safety remains intact.
- Optional lock collaboration UX is not reachable.

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
