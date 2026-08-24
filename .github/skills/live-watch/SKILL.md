---
name: live-watch
description: Run a full live observation session for the Unfluffify extension — ask for a URL, start pnpm dev:no-browser + pnpm browser:live, attach a raw-CDP console/JS-stack observer over popup + target page + background service worker, signal ready, then triage user-reported bugs (backlog vs stop) and route to make-plan or safe-change + review-push. Use when the user wants to drive the extension live while you watch everything and collect bugs.
---

# Run a Live Observation Session

Use this skill when the user wants to **exercise the extension themselves** while
you watch the whole system live — both build/runtime terminals, the page, and the
extension — capture every bug they report, and then route the collected bugs to a
plan or a fix.

This skill composes two existing skills; do not improvise around them:

- `live-browser` — the ONLY supported way to open the live Chromium with
  the unpacked extension loaded (`pnpm browser:live <url>`).
- `live-round` — the `pnpm dev` + launcher lifecycle and recovery.

It adds the **observation + triage + routing loop** on top.

## Hard rules

- A target page URL is **mandatory**. If the user did not give one, STOP and ask
  for it (one question). Never guess, never reuse a previous URL.
- Operate only the launcher-owned managed Playwright MCP Chromium. Never touch the
  OS Chrome, never set `executablePath` to the OS browser, never `osascript`/
  `open -a`. See `live-browser`.
- Never start a second MCP client/server against the same `.wxt/browser-profile`.
  Inspect the already-open browser only via the launcher control channel or the
  CDP endpoint `http://127.0.0.1:9222`.
- `pkill`/`killall` are not permitted in this environment. Stop processes with
  `stop_bash` (for shells you own) or `kill <PID>`.
- Do not edit `src/` during observation. Observation only reads; fixes happen
  later, after the user picks a route.

## Step 1 — Ask for the target URL

If the user has not already named the page, ask exactly one multiple-choice-style
question for the URL and wait. Do not launch until you have it.

## Step 2 — Pre-flight: clear stale processes

Confirm no stale launcher/MCP/dev processes are holding the profile or port:

```bash
pgrep -af "launch-test-browser.mjs|@playwright/mcp|wxt|remote-debugging-port=9222" || echo "clean"
```

If anything is left over from a previous run, stop those shells (`stop_bash`) or
`kill <PID>` before continuing.

## Step 3 — Start the dev server (no browser)

Start the WXT dev server WITHOUT its own browser, so the only Chromium is the
launcher's:

```bash
pnpm dev:no-browser
```

Run it `mode="async"` and keep the shellId (e.g. `dev-server`). Wait for the
"built" / server-ready banner. Note: `dev:no-browser` builds `.output/chrome-mv3-dev`,
while `pnpm browser:live` builds and loads `.output/chrome-mv3` — they are
separate outputs. See `live-round` for lifecycle/recovery details.

## Step 4 — Launch the live browser bound to the page

```bash
pnpm browser:live <target-url>
```

Run it `mode="async"`, keep the shellId (e.g. `browser-live`). It rebuilds
`.output/chrome-mv3`, opens the page, resolves the extension id at runtime, and
opens the popup bound to the page tab. Wait for the
"live test browser ready" banner and record the printed extension id, page tabId,
bound popup URL, and actual side-panel URL. Confirm binding with the launcher
control command `state`.

## Step 5 — Attach the full-console / JS-stack observer

The launcher control channel only summarizes a few buttons. For COMPLETE console
coverage across the popup, the target page, AND the background service worker
(with JS stacks), attach the raw-CDP observer to the SAME live browser over its
CDP endpoint — this does not open a second profile:

```bash
node scripts/observe-live-console.mjs >> .temp/cdp-observer.log 2>&1
# or: pnpm browser:observe >> .temp/cdp-observer.log 2>&1
```

Run it `mode="async"` (e.g. shell `cdp-observer`) and `tail` the log. The observer
streams `console.*`, uncaught exceptions, and `Log.entryAdded` warnings/errors from
every attached target, tagged by target type/url, with short stack frames. It only
reads — it never closes the browser. It de-duplicates targets so each console line
appears once. `.temp/` is gitignored; the log is a throwaway session artifact.

Render Inspection is the one deliberate observer exception: Chrome permits only
one debugger owner for the website tab, and the extension itself must own that
slot. Immediately before clicking With/Without JavaScript, send `stop-observe`,
stop this raw-CDP observer, and close one-shot CDP clients. Drive the controls
through the real `popup.html` side-panel target, not the `?debugTabId=` tab. Do
not attach to the website target until the inspection is set or cancelled; then
restart the observer and launcher observation. Record the pause/restart boundary
in the live evidence so the coverage gap is explicit.

For fresh popup view-state on demand, prefer a CDP one-shot over reading the huge
launcher stdout buffer:

```bash
node --input-type=module -e '
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0];
const popup = ctx.pages().find((p) => p.url().includes("/popup.html"));
console.log(JSON.stringify(await popup.evaluate(() => window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()), null, 2));
await b.close();
'
```

Close only the CDP client (`b.close()`); never kill the launcher from a one-shot.

## Step 6 — Signal ready

Once the dev server, live browser (bound popup), and observer are all confirmed
healthy, tell the user you are observing everything and they can start using the
system. Keep the three shells running.

## Step 7 — Triage each reported bug

For every issue the user reports, BEFORE moving on:

1. Capture evidence immediately:
   - popup `getViewState()` + relevant DOM (CDP one-shot, Step 5).
   - the matching `console.*` / exception / `Log` lines from the observer log,
     including stacks.
2. Record the bug in the session DB so it survives context summarization:

   ```sql
   CREATE TABLE IF NOT EXISTS session_bugs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     evidence TEXT,
     status TEXT DEFAULT 'reported',
     created_at TEXT DEFAULT CURRENT_TIMESTAMP
   );
   INSERT INTO session_bugs (title, evidence) VALUES ('<short title>', '<view-state + console evidence>');
   ```

3. Ask the user exactly one question: **backlog this and keep observing, or stop
   observing and go to the next step?** Keep looping (stay in Step 7) until they
   choose to stop.

## Step 8 — Stop cleanly

When the user says stop, tear down in reverse order and verify nothing is left:

```bash
# stop_bash cdp-observer ; stop_bash browser-live ; stop_bash dev-server
pgrep -af "launch-test-browser.mjs|@playwright/mcp|wxt|remote-debugging-port=9222" || echo "ALL_STOPPED"
```

## Step 9 — Route the backlog

Ask the user exactly one question: for the reported bugs, do they want
**make-plan** or a **safe-change followed by
review-push**? Then act:

- **Thorough planning** → invoke the `make-plan` skill. Produce a deterministic,
  file-cited plan
  and a SQL todo chain. Do NOT edit `src/` (planning only) unless the user later
  asks to implement.
- **Fix now** → invoke `safe-change` for each bug (read knowledge +
  exact source/tests first, keep changes scoped, add regression coverage), then
  run `review-push` to review, validate
  (`pnpm lint && pnpm check && pnpm test && pnpm build`), commit, and push.

Re-validate core unflagged behavior live with `pnpm browser:live <url>` when a fix
touches runtime behavior; reload the unpacked extension/service worker after any
rebuild before re-observing (see `live-browser`).

## Cleanup

Remove throwaway artifacts when the session ends:

```bash
rm -f .temp/cdp-observer.log
```

The reusable observer (`scripts/observe-live-console.mjs`) and its
`pnpm browser:observe` alias are committed; only the `.temp` log is disposable.
