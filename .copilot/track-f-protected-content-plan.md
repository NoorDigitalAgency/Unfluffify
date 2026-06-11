# Track F Dedicated Plan - Protected Content Areas

Last updated: 2026-06-11
Branch: main
Status: F1-F21 complete and pushed per-slice; F22-F24 are the next mechanical phases.

Current validation baseline:
```bash
npm test
# 906 pass / 0 fail
```

Review status:
- F1-F19 were reviewed on 2026-06-11.
- No behavioral regressions were found in the extracted handlers.
- All new imported `content/*` modules had manifest entries and tests.
- F20 completed with focused validation plus a green full suite.
- F21 completed with focused validation plus a green full suite.
- Pre-code fixes before F22 are not required.

Lowest recommended model and effort:
- F20-F22: GPT-4.1-mini-class coding model at high effort.
- F23-F24: stronger coding model at high effort.
- Do not assign explicit include/exclude or marking-contract work to a small or
  low-effort model.

## Approval

Track F required explicit user approval before implementation.

Approval evidence:
- Assistant reported that Track F required explicit approval before starting.
- User replied: "Continue" on 2026-06-11.

## Phase F1 - Page Toast Helper Extraction

Why this phase:
- `content-main.js` still owns page-toast style/DOM/timer logic that is independent
  from marking decisions.
- This is the lowest-risk Track F extraction and reduces main-file UI utility
  surface while preserving behavior.

New module:
- `content/page-toast.js`

Files to edit:
- `content-main.js`
- `content/page-toast.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/page-toast.test.js`

Exact function boundary:
- Move page-toast internals currently inside:
  - `ensurePageToastStyle`
  - `showPageToast`
- Keep a thin `showPageToast` wrapper in `content-main.js` so current call sites
  remain unchanged.
- Keep snapshot stripping behavior (`#unfluffify-page-toast` and
  `#unfluffify-page-toast-style`) exactly preserved.

Rules:
1. Do not alter toast copy strings or call sites.
2. Do not alter toast display duration (3000ms).
3. Keep `data-uf-extension-ui="true"` on toast root.
4. Keep style z-index/position/animation semantics unchanged.
5. Do not touch marking, selector, or silent-highlight decision logic.

Focused validation:
```bash
npm test -- tests/page-toast.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js
```

Full validation:
```bash
npm test
```

Live validation:
- Optional for this phase; proceed only if automated tests and code review are
  not sufficient.

Rollback criteria:
- Any regression in content activation/order tests, snapshot stripping, or UI
  filtering behavior should trigger rollback of the phase.

Commit message:
```text
refactor(content): extract page toast helper
```

## Phase F2 - Render-Mode Inspection Lifecycle Client (Session Flag + Watchdog)

Why this phase:
- `content-main.js` still directly owns render-mode inspection session flag storage
  and watchdog timer plumbing.
- This is a behavior-preserving extraction boundary that reduces lifecycle
  mechanics in the main file without moving protected marking logic.

New module:
- `content/render-mode-inspection-client.js`

Files to edit:
- `content-main.js`
- `content/render-mode-inspection-client.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/render-mode-inspection-client.test.js`

Exact function boundary:
- Move only these mechanics into module:
  - session flag read/write (`sessionStorage`)
  - watchdog timer arm/clear
- Keep these behaviors and call sites in `content-main.js`:
  - `recoverFromStuckRenderModeInspection`
  - command/runtime message handlers for begin/reveal/capture/end
  - all marking/silent-highlight/reveal decision logic

Rules:
1. Preserve `isRenderModeInspectionActive()` semantics exactly (`in-memory || persisted`).
2. Keep watchdog timeout value and recovery callback behavior unchanged.
3. Do not move or edit protected marking/inspection command flow in this phase.
4. Keep all existing message types and lifecycle event payloads unchanged.

Focused validation:
```bash
npm test -- tests/render-mode-inspection-client.test.js tests/content-activation-order.test.js tests/render-mode-inspection-order.test.js tests/property-lock-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in render-mode inspection ordering, activation gating, or
  property-lock reconnect behavior should trigger rollback of this phase.

Commit message:
```text
refactor(content): extract render mode inspection lifecycle client
```

## Phase F3 - Runtime Inspection Handler Delegation

Why this phase:
- `content-main.js` still duplicated render-mode inspection behavior in two paths:
  command-router handlers and legacy runtime-message branches.
- This phase reduces divergence risk by reusing one authoritative handler set.

Files to edit:
- `content-main.js`
- `tests/content-activation-order.test.js`
- `tests/render-mode-inspection-order.test.js`
- `tests/property-lock-render-mode.test.js`

Exact function boundary:
- Keep runtime listener branches (`if (message.type === "...")`) intact for
  compatibility and source contracts.
- Replace duplicated inspection logic inside runtime branches with delegation to:
  - `handleGetInspectionStatusCommand`
  - `handleRenderModeInspectionBeginCommand`
  - `handleRunRenderModeRevealOnceCommand`
  - `handleCaptureRenderModeInspectionHtmlCommand`
  - `handleRenderModeInspectionEndCommand`
  - `handleHideConsentForInspectionCommand`

Rules:
1. Preserve message type names and runtime response shapes.
2. Preserve async reply behavior (`return true` for async branches).
3. Do not alter reveal/capture/end semantics or lifecycle phases.
4. Keep property-lock reconnect banner recovery behavior unchanged.

Focused validation:
```bash
npm test -- tests/render-mode-inspection-order.test.js tests/content-activation-order.test.js tests/property-lock-render-mode.test.js tests/render-mode-inspector.test.js tests/popup-mode-sync.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in inspection ordering, popup inspection status polling, or
  property-lock inspection reconnect handling should trigger rollback.

