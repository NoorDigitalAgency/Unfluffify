# Unfluffify

A Chrome extension (Manifest V3) that helps extract meaningful content from web pages by identifying and marking non-meaningful elements. This tool assists AI systems in focusing on the substantive content of a page.

Unfluffify targets recent Chrome browsers only. The extension intentionally relies on current Chrome Manifest V3 and modern Web API coverage; backward compatibility with older Chrome releases or other browsers is not a project goal.

The detailed source of truth for marking and highlighting behavior is documented in [MARKING_AND_HIGHLIGHTING_LOGIC.md](./MARKING_AND_HIGHLIGHTING_LOGIC.md). Those marking rules are a locked 052c-derived restored contract and should not be changed unless a task explicitly asks for a marking-rules contract change.
Property edit-lock ownership, takeover, heartbeat, cloned-tab client rotation, and observer-refresh behavior is documented in [PROPERTY_LOCK.md](./PROPERTY_LOCK.md). That lock contract is also locked and should not be changed unless a task explicitly asks for property-lock behavior changes.

## Packaging Workflow

Run the GitHub Actions workflow at `.github/workflows/build-extension-package.yml` with **Run workflow**.

Each run:

- stages only files reachable from the extension runtime surface (manifest entrypoints, imported modules, HTML/CSS assets, and extension-local file references)
- creates a timestamped archive named `Unfluffify-v<manifest-version>-<yymmdd-hhmm>.zip` using a UTC timestamp
- refreshes the `extension-latest` release with that timestamped asset and a stable alias named `Unfluffify-latest.zip`

Permanent direct download URL:

`https://github.com/NoorDigitalAgency/Unfluffify/releases/download/extension-latest/Unfluffify-latest.zip`

Permanent release page:

`https://github.com/NoorDigitalAgency/Unfluffify/releases/tag/extension-latest`

For a local dry run of the staging logic, run:

```bash
deno task build:release
deno task package -- --stage-dir .tmp/extension-package
```

## Development Workflow

Common local commands:

```bash
deno task check
deno task test
deno task lint
deno task build
deno task dev
deno task verify
```

`deno task dev` watches extension sources and rebuilds the development extension output under `dist/extension-dev`.
The dev watcher and one-shot builds share `scripts/build-extension.ts`, so copied assets, bundled files, and dev reload artifacts stay consistent.
`deno task lint` currently covers the Deno automation files that are lint-clean.
`deno task verify` runs the type check, regression suite, and release build.

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

1. Run `deno task dev` for a watched development build, or `deno task build` for a one-shot local build.
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right corner)
4. Click **Load unpacked** and select `dist/extension-dev` for development or `dist/extension` for the one-shot build.
5. Pin the extension for easy access

## Testing

Run the regression suite from the repository root:

```bash
deno task test
```

The tests cover the pure marking/highlighting rules that have caused regressions during recent logic changes.
Run this command before opening or updating a pull request to catch regressions early.

For marking-rule work, also run the focused guard suite:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net=127.0.0.1 --no-check --unstable-sloppy-imports tests/core-visibility.test.js tests/core-motion-pause.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
```

## Project Structure

### Core Entry Points

- **`background.js`** - Service worker handling tab state, messaging, device emulation, and cleanup
- **`popup.js`** - Main popup UI and state management (uses Preact framework)
- **`content-loader.js`** - Initial content script that loads the main content script
- **`content-main.js`** - Main content script that runs on web pages (large, complex logic)

### Common Utilities (`/common`)

- **`config.js`** - Configuration management, timestamps, selector sets, page markings
- **`constants.js`** - Global constants including device emulation presets, default exclusions
- **`utilities.js`** - Shared utilities: tab state, script injection, URL normalization, storage
- **`emulation.js`** - Device emulation state and debugger protocol management
- **`selector-set.js`** - AI selector set operations and deduplication
- **`xpath-utilities.js`** - XPath refinement and manipulation utilities
- **`property-lock.js`** - Property edit-lock constants, timing windows, WebSocket protocol names, and normalized state helpers
- **`property-lock-background.js`** - Background-side per-property/per-client lock WebSocket orchestration with stable page-session IDs and tab-local popup routing

### Content Scripts (`/content`)

- **`core.js`** - Main content script logic: DOM manipulation, element selection, marking synchronization, overlay rendering, and per-pass marking caches
- **`marking-rules.js`** - Shared pure rules for 052c-derived toggleable markability, Shift parent-boundary choice, and explicit toggle pacing
- **`shared-inclusion.js`** - Shared logic for element selection and inclusion/exclusion
- **`silent-highlight-rules.js`** - Shared pure rules for movement-settle sampling in silent highlighting
- **`constants.js`** - Content script constants (removable element selectors, etc.)

### Regression Tests (`/tests`)

- **`marking-rules.test.js`** - Regression coverage for the locked default-exclusion taxonomy, restored toggleable boundary markability, Shift parent-boundary chooser, and duplicate toggle suppression
- **`submission-rules.test.js`** - Regression coverage for AI submission roots and content rows: stored excluded rows, hidden textual exclusions, immutable-tag omission, included textual boundaries, and explicit includes
- **`core-visibility.test.js`** - Regression coverage for content-side visibility guards, restored Shift/Alt target promotion, sanitized snapshot XPath alignment, and dynamic style-mutation redraw decisions used by marking and submission
- **`core-motion-pause.test.js`** - Regression coverage for pre-freeze page inspection, input blocking, full-scroll lazy-content reveal, and motion-freeze normalization
- **`theme-colors.test.js`** - Regression coverage for AA contrast on semantic theme colors
- **`silent-highlight-rules.test.js`** - Regression coverage for settle-before-redraw silent highlight behavior
- **`config.test.js`** - Coverage for configuration normalization and sync-payload construction
- **`page-save-state.test.js`** - Coverage for page-save button state, including initial saves when default markings are accepted as-is
- **`core-scheduling.test.js`** - Coverage for debounced marking work, cheap explicit-overlay refreshes, and per-pass marking cache guards
- **`popup-marking-refresh.test.js`** - Source-level coverage that Todo List completion reads backend-saved page markings instead of local drafts, enabling marking avoids duplicate refresh work, and periodic Live Page candidate refreshes stay quiet unless the candidate set changes
- **`property-lock.test.js`** - Coverage for lock URL construction, state normalization, timing windows, stable client identity, and content-source lock guards
- **`property-lock-background.test.js`** - Coverage for background-side client-session lock routing, navigation grace windows, and lock protocol metadata
- **`utilities-runtime.test.js`** - Coverage for Chrome runtime/storage wrappers, including extension-context invalidation handling
- **`lynx-checklist.test.js`** - Coverage for Lynx checklist assignment and view-model building

### Popup UI (`/popup`)

- **`ui.js`** - Preact-based UI component rendering and state management (1300+ lines)
- **`helpers.js`** - Helper functions for tab operations, device emulation, AI settings
- **`chrome-helpers.js`** - Chrome API wrappers (browsing data, tab reloading)
- **`messages.js`** - Message passing utilities
- **`state.js`** - Popup UI state management
- **`emulation.js`** - Device emulation state in popup

### Resources

- **`popup.css`** - Popup UI styles
- **`popup.html`** - Popup container
- **`manifest.json`** - Extension manifest (Manifest V3)
- **`icons/`** - Extension icons
- **`cursors/`** - Custom cursor SVGs
- **`assets/`** - Material Design Icons

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
