# Unfluffify Knowledge

## Testing

- Use Node's built-in test runner via `npm test`; the script intentionally runs
  plain `node --test` so the full subtest count is meaningful.

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
