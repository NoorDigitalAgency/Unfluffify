# Handoff — Test Orchestration initiative (2026-06-06)

For the next agent (or human) picking up the two-host LLM test-orchestration
work. The full design is in `.copilot/test-orchestration-plan.md`; this is the
"where we are / what to do next" note.

## State
- **Planning complete. Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 code are
  implemented.** All Q&A decisions are resolved (see the plan's Decisions
  table). Phase 3 live auth validation is complete; Phase 4 is partially
  live-validated with one blocked sub-check.
- The plan and the first implementation slice are committed to `main`.
- Implemented files:
  - `orchestration/config.example.jsonc`
  - `orchestration/secrets.example.jsonc`
  - `orchestration/setup.md`
  - `orchestration/lib/protocol.mjs`
  - `orchestration/lib/websocket.mjs`
  - `orchestration/lib/config.mjs`
  - `orchestration/lib/artifacts.mjs`
  - `orchestration/lib/bus-client.mjs`
  - `orchestration/lib/jsonc.mjs`
  - `orchestration/lib/secrets.mjs`
  - `orchestration/bus-server.mjs`
  - `orchestration/mock-client.mjs`
  - `orchestration/runner.mjs`
  - `orchestration/setup-auth.mjs`
  - `orchestration/steps/browser.mjs`
  - `orchestration/scenarios/property-lock-one-machine.mjs`
  - `tests/orchestration-bus.test.js`
  - `tests/orchestration-runner.test.js`
  - `tests/orchestration-auth.test.js`
  - `tests/orchestration-property-lock-scenario.test.js`
- `.gitignore` protects `orchestration/.secrets.jsonc`,
  `orchestration/config.jsonc`, legacy `.json` variants,
  `orchestration/runs/`, and profile dirs.
- Focused validation:
  `node --test tests/orchestration-property-lock-scenario.test.js tests/orchestration-auth.test.js tests/orchestration-runner.test.js tests/orchestration-bus.test.js`
  passes (`28/28`, `# fail 0`).
- Full validation: `npm test` passes (`595/595`, `# fail 0`), and
  `node --check` passes for `orchestration/scenarios/property-lock-one-machine.mjs`
  and `tests/orchestration-property-lock-scenario.test.js`.
- Live Phase 3 auth seeding passed on 2026-06-06 with local gitignored
  `config.jsonc` / `.secrets.jsonc` and xvfb. Extension startup works after
  disabled-profile recovery and normal launch no longer forces
  `chrome.runtime.reload()`. Account A seeded successfully into
  `orchestration/profiles/director`; account B seeded successfully into
  `orchestration/profiles/follower`.
- The auth seeder now clears stale tokens before opening the popup and before
  submitting credentials, refuses obvious director/follower profile mismatches,
  accepts a popup that already opens in configuration view, and waits for edit
  controls on read-only configured fields.

## Decisions locked (don't re-litigate without the user)
- Two-machine-ready, **validate on one machine first**.
- Coordination via a **scenario-bus WebSocket server** (typed control channel +
  free-form debug channel). LAN bus = agent coordination only; product P2P stays
  cloud-routed (Cloudflare signaling/TURN).
- Driver: **deterministic Playwright step-scripts** for scenarios, **MCP for
  debugging only** (escalated/human-aware; never the follower's default surface).
- Cover **both** property-lock and remote-support from the start.
- **Director** = human-interactive side (account A); **Follower** = autonomous
  (account B), bound to the step protocol.
- Auth: **automated**, from gitignored `orchestration/.secrets.jsonc`.
- Backend: dedicated staging; **full flexibility like prod** (no concurrency cap).

## Inputs already provided by the user
- Config view values for `.secrets.jsonc`: **Configuration Endpoint** (URL),
  **AI Endpoint** (URL), **Stage Base** (host, e.g. `noorlynx.com`) + two
  account email/password pairs. Shape is in the plan.
- Test properties (pick any; candidate pages discovered at run time):
  `prowork.se`, `renewed.se`, `vitec-pyramid.com`, `bonliva.se`, `bonliva.no`.

## Reuse, don't reinvent
- `scripts/smoke-property-lock-phase2.mjs` — per-machine driver template
  (headed persistent profile + unpacked extension, `chrome.runtime.reload()`,
  `popup.html?debugTabId=…`, reads page banner + popup + `chrome.storage.session`).
- `.vscode/mcp.json` + `.vscode/browser-mcp.config.json` — MCP debug surface.
- Observability: `popup.html?debugTabId=`, `chrome.storage.session`
  (`tabState:*`, `deviceEmulation:*`), property-lock banner text, RS state.

## Next step: Phase 4
Create local `orchestration/config.jsonc` and `orchestration/.secrets.jsonc`
from the commented JSONC examples if they are not already present, then run
with a real display or xvfb. Use explicit profile dirs so the two sides cannot
collide:

`xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director`

and:

`xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role follower --side B --account B --profile-dir orchestration/profiles/follower`

Both profiles are currently seeded. Phase 4 now has a direct scenario:

`xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/scenarios/property-lock-one-machine.mjs --property-url https://www.bonliva.no/ --cross-property-url https://prowork.se/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower`

Latest live result:
`orchestration/runs/2026-06-06T21-28-48-445Z-property-lock-phase4` returned
`ok:false`, but passed `singleEditorLock`, `readOnlySecondProfile`, `takeover`,
`crossPropertyCountdown`, and `release`. `offCandidateCountdown` is BLOCKED:
the generated same-origin URL stayed in editor state with no off-candidate
deadline, and the popup exposed no candidate URLs to derive a known valid
candidate/non-candidate pair. Re-run this sub-check when staging has a known
same-base non-candidate URL for the chosen property.

Next step: Phase 5 remote-support handshake on one machine. Media-connected
assertions remain two-machine-gated and must be reported as skipped/blocked on
a single host, not faked.

## Watch-outs
- **Never commit** `orchestration/.secrets.jsonc`, `config.jsonc`, legacy
  `.json` variants, or any profile dir. Packager is reachability-based, so
  `orchestration/` stays out of the shipped zip — do not reference it from
  `manifest.json`.
- Always pass an explicit `--profile-dir` when seeding more than one side from
  one local config file. The seeder refuses obvious `director`/`follower`
  mismatches, but custom profile names still rely on operator discipline.
- Same-host WebRTC won't connect → RS **media** asserts are two-machine-gated;
  property-lock validates fully on one machine.
- `--auto-select-desktop-capture-source` token is locale/case-dependent and
  fails silently — pin the real source-title substring per host at Phase 6
  (straight quotes only; the user's "Entire Screen" snippet won't match).
- Don't touch the locked marking contract (see `plan.md`).
