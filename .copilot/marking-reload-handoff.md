# Marking Reload Handoff

This is a planning-only handoff for the local Copilot agent. Do not implement from
this session's changes. Start implementation in a fresh local session after
reading this file, `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`,
and `.copilot/plan.md`.

## User Intent

- Prioritize page/tab reload marking-state correctness over AI lifecycle changes.
- The AI lifecycle is currently stable; avoid broad AI lifecycle rewrites unless a
  reload-state fix directly requires a small adjustment.
- Use several safe commits rather than one large risky change. PR splitting is
  optional, but commit-level isolation is important because these changes can
  race with other work.
- Include the existing MV3 offscreen document in the plan and consider it when it
  is a better lifecycle owner than the popup or service worker.
- Do not route huge HTML, server payloads, AI payloads, or AI responses through
  runtime messaging. Payloads can be heavy enough to hit messaging limits.
- Add a question-and-answer sanity check / quality / correctness / fix-planning
  phase for marking rules, marking rendering rules, XPath calculation, and AI
  payload construction before changing behavior.

## Non-Goals

- Do not change the locked marking-rules contract unless the user explicitly
  approves a contract change.
- Do not redesign the AI run lifecycle.
- Do not move large page snapshots or server responses between extension contexts
  by message just because it is convenient.
- Do not introduce a second marking-state source of truth.

## Current Anchors

- Background reload/restore state lives in `background.js` around tab state,
  restore-scoped state, `webNavigation`, and `tabs.onUpdated` handling.
- Popup reload inspection UX lives in `popup.js` around
  `waitForEnableMarkingInspectionToSettle`, navigation inspection overlay state,
  and `tabs.onUpdated` listeners.
- Content marking, rendering, XPath, snapshot, and submission behavior lives in
  `content/core.js`, `content/marking-rules.js`, `content/submission-rules.js`,
  `content/silent-highlight-rules.js`, and `content-main.js`.
- AI payload assembly/backfill behavior lives primarily in `popup.js` and
  `common/config.js`, with current-page snapshot refresh support in
  `content-main.js`.
- Existing offscreen runtime files are `remote-support-offscreen.html` and
  `remote-support-offscreen.js`; they are currently remote-support WebRTC
  transport infrastructure, not a generic large-payload worker.
- Focused marking regression coverage includes:
  `tests/core-visibility.test.js`, `tests/core-scheduling.test.js`,
  `tests/marking-rules.test.js`, `tests/popup-marking-refresh.test.js`,
  `tests/selector-suppression.test.js`,
  `tests/silent-highlight-annotations.test.js`,
  `tests/silent-highlight-rules.test.js`, and
  `tests/submission-rules.test.js`.
- Full tests run with `npm test`.

## Phase 0: Q&A Sanity Check and Fix Planning

Before implementation, the local agent should run this phase and capture answers
in its working notes before editing code.

