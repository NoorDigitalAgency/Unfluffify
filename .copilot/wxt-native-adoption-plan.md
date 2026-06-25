# Part C — Native WXT Runtime Adoption Plan

Last updated: 2026-06-25
Branch: `feat/wxt-port-plan`
Status: C0 complete; C1 ready

This is the executor doc for **Part C** of the WXT program. It is written so a
low-context agent can execute it without inventing architecture or making
unresolved product decisions. It builds directly on:

- `.copilot/wxt-port-plan.md` (Part A toolchain cutover + Part B index)
- `.copilot/knowledge.md` (WXT migration facts, WAR rules, storage boundary)
- `.copilot/event-bus-architecture-plan.md` (the bus/Brain authority model)

> Read those first. Do not re-derive their decisions here.

---

## 1. Goal

Make Unfluffify genuinely **WXT-native at runtime**, not just WXT-packaged.
Today WXT is only a manifest generator plus five thin entrypoint shims that
`import(chrome.runtime.getURL("legacy/<x>.js"))` modules that are still bundled
by the custom Deno/esbuild pipeline (`scripts/build-extension.ts` →
`dist/extension` → mirrored into `.output/chrome-mv3/legacy/` by
`scripts/sync-wxt-bootstrap.mjs`). Part C makes WXT bundle the real application
code directly from its entrypoint import graphs, removes the esbuild build and
the `legacy/` mirror, and adopts WXT's runtime helpers (`wxt/browser` polyfill,
`wxt/utils/storage`, and `@webext-core/messaging` for one-shot request/reply)
**beneath** the existing higher-level concepts (typed event bus, background
Brain authority, popup/content layer hosts, spinner/activation contracts), which
are preserved unchanged. No user-visible behavior changes.

---

## 2. Current facts (verified 2026-06-25)

### Build pipeline (the thing being replaced)

- `pnpm build` =
  `node scripts/run-deno.mjs run … scripts/build-extension.ts --release && wxt build && node scripts/sync-wxt-bootstrap.mjs`
  (`package.json`).
- `scripts/build-extension.ts` runs **esbuild with `bundle: false`** (line ~185),
  `format: "esm"`, `outbase: repo root`, emitting one `.js` per source `.ts`
  into `dist/extension/`, plus copying static assets (icons, cursors, assets,
  `*.html`, `*.css`, `manifest.json`).
- Because `bundle: false`, every imported `content/*` and `common/*` module is a
  **separate runtime ESM file** the browser fetches individually — which is the
  ONLY reason they must each be web-accessible.
- `scripts/sync-wxt-bootstrap.mjs` copies `dist/extension` into
  `.output/chrome-mv3` (skipping WXT-owned `content-loader.js`, `popup.html`,
  `offscreen.html`), mirrors the whole tree again into
  `.output/chrome-mv3/legacy/`, materializes a `content-loader.js` root alias,
  and bridges the manifest `action`/`background`/`content_scripts` back to the
  source `manifest.json`.

### WXT surface today (the shims)

- `wxt.config.ts`: `imports: false` (no auto-imports); manifest block hand-authors
  `permissions`, `host_permissions`, `web_accessible_resources`, `icons`,
  `action.default_title`; `version` read from `manifest.json`.
- `entrypoints/background.ts` = `defineBackground(() => {})` (EMPTY). Real
  background runs from mirrored `legacy/background.js` via the bridged manifest
  `background.service_worker`.
- `entrypoints/content-loader.content.ts` = `defineContentScript({ matches:
  ["<all_urls>"], runAt: "document_start", main })` where `main` does
  `await import(chrome.runtime.getURL("legacy/content-loader.js"))`.
- `entrypoints/page-motion-freeze-bridge.content.ts` =
  `defineContentScript({ …, world: "MAIN", allFrames: true, main })` →
  `import(chrome.runtime.getURL("legacy/common/page-motion-freeze-bridge.js"))`.
- `entrypoints/popup/main.ts` = `void import(chrome.runtime.getURL("legacy/popup.js"))`.
- `entrypoints/offscreen/main.ts` = `void import(chrome.runtime.getURL("legacy/offscreen.js"))`.
- WXT version: `0.20.27`. Available helpers (verified in `node_modules/wxt/dist`):
  `wxt/utils/define-background`, `wxt/utils/define-content-script`,
  `wxt/utils/define-unlisted-script`, `wxt/utils/inject-script`,
  `wxt/utils/storage` (`storage.defineItem`), `wxt/browser` (`browser` polyfill).
  There is **no** `defineOffscreenDocument`; offscreen is a plain HTML entrypoint
  (`entrypoints/offscreen/index.html` + `main.ts`). **WXT messaging is NOT
  bundled**; "WXT messaging" requires adding the `@webext-core/messaging` dep.

### Real entry modules (currently bundled by esbuild, runtime-loaded as legacy)

| Source (repo root) | Output today | Top-level await? | Init-order sensitive? |
|---|---|---|---|
| `background.ts` (~3640 lines) | `legacy/background.js` | No | YES (worldTrace→legacyBridge→brain→16×registerBackgroundCommand→onConnect→onMessage) |
| `popup.ts` (~8593 lines) | `legacy/popup.js` | No (`init()` called un-awaited at EOF) | partial |
| `content-main.ts` (~7460 lines) | `legacy/content-main.js` (WAR, loaded via getURL by content-loader) | No (`export function main()`) | YES |
| `content-loader.ts` (~120 lines) | `content-loader.js` (registered content script) | No | YES (de-dup guard) |
| `offscreen.ts` (~53 lines) | `legacy/offscreen.js` | No | No (1 listener) |
| `common/page-motion-freeze-bridge.ts` | `legacy/common/page-motion-freeze-bridge.js` (MAIN world) | No (IIFE) | No |

