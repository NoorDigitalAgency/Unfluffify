# Handoff - World Decomposition And Content Follow-Up

Last updated: 2026-06-11
Branch: `main`
Status: world-decomposition program complete; content follow-up D2 + E2 + F1 complete.

## Active Plan

The active successor plan is:

1. `.copilot/content-main-followup-refactor-plan.md`
2. `.copilot/track-f-protected-content-plan.md`

The completed world-decomposition summary below is retained here. The old
step-by-step archive was removed from `.copilot`; use git history if its
rationale is needed.

## Current Repository State

Known-good state at this handoff update:

```bash
git status --short --branch
# ## main...origin/main

npm test
# 865 pass / 0 fail
```

Recent completion commits:

1. `refactor(content): extract remote support support page` (this handoff update)
2. `82e9f84 refactor(content): extract remote support viewer client`
3. `45f4f45 refactor(content): inject remote support state request`
4. `dde67f9 docs(copilot): remove stale historical plans`
5. `425b6cb docs(copilot): add content follow-up refactor plan`
6. `c6e49c7 refactor(content): extract property lock banner`

Feature flags relevant to the next work:

1. `FEATURE_FLAGS.remoteSupport === false`
2. `FEATURE_FLAGS.propertyLockCollaboration === false`

Because both of those features are currently disabled, live validation for those
feature-specific refactors may be deferred until the user prioritizes those
features again.

## Completed World-Decomposition Summary

### Track A - Background

Complete. Background domains have been extracted into `background/*`, including
command ledger, live-page client, network/remote/config sync, world trace,
popup-state broker, render-mode inspector, AI-run orchestrator, async task
reporting, tab state, and managed timeout hardening.

### Track B - Popup

Complete. Popup domains have been extracted into `popup/*`, including spinner,
site resolution, remote config, render-mode inspection, page reconciliation,
property-lock UI, remote-support UI, and grouped timer hardening.

### Track C - Content Peripheral Slices

Complete as implemented.

1. C0: `d81064f test(content): add decomposition boundary guard`
2. C1: `0e8bf99 refactor(content): extract page telemetry bridge`
3. C2: `60ee4df refactor(content): extract remote support client`
4. C3: `c6e49c7 refactor(content): extract property lock banner`

Important scope note: C2 and C3 were implemented conservatively. The original
world-decomposition plan listed a broader remote-support support-page extraction
and a full `updatePropertyLockBannerMode` move. Those are not bugs in the current
code; they are intentionally deferred follow-up work in the active plan.

## Review Findings Already Addressed In The Active Plan

The 2026-06-11 review found:

1. The old handoff had stale status and pending commit lines after C3 was already
   pushed.
2. The old world-decomposition plan still claimed implementation had not started
   and still carried mandatory Track C live-gate wording that no longer matched
   the user's current policy.
3. `content-main.js` is still large, but most of the remaining mass is protected
   marking, silent-highlight, visibility, and reconciliation logic.
4. D0 has addressed the direct `chrome.runtime.sendMessage` dependency in
   `content/remote-support-client.js` by injecting `requestRemoteSupportState`.
5. Remote-support support-page viewer/UI code and property-lock mode/state code
   are the next sensible decoupling candidates, but they are flag-gated and must
   remain behavior-preserving.

The active plan turns those findings into mechanical phases.

## Content Follow-Up Progress

### Track D - Remote Support Content Follow-Up

1. D0 complete: `content/remote-support-client.js` now requests initial
   background state through the injected `requestRemoteSupportState` dependency
   supplied by `content-main.js`.
2. D0 validation:
   - `npm test -- tests/content-remote-support-client.test.js tests/content-decomposition-boundary.test.js`
     -> 5 pass / 0 fail
   - `npm test` -> 841 pass / 0 fail
3. D1 complete: viewer transport state and request/response wiring moved from
   `content-main.js` into `content/remote-support-viewer-client.js`, with
   `content-main.js` delegating through `getRemoteSupportViewerClient()`.
4. D1 validation:
   - `npm test -- tests/content-remote-support-viewer-client.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-remote-support-client.test.js`
     -> 14 pass / 0 fail
   - `npm test` -> 845 pass / 0 fail
5. D2 complete: support-page state, UI, render cycle, and frame handling moved
   from `content-main.js` into `content/remote-support-support-page.js`, with
   `content-main.js` delegating support-page initialization and runtime message
   branches through `getRemoteSupportSupportPage()`.
