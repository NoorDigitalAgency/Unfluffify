# Content Main Runtime Router Plan

Last updated: 2026-06-12
Status: CURRENT EXECUTOR PLAN - Track H is active. Track F and high-risk phases G0-G5 are complete historical work.

## Purpose

This plan is the active, executor-grade follow-up for `content-main.js` after
G5. The goal is structural only: reduce the remaining `content-main.js`
entanglement without changing any locked marking, save, preview, property-lock,
or render-mode behavior.

This track is intentionally written so a less capable model can execute it
mechanically. The design decisions have already been made here. The executor
must follow them literally instead of inventing a new architecture.

## Current Baseline

Known-good baseline at plan start:

```bash
git status --short --branch
# ## main...origin/main

npm test
# 946 pass / 0 fail
```

Already complete before this plan:

1. World decomposition Tracks A and B.
2. Content follow-up Track D through D2.
3. Content follow-up Track E through E2.
4. Track F through F24.
5. High-risk branch plan G0 through G5.
6. Post-review async content-message fallback hardening for rejectable delegated
   branches.

## Exact Outcome Required

At the end of this track:

1. `content-main.js` still owns `main()`, core lifecycle wiring, and the large
   mutable domain state clusters that are intentionally out of scope.
2. The legacy plain-message runtime branch chain is no longer inline inside the
   `chrome.runtime.onMessage.addListener(...)` body.
3. The support-page-specific runtime message subgroup is no longer mixed into
   the general runtime branch chain.
4. The lazy singleton cache/getter block for handler and client instances is no
   longer declared inline in `content-main.js`.
5. Popup and background callers keep using the exact same message names and
   payloads they use today.
6. The existing envelope-based command path in
   `content/content-command-router.js` stays unchanged in this track.

## Fixed Design Decisions

These decisions are already made. Do not redesign them during execution.

1. Keep all existing plain `chrome.runtime.sendMessage(...)` callsites exactly
   as they are in this track.
2. Keep `content/content-command-router.js` and the existing registered content
   commands exactly as they are. Do not migrate additional message types to the
   envelope path in this plan.
3. Keep the `chrome.runtime.onMessage.addListener(...)` registration in
   `content-main.js`. Only the branch logic moves.
4. Do not move property-lock mutable primitives, silent-highlighting mutable
   primitives, AI preview DOM/rendering helpers, or render-mode inspection
   mutable state out of `content-main.js` in this track.
5. Do move the legacy runtime branch chain into a dedicated content module.
6. Do move the support-page runtime-message subgroup into its own dedicated
   content module.
7. Do move the lazy singleton cache/getter state for handler/client instances
   into a dedicated content module.
8. Do not introduce a shared mutable truth store. New modules may cache lazy
   singleton instances only. All existing mutable runtime truth stays where it
   already lives.
9. New modules approved for this plan:
   - `content/runtime-message-handler.js`
   - `content/remote-support-support-page-message-handler.js`
   - `content/content-main-service-registry.js`
10. Every new `content/*` import added to `content-main.js` must be added to
    `manifest.json` and kept green in
    `tests/content-decomposition-boundary.test.js` and
    `tests/manifest-permissions.test.js` in the same commit.

## Source Anchors In The Current File

These anchors are the only ones the executor should rely on for this track.

1. Existing content-command registrations are in `content-main.js` around lines
   6630-6745.
2. The legacy plain-message listener starts in `content-main.js` at line 6873.
3. The large top-level mutable state cluster begins in `content-main.js` around
   line 221.
4. The lazy service cache/getter block begins in `content-main.js` around line
   394 and continues through the getter helpers around line 795.
5. The handler/client dependency-builder block remains in `content-main.js`
   around lines 6125-6516 and stays there during this track.

## Out Of Scope

Do not drift into these areas during this plan.

1. `content/core.js`.
2. Marking contract changes.
3. Silent-highlighting behavior changes.
4. Page-save reconciliation behavior changes.
5. XPath behavior changes.
6. AI submission behavior changes.
7. Popup/background architectural changes.
8. Converting plain runtime messages to the envelope protocol.
9. Moving the large mutable property-lock or silent-highlighting state clusters
   out of `content-main.js`.

## Required Baseline Before Every Phase

Run before each phase:

```bash
git status --short --branch
git pull --ff-only
npm test
```