Commit message:
```text
refactor(content): dedupe runtime inspection handlers
```

## Phase F4 - Inspection Status Resolver Extraction

Why this phase:
- `handleGetInspectionStatusCommand` still held a concentrated status-composition
  block in `content-main.js`.
- Extracting this pure status computation lowers main-file complexity while
  preserving all runtime and command-router contracts.

New module:
- `content/inspection-status.js`

Files to edit:
- `content-main.js`
- `content/inspection-status.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/content-activation-order.test.js`
- `tests/popup-mode-sync.test.js`
- Add `tests/inspection-status.test.js`

Exact function boundary:
- Move only inspection-status computation into module.
- Keep `handleGetInspectionStatusCommand` as a thin wrapper in
  `content-main.js`.
- Leave begin/reveal/capture/end inspection handlers unchanged in this phase.

Rules:
1. Preserve `getInspectionStatus` response shape exactly.
2. Preserve pending/active semantics and mode/markingEnabled fields.
3. Do not alter lifecycle event flow or inspection reveal/capture ordering.

Focused validation:
```bash
npm test -- tests/inspection-status.test.js tests/content-activation-order.test.js tests/popup-mode-sync.test.js tests/render-mode-inspection-order.test.js tests/render-mode-inspector.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup mode reconciliation, inspection-status polling, or
  render-mode orchestration should trigger rollback.

Commit message:
```text
refactor(content): extract inspection status resolver
```

## Phase F5 - Render-Mode Inspection Handler Extraction

Why this phase:
- `content-main.js` still directly owned begin/reveal/capture/end/hide inspection
  handler implementations.
- Moving the logic into a dedicated module keeps the runtime and command-router
  entrypoints stable while reducing high-risk duplication surface.

New module:
- `content/render-mode-inspection-handlers.js`

Files to edit:
- `content-main.js`
- `content/render-mode-inspection-handlers.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/render-mode-inspection-order.test.js`
- `tests/property-lock-render-mode.test.js`
- Add `tests/render-mode-inspection-handlers.test.js`

Exact function boundary:
- Keep wrapper functions in `content-main.js`:
  - `handleRenderModeInspectionBeginCommand`
  - `handleRunRenderModeRevealOnceCommand`
  - `handleCaptureRenderModeInspectionHtmlCommand`
  - `handleRenderModeInspectionEndCommand`
  - `handleHideConsentForInspectionCommand`
- Move implementation logic into `content/render-mode-inspection-handlers.js` via
  dependency injection.

Rules:
1. Preserve runtime message type handling and response payloads.
2. Preserve watchdog refresh behavior across reveal/capture phases.
3. Preserve property-lock reconnect banner recovery on inspection end.
4. Do not alter background inspector orchestration flow.

Focused validation:
```bash
npm test -- tests/render-mode-inspection-handlers.test.js tests/render-mode-inspection-order.test.js tests/property-lock-render-mode.test.js tests/render-mode-inspector.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in reveal/capture ordering, inspection end cleanup, or popup
  inspection reconcile behavior should trigger rollback.

Commit message:
```text
refactor(content): extract render mode inspection handlers
```

## Phase F6 - Runtime setEnabled Delegation

Why this phase:
- `content-main.js` still duplicated setEnabled behavior between
  `handleSetEnabledCommand` and the runtime listener branch.
- Delegating runtime `setEnabled` to `handleSetEnabledCommand` removes another
  divergence vector while preserving response contracts.

Files to edit:
- `content-main.js`
- `tests/content-activation-order.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "setEnabled")` in place.
- Replace in-branch implementation with delegation to
  `handleSetEnabledCommand(message)` and preserve async response behavior.
- Keep `handleSetEnabledCommand` as the single implementation authority.

Rules:
1. Preserve `setEnabled` response payloads (including lock failure).
2. Preserve async `return true` runtime listener behavior.
3. Preserve activation and mode lifecycle event emission order.

Focused validation:
```bash
npm test -- tests/content-activation-order.test.js tests/lifecycle-broker.test.js tests/popup-mode-sync.test.js tests/render-mode-inspection-order.test.js tests/content-decomposition-boundary.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in activation restore, mode reconciliation, or lifecycle event
  sequencing should trigger rollback.

Commit message:
```text
refactor(content): dedupe runtime setEnabled handling
```

## Phase F7 - AI Preview Runtime Response Builder Extraction

Why this phase:
- `content-main.js` runtime branches for `getAiPreviewState` and
  `setAiPreviewExpandedMode` contained duplicated response-shaping logic.
- Extracting response shaping lowers drift risk while preserving runtime message
  contracts and feature-flag behavior.

New module:
- `content/ai-preview-state-response.js`

Files to edit:
- `content-main.js`
- `content/ai-preview-state-response.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/preview-tooltip.test.js`
- `tests/feature-flags.test.js`
- Add `tests/ai-preview-state-response.test.js`

Exact function boundary:
- Keep runtime message branches in `content-main.js`.
- Delegate response shaping to module builder methods:
  - `buildGetStateResponse`
  - `buildExpandedModeDisabledResponse`
  - `buildExpandedModeResponse`
- Keep `setAiPreviewExpandedMode` state mutation logic in `content-main.js`.

Rules:
1. Preserve response payload fields and item mapping shape.
2. Preserve `previewExpandedStates` feature-disabled behavior and reason fields.
3. Do not alter preview state mutation flow.

Focused validation:
```bash
npm test -- tests/ai-preview-state-response.test.js tests/preview-tooltip.test.js tests/feature-flags.test.js tests/content-decomposition-boundary.test.js tests/popup-mode-sync.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup preview controls, preview state sync, or disabled
  feature response semantics should trigger rollback.

