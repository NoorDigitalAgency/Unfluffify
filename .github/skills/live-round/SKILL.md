---
name: live-round
description: Run a stable full roundtrip with pnpm dev:no-browser + pnpm browser:live, keep stdout/stderr monitored, verify popup control, and recover from stuck launcher/profile states.
---

# Dev + Live Browser Round Control

Use this skill when you need a reliable, repeatable workflow that keeps both:

- `pnpm dev:no-browser` running for local build/watch logs without opening an OS browser
- `pnpm browser:live <target-url>` running for real popup/page control

This skill is specifically for avoiding stuck terminal channels, stale MCP/Chromium
locks, and popup control loss.

## When to use

- You need continuous stdout/stderr from `pnpm dev:no-browser` while driving live browser behavior.
- You need to send launcher control commands (`state`, `observe`, `exit-preview`).
- You need deterministic recovery when the launcher appears stuck.

## Preconditions

1. Keep WXT's explicit no-browser switch available and always use it during a live round:

```ts
// web-ext.config.ts
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  disabled: process.env.UNFLUFFIFY_NO_BROWSER === '1',
  chromiumArgs: ['--user-data-dir=./.wxt/browser-profile'],
});
```

2. Use these scripts intentionally:

- `pnpm dev:no-browser` = round-control mode. Do not run `pnpm dev` in this workflow because its auto-opened browser is not launcher-owned.

3. Always use one dev process and one `pnpm browser:live` process.
4. Use timeout guards for one-shot commands.
5. `pnpm dev:no-browser` is expected to stay resident after the initial build in
   both interactive and `/dev/null` launches. If port `3000` is already in use,
   WXT will pick the next free localhost port, so trust the printed
   `Started dev server @ http://localhost:<port>` line instead of assuming 3000.

## Timeout policy

- One-shot commands: `mode=sync` with explicit timeout safety cap.
- Long-running sessions (`pnpm dev:no-browser`, `pnpm browser:live`): `mode=async`.
- After async start, read output from the returned terminal id.

Recommended safety caps:

- process checks / grep: 10s
- script runs: 5-15m depending on flow
- launcher boot probes: 30-120s

## Canonical startup sequence

### 1. Inspect and stop only verified stale launcher processes

List possible owners with a timeout:

```bash
pgrep -af "launch-test-browser.mjs|playwright-mcp|remote-debugging-port=9222|\.wxt/browser-profile" || echo "clean"
```

Stop a process only when it is an orphan from a shell you own and its exact command/cwd identifies this repository. Prefer stopping the owned shell; otherwise use `kill <verified-pid>`. Never use `pkill`/`killall` or a pattern kill. Then verify:

```bash
pgrep -af "launch-test-browser.mjs|playwright-mcp|remote-debugging-port=9222|\.wxt/browser-profile" || echo "clean"
```

Expected: no launcher/MCP entries except the `rg` line itself.

### 2. Start dev session first

```bash
pnpm dev:no-browser
```

Expected output includes:

- `Started dev server @ http://localhost:<port>`
- `Load ".output/chrome-mv3-dev" as an unpacked extension manually`

### 3. Start live browser launcher second

```bash
pnpm browser:live <target-url>
```

On headless Linux hosts with no `DISPLAY`/`WAYLAND_DISPLAY`, the launcher now
relaunches itself through `xvfb-run -a --server-args="-screen 0 1280x900x24"`
when that wrapper is installed. If `xvfb-run` is missing, it prints the exact
manual wrapper command and exits before managed-Chromium startup.

Expected output includes:

- `managed Chromium`
- `page loaded`
- `live test browser ready`
- closed helper URL with `debugTabId`
- actual side-panel URL
- control commands banner
- a fresh `.temp/browser-live-provenance.json` bound to the owned browser process, exact extension id, target id, profile, source, and normalized canonical bundle inventory

`dev:no-browser` writes `.output/chrome-mv3-dev` only. The launcher must perform its own current-source `pnpm build` into canonical `.output/chrome-mv3`; do not add `--no-build` merely because the dev watcher is healthy. `--no-build` is allowed only when the launcher can verify its persisted trusted build attestation.

P25 pinned-legacy rounds may append
`--bundle-source .temp/p25-side-by-side/builds/legacy`. The launcher stages it
recoverably into canonical `.output/chrome-mv3`; never point Chromium at the
scratch directory directly.

## Control-channel validation (required)

Immediately send:

```text
state
```

Expected:

- `[control:state]` JSON payload appears
- popup URL and target URL are present

If this fails, do not continue functional testing. Recover first.

## Functional roundtrip notes

For Bonliva flows, popup actions are state-gated:

1. Render mode may be already configured; skip if no render prompt exists.
2. Enable marking.
3. Run AI content detection / Send to Lynx trigger.
4. Show Content List.
5. Save Session.
6. Final Send to Lynx confirmation.

For a Render Inspection round, send `stop-observe` and stop any
`pnpm browser:observe` process before clicking With/Without JavaScript. Chrome
allows only one debugger owner and the extension must own the website tab until
the inspection is set or cancelled. Use the real side panel for those clicks,
then restart observation.

Important: if Lynx checklist modal is open and `Send to Lynx` is disabled, this
is usually not a terminal/control issue. It indicates checklist requirements are
not satisfied (for example, missing marked pages by page type).

## Stuck-state recovery matrix

### Symptom A: launcher output stops at install spinner

- Cause: orphan `playwright-mcp install-browser` process.
- Fix: run the hard-clean commands above, then relaunch.

### Symptom B: `state` command appears sent but no JSON response

- Cause: wrong terminal id or stale launcher session.
- Fix: ensure command is sent to current launcher terminal id only.

### Symptom C: launcher prints `unknown command "pnpm browser:live ..."`

- Cause: shell command accidentally sent to launcher control channel.
- Fix: keep one dedicated launcher terminal and send only control commands there.

### Symptom D: compute/save clicks timeout due interception

- Cause: modal dialog overlays controls.
- Fix: handle modal first (for example checklist cancel/confirm path), then retry.

## Logging and evidence capture

During runs, collect:

- `pnpm dev:no-browser` terminal output (build/watch and errors)
- `pnpm browser:live` output (ready banner, control responses, observe diffs)
- popup/target console errors and page errors (via CDP script when needed)
- structured flow report JSON under `.temp/`

## Completion checklist

Before declaring success:

1. `pnpm dev:no-browser` is healthy and still running.
2. launcher is at `live test browser ready`.
3. `state` returns valid popup+target payload.
4. required functional steps either complete or fail with explicit product-state reason.
5. all failures include concrete logs (not just "stuck").
