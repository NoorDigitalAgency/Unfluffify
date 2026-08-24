---
name: live-browser
description: Launch the live/dev test browser for this repo with the unpacked extension loaded, using the repo-local playwright-local MCP browser. Use whenever you need to observe, debug, or manually test the extension in a real Chromium.
---

# Launch the Live Test Browser

Use this skill whenever you need a real Chromium with the Unfluffify extension
loaded for observation, debugging, or manual testing. It is the canonical setup
and replaces hand-rolled Playwright launches or the orchestration browser
helpers for simple live runs.

This skill is the executable form of
`.github/instructions/browser-launch.instructions.md`. Follow it directly
instead of re-reading and re-deriving that file.

## Use this skill when

- The user asks to "open", "launch", "start", or "use the browser" to look at
  the extension.
- You need to reproduce a popup/page/spinner behavior in a real browser.
- You need to inspect the live AI / reveal-freeze / preview flows against a real
  page (e.g. Bonliva).

## Required input

- A **target page URL** to load is mandatory. If the user did not say which page
  to load, **stop and ask for it before launching** — do not assume a default,
  do not reuse the last URL. The launcher also refuses to start without a URL.

## Do NOT use this skill for

- Headless unit/integration tests (`pnpm test`) — those do not need a
  visible browser.
- Orchestration scenarios under `orchestration/profiles/*` — only use those when
  the user explicitly asks for the orchestration browser path.

## Procedure

### 1. Confirm the target page

The user must instruct which page (URL) to load. If no target page was provided,
**stop and ask the user for it** — do not guess a default, do not reuse the last
URL, and do not launch until you have an explicit target page.

### 2. Launch with the one-command launcher

Run, from the repository root, in the background so the browser stays open while
you observe:

```
pnpm browser:live <target-url>
```

Example: `pnpm browser:live https://bonliva.se`

That single command runs the entire proven flow (`scripts/launch-test-browser.mjs`):

1. Resolves the active repo root for the current environment (no hardcoded
   machine paths).
2. On Linux hosts with no `DISPLAY` or `WAYLAND_DISPLAY`, auto-relaunches
   itself through `xvfb-run -a --server-args="-screen 0 1280x900x24"` when
   `xvfb-run` is installed. If not, it prints that exact wrapper command and
   stops before trying to launch Chromium.
3. Builds `.output/chrome-mv3` (`pnpm build`). Pass `--no-build` to skip the
   rebuild. `.output/chrome-mv3` is the loadable unpacked root — never the
   source checkout root.
4. Writes a launchable, per-environment copy of the placeholdered config to the
   gitignored `.temp/browser-mcp.config.json` (substitutes the repo root and
   drops the placeholder `executablePath`; the launcher resolves the executable
   supplied by the pinned MCP package at runtime). The
   committed `.vscode/mcp.json`, `.mcp.json`, and
   `.vscode/browser-mcp.config.json` stay placeholdered and non-launchable;
   never edit them to bake in current-environment paths. The launcher injects
   `--remote-debugging-port=9222` and `--remote-allow-origins=*` into the temp
   config so the same browser is controllable over CDP without opening a second
   profile.
5. Ensures the MCP-managed Chromium is installed (idempotent).
6. Starts that pinned package's managed Chromium directly with
   `--user-data-dir=<repoRoot>/.wxt/browser-profile`. No persistent Playwright
   session remains attached to the website tab, because that would occupy
   Chrome's single `chrome.debugger` owner and make Render Inspection fail.
7. Opens `<target-url>` as the first tab.
8. Resolves the loaded extension id from the service worker and cross-checks it
   against the deterministic path-hash id (changes per environment — never
   hardcode it).
9. Resolves the target page's Chrome tab id via the service worker.
10. Opens a temporary helper tab
   `chrome-extension://<id>/popup.html?debugTabId=<pageTabId>` so the extension
   can request the real Chrome side panel for the target page (`<pageTabId>` is
   the page's tab, never the helper's). Once the exact production side-panel
   target exists, the launcher closes the helper so only one popup client polls
   configuration, lock, and signal authority.

On success it prints the target URL, extension id, page tabId, the now-closed
helper URL, and the live side-panel URL. It also starts a launcher-owned control
channel on the same process stdin/stdout. To close the browser, stop the launcher
(Ctrl-C or `kill <pid>`).

### 3. Control and observe through the launcher

The launcher owns the managed Chromium process. Do not start another browser or
MCP server with the same `.wxt/browser-profile`; it will profile-lock. Use the
launcher's stdin/stdout control commands and/or the same-browser CDP endpoint
`http://127.0.0.1:9222`.

Keep the `shellId` returned by the async `pnpm browser:live ...` call. Once
the ready banner appears, the launcher prints:

```
[control] commands: help, state, exit-preview, observe, stop-observe
[control] automatic button-state observation is enabled
```

If your host environment supports writing to the running shell session, use the
launcher's stdin control channel with the same `shellId`:

- `state` captures production-safe active-view, control, input, and disabled
  state from the real side-panel DOM, plus a target-page summary and open page
  URLs. Debug builds additionally merge selected
  `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` fields; production does not
  require or expose that hook.
- `exit-preview` captures before/after state around a launcher click on
  `.preview-sidebar__dismiss` (Exit Preview), waiting 1.5 seconds for restore.
- `observe` enables continuous button-state polling and logs `[observe:buttons]`
  only when the summarized state changes.
- `stop-observe` stops polling without closing the browser.
- `help` prints the available commands.

For button-state debugging, run `state` before the critical click and leave
observation enabled while the user walks through the flow. If your environment
cannot write to the running shell session, rely on the launcher's auto-enabled
observation output and use the CDP path below for active control.

If you need direct programmatic control beyond the launcher commands, connect to
the same browser over CDP instead of starting another browser, using any
Node environment where the `playwright` package is already available:

```bash
node --input-type=module -e '
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const pages = context.pages();
const popup = pages.find((p) => p.url().startsWith("chrome-extension://") && p.url().includes("/popup.html"));
const target = pages.find((p) => !p.url().startsWith("chrome-extension://") && !p.url().startsWith("chrome://"));
console.log({ popup: popup?.url(), target: target?.url() });
await browser.close();
'
```

Through that CDP connection you can inspect the real side-panel DOM, click popup
controls, observe the target page, and capture screenshots/logs. In debug builds
you may also evaluate `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()`; never
make production observation depend on it. Close only the CDP client with
`browser.close()`; stop the launcher only when the live browser should close.

Chrome permits only one debugger owner per website tab. Before exercising
Render Inspection, send `stop-observe`, stop any `pnpm browser:observe` process,
and close all one-shot CDP clients. Drive the Render mode controls through the
real `popup.html` side-panel target. The `?debugTabId=` helper has already
closed. Keep CDP clients off the website target until the inspection is set or
cancelled and the extension releases `chrome.debugger`; then restart
observation.

### 4. Reload after every rebuild

If you rebuild while the browser is open, the persisted profile can keep an older
MV3 service worker alive even though files on disk changed. If removed debug logs
or stale behavior still appear:

- call `chrome.runtime.reload()` from the extension context, or
- reload the extension on `chrome://extensions`,

then wait for the new service worker before retesting. Re-running
`pnpm browser:live` from a clean stop rebuilds and reloads from scratch.

## Guardrails

- **Use only the pinned MCP package's managed Chromium; never touch the OS
  Chrome.** Operate the browser exclusively through `pnpm browser:live`, its
  launcher control channel, and the same-session CDP endpoint. Never run the OS
  Chrome/Chromium app binary directly,
  never `open -a 'Google Chrome'`, never set `executablePath` to the OS browser,
  never automate it with AppleScript/`osascript`, and never quit, kill,
  relaunch, or otherwise interfere with the user's OS Chrome instances, windows,
  or default profile. Only stop the launcher's own managed-Chromium process.
- Always load `.output/chrome-mv3`, never the source checkout root.
- Do not start a second browser or MCP server for the same profile and do not
  default to `orchestration/profiles/*` Playwright flows for simple live
  observation; those are for orchestration scenarios and can fail on
  service-worker waits or profile-lock issues.
- On headless Linux, rely on the launcher's built-in `xvfb-run` relaunch first;
  if it prints the manual wrapper command instead, re-run exactly that command.

## Debugging the launcher (internals)

If you must extend the flow, mirror `scripts/launch-test-browser.mjs`. Resolve
the browser from the pinned MCP package, keep `.wxt/browser-profile`, and make
CDP connections short-lived. Never add `--remote-debugging-pipe` or a persistent
Playwright page session: either one reintroduces the Render Inspection conflict.

## Example

- Right: confirm the user-instructed target page (ask if missing), then run
  `pnpm browser:live https://bonliva.se` in the background. It runs `pnpm build`,
  writes `.temp/browser-mcp.config.json`, launches the
  pinned MCP package's managed Chromium with `.wxt/browser-profile`, opens the
  page in the first tab, resolves the extension id and page tabId, uses a
  temporary `popup.html?debugTabId=<pageTabId>` helper to open the actual side
  panel, and closes the helper after the panel is ready.
- Wrong: launch without a user-instructed target page, run the OS Chrome binary
  / `open -a 'Google Chrome'`, set `executablePath` to the OS browser, drive or
  quit the OS Chrome with `osascript`, hardcode a stale extension id instead of
  resolving it from the current load directory, point `debugTabId` at the
  popup's own tab, start a second MCP client/server for the same profile,
  hand-roll a fresh `launchPersistentContext()` flow, launch the committed
  placeholdered configs as-is, load the repo root as the unpacked extension, or
  reuse `orchestration/profiles/follower` just to open a browser for manual
  observation.
