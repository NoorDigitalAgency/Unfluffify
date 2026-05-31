# Unfluffify

A Chrome extension (Manifest V3) that helps extract meaningful content from web pages by identifying and marking non-meaningful elements. This tool assists AI systems in focusing on the substantive content of a page.

The detailed source of truth for marking and highlighting behavior is documented in [MARKING_AND_HIGHLIGHTING_LOGIC.md](./MARKING_AND_HIGHLIGHTING_LOGIC.md). Those marking rules are a locked restored contract and should not be changed unless a task explicitly asks for a marking-rules contract change.
Property edit-lock ownership, takeover, heartbeat, and observer-refresh behavior is documented in [PROPERTY_LOCK.md](./PROPERTY_LOCK.md). That lock contract is also locked and should not be changed unless a task explicitly asks for property-lock behavior changes.
Remote support design, security guarantees, and backend endpoint expectations are documented in [REMOTE_SUPPORT.md](./REMOTE_SUPPORT.md).

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
npm run package:extension -- --stage-dir .tmp/extension-package
```

## Features

- **Content Labeling**: Mark elements as "excluded" to identify fluff (ads, banners, navigation, forms, footers, etc.), including generated default exclusions that render in the ordinary exclude overlay
- **Page Scoping**: Set a base URL to apply patterns across multiple pages of a site
- **Silent Highlighting**: Visual overlay showing excluded/included content with customizable colors
- **AI Selector Computation**: Uses AI to suggest which elements should be marked as fluff
- **Device Simulation**: Emulate mobile and desktop viewports to test content extraction
- **Rendering Mode Detection**: Distinguish between static HTML and JavaScript-rendered content
- **Data Persistence**: Save and sync markings across page navigation; Todo List completion uses backend-saved page data, not local draft markings, and marks both the current candidate and its page-type subsection
- **Property Edit Locking**: Coordinates one active marking editor per property with stable page-session ownership, same-user tab handoff, takeover suggestions, and passive observer refresh
- **Cookie/Consent Management**: Hides consent interfaces before save so hidden textual content is handled by the same submission visibility rules as other invisible text
- **Remote Support**: WebRTC-based, view-only session allowing a supporter to open the dedicated support page, enter a support code, view the supportee's shared Chrome window, use two-way camera/microphone guidance through standard browser prompts, and stream labeled console/network telemetry
- **Remote Support Isolation**: Multiple support sessions can run concurrently in one profile as long as each requester/supporter flow stays in its own tab

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right corner)
3. Click **Load unpacked** and select the project folder
4. Pin the extension for easy access

## Testing

Run the regression suite from the repository root:

```bash
npm test
```

The script uses Node's built-in test runner with `--test-force-exit` so mocked extension transports cannot keep CI open after assertions finish.

The tests cover the pure marking/highlighting and remote-support rules that have caused regressions during recent logic changes.
Run this command before opening or updating a pull request to catch regressions early.
The remote-support regressions also cover tab-scoped background state, concurrent offscreen transport sessions, view-only display sharing, page-world telemetry bridging, extension-side telemetry with headers/timing, and dismissible session notices.

For marking-rule work, also run the focused guard suite:

```bash
node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js
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
- **`remote-support.js`** - Remote support constants, state factory, message helpers, and payload utilities
- **`remote-support-background.js`** - Background-side per-tab session orchestration: tab-scoped state lookup, frame streaming, telemetry routing, view-only command rejection, DevTools attachment, and offscreen transport coordination
- **`property-lock.js`** - Property edit-lock constants, timing windows, WebSocket protocol names, and normalized state helpers
- **`property-lock-background.js`** - Background-side per-property/per-client lock WebSocket orchestration with stable page-session IDs and tab-local popup routing

### Offscreen Transport

- **`remote-support-offscreen.html`** - Hidden MV3 offscreen document used to host the WebRTC runtime
- **`remote-support-offscreen.js`** - Multiplexed WebRTC signaling/data-channel transport running in the offscreen document because the service worker does not expose `RTCPeerConnection`

### Content Scripts (`/content`)

- **`core.js`** - Main content script logic: DOM manipulation, element selection, marking synchronization, overlay rendering, and per-pass marking caches
- **`marking-rules.js`** - Shared pure rules for b9-aligned toggleable markability, parent-boundary eligibility, and explicit toggle pacing
- **`shared-inclusion.js`** - Shared logic for element selection and inclusion/exclusion
- **`silent-highlight-rules.js`** - Shared pure rules for movement-settle sampling in silent highlighting
- **`constants.js`** - Content script constants (removable element selectors, etc.)

### Regression Tests (`/tests`)

