# Two-host orchestration setup

This folder is repo-local test infrastructure for coordinated property-lock and
remote-support validation. It is not referenced by `manifest.json` and must not
ship in the extension package.

## Files

- `config.example.jsonc` - copy to `orchestration/config.jsonc` on each host.
- `secrets.example.jsonc` - copy to `orchestration/.secrets.jsonc` and fill with
  staging values and the two test accounts.
- `bus-server.mjs` - LAN coordination server for director/follower agents.
- `mock-client.mjs` - small smoke client for checking bus connectivity.
- `runs/` - generated bus transcripts and future scenario artifacts.
- `profiles/` - generated persistent Chrome profiles.

`config.jsonc`, `.secrets.jsonc`, legacy `.json` variants, `runs/`, and profile folders are gitignored.
Never commit real endpoints, passwords, run dumps, screenshots, or profiles.

## Initial one-machine bring-up

1. From the repo root, copy the templates:

   ```bash
   cp orchestration/config.example.jsonc orchestration/config.jsonc
   cp orchestration/secrets.example.jsonc orchestration/.secrets.jsonc
   ```

2. Edit `orchestration/.secrets.jsonc` with:

   - Configuration Endpoint
   - AI Endpoint
   - Stage Base
   - account A email/password
   - account B email/password

3. Edit `orchestration/config.jsonc` for the local side:

   - `role`: `director` for the human-interactive side, `follower` for the
     autonomous side.
   - `side`: `A` or `B`.
   - `account`: `A` or `B`.
   - `chromePath`: leave empty to use Playwright's bundled Chromium, or set an
     absolute Chrome path.
   - `playwrightModulePath`: optional absolute path to `playwright/index.mjs`
     if Playwright is not installed in this repo.
   - `profileDir`: unique per side, for example
     `orchestration/profiles/director`.
   - `testPropertyUrl`: one staging-backed property from the handoff list.

4. Start the bus:

   ```bash
   node orchestration/bus-server.mjs --host 127.0.0.1 --port 8765
   ```

5. In two other terminals, smoke the bus:

   ```bash
   node orchestration/mock-client.mjs --role director --side A --note "director online"
   node orchestration/mock-client.mjs --role follower --side B --note "follower online"
   ```

6. Confirm a transcript appeared in `orchestration/runs/<timestamp>/bus.log`.

## Runner smoke

After the bus is running, start a follower runner:

```bash
node orchestration/runner.mjs --role follower --side B --bus-host 127.0.0.1 --bus-port 8765
```

The runner waits for typed `step` messages. For Phase 2 it supports:

- `launchBrowser`
- `openProperty`
- `openPopup`
- `readState`
- `teardown`

The default browser steps require Playwright. If Playwright is not installed in
this repo, set either `playwrightModulePath` in `config.jsonc` or
`UNFLUFFIFY_PLAYWRIGHT_PATH` to a `playwright/index.mjs` file.

Each runner writes `runner.log` and `state-latest.json` under
`orchestration/runs/<timestamp>-<role>-<side>/`.

## Auth seeding

After filling `orchestration/config.jsonc` and `orchestration/.secrets.jsonc`,
seed a persistent profile for a side/account:

```bash
node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director
node orchestration/setup-auth.mjs --role follower --side B --account B --profile-dir orchestration/profiles/follower
```

The script launches the unpacked extension, opens the popup configuration view,
sets Configuration Endpoint, AI Endpoint, and Stage Base from
`.secrets.jsonc`, submits the selected account credentials, and verifies that
Chrome sync storage has a token. It never prints the token or password.

Use a different `--profile-dir` for each side/account. The script refuses
obvious director/follower profile mismatches and clears stale tokens before
login so a previous account cannot make a failed login look seeded.

If `.secrets.jsonc` and legacy `.secrets.json` are both absent, the script exits
before launching a browser.

If headed Chrome is not running on a real display, wrap the command with xvfb:

```bash
xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/setup-auth.mjs --role director --side A --account A --profile-dir orchestration/profiles/director
```

`Authentication failed before token was saved ... Login failed (400)` means the
staging auth service rejected that account/request. Verify the account's
email/password and staging permission in `orchestration/.secrets.jsonc`, then
rerun the same command; do not fake a token in profile storage.

## Property-lock one-machine scenario

After seeding the director and follower profiles, run the Phase 4 property-lock
scenario with explicit profile dirs:

```bash
xvfb-run -a -s "-screen 0 1280x1024x24" node orchestration/scenarios/property-lock-one-machine.mjs --property-url https://www.bonliva.no/ --cross-property-url https://prowork.se/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower
```

The scenario writes `summary.json` and `scenario.log` under
`orchestration/runs/<timestamp>-property-lock-phase4/`. It performs preflight
lock release for both profiles, then checks single-editor lock, read-only
second profile, take-over, off-candidate countdown, cross-property countdown,
and release.

Current live status as of 2026-06-06: the scenario code is in place and the
latest run passed single-editor/read-only/takeover/cross-property/release, but
the off-candidate countdown sub-check is blocked until a chosen staging property
has both a known current Live Page candidate and a known same-base
non-candidate URL. Do not mark that sub-check green from an arbitrary generated
same-origin URL; those can remain in editor state without an off-candidate
deadline.

## Remote-support one-machine handshake

After seeding both profiles, run the Phase 5 remote-support handshake harness:

```bash
node orchestration/scenarios/remote-support-one-machine.mjs --property-url https://www.bonliva.no/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower --capture-source-title "Screen"
```

The scenario opens the director profile on the property, calls the extension's
remote-support request-code runtime contract with the stored token, opens the
follower profile on the configured `/support` page, joins with the generated
code when available, writes state snapshots, and marks same-host media assertions
as gated/skipped.

Current live status as of 2026-06-06: the harness reaches the runtime request
path with a seeded token, but the current real display (`DISPLAY=:0`, GNOME
Wayland remote desktop) returns `Screen sharing was cancelled or unavailable`
before a support code is issued. The `captureSourceTitle` values
`Entire screen`, `Screen 1`, `Entire Screen`, and `Screen` all failed. The
Wayland/PipeWire flags below also failed in the same capture step. Re-run after
verifying the exact host desktop-capture source/portal behavior.

For host-specific capture experiments, pass extra Chrome flags with repeated
`--chrome-arg` values:

```bash
node orchestration/scenarios/remote-support-one-machine.mjs --property-url https://www.bonliva.no/ --director-profile-dir orchestration/profiles/director --follower-profile-dir orchestration/profiles/follower --capture-source-title "Screen" --chrome-arg "--enable-features=WebRTCPipeWireCapturer" --chrome-arg "--ozone-platform=wayland"
```

## Two-machine bring-up

1. Start `bus-server.mjs` on the director machine using a LAN-reachable host,
   for example `--host 0.0.0.0 --port 8765`.
2. Set the follower host's `busHost` to the director LAN IP.
3. Validate the bus with `mock-client.mjs` from both machines before running
   browser scenarios.

Remote-support media assertions remain two-machine-gated. Same-host WebRTC is
expected to validate only request/join/signaling up to the media connection.

## SSH RPC transition decisions

The active migration plan in
`/tmp/workspace/NoorDigitalAgency/Unfluffify/orchestration/ssh-rpc-plan.md`
is now pinned to these defaults:

- Unix-like remote hosts first.
- Dedicated SSH key under `orchestration/.ssh/`.
- Setup installs missing remote dependencies.
- Remote checkout sync supports both `git pull --ff-only` and `rsync`.
- Account A/B secrets may be copied to remote ignored secrets files.
- Desktop validation supports baseline + real desktop + Xvfb + Wayland.
- Fake deterministic capture is valid for most runs, with one optional
  real-desktop smoke check.

## Capture source token

`captureSourceTitle` is matched by Chrome against the available screen-share
source title. It is locale and host dependent. Use straight quotes in JSONC. If
the token does not match, Chrome silently selects nothing and remote-support
media assertions will hang or fail.
