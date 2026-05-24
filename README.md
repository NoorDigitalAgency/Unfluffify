# Unfluffify

A Chrome extension (Manifest V3) that helps extract meaningful content from web pages by identifying and marking non-meaningful elements. This tool assists AI systems in focusing on the substantive content of a page.

The detailed source of truth for marking and highlighting behavior is documented in [MARKING_AND_HIGHLIGHTING_LOGIC.md](./MARKING_AND_HIGHLIGHTING_LOGIC.md).
Remote support design, security guarantees, and backend endpoint expectations are documented in [REMOTE_SUPPORT.md](./REMOTE_SUPPORT.md).

## Features

- **Content Labeling**: Mark elements as "excluded" to identify fluff (ads, banners, navigation, etc.)
- **Page Scoping**: Set a base URL to apply patterns across multiple pages of a site
- **Silent Highlighting**: Visual overlay showing excluded/included content with customizable colors
- **AI Selector Computation**: Uses AI to suggest which elements should be marked as fluff
- **Device Simulation**: Emulate mobile and desktop viewports to test content extraction
- **Rendering Mode Detection**: Distinguish between static HTML and JavaScript-rendered content
- **Data Persistence**: Save and sync markings across page navigation
- **Cookie/Consent Management**: Special handling for cookie banners and consent interfaces
- **Remote Support**: WebRTC-based session allowing a supporter to open the dedicated support page, enter a support code, view a live tab preview, stream console/network telemetry, and send remote control inputs

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

The tests cover the pure marking/highlighting and remote-support rules that have caused regressions during recent logic changes.
Run this command before opening or updating a pull request to catch regressions early.

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
- **`silent-highlight-options.js`** - Silent highlight visual configuration
- **`xpath-utilities.js`** - XPath refinement and manipulation utilities
- **`remote-support.js`** - Remote support constants, state factory, message helpers, and payload utilities
- **`remote-support-background.js`** - Background-side session orchestration: session state, frame streaming, telemetry routing, remote command replay, and offscreen transport coordination

### Offscreen Transport

- **`remote-support-offscreen.html`** - Hidden MV3 offscreen document used to host the WebRTC runtime
- **`remote-support-offscreen.js`** - WebRTC signaling/data-channel transport running in the offscreen document because the service worker does not expose `RTCPeerConnection`

### Content Scripts (`/content`)

- **`core.js`** - Main content script logic (3900+ lines): DOM manipulation, element selection, overlay rendering
- **`marking-rules.js`** - Shared pure rules for toggleable markability and exclude parent-boundary selection
- **`shared-inclusion.js`** - Shared logic for element selection and inclusion/exclusion
- **`silent-highlight-rules.js`** - Shared pure rules for movement-settle sampling in silent highlighting
- **`constants.js`** - Content script constants (removable element selectors, etc.)

### Regression Tests (`/tests`)

- **`marking-rules.test.js`** - Regression coverage for toggleable boundary markability and parent-boundary selection
- **`silent-highlight-rules.test.js`** - Regression coverage for settle-before-redraw silent highlight behavior
- **`config.test.js`** - Coverage for configuration normalization and sync-payload construction
- **`lynx-checklist.test.js`** - Coverage for Lynx checklist assignment and view-model building
- **`remote-support.test.js`** - Coverage for remote support utilities: constants, support-page URL matching, inactive-state factory, AJAX type detection, support-code normalization, endpoint URL resolution, message serialization/parsing, and UTF-8-aware payload clamping
- **`remote-support-background.test.js`** - Coverage for background-side remote-support bootstrap and transport-event handling
- **`remote-support-offscreen.test.js`** - Smoke coverage for the offscreen WebRTC transport document boot path

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
2. **Mark Content**: Hover over page elements to see highlights, click to toggle exclusion
3. **View Markings**: Use the popup to see lists of excluded/included elements
4. **Use Selector List**: Manage exclusion selectors directly from the popup
5. **Navigate**: Go to other pages under the base URL to see inferred patterns
6. **Save Markings**: Click save to persist your changes

## Key Concepts

### Silent Highlighting

Visual overlay showing page content classification:
- **Excluded** (highlighted in one color) - Marked as fluff
- **Included** (optional highlight) - Marked as meaningful content
- **Visible Consent** - Cookie/consent elements detected

### AI Selectors

The extension can compute AI-suggested selectors to automatically identify similar fluff content. Users can then verify and apply these suggestions.

### Base URLs

A base URL defines the scope for pattern inference. For example:
- Base URL: `https://example.com/news` 
- Matches: `https://example.com/news/article1`, `https://example.com/news/article2`, etc.
- Non-matches: `https://example.com/blog`, `https://other.com`

### Device Simulation

Simulate mobile (412x960) or desktop (1920x1080) viewports to test how content extraction works on different devices.

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
