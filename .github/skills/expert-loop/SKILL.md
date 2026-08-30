---
name: expert-loop
description: Repeatedly audit the rewritten extension, plan and execute verified remediation, check each run-plan result against its exact make-plan, and restart the full audit until expert-check proves production readiness. Use only when the user explicitly authorizes the autonomous expert-check, make-plan, run-plan, commit, and push loop; deployment and production publication remain separate permissions.
---

# Expert Audit and Remediation Loop

Drive the rewritten extension to a genuinely production-ready state through two
nested evidence-backed loops:

```text
full expert-check
  ├─ PASS ───────────────────────────────────────────> final readiness report
  └─ findings -> make-plan -> run-plan -> conformance check
                                      ├─ FAIL -> delta make-plan -> run-plan -> check again
                                      └─ PASS -> restart full expert-check on the new pushed HEAD
```

The inner loop proves that the exact plan was implemented completely and
correctly. The outer loop then starts a fresh product-wide audit to find
regressions, interactions, or remaining issues outside that plan. Do not treat
plan conformance as a substitute for the next full audit.

## Invocation and Authority

Use this skill only when the user explicitly asks for the iterative
`expert-check` -> `make-plan` -> `run-plan` closure loop. An ordinary audit,
review, or production-readiness question uses `expert-check` alone.

Explicit invocation authorizes:

- repository diagnosis, planning, implementation, tests, and headed validation;
- normal non-force commits and pushes performed by each `run-plan` cycle;
- creation of local evidence artifacts required to prove the result.

It does not authorize:

- deployment, release promotion, or production configuration changes;
- authoritative production Save, final Lynx selector publication, or other
  external data mutation unless the user separately approves it;
- force-push, rebase, history rewriting, destructive cleanup, or absorbing
  unrelated worktree changes;
- weakening a contract, severity, test, or acceptance threshold to make the
  loop terminate.

Before the first implementation cycle, state that successful `run-plan` cycles
will commit and push. If that publication authority is not explicit in the
user's request, stop after the first audit and ask for it.

## Required Skill Composition

At the start, read and follow the current repository versions of:

1. `branch-sync`
2. `expert-check`
3. `make-plan`
4. `run-plan`
5. `safe-change`
6. `review-push`
7. the relevant repository `live-*` skills for any headed browser work

Announce the nested skill when each phase begins. The nested skill keeps its own
contract unless this skill adds a stricter gate. In particular:

- `expert-check` remains the evidence and release-verdict authority;
- `make-plan` remains the implementation-plan authority;
- `run-plan` remains the execution and normal commit/push authority;
- `review-push` remains the final diff, validation, commit, and sync authority
  within each execution cycle.

Read `.copilot/knowledge.md`, all relevant repository instructions, the current
product authority, the active `plan.md`, and the exact source/tests before
judging or changing behavior. Refresh the code graph when required by the
component skills.

## Loop Ledger and Evidence Identity

Maintain one durable loop ledger in the active plan or its explicitly linked
plan document. Preserve completed historical plans. Give every outer audit and
inner plan revision a stable identity, for example:

- outer audit: `EL-01`, `EL-02`, ...
- remediation plan: `EL-01-R1`, `EL-01-R2`, ...
- findings: retain the stable IDs assigned by `expert-check`

For every state transition record:

- branch, exact commit, upstream synchronization, and tracked worktree state;
- build, extension, browser/profile, candidate URL, document, and viewport
  identity when relevant;
- audit verdict and finding IDs entering the plan;
- plan revision, its acceptance criteria, non-goals, and todo dependencies;
- implementation commits, focused/full validation, and retained evidence;
- conformance result for every planned acceptance criterion;
- open blocker, owner, and next permitted action.

Acceptance criteria are append-only once implementation begins. Status and
evidence may be updated, but criteria may not be silently deleted, softened, or
rewritten. A legitimate scope or decision change requires a new plan revision
that explains the change and preserves the prior result.

Historical artifacts are not current proof unless they match the exact audited
source and environment identity.

## Outer Loop: Full Expert Check

Start each outer iteration from the latest successfully pushed `HEAD` with no
unreviewed tracked implementation changes.

1. Invoke `expert-check` across the complete requested product scope. For a full
   release-readiness run, include all valid candidate properties, automated
   gates, production/debug builds, contracts, UI/UX, accessibility, performance,
   payloads, console/network hygiene, failure recovery, and headed workflows.
2. Reproduce and classify findings using `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`,
   `N/A`, and `NOT TESTED`. Do not count external or inapplicable cases as
   product passes.
3. If the verdict is `PASS` and the production-readiness gate below also passes,
   leave the loop and write the final readiness report.
4. Otherwise, send every confirmed product-owned issue that prevents a final
   `PASS` into the next `make-plan` phase. Retain non-blocking improvements in
   the register; do not discard them merely because they are Low severity.

A `CONDITIONAL`, required `BLOCKED`, `PARTIAL`, or `NOT TESTED` result never
advances directly to production-ready.

## Planning Phase: Make the Remediation Executable

Invoke `make-plan` against the exact entering audit and source identity.

The plan must:

- map every in-scope finding ID to an owning phase or an explicit external/N/A
  disposition with evidence;
