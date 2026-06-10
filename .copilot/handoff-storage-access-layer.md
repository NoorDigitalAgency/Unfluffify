# Handoff - Storage Access Layer Refactor

Last updated: 2026-06-10
Branch at document creation: main
Implementation status: COMPLETE (Phases 0-12 complete)
Document commit scope: Phase 12 strict boundary enforcement slice

## Read This First

The active successor architecture plan is:

1. `.copilot/storage-access-layer-plan.md`

Follow that file exactly. This handoff records current status, validation
evidence, and the next strict step for future implementation sessions.

## Current Status

As of this handoff:

1. The service-worker authority refactor is complete through Phase 10 and merged
   to `main` via `d286355`.
2. A review on 2026-06-10 found no blocking functional issue in the refactor.
3. Full suite validation passed during review:
   - `npm test` -> 707/707 passed.
4. VS Code diagnostics reported no errors for the inspected architecture files:
   - `background.js`
   - `popup.js`
   - `common/async-messaging.js`
   - `background/command-router.js`
   - `background/tab-runtime.js`
   - `popup/messages.js`
5. Working tree was clean after review and before this planning update.
6. Phase 0 baseline setup has been executed on `main`:
   - `git fetch origin`
   - `git pull --ff-only`
   - `npm ci`
   - `npm test`
7. Phase 1 command source/tab policy hardening is implemented and validated.
8. Phase 2 command-ledger payload redaction is implemented and validated.
9. Phase 3 storage-access inventory guard is implemented and validated.
10. Phase 4 low-level storage wrapper extraction is implemented and validated.
11. Phase 5 transfer payload store extraction is implemented and validated.
12. Phase 6 settings store read-path migration is implemented and validated.
13. Phase 7 settings store write-path migration is implemented and validated.
14. Phase 8 credential migration first slice is implemented and validated for
   `TAB_RUN_AI`.
15. Phase 8 second slice is implemented for runtime network handlers in
   `background.js` and popup runtime payload cleanup in `popup.js`.
16. Phase 8 non-popup caller slice is implemented for content-side property-page
   type fetch runtime payload ownership.
17. Phase 8 credential payload cleanup is complete and validated.
18. Phase 9 tab-session-store migration is complete and validated.
19. Phase 9 runtime `setTabState` merge path now serializes read-merge-write updates per tab.
20. Phase 10 device emulation storage boundary is complete and validated.
21. Phase 11 config write queue is complete and validated.
22. Phase 12 strict boundary cleanup is complete and validated.
23. Transfer payload calls in popup/background now route through `background/transfer-payload-store.js` helpers.
24. Background persisted AI-run records now route through `background/ai-run-record-store.js` helpers.
25. Background restore-scope cleanup now routes through `clearTabStateScope` in `background/tab-session-store.js`.
26. Popup and background storage-change listeners now route through `addStorageChangeListener` in `common/storage-core.js` via `common/utilities.js`.
27. `common/utilities.js::disableExtensionForTab` now delegates live tab-state and script-injected cleanup to tab-session-store helpers instead of constructing/removing session keys directly.
28. `tests/storage-access-boundary.test.js` now keeps the current Chrome storage migration-debt bucket empty; new production raw storage access must live in an approved storage/domain module.
29. Residual page-local `localStorage` / `sessionStorage` usage remains separately tracked and out of scope for the Chrome storage phase.
30. Post-review hardening fixed the config cross-base lost-update race by merging queued entry writes into the latest stored configs snapshot before whole-object persistence.
31. Post-review hardening completed the command-router policy surface for `sender-or-message`, `none`, `tabIdSource`, and `policy` context metadata.

## Review Findings To Fix First

These two fixes are mandatory before storage migration.

### Finding 1 - Command Source And Tab Policy

Current risk:

1. `background/command-router.js` and `background.js` prefer caller-supplied
   `message.tabId` before `sender.tab.id`.
2. This is correct for popup debug-tab targeting, but the router does not encode
   source policy today.