Expected:

1. Clean `main...origin/main`.
2. Full suite passes.
3. No uncommitted files under `.copilot`, `content-main.js`, `content/`,
   `tests/`, or `manifest.json` before starting the next phase.

## Global Execution Rules

The executor must follow these rules literally.

1. One phase per commit.
2. Add tests before or with the structural move that needs them.
3. Preserve branch order in the legacy runtime router. Do not convert the chain
   into a map, lookup table, mini-framework, or generic dispatcher in H1.
4. Copy the existing branch logic first, then prune dead code only after tests
   are green.
5. Preserve `sendResponse(...)` timing exactly. If a branch is synchronous now,
   keep it synchronous. If it currently returns `true`, keep returning `true`.
6. Preserve the exact `ok`, `locked`, `reconciliationPending`, `count`, and
   other response fields currently returned by each branch.
7. Keep popup/background callsites untouched in this track.
8. After every phase update `.copilot/handoff-world-decomposition.md` with the
   exact validation result and the commit message that was used.
9. After every phase update the status bullets in this file.

## Track H Status Bullets

1. H0 complete (2026-06-12):
   - Added `tests/content-main-runtime-router-contract.test.js`.
   - Focused validation: pass (`npm test -- tests/content-main-runtime-router-contract.test.js tests/content-command-router.test.js tests/content-high-risk-branches.test.js`).
   - Full validation: pass (`npm test` => 949 pass / 0 fail).
   - Commit message: `test(content): lock runtime router contracts`.
2. H1 complete (2026-06-12):
   - Added `content/runtime-message-handler.js` and delegated legacy runtime chain from `content-main.js`.
   - Added `tests/runtime-message-handler.test.js`; updated source-contract tests for router-location compatibility.
   - Focused validation: pass (`npm test -- tests/content-main-runtime-router-contract.test.js tests/runtime-message-handler.test.js tests/content-command-router.test.js tests/content-activation-order.test.js tests/content-high-risk-branches.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`).
   - Full validation: pass (`npm test` => 955 pass / 0 fail).
   - Commit message: `refactor(content): extract runtime message handler`.
3. H2 pending.
4. H3 pending.

## Phase H0 - Lock The Runtime Router Contract

Purpose:
- Freeze the post-G5 router inventory before moving any code.
- Remove guesswork for weaker executors.

Risk level: medium.

Files to edit:
- `tests/content-main-runtime-router-contract.test.js` (new)
- `.copilot/content-main-followup-refactor-plan.md`
- `.copilot/handoff-world-decomposition.md`

Exact router inventory to lock in the test:

1. `remoteSupportViewerTransportStart`
2. `remoteSupportViewerTransportStop`
3. `remoteSupportViewerTransportSendData`
4. `remoteSupportStateChanged`
5. `remoteSupportFrame`
6. `setEnabled`
7. `getInspectionStatus`
8. `renderModeInspectionBegin`
9. `runRenderModeRevealOnce`
10. `captureRenderModeInspectionHtml`
11. `renderModeInspectionEnd`
12. `hideConsentForInspection`
13. `remoteSupportState`
14. `remoteSupportModeChanged`
15. `getAiPreviewState`
16. `setAiPreviewExpandedMode`
17. `setAiComputeLock`
18. `closeAiPreview`
19. `configUpdated`
20. `forceRefresh`
21. `getDefaultExclusions`
22. `collectPageData`
23. `filterXPathsOnPage`
24. `collectAiSubmissionXpaths`
25. `filterInvisibleXpathsOnPage`
26. `describeXPathsOnPage`
27. `focusElement`
28. `clearFocus`
29. `capturePageSnapshot`
30. `getPageDraftStatus`
31. `setPageSaveReconciliationPending`
32. `clearPageSaveReconciliation`
33. `setExplicitExclude`
34. `setExplicitInclude`
35. `savePageDraft`
36. `revertPageDraft`
37. `showAiPreview`

Exact work:

1. Create `tests/content-main-runtime-router-contract.test.js`.
2. Read `content-main.js` as source text.
3. Assert that the eight command-router registrations remain present for the
   already-modern envelope path:
   - `activateContentMain`
   - `setEnabled`
   - `getInspectionStatus`
   - `renderModeInspectionBegin`
   - `runRenderModeRevealOnce`
   - `captureRenderModeInspectionHtml`
   - `renderModeInspectionEnd`
   - `hideConsentForInspection`
