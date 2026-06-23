---
description: Repository-specific rules for launching live test browsers
---

When a user asks to start a live test browser for this repository, prefer the
repo-local MCP browser configuration instead of improvising with ad hoc
Playwright launch code or the orchestration browser helpers.

First step: build per-environment, launchable copies of the placeholdered
`playwright-local` configs. The committed configs are intentionally
non-launchable — they carry `__UNFLUFFIFY_REPO_ROOT__` and
`__CHROMIUM_EXECUTABLE_PATH__` placeholders so they fail if launched as-is.

1. Determine the active `Unfluffify` repository root for the current
   environment (e.g. the current workspace / git repo root). Treat that
   directory as the source of truth for all browser launch paths.
2. Create a gitignored `.temp/` directory at the repository root if it does not
   already exist.
3. Copy `.vscode/mcp.json` and `.vscode/browser-mcp.config.json` into `.temp/`
   (e.g. `.temp/mcp.json` and `.temp/browser-mcp.config.json`).
4. In the `.temp/` copies, replace every `__UNFLUFFIFY_REPO_ROOT__` placeholder
   with the resolved repository root. Do NOT point `__CHROMIUM_EXECUTABLE_PATH__`
   at the OS Chrome/Chromium app — remove the `executablePath` line entirely so
   Playwright uses its own managed Chromium (install it once with
   `deno run -A npm:playwright@latest install chromium` if it is missing). Point
   the `--config=` argument in `.temp/mcp.json` at `.temp/browser-mcp.config.json`.
5. Launch the browser using the `.temp/` copies — never the committed,
   placeholdered originals — and only via the `playwright-local`
   (`npm:@playwright/mcp@latest`) MCP server with Playwright's own managed
   Chromium. Never start the OS Chrome/Chromium app binary, `open -a`, or
   `osascript` to stand in for the MCP browser.

Do not edit the committed `.vscode/mcp.json`, `.mcp.json`, or
`.vscode/browser-mcp.config.json` to bake in current-environment paths; keep the
substitution confined to the `.temp/` copies.

The committed `.vscode/mcp.json` server `playwright-local` is the template, which
(once substituted into `.temp/`) launches:

- `deno run -A npm:@playwright/mcp@latest`
- `--user-data-dir=<repoRoot>/.mcp-browser-profile`
- `--config=<repoRoot>/.temp/browser-mcp.config.json`

That browser config is the canonical live-test setup for this repo:

- visible Chromium (`headless: false`)
- `ignoreDefaultArgs: ["--disable-extensions"]` so the extension can load
- persistent profile in `.mcp-browser-profile`

Use only the Playwright MCP browser; never touch the OS Chrome:

- Launch and drive the browser exclusively through the `playwright-local`
  (`npm:@playwright/mcp@latest`) MCP server and its browser tools, using
  Playwright's own managed Chromium bound to `.mcp-browser-profile`.
- Never run the OS Chrome/Chromium application binary directly, never
  `open -a 'Google Chrome'`, and never set `executablePath` to the OS browser.
- Never automate the OS browser with AppleScript/`osascript`, and never quit,
  kill, relaunch, or otherwise interfere with the user's OS Chrome instances,
  windows, or default profile.
- The only browser you operate is the Playwright MCP instance bound to
  `.mcp-browser-profile`.

Important: the loadable unpacked extension root for live launches is the built
output, not the source checkout root. Default to:

- `dist/extension-dev` for live/manual/browser-MCP runs
- `dist/extension` only when the user explicitly wants the non-dev/release build

After rebuilding `dist/extension-dev`, reload the unpacked extension in the
persisted profile before observing behavior. The persisted Chromium profile can
keep an older MV3 service worker alive even though files on disk have changed;
if removed debug logs or stale behavior still appear, call `chrome.runtime.reload()`
from the extension context or reload the extension on `chrome://extensions` and
wait for the new service worker before retesting.

Do not assume the repo root itself is loadable as an unpacked extension. It
does not contain the built JS entrypoints Chrome needs (for example
`background.js`, `popup.js`, `content-loader.js`), so service-worker waits and
popup targeting can fail if the repo root is loaded directly.

Do not default to the repo's `orchestration/profiles/*` Playwright flows for
simple live observation. Those paths are for orchestration scenarios and can
fail on extension service-worker waits or profile-lock issues. Only use them
when the user explicitly asks for the orchestration browser path.

Required target page and popup binding:

- The user must instruct which page (URL) to load. If no target page was
  provided, stop and ask the user for it before launching — do not guess a
  default, do not reuse a previous URL, and do not launch until you have an
  explicit target page.
- Resolve the loaded extension's id/hash from the current load directory at
  runtime; the unpacked extension id is derived from the absolute path of the
  loaded extension directory and changes per environment, so read it from
  `chrome://extensions` (Developer mode) or a `chrome.runtime.getURL("")` value
  rather than hardcoding it.
- Load the instructed page first in its own tab and capture that tab's numeric
  `tabId`. Then open a second tab at
  `chrome-extension://<extension-id>/popup.html?debugTabId=<tabId>` so the
  extension binds to the target page. `<tabId>` must be the instructed page's
  tab id, never the popup's own tab.

Example:

- Right: confirm the user-instructed target page (ask if missing), substitute
  the placeholdered configs into `.temp/`, launch the repo's `playwright-local`
  MCP browser with `<repoRoot>/.temp/browser-mcp.config.json`,
  `<repoRoot>/.mcp-browser-profile`, and the built extension root
  `<repoRoot>/dist/extension-dev`, open the instructed page in the first tab and
  capture its `tabId`, resolve the loaded extension's id, then open a second tab
  at `chrome-extension://<id>/popup.html?debugTabId=<tabId>` bound to that page
  tab.
- Wrong: launch without a user-instructed target page, run the OS Chrome binary
  / `open -a 'Google Chrome'`, set `executablePath` to the OS browser, drive or
  quit the OS Chrome with `osascript`, hardcode a stale extension id instead of
  resolving it from the current load directory, point `debugTabId` at the
  popup's own tab, hand-roll a fresh `launchPersistentContext()` flow, launch
  the committed placeholdered configs as-is, or reuse
  `orchestration/profiles/follower` just to open a browser for manual
  observation.
