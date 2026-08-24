---
description: Repository-specific rules for launching live test browsers
---

When a user asks to start a live test browser for this repository, launch it with
the committed one-command launcher — do NOT improvise ad hoc Playwright launch
code, do NOT drive the OS Chrome, and do NOT use the orchestration browser
helpers.

## Canonical command

```
pnpm browser:live <target-url>
```

Example: `pnpm browser:live https://bonliva.se`

This is the only supported way to open the live test browser. It is a thin,
proven driver (`scripts/launch-test-browser.mjs`) around the Chromium installed
by the pinned `npm:@playwright/mcp` package. Run it
from the repository root, in the background, so it can keep running while you
observe. The browser stays open until you stop it with Ctrl-C or `kill <pid>`.

## A target page URL is mandatory

The user must instruct which page (URL) to load. If no target page was provided,
STOP and ask the user for it before launching — do not guess a default, do not
reuse a previous URL, and do not launch until you have an explicit target page.
The launcher enforces this: it exits with an error if no URL is passed.

Pass `--no-build` to skip the rebuild. By default the launcher runs `pnpm build`
first so the browser always loads the current WXT output from
`.output/chrome-mv3`.

On Linux hosts with no `DISPLAY` or `WAYLAND_DISPLAY`, the launcher now
auto-relaunches itself through
`xvfb-run -a --server-args="-screen 0 1280x900x24"` when `xvfb-run` is
available. If not, it prints that exact wrapper command and stops before trying
to launch Chromium.

## What `pnpm browser:live` does (and why)

The launcher performs the exact, proven flow so a low-context agent does not have
to re-derive it:

1. Resolves the active repository root from its own file location — works in any
   environment, with no hardcoded machine paths.
2. On headless Linux hosts, auto-relaunches inside `xvfb-run` when available so
   the managed Chromium still gets a display server. If `xvfb-run` is missing,
   it prints the manual wrapper command and aborts before browser launch.
3. Builds the current unpacked WXT extension (`pnpm build` ->
   `.output/chrome-mv3`) unless `--no-build` is given. `.output/chrome-mv3` is
   the loadable unpacked root; never load the source checkout root.
4. Materializes a launchable, per-environment copy of the placeholdered config
   into the gitignored `.temp/browser-mcp.config.json`: it substitutes
   `__UNFLUFFIFY_REPO_ROOT__` with the resolved root and DROPS `executablePath`
   entirely; the launcher resolves the pinned package's managed Chromium at
   runtime (never the OS browser).
   It also injects `--remote-debugging-port=9222` and
   `--remote-allow-origins=*` so the same browser can be inspected/controlled
   through CDP without opening a second profile.
   The committed `.vscode/mcp.json`, `.mcp.json`, and
   `.vscode/browser-mcp.config.json` stay placeholdered and intentionally
   non-launchable; never edit them to bake in current-environment paths.
5. Ensures the pinned MCP package's managed Chromium is installed
   (`npx -y @playwright/mcp@<pinned> install-browser chromium`, idempotent).
6. Starts that managed Chromium directly with
   `--user-data-dir=<repoRoot>/.wxt/browser-profile`. It intentionally does not
   leave a Playwright session or `--remote-debugging-pipe` attached to the page,
   because either one occupies Chrome's debugger slot and blocks the extension's
   Render Inspection runtime.
7. Opens the target URL as the first tab.
8. Resolves the loaded extension id from the running extension service worker
   (`worker.url().split('/')[2]`) and cross-checks it against the deterministic
   path-hash id. Chrome derives an unpacked extension id from SHA-256 of the
   absolute load path: first 16 bytes, each nibble mapped `0..15 -> 'a'..'p'`.
   The id changes per environment / load path — never hardcode it.
9. Resolves the target page's Chrome tab id via the service worker
   (`chrome.tabs.query`) matched against `page.url()`.
10. Opens a temporary helper tab
   `chrome-extension://<id>/popup.html?debugTabId=<pageTabId>` so the extension
   can request the real Chrome side panel. `<pageTabId>` is the target page's tab
   id, never the helper's. After the exact side-panel target exists, it closes
   the helper so only the production popup client remains.

On success it prints the target URL, extension id, page tabId, the closed helper
URL, and the live side-panel URL, then starts the launcher control channel on the
same process stdin/stdout.

## Required control protocol for observation/debugging

