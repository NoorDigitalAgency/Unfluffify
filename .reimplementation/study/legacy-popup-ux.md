# Legacy Unfluffify — Popup / Browser-Action UX & Visual Specification

**Source tree:** `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main` (branch `main`, production v1.10.0+3).
All `file:line` citations below are relative to that tree's `src/` unless another root is shown.

This spec is written so a developer who has never seen the legacy popup can re-create it pixel- and behavior-faithfully. Every exact user-visible string, control id, gating condition, confirm dialog, spinner phase, and CSS token is cited to its source.

---

## Table of contents

1. [Surface & shell — it is a SIDE PANEL, not a bubble popup](#1-surface--shell)
2. [Browser-action icon states](#2-browser-action-icon-states)
3. [Entry HTML, CSS load order, lifecycle boot](#3-entry-html-css-load-order-boot)
4. [Design system](#4-design-system)
5. [Layout structure & dimensions](#5-layout-structure--dimensions)
6. [View model & view resolution](#6-view-model--view-resolution)
7. [View: Loading](#7-view-loading)
8. [View: Configuration (signed-out / setup)](#8-view-configuration)
9. [View: Marking (the main view)](#9-view-marking)
10. [View: Preview sidebar ("Detected Content")](#10-view-preview-sidebar)
11. [Modal: Lynx checklist popover (Send to Lynx)](#11-modal-lynx-checklist-popover)
12. [Property-lock indicator (flag-gated)](#12-property-lock-indicator)
13. [Header menus (kebab / config menu, todo controls menu, theme menu)](#13-header-menus)
14. [The marking-session state machine (button matrix per state)](#14-marking-session-state-machine)
15. [Blocking curtain & spinner choreography](#15-blocking-curtain--spinner-choreography)
16. [Toasts](#16-toasts)
17. [Confirm dialogs (window.confirm / window.alert) — exact strings](#17-confirm-dialogs)
18. [Accounts / sign-in UX and token handling](#18-accounts--sign-in-ux)
19. [Flow: Run AI content detection](#19-flow-run-ai-content-detection)
20. [Flow: Save Session / Discard](#20-flow-save-session--discard)
21. [Flow: Send to Lynx](#21-flow-send-to-lynx)
22. [Flow: Render-mode selection](#22-flow-render-mode-selection)
23. [Flow: Enable Marking toggle](#23-flow-enable-marking-toggle)
24. [Device emulation & desktop preview](#24-device-emulation--desktop-preview)
25. [Keyboard shortcuts](#25-keyboard-shortcuts)
26. [Popup lifecycle: open / tab-switch / navigation / close](#26-popup-lifecycle)
27. [Debug affordances](#27-debug-affordances)
28. [Feature flags — what production actually shows](#28-feature-flags)
29. [Vestigial view-state (declared but never rendered)](#29-vestigial-view-state)
30. [Status/notice string master tables](#30-status-string-master-tables)

---

## 1. Surface & shell

**The "popup" is Chrome's per-tab Side Panel, not an action popup bubble.**

- The manifest's `action` is only `{ default_title: "Unfluffify" }` — there is **no `default_popup`** (`wxt.config.ts:7-9`, and a build hook re-asserts this even if WXT tries to add one: `wxt.config.ts:24-26,47-49`).
- Clicking the toolbar button fires `browser.action.onClicked`, which binds `popup.html` to that tab's side panel and opens it (`background.ts:4285-4294`):
  ```ts
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) {
      setBrowserSidePanelOptions({ tabId: tab.id, path: "popup.html", enabled: true }).then();
      openBrowserSidePanel({ tabId: tab.id }).then();
    }
  });
  ```
- Consequences a re-implementation must reproduce:
  - The panel **stays open across tab switches** — the popup subscribes to `tabs.onActivated` and re-binds itself to the newly active tab (`popup.ts:9699-9754`) instead of closing.
  - The panel **survives page navigation/reloads** of the inspected tab (`tabs.onUpdated` listener, `popup.ts:9756-9833`).
  - Width is user-draggable (side-panel behavior); the CSS is written for a `min-width: 320px` fluid column (`theme-components.css:12`).
- Tab-context resolution for a running panel: background `resolvePopupTabContext` resolves in priority order **debugTabId param → side-panel bound tab → active tab of current window → active tab of last-focused window** (`background.ts:2670-2686`, fallback in `popup/messages.ts:540-566`).
- Manifest facts (from `wxt.config.ts:50-85`): name `Unfluffify`; description `"Chrome extension to label what's non-meaningful text content to help AI find the meaningful text content."`; MV3; permissions `storage, sidePanel, tabs, scripting, debugger, alarms, browsingData, webNavigation, activeTab, offscreen`; `host_permissions: ["<all_urls>"]`; web-accessible resources: the MDI woff2 + `cursors/*.svg` (the include/exclude marking cursors used by the content script — `src/public/cursors/{include,exclude}.svg`).

## 2. Browser-action icon states

- Two full icon sets exist: `public/icons/default/icon{16,32,48,128}.png` and `public/icons/active/icon{16,32,48,128}.png`. Manifest default is the `default` set (`wxt.config.ts:79-84`).
- Visual: the mascot is a cartoon **eraser character sweeping with a broom**. The `active` variant sits on a **green circular badge background**; the `default` variant is the same mascot on transparent/no badge (verified by viewing the PNGs).
- Switching logic — `utils.updateActionForTab(tabId)` (`common/utilities.ts:754-798`): a tab shows the **active** icon when the tab is the active tab AND (`tabState.enabled` — marking on — OR `initialState.active` — the extension has bootstrapped/registered on the tab). Otherwise the **default** icon.
- Refresh triggers: `tabs.onActivated` and `windows.onFocusChanged` re-sweep every tab in the window (`background.ts:4034-4053`); it is also called after tab bootstrap/activation events (`background.ts:1159,3518,3608,3634,4281`).
- **No badge text is ever set** (no `setBadgeText`/`setBadgeBackgroundColor` anywhere). Action title is static `"Unfluffify"`.
- There is **no options page** (`options_ui` absent from `wxt.config.ts`); all configuration lives inside the panel's Configuration view.

## 3. Entry HTML, CSS load order, boot

- `entrypoints/popup/index.html`: `<title>Unfluffify</title>`, single `<div id="app">`, module script `./main.ts`.
- `entrypoints/popup/main.ts` import order (this order matters — utilities override components):
  1. `fonts.css` (Inter 400/500/600/700 + JetBrains Mono 400/500, self-hosted woff2, `font-display: swap`) — `public/assets/fonts/fonts.css`
  2. `theme-color.css` (tokens + 16 themes)
  3. `theme-components.css` (all component styles)
  4. `popup.css` (popup-only additions: preview sidebar state colors, trace panel)
  5. `theme-utilities.css` (utility classes, loaded last "so they can intentionally override component defaults" — `theme-utilities.css:1`)
  6. `materialdesignicons.min.css` (Material Design Icons webfont)
  7. `popup.js` (the compiled `popup.ts` controller)
- React 18/19 (`react-dom/client` `createRoot`, `flushSync` renders — `popup/ui.tsx:1-4,2516-2558`). Renders are synchronous, imperative `renderApp()` calls triggered by `setViewState(patch)`; there are no hooks/state inside components — the whole UI is a pure function of a single module-level `viewState` object (`ui.tsx:506,2605-2621`).
- Render-crash self-healing: `createRoot` has `onCaughtError`/`onUncaughtError` handlers that unmount and remount the entire app from scratch (`ui.tsx:2481-2514`), plus a DOM-level fallback that keeps the busy curtain and `body.is-busy` synchronized if React fails mid-render (`ui.tsx:884-915,2668-2690`).

## 4. Design system

### 4.1 Typography

- Sans stack: `--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (`theme-color.css:3`).
- Mono stack: `--font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace` (`theme-color.css:4`).
- Base: body 13px Inter (`theme-components.css:16-17`). Mono is used for: readouts (`theme-components.css:65-77`), section-menu item labels (11px, `:272-281`), list item URLs (11px, `:1235-1243`), preview sidebar index numbers (11px, `:1952-1957`), trace output (10.5px, `popup.css:128-143`).
- Type scale in practice: 10px (render-mode step index), 11px (hints, labels, badges, notices-in-badges), 12px (buttons, section titles, menu items, statuses, alerts), 13px (body, inputs, todo subsection titles), 14px (warning-popover title).
- Weights: 400 body; 500 buttons/menu items/links; 600 section titles/labels/badges/emphasis; 700 property-lock status, curtain title, "current" badges, todo-candidate badges.

### 4.2 Color tokens & themes

`theme-color.css` defines a **16-theme catalog**, each specifying light+dark values via CSS `light-dark()` (`color-scheme: light dark` on `:root`, `theme-color.css:2`). Base (`:root`, effectively the fallback/indigo look, `theme-color.css:1-20`):

| Token | Value |
|---|---|
| `--bg` | `#f8f9fc` |
| `--bg-accent` | `#f0f2f7` |
| `--card` | `#ffffff` |
| `--ink-base` | `#1a1d26` |
| `--muted-base` | `#6b7280` |
| `--line-base` | `#e5e7eb` |
| `--accent` | `#4f46e5` |
| `--accent-dark` | `#3730a3` |
| `--accent-light` | `#eef2ff` |
| `--success` | `light-dark(#366342, #80d090)` |
| `--danger` | `light-dark(#a33d3d, #ff8080)` |
| `--warn` | `light-dark(#936d0b, #ffc66e)` |
| `--warn-ink` | `light-dark(#856100, #ffc66e)` |
| `--radius` | `8px` |
| `--radius-lg` | `12px` |

Derived tokens (mixed for contrast per scheme, `theme-color.css:233-265`): `--ink`, `--muted`, `--line`, `--focus-ring`, `--focus-ring-soft`, `--shadow-1/2` (dark mode gets deeper shadows), `--shadow: 0 1px 3px …, 0 1px 2px …`, `--shadow-md: 0 4px 12px …, 0 2px 4px …`, `--control-border`.

Theme catalog (values, display labels, and accent-cluster used for menu ordering — `popup.ts:780-823`):

| value | label | cluster |
|---|---|---|
| blueprint | Blueprint | blue |
| swedish-minimal | Swedish Minimal | blue |
| cool | Cool | blue |
| nordic | Nordic | blue |
| tidepool | Tidepool | cyan |
| mint | Mint | cyan |
| ocean | Ocean | cyan |
| graphite | Graphite | cyan |
| earthy | Earthy | green |
| olive | Olive | green |
| sunset | Sunset | warm |
| clay-rose | Clay Rose | warm |
| neutral | Neutral | violet |
| plum-steel | Plum Steel | violet |
| plum | Plum | violet |
| lavender | Lavender | violet |

Menu order = cluster order (blue 0, cyan 1, green 2, warm 3, violet 4) then label alphabetical within cluster (`popup.ts:812-823`): Blueprint, Cool, Nordic, Swedish Minimal, Graphite, Mint, Ocean, Tidepool, Earthy, Olive, Clay Rose, Sunset, Lavender, Neutral, Plum, Plum Steel.

- **Default theme: `nordic`; default mode: `system`** (`popup.ts:775-776`). Each theme block overrides bg/card/ink/muted/line/accent triads for both schemes (e.g. nordic light accent `#3e7d9f`, dark accent `#8fc6dd` — `theme-color.css:181-192`). `olive` additionally overrides primary button tokens `--button-primary-bg/hover/ink` (`theme-color.css:176-178`).
- Theme is applied by stamping `data-theme` and `data-theme-mode` attributes on `<html>` and setting `style.colorScheme` = `light dark` | `light` | `dark` (`popup.ts:2369-2380`). Persisted globally (sync storage, keys `globalTheme` / `globalThemeMode`) and live-synced across popup instances via a storage listener (`popup.ts:9856-9877`).
- **NOTE:** appearance customization is behind the `appearanceCustomization` feature flag which is **false in production** (`common/feature-flags.ts:8`) — see §28. Production always runs `nordic`/`system` (reset path `popup.ts:2382-2391,2407-2417`).

### 4.3 Component styles (key metrics)

All from `theme-components.css` unless noted.

- **body**: margin 0, padding 10px, `min-width: 320px`, `display:grid; gap:6px`, 13px Inter, `color: var(--ink)` (`:9-19`). `body.is-busy { overflow: hidden }` (`popup.css:1-3`).
- **.card**: card bg, 1px `--line` border, radius 12px (`--radius-lg`), padding 10px, `--shadow`, internal `display:grid; gap:8px` (`:21-30`).
- **Primary button**: inline-flex, gap 6px, padding 7px 12px, radius 6px, bg `light-dark(var(--accent), var(--accent-dark))`, text `light-dark(#fff, var(--card))`, 12px/500; hover swaps to the other accent; `:active { translateY(1px) }`; `:disabled { opacity:.5; cursor:not-allowed }`; `.loading:disabled { cursor: progress }` (`:167-198`).
- **Secondary button** `.u-btn-secondary`: `--line` border, `--bg-accent` bg, ink text (`theme-utilities.css:37-45`). Warn/danger button variants exist (`theme-utilities.css:47-71`) but are unused in the popup.
- **Inputs** (`text/email/password`): padding 7px 10px, 1px `--control-border` border, radius 6px, card bg, 13px; focus → accent border; focus-visible → `0 0 0 3px var(--focus-ring-soft)` (`:85-110`). `input[readonly]` → `--bg-accent` bg + muted text (`:143-146`).
- **Checkbox/radio**: 16×16, `accent-color: var(--accent)`; disabled → `opacity:.6; cursor:not-allowed` (`:148-160`).
- **Focus ring** (global): `:focus-visible → outline: 2px solid var(--focus-ring); outline-offset: 2px` + soft box-shadow; `:focus:not(:focus-visible)` suppressed (`:322-363`).
- **.section-title**: inline-flex, gap 5px, `color: var(--accent)`, 12px/600 (`:200-209`).
- **.control-label**: accent, 11px/600 (`:50-58`).
- **.hint**: muted 11px (`:80-83`).
- **.section-menu** (dropdown menus): absolute below trigger (`top: calc(100% + 4px); right:0`), z-index 12, grid gap 2px, min-width 240px, padding 4px, 1px line border, radius 8px, card bg, `--shadow-md`; items are borderless full-width buttons, padding 7px 10px, radius 6px, 12px/500, hover `--bg-accent`; `.section-menu__label` is **mono 11px ellipsized** (`:230-297`).
- **.section-divider**: `border-top: 1px solid var(--line); margin: 2px 0` (`:521-524`).
- **.button-row**: 2-column equal grid, gap 8px (`:526-530`).
- **.input-row**: flex, gap 8px; input flexes; buttons `padding:6px 10px; radius 8px` (`:299-320`).
- **Alerts** `.u-alert` (+`-warn/-danger/-success/-muted` tones): padding 8px 10px, 1px border `color-mix(tone 50%, transparent)`, radius 8px, bg `color-mix(tone 15%, transparent)`, tone-colored 12px text (`theme-utilities.css:96-124`). The popup's notices all use `u-alert u-alert-warn` via `warningNoticeClass()` (`ui.tsx:617-619`).
- **Toast `#toast`**: fixed, left/right 14px, bottom 14px, padding 10px 12px, radius 8px, bg `color-mix(in srgb, var(--ink) 88%, transparent)` (dark translucent), text `var(--card)` 12px, fade+slide (opacity 0→1, translateY 8px→0, 0.2s), `pointer-events: none` (`:2015-2034`).
- **Blocking curtain `.ui-curtain`**: fixed inset 0, z-index 20, `place-items:center`, scrim `color-mix(in srgb, var(--ink) 40%, transparent)`; content card: grid `auto 1fr`, min-width 220px, max-width `min(320px, 100vw-32px)`, padding 14px 16px, line border, radius 12px, card bg, shadow-md; 16×16 spinner ring (2px border, accent top, 0.8s linear rotation `ui-curtain-spin`); title 12px/700 ink; hint 11px muted; optional timer 11px/700 ink (`:2036-2148`).
- **Modal scrim `.warning-popover`**: fixed inset 0, z-index 25, `place-items:center`, same 40% ink scrim + `backdrop-filter: blur(2px)`; card `width: min(560px, 100vw - 28px)`, max-height `calc(100vh - 28px)`, padding 18px 18px 16px, radius 12px, shadow-md (`:906-931`).
- **Mac-style close button `.close-button`** (flag-gated, see §28): 14×14 red circle `#ff5f57` with darker red border, ×-glyph strokes appear on hover; disabled state renders grey (`:2189-2248`).
- **Collapsible headers** (`.todo-header`, `.config-extras-header`, `.todo-subsection-header`): a `"▸"` `::before` glyph that rotates 90° when `aria-expanded="true"`, transition 0.18s (`:1515-1526,1647-1656,1813-1821`).
- **Reduced motion**: global `@media (prefers-reduced-motion: reduce)` kills all animation/transitions (`:2261-2270`).
- **Narrow layout**: `@media (max-width: 520px)` stacks the appearance controls (`:2250-2260`).

### 4.4 Iconography

Material Design Icons webfont (self-hosted `materialdesignicons.min.css` + woff2). The `icon(name)` helper renders `<span class="mdi mdi-<name> mdi-18px btn-icon?" aria-hidden="true">` (`ui.tsx:621-628`); `.btn-icon` = 15px square inline block (`theme-utilities.css:3-11`); `.field-icon` = muted 13px with 3px right margin; `.row-icon` = muted 15px.

Icons used in the popup (full list, `ui.tsx` grep):
`account-key-outline` (Authentication title), `api` (Endpoints title), `arrow-left` (back, checklist cancel), `auto-fix` (Run AI), `bug-outline` (trace toggle row), `check` (Set buttons, selected theme), `chevron-down` (theme dropdown caret), `chevron-left/right` (theme prev/next), `close`/`pencil` (Cancel/Change edit toggles, `ui.tsx:634-636`), `cloud-upload-outline` (Send to Lynx), `content-save` (Save Session), `dots-vertical` (kebab menus), `exit-to-app` (Exit preview), `eye-outline` (Show Content List), `format-list-bulleted` (trace panel), `format-list-checks` (Todo List title), `home-outline` (Property URL label), `login` (Login), `monitor-dashboard` (Render Mode title/menu + undetermined mode), `monitor-eye` (desktop preview row), `palette-outline` (Appearance), `pencil-box-outline` (Enable Marking row), `progress-check`/`progress-helper` (todo done/pending indicators, `ui.tsx:1301-1310`), `restore` (Discard), `send` (checklist Send), `theme-light-dark`/`white-balance-sunny`/`weather-night` (mode buttons System/Light/Dark, `ui.tsx:1123-1128`), `timeline-text-outline` (Diagnostics), `trash-can-outline` (Empty cache), `tune` (Open configuration), `tune-variant` (Extras), `unfold-more-horizontal`/`unfold-less-horizontal` (Expand/Collapse all), `play` (extended into collapsible headers).
Render-mode value icons: `language-html5` (Static), `language-javascript` (JavaScript), `monitor-dashboard` (Undetermined) (`popup/render-mode.ts:15-18`).
Property-lock icons (flag-gated): `lock-open-outline`, `sync`, `cloud-off-outline`, `account-switch-outline`, `wifi-off`, `timer-alert-outline`, `home-export-outline`, `map-marker-alert-outline`, `swap-horizontal`, `clock-outline`, `lock-alert-outline`, `lock-open-variant-outline`, `lock-check-outline`, `lock-outline` (`property-lock-decider.ts`).

### 4.5 Logo / branding

- `public/logo.png` (1360×961 RGBA): the eraser-mascot sweeping white "fluff" clouds off a browser window that carries the orange **noor** logo and "by" mark; wordmark **"Unfluffify"** below ("Un" in blue, "fluffify" in orange).
- Rendered in the header at **110px wide, auto height, opacity 0.9** (`theme-components.css:510-514`), `alt="Unfluffify"` (`text.ts:186`, `ui.tsx:1609`).

## 5. Layout structure & dimensions

Top-level DOM (marking view, all features off — the production shape), from `App` (`ui.tsx:1578-1791`):

```
body (grid, gap 6px, padding 10px, min-width 320px)
└── #app
    ├── div.app.u-grid.u-gap-4            (gap 10px)
    │   ├── div.close-bar                  (22px min-height strip; empty in prod — close button flag-gated)
    │   ├── header.app-header (card-like: padding 10px 12px, line border, radius 12px, shadow)
    │   │   ├── .header-top (flex, logo left / actions right)
    │   │   │   ├── img.header-logo (110px)
    │   │   │   └── .header-actions → #config-toggle kebab (⋮) + #config-menu dropdown
    │   │   │       (in Configuration view: replaced by #config-header-back "←")
    │   │   └── .header-property-url  (hidden in preview/config/loading)
    │   │       ├── label.field--compact: 🏠 "Property URL" + #base-url (read-only ellipsized text, title=full URL)
    │   │       ├── #base-url-notice (u-alert-warn, role=status)
    │   │       └── [property-lock indicator — flag-gated]
    │   ├── <active view> (Loading | Preview sidebar | Marking | Configuration)
    │   └── [desktop-preview section — flag-gated]
    ├── #toast (fixed bottom)
    └── #ui-curtain (fixed full-screen busy overlay)
```

- The Property URL row is a **read-only text element**, not an input: `.property-url-text` — transparent, no border, ellipsized nowrap, `title` = full value; placeholder text `"Property not found"` when empty (`ui.tsx:1697-1711`, `text.ts:509-510`, `theme-components.css:771-783`).
- Marking view is a vertical stack of `.card` sections (see §9 for order).
- Everything is fluid width; no fixed panel width is imposed.

## 6. View model & view resolution

Three top-level views (`ui.tsx:42-46`): `Loading`, `Configuration`, `Marking`. Two overlay surfaces can replace the main view area: the **preview sidebar** (when `previewBlocked || previewActive`, `ui.tsx:1581,1724-1727`) and the full-screen **curtain** (renders on top of everything, §15). The Lynx checklist is a modal popover inside the Marking view.

**Resolution rule** (per `refreshUiInner`, `popup.ts:5836-5847`):

```
configurationComplete = configEndpoint set && aiEndpoint set && stageBase set && token present   (popup.ts:5633-5637)
if (!configurationComplete)      → View.Configuration (locked: configViewLocked=true)
else if (was locked)             → View.Marking (unlock)
else                             → whatever view the user chose (state.currentView), default Marking
```

- The popup **starts in `Loading`** (`ui.tsx:187`) and leaves it on the first `refreshUiInner` pass.
- Token invalidation at any time forces `Configuration` + lock (`popup.ts:4158-4171`), i.e. the popup's "signed-out" state **is** the Configuration view.
- The user can also open Configuration manually from the kebab menu (`popup.ts:7336-7343`); Back returns only if `maybeSwitchToMarkingView` verifies a valid token + all three fields (`popup.ts:7345-7369`).

## 7. View: Loading

`renderPopupLoadingView` (`ui.tsx:1569-1576`):

- `<section id="popup-loading-view" class="popup-loading-view" role="status" aria-live="polite">` — grid `auto 1fr`, padding 14px 12px, muted text (`theme-components.css:392-414`).
- 16×16 accent spinner ring + title = `busyMessage` or **"Loading popup..."** (`text.ts:212`).
- While loading: header renders logo only (no kebab, no property URL, no close-bar) (`ui.tsx:1588-1605,1693-1696`).

## 8. View: Configuration

Rendered by `renderConfigurationView` (`ui.tsx:2341-2475`). Header shows a **back arrow** (`#config-header-back`, icon `arrow-left`, title/aria-label **"Back"**) instead of the kebab; it is disabled while configuration is incomplete (`configurationBackDisabled = !configurationComplete`, `popup.ts:5863`; `ui.tsx:1614-1626`).

### Card 1 — "Endpoints" (icon `api`)

- Hint line: **"Set endpoints, login credentials, and sign in to continue."** (`text.ts:450`).
- Configuration notice (u-alert-warn, hidden when complete): **"Provide Configuration Endpoint, AI Endpoint, Stage Base, then login to continue."** (`text.ts:451`) — or, when the config server is unreachable from the marking view: **"Problem connecting to the configuration server. Retrying..."** (`text.ts:452`; logic `popup.ts:5864-5871`).
- Three identical **editable field rows** (`renderEditableConfigurationField`, `ui.tsx:2267-2339`), each = label + input + a `Set` button (icon `check`) shown while editing + a `Change`/`Cancel` toggle button (icon `pencil`/`close`) shown once a value exists, + a per-field u-alert-warn notice:

| Field | input id | Label | Placeholder | Unset notice | Editing notice |
|---|---|---|---|---|---|
| Config endpoint | `config-endpoint-url` | "Configuration Endpoint" | `https://example.com` | "Set Configuration Endpoint before continuing" | "Set Configuration Endpoint to continue" |
| AI endpoint | `endpoint-url` | "AI Endpoint" | `https://example.com` | "Set Endpoint before using AI" | "Set Endpoint to continue" |
| Stage base | `stage-base` | "Stage Base" | `noorlynx.com` | "Set Stage Base before signing in" | "Set Stage Base to continue" |

  (labels/placeholders/notices: `text.ts:466-486`; buttons `#<id>-set` / `#<id>-edit`; edit-toggle label "Change" ↔ "Cancel" `text.ts:5-6`.)
- Field behavior (`getEditableFieldState`, `popup.ts:4210-4243`): a field with no stored value is permanently in edit mode (input writable, Set visible, unset-notice shown). Once set, the input becomes `readonly` (grey `--bg-accent` background) and only `Change` is visible. Enter submits while editing (`popup.ts:7143-7165`).
- Set validation & effects:
  - Config endpoint: empty → toast **"Enter a Configuration Endpoint"**; invalid URL → toast **"Enter a valid Configuration Endpoint"**; changing it clears the token → toast **"Configuration endpoint changed. Login required."** (`popup.ts:8017-8040`).
  - AI endpoint: **"Enter an Endpoint"** / **"Enter a valid Endpoint"** / **"Endpoint changed. Login required."** (`popup.ts:8047-8069`).
  - Stage base: normalized; invalid → **"Enter a valid Stage Base"**; changing clears token → **"Stage Base changed. Login required"** (`popup.ts:8076-8092`).
  - After every successful Set the popup attempts `maybeSwitchToMarkingView()` (auto-return to Marking once everything is valid).
- All three fields + their buttons disable while an AI request is in flight (`configurationUiDisabled = aiBusy`, `popup.ts:5889,6014-6059`).

### Card 2 — "Authentication" (icon `account-key-outline`)

- Email field: label "Email", `#login-email`, `type=email`, placeholder `name@example.com`.
- Password field: label "Password", `#login-password`, `type=password`, placeholder `password`; Enter triggers login when enabled (`popup.ts:7167-7173`).
- `.token-row`: left status text `#token-status` + right `#login-action` button (icon `login`, label **"Login"**).
- Status text: **"Token saved"** (tone success/green) when a token exists, **"Login required"** (tone warning) otherwise (`popup.ts:6026-6029`; `text.ts:495-496`).
- Gating (`popup.ts:6024-6034`): credentials inputs disabled unless Stage Base is set (and not aiBusy); Login button disabled unless credentials enabled AND email matches `EMAIL_REGEX` AND password non-empty.
- See §18 for the full login flow.

### Card 3 — "Extras" (collapsible; **hidden entirely in production**)

`renderConfigurationExtrasSection` (`ui.tsx:2151-2232`) renders only if `appearanceCustomization` or `traceDiagnostics` is enabled — both false in prod, so the card does not exist (returns null, `ui.tsx:2213-2215`). When enabled:

- Collapsible header "Extras" (icon `tune-variant`, ▸ rotates).
- **Appearance** subsection (icon `palette-outline`): "Theme" label + prev/next chevron buttons (titles "Previous theme"/"Next theme") flanking a custom dropdown `#theme-dropdown-toggle` showing current theme label + a 4-swatch mini palette (bg/ink/accent/accent-light, 10×10 rounded squares, `theme-components.css:658-690`); menu is a listbox of all 16 themes each with label + palette + check on selected; opens up or down based on available space (`popup.ts:6533-6544`); ArrowUp/Down cycles live (`popup.ts:6556-6589`). "Mode" label + 3-button group (System/Light/Dark with icons, active gets accent-light background) (`ui.tsx:1123-1150`, `theme-components.css:720-760`).
- **Diagnostics** subsection (icon `timeline-text-outline`): row "Trace cross-world messaging" + checkbox `#trace-mode-enabled`; when on, a "Trace events" panel with count badge and a read-only 140px-high mono `textarea#trace-events-output` showing the last 20 events, newest first, formatted `HH:MM:SS  channel / event  summary` (`ui.tsx:2178-2210,2153-2171`; styles `popup.css:85-143`).

## 9. View: Marking

Rendered by `renderMarkingView` (`ui.tsx:1969-2107`). Section order top-to-bottom (each its own `.card`, some conditional):

1. **Render Mode card** — visible only while a render mode is *required but not yet set*, or while editing it (`renderModeSectionVisible = renderModeRequired && (!renderModeSet || renderModeEditMode)`, `popup.ts:5988-5990`). Title: icon `monitor-dashboard` + **"Render Mode"**. Contents in §22.
2. **Todo List card** — visible when `siteIdReady && renderModeReady` (`todoListVisible`, `popup.ts:5925-5926`). See §9.1.
3. **Enable Marking card** — visible when `renderModeReady` (`postRenderModeControlsVisible`, `ui.tsx:1970,2083-2099`): a single `.row` with label icon `pencil-box-outline` + **"Enable Marking"** and checkbox `#toggle-enabled`; row `title` tooltip = **"CTRL/CMD+E"** (`text.ts:202,208`).
4. **Merged controls card** — visible when `renderModeReady` and it has content (`ui.tsx:1984-2103`):
   - In **marking mode** (`!mainUiHidden`):
     - AI controls (`ui.tsx:1793-1828`): `#ai-dirty-notice` (u-alert-warn; text = **"Run AI before you can save"** or the reconciliation status; shown when a save reconciliation is pending, `popup.ts:6074-6077`) and the full-width primary button `#compute` (icon `auto-fix`) — label **"Run AI content detection"** idle / **"AI is working..."** busy (`text.ts:12-13`).
     - **"Show Content List"** button `#marking-preview` (secondary, full width, icon `eye-outline`, label from `actions.previewLatest` = "Show Content List") — rendered only when `markingPreviewVisible` (machine-owned; true in `post_ai_clean`) (`ui.tsx:1993-2008`).
     - Divider, then optional session notice (u-alert-warn; **"Run AI content detection before saving or exiting marking."**, `page-save-state.ts:86-90`), then `.button-row`: `#page-save` (primary, icon `content-save`, label **"Save Session"**) + `#page-revert` (secondary, icon `restore`, label **"Discard"**) (`ui.tsx:2010-2036`; labels `text.ts:191-192,201`).
     - `#page-draft-status` hint line under the buttons, tone-colored (§30.2).
   - In **silent mode** (`cssSelectorsVisible`; marking off but page is a known ready property, `popup.ts:6078`): `#preview-latest` (secondary full-width, icon `eye-outline`, **"Show Content List"**), divider, `#save-excludes` (primary full-width, icon `cloud-upload-outline`, label **"Send to Lynx"** idle / **"Sending to Lynx..."** busy) (`ui.tsx:2234-2265`; `text.ts:14-15`).
5. **Lynx checklist popover** — always mounted, `hidden` unless open (§11).

### 9.1 Todo List card

`renderMarkedPagesSection` (`ui.tsx:1312-1483`). This is the GraphQL-driven page-type coverage checklist (`propertyPageTypes` from `urlSearchInfo`/`propertyPageTypes` queries).

- Header row: collapsible button (▸ + icon `format-list-checks` + title **"Todo List"**) with a right-aligned **progress pill** `x/y` (completed page types / total) — done state: `progress-check` icon, success-green pill; pending: `progress-helper` icon, muted pill (`ui.tsx:1287-1336`; styles `theme-components.css:1534-1554`). A page type counts as completed when it has ≥1 *backend-saved* marked page (`getTodoProgress`, `ui.tsx:1287-1299`; coverage uses backend-saved markings only — "Todo completion must reflect persisted save results, not temporary local drafts", `popup.ts:5547-5552`).
- When the section is expanded, a kebab `#todo-controls-menu-toggle` (⋮, tooltip **"Todo controls"**) appears with a menu (`ui.tsx:1094-1121`): **"Expand all"** (icon `unfold-more-horizontal`), **"Collapse all"** (`unfold-less-horizontal`), and a checkbox item **"Auto-collapse"** (`checkbox-marked`/`checkbox-blank-outline`, default checked `ui.tsx:255`).
- Optional u-alert-warn notice line under the header (`pageTypeNoticeText`, §30.3).
- Body: one **subsection per page type** (`.todo-subsection`, bordered rounded box). Subsection header = ▸ + title (accent, 13px/500) + optional **"Current"** badge (uppercase pill, accent) + count pill (marked count; success if >0). Subsection highlights: `--missing` (warn border) when 0 marked; `--current` (accent border + accent-light bg) when the active tab belongs to it (`ui.tsx:1364-1407`; styles `theme-components.css:1610-1706`).
- Candidates inside an expanded subsection (`.todo-candidate`): done/pending indicator + link. Label = URL pathname+search (`formatPageTypeCandidateLabel`, `popup.ts:2529-2539`), `title` = full URL. Word count suffix "N words" if provided (`ui.tsx:651-655,1442-1448`; `text.ts:319`). Current candidate gets the accent card treatment + "Current" badge and its link is disabled (plain span, muted); duplicates are disabled too and show a warning line **"Also listed under X, Y."** (`popup.ts:6144-6147`, `ui.tsx:1460-1466`).
- Clicking a candidate link **navigates the inspected tab** to that URL via the background (`handleMarkedPageNavigate` → `navigateActiveTabToUrlWithTodoCollapse`, `popup.ts:7505-7518`), guarded by the unsaved-session confirm (§17) and followed by todo auto-collapse.
- Empty state (`.page-types__empty`, dashed border box): **"Live Pages are not prepared for this site yet. Prepare them in Lynx before marking pages here."**, or the fetch error, or the site-blocked reason (`popup.ts:6152-6156`; `text.ts:304`).
- Expansion state is remembered per `tab|baseUrl` context (up to 200 contexts) and auto-collapses on property change or when Auto-collapse is on and context changes (`popup.ts:4373-4453,6188-6216`).

### 9.2 Marking-view visibility algebra (what shows when)

Key derived values (`popup.ts:5881-5926`):

```
pageScopedUiDisabled = unsupportedByGraphql || !tabInScope || remoteConfigRetryBlocked || propertyLockBlocking
silentModeActive     = !pageScopedUiDisabled && view==Marking && renderModeReady && !isEnabled
mainUiHidden         = pageScopedUiDisabled || !isEnabled || (!navInspectionPending && (!siteIdReady || !renderModeReady))
toggleEnabled(view)  = pageScopedUiDisabled ? false : isEnabled
todoListVisible      = siteIdReady && renderModeReady
cssSelectorsVisible  = silentModeActive
```

So the marking view has three main postures:

| Posture | Conditions | Visible sections |
|---|---|---|
| **Property-resolution / render-mode setup** | render mode not confirmed | Render Mode card (+ header). No todo list, no toggle, no controls |
| **Silent (highlight-only)** | render mode set, marking OFF | Todo List, Enable Marking toggle (off), Show Content List + Send to Lynx |
| **Marking session** | marking ON | Todo List, Enable Marking toggle (on), Run AI (+notice), [Show Content List], Save Session / Discard + status line |

- With no resolvable property (`Property not found`) or off-tab, the header notice explains it and everything else hides (`popup.ts:5092-5104,6079-6087`).

## 10. View: Preview sidebar

When a preview session is active (`previewBlocked || previewActive`) the whole marking/config view is replaced by `renderPreviewSidebar` (`ui.tsx:1485-1567`), and the header hides the kebab and property URL (`ui.tsx:1611,1693-1696`).

- `.card.preview-sidebar` with a **sticky header** (blurred translucent bg, bottom border): title **"Detected Content"** (or **"Content States"** when show-all-categories is on) + a 24×24 dismiss button (icon `exit-to-app`, aria-label/title **"Exit Preview"**; hover turns danger-red) (`ui.tsx:1486-1539`; styles `theme-components.css:1864-2013`; strings `text.ts:329-330,200`).
- Optional toggle row (feature `previewExpandedStates`, **off in prod**): label **"Show all states"**, tooltip **"Show excluded, explicitly included, implicitly included, and undetected markable content."** + checkbox; disabled while the preview is still opening (`ui.tsx:1540-1558`; `text.ts:332-333`).
- Hint line: while opening → `previewBlockedMessage` or **"Loading preview..."**; otherwise **"Click a row or included page content to compare both sides. Exit preview to resume editing."** (`ui.tsx:1559-1563`; `text.ts:331,334`).
- List `.preview-sidebar__list`: one button per detected item — mono index `1.`, `2.`… + item text (11px, pre-wrap). Item `title` = element title or xpath. Clicking focuses/scrolls the element on the page (`onPreviewItemFocus` → `requestTabFocusPreviewElement`; failure toast **"Unable to focus element"**, `popup.ts:9453-9468`). The active (focused) item gets the accent treatment and is auto-scrolled into view (center) when focus changes (`ui.tsx:2534-2552`).
- With show-all-categories on, items carry per-kind classes with distinct colors (`popup.css:34-83`): `excluded` = danger-tinted, `explicit_included` = accent-tinted, `implicit_included` = success-tinted, `undetected` = warn-tinted; the active item overlays accent.
- States: loading → single row **"Loading preview..."**; empty (confirmed settled-empty) → dashed box **"No content detected"** (`ui.tsx:1490-1524`; `text.ts:334-335`).
- Item-list anti-flicker rules (must be reproduced for faithful behavior): the first non-empty hydration **latches**; later empty/stale snapshots keep the latched list; a settled-empty verdict needs a 3s confirmation window (`PREVIEW_SETTLED_EMPTY_CONFIRM_MS = 3000`) before "No content detected" is shown (`popup.ts:9268-9388`). Sidebar visibility is popup-owned (open intent / suppress-reopen / restore-pending latches), never flapped by transient probe reads (`popup.ts:4599-4698,9309-9343`).
- Exit behavior: §19/§20; Exit while a restore is already pending only re-arms the 1s fallback (`popup.ts:9167-9171`).
- Preview mode also suppresses/normalizes open menus (`normalizeViewState`, `ui.tsx:2589-2603`).

## 11. Modal: Lynx checklist popover

`renderLynxChecklistPopover` (`ui.tsx:1861-1967`) — full-screen modal scrim (`warning-popover lynx-checklist-popover`, `role=dialog aria-modal=true`), opened by **Send to Lynx** (§21).

- Title: **"Final check before sending to Lynx:"** (`text.ts:374`).
- Section heading: **"Current Live Page coverage:"** (`text.ts:375`), then one box per page type: title + done/pending indicator (`progress-check` green / `progress-helper` muted). Missing page types get the warn-tinted box (`--missing`) and, if candidates exist, a **"Candidates:"** label + up to **3** candidate-URL buttons (full URL text, wrap-anywhere) that navigate the tab there (closing the popover first) (`ui.tsx:1878-1922`; preview slice(0,3): `common/lynx-checklist.ts:377`; navigation `popup.ts:7520-7526`).
- Status area under coverage:
  - While the cssInfo staleness check is running and coverage is complete: inline spinner + **"Checking Lynx selector status..."** (`ui.tsx:1924-1930`; `text.ts:382`).
  - Else a u-alert-warn notice (`getLynxChecklistNoticeText`, `ui.tsx:1830-1859`):
    - cssInfo match → **"Lynx already has selectors that match the ones awaiting in the extension."**
    - cssInfo error → **"Could not verify the Lynx selector status. Close and reopen this checklist to retry."**
    - no candidates → **"Live Pages are not prepared for this site yet. Prepare them before sending to Lynx."**
    - missing coverage → **"Mark at least one page for: {titles, comma-joined}."** (`text.ts:376-384`).
  - Invalid stored pages hint: **"Some stored pages are no longer valid candidates and will be ignored."** (`ui.tsx:1937-1943`; `text.ts:381`).
- Action row: `#lynx-checklist-cancel` (secondary, icon `arrow-left`, **"Cancel"**) and `#lynx-checklist-send` (primary, icon `send`, **"Send to Lynx"**). Send is enabled **only** when coverage is complete AND the cssInfo gate returned `clear` (fail-closed: disabled for `pending`/`match`/`error`) (`ui.tsx:1944-1963`).
- cssInfo gate mechanics: every popover open resets the gate to `pending` and re-checks (`popup.ts:6867-6897,6920-6947`); a re-render also starts a missing check once coverage hydrates (`popup.ts:6849-6865`); the check compares the pending selector CSS (include = inclusionSelectors joined ", "; exclude = sanitized exclusionSelectors joined ", ") against backend `cssInfo` (`popup.ts:6901-6910`).

## 12. Property-lock indicator

Flag `propertyLockCollaboration` — **false in production**, so this never renders today (`ui.tsx:936-938`). When enabled it renders inside the header property-URL block (`ui.tsx:1721`): a toned status strip (`.property-lock`, grid icon|text|actions, tone-tinted border/surface via `u-surface-tone u-tone-*`) with status (12px/700), optional detail (11px muted) and up to two small action buttons (min-height 26px, 11px).

Complete state → tone/icon/status mapping (`background/brain/deciders/property-lock-decider.ts:137-367`; strings `text.ts:107-151`):

| State | Tone | Icon | Status text | Detail | Buttons |
|---|---|---|---|---|---|
| Connecting | muted | `sync` | "Checking edit lock..." | — | — |
| Unavailable | warning | `cloud-off-outline` | "Edit lock unavailable" | "Marking controls are paused until coordination reconnects." | — |
| Takeover suggestion received (editor side) | warning | `account-switch-outline` | "{From} would like to edit this property" | "Changes are reserved to your session." | **Accept** / **Reject** |
| Reconnecting after inspection | muted | `sync` | "Reconnecting after inspection..." | — | — |
| Disconnect countdown (editor) | warning | `wifi-off` | "Connection lost. You will lose the editor role in {n}s unless the connection recovers." | — | — |
| Inactivity warning (editor) | warning | `timer-alert-outline` | "No recent page interaction. You will lose the editor role in {n}s unless you continue editing." | — | **Continue editing** |
| Cross-property countdown | warning | `home-export-outline` | "Previous property held • editor role ends in {n}s" | "You left the previous property. Return to it within {n}s or you will lose the editor role." | — |
| Off-candidate countdown | warning | `map-marker-alert-outline` | "Off candidate page • editor role ends in {n}s" | "This page is not a current Live Page candidate. Return to a candidate page within {n}s or you will lose the editor role." | — |
| Transfer countdown | warning | `swap-horizontal` | "Editing is being transferred from {A} to {B} ({n}s)." | — | — |
| Own suggestion pending | warning | `clock-outline` | "Waiting for {editor}'s response..." | "Marking controls are paused until you take over or the lock is released." | — |
| Suggestion rejected | danger | `lock-alert-outline` | "{editor} prefers to continue editing." | (passive detail) | **Suggest to take over** |
| Unlocked | success | `lock-open-outline` | "No active editor" | — | — |
| Takeover available | warning | `lock-open-variant-outline` | "This property is not being actively edited anymore." / (recent editor:) "You have been inactive for too long." | — | **Take over** / (recent:) **Continue editing** |
| Transfer state | warning | `swap-horizontal` | transfer message | — | — |
| You are editor | success | `lock-check-outline` | "You are editing this property" | "Changes are reserved to your session." | — |
| Locked by other | danger (expiry-warning: warning) | `lock-outline` | "{editor} is currently editing this property" / expiry: "This property will be released for editing in {n}s" | "Marking controls are paused until you take over or the lock is released." | **Suggest to take over** (secondary) |
| Locked by same user (other tab) | danger | `lock-outline` | "You are already editing this property in another tab" | "Switch editing to this tab or keep working in the other tab." / (unsaved:) "Other tab has unsaved changes" | **Continue editing here**, (unsaved:) **Continue editing here anyway** |

Button handlers: take (`popup.ts:7175-7182`), suggest (`7184-7193`), continue (`7195-7205`), force-continue (`7207-7220`), accept — with save/discard confirms, §17 — (`7222-7259`), reject (`7261-7279`). When editing is blocked by the lock, all page-scoped UI is disabled through `pageScopedUiDisabled` (`popup.ts:5881-5885`) and toasts like "Property is being edited by {editor}" surface on blocked actions (`popup.ts:7709-7712`).

## 13. Header menus

### Kebab / config menu (`#config-toggle` ⋮ → `#config-menu`, `ui.tsx:1628-1688`)

- Trigger title: **"Configuration"**; `aria-haspopup=menu`.
- Items (in order):
  1. `#config-open-view` — icon `tune`, label **"Open configuration view"** → switches to the Configuration view (`popup.ts:7336-7343`).
  2. `#render-mode-open-view` — icon `monitor-dashboard`, label **"View or change render mode"** — visible only when a render mode is already set on a valid candidate page (`renderModeChangeMenuVisible`, `popup.ts:5999-6004`) → opens the Render Mode card in edit mode (`popup.ts:7104-7109`).
  3. *(flag `cacheAndUnregisterTools`, off in prod)* divider + `#clear-domain-cache` — icon `trash-can-outline`, class `danger` (red text, red hover tint), label **"Empty cache for current domain"** (§17 confirm; flow `popup.ts:7903-7968`, spinner "Clearing this site's cache and reloading...", toasts "Domain cache cleared" / "Unable to clear cache" / "Unable to reload tab" / "No active tab to clear" / "Unsupported page for cache clearing").
- Open/close: toggle click; any document click or Escape closes all menus (`popup.ts:9650-9660`); opening one menu closes the others (`ui.tsx:2698-2729`); preview mode force-closes menus (`ui.tsx:2589-2599`).

### Unregister close button (`#close-tab`, flag `cacheAndUnregisterTools`, off in prod)

Mac-style red dot in the top close-bar; title **"Unregister current tab and reload"**; disabled during preview/config or while running. Confirm **"Do you want to close Unfluffify and refresh the page to normal?"**; on OK: spinner "Disconnecting this tab and reloading...", background `unregisterTabAndReload`, then `window.close()` on the panel (`ui.tsx:1592-1603`; `popup.ts:7970-8015`; `text.ts:533-536`).

### Todo controls menu & theme menu — described in §9.1 / §8 Card 3.

## 14. Marking-session state machine

The four marking action buttons + toggle + mode + session curtain are **not** re-derived from facts; they render from a finite-state machine's frozen per-state memory (`popup/marking-session-machine.ts`). Signals (user actions & brain events) move the state; every state has a complete surface (`MARKING_SESSION_SURFACE_MEMORY`, `:401-512`), applied over any projected patch (`popup.ts:1867-1976`).

States and their surfaces:

| State | Run AI | Show Content List | Save | Discard | Toggle (checked/locked) | Mode | Curtain |
|---|---|---|---|---|---|---|---|
| `boot` | (pass-through) | | | | null/null | null | null |
| `silent` | – (hidden) | hidden | – | – | ☐ / unlocked | silent | hidden |
| `silent_preview` | – | hidden | – | – | ☐ / unlocked | silent | hidden |
| `pre_ai_clean` | **enabled** | hidden | disabled (`no_session_changes`) | disabled | ☑ / unlocked | marking | hidden |
| `pre_ai_dirty` | **enabled** | hidden | disabled (`requires_ai_run`) | **enabled** | ☑ / unlocked | marking | hidden |
| `running` | disabled+loading | hidden | disabled (`busy`) | disabled | ☑ / **locked** | marking | **visible**: "Computing selectors" / "Waiting for AI results", op `computing_ai`, timer = run countdown |
| `post_ai_clean` | disabled | **visible+enabled** | **enabled** | **enabled** | ☑ / **locked** | marking | hidden |
| `preview_open` | all locked | visible+disabled | disabled (`busy`) | disabled | ☑ / locked | marking | hidden |
| `exit_restoring` | all locked | visible+disabled | disabled (`busy`) | disabled | ☑ / locked | marking | hidden |
| `silent_exit_restoring` | – | hidden | – | – | ☐ / locked | silent | hidden |
| `inspecting` (overlay) | all locked | | busy | | null | keeps prior | **visible**: "Inspecting the page" / "Working… controls are temporarily blocked." phase `render_mode_inspection` |
| `reconciling` (overlay) | all locked | | `server_sync_pending` | | null | keeps prior | **visible**: "Server sync pending" / "Finish server sync before editing" |

Transition table (`:137-207`): `silent --marking-enabled--> pre_ai_clean`; `pre_ai_clean --markings-changed--> pre_ai_dirty`; `--run-started--> running`; `running --run-completed--> post_ai_clean`, `--post-ai-preview-opened--> preview_open`, `--run-failed--> pre_ai_dirty`; `post_ai_clean --preview-opened--> preview_open`, `--saved--> silent`, `--discarded--> pre_ai_clean`; `preview_open --exit-clicked--> exit_restoring --exit-settled--> post_ai_clean`; silent-origin previews return to silent; `navigated` from any session state → silent. Overlays (`inspecting`/`reconciling`) stack on a remembered prior state and return on their `-ended` signal, with a **30s fail-open** (`MARKING_SESSION_OVERLAY_FAIL_OPEN_MS`, `:63`; timer `popup.ts:1751-1792`). A fresh popup adopts its initial state from the projected snapshot (`adoptMarkingSessionState`, `:228-252`; `popup.ts:1875-1913`).

The `pageSaveBlockedReason` memory feeds the click-time toasts in §20; the run-countdown timer renders `M:SS` from the run deadline once the payload is server-side, and narrates the local prepare phase before that (`popup.ts:1941-2009`).

## 15. Blocking curtain & spinner choreography

One full-screen curtain `#ui-curtain` (title + hint + optional timer, §4.3). Visibility & content are resolved by a strict priority ladder (`getBlockingUiCurtainState`, `ui.tsx:657-782`):

1. **Session curtain** (brain/machine dictated — running AI, inspecting, reconciling). Suppressed on the render-mode *detection* view so a fresh site never shows a stuck prep spinner (`ui.tsx:661-666`). Timer: countdown (`M:SS`) or elapsed (`Elapsed M:SS`, only after 3s — `ui.tsx:403-415`), else the `computing_ai` fallback.
2. **Compute in flight** (`computeButtonLoading`): before the payload reaches the server → title `busyMessage` or **"Preparing page content for AI..."**, hint "Working... controls are temporarily blocked.", no timer; once running remotely → title **"Analyzing page content with AI..."**, note **"This can take up to 8 minutes. Editing stays paused until the AI run finishes."**, timer = live countdown, else fallback text **"Up to 8:00"** (`ui.tsx:691-723`; timeout constants `common/bus/contracts/ai-run.ts:1-12`).
3. **Generic busy** (`isBusy` from a spinner lease or background lifecycle): title `busyMessage` or **"Loading popup..."**, hint "Working... controls are temporarily blocked.", timer per lease timerMode (`ui.tsx:724-735`).
4. **Submitting** (`saveExcludesButtonLoading`): **"Sending to Lynx..."**.
5. **AI controls busy**: **"Working with AI..."**.
6. **Device emulation applying**: **"Updating page preview mode..."**.

While visible, `body.is-busy` blocks scrolling; a 1s interval re-renders for live timers (`ui.tsx:784-834`).

**Spinner leases.** The popup holds no local spinner state; operations request a lease from the background broker (`runWithBrainSpinnerLease`, `popup.ts:910-954`) and the brain broadcasts the active phase; the popup maps `{kind, phase}` → presentation via the shared **spinner contract** (`common/spinner-contract.ts:171-516`). Phases whose `blockSurfaces.popup` is true raise the curtain. The complete phase table (title / note / blocks / timer / max duration):

| kind:phase | Title | Timer | Blocks | Max |
|---|---|---|---|---|
| ai-run:preparing-page | Preparing page content for AI | none | page+popup | 30s |
| ai-run:capture-marked-content | Capturing marked content | none | page+popup | 30s |
| ai-run:prepare-selector-payload | Preparing selector payload | none | page+popup | 30s |
| ai-run:refining-static-xpaths | Refining static page XPaths | none | popup | 5s |
| ai-run:remote-wait | Waiting for AI results | **countdown** | page+popup | 8min |
| ai-run:opening-preview | Preparing content list... | none | page+popup | 60s |
| ai-run:syncing-markings | Syncing saved markings in the background | none | none | 30s |
| reveal-freeze:revealing-content | Revealing lazy-loaded content | elapsed | page+popup | 120s |
| reveal-freeze:scrolling-down / -up | Scrolling page down / up | elapsed | page+popup | 120s |
| reveal-freeze:freezing-motion | Freezing page motion | elapsed | page+popup | 120s |
| reveal-freeze:capturing-static-page | Capturing static page | elapsed | page+popup | 120s |
| reveal-freeze:restoring-motion | Restoring page motion | elapsed | page+popup | 30s |
| render-mode-inspection:starting | Starting render-mode inspection | elapsed | page+popup | 60s |
| render-mode-inspection:capturing-page | Capturing this page for render-mode inspection | elapsed | page+popup | 60s |
| render-mode-inspection:reloading-for-inspection | Reloading for render-mode inspection | elapsed | page+popup | 60s |
| render-mode-inspection:waiting-for-consent | Waiting for render-mode consent | elapsed | page+popup | 60s |
| render-mode-inspection:checking-render-mode | Checking render mode | elapsed | popup | 60s |
| render-mode-inspection:saving-choice | Saving render-mode choice | none | popup | 30s |
| popup-bootstrap:refreshing-state | Loading popup state | none | popup | 30s |
| popup-bootstrap:connecting-to-tab | Connecting to the tab | none | popup | 30s |
| popup-bootstrap:loading-settings | Loading saved settings | none | popup | 30s |
| content-bootstrap:page-inspection | Preparing page content | elapsed | page+popup | 120s |
| content-bootstrap:connecting | Connecting to page bridge | none | popup | 30s |
| config-sync:loading | Loading saved markings | none | popup | 30s |
| config-sync:saving | Syncing saved markings | none | none | 30s |
| config-sync:retrying | Retrying saved-marking sync | none | popup | 60s |
| highlight-render:calculating-markings | Calculating markings... | none | page+popup | 60s |
| highlight-render:calculating-highlights | Calculating highlightings... | none | page+popup | 60s |
| preview-hydration:loading-items | Loading detected content | none | none | 30s |
| page-save:saving | Saving page changes | none | popup | 60s |
| page-save:discarding | Discarding page changes | none | popup | 30s |
| property-lock-transfer:transferring-editor | Transferring editor lock | countdown | popup | 60s |

Popup-side operation spinner messages requested per action (`PopupText.overlay`, `text.ts:211-237`): "Refreshing popup data...", "Preparing render mode inspection...", "Saving render mode for this site...", "Scrolling to the selected element...", "Updating exclusion."/"Updating inclusion...", "Preparing this page for marking...", "Turning off marking on this page...", "Clearing this site's cache and reloading...", "Disconnecting this tab and reloading...", "Saving this page session...", "Discarding unsaved page changes...", "Preparing content list...", "Preparing page content...".

Other choreography rules worth copying:
- The popup-refresh spinner engages **only after a 180ms delay** and is suppressed if another spinner is already active (`POPUP_BUSY_OVERLAY_DELAY_MS`, `popup.ts:756,6478-6490`).
- Save/Discard spinners engage **at click** and persist behind confirm dialogs so the press never looks dead (`page-reconciliation.ts:107-110,214-218`).
- The "Preparing content list..." hold spans results-applied → list actually rendered; 60s fail-open (`popup.ts:956-991`, contract `spinner-contract.ts:225-236`).
- Navigation-inspection curtain clears deterministically on the content `inspectionSettled` push; 15s bounded fail-opens exist as backstops (`popup.ts:2213-2310,9965-9976`).
- Spinner broadcasts repaint only the busy surface, not the whole view (`popup.ts:9481-9490`).

## 16. Toasts

`showToast(message)` — single `#toast` element, bottom-anchored, auto-hides after **1800ms** (`ui.tsx:2648-2666`). Toast strings appear throughout §§8, 19–24 and in `text.ts` (every `toast*` key). Notable recurring ones: "Selectors computed locally — Save to sync", "Session saved", "Session discarded", "Submitted to server", "Login successful", "Login expired. Please log in again.", "No changes to save", "Property data updated from server", "Live Page candidates updated" (flag-gated), block-reason toasts (§20/§21).

## 17. Confirm dialogs

All native `window.confirm` / `window.alert`, exact strings:

| Trigger | Type | Text | Source |
|---|---|---|---|
| Discard button | confirm | "Discard the current session? Unsaved changes will be lost." | `text.ts:430`; `page-reconciliation.ts:250` |
| Turning Enable Marking OFF with pending session | confirm | "Disable marking and discard the CSS selectors and markings from this session? This cannot be undone." | `text.ts:442`; `popup.ts:7625` |
| Navigating (todo/checklist link) away with pending session | confirm | "Leave this page and discard the CSS selectors and markings from this session? This cannot be undone." | `text.ts:443`; `popup.ts:7492` |
| Clear domain cache | confirm | "Clear cookies, local storage, and cached files for {hostname}?" | `text.ts:97-100`; `popup.ts:7932` |
| Unregister tab | confirm | "Do you want to close Unfluffify and refresh the page to normal?" | `text.ts:535`; `popup.ts:7982` |
| Accept lock transfer with unsaved changes | confirm | "Save your changes before transferring editing?" then, if declined, "Discard unsaved changes and transfer editing?" | `text.ts:130,132`; `popup.ts:7233,7242` |
| Page-type candidates changed & current page invalid (flag-gated) | alert | "Live Page candidates changed in Lynx, and this page is no longer a valid candidate. Marking has been stopped until you choose a current candidate from the Todo List." | `text.ts:317`; `popup.ts:7728-7733` |
| Consent drift (raised from content side) | alert string defined | "Consent elements changed on this page. Save to keep the updates." | `text.ts:546` |
| Newer remote data replaced local | alert string defined | "Newer data for this page was found and replaced your local changes." | `text.ts:550` |

Before the disable/navigate confirms, a toast pre-announces why: **"Save or discard the current session before exiting marking."** or **"Run AI, then save or discard before exiting marking."** (`text.ts:440-441`; `popup.ts:7487-7491,7620-7624`).

## 18. Accounts / sign-in UX

- **Login flow** (`handleLoginAction`, `popup.ts:8099-8163`): guards → toasts "Set Stage Base first" / "Enter a valid email" / "Enter password". Sets `aiRequestInFlight="login"` (which disables the configuration UI), sends `requestAuthLogin {stageBase,email,password}` to the background (which talks to the accounts endpoint). Failure surfaces the backend `error`/`message` payload text or **"Login failed ({status})"** / "Login request failed" / "Login response did not include token" / "Login failed". Success: token saved (with stage base), remote-config cache cleared, **password field cleared**, toast **"Login successful"**, auto-switch to Marking view.
- **Token status** is surfaced only as "Token saved" (green) / "Login required" (amber) next to the Login button (§8 Card 2). The token value itself is never displayed.
- **Validation cadence**: on every full refresh at most once per **10 minutes** (`TOKEN_VALIDATION_INTERVAL_MS = 600s`, `popup.ts:755,4173-4204`), forced before Save and view-switches; background alarms also validate while the popup is closed and push `tokenInvalid` (`popup.ts:9977-9980,9995-9998`).
- **Expiry UX**: any invalidation → token cleared, popup force-locked to Configuration view, status "Login required" (warning), toast **"Login expired. Please log in again."** (`invalidateTokenAndLockConfiguration`, `popup.ts:4158-4171`).
- **Token rotation is invisible** in the popup — submit flows re-read the freshest stored token mid-flight (`popup.ts:8863-8871`) but display nothing.
- Changing any endpoint/stage-base clears the token and requires re-login (toasts in §8). Auth context changes propagate cross-instance via sync-storage listeners (`popup.ts:9843-9855`).
- Guard toasts for AI actions without credentials: **"Set Endpoint URL first"**, **"Login first"** (`helpers.ts:146-157`; `text.ts:556-557`).

## 19. Flow: Run AI content detection

`handleComputeSelectors` (`popup.ts:8645-8742`) + `applyComputedSelectorSet` (`popup.ts:8396-8548`):

1. Preconditions (silent no-ops or toasts): active tab; base URL (toast "Property not found"); render mode confirmed (toast **"Confirm Render Mode before continuing"**); no reconciliation pending (toast "Server sync pending"); AI credentials (§18 guards); run not already up-to-date; current page URL known (toast "Current page unavailable"); if the page snapshot is stale/missing, **mobile simulation must be on** (toast **"Mobile simulation must be enabled to save markings."**, `popup.ts:2323-2332,8692-8699`).
2. Machine → `running`; curtain sequence: local prepare phases (capture → xpath refine → payload; titles from the spinner contract, **no countdown** — the note narrates the phase) then remote-wait with the **M:SS countdown** (8-minute default). The background command `requestTabRunAi` drives content-side capture and the async job (POST `/get_selectors` + polling).
3. Failure → toast from `getAiRunCommandFailureMessage` (`popup.ts:8620-8643`): "Server sync pending" (reconciliation), "Property is being edited by {editor}" (locked), "Unable to prepare the current page for AI" (missing_current_page), "Mark pages before computing selectors" (missing_saved_pages), "AI request timed out" (timed_out), else backend error or "AI request failed". Machine → `pre_ai_dirty`.
4. Success: selectors stored into the local config; **results-applied tears the run curtain down immediately** and raises the "Preparing content list..." hold; the AI preview opens on-page and the popup switches to the **preview sidebar** seeded with the immediately-returned items; save-status line set to **"Selectors computed locally"** (warning tone) and toast **"Selectors computed locally — Save to sync"** (`popup.ts:8439-8546`).
5. Interrupted runs persist and **resume on popup reopen** (`maybeResumePersistedAiRun`, `popup.ts:6370-6469`): a live run re-enters the countdown curtain; a finished run applies results; server-side loss → toast **"AI results expired. Try again."**; other failures → "AI request failed".

## 20. Flow: Save Session / Discard

**Save** (`page-reconciliation.ts:101-207`): spinner "Saving this page session..." from click. Gate refusals (each a toast, never silent): AI busy → "Working..."; reconciliation pending / `server_sync_pending` → "Server sync pending"; `busy` → "Working..."; `no_session_changes` → status "No local changes to save" + toast **"No changes to save"**; `requires_ai_run` → **"Run AI content detection before saving or exiting marking."**; unnamed → "Save is unavailable right now" (via secondary-gates click paths, `popup.ts:9018-9030`). Then force token validation; then up to **5 attempts** of `syncBaseConfigToServer` (full local snapshot, replace-local-from-response) with 1.5s→10s backoff; between attempts the curtain shows **"Problem connecting to server. Retrying..."** (`:195-201`). Success: reconciliation cleared, fingerprints reset, **post-save silent transition** (mode drops to silent highlighting; machine `saved` → silent), save-status **"Saved and synced"** (green) + toast **"Session saved"**. Failure: status "Save failed" (red) + toast "Unable to save session"; auth expiry exits quietly (login flow takes over).

**Discard** (`page-reconciliation.ts:209-263`): spinner "Discarding unsaved page changes..." from click, gates as above (`no_page_changes` → "No changes to save"), then confirm (§17) **before** the slow runtime refresh; on OK: local session reset to PRE_AI immediately + content discard fired non-blocking; status/toast **"Session discarded"**; machine `discarded` → `pre_ai_clean` (marking stays ON with a clean session). Backend reconciliation happens best-effort afterwards (`popup.ts:8224-8353`).

## 21. Flow: Send to Lynx

Two stages:

1. **`#save-excludes` click** (`handleSaveExcludes`, `popup.ts:8999-9033`): guards — active tab, base URL, render mode (toast **"Confirm Render Mode before sending to Lynx"**), then re-checks the brain's secondary gates: `server_sync_pending` → toast "Server sync pending"; `requires_ai_run` → "Run AI before saving"; `no_session_changes` → "No session changes to save"; `busy` → "Finish the current operation before saving"; other → "Save is unavailable right now". If clear → **opens the Lynx checklist popover** (§11).
2. **Checklist Send** (`handleLynxChecklistSend`, `popup.ts:8953-8997` + `submitSelectorSetToServer`, `popup.ts:8781-8951`): re-verifies gates; cssInfo gate must be `clear` (a pending/errored gate retries on click, fail-closed); credentials required. Popover closes; curtain **"Sending to Lynx..."**; every config/render-mode control is force-disabled for the duration (`popup.ts:8789-8811`). Pipeline: optional page-type assignments POST (flag-gated off — the endpoint 404s, `popup.ts:8744-8749`) → GraphQL `updateScrapingConditions` (includeCss/excludeCss/renderMode) → local config stamped with the submitted fingerprint → config `/save` sync. Outcome status line: **"Submitted selectors"** / **"Submitted selectors (config sync skipped)"** / **"(config sync failed)"** / **"Submitted selectors and synced"**, plus toast **"Submitted to server"**. Failures: skip-reasons pass through ("No selectors available to submit", "Set Stage Base first", "Property not found", pre-gates), errors toast "Submit response error" / "Submit response format error" / "Submit request failed" or the GraphQL error message.

## 22. Flow: Render-mode selection

UI: `renderRenderModeEditor` (`ui.tsx:1152-1285`) — a 3-step wizard inside the Render Mode card, each step headed by a numbered accent chip (18×18 circle) + label:

1. **"Inspect the page"** — two secondary buttons in a 2-col grid: `#render-mode-inspect-without-javascript` **"Without JavaScript"** and `#render-mode-inspect-with-javascript` **"With JavaScript"**. They alternate: while the tab runs JS only "Without JavaScript" is enabled; once held in no-JS mode only "With JavaScript" is (`popup.ts:5960-5973`, held-state from session storage `popup.ts:4521-4525`). Both disabled when aiBusy / page-scope disabled / no tab.
   - Click → curtain "Preparing render mode inspection..." then the background inspection reload (debugger-attached, JS toggled). Start toasts: **"Reloading page with JavaScript disabled for inspection"** / **"…enabled for inspection"**; failure toasts: **"Unable to reload page for render mode inspection"**, or **"Something went wrong and the render mode could not be confirmed. Please try again."** (`popup.ts:6668-6751`; `render-mode.ts:37-65`).
2. **"What did you observe?"** — two boxed radio options (accent highlight when checked): **"Meaningful content the same in both"** (value `static`) and **"Meaningful content only with JavaScript"** (value `rendered`); a hidden disabled `undetermined` radio keeps the group consistent (`ui.tsx:1190-1227`). Disabled until editable (`renderModeInputDisabled || renderModeReadOnly`).
3. **"Render mode"** — a read-only **pill** showing the chosen value with icon (`Static`/`language-html5`, `JavaScript`/`language-javascript`, `Undetermined`/`monitor-dashboard`; accent-tinted pill, `theme-components.css:879-904`), a visually hidden `<select id="render-mode">` mirroring it, plus `#render-mode-set` (**"Set"**, icon check; visible while editing; disabled when value undetermined) and `#render-mode-edit` (**"Change"**/**"Cancel"**; visible once set) (`ui.tsx:1229-1282`; gating `popup.ts:5927-5990`).

Notices above/inside the card (u-alert-warn; priority order `popup.ts:5611-5631`): off-tab → "Open the extension on this tab to detect Render Mode."; unmapped → "Property not found."; unresolved site → "Render Mode will only be enabled for known properties."; detecting (auto-detect flag, off) → "Detecting Render Mode..."; auto-detect failed → "We could not detect the Render Mode automatically."; low confidence → "Render Mode was detected automatically, but it is recommended to double-check it manually before continuing."; not yet set → **"Confirm Render Mode before continuing"**; editing → **"Set Render Mode to continue"**.

**Set** (`handleRenderModeSet`, `popup.ts:6969-7094`): curtain "Saving render mode for this site..."; guards (undetermined → toast "Render Mode is undetermined and cannot be set."; no base → "Render Mode is unavailable for this page"); persists `renderMode` + timestamp into the config; normalizes the page (detach debugger / re-enable JS / reload), ends the content-side inspection, raises the navigation-inspection overlay for the post-Set reload, then success toast **"Render mode set to JavaScript"** / **"Render mode set to Static"**.

While the render-mode section is visible the popup keeps a debugger attached to the tab and hides consent banners for a clean comparison (`syncRenderModeDebuggerLifecycle`, `popup.ts:6781-6818`); leaving the section detaches and reloads.

Guard toasts elsewhere: enabling marking → **"Confirm Render Mode before enabling marking"**; compute → **"Confirm Render Mode before continuing"**; submit → **"Confirm Render Mode before sending to Lynx"** (`text.ts:288-290`).

## 23. Flow: Enable Marking toggle

`handleEnableToggle` (`popup.ts:7528-7766`):

- **ON**: guards in order — active tab; base URL (toast "Property not found"); render mode ready (toast + snap back); current page must be a valid page-type candidate (toast = the current page-type notice or **"This page is not one of the current Live Page candidates. Choose one of the listed candidates to continue."**); base-url parse ("Enter a valid Property URL") and page-within-base ("Current page is outside the Property URL"); siteId resolution; desktop preview must be off (toast **"Turn off desktop preview before enabling marking."**). Then curtain **"Preparing this page for marking..."** (180ms delay) while the background activates marking on the page. Failure → toast (locked-by-editor or "Unable to activate on this page"), toggle snaps back off. Success → machine `marking-enabled` → `pre_ai_clean`.
- **OFF**: an immediate spinner **"Turning off marking on this page..."** engages at click (no delay); if the session has pending changes → pre-toast + confirm (§17); Cancel keeps marking on; OK discards locally then deactivates. Failure → toast "Unable to disable marking", toggle snaps back on. Success → machine → `silent`.
- The toggle checkbox itself is disabled per machine state (locked during running/post-AI/preview/restoring) — `toggleEnabledDisabled` in §14.

## 24. Device emulation & desktop preview

- **Mobile emulation is automatic** for marking (the extension spoofs a mobile identity); the popup's manual "Enable mobile simulation" toggle and scale slider exist only as handlers + view state (`deviceEmulationToggle` flag **off**; no JSX renders them — verified: no `deviceEmulationEnabled` input in `ui.tsx`). Defaults: mode `mobile`, scale `0.85` (displayed "85%") (`ui.tsx:221-224`).
- Mobile-simulation state still gates saving/compute ("Mobile simulation must be enabled to save markings.", §19) and is reconciled every refresh (`popup.ts:5228-5235`).
- **Desktop preview** (flag `desktopPreview`, **off in prod**): when enabled + in silent mode with stored selectors, a separate bottom card renders — row icon `monitor-eye`, label **"Preview in desktop mode"**, tooltip "M", checkbox `#desktop-preview-enabled`, plus notice **"Marking mode is disabled while desktop preview is on."** (`ui.tsx:1733-1763`; visibility `popup.ts:5908-5918`). Toggling runs curtain "Updating page preview mode..." and switches the emulated device between desktop/mobile (`popup.ts:7793-7856`); emulation apply has a 12s timeout with failure toast "Device emulation failed" (`helpers.ts:104-135`); unsupported URL → "Device simulation is only available on http(s) pages".

## 25. Keyboard shortcuts

Document-level (`popup.ts:9655-9697`); all require Ctrl (or Cmd), no Alt/Shift, not repeat, not inside an editable target:

| Keys | Action | Guard |
|---|---|---|
| Ctrl/Cmd+E | Toggle Enable Marking | skipped if `toggleEnabledDisabled` |
| Ctrl/Cmd+S | Save Session | requires marking on and Save enabled |
| Ctrl/Cmd+M | Toggle desktop preview | only when the `desktopPreview` flag is on and control visible+enabled |
| Escape | Close config/todo/theme menus | — |

The two hotkeys are advertised as plain `title` tooltips on their rows: "CTRL/CMD+E" (Enable Marking row), "M" (desktop preview row) (`text.ts:207-208`).

## 26. Popup lifecycle

**Open** (`init()`, `popup.ts:9540-10003`): load page-type taxonomy (fail-open, 5 retries at 2s→30s backoff); resolve active tab; start the popup bus client for that tab (receives view projections, spinner-surface broadcasts, and signal frames); restore the projected spinner queue (so a curtain that was up when the panel closed is re-shown); apply theme; `initUi(handlers)`; register document/tab/storage/runtime listeners; final `refreshUi({useBusyOverlay:false})`.

**refreshUi** — the single full re-derivation pass (`refreshUiInner`, `popup.ts:4455-6368`): validates token, loads settings + configs + tab state, resolves the property (local config match → GraphQL `urlSearchInfo` discovery → fallback), runs the once-per-page-session `/load` (never re-fired by refreshes — `#load-once`, `popup.ts:4873-4917`), fetches page types (2-minute quiet refresh cycle, `popup.ts:768,2470-2527`), reconciles marking/preview/device state, derives every view-state field, applies brain dictation + machine memory last, publishes session facts. Debounced re-runs (120ms, `scheduleRefresh` `popup.ts:9470-9479`) are triggered by: storage changes (configs, tab state, device emulation, no-JS-held key, theme/auth keys), `pageDraftChanged`, property-lock lock-state pushes, and page-type refresh dues.

**Tab switch** (`tabs.onActivated`, `popup.ts:9699-9754`): transient spinner leases of the old tab are cleared, all projected background state is reset, the bus reconnects to the new tab, spinner queue restored, then a quiet refresh (explicitly **no** "Refreshing popup data..." curtain on switches).

**Tab navigation** (`tabs.onUpdated`, `popup.ts:9756-9833`): remote-config cache cleared per navigation; if marking (or a render-mode Set reload) is expected on the destination, the navigation-inspection overlay is raised and cleared via the content `inspectionSettled` event + settle polls; otherwise a plain refresh. A real (non-hash) URL change signals `navigated` → machine drops to silent and resets the AI-run mirror (`popup.ts:4489-4518`).

**Close** (`beforeunload`, `popup.ts:9834-9841`): clears the off-candidate lock timer, transient spinner leases, and settle polls. Nothing else — persistent leases and background state survive for the next open.

**Runtime messages** consumed (`popup.ts:9899-9993`): property-lock state updates, `aiPreviewClosed` / `aiPreviewFocusChanged` / `aiPreviewStateChanged` (preview lifecycle + hydration pushes), `inspectionSettled`, `tokenInvalid`, `pageTypesRefreshDue`, `pageDraftChanged`.

## 27. Debug affordances

- **`?debugTabId=<id>`** query param on `popup.html`: binds the panel to an arbitrary tab id instead of the active/side-panel tab; honored first in tab-context resolution (`popup/messages.ts:548-566`; `background.ts:2637-2649`). Works in any build.
- **`?directMode=1`**: only honored in a **debug build** (`UNFLUFFIFY_DEBUG=1` / dev server, compile-time `__UF_DEBUG_BUILD__`, `feature-flags.ts:52-64`). Lets marking activate on ANY page: synthesizes a base URL from the page origin, skips render-mode + page-type + siteId gates for marking/enumeration/overlay only — save/AI stay gated (`popup.ts:514-529,4782-4794,5069-5073,7587-7601,7669-7673`).
- **`window.__UNFLUFFIFY_POPUP_DEBUG__`**: exposes `getViewState`, `directModeActive`, and `activateDirectMode()` for automated tests (`popup.ts:531-549`).
- **`localStorage.ufDebugSpinnerQueue = "1"`** (also a default-on debug flag): `[popup-spinner]` / `[popup-blocker]` console.debug tracing of curtain/spinner decisions (`popup.ts:1323-1347`; `ui.tsx:836-878`).
- **Trace diagnostics** (flag + `worldTraceEnabled` debug flag): the Extras→Diagnostics trace panel (§8) and `[world-trace][popup]` logs + a popup-bus self-test per tab (`popup.ts:1355-1378`).

## 28. Feature flags — what production actually shows

`common/feature-flags.ts:3-17` — **every flag is `false`** in the shipped build:

| Flag | Hides in production |
|---|---|
| `desktopPreview` | Desktop-preview card + Ctrl/Cmd+M hotkey |
| `deviceEmulationToggle` | manual mobile-simulation toggle (also has no JSX at all) |
| `traceDiagnostics` | Diagnostics section, trace events panel, world-trace logging |
| `renderModeAutoDetection` | endpoint-based auto detection of render mode (manual wizard is the only path) |
| `appearanceCustomization` | the whole Extras/Appearance section → theme is always Nordic/System |
| `cacheAndUnregisterTools` | red close/unregister button + "Empty cache for current domain" menu item |
| `propertyLockCollaboration` | the property-lock indicator + all lock behavior |
| `previewExpandedStates` | "Show all states" preview checkbox + category coloring |
| `pageTypesChangeDetection` | "Live Page candidates changed…" notice/alert/forced-open-todo on the 2-min poll |
| `pageTypeAssignments` | page-type assignment POST during Send to Lynx |

The Extras card disappears entirely (both subsections flag-gated), and the config menu shrinks to "Open configuration view" + conditionally "View or change render mode". A faithful re-creation must implement the flagged surfaces but ship them dark.

## 29. Vestigial view-state (declared but never rendered)

Present in `initialViewState`/handlers but with **no JSX** — do not build UI for these, but keep the strings for parity:

- **Server Sync panel**: `syncLoadStatusText/Tone`, `syncSaveStatusText/Tone` are still computed on every load/save ("Latest loaded: …"/"Latest saved: …", "Synced (base)", "No remote data (404)", "Login required", "Skipped", "Failed", "… at HH:MM" — `text.ts:30-95`; `popup.ts:3284-3350,6111-6114`) but nothing renders them (`grep syncLoadStatusText ui.tsx` → state only). The save-status *strings* do still reach the user via toasts.
- **Marked Pages list** (`markedPages`, `markedPagesEmptyText`, "Marked Pages"/"Navigate" strings) — data feeds the checklist model only (`ui.tsx:1864`).
- **Explicit exclude/include lists** (`onExplicitExclude*`/`onExplicitInclude*` handlers, `popup.ts:7371-7447`) — the on-page UI drives these; the popup renders no list.
- **Render-mode warning popover** ("How to Verify the Render Mode Manually" + 9-step ol + acknowledge checkbox + "Confirm to continue." toast, `text.ts:252-270`): view fields are hard-reset to hidden every pass (`popup.ts:5938-5940`) and no component renders it.
- **Device emulation manual controls** (scale slider, `formatScalePercent`) — state only.
- `ViewText.openOnCurrentTabNotice` *is* used (header notice when off-tab, `popup.ts:5101-5104`).

## 30. Status string master tables

### 30.1 Session/save status line `#page-draft-status` (`page-save-state.ts:72-97`)

| Condition | Text | Tone |
|---|---|---|
| controls hidden | "" | success |
| reconciliation pending/present, reason `sync_failed` | "Server sync failed. Save again to retry." | warning |
| reason `sync_skipped` | "Server sync required. Save again to retry." | warning |
| reason `load_failed` | "Server refresh failed. Save again to retry." | warning |
| other reconciliation | "Server sync pending" | warning |
| pending changes + needs AI | "Run AI before saving" (+ card notice "Run AI content detection before saving or exiting marking.") | warning |
| pending changes | "Changes ready to save" | warning |
| clean | "No unsaved session changes" | success |

### 30.2 Save-status labels fed to `updateLastConfigSaveStatus` (tones `popup.ts:3301-3328`; shown today via toasts/history state)

Success: "Saved and synced", "Reverted and synced", "Selectors updated and synced", "Submitted selectors", "Submitted selectors and synced". Warning: "Saved locally (sync skipped)", "Saved locally (server sync pending)", "Reverted locally (sync skipped)", "Selectors updated locally (sync skipped)", "Submitted selectors (config sync skipped)", "Selectors computed locally" (explicit warning override, `popup.ts:8543-8545`). Danger: "Save failed", "Revert failed", "Saved locally (sync failed)", "Saved and synced (refresh failed)", "Reverted locally (sync failed)", "Selectors updated locally (sync failed)", "Submitted selectors (config sync failed)". Muted: "No local changes to save", "Unknown". All get "` at HH:MM`" timestamps except skipped loads (`popup.ts:3330-3350`).

### 30.3 Page-type (Todo) notice line (`popup.ts:6157-6171`)

| Condition | Text |
|---|---|
| current URL under multiple page types | "This URL appears under multiple page types in Live Pages and cannot be marked until that conflict is resolved." |
| current URL not a candidate, was stored before | "This page is no longer a current Live Page candidate and will be ignored until it returns." |
| current URL not a candidate | "This page is not one of the current Live Page candidates. Choose one of the listed candidates to continue." |
| no candidates | fetch error or "Live Pages are not prepared for this site yet. Prepare them in Lynx before marking pages here." |
| invalid stored pages exist | "Stored pages that are no longer valid candidates are ignored and removed from remote sync." |
| (flag-gated) candidates changed | "Live Page candidates changed in Lynx. Review the updated Todo List before continuing." |

### 30.4 Header property-URL notice (`popup.ts:6079-6087,5092-5104,5294-5300`)

Priority: config-server retry → "Problem connecting to the configuration server. Retrying..."; site blocked → "Property not found." / "Unable to resolve domainId right now" / "Property not found" (no domain id) / off-tab "Open the extension on this tab to enable controls."; no base URL yet → "Property will be detected automatically".

---

## Reference constants (timing)

| Constant | Value | Source |
|---|---|---|
| Toast duration | 1800 ms | `ui.tsx:2657-2665` |
| Busy-overlay engage delay (popup refresh & light ops) | 180 ms | `popup.ts:756` |
| Token validation interval | 600 s | `popup.ts:755` |
| Remote-config retry delay | 2.5 s | `popup.ts:757` |
| Page-type quiet refresh | 120 s | `popup.ts:768` |
| AI run timeout (countdown) | 8 min ("Up to 8:00" fallback) | `ai-run.ts:1-12` |
| Page-save sync retries | 5 attempts, 1.5 s → 10 s backoff | `popup.ts:618-620` |
| Preview restore fallback | 1 s | `popup.ts:621` |
| Preview settled-empty confirmation | 3 s | `popup.ts:9283` |
| Marking-session overlay fail-open | 30 s | `marking-session-machine.ts:63` |
| Nav-inspection / stale-inspection fail-open | 15 s | `popup.ts:2213-2214` |
| Exit-preview command budget | 20 s | `popup.ts:9199-9201` |
| Device-emulation apply timeout | 12 s | `helpers.ts:114` |
| Refresh debounce | 120 ms | `popup.ts:9474-9478` |
| Todo expansion contexts kept | 200 | `popup.ts:769` |
