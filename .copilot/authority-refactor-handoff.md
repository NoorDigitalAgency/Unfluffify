# Authority Refactor Handoff

Planning-only handoff for the local Copilot agent. This document reconstructs
the final concrete authority-refactor plan from the prior planning session. The
later marking/XPath inspection is an additional preflight step in the process;
it does not replace the authority-refactor plan.

## Core Conclusion

Centralizing authority in the background service worker is reasonable and likely
to improve reliability for popup reloads, tab switches, navigation restore, AI
run polling, tab state, device emulation, and privileged Chrome APIs.

That does **not** mean moving DOM/page authority out of content scripts. Content
scripts must remain the authority for live page inspection, markings, snapshots,
draft collection, XPath calculation against the live/sanitized DOM, overlays,
and page-local preview rendering.

## Current Findings

- `background.js` already owns durable responsibilities: tab state, device
  emulation, content injection, navigation restore, icons, remote support, and
  property-lock routing.
- `popup.js` still owns too much orchestration: active-tab refresh, AI run
  lifecycle/polling, spinner queue persistence, remote config sync, direct tab
  state writes, tab listeners, and some privileged Chrome calls.
- `content-main.js` owns page-local authority: enabled state, markings, draft
  status, AI preview, page snapshots, property-lock UI, and remote support page
  rendering.
- Existing background-owned modules such as
  `common/remote-support-background.js` and `common/property-lock-background.js`
  are good examples of the target direction.

## Authority Boundaries

- Background service worker:
  - durable orchestration
  - tab lifecycle
  - state persistence
  - privileged Chrome APIs
  - long-running workflow recovery
  - cross-context broadcasts
- Popup/side panel:
  - UI rendering
  - user intent capture
  - request/response calls to background/content owners
- Content scripts:
  - live DOM/page inspection
  - page mutations
  - marking overlays
  - snapshots
  - XPath calculation from live/sanitized DOM
  - draft collection
  - AI preview rendering
- Shared modules:
  - pure normalization
  - serialization
  - constants
  - reusable helpers

## Concrete Plan

### 1. Define and document authority boundaries

- Lock the service worker as the durable runtime authority.
- Lock popup/side panel as UI and user-intent surfaces only.
- Lock content scripts as the page/DOM authority.
- Lock shared modules as pure logic only.

### 2. Add the marking/XPath inspection as an extra preflight step

Before changing ownership boundaries, inspect the marking and XPath contracts so
the refactor does not accidentally change page semantics.

