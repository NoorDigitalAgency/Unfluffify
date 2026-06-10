# Handoff - Storage Access Layer Refactor

Last updated: 2026-06-10
Branch at document creation: main
Implementation status: IN_PROGRESS (Phases 0-2 complete, not yet committed)
Document commit scope: implementation handoff refresh after Phase 0-2 execution

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
9. Storage-domain migration phases have not started yet.

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
4. Phase 3 - Add storage access inventory guard: TODO.
5. Phase 4 - Extract low-level storage core: TODO.
6. Phase 5 - Transfer payload store: TODO.
7. Phase 6 - Settings store read path: TODO.
8. Phase 7 - Settings store write path: TODO.
9. Phase 8 - Background-owned credentials for network commands: TODO.
10. Phase 9 - Tab session store: TODO.
11. Phase 10 - Device emulation storage boundary: TODO.
12. Phase 11 - Config store write queue: TODO.
13. Phase 12 - Remove remaining raw Chrome storage debt: TODO.

## Validation Baseline

Last known validation after Phase 0-2 implementation:

```bash
npm test
```

Result:

1. 712 tests passed.
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

Next exact command:

1. `git switch -c refactor/storage-access-layer`
2. `rg -n --glob '!.tmp/**' 'chrome\.storage|utils\.storage(Get|Set|Remove)' .`

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
