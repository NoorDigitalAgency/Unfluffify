---
name: safe-change
description: Modify, fix, or add repository code while strictly following the knowledge base, plan, instructions, and regression guardrails.
---

# Safe Repository Code Change

Use this skill before implementing any non-trivial code change in this
repository, especially when the agent has limited context or the change touches
popup/background/content messaging, marking/highlighting, AI submission,
storage, render-mode inspection, property lock, or spinner/page-blocking flows.

## Mandatory reading order

1. Read `.copilot/knowledge.md`.
2. Read all relevant `.github/instructions/*.instructions.md`.
3. Read the active session `plan.md`, if present.
4. Read any relevant `.github/skills/*/SKILL.md`.
5. Refresh the repo graph with `codebase-memory-mcp-index_repository` if the
   current `HEAD` has not been indexed in this session.
6. Read the exact source files and tests for the target behavior using
   `codebase-memory-mcp-search_graph`,
   `codebase-memory-mcp-search_code`,
   `codebase-memory-mcp-get_code_snippet`, and
   `codebase-memory-mcp-trace_path` before falling back to `rg` / manual file
   browsing.

Do not start editing from memory or from a vague issue summary.

## Worktree safety

Before editing:

```bash
git --no-pager status --short
```

- Do not revert or overwrite changes you did not make.
- If unrelated files are dirty, ignore them.
- If a file you need is already modified, read it carefully and preserve both
  the user's changes and your intended change.
- Never use destructive commands such as `git reset --hard` or `git checkout --`
  unless the user explicitly requested them.

## Implementation discipline

1. Trace the existing behavior before changing it.

   Find the entry point, state owner, message path, persistence path, UI render
   path, and tests. If you cannot name those, you do not understand enough yet.

2. Reuse existing helpers and contracts.

   Search before adding new helpers, using the repo graph first:

   - `codebase-memory-mcp-search_graph` / `search_code`
   - `codebase-memory-mcp-get_code_snippet(..., include_neighbors: true)`
   - `codebase-memory-mcp-trace_path(..., mode: "calls")`
   - then `rg "existingConcept|helperName|messageType"` only if exact text search
     is still needed

3. Make the smallest complete change.

   A complete change updates every required surface, but does not rewrite
   unrelated architecture.

4. Keep behavior-safe defaults.

   If a new typed contract is added, legacy or unresolved states must preserve
   old safe behavior unless the user explicitly approved a breaking change.

5. Do not swallow failures.

   Avoid broad catch blocks and success-shaped fallbacks. Surface errors through
   existing repository patterns.

6. Add regression coverage for every bug you fix.

   If the change closes a review finding, add a focused test that would fail
   before the fix.

7. Validate exactly what changed.

   Start with focused tests, then run broader validation before finishing.

## Repository hot zones

Treat these areas as compatibility contracts:

- **Marking and highlighting:** Do not change taxonomy, target resolution,
  default-exclusion behavior, overlay projection, sync semantics, or
  silent-highlighting behavior unless the user explicitly requests a marking
  contract change. Read `.copilot/knowledge.md` and
  `MARKING_AND_HIGHLIGHTING_LOGIC.md` first.
- **AI submission:** Preserve payload semantics around explicit includes,
  exclusions, immutable defaults, saved submission XPath rows, raw/rendered HTML
  handling, and large-message avoidance.
- **Spinner/page blocking:** Service worker owns global operation leases; popup
  renders broker state; content/main-world owns page-local apply/release and TTL
  fail-open. Do not infer active blocking from queue tail or message text when
  lease metadata exists.
- **Storage:** Use approved storage/domain modules. Do not add scattered
  `chrome.storage` or `utils.storage*` access outside allowed boundaries.
- **Browser live validation:** Follow the `live-browser` skill — run
  `pnpm browser:live <target-url>` (the committed launcher) to build and load
  `.output/chrome-mv3`, write the per-environment `.temp/browser-mcp.config.json`,
  and launch only the exactly-pinned `npm:@playwright/mcp` package's managed
   Chromium bound to `.wxt/browser-profile`. A target page URL is mandatory; never
  touch the OS Chrome. Reload the unpacked extension/service worker after
  rebuilding.

## Validation defaults

For code changes, use the current pnpm workflow:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```

Use `pnpm build` when preparing `.output/chrome-mv3` for live browser
validation.

Run focused tests first when iterating, then the broader validation before
claiming completion.

Documentation-only changes do not require full code validation, but still run:

```bash
git --no-pager diff --check
```

## Review-before-finish checklist

Before final response or commit:

- Does this satisfy the exact user request, not a nearby proxy?
- Did you update every relevant surface?
- Did you preserve legacy behavior where the new contract does not apply?
- Did you add regression coverage for new behavior or fixed bugs?
- Did validation match the risk of the change?
- Is the worktree free of accidental generated files or secrets?
