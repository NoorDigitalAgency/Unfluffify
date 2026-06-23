---
description: Repository workflow guardrails for agents making plans, code changes, reviews, commits, or knowledge updates.
applyTo: "**"
---

# Agent Workflow Guardrails

Use the repository skills before improvising repeatable workflows:

- `review-fix-commit-push` for review/fix/commit/push loops.
- `autonomous-implementation-plan` for detailed implementation handoffs.
- `repo-safe-code-change` before non-trivial source changes.
- `extract-repo-knowledge` for durable knowledge-base and skill updates.
- `launch-test-browser` to open the live/dev Chromium with the unpacked
  extension loaded for observation or manual testing.

## Low-context agent rules

When modifying this repository, do not rely on memory or generic extension
patterns. Read the repo knowledge first:

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. relevant `.github/skills/*/SKILL.md`
4. the active session plan, if present
5. the exact source files and tests for the behavior

If a behavior decision is unclear, ask the user a deterministic multiple-choice
question before implementing. Do not invent product behavior, contracts, UI copy,
timeouts, persistence semantics, or fallback behavior.

## Non-drift rules

- Keep changes scoped to the requested behavior.
- Preserve legacy-safe behavior when introducing typed contracts or new state.
- Do not replace source-of-truth ownership without an explicit approved plan.
- Do not infer behavior from message text or queue position when a typed contract
  exists.
- Do not edit locked marking/highlighting behavior without explicit user approval
  and matching knowledge/test updates.
- Do not add broad catch blocks, silent success fallbacks, or hidden early
  returns.
- Always add regression coverage for fixed bugs.

## Validation rule

Use validation that matches the risk:

- Docs only: `git --no-pager diff --check`
- Source changes: focused tests while iterating, then `deno task check`,
  `deno task test`, and `deno task build:release`
- Live browser behavior: launch with `deno task browser:live <target-url>` (the
  `launch-test-browser` skill / committed launcher), which builds
  `dist/extension-dev` and drives only the `npm:@playwright/mcp@latest` managed
  Chromium; reload the unpacked extension/service worker after a rebuild before
  observing. Never touch the OS Chrome.

## Knowledge update rule

When a session discovers a reusable pitfall, decision, or workflow, update the
right durable asset in the same change:

- small stable fact -> `.copilot/knowledge.md`
- always-on rule -> `.github/instructions/*.instructions.md`
- repeatable procedure -> `.github/skills/*/SKILL.md`
