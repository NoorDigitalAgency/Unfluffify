# Unfluffify Plan

## Checkpoint Status (2026-06-06)

- Engineering backlog items are complete and shipped to `main`.
- CR-1 and CR-2 cleanup follow-ups are complete.
- Remaining non-code work is human-gated two-profile remote-support validation.

## Marking Contract Lock

Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-rules contract change.

052c-derived marking restoration completed and is treated as a locked contract.

AI-submission behavior must continue to submit every stored excluded XPath row as excluded, with existing immutable/default handling rules preserved.

## Current Working Guidance

- Keep `.copilot/knowledge.md` as the durable technical decision log.
- Use this file as the current checkpoint summary only; avoid adding historical
  run-by-run handoff logs.
- Prefer targeted follow-up notes in code comments/tests over long standalone
  migration diaries.

## Remaining Item (Human-Gated)

- Validate remote support end-to-end with two real Chrome profiles (permission
  prompts, viewer transport, telemetry mirrors, and teardown behavior).
