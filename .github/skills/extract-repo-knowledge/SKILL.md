---
name: extract-repo-knowledge
description: Read the codebase by domain, extract durable architectural knowledge, ask deterministic clarification questions, and update repo knowledge/skills/instructions.
---

# Extract Repository Knowledge

Use this skill when the user asks to learn the codebase, document architectural
logic, capture decisions, create a durable knowledge base, or prepare future
agents so they do not need to reread and understand the whole repository every
time.

This is a research and documentation workflow. Do not change product behavior
while running it unless the user separately requests implementation.

## Output goals

Produce durable agent-facing assets:

- `.copilot/knowledge.md` updates for stable facts and decisions.
- `.github/instructions/*.instructions.md` for automatic guardrails.
- `.github/skills/*/SKILL.md` for repeatable workflows.
- Optional focused docs only when the user explicitly asks for them or the repo
  already has the correct home for that domain.

## Phase 1: Inventory the repository

Start with structure, not assumptions:

```bash
find . -maxdepth 3 -type f | sort
git --no-pager status --short
```

Then identify domains by source and tests. For this repo, begin with:

- background/service-worker commands and broker state
- popup UI, state, message client, and timers
- content-main routing and content service registry
- content/core marking/highlighting behavior
- common contracts, text, config, utilities, and page-world bridges
- offscreen document responsibilities
- tests that encode architecture contracts
- existing knowledge/instructions/skills

Use parallel code-search/read passes. Do not read only production code; tests
often define the real contract.

## Phase 2: Extract facts by domain

For each domain, capture:

1. **Owner of truth**

   Which module owns state and which modules are renderers/bridges?

2. **Lifecycle**

   How does the flow start, update, finish, fail, and recover?

3. **Message/data contracts**

   What message types, payload fields, storage keys, and invariants must stay
   stable?

4. **Compatibility rules**

   What historical behavior must not regress?

5. **Failure modes**

   What timeouts, stale states, extension reloads, Chrome messaging limits, or
   page-world issues are already known?

6. **Validation**

   Which tests and live checks prove the behavior?

Keep each fact tied to source paths and tests. Mark assumptions separately.

## Phase 3: Build the question list

When logic or intent is unclear, ask the user before writing durable knowledge.
Questions must be deterministic and easy to answer.

Rules:

- Ask one question at a time.
- Prefer multiple-choice answers.
- Put the recommended answer first when there is one.
- Explain why the decision matters in one sentence.
- Do not ask broad questions like "What should I document?"

Example:

```text
For unresolved legacy spinner reasons, should future agents preserve the old
blocking default or force all spinners into the typed phase registry?

Choices:
1. Preserve the old blocking default until each flow is migrated (Recommended)
2. Treat unknown reasons as non-blocking and require every flow to register a phase
3. Block popup only, never the page, for unknown reasons
```

## Phase 4: Update durable knowledge

Write facts where future agents will actually find them:

- Put stable domain rules in `.copilot/knowledge.md`.
- Put always-on guardrails in `.github/instructions/*.instructions.md`.
- Put repeatable procedures in `.github/skills/{skill-name}/SKILL.md`.

Do not dump a giant transcript. Summarize decisions, invariants, pitfalls, and
validation commands.

## Phase 5: Validate the knowledge update

For documentation-only knowledge updates:

```bash
git --no-pager diff --check
```

For any code-adjacent contract change, also run the relevant focused tests or
full validation:

```bash
deno task check
deno task test
deno task build:release
```

Use `deno task build:dev` only when preparing the development extension bundle
for live browser validation.

## Knowledge quality checklist

Before finishing, verify that a future low-context agent can answer:

- What files must be read before touching this domain?
- What existing behavior is locked?
- What helper or module should be reused?
- What should never be introduced?
- Which tests prove the contract?
- What should be asked of the user instead of guessed?

If any answer is missing, update the knowledge or skill before stopping.