- The ONLY two runtime `getURL` dynamic imports in content are
  `content-loader.ts:45` (`content-main.js`) and `content-loader.ts:84`
  (`common/feature-flags.js`). Everything else under `content/*` is a static
  ESM import resolved at runtime because of `bundle: false`.
- Page-world `getURL` ASSETS that must stay web-accessible: cursor SVGs
  (`content/core.ts:6519-6520`, `cursors/exclude.svg`, `cursors/include.svg`).
- `background.ts` also opens extension pages via runtime URLs
  (`background.ts:687` `OFFSCREEN_DOCUMENT_PATH`, `background.ts:2127`
  `getURL("popup.html")`), but those HTML documents are extension pages, not
  `web_accessible_resources`, and Part C must preserve their paths without
  adding them to WAR.
- `common/page-motion-freeze-control.ts` is injected via
  `chrome.scripting.executeScript({ func })` (serialized) and must **NOT** be
  web-accessible.

### Storage layer (for `wxt/utils/storage` adoption)

- Single chokepoint `common/storage-core.ts` exposes
  `storageGet/storageSet/storageRemove/storageClear/addStorageChangeListener`
  (callback→Promise wrappers over `chrome.storage.*`).
- `tests/storage-access-boundary.test.js` restricts raw `chrome.storage.*` to 7
  approved modules: `common/storage-core.ts`,
  `background/transfer-payload-store.ts`, `background/ai-run-record-store.ts`,
  `common/settings-store.ts`, `background/tab-session-store.ts`,
  `common/emulation.ts`, `common/render-mode-js-state.ts`.
- Two boundary-internal bypasses to refactor first:
  `common/settings-store.ts:~130` (`chrome.storage.onChanged.addListener`) and
  `common/render-mode-js-state.ts:~38-40` (direct `session.set/remove`).
- Storage areas in use: `sync` (7 `global*` keys), `session` (`tabState:*`,
  `scriptInjected:*`, `popupAiRun`, `remote-config-*`, `deviceEmulation:*`,
  `renderModeNoJsHeld:*`). No `local`/`managed`.

### Messaging layer (for `@webext-core/messaging` adoption, HYBRID)

- Typed bus (`common/bus/*`) is transport-abstracted via a `Transport` interface
  (`common/bus/transport/transport-types.ts`). Three transports are the only
  bus chokepoints:
  - `content-transport.ts:17` `chrome.runtime.sendMessage` (one-shot, → background)
  - `popup-transport.ts:59` `chrome.runtime.sendMessage` (one-shot request/reply)
  - `popup-transport.ts:23` `chrome.runtime.connect` (PERSISTENT port, events)
  - `background-transport.ts:140` `chrome.tabs.sendMessage` (one-shot, → content);
    `:237` popup port `onMessage`; `:86` port reply.
- Legacy `common/async-messaging.ts:327,348` (`runtime.sendMessage` /
  `tabs.sendMessage`) used by `popup/messages.ts`.
- PERSISTENT port channels that `@webext-core/messaging` CANNOT model (one-shot
  only): popup bus port (`popup-transport`/`background-transport`), property-lock
  port (`common/property-lock-background.ts:397` server +
  `content/property-lock-port-client.ts:105` client), popup-state-broker port
  (`background/popup-state-broker.ts:69,140`, `ufPopupState:` prefix).

### Test contracts that pin the current shape (must be updated as files move)

- `tests/manifest-permissions.test.js`: (a) every literal `getURL("…")` injected
  page resource is web-accessible; (b) no broad `content/*.js`/`common/*.js`
  wildcards; (c) `content-main.js` imports of `./content/*` are all in WAR. **(c)
  and most of the explicit content WAR list are eliminated by native bundling and
  must be rewritten in C4.**
- `tests/package-extension.test.js`: staged output currently includes
  `content-main.js` and `common/config.js` because packaging walks manifest
  entrypoints plus WAR resources. This staging contract changes once C4 removes
  code-module WAR and C5 removes the esbuild/legacy shape.
- `tests/build-artifact-parity.test.js`: currently hard-codes
  `dist/extension` and `dist/extension/manifest.json`. C5 must migrate or retire
  that assertion once `dist/extension` disappears.
- `tests/build-extension-package-workflow.test.js`: currently asserts the release
  workflow's `required_files` list still contains `content-main.js`. C4/C5 must
  update that workflow contract when code-module WAR and the legacy shape are
  removed.
- `vitest-tests/a1-bootstrap.test.ts`: verify-gating transitional bridge test for
  `scripts/build-extension.ts`, `scripts/sync-wxt-bootstrap.mjs`,
  `manifest.json`, `legacy/`, and WXT-owned `popup.html` / `offscreen.html`
  preservation. It must be updated or retired as the hybrid bridge disappears.
- `tests/storage-access-boundary.test.js`: the 7-module storage allowlist.
- `tests/package-test-script.test.js`: deno-task and lint-rule contract;
  `resolveDenoExecutable()` usage in build scripts (touched when esbuild build
  script is removed in C5).
- `tests/device-emulation-lifecycle.test.js:255`: regex pins
  `documentUrls: [chrome.runtime.getURL("popup.html")]` in `background.ts` source.
- Many other `readFileSync(new URL(...))` source-contract tests reference
  repo-root paths (`background.ts`, `content-main.ts`, `popup.ts`). When a module
  is MOVED into `entrypoints/`, update the test's path constant; do NOT weaken the
  assertion.

---

## 3. Decisions already made

User-approved for Part C (this session):

1. **Full native bundling.** WXT bundles the real code; drop esbuild
   (`build-extension.ts`) and the `legacy/` mirror. Eliminate all `content/*`
   web-accessible resources and `getURL` dynamic imports of code modules.
