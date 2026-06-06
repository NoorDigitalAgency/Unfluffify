# Unfluffify Plan

## Checkpoint Status (2026-06-06)

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
- Phase 3 live validation is COMPLETE: local gitignored `config.jsonc` and
  `.secrets.jsonc` exist, xvfb/Chromium can launch the extension, account A
  seeded successfully into `orchestration/profiles/director`, and account B
  seeded successfully into `orchestration/profiles/follower`.
- Phase 4 is code-complete and partially live-validated with the two seeded
  profiles. Live run
  `orchestration/runs/2026-06-06T21-28-48-445Z-property-lock-phase4` passed
  single-editor lock, read-only second profile, takeover, cross-property
  countdown, and release. The off-candidate countdown sub-check remains BLOCKED:
  tested same-origin non-candidate URLs stayed in editor state with no popup
  candidate list / off-candidate deadline. Re-run after a staging property has a
  known current Live Page candidate plus a known same-base non-candidate URL.
- Phase 5 is code-complete and live-blocked by desktop capture. Latest real
  display run on `DISPLAY=:0` / GNOME Wayland remote desktop,
  `orchestration/runs/2026-06-06T22-08-05-959Z-remote-support-phase5`,
  confirmed the director profile has a stored token and can reach the runtime
  request path, then failed with `Screen sharing was cancelled or unavailable`
  before a support code was issued. Tried `captureSourceTitle` values
  `Entire screen`, `Screen 1`, `Entire Screen`, and `Screen`; also tried
  `--enable-features=WebRTCPipeWireCapturer` and `--ozone-platform=wayland`.
  System Chrome was tested but did not load the seeded unpacked extension
  service worker from the existing profile. Re-run after verifying the exact
  host capture-source path/portal behavior.
- Phase 6 still requires two real hosts.
- Latest focused validation for the orchestration slice:
  `node --test tests/orchestration-remote-support-scenario.test.js tests/orchestration-property-lock-scenario.test.js tests/orchestration-auth.test.js tests/orchestration-runner.test.js tests/orchestration-bus.test.js`
  passes (`31/31`, `# fail 0`). Full-suite validation passes (`598/598`,
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

- Re-run Phase 5 remote-support request/join validation after the host desktop
  capture path is verified; media-connected assertions remain two-machine-gated.
- Re-run the Phase 4 off-candidate countdown sub-check when a known same-base
  non-candidate URL is available for the staging property.
- Validate remote support end-to-end with two real Chrome profiles (permission
  prompts, viewer transport, telemetry mirrors, and teardown behavior).
