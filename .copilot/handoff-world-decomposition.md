# Handoff - Content Main Decomposition

Last updated: 2026-06-12
Branch: `main`
Status: world decomposition complete; content follow-up D0-D2, E0-E2, Track F F1-F24, and high-risk phases G0-G5 complete. Track H runtime-router/service work H0-H3 is complete and now paused for post-H3 review.

## Current Repository State

Latest validated implementation baseline:

```bash
git status --short --branch
# ## main...origin/main

npm test
# 961 pass / 0 fail
```

This baseline includes G5 (`setExplicitExclude` and `setExplicitInclude`)
extracted into `content/explicit-marking-handler.js` with focused tests plus a
green full suite, plus post-review async content-message fallback hardening for
rejectable delegated branches.

Track H progress:

1. H0 complete with commit message `test(content): lock runtime router contracts`.
2. H0 focused validation passed:
   - `npm test -- tests/content-main-runtime-router-contract.test.js tests/content-command-router.test.js tests/content-high-risk-branches.test.js`
3. H0 full validation passed:
   - `npm test` (`949 pass / 0 fail`)
4. H1 complete with commit message `refactor(content): extract runtime message handler`.
5. H1 focused validation passed:
   - `npm test -- tests/content-main-runtime-router-contract.test.js tests/runtime-message-handler.test.js tests/content-command-router.test.js tests/content-activation-order.test.js tests/content-high-risk-branches.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
6. H1 full validation passed:
   - `npm test` (`955 pass / 0 fail`)
7. H2 complete with commit message `refactor(content): extract support page runtime messages`.
8. H2 focused validation passed:
   - `npm test -- tests/content-main-runtime-router-contract.test.js tests/content-remote-support-support-page-message-handler.test.js tests/content-remote-support-support-page.test.js tests/runtime-message-handler.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
9. H2 full validation passed:
   - `npm test` (`959 pass / 0 fail`)
10. H3 complete with commit message `refactor(content): extract content main service registry`.
11. H3 focused validation passed:
    - `npm test -- tests/content-main-service-registry.test.js tests/content-main-runtime-router-contract.test.js tests/content-activation-order.test.js tests/content-high-risk-branches.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js`
12. H3 full validation passed:
    - `npm test` (`961 pass / 0 fail`)

## Review Result

The recent Track F extraction series was reviewed after F19. The review covered:

1. `content-main.js` runtime branch delegation.
2. All newly extracted `content/*handler.js` modules from F8-F19.
3. Handler unit tests and source-contract tests.
4. `manifest.json` web-accessible resource registration.
5. `.copilot` handoff and plan documents.

Findings:

1. No behavioral regressions were found in the recent handler extractions.
2. Async response behavior is preserved for the reviewed branches:
   - async branches still return `true`
   - synchronous branches still return synchronously
   - fallback response handling matches the local branch pattern used at the
     time of extraction
3. Every new imported `content/*` module has a manifest entry and boundary-test
   coverage.
4. Every extracted handler has focused unit coverage.
5. The `.copilot` docs were stale and still described Track F as complete only
   through F1. This handoff and the active plan now supersede that wording.
6. `manifest.json` had one cosmetic indentation inconsistency around
   `content/render-mode-inspection-handlers.js`; it was corrected in the docs
   cleanup commit.

No pre-code bugfix phase is required before the next implementation slice.

## Completed Architecture Work

### World Decomposition

Tracks A and B are complete. Background and popup domains have been moved into
focused modules. Historical details are available in git history; do not restore
old archive plans into `.copilot`.

### Content Follow-Up Tracks D and E

Track D is complete through D2:

1. D0: remote-support client runtime dependency injection.
2. D1: remote-support viewer client extraction.
3. D2: remote-support support-page extraction.

Track E is complete through E2:

1. E0: property-lock banner mode extraction.
2. E1: property-lock port client extraction.
3. E2: property-lock state-machine extraction.

### Track F Completed Through F24

Track F now includes these completed, pushed phases:

1. F1 page toast helper.
2. F2 render-mode inspection lifecycle client.
3. F3 runtime inspection handler delegation.
4. F4 inspection status resolver.
5. F5 render-mode inspection handlers.
6. F6 runtime `setEnabled` delegation.
7. F7 AI preview response builder.
8. F8 AI preview compute-lock handler.
9. F9 AI preview close handler.
10. F10 AI preview expanded-mode handler.
11. F11 remote support state handler.
12. F12 AI preview get-state handler.
13. F13 default exclusions handler.
14. F14 visible xpaths handler.
15. F15 invisible xpaths handler.
16. F16 describe xpaths handler.
17. F17 focus handler.
18. F18 AI submission xpaths handler.
19. F19 collect page data handler.
20. F20 force refresh handler.
21. F21 page save reconciliation pending handler.
22. F22 page save reconciliation clear handler.
23. F23 page draft status handler.
24. F24 capture page snapshot handler.