2. **Messaging = HYBRID.** Port the one-shot request/reply paths
   (`content-transport`, `popup-transport` request path, `async-messaging`) to
   `@webext-core/messaging` for portability/maintainability. KEEP the three
   persistent port channels (popup bus port, property-lock, popup-state-broker)
   on raw `chrome.*` ports — `@webext-core/messaging` is one-shot-only and
   cannot model long-lived connections; this is a functional requirement, not a
   design preference.
3. **Adopt `wxt/browser` polyfill** (`browser`) in place of raw `chrome.*`,
   behind a single re-export seam, migrated in mechanical batches.
4. **Adopt `wxt/utils/storage`** (`storage.defineItem`) behind the existing
   `storage-core.ts` boundary; the 7 approved storage modules and the boundary
   test stay intact.

Repository constraints (locked, inherited):

5. Do NOT change marking/highlighting, silent-highlight, visibility,
   reconciliation, XPath, AI-submission, overlay projection, spinner/lease, or
   property-lock **semantics**. Part C is structural/toolchain only.
6. Keep the side-panel `action` contract: no `action.default_popup`.
7. Keep cursor SVGs web-accessible; preserve the existing runtime URLs for
   `popup.html` and `offscreen.html` without adding those HTML pages to WAR; keep
   `page-motion-freeze-control` OUT of WAR.
8. Every commit must be green: `pnpm lint && pnpm check && pnpm test && pnpm build`
   (canonical full gate: `pnpm verify`). Live-browser validation via
   `pnpm browser:live https://bonliva.se` for runtime-behavior phases.

---

## 4. Open questions

None blocking. Resolved this session: scope = full native; messaging = hybrid;
browser polyfill = yes (seam + batches); storage = yes (behind boundary).

If, during C2/C4, WXT's Node-side typecheck of an entrypoint import graph forces
a DOM-vs-Node `lib`/timer conflict that cannot be resolved by tsconfig project
separation, STOP and ask before weakening types or adding broad casts.

---

## 5. Non-goals

- No behavior change, no feature flags flipped, no new product behavior.
- No Firefox/Safari parity work.
- Do NOT port the persistent port channels to `@webext-core/messaging`.
- Do NOT collapse or restructure the typed bus / Brain / layer-host abstractions;
  they sit ON TOP of the new WXT-native base unchanged.
- Do NOT enable WXT auto-imports (`imports: false` stays) — the codebase is
  explicit-import by contract (`no-sloppy-imports` / `.js` specifier rules).
- Do NOT touch `content/core.ts` marking internals.

---

## 6. Implementation phases

Each phase is independently shippable and ends with a review-fix-loop → commit →
push. The order de-risks by flipping the simplest entrypoint to native bundling
first and the hardest (content) later, while the `legacy/` mirror keeps the
not-yet-migrated entrypoints working (a strangler within Part C).

### Phase C0 — Baseline, safety rails, contract-test inventory

**Files**: this doc; `.copilot/plan.md` (add Part C to active docs); session
plan.

**Steps**
1. Confirm clean green baseline: `pnpm verify` passes; worktree clean; branch in
   sync.
2. Enumerate every source-contract test that pins a repo-root path or a content
   WAR entry (grep `readFileSync` + `new URL` in `tests/`, and the
   `manifest-permissions` WAR list). Record the list in this doc's appendix so
   later phases know exactly which assertions to update when a module moves.
3. Snapshot the current generated manifest (`.output/chrome-mv3/manifest.json`)
   and the WAR list as the parity reference.

**Expected state**: a precise map of which tests break when each entry module
moves into `entrypoints/`.
**Validation**: `pnpm verify`; `git --no-pager diff --check`.
**Rollback**: docs-only; none needed.

### Phase C1 — Native-bundle the offscreen entrypoint (lowest risk)

**Files**: `entrypoints/offscreen/main.ts`, `entrypoints/offscreen/index.html`,
`offscreen.ts` (source), `scripts/sync-wxt-bootstrap.mjs` (stop mirroring
`offscreen.js` to legacy once unused), affected source-contract tests.

**Steps**
1. Move the body of root `offscreen.ts` into the WXT offscreen entrypoint import
   graph: `entrypoints/offscreen/main.ts` imports the offscreen logic module
   directly (static import) instead of `import(getURL("legacy/offscreen.js"))`.
   Keep `offscreen.ts`'s logic in a module WXT can bundle (e.g. move
   `offscreen.ts` → an importable `offscreen/main.ts` module, or import its
   exports). Preserve the single `chrome.runtime.onMessage` listener and its
   `DOMParser` refinement behavior exactly.
2. Ensure `background.ts` still creates the offscreen doc via
   `chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)` and that WXT emits
   `offscreen.html` at the path the manifest/runtime expects (bridge if needed).
3. Remove the now-dead `legacy/offscreen.js` runtime-load path.

**Expected state**: offscreen runs from WXT-bundled code; no `legacy/offscreen.js`
dependency.
**Validation**: `pnpm build`; load `.output/chrome-mv3`; trigger an AI run that
uses offscreen XPath refinement; `pnpm verify`.
**Rollback**: restore the `import(getURL("legacy/offscreen.js"))` shim; the legacy
mirror still exists until C5.

### Phase C2 — Native-bundle the background entrypoint

**Files**: `entrypoints/background.ts`, `background.ts` (source) and its
`background/*` import graph, `tsconfig.wxt.json` (if entrypoint typecheck needs
the background graph), `scripts/sync-wxt-bootstrap.mjs`, affected source-contract
tests (e.g. `device-emulation-lifecycle.test.js:255` path), knowledge doc.

**Steps**
1. Convert `entrypoints/background.ts` from `defineBackground(() => {})` to
   `defineBackground(() => { … })` whose body is the real background bootstrap,
   by importing the background entry module's exported `start()`/`main()` (refactor
   root `background.ts` to export an idempotent `startBackground()` that contains
   today's top-level side effects in the SAME order:
   worldTrace → legacyBridge → brain → 16×`registerBackgroundCommand` →
   `onConnect` → `onMessage` → remaining listeners → deferred sweeps).
   `defineBackground`'s callback is sync; today there is no top-level await, so
   this is safe. Do NOT reorder registrations.
