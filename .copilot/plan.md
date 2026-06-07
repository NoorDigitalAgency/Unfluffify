# Unfluffify Plan

## Checkpoint Status (2026-06-07)

- Engineering backlog items are complete and shipped to `main`.
- CR-1 and CR-2 cleanup follow-ups are complete.
- Test orchestration Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5 code are implemented in
  `orchestration/`: secret-safe JSONC templates/setup docs, a dependency-free
  scenario-bus WebSocket server, protocol validation, mock client, transcript
  logging, runner config loading, runner bus client, deterministic browser step
  registry, artifact logging, JSONC config/secrets parsing, auth secret
  validation, UI-driven auth seeding, disabled-profile recovery, profile-target
  guards, stale-token clearing, one-machine property-lock scenario coverage,
  one-machine remote-support handshake harnessing, and unit coverage.
- Repo-local validation was re-run before milestone execution:
  - `npm test` passes (`603/603`, `# fail 0`).
  - Focused orchestration suite
    `node --test tests/orchestration-remote-support-scenario.test.js tests/orchestration-property-lock-scenario.test.js tests/orchestration-auth.test.js tests/orchestration-runner.test.js tests/orchestration-bus.test.js`
    passes (`35/35`, `# fail 0`).
- Phase 4 (property-lock one-machine) was re-run:
  - Command:
    `xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/scenarios/property-lock-one-machine.mjs --property-url https://www.bonliva.no/ --cross-property-url https://prowork.se/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower`
  - Run dir:
    `orchestration/runs/2026-06-07T07-33-49-449Z-property-lock-phase4`
  - Result: blocked in environment bootstrap with
    `Could not resolve playwright; set playwrightModulePath or UNFLUFFIFY_PLAYWRIGHT_PATH`
    before off-candidate countdown assertions could run.
- Phase 5 (remote-support one-machine request/join) was re-run:
  - Command:
    `node orchestration/scenarios/remote-support-one-machine.mjs --property-url https://www.bonliva.no/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower --capture-source-title "Screen"`
  - Result: blocked immediately by missing local secrets file:
    `Missing orchestration secrets: .../orchestration/.secrets.jsonc or .../orchestration/.secrets.json`.
- Phase 6 (two-host workflow) prep was re-run for repo-local coordination:
  - Bus bring-up:
    `node orchestration/bus-server.mjs --host 127.0.0.1 --port 8765`
  - Local smoke clients both succeeded:
    `node orchestration/mock-client.mjs --role director --side A ...` and
    `node orchestration/mock-client.mjs --role follower --side B ...`
  - Transcript:
    `orchestration/runs/2026-06-07T07-34-00-300Z/bus.log`
  - Result: local bus messaging is healthy; full Phase 6 remains externally blocked
    because this environment has no second real host.

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

- Install or point to Playwright for orchestration scenarios
  (`playwrightModulePath` or `UNFLUFFIFY_PLAYWRIGHT_PATH`) and re-run Phase 4.
- Create local gitignored `orchestration/config.jsonc` and
  `orchestration/.secrets.jsonc`, then seed director/follower profiles with
  `orchestration/setup-auth.mjs`.
- Re-run the Phase 4 off-candidate countdown sub-check with a staging property
  that has both (a) a known current Live Page candidate and (b) a known
  same-base non-candidate URL.
- Re-run Phase 5 remote-support request/join validation after secrets/profile
  seeding and host-specific desktop capture source token verification.
- Run full Phase 6 on two real hosts (LAN-reachable bus host + remote follower
  host) to validate permission prompts, viewer transport, telemetry mirrors, and
  teardown behavior.
