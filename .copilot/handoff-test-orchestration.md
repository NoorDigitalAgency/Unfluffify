# Handoff — Test Orchestration initiative (2026-06-06)

For the next agent (or human) picking up the two-host LLM test-orchestration
work. The full design is in `.copilot/test-orchestration-plan.md`; this is the
"where we are / what to do next" note.

## State
- **Planning complete. Phase 0, Phase 1, Phase 2, and Phase 3 code are
  implemented.** All Q&A decisions and open items are resolved (see the plan's
  Decisions table + Open items).
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
- Validation:
  `node --test tests/orchestration-bus.test.js tests/orchestration-runner.test.js tests/orchestration-auth.test.js`
  passes (`15/15`).
- Full validation: `npm test` passes (`582/582`, `# fail 0`), and
  `node --check` passes for `orchestration/setup-auth.mjs`,
  `orchestration/lib/jsonc.mjs`, `orchestration/lib/config.mjs`,
  `orchestration/lib/secrets.mjs`, `tests/orchestration-runner.test.js`, and
  `tests/orchestration-auth.test.js`.
- Live Phase 3 auth seeding remains human/display-gated: the script needs
  gitignored `.secrets.jsonc` credentials and headed Chrome needs a real
  display or xvfb. The missing-secret boundary was validated with an explicit
  nonexistent `--secrets` path before browser launch.

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

## Next step: Phase 3 live validation, then Phase 4
Create local `orchestration/config.jsonc` and `orchestration/.secrets.jsonc`
from the commented JSONC examples, then run with a real display or xvfb:

`node orchestration/setup-auth.mjs --role director --side A --account A`

and repeat for the follower account/profile. Once both profiles are seeded,
start Phase 4: property-lock E2E on one machine with two profiles. Phase 4
should reuse the Phase 2 runner/browser steps and add scenario definitions for
single-editor lock, read-only second tab, take-over, off-candidate countdown,
cross-property countdown, and release.

Then Phases 5→7 per the plan (RS handshake one machine → two-machine media →
LLM roles).

## Watch-outs
- **Never commit** `orchestration/.secrets.jsonc`, `config.jsonc`, legacy
  `.json` variants, or any profile dir. Packager is reachability-based, so
  `orchestration/` stays out of the shipped zip — do not reference it from
  `manifest.json`.
- Same-host WebRTC won't connect → RS **media** asserts are two-machine-gated;
  property-lock validates fully on one machine.
- `--auto-select-desktop-capture-source` token is locale/case-dependent and
  fails silently — pin the real source-title substring per host at Phase 6
  (straight quotes only; the user's "Entire Screen" snippet won't match).
- Don't touch the locked marking contract (see `plan.md`).
