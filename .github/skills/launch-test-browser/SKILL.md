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
  to load, stop and ask for it before launching — do not assume a default.

## Do NOT use this skill for

- Headless unit/integration tests (`deno task test`) — those do not need a
  visible browser.
- Orchestration scenarios under `orchestration/profiles/*` — only use those when
  the user explicitly asks for the orchestration browser path.

## Canonical configuration (do not improvise)

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
   placeholdered originals.

Do not edit the committed `.vscode/mcp.json`, `.mcp.json`, or
`.vscode/browser-mcp.config.json` to bake in current-environment paths; keep the
substitution confined to the `.temp/` copies.

The committed `.vscode/mcp.json` server `playwright-local` is the template, which
(once substituted into `.temp/`) runs:

- `deno run -A npm:@playwright/mcp@latest`
- `--user-data-dir=<repoRoot>/.mcp-browser-profile`
- `--config=<repoRoot>/.temp/browser-mcp.config.json`

`.temp/browser-mcp.config.json` (the substituted copy) is the canonical
live-test browser config:

- visible Chromium (`headless: false`)
- `ignoreDefaultArgs: ["--disable-extensions"]` so the extension can load
- persistent profile in `.mcp-browser-profile`
- loads the unpacked extension from `dist/extension-dev` via
  `--load-extension` / `--disable-extensions-except`

## Procedure

1. **Confirm the target page before doing anything else.** The user must
   instruct which page (URL) to load. If no target page was provided, **stop and
   ask the user for it** — do not guess a default, do not reuse the last URL, and
   do not launch the browser until you have an explicit target page.

2. **Build the dev extension first.** The loadable unpacked root is the built
   output, not the source checkout root. Run:

   ```
   deno task build:dev
   ```

   This produces `dist/extension-dev`. Use `dist/extension` only when the user
   explicitly asks for the non-dev/release build.

3. **Substitute the configs into `.temp/` and launch the `playwright-local` MCP
   browser** with the resolved copies. Use:

   - `<repoRoot>/.mcp-browser-profile`
   - `<repoRoot>/.temp/browser-mcp.config.json`

   Drive only the `playwright-local` (`npm:@playwright/mcp@latest`) MCP server
   with Playwright's own managed Chromium. Do not start the OS Chrome/Chromium
   app binary, `open -a 'Google Chrome'`, or `osascript`; do not hand-roll a
   `launchPersistentContext()` flow; do not launch the committed placeholdered
   configs as-is; and do not reuse `orchestration/profiles/*` for simple
   observation.

4. **Reload the unpacked extension after every rebuild.** The persisted Chromium
   profile can keep an older MV3 service worker alive even though files on disk
   changed. If removed debug logs or stale behavior still appear:
   - call `chrome.runtime.reload()` from the extension context, or
   - reload the extension on `chrome://extensions`,

   then wait for the new service worker to come up before retesting.

5. **Open the instructed page first, in its own tab.** Navigate the first tab to
   the user-instructed target page and let it load. Capture that tab's numeric
   `tabId` — this is the tab the extension will bind to.

6. **Resolve the loaded extension's id/hash for the current load directory.** The
   unpacked extension id is derived from the absolute path of the loaded
   extension directory, so it changes per environment / load path. Read it from
   the running browser instead of hardcoding it:
   - open `chrome://extensions` (enable Developer mode) and read the **ID** of
     the loaded Unfluffify extension, or
   - inspect the extension's service worker / a `chrome.runtime.getURL("")`
     value,

   and use that id as `<extension-id>` below.

7. **Open a second tab bound to the page tab via `debugTabId`.** With the target
   page tab id from step 5 and the resolved extension id from step 6, open the
   popup in a second tab so the extension binds to the target page:

   ```
   chrome-extension://<extension-id>/popup.html?debugTabId=<tabId>
   ```

   `<tabId>` must be the id of the instructed page's tab, not the popup tab.

## Guardrails

- **Use only the Playwright MCP browser; never touch the OS Chrome.** Launch and
  drive the browser exclusively through the `playwright-local`
  (`npm:@playwright/mcp@latest`) MCP server and its browser tools, using
  Playwright's own managed Chromium bound to `.mcp-browser-profile`. Never run
  the OS Chrome/Chromium app binary directly, never `open -a 'Google Chrome'`,
  never set `executablePath` to the OS browser, never automate it with
  AppleScript/`osascript`, and never quit, kill, relaunch, or otherwise
  interfere with the user's OS Chrome instances, windows, or default profile.
- Do not assume the repo root
  is loadable as an unpacked extension. It lacks the built JS entrypoints
  Chrome needs (e.g.
  `background.js`, `popup.js`, `content-loader.js`), so service-worker waits and
  popup targeting will fail if the repo root is loaded directly.
- Always load `dist/extension-dev` (or `dist/extension` for explicit release
  runs), never the source checkout root.
- Do not default to `orchestration/profiles/*` Playwright flows for simple live
  observation; those are for orchestration scenarios and can fail on
  service-worker waits or profile-lock issues.

## Example

- Right: confirm the user-instructed target page (ask if missing), build
  `dist/extension-dev`, substitute the placeholdered configs into `.temp/`,
  launch the `playwright-local` MCP browser with
  `<repoRoot>/.temp/browser-mcp.config.json` and
  `<repoRoot>/.mcp-browser-profile`, reload the unpacked extension, open the
  instructed page in the first tab and capture its `tabId`, resolve the loaded
  extension's id, then open a second tab at
  `chrome-extension://<id>/popup.html?debugTabId=<tabId>` bound to that page tab.
- Wrong: launch without a user-instructed target page, run the OS Chrome binary
  / `open -a 'Google Chrome'`, set `executablePath` to the OS browser, drive or
  quit the OS Chrome with `osascript`, hardcode a stale extension id instead of
  resolving it from the current load directory, point `debugTabId` at the
  popup's own tab, hand-roll a fresh `launchPersistentContext()` flow, launch
  the committed placeholdered configs as-is, load the repo root as the unpacked
  extension, or reuse `orchestration/profiles/follower` just to open a browser
  for manual observation.
