# Handoff — Test Orchestration initiative (2026-06-06)

For the next agent (or human) picking up the two-host LLM test-orchestration
work. The full design is in `.copilot/test-orchestration-plan.md`; this is the
"where we are / what to do next" note.

## State
- **Planning complete. Phase 0 and Phase 1 are implemented.** All Q&A decisions
  and open items are resolved (see the plan's Decisions table + Open items).
- The plan and the first implementation slice are committed to `main`.
- Implemented files:
  - `orchestration/config.example.json`
  - `orchestration/secrets.example.json`
  - `orchestration/setup.md`
  - `orchestration/lib/protocol.mjs`
  - `orchestration/lib/websocket.mjs`
  - `orchestration/bus-server.mjs`
  - `orchestration/mock-client.mjs`
  - `tests/orchestration-bus.test.js`
- `.gitignore` protects `orchestration/.secrets.json`,
  `orchestration/config.json`, `orchestration/runs/`, and profile dirs.
- Validation: `node --test tests/orchestration-bus.test.js` passes (`4/4`).

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
- Auth: **automated**, from gitignored `orchestration/.secrets.json`.
- Backend: dedicated staging; **full flexibility like prod** (no concurrency cap).

## Inputs already provided by the user
- Config view values for `.secrets.json`: **Configuration Endpoint** (URL),
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

## Next step: Phase 2
Build the per-machine runner and deterministic step-script library:
- Config loader for gitignored `orchestration/config.json` plus optional CLI
  overrides.
- Browser launch helpers generalized from
  `scripts/smoke-property-lock-phase2.mjs`.
- Step modules for `launchBrowser`, `readState`, `openProperty`, popup debug
  URL loading, banner/state reads, and idempotent teardown.
- Runner that connects to `bus-server.mjs`, waits for `bus:hello`, executes
  typed `step` messages, returns `report` messages, and writes per-side
  artifacts under `orchestration/runs/<timestamp>/`.
Acceptance: on one machine, a runner can launch the unpacked extension, open a
property URL, read popup/banner/session state, and report it over the bus.

Then Phases 3→7 per the plan (auth seed → property-lock E2E on one machine →
RS handshake one machine → two-machine media → LLM roles).

## Watch-outs
- **Never commit** `orchestration/.secrets.json`, `config.json`, or any profile
  dir. Packager is reachability-based, so `orchestration/` stays out of the
  shipped zip — do not reference it from `manifest.json`.
- Same-host WebRTC won't connect → RS **media** asserts are two-machine-gated;
  property-lock validates fully on one machine.
- `--auto-select-desktop-capture-source` token is locale/case-dependent and
  fails silently — pin the real source-title substring per host at Phase 6
  (straight quotes only; the user's "Entire Screen" snippet won't match).
- Don't touch the locked marking contract (see `plan.md`).
