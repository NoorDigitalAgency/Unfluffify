# Unfluffify Plan

## Checkpoint Status (2026-06-06)

- Engineering backlog items are complete and shipped to `main`.
- CR-1 and CR-2 cleanup follow-ups are complete.
- Test orchestration Phase 0, Phase 1, Phase 2, and Phase 3 code are implemented in
  `orchestration/`: secret-safe JSONC templates/setup docs, a dependency-free
  scenario-bus WebSocket server, protocol validation, mock client, transcript
  logging, runner config loading, runner bus client, deterministic browser step
  registry, artifact logging, JSONC config/secrets parsing, auth secret
  validation, UI-driven auth seeding, disabled-profile recovery, profile-target
  guards, stale-token clearing, and unit coverage.
- Phase 3 live validation is COMPLETE: local gitignored `config.jsonc` and
  `.secrets.jsonc` exist, xvfb/Chromium can launch the extension, account A
  seeded successfully into `orchestration/profiles/director`, and account B
  seeded successfully into `orchestration/profiles/follower`.
- Phase 4 is now unblocked for one-machine property-lock E2E with two seeded
  profiles. Phase 6 still requires two real hosts.
- Latest focused validation for the Phase 3 code slice:
  `node --test tests/orchestration-auth.test.js tests/orchestration-runner.test.js`
  passes (`20/20`, `# fail 0`). Full-suite validation passes (`591/591`,
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

## Remaining Items

- Build and run Phase 4 property-lock E2E on one machine with the seeded
  director/follower profiles.
- Validate remote support end-to-end with two real Chrome profiles (permission
  prompts, viewer transport, telemetry mirrors, and teardown behavior).
