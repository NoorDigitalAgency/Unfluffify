# Handoff - Content Main Decomposition

Last updated: 2026-06-11
Branch: `main`
Status: world decomposition complete; content follow-up D0-D2, E0-E2, and Track F F1-F19 complete and pushed.

## Current Repository State

Known-good code baseline before this documentation refresh:

```bash
git status --short --branch
# ## main...origin/main

git log --oneline -1
# 31fddb5 refactor(content): extract collect page data handler

npm test
# 903 pass / 0 fail
```

The working tree was clean before the review/documentation update. The only
review fix to production metadata was a cosmetic indentation correction in
`manifest.json`; it does not change JSON contents.

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

### Track F Completed Through F19

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

Recent Track F commits at the review baseline:

```text
31fddb5 refactor(content): extract collect page data handler
95282e5 refactor(content): extract ai submission xpaths handler
9804039 refactor(content): extract focus handler
e572536 refactor(content): extract describe xpaths handler
1e0354e refactor(content): extract invisible xpaths handler
e337dc9 refactor(content): extract visible xpaths handler
6663f82 refactor(content): extract default exclusions handler
378a972 refactor(content): extract ai preview get-state handler
344d850 refactor(content): extract remote support state handler
7aad64a refactor(content): extract ai preview expanded-mode handler
```

## Active Documents

Use these files, in this order, before making any further implementation change:

1. `.copilot/plan.md` - active architecture index and guardrails.
2. `.copilot/content-main-followup-refactor-plan.md` - current status summary.
3. `.copilot/track-f-protected-content-plan.md` - mechanical phase plan for the
   next implementation slices.
4. `.copilot/knowledge.md` - domain-specific rules that must not be violated.

## Next Exact Step

Start with Phase F20 in `.copilot/track-f-protected-content-plan.md`.

F20 is the recommended next slice because it is the smallest remaining async
runtime branch: extract `forceRefresh` into `content/force-refresh-handler.js`
without changing its promise/error behavior.

Before editing F20, run:

```bash
git status --short --branch
git pull --ff-only
npm test
```

Expected baseline:

1. clean `main...origin/main`
2. full test suite passes
3. `manifest.json` keeps explicit web-accessible resource entries, no broad
   `content/*.js` or `common/*.js` wildcards

## Model Capability Recommendation

Lowest model to safely follow the next mechanical plan:

1. F20-F22: a mid-tier coding model with high effort is acceptable if it can
   edit multiple files, run focused/full tests, and handle simple regex/source-
   contract drift. A GPT-4.1-mini-class model at high effort is the lowest I
   would trust.
2. F23-F24: use a stronger coding model at high effort. These phases copy
   larger transactional blocks and require careful preservation of async order,
   cached state updates, and response shapes.
3. Do not assign explicit include/exclude or marking-contract refactors to a
   low-capability model. Those need a new high-risk plan and a senior model.

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
