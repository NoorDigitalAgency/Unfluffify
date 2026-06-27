---
name: dev-live-round-control
description: Run a stable full roundtrip with pnpm dev + pnpm browser:live, keep stdout/stderr monitored, verify popup control, and recover from stuck launcher/profile states.
---

# Dev + Live Browser Round Control

Use this skill when you need a reliable, repeatable workflow that keeps both:

- `pnpm dev` running for local build/watch logs
- `pnpm browser:live <target-url>` running for real popup/page control

This skill is specifically for avoiding stuck terminal channels, stale MCP/Chromium
locks, and popup control loss.

## When to use

- You need continuous stdout/stderr from `pnpm dev` while driving live browser behavior.
- You need to send launcher control commands (`state`, `observe`, `exit-preview`).
- You need deterministic recovery when the launcher appears stuck.

## Preconditions

1. Keep browser auto-open enabled by default, and use explicit no-browser mode when needed:

```ts
// web-ext.config.ts
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  disabled: process.env.UNFLUFFIFY_NO_BROWSER === '1',
  chromiumArgs: ['--user-data-dir=./.wxt/browser-profile'],
});
```

2. Use these scripts intentionally:

- `pnpm dev` = normal mode (auto-opens browser)
- `pnpm dev:no-browser` = round-control mode (no auto-open; preferred with `pnpm browser:live`)

3. Always use one dev process and one `pnpm browser:live` process.
4. Use timeout guards for one-shot commands.
5. `pnpm dev:no-browser` is expected to stay resident after the initial build in
   both interactive and `/dev/null` launches. If port `3000` is already in use,
   WXT will pick the next free localhost port, so trust the printed
   `Started dev server @ http://localhost:<port>` line instead of assuming 3000.

## Timeout policy

- One-shot commands: `mode=sync` with explicit timeout safety cap.
- Long-running sessions (`pnpm dev`, `pnpm browser:live`): `mode=async`.
- After async start, read output from the returned terminal id.

Recommended safety caps:

- process checks / grep: 10s
- script runs: 5-15m depending on flow
- launcher boot probes: 30-120s

## Canonical startup sequence

### 1. Hard-clean stale launcher processes

Run with timeout:

```bash
pkill -f "playwright-mcp install-browser chromium" || true
pkill -f "@playwright/mcp@latest install-browser chromium" || true
pkill -f "node ./scripts/launch-test-browser.mjs" || true
pkill -f "@playwright/mcp@latest --user-data-dir" || true
```

Verify clean state:

```bash
ps aux | rg -n "launch-test-browser.mjs|playwright-mcp|@playwright/mcp" -S
```

Expected: no launcher/MCP entries except the `rg` line itself.

### 2. Start dev session first

```bash
pnpm dev:no-browser
```

Expected output includes:

- `Started dev server @ http://localhost:<port>`
- `Load ".output/chrome-mv3-dev" as an unpacked extension manually`

If you intentionally want browser auto-open (outside round-control mode), use:

```bash
pnpm dev
```

### 3. Start live browser launcher second

```bash
pnpm browser:live <target-url> --no-build
```

On headless Linux hosts with no `DISPLAY`/`WAYLAND_DISPLAY`, the launcher now
relaunches itself through `xvfb-run -a --server-args="-screen 0 1280x900x24"`
when that wrapper is installed. If `xvfb-run` is missing, it prints the exact
manual wrapper command and exits before MCP startup.

Expected output includes:

- `MCP initialized`
- `page loaded`
- `live test browser ready`
- popup URL with `debugTabId`
- control commands banner

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

- `pnpm dev` terminal output (build/watch and errors)
- `pnpm browser:live` output (ready banner, control responses, observe diffs)
- popup/target console errors and page errors (via CDP script when needed)
- structured flow report JSON under `.temp/`

## Completion checklist

Before declaring success:

1. `pnpm dev` is healthy and still running.
2. launcher is at `live test browser ready`.
3. `state` returns valid popup+target payload.
4. required functional steps either complete or fail with explicit product-state reason.
5. all failures include concrete logs (not just "stuck").