1. Restate the locked marking contract from `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Trace the current reload lifecycle:
   - enabling marking,
   - top-level navigation start,
   - reload completion,
   - content-script activation,
   - restore-scoped tab state consumption,
   - inspection spinner start/end,
   - marking render/snapshot readiness.
3. Trace the current rendering rules:
   - ordinary exclude overlay,
   - toggleable default projection,
   - explicit include/exclude precedence,
   - fast explicit refresh versus full invalidating rebuild,
   - silent highlighting layers.
4. Trace XPath calculation:
   - live XPath generation,
   - sanitized snapshot XPath generation,
   - stripped extension/automation roots,
   - saved `submissionXpaths`,
   - hidden textual rows,
   - immutable/default suppression.
5. Trace AI payload construction:
   - stored `renderedHtml`,
   - stored/backfilled `rawHtml`,
   - refined raw XPaths,
   - multi-page snapshot selection,
   - current-page refresh exception,
   - where payloads are passed or persisted.
6. Identify any contract ambiguity before coding. Ask the user if an answer would
   change marking taxonomy, target resolution, overlay projection, XPath
   semantics, or payload ownership.
7. Write a small fix plan that maps each proposed change to:
   - source-of-truth owner,
   - affected files,
   - tests to add/update,
   - payload-size implications,
   - rollback risk.

Suggested sanity-check questions for the user only if uncertainty remains:

- Should reload restoration preserve marking enabled state only for same-base-URL
  navigations, or are there product cases where cross-base restore is expected?
- Should the offscreen document remain remote-support-specific unless heavy
  payload ownership clearly needs a long-lived extension document?
- If an AI payload is too large for messaging, should the preferred handoff be an
  IndexedDB/cache key, a background-owned fetch, or an offscreen-owned fetch?
- Are there any intentional marking-rule contract changes, or should all reload
  work preserve the current locked contract exactly?

## Phase 1: Stabilize Reload/Restore State

Goal: make tab/page reload markings reliably rehydrate without making the popup
the source of truth.

- Treat the background restore-scoped tab state as the coordination point for
  reload/navigation restoration.
- Ensure top-level navigation records restore intent before clearing injected
  content-script state.
- Ensure restore state is cleared only after a same-base restored page has
  acknowledged activation and marking reinspection has settled, or after a
  deliberate out-of-scope navigation disables marking.
- Keep tab removal cleanup complete for normal, restore, initial, script, and
  emulation session keys.
- Add regression coverage for reload, same-base navigation, out-of-base
  navigation, and stale restore-state cleanup.

Commit boundary: background reload/restore source-of-truth changes plus tests.

## Phase 2: Stabilize Popup Inspection UI

Goal: keep page/tab reload markings visibly blocked until reinspection is known
to be finished, without masking stuck states forever.

- Keep the navigation inspection overlay tied to tab identity and restore state.
- Start the overlay on reload/loading when an enabled restore is expected.
- End the overlay only after content inspection or save-preparation
  reconciliation reports settled, or after a bounded timeout with a safe refresh.
- Avoid ending the overlay on tab activation before stale spinner state is
  cleared for the previous tab.
- Ensure refresh paths stay quiet and do not trigger unnecessary property-lock or
  remote config fetches.

Commit boundary: popup inspection overlay lifecycle changes plus focused tests.

## Phase 3: Stabilize Content Rehydration and Rendering Readiness

Goal: ensure restored pages report accurate status while maintaining the locked
marking/rendering contract.

- Ensure content activation after reload follows the single `setEnabled` path.
- Ensure `getInspectionStatus` and `getPageDraftStatus` are accurate during
  reveal, motion freeze, marking sync, snapshot refresh, and temporary disabled
  states.
- Preserve fast explicit-refresh semantics and full invalidating rebuild
  ownership; do not use reload fixes to alter overlay precedence.
- Confirm saved snapshots continue stripping extension-owned UI and pause
  mechanics.

Commit boundary: content rehydration/status changes plus marking/rendering tests.

## Phase 4: Payload Ownership and Heavy Data Safety

Goal: prevent future messaging-limit failures while preserving AI payload
correctness.

- Inventory all heavy values currently moved by message:
  `renderedHtml`, `rawHtml`, `submissionXpaths`, config sync payloads, AI request
  payloads, and server responses.
- Prefer storing heavy values in IndexedDB/config storage and passing lightweight
  keys or metadata between contexts.
- Prefer a background-owned or offscreen-owned fetch only when it avoids moving a
  large payload through runtime messaging and has a clear lifecycle advantage.
- If the existing offscreen document is considered, first decide whether to keep
  remote support transport isolated or introduce a separate offscreen role/API.
- Do not pipe full AI request/response bodies popup -> background -> offscreen ->
  server unless the design proves each hop stays under safe message sizes.
- Add tests or source guards that make accidental large-message paths visible.

Commit boundary: payload ownership safety changes plus tests. Keep separate from
reload UI changes unless the same bug requires both.

## Phase 5: AI Lifecycle Touches Only If Needed

Goal: preserve current stable AI lifecycle.

- Only adjust AI code if reload fixes expose stale stored snapshots,
  `submissionXpaths`, raw backfills, or compute-lock state.
- Keep compute-busy feedback before raw HTML backfills, XPath refinement, and
  payload construction.
- Keep five-second async AI run polling.
- Preserve the rule that AI runs use stored multi-page snapshots, with only the
  active current page eligible for a pre-run refresh when it has unsaved changes.

Commit boundary: only small AI-adjacent fixes that directly support reload or
payload safety.

## Validation Plan

Run focused tests after each relevant commit:

```sh
node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
```

Run broader tests before handoff or PR:

```sh
npm test
```

If remote/offscreen code is touched, also run:

```sh
npm test -- tests/remote-support-offscreen.test.js tests/remote-support-background.test.js tests/remote-support.test.js
```

## Initial Prompt for the Local Copilot Agent

Use this prompt to start the implementation session:

> Read `.copilot/marking-reload-handoff.md`,
> `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, and
> `.copilot/plan.md`. Do not code yet. First perform Phase 0: Q&A sanity check
> and fix planning for marking rules, rendering rules, XPath calculation, and AI
> payload construction. Identify any ambiguity that would require user approval.
> If there is no ambiguity, propose the smallest commit sequence for stabilizing
> page/tab reload marking states while preserving the locked marking contract and
> avoiding large runtime-message payload transfers.

After that sanity phase is accepted, use:

> Implement only Phase 1 first. Keep the change small. Do not alter the marking
> contract. Add focused regression coverage for reload/restore state. Validate
> with the focused marking tests that cover the changed behavior, then stop and
> summarize before moving to Phase 2.

For later phases, continue one phase per commit unless a test proves two changes
must land together.

