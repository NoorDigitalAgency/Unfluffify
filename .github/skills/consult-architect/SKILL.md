---
name: consult-architect
description: Before new architecture/design direction choices, consult @Sojaner early with the root cause, proposed direction, and one deterministic multiple-choice question unless an approved handoff, plan, or direct user instruction already answers it.
---

# Consult @Sojaner Early for Architecture Decisions

Use this skill when a task introduces a new architectural or design direction:
cross-domain ownership changes, state-machine authority changes, or advanced
problem solving that creates a real behavior/architecture fork with multiple
reasonable directions.

Do not use it for narrow local fixes whose behavior is already fully defined by
existing source contracts, tests, or an explicit approved handoff.

## Contract

Do not spiral into deep investigation or implementation before consulting.

This skill is complete only when one of these is true:

1. @Sojaner approves the proposed direction.
2. @Sojaner gives a different direction.
3. The current task is already governed by an explicit approved plan/handoff or
   direct user instruction that answers the design question, so no new consult is
   needed.
4. The user is unavailable, no approved direction exists, and you stop with a
   clearly documented blocker instead of guessing.

## Minimum pre-work

Gather only enough context to frame the decision:

- the actual symptom or root cause
- the owner-of-truth modules and invariants that would be touched
- one recommended solution
- any materially different alternatives worth rejecting
- the single decision that needs approval

Do not read half the repository or write code first unless that is required to
identify the real decision.

## Required ask format

When a consult is needed, ask exactly one deterministic question with explicit
choices using the available user-interaction mechanism.

The prompt must contain:

1. the root cause in one or two sentences
2. the proposed solution in one or two sentences
3. one sentence on why the decision matters
4. one multiple-choice question with the recommended option first

Example structure:

```text
Root cause: the brain and popup both own the same spinner fact, so the page and
popup can drift during reconnects.

Proposed solution: move the deciding state fully into the brain and leave the
popup as a renderer only.

This matters because the wrong owner will keep reintroducing the same stuck
curtain bugs.

Question: Which authority should future changes follow?
Choices:
1. Brain-only authority with popup as renderer (Recommended)
2. Popup-local authority with brain mirroring
3. Shared dual authority with reconciliation
```

## Autonomous / no-user-available rule

If the current task already follows an explicit approved plan, handoff, or
direct user instruction that answers the architectural question, treat that as
the consult result and proceed without asking again.

If the task introduces a new architectural/design decision (or a true behavior
fork with no safe default) and the user is unavailable, stop and document the
blocker. Do not invent the direction.

## Guardrails

- Ask early, before deep implementation.
- Ask one question at a time.
- Prefer multiple choice over freeform.
- Put the recommended option first.
- Do not ask style or naming questions through this skill.
- Do not use this skill to re-ask decisions the user already approved in the
  current plan/handoff.

## Done response

Lead with the decision state:

- `Architect direction approved`
- `Architect direction changed`
- `Covered by approved handoff`
- `Blocked waiting for architect direction`

Then either continue into the task or stop on the blocker.