2. Resolve the WXT Node-typecheck risk (knowledge §"Do not import the legacy
   browser-source entry roots directly from WXT entrypoint files"): the
   entrypoint now legitimately imports browser code that WXT bundles for the
   browser target. Ensure `tsconfig.wxt.json` includes the background graph with
   browser `lib` settings so DOM/`setTimeout` types resolve as browser, not Node.
   If a Node-vs-DOM timer type conflict appears, isolate via project references /
   `lib` config — NOT via broad `any` casts. If unresolvable, STOP and ask.
3. Stop runtime-loading `legacy/background.js`; the bridged manifest
   `background.service_worker` now points at the WXT-emitted `background.js`.
4. Update source-contract tests whose path constants referenced root
   `background.ts` to the new location if the file moved; keep assertions intact.

**Expected state**: the service worker is WXT-bundled; init order preserved; no
`legacy/background.js`.
**Validation**: `pnpm build`; `pnpm verify`; `pnpm browser:live https://bonliva.se`
— popup binds, marking + AI run + page save smoke, `state`/`observe`/
`exit-preview` work.
**Rollback**: revert entrypoint to the empty `defineBackground` + legacy bridge.

### Phase C3 — Native-bundle the popup entrypoint

**Files**: `entrypoints/popup/main.ts`, `entrypoints/popup/index.html`,
`popup.ts` + `popup/*` graph, `*.css`, source-contract tests.

**Steps**
1. Move the real `popup.html` body into `entrypoints/popup/index.html` (preserve
   DOM structure, ids, CSS links exactly — popup UI/button-state contracts depend
   on ids like `#compute`, `#marking-preview`, `#page-save`, `#page-revert`,
   `#toggle-enabled`). Keep NO `action.default_popup` (side-panel contract).
2. `entrypoints/popup/main.ts` imports the popup bootstrap directly (refactor
   root `popup.ts` to export an idempotent `startPopup()`), replacing
   `import(getURL("legacy/popup.js"))`. Preserve the existing `init()` call
   semantics (await it inside `startPopup` if needed to avoid the un-awaited race,
   but do NOT change observable ordering of the first render vs bus connect).
3. Ensure CSS/theme files are emitted to the paths the popup HTML references
   (WXT `public/` or imported assets).
4. Stop mirroring `legacy/popup.js`.

**Expected state**: popup runs from WXT-bundled code; ids/CSS unchanged.
**Validation**: `pnpm build`; `pnpm browser:live https://bonliva.se` — full popup
UI, theme, every button-state transition, exit-preview; `pnpm verify`.
**Rollback**: restore the legacy popup shim.

### Phase C4 — Native-bundle the content entrypoints (hard; eliminates content WAR)

**Files**: `entrypoints/content-loader.content.ts`,
`entrypoints/page-motion-freeze-bridge.content.ts`, `content-loader.ts`,
`content-main.ts` + the full `content/*` graph, `common/page-world-protocol.ts`,
`content/page-world-relay.ts`, `wxt.config.ts` (WAR list), `manifest.json`
(content WAR), `tests/manifest-permissions.test.js` (rewrite content WAR
assertions), `scripts/sync-wxt-bootstrap.mjs`.

**Steps**
1. Fold `content-main.ts` and all its static `content/*` imports into the
   ISOLATED-world content entrypoint: `entrypoints/content-loader.content.ts`
   `main()` imports `content-main`'s `main()` directly (static import → WXT
   bundles the whole graph into one content script). Remove the
   `import(getURL("content-main.js"))` and `import(getURL("feature-flags.js"))`
   dynamic loads; import those modules statically.
2. Preserve the content de-dup guard and `main()` idempotency
   (`state.initialized`). Preserve `runAt: document_start`, ISOLATED world,
   matches `<all_urls>`.
3. Page/MAIN-world code: the page-world relay (`content/page-world-relay.ts`)
   runs in ISOLATED world and talks to the MAIN world via `window.postMessage`
   (`common/page-world-protocol.ts`). The MAIN-world counterpart stays a
   separate MAIN-world content script. Keep
   `entrypoints/page-motion-freeze-bridge.content.ts` as the MAIN-world
   entrypoint but native-bundle its source
   (`common/page-motion-freeze-bridge.ts`) instead of runtime-loading legacy.
   If any OTHER code genuinely needs to execute in the page MAIN world, add a
   dedicated `world: "MAIN"` entrypoint rather than re-introducing WAR code
   modules.
4. **Eliminate `content/*` and `common/*` code modules from
   `web_accessible_resources`** in both `wxt.config.ts` and `manifest.json`.
   KEEP only genuine page-world ASSETS: cursor SVGs (`cursors/*.svg`) and
   `assets/materialdesignicons-webfont.woff2`. Preserve `popup.html` and
   `offscreen.html` as extension-page runtime URLs, but do NOT add them to WAR.
5. Rewrite `tests/manifest-permissions.test.js`: drop the
   "content-main imports of ./content/* must be in WAR" assertion (no longer
   true — they are bundled). KEEP: cursor `getURL` literals are web-accessible;
   no broad wildcards; `page-motion-freeze-control` NOT web-accessible; required
   font asset present. Add an assertion that content code modules are NOT in WAR
   (regression guard against re-introducing per-module WAR).
6. Stop mirroring `legacy/content-loader.js`, `legacy/content-main.js`,
   `legacy/content/*`, `legacy/common/page-motion-freeze-bridge.js`.

**Expected state**: one bundled content script (ISOLATED) + one MAIN-world bridge
script; no content code in WAR; cursors/fonts still web-accessible.
**Validation**: `pnpm build`; inspect generated manifest WAR; `pnpm verify`;
`pnpm browser:live https://bonliva.se` — marking, silent-highlight, AI preview +
submission, page save/revert, property-lock banner, motion-freeze, render-mode
without-JS, on representative pages.
**Rollback**: restore the legacy content shims + content WAR list (revert the
manifest-permissions test together).

### Phase C5 — Drop esbuild + legacy mirror (complete the real A7)

**Files**: remove `scripts/build-extension.ts`; gut/remove
`scripts/sync-wxt-bootstrap.mjs` (only the manifest `action` bridge may remain if
still required for the side-panel contract); `package.json` (`build`, `dev`,
`zip`, `verify`); remove source `manifest.json` if `wxt.config.ts` is now the sole
authority (or keep solely as the `action` bridge source); `tests/package-test-
script.test.js`; `tests/manifest-permissions.test.js`; `README.md`;
`.copilot/knowledge.md`; `.copilot/wxt-port-handoff.md`.

**Steps**
1. Reduce `pnpm build` to `wxt build` (+ a minimal manifest `action` bridge step
   ONLY if WXT still cannot omit `default_popup` while keeping the side-panel
   `action`). Confirm whether `wxt.config.ts` `manifest.action` without
   `default_popup` already produces the correct side-panel action; if so, delete
   the bridge entirely.
2. Remove the `dev` watcher's dependency on the esbuild script; use `wxt dev` (or
   keep a thin wrapper only if the live launcher needs it — see
   `scripts/launch-test-browser.ts`).
3. Remove the `legacy/` mirror entirely; confirm no entrypoint or runtime
   `getURL("legacy/…")` reference remains (grep `legacy/`).
4. Update `tests/package-test-script.test.js`: drop assertions about the removed
   esbuild build script / deno build tasks; keep the lint-rule contract.
5. Remove `manifest.json` source-contract test couplings that no longer apply
   (e.g. the `device-emulation-lifecycle` `documentUrls` regex if the file moved
   — update the path, keep the behavioral assertion).
6. Grep-sweep for stale references: `dist/extension`, `build-extension.ts`,
   `sync-wxt-bootstrap`, `legacy/`, `run-deno.*build`. Update README + knowledge
   to describe the single WXT-native pipeline.

**Expected state**: ONE WXT build path; no esbuild; no `legacy/` mirror; generated
manifest is authoritative.
**Validation**: `pnpm verify`; `pnpm zip` smoke; `pnpm browser:live
https://bonliva.se`; CI workflow dry-run review.
**Rollback**: if a hidden consumer needs `dist/extension`, restore a thin staging
wrapper temporarily rather than reverting the whole cutover.

### Phase C6 — Adopt `wxt/browser` polyfill behind a seam

**Files (new)**: `common/browser.ts` (re-export `browser` from `wxt/browser`).
**Files (batched)**: all modules using raw `chrome.*` (~50), plus a boundary
test.

**Steps**
1. Add `common/browser.ts`: `export { browser } from "wxt/browser";`. This is the
   single seam; modules import `browser` from here.
2. Migrate raw `chrome.*` → `browser.*` in mechanical, reviewable batches grouped
   by area (background, content, popup, common). `browser` is promise-based and
   chrome-API-compatible; behavior is unchanged. Keep `chrome.*` only where a
   Chrome-only API has no polyfill equivalent (e.g. `chrome.sidePanel`,
   `chrome.debugger`, `chrome.offscreen`, `chrome.scripting.executeScript` MAIN
   world) — document each retained `chrome.*` with a one-line reason.
3. Add `tests/browser-polyfill-boundary.test.js` (Vitest): only `common/browser.ts`
   re-exports `wxt/browser`; raw `chrome.*` is allowed only in an explicit
   allowlist of Chrome-only-API files. This protects against drift.
4. Each batch is its own commit + review-fix-loop.

**Expected state**: runtime uses the `browser` polyfill via one seam; Chrome-only
APIs are the only documented `chrome.*` exceptions.
**Validation**: per batch focused tests; `pnpm verify`; `pnpm browser:live
https://bonliva.se` after the background/content/popup batches.
**Rollback**: revert the batch; the seam re-export is inert.

### Phase C7 — Adopt `wxt/utils/storage` behind `storage-core.ts`

**Files**: `common/storage-core.ts`, `common/settings-store.ts`,
`common/render-mode-js-state.ts`, `tests/storage-core.test.js`,
`tests/storage-access-boundary.test.js` (allowlist unchanged).

**Steps**
1. Refactor the two boundary-internal bypasses through `storage-core.ts`:
   add `addStorageChangeListener`/`addSyncStorageChangeListener` usage in
   `settings-store.ts`; route `render-mode-js-state.ts` session writes through
   `storageSet`/`storageRemove`.
2. Reimplement `storage-core.ts` internals on `wxt/utils/storage`: define typed
   items via `storage.defineItem("session:<key>" | "sync:<key>" | "local:<key>")`
   and back `storageGet/Set/Remove/Clear` with them, OR keep the area-generic
   wrappers using WXT's area accessors. Preserve the EXACT public signatures so
   the other 6 approved modules need no change.
3. Keep all storage keys and areas identical (sync `global*`; session `tabState:*`
   etc.). No key renames, no area changes.
4. Keep the 7-module allowlist; `storage-access-boundary.test.js` stays green
   (all `chrome.storage`/`wxt/storage` access remains inside the approved
   modules). Update the boundary regex if it must also recognize `wxt/storage`
   usage as "approved only inside the 7".

**Expected state**: storage runs on `wxt/utils/storage` behind the unchanged
boundary; identical keys/areas/behavior.
**Validation**: `pnpm test` (storage tests); `pnpm verify`; live smoke of settings
persistence + per-tab state + device emulation + render-mode hold.
**Rollback**: restore the `chrome.storage` callback wrappers in `storage-core.ts`.

### Phase C8 — Port one-shot request/reply messaging to `@webext-core/messaging`

**Files**: `package.json` (+`@webext-core/messaging`),
`common/bus/transport/content-transport.ts`,
`common/bus/transport/popup-transport.ts` (request path only),
`common/bus/transport/background-transport.ts` (one-shot `tabs.sendMessage` +
`runtime.onMessage` inbound only), `common/async-messaging.ts`,
`popup/messages.ts`, a transport test.

**Steps**
1. Add `@webext-core/messaging`; define a typed protocol map for the existing
   one-shot envelope contract. Do NOT change the bus envelope shape
   (`uf-bus/1`) or the `Transport` interface.
2. Replace the one-shot `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`
   calls inside the transports with `@webext-core/messaging` send/onMessage,
   keeping send semantics, error mapping (`chrome.runtime.lastError` →
   reject), and reply timing identical.
3. **Do NOT touch** the persistent port paths: `popup-transport.ts:23`
   `chrome.runtime.connect` + event `postMessage`; `background-transport.ts`
   popup port handling; `property-lock-*` ports; `popup-state-broker` ports.
   These stay on `chrome.*`.
4. Migrate `async-messaging.ts` legacy request helpers to the same protocol where
   they are one-shot; keep behavior identical for `popup/messages.ts` callers.
5. Add `tests/messaging-port-boundary` coverage: assert the three persistent
   port channels still use `chrome.runtime.connect`/ports (regression guard), and
   that one-shot bus paths route through `@webext-core/messaging`.

**Expected state**: one-shot request/reply runs on `@webext-core/messaging` under
the bus; ports unchanged; bus API and Brain authority unchanged.
**Validation**: `pnpm test` (bus/transport tests); `pnpm verify`;
`pnpm browser:live https://bonliva.se` — content↔background requests, popup
requests, legacy commands, AND the port-based popup state stream + property-lock
banner still work.
**Rollback**: revert transports to raw `chrome.*` one-shot sends; the bus
interface is unchanged so rollback is local.

### Phase C9 — Final cleanup, docs, knowledge, full validation

**Files**: `.copilot/knowledge.md`, `.copilot/wxt-port-plan.md` (mark Part C done),
`.copilot/wxt-port-handoff.md`, `README.md`, `.copilot/plan.md`.

**Steps**
1. Update knowledge with the new durable facts: WXT bundles all entry graphs;
   no `legacy/` mirror; `browser` polyfill seam; `wxt/storage` behind
   `storage-core`; hybrid messaging (one-shot on `@webext-core/messaging`, ports
   on `chrome.*`).
2. Remove superseded WXT-port "legacy mirror" facts from knowledge.
3. Final `pnpm verify` + full live regression on `https://bonliva.se`.

**Expected state**: program documents and knowledge reflect the WXT-native
runtime; one canonical pipeline.
**Validation**: `pnpm verify`; full live regression.

---

## 7. Test matrix

- **Unit/contract (Vitest)**: storage-core, storage-access-boundary,
  manifest-permissions (rewritten), package-test-script (trimmed), bus/transport,
  new browser-polyfill-boundary, new messaging-port-boundary,
  device-emulation-lifecycle (paths updated).
- **Build/integration**: `pnpm check` (`wxt prepare` + both tsconfig projects),
  `pnpm build`, generated-manifest WAR check.
- **Live/manual** (`pnpm browser:live https://bonliva.se`) for C2, C3, C4, C6
  (post background/content/popup batches), C7, C8, C9: popup binding;
  `state`/`observe`/`exit-preview`; marking + silent-highlight; AI preview +
  submission; page save/revert + reconciliation; property-lock banner;
  motion-freeze; render-mode without-JS; device emulation; theme.
- **Canonical gate** each commit: `pnpm verify`.

## 8. Regression risks

- **Init-order break (C2)**: reordering background registrations breaks message
  routing. Protection: extract a single `startBackground()` preserving exact
  order; live smoke.
- **WXT Node typecheck of browser graph (C2/C4)**: DOM-vs-Node `lib`/timer
  conflicts. Protection: tsconfig project separation/browser `lib`; stop-and-ask
  if unresolvable; never mask with broad casts.
- **WAR under-scoping (C4/C5)**: dropping a cursor/font/HTML asset breaks
  `getURL` loads. Protection: keep genuine page assets web-accessible; keep the
  (rewritten) manifest-permissions test green; diff generated manifest vs C0
  snapshot.
- **Content bundling changes load timing (C4)**: single bundle vs many ESM
  fetches could shift `document_start` readiness. Protection: keep `runAt`/world
  identical; live smoke of marking + property-lock on representative pages.
- **Popup id/CSS drift (C3)**: button-state contracts depend on exact ids.
  Protection: copy HTML body verbatim; exit-preview/observe live check.
- **Storage signature drift (C7)**: changing `storage-core` public API breaks 6
  modules. Protection: preserve exact signatures; keep boundary allowlist.
- **Port path accidentally ported (C8)**: porting a persistent port to one-shot
  messaging silently breaks state streaming/property-lock. Protection: explicit
  port-boundary regression test; do not touch connect/port code.
- **Side-panel action regression (C5)**: re-introducing `default_popup` breaks
  side-panel open. Protection: keep no `default_popup`; verify action behavior
  live.

## 9. Acceptance criteria

1. `pnpm build` runs `wxt build` only (no esbuild, no `legacy/` mirror); the
   `.output/chrome-mv3` tree contains WXT-bundled `background.js`, popup,
   offscreen, one ISOLATED content script, one MAIN-world bridge — and NO
   `legacy/` directory.
2. `web_accessible_resources` contains only genuine page-world ASSETS (cursors
   and font), zero `content/*`/`common/*` code modules; `popup.html` and
   `offscreen.html` still resolve at the expected runtime URLs but are not added
   to WAR; manifest-permissions test green and asserts the absence of code-module
   WAR.
3. Runtime uses `browser` (wxt/browser) via `common/browser.ts`; only documented
   Chrome-only APIs remain `chrome.*`; boundary test green.
4. `storage-core.ts` is backed by `wxt/utils/storage`; all keys/areas unchanged;
   storage-access-boundary test green with the same 7-module allowlist.
5. One-shot bus request/reply + legacy commands run on `@webext-core/messaging`;
   the popup bus port, property-lock port, and popup-state-broker port still use
   `chrome.runtime.connect`; port-boundary test green.
6. The typed bus, background Brain authority, popup/content layer hosts, and
   spinner/activation/marking/property-lock behavior are unchanged (all existing
   behavior tests green; full live regression on `https://bonliva.se` passes).
7. `pnpm verify` passes at every phase boundary.

## 10. Todo chain

Tracked in the session SQL `todos` table (ids `wxt-c0` … `wxt-c9`) with
dependencies C0→C1→C2→C3→C4→C5, then C6/C7/C8 (each depends on C5, mutually
independent), then C9 (depends on C6,C7,C8).

## 11. Appendix — contract tests to update per phase (completed in C0)

### C0 baseline snapshot (verified 2026-06-25)

- `git status --short --branch` showed a clean branch:
  `## feat/wxt-port-plan...origin/feat/wxt-port-plan`
- `git rev-list --left-right --count HEAD...origin/feat/wxt-port-plan` returned
  `0  0` (in sync with upstream).
- `pnpm verify` passed on the pre-C0 baseline.
- Generated manifest parity snapshot (`.output/chrome-mv3/manifest.json`):
  - `web_accessible_resources` count = **60**
  - code-module WAR entries = **58**
  - non-code WAR assets = `assets/materialdesignicons-webfont.woff2`,
    `cursors/*.svg`

### Current generated WAR snapshot (C4/C5 parity reference)

The generated manifest currently exposes these 58 code modules plus 2 page
assets:

`content-main.js`,
`content/constants.js`,
`content/core.js`,
`content/marking-rules.js`,
`content/shared-inclusion.js`,
`content/shared-selector-cache.js`,
`content/silent-highlight-rules.js`,
`content/submission-rules.js`,
`content/content-command-router.js`,
`content/content-main-service-registry.js`,
`content/ai-preview-close-handler.js`,
`content/ai-preview-compute-lock-handler.js`,
`content/ai-preview-expanded-mode-handler.js`,
`content/ai-preview-get-state-handler.js`,
`content/ai-preview-show-handler.js`,
`content/ai-preview-state-response.js`,
`content/ai-submission-xpaths-handler.js`,
`content/capture-page-snapshot-handler.js`,
`content/collect-page-data-handler.js`,
`content/config-updated-handler.js`,
`content/default-exclusions-handler.js`,
`content/describe-xpaths-handler.js`,
`content/layers/content-bus-client.js`,
`content/explicit-marking-handler.js`,
`content/focus-handler.js`,
`content/force-refresh-handler.js`,
`content/invisible-xpaths-handler.js`,
`content/inspection-status.js`,
`content/page-draft-revert-handler.js`,
`content/page-draft-save-handler.js`,
`content/page-draft-status-handler.js`,
`content/page-save-reconciliation-clear-handler.js`,
`content/page-world-relay.js`,
`content/page-save-reconciliation-pending-handler.js`,
`content/page-toast.js`,
`content/render-mode-inspection-handlers.js`,
`content/render-mode-inspection-client.js`,
`content/property-lock-banner.js`,
`content/property-lock-banner-mode.js`,
`content/property-lock-port-client.js`,
`content/property-lock-state-machine.js`,
`content/runtime-message-handler.js`,
`content/visible-xpaths-handler.js`,
`common/config.js`,
`common/constants.js`,
`common/feature-flags.js`,
`common/lynx-checklist.js`,
`common/lynx-live-pages.js`,
`common/message-protocol.js`,
`common/page-world-protocol.js`,
`common/property-lock.js`,
`common/selector-set.js`,
`common/settings-store.js`,
`common/storage-core.js`,
`common/text.js`,
`common/utilities.js`,
`common/world-messaging-contract.js`,
`background/tab-session-store.js`,
`assets/materialdesignicons-webfont.woff2`,
`cursors/*.svg`

### Phase-by-phase contract-test map

#### C1 — offscreen native bundling

- No current source-contract test pins `../offscreen.ts` directly.
- Regression surface is behavior-only: offscreen creation remains asserted
  indirectly through background and AI-run flows.
- `vitest-tests/a1-bootstrap.test.ts` also covers the transitional bridge rule
  that WXT-owned `offscreen.html` must win over mirrored legacy files while the
  hybrid build still exists. C1 should leave that bridge behavior unchanged.

#### C2 — background entrypoint move / bundling

These tests currently read `../background.ts` directly and must update path
constants if the file moves or if assertions must point at an exported
`startBackground()` bootstrap:

- `tests/ai-run.test.js`
- `tests/background-command-hardening.test.js`
- `tests/background-decomposition-boundary.test.js`
- `tests/background-marking-activation.test.js`
- `tests/background-render-mode-inspection.test.js`
- `tests/device-emulation-lifecycle.test.js`
- `tests/feature-flags.test.js`
- `tests/lifecycle-broker.test.js`
- `tests/marking-no-auto-restore.test.js`
- `tests/page-motion-bridge-isolation.test.js`
- `tests/popup-ai-run-gating.test.js`
- `tests/popup-authority-boundary.test.js`
- `tests/popup-marking-refresh.test.js`
- `tests/property-lock-background.test.js`
- `tests/render-mode-inspection-order.test.js`
- `tests/selector-suppression.test.js`
- `tests/world-trace-contract.test.js`

Special case inside the above set:

- `tests/device-emulation-lifecycle.test.js` also pins the exact
  `documentUrls: [chrome.runtime.getURL("popup.html")]` source contract and must
  keep that behavioral assertion intact when the background bootstrap moves.

#### C3 — popup entrypoint move / bundling

These tests currently read `../popup.ts` directly and must update path constants
if the file moves or if assertions must point at an exported `startPopup()`
bootstrap:

- `tests/ai-run.test.js`
- `tests/background-marking-activation.test.js`
- `tests/background-render-mode-inspection.test.js`
- `tests/device-emulation-lifecycle.test.js`
- `tests/feature-flags.test.js`
- `tests/lifecycle-broker.test.js`
- `tests/popup-ai-run-gating.test.js`
- `tests/popup-background-snapshot.test.js`
- `tests/popup-decomposition-boundary.test.js`
- `tests/popup-marking-refresh.test.js`
- `tests/popup-mode-sync.test.js`
- `tests/popup-render-mode.test.js`
- `tests/preview-tooltip.test.js`
- `tests/property-lock-render-mode.test.js`
- `tests/property-lock.test.js`
- `tests/render-mode-inspection-order.test.js`
- `tests/world-trace-contract.test.js`

Popup HTML contract that also moves in C3:

- `tests/theme-colors.test.js` reads `../popup.html` directly and asserts the
  exact stylesheet injection order. When the popup body moves to
  `entrypoints/popup/index.html`, update that path constant without weakening
  the ordering assertion.
- `vitest-tests/a1-bootstrap.test.ts` also covers the transitional bridge rule
  that WXT-owned `popup.html` must win over mirrored legacy files while the
  hybrid build still exists. C3 should leave that bridge behavior unchanged
  until C5 intentionally removes the bridge.

#### C4 — content entrypoint move / bundling + WAR rewrite

These tests currently read `../content-main.ts`, `../content-loader.ts`, and/or
`../manifest.json`, or read the generated manifest, and therefore must update
their path constants or expectations when content code becomes WXT-bundled:

- `tests/ai-run.test.js` (`../content-main.ts`)
- `tests/background-render-mode-inspection.test.js` (`../manifest.json`)
- `tests/content-activation-order.test.js` (`../content-main.ts`,
  `../content-loader.ts`)
- `tests/content-decomposition-boundary.test.js` (`../content-main.ts`)
- `tests/content-high-risk-branches.test.js` (`../content-main.ts`,
  `../manifest.json`)
- `tests/content-main-runtime-router-contract.test.js` (`../content-main.ts`)
- `tests/content-main-service-registry.test.js` (`../content-main.ts`)
- `tests/device-emulation-lifecycle.test.js` (`../content-main.ts`)
- `tests/feature-flags.test.js` (`../content-main.ts`)
- `tests/lifecycle-broker.test.js` (`../content-main.ts`)
- `tests/manifest-permissions.test.js` (`../content-main.ts`,
  `../manifest.json`, `.output/chrome-mv3/manifest.json`)
- `tests/page-motion-bridge-isolation.test.js` (`../content-loader.ts`)
- `tests/page-motion-freeze-bridge.test.js` (`../manifest.json`)
- `tests/package-extension.test.js` (staged `content-main.js`,
  `common/config.js`, `popup.html`)
- `tests/popup-marking-refresh.test.js` (`../content-main.ts`)
- `tests/popup-mode-sync.test.js` (`../content-main.ts`)
- `tests/preview-tooltip.test.js` (`../content-main.ts`)
- `tests/property-lock-render-mode.test.js` (`../content-main.ts`)
- `tests/property-lock.test.js` (`../content-main.ts`)
- `tests/render-mode-inspection-order.test.js` (`../content-main.ts`)
- `tests/selector-suppression.test.js` (`../content-main.ts`)
- `tests/silent-highlight-annotations.test.js` (`../content-main.ts`)
- `tests/ui-font-uniformity.test.js` (`../content-main.ts`)
- `tests/world-trace-contract.test.js` (`../content-main.ts`)

`tests/manifest-permissions.test.js` is the highest-risk C4 contract test. It
currently asserts:

1. every literal page-world `getURL("…")` resource is web-accessible,
2. no broad `content/*.js` / `common/*.js` wildcards exist,
3. `content-main.ts` imports of `./content/*` are all individually
   web-accessible.

Only (3) and the explicit code-module WAR inventory are intentionally removed in
C4. (1) and (2) must remain, and C4 must add a NEW negative assertion that
content/common code modules are no longer web-accessible.

`tests/package-extension.test.js` must also be updated in or before C4 because
its staged-file assertions currently expect `content-main.js` and
`common/config.js` to be present via the old manifest/WAR-driven staging rules.

#### C5 — esbuild / legacy removal

These tests currently pin the old build-path shape and must be updated when
`scripts/build-extension.ts`, `dist/extension`, and `legacy/` disappear:

- `tests/package-test-script.test.js` (`../scripts/build-extension.ts`,
  `legacy/`)
- `tests/package-extension.test.js` (final staged-file expectations after the
  code-module WAR inventory and legacy mirror are gone)
- `tests/build-artifact-parity.test.js` (`dist/extension`,
  `dist/extension/manifest.json`)
- `tests/build-extension-package-workflow.test.js`
  (`.github/workflows/build-extension-package.yml` `required_files` still
  requiring `content-main.js`)
- `vitest-tests/a1-bootstrap.test.ts` (`scripts/build-extension.ts`,
  `scripts/sync-wxt-bootstrap.mjs`, `manifest.json`, `legacy/`, `popup.html`,
  `offscreen.html`)

Also revisit any C4-updated manifest tests that still mention the transitional
source `manifest.json` once generated-manifest authority is final.
