# Track F Dedicated Plan - Protected Content Areas

Last updated: 2026-06-11
Branch: main

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
