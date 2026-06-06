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
node orchestration/setup-auth.mjs --role director --side A --account A
node orchestration/setup-auth.mjs --role follower --side B --account B
```

The script launches the unpacked extension, opens the popup configuration view,
sets Configuration Endpoint, AI Endpoint, and Stage Base from
`.secrets.jsonc`, submits the selected account credentials, and verifies that
Chrome sync storage has a token. It never prints the token or password.

If `.secrets.jsonc` and legacy `.secrets.json` are both absent, the script exits
before launching a browser.

## Two-machine bring-up

1. Start `bus-server.mjs` on the director machine using a LAN-reachable host,
   for example `--host 0.0.0.0 --port 8765`.
2. Set the follower host's `busHost` to the director LAN IP.
3. Validate the bus with `mock-client.mjs` from both machines before running
   browser scenarios.

Remote-support media assertions remain two-machine-gated. Same-host WebRTC is
expected to validate only request/join/signaling up to the media connection.

## Capture source token

`captureSourceTitle` is matched by Chrome against the available screen-share
source title. It is locale and host dependent. Use straight quotes in JSONC. If
the token does not match, Chrome silently selects nothing and remote-support
media assertions will hang or fail.