- **`marking-rules.test.js`** - Regression coverage for the locked default-exclusion taxonomy, toggleable boundary markability, parent-boundary eligibility, and duplicate toggle suppression
- **`submission-rules.test.js`** - Regression coverage for AI submission roots and content rows: explicit exclusions, hidden textual exclusions, immutable-tag omission, included textual boundaries, and explicit includes
- **`core-visibility.test.js`** - Regression coverage for content-side visibility guards, sanitized snapshot XPath alignment, and dynamic style-mutation redraw decisions used by marking and submission
- **`theme-colors.test.js`** - Regression coverage for AA contrast on semantic theme colors
- **`silent-highlight-rules.test.js`** - Regression coverage for settle-before-redraw silent highlight behavior
- **`config.test.js`** - Coverage for configuration normalization and sync-payload construction
- **`page-save-state.test.js`** - Coverage for page-save button state, including initial saves when default markings are accepted as-is
- **`core-scheduling.test.js`** - Coverage for debounced marking work, cheap explicit-overlay refreshes, and per-pass marking cache guards
- **`popup-marking-refresh.test.js`** - Source-level coverage that Todo List completion reads backend-saved page markings instead of local drafts and enabling marking avoids duplicate refresh work
- **`property-lock.test.js`** - Coverage for lock URL construction, state normalization, timing windows, stable client identity, and content-source lock guards
- **`property-lock-background.test.js`** - Coverage for background-side client-session lock routing, navigation grace windows, and lock protocol metadata
- **`utilities-runtime.test.js`** - Coverage for Chrome runtime/storage wrappers, including extension-context invalidation handling
- **`lynx-checklist.test.js`** - Coverage for Lynx checklist assignment and view-model building
- **`remote-support.test.js`** - Coverage for remote support utilities: constants, support-page URL matching, inactive-state factory, AJAX type detection, support-code normalization, endpoint URL resolution, message serialization/parsing, and UTF-8-aware payload clamping
- **`remote-support-background.test.js`** - Coverage for background-side remote-support bootstrap, tab-scoped session isolation, DevTools routing, and transport-event handling
- **`remote-support-offscreen.test.js`** - Coverage for concurrent session handling in the offscreen WebRTC transport document

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
2. **Mark Content**: Hover over page elements to see highlights, click to toggle exclusion. Hold **Shift** to target a broader content boundary; shallow generic page wrappers are intentionally skipped.
3. **Interact With Page UI**: Hold **Space** to let clicks reach accordions, tabs, menus, and other page controls, then release to keep marking
4. **View Markings**: Use the popup to see lists of excluded/included elements
5. **Use Selector List**: Manage exclusion selectors directly from the popup
6. **Navigate**: Go to other pages under the base URL to see inferred patterns
7. **Save Markings**: Click save to persist your changes

When a save or sync step temporarily blocks editing, the page overlay dims and shows a marking-paused notice until marking is available again.

## Key Concepts

### Silent Highlighting

Visual overlay showing page content classification:
- **Excluded** (highlighted in one color) - Marked as fluff
- **Included** (optional highlight) - Marked as meaningful content
- **Consent handling** - Cookie/consent elements are hidden before save and submitted only when they qualify as invisible textual content

### Motion Stability

When Unfluffify owns a matching page for marking or silent highlighting, it pauses page animations, transitions, timer-driven JavaScript carousels and sliders, SVG animation clocks, and autoplay-like media so markings and saves are compared from one stable page posture. Marking enable first runs a bounded instant scroll sweep to trigger viewport and lazy reveal handlers, restores the user's original scroll position, and then freezes page motion before overlays render. Scroll, viewport, and attribute-driven reveal elements such as Webflow interaction hooks are normalized to their visible posture instead of being frozen hidden, while semantic hidden UI such as dialogs, menus, tabs, and carousels stays hidden. The freeze applies to page content only: Unfluffify's overlay, status UI, and internal render scheduling remain active. A small pause glyph appears on the page while this freeze is active.

### AI Selectors

The extension can compute AI-suggested selectors to automatically identify similar fluff content. Starting a run immediately shows the busy spinner/countdown and pauses marking edits before saved-page backfills, XPath refinement, and payload construction begin. The popup checks async run status every 5 seconds while users wait, then users can verify and apply the suggestions.

### Base URLs

A base URL defines the scope for pattern inference. For example:
- Base URL: `https://example.com/news` 
- Matches: `https://example.com/news/article1`, `https://example.com/news/article2`, etc.
- Non-matches: `https://example.com/blog`, `https://other.com`

### Device Simulation

Simulate mobile (412x960) or desktop (1920x1080) viewports to test how content extraction works on different devices.
The extension preserves the chosen simulation mode across marking-mode navigation and unregister/reload cleanup; switching back to desktop is always a user-controlled action.

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
- Popup ↔ Background ↔ Content Script ↔ Page

Message types include state queries, updates, device emulation commands, and data syncing.

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
