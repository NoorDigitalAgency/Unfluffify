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
- Phase 3 live validation is PARTIAL: local gitignored `config.jsonc` and
  `.secrets.jsonc` exist, xvfb/Chromium can launch the extension, and account B
  seeded successfully into `orchestration/profiles/follower`.
- Phase 3 remains BLOCKED for the director side: account A login reaches the
  staging auth service but returns `Login failed (400)` before a token is saved.
  Phase 4+ depends on a valid director profile; Phase 6 still requires two real
  hosts.
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

## Remaining Items (Human-Gated)

- Fix or replace account A in `orchestration/.secrets.jsonc`, then rerun:
  `xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director`.
- Validate remote support end-to-end with two real Chrome profiles (permission
  prompts, viewer transport, telemetry mirrors, and teardown behavior).
