---
description: Repository-specific rules for launching live test browsers
---

When a user asks to start a live test browser for this repository, prefer the
repo-local MCP browser configuration instead of improvising with ad hoc
Playwright launch code or the orchestration browser helpers.

First step: determine the active `Unfluffify` repository root for the current
environment and treat that directory as the source of truth for all browser
launch paths.

- Start from the current workspace / git repo root for `Unfluffify`.
- Derive all absolute browser-launch paths from that root.
- Do not loop trying to reconcile stale machine-specific absolute paths found in
  `.vscode/mcp.json`, `.mcp.json`, or related config files.
- Use the calculated current-environment paths at runtime without editing those
  config files unless the user explicitly asks.

Use `.vscode/mcp.json` server `playwright-local`, which launches:

- `deno run -A npm:@playwright/mcp@latest`
- `--user-data-dir=<repoRoot>/.mcp-browser-profile`
- `--config=<repoRoot>/.vscode/browser-mcp.config.json`

That browser config is the canonical live-test setup for this repo:

- visible Chromium (`headless: false`)
- `ignoreDefaultArgs: ["--disable-extensions"]` so the extension can load
- persistent profile in `.mcp-browser-profile`

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

Example:

- Right: use the repo's `playwright-local` MCP browser with
  `<repoRoot>/.vscode/browser-mcp.config.json`,
  `<repoRoot>/.mcp-browser-profile`, and the built extension root
  `<repoRoot>/dist/extension-dev` by default.
- Wrong: hand-roll a fresh `launchPersistentContext()` flow or reuse
  `orchestration/profiles/follower` just to open a browser for manual
  observation.
