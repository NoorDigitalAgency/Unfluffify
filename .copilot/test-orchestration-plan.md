# Test Orchestration Plan — LLM-driven two-host remote-support & property-lock testing

Planning doc (no code yet). Goal: scaffold the repo on two LAN machines, run one
LLM agent per machine, let them coordinate over a LAN channel, and automate
end-to-end testing/debugging of the **remote-support** and **property-lock**
scenarios with a human in the loop on one side. Uses local Playwright.

## Decisions (from Q&A 2026-06-06)

| Topic | Decision |
|-------|----------|
| Topology | Build **two-machine-ready**; validate on **one machine first**. |
| Agent coordination | A small **scenario-bus WebSocket server** (fixed schema). |
| Browser driver | **Both** — deterministic Playwright step-scripts for the scenario, MCP for debugging. |
| First target | **Both** scenario families (property-lock + remote-support) from the start. |
| Accounts | **Configurable per scenario** (an account per side as config). |
| Auth seeding | **Automated login from a gitignored secrets file.** |
| Collab model | **Structured steps + a free-form debug channel.** |
| Backend | **Dedicated test property on a staging backend.** |

## Critical reality checks (from codebase research)

1. **Product P2P is cloud-routed, not LAN.** Remote support is WebRTC over
   Cloudflare signaling + TURN, fail-closed without server ICE
   (`remote-support-offscreen.js` throws on missing ICE; background returns
   "missing ICE configuration"). Both hosts need **internet + valid auth +
   reachable staging signaling/lock WS**. The LAN bus is for **agent
   coordination only**.
2. **The only product data crossing the bus is the `supportCode`.** Supportee
   `remoteSupportRequestCode` → backend returns `{sessionId, supportCode,
   iceServers, wsUrl}`; supporter joins by entering `supportCode`. Property lock
   needs even less — both browsers open the **same property URL**.
3. **Same-host WebRTC does not connect** (user triage; loopback/fake-device
   candidate pairing). Therefore:
   - Property-lock (WebSocket-based, no WebRTC) validates **fully on one
     machine** with two profiles.
   - Remote-support **handshake/signaling up to connect** validates on one
     machine, but **media-connected assertions** (screen-share visible,
     view-only mirror, DevTools network/console mirror, teardown of live media)
     are **two-machine-gated**.
4. **Headed mode is required** (WebRTC + extensions). The interactive side uses
   a real display; the other can use `xvfb-run` (as the existing smokes do).
5. **`--auto-select-desktop-capture-source` is finicky.** The value must use
   STRAIGHT quotes and match the capture source name (locale-dependent, e.g.
   "Entire screen"). The snippet in the request used smart quotes (“ ”) which
   will break the flag. Validate the exact accepted token on each host during
   bring-up.

## Existing assets to reuse

- `scripts/smoke-property-lock-phase2.mjs` — per-machine driver template
  (headed persistent profile + unpacked extension, `chrome.runtime.reload()`,
  `popup.html?debugTabId=…`, inspects page banner + popup + `chrome.storage.session`).
- `scripts/smoke-ai-submission.mjs` — launch/snapshot patterns.
- `.vscode/mcp.json` (`playwright-local`) + `.vscode/browser-mcp.config.json` —
  MCP debugging surface (persistent profile, no-sandbox, bundled chromium).
- Observability hooks: `popup.html?debugTabId=`, `chrome.storage.session`
  (`tabState:*`, `tabState:initial:*`, `deviceEmulation:*`), property-lock page
  banner text, RS terminate button / `getRemoteSupportState`.

## Architecture

```
            ┌─────────────── LAN ───────────────┐
  Machine A (Director, you interact)     Machine B (Follower, autonomous)
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │ LLM agent (Claude Code)   │         │ LLM agent (Claude Code)   │
  │  ├ runner.mjs (driver)    │         │  ├ runner.mjs (driver)    │
  │  ├ step-scripts/          │◀──bus──▶│  ├ step-scripts/          │
  │  ├ MCP (debug only)       │  ws://  │  ├ MCP (debug only)       │
  │  └ headed Chrome + ext    │         │  └ headed Chrome + ext    │
  └───────────────────────────┘         └───────────────────────────┘
         scenario-bus WS server (one host) ── control + debug channels
                       │
              product traffic ↓ (NOT the bus)
              Cloudflare signaling/TURN + staging lock WS
```

