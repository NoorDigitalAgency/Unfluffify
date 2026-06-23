---
description: Repository-specific rules for launching live test browsers
---

When a user asks to start a live test browser for this repository, launch it with
the committed one-command launcher — do NOT improvise ad hoc Playwright launch
code, do NOT drive the OS Chrome, and do NOT use the orchestration browser
helpers.

## Canonical command

```
deno task browser:live <target-url>
```

Example: `deno task browser:live https://bonliva.se`

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

Pass `--no-build` to skip the dev rebuild. By default the launcher rebuilds
`dist/extension-dev` first so the browser always loads current code.

## What `deno task browser:live` does (and why)

The launcher performs the exact, proven flow so a low-context agent does not have
to re-derive it:

1. Resolves the active repository root from its own file location — works in any
   environment, with no hardcoded machine paths.
2. Builds the dev extension (`deno task build:dev` -> `dist/extension-dev`)
   unless `--no-build` is given. `dist/extension-dev` is the loadable unpacked
   root; never load the source checkout root (it lacks `background.js`,
   `popup.js`, `content-loader.js`, etc.).
3. Materializes a launchable, per-environment copy of the placeholdered config
   into the gitignored `.temp/browser-mcp.config.json`: it substitutes
   `__UNFLUFFIFY_REPO_ROOT__` with the resolved root and DROPS `executablePath`
   entirely so Playwright uses its own managed Chromium (never the OS browser).
   The committed `.vscode/mcp.json`, `.mcp.json`, and
   `.vscode/browser-mcp.config.json` stay placeholdered and intentionally
   non-launchable; never edit them to bake in current-environment paths.
4. Ensures the MCP-managed Chromium is installed
   (`deno run -A npm:@playwright/mcp@latest install-browser chromium`,
   idempotent).
5. Starts `npm:@playwright/mcp@latest` over stdio (a single client = no
   profile-lock) with `--user-data-dir=<repoRoot>/.mcp-browser-profile` and
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
bound popup URL.

## Use only the Playwright MCP browser; never touch the OS Chrome

- Operate only the Playwright MCP managed Chromium bound to
  `.mcp-browser-profile`, exclusively via `deno task browser:live` /
  `npm:@playwright/mcp@latest`.
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
service worker before retesting. Re-running `deno task browser:live` from a clean
stop rebuilds and reloads from scratch.

## Debugging the launcher (internals)

If you must drive the MCP browser by hand (e.g. to extend the flow), mirror
`scripts/launch-test-browser.ts` and `orchestration/steps/browser.mjs`:

- The `browser_run_code_unsafe` sandbox is NOT a full Node context: `setTimeout`
  and `URL` are undefined there. Use Playwright APIs (`page.waitForTimeout`) and
  plain string ops (`String(url).split('/')`) in the outer function. The inner
  `worker.evaluate(...)` body runs in the extension service worker, where
  `chrome.*` and `setTimeout` are available.
- Use a single MCP client/connection. A second connection to the same
  `--user-data-dir` fails with "Browser is already in use"; one stdio client
  avoids the profile lock without `--shared-browser-context`.

## Do not

- Do not launch without a user-instructed target page.
- Do not run the OS Chrome binary, `open -a 'Google Chrome'`, set
  `executablePath` to the OS browser, or drive/quit the OS Chrome with
  `osascript`.
- Do not hardcode a stale extension id; resolve it at runtime / from the load
  path.
- Do not point `debugTabId` at the popup's own tab.
- Do not hand-roll a `launchPersistentContext()` flow, launch the committed
  placeholdered configs as-is, load the repo root as the unpacked extension, or
  reuse `orchestration/profiles/*` for simple live observation.
