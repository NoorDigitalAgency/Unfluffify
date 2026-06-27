# Unfluffify

A Chrome extension (Manifest V3) that helps extract meaningful content from web pages by identifying and marking non-meaningful elements. This tool assists AI systems in focusing on the substantive content of a page.

Unfluffify targets recent Chrome browsers only. The extension intentionally relies on current Chrome Manifest V3 and modern Web API coverage; backward compatibility with older Chrome releases or other browsers is not a project goal.

The detailed source of truth for marking and highlighting behavior is documented in [MARKING_AND_HIGHLIGHTING_LOGIC.md](./MARKING_AND_HIGHLIGHTING_LOGIC.md). Those marking rules are a locked 052c-derived restored contract and should not be changed unless a task explicitly asks for a marking-rules contract change.
Property edit-lock ownership, takeover, heartbeat, cloned-tab client rotation, and observer-refresh behavior is documented in [PROPERTY_LOCK.md](./PROPERTY_LOCK.md). That lock contract is also locked and should not be changed unless a task explicitly asks for property-lock behavior changes.

## Packaging Workflow

Run the GitHub Actions workflow at `.github/workflows/build-extension-package.yml` with **Run workflow**.

Each run:

- validates the extension with `pnpm verify`, including the post-build WXT
  manifest/WAR check against `.output/chrome-mv3/manifest.json`
- creates a synced `.output/chrome-mv3` archive with `pnpm zip`
- stages release files from the synced WXT output under `.output/chrome-mv3`,
  keeping only the extension runtime surface (manifest entrypoints, imported
  modules, HTML/CSS assets, and extension-local file references)
- checks that every staged release file is also present in the synced
  `.output/chrome-mv3` zip
- creates a timestamped archive named `Unfluffify-v<manifest-version>-<yymmdd-hhmm>.zip` using a UTC timestamp
- refreshes the `extension-latest` release with that timestamped asset and a stable alias named `Unfluffify-latest.zip`

Permanent direct download URL:

`https://github.com/NoorDigitalAgency/Unfluffify/releases/download/extension-latest/Unfluffify-latest.zip`

Permanent release page:

`https://github.com/NoorDigitalAgency/Unfluffify/releases/tag/extension-latest`

For a local dry run of the WXT build + staging logic, run:

```bash
pnpm build
node ./scripts/package-extension.mjs --stage-dir .tmp/extension-package
```

## Development Workflow

Run `pnpm install` once after cloning if you want to use the checked-in WXT/pnpm
toolchain.

Common local release/CI commands:

```bash
pnpm dev
pnpm dev:no-browser
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm zip
pnpm browser:live <target-url>
pnpm verify
```

`pnpm dev` runs the WXT development server for the unpacked extension output.

`pnpm dev:no-browser` runs the same development server with browser auto-open
disabled (via `UNFLUFFIFY_NO_BROWSER=1`). Use this mode when pairing dev logs
with `pnpm browser:live <target-url>` control flows.

`pnpm verify` is the current release/CI verification path: it runs lint, type
check, the Vitest suite, rebuilds the synced WXT output, and then runs the
generated-manifest permission/WAR check against `.output/chrome-mv3/manifest.json`.

Treat the pnpm commands above as the supported public workflow. The repository
no longer depends on Deno for CI, packaging, browser launch, or orchestration.

Durable architecture knowledge lives in `.copilot/knowledge.md`. `pnpm build`
produces the runnable unpacked extension under `.output/chrome-mv3`. Source code
now lives under `src/`, stable public assets under `src/public/`, and
`wxt.config.ts` is the sole manifest source of truth. The only remaining
manifest bridge is the source-owned `action` block so WXT's popup entrypoint
does not reintroduce `action.default_popup` into the shipped manifest. Content
scripts now ship on WXT's native `content-scripts/` paths. All automated tests
now live under `tests/`; the old `vitest-tests/` split and dedicated Deno test
shim files are gone.

The live-browser launcher targets the WXT unpacked output:
`pnpm browser:live <target-url>` shells through the committed launcher, runs
`pnpm build` by default, and loads `.output/chrome-mv3` into the managed
Playwright Chromium.

Orchestration helpers are exposed as pnpm/Node scripts:

```bash
pnpm orchestrate:bus -- --host 127.0.0.1 --port 8765
pnpm orchestrate:runner -- --role follower --side B
pnpm orchestrate:setup-auth -- --role director --side A --account A
pnpm orchestrate:property-lock -- --property-url https://example.com/
```

## Features

