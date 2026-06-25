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
proven driver (`scripts/launch-test-browser.ts`) around the `playwright-local`
(`npm:@playwright/mcp@latest`) MCP server and its own managed Chromium. Run it
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

## What `pnpm browser:live` does (and why)

The launcher performs the exact, proven flow so a low-context agent does not have
to re-derive it:

1. Resolves the active repository root from its own file location — works in any
   environment, with no hardcoded machine paths.
2. Builds the current unpacked WXT extension (`pnpm build` ->
   `.output/chrome-mv3`) unless `--no-build` is given. `.output/chrome-mv3` is
   the loadable unpacked root; never load the source checkout root.
3. Materializes a launchable, per-environment copy of the placeholdered config
   into the gitignored `.temp/browser-mcp.config.json`: it substitutes
   `__UNFLUFFIFY_REPO_ROOT__` with the resolved root and DROPS `executablePath`
   entirely so Playwright uses its own managed Chromium (never the OS browser).
   It also injects `--remote-debugging-port=9222` and
   `--remote-allow-origins=*` so the same browser can be inspected/controlled
   through CDP without opening a second profile.
   The committed `.vscode/mcp.json`, `.mcp.json`, and
   `.vscode/browser-mcp.config.json` stay placeholdered and intentionally
   non-launchable; never edit them to bake in current-environment paths.
4. Ensures the MCP-managed Chromium is installed
   (`node ./scripts/run-deno.mjs run -A npm:@playwright/mcp@latest install-browser chromium`,
   idempotent).
5. Starts `npm:@playwright/mcp@latest` over stdio (a single launcher-owned
   client = no profile-lock) with
   `--user-data-dir=<repoRoot>/.mcp-browser-profile` and
   `--config=<repoRoot>/.temp/browser-mcp.config.json`.
6. Navigates the first tab to the target URL.
7. Resolves the loaded extension id from the running extension service worker
   (`worker.url().split('/')[2]`) and cross-checks it against the deterministic
   path-hash id. Chrome derives an unpacked extension id from SHA-256 of the
   absolute load path: first 16 bytes, each nibble mapped `0..15 -> 'a'..'p'`.
   The id changes per environment / load path — never hardcode it.
8. Resolves the target page's Chrome tab id via the service worker
   (`chrome.tabs.query`) matched against `page.url()`.
9. Opens a SECOND tab `chrome-extension://<id>/popup.html?debugTabId=<pageTabId>`
   so the extension binds to the target page. `<pageTabId>` is the target page's
   tab id, never the popup's own tab.

On success it prints the target URL, the extension id, the page tabId, and the
bound popup URL, then starts the launcher control channel on the same process
stdin/stdout.

## Required control protocol for observation/debugging

The Playwright MCP server is owned by `scripts/launch-test-browser.ts` over
stdio. Do **not** start a second MCP server/client against the same
`.mcp-browser-profile` to inspect the browser; it either profile-locks or leaves
the agent unable to control the already-open page/popup. Use the launcher's
control channel on the original Bash `shellId` and/or the CDP endpoint
`http://127.0.0.1:9222` instead.

Start the launcher with `mode="async"` and keep the returned `shellId`. After the
ready banner appears, the launcher prints:

```
[control] commands: help, state, exit-preview, observe, stop-observe
[control] automatic button-state observation is enabled
```

If your host environment supports writing to the running shell session, use the
launcher's stdin control channel with that same `shellId` to send commands:

- `state` — captures the bound popup's
  `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` fields,
  live DOM state for `#compute`, `#marking-preview`, `#page-save`,
  `#page-revert`, and `#toggle-enabled`, plus a target-page summary and open
  page URLs.
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
browser over CDP:

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

Use that CDP connection to evaluate popup state
(`window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()`),
click popup controls, inspect the target page, and capture screenshots/logs.
Close only the CDP client (`browser.close()`); do not kill the launcher unless
you intend to close the live browser.

## Use only the Playwright MCP browser; never touch the OS Chrome

- Operate only the Playwright MCP managed Chromium bound to
  `.mcp-browser-profile`, exclusively via `pnpm browser:live` and the
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

If you must drive the MCP browser by hand (e.g. to extend the flow), mirror
`scripts/launch-test-browser.ts` and `orchestration/steps/browser.mjs`:

- The `browser_run_code_unsafe` sandbox is NOT a full Node context: `setTimeout`
  and `URL` are undefined there. Use Playwright APIs (`page.waitForTimeout`) and
  plain string ops (`String(url).split('/')`) in the outer function. The inner
  `worker.evaluate(...)` body runs in the extension service worker, where
  `chrome.*` and `setTimeout` are available.
- Use the single launcher-owned MCP client/connection and its control commands.
  A second connection to the same `--user-data-dir` fails with "Browser is
  already in use" or cannot observe/control the browser that is already open.

## Do not

- Do not launch without a user-instructed target page.
- Do not run the OS Chrome binary, `open -a 'Google Chrome'`, set
  `executablePath` to the OS browser, or drive/quit the OS Chrome with
  `osascript`.
- Do not hardcode a stale extension id; resolve it at runtime / from the load
  path.
- Do not point `debugTabId` at the popup's own tab.
- Do not hand-roll a `launchPersistentContext()` flow, launch the committed
  placeholdered configs as-is, load the repo root as the unpacked extension,
  start a second MCP client/server for the same profile, or reuse
  `orchestration/profiles/*` for simple live observation.
