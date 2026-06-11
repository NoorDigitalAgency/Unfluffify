# High-Risk Content Branch Plan

Last updated: 2026-06-11
Branch: main
Status: G0-G3 complete; next phase is G4.

## Scope

Track F completed the written mechanical runtime-handler extractions through
F24. At the start of this plan, the remaining inline `content-main.js` runtime
branches were higher risk because they touched marking contracts, draft
persistence, AI preview state, or configuration reload ordering:

1. `configUpdated`
2. `setExplicitExclude`
3. `setExplicitInclude`
4. `savePageDraft`
5. `revertPageDraft`
6. `showAiPreview`

Progress:
- G0 locked the remaining branch inventory and guard matrix, then added the
   isolated `revertPageDraft` async failure fallback.
- G1 extracted `configUpdated` into `content/config-updated-handler.js` with
   focused handler coverage and preserved mixed sync/async response timing.
- G2 extracted `showAiPreview` into `content/ai-preview-show-handler.js` with
   focused coverage for preview item construction, empty-preview degradation,
   and close handling.
- G3 extracted `revertPageDraft` into `content/page-draft-revert-handler.js`
   while preserving inline validation and the G0 failure fallback.

Do not edit these branches as a continuation of Track F. Treat this as a new
high-risk track that starts with audit-result hardening and a fresh review gate.

## Post-F24 Audit Result

Baseline at audit time:

```bash
git status --short --branch
# ## main...origin/main

git log --oneline -1
# 33cb2f1 refactor(content): extract capture page snapshot handler

npm test
# 917 pass / 0 fail
```

No confirmed behavioral regression was found in the F20-F24 extractions.

Residual risks and missing coverage:

1. `revertPageDraft` returns `true` but its async IIFE has no `.catch()`.
   If `core.loadConfig`, `core.syncPageMarkings`, or another awaited operation
   rejects, the runtime message can fail to answer. This is pre-existing but
   should be fixed before extraction.
2. `showAiPreview` has no content-side guard for base-url scope, property-lock
   blocking, page-save reconciliation, or an already-active preview. Popup code
   does some gating before sending the message, but the runtime branch itself is
   not protected and the existing tests mostly cover popup request routing.
3. `configUpdated` has several intentionally unusual semantics: AI-preview mode
   reloads config without clearing preview restore state, enabled same-base
   updates respond only after merge/reseed settles, and the failure path still
   reports `{ ok: true }` after property-lock sync. These are covered by source
   tests, but not by focused handler-level tests.
4. `setExplicitExclude` and `setExplicitInclude` are marking-contract code, not
   simple runtime plumbing. Existing tests protect selector-suppression shape
   and XPath element caching, but there is no handler-level coverage for stale
   XPath/null-element cleanup, descendant override pruning, or property-lock and
   reconciliation guard responses.
5. `savePageDraft` is only a small branch wrapper, but the real work lives in
   `saveCurrentPageDraft`. That helper touches backend-saved refresh, local
   draft equality, reconciliation pending state, consent hiding, DOM snapshot,
   raw HTML capture, submission xpaths, config persistence, and saved-entry
   cache updates. Existing popup tests cover the higher-level save workflow, but
   focused helper tests are missing.
6. Property-lock and page-save reconciliation guard coverage is uneven for the
   remaining runtime branches. Before changing guard behavior, define the guard
   matrix explicitly so collaboration and preview workflows are not hardened in
   one path while accidentally broken in another.

## Non-Negotiable Guardrails

1. Do not edit `content/core.js`.
2. Do not change marking taxonomy, default exclusion behavior, XPath identity,
   selector suppression, AI-submission rows, overlay projection, or page-save
   reconciliation semantics unless the user approves that exact contract
   change.
3. Keep runtime message names and response shapes stable unless a phase
   explicitly says otherwise.
4. Preserve current async response behavior intentionally. If a branch currently
   lacks a catch and the phase wants to add one, that must be named as a bugfix,
   tested, and isolated in its own commit.
5. Every new `content/*` module imported by `content-main.js` must be added to
   `manifest.json` and `tests/content-decomposition-boundary.test.js` in the
   same commit.
6. Do not add broad `content/*.js` or `common/*.js` manifest wildcards.
7. Use dependency injection; do not introduce a shared mutable content-state
   module.
8. Keep one phase per commit. For each phase run focused tests, full
   `npm test`, diagnostics, review, commit, and push.

## Stop Conditions

Stop and ask the user before continuing if any of these occur:

