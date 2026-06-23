---
name: autonomous-implementation-plan
description: Create a precise implementation plan that a low-context agent can execute end-to-end without major reasoning or design decisions.
---

# Autonomous Implementation Plan

Use this skill when the user asks for a concrete, thorough implementation plan,
handoff, or phase plan that another agent should be able to execute safely.

The output must be a buildable recipe, not a brainstorm. A less capable agent
should be able to follow it without inventing architecture, guessing file paths,
or making unresolved product decisions.

## Planning standards

The plan must be:

- **Deterministic:** every important branch has an explicit decision rule.
- **Repository-aware:** it cites existing files, helpers, tests, and knowledge
  documents the implementing agent must read.
- **Scoped:** it states non-goals and the exact behavior that must not change.
- **Testable:** it defines focused tests, full validation, and acceptance
  criteria.
- **Recoverable:** it calls out likely regressions and how to detect them.

## Required pre-plan inspection

Before writing the plan:

1. Read the relevant repository knowledge:

   - `.copilot/knowledge.md`
   - `.github/instructions/*.instructions.md`
   - any existing `.github/skills/*/SKILL.md` related to the task
   - current session `plan.md`, if present

2. Inspect the current code paths and tests. Do not rely on memory.

   Use targeted searches first, then read the concrete files:

   ```bash
   rg "symbol|message|route|reason" path-or-repo
   git --no-pager status --short
   ```

3. Identify all unclear decisions. If any decision affects behavior,
   architecture, data shape, UI copy, persistence, or validation scope, stop and
   ask the user one deterministic question at a time with multiple-choice
   answers.

## Required plan structure

Write plans in this structure:

1. **Goal**

   State the user-visible outcome in one paragraph.

2. **Current facts**

   List verified facts only. Include file paths and symbols, for example:

   - `background/spinner-operations.ts:createSpinnerOperations()` owns spinner
     queue normalization.
   - `popup/ui.ts:getBusyCurtainCopy()` renders busy curtain copy.

3. **Decisions already made**

   Include user-approved decisions and repository constraints. Do not treat
   assumptions as decisions.

4. **Open questions**

   If questions remain, list them as deterministic choices. Do not proceed to an
   implementation plan until these are answered.

5. **Non-goals**

   State what the implementing agent must not change.

6. **Implementation phases**

   For each phase, include:

   - exact files to edit
   - exact functions/types/tests to touch
   - step-by-step edits in execution order
   - expected intermediate state
   - focused validation command
   - rollback or fallback rule

7. **Test matrix**

   Include unit, source-contract, integration, and live/manual checks as
   appropriate. For this repo, default validation is:

   ```bash
   deno task check
   deno task test
   deno task build:release
   ```

   Add `deno task build:dev` when the implementation needs live browser
   validation against `dist/extension-dev`.

8. **Regression risks**

   Include the highest-risk existing behavior and how the plan protects it.

9. **Acceptance criteria**

   Use observable criteria, not vibes. Example:

   - "AI preview appears before deferred config sync begins."
   - "An unresolved legacy spinner reason remains blocking after a broker
     snapshot."

10. **Todo chain**

    Create SQL todos when the plan spans multiple phases. Each todo should be
    executable without rereading the whole plan.

## Question format

Ask one question at a time. Prefer multiple-choice. Put the recommended option
first when there is one.

Example:

```text
Who should own the operation deadline?

Choices:
1. Service worker broker owns the deadline and popup only renders ticks (Recommended)
2. Popup owns the deadline while the broker stores only message state
3. Content script owns the deadline and reports expiry to the broker
```

## Plan anti-patterns

Avoid:

- "Refactor the module" without naming exact files/functions.
- "Add tests" without naming test files and cases.
- "Handle errors gracefully" without saying which errors and what the user sees.
- "Update docs if needed" without naming the doc and trigger condition.
- Broad rewrites when a narrower behavior-preserving edit is enough.

## Handoff quality check

Before finalizing, reread the plan as if you are a much weaker agent. If any step
requires hidden reasoning, split it into smaller steps or ask the user for a
decision.
