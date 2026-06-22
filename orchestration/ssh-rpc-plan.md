# SSH Playwright RPC orchestration plan

This plan replaces the follower-agent workflow for two-machine testing with a
director-owned SSH bootstrap and a long-lived Playwright RPC worker on the
remote machine. It is only test/debug orchestration.

## Goals

- One human starts debugging from the director machine.
- The director setup script gathers SSH, repo, endpoint, profile, and account
  details, stores them in gitignored local files, and verifies that both
  machines are ready.
- If SSH key auth is unavailable, the setup script can prompt once for a
  password, generate a repo-local key if needed, copy the public key to the
  remote host, then continue with key auth.
- The director launches and owns a remote Playwright RPC server over SSH.
- The remote RPC server controls the follower browser directly and immediately;
  no second LLM/agent prompt cycle is involved.
- Both director and follower Chrome instances launch with deterministic media,
  permission, capture, and extension flags so tests do not require human
  selection for screen, camera, microphone, or audio permission prompts.
- Runs collect enough state, screenshots, traces, browser logs, extension logs,
  network records, and command transcripts to debug failures from the director
  side.

## Non-goals

- Do not expose the remote RPC server on a LAN interface by default.
- Do not store passwords, tokens, or private keys in tracked files.
- Do not require the remote machine to run Codex or another LLM session.

## Decisions (2026-06-07)

1. First implementation supports Unix-like remote hosts.
2. Generated SSH key lives under `orchestration/.ssh/`.
3. Setup installs missing remote dependencies instead of only reporting them.
4. Remote checkout supports both `git pull --ff-only` and `rsync` from the
   director checkout.
5. Account A/B secrets may be copied to the remote checkout.
6. Desktop support baseline includes real desktop, Xvfb, and Wayland paths.
7. Fake deterministic capture is acceptable for most tests, with one optional
   real-desktop smoke test.

## Local files

Add these gitignored files as the stable storage targets:

- `orchestration/ssh-rpc.local.jsonc`: machine topology and non-secret paths.
- `orchestration/ssh-rpc.secrets.jsonc`: account credentials and optional
  SSH password bootstrap metadata.
- `orchestration/config.jsonc`: existing per-side browser defaults.
- `orchestration/.secrets.jsonc`: existing endpoint and account source, if the
  implementation chooses to keep using it.

Planned `ssh-rpc.local.jsonc` shape:

```jsonc
{
  "remote": {
    "host": "192.168.86.37",
    "username": "rojan",
    "port": 22,
    "identityFile": "orchestration/.ssh/unfluffify_two_host_ed25519",
    "repoPath": "/home/rojan/Documents/Git/GitHub/Unfluffify",
    "nodePath": "node",
    "playwrightModulePath": "/home/rojan/Desktop/test/node_modules/playwright/index.mjs",
    "chromePath": "",
    "profileDir": "orchestration/profiles/follower",
    "displayMode": "real",
    "syncPolicy": "pull", // or "rsync"
    "rpcPort": 9876
  },
  "director": {
    "profileDir": "orchestration/profiles/director",
    "playwrightModulePath": "",
    "chromePath": ""
  },
  "extension": {
    "configurationEndpoint": "https://example.invalid",
    "aiEndpoint": "https://example.invalid",
    "stageBase": "a.example.invalid",
    "testPropertyUrl": "https://www.example.invalid/",
    "supportPageUrl": ""
  },
  "browser": {
    "captureSourceTitle": "Entire screen",
    "viewport": { "width": 1280, "height": 1024 },
    "useFakeMedia": true,
    "autoGrantPermissions": true
  }
}
```

Planned `ssh-rpc.secrets.jsonc` shape:

```jsonc
{
  "copyToRemoteCheckout": true,
  "accounts": {
    "A": { "email": "", "password": "" },
    "B": { "email": "", "password": "" }
  }
}
```

Do not persist the SSH password after bootstrap. If a password prompt is needed,
use it only to run `ssh-copy-id` or append the generated public key to
`~/.ssh/authorized_keys` on the remote host.

## Setup script flow

Create `orchestration/setup-ssh-rpc.mjs`.

1. Prompt for remote host, username, SSH port, optional identity file path.
2. Try `ssh -o BatchMode=yes` with the selected key/default agent.
3. If key auth fails:
   - Ask whether to generate a dedicated Ed25519 key under
     `orchestration/.ssh/`.
   - Prompt for the remote SSH password without echo.
   - Copy the public key using `ssh-copy-id` when available, otherwise use an
     SSH command that creates `~/.ssh`, fixes permissions, and appends the
     public key.
   - Retry `ssh -o BatchMode=yes`.
4. Prompt for the remote repo path and verify/install:
   - `test -d <repo>/.git`
   - `node --version`
   - Playwright import via the configured `UNFLUFFIFY_PLAYWRIGHT_PATH`
   - extension files exist, including `manifest.json`
   - install missing dependencies (`xvfb-run`, `rsync`, `sshpass`, browser
     binaries) when absent