1. A phase requires editing `content/core.js`.
2. A phase requires changing the marking contract instead of only preserving or
   extracting it.
3. A branch guard cannot be defined without changing popup/background message
   payloads or user-facing workflow timing.
4. A focused test fails for a reason other than expected source-contract drift.
5. Full `npm test` fails and the cause is not obviously local to the current
   phase.
6. A new content module would need to import `content-main.js`.
7. A module cycle appears.
8. Live validation is required for unflagged marking/save/preview behavior and
   cannot be completed autonomously.

## Phase G0 - Pre-Start Audit Hardening

Purpose:
- Address audit findings before extracting the remaining branches.
- Add missing branch-level coverage so later refactors can be mechanical.

Risk level: high. Use a senior coding model at high effort.

Files likely to edit:
- `content-main.js`
- `tests/content-high-risk-branches.test.js` or existing focused suites
- `.copilot/high-risk-content-branches-plan.md`
- `.copilot/handoff-world-decomposition.md`

Required steps:

1. Establish baseline:
   ```bash
   git status --short --branch
   git pull --ff-only
   npm test
   ```

2. Add a focused source-contract test that inventories the six remaining inline
   branches and records that Track F is complete. This test should fail if a
   branch is removed without adding the planned handler import and manifest
   entry.

3. Add guard-matrix tests for the remaining branches before changing behavior.
   The matrix must state, for each message type, whether these checks are
   required in `content-main.js`:
   - active base-url scope
   - `state.config` availability
   - property-lock interaction block
   - page-save reconciliation pending block
   - async `.catch()` response fallback

4. Fix `revertPageDraft` async failure handling in its own small commit:
   - keep existing validation and success response unchanged
   - add `.catch(() => sendResponse({ ok: false }))`
   - add focused test coverage that a load failure still answers `{ ok: false }`
   - do not extract the branch in this same commit

5. Decide and document `showAiPreview` handler-level guards before extraction.
   If adding guards, update tests first and keep the response contract explicit:
   - missing/wrong base URL: `{ ok: false }`
   - property-lock blocked: `{ ok: false, locked: true }`
   - reconciliation pending: `{ ok: false, reconciliationPending: true }`
   - already-active preview: either close-and-reenter or deterministic
     `{ ok: false }`; choose one and test it before implementation

6. Decide and document `configUpdated` guard policy before extraction. Do not
   blindly add property-lock or render-mode-inspection gates. This branch is
   also used for save/discard/render-mode update flows, so any new gate must
   prove it does not block required config resync.

G0 decisions recorded before extraction:
- `configUpdated` keeps its existing content-side policy for G1: AI-preview
   reloads remain allowed without `state.config`, enabled updates are scoped by
   `utils.sameBaseUrl(message.baseUrl, state.baseUrl)`, and no property-lock or
   reconciliation block is added in `content-main.js`.
- `showAiPreview` keeps popup-owned gating for G2. The current content branch
   intentionally has no base-url, config, property-lock, reconciliation, or
   already-active-preview guard. Any later hardening must be added as a tested
   behavior change before extraction.
- `revertPageDraft` keeps its existing base-url, `state.config`, and
   property-lock gates. Its async load/sync body now catches failures and
   responds `{ ok: false }` before the later G3 extraction.

Focused validation:
```bash
npm test -- tests/content-high-risk-branches.test.js tests/popup-marking-refresh.test.js tests/preview-tooltip.test.js tests/popup-ai-run-gating.test.js tests/selector-suppression.test.js
```

Full validation:
```bash
npm test
```

Commit message:
```text
test(content): lock high-risk branch contracts
```

If the `revertPageDraft` catch fix is made as a separate commit, use:
```text
fix(content): handle page draft revert failures
```

## Phase G1 - Config Updated Handler Extraction

Purpose:
- Extract the `configUpdated` runtime branch after G0 has locked its guard
  policy and response timing.

New module:
- `content/config-updated-handler.js`

Boundary:
- Keep `if (message.type === "configUpdated")` in `content-main.js`.
- Move branch internals into methods that preserve the three current paths:
  1. AI-preview active config reload.
  2. enabled same-base merge/reseed flow.
  3. disable/clear-preview fallback for out-of-scope updates.

Must preserve:
- AI-preview active branch keeps preview restore state.
- Enabled same-base branch responds only after load/merge/reseed settles.
- Enabled same-base failure path still runs property-lock sync and responds
  `{ ok: true }`.
- `forceReloadPageEntry` reseeds saved entry, page type, render, and draft
  status exactly as before.

