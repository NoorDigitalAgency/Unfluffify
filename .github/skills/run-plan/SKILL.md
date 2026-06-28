---
name: run-plan
description: Start or continue the repository's active plan autonomously, execute each ready step end-to-end, and finish with review-push unless a real blocker or required user input stops progress.
---

# Implement the Active Plan to Completion

Use this skill when the user explicitly wants you to **start or continue the
repository's plan autonomously**, keep going step by step until the plan is done,
and then run a final `review-push` round.

Do not use this skill unless the user explicitly wants the task to end with
commit/push publication. If the user wants autonomous plan execution without
publishing, use `safe-change` and stop before `review-push`.

This skill composes existing repository workflows; do not improvise around them:

- `branch-sync` before plan execution starts.
- `impl-plan` when no executable plan exists yet.
- `safe-change` for each implementation slice.
- `review-push` after the full plan is complete.

Before any planning or editing, first ensure the branch is current by running
`branch-sync`. If that skill reports a blocker, stop there rather
than starting plan execution from a stale or diverged branch.

## Contract

Do not stop after one phase, one commit, or one successful test. Keep moving
through the active plan until exactly one of these is true:

1. Every ready plan step is complete and the remaining plan is fully done.
2. You hit a genuine blocker that you cannot responsibly resolve alone.
3. The next step requires explicit user input or approval.

Do not ask the user for routine progress confirmation between phases. Only stop
for real decisions, missing external access, ambiguous competing plans, or
blocked validation/push states.

## Required startup read

Before choosing work, read in this order:

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. relevant `.github/skills/*/SKILL.md`
4. active session `plan.md`, if present
5. repository `.copilot/plan.md`
6. current worktree state

Minimum worktree check:

```bash
git --no-pager status --short
git --no-pager branch --show-current
```

Never overwrite unrelated user changes. If the files you need are already
modified, read them and preserve both the user's work and your intended change.

## Step 1 - Find the executable plan

Determine the active execution source in this order:

1. A SQL todo already marked `in_progress`.
2. Ready SQL todos (pending with all dependencies done).
3. The current session `plan.md`, if it contains an executable phased plan.
4. `.copilot/plan.md`, if it contains exactly one executable open plan.

Use this ready-todo query:

```sql
SELECT t.* FROM todos t
WHERE t.status = 'pending'
AND NOT EXISTS (
  SELECT 1 FROM todo_deps td
  JOIN todos dep ON td.depends_on = dep.id
  WHERE td.todo_id = t.id AND dep.status != 'done'
);
```

## Step 2 - Decide whether you can proceed or must ask

Proceed autonomously only when the next step is unambiguous.

Stop and ask the user exactly one deterministic question when:

- multiple open plans are simultaneously executable and the priority is unclear
- the only candidate plan is marked draft / review-only / blocked on approval
- the plan contains unresolved behavior or architecture questions
- the next step needs credentials, URLs, feature flags, environment access, or
  other external input you do not have
- local same-file user edits make intent ambiguous
- push/sync would require rebase, force-push, or another history rewrite

If no implementation plan exists yet but the requirement is clear, invoke
`impl-plan` first, create the execution plan/todo chain,
and then continue this skill.

## Step 3 - Materialize the plan into SQL todos

If the plan is described only in prose, mirror its execution steps into session
SQL todos before editing so progress survives context summarization.

Rules:

- Use descriptive kebab-case ids.
- Make each todo executable without rereading the whole plan.
- Encode dependencies in `todo_deps`.
- Mark a todo `in_progress` before touching its code.
- Mark it `done` only after its focused review/fix pass and validation succeed.

If the plan already has a todo chain, preserve it; do not invent a parallel
competing plan.

## Step 4 - Execute one ready step at a time

For each ready todo/phase:

1. Trace the exact source files, owners, message/data contracts, and tests for
   that step before editing.
2. Follow `safe-change`.
3. Make the smallest complete change for that step.
4. Add or update focused regression coverage when behavior changes or bugs are
   fixed.
5. Run the smallest relevant validation for that step.
6. Run a high-signal review/fix iteration on that step before moving on. Do not
   wait until the end to discover obvious correctness issues.
7. Update the session plan and/or `.copilot/plan.md` when milestone status or
   blocker state materially changes.
8. Mark the step `done`, then immediately take the next ready step.

Do not pause after a successful slice if another ready step remains.

## Step 5 - Keep looping until the plan is actually complete

After each completed step:

1. Re-query ready todos.
2. If another ready step exists, mark it `in_progress` and continue.
3. If no ready step exists, decide whether the plan is:
   - **complete**: everything intended is done
   - **blocked**: remaining work depends on user input or an external constraint
   - **incomplete due to review debt**: loop back and fix the unresolved issue

Do not declare completion while any planned step is still pending, in progress,
or silently blocked.

## Step 6 - Finish with `review-push`

Because this skill is only for publish-authorized runs, once the plan is fully
complete invoke `review-push` for the final round. That round must:

- run the review/fix loop until clean
- run validation matching the actual risk
- commit only intended files
- push/sync without force-push

Default repo gate for source changes:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```

Docs-only plan work may use:

```bash
git --no-pager diff --check
```

## Knowledge-update rule

If plan execution uncovers a reusable repository workflow, guardrail, or pitfall,
update the durable asset in the same branch before the final review/commit/push:

- `.copilot/knowledge.md` for stable facts
- `.github/instructions/*.instructions.md` for always-on rules
- `.github/skills/*/SKILL.md` for repeatable procedures

## Failure handling

- If a step fails validation, fix the failure and rerun the smallest relevant
  validation before continuing.
- If you cannot tell whether a review finding is real, verify against source and
  tests before dismissing it.
- If the plan's next step would change behavior that the plan never resolved,
  stop and ask instead of guessing.
- If the plan is blocked by missing external configuration or credentials, report
  the exact missing input and stop there.

## Done condition

This skill is done only when the active plan has no remaining ready work and the
final `review-push` round is complete, or when you have surfaced the
single concrete blocker that prevents further safe progress.