Commit message:
```text
refactor(content): extract ai preview response builder
```

## Phase F8 - AI Preview Compute-Lock Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `setAiComputeLock` runtime branch
  control flow with AI preview mode transitions and timer cleanup.
- Extracting this handler reduces main-listener complexity while preserving the
  runtime message contract used by AI run heartbeat/orchestration paths.

New module:
- `content/ai-preview-compute-lock-handler.js`

Files to edit:
- `content-main.js`
- `content/ai-preview-compute-lock-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/ai-run.test.js`
- Add `tests/ai-preview-compute-lock-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "setAiComputeLock")` in
  `content-main.js`.
- Delegate in-branch behavior to module method `handleMessage(message)`.
- Keep `beginAiPreviewMode`, `scheduleAiComputeLockRelease`, and
  `exitAiPreviewMode` implementations in `content-main.js`.

Rules:
1. Preserve success/error response payloads (`{ ok, active }` on success).
2. Preserve async runtime listener behavior (`return true`).
3. Preserve compute-lock start side effects (`beginAiPreviewMode`, clear items,
   release scheduling, silent highlighting refresh trigger).
4. Preserve inactive cleanup semantics (exit compute-lock mode when active,
   otherwise clear orphaned release timer).

Focused validation:
```bash
npm test -- tests/ai-preview-compute-lock-handler.test.js tests/ai-run.test.js tests/content-decomposition-boundary.test.js tests/preview-tooltip.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in AI run recovery heartbeat/compute-lock coordination,
  preview-mode restoration, or runtime contract behavior should trigger rollback.

Commit message:
```text
refactor(content): extract ai preview compute-lock handler
```

## Phase F9 - AI Preview Close Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `closeAiPreview` runtime branch
  control flow with active checks, popover-close path, and preview exit path.
- Extracting this branch trims listener complexity while preserving popup close
  contracts and preview-exit behavior.

New module:
- `content/ai-preview-close-handler.js`

Files to edit:
- `content-main.js`
- `content/ai-preview-close-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/ai-preview-close-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "closeAiPreview")` in
  `content-main.js`.
- Delegate close flow to module method `handleMessage()`.
- Keep `exitAiPreviewMode` implementation in `content-main.js`.

Rules:
1. Preserve success response payload (`{ ok: true, active: false }`) for inactive
   preview, popover-close path, and successful preview exit.
2. Preserve error response fallback (`{ ok: false }`) when close flow fails.
3. Preserve async runtime listener behavior (`return true`).
4. Do not alter compute-lock restore semantics in `exitAiPreviewMode`.

Focused validation:
```bash
npm test -- tests/ai-preview-close-handler.test.js tests/preview-tooltip.test.js tests/content-decomposition-boundary.test.js tests/popup-mode-sync.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup close behavior, preview teardown/restore sequencing,
  or runtime close response contracts should trigger rollback.

Commit message:
```text
refactor(content): extract ai preview close handler
```

## Phase F10 - AI Preview Expanded-Mode Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `setAiPreviewExpandedMode` runtime
  branch response/control flow.
- Extracting this branch keeps message contracts intact while reducing main
  listener complexity around feature-gated preview mode toggling.

New module:
- `content/ai-preview-expanded-mode-handler.js`

Files to edit:
- `content-main.js`
- `content/ai-preview-expanded-mode-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- `tests/preview-tooltip.test.js`
- `tests/feature-flags.test.js`
- Add `tests/ai-preview-expanded-mode-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "setAiPreviewExpandedMode")` in
  `content-main.js`.
- Delegate branch response/control flow to module method
  `handleMessage(message)`.
- Keep `setAiPreviewExpandedMode` state mutation function in `content-main.js`.

Rules:
1. Preserve feature-disabled behavior (force false mode and return disabled
   response shape).
2. Preserve enabled behavior (normalize `message.active`, return expanded-mode
   response with current state).
3. Preserve runtime branch fallback response (`{ ok: false }`) on unexpected
   handler failure.
4. Do not alter `setAiPreviewExpandedMode` mutation semantics.

Focused validation:
```bash
npm test -- tests/ai-preview-expanded-mode-handler.test.js tests/preview-tooltip.test.js tests/feature-flags.test.js tests/content-decomposition-boundary.test.js tests/popup-mode-sync.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in preview expanded-state toggling, popup preview list sync,
  or feature-disabled response semantics should trigger rollback.

Commit message:
```text
refactor(content): extract ai preview expanded-mode handler
```

## Phase F11 - Remote Support State Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned runtime handling for
  `remoteSupportState` and `remoteSupportModeChanged` payload normalization and
  response composition.
- Extracting this branch keeps runtime contracts stable while reducing listener
  complexity and centralizing state-message normalization.

New module:
- `content/remote-support-state-handler.js`

Files to edit:
- `content-main.js`
- `content/remote-support-state-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/remote-support-state-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "remoteSupportState" ||
  message.type === "remoteSupportModeChanged")` in `content-main.js`.
- Delegate payload normalization and response building to
  `handleMessage(message)`.
- Keep remote support client session/mode/role state authority in existing
  `content-main.js` client wrappers.

Rules:
1. Preserve `remoteSupportState` payload precedence for object-valued
   `message.state`.
