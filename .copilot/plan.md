# Unfluffify Plan

## Checkpoint Status (2026-06-06)

- Engineering backlog items are complete and shipped to `main`.
- CR-1 and CR-2 cleanup follow-ups are complete.
- Test orchestration Phase 0, Phase 1, Phase 2, and Phase 3 code are implemented in
  `orchestration/`: secret-safe JSONC templates/setup docs, a dependency-free
  scenario-bus WebSocket server, protocol validation, mock client, transcript
  logging, runner config loading, runner bus client, deterministic browser step
  registry, artifact logging, JSONC config/secrets parsing, auth secret
  validation, UI-driven auth seeding, and unit coverage.
- Remaining non-code work is human-gated two-profile remote-support validation.
- Phase 3 live validation is BLOCKED until local gitignored staging credentials
  exist in `orchestration/.secrets.jsonc` and headed Chrome has a display;
  Phase 4+ depends on that auth seed, and Phase 6 requires two real hosts.
- Latest validation for the Phase 3 code slice: `npm test` passes (`582/582`,
  `# fail 0`).

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