- Re-read `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, and the
  marking sections of `.copilot/plan.md`.
- Confirm the locked marking contract remains unchanged:
  - taxonomy
  - target resolution
  - explicit include/exclude precedence
  - toggleable default exclusions
  - overlay projection
  - fast explicit refresh versus full invalidating rebuild
  - silent-highlighting layers
- Trace XPath ownership:
  - live XPath generation
  - sanitized snapshot XPath generation
  - stripped extension/automation roots
  - saved `submissionXpaths`
  - hidden textual rows
  - immutable/default suppression
- Confirm content scripts remain the only owner for live DOM, snapshot, marking,
  overlay, and XPath operations.
- Treat any proposed change to marking semantics, XPath semantics, or payload
  meaning as out of scope unless the user explicitly approves it.

### 3. Introduce a background runtime-authority layer

- Add a small, grouped set of background message APIs for:
  - tab context
  - activation state
  - navigation state
  - spinner/run state
  - config sync state
  - device state
- Avoid scattering one-off message handlers through `background.js`; group APIs
  by domain.
- Keep background operations idempotent so popup reloads and duplicate messages
  are safe.

### 4. Move tab state writes behind background APIs

- Replace popup-side direct `utils.getTabState` / `utils.setTabState` usage with
  background messages.
- Make the worker the single writer for:
  - `tabState:*`
  - `tabState:initial:*`
  - `tabState:restore:*`
  - `deviceEmulation:*`
  - `scriptInjected:*`
- Preserve existing restore behavior across reload/navigation.

### 5. Move active-tab lifecycle orchestration to the worker

- Popup should ask the worker for the current bound tab/context instead of
  independently resolving active/side-panel tabs as an authority.
- Worker should own:
  - activation on first supported page
  - content-loader activation
  - icon updates
  - navigation-based restore/disable decisions
- Popup tab listeners should become UI refresh triggers only, not state mutators.

### 6. Move spinner/navigation inspection state delegation

- Worker should own durable spinner/navigation inspection state.
- Popup should display that state and request refreshes, not persist or mutate
  the underlying lifecycle state directly.
- Preserve the existing page inspection/reveal/marking readiness behavior.
- Do not use this phase to change marking rules, XPath rules, or overlay
  precedence.

### 7. Move AI run lifecycle to the worker

- Move AI run start/status/result polling, deadlines, persisted run record,
  resume checks, and compute-lock coordination out of `popup.js`.
- Keep content-script responsibilities limited to:
  - snapshot capture
  - compute lock visual state
  - preview display
  - marking/XPath/payload evidence generation that requires DOM access
- Worker should broadcast AI run status updates to popup and content so popup
  reloads and tab switches do not interrupt polling.

### 8. Move privileged Chrome APIs behind worker messages

- Route these operations through background APIs:
  - tab reload
  - browsing-data clearing
  - content injection
  - device emulation
  - debugger operations
  - static HTML fetches
- Leave popup with request/response calls and UI feedback.

### 9. Keep page marking and draft DOM logic in content

- Do not move these into the worker:
  - `capturePageSnapshot`
  - live XPath filtering
  - draft dirty checks
  - marking overlays
  - AI preview rendering
- Worker may coordinate when content operations run and where their results are
  persisted.

### 10. Consolidate persistence strategy

- Use `chrome.storage.session` for tab/session runtime state.
- Use IndexedDB/config helpers for durable config/page marking data.
- Store enough resumable metadata for long operations, especially AI runs and
  navigation inspections.
- Avoid relying on background in-memory state alone because MV3 service workers
  can be suspended.
- Avoid moving huge HTML, server payloads, AI payloads, or AI responses through
  runtime messaging. Prefer persisted keys/metadata or an owner-context fetch.

### 11. Add compatibility shims first

- Add worker APIs while keeping current popup/content calls working.
- Migrate one responsibility at a time.
- Start with low-risk state ownership, then AI run orchestration, then remote
  config flow.

## Suggested Migration Order

1. Tab state/background authority cleanup.
2. Popup active-tab lifecycle delegation.
3. Spinner/navigation inspection state delegation.
4. AI run orchestration migration.
5. Remote config/site discovery orchestration cleanup.
6. Remove obsolete popup-side state mutations.

## Testing Plan

- Add tests for worker-owned tab state migration.
- Add tests for popup reload during active AI run.
- Add tests for tab switch and navigation restore behavior.
- Add tests ensuring content remains the only DOM/marking/XPath authority.
- Keep existing `npm test` coverage passing after each migration step.

Focused marking/XPath guard suite when touching marking, rendering, snapshot, or
submission code:

```sh
node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
```

Full suite before handoff/PR:

```sh
npm test
```

## Clarification Questions for the Local Agent

Ask the user only if the answer affects implementation scope:

- Should “background worker” mean strictly the MV3 service worker, or is an
  offscreen document acceptable for future truly long-lived work?
- Is AI run lifecycle the highest-priority reliability issue, or are tab/page
  reload marking states more urgent?
- Should this be done as one large refactor or split into several safer PRs?
- If a change would alter marking semantics, XPath semantics, or payload meaning,
  is that explicitly approved?

## Final Prompt for the Local Agent

Use this exact prompt to start the local implementation session:

> Read `.copilot/authority-refactor-handoff.md`,
> `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, and
> `.copilot/plan.md`. Do not code yet. First restate the authority boundaries:
> background service worker is durable runtime authority; popup/side panel is UI
> and user intent only; content scripts remain the only live DOM/page authority;
> shared modules stay pure. Then perform the added marking/XPath preflight:
> verify the locked marking contract, trace live and sanitized XPath ownership,
> and confirm no proposed authority refactor changes marking semantics, XPath
> semantics, overlay projection, or payload meaning. If any ambiguity would
> change those contracts, stop and ask for user approval.
>
> If there is no ambiguity, propose the smallest safe commit sequence for the
> authority refactor in this order: tab state/background authority cleanup,
> popup active-tab lifecycle delegation, spinner/navigation inspection state
> delegation, AI run orchestration migration, remote config/site discovery
> orchestration cleanup, then removal of obsolete popup-side state mutations.
> Keep page marking, draft DOM logic, snapshots, overlays, XPath calculation,
> and AI preview rendering in content scripts. Avoid moving large HTML/server/AI
> payloads through runtime messages; prefer persisted keys/metadata or an
> owner-context fetch.
>
> After the plan is accepted, implement only the first migration step. Keep the
> change small and compatibility-shimmed. Add focused regression coverage for
> worker-owned tab state, preserve reload/navigation restore behavior, run the
> relevant focused tests plus `npm test`, then stop and summarize before moving
> to the next step.