- **Scenario bus** (`orchestration/bus-server.mjs`): tiny Node `ws` server (or
  built-in WebSocket) on one host. Two logical channels over one connection:
  - **control** — fixed JSON schema (typed), validated and logged.
  - **debug** — free-form `note{text}` messages for failure diagnosis.
  Relays by role, transcripts everything to `orchestration/runs/<ts>/bus.log`.
- **Per-machine runner** (`orchestration/runner.mjs`): launches headed
  persistent-profile Chrome (smoke launch shape + the fake-media/auto-capture
  args), connects to the bus as `director` or `follower`, executes structured
  steps via the step-script library, and on failure opens MCP for the agent to
  poke around.
- **Step-script library** (`orchestration/steps/*.mjs`): deterministic,
  parameterized commands generalized from the smokes — `launchBrowser`,
  `ensureAuth`, `openProperty(url)`, `requestSupportCode()→code`,
  `joinSupport(code)`, `assertEditorLock`, `assertReadOnly`, `takeOver`,
  `assertCountdown(kind)`, `assertScreenShareVisible`, `assertViewOnly`,
  `assertDevtoolsMirror`, `readState()`, `release`, `teardown`. Pure-ish,
  return structured results, independently testable.
- **Scenario definitions** (`orchestration/scenarios/*.mjs`): declarative step
  sequences with the performing side + assertions + bus sync points (e.g.
  follower waits for `code` from director). Two families: `property-lock.*`,
  `remote-support.*`.
- **Auth seeding** (`orchestration/setup-auth.mjs`): reads
  `orchestration/.secrets.jsonc` (gitignored JSONC; legacy `.json` fallback)
  → drives Playwright to fill the
  extension **configuration view** (the 3 staging values) and then the
  **authentication view** (email + password) per account, into the persistent
  profile. Secrets file shape:
  ```jsonc
  {
    // Shared across both sides — same staging backend.
    "config": {
      "configurationEndpoint": "https://…",  // "Configuration Endpoint" (URL)
      "aiEndpoint": "https://…",             // "AI Endpoint" (URL)
      "stageBase": "noorlynx.com"            // "Stage Base" (host name)
    },
    // One account per side (cross-user take-over needs two).
    "accounts": {
      "A": { "email": "…", "password": "…" },
      "B": { "email": "…", "password": "…" }
    }
  }
  ```
  Director uses account A, follower account B (configurable per scenario; a
  single-account scenario can point both sides at the same account).
- **Config** (`orchestration/config.jsonc`, gitignored JSONC or templated;
  legacy `.json` fallback):
  `{ role, busHost, busPort, side, account, displayMode: "real"|"xvfb",
  chromePath, extensionPath, profileDir, stageBase, testPropertyUrl }`.

### Control message schema (initial)
`hello{role,side}` · `scenario_start{name,params}` · `request_code` ·
`code{value,sessionId,expiresAt}` · `step{id,action,params}` ·
`report{stepId,state}` · `assert{id,expr}` · `assert_result{id,pass,detail}` ·
`barrier{name}` (both sides sync) · `scenario_end{status}` · `error{detail}`.
Debug channel: `note{text}`.

### Collaboration model
- The bus carries **structured steps**; deterministic harnesses execute them.
  LLM agents own: setup, choosing/parameterizing scenarios, interpreting
  assertion results, and **failure diagnosis over the free-form debug channel**.
- **Director** = the side you sit at: starts scenarios, surfaces pass/fail +
  screenshots, drives the debug conversation. **Follower** = autonomous
  (Claude Code auto/loop) but only executes the constrained step protocol;
  free-form/MCP only escalated on failure.

