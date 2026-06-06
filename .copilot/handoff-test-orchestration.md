# Handoff — Test Orchestration initiative (2026-06-06)

For the next agent (or human) picking up the two-host LLM test-orchestration
work. The full design is in `.copilot/test-orchestration-plan.md`; this is the
"where we are / what to do next" note.

## State
- **Planning complete. Phase 0, Phase 1, Phase 2, and Phase 3 code are
  implemented.** All Q&A decisions are resolved (see the plan's Decisions
  table). Phase 3 live validation is partial and blocked on account A auth.
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
  - `tests/orchestration-bus.test.js`
  - `tests/orchestration-runner.test.js`
  - `tests/orchestration-auth.test.js`
- `.gitignore` protects `orchestration/.secrets.jsonc`,
  `orchestration/config.jsonc`, legacy `.json` variants,
  `orchestration/runs/`, and profile dirs.
- Focused validation:
  `node --test tests/orchestration-bus.test.js tests/orchestration-runner.test.js tests/orchestration-auth.test.js`
  passes for the committed Phase 0-3 test files; the latest focused auth/runner
  slice passes (`20/20`, `# fail 0`).
- Full validation: `npm test` passes (`591/591`, `# fail 0`), and
  `node --check` passes for `orchestration/setup-auth.mjs`,
  `orchestration/lib/jsonc.mjs`, `orchestration/lib/config.mjs`,
  `orchestration/lib/secrets.mjs`, `tests/orchestration-runner.test.js`, and
  `tests/orchestration-auth.test.js`.
- Live Phase 3 auth seeding was attempted on 2026-06-06 with local gitignored
  `config.jsonc` / `.secrets.jsonc` and xvfb. Extension startup works after
  disabled-profile recovery and normal launch no longer forces
  `chrome.runtime.reload()`. Account B seeded successfully into
  `orchestration/profiles/follower`; account A is BLOCKED by staging auth
  returning `Login failed (400)` before a token is saved.
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

## Next step: finish Phase 3 director auth, then Phase 4
Create local `orchestration/config.jsonc` and `orchestration/.secrets.jsonc`
from the commented JSONC examples if they are not already present, then run
with a real display or xvfb. Use explicit profile dirs so the two sides cannot
collide:

`xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director`

If account A still returns `Login failed (400)`, verify/replace the account A
email/password or staging permission in `.secrets.jsonc`; do not fake a token.
Account B has already succeeded, but can be reseeded with:

`xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role follower --side B --account B --profile-dir orchestration/profiles/follower`

Once both profiles are seeded, start Phase 4: property-lock E2E on one machine
with two profiles. Phase 4 should reuse the Phase 2 runner/browser steps and
add scenario definitions for single-editor lock, read-only second tab,
take-over, off-candidate countdown, cross-property countdown, and release.

Then Phases 5→7 per the plan (RS handshake one machine → two-machine media →
LLM roles).

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