- distinguish proven root cause from hypothesis;
- name exact files, symbols, contracts, tests, live checks, and non-goals;
- preserve locked decisions and deliberate rewrite improvements;
- define observable acceptance for behavior, performance, accessibility,
  payload hygiene, state cleanup, failure paths, and regression boundaries;
- include focused validation per phase and full gates for the exact final source;
- materialize an executable todo/dependency chain for `run-plan`;
- contain no unresolved product or architecture decision.

If a new behavior, architecture, data, UI-copy, persistence, or risk decision is
needed, use `consult-architect` where required and ask the user one deterministic
question. Do not start `run-plan` while an open question remains.

When the prior inner conformance check failed, create a delta revision covering
the exact remaining gap and any regression it exposed. Do not replace the
original plan with a vague "finish fixes" step and do not reimplement already
approved work without evidence that it regressed.

## Execution Phase: Run the Plan Completely

Invoke `run-plan` for the accepted executable plan revision.

- Execute every ready phase; do not stop after the first fix or green test.
- Follow `safe-change` for implementation slices and add focused regression
  coverage for each defect.
- Keep unrelated user files and generated audit artifacts out of commits.
- Run validation proportional to risk, including the required repository and
  headed-browser gates on the exact source.
- Complete `review-push`, commit only intended files, push without force, and
  verify upstream synchronization before conformance review begins.
- If `run-plan` reports a real blocker, preserve its state and stop the loop;
  never pretend the plan reached conformance review.

## Inner Loop: Plan-Conformance Quality and Sanity Check

After a successful `run-plan`, invoke `expert-check` in plan-conformance scope
against the exact pushed result. This is an independent verification pass, not
a summary of the implementer's tests.

Build a criterion-by-criterion matrix and prove:

1. Every planned phase and todo is complete; no work was silently skipped.
2. Every finding mapped into the plan has the intended observable resolution.
3. The implementation follows the plan's approved ownership, interfaces,
   non-goals, and locked product decisions.
4. Every acceptance criterion passes with current automated, source, payload,
   and headed evidence appropriate to the contract.
5. The diff contains no significant correctness, race, data-loss, security,
   privacy, accessibility, performance, production-debug, or maintainability
   regression.
6. Failure, cancellation, retry, navigation, reload, and cleanup paths affected
   by the plan remain bounded and truthful.
7. The exact implementation commit is pushed and the tracked worktree contains
   no unreviewed product change.

The conformance verdict is only:

- `APPROVED`: all criteria pass, all planned findings are resolved, and no
  significant regression attributable to the plan remains;
- `REJECTED`: any criterion is failed, partial, blocked, not tested, contradicted
  by live evidence, or implemented by weakening the plan.

On `REJECTED`, return immediately to a delta `make-plan` and then `run-plan`.
Repeat the inner loop until `APPROVED`. Only then begin the next full outer
`expert-check` on the new pushed `HEAD`.

## Production-Readiness Gate

The loop may finish only when the final full `expert-check`, performed after the
last conformance approval and with no intervening product change, proves all of
the following:

- overall verdict is `PASS`, not `CONDITIONAL`;
- every required contract and valid-property cell passes on current evidence;
- no required cell is `FAIL`, `PARTIAL`, `BLOCKED`, or `NOT TESTED`;
- no unresolved Critical or High finding remains, and no unresolved Medium
  finding violates deployability or a required contract;
- exact-source focused/full tests, production and debug builds, browser gates,
  payload/security/privacy checks, and live workflows required by the audit pass;
- every remediation plan revision has an `APPROVED` conformance matrix;
- the intended branch is pushed, synchronized with upstream, and has no
  unreviewed tracked implementation changes;
- any remaining Low improvement is explicitly recorded as non-blocking with a
  reason and does not contradict a required acceptance criterion.

Production-ready means **deployable**, not deployed. Report the release
recommendation and ask for separate deployment authorization if deployment is
desired.

## Progress and Stop Conditions

After each phase, give a concise checkpoint containing the outer iteration,
plan revision, exact commit, verdict, remaining finding IDs, and next action. Do
not ask for routine confirmation while the explicitly authorized loop is making
measurable progress.

Stop and ask for direction when:

- a required product or architecture decision is unresolved;
- credentials, a target URL, candidate data, production mutation, deployment,
  or another external permission is required;
- upstream movement would require rebase, force-push, or history rewriting;
- unrelated same-file work makes intent unsafe to merge;
- a required external service or environment prevents trustworthy acceptance;
- two consecutive remediation revisions make no measurable progress on the same
  finding and produce no new root-cause evidence.

There is no arbitrary iteration cap while evidence shows safe progress. A stop
condition is a blocker report, never a production-ready verdict.

## Final Report

Lead with `PRODUCTION READY` or `NOT PRODUCTION READY`. Include:

- final commit, branch, upstream synchronization, and audited environment;
- outer-audit and inner-plan iteration history;
- final contract and property matrices;
- resolved and remaining finding registers;
- validation, performance, accessibility, payload, security/privacy, and live
  browser evidence;
- all plan-conformance approvals and important retained artifacts;
- deployment recommendation and the explicit statement that no deployment or
  production publication occurred unless separately authorized.