The managed Chromium process is owned by `scripts/launch-test-browser.mjs`. Do
**not** start a second browser or MCP server against the same
`.wxt/browser-profile`; it profile-locks. Use the launcher's control channel on
the original Bash `shellId` and/or the CDP endpoint
`http://127.0.0.1:9222` instead.

Start the launcher with `mode="async"` and keep the returned `shellId`. After the
ready banner appears, the launcher prints:

```
[control] commands: help, state, exit-preview, observe, stop-observe
[control] automatic button-state observation is enabled
```

If your host environment supports writing to the running shell session, use the
launcher's stdin control channel with that same `shellId` to send commands:

- `state` — captures production-safe active-view, control, input, and disabled
  state from the real side-panel DOM, plus a target-page summary and open page
  URLs. A debug build additionally merges selected debug-hook fields; production
  observation never waits for or requires the hook.
- `exit-preview` — captures the same state before and after clicking
  `.preview-sidebar__dismiss` (Exit Preview) and waits 1.5 seconds for restore.
- `observe` — enables continuous polling and prints `[observe:buttons]` only
  when the summarized button state changes.
- `stop-observe` — stops the continuous polling without closing the browser.
- `help` — prints the available commands.

For button-state bugs, always capture `state` before the user clicks, keep
`observe` enabled while they interact, and use `exit-preview` when you need the
launcher to click Exit Preview itself. If your agent environment cannot write to
the running shell session, rely on the launcher's auto-enabled observation
output plus the CDP flow below; use the same browser session over CDP to inspect
popup state and click controls manually.

If the launcher control channel output is not enough, connect to the same live
browser over CDP from any Node environment where the `playwright` package is
already available:

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

Use that CDP connection to inspect the real side-panel DOM, click popup controls,
inspect the target page, and capture screenshots/logs. The
`window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` helper is optional and
debug-build-only.
Close only the CDP client (`browser.close()`); do not kill the launcher unless
you intend to close the live browser.

Chrome permits only one debugger owner per website tab. Before testing Render
Inspection, send `stop-observe`, stop `pnpm browser:observe`, and close every
one-shot CDP client. Operate the Render mode controls through the real
`popup.html` side-panel target; the `?debugTabId=` helper has already closed.
Do not attach CDP to the website until the inspection is set or cancelled.
Restart observation after the extension releases `chrome.debugger`.

## Use only the Playwright MCP browser; never touch the OS Chrome

- Operate only the pinned MCP package's managed Chromium bound to
  `.wxt/browser-profile`, exclusively via `pnpm browser:live` and the
  launcher's same-session control channel.
- Never run the OS Chrome/Chromium application binary directly, never
  `open -a 'Google Chrome'`, and never set `executablePath` to the OS browser.
- Never automate the OS browser with AppleScript/`osascript`, and never quit,
  kill, relaunch, or otherwise interfere with the user's OS Chrome instances,
  windows, or default profile. Only stop the launcher's own
  `npm:@playwright/mcp@latest` / managed-Chromium processes (Ctrl-C or
  `kill <pid>`).

## Reload after every rebuild

If you rebuild while the browser is open, the persisted profile can keep an older
MV3 service worker alive even though files on disk changed. If removed debug logs
or stale behavior still appear, call `chrome.runtime.reload()` from the extension
context or reload the extension on `chrome://extensions`, and wait for the new
service worker before retesting. Re-running `pnpm browser:live` from a clean
stop rebuilds and reloads from scratch.

## Debugging the launcher (internals)

If you must extend the flow, mirror `scripts/launch-test-browser.mjs`: resolve
the browser from the pinned MCP package, preserve `.wxt/browser-profile`, and
use short-lived CDP sockets. Never add `--remote-debugging-pipe` or a persistent
Playwright page session.

## Do not

- Do not launch without a user-instructed target page.
- Do not run the OS Chrome binary, `open -a 'Google Chrome'`, set
  `executablePath` to the OS browser, or drive/quit the OS Chrome with
  `osascript`.
- Do not hardcode a stale extension id; resolve it at runtime / from the load
  path.
- Do not point `debugTabId` at the popup's own tab.
- Do not hand-roll a browser launch or `launchPersistentContext()` flow, launch the committed
  placeholdered configs as-is, load the repo root as the unpacked extension,
  start a second MCP client/server for the same profile, or reuse
  `orchestration/profiles/*` for simple live observation.