## Safety & determinism
- Constrained control schema; bus validates message types and rejects unknown.
- Keep the follower's autonomous surface to the step protocol. MCP
  `browser_run_code_unsafe` is RCE-equivalent — use MCP only in an escalated,
  human-aware debug session, never as the default follower action surface.
- Every scenario runs an **idempotent teardown** (release lock, end session,
  detach debugger/emulation) even on failure.
- Each run produces a reproducible artifact: bus transcript + per-side
  screenshots + console/network dumps + the resolved scenario/params.
- **Never commit secrets or profiles.** Add to `.gitignore`:
  `orchestration/.secrets.jsonc`, `orchestration/config.jsonc`,
  legacy `.json` variants,
  `orchestration/runs/`, and any orchestration profile dirs. The extension
  packager is reachability-based (manifest-driven), so `orchestration/` is
  already excluded from the shipped zip — keep it that way (do not reference it
  from the manifest).

## Phased implementation

- **Phase 0 — scaffolding contract. COMPLETE 2026-06-06.** `orchestration/` dir, `config.jsonc` +
  `.secrets.jsonc` templates, `.gitignore` entries, a `setup.md` (clone, chromium
  install/path, secrets, run). Acceptance: both hosts can be brought to a known
  state from the README with no committed secrets.
- **Phase 1 — scenario bus. COMPLETE 2026-06-06.** WS server + schema + two channels + transcript
  logging. Acceptance: two mock clients (director/follower) exchange a full
  control sequence + a debug note; unknown types rejected; transcript written.
  Unit tests with in-process clients.
- **Phase 2 — runner + step-script library. COMPLETE 2026-06-06.** Generalize the smokes; launch with
  fake-media/auto-capture args; `readState` helpers; deterministic results.
  Acceptance: a runner launches the extension, opens the popup, reads
  banner/storage state, and reports over the bus on one machine.
- **Phase 3 — auth seeding. COMPLETE 2026-06-06.** `setup-auth.mjs` from
  `.secrets.jsonc`, configurable account per side. Acceptance: a fresh profile
  reaches authenticated state non-interactively for a given account. Current
  live status: account A seeds into `orchestration/profiles/director`; account B
  seeds into `orchestration/profiles/follower`.
- **Phase 4 — property-lock E2E on ONE machine. CODE COMPLETE / PARTIAL LIVE 2026-06-06.** Two profiles,
  configurable accounts. Assert: single-editor lock, read-only second tab,
  take-over, off-candidate (70s) + cross-property (30s) countdowns, release.
  Acceptance: scenario passes end-to-end on one host with a real staging
  test property. Current live status: run
  `orchestration/runs/2026-06-06T21-28-48-445Z-property-lock-phase4` passed
  single-editor lock, read-only second profile, take-over, cross-property
  countdown, and release. The off-candidate countdown sub-check remains
  BLOCKED because tested same-origin URLs stayed in editor state and exposed no
  popup candidate list / off-candidate deadline. Re-run with a known current
  Live Page candidate plus a known same-base non-candidate URL.
- **Phase 5 — remote-support handshake on one machine. CODE COMPLETE / LIVE BLOCKED 2026-06-06.** request_code → bus
  `code` → join → assert signaling/up-to-connect. Media-connected asserts marked
  `two-machine-gated` and skipped with a clear reason on a single host.
  Acceptance: handshake + signaling validated; media asserts reported as gated.
  Current live status: run
  `orchestration/runs/2026-06-06T22-08-05-959Z-remote-support-phase5` on
  `DISPLAY=:0` / GNOME Wayland remote desktop confirmed the director token and
  runtime request path, then failed with `Screen sharing was cancelled or
  unavailable` before a support code was issued. Tried `captureSourceTitle`
  values `Entire screen`, `Screen 1`, `Entire Screen`, and `Screen`; also tried
  `--enable-features=WebRTCPipeWireCapturer` and `--ozone-platform=wayland`.
  Re-run after verifying the host desktop-capture source/portal behavior.
- **Phase 6 — two-machine bring-up.** Point the follower at machine B over LAN.
  Validate RS media: screen-share visible, view-only, DevTools console/network
  mirror labels, camera/mic via fake media, teardown clears media/telemetry.
  Re-run property-lock cross-host (cross-user take-over). Resolve the
  `--auto-select-desktop-capture-source` token per host. Acceptance: the
  two-machine-gated asserts from Phase 5 now pass.
- **Phase 7 — LLM orchestration layer.** Director/follower agent roles +
  prompts; follower in auto/loop bound to the step protocol; failure → free-form
  debug channel; human interaction at the director (start scenario, review
  artifacts, drive debug). Acceptance: a human at the director kicks off a
  scenario and gets a pass/fail + artifacts with no manual action on the
  follower for the happy path.

## Implementation status (2026-06-06)

- Phase 0 is complete:
  `orchestration/config.example.jsonc`, `orchestration/secrets.example.jsonc`,
  `orchestration/setup.md`, JSONC loader support, and gitignore protection for
  local secrets, run artifacts, and profiles.
- Phase 1 is complete:
  `orchestration/bus-server.mjs`, `orchestration/mock-client.mjs`,
  `orchestration/lib/protocol.mjs`, `orchestration/lib/websocket.mjs`, and
  `tests/orchestration-bus.test.js`.
- The bus is dependency-free: it uses Node's HTTP upgrade path and a minimal
  server-side text-frame WebSocket implementation. Clients can use Node 22's
  built-in `WebSocket`.
- `hello` is registration-only and receives a typed
  `report{stepId:"bus:hello"}` ack. Runners should wait for that ack before
  sending scenario `step` traffic.
- Validation completed:
  `node --test tests/orchestration-bus.test.js` -> `4/4` pass.
- Phase 2 is complete:
  `orchestration/runner.mjs`, `orchestration/lib/config.mjs`,
  `orchestration/lib/bus-client.mjs`, `orchestration/lib/artifacts.mjs`,
  `orchestration/steps/browser.mjs`, and `tests/orchestration-runner.test.js`.
  The runner waits for `bus:hello`, executes typed `step` messages, returns
  structured `report` messages, and logs artifacts under
  `orchestration/runs/<timestamp>-<role>-<side>/`.
- Validation completed:
  `node --test tests/orchestration-bus.test.js tests/orchestration-runner.test.js`
  -> `7/7` pass.
- Phase 3 code is complete:
  `orchestration/lib/jsonc.mjs`, `orchestration/lib/secrets.mjs`,
  `orchestration/setup-auth.mjs`, and `tests/orchestration-auth.test.js`. The
  script validates gitignored JSONC secrets, opens the popup configuration view,
  fills Configuration Endpoint / AI Endpoint / Stage Base, submits the selected
  account credentials, and verifies token presence without printing secret
  values. The seeder also clears stale tokens before popup render/login,
  refuses obvious director/follower profile mismatches, recovers disabled
  unpacked-extension metadata in generated profiles, and accepts both fresh
  configuration view and configured read-only field states.
- Phase 3 live validation is complete. Local gitignored `.secrets.jsonc` and
  `config.jsonc` exist, and headed Chromium runs under xvfb. Account A seeded
  successfully with:
  `xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director`.
  Account B seeded successfully with:
  `xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role follower --side B --account B --profile-dir orchestration/profiles/follower`.
- Validation completed:
  `node --test tests/orchestration-bus.test.js tests/orchestration-runner.test.js tests/orchestration-auth.test.js`
  -> pass; latest focused auth/runner validation is `20/20`, `# fail 0`.
- Full validation completed:
  `npm test` -> `598/598` pass, `# fail 0`; focused orchestration validation
  `node --test tests/orchestration-remote-support-scenario.test.js tests/orchestration-property-lock-scenario.test.js tests/orchestration-auth.test.js tests/orchestration-runner.test.js tests/orchestration-bus.test.js`
  -> `31/31`, `# fail 0`; `node --check` passes for the Phase 4 and Phase 5
  scenario/test files.
- Phase 4 code is complete:
  `orchestration/scenarios/property-lock-one-machine.mjs` and
  `tests/orchestration-property-lock-scenario.test.js`. The scenario uses the
  seeded director/follower profiles, performs preflight lock release, validates
  single-editor/read-only/takeover/cross-property/release behavior, writes
  structured `summary.json`, and emits duplicate-editor diagnostics when live
  locking allows both distinct client IDs to edit the same site.
- Phase 4 live validation is partial. Latest run:
  `xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/scenarios/property-lock-one-machine.mjs --property-url https://www.bonliva.no/ --cross-property-url https://prowork.se/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower`
  -> `ok:false`, `singleEditorLock:true`, `readOnlySecondProfile:true`,
  `takeover:true`, `offCandidateCountdown:false`,
  `crossPropertyCountdown:true`, `release:true`.
- Phase 5 code is complete:
  `orchestration/scenarios/remote-support-one-machine.mjs` and
  `tests/orchestration-remote-support-scenario.test.js`. The scenario opens the
  seeded director profile on a property, invokes the remote-support
  request-code runtime contract with the stored token, opens the follower on
  the configured `/support` page, invokes the join runtime contract when a code
  exists, records requester/supporter state snapshots, and explicitly records
  same-host media assertions as gated/skipped.
- Phase 5 live validation is blocked by desktop capture on the current host.
  Latest real-display run:
  `node orchestration/scenarios/remote-support-one-machine.mjs --property-url https://www.bonliva.no/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower --capture-source-title "Screen" --chrome-arg "--enable-features=WebRTCPipeWireCapturer" --chrome-arg "--ozone-platform=wayland"`
  -> `ok:false`, `directorTokenAvailable:true`,
  `requestRuntimeAvailable:true`, error `Screen sharing was cancelled or
  unavailable`. The configured `Entire screen`, `Screen 1`, `Entire Screen`,
  and `Screen` tokens all failed the same way. System Chrome was tested but did
  not load the seeded unpacked extension service worker from the existing
  profile.
- Phase 6 still needs two real hosts for media-connected assertions.

## Open items to confirm before Phase 4+
- The 3 staging configuration values (Configuration Endpoint, AI Endpoint,
  Stage Base) + the two account credentials → go in `.secrets.jsonc` (above).
- Test properties (resolved 2026-06-06) — use any of these; candidate pages are
  discovered at run time per property: `https://prowork.se/`,
  `https://renewed.se/`, `https://www.vitec-pyramid.com/`,
  `https://www.bonliva.se/`, `https://www.bonliva.no/`. A scenario picks one
  property; both sides open the same one (lock) / share the support code (RS).
- Staging permits full flexibility (same as production) — no concurrency
  throttling concern. Resolved 2026-06-06.
- Exact `--auto-select-desktop-capture-source` token accepted on each host's
  Chrome (locale-dependent capture-source title) — resolved during Phase 6
  bring-up, see "capture-source token" note below.

### Note: the `--auto-select-desktop-capture-source` token
The flag makes automated Chrome auto-pick a screen for `getDisplayMedia()` /
`chrome.desktopCapture` **without showing the picker**. Its value is matched as
a substring against the *title* of an available capture source. The exact title
varies per host, so it cannot be hardcoded blindly:
- **Locale-dependent** — on a non-English Chrome the screen entry may be
  "Hele skjermen" (nb), "Gesamter Bildschirm" (de), etc., not "Entire screen".
- **Case/format-dependent** — the real label is usually "Entire screen"
  (lowercase s); the requested snippet's "Entire Screen" won't match. Multi-
  monitor hosts expose "Screen 1" / "Screen 2".
- **Failure mode is silent** — a non-matching token auto-selects nothing, so the
  follower's screen-share never starts and the RS media asserts hang.
Bring-up step: enumerate the offered source titles on each host and pin the
correct substring in that host's `config.jsonc` (straight quotes only).
