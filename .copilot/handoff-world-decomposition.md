# Handoff - World Decomposition And Content Follow-Up

Last updated: 2026-06-11
Branch: `main`
Status: world-decomposition program complete; content follow-up plan ready.

## Active Plan

The active successor plan is:

1. `.copilot/content-main-followup-refactor-plan.md`

The previous plan, `.copilot/world-decomposition-plan.md`, is now historical.
Use it for rationale only, not as the active step list.

## Current Repository State

Known-good state at this handoff update:

```bash
git status --short --branch
# ## main...origin/main

npm test
# 840 pass / 0 fail
```

Recent completion commits:

1. `c6e49c7 refactor(content): extract property lock banner`
2. `60ee4df refactor(content): extract remote support client`
3. `0e8bf99 refactor(content): extract page telemetry bridge`
4. `e4eb958 fix(extension): restore background and popup startup`
5. `d81064f test(content): add decomposition boundary guard`
6. `713fe79 refactor(popup): group popup timers`

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
4. `content/remote-support-client.js` still has one direct
   `chrome.runtime.sendMessage` dependency that should be injected for testability.
5. Remote-support support-page viewer/UI code and property-lock mode/state code
   are the next sensible decoupling candidates, but they are flag-gated and must
   remain behavior-preserving.

The active plan turns those findings into mechanical phases.

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

1. Run PRE0 from the active plan to verify the current baseline.
2. PRE1 documentation drift is addressed by this docs cleanup commit. If future
   edits reintroduce stale references, repeat PRE1 before code work.
3. Begin Phase D0: inject the remote-support state request dependency into
   `content/remote-support-client.js`.

Do not start D1/D2 before D0 is committed and pushed.

## Validation Commands For The Next Agent

Use these before starting D0:

```bash
git status --short --branch
git pull --ff-only
npm test
rg -n "remoteSupport:|propertyLockCollaboration:" common/feature-flags.js
rg -n "content/page-telemetry-bridge.js|content/remote-support-client.js|content/property-lock-banner.js" manifest.json
```

Expected:

1. clean `main...origin/main`
2. full test suite passes
3. both relevant feature flags are `false`
4. all current extracted content modules are listed in the manifest