Recent validated Track F slices before the remaining high-coupling branches:

```text
F24 refactor(content): extract capture page snapshot handler
F23 refactor(content): extract page draft status handler
F22 refactor(content): extract reconciliation clear handler
F21 refactor(content): extract reconciliation pending handler
F20 refactor(content): extract force refresh handler
```

## Active Documents

Use these files, in this order, before making any further implementation change:

1. `.copilot/plan.md` - active architecture index and guardrails.
2. `.copilot/content-main-followup-refactor-plan.md` - active Track H executor
   plan for the remaining `content-main.js` router/service seams.
3. `.copilot/knowledge.md` - domain-specific rules that must not be violated.
4. `.copilot/high-risk-content-branches-plan.md` - completed G0-G5 historical
   record.
5. `.copilot/track-f-protected-content-plan.md` - completed mechanical Track F
   record through F24.

## Next Exact Step

Track F mechanical slices are complete through F24. High-risk phases G0-G5 are
also complete and remain documented for history in
`.copilot/high-risk-content-branches-plan.md`.

The next exact step is Track H in
`.copilot/content-main-followup-refactor-plan.md`.

Track H is already scoped. Do not redesign it. H0-H3 are complete. Stop here
and review before any deeper mutable-state extraction. The approved outcome is:

1. extract the legacy plain-message runtime router from `content-main.js`
2. extract the support-page runtime-message subgroup from that router
3. extract the lazy handler/client service registry
4. stop after H3 and review again before any mutable-state extraction

Current baseline expectations:

1. clean `main...origin/main`
2. full test suite passes (`961 pass / 0 fail` at the current baseline)
3. `manifest.json` keeps explicit web-accessible resource entries, no broad
   `content/*.js` or `common/*.js` wildcards

Post-F24 audit result:

1. No confirmed behavioral regression was found in F20-F24.
2. Remaining risk is concentrated in `configUpdated`, `setExplicitExclude`,
   `setExplicitInclude`, `savePageDraft`, `revertPageDraft`, and
   `showAiPreview`.
3. Missing coverage should be addressed before extraction, not while extracting.
4. The `revertPageDraft` branch now has an isolated async fallback test and
   responds `{ ok: false }` when its async load/sync body fails.

## Model Capability Recommendation

Recommended model for the active Track H plan:

1. Use GPT-5.4 at high effort when available.
2. A less capable model may execute H0-H3 only by following the written Track H
   instructions literally.
3. Do not let the executor infer post-H3 work or redesign message transport.

## Non-Negotiable Guardrails

1. Do not edit `content/core.js`.
2. Do not change marking taxonomy, default exclusions, silent-highlighting,
   visibility, overlay projection, page-save reconciliation semantics, XPath
   calculation, or AI-submission behavior unless the user approves a new
   high-risk marking-contract plan.
3. Do not change runtime message names or payload field names.
4. Do not change storage keys, feature defaults, retry counts, timer values, or
   user-facing copy unless a phase explicitly says so.
5. Every new `content/*` module imported by `content-main.js` must be added to
   `manifest.json` `web_accessible_resources.resources` in the same commit.
6. Do not add broad `content/*.js` or `common/*.js` web-accessible-resource
   wildcards.
7. Do not introduce a shared mutable content-state module. Use dependency
   injection with narrow getters/setters.
8. Keep one phase per commit. Run focused tests, full `npm test`, diagnostics,
   commit, and push before moving to the next phase.

## Stop Conditions

Stop and ask the user before continuing if any of these occur:

1. A phase appears to require editing `content/core.js`.
2. A phase appears to change marking, silent-highlighting, visibility, XPath,
   AI-submission, or page-save reconciliation behavior instead of only moving
   code behind dependency injection.
3. Focused tests fail for a reason other than expected source-contract drift.
4. Full `npm test` fails and the cause is not obviously local to the current
   phase.
5. A new module would need to import `content-main.js`.
6. A module cycle appears.
7. Live validation is required for an unflagged core workflow and cannot be
   completed autonomously.