Focused tests:
```bash
npm test -- tests/config-updated-handler.test.js tests/preview-tooltip.test.js tests/popup-ai-run-gating.test.js tests/popup-marking-refresh.test.js tests/popup-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Commit message:
```text
refactor(content): extract config updated handler
```

## Phase G2 - AI Preview Show Handler Extraction

Purpose:
- Extract `showAiPreview` after G0 defines the required handler-level guards.

New module:
- `content/ai-preview-show-handler.js`

Boundary:
- Keep runtime validation in `content-main.js` if G0 adds it there.
- Move preview construction and mode entry into the handler:
  - normalize selector set
  - collect default preview items
  - build expanded category items
  - enter preview mode
  - set preview item sets
  - call `core.showAiPopover`
  - return `{ ok: true, count }`

Must preserve:
- collection failures degrade to empty preview item sets
- `onClose` exits AI preview mode
- preview state restoration behavior from F9/F10/F12
- popup silent preview and marking-mode preview remain distinct entry points

Focused tests:
```bash
npm test -- tests/ai-preview-show-handler.test.js tests/preview-tooltip.test.js tests/popup-marking-refresh.test.js tests/background-marking-activation.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Commit message:
```text
refactor(content): extract ai preview show handler
```

## Phase G3 - Page Draft Revert Handler Extraction

Purpose:
- Extract `revertPageDraft` only after G0 fixes/locks async failure handling.

New module:
- `content/page-draft-revert-handler.js`

Boundary:
- Keep target-base validation and property-lock gate in `content-main.js`.
- Move successful async body into handler.
- Preserve catch fallback from G0.

Must preserve:
- reload config from storage
- set saved page entry to stored entry or null
- sync page markings when a stored entry exists
- update `state.baseUrl` and `state.config` only after config load succeeds
- schedule render and notify draft status
- return `{ ok: true, dirty, entry }`

Focused tests:
```bash
npm test -- tests/page-draft-revert-handler.test.js tests/popup-page-reconciliation.test.js tests/popup-marking-refresh.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Commit message:
```text
refactor(content): extract page draft revert handler
```

## Phase G4 - Page Draft Save Helper Extraction

Purpose:
- Extract `saveCurrentPageDraft` and then the `savePageDraft` branch wrapper.

New module:
- `content/page-draft-save-handler.js`

Boundary:
- Keep target-base validation and property-lock gate in `content-main.js`.
- Move `saveCurrentPageDraft` into the handler with injected deps.
- Keep branch behavior: successful result sends property-lock activity before
  response.

Must preserve:
- backend-saved refresh before draft comparison
- no-op save response when snapshot and submission xpaths already match
- reconciliation-pending response when server sync is pending
- consent hiding before snapshot
- rendered/raw HTML and submission-xpath persistence
- save failure clears newly-created reconciliation pending state
- saved-entry cache update and draft-status notification

Focused tests:
```bash
npm test -- tests/page-draft-save-handler.test.js tests/popup-page-reconciliation.test.js tests/popup-marking-refresh.test.js tests/ai-run.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Commit message:
```text
refactor(content): extract page draft save handler
```

## Phase G5 - Explicit Marking Handler Extraction

Purpose:
- Extract `setExplicitExclude` and `setExplicitInclude` together because they
  share selector suppression, XPath element caching, descendant cleanup, and
  marking-contract rules.

New module:
- `content/explicit-marking-handler.js`

Boundary:
- Keep base-url, `state.config`, property-lock, reconciliation, and missing
  XPath validation in `content-main.js`.
- Move the marking mutations into handler methods:
  - `setExplicitExclude({ targetBaseUrl, xpath, excluded })`
  - `setExplicitInclude({ targetBaseUrl, xpath, included })`

Must preserve:
- `createXPathElementCache()` per operation
- `isSameOrDescendantByElementOrXPath` semantics
- default toggleable conversion from excluded ancestor to `excluded: false`
- selector suppression add/clear behavior
- include descendant pruning
- timestamp touch, normalization, render scheduling, snapshot save, draft
  persist, property-lock activity, and dirty response

Focused tests:
```bash
npm test -- tests/explicit-marking-handler.test.js tests/selector-suppression.test.js tests/popup-marking-refresh.test.js tests/content-activation-order.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js
```

Commit message:
```text
refactor(content): extract explicit marking handler
```

## Stop After G5

After G5, stop and review `content-main.js` again. Remaining work may include
additional orchestration branches, but do not infer boundaries without a fresh
audit and updated plan.