6. D2 validation:
   - `npm test -- tests/content-remote-support-support-page.test.js tests/remote-support-support-page.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
     -> 11 pass / 0 fail
   - `npm test` -> 848 pass / 0 fail
7. Live validation deferred by policy while `FEATURE_FLAGS.remoteSupport` is
   false.

### Track E - Property Lock Content Follow-Up

1. E0 complete: `updatePropertyLockBannerMode` decision logic moved from
   `content-main.js` into `content/property-lock-banner-mode.js`, with
   `content-main.js` keeping a thin wrapper and injecting state deps.
2. E0 validation:
   - `npm test -- tests/property-lock-banner-mode.test.js tests/property-lock.test.js tests/property-lock-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
     -> 43 pass / 0 fail
   - `npm test` -> 853 pass / 0 fail
3. Live validation deferred by policy while
   `FEATURE_FLAGS.propertyLockCollaboration` is false.
4. E1 complete: property-lock port lifecycle moved from `content-main.js` into
   `content/property-lock-port-client.js`, with `content-main.js` delegating
   connect/disconnect/reconnect/send behavior through the injected client.
5. E1 validation:
   - `npm test -- tests/property-lock-port-client.test.js tests/property-lock.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
     -> 40 pass / 0 fail
   - `npm test` -> 858 pass / 0 fail
6. Live validation deferred by policy while
   `FEATURE_FLAGS.propertyLockCollaboration` is false.
7. E2 complete: property-lock recovery/persistence/warning transitions and
   server-message reducer moved from `content-main.js` into
   `content/property-lock-state-machine.js`, with `content-main.js` delegating
   through a dependency-injected state-machine factory.
8. E2 validation:
   - `npm test -- tests/property-lock-state-machine.test.js tests/property-lock.test.js tests/property-lock-render-mode.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
     -> 41 pass / 0 fail
   - `npm test` -> 861 pass / 0 fail
9. Live validation deferred by policy while
   `FEATURE_FLAGS.propertyLockCollaboration` is false.

### Track F - Protected Content Follow-Up

1. Dedicated Track F plan created: `.copilot/track-f-protected-content-plan.md`.
2. F1 complete: page-toast style/DOM/timer helper moved from
   `content-main.js` into `content/page-toast.js`, while `content-main.js`
   preserves a thin `showPageToast` wrapper and snapshot strip behavior.
3. F1 validation:
   - `npm test -- tests/page-toast.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js`
     -> 33 pass / 0 fail
   - `npm test` -> 865 pass / 0 fail

## Non-Negotiable Guardrails

1. Do not edit `content/core.js`.
2. Do not move or alter marking, silent-highlighting, visibility, page-save
   reconciliation, XPath, AI-submission, or overlay projection behavior unless
   the user explicitly approves a new high-risk marking-contract plan.
3. Do not enable `remoteSupport` or `propertyLockCollaboration` as part of a
   refactor.
4. Do not change runtime message names, payload shapes, storage keys, timeouts,
   retry counts, or feature defaults unless a phase explicitly says so.
5. Every new `content/*` module imported by `content-main.js` must be added to
   `manifest.json` `web_accessible_resources.resources` in the same commit.
6. Never add broad `content/*.js` or `common/*.js` web-accessible-resource
   wildcards.
7. Do not introduce a shared mutable content-state bucket. Use narrow dependency
   injection, getters, setters, or factories.
8. Do not commit generated MCP/browser profiles, screenshots, debug JSON,
   orchestration run output, tokens, or secrets.

## Live Validation Policy

Use this policy for follow-up phases:

1. Docs-only or tests-only phases do not need live validation.
2. Flag-gated remote-support and property-lock collaboration phases may record
   live validation as deferred while the corresponding feature flag remains
   disabled.
3. Core unflagged user behavior requires live validation when the automated tests
   and source review do not give high confidence.
4. If a core live harness is needed and cannot be completed autonomously, stop
   and ask the user for collaborative live harness debugging.

## Next Exact Step

Start with `.copilot/content-main-followup-refactor-plan.md`.

Recommended next implementation phase:

1. Run the standard phase baseline from the active plan.
2. Continue Track F under `.copilot/track-f-protected-content-plan.md`.
3. Before any F2+ implementation, keep using dedicated per-phase scope,
   validation, and rollback criteria.

Track D is complete through D2. Track E is complete through E2. Track F is
complete through F1.

## Validation Commands For The Next Agent

Use these before any Track F phase after F1:

```bash
git status --short --branch
git pull --ff-only
npm test
rg -n "remoteSupport:|propertyLockCollaboration:" common/feature-flags.js
rg -n "content/page-telemetry-bridge.js|content/page-toast.js|content/remote-support-client.js|content/remote-support-viewer-client.js|content/remote-support-support-page.js|content/property-lock-banner.js|content/property-lock-banner-mode.js|content/property-lock-port-client.js|content/property-lock-state-machine.js" manifest.json
```

Expected:

1. clean `main...origin/main`
2. full test suite passes
3. both relevant feature flags are `false`
4. all current extracted content modules are listed in the manifest
