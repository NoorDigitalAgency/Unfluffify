# Content Main Follow-Up Refactor Plan

Last updated: 2026-06-11
Status: CURRENT INDEX - Track F, G0, and G1 are complete; high-risk continuation lives in `high-risk-content-branches-plan.md`

## Purpose

This document is the active index for the post-world-decomposition content-main
follow-up. The completed mechanical Track F phases are maintained in
`.copilot/track-f-protected-content-plan.md`; the remaining high-risk branch
plan lives in `.copilot/high-risk-content-branches-plan.md`.

Older D/E/F instructions that once lived here are complete and are intentionally
not repeated. Use git history for historical rationale if needed.

## Current State

Current validated baseline:

```bash
npm test
# 928 pass / 0 fail
```

Completed:

1. World-decomposition Tracks A and B.
2. Content follow-up Track D through D2.
3. Content follow-up Track E through E2.
4. Track F through F24.
5. High-risk plan G0 and G1.

Current implementation plan:

1. The written Track F phases are complete.
2. The active high-risk plan is `.copilot/high-risk-content-branches-plan.md`.
3. Continue with G2, `showAiPreview` handler extraction.
4. Follow one phase per commit.
5. Run focused validation and full `npm test` for every phase.
6. Update `.copilot/handoff-world-decomposition.md` with validation and commit
   results after each phase.
7. Stop at the explicit stop conditions in the high-risk plan.

## Review Summary

The F1-F19 extraction series was reviewed on 2026-06-11, and F20-F24 completed with focused plus full-suite validation.

Code review result:

1. No behavioral regression was found in the recent handler extractions.
2. Async/sync runtime response contracts looked preserved.
3. New content modules were registered in `manifest.json` and covered by
   boundary tests.
4. The only code-adjacent issue was cosmetic manifest indentation, corrected in
   the docs cleanup commit.
5. The real blocker for the next agent was documentation drift; the handoff and
   active plan have been refreshed.

No pre-code bugfix phase remains inside the written Track F plan.

Post-F24 audit note: the next plan includes a G0 pre-start phase because the
remaining branches have uneven guard coverage and one pre-existing async failure
handling risk in `revertPageDraft`.

## Required Baseline Before Any Next Phase

Run:

```bash
git status --short --branch
git pull --ff-only
npm test
```

Expected:

1. clean `main...origin/main`
2. full test suite passes with 0 failures
3. no uncommitted files under `.copilot`, `content-main.js`, `content/`,
   `tests/`, or `manifest.json`

## Guardrails

1. Do not edit `content/core.js`.
2. Do not change marking, silent-highlighting, visibility, page-save
   reconciliation semantics, XPath calculation, AI-submission behavior, overlay
   projection, or feature defaults unless the user explicitly approves a new
   high-risk plan.
3. Keep runtime message names and payload fields identical.
4. Every new `content/*` import in `content-main.js` must be added to
   `manifest.json` in the same commit.
5. Never add broad `content/*.js` or `common/*.js` manifest wildcards.
6. Do not introduce shared mutable state modules. Use narrow dependency
   injection.

## Model Capability Recommendation

Lowest acceptable executor:

1. The completed F20-F24 work is no longer the active executor target.
2. The active high-risk plan should use GPT-5.4 at high effort.
3. Explicit include/exclude, save/revert draft, and AI preview orchestration
   should not be assigned to a low-capability model.