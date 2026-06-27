# Unfluffify Active Architecture Plan

Last updated: 2026-06-27

## Objective

Keep the active architecture index aligned with the repository's finalized WXT
runtime. The extension now ships from the WXT-native `src/` tree, public assets
come from `src/public/`, the popup UI is React/JSX, and no new content/runtime
refactor track is approved beyond the paused post-H3 state.

## Read this first before changing code

1. `.copilot/knowledge.md`
2. `.github/instructions/*.instructions.md`
3. `.github/skills/*/SKILL.md` relevant to the task

The completed WXT-migration, type-safety, post-WXT cleanup, and final
WXT-finalization (test cleanup, TS port, React UI port, Preact removal, logo
fix, extensionless imports, lint pass) plan/progress docs were removed from the
workspace; their durable outcomes live in `.copilot/knowledge.md`. Use git
history if earlier rationale is needed.

There is one open implementation plan below: **Dev/Live-Browser Tooling
Hardening**, opened 2026-06-27 after a live migration-regression sweep.

---

## Open Implementation Plan: Dev/Live-Browser Tooling Hardening (2026-06-27)

### Goal

Make the post-migration developer/test tooling (`pnpm dev*` and
`pnpm browser:live`) work reliably on headless and non-interactive hosts, and
record the live-runtime verification status of the JS->TS + vanilla->WXT
migrations so a future agent does not re-derive it.

### Investigation summary (what was actually observed on 2026-06-27)

A live sweep was run against `https://www.bonliva.se/` with `pnpm dev:no-browser`
plus `pnpm browser:live` (managed Playwright-MCP Chromium), inspecting popup,
background service worker, and content-script consoles over CDP
(`http://127.0.0.1:9222`).

**Runtime verdict: the migrated runtime is clean on every testable surface.**

- Background SW boot logs only `console.info "Unfluffify background worker ready"`;
  no errors/warnings/exceptions.
- Popup loads on the gated Configuration view; `__UNFLUFFIFY_POPUP_DEBUG__
  .getViewState()` returns full state; no console/page errors. Endpoint inputs +
  "Set" handlers persist values with no handler errors.
- Content script (`content-scripts/content-loader.js`) injects at
  `document_start` on the target with no errors; MAIN-world freeze bridge present.
- Popup fonts/icons/styles load (the earlier `fonts.css` /
  `materialdesignicons.min.css` 404s and `Bus publish listener rejected` noise
  were already fixed in commit `2698449`). The only console errors are the target
  site's own third-party `cdn.acsbapp.com/config/...` 404 (not extension-related).
- Static sweep: every `utils.getExtensionResourceUrl(...)` target
  (`offscreen.html`, `popup.html`, `assets/materialdesignicons-webfont.woff2`,
  `cursors/exclude.svg`, `cursors/include.svg`) is bundled or web-accessible; the
  only raw `chrome.*` usage is the sanctioned `common/storage-core.ts` seam and
  the locked `common/page-motion-freeze-bridge.ts`.

No new extension-code runtime regression from the migrations surfaced. The two
real findings are tooling/environment issues, and the deep functional flows are
unverified because they are gated behind real backend credentials.

### Current facts (verified)

- `scripts/launch-test-browser.mjs` has **no** headless/`$DISPLAY`/Xvfb handling
  (confirmed by grep). On a headless host the managed Chromium dies with
  `Missing X server or $DISPLAY` during popup binding. Wrapping the whole command
  in `xvfb-run -a --server-args="-screen 0 1280x900x24" pnpm browser:live <url>
  --no-build` makes it reach `live test browser ready` and bind the popup
  (`debugTabId`) successfully.
- `web-ext.config.ts` sets `disabled: UNFLUFFIFY_NO_BROWSER==='1'` and
  `chromiumArgs: ['--user-data-dir=./.wxt/browser-profile']`; it has no headless
  handling either.
- `pnpm dev` / `pnpm dev:no-browser` builds `.output/chrome-mv3-dev` then the
  process exits; the Vite dev server on `http://localhost:3000` closes and no
  `wxt`/`vite` watcher survives. Reproduced 3x including fully detached
  (`setsid ... < /dev/null`), so it is not a SIGHUP artifact. Root cause is
  **not yet proven**: most likely the WXT/web-ext CLI exiting on non-TTY stdin
  EOF (`< /dev/null`), but possibly the `disabled:true` no-browser runner path.
  The `dev-live-round-control` skill assumes `pnpm dev` "is healthy and still
  running", so this gap breaks that documented workflow on non-interactive hosts.

### Decisions already made (constraints)

- Browser/live validation must keep using only `pnpm browser:live` and the
  managed Playwright-MCP Chromium bound to `.wxt/browser-profile`; never the OS
  Chrome (`.github/instructions/browser-launch.instructions.md`).
- Committed `.vscode/mcp.json`, `.mcp.json`, `.vscode/browser-mcp.config.json`
  stay placeholdered and non-launchable.
- Do not touch locked marking/highlighting/property-lock contracts or the
  storage/browser seams while fixing tooling.

### Open questions (resolve before coding)

1. Headless strategy: (a) auto-detect missing `$DISPLAY` in
   `scripts/launch-test-browser.mjs` and self-wrap with `xvfb-run`; (b) add a
   separate `pnpm browser:live:headless` script; or (c) document the `xvfb-run`
   requirement only. Recommended: (a) with a clear log line, falling back to a
   documented manual `xvfb-run` path.
2. Dev-server persistence: confirm whether `pnpm dev` stays alive under a real
   TTY (e.g. `script -qec 'pnpm dev:no-browser' /dev/null`) before changing any
   config, so we do not "fix" a non-TTY-only artifact.

### Non-goals

- No extension runtime/behavior changes; this plan is tooling + docs only.
- Do not change `wxt.config.ts` manifest contract, WARs, or popup bundling.
- Do not modify locked contracts or seams.

### Implementation phases

**Phase 1 - Diagnose dev-server exit (no code change yet).**

- Run `script -qec 'pnpm dev:no-browser' /dev/null` (TTY) and, separately,
  `pnpm dev:no-browser < /dev/null` (non-TTY); compare whether the Vite server on
  `:3000` persists.
- Expected outcome: a definitive root cause (TTY/stdin-EOF vs runner config).
- Validation: `curl -sf http://localhost:3000/` succeeds while the command runs.
- Fallback: if it persists under a TTY, the fix is documentation only (note that
  `pnpm dev` needs an interactive terminal / `--watch`-style invocation), not a
  config change.

**Phase 2 - Headless live-browser support in `scripts/launch-test-browser.mjs`.**

- Edit `scripts/launch-test-browser.mjs`: if `process.env.DISPLAY` is empty and
  an `Xvfb`/`xvfb-run` binary is available, start (or wrap with) a virtual
  display before launching the MCP Chromium; log the chosen path. Otherwise keep
  current behavior and print an actionable hint pointing at `xvfb-run`.
- Keep `.temp/browser-mcp.config.json` generation, the single launcher-owned MCP
  client, deterministic-id cross-check, and popup `debugTabId` binding unchanged.
- Validation: on a host with no `$DISPLAY`, `pnpm browser:live <url> --no-build`
  reaches `live test browser ready` without manual `xvfb-run`.

**Phase 3 - Docs/skills/knowledge alignment.**

- Update `.github/skills/launch-test-browser/SKILL.md`,
  `.github/skills/dev-live-round-control/SKILL.md`, and
  `.github/instructions/browser-launch.instructions.md` with the headless
  requirement/behavior and the verified `xvfb-run` fallback command.
- Add a `.copilot/knowledge.md` fact for headless live-browser runs and the
  non-TTY dev-server caveat (per Phase 1 result).
- Validation: `git --no-pager diff --check`.

**Phase 4 - Gated-flow verification (requires user-supplied config).**

- The AI content detection, marking, content-list, save / Send-to-Lynx,
  render-mode inspection, and property-lock flows are gated behind a real
  Configuration Endpoint + AI Endpoint + Stage Base + login and were NOT
  exercised live. Once the user supplies a staging config/credentials, drive the
  flow per `dev-live-round-control` and capture popup/SW/content console + page
  errors via CDP. Do not fabricate credentials.

### Test matrix

- Tooling phases: targeted manual runs of `pnpm dev:no-browser` and
  `pnpm browser:live <url> --no-build`, plus existing
  `tests/playwright-mcp-config.test.ts`.
- Repo guard (after any script/config edit): `pnpm lint`, `pnpm check`,
  `pnpm test`, `pnpm build`.
- Docs-only edits: `git --no-pager diff --check`.

### Regression risks

- Highest risk: breaking the proven launcher flow (profile-lock, deterministic
  id, popup binding). Protect by leaving the MCP-client/config/binding logic
  untouched and only gating the display setup ahead of launch.
- Risk: a dev-config change that "fixes" a non-TTY-only artifact and regresses
  normal interactive `pnpm dev`. Protect with Phase 1 TTY-vs-non-TTY diagnosis
  before any config edit.

### Acceptance criteria

- `pnpm browser:live <url> --no-build` reaches `live test browser ready` on a
  headless host without a manual `xvfb-run` wrapper (or the requirement is
  clearly documented if option (c) is chosen).
- The dev-server-exit root cause is documented, and `pnpm dev`'s expected
  lifecycle on interactive vs non-interactive hosts is stated in the skills.
- `.copilot/knowledge.md` and the two browser/dev skills reflect the headless
  and non-TTY realities.
- Repo validation (`pnpm lint && pnpm check && pnpm test && pnpm build`) stays
  green.

### Todo chain

1. Phase 1 dev-server-exit diagnosis (TTY vs non-TTY).
2. Phase 2 headless launcher support.
3. Phase 3 docs/skills/knowledge updates.
4. Phase 4 gated-flow verification once credentials are provided.

## Current state

1. The shipped runtime is WXT-native end to end:
   - source code lives under `src/`
   - entrypoints live under `src/entrypoints/`
   - shared types live under `src/types/`
   - stable public assets live under `src/public/`
   - `wxt.config.ts` is the sole manifest source of truth
2. The popup UI is React/JSX (`src/popup/ui.tsx`); Preact is fully removed.
   Relative imports under `src/**` are extensionless except the locked
   page-motion freeze pair.
3. The public workflow is pnpm/Node-only:
   - validation: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`,
     `pnpm verify`
   - packaging: `pnpm zip`, `node ./scripts/package-extension.mjs`
   - live browser: `pnpm browser:live <target-url>`
   - orchestration: `pnpm orchestrate:*`
   - tests: all automated coverage lives under `tests/`
4. The WXT migration, post-WXT cleanup/type-safety finalization, and the final
   WXT-finalization pass are complete and merged to `main`; their durable
   outcomes are captured in `.copilot/knowledge.md`.
5. Event-bus Tracks 0-4 and Part C native WXT adoption are complete.
6. Track H remains paused after H3 by design. Do not resume deeper
   `content-main` extraction unless a new written plan is approved.

## Guardrails

1. Do not change locked marking/highlighting/property-lock contracts without an
   explicit new plan.
2. Keep Chrome storage access behind the approved storage/domain modules guarded
   by `tests/storage-access-boundary.test.ts`.
3. Keep the WXT/browser seams intact:
   - `common/browser.ts` remains the browser-compatible extension API seam
   - `common/storage-core.ts` remains the storage seam
   - generated manifest output must keep stable WAR/icon/cursor paths
4. For browser/live validation, use only `pnpm browser:live <target-url>` and
   the managed Playwright MCP Chromium.

## Marking Contract Lock

The 052c-derived marking restoration is complete and remains a
locked compatibility contract. Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking contract change.

Key reminders for any future work in this area:

1. Keep silent-highlighting and marking behavior aligned with
   `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Keep selector/default precedence and overlay projection behavior unchanged
   unless the task explicitly authorizes a contract change.
3. Keep AI submission behavior aligned with the locked contract: submit every stored excluded XPath row as excluded.

## Validation policy

1. Source changes: iterate with focused tests, then run `pnpm lint`,
   `pnpm check`, `pnpm test`, and `pnpm build`.
2. Docs-only changes: run `git --no-pager diff --check`.
3. Live validation is required for core unflagged browser behavior when tests
   and source review are not enough.

## Model recommendation

Use a strong reasoning model for non-trivial runtime changes. Do not let a
low-context executor infer new product behavior, reopen retired architecture
tracks, or continue the paused Track H work by continuity alone.