3. A future content-origin command could accidentally gain cross-tab authority
   if it reuses the same route shape.

Required fix:

1. Extend background command registration with explicit `allowedSources`,
   `tabIdPolicy`, and `requireTab` options.
2. Route popup commands by message tab ID only when the command declares that
   policy.
3. Route content-origin commands by sender tab ID only.
4. Record command ledger entries under the resolved command context tab ID, not
   a spoofable message tab ID.

Plan phase:

1. Phase 1 in `.copilot/storage-access-layer-plan.md`.

### Finding 2 - Command Ledger Payload Redaction

Current risk:

1. `background.js::maybeGetCommandPayloadForLedger` stores raw payloads when
   `fullWorldMessagingLogging` is enabled.
2. The ledger is bounded and in-memory, but payloads may include `tokenValue`,
   `password`, `payloadKey`, large HTML, large config objects, or selector/page
   payload bodies.

Required fix:

1. Add a command-ledger redaction helper.
2. Redact token/password/authorization/cookie/secret/JWT-like fields.
3. Redact or summarize `payloadKey` and large body fields.
4. Keep useful command diagnostics: type, duration, status, error code, and
   small non-sensitive scalar metadata.

Plan phase:

1. Phase 2 in `.copilot/storage-access-layer-plan.md`.

## Storage Refactor Direction

After the two fixes, centralize storage by domain in this order:

1. Storage access inventory guard.
2. Low-level storage core wrappers.
3. Transfer payload store.
4. Settings store read path.
5. Settings store write path.
6. Background-owned credentials for network commands.
7. Tab session store.
8. Device emulation storage boundary.
9. Config store write queue.
10. Strict raw-storage boundary cleanup.

Do not skip directly to removing raw storage calls. First add the guard test so
the migration has a measurable surface.

## First Commands For Future Implementation

Run these before editing code:

```bash
git status --short
git fetch origin
git pull --ff-only
git switch -c refactor/storage-access-layer
npm ci
npm test
rg -n --glob '!.tmp/**' 'chrome\.storage|utils\.storage(Get|Set|Remove)|localStorage|sessionStorage|storage\.onChanged' .
rg -n --glob '!.tmp/**' 'registerBackgroundCommand|dispatchBackgroundCommand|getMessageTabId|maybeGetCommandPayloadForLedger' background.js background/command-router.js background/tab-runtime.js
```

If baseline tests fail before edits, stop and update this handoff with the
failure. Do not begin implementation on top of unexplained failures.

## Phase Checklist

Status values:

1. TODO: not started.
2. IN_PROGRESS: implementation started but not committed.
3. DONE: committed and validated.
4. BLOCKED: requires user decision or environment fix.

Current phase status:

1. Phase 0 - Baseline and branch setup: DONE.
2. Phase 1 - Harden background command source and tab policy: DONE.
3. Phase 2 - Redact command ledger payloads: DONE.
4. Phase 3 - Add storage access inventory guard: DONE.
5. Phase 4 - Extract low-level storage core: DONE.
6. Phase 5 - Transfer payload store: DONE.
7. Phase 6 - Settings store read path: DONE.
8. Phase 7 - Settings store write path: DONE.
9. Phase 8 - Background-owned credentials for network commands: DONE.
10. Phase 9 - Tab session store: DONE.
11. Phase 10 - Device emulation storage boundary: DONE.
12. Phase 11 - Config store write queue: DONE.
13. Phase 12 - Remove remaining raw Chrome storage debt: DONE.

## Validation Baseline

Last known validation after Phase 10 device emulation storage boundary migration:

```bash
npm test
```

Result:

1. 750 tests passed.
2. 0 failed.

Focused validation executed for Phase 11 config write queue:

1. `node --test tests/config-store-queue.test.js tests/selector-suppression.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js`
2. `npm test`

Focused result:

1. 83 passed.
2. 0 failed.

Focused validation executed for Phase 12 transfer payload cleanup slice:

