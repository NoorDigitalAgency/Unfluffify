# Unfluffify Active Architecture Plan

Last updated: 2026-06-11

## Objective

Continue the post-world-decomposition architecture work through the remaining
explicitly planned `content-main.js` seams, without touching protected marking,
silent-highlight, visibility, reconciliation, XPath, AI-submission, overlay
projection, or `content/core.js` behavior.

## Active Documents

Use these documents before making implementation changes:

1. `.copilot/content-main-followup-refactor-plan.md`
2. `.copilot/handoff-world-decomposition.md`
3. `.copilot/knowledge.md`

Historical and superseded `.copilot` plans/handoffs have been removed from the
workspace. If earlier rationale is needed, use git history instead of restoring
old archive files into the active `.copilot` folder.

## Current Architecture Track

The service-worker authority refactor, storage-access layer refactor, and world
decomposition program are complete and merged to `main`. Content follow-up
Tracks D and E are complete, and Track F is complete through F20. The active
track is now the remaining Track F runtime-branch decomposition in
`.copilot/track-f-protected-content-plan.md`, starting at F21.

This track protects the 11 always-on core features, including reveal/freeze and
lazy-loading stopping/restoration. Do not resume old implementation tracks unless
the user explicitly asks for them.

## Validation Baseline

Known-good current validation baseline:

```bash
git status --short --branch
# ## main...origin/main

npm test
# 904 pass / 0 fail
```

Review status on 2026-06-11: F1-F19 were reviewed with no behavioral regression
found. F20 then completed with focused validation and a green full suite. The
only earlier issue was stale `.copilot` documentation plus cosmetic manifest
indentation, both already addressed.

## Guardrails

1. Do not edit `content/core.js`.
2. Do not edit marking, silent-highlighting, visibility, page-save
   reconciliation, XPath, AI-submission, overlay projection, or locked core user
   flows without a separate high-risk plan approved by the user.
3. Do not enable `remoteSupport` or `propertyLockCollaboration` as part of a
   refactor.
4. Do not change runtime message names, payload shapes, storage keys, timeouts,
   retry counts, or feature defaults unless a phase explicitly says so.
5. Every new `content/*` module imported by `content-main.js` must be added to
   `manifest.json` `web_accessible_resources.resources` in the same commit.
6. Do not add broad `content/*.js` or `common/*.js` web-accessible-resource
   wildcards.
7. Do not introduce a shared mutable content-state bucket; use narrow dependency
   injection, getters, setters, or factories.
8. Do not commit generated MCP/browser profiles, screenshots, debug JSON,
   orchestration run output, tokens, or secrets.

## Marking Contract Lock

Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-contract change.

052c-derived marking restoration completed. The locked contract keeps `BUTTON`
toggleable, intentionally omits the redundant void `LINK` tag from the marking
taxonomy, keeps silent highlighting on `immutable`, `content`, and `excluded`,
and keeps toggleable default exclusions on the ordinary exclude marking path
without a separate visual layer.

AI submission must submit every stored excluded XPath row as excluded, while
explicit includes still submit as included even when nested inside excluded
ancestors. Any legitimate contract change must update
`MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, `.copilot/plan.md`,
`README.md`, and the focused regression tests in the same commit.

## Live Validation Policy

1. Docs-only or tests-only phases do not need live validation.
2. Flag-gated remote-support and property-lock collaboration phases may record
   live validation as deferred while the corresponding feature flag remains
   disabled.
3. Core unflagged user behavior requires live validation when automated tests and
   source review do not give high confidence.
4. If a core live harness is needed and cannot be completed autonomously, stop
   and ask the user for collaborative live harness debugging.

## Model Capability Recommendation

For the next plan in `.copilot/track-f-protected-content-plan.md`:

1. F20-F22 can be followed by a GPT-4.1-mini-class coding model at high effort.
2. F23-F24 should use a stronger coding model at high effort.
3. Do not give explicit include/exclude or marking-contract work to a small or
   low-effort model.
