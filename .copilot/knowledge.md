# Unfluffify Knowledge

## Agent Workflow Assets

- Repository-level repeatable workflows live in `.github/skills/`. Use
  `.github/skills/branch-sync/SKILL.md` before starting
  repository work so the current branch is checked against upstream and clean
  behind-only branches are fast-forwarded before task execution; invoke the
  `branch-sync` skill directly when it is exposed in the
  environment. Read-only review/inspection and entering
  `review-push` on an already-dirty worktree are exempt,
  `review-push` for clean-review/fix/commit/push loops,
  `.github/skills/run-plan/SKILL.md` only when the user explicitly
  wants autonomous active-plan execution to continue through
  `review-push`; invoke the `run-plan` skill directly
  when it is exposed in the environment,
  `make-plan` for precise implementation handoffs,
  `safe-change` before non-trivial source edits,
  `live-round` for stable pnpm dev + pnpm browser:live rounds with
  launcher/popup control verification and stuck-state recovery,
  `repo-knowledge` when updating durable architecture knowledge, and
  `consult-architect` before architecture, design, state-machine ownership, or
  advanced problem-solving work that introduces a new direction unless an
  explicitly approved handoff, plan, or direct user instruction already carries
  the approved direction,
  `live-browser` to open the live/dev Chromium with the unpacked
  extension loaded for observation or manual testing.
- Repository discovery is `codebase-memory-mcp`-first: refresh the graph with
  `codebase-memory-mcp-index_repository` at session start (or before the first
  substantive repo task if that refresh has not happened yet), after every
  commit, and again after every push, then prefer `search_graph`, `search_code`,
  `get_code_snippet`, and `trace_path` before `rg`, `glob`, or manual file
  hunts.
- Live test browser: launch with `pnpm browser:live <target-url>`
  (`scripts/launch-test-browser.mjs`).
  A target URL is mandatory. It runs `pnpm build`, loads `.output/chrome-mv3`,
  and on Linux hosts with no `DISPLAY`/`WAYLAND_DISPLAY` it now auto-relaunches
  itself through `xvfb-run -a --server-args="-screen 0 1280x900x24"` when that
  wrapper is installed. If `xvfb-run` is unavailable, the launcher prints the
  exact manual wrapper command and stops before trying to boot Chromium. It
  writes a per-environment `.temp/browser-mcp.config.json` (drops
  `executablePath`), and drives ONLY the `npm:@playwright/mcp@latest` managed
  Chromium through the Node-backed launcher (`npx -y @playwright/mcp@latest`
  under the hood) over a single launcher-owned stdio client — never the OS
  Chrome. The
  launcher exposes a same-session control channel on its shell `shellId`; when
  the host environment supports writing to that running shell, use `state`,
  `exit-preview`, `observe`, `stop-observe`, and `help` there to
  inspect/control the bound popup and target page. Otherwise rely on the
  auto-enabled observation output plus `chromium.connectOverCDP(...)` against
  `http://127.0.0.1:9222` for active inspection/control of the already-open page
  and extension popup. Do not start a second MCP client/server for the same
  `.wxt/browser-profile`. The committed `.vscode/mcp.json`, `.mcp.json`, and
  `.vscode/browser-mcp.config.json` are intentionally placeholdered
  (`__UNFLUFFIFY_REPO_ROOT__`, `__CHROMIUM_EXECUTABLE_PATH__`) and
  non-launchable. Unpacked extension id is deterministic: SHA-256 of the
  absolute load path, first 16 bytes, each nibble mapped `0..15 -> 'a'..'p'`.
  Inside `browser_run_code_unsafe`, `setTimeout` and `URL` are undefined — use
  `page.waitForTimeout` and string ops.
- Dev browser startup mode is explicit: `pnpm dev` auto-opens browser by default,
  while `pnpm dev:no-browser` sets `UNFLUFFIFY_NO_BROWSER=1` and runs WXT with
  browser auto-open disabled (preferred when paired with `pnpm browser:live`).
  A 2026-06-27 recheck showed `pnpm dev:no-browser` stayed resident both under
  `script -qec 'pnpm dev:no-browser' /dev/null` and
  `bash -lc 'exec </dev/null; pnpm dev:no-browser'`; no stdin/TTY workaround is
  required in this repo for that command, and WXT will move to the next free
  localhost port if `3000` is already occupied.
- Always-on workflow guardrails live in
  `.github/instructions/agent-workflow-guardrails.instructions.md`. Future
  agents should read the knowledge base, relevant instructions/skills, active
  plan, source files, and tests before changing behavior.
- If a behavior decision is unclear and an explicitly approved handoff, plan,
  or direct user instruction does not already answer it, future agents should ask a
  deterministic multiple-choice question instead of guessing and encoding drift
  into code or docs. In no-user-available runs, only stop on a true blocker or
  a no-safe-default fork.
- For architecture or design-heavy work that introduces a new direction, future
  agents should consult @Sojaner early with the root cause, proposed direction,
  and one deterministic multiple-choice question unless that decision is already
  explicitly approved in a handoff, plan, or direct user instruction.
  If a new architecture decision appears while the user is unavailable, stop and
  document the blocker instead of guessing.

## Testing

- Use pnpm/WXT as the primary release/CI toolchain: `pnpm lint`, `pnpm check`,
  `pnpm test`, `pnpm build`, `pnpm zip`, and `pnpm verify`.

### Live-QA pitfalls (2026-07-03, learned the hard way)

- Exclude-mode clicks on an ALREADY-excluded element resolve to no target — a
  designed no-op (`getMarkableTarget` filters by the excluded set). A scripted
  mark click must land on content NOT covered by an existing `.uf-rect`, or it
  registers no user edit at all. The run-flow2 planner enforces this; any new
  click harness must too. Symptom otherwise: `toggle.target-resolution
  {hasTarget:false}` with zero draft/machine movement while auto-seeded drafts
  still flip `sessionHasPendingChanges` (which is NOT proof a click landed).
- CDP `DOMDebugger.getEventListeners` does NOT see listeners registered from
  the extension's isolated world (it enumerates only the caller's JS world).
  An empty listener list on a content-script element proves nothing; probe
  liveness with a dispatched untrusted event and watch for handler effects
  (e.g. `[Unfluffify][toggle-perf]` lines with
  `localStorage["unfluffify:toggle-perf"]="1"`).
- Background popup TABS get throttled/frozen by Chrome and wedge their CDP
  socket (evals time out). Keep the QA popup in its OWN focused window
  (`chrome.windows.create({url: popup.html?debugTabId=...})`), and recreate
  it rather than poking a wedged one.
- A tab stuck on an unhandled beforeunload dialog blocks its whole CDP target
  (`Page.enable` times out) and can hang `chrome.tabs.remove` awaits. Replace
  the tab (`tabs.create` + fire-and-forget remove) and re-pin the popup's
  `debugTabId` to the new tab id.
- `.temp/nav-reset.mjs` navigates with an auto-accepting beforeunload handler;
  ALWAYS navigate through it (never `tabs.reload` after `runtime.reload` —
  orphaned content instances).
- Reveal/freeze DOM measurements: attach the CDP sampler to the page target
  BEFORE navigating (targets persist across same-tab navigation) or the walk
  finishes before you look; sample nodes + scrollY + docH + the
  `uf-page-motion-paused` class. The brain only drives a tab's directives
  when a popup exists for it — cold/warm comparisons must keep a popup
  present in BOTH arms. COLD = fresh extension + fresh page; WARM = refresh
  of the same page (the editor sync on the cold pass changes what the warm
  pass has to reveal: synced entries appear only after the first visit).
- The shipped extension build, packaging flow, live-browser launcher, and
  orchestration CLIs are now pnpm/Node-based and WXT-native. The repository no
  longer depends on Deno for CI, packaging, browser launch, or orchestration.
- All automated tests now live under `tests/`. The old `vitest-tests/` split and
  dedicated Deno runtime shim files are gone.

## WXT migration facts

- The shipped WXT source tree now lives under `src/`: runtime modules in
  `src/background`, `src/common`, `src/content`, `src/offscreen`, and
  `src/popup`; entrypoints in `src/entrypoints`; shared types in `src/types`;
  stable public assets in `src/public`.
- WXT treats `src/entrypoints/popup/index.html` as a special popup entrypoint
  and auto-generates `action.default_popup`. Unfluffify keeps the manifest
  contract entirely in `wxt.config.ts` (version from `package.json`); there is
  no root `manifest.json`. The generated manifest still needs its `action`
  block restored to the source contract before shipping.
- WXT emits content-script bundles under `content-scripts/<name>.js`. After C5,
  Unfluffify's source manifest and manual injection paths use those native WXT
  output paths directly instead of materializing root alias files.
- C6 browser polyfill adoption starts from `common/browser.ts`, which is now the
  runtime seam for browser-compatible extension APIs. Shared one-shot messaging,
  bus transports, and touched type positions should import `browser` /
  `Browser.*` from that seam instead of reaching for raw `chrome.*` directly.
- Promise-capable callers should use the exported `common/browser.ts` proxy or
  its `callBrowserApi` / `callBrowserApiVoid` helpers. That seam now normalizes
  promise-only `globalThis.browser` hosts and callback-style `globalThis.chrome`
  hosts so migrated runtime code does not assume a single async convention.
- The WXT build must also copy stable manifest-named public assets into the
  output root: `assets/materialdesignicons-webfont.woff2`,
  `cursors/exclude.svg`, `cursors/include.svg`, and the default icon set under
  `icons/default/`. WXT still emits hashed CSS/font assets for the popup bundle,
  but the manifest, cursor `getURL(...)` calls, and package staging contract
  depend on these stable output paths existing alongside the hashed assets.
- Do not import the legacy browser-source entry roots directly from WXT
  entrypoint definition files. WXT imports those files in Node during
  prepare/build, which drags browser code into the WXT/Node typecheck and
  reintroduces Node-vs-DOM timer conflicts. Runtime-load mirrored built JS from
  the output tree instead.
- Once a WXT entrypoint starts importing a real browser runtime graph directly
  (for the native-bundling cutover), keep the WXT typecheck split between
  **browser entrypoints** and **Node config files**. In this repo that means
  `tsconfig.wxt.json` should stay browser-typed (`chrome`, DOM/WebWorker libs)
  for `src/entrypoints/**/*.ts`, while `wxt.config.ts` / `vitest.config.ts`
  live in a separate Node-typed project (`tsconfig.wxt-node.json`). Mixing Node
  globals into the entrypoint graph reintroduces timer-signature conflicts in
  browser code such as `src/common/page-motion-freeze-control.ts`.
- When the popup runtime is imported into the WXT browser entrypoint graph, do
  not type shared timer helpers against bare global `setTimeout` /
  `setInterval` return types. In this repo those can drift to Node `Timeout`
  under mixed tooling. Popup/browser helpers should use browser-owned timer
  surfaces (`Window["setTimeout"]`, `Window["setInterval"]`, or an explicit
  `WindowOrWorkerGlobalScope` timer API) so popup state fields, spinner
  watchdogs, and async-message timeouts remain compatible with the WXT browser
  typecheck.
- The live browser launcher no longer imports `chrome.runtime.getURL("popup/ui.js")`
  from the built extension. Popup live-debug inspection now reads
  `window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` from the running popup page
  so the build can stay WXT-native without mirroring the old popup module tree.
- `scripts/package-extension.mjs` must expand wildcard manifest
  `web_accessible_resources` entries (currently `cursors/*.svg`) when staging
  the release zip. The bundled content script references those cursor assets via
  runtime `getURL(...)`, so only reading literal quoted JS imports is not enough
  to produce a complete release package.
- Even after the content entrypoint native-bundles `content-main.ts`, the raw
  runtime message handshake `chrome.tabs.sendMessage(tabId, { type:
  "activateContentMain" })` must keep returning `{ ok: true, initialized: true
  }`. Background bootstrap (`ensureContentMainForTab`) still depends on that
  legacy reply contract while later phases keep the old retry/injection path
  alive.
- `common/page-motion-freeze-control.ts` and
  `common/page-motion-freeze-bridge.ts` are a locked pair: the control function
  body from `const STATE_KEY = "__unfluffifyPageMotionFreezeState";` through the
  final `return buildResult();` must stay byte-identical modulo stripped
  `@ts-` comments, and the bridge source is `eval`'d as plain JavaScript in
  tests. Any typing needed for the module copy must live **before** the
  `STATE_KEY` marker or outside that shared body, otherwise parity/eval tests
  fail.
- Runtime suppression tracking is now down to that locked page-motion pair only:
  `tests/fixtures/ts-suppression-budget.json` should list just
  `src/common/page-motion-freeze-bridge.ts` and
  `src/common/page-motion-freeze-control.ts` as the intentional exempt floor.
- Release packaging now stages from the synced WXT output at
  `.output/chrome-mv3`. `pnpm verify` runs the pnpm lint/check/test pipeline,
  rebuilds via `pnpm build`, and then runs the generated-manifest permission
  test directly. The release workflow uses `pnpm zip` for a synced
  `.output/chrome-mv3` archive, then `scripts/package-extension.mjs` to preserve the stable
  `extension-latest` / `Unfluffify-latest.zip` alias semantics.
- The popup UI is React/JSX in `src/popup/ui.tsx` (Preact is fully removed; no
  vendored runtime remains). React tooling is wired via `@wxt-dev/module-react`
  (build) and `@vitejs/plugin-react` (Vitest); `tsconfig.json` uses
  `jsx: react-jsx` and includes `src/popup/**/*.tsx`. `createRoot().render()` is
  async — any code that reads refs/DOM immediately after a render must wrap it in
  `flushSync(...)`, and React render errors do NOT surface through caller
  `try/catch`; recovery uses `createRoot(el, { onCaughtError, onUncaughtError })`
  hooks that schedule a `queueMicrotask` unmount+remount. The pure flag helper
  `isPopupFeatureEnabled` lives in `src/popup/feature-flags-helpers.ts` and is
  re-exported from `ui.tsx` so flag-logic tests need not import JSX.
- Relative imports under `src/**/*.{ts,tsx}` are extensionless (bundled build);
  the only exception is the locked page-motion freeze pair
  (`src/common/page-motion-freeze-bridge.ts`,
  `src/common/page-motion-freeze-control.ts`). Source-contract tests that assert
  import specifier strings expect extensionless paths, but
  `tests/manifest-permissions.test.ts` re-appends `.js` when comparing source
  imports against emitted bundle/WAR names.
- `logo.png` is a public asset at `src/public/logo.png`; WXT copies it to the
  output root and `scripts/package-extension.mjs` stages it explicitly, with
  parity assertions in `tests/build-artifact-parity.test.ts` and
  `tests/package-extension.test.ts`.
- Popup stylesheet layering now bundles through side-effect CSS imports in
  `src/entrypoints/popup/main.ts` (fonts, theme-color, theme-components,
  popup, theme-utilities, materialdesignicons). Do not reintroduce raw
  stylesheet `<link>` tags in `src/entrypoints/popup/index.html`: WXT/Vite must
  rewrite those CSS/font URLs into the generated popup asset bundle, while
  `scripts/package-extension.mjs` still stages the stable raw public
  `assets/fonts/fonts.css` and `assets/materialdesignicons.min.css` files for
  packaging parity.
- ESLint enforces unused detection across BOTH `src/**/*.{ts,tsx}` and
  `tests/**/*.ts` via `eslint-plugin-unused-imports`
  (`unused-imports/no-unused-imports: error`) and
  `@typescript-eslint/no-unused-vars: error` (ignore pattern `^_` for
  args/vars/caught errors), plus `no-useless-assignment`, `no-useless-escape`,
  and `prefer-spread`. The locked freeze pair has a file-level override that
  disables `no-unused-vars` and `prefer-spread` (its content stays byte-stable).
  Prefix intentionally-unused catch bindings and args with `_`.
- All test files are TypeScript under `tests/` (no `tests/*.test.js` remain);
  pure structural source-shape tests were removed in favor of behavior,
  contract/guard, and sentiment tests.

## The Reveal/Freeze Contract (architect, 2026-07-03)

Exactly ONE reveal/freeze ritual per page visit, run either immediately at
page-load complete or immediately after render-mode detection exits — this
applies regardless of mode or phase. The ritual: smooth scroll to top; walk
down; at 50% of the INITIAL scroll height the LAZYLOADING freeze engages
(maximum ONE lazy expansion for the whole ritual — an expansion during the
0->50% sweep counts as the one); arrive at the bottom and wait for the
expansion; scroll to the new bottom and wait — no further expansions may
occur; the PAGE FREEZE (full motion pause) engages AT THE ABSOLUTE BOTTOM,
never earlier; the return scroll happens under the freeze. The full scroll
to the true bottom is never neglected. Enforcement mechanics: concurrent
warmups JOIN the in-flight ritual (never supersede — the id-bump abort used
to release the page-world lazy-load lock under the surviving walk); only the
walk that ENGAGED the lock may release it; unpaused subsystem resumes
(resumePageMotion with no pauseState) do not restore suppression while a
ritual is in flight; the freeze rides the reveal's pauseAtBottom hook.

## Content script lifecycle

- In content scripts, `Extension context invalidated` means the old extension instance was reloaded/disabled/replaced. Treat it as a terminal lifecycle signal for that script: stop property-lock reconnect loops and wait for the new content script instead of retrying Chrome extension APIs.

## Manifest / web-accessible resources

- `web_accessible_resources` is an explicit allowlist (no `common/*.js` /
  `content/*.js` wildcards) to limit the install fingerprint. Any resource
  loaded into the page world via `chrome.runtime.getURL(...)` MUST stay listed
  or the browser blocks the load. Notably the cursor SVGs under `cursors/` are
  injected into the page world and must remain web-accessible.
  `common/page-motion-freeze-control.js` is the opposite
  case: it runs via `chrome.scripting.executeScript({ func })` (serialized), so
  it must NOT be web-accessible. `tests/manifest-permissions.test.ts` now
  asserts every literal `getURL("…")` injected resource is web-accessible.

## Current Architecture Decisions

- Popup tab-runtime snapshots must flow through the background command
  `POPUP_GET_TAB_VIEW_STATE`; do not reintroduce popup fallback reads through
  `WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE`.
- Earlier storage-access work centralized Chrome storage access through domain
  stores instead of raw scattered `chrome.storage` or `utils.storage*` calls.
- Chrome storage access is now restricted to approved storage/domain modules
  guarded by `tests/storage-access-boundary.test.ts`; background, popup, and
  content production paths should call domain helpers rather than direct
  `chrome.storage` or `utils.storage*` wrappers. Page-local `localStorage` /
  `sessionStorage` usage is tracked separately from this Chrome storage rule.
- Earlier world-decomposition work is complete. Content follow-up Tracks D/E,
  the mechanical Track F slices, and the high-risk G0-G5 plan are historical
  work on this branch. Track H is complete through H3 on `feat/wxt-port-plan`
  and remains paused pending a new post-H3 review plan. Hard rules remain:
  never edit `src/content/core.ts` or locked
  marking/silent-highlight/visibility/reconciliation logic without a new
  approved plan; every new `content/*` module must be added to
  `web_accessible_resources` with `tests/manifest-permissions.test.ts` green;
  live validation is required for core unflagged behavior when automated
  validation is not enough, while flag-disabled property-lock follow-ups may
  defer live validation until those features are prioritized.
- Part C native WXT runtime adoption is complete on `feat/wxt-port-plan`. The
  runtime is now genuinely WXT-native end to end: WXT bundles the real
  background, popup, content, offscreen, and MAIN-world bridge graphs; the
  esbuild build, `legacy/` mirror, and standalone sync bridge are gone; `pnpm
  build` is pure `wxt build`; the source manifest uses native
  `content-scripts/*` paths; stable public assets are restored through WXT
  hooks; and the only remaining manifest override is restoring the source
  `action` block to omit `default_popup`.
- C6 browser adoption is complete. The repo now has a dedicated
  `common/browser.ts` seam; shared async messaging, bus transports,
  popup/offscreen/content runtime listeners, popup active-tab fallback lookup,
  popup render-mode tab-load waiters, content one-shot sends, property-lock
  port connect/background port wiring, and touched sender/type positions route
  through promise-based browser APIs via that seam. Keep
  `tests/browser-polyfill-boundary.test.ts` as the guard for the intentionally
  remaining raw `chrome.*` surfaces.
- C7 storage adoption now routes `common/storage-core.ts` through
  `wxt/utils/storage` for real extension hosts while preserving the legacy
  callback-style contract for Node/test hosts and existing callers. Keep the
  public `storageGet` / `storageSet` / `storageRemove` / `storageClear` /
  `addStorageChangeListener` surface unchanged, keep keys/areas identical, and
  route settings-cache invalidation through `addSyncStorageChangeListener`
  instead of direct `chrome.storage.onChanged` usage.
- C8 one-shot messaging adoption uses `@webext-core/messaging` only for
  **tab-targeted** one-shot delivery (`tabs.sendMessage` paths into content).
  In live Chromium MV3, popup/content -> background `runtime.sendMessage`
  requests wrapped in the package's `{ id, type, data, timestamp }` envelope did
  not reach the background worker at all, even though the equivalent raw request
  envelopes did. Keep popup/content -> background one-shot requests and bus
  sends on the repo's existing raw runtime-message shape; keep the content-side
  runtime listeners able to unwrap `uf-bus/1` / `uf-runtime-request/1` package
  envelopes so background -> content one-shot delivery can still use the package
  where it works.
- C9 closeout confirmed the final Part C gate: `pnpm verify` is green, and the
  Bonliva live popup regression still passes the render-mode
  "Without JavaScript" flow by entering "Starting render-mode inspection"
  instead of the prior "No response" failure.
- `renderMode.runInspection` is served through the background tab-operation
  runner, so the live popup/background bus reply is the operation envelope
  (`{ ok, kind, ..., result }`), not just the inner inspection payload. Popup
  callers must unwrap `result`, and keeping the render-mode bus handlers
  registered before later popup-state/spinner bootstrap avoids live MV3 startup
  gaps where those requests are missing while other bus handlers already work.

## Popup Preview Exit Contract

- Approved popup button-state contract for the AI run -> Show Content List ->
  Exit Preview -> marking mode flow. The page is LOCKED (marking-edits overlay,
  `cursor-disabled`) only while the AI run is in flight (computing) or its preview
  is open; in every editable stage the page cursor stays markable:
  - State A — fresh marking entry (`MARKING_FRESH`): Run AI enabled, Show Content
    List disabled, Save disabled, Discard disabled, marking toggle checked/enabled,
    page editable.
  - State B — pre-AI dirty (`MARKING_DIRTY`, `currentPageHasPendingChanges` true,
    not POST_AI): Run AI enabled, Show Content List disabled, Save disabled,
    **Discard enabled** (revert markings to the initial state), page editable.
  - computing/preview: page LOCKED; Run AI disabled. Save/Discard/List follow the
    preview matrix.
  - State C — clean post-AI run (`READY_TO_SAVE`, POST_AI &&
    `!currentPageHasPendingChanges`): Run AI disabled, Show Content List enabled,
    Save enabled, Discard enabled, marking toggle checked/enabled, page editable.
  - State B again — post-AI marking edit: the moment the user edits a marking
    post-AI, the popup reports `currentPageHasPendingChanges` true, which drops the
    SESSION phase from `READY_TO_SAVE` back to `MARKING_DIRTY` (the underlying
    typed `store.aiRun.phase` stays POST_AI; only the projected phase changes). Run
    AI re-enables, Save/List block (REQUIRES_AI_RUN), Discard stays enabled.
  - `currentPageHasPendingChanges` is the dirty axis (DETERMINISTIC, NOT
    fingerprints): it is the popup-owned signal `currentDraftDirty ||
    reconciliationPending` (the "local != backend / has unsaved work" term was
    REMOVED — that stays in `sessionHasPendingChanges` only, since it is always
    true right after an AI run and would otherwise pin the page dirty forever).
    `currentDraftDirty` comes from content `isPageDraftDirty`, which is now
    deterministic: dirty ONLY after a real user marking-toggle click (page
    click/drag → `completeExplicitToggle` → `markUserMarkingEdit`, tracked in
    `state.userMarkingEditsByPageUrl`), plus the `autoSeededPendingSavePageUrl` /
    reconciliation short-circuits. There is NO fingerprint-vs-baseline compare, so
    scroll / cursor / reflow / background re-sync NEVER flip a page dirty. The flag
    is cleared at clean baselines: `enableForBaseUrl` (fresh enable), the AI-run
    snapshot (`capturePageSnapshot` persist), `disable()` (post-save silent
    transition clears the whole Set), and discard (`page-draft-revert-handler`).
    `currentPageHasPendingChanges` is NOT stripped by the brain-authority layer, so
    the brain always sees post-AI edits. The post-run AI-run event patches
    (PREVIEW_READY / RESULTS_APPLIED / EXITED) set `currentPageHasPendingChanges:
    false` to establish the clean post-AI baseline with no flicker gap; a real
    popup/page edit overrides it true. The popup's own
    `isAiRunUpToDateForCurrentMarkings()` also defers to the brain: true when
    `sessionAiRunPhase === POST_AI` OR `popupBackgroundSessionPhase ===
    READY_TO_SAVE`, so the popup's Save/status copy stays consistent with the brain.
  - dictation-decider: `postAiClean = postAi && !currentPageHasPendingChanges`.
    Run AI (`computeButtonDisabled`) is disabled only when `actionMatrixDisabled ||
    postAiClean`. Save / Show List enable only when `postAiClean`. Discard enables
    when `postAi || (currentPageHasPendingChanges && !pageSaveReconciliationPending)`.
  - secondary-gates-decider MUST stay consistent: `pageSaveBlockedReason` and
    `markingPreviewBlockedReason` return `REQUIRES_AI_RUN` when `!postAiClean`;
    `pageRevertBlockedReason` returns `NONE` in POST_AI/AI_PREVIEW and in pre-AI
    dirty (`currentPageHasPendingChanges && !reconciliation`). An enabled button
    must carry an empty blocked-reason (the `handlePageRevert` handler refuses on a
    non-empty reason).
  - Show Content List preview is read-only, and exiting it must be
    state-neutral: restore the exact pre-preview marking state after at most a
    brief restore-pending bridge
- The preview-exit fix on `feat/wxt-port-plan` now captures an authoritative
  popup-owned marking-session snapshot before preview opens, restores that
  snapshot synchronously on popup-initiated exit, clears it on every finalized
  exit path, and advances `previewRestoreAppliedToken` so the later async
  `aiPreviewClosed` notification remains a compatibility backup instead of
  re-deriving over the restored state.
- Brain-centralized session dictation now owns popup button/curtain authority.
  Layers report raw `SessionFacts`; `decideSessionPhase(...)` +
  `deriveDictation(...)` in `src/background/brain/deciders/` decide the 5-button
  matrix and blocking curtain; popup-local overrides must stay limited to
  short-lived fallback bridges until projected dictation arrives.
- Popup `SessionFacts` reports carry a monotonic per-popup-session `seq` stamped
  at `refreshUiInner` START (not send time), threaded popup
  `publishCurrentSessionFacts(...,seq)` → `publishPopupSessionFacts(...,seq)` →
  `SessionFactsReportedPayload.seq`. `refreshUi` does NOT serialize, so overlapping
  `refreshUiInner` runs publish the full facts set OUT OF ORDER; the brain
  `FACTS_REPORTED` handler drops popup reports with `seq <=`
  `lastPopupSessionFactsSeqByTab` (per tab; reset on `registerPopupPort` because the
  popup counter restarts at 1 each load) so a stale run can't be the last writer and
  dictate a stale `mainUiHidden` (regression: main UI stuck hidden after marking
  enable on first-visit/slow-load). Untagged reports (content facts, partial popup
  publishes) carry no seq and ALWAYS apply (back-compat). Two non-negotiable traps:
  stamp at COMPUTE time (a send-time stamp marks the stale-published-later report
  newest) and use a COUNTER not a wall-clock timestamp (ms-resolution collides
  across rapid refreshes).
- The brain broadcasts curtain/spinner via `SPINNER_EVENT_TYPES` to BOTH popup
  and content (`pageCurtain`/`banner` → CONTENT+POPUP) and clears `navInspect`
  on terminal curtain-bearing lifecycle. The popup curtain is driven by the
  `navigationInspectionPending` fact, computed from content inspection status. To
  avoid a stuck "Inspecting page…/Working…" curtain, content emits
  `inspectionSettled` (core `setPageInspectionUiSettledListener` fired in
  `finishPageInspectionUi`) so the popup ends its overlay and the fact clears
  deterministically. Settle safety is a single bounded one-shot fail-open
  deadline (no polling). Polling-elimination: only backend/readiness polls stay
  (popup `continueAiRunPolling`; background `chrome.alarms` token monitor;
  property-page-types backend poll). SPA URL detection is event-based
  (`ensureNavigationNotifierInstalled`: history pushState/replaceState patch +
  popstate/hashchange). Page-motion-pause 250ms refresh and silent-highlight
  position dwell stay (re-scan `getAnimations()`/dwell have no DOM event); 1s
  countdown timers are display clocks. Visible countdown clocks must be exempted
  in any "no setInterval" source-contract guard.
- Brain projection broadcasts MUST be deduped by content. The store
  (`state-store.ts mutate`) bumps `version` and schedules a projection on EVERY
  fold, including no-op folds of byte-identical facts. The popup re-runs
  `refreshUi` (which republishes its facts) both when it applies a
  `POPUP_STATE_EVENT_TYPES.VIEW_UPDATED` projection (`applyPopupViewSnapshot`) and
  when a popup/pageCurtain spinner SET/CLEAR arrives
  (`handleSpinnerSurfaceChangedFromBrain`). Without deduping, that is an unbounded
  publish->fold->project->apply->publish loop (~200 projections/sec) that
  remounts popup inputs (config fields lose typed characters) and spams the
  content directive. `publishProjectedState` in `src/background/brain/index.ts`
  caches the last broadcast per tab and only re-publishes `VIEW_UPDATED` and the
  three spinner surfaces when their content changed (`popupView.version` is
  excluded because the popup never reads it; the cache is reset on popup port
  (re)connect so a fresh popup always gets a full projection). `directive.content`
  is intentionally NOT deduped — the content realm receives it via a push
  subscription with no pull, so a freshly (re)loaded content script that reports
  identical facts must still get the current directive; its listeners already
  no-op on unchanged values.
- The brain `silentHighlightActive` directive
  (`view-projector.ts shouldActivateSilentHighlighting`) is the STABLE intent
  ("silent highlighting should be active for this page") and must not be gated on
  the activation's own transient signals. The silent-highlight editor reveal sets
  `navigationInspectionPending`, `pageInspectionBusy`, and an `editor_preparing`
  page-save reconciliation while it runs; gating the directive on those makes it
  flip off while preparing and on once settled, re-triggering the content
  activation forever (a perpetual "Preparing page content…/Working…" curtain that
  blocks all controls). Only a NON-`editor_preparing` reconciliation
  (saving/syncing) suppresses it.
- The popup-published `silentModeActive` session fact must reflect the actual
  PAGE state (`!pageScopedUiDisabled && renderModeReady && !isEnabled`), NOT the
  popup `currentView`. The popup keeps a separate view-gated `silentModeActive`
  for Marking-only local UI (`cssSelectorsVisible`, `desktopPreviewVisible`) but
  publishes `silentModeActivePageState`. Gating the published fact on
  `currentView === Marking` made it report `false` on the config view while the
  content reported `true`, and the brain merges both sources into one fact, so the
  conflict oscillated.
- Testing brain/content changes in the live browser: the persistent
  `.wxt/browser-profile` caches the MV3 service worker across relaunches, so a
  fresh `pnpm browser:live` can keep running STALE background code (verify a known
  symbol like a debug hook is actually present). Clear
  `.wxt/browser-profile/Default/Service Worker/{ScriptCache,Database}` while the
  browser is stopped (IndexedDB config is preserved) or force
  `chrome.runtime.reload()` and wait for the new worker before trusting a result.

## AI Submission Rules

- Starting AI content detection must show compute-busy feedback and apply the page-side compute lock before raw HTML backfills, XPath refinement, or payload construction; the async status poll interval is 5 seconds.
- Heavy `renderedHtml`, `rawHtml`, AI request payloads, AI responses, and server config payloads should not be routed through multiple runtime-message hops. Prefer storage/cache keys or a context-owned fetch when payload size could approach Chrome messaging limits.
- Saved `submissionXpaths` are shallow boundary rows for CSS-selector calculation: exclusion roots are submitted once and their descendants are suppressed unless a descendant is an explicit include.
- Submission XPath indexes must be computed after marking sync against the same sanitized DOM view as saved `renderedHtml`; extension UI, browser-automation roots, and save-time stripped nodes do not count as siblings.
- Exclusion rows include every stored excluded XPath row, plus implicit hidden textual content detected in mobile save mode. Generated/default rows submit as excluded unless explicitly included or suppressed by an excluded ancestor; `explicit: true` remains local user-edit metadata, not the AI-submission gate.
- Immutable defaults and descendants are excluded by the payload's immutable tag list only, not by per-page XPath rows; stale immutable rows must be suppressed.
- Explicit includes always submit as included rows, even when hidden or nested inside excluded ancestors.
- Consent UI is hidden before saving and then handled by normal invisibility detection; do not persist or sync `consentXpaths`.

## Page Save and Candidate Completion

- Local page-marking drafts are not candidate-completion evidence. The Todo List, candidate `Marked` badges, marked-pages list, and Lynx checklist coverage must use the backend-saved page-marking cache populated from confirmed `/load` or valid `/save` backend payloads.
- The Todo List current-page indicator belongs on both the current candidate row and its parent page-type subsection, so the active page type is visible even when the subsection body is collapsed.
- Config sync must not upload unsaved local page drafts by default. It may include backend-saved page markings and the current page only when the user is explicitly saving or reverting that page.
- Empty or partial `/load`/`/save` responses must not replace local saved page snapshots or clear the backend-saved cache; merge confirmed save payloads and incoming remote entries by timestamp.
- Every saved page marking MUST carry a valid candidate-resolved `pageType`: the backend `PageMarking.PageType` is `[JsonRequired]` and validation rejects blank/unknown types. A freshly-marked page can start with a blank pageType, so `refreshUi` repairs pageTypes on LOCAL draft markings (not only backend-saved ones) via `repairLocalPageMarkingPageTypes` before save (`src/popup.ts` ~4610). Without this the blank-pageType page is filtered out of the save payload / rejected, so it never persists — coverage stays empty AND the page stays dirty (current markings never match the empty backend-saved snapshot), which also suppresses silent highlighting.
- The page-type taxonomy is BACKEND-sourced and dynamic. The backend (`UnfluffifyHub`) owns it in `Dtos/PageTypeTaxonomy.cs` and serves it via `GET /page-types` (`.RequireAuthorization()`); `PageMarking` validation derives its allowed slugs from `PageTypeTaxonomy.SlugSet`. The extension fetches it (`loadPageTypeTaxonomy` in `remote-network.ts`, triggered by the popup + on background start), caches it in `chrome.storage.local` under `pageTypeTaxonomy`, and reads it through `src/common/page-type-taxonomy.ts` (all realms call `initPageTypeTaxonomy()` to load the cache + subscribe to changes). Only the TOP level is used (key = type slug, `label` = visual label); `subtypes` are fetched/stored for a later feature but not consumed yet. `config.ts` (`SUPPORTED_PAGE_TYPE_KEYS`) and `lynx-checklist.ts` (labels + order) read the active taxonomy dynamically. `DEFAULT_PAGE_TYPE_TAXONOMY` (extension) is the offline/first-load fallback and MUST stay in sync with the backend `PageTypeTaxonomy` — adding/renaming a type or label requires updating BOTH.
- Page-save reconciliation must not be cleared merely because `/save` returned OK; the forced backend reload must confirm the current page is present in the backend-saved cache.
- A page with no local or remote saved data must remain saveable even when the user accepts the default markings as-is and has made no manual toggle changes.

## Marking and Highlighting Rules

- The marking rules are a locked compatibility contract. Do not change taxonomy, target resolution, sync semantics, overlay projection, or default-exclusion behavior unless the user explicitly requests a marking-rules contract change.
- For reload/page lifecycle work, run a Q&A sanity-check phase before implementation: trace marking rules, rendering rules, XPath calculation, and AI payload construction so fixes preserve the locked contract and avoid large message transfers.
- Any legitimate marking contract change must update `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and focused regression tests in the same commit.
- Marking rules are anchored to the approved `052c164b077d459fa7a6e79b306f01144336719c`-derived contract, with deliberate current safeguards: `BUTTON` is toggleable, the redundant void `LINK` tag is omitted from the taxonomy, stricter geometry/paint guards stay active, selector-excluded content has no dedicated marking overlay, and silent highlighting stays `immutable`/`content`/`excluded`.
- Shift expanded exclusion restores the 052c chooser: self structured/toggleable boundary, nearest structured group ancestor, nearest toggleable ancestor, then broadest markable ancestor, while still rejecting shallow generic body-level page shells.
- Alt explicit include restores 052c mixed direct-text ancestor promotion while keeping current silent-whitespace safeguards.
- Toggleable default exclusions are `FOOTER`, `FORM`, `LABEL`, `NAV`, `HEADER`, `DIALOG`, `ASIDE`, and `BUTTON`. Immutable defaults are `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`, `SCRIPT`, `TEMPLATE`, `IFRAME`, `VIDEO`, and `SVG`. `SVG` is immutable because an `<svg>` is a self-contained graphic whose internal text is not indexable page copy; tag-selector matching is case-insensitive on both sides because foreign-namespace elements like `<svg>` report a lowercase `tagName`. `LINK` is intentionally omitted from the taxonomy because a `<link>` is a void metadata element that never carries text or descendants and can never be a marking target.
- Exclude clicks drill into markable descendants inside active toggleable default boundaries; the generated default ancestor is stored as `excluded: false` while the descendant becomes explicit. Generated/default descendant rows also participate in suppressing broader auto-default ancestors. Blank/default-boundary clicks can still unmark the boundary itself.
- Toggleable defaults differ from user/CSS-selected exclusions only during the inclusion/exclusion decision. After sync decides a default boundary is excluded, generated rows whose live element still matches a toggleable default render through the ordinary exclude marking path even without `explicit: true` and stay out of the implicit/default content layer; stale untagged non-default excludes must stay hidden.
- Toggleable default exclusions must not have a dedicated visual layer, CSS class, render collection, or post-hoc overlay rule.
- A stored toggleable default row with `excluded: false` unmarks only that boundary without becoming a full explicit include subtree.
- Stored unexcluded default boundaries also suppress their own default-layer marking, but not their descendants, to avoid visual-only ancestor ghosts around explicit descendant marks.
- Default-layer collection remains structural and is not globally filtered by visible explicit marks; broad filtering can make implicit descendants flicker on alternating toggles.
- Fast explicit-toggle overlay refreshes must run `syncPageMarkings` before drawing explicit layers, but must not recompute the default layer. Structural toggles run the invalidating full render immediately after that refresh; leaf explicit-exclude toggles may patch cached lower-priority collections and debounce the invalidating full render to keep mark/unmark acknowledgement responsive.
- Marking enable uses `setEnabled` as the single activation path; do not add a second immediate popup `forceRefresh` after successful enable.
- Marking data is session-scoped: every marking enable recomputes the page entry fresh from defaults + CSS/AI-selector influence (selector influence only when a selector set is present), discards any stale `config.pageMarkings[pageUrl]` draft, and a freshly enabled page never starts dirty because `enableForBaseUrl` clears its deterministic `userMarkingEditsByPageUrl` entry (dirty is now the deterministic real-toggle flag, NOT a fingerprint-vs-baseline compare — see the Popup Preview Exit Contract dirty-axis note). Backend-saved explicit markings do not pre-populate the fresh session entry, no unsaved-draft cache survives a disable (`enableForBaseUrl` deletes the stale entry and sets `pendingFreshBaselinePageUrl`; `renderHighlightsInner` reseeds `setSavedPageEntry`), and marking is disabled on any navigation/reload regardless of same page or property.
- Full marking passes may use per-pass caches for visibility, text, immutable/default selector, ancestor, and textual-descendant decisions. These caches are derived from the current DOM/config and must not become persistent marking truth.
- Explicit include boundaries block descendant hover targeting and marking until the exact include boundary is removed.
- Hidden explicit include/exclude markings persist while their DOM element exists and render as non-toggleable ghost markings when measurable.
- Marking mode uses `Alt` for explicit include, `Shift` for parent selection, and hold-`Space` for temporary page UI interaction/pass-through.
- Preview Contents is intentionally available in marking mode again, gated on AI-run freshness and page-save reconciliation. Silent Preview Contents (the silent-mode "Show Content List") is enabled whenever stored selectors exist in silent mode — it reads the latest stored selector set and does NOT require a fresh in-session AI run (#14); exiting it returns to the origin mode (silent→silent, marking→marking). Send to Lynx remains silent-highlighting-only with handler-level guards outside silent mode.
- Shift parent selection may climb wrapper chains to cohesive content boundaries, but must reject shallow generic body-level page shells with broad viewport footprint or multiple page landmarks.
- Marking overlays watch style mutations so dynamic opacity, visibility, and movement changes trigger repositioning.
- The marking mutation observer re-runs `hideConsentElements()` on any non-overlay `childList` batch so late-injected consent widgets are hidden during active marking. This is idempotent and loop-safe (the consent bypass `<style>` is appended to `document.head`, which the body-scoped observer does not watch). It is currently un-debounced (unlike the adjacent `scheduleRender`); fold it into a throttled path if a highly mutating page shows cost during marking.
- `REMOVABLE_ELEMENT_SELECTORS` (the consent/overlay matcher) is a HIGH-PRECISION allowlist, not an exhaustive one. It covers cookie/consent/gdpr, modal/popup/dialog/alertdialog/`aria-modal`, native `dialog[open]`, overlay/backdrop, interstitial, and newsletter/subscribe signals across class/id/role/aria-label. Do NOT add generic content words (`banner`, `notice`, `toast`, `lightbox`, `paywall`, the `cmp` substring, `role=banner`) — they match real headers/promos/galleries/AEM components and would hide actual page content. Every non-element entry keeps the `:not(body):not(html)` guard. Any future addition must be validated against the live AI-submission smoke (bonliva 117 / prowork 76 / vitec-pyramid 57 included-visible) so included-content counts do not drop. `tests/consent-selector-precision.test.ts` locks the safe-include / forbidden-broad contract.
- Extension-owned UI injected into the page (toasts, banners, notices, AI popover, motion-pause indicator) uses the shared `EXTENSION_UI_FONT_STACK` constant (mirrors the popup brand `--font-sans` = Inter) rather than ad-hoc per-element families. The Material Design Icons glyph font is intentionally separate.
- Page motion pause is a shared marking/silent-highlighting lifecycle source. Marking/reveal warmup first hides consent chrome before inspection styling or any scroll, then shows a page-inspection spinner, blocks page/content-overlay input, performs the historical max-scroll reveal walk for lazy content, returns to the reserved scroll position, freezes, and renders overlays. Matching base-URL pages stay frozen even before selector overlays exist; the pause uses broad CSS/Web Animations/SVG/media/style-lock coverage plus a page-world timer/rAF gate, normalizes layout-present scroll/viewport/attribute-driven reveal candidates such as Webflow `data-w-id` blocks to visible posture, shows an Unfluffify-scoped Material Design Icons snowflake/code indicator without injecting global `.mdi` page styles, excludes extension-owned UI, keeps internal marking scheduling on extension-owned timers/rAF, and strips all freeze mechanics from snapshots.
- The page freeze is a SINGLE page-visit-scoped lock, decoupled from the overlay layers: once the page is frozen it stays frozen for the whole visit and is released ONLY on navigation. `pausePageMotion(reason)` always also holds the `PAGE_VISIT_MOTION_PAUSE_REASON = "page-visit"` reason, so per-subsystem `resumePageMotion(reason)` calls (marking `disable()`, silent-highlighting teardown, AI run/preview/exit) drop only their own reason and leave the page frozen — they change which highlight/marking OVERLAY is showing, never the freeze. `resumeAllPageMotion()` is the single release, wired into `emitNavigationChangeIfUrlChanged` (history pushState/replaceState + popstate/hashchange) so the freeze lifts on any URL change and the new page re-freezes itself if still eligible; full-page navigations re-inject content anyway. `enableForBaseUrl` checks `isPageMotionPaused()` (not a specific reason) to keep an existing freeze and skip re-running the reveal warmup. Do NOT reintroduce per-phase freeze teardown (e.g. unfreezing in `disable()` or on AI-run/preview transitions) — that reintroduces the freeze-drop (#3) / stuck-freeze leak class of bugs.
- Opening Unfluffify on a supported page enables mobile simulation by default for a fresh tab session. A user-disabled mobile simulation state is a per-session choice and must not be auto-enabled again until the tab session state is cleared, except that active marking sessions force mobile simulation back on for the editor tab until marking is disabled.
- When AI selectors exist for the current property, the popup exposes a separate desktop-preview checkbox that persists for the tab lifecycle via initial tab state. Enabling it switches the page to desktop emulation, keeps silent previewing available, disables marking entry, and DevTools detach clears the checkbox back to forced mobile simulation.
- Same-property pages that are no longer current Live Page candidates still keep silent highlighting and property-lock visibility for that property. Only marking entry is blocked there; the popup should not collapse the whole page UI just because the page is off-candidate.
- USER-SPECIFIED reveal/freeze + consent + silent-highlight CONTRACT (2026-07-01; target behavior — current code has open gaps tracked as QA round #2 in `.copilot/lifecycle-resume-plan.md`, findings #4/#6/#7/#8):
  - Cookie-consent removal runs on ALL property pages (candidate or not), always/end-to-end, decoupled from reveal/freeze and candidacy — so users cannot click consent buttons that mutate the DOM.
  - Reveal/freeze/lazy-load-lock runs ONLY on a candidate page in two cases: (a) full page load when the render mode is already set, or (b) immediately after FIRST-TIME render-mode set (exiting the render-mode view). It must NEVER run in marking mode, during render-mode decision/EDITING (re-inspect of an existing mode), or at any later in-session point. It runs right before silent highlighting is applied.
  - Silent highlighting renders whenever (stored selectors present AND marking off), independent of reveal/freeze: immediately post-save / in-session (no reveal/freeze expected), or after reveal/freeze on page load. It must never be gated on / held by a reveal/freeze activation completing. During an active AI preview it ALSO renders alongside the yellow AI-detected content so the user can compare saved vs detected content (#8). CRITICAL: a displaying preview reports `silentModeActive=false` (the preview replaces silent mode), and a marking-mode AI preview additionally keeps marking enabled (`isEnabled=true`); so while a preview is displaying (`previewComparisonActive = previewActive && !previewRestorePending`) the WHOLE marking-off base condition (`silentModeActive` + `!isEnabled`) is waived along with the "clean session" gates (pending changes / draft dirty / requires-AI-run). Only a restoring/exiting preview (`previewRestorePending`) or an in-flight AI compute (`aiBusy`/`aiComputing`) still suppresses it; `previewBlocked` is coupled to `previewActive` in the real reporters (both flip together) and is NOT a suppressor. Owned solely by the brain directive `shouldActivateSilentHighlighting` (`view-projector.ts`); content only reflects `directive.silentHighlightActive`. NOTE on the marking-mode preview mechanics: the brain sees `isEnabled=true` (the popup owns marking-session facts while connected and keeps reporting the active session), which is why the brain gate must waive `!isEnabled` during a preview; meanwhile the CONTENT has `state.enabled=false` because `beginAiPreviewMode` calls `core.disable()` on preview entry, so `refreshSilentHighlightings` proceeds past its marking-enabled early-bail and renders once the directive is active. That early-bail is additionally gated on `!isSilentHighlightActiveByDirective()` so the content reflects the directive rather than re-deriving the block from local `state.enabled` (defensive brain-authority alignment). Reveal/freeze stays inert during any preview because `shouldRunSilentHighlightEditorActivation` short-circuits on `state.enabled` and requires `pageRevealFreezeActive`, which is false during preview.
  - Whenever the popup shows a blocking curtain (incl. AI run), the page must also be blocked from interaction (full pageCurtain), not merely marking-disabled.
- While the current editor stays on a same-property off-candidate page, content and popup mirror a 70 second local countdown from tab-scoped initial state. When it expires, the content script sends `propertyLockRelease` so the editor role is dropped unless the user has returned to a candidate page first.
- If the current editor navigates to a different property, the old property enters a 30 second cross-property recovery cooldown stored in initial tab state (`siteId`, `baseUrl`, `clientId`, `deadlineAt`). The new page and popup mirror that warning, returning to the original property reuses the same client session, and expiry sends `propertyLockRelease` for the old property runtime.
- Tab removal is different from navigation disconnects: the background immediately sends `release_lock` and disposes the property-lock runtime for that tab instead of waiting for the ordinary 70 second disconnect grace used for reconnectable page transitions.
- Popup-side property-lock warning rendering must treat mirrored initial-tab-state countdowns as authoritative UI state. Cross-property and off-candidate warnings must still render even when the freshly fetched live lock snapshot on the current page is inactive, unavailable, or no longer reports `isEditor`.
- If marking remains enabled while page editing is blocked by save reconciliation, the page overlay must visibly enter the temporary disabled state: dim markings, clear hover, show the paused status notice, and strip that UI from snapshots.
- The marking-edits-blocked overlay reason is brain-dictated: the background view-projector composes both causes — the **active AI run lock** (`aiComputing || previewActive || previewBlocked` → reason `ai_run`) and a pending page-save reconciliation (reason `saving`/`syncing`) — into the `contentDirective.markingEditsBlocked` + `markingEditsBlockedReason` directive. The page is locked ONLY while the AI run is in flight (computing) or its preview is open; once the run settles into POST_AI the page is editable again (so the user can revise markings and re-run, or Save/Discard). Content reflects it via `getMarkingEditsBlockedReasonByDirective()` and never re-derives the block locally, including the blocked-interaction toast wording (saving/syncing → reconciliation copy, ai_run → generic copy). The silent-highlight editor-preparation reconciliation (`pageSaveReconciliationReason === "editor_preparing"`) is exempt brain-side and must never raise the overlay. Content reports `pageSaveReconciliationReason` up alongside the pending flag (normalized to `"" | saving | syncing | editor_preparing`).
- The popup page-save informational notices (`pageDraftStatusText`/`Tone`, `pageSessionNoticeVisible`/`Text`, `aiDirtyNoticeVisible`/`Text`) are a SANCTIONED local shared-derivation reflection, not authority drift. They are computed by the shared pure function `buildPageSaveUiState` (`src/common/page-save-state.ts`) from facts the brain already owns (`sessionHasPendingChanges`, `sessionRequiresAiRun`, `currentDraftDirty`, reconciliation) plus the brain-reflected `mainUiHidden`. Because the popup runs the same canonical function with those inputs, its output is byte-identical to what a brain projection would produce — there is no possible divergence. The gating these notices sit on (page-save/revert button disabled) is already brain-dictated via the matrix. Do NOT re-flag these for brain projection: doing so adds a brain-contract surface (new reconciliation facts + decider + projection + reflection) and puts a frequently-updating notice behind report-up→project→reflect latency (flicker risk on locked page-save UX) for zero functional gain (Audit 3 decision, 2026-06-30).
- Repo-local Phase 2 live validation currently uses `scripts/smoke-property-lock-phase2.mjs` with `xvfb-run -a node ...`. The most reliable setup is the persistent repo profile plus an explicit `chrome.runtime.reload()` of the unpacked extension worker before each run. Fresh profiles are not meaningful product validation until the required extension config/auth state is present.
- The current property-lock smoke harness is good for cross-property countdown diagnostics, but it is still operationally flaky around popup reopen/auth bootstrap after extension reload. Treat smoke failures that land on the unauthenticated popup as harness/profile issues unless they reproduce while the page banner and `tabState:initial:*` storage also show bad state.
- Session-fact reporting is STICKY per layer: popup (`lastPopupSessionFacts` in `popup-bus-client.ts`) and content (`lastContentSessionFacts` in `content-bus-client.ts`) each accumulate every published patch and re-serve the merged snapshot to the brain heartbeat's 1s STATE_GET pulls. Any state teardown that resets a fact's local source WITHOUT republishing the fact leaves a stale sticky value that the heartbeat re-folds forever, fighting the other layer's fresh reports (brain fact/directive flap — the #5 "marking temporarily unavailable" oscillation came from `clearAiPreviewState()` resetting `aiPreviewState` silently, leaving sticky `previewActive:true`). Rule: every content/popup state reset that a published fact is derived from must republish that fact in the same code path (content preview teardowns all publish via `publishAiPreviewSessionFacts()`).
- The popup's `state.sessionAiRunPhase` mirror MUST reach POST_AI when an AI run completes (`captureAiRunMarkingsFingerprint()` sets it; `resetAiRunMarkingsFingerprint()` drops back to PRE_AI). The brain owns the ai-run lifecycle, but the popup still PUBLISHES `aiRunPhase` in full fact reports and the brain's clean-reset handover (`shouldKeepBrainAiRunAuthority`) folds a reported `pre_ai` when pending-change facts look clean — a popup that can only ever say `pre_ai` wedges the brain at PRE_AI post-exit (Save stuck `requires_ai_run`). The mirror also drives the POST_AI leg of `shouldReportManualAiPreviewEvent()`, which is what guarantees the `EXITED` ai-run event on preview exit (handoff option (c), approved 2026-07-02). Regression tests: `tests/post-exit-ai-run-state.test.ts`.
- The popup preview sidebar (Detected Content) is POPUP-OWNED for visibility and item list, NOT re-derived from the racy `getAiPreviewState` content probe. Three facts on popup state drive it: `previewOpenIntent` (a preview session is open), `previewSuppressReopen` (just closed — ignore a lagging active probe), and the `previewSessionHadItems`/`previewItemsLatched` item latch. There are THREE preview-open code paths that must ALL set `previewOpenIntent=true` + `resetPreviewItemsLatch()`: (1) AI-run completion `applyComputedSelectorSet` (seeds the latch with the immediate items), (2) marking-mode `handleShowAiPreview`, (3) Silent Preview `handlePreviewLatest` (bound to `onPreviewLatest`/`#preview-latest`). Missing the wire on ANY path makes that entry show "No content detected" (popup empty while content has items) because the latch/visibility override never engages. `resolveOpenPreviewItems` is the single item authority: a settled probe/push updates it, a pending/missing snapshot keeps the latched list, empty is shown only when the session never produced items (loading -> pending, or genuine no-detections -> settled). `overrideDictatedPreviewVisibility` forces the view's `previewActive/previewBlocked` from `previewOpenIntent` so the brain's flapping folded preview facts (applied via `central-state-dictation.ts` + `applyPopupViewSnapshot`) cannot blink the sidebar. Do NOT reset the intent latch on a transient refreshUi `tabInScope=false` (it flickers during heavy-page preview churn) — clear it only on the authoritative close (`settlePreviewRestoreClosed`) or a fresh AI run start (`setAiRunActiveState`). Regression tests: `tests/popup-preview-transient-guard.test.ts`. Verified live on bonliva.se/lediga-jobb: preview open+hold stable (932 items latched, no empty/visibility flaps). CAVEAT (2026-07-03): the popup-owned visibility holds while the preview is OPEN, but the post-EXIT window has a deeper failure — see the #5/#14 root-cause bullet below and HANDOFF.md top section.
- #5/#14 POST-EXIT ROOT CAUSE (2026-07-03, trace-proven): `refreshUi` is a long async pipeline (4-8s on heavy pages) and passes INTERLEAVE — a pass whose tab-probe reads predate a popup-initiated exit settle publishes AFTER it, computing `isEnabled:false` from stale `contentMarkingModeActive`/`toggleEnabled`. ONE such `publishCurrentSessionFacts` makes the brain fold `isEnabled:false` -> `decideSessionPhase` returns SILENT -> dictation directs content OUT of marking (destroying a successfully-restored session) -> content genuinely disables -> permanent wedge. Input-time guards and time-based grace windows DO NOT fix this class (a pass's lifetime straddles any boundary); the fix must gate at the moment of effect with a pass-epoch check (capture epoch at pass start, compare at publish/sync callsites, skip marking-fact publishes and enabled:false syncs from stale passes). The same staleness also fires the "content wins" toggle sync (`setTabState enabled:false` + `setEnabled false`) and the brain's stale `previewActive:true` projection can reopen the closed sidebar via dictation (fixed by holding visibility closed post-close when no open intent).
- Scripted live-QA harness (2026-07-03): `.temp/run-flow.mjs` drives the FULL flow (enable -> trusted CDP mark clicks via `Input.dispatchMouseEvent` with 120ms hover -> Run AI -> preview -> single Exit -> 250ms hands-off sampling -> machine VERDICT `{sidebarReopened, silentCollapse, saveReachable}`), `.temp/exit-flow.mjs` resumes from an in-flight run. Every action/observation line carries an ISO timestamp for merging with `.temp/trace-observer.log` (CDP console tap) and `.temp/poll-viewstate.mjs`. Marking clicks MUST be trusted CDP input events (content's overlay `handleClick` path), and `#toggle-enabled` must be waited for DOM-enabled before clicking (disabled during `server_sync_pending` = silent no-op). Preferred over manual pairing for all repro rounds.
- Live-browser test methodology pitfall: repeatedly calling `chrome.runtime.reload()` + `page.reload()` leaves ORPHANED content-script instances in the page (bfcache/re-inject) that ALSO answer `chrome.tabs.sendMessage(tabId,…,{frameId:0})`, so the popup broker probe and a fresh SW probe get NONDETERMINISTIC contradictory replies (one instance active, one not). This corrupts live diagnosis. To reset cleanly, do a FULL navigation (`page.goto(url)`) which replaces the document and kills orphaned instances, or relaunch `pnpm browser:live` fresh. The brain persists per-tab state in `chrome.storage.session["brain:state-store"]`; a stale preview-open there survives SW reload/navigation and is self-sustained by the popup republish loop (only content publishing previewActive:false or Discard clears it) — clear that key + reload the SW for a truly fresh brain.
- #5/#14 marking-session write discipline (2026-07-03, fix round C — the durable doctrine): every popup-initiated marking transition bumps `state.markingSessionEpoch` (exit settle, toggle both directions, run start, the four force-disable branches, content-wins sync, discard, silent-align, restore confirmation); each `refreshUiInner` pass captures the epoch at start and a STALE pass must skip marking-fact publishes (`isEnabled`/`silentModeActive` omitted from the patch — sticky facts keep serving the last good values) and skip enabled-flip writes; a pass that performs a transition re-adopts the bumped epoch. Time/count windows CANNOT fix this class (a pass straddles any boundary; content restores can outlive any grace). The post-exit restore additionally needs the OBSERVATION latch `previewCloseMarkingRestoreUnconfirmed`: armed at a marking-restored settle, holds popup enabled-authority (content-wins ignores content's transient false, publish clamps to the restore target, readiness gate holds) until a probe FIRST observes content marking re-enabled — that observation bumps the epoch so older passes die retroactively. The latch is RAISE-ONLY at settle: content settles the same close AGAIN via a token-less `aiPreviewClosed` push after the snapshot is cleared, and letting that duplicate disarm the latch re-exposed the collapse.
- Preview-session guards are LATCHES, not windows (2026-07-03): `previewSuppressReopen` stays up from a popup-initiated close until the next in-popup open (probe responses reorder across interleaved passes — a confirmed-closed probe does NOT make a later stale-active probe fresh); an out-of-scope refreshUi pass (transient tabInScope=false from tab-context re-resolution) with standing `previewOpenIntent` must keep the popup-owned open state + latched items instead of writing the empty no-probe default (it stomped the hydrated list past the session latch and painted a permanent "No content detected" while the state oscillated 130<->0 — only visible at 100ms sampling + screencast frames). The toggle force-true and enabled-preserve during previews apply ONLY to marking-backed previews (`previewActive && previewMarkingSessionSnapshot`); the Silent Preview never snapshots, and forcing enabled there published isEnabled:true over a silent session AND blocked the content-wins sync from ever converging.
- Criterion-4 trap (2026-07-03): brain dictation locks the enable toggle for POST_AI so runs resolve via Save/Discard — but Save/Discard are HIDDEN in silent mode, so `postAi` must lock only while `facts.isEnabled` (silent + stale post_ai was unrecoverable without a brain-store reset); the popup must reset its POST_AI mirror (`resetAiRunMarkingsFingerprint`) on a real navigation (URL change beyond the hash), or its sticky `aiRunPhase: post_ai` publish keeps the brain locking the toggle for pages the run never belonged to.
- Per-frame live QA (2026-07-03): `.copilot/qa-scripts/run-flow2.mjs` = the acceptance harness for #5-family work (popup CDP screencast PNG-per-repaint into `.temp/frames-*/`, 100ms change-only viewstate sampling, two-sided click test, 6-minute post-exit hands-off window, per-criterion VERDICT). 250ms/2s samplers and short windows produced FALSE PASSES (writes coalesce between paints; the user-visible failure lived in the gaps and minutes later). Environment: never `tabs.reload` after `runtime.reload` (full-navigate instead), recreate the popup tab after a runtime reload, restart CDP observers (dead WS), `pkill -f` patterns must not match your own command line, and the extension login lives in profile `Default/Local Extension Settings/<ext-id>` — never delete it when surgically clearing profile state.
- REFLEX-ARC program (2026-07-03, architect-approved — the standing direction): the brain keeps DECISION authority and OBSERVES; each layer runs mechanical, deterministic, locally-orchestrated routines (muscle memory) with minimal persistent state, moved ONLY by discrete signals through predefined transition tables, each state applying a COMPLETE memorized presentation (including spinner/curtain content). Signals must be EVENTS born at the source with provenance + sequence + once-only consumption — never reconstructed downstream from re-served level snapshots (sticky facts/heartbeats re-serving state is the "brain echoes extra commands" class). Live proof of the boundary: the popup session machine (src/popup/marking-session-machine.ts) executed its table flawlessly in round-11 while a FALSE 'markings-changed' signal (content's post-exit config-sync merge flipping the draft report clean->dirty with no user edit) moved it wrongly — machines were right, the signal layer doesn't exist yet. Program docs: `.copilot/architecture/reflex-arc-plan.md` (the muscle-memory inventory per layer lives there as the phase tables) + HANDOFF.md "THE AGREED PROGRAM". Do NOT keep patching button/preview surfaces field-by-field; finish the program stages instead.
- THE MAIN PLAN (2026-07-03, architect-approved after live QA rounds): `.copilot/architecture/reflex-arc-plan.md` — native uf-bus signal frames (per-tab seq, provenance source+cause, pull-cursor consumption, brain-owned ring log), per-layer state machines whose per-state memories cover the FULL surface including curtain/spinner content, brain reduced to decisions + observation + signal emission, direct replacement per phase (no flags; safety = phase discipline: full gate + per-frame live acceptance before the next phase), saved lands in SILENT. The plan is written to be executed mechanically (states x signals x memories tables, file-level work items, per-phase deletions, tests, acceptance) — follow it rather than re-deriving; record divergences as DECISION lines in the plan. P0 foundation shipped as 171b05c + 2b780d9.
- REFLEX-ARC PROGRAM COMPLETE (2026-07-03, P0-P6 all shipped + live-accepted). The durable doctrine the phases established:
  - SPINNER/CURTAIN AUTHORITY (P4): the brain broadcasts SURFACE VOCABULARY only — `{kind, phase, startedAt, deadlineAt, operationId, reason?, spinnerKey?}` — never composed display strings. Every layer resolves presentation locally: the popup from the shared phase-definition table (`common/spinner-contract.ts`) with the marking-session machine's surface memory overriding on top; content from `resolveContentOverlayMemory(machineState)` first, then the definition table. `phaseToSpinnerState` and `deriveDictation` are DELETED. `session.dictation` is a PHASE POINTER `{phase}` only — the popup machine memories own buttons/mode/curtain content (BUTTON_IDS/CURTAIN_OPERATIONS left the bus contract with deriveDictation).
  - NO POPUP-LOCAL SPINNER STATE (P4.3): `src/popup/spinner.ts` is deleted. Popup operations request a brain broker LEASE via `runWithBrainSpinnerLease` (SET on start, REMOVE on settle); the navigation-inspection spinner's single writer is the brain's lifecycle selection, and gates observe it via `hasProjectedNavigationInspectionSpinner()` (never a local entry map).
  - CONTENT MACHINE IS THE PREVIEW ROUTINE RECORD (P4.4): facts/response builders and routine guards read `contentMarkingMachine` (via `machineOwnsPreviewRoutine()` / `resolveContentExitDestination()`), never the loose `aiPreviewState` active/mode/previousEnabled/restoreMarkingOnExit flags; aiPreviewState holds presentation data only.
  - POPUP REFRESH REDUCTION (P5): a spinner broadcast repaints ONLY the busy surface via the single `buildProjectedBusyViewState()` builder (a targeted `setViewState`), NOT a full `refreshUi`. `refreshUiInner` runs only on real triggers (open, tab/url change, user actions, signal-driven data needs). `stabilizePreviewViewState` + the `getPreviewItemsSignature`/`lastPreviewItemsSignature` bookkeeping are DELETED — the session item latch is the only continuity mechanism; the identical-push skip is an explicit canonical content-equality check. Measured heavy-page pass rate ~60/min -> ~0 idle. BONUS: the PAGE_SAVE spinner renders again (the targeted repaint catches broadcasts the full-refresh race swallowed).
  - #5/#14 IS CLOSED. The root cause (interleaved stale refreshUi passes publishing isEnabled:false after an exit settle) is removed at its source by P5's cadence removal, not just guarded. P6 acceptance: two independent 6+ minute post-exit holds (light + heavy properties) with ZERO drift; full six-flow matrix on three properties from a fresh install; FINDING-3 confirmed dead (247-item heavy page stable). The epoch/latch write-discipline guards from the earlier rounds remain as belt-and-suspenders but the class no longer occurs.
  - SEND-TO-LYNX STALENESS GUARD: the backend `cssInfo(url)` GraphQL query is the source of truth (fetched through the background, bearer token, stage-base endpoint). On checklist popover open — ONLY once page-type coverage is complete (the query is redundant while the todo guard blocks send) — the popup compares SANITIZED selector sets (split commas, trim, collapse whitespace, order-insensitive set equality per inclusion+exclusion field, no case folding) against the exact submit payload. FAIL-CLOSED: send disabled while pending (spinner shown) / on a both-field match / on check failure (reopen retries). `usesUnfluffify:false` or an empty backend never blocks; our submit flips usesUnfluffify true. Replaces the deleted local last-submitted-fingerprint guard.
  - AI-RUN TIMEOUT: one source of truth (`AI_RUN_DEFAULT_TIMEOUT_MS`/`_MINUTES` in `common/bus/contracts/ai-run.ts`) feeds the abort deadline, the REMOTE_WAIT spinner-definition duration, the countdown fallback, and the busy note — never hardcode the minutes.
- FRESH-INSTALL CONFIG GOTCHA (2026-07-03): the AI endpoint (`globalEndpoint`) must include the `:8443` port — `https://unfluffify.dnscdn.se` bare returns Cloudflare 525 on `/get_selectors`; `https://unfluffify.dnscdn.se:8443` returns 401 then authorizes. configEndpoint is `https://unfluffify.lynxdev.se`, stageBase `a.lynxdev.se` (GraphQL resolves to `https://api.a.lynxdev.se/graphql`). Clearing the `/load` config DB does NOT clear GraphQL Live Pages (permanent) or cssInfo selector history.
- LIVE-QA HARNESS RECIPE (2026-07-03, the working setup after the MCP/repo-launcher paths wedged on this Wayland host): a persistent playwright DRIVER process (scratchpad `pw` install at `playwright@next` to match the cached Chromium; `chromium.launchPersistentContext` with `--load-extension` + `--remote-debugging-port=9222`) owning the browser, reading newline commands from a `driver.cmd` file and streaming state deltas. Headed works under pw@next on Wayland; older pw pinned to an incompatible Chromium hung the pipe handshake (headless-new + `channel:"chromium"` was the earlier workaround). CRITICAL: the persistent profile CACHES the MV3 service worker — after any `pnpm build` the running SW is STALE (a new handler is in the bundle but returns undefined live); `chrome.runtime.reload()` + rebind sw/popup handles before testing a rebuild. Auto-accept `page`/`popup` dialogs or the discard/navigate flows hang. `pkill -f <driver>` self-matches the agent's own compound command (exit 144) and kills the launch — target PIDs from `pgrep` in a loop instead.
