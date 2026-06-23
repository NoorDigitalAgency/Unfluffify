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

## Do NOT use this skill for

- Headless unit/integration tests (`deno task test`) — those do not need a
  visible browser.
- Orchestration scenarios under `orchestration/profiles/*` — only use those when
  the user explicitly asks for the orchestration browser path.

## Canonical configuration (do not improvise)

Launch through the `.vscode/mcp.json` server `playwright-local`, which runs:

- `deno run -A npm:@playwright/mcp@latest`
- `--user-data-dir=/home/rojan/Documents/Git/GitHub/Unfluffify/.mcp-browser-profile`
- `--config=/home/rojan/Documents/Git/GitHub/Unfluffify/.vscode/browser-mcp.config.json`

`.vscode/browser-mcp.config.json` is the canonical live-test browser config:

- visible Chromium (`headless: false`)
- `ignoreDefaultArgs: ["--disable-extensions"]` so the extension can load
- persistent profile in `.mcp-browser-profile`
- loads the unpacked extension from `dist/extension-dev` via
  `--load-extension` / `--disable-extensions-except`

## Procedure

1. **Build the dev extension first.** The loadable unpacked root is the built
   output, not the source checkout root. Run:

   ```
   deno task build:dev
   ```

   This produces `dist/extension-dev`. Use `dist/extension` only when the user
   explicitly asks for the non-dev/release build.

2. **Launch the `playwright-local` MCP browser** with the config above. Do not
   hand-roll a `launchPersistentContext()` flow and do not reuse
   `orchestration/profiles/*` for simple observation.

3. **Reload the unpacked extension after every rebuild.** The persisted Chromium
   profile can keep an older MV3 service worker alive even though files on disk
   changed. If removed debug logs or stale behavior still appear:
   - call `chrome.runtime.reload()` from the extension context, or
   - reload the extension on `chrome://extensions`,

   then wait for the new service worker to come up before retesting.

4. **Target the popup with the debug pattern** when you need the popup bound to a
   specific tab:

   ```
   chrome-extension://<extension-id>/popup.html?debugTabId=<tabId>
   ```

## Guardrails

- Do not assume the repo root
  (`/home/rojan/Documents/Git/GitHub/Unfluffify`) is loadable as an unpacked
  extension. It lacks the built JS entrypoints Chrome needs (e.g.
  `background.js`, `popup.js`, `content-loader.js`), so service-worker waits and
  popup targeting will fail if the repo root is loaded directly.
- Always load `dist/extension-dev` (or `dist/extension` for explicit release
  runs), never the source checkout root.
- Do not default to `orchestration/profiles/*` Playwright flows for simple live
  observation; those are for orchestration scenarios and can fail on
  service-worker waits or profile-lock issues.

## Example

- Right: build `dist/extension-dev`, launch the `playwright-local` MCP browser
  with `.vscode/browser-mcp.config.json` and `.mcp-browser-profile`, reload the
  unpacked extension, then open
  `chrome-extension://<id>/popup.html?debugTabId=<tabId>`.
- Wrong: hand-roll a fresh `launchPersistentContext()` flow, load the repo root
  as the unpacked extension, or reuse `orchestration/profiles/follower` just to
  open a browser for manual observation.