4. Assert that every plain runtime message listed above exists in either
   `content-main.js` or, after later phases, in the dedicated router module.
   Write the test forward-compatibly so it stays green after H1 and H2.
5. Assert that `content-main.js` still contains a legacy
   `chrome.runtime.onMessage.addListener(...)` registration after this phase.
6. Do not change production code in H0.

Focused validation:

```bash
npm test -- tests/content-main-runtime-router-contract.test.js tests/content-command-router.test.js tests/content-high-risk-branches.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
test(content): lock runtime router contracts
```

## Phase H1 - Extract The Legacy Runtime Router

Purpose:
- Remove the huge plain-message branch chain from the inline listener.
- Keep all behavior identical.

Risk level: high.

New module:
- `content/runtime-message-handler.js`

Files to edit:
- `content-main.js`
- `content/runtime-message-handler.js` (new)
- `manifest.json`
- `tests/content-main-runtime-router-contract.test.js`
- `tests/runtime-message-handler.test.js` (new)
- `tests/content-decomposition-boundary.test.js`
- `.copilot/content-main-followup-refactor-plan.md`
- `.copilot/handoff-world-decomposition.md`

Exact implementation instructions:

1. Create `content/runtime-message-handler.js`.
2. Export one function from that module:
   - `handleRuntimeMessage(message, sender, sendResponse, deps)`
3. Copy the existing legacy branch chain out of the inline listener and paste it
   into `handleRuntimeMessage(...)`.
4. Preserve the branch order exactly as it is today.
5. Do not rewrite the chain as a data-driven dispatcher in H1.
6. Keep the following behavior exactly unchanged:
   - ignored invalid messages return `undefined`
   - async branches still return `true`
   - synchronous branches still respond synchronously
   - branches that intentionally do not answer in some guard case keep that
     behavior
7. In `content-main.js`, keep the inline listener itself, the invalid-message
   guard, the world-trace logging block, and the envelope-command dispatch
   block.
8. After the envelope block, replace the inline legacy chain with a single call
   to `handleRuntimeMessage(message, _sender, sendResponse, createRuntimeMessageHandlerDeps())`.
9. Define `createRuntimeMessageHandlerDeps()` inside `content-main.js` for H1.
   Do not extract it in this phase. It must pass the exact existing helpers and
   readers needed by the copied branches.
10. Include only the dependencies the router actually needs. Copy the branch
    code first, then prune unused deps after tests pass.
11. Do not change any popup/background code.

Required dependency names to wire through `createRuntimeMessageHandlerDeps()`:

1. `getRemoteSupportSupportPage`
2. `handleSetEnabledCommand`
3. `handleGetInspectionStatusCommand`
4. `handleRenderModeInspectionBeginCommand`
5. `handleRunRenderModeRevealOnceCommand`
6. `handleCaptureRenderModeInspectionHtmlCommand`
7. `handleRenderModeInspectionEndCommand`
8. `handleHideConsentForInspectionCommand`
9. `getRemoteSupportStateHandler`
10. `getAiPreviewGetStateHandler`
11. `getAiPreviewExpandedModeHandler`
12. `getAiPreviewComputeLockHandler`
13. `getAiPreviewCloseHandler`
14. `getConfigUpdatedHandler`
15. `getForceRefreshHandler`
16. `getDefaultExclusionsHandler`
17. `getCollectPageDataHandler`
18. `getVisibleXpathsHandler`
19. `getAiSubmissionXpathsHandler`
20. `getInvisibleXpathsHandler`
21. `getDescribeXpathsHandler`
22. `getFocusHandler`
23. `getCapturePageSnapshotHandler`
24. `getPageDraftStatusHandler`
25. `getPageSaveReconciliationPendingHandler`
26. `getPageSaveReconciliationClearHandler`
27. `getExplicitMarkingHandler`
28. `getPageDraftSaveHandler`
29. `getPageDraftRevertHandler`
30. `getAiPreviewShowHandler`
31. `state`
32. `matchesActiveBaseUrl`
33. `checkPropertyLockBlocksMarking`
34. `sendPropertyLockActivity`
35. `locationHref: () => location.href`
36. `isPageSaveReconciliationPending: (pageUrl) => core.isPageSaveReconciliationPending(pageUrl)`