- **Content Labeling**: Mark elements as "excluded" to identify fluff (ads, banners, navigation, forms, footers, etc.), including generated default exclusions that render in the ordinary exclude overlay and submit as excluded rows
- **Page Scoping**: Set a base URL to apply patterns across multiple pages of a site
- **Silent Highlighting**: Visual overlay showing excluded/included content with customizable colors; silent Preview Contents and Send to Lynx live on this surface, while marking mode has its own AI-fresh Preview Contents check
- **AI Selector Computation**: Uses AI to suggest which elements should be marked as fluff, always from the stored raw/rendered HTML and XPath evidence for every marked page under the current property
- **Device Simulation**: Opens tabs in mobile simulation by default, preserves per-session choices outside marking, and forces mobile simulation while active marking is running
- **Desktop Preview**: When a property already has AI selectors, a separate popup toggle can switch the current tab into desktop preview while keeping marking disabled
- **Off-Candidate Previewing**: Same-property pages that are not current Live Page candidates still keep silent highlighting and property-lock visibility, while marking remains unavailable
- **Off-Candidate Lock Warning**: Editors who remain on a same-property off-candidate page see a 70 second warning before the extension releases the editor role
- **Cross-Property Cool-Off**: Editors who navigate to a different property keep a 30 second recovery window, with mirrored page/popup warnings, before the previous property's editor role is released
- **Rendering Mode Detection**: Distinguish between static HTML and JavaScript-rendered content
- **Data Persistence**: Marking data only lives while marking is enabled — each enable recomputes the page entry fresh from defaults plus CSS/AI-selector influence (wiping any stale draft so the page never starts dirty), and marking is disabled on any navigation or reload regardless of same page or property. Marking edits stay session-local until users run AI and explicitly Save Session or Discard Session; passive observers use backend-saved page data while the active editor uses the local session data, marks both the current candidate and its page-type subsection, and quietly polls Live Page candidates until a changed set needs review
- **Property Edit Locking**: Coordinates one active marking editor per property with stable page-session ownership, same-user tab handoff, takeover suggestions, immediate eligible-page editor claiming for the current extension session, an editor bootstrap refresh when ownership changes, and passive observer refresh no more than once per minute
- **Immediate Close Release**: Closing the editor tab releases that property's lock immediately instead of waiting for the normal port-disconnect grace window
- **Cookie/Consent Management**: Hides consent interfaces before save so hidden textual content is handled by the same submission visibility rules as other invisible text

## Installation (Developer Mode)

1. Run `pnpm dev` for the WXT development server, or `pnpm build` for the production WXT build.
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right corner)
4. Click **Load unpacked** and select `.output/chrome-mv3`.
5. Pin the extension for easy access

## Testing

Run the regression suite from the repository root:

```bash
pnpm test
```

The tests cover the pure marking/highlighting rules that have caused regressions during recent logic changes.
Run this command before opening or updating a pull request to catch regressions early.

For marking-rule work, also run the focused guard suite:

```bash
pnpm exec vitest run tests/core-visibility.test.ts tests/core-motion-pause.test.ts tests/core-scheduling.test.ts tests/marking-rules.test.ts tests/popup-marking-refresh.test.ts tests/selector-suppression.test.ts tests/silent-highlight-annotations.test.ts tests/silent-highlight-rules.test.ts tests/submission-rules.test.ts
```

## Project Structure

### Source Layout (`/src`)

- **`src/entrypoints/`** - WXT entrypoints for background, popup, offscreen, and
  content-script bootstraps
- **`src/background.ts`** - Service worker bootstrap and command wiring
- **`src/popup.ts`** - Main popup runtime bootstrap
- **`src/content-main.ts`** - Main content runtime that runs on web pages
- **`src/offscreen/bootstrap.ts`** - Offscreen runtime bootstrap owned by the
  WXT offscreen entrypoint

### Shared Runtime Modules

- **`src/common/`** - Shared browser/runtime helpers, messaging seams, config,
  storage boundaries, and domain contracts
- **`src/background/`** - Background-side orchestration, tab state, bus/Brain,
  remote config, and operation routing
- **`src/content/`** - Content-side handlers, overlays, marking logic helpers,
  render-mode inspection, and page-side coordination
- **`src/popup/`** - Popup state, React UI helpers, and render-mode flows
- **`src/offscreen/`** - Offscreen document support modules
- **`src/types/`** - Shared TypeScript contracts for runtime surfaces

### Regression Tests (`/tests`)

- **`marking-rules.test.ts`** - Regression coverage for the locked default-exclusion taxonomy, restored toggleable boundary markability, Shift parent-boundary chooser, and duplicate toggle suppression
- **`submission-rules.test.ts`** - Regression coverage for AI submission roots and content rows: stored excluded rows, hidden textual exclusions, immutable-tag omission, included textual boundaries, and explicit includes
- **`core-visibility.test.ts`** - Regression coverage for content-side visibility guards, restored Shift/Alt target promotion, sanitized snapshot XPath alignment, and dynamic style-mutation redraw decisions used by marking and submission
- **`core-motion-pause.test.ts`** - Regression coverage for pre-freeze page inspection, input blocking, full-scroll lazy-content reveal, and motion-freeze normalization
- **`theme-colors.test.ts`** - Regression coverage for AA contrast on semantic theme colors
- **`silent-highlight-rules.test.ts`** - Regression coverage for settle-before-redraw silent highlight behavior
- **`config.test.ts`** - Coverage for configuration normalization and sync-payload construction
- **`page-save-state.test.ts`** - Coverage for page-save button state, including initial saves when default markings are accepted as-is
- **`core-scheduling.test.ts`** - Coverage for debounced marking work, cheap explicit-overlay refreshes, and per-pass marking cache guards
- **`popup-marking-refresh.test.ts`** - Source-level coverage that Todo List completion reads backend-saved page markings instead of local drafts, enabling marking avoids duplicate refresh work, and periodic Live Page candidate refreshes stay quiet unless the candidate set changes
- **`property-lock.test.ts`** - Coverage for lock URL construction, state normalization, timing windows, stable client identity, and content-source lock guards
- **`property-lock-background.test.ts`** - Coverage for background-side client-session lock routing, navigation grace windows, and lock protocol metadata
- **`utilities-runtime.test.ts`** - Coverage for Chrome runtime/storage wrappers, including extension-context invalidation handling
- **`lynx-checklist.test.ts`** - Coverage for Lynx checklist assignment and view-model building

### Popup UI (`/src/popup`)

- **`ui.tsx`** - React-based UI component rendering and state management
- **`helpers.ts`** - Helper functions for tab operations, device emulation, and
  AI settings
- **`chrome-helpers.ts`** - Browser-tab helpers and popup-triggered tab actions
- **`messages.ts`** - Popup message and background command helpers
- **`state.ts`** - Popup state management helpers
- **`emulation.ts`** - Device emulation state in the popup

### Resources

- **`src/popup.css`** - Popup UI styles
- **`src/entrypoints/popup/index.html`** - Popup entrypoint container
- **`wxt.config.ts`** - WXT config and manifest source of truth
- **`src/public/icons/`** - Extension icons copied to stable output paths
- **`src/public/cursors/`** - Custom cursor SVGs copied to stable output paths
- **`src/public/assets/`** - Material Design Icons and font assets copied to
  stable output paths

## How to Use

1. **Enable on a Page**: Click the Unfluffify icon → Set a **Base URL** → Click **Enable on this tab**
2. **Mark Content**: Hover over page elements to see highlights, click to toggle exclusion. Hold **Shift** to target a broader 052c-style content boundary; shallow generic page wrappers are intentionally skipped. Hold **Alt** to explicitly include eligible content, including mixed direct-text ancestors.
3. **Interact With Page UI**: Hold **Space** to let clicks reach accordions, tabs, menus, and other page controls, then release to keep marking
4. **View Markings**: Use the popup to see lists of excluded/included elements
5. **Use Selector List**: Manage exclusion selectors directly from the popup
6. **Navigate**: Go to other pages under the base URL to see inferred patterns
7. **Run AI, Then Save or Discard**: After marking changes, run AI content detection, then save the full session or discard it before exiting marking

Page-save reconciliation states are generally non-blocking for preparation, loading, calculation, saving, and retry messaging. The editor-role activation preparation (`editor_preparing`) is the explicit exception and is blocking so reveal/freeze setup cannot be interrupted by user input.

## Key Concepts

### Silent Highlighting

Visual overlay showing page content classification:
- **Excluded** (highlighted in one color) - Marked as fluff
- **Included** (optional highlight) - Marked as meaningful content
- **Consent handling** - Cookie/consent elements are hidden before save and submitted only when they qualify as invisible textual content

### Motion Stability

