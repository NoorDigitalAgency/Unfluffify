---
name: review-fix-commit-push
description: Run a review and fix loop until clean, validate, commit, push, and continue to the next ready task.
---

# Review, Fix, Commit, Push, Continue

Use this skill only when the user explicitly asks for the review/fix loop to end
with commit and push/sync, or explicitly asks to commit and push after review.
If the user asks only for review/fix work, do not use this skill to publish
changes.

## Contract

Do not stop after the first review, the first fix, or the first successful test.
The task is complete only when:

1. The review reports no significant issues.
2. Required validation passes.
3. The intended changes are committed.
4. The branch is pushed or otherwise synced with its upstream.
5. The next ready task is identified or started, if the user asked to continue.

## Workflow

1. Inspect the worktree and branch:

   ```bash
   git --no-pager status --short
   git --no-pager branch --show-current
   git rev-parse --abbrev-ref --symbolic-full-name @{u}
   ```

   If unrelated user changes are present, leave them alone. If changes are in the
   same files you need to touch, read the file and preserve the user's work.

2. Run a high-signal review of the current diff.

   Ask the reviewer to report only correctness issues that matter: regressions,
   broken behavior, data loss, race conditions, security/privacy problems,
   runtime/type failures, missing validation for the exact requirement, or
   repository-contract violations. Tell the reviewer to ignore style and trivia.

3. If the review is not clean, fix every significant finding.

   For each finding:

   - Reproduce or reason through the failure mode before editing.
   - Fix the root cause, not just the visible symptom.
   - Add or update focused regression coverage for the bug.
   - Run the smallest relevant validation for that fix.

4. Repeat review -> fix -> focused validation until the reviewer reports
   `CLEAN` or equivalent.

   Do not commit while significant review findings remain.

5. Run final validation for the actual change.

   Preferred order for this repo:

   ```bash
   deno task check
   deno task test
   deno task build:release
   ```

   Use narrower commands only when the change is documentation-only or when a
   full command is clearly unrelated. If browser/live validation is required,
   use `pnpm browser:live <target-url>` / `.output/chrome-mv3` and reload the
   extension service worker before observing behavior.

6. Commit with the repository's existing message style.

   Sample recent commits first:

   ```bash
   git --no-pager log --oneline -20
   git --no-pager log --oneline --author="$(git config user.name)" -10
   ```

   Stage only intended files by explicit path. Never use `git add -A` when
   unrelated user changes may exist.

   ```bash
   git status --short
   git add path/to/intended-file another/intended-file
   git --no-pager diff --cached --stat
   git --no-pager diff --cached --check
   ```

   Scan for accidental secrets or generated artifacts before committing.

7. Push or sync without force-push.

   ```bash
   git fetch origin
   git rev-list --left-right --count HEAD...@{u}
   git push
   git --no-pager status --porcelain
   git rev-list --left-right --count HEAD...@{u}
   ```

   If upstream moved and a rebase is needed, preserve both upstream and local
   intent. Ask the user before any history rewrite or force-push.

8. Move to the next task only after push succeeds.

   If SQL todos exist, query ready todos:

   ```sql
   SELECT t.* FROM todos t
   WHERE t.status = 'pending'
   AND NOT EXISTS (
     SELECT 1 FROM todo_deps td
     JOIN todos dep ON td.depends_on = dep.id
     WHERE td.todo_id = t.id AND dep.status != 'done'
   );
   ```

   Mark the next task `in_progress` before starting it. If there is no ready
   task, report completion and stop.

## Failure handling

- If review finds an issue you believe is wrong, verify with source/tests before
  rejecting it.
- If validation fails, fix the failure and rerun the relevant validation.
- If hooks alter files, do not amend automatically. Inspect, stage intentionally,
  and create a follow-up commit only if appropriate.
- If push is rejected due to upstream changes, fetch and inspect ahead/behind
  state, then ask the user before rebasing or otherwise rewriting local commit
  history. Never force-push without explicit approval.

## Done response

Lead with the result. Include the commit hash, push target, and any meaningful
validation performed. Do not include a long process recap unless something was
blocked or unusual.