5. Prompt for extension configuration:
   - Configuration Endpoint
   - AI Endpoint
   - Stage Base
   - default property URL
   - optional support page URL override
6. Prompt for account A and B credentials. Store in ignored local secrets and
   optionally copy to the ignored remote checkout secrets file.
7. Prompt for browser mode and capture target:
   - default to `fake-media` for deterministic CI/debugging.
   - support `real-media`, `xvfb`, and Wayland/PipeWire runs.
   - mark one optional real-desktop smoke test per run set.
8. Write local config/secrets atomically with file mode `0600`.
9. Run local and remote preflight checks.
10. Offer to seed director and follower profiles.
11. Offer to start the remote RPC server and run a smoke command.

The setup script should print exact commands it runs, but redact passwords,
tokens, and bearer credentials.

## Remote process model

Create `orchestration/rpc-server.mjs`.

- Runs on the remote machine from the remote repo checkout.
- Listens on `127.0.0.1:<rpcPort>` only.
- The director reaches it through SSH local port forwarding:

  ```bash
  ssh -N -L 9876:127.0.0.1:9876 user@host
  ```

- The director should be able to start it with one SSH command:

  ```bash
  cd <repo> &&
  UNFLUFFIFY_PLAYWRIGHT_PATH=<path> \
  deno task orchestrate:rpc-server -- --host 127.0.0.1 --port 9876
  ```

- The server owns one or more named browser contexts and rejects attempts to
  reuse a profile already locked by another Chrome process.
- It writes a command transcript and artifacts under
  `orchestration/runs/<timestamp>-rpc-follower-B/`.
- It supports graceful shutdown and emergency browser cleanup.

Create `orchestration/rpc-client.mjs` for the director-side library and optional
CLI smoke commands.

## Transport protocol

Use WebSocket JSON-RPC 2.0 over the SSH tunnel. JSON-RPC gives request ids,
responses, notifications, and error shape without inventing new framing.

Request envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "cmd_0001",
  "method": "browser.launch",
  "params": {}
}
```

Success:

```json
{
  "jsonrpc": "2.0",
  "id": "cmd_0001",
  "result": { "ok": true }
}
```

Failure:

```json
{
  "jsonrpc": "2.0",
  "id": "cmd_0001",
  "error": {
    "code": -32000,
    "message": "Popup did not become ready",
    "data": {
      "category": "timeout",
      "artifactPath": "orchestration/runs/.../failure.png"
    }
  }
}
```

Notification:

```json
{
  "jsonrpc": "2.0",
  "method": "event.console",
  "params": {
    "contextId": "follower",
    "pageId": "property",
    "level": "error",
    "text": "..."
  }
}
```

Each command should accept `timeoutMs` and `traceId`. Every response should
include `durationMs` and relevant artifact paths when generated.

## RPC method surface

### System

- `system.ping`: return process id, hostname, platform, cwd, git commit, Node
  version, Playwright resolution, display variables, and server uptime.
- `system.preflight`: verify repo, extension path, Node, Playwright import,
  browser executable, display mode, writable run dir, and profile lock status.
- `system.env`: return a redacted view of selected environment variables.
- `system.exec`: run allowlisted diagnostic commands, disabled by default unless
  started with `--allow-exec`.
- `system.shutdown`: close browsers, flush artifacts, and stop the RPC server.

### Browser lifecycle

- `browser.launch`: launch persistent Chromium with extension loaded.
- `browser.close`: close a named browser context.
- `browser.resetProfile`: delete or archive a named profile after the browser is
  closed.
- `browser.contexts`: list active contexts, pages, workers, extension ids, and
  profile dirs.
- `browser.grantPermissions`: grant camera, microphone, clipboard, geolocation,
  and notification permissions for configured origins.
- `browser.setViewport`: set default viewport or page-specific viewport.
- `browser.startTracing`: start Playwright trace, HAR, console, and screenshot
  collection.
- `browser.stopTracing`: stop tracing and return artifact paths.

### Page control

- `page.new`: create a page in a context.
- `page.goto`: navigate with `waitUntil`, timeout, and expected URL matching.
- `page.reload`: reload and wait.
- `page.close`: close a page.
- `page.bringToFront`: focus a page.
- `page.waitForSelector`: wait for DOM readiness.
- `page.click`: click a selector or coordinates.
- `page.fill`: fill a selector.
- `page.press`: send a key.
- `page.evaluate`: evaluate a function body with JSON params. Require an
  explicit `unsafe: true` flag in the caller to make this visible in logs.
- `page.screenshot`: capture full page or viewport.
- `page.videoFrame`: capture a screenshot from a video element if possible.
- `page.contentSnapshot`: return URL, title, selected DOM text, active element,
  visibility state, and focused frame info.

### Extension control

- `extension.resolve`: wait for the extension service worker and extension id.
- `extension.reload`: reload the unpacked extension and reacquire the worker.
- `extension.openPopup`: open `popup.html?debugTabId=<tabId>`.
- `extension.sendMessage`: call `chrome.runtime.sendMessage` through the worker
  or popup.
- `extension.storage.get`: read `chrome.storage.sync`, `local`, and `session`
  keys with redaction support.
- `extension.storage.set`: set configuration keys during setup.
- `extension.worker.evaluate`: evaluate diagnostic code in the service worker.
- `extension.collectLogs`: return recent background, popup, content, console,
  and network telemetry captured by the harness.

### Auth and configuration

- `auth.seedProfile`: configure endpoints and log in a selected account.
- `auth.verifyToken`: assert the selected profile has a stored token.
- `auth.clearToken`: clear stale token and account state.
- `config.applyExtensionSettings`: set Configuration Endpoint, AI Endpoint, and
  Stage Base through the extension UI or storage contract.
- `config.readExtensionSettings`: return redacted current extension settings.

### Property lock test helpers

- `property.open`: open a property URL and activate content.
- `property.readLockState`: return page banner, popup lock state, background tab
  state, and selected candidate state.
- `property.takeLock`: request or take over the lock.
- `property.releaseLock`: release the lock.
- `property.waitForLockState`: wait for owner/read-only/takeover/countdown
  predicates.

### Debug artifact collection

- `debug.snapshotAll`: collect screenshots, DOM summaries, extension state,
  browser logs, current URLs, WebRTC state, storage snapshots, and process info.
- `debug.tailRunLog`: stream recent server transcript lines.
- `debug.downloadArtifact`: fetch a named artifact over the RPC connection.
- `debug.mark`: write a named marker into the run transcript.

## Browser launch policy

Both director and remote browser launch should use a shared helper that builds
Chrome flags. Baseline flags:

```text
--no-sandbox
--disable-dev-shm-usage
--disable-extensions-except=<extensionPath>
--load-extension=<extensionPath>
--use-fake-ui-for-media-stream
--use-fake-device-for-media-stream
--auto-accept-camera-and-microphone-capture
--allow-http-screen-capture
--disable-features=MediaRouter
--enable-features=WebRTCPipeWireCapturer
--unsafely-treat-insecure-origin-as-secure=<configured origins>
```

When `captureSourceTitle` is configured:

```text
--auto-select-desktop-capture-source=<captureSourceTitle>
```

For deterministic non-human media tests, prefer fake media:

```text
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream
--use-file-for-fake-video-capture=<optional y4m fixture>
--use-file-for-fake-audio-capture=<optional wav fixture>
```

For real screen-share validation, run on a real desktop when possible. Xvfb can
validate automation and extension behavior, but it may not represent the actual
Wayland/PipeWire portal path. The setup script should record `DISPLAY`,
`WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, `PIPEWIRE_RUNTIME_DIR`, and the exact
Chrome capture title used.

