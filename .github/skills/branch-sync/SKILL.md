---
name: branch-sync
description: Before starting repository work, verify the current branch is up to date with its upstream and bring it into a safe synced state when that can be done without rewriting history.
---

# Sync the Current Branch Before Starting Work

Use this skill at the **start of a task** before planning or editing repository
workflows that assume the branch is current.

Read-only inspection or review does not require this skill first; use it when
the task is about starting work from a current branch.
Do not use it to block entry into `review-push` on an already-dirty
worktree; that workflow owns end-of-task upstream handling.

The goal is to make sure the current branch has the latest upstream changes and
is safe to work on without hiding divergence or rewriting history.

## Contract

Do not begin the task itself until you have checked the branch/upstream state and
handled it according to the rules below.

This skill is complete only when one of these is true:

1. The branch is confirmed in sync with its upstream.
2. The branch was clean and safely fast-forwarded to upstream.
3. The branch is ahead-only with zero upstream lag, so it already contains the
   latest upstream changes and is safe to start from.
4. You surfaced the exact blocker that prevents safe sync and stopped before task
   work begins.

## Required checks

Run, in order:

```bash
git --no-pager status --short
git --no-pager branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git fetch "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} | cut -d/ -f1)"
git rev-list --left-right --count HEAD...@{u}
```

Interpret `git rev-list --left-right --count HEAD...@{u}` as:

- first number = commits only on local `HEAD`
- second number = commits only on upstream

## Decision rules

### Case 1 - Clean and already in sync (`0 0`)

Proceed with the real task.

### Case 2 - Clean and behind only (`0 N`)

Fast-forward before starting:

```bash
git pull --ff-only
```

Then re-run:

```bash
git rev-list --left-right --count HEAD...@{u}
```

Proceed only if it returns `0 0`.

### Case 3 - Clean and ahead only (`N 0`)

Do not rewrite history. The branch is not fully synced yet because upstream does
not contain the local commits. Leave the commits intact, note that the branch is
ahead-only, and proceed with the task if that is acceptable for the requested
work. If the user asked for a fully synced/published branch, push only at the
appropriate publish step rather than at task start.

### Case 4 - Clean but diverged (`N M`, both non-zero)

Stop and ask the user before rebasing, merging, or otherwise rewriting/integrating
history. Do not guess the integration strategy.

### Case 5 - Dirty worktree, upstream unchanged (`status` dirty and counts `N 0`
or `0 0`)

Do not discard or stash user changes automatically. You may proceed with the task
only if the current local changes are the intended starting point. Otherwise stop
and ask the user how to handle the dirty worktree.

### Case 6 - Dirty worktree and upstream is ahead or diverged

Stop and ask the user. Do not pull, merge, rebase, or stash around local changes
without explicit approval.

## Guardrails

- Never use `git reset --hard`, `git checkout --`, or force-push.
- Never rebase, merge, or stash automatically when local changes exist.
- Prefer `git pull --ff-only` over broader pull behavior when the branch is clean
  and only behind.
- If the branch has no upstream configured, stop and report that exact problem.
- If fetching the upstream remote fails, stop and report the fetch failure rather
  than pretending the branch state is current.

## How other skills should use this

- Use this skill before `run-plan` or any comparable start-of-task
  workflow.
- Use this skill before non-trivial repository tasks that may take time, so work
  does not begin from a stale branch.
- Do not use this skill as a substitute for the publish/sync checks in
  `review-push`; that skill still owns the end-of-task push phase.

## Done response

Lead with the sync result:

- `In sync with upstream`
- `Fast-forwarded to upstream`
- `Ahead of upstream but up to date`
- `Blocked on dirty worktree before sync`
- `Blocked on branch divergence`

Then either continue into the real task or stop for user input.