1. `node --test tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 64 passed.
2. 0 failed.

Focused validation executed for Phase 12 AI-run persisted record cleanup slice:

1. `node --test tests/ai-run.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 18 passed.
2. 0 failed.

Focused validation executed for Phase 12 listener/tab cleanup boundary slice:

1. `node --test tests/storage-access-boundary.test.js tests/device-emulation-lifecycle.test.js tests/marking-no-auto-restore.test.js tests/popup-marking-refresh.test.js tests/tab-session-store.test.js`
2. `npm test`

Focused result:

1. 85 passed.
2. 0 failed.

Full-suite result:

1. 755 passed.
2. 0 failed.

Focused validation executed for post-review config queue and command-router policy hardening:

1. `node --test tests/config-store-queue.test.js tests/background-command-router.test.js tests/background-command-hardening.test.js tests/tab-isolation-hardening.test.js`

Focused result:

1. 27 passed.
2. 0 failed.

Full-suite result:

1. 758 passed.
2. 0 failed.

Focused validation executed for Phase 12 strict boundary enforcement slice:

1. `node --test tests/storage-access-boundary.test.js tests/device-emulation-lifecycle.test.js tests/settings-store.test.js tests/transfer-payload-store.test.js tests/tab-session-store.test.js`
2. `npm test`

Focused result:

1. 53 passed.
2. 0 failed.

Full-suite result:

1. 755 passed.
2. 0 failed.

Focused validation executed for Phase 9 runtime merge queue hardening:

1. `node --test tests/tab-session-store.test.js tests/device-emulation-lifecycle.test.js tests/background-marking-activation.test.js tests/tab-isolation-hardening.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 50 passed.
2. 0 failed.

Focused validation executed for Phase 10 device emulation storage boundary:

1. `node --test tests/device-emulation-lifecycle.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 26 passed.
2. 0 failed.

Focused validation executed for Phase 9 tab-session-store migration:

1. `node --test tests/tab-session-store.test.js tests/device-emulation-lifecycle.test.js tests/background-marking-activation.test.js tests/tab-isolation-hardening.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 49 passed.
2. 0 failed.

Focused validation executed for Phase 8 non-popup caller slice:

1. `node --test tests/selector-suppression.test.js tests/popup-marking-refresh.test.js tests/ai-run.test.js`
2. `npm test`

Focused result:

1. 80 passed.
2. 0 failed.

Focused validation executed for Phase 8 closure hardening:

1. `node --test tests/selector-suppression.test.js tests/popup-marking-refresh.test.js tests/ai-run.test.js`
2. `npm test`

Focused result:

1. 80 passed.
2. 0 failed.

Focused validation executed for Phase 8 second slice:

1. `node --test tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js`
2. `npm test`

Focused result:

1. 80 passed.
2. 0 failed.

Focused validation executed for Phase 8 first slice:

1. `node --test tests/ai-run.test.js tests/popup-marking-refresh.test.js`
2. `npm test`

Focused result:

1. 61 passed.
2. 0 failed.

Focused validation executed for Phase 7:

1. `node --test tests/settings-store.test.js tests/popup-marking-refresh.test.js tests/feature-flags.test.js`
2. `npm test`

Focused result:

1. 71 passed.
2. 0 failed.

Focused validation executed for Phase 6:

1. `node --test tests/settings-store.test.js tests/popup-marking-refresh.test.js tests/property-lock.test.js`
2. `npm test`

Focused result:

1. 81 passed.
2. 0 failed.

Focused validation executed for Phase 5:

1. `node --test tests/transfer-payload-store.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/render-mode-inspection-order.test.js tests/marking-no-auto-restore.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 78 passed.
2. 0 failed.

Focused validation executed for Phase 4:

1. `node --test tests/storage-core.test.js tests/utilities-runtime.test.js tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 12 passed.
2. 0 failed.

Focused validation executed for Phase 3:

1. `node --test tests/storage-access-boundary.test.js`
2. `npm test`

Focused result:

1. 2 passed.
2. 0 failed.

Focused validation executed after Phase 0-2 changes:

1. `npm test -- tests/background-command-router.test.js tests/background-command-hardening.test.js tests/tab-isolation-hardening.test.js tests/background-render-mode-inspection.test.js`
2. `npm test`

Focused result:

1. 23 passed.
2. 0 failed.

Focused validation from the review:

1. Main architecture files had no VS Code diagnostics.
2. Storage access inventory showed raw Chrome storage calls spread across:
   - `background.js`
   - `popup.js`
   - `popup/helpers.js`
   - `content-main.js`
   - `common/utilities.js`
   - `common/emulation.js`
   - `common/property-lock-background.js`
   - `common/lynx-live-pages.js`
   - orchestration/smoke scripts

## Phase 0-2 Implementation Delta

Files changed:

1. `background/command-router.js`
2. `background.js`
3. `tests/background-command-router.test.js`
4. `tests/background-command-hardening.test.js` (new)
5. `tests/background-render-mode-inspection.test.js`
6. `tests/background-marking-activation.test.js`

What changed:

1. Added per-command registration options in command routing:
   - `allowedSources`
   - `tabIdPolicy` (`message-or-sender`, `message`, `sender`)
   - `requireTab`
2. Added dispatch notification callback support so caller can observe resolved
   command context.
3. Declared popup command policy in `background.js` and applied it to all
   background command registrations that are popup-driven and tab-scoped.
4. Updated command ledger tab-id resolution to prioritize resolved command
   context tab id.
5. Replaced raw command payload ledger logging with redacted/summarized payload
   logging for debug mode.
6. Added/updated tests for:
   - source enforcement
   - sender-tab policy resolution
   - background hardening invariants
   - updated source-shape boundaries after registration signature changes.

## Phase 3 Implementation Delta

Files changed:

1. `tests/storage-access-boundary.test.js` (new)

What changed:

1. Added a recursive JavaScript storage boundary inventory test that excludes:
   - `.tmp/**`
   - `node_modules/**`
   - `tests/**`
   - `orchestration/**`
   - `scripts/**`
2. Added explicit bucket classification with comments for:
   - approved wrapper modules

## Phase 5 Implementation Delta

Files changed:

1. `background/transfer-payload-store.js` (new)
2. `background.js`
3. `tests/transfer-payload-store.test.js` (new)
4. `tests/storage-access-boundary.test.js`
5. `tests/marking-no-auto-restore.test.js`
6. `tests/popup-marking-refresh.test.js`

What changed:

1. Added dedicated transfer payload store helpers for:
   - key build/parse
   - put/get/consume/remove
   - stale key sweep
   - payload summary
2. Rewired `background.js` transfer-payload workflows to use the store helpers.
3. Removed inline transfer-payload key/sweep utilities from `background.js`.
4. Updated storage boundary inventory to classify the new wrapper module.
5. Added focused tests for transfer payload store contracts and updated source-shape tests.

## Phase 6 Implementation Delta

Files changed:

1. `common/settings-store.js` (new)
2. `popup/helpers.js`
3. `content-main.js`
4. `common/property-lock-background.js`
5. `tests/settings-store.test.js` (new)
6. `tests/storage-access-boundary.test.js`

What changed:

1. Added settings store read helpers with one batched sync-storage read for global AI settings.
2. Added optional settings read cache with sync-area change invalidation and explicit cache invalidation helper.
3. Added property-lock connection settings helper for clearer background call-site intent.
4. Delegated popup, content, and property-lock background settings reads to the shared settings store.
5. Added settings-store tests for batched read shape, normalization, cache behavior, invalidation, and token redaction summaries.
6. Updated storage-boundary approved-wrapper list to include the new settings store module.

## Phase 7 Implementation Delta

Files changed:

1. `common/settings-store.js`
2. `popup.js`
3. `common/lynx-live-pages.js`
4. `tests/settings-store.test.js`
5. `tests/popup-marking-refresh.test.js`
6. `tests/storage-access-boundary.test.js`

What changed:

1. Added settings-store write helpers for global token, endpoints, stage base, and login persistence.
2. Added theme settings read/write helpers in settings-store and delegated popup theme persistence to the store.
3. Migrated popup endpoint/stage/login/token-clear write paths to settings-store helpers while preserving token-reset behavior.
4. Migrated `maybeUpdateStoredTokenFromResponse` token persistence to settings-store.
5. Expanded settings-store tests for write-path token-reset rules, login persistence, token clear scope, and theme normalization.
6. Updated popup source-shape test expectations and storage-boundary phase TODO notes.
   - current migration debt
   - smoke/orchestration access
3. Added guard assertions so every raw storage finding maps to exactly one
   bucket and unmanaged new storage access fails the test.
4. Added separate tracking for page-local `window.localStorage` and
   `window.sessionStorage` usage in known files without forcing removal in this
   phase.
5. Added an ordered phase TODO list in the test to support bucket removals as
   migration progresses.

Inventory snapshot encoded by the test:

1. Approved wrapper bucket:
   - `common/storage-core.js`
2. Current migration debt bucket:
   - `background.js`
   - `popup.js`
   - `popup/helpers.js`
   - `content-main.js`
   - `common/emulation.js`
   - `common/property-lock-background.js`
   - `common/lynx-live-pages.js`
   - `common/utilities.js`
3. Page-local storage tracking bucket:
   - `content-loader.js`
   - `content-main.js`
   - `content/core.js`
   - `popup.js`
   - `popup/ui.js`

## Phase 4 Implementation Delta

Files changed:

1. `common/storage-core.js` (new)
2. `common/utilities.js`
3. `tests/storage-core.test.js` (new)
4. `tests/storage-access-boundary.test.js`

What changed:

1. Added `common/storage-core.js` with extracted low-level storage wrappers:
   - `storageGet`
   - `storageSet`
   - `storageRemove`
   - `storageClear`
   - `getStorageAreaName`
   - `isChromeStorageArea`
2. Preserved wrapper runtime error behavior, including `runtime.lastError`
   rejection and extension-context invalidation rejection paths.
3. Updated `common/utilities.js` to import and re-export storage wrappers from
   `common/storage-core.js` while keeping existing utility call sites stable.
4. Added `tests/storage-core.test.js` coverage for:
   - get/set/remove success
   - `runtime.lastError` rejection
   - synchronous storage API throw rejection
   - extension-context invalidation rejection
5. Updated storage boundary allowlist to treat `common/storage-core.js` as the
   approved wrapper module and moved `common/utilities.js` to migration debt.

Next exact command:

1. `git switch -c refactor/storage-access-layer-phase5`
2. `node --test tests/transfer-payload-store.test.js tests/ai-run.test.js tests/popup-marking-refresh.test.js tests/render-mode-inspection-order.test.js`

## Implementation Notes

1. Prefer adding tests before broad storage migrations.
2. Keep `common/utilities.js` compatibility exports until all call sites have
   moved.
3. Avoid import cycles. If a target store creates a cycle, introduce a narrower
   module instead of importing background-only code into shared content modules.
4. Background-owned credential reads should not block login. Login may still
   pass an email/password from popup for the immediate auth request, but the
   password must never be persisted or logged.
5. Page-local `localStorage` and `sessionStorage` flags are explicitly out of
   the initial Chrome storage migration. Track them, but do not fail the Chrome
   storage boundary test on them until a later page-local cleanup track.

## Commit Pattern

Recent repository commits use Conventional Commit style. Continue that style.

Suggested first implementation commits:

1. `fix(background): enforce command source tab policy`
2. `fix(background): redact command ledger payloads`
3. `test(storage): guard raw storage access inventory`
4. `refactor(storage): extract chrome storage core wrappers`

Each implementation commit must update this handoff with:

1. phase status
2. files changed
3. tests run
4. next exact command