2. Preserve `remoteSupportModeChanged` fallback behavior using the full message
   payload.
3. Preserve response shape (`{ ok, mode, role }`) and runtime branch return
   flow.
4. Do not alter support-page transport message handling in adjacent branches.

Focused validation:
```bash
npm test -- tests/remote-support-state-handler.test.js tests/remote-support-support-page.test.js tests/orchestration-remote-support-scenario.test.js tests/popup-remote-support-ui.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in remote-support state reconciliation, popup remote-support
  mode UI updates, or runtime response contract behavior should trigger rollback.

Commit message:
```text
refactor(content): extract remote support state handler
```

## Phase F12 - AI Preview Get-State Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `getAiPreviewState` runtime branch
  response flow.
- Extracting this branch keeps runtime contracts stable while reducing listener
  complexity and centralizing preview-state response delegation.

New module:
- `content/ai-preview-get-state-handler.js`

Files to edit:
- `content-main.js`
- `content/ai-preview-get-state-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/ai-preview-get-state-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "getAiPreviewState")` in
  `content-main.js`.
- Delegate response retrieval to `handleMessage()`.
- Keep response-shape authority in `content/ai-preview-state-response.js`.

Rules:
1. Preserve runtime response shape from `buildGetStateResponse`.
2. Preserve fallback runtime response (`{ ok: false }`) for unexpected
   non-object returns.
3. Keep branch synchronous (`return;`), without async listener behavior changes.
4. Do not alter AI preview state mutation or item mapping behavior.

Focused validation:
```bash
npm test -- tests/ai-preview-get-state-handler.test.js tests/ai-preview-state-response.test.js tests/content-decomposition-boundary.test.js tests/preview-tooltip.test.js tests/popup-mode-sync.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup preview state hydration, preview sidebar render-state
  sync, or runtime response contracts should trigger rollback.

Commit message:
```text
refactor(content): extract ai preview get-state handler
```

## Phase F13 - Default Exclusions Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `getDefaultExclusions` runtime response
  composition.
- Extracting this tiny branch provides a low-risk reduction in listener surface
  while preserving selector payload contracts.

New module:
- `content/default-exclusions-handler.js`

Files to edit:
- `content-main.js`
- `content/default-exclusions-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/default-exclusions-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "getDefaultExclusions")` in
  `content-main.js`.
- Delegate immutable selector response composition to `handleMessage()`.
- Keep selector constants as the source of truth in `common/constants.js`.

Rules:
1. Preserve response field name (`immutableSelectors`).
2. Preserve array-copy behavior to avoid leaking mutable constant references.
3. Keep branch synchronous and return flow unchanged.
4. Do not alter default selector contents.

Focused validation:
```bash
npm test -- tests/default-exclusions-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in selector payload shape or default exclusion behavior should
  trigger rollback.

Commit message:
```text
refactor(content): extract default exclusions handler
```

## Phase F14 - Visible XPath Filter Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `filterXPathsOnPage` runtime filtering
  logic.
- Extracting this branch keeps runtime behavior stable while reducing listener
  complexity and isolating visibility filtering logic.

New module:
- `content/visible-xpaths-handler.js`

Files to edit:
- `content-main.js`
- `content/visible-xpaths-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/visible-xpaths-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "filterXPathsOnPage")` in
  `content-main.js`.
- Delegate xpath visibility filtering to `handleMessage(message)`.
- Keep element/xpath and visibility authority in existing `core` APIs.

Rules:
1. Preserve request normalization for non-array `message.xpaths` (empty array).
2. Preserve visibility predicate (`getElementFromXPath` + `isVisible`).
3. Preserve response shape (`{ xpaths: [...] }`).
4. Keep branch synchronous and return flow unchanged.

Focused validation:
```bash
npm test -- tests/visible-xpaths-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup xpath filtering behavior or runtime response shape
  should trigger rollback.

Commit message:
```text
refactor(content): extract visible xpaths handler
```

## Phase F15 - Invisible XPath Filter Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `filterInvisibleXpathsOnPage` runtime
  filtering logic.
- Extracting this branch preserves behavior while reducing listener complexity
  and isolating inverse-visibility filtering logic.

New module:
- `content/invisible-xpaths-handler.js`

Files to edit:
- `content-main.js`
- `content/invisible-xpaths-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/invisible-xpaths-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "filterInvisibleXpathsOnPage")` in
  `content-main.js`.
- Delegate xpath inverse-visibility filtering to `handleMessage(message)`.
- Keep element/xpath and visibility authority in existing `core` APIs.

Rules:
1. Preserve request normalization for non-array `message.xpaths` (empty array).
2. Preserve inverse visibility predicate (`getElementFromXPath` + `!isVisible`).
3. Preserve response shape (`{ xpaths: [...] }`).
4. Keep branch synchronous and return flow unchanged.

Focused validation:
```bash
npm test -- tests/invisible-xpaths-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup inverse-xpath filtering behavior or runtime response
  shape should trigger rollback.

Commit message:
```text
refactor(content): extract invisible xpaths handler
```

## Phase F16 - XPath Description Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `describeXPathsOnPage` runtime
  filtering and label composition logic.
- Extracting this branch preserves behavior while reducing listener complexity
  and isolating xpath description assembly.

New module:
- `content/describe-xpaths-handler.js`

Files to edit:
- `content-main.js`
- `content/describe-xpaths-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/describe-xpaths-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "describeXPathsOnPage")` in
  `content-main.js`.
- Delegate visible-element description assembly to `handleMessage(message)`.
- Keep DOM/xpath/label authority in existing `core` APIs.

Rules:
1. Preserve request normalization for non-array `message.xpaths` (empty array).
2. Preserve filtering on visible elements only.
3. Preserve response shape (`{ items: [{ xpath, text }] }`).
4. Keep branch synchronous and return flow unchanged.

Focused validation:
```bash
npm test -- tests/describe-xpaths-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in popup xpath-description behavior or runtime response shape
  should trigger rollback.

Commit message:
```text
refactor(content): extract describe xpaths handler
```

## Phase F17 - Focus Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `focusElement` and `clearFocus` runtime
  control flow.
- Extracting these tightly-coupled branches preserves behavior while reducing
  listener complexity and centralizing preview-focus synchronization.

New module:
- `content/focus-handler.js`

Files to edit:
- `content-main.js`
- `content/focus-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/focus-handler.test.js`

Exact function boundary:
- Keep runtime branches `if (message.type === "focusElement")` and
  `if (message.type === "clearFocus")` in `content-main.js`.
- Delegate focus/clear-focus behavior to handler methods.
- Keep preview focus state authority in existing `setAiPreviewFocusedXpath`
  logic.

Rules:
1. Preserve failure response when xpath target cannot be resolved.
2. Preserve success response shape (`{ ok: true }`) for focus/clear success.
3. Preserve preview-focused-xpath synchronization only while preview is active.
4. Keep branches synchronous and return flow unchanged.

Focused validation:
```bash
npm test -- tests/focus-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/preview-tooltip.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in preview focus behavior, copy-on-focus UX, or runtime focus
  response contracts should trigger rollback.

Commit message:
```text
refactor(content): extract focus handler
```

## Phase F18 - AI Submission XPath Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `collectAiSubmissionXpaths` runtime
  response wiring.
- Extracting this tiny branch reduces listener surface while preserving
  submission-xpath collection contracts.

New module:
- `content/ai-submission-xpaths-handler.js`

Files to edit:
- `content-main.js`
- `content/ai-submission-xpaths-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/ai-submission-xpaths-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "collectAiSubmissionXpaths")` in
  `content-main.js`.
- Delegate response composition to `handleMessage()`.
- Keep submission xpath collection authority in
  `collectAiSubmissionXpathsForCurrentPage`.

Rules:
1. Preserve response field name (`xpaths`).
2. Preserve current collection source and ordering.
3. Keep branch synchronous and return flow unchanged.
4. Do not alter submission-xpath detection logic.

Focused validation:
```bash
npm test -- tests/ai-submission-xpaths-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js tests/content-activation-order.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in submission-xpath collection contracts should trigger
  rollback.

Commit message:
```text
refactor(content): extract ai submission xpaths handler
```

## Phase F19 - Collect Page Data Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owned `collectPageData` runtime payload
  assembly.
- Extracting this branch preserves behavior while reducing listener complexity
  and isolating page-data response composition.

New module:
- `content/collect-page-data-handler.js`

Files to edit:
- `content-main.js`
- `content/collect-page-data-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/collect-page-data-handler.test.js`

Exact function boundary:
- Keep runtime branch `if (message.type === "collectPageData")` in
  `content-main.js`.
- Delegate page-data payload assembly to `handleMessage(message)`.
- Keep config/page-entry/snapshot authority in existing `core` and
  `createCurrentPageSnapshot` APIs.

Rules:
1. Preserve target base URL resolution (`message.baseUrl || state.baseUrl`).
2. Preserve response fields (`baseUrl`, `pageUrl`, `renderedHtml`, `rawHtml`,
   `renderMode`, `immutableSelectors`, `xpaths`).
3. Preserve runtime async flow (`return true` branch behavior).
4. Preserve fallback normalization of `rawHtml`/`xpaths` fields.

Focused validation:
```bash
npm test -- tests/collect-page-data-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Rollback criteria:
- Any regression in collect-page-data response shape/content should trigger
  rollback.

Commit message:
```text
refactor(content): extract collect page data handler
```

## Pre-Phase R0 - Review Cleanup Before F20

Status: completed by the 2026-06-11 documentation cleanup.

Review findings:
1. No behavioral code regression was found in F1-F19.
2. `.copilot` documents were stale and described Track F as complete only
   through F1.
3. `manifest.json` had a cosmetic indentation issue for
   `content/render-mode-inspection-handlers.js`.

Actions completed:
1. Refresh `.copilot/handoff-world-decomposition.md` to F19.
2. Replace stale `.copilot/content-main-followup-refactor-plan.md` content with
   a current index.
3. Refresh `.copilot/plan.md` and `.copilot/knowledge.md` status language.
4. Fix cosmetic manifest indentation.

Validation for the next code phase must still start with:
```bash
git status --short --branch
git pull --ff-only
npm test
```

## Phase F20 - Force Refresh Runtime Handler Extraction

Why this phase:
- `content-main.js` still directly owns the `forceRefresh` runtime branch.
- This is the smallest remaining async runtime branch after F19.
- Extraction reduces listener complexity without touching marking decisions.

New module:
- `content/force-refresh-handler.js`

Files to edit:
- `content-main.js`
- `content/force-refresh-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/force-refresh-handler.test.js`
- Update `.copilot/handoff-world-decomposition.md` after validation.

Exact function boundary:
- Keep runtime branch `if (message.type === "forceRefresh")` in
  `content-main.js`.
- Move only the branch body into `content/force-refresh-handler.js`.
- Keep all dependencies injected from `content-main.js`.

Mechanical implementation steps:
1. Create `content/force-refresh-handler.js` with:
   ```js
   export function createForceRefreshHandler(deps) {
     async function handleMessage() {
       await deps.refreshFromTabState();
       deps.refreshEnabledAiHighlights();
       deps.runPropertyLockSync({ forceSiteIdRefresh: true });
       await deps.refreshSilentHighlightings();
       return { ok: true };
     }

     return { handleMessage };
   }
   ```
2. In `content-main.js`, add an import next to the other `content/*handler.js`
   imports:
   ```js
   import { createForceRefreshHandler } from "./content/force-refresh-handler.js";
   ```
3. Add a cached variable near the other handler caches:
   ```js
   let forceRefreshHandler = null;
   ```
4. Add a getter near the other handler getters:
   ```js
   function getForceRefreshHandler() {
     if (!forceRefreshHandler) {
       forceRefreshHandler = createForceRefreshHandler(createForceRefreshHandlerDeps());
     }
     return forceRefreshHandler;
   }
   ```
5. Add dependency factory near the other `create*Deps` functions:
   ```js
   function createForceRefreshHandlerDeps() {
     return {
       refreshFromTabState: () => core.refreshFromTabState(),
       refreshEnabledAiHighlights,
       refreshSilentHighlightings,
       runPropertyLockSync
     };
   }
   ```
6. Replace the branch body with this exact pattern. Do not add a `.catch()`;
   the existing branch had no rejection fallback.
   ```js
   if (message.type === "forceRefresh") {
     getForceRefreshHandler().handleMessage().then((response) => {
       sendResponse(response && typeof response === "object" ? response : { ok: false });
     });
     return true;
   }
   ```
7. Add `content/force-refresh-handler.js` to `manifest.json` resources.
8. Add `assertImportsContentModule("force-refresh-handler")` to
   `tests/content-decomposition-boundary.test.js`.
9. Add `tests/force-refresh-handler.test.js` covering:
   - calls `refreshFromTabState` first
   - calls `refreshEnabledAiHighlights` after refresh
   - calls `runPropertyLockSync({ forceSiteIdRefresh: true })`
   - awaits `refreshSilentHighlightings`
   - returns `{ ok: true }`

Rules:
1. Do not alter force-refresh response shape.
2. Do not add or remove property-lock sync calls.
3. Do not add error handling that changes the old rejected-promise behavior.
4. Keep runtime branch async behavior (`return true`).

Focused validation:
```bash
npm test -- tests/force-refresh-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js tests/popup-marking-refresh.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
refactor(content): extract force refresh handler
```

## Phase F21 - Page Save Reconciliation Pending Handler Extraction

Why this phase:
- `content-main.js` still directly owns the valid async operation for
  `setPageSaveReconciliationPending`.
- Validation and early synchronous failure responses should remain in
  `content-main.js` to avoid changing runtime timing.

New module:
- `content/page-save-reconciliation-pending-handler.js`

Files to edit:
- `content-main.js`
- `content/page-save-reconciliation-pending-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/page-save-reconciliation-pending-handler.test.js`
- Update `.copilot/handoff-world-decomposition.md` after validation.

Exact function boundary:
- Keep this code in `content-main.js`:
  - `targetBaseUrl` resolution
  - `pageUrl` resolution
  - invalid-target early `{ ok: false }` response
- Move only the successful async pending operation and response composition.

Mechanical implementation steps:
1. Create `content/page-save-reconciliation-pending-handler.js`:
   ```js
   export function createPageSaveReconciliationPendingHandler(deps) {
     async function setPending({ targetBaseUrl, pageUrl, reason }) {
       const reconciliation = await deps.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, {
         reason: typeof reason === "string" ? reason : "pending"
       });
       return { ok: true, reconciliation };
     }

     return { setPending };
   }
   ```
2. Import it in `content-main.js`.
3. Add cached variable:
   ```js
   let pageSaveReconciliationPendingHandler = null;
   ```
4. Add getter:
   ```js
   function getPageSaveReconciliationPendingHandler() {
     if (!pageSaveReconciliationPendingHandler) {
       pageSaveReconciliationPendingHandler = createPageSaveReconciliationPendingHandler(
         createPageSaveReconciliationPendingHandlerDeps()
       );
     }
     return pageSaveReconciliationPendingHandler;
   }
   ```
5. Add dependency factory:
   ```js
   function createPageSaveReconciliationPendingHandlerDeps() {
     return {
       setPageSaveReconciliationPending: (baseUrl, pageUrl, options) =>
         core.setPageSaveReconciliationPending(baseUrl, pageUrl, options)
     };
   }
   ```
6. In the runtime branch, preserve the first 7 lines exactly through the invalid
   target guard. Replace only the `.then` call with:
   ```js
   getPageSaveReconciliationPendingHandler().setPending({
     targetBaseUrl,
     pageUrl,
     reason: message.reason
   }).then((response) => {
     sendResponse(response && typeof response === "object" ? response : { ok: false });
   }).catch(() => {
     sendResponse({ ok: false });
   });
   return true;
   ```
7. Add manifest and boundary-test entries.
8. Add unit tests for:
   - string reason is passed through
   - missing/non-string reason becomes `"pending"`
   - returned reconciliation is wrapped as `{ ok: true, reconciliation }`

Rules:
1. Do not move validation out of `content-main.js` in this phase.
2. Preserve invalid target synchronous response behavior.
3. Preserve `.catch(() => sendResponse({ ok: false }))`.

Focused validation:
```bash
npm test -- tests/page-save-reconciliation-pending-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js tests/inspection-status.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
refactor(content): extract reconciliation pending handler
```

## Phase F22 - Page Save Reconciliation Clear Handler Extraction

Why this phase:
- `clearPageSaveReconciliation` has a self-contained async success path, but it
  updates in-memory config, backend-saved baseline, render scheduling, and draft
  notification.
- Keep input validation in `content-main.js` to preserve early response timing.

New module:
- `content/page-save-reconciliation-clear-handler.js`

Files to edit:
- `content-main.js`
- `content/page-save-reconciliation-clear-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/page-save-reconciliation-clear-handler.test.js`
- Update `.copilot/handoff-world-decomposition.md` after validation.

Exact function boundary:
- Keep `targetBaseUrl`, `pageUrl`, and invalid-target guard in `content-main.js`.
- Move only the async IIFE body into module method `clear({ targetBaseUrl, pageUrl })`.

Mechanical module body:
```js
export function createPageSaveReconciliationClearHandler(deps) {
  async function clear({ targetBaseUrl, pageUrl }) {
    const currentPageUrl = deps.getPageUrl();
    await deps.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
    await deps.refreshPageSaveReconciliation(targetBaseUrl, currentPageUrl);
    const refreshedConfig = await deps.loadConfig(targetBaseUrl);
    const backendSavedPageMarkings = await deps.getBackendSavedPageMarkings(targetBaseUrl);
    const storedEntry = deps.findPageMarkingEntry(
      { pageMarkings: backendSavedPageMarkings },
      currentPageUrl,
      targetBaseUrl
    );
    deps.setConfig(refreshedConfig);
    deps.setSavedPageEntry(currentPageUrl, storedEntry || null);
    deps.scheduleRender();
    deps.notifyDraftStatus(currentPageUrl);
    return { ok: true, entry: storedEntry ? deps.clonePageEntry(storedEntry) : null };
  }

  return { clear };
}
```

Dependency factory in `content-main.js` must supply exactly:
```js
function createPageSaveReconciliationClearHandlerDeps() {
  return {
    clearPageSaveReconciliation: (baseUrl, pageUrl) =>
      core.clearPageSaveReconciliation(baseUrl, pageUrl),
    clonePageEntry: (entry) => core.clonePageEntry(entry),
    findPageMarkingEntry: (configValue, pageUrl, baseUrl) =>
      core.findPageMarkingEntry(configValue, pageUrl, baseUrl),
    getBackendSavedPageMarkings: (baseUrl) => config.getBackendSavedPageMarkings(baseUrl),
    getPageUrl: () => location.href,
    loadConfig: (baseUrl) => core.loadConfig(baseUrl),
    notifyDraftStatus: (pageUrl) => core.notifyDraftStatus(pageUrl),
    refreshPageSaveReconciliation: (baseUrl, pageUrl) =>
      core.refreshPageSaveReconciliation(baseUrl, pageUrl),
    scheduleRender: () => core.scheduleRender(),
    setConfig: (nextConfig) => {
      state.config = nextConfig;
    },
    setSavedPageEntry: (pageUrl, entry) => core.setSavedPageEntry(pageUrl, entry)
  };
}
```

Runtime branch replacement after validation guard:
```js
getPageSaveReconciliationClearHandler().clear({ targetBaseUrl, pageUrl })
  .then((response) => {
    sendResponse(response && typeof response === "object" ? response : { ok: false });
  })
  .catch(() => {
    sendResponse({ ok: false });
  });
return true;
```

Unit tests must verify call order using an array log:
1. `clearPageSaveReconciliation`
2. `refreshPageSaveReconciliation`
3. `loadConfig`
4. `getBackendSavedPageMarkings`
5. `setConfig`
6. `setSavedPageEntry`
7. `scheduleRender`
8. `notifyDraftStatus`

Rules:
1. Do not move validation out of `content-main.js`.
2. Do not change current-page URL behavior; the module must call `getPageUrl()`
   after clearing, as the old branch used `location.href` inside the async body.
3. Preserve `{ ok: true, entry }` response shape and catch fallback.

Focused validation:
```bash
npm test -- tests/page-save-reconciliation-clear-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/popup-marking-refresh.test.js tests/popup-mode-sync.test.js tests/inspection-status.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
refactor(content): extract reconciliation clear handler
```

## Phase F23 - Page Draft Status Runtime Handler Extraction

Why this phase:
- `getPageDraftStatus` still owns a large but cohesive status/sync block.
- It reads backend-saved baseline state, syncs current page markings, computes
  dirty/reconciliation status, and returns a popup-facing payload.

Risk level: high. Use a stronger model at high effort.

New module:
- `content/page-draft-status-handler.js`

Files to edit:
- `content-main.js`
- `content/page-draft-status-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/page-draft-status-handler.test.js`
- Update existing source-contract tests if they assert the old inline block.
- Update `.copilot/handoff-world-decomposition.md` after validation.

Exact function boundary:
- Keep validation in `content-main.js`:
  - `const targetBaseUrl = message.baseUrl || state.baseUrl;`
  - `if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config)`
    early response.
- Move the async IIFE body only.

Dependency checklist:
- `areEntriesEquivalent`
- `clonePageEntry`
- `collectAiSubmissionXpathsForCurrentPage`
- `collectImmutableElements`
- `getConfig`
- `getDraftPageEntry`
- `getPageDraftDirty`
- `getPageSaveReconciliationPending`
- `getPageSaveReconciliationState`
- `getPageUrl`
- `getSavedPageEntry`
- `hasPageMarkingEntry`
- `refreshSavedPageEntryFromBackendCache`
- `setSavedPageEntry`
- `submissionXpathsEqual`
- `syncPageMarkings`

Mechanical move steps:
1. Copy the current async body exactly from the branch into module method:
   `async function getStatus({ targetBaseUrl })`.
2. Replace direct `state.config` reads with `deps.getConfig()`.
3. Replace `location.href` with `deps.getPageUrl()`.
4. Replace each `core.*` call with its dependency equivalent.
5. Return the old `sendResponse({ ... })` payload instead of calling
   `sendResponse` inside the module.
6. Keep the old `.catch(() => sendResponse({ ok: false }))` in `content-main.js`.
7. Do not change the submission-xpath staleness rule. Copy the explanatory
   comment into the module above the same block.

Unit tests must cover:
1. no existing page entry returns a payload with `ok: true`, `entry: null`, the
  current `savedEntry`, `dirty` equal to `deps.isPageDraftDirty(pageUrl)`, and
  the reconciliation fields from deps.
2. clean entry with sync changes updates saved entry when `wasClean` and
   `syncResult.changed` are both true.
3. stale submission xpaths mark dirty only when existing entry already has prior
   `submissionXpaths`.
4. response includes `reconciliation` and `reconciliationPending` from deps.

Focused validation:
```bash
npm test -- tests/page-draft-status-handler.test.js tests/popup-marking-refresh.test.js tests/content-activation-order.test.js tests/popup-mode-sync.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
refactor(content): extract page draft status handler
```

## Phase F24 - Capture Page Snapshot Runtime Handler Extraction

Why this phase:
- `capturePageSnapshot` owns a larger transactional save/snapshot path.
- It should be extracted only after F20-F23 are green because it touches config,
  page entries, raw HTML capture, submission xpaths, backend cache refresh, and
  property-lock activity.

Risk level: high. Use a stronger model at high effort.

New module:
- `content/capture-page-snapshot-handler.js`

Files to edit:
- `content-main.js`
- `content/capture-page-snapshot-handler.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/capture-page-snapshot-handler.test.js`
- Update existing source-contract tests if they assert the old inline block.
- Update `.copilot/handoff-world-decomposition.md` after validation.

Exact function boundary:
- Keep early validation in `content-main.js`:
  - `targetBaseUrl` resolution
  - missing base URL response
  - `shouldPersist` calculation
  - property-lock blocking response
  - reconciliation-pending response
- Move only the async IIFE body into module method:
  `capture({ targetBaseUrl, shouldPersist, pageType })`.

Dependency checklist:
- `collectAiSubmissionXpathsForCurrentPage`
- `collectImmutableElements`
- `createCurrentPageSnapshot`
- `fetchCurrentPageRawHtml`
- `getActiveConfig`
- `getCurrentPageType`
- `getDocumentTitle`
- `getPageMarkingEntry`
- `getPageUrl`
- `hasPageMarkingEntry`
- `loadConfig`
- `matchesActiveBaseUrl`
- `refreshSavedPageEntryFromBackendCache`
- `saveConfig`
- `sendPropertyLockActivity`
- `setConfig`
- `syncPageMarkings`
- `touchPageEntryTimestamp`

Mechanical move steps:
1. Copy the current async IIFE body exactly into the module.
2. Replace `sendResponse({ ok: false }); return;` inside the moved body with
   `return { ok: false };`.
3. Replace final `sendResponse({ ok: true });` with `return { ok: true };`.
4. Replace `state.config` reads with `deps.getActiveConfig()`.
5. Replace `state.config = config` with `deps.setConfig(config)`.
6. Replace `state.currentPageType` with `deps.getCurrentPageType()`.
7. Replace `document.title || location.href` with
   `deps.getDocumentTitle() || deps.getPageUrl()`.
8. Replace `location.href` with `deps.getPageUrl()`. Use a local `pageUrl` once
   at the top of the method if that makes the copy safer.
9. Keep the old branch catch behavior. The current branch does not catch the
   async IIFE. If adding a catch is desired, stop and ask; do not change it
   during this mechanical extraction.

Runtime branch replacement after validation guard:
```js
getCapturePageSnapshotHandler().capture({
  targetBaseUrl,
  shouldPersist,
  pageType: typeof message.pageType === "string" ? message.pageType : ""
}).then((response) => {
  sendResponse(response && typeof response === "object" ? response : { ok: false });
});
return true;
```

Unit tests must cover:
1. non-persisting request with no existing entry returns `{ ok: false }`.
2. existing entry path captures rendered/raw HTML and title.
3. persisted request calls `saveConfig`, refreshes saved backend cache when the
   base URL is active, and sends property-lock activity.
4. non-persisted request does not call `saveConfig` or property-lock activity.
5. `pageType` precedence matches old behavior: message page type, then current
   page type, then existing entry page type.

Focused validation:
```bash
npm test -- tests/capture-page-snapshot-handler.test.js tests/content-activation-order.test.js tests/popup-marking-refresh.test.js tests/ai-run.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
refactor(content): extract capture page snapshot handler
```

## Stop After F24

After F24, stop and report status unless the user explicitly approves a new
high-risk marking/draft plan.

Remaining branches after F24 include `configUpdated`, `setExplicitExclude`,
`setExplicitInclude`, `savePageDraft`, `revertPageDraft`, and `showAiPreview`.
Those are more tightly coupled to marking contracts, draft persistence, or AI
preview orchestration. A less capable model should not infer boundaries for
those branches.