Required tests in `tests/runtime-message-handler.test.js`:

1. Unknown message returns `undefined` and does not call `sendResponse`.
2. A representative synchronous delegated branch responds synchronously.
   Use `getDefaultExclusions` for this.
3. A representative async delegated branch returns `true` and answers on
   success. Use `setAiComputeLock` for this.
4. The async delegated branch answers `{ ok: false }` when the delegated
   promise rejects.
5. `remoteSupportStateChanged` ignores mismatched support-page tab ids without
   sending a response.
6. `remoteSupportFrame` answers only when the support-page handler says the
   frame was accepted.

Focused validation:

```bash
npm test -- tests/content-main-runtime-router-contract.test.js tests/runtime-message-handler.test.js tests/content-command-router.test.js tests/content-activation-order.test.js tests/content-high-risk-branches.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract runtime message handler
```

## Phase H2 - Extract The Support-Page Runtime Subrouter

Purpose:
- Remove the remote-support support-page transport subgroup from the general
  legacy router.

Risk level: high.

New module:
- `content/remote-support-support-page-message-handler.js`

Files to edit:
- `content/runtime-message-handler.js`
- `content/remote-support-support-page-message-handler.js` (new)
- `content-main.js`
- `manifest.json`
- `tests/content-main-runtime-router-contract.test.js`
- `tests/content-remote-support-support-page-message-handler.test.js` (new)
- `tests/content-remote-support-support-page.test.js`
- `tests/content-decomposition-boundary.test.js`
- `.copilot/content-main-followup-refactor-plan.md`
- `.copilot/handoff-world-decomposition.md`

Exact messages to move in H2:

1. `remoteSupportViewerTransportStart`
2. `remoteSupportViewerTransportStop`
3. `remoteSupportViewerTransportSendData`
4. `remoteSupportStateChanged`
5. `remoteSupportFrame`

Exact implementation instructions:

1. Create `content/remote-support-support-page-message-handler.js`.
2. Export one function:
   - `handleRemoteSupportSupportPageMessage(message, sendResponse, deps)`
3. The function must return:
   - `null` when the message type is not one of the five support-page types
   - `undefined` when the branch intentionally handles the message without a
     listener-level `return true`
   - `true` when the branch starts async work and the listener must stay open
4. In `content/runtime-message-handler.js`, call this helper first, immediately
   after the invalid-message guard. If the return value is not `null`, return it
   directly.
5. Preserve these behaviors exactly:
   - support-page transport start/stop/send-data still respond with `{ ok: false }`
     fallback objects when the viewer request returns a non-object
   - `remoteSupportStateChanged` still ignores tab-id mismatches silently
   - `remoteSupportFrame` still ignores frames that the support page rejects
6. Do not move non-support-page messages in H2.

Required tests in `tests/content-remote-support-support-page-message-handler.test.js`:

1. Non-support-page message returns `null`.
2. Start branch returns `true` and normalizes non-object viewer responses to
   `{ ok: false }`.
3. State-changed branch ignores mismatched tab ids.
4. Frame branch responds only when the support-page handler reports success.

Focused validation:

```bash
npm test -- tests/content-main-runtime-router-contract.test.js tests/content-remote-support-support-page-message-handler.test.js tests/content-remote-support-support-page.test.js tests/runtime-message-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract support page runtime messages
```

## Phase H3 - Extract The Lazy Service Registry

Purpose:
- Remove the large lazy singleton cache/getter block from `content-main.js`
  without touching the mutable runtime truth clusters.

Risk level: medium.

New module:
- `content/content-main-service-registry.js`

Files to edit:
- `content-main.js`
- `content/content-main-service-registry.js` (new)
- `manifest.json`
- `tests/content-main-service-registry.test.js` (new)
- `tests/content-main-runtime-router-contract.test.js`
- `tests/content-decomposition-boundary.test.js`
- `.copilot/content-main-followup-refactor-plan.md`
- `.copilot/handoff-world-decomposition.md`

Exact scope for H3:

Move only the lazy singleton cache/getter state for these helpers:

1. `getRemoteSupportViewerClient`
2. `getRemoteSupportSupportPage`
3. `getPageToastClient`
4. `getPageSaveReconciliationClearHandler`
5. `getPageSaveReconciliationPendingHandler`
6. `getRenderModeInspectionClient`
7. `getRenderModeInspectionHandlers`
8. `getInspectionStatusResolver`
9. `getPageDraftRevertHandler`
10. `getPageDraftSaveHandler`
11. `getExplicitMarkingHandler`
12. `getPageDraftStatusHandler`
13. `getAiPreviewStateResponseBuilder`
14. `getAiPreviewCloseHandler`
15. `getAiPreviewComputeLockHandler`
16. `getAiPreviewExpandedModeHandler`
17. `getAiPreviewGetStateHandler`
18. `getAiPreviewShowHandler`
19. `getAiSubmissionXpathsHandler`
20. `getCapturePageSnapshotHandler`
21. `getConfigUpdatedHandler`
22. `getCollectPageDataHandler`
23. `getDefaultExclusionsHandler`
24. `getDescribeXpathsHandler`
25. `getFocusHandler`
26. `getForceRefreshHandler`
27. `getInvisibleXpathsHandler`
28. `getVisibleXpathsHandler`
29. `getPropertyLockPortClient`
30. `getPropertyLockStateMachine`
31. `getRemoteSupportClient`
32. `getRemoteSupportStateHandler`

Explicit non-goals for H3:

1. Do not move `aiPreviewState`.
2. Do not move `pageTelemetryBridgePort`, `pageTelemetryBridgeNonce`, or
   `pageTelemetryBridgeListenerBound`.
3. Do not move property-lock mutable primitives.
4. Do not move silent-highlighting mutable primitives.
5. Do not move any of the `create*Deps()` builder functions.

Exact implementation instructions:

1. Create `content/content-main-service-registry.js`.
2. Export one factory:
   - `createContentMainServiceRegistry(factories)`
3. Inside that registry module, declare the lazy singleton refs currently held
   inline in `content-main.js` and keep their lazy `null`-then-create behavior.
4. In `content-main.js`, instantiate the registry once.
5. Keep the existing `getX()` function names in `content-main.js` as one-line
   wrappers that call the registry. This is required. Do not bulk-rename every
   downstream callsite in H3.
6. Remove the inline `let foo = null;` declarations for the moved singleton
   refs from `content-main.js`.
7. Do not change any actual handler/client factory bodies in H3.

Required tests in `tests/content-main-service-registry.test.js`:

1. Each registry getter creates its service lazily.
2. Repeated calls return the same cached instance.
3. Different getters do not share instances.

Required source-contract assertions to add or update:

1. `content-main.js` imports `content-main-service-registry.js`.
2. `content-main.js` no longer declares `let remoteSupportClient = null;`.
3. `content-main.js` no longer declares `let pageToastClient = null;`.
4. `content-main.js` no longer declares `let configUpdatedHandler = null;`.
5. `content-main.js` still keeps the large mutable truth clusters listed above.

Focused validation:

```bash
npm test -- tests/content-main-service-registry.test.js tests/content-main-runtime-router-contract.test.js tests/content-activation-order.test.js tests/content-high-risk-branches.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Full validation:

```bash
npm test
```

Commit message:

```text
refactor(content): extract content main service registry
```

## Stop After H3

After H3, stop and review `content-main.js` again before planning any deeper
mutable-state extraction.

Do not guess the next step beyond H3. The remaining complexity after H3 will be
in the large mutable state clusters and deeper lifecycle logic. That requires a
fresh review and a new written plan rather than continuation by inference.

## Stop Conditions

Stop and ask the user before continuing if any of these happen:

1. Any phase appears to require editing `content/core.js`.
2. Any phase appears to change marking, silent-highlighting, property-lock,
   render-mode, page-save reconciliation, XPath, or AI-submission behavior
   instead of only moving code.
3. A new module would need to import `content-main.js`.
4. A module cycle appears.
5. A focused test fails for a reason that is not obviously local to the phase.
6. Full `npm test` fails and the cause is not obviously local to the phase.
7. Any phase seems to require popup/background callsite changes to plain runtime
   messages.
8. Live validation becomes necessary for an unflagged user flow and cannot be
   completed autonomously.

## Historical Documents

Use these only for historical context, not as the active executor plan:

1. `.copilot/high-risk-content-branches-plan.md` - completed G0-G5 record.
2. `.copilot/track-f-protected-content-plan.md` - completed mechanical Track F
   record.