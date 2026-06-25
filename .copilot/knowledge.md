# Unfluffify Knowledge

## Agent Workflow Assets

- Repository-level repeatable workflows live in `.github/skills/`. Use
  `review-fix-commit-push` for clean-review/fix/commit/push loops,
  `autonomous-implementation-plan` for precise implementation handoffs,
  `repo-safe-code-change` before non-trivial source edits,
  `extract-repo-knowledge` when updating durable architecture knowledge, and
  `launch-test-browser` to open the live/dev Chromium with the unpacked
  extension loaded for observation or manual testing.
- Live test browser: launch with `pnpm browser:live <target-url>`
  (`scripts/launch-test-browser.ts`).
  A target URL is mandatory. It runs `pnpm build`, loads `.output/chrome-mv3`,
  writes a per-environment `.temp/browser-mcp.config.json` (drops
  `executablePath`), and drives ONLY the `npm:@playwright/mcp@latest` managed
  Chromium over a single launcher-owned stdio client — never the OS Chrome. The
  launcher exposes a same-session control channel on its shell `shellId`; when
  the host environment supports writing to that running shell, use `state`,
  `exit-preview`, `observe`, `stop-observe`, and `help` there to
  inspect/control the bound popup and target page. Otherwise rely on the
  auto-enabled observation output plus `chromium.connectOverCDP(...)` against
  `http://127.0.0.1:9222` for active inspection/control of the already-open page
  and extension popup. Do not start a second MCP client/server for the same
  `.mcp-browser-profile`. The committed `.vscode/mcp.json`, `.mcp.json`, and
  `.vscode/browser-mcp.config.json` are intentionally placeholdered
  (`__UNFLUFFIFY_REPO_ROOT__`, `__CHROMIUM_EXECUTABLE_PATH__`) and
  non-launchable. Unpacked extension id is deterministic: SHA-256 of the
  absolute load path, first 16 bytes, each nibble mapped `0..15 -> 'a'..'p'`.
  Inside `browser_run_code_unsafe`, `setTimeout` and `URL` are undefined — use
  `page.waitForTimeout` and string ops.
- Always-on workflow guardrails live in
  `.github/instructions/agent-workflow-guardrails.instructions.md`. Future
  agents should read the knowledge base, relevant instructions/skills, active
  plan, source files, and tests before changing behavior.
- If a behavior decision is unclear, future agents should ask a deterministic
  multiple-choice question instead of guessing and encoding drift into code or
  docs.

## Testing

- Use pnpm/WXT as the primary release/CI toolchain: `pnpm lint`, `pnpm check`,
  `pnpm test`, `pnpm build`, `pnpm zip`, and `pnpm verify`.
- Keep Deno only as an internal implementation dependency behind the pnpm
  scripts and for the remaining orchestration/browser tasks; the shipped
  extension build itself is now WXT-native.
- `deno task <script>` can still resolve npm scripts implicitly via
  `package.json`, but the supported/public workflow is pnpm-first and docs/tests
  should treat those Deno aliases as unsupported compatibility fallbacks.

## WXT migration facts

- WXT treats `entrypoints/popup.html` / `entrypoints/popup/index.html` as a
  special popup entrypoint and auto-generates `action.default_popup`. When the
  source-of-truth manifest intentionally omits that field (as Unfluffify does
  for side-panel-driven popup opening), the generated manifest still needs its
  `action` block restored to the source contract before shipping.
- WXT emits content-script bundles under `content-scripts/<name>.js`. After C5,
  Unfluffify's source manifest and manual injection paths use those native WXT
  output paths directly instead of materializing root alias files.
- C6 browser polyfill adoption starts from `common/browser.ts`, which is now the
  runtime seam for browser-compatible extension APIs. Shared one-shot messaging,
  bus transports, and touched type positions should import `browser` /
  `Browser.*` from that seam instead of reaching for raw `chrome.*` directly.
- The browser seam must prefer a promise-capable browser surface (`globalThis.browser`
  or the WXT/browser export) ahead of any raw `globalThis.chrome` fallback. The
  C6 shared adapters (`common/async-messaging.ts`, `common/bus/transport/*`)
  now assume promise-based `sendMessage` semantics.
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
  for `entrypoints/**/*.ts`, while `wxt.config.ts` / `vitest.config.ts` live in
  a separate Node-typed project (`tsconfig.wxt-node.json`). Mixing Node globals
  into the entrypoint graph reintroduces timer-signature conflicts in browser
  code such as `common/page-motion-freeze-control.ts`.
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
- Release packaging now stages from the synced WXT output at
  `.output/chrome-mv3`. `pnpm verify` runs the pnpm lint/check/test pipeline,
  rebuilds via `pnpm build`, and then runs the generated-manifest permission
  test directly. The release workflow uses `pnpm zip` for a synced
  `.output/chrome-mv3` archive, then `scripts/package-extension.mjs` to preserve the stable
  `extension-latest` / `Unfluffify-latest.zip` alias semantics.

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
  it must NOT be web-accessible. `tests/manifest-permissions.test.js` now
  asserts every literal `getURL("…")` injected resource is web-accessible.

## Current Architecture Decisions

- Popup tab-runtime snapshots must flow through the background command
  `POPUP_GET_TAB_VIEW_STATE`; do not reintroduce popup fallback reads through
  `WORLD_MESSAGE_TYPES.GET_BACKGROUND_STATE`.
- Earlier storage-access work centralized Chrome storage access through domain
  stores instead of raw scattered `chrome.storage` or `utils.storage*` calls.
- Chrome storage access is now restricted to approved storage/domain modules
  guarded by `tests/storage-access-boundary.test.js`; background, popup, and
  content production paths should call domain helpers rather than direct
  `chrome.storage` or `utils.storage*` wrappers. Page-local `localStorage` /
  `sessionStorage` usage is tracked separately from this Chrome storage rule.
- Earlier world-decomposition work is complete. Content follow-up Tracks D/E are
  complete, Track F is complete through F24, and the high-risk plan is complete
  through G5. The active post-G5 work is Track H in
  `.copilot/content-main-followup-refactor-plan.md`: extract the legacy
  plain-message runtime router, the support-page runtime-message subgroup, and
  the lazy handler/client service registry from `content-main.js` while keeping
  popup/background plain runtime message callsites unchanged. Hard rules
  remain: never edit `content/core.js` or locked marking/silent-highlight/
  visibility/reconciliation logic without a new high-risk plan; every new
  imported `content/*` module must be added to `web_accessible_resources` with
  `tests/manifest-permissions.test.js` green; live validation is required for
  core unflagged behavior when automated validation is not enough, while
  flag-disabled property-lock follow-ups may defer live
  validation until those features are prioritized.
- Part C native WXT runtime adoption is active on `feat/wxt-port-plan`. C0-C5
  are complete: C2 proved that the background service worker can be
  native-bundled by making startup explicit behind `startBackground()` while the
  root `background.ts` still self-starts for the legacy esbuild path, and C3
  proved that the popup can be native-bundled by importing `popup.ts` from the
  WXT popup entrypoint once timer helpers are kept browser-typed. C4 proved the
  content runtime can be native-bundled through WXT entrypoints while content
  code WAR is removed, the MAIN-world bridge is aliased back onto the source
  manifest path, the root `content-main.js` artifact is retired, and the legacy
  `activateContentMain` reply contract stays intact for background bootstrap
  compatibility. C5 removed the esbuild build, the `legacy/` mirror, and the
  standalone sync bridge: `pnpm build` is now pure `wxt build`, the source
  manifest uses native `content-scripts/*` paths, stable public assets are
  copied through WXT hooks, popup live-debug state comes from the popup debug
  hook instead of mirrored `popup/ui.js`, and the only remaining manifest
  override is restoring the source `action` block to omit `default_popup`.
- C6 is in progress. The first two browser-polyfill batches are complete: the
  repo now has a dedicated browser seam; shared async messaging, bus
  transports, popup/offscreen runtime listeners, popup active-tab fallback
  lookup, and popup render-mode tab-load waiters use promise-based browser APIs
  through that seam; touched type positions use `Browser.*`; and
  `tests/browser-polyfill-boundary.test.js` tracks the remaining raw-`chrome`
  migration debt for later C6 batches.

## Popup Preview Exit Contract

- Approved popup button-state contract for the AI run -> Show Content List ->
  Exit Preview -> marking mode flow:
  - fresh marking entry: Run AI enabled, Show Content List disabled, Save
    disabled, Discard disabled, marking toggle checked/enabled
  - clean post-AI-run state: Run AI disabled, Show Content List enabled, Save
    enabled, Discard enabled, marking toggle checked/enabled
  - stale post-edit state: Run AI enabled, Show Content List disabled, Save
    disabled, Discard enabled, marking toggle checked/enabled
  - Show Content List preview is read-only, and exiting it must be
    state-neutral: restore the exact pre-preview marking state after at most a
    brief restore-pending bridge
- Known preview-exit pitfall: the current bug source is the split close
  protocol between the immediate `TAB_CLOSE_AI_PREVIEW` response and the later
  async `aiPreviewClosed` notification. Future fix work must make
  popup-initiated preview close restore from an authoritative close payload
  synchronously while keeping the async notification as compatibility backup,
  and must preserve the authoritative draft snapshot instead of re-probing a
  transient re-derived draft during preview exit.

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
- Page-save reconciliation must not be cleared merely because `/save` returned OK; the forced backend reload must confirm the current page is present in the backend-saved cache.
- A page with no local or remote saved data must remain saveable even when the user accepts the default markings as-is and has made no manual toggle changes.

## Marking and Highlighting Rules

- The marking rules are a locked compatibility contract. Do not change taxonomy, target resolution, sync semantics, overlay projection, or default-exclusion behavior unless the user explicitly requests a marking-rules contract change.
- For reload/page lifecycle work, run a Q&A sanity-check phase before implementation: trace marking rules, rendering rules, XPath calculation, and AI payload construction so fixes preserve the locked contract and avoid large message transfers.
- Any legitimate marking contract change must update `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and focused regression tests in the same commit.
- Marking rules are anchored to the approved `052c164b077d459fa7a6e79b306f01144336719c`-derived contract, with deliberate current safeguards: `BUTTON` is toggleable, the redundant void `LINK` tag is omitted from the taxonomy, stricter geometry/paint guards stay active, selector-excluded content has no dedicated marking overlay, and silent highlighting stays `immutable`/`content`/`excluded`.
- Shift expanded exclusion restores the 052c chooser: self structured/toggleable boundary, nearest structured group ancestor, nearest toggleable ancestor, then broadest markable ancestor, while still rejecting shallow generic body-level page shells.
- Alt explicit include restores 052c mixed direct-text ancestor promotion while keeping current silent-whitespace safeguards.
- Toggleable default exclusions are `FOOTER`, `FORM`, `LABEL`, `NAV`, `HEADER`, `DIALOG`, `ASIDE`, and `BUTTON`. Immutable defaults are `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`, `SCRIPT`, `TEMPLATE`, `IFRAME`, and `VIDEO`. `LINK` is intentionally omitted from the taxonomy because a `<link>` is a void metadata element that never carries text or descendants and can never be a marking target.
- Exclude clicks drill into markable descendants inside active toggleable default boundaries; the generated default ancestor is stored as `excluded: false` while the descendant becomes explicit. Generated/default descendant rows also participate in suppressing broader auto-default ancestors. Blank/default-boundary clicks can still unmark the boundary itself.
- Toggleable defaults differ from user/CSS-selected exclusions only during the inclusion/exclusion decision. After sync decides a default boundary is excluded, generated rows whose live element still matches a toggleable default render through the ordinary exclude marking path even without `explicit: true` and stay out of the implicit/default content layer; stale untagged non-default excludes must stay hidden.
- Toggleable default exclusions must not have a dedicated visual layer, CSS class, render collection, or post-hoc overlay rule.
- A stored toggleable default row with `excluded: false` unmarks only that boundary without becoming a full explicit include subtree.
- Stored unexcluded default boundaries also suppress their own default-layer marking, but not their descendants, to avoid visual-only ancestor ghosts around explicit descendant marks.
- Default-layer collection remains structural and is not globally filtered by visible explicit marks; broad filtering can make implicit descendants flicker on alternating toggles.
- Fast explicit-toggle overlay refreshes must run `syncPageMarkings` before drawing explicit layers, but must not recompute the default layer. Structural toggles run the invalidating full render immediately after that refresh; leaf explicit-exclude toggles may patch cached lower-priority collections and debounce the invalidating full render to keep mark/unmark acknowledgement responsive.
- Marking enable uses `setEnabled` as the single activation path; do not add a second immediate popup `forceRefresh` after successful enable.
- Marking data is session-scoped: every marking enable recomputes the page entry fresh from defaults + CSS/AI-selector influence (selector influence only when a selector set is present), discards any stale `config.pageMarkings[pageUrl]` draft, and adopts the freshly synced entry as the clean baseline on the first render so a freshly enabled page never starts dirty. Backend-saved explicit markings do not pre-populate the fresh session entry or seed the clean baseline, no unsaved-draft cache survives a disable (`enableForBaseUrl` deletes the stale entry and sets `pendingFreshBaselinePageUrl`; `renderHighlightsInner` reseeds `setSavedPageEntry`), and marking is disabled on any navigation/reload regardless of same page or property.
- Full marking passes may use per-pass caches for visibility, text, immutable/default selector, ancestor, and textual-descendant decisions. These caches are derived from the current DOM/config and must not become persistent marking truth.
- Explicit include boundaries block descendant hover targeting and marking until the exact include boundary is removed.
- Hidden explicit include/exclude markings persist while their DOM element exists and render as non-toggleable ghost markings when measurable.
- Marking mode uses `Alt` for explicit include, `Shift` for parent selection, and hold-`Space` for temporary page UI interaction/pass-through.
- Preview Contents is intentionally available in marking mode again, gated on AI-run freshness and page-save reconciliation. Silent Preview Contents still reads the latest stored selector set, and Send to Lynx remains silent-highlighting-only with handler-level guards outside silent mode.
- Shift parent selection may climb wrapper chains to cohesive content boundaries, but must reject shallow generic body-level page shells with broad viewport footprint or multiple page landmarks.
- Marking overlays watch style mutations so dynamic opacity, visibility, and movement changes trigger repositioning.
- The marking mutation observer re-runs `hideConsentElements()` on any non-overlay `childList` batch so late-injected consent widgets are hidden during active marking. This is idempotent and loop-safe (the consent bypass `<style>` is appended to `document.head`, which the body-scoped observer does not watch). It is currently un-debounced (unlike the adjacent `scheduleRender`); fold it into a throttled path if a highly mutating page shows cost during marking.
- `REMOVABLE_ELEMENT_SELECTORS` (the consent/overlay matcher) is a HIGH-PRECISION allowlist, not an exhaustive one. It covers cookie/consent/gdpr, modal/popup/dialog/alertdialog/`aria-modal`, native `dialog[open]`, overlay/backdrop, interstitial, and newsletter/subscribe signals across class/id/role/aria-label. Do NOT add generic content words (`banner`, `notice`, `toast`, `lightbox`, `paywall`, the `cmp` substring, `role=banner`) — they match real headers/promos/galleries/AEM components and would hide actual page content. Every non-element entry keeps the `:not(body):not(html)` guard. Any future addition must be validated against the live AI-submission smoke (bonliva 117 / prowork 76 / vitec-pyramid 57 included-visible) so included-content counts do not drop. `tests/consent-selector-precision.test.js` locks the safe-include / forbidden-broad contract.
- Extension-owned UI injected into the page (toasts, banners, notices, AI popover, motion-pause indicator) uses the shared `EXTENSION_UI_FONT_STACK` constant (mirrors the popup brand `--font-sans` = Inter) rather than ad-hoc per-element families. The Material Design Icons glyph font is intentionally separate.
- Page motion pause is a shared marking/silent-highlighting lifecycle source. Marking/reveal warmup first hides consent chrome before inspection styling or any scroll, then shows a page-inspection spinner, blocks page/content-overlay input, performs the historical max-scroll reveal walk for lazy content, returns to the reserved scroll position, freezes, and renders overlays. Matching base-URL pages stay frozen even before selector overlays exist; the pause uses broad CSS/Web Animations/SVG/media/style-lock coverage plus a page-world timer/rAF gate, normalizes layout-present scroll/viewport/attribute-driven reveal candidates such as Webflow `data-w-id` blocks to visible posture, shows an Unfluffify-scoped Material Design Icons snowflake/code indicator without injecting global `.mdi` page styles, excludes extension-owned UI, keeps internal marking scheduling on extension-owned timers/rAF, and strips all freeze mechanics from snapshots.
- Opening Unfluffify on a supported page enables mobile simulation by default for a fresh tab session. A user-disabled mobile simulation state is a per-session choice and must not be auto-enabled again until the tab session state is cleared, except that active marking sessions force mobile simulation back on for the editor tab until marking is disabled.
- When AI selectors exist for the current property, the popup exposes a separate desktop-preview checkbox that persists for the tab lifecycle via initial tab state. Enabling it switches the page to desktop emulation, keeps silent previewing available, disables marking entry, and DevTools detach clears the checkbox back to forced mobile simulation.
- Same-property pages that are no longer current Live Page candidates still keep silent highlighting and property-lock visibility for that property. Only marking entry is blocked there; the popup should not collapse the whole page UI just because the page is off-candidate.
- While the current editor stays on a same-property off-candidate page, content and popup mirror a 70 second local countdown from tab-scoped initial state. When it expires, the content script sends `propertyLockRelease` so the editor role is dropped unless the user has returned to a candidate page first.
- If the current editor navigates to a different property, the old property enters a 30 second cross-property recovery cooldown stored in initial tab state (`siteId`, `baseUrl`, `clientId`, `deadlineAt`). The new page and popup mirror that warning, returning to the original property reuses the same client session, and expiry sends `propertyLockRelease` for the old property runtime.
- Tab removal is different from navigation disconnects: the background immediately sends `release_lock` and disposes the property-lock runtime for that tab instead of waiting for the ordinary 70 second disconnect grace used for reconnectable page transitions.
- Popup-side property-lock warning rendering must treat mirrored initial-tab-state countdowns as authoritative UI state. Cross-property and off-candidate warnings must still render even when the freshly fetched live lock snapshot on the current page is inactive, unavailable, or no longer reports `isEditor`.
- If marking remains enabled while page editing is blocked by save reconciliation, the page overlay must visibly enter the temporary disabled state: dim markings, clear hover, show the paused status notice, and strip that UI from snapshots.
- Repo-local Phase 2 live validation currently uses `scripts/smoke-property-lock-phase2.mjs` with `xvfb-run -a node ...`. The most reliable setup is the persistent repo profile plus an explicit `chrome.runtime.reload()` of the unpacked extension worker before each run. Fresh profiles are not meaningful product validation until the required extension config/auth state is present.
- The current property-lock smoke harness is good for cross-property countdown diagnostics, but it is still operationally flaky around popup reopen/auth bootstrap after extension reload. Treat smoke failures that land on the unauthenticated popup as harness/profile issues unless they reproduce while the page banner and `tabState:initial:*` storage also show bad state.
