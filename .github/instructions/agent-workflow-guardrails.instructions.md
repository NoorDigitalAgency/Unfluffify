---
description: Repository workflow guardrails for agents making plans, code changes, reviews, commits, or knowledge updates.
applyTo: "**"
---

# Agent Workflow Guardrails

Use the repository skills before improvising repeatable workflows:

- Follow `.github/skills/branch-sync/SKILL.md` before starting a
  repository task so work begins from a current branch or stops on a clear sync
  blocker. Invoke the `branch-sync` skill directly when it is
  exposed in the environment. Read-only review or inspection tasks are exempt.
- `review-push` for review/fix/commit/push loops.
- Follow `.github/skills/run-plan/SKILL.md` only when the user
  explicitly wants active-plan execution to continue through commit/push
  publication. Invoke the `run-plan` skill directly when it is
  exposed in the environment.
- `make-plan` for detailed implementation handoffs.
- `safe-change` before non-trivial source changes.
- `repo-knowledge` for durable knowledge-base and skill updates.
- `consult-architect` before architecture, design, cross-domain ownership, or
  advanced problem-solving work that introduces a new behavior/architecture
  direction when that direction is not already approved in an explicitly
  approved handoff, plan, or direct user instruction.
- `live-browser` to open the live/dev Chromium with the unpacked
  extension loaded for observation or manual testing.

## Low-context agent rules

When modifying this repository, do not rely on memory or generic extension
patterns. Read the repo knowledge first:

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. relevant `.github/skills/*/SKILL.md`
4. the active session plan, if present
5. the exact source files and tests for the behavior

Before substantive planning, review, or editing work in a fresh session,
refresh the repository graph with `codebase-memory-mcp-index_repository` unless
the current `HEAD` has already been indexed in this session. When searching for
symbols, relationships, or affected code, prefer `codebase-memory-mcp`
(`search_graph`, `search_code`, `get_code_snippet`, `trace_path`) before
`glob`, `rg`, or manual browsing. After every commit, and again after every
successful push, refresh the graph so the next agent inherits the latest local
and published index.

Before starting a new repository planning or editing task, follow
`.github/skills/branch-sync/SKILL.md` so the current branch is
checked against its upstream and safely fast-forwarded when possible. Invoke the
skill directly when it is exposed in the environment. If the worktree is dirty
and upstream moved, or the branch diverged, stop and ask instead of guessing.

Pure read-only review or inspection may proceed without this sync step.
Entering `review-push` on an already-dirty worktree is also exempt;
that workflow handles upstream movement at the publish step.

If a behavior decision is unclear and an explicitly approved handoff, plan, or
direct user instruction does not already answer it, ask the user a deterministic
multiple-choice question before implementing. In no-user-available runs, only
stop on a true blocker or a no-safe-default fork; do not invent product
behavior, contracts, UI copy, timeouts, persistence semantics, or fallback
behavior.

For architectural reasoning, design, or advanced problem-solving work that
creates a new direction choice, consult @Sojaner early unless the current task
already carries an approved direction in an explicitly approved handoff, plan,
or direct user instruction. Present the root cause, the proposed solution, and
one deterministic multiple-choice question before deep implementation instead of
spiraling. If a new architecture decision appears and the user is unavailable,
stop and document the blocker instead of guessing.

## Non-drift rules

- Keep changes scoped to the requested behavior.
- Preserve legacy-safe behavior when introducing typed contracts or new state.
- Do not replace source-of-truth ownership without an explicit approved plan.
- Do not infer behavior from message text or queue position when a typed contract
  exists.
- Do not reintroduce popup-local button/curtain authority once a brain-side
  session dictation/decider exists; extend the background deciders and fact
  reporters instead.
- Do not edit locked marking/highlighting behavior without explicit user approval
  and matching knowledge/test updates.
- Do not add broad catch blocks, silent success fallbacks, or hidden early
  returns.
- Always add regression coverage for fixed bugs.

## Validation rule

Use validation that matches the risk:

- Docs only: `git --no-pager diff --check`
- Source changes: focused tests while iterating, then `pnpm lint`,
  `pnpm check`, `pnpm test`, and `pnpm build`
- Live browser behavior: launch with `pnpm browser:live <target-url>` (the
  `live-browser` skill / committed launcher), which builds and loads
  `.output/chrome-mv3` in only the `npm:@playwright/mcp@latest` managed
  Chromium; reload the unpacked extension/service worker after a rebuild before
  observing. Never touch the OS Chrome.

## Knowledge update rule

When a session discovers a reusable pitfall, decision, or workflow, update the
right durable asset in the same change:

- small stable fact -> `.copilot/knowledge.md`
- always-on rule -> `.github/instructions/*.instructions.md`
- repeatable procedure -> `.github/skills/*/SKILL.md`