Use Playwright context permissions in addition to flags:

```js
await context.grantPermissions([
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
  "notifications"
], { origin });
```

## Director scenario flow

Create `orchestration/two-host-debug.mjs`.

1. Load `ssh-rpc.local.jsonc` and `ssh-rpc.secrets.jsonc`.
2. Verify SSH key auth with `BatchMode=yes`.
3. Update remote checkout by configured sync policy (`pull` or `rsync`).
4. Start an SSH tunnel to the remote RPC port.
5. Start the remote RPC server if it is not already healthy.
6. Run `system.preflight` remotely and locally.
7. Launch director browser profile A locally.
8. Launch follower browser profile B remotely.
9. Seed or verify both profiles.
10. Execute the chosen scenario entirely from the director process.
11. On failure, call `debug.snapshotAll` on both sides before cleanup.
12. Save a combined summary under `orchestration/runs/<timestamp>-two-host/`.
13. Close browsers and the tunnel unless `--keep-open` is set.

## Security model

- Bind remote RPC to `127.0.0.1`.
- Reach remote RPC only through SSH local forwarding.
- Generate a random per-run RPC bearer token and pass it to the remote server in
  the SSH command environment. Require it on the WebSocket upgrade.
- Redact account passwords, auth tokens, endpoint credentials, cookies, and
  Authorization headers from all logs and responses.
- Store generated private keys with mode `0600`.
- Store local config/secrets with mode `0600`.
- Never print the SSH password or persist it after key installation.

## Implementation phases

1. Add shared browser launch flag builder and tests around deterministic media
   flags.
2. Add JSON-RPC framing helpers and unit tests.
3. Add remote RPC server with `system.*`, `browser.*`, `page.*`, and
   `debug.snapshotAll`.
4. Add extension/auth/property-lock method groups.
5. Add SSH setup script and gitignored config/secrets files.
6. Add director two-host scenario runner.
7. Retire the two-agent follower instructions from `setup.md` after the SSH RPC
   runner passes the current Phase 6 validation.

## Acceptance criteria

- A fresh director machine can run one setup script, provide SSH details and
  account credentials, and produce ignored local config files.
- If SSH key auth is absent, the script can install a dedicated key and retry
  without requiring another password prompt.
- The director can start the remote RPC server over SSH and receive
  `system.ping`.
- The director can launch both browsers with extension profiles and no media
  permission prompts.
- On failure, the run directory contains enough artifacts to inspect both
  browsers without accessing the remote desktop manually.