When a tab acquires the editor role, Unfluffify runs one content-reveal sweep for that page and then keeps page motion paused for both silent highlighting and marking mode so markings and saves are compared from one stable posture. If selectors exist, silent highlighting renders immediately; if selectors do not exist yet, the tab still remains in silent-highlighting mode with motion paused until marking mode is enabled. Marking enable runs its own bounded instant scroll sweep, restores the user's original scroll position, and then renders overlays against the already-frozen page. Scroll, viewport, and attribute-driven reveal elements such as Webflow interaction hooks are normalized to their visible posture instead of being frozen hidden, while semantic hidden UI such as dialogs, menus, tabs, and carousels stays hidden. The freeze applies to page content only: Unfluffify's overlay, status UI, and internal render scheduling remain active. A small Material Design Icons snowflake/code indicator appears on the page while this freeze is active; its content-script font face and selectors are Unfluffify-scoped so the target page does not receive global `.mdi` styles.

### AI Selectors

The extension can compute AI-suggested selectors to automatically identify similar fluff content. Starting a run immediately shows the busy spinner/countdown and pauses marking edits before saved-page backfills, XPath refinement, and payload construction begin. If the current page has unsaved local marking changes, the run first captures that page into the local stored snapshot so the AI request still uses stored evidence only. The popup checks async run status every 5 seconds while users wait, then users can verify and apply the suggestions. Saving is intentionally blocked until the latest local marking session has been processed by AI. Silent Preview Contents always reads the latest stored selector set for the property; marking mode exposes its own Preview Contents action only after the AI run is fresh for the current markings. Send to Lynx stays on the silent-highlighting surface while marking stays focused on current-page editing.

### Base URLs

A base URL defines the scope for pattern inference. For example:
- Base URL: `https://example.com/news` 
- Matches: `https://example.com/news/article1`, `https://example.com/news/article2`, etc.
- Non-matches: `https://example.com/blog`, `https://other.com`

### Device Simulation

Opening Unfluffify on a supported page enables mobile simulation (412x960) by default so marking and AI-submission visibility match the mobile extraction contract. Every fresh tab session opened through the extension starts in that mobile simulation mode, including when the side panel is already open and you switch to a new tab. Outside active marking, the simulation choice remains a per-session setting that users can disable from the popup and that the extension will not silently re-enable until the tab session state is cleared. During an active marking session, the editor tab forces mobile simulation back on and keeps the popup device toggle unavailable until marking is disabled. Navigation, reload, unregister/reload cleanup, and Render Mode inspection must preserve the current session choice when marking is not active.

When AI selectors already exist for the current property, the popup also shows a separate `Preview in desktop mode` checkbox. That choice persists for the tab lifecycle, switches the page into desktop emulation, keeps silent previewing available, and disables marking entry until the checkbox is turned off again. If DevTools tears down emulation while desktop preview is on, the extension clears desktop preview and restores mobile emulation for the tab.

## Architecture Notes

### Manifest V3

This extension uses Chrome's Manifest V3 (the current standard):
- Service workers replace background pages
- Content scripts are sandboxed
- Dynamic import is used for loading resources

### State Management

- **Tab State** (session storage): `tabState:{tabId}`
- **Device Emulation** (session storage): `deviceEmulation:{tabId}`
- **IndexedDB**: Stores detailed page markings, configurations, drafts
- **Backend-saved marking cache**: Tracks the last confirmed backend page-marking payload separately from local drafts so candidate completion cannot be inferred from unsynced local data; empty or partial backend responses are timestamp-merged instead of wiping local saved pages
- **Property lock session ID**: The edit lock uses a stable page-session client ID, not the Chrome tab ID, so same-user duplicate tabs can be locked and transferred predictably
- **Popup UI State**: In-memory state synchronized with persistent storage

### Message Passing

Communication flow:
- Popup ↔ Service Worker ↔ Content Script ↔ Page World

Command-routing notes:
- Popup tab snapshots are requested via the background command `POPUP_GET_TAB_VIEW_STATE`.
- Popup-to-content requests are routed through the background command `TAB_CONTENT_REQUEST`.
- Legacy popup fallback messaging for `GET_BACKGROUND_STATE` is removed from the active architecture.

## Code Quality

All functions have JSDoc documentation explaining:
- Purpose and behavior
- Parameters and return types
- Async nature where applicable

Unused code has been removed. All exported functions are actively used or part of the public API.

## Performance Considerations

- **Lazy loading**: content-main.js is loaded dynamically only when needed
- **Debouncing**: DOM mutations and scroll events are debounced
- **Caching**: Element collections and visibility are cached
- **WeakMap usage**: DOM references use WeakMap to avoid memory leaks
