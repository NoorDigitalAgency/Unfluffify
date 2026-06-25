---
name: launch-test-browser
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

That single command runs the entire proven flow (`scripts/launch-test-browser.ts`):

1. Resolves the active repo root for the current environment (no hardcoded
   machine paths).
2. Builds `.output/chrome-mv3` (`pnpm build`). Pass `--no-build` to skip the
   rebuild. `.output/chrome-mv3` is the loadable unpacked root — never the
   source checkout root.
3. Writes a launchable, per-environment copy of the placeholdered config to the
   gitignored `.temp/browser-mcp.config.json` (substitutes the repo root and
   drops `executablePath` so Playwright uses its own managed Chromium). The
   committed `.vscode/mcp.json`, `.mcp.json`, and
   `.vscode/browser-mcp.config.json` stay placeholdered and non-launchable;
   never edit them to bake in current-environment paths. The launcher injects
   `--remote-debugging-port=9222` and `--remote-allow-origins=*` into the temp
   config so the same browser is controllable over CDP without opening a second
   profile.
4. Ensures the MCP-managed Chromium is installed (idempotent).
5. Starts `npm:@playwright/mcp@latest` over stdio (single launcher-owned client
   = no profile-lock) with `--user-data-dir=<repoRoot>/.mcp-browser-profile` and
   `--config=<repoRoot>/.temp/browser-mcp.config.json`.
6. Navigates the first tab to `<target-url>`.
7. Resolves the loaded extension id from the service worker and cross-checks it
   against the deterministic path-hash id (changes per environment — never
   hardcode it).
8. Resolves the target page's Chrome tab id via the service worker.
9. Opens a SECOND tab `chrome-extension://<id>/popup.html?debugTabId=<pageTabId>`
   so the extension binds to the target page (`<pageTabId>` is the page's tab,
   never the popup's own tab).

On success it prints the target URL, extension id, page tabId, and bound popup
URL. It also starts a launcher-owned control channel on the same process
stdin/stdout. To close the browser, stop the launcher (Ctrl-C or `kill <pid>`).

### 3. Control and observe through the launcher

The MCP server is intentionally owned by the launcher. Do not start a second MCP
server/client for the same `.mcp-browser-profile` to debug the open browser; it
will either profile-lock or leave you unable to control the existing page/popup.
Use the launcher's stdin/stdout control commands and/or the same-browser CDP
endpoint `http://127.0.0.1:9222`.

Keep the `shellId` returned by the async `pnpm browser:live ...` call. Once
the ready banner appears, the launcher prints:

```
[control] commands: help, state, exit-preview, observe, stop-observe
[control] automatic button-state observation is enabled
```

If your host environment supports writing to the running shell session, use the
launcher's stdin control channel with the same `shellId`:

- `state` captures the bound popup's
  `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` button fields,
  the live DOM state for `#compute`, `#marking-preview`, `#page-save`,
  `#page-revert`, and `#toggle-enabled`, a target-page summary, and open page
  URLs.
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
the same browser over CDP instead of starting another MCP server:

```bash
node ./scripts/run-deno.mjs eval --allow-net --allow-env --allow-read --allow-sys '
const { chromium } = await import("npm:playwright");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const pages = context.pages();
const popup = pages.find((p) => p.url().startsWith("chrome-extension://") && p.url().includes("/popup.html"));
const target = pages.find((p) => !p.url().startsWith("chrome-extension://") && !p.url().startsWith("chrome://"));
console.log({ popup: popup?.url(), target: target?.url() });
await browser.close();
'
```

Through that CDP connection you can evaluate popup state with
`window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()`, click popup controls,
observe the target page, and capture screenshots/logs. Close only the CDP client with
`browser.close()`; stop the launcher only when the live browser should close.

### 4. Reload after every rebuild

If you rebuild while the browser is open, the persisted profile can keep an older
MV3 service worker alive even though files on disk changed. If removed debug logs
or stale behavior still appear:

- call `chrome.runtime.reload()` from the extension context, or
- reload the extension on `chrome://extensions`,

then wait for the new service worker before retesting. Re-running
`pnpm browser:live` from a clean stop rebuilds and reloads from scratch.

## Guardrails

- **Use only the Playwright MCP browser; never touch the OS Chrome.** Operate the
  browser exclusively through `pnpm browser:live`, its launcher-owned MCP
  client, and the same-session control commands. Never run the OS
  Chrome/Chromium app binary directly,
  never `open -a 'Google Chrome'`, never set `executablePath` to the OS browser,
  never automate it with AppleScript/`osascript`, and never quit, kill,
  relaunch, or otherwise interfere with the user's OS Chrome instances, windows,
  or default profile. Only stop the launcher's own managed-Chromium process.
- Always load `.output/chrome-mv3`, never the source checkout root.
- Do not start a second MCP client/server for the same profile and do not
  default to `orchestration/profiles/*` Playwright flows for simple live
  observation; those are for orchestration scenarios and can fail on
  service-worker waits or profile-lock issues.

## Debugging the launcher (internals)

If you must drive the MCP browser by hand to extend the flow, mirror
`scripts/launch-test-browser.ts` and `orchestration/steps/browser.mjs`:

- The `browser_run_code_unsafe` sandbox is NOT a full Node context: `setTimeout`
  and `URL` are undefined there. Use Playwright APIs (`page.waitForTimeout`) and
  plain string ops (`String(url).split('/')`) in the outer function; the inner
  `worker.evaluate(...)` body runs in the extension service worker, where
  `chrome.*` and `setTimeout` are available.
- Use the single launcher-owned MCP client/connection and its control commands.
  A second connection to the same `--user-data-dir` fails with "Browser is
  already in use" or cannot observe/control the browser that is already open.

## Example

- Right: confirm the user-instructed target page (ask if missing), then run
  `pnpm browser:live https://bonliva.se` in the background. It runs `pnpm build`,
  writes `.temp/browser-mcp.config.json`, launches the
  `playwright-local` MCP managed Chromium with `.mcp-browser-profile`, opens the
  page in the first tab, resolves the extension id and page tabId, and opens a
  second tab `chrome-extension://<id>/popup.html?debugTabId=<pageTabId>` bound to
  the page.
- Wrong: launch without a user-instructed target page, run the OS Chrome binary
  / `open -a 'Google Chrome'`, set `executablePath` to the OS browser, drive or
  quit the OS Chrome with `osascript`, hardcode a stale extension id instead of
  resolving it from the current load directory, point `debugTabId` at the
  popup's own tab, start a second MCP client/server for the same profile,
  hand-roll a fresh `launchPersistentContext()` flow, launch the committed
  placeholdered configs as-is, load the repo root as the unpacked extension, or
  reuse `orchestration/profiles/follower` just to open a browser for manual
  observation.
