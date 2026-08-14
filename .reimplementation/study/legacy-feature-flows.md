# Legacy Unfluffify (production v1.10.0) — End-to-End Feature & Flow Inventory

All file references are relative to the legacy worktree root:
`/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main`

Branch `main`, HEAD `28974c2a` ("fix(brain): gate reveal/freeze + silent highlighting on real editor activation"), which sits 3 fix-commits after the `1.10.0` version bump (`e148f9d2`) — matching the "v1.10.0 + 3 fixes" production description.

---

## 0. Build-level facts that shape every flow

**Feature flags are compile-time constants and are ALL `false` in this build** (`src/common/feature-flags.ts:3-17`):

| Flag | Effect when false (current production state) |
|---|---|
| `desktopPreview` | Desktop-preview checkbox never functions (`src/popup.ts:7794`), TAB_ACTIVATE_MARKING desktop-preview refusal can never trigger from UI |
| `deviceEmulationToggle` | The manual device-emulation on/off toggle in the popup is inert (`src/popup.ts:7769`); mobile emulation is still applied automatically (see §7) |
| `traceDiagnostics` | Trace mode UI off |
| `renderModeAutoDetection` | Backend `/is_js_rendered` detection is refused by the background (`src/background.ts:3264-3266`); render-mode suggestion comes only from the manual two-inspection flow |
| `appearanceCustomization` | Theme picker inert; stored theme values are reset (`src/popup.ts:9859-9862`) |
| `cacheAndUnregisterTools` | "Clear domain cache" and "Unregister tab & reload" menu items no-op (`src/popup.ts:7905`, `src/popup.ts:7972`; background refusal `src/background.ts:3048`, `src/background.ts:3618`) |
| `propertyLockCollaboration` | **The entire property-lock system is disabled in production.** Background port listener never installs (`src/background.ts:2890-2892`), lock messages return `feature_disabled` (`src/background.ts:3025-3028`), popup resets lock state (`src/popup.ts:9910-9913`), tab-state lock fields are zeroed on write (`src/background.ts:3453-3497`) |
| `previewExpandedStates` | "Show all states" preview list mode hidden |
| `pageTypesChangeDetection` | Periodic quiet Live-Page-candidate change detection (changed-set toast/alert) gated off (commit `8e53a71f`) |
| `pageTypeAssignments` | `POST /assign_page_types` submission is skipped entirely — backend endpoint not live, previously 404'd on every Send to Lynx (`src/popup.ts:8744-8749`) |

Debug flags (`src/common/feature-flags.ts:19-25`): only `ufDebugSpinnerQueue` is on.

**Direct mode** (debug builds only): `?directMode=1` on the popup URL enables marking on unconfigured pages, skipping siteId resolution; save/AI stay gated (`src/popup.ts:520-529`, `src/popup.ts:7669-7674`, `src/popup.ts:4782-4794`; gate: `src/common/feature-flags.ts:52-64`). Production `pnpm build` compiles this off.

**Manifest** (`wxt.config.ts:52-86`): MV3, permissions `storage, sidePanel, tabs, scripting, debugger, alarms, browsingData, webNavigation, activeTab, offscreen`, host `<all_urls>`. The popup is a **side panel** (`popup.html`), opened by clicking the toolbar action (`src/background.ts:4285-4294`). No `onInstalled`/uninstall hooks exist anywhere in `src/`.

---

## 1. Architecture overview (layers and messaging)

- **Background service worker** (`src/background.ts`, ~4300 lines + `src/background/*`): command router for popup-issued tab commands (`BACKGROUND_COMMANDS`, `src/background.ts:384-400`), all remote network I/O (`src/background/remote-network.ts`), page-data lifecycle loading on navigation (`src/background/page-data-lifecycle.ts`), AI-run orchestration (`src/background/ai-run-orchestrator.ts`), render-mode inspector (`src/background/render-mode-inspector.ts`), the "brain" (state store + deciders + view projector under `src/background/brain/`), popup-state broker/spinner operations, SW keepalive, property-lock hub (disabled).
- **Content scripts**: bootstrap loader (`src/entrypoints/content-loader.content.ts`) lazily activates the heavy main runtime `src/content-main.ts` + `src/content/core.ts` (marking engine, overlays, silent highlighting, motion freeze, consent hiding). A separate MAIN-world bridge handles page-motion freeze (`src/entrypoints/page-motion-freeze-bridge.content.ts`).
- **Popup / side panel** (`src/popup.ts` ~10000 lines + `src/popup/*`, React UI `src/popup/ui.tsx`): owns user flows; holds a marking-session finite state machine (`src/popup/marking-session-machine.ts`); communicates with background via request envelopes (`POPUP_GET_TAB_VIEW_STATE`, `TAB_CONTENT_REQUEST`, tab commands) and a long-lived bus port per tab (`src/background.ts:2874-2888`).
- **Offscreen document** (`src/offscreen/bootstrap.ts`): DOMParser-based XPath refinement for AI payloads (`src/background.ts:970-1078`).
- **Transfer-payload store** (`src/background/transfer-payload-store.ts`): large payloads (page HTML snapshots, /save bodies, AI results) are parked in storage under `remote-config-<scope>:<ts>:<nonce>` keys and passed between layers by key, never inline; stale payloads are swept on worker start (`src/background.ts:4296-4299`) with a max age of 5 min (+ AI timeout margin) (`transfer-payload-store.ts:4-9`).

Storage areas:
- `chrome.storage.sync`: global settings (`globalToken`, `globalEndpoint`, `globalConfigEndpoint`, `globalStageBase`, `globalAuthContextVersion`, `globalTheme`, `globalThemeMode`) (`src/common/settings-store.ts:5-15`).
- `chrome.storage.session`: per-tab state `tabState:{tabId}` in default/`initial`/`restore` scopes, `deviceEmulation:{tabId}`, render-mode no-JS hold, persisted AI-run record (`popupAiRun`), transfer payloads.
- IndexedDB (via `idbGet/idbSet` in `src/common/utilities.ts`, proxied to background for popup/content via `idbGet` messages `src/background.ts:3685-3723`): `configs` (per-baseUrl property config), `backendSavedPageMarkings` (last confirmed backend snapshot per baseUrl, `src/common/config.ts:34,321-366`), `pageSaveReconciliations` (`src/common/config.ts:33,229-288`), page-type taxonomy cache.

---

## 2. Complete backend API surface

| Endpoint | Method | Caller | Purpose |
|---|---|---|---|
| `{configEndpoint}/load` | POST `{siteId}` | `loadRemoteConfigSnapshot` `src/background/remote-network.ts:230-275` | Fetch property config snapshot; 401/403→`auth_error`, 404→`not_found` |
| `{configEndpoint}/save` | POST full sync payload | `saveRemoteConfigSnapshot` `src/background/remote-network.ts:315-366` | Persist property config; response body is the server's authoritative snapshot |
| `{configEndpoint}/remove` | POST `{siteId,url}` | `removeRemotePageMarking` `src/background/remote-network.ts:99-124` | Remove one page marking server-side (used when pruning invalid page-typed pages, `src/popup.ts:3143-3234`) |
| `{configEndpoint}/page-types` | GET | `loadPageTypeTaxonomy` `src/background/remote-network.ts:277-313` | Page-type taxonomy (slugs+labels) cached locally |
| `{configEndpoint}/is_js_rendered` | POST `{rawHtml,renderedHtml}` | `requestRenderModeDetection` `src/background/remote-network.ts:368-409` | Render-mode auto detection — **flagged off in prod** |
| `{configEndpoint}/assign_page_types` | POST array | `submitPageTypeAssignments` `src/background/remote-network.ts:411-446` | Page-type assignment submission — **flagged off in prod** |
| `{aiEndpoint}/get_selectors` | POST snapshot | `requestAiRunStartSnapshot` `src/background/remote-network.ts:448-494` | Start async AI selector job; response strictly `{session_id}` (`src/popup/ai-run.ts:58-68`) |
| `{aiEndpoint}/get_selectors/status/{sessionId}` | GET | `requestAiRunStatus` `src/background/remote-network.ts:65-97` | Poll job status: `running|done|error`, 404 = job gone |
| `{aiEndpoint}/get_selectors/result/{sessionId}` | GET | `requestAiRunResultSnapshot` `src/background/remote-network.ts:496-546` | Fetch `{exclusionSelectors[],inclusionSelectors[]}` |
| `https://api.{stageBase}/graphql` — `urlSearchInfo(url,includePageInfo:false){domainId domainName}` | POST | `resolveLivePageSiteId` `src/background/live-page-client.ts:158-240` (query text `src/common/lynx-live-pages.ts:23-30`) | URL → siteId + canonical property base URL |
| GraphQL `propertyPageTypes(domainId){pageTypes{pageType pages{url wordsCount}}}` | POST | `fetchLivePagePropertyPageTypes` `src/background/live-page-client.ts:243-327` | Live Page candidates per page type (Todo list) |
| GraphQL `cssInfo(url){domainId domainName exclusionCssSelectors inclusionCssSelectors isJavascriptRenderingEnabled usesUnfluffify}` | POST | `fetchLynxCssInfo` `src/background/remote-network.ts:183-228` | Send-to-Lynx staleness gate |
| GraphQL mutation `updateScrapingConditions(domainId,includeCss,excludeCss,renderingMode)` | POST | `submitSelectorSetGraphqlUpdate` `src/background/remote-network.ts:126-181` | "Send to Lynx" — pushes CSS selector sets + render mode enum (`STATIC|RENDERED`) |
| `https://accounts.{stageBase}/api/account/validate` | GET | `validateAuthToken` `src/background/network-core.ts:85-111` | Token validity probe (401/403 ⇒ invalid) |
| `https://accounts.{stageBase}/api/account/login` | POST `{email,password}` | `requestAuthLogin` `src/background/network-core.ts:113-143` | Sign-in, returns `{token}` |
| Target page URL | GET (credentials:include, 30s abort) | `fetchStaticPageHtmlForBackground` `src/background/remote-network.ts:548-588` | Raw (unrendered) HTML capture for AI payloads / render-mode inspection |
| `wss://{configEndpointHost}/property-lock?token=…` | WebSocket | `src/common/property-lock.ts:145-181`, `property-lock-background.ts:723-758` | Property edit lock hub — **flagged off in prod** |
| `https://www.gstatic.com/generate_204`, `https://cloudflare.com/cdn-cgi/trace` | GET no-cors | `property-lock-background.ts:892-930` | Independent network reachability probes for lock connectivity |

**Token rotation happens on every one of these HTTP calls**: `maybeUpdateStoredTokenFromResponse` reads the `x-update-token` response header and, if present and different, writes it into `storage.sync.globalToken` (`src/common/lynx-live-pages.ts:141-161`). Callers re-read the stored token mid-flow before follow-up requests (e.g. `src/popup/remote-config.ts:380-387,458-465`, `src/popup.ts:8863,8871`).

---

## 3. Options / settings / endpoints configuration

There is no options page; configuration lives in the popup's **Configuration view** (`View.Configuration`, `src/popup/ui.tsx:1582`). Fields and handlers:

- **Config endpoint** (`globalConfigEndpoint`) — `handleConfigEndpointSet` `src/popup.ts:8017-8040`. URL-validated. Changing the endpoint **origin** clears the stored token and bumps `globalAuthContextVersion` (forced re-login) (`src/common/settings-store.ts:219-247`).
- **AI endpoint** (`globalEndpoint`) — `handleEndpointSet` `src/popup.ts:8047-8069`; same origin-change⇒token-cleared rule (`settings-store.ts:249-277`).
- **Stage base** (`globalStageBase`) — hostname-only, normalized/validated by `normalizeStageBase` (`src/common/lynx-live-pages.ts:46-70`); `handleStageBaseSet` `src/popup.ts:8076-8092`; any change clears the token (`settings-store.ts:279-303`). Stage base derives `https://api.{base}/graphql` and `https://accounts.{base}/…`.
- **Sign-in** (email+password) — `handleLoginAction` `src/popup.ts:8099-8163`: sends `requestAuthLogin` through the background, saves `{stageBase, token}` + new auth-context version on success (`settings-store.ts:199-217`), clears remote-config caches, switches back to the marking view.
- Theme picker + theme mode (flagged off), trace toggle (flagged off), cache/unregister tools (flagged off).

The popup auto-opens the Configuration view when stage base / endpoints / token are missing and returns via `maybeSwitchToMarkingView` once complete (`src/popup.ts:7336-7365`).

Background credential resolution: any network module resolves missing endpoint/token/stageBase from settings with `endpointPreference: "config" | "ai"` picking `globalConfigEndpoint` vs `globalEndpoint` (`src/background/network-core.ts:44-67`).

---

## 4. Accounts: sign-in state, validation, rotation

- **Sign-in state** = presence of a non-empty `globalToken`. `validateStoredToken` (popup, `src/popup.ts:4173+`) rate-limits validation to every 10 min (`TOKEN_VALIDATION_INTERVAL_MS` `src/popup.ts:755`) unless forced (page save forces it: `src/popup/page-reconciliation.ts:151`).
- **Background auth monitor**: a `chrome.alarms` job `uf-auth-token-check` every 10 min calls `/validate`; on `valid:false` it broadcasts `tokenInvalid` (`src/background/auth-token-monitor.ts:7-37`, wired `src/background.ts:872-884,900-907`). The popup reacts by `invalidateTokenAndLockConfiguration(true)` — clears the token, locks configuration UI, shows a toast (`src/popup.ts:9977-9980`, `src/popup.ts:4158+`).
- **`auth_error` on /load or /save** likewise invalidates the token and locks configuration (`src/popup/remote-config.ts:260-266,466-469`).
- **Rotation**: `x-update-token` header persistence on every backend/GraphQL/accounts response (§2). Cross-context cache invalidation via a sync-storage change listener (`src/common/settings-store.ts:131-149`); popup listens for `globalAuthContextVersion`/`globalStageBase`/`globalConfigEndpoint` changes and resets validation timestamps + caches (`src/popup.ts:9845-9855`).

---

## 5. Property identification / resolution (URL → siteId → canonical base URL)

Two independent resolution paths exist:

**(a) Background page-data lifecycle (navigation-driven, credential-less trigger)** — `src/background/page-data-lifecycle.ts`:
1. `webNavigation.onCommitted` (frame 0) and `onHistoryStateUpdated` (SPA) call `handleTopLevelNavigationCommitted`/`handleSpaNavigation` (`src/background.ts:3914-3927,3973-3983`), building a navigation key `tabId|pageUrl|documentId`.
2. `resolveContext` (`page-data-lifecycle.ts:205-289`): base URL priority = requested → tab-state → `findMatchingBaseUrl(pageUrl, configs)`; siteId from input or cached config. **A cached siteId is re-validated against GraphQL `urlSearchInfo` every time** because stale local siteIds previously loaded the wrong property's data (`page-data-lifecycle.ts:233-255`). If nothing is cached, `resolveLivePageSiteId` resolves both siteId and canonical baseUrl from `urlSearchInfo.domainName` (protocol borrowed from the page URL, trailing slashes trimmed — `live-page-client.ts:95-136`), persists the siteId into the config (`page-data-lifecycle.ts:186-203`), and mirrors it into the brain (`src/background.ts:655-661`).
3. Then the /load flow runs (§11).

**(b) Popup `ensureBaseUrlSiteId`** (`src/popup/site-resolution.ts:348-510`), used before marking enable, save sync, and Send to Lynx: reads config's stored siteId first; else uses a popup-session in-memory lookup cache; else calls `resolveLivePageSiteId` via runtime message (`resolveSiteIdFromGraphql` `site-resolution.ts:262-303`, background handler `src/background.ts:3725-3738`). If GraphQL returns a **different canonical base URL** than requested, the two config entries are merged timestamp-wise into the canonical key and the old key is deleted (`site-resolution.ts:461-490`, merge logic `305-346`).

The popup **never persists the brain-projected siteId itself** — the SW page-data lifecycle is the sole config/siteId write authority (`#sw-sole-authority` comment, `src/popup.ts:4803-4812`); it only adopts a session-scoped in-memory lookup as a fresh-install fallback (`src/popup.ts:4813-4834`).

Base-URL scoping helper: `isPageWithinBaseUrl` — a base URL like `https://example.com/news` matches all pages under that prefix (README:235-239). `urlSearchInfo` GraphQL `NotFound` error code ⇒ "no mapped base URL" state (`live-page-client.ts:202-213`; popup notice `src/popup.ts:4773-4776`).

---

## 6. Activation lifecycle

**Passive page load (popup never opened)** — `tabs.onUpdated status:"complete"` (`src/background.ts:4220-4267`):
- If tab's `initial.active` is false, content is activated **only when the URL matches a configured property** (`findMatchingBaseUrl`) — durable contract: consent hiding must run on every configured property page at load; unrelated pages stay dormant (`src/background.ts:4228-4240`).
- `brain.recordEditorActivation(tabId, initialActive)` gates the reveal/freeze + silent-highlight directives: a passive load does **consent hiding only** and does not consume the one-per-visit reveal (`src/background.ts:4256-4262`; content-side unconditional `core.hideConsentElements()` before the directive early-return, `src/content-main.ts:5604-5610`).

**Popup activation (side panel opened / popup bootstrap)** — first `refreshUiInner` pass sends `TAB_BOOTSTRAP_CONTENT` when `initial.active` is false and the URL has an origin (`src/popup.ts:4552-4560`). The command (`src/background.ts:1135-1188`):
1. sets `initial.active=true`, 2. `brain.recordEditorActivation(true)` — unlocks reveal/freeze + silent highlighting ("the popup bootstrap is the real editor activation", `src/background.ts:1156-1158`), 3. enforces default mobile emulation, 4. ensures content-main is injected/active (5 retry attempts with forced injection, `src/background.ts:670-716`).
After editor activation, the content side runs one content-reveal sweep and keeps page motion frozen for both silent highlighting and marking (README:227).

**Session semantics**: `initial.active` (session storage) marks "this tab has an active extension page session". `tabState.enabled` marks marking mode.

**Cross-property navigation reset** — `disableExtensionOnTopLevelNavigation` on `webNavigation.onCommitted` (chosen over onBeforeNavigate so a "Stay on page" cancel doesn't tear the session down — `src/background.ts:3910-3914`):
- Determines previous baseUrl from tab state, falling back to the brain's last content page URL matched against configs (`src/background.ts:3853-3866`).
- **Cross-URL navigation** (new URL outside previous base): disposes all volatile per-tab state (AI compute lock, spinner queue, lifecycle, world trace), resets `initial.active=false` and the brain editor-activation gate — the new property starts as a fresh passive load (`src/background.ts:3876-3893`).
- Same-URL reloads with an active AI compute lock are left alone (`src/background.ts:3894-3896`).
- **Marking never survives any navigation/reload** ("editor-mobile-only contract"): if `state.enabled`, the extension is disabled for the tab (`src/background.ts:3897-3908`); the reload-`restore` scope is always cleared, never populated (`src/background.ts:3510-3515`, `src/background.ts:4241-4245`).

**Tab close**: `tabs.onRemoved` clears tracked session state incl. device emulation, releases render-mode no-JS hold, releases property lock immediately (when enabled), disposes tab runtime and brain entry last (`src/background.ts:3812-3831`). Ghost brain tabs pruned after rehydrate (`src/background.ts:3835-3843`).

**Action icon**: active icon set when the tab is focused and either marking-enabled or session-active; default icon otherwise (`src/common/utilities.ts:754-798`); refreshed on tab activation/focus/session-storage changes (`src/background.ts:4034-4054,4269-4283`).

---

## 7. Device emulation

- Presets: mobile 412×960 (`deviceScaleFactor` 1, mobile true), desktop 1920×1080; default scales mobile 0.85 / desktop 0.7 (`src/common/constants.ts:14-32`). Implemented over the `chrome.debugger` API (`Emulation.setDeviceMetricsOverride` in `src/common/emulation.ts`).
- **Default-on mobile**: every popup bootstrap and marking activation calls `ensureDefaultMobileDeviceEmulation` (`src/background.ts:1161,1301`; guard fn `src/background.ts:4191-4218`). Fresh tab sessions therefore start in mobile simulation (README:242).
- **Per-session choice outside marking**: the emulation state is session-storage per tab (`deviceEmulation:{tabId}`); user disables are respected (not silently re-enabled) until the tab session state is cleared (README:242-243). The explicit toggle UI is feature-flagged off, so in production the choice is effectively managed automatically.
- **Marking forces mobile**: `debugger.onDetach` with an enabled tab immediately re-applies mobile emulation (`src/background.ts:3986-4004`); TAB_ACTIVATE_MARKING re-ensures it.
- **Desktop preview** (flag off): separate checkbox, requires stored AI selectors, persists per tab lifecycle in `initial.desktopPreviewEnabled`, disables marking entry (`src/background.ts:1272-1278`), switches to desktop metrics (`src/popup.ts:7793-7856`); DevTools detach clears it back to mobile (`src/background.ts:4006-4026`).
- Navigation completion reconciles/clears emulation state as needed (`src/background.ts:3959-3972`, `emulation.ts:471+`).
- Mobile simulation is a **precondition for capturing page snapshots**: `ensureMobileSimulationForSave` gates AI-run snapshot capture (`src/popup.ts:2323-2333`, used at `src/popup.ts:8698`).

---

## 8. Render-mode inspection (static vs rendered)

Config fields: `renderMode` (`static|rendered`, default static) + `renderModeUpdatedAt`; "confirmed" ⇔ `renderModeUpdatedAt != epoch fallback` (`src/common/config.ts:1150-1155`). Until confirmed, marking enable, AI run, and Send to Lynx are all blocked with toasts (`src/popup.ts:7587-7593`, `src/popup.ts:8655-8658`, `src/popup.ts:9009-9012`).

**The two inspections** — popup buttons "Inspect with JavaScript" / "Inspect without JavaScript" (`src/popup.ts:6820-6826`) both call `runRenderModeInspectionReload` (`src/popup.ts:6668-6751`) which issues the brain request `renderMode.runInspection` handled by `executeRenderModeInspection` (`src/background.ts:1890-2223`):

1. Clear any prior no-JS hold; record inspection started in the brain.
2. If JS-on inspection: re-enable JS, and if the tab was held no-JS, recovery-reload it first (`src/background.ts:2047-2071`).
3. Begin step handshake with content (`runRenderModeInspectionBeginStep`), with a reload-recovery retry if content is unreachable (`src/background.ts:2073-2083`).
4. Reload the page with `reloadPageWithJavaScriptControl(tabId, javaScriptDisabled)` (Chrome debugger `Emulation.setScriptExecutionDisabled`), waiting for load start (8s) and completion (15s) (`src/background.ts:2091-2123`; timeouts `src/background.ts:423-425`).
5. Capture:
   - JS-on: hide consent overlays (`runRenderModeHideConsentStep`), then content-side HTML capture (`runRenderModeCaptureHtmlStep`) (`src/background.ts:2130-2147`).
   - JS-off: capture via debugger `DOM.getDocument`/`DOM.getOuterHTML` (content scripts can't run), raw HTML via background fetch (`captureRenderModeHtmlWithDebugger`, `src/background.ts:911-968`).
6. Snapshot `{pageUrl, renderedHtml, rawHtml, renderMode, hiddenCount}` returns to the popup, which remembers it keyed `baseUrl|pageUrl` (`rememberRenderModeInspectionSnapshot`, `src/popup.ts:2947+`).
7. `finally`: JS-off inspections leave the page in no-JS mode and mark the tab "no-JS held" (`src/background.ts:2175-2188`); JS-on sends the end-inspection handshake.

**No-JS hold lifecycle**: held tabs restore JavaScript on the next genuine top-level navigation (`onBeforeNavigate`, `src/background.ts:3929-3957`), or after 30s of tab inactivity via the tab-inactivity observer alarm (`src/background.ts:352-353,779-855`), never while the tab is active+focused.

**Auto-detection** (flag off in prod): with both inspections' snapshot present, `maybeAutoDetectRenderMode` would POST raw+rendered HTML to `/is_js_rendered`; accuracy < 0.65 ⇒ "unsure"/undetermined (`src/popup/render-mode-inspection.ts:114-282`; thresholds `src/popup.ts:759-761`). In production the user reads the two reloads and chooses manually.

**Confirmation — "Set" is local-only** (`handleRenderModeSet`, `src/popup.ts:6969-7094`): writes `renderMode` + fresh `renderModeUpdatedAt` into the **local IndexedDB config only** — no backend call. Persistence to the backend happens later as part of the `/save` sync payload (§11) and as the `renderingMode` enum on `updateScrapingConditions` at Send to Lynx (`src/background/remote-network.ts:138-147`). Set also: ends any content-side inspection unconditionally (reveal/freeze must run right after leaving detection, `src/popup.ts:7025-7048`), normalizes debugger/JS state, expects and overlays the post-Set reveal/freeze reload, and pushes `configUpdated` to the tab.

**Selector freshness is tied to render mode**: a selector set whose `selectorsUpdatedAt` predates `renderModeUpdatedAt` is treated as absent (`isSelectorSetCurrentForRenderMode`, `src/common/config.ts:745-767`; used by `getNewestConfigSelectorSet:867-901`) — changing render mode invalidates previously computed AI selectors.

**Property-lock interplay** (when flag on): inspection reloads show "reconnecting-after-inspection" instead of the 70s loss countdown; the popup explicitly re-claims the lock and polls the snapshot afterwards (`PROPERTY_LOCK.md:58-62`; `reconcilePropertyLockAfterRenderModeReload` `src/popup.ts:4338+`).

---

## 9. Marking session: enable → seed → edit → dirty → save/discard

**The popup marking-session FSM** (`src/popup/marking-session-machine.ts`) is the authority for how each state *looks* (memorized full-surface matrices, `MARKING_SESSION_SURFACE_MEMORY:401-512`): states `silent, silent_preview, pre_ai_clean, pre_ai_dirty, running, post_ai_clean, preview_open, exit_restoring, silent_exit_restoring` plus overlays `inspecting, reconciling` (30s fail-open, `:63`). Transition table at `:137-207`. Key transitions: `marking-enabled→pre_ai_clean`, `markings-changed→pre_ai_dirty`, `run-started→running`, `run-completed→post_ai_clean`, `saved→silent`, `discarded→pre_ai_clean`, `navigated→silent`.

**Enable** (`handleEnableToggle`, `src/popup.ts:7528-7766`):
Gates in order — base URL present; render mode confirmed (`:7587`); current page is a valid Live-Page candidate with a page type (`:7594`); page inside base URL (`:7656`); siteId resolvable (`:7676-7689`); desktop preview off (`:7694`). Then `TAB_ACTIVATE_MARKING` (`src/background.ts:1232-1409`): spinner-wrapped, forces mobile, bootstraps content, sends content `setEnabled {enabled:true, baseUrl, pageType, performInitialReveal:true}`; a lock-refused enable maps to a "locked" toast (`:7709-7712`, `src/background.ts:1358-1367`). On success: tab state `{enabled:true, baseUrl, pageType}`, runtime mode `marking`, brain signal `MARKING_ENABLED`, popup resets the AI-run fingerprint (Run AI enabled, Save/Preview disabled — `:7722-7724`) and signals `marking-enabled`.

**Seeding**: each enable recomputes the page entry fresh from the default-exclusion taxonomy plus CSS/AI-selector influence, wiping any stale draft, so the page never starts dirty (README:110; content `enableForBaseUrl` wipes the entry, `src/content-main.ts:3728`). Default exclusions: immutable tags (IMG, INPUT, SELECT, TITLE, STYLE, SCRIPT, TEMPLATE, IFRAME, VIDEO, SVG, NOSCRIPT) vs user-toggleable boundaries (FOOTER, FORM, LABEL, NAV, HEADER, DIALOG, ASIDE, BUTTON) (`src/common/constants.ts:39-85` — locked marking contract).

**User edits** (content side, contract in `MARKING_AND_HIGHLIGHTING_LOGIC.md`): click toggles exclusion; Shift targets broader 052c content boundaries; Alt explicitly includes; Space passes clicks through to page UI (README:207-209). Edits update the page draft; `pageDraftChanged` runtime messages carry dirty status to popup and (when enabled) lock hub (`src/background.ts:342-351`, popup listener `src/popup.ts:9987-9992`). The popup also lists explicit exclusions/inclusions with view-on-page (focusElement) and remove actions (`setExplicitExclude` / `setExplicitInclude` messages, `src/popup.ts:7371-7448`).

**Dirty tracking / gating** (popup): `currentDraftDirty` (real marking edit) and reconciliation-pending are the "current page edited" signal (`src/popup/page-reconciliation.ts:68-86`); `sessionHasPendingChanges` = draft dirty ∨ reconciliation pending ∨ selectors pending sync ∨ local-vs-backendSaved page marking diff (`src/popup.ts:2642-2654`). `doesSessionRequireAiRun` (`src/popup.ts:2611-2640`): dirty draft without an up-to-date AI run ⇒ run required; otherwise required when local markings differ from backend-saved and selectors are missing/stale (older than newest local marking timestamp, or invalidated by render-mode change). **Save is deliberately blocked until the AI run has processed the latest markings** (`requires_ai_run` blocked reason; FSM `pre_ai_dirty` memory: save disabled, discard enabled, `marking-session-machine.ts:426-432`).

**Save Session** (`handlePageSave`, `src/popup/page-reconciliation.ts:101-207`):
1. Spinner from click; gates: AI busy, reconciliation pending, blocked reasons `busy|server_sync_pending|no_session_changes|requires_ai_run` each toast specifically (`:119-150`).
2. Forced token validation (`:151`).
3. Up to 5 attempts of `syncBaseConfigToServer` with `includeAllLocalPageMarkings:true, replaceLocalFromServerResponse:true` (§11), exponential 1.5s→10s backoff (`:158-202`).
4. On success: clear the page-save reconciliation, clear pending-selector-sync, reset AI fingerprint, then **`applyPostSaveSilentTransition` — a successful save ENDS the marking session** (`src/popup.ts:8187-8222`): local draft state reset, background command `TAB_APPLY_POST_SAVE_TRANSITION` (`src/background.ts:1508-1563`) pushes `configUpdated {forceReloadPageEntry:true}` + `setEnabled false` to the tab (page re-renders from defaults + saved selectors baseline, drops to silent highlighting), FSM `saved→silent`, toast "session saved".

**Discard Session** (`handlePageRevert` → confirm dialog → `applyLocalPageDiscard`, `src/popup/page-reconciliation.ts:209-263`, `src/popup.ts:8224-8302`):
- Immediately resets local session to PRE_AI-clean (draft cleared, AI-computed-since-submit flags cleared, fingerprint reset, reconciliation cleared) **before any backend round-trip**.
- Fires `TAB_APPLY_LOCAL_DISCARD` (`src/background.ts:1565-1598`) = `configUpdated {forceReloadPageEntry:true}` — the content page entry reloads from the (unchanged) stored config, i.e. **Discard restores the backend-saved baseline for the page while marking stays enabled** (FSM `discarded→pre_ai_clean`).
- Publishes settled facts (enabled, PRE_AI, no preview) so brain authority doesn't wedge (`:8277-8289`).
- Best-effort non-blocking reconciliation afterwards: forced `/load` refreshes local config to the last-saved backend state (`reconcilePopupConfigAfterDiscard`, `src/popup.ts:8309-8354`).
- Disable-with-pending-changes runs the same discard after a `window.confirm` (`src/popup.ts:7618-7637`).

**Marking mode never survives navigation** (§6), so a navigation mid-session silently discards the draft (FSM `navigated→silent`; popup drops AI mirror on real URL change, `src/popup.ts:4496-4503`).

---

## 10. AI run: submission, job lifecycle, application, preview, resume

**Trigger**: "Compute selectors" (`handleComputeSelectors`, `src/popup.ts:8645-8742`). Gates: not already in flight; render mode confirmed; no reconciliation pending; AI credentials present; run actually needed (`aiRunUpToDate` check `:8673-8676`); mobile simulation on if the current page needs a fresh snapshot (`:8692-8700`). It marks the run active (spinner+countdown immediately) and issues `TAB_RUN_AI` with `{baseUrl, currentPageUrl, pageType, currentRenderMode, siteId}`.

**Background orchestration** (`TAB_RUN_AI` `src/background.ts:2225-2306` → `runAiCommandForTab` `src/background/ai-run-orchestrator.ts:712-880`), all under SW keepalive:
1. **AI compute lock** on the tab — heartbeat-renewed fail-open TTL (default +30s) that pauses marking edits page-side (`setAiComputeLock` content message) and self-clears if heartbeats stop (`:459-531`).
2. **Snapshot capture (only if needed)**: if the current page's stored entry lacks `renderedHtml`/`submissionXpaths` **or the local draft is dirty**, sends content `capturePageSnapshot {persist:true}` with a 120s budget (heavy pages; `:8`, `:767-793`). The content handler (`src/content/capture-page-snapshot-handler.ts`) persists renderedHtml, rawHtml (own fetch with deadline), title, pageType, submissionXpaths into the page entry — so **the AI request always uses stored evidence only** (README:231).
3. **Payload assembly** (`prepareAiRunPayloadSnapshot` `:566-710`): from the property config, take every page entry within baseUrl that has `renderedHtml` + non-empty `submissionXpaths` (fails `missing_current_page` if the current page isn't among them). Backfill missing `rawHtml` via background fetch and persist it. Payload:
   `{ baseUrl, renderMode, defaultExclusionSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS, pages: [{url, renderedHtml, rawHtml? (static mode only), renderedXPaths}] }`, where `renderedXPaths` = `buildAiSubmissionXpaths(entry)` — submission xpaths with `excluded` flags and `explicit:true` for explicit includes, document-root xpaths dropped (`src/popup/ai-run.ts:83-111`).
4. **Static-mode refinement**: when `renderMode === "static"`, the payload's xpaths are refined against raw HTML in the **offscreen document** (DOMParser), budget 2.5s overall/2s per message, falling back to unrefined entries (`:387-435`; offscreen plumbing `src/background.ts:970-1078`).
5. **Start**: POST `/get_selectors` with the (refined) payload; strict `{session_id}` parse (`remote-network.ts:448-494`).
6. **Poll loop** (`pollAiRunUntilDone` `:886-1004`): poll-first (no head lag), every 5s (`AI_RUN_POLL_INTERVAL_MS`), overall deadline 8 minutes (`AI_RUN_DEFAULT_TIMEOUT_MS`, `src/common/bus/contracts/ai-run.ts:1`). Each cycle refreshes the **AI-run heartbeat**: persists `{sessionId, siteId, expiresAt(now+2min), deadlineAt}` to session storage (`ai-run-record-store.ts`) and renews the compute lock — this is what makes the run resumable. Status `error`⇒fail; `done`⇒ GET result; result validated as selector arrays and parked as a transfer payload.
7. Cleanup in `finally`: persisted record cleared, compute lock released.

**Result application** (`applyComputedSelectorSet`, `src/popup.ts:8396-8548`): writes `selectors` + fresh `selectorsUpdatedAt` into the local config (timestamp only bumped when the set actually changed); flags `selectorsPendingConfigSync`; captures the **AI-run markings fingerprint** (run freshness = fingerprint of current page markings, `src/popup.ts:2789-2817`); publishes `RESULTS_APPLIED`; tears the run curtain down immediately; auto-opens the **AI preview** on the page (`TAB_SHOW_AI_PREVIEW` → content renders detected-content overlay + popup "Detected Content" sidebar); status "Selectors computed locally — Save to sync" (warning tone until Save). FSM: `run-completed → post_ai_clean → preview_open`.

**Failure UX**: reasons map to specific toasts (reconciliation pending, locked, missing current page, no marked pages, timeout, HTTP status) (`src/popup.ts:8620-8643`); `run-failed` FSM signal returns to `pre_ai_dirty`.

**Resume**: on popup load with a persisted, unexpired record for the current site (`shouldResumePersistedAiRun`: same siteId + `expiresAt > now`, `src/popup/ai-run.ts:133-140`), `maybeResumePersistedAiRun` (`src/popup.ts:6370-6469`) re-checks status server-side, restores the running UI, and issues `TAB_RESUME_AI` (`src/background.ts:2308-2379` → `resumeAiCommandForTab` — poll-only, no snapshot/start).

**Preview surfaces** (two distinct products):
- **Silent "Preview Contents"** (`handlePreviewLatest` `src/popup.ts:9035-9103`): available outside marking whenever the property has stored, render-mode-current selectors; opens preview from **latest stored** selector set.
- **Marking "Preview Contents"** (`handleMarkingPreview` `src/popup.ts:9105-9165`): only exposed in `post_ai_clean` (FSM `markingPreviewVisible`), i.e. only when the AI run is fresh for the current markings.
- Preview interactions: row/element focus sync (`TAB_FOCUS_PREVIEW_ELEMENT`), expanded categories mode (flagged off), item latch to prevent hydration flicker (`src/popup.ts:9268+`). **Exit Preview** (`handleExitPreviewMode` `src/popup.ts:9167-9249`): closes with a 20s budget, optionally restores marking mode (restore-token latch + `aiPreviewClosed` settle + hard-finalize fallback); silent-origin previews return to silent (`silent_exit_restoring` FSM leg).

---

## 11. Save/load config sync (the /load–/save contract)

**Sync payload (version 5)** — `createConfigSyncPayload` (`src/common/config.ts:1218-1270`):
```
{ version: 5, baseUrl, siteId, renderMode, renderModeUpdatedAt,
  pageMarkings: { [url]: { timestamp, title?, pageType?, renderedHtml, rawHtml,
                           xpaths: [{xpath, excluded, explicit?}],   // includes includeXpaths/selectorSuppressed as explicit includes
                           submissionXpaths: [{xpath, excluded}] } },
  selectors: {exclusionSelectors[], inclusionSelectors[]}, selectorsUpdatedAt,
  submittedSelectorsFingerprint }
```
(`silentWhitespaceExcludedXpaths` stays local-only; `consentXpaths`/`aiSelectorModifiers` are legacy fields dropped on normalize, `config.ts:966,1143`.)

**Load** (two callers, one flow):
- Navigation-driven: background page-data lifecycle (§5) — POST `/load {siteId}`, response parked as transfer payload (`remote-network.ts:230-275`), then:
  - **200** ⇒ `replaceServerConfigIntoLocalSnapshot` (`src/background/remote-config-sync.ts:266-409`): the local property config is **completely replaced** by the server payload — nothing local is spread in ("#load-once step 3", `:316-323`); `backendSavedPageMarkings[baseUrl]` snapshot updated to the server's page markings (`:388`); interrupted requests restore the previous snapshot (owner/`shouldContinue` fences, `:345-401`).
  - **404** ⇒ `clearLocalPageDataForMissingRemote` (`:146-264`): local page markings + selectors + submitted fingerprint cleared, backend-saved cache dropped (restorable if superseded mid-flight); reconciliations cleared; tab told `configUpdated {forceReloadPageEntry:true}` (`page-data-lifecycle.ts:349-390`).
  - **401/403** ⇒ `auth_error`; other ⇒ `error` (retried by popup with exp backoff capped 30s, `src/popup/remote-config.ts:176-196`).
  - Dedupe: concurrent loads for one navigation collapse into a single in-flight `/load` ("#load-dedupe", `page-data-lifecycle.ts:301-322`); results cached per navigation key; request-id + site fences discard stale applications (`:175-184`).
- Popup-driven: `loadRemoteConfigForCurrentPage` (`src/popup/remote-config.ts:198-326`) → background `loadPageDataForNavigation` (`src/background.ts:3219-3230`). **"#load-once"**: fires once per page session key `tab|page|site|endpoint`, reused on later refreshes (`src/popup.ts:4874-4917`); `not_found` fences+clears cached page results for the whole site (`remote-config.ts:267-292`); `changed` results toast "remote data updated".
- **Editor skip** (lock feature): the active editor stops calling `/load` after a one-time ownership-change bootstrap (forced load) — `editorOwnsCurrentProperty` / `propertyLockEditorBootstrapPending` (`src/popup.ts:4867-4920`; contract PROPERTY_LOCK.md:100-114). Passive observers keep loads at most once per minute.

**Save** — `syncBaseConfigToServer` (`src/popup/remote-config.ts:328-548`):
1. Re-resolve siteId (canonical baseUrl may change), refresh token, refresh property page types.
2. **Page-marking filter** decides what goes into `payload.pageMarkings` (`:420-445`):
   - default (Send-to-Lynx path): pages already **backend-saved** (∪ current page if `includeCurrentPageMarking`);
   - Save Session passes `includeAllLocalPageMarkings:true` ⇒ all local pages;
   - when property page types are available, the set is further narrowed to **valid Live-Page candidates** via `buildLynxChecklistViewModel().activeMarkedPages` keyed `url|pageType`.
3. Payload parked as transfer payload; background POSTs `/save` (`remote-network.ts:315-366`).
4. Response handling: `auth_error` ⇒ token invalidation; HTTP error ⇒ retry if retryable status (408/425/429/5xx, `src/popup.ts:766`), up to `maxAttempts` (5 for page save) with 1.5→10s backoff; empty/invalid body ⇒ a **local-only selector merge** fallback (payload with pageMarkings stripped) (`:487-500`).
5. Success with body:
   - Save Session (`replaceLocalFromServerResponse:true`) ⇒ `replaceServerConfigIntoLocalSnapshot` — the server response becomes the complete new local config + backendSaved cache.
   - Other paths ⇒ `mergeServerConfigIntoLocalSnapshot` (`remote-config-sync.ts:411-548`): timestamp-merge of page markings (confirmed payload entries can win ties), render-mode/selector-state merges, backendSaved cache timestamp-merged rather than wiped for empty/partial responses (README:260).
6. `changed` ⇒ `configUpdated` pushed to the tab; `replacedCurrentPage` optionally alerts "newer remote data replaced local".
7. Invalid page-typed URLs reported by the merge are pruned locally and via `/remove` remotely (`pruneRemoteInvalidPageMarkings`, `src/popup.ts:3160+`).

**Guard/merge primitives** (`src/common/config.ts`): per-entry timestamp comparison `mergePageMarkingsByTimestamp:1272-1327` (richer-snapshot tie-breaker), selector-state merge with submitted-fingerprint reconciliation `:820-852`, render-mode merge `:464-497`. All config writes are queued per-baseUrl and globally (`:1399-1445`).

**Page-save reconciliation states**: keyed `[baseUrl,pageUrl]`, `pending` with a reason; non-blocking reasons `pending|saving|preparing|loading|calculating|sync_failed|sync_skipped|load_failed` — **`editor_preparing` is the one blocking reason** (silent-highlighting preparation; `src/common/config.ts:37-48`, `src/popup.ts:758`, README:214).

**Known destructive-save exposure (matches live QA finding)**: on the Send-to-Lynx path the filter is `backendSavedPageUrls.has(url)` (`remote-config.ts:420-423`); if the backend-saved cache is empty/stale (e.g. never loaded this session, or cleared by a 404 race), the v5 payload carries an **empty `pageMarkings`**, and a backend that treats `/save` as full-replace wipes all page markings. The dropped guard (dangling commit `e11059b1` on the rewrite repo) addressed this class.

---

## 12. Property lock (contract complete; feature-flagged OFF in production)

`PROPERTY_LOCK.md` is the locked contract; implementation spans `src/common/property-lock.ts` (constants/normalizers), `src/common/property-lock-background.ts` (WS hub), `src/content/property-lock-state-machine.ts` + `property-lock-port-client.ts` + `property-lock-banner*.ts` (page banner/state), `src/popup/property-lock-ui.ts` + `brain/deciders/property-lock-decider.ts` (popup view).

- **Identity**: stable page-session `clientId` in page `sessionStorage` (not the tab id); duplicated/cloned tabs get rotated to a fresh clientId (`PROPERTY_LOCK.md:17-22`; conflict rotation `property-lock-background.ts:307-334`). One WebSocket per `siteId:clientId` (`:209,679-705`).
- **Acquire**: content connects a `propertyLock` port as soon as the page resolves to a Live-Page candidate property; landing on an eligible page queues the editor claim immediately (no waiting for marking mode) (`PROPERTY_LOCK.md:10-24`). WS `subscribe` + `take_lock`/`client_status` messages (`property-lock-background.ts:763-787,582-617`).
- **Heartbeat**: every 30s while page interaction occurred within the last 30 min (`PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS`/`EDITOR_IDLE_TIMEOUT_MS`, `property-lock.ts:53-56`; loop `property-lock-background.ts:778-787`); activity debounced 5s (`:1112-1125`).
- **Connection loss**: editor sees a 70s countdown; after it, if independent connectivity probes (gstatic/cloudflare) also fail, the runtime demotes to non-editor (`:932-964`). Reconnect backoff 2s doubling, 60s cap (`:1130-1162`).
- **Off-candidate warning**: staying on a same-property non-candidate page starts a 70s countdown, then `release_lock` (`PROPERTY_LOCK.md:49-52`; content machine `property-lock-state-machine.ts:235-258`).
- **Cross-property cool-off**: navigating to a different property keeps a 30s recovery window (recovery `{siteId, baseUrl, clientId, deadline}` persisted in tab `initial` state — `src/background.ts:3462-3497`); return within the window restores the same editor session, otherwise `release_lock` by stored ids (`PROPERTY_LOCK.md:53-57,77-80`; popup release `src/popup.ts` refreshUiInner recovery block ~`5420-5440` region).
- **Same-user tabs**: passive tab shows "already editing in another tab"; `Continue editing here` transfers when the editor tab is clean; dirty editor ⇒ disabled + "anyway" force that discards the other tab's draft (`PROPERTY_LOCK.md:28-39`; local promote `property-lock-background.ts:803-837`; popup handlers `src/popup.ts:7195-7220`).
- **Takeover**: passive "Suggest to take over" → editor accept/reject; accept with unsaved changes asks save-and-sync (runs `handlePageSave` before accepting — `src/popup.ts:7222-7259`) or discard; both sides see a transfer state; new editor gets a toast (`PROPERTY_LOCK.md:82-98`).
- **Data freshness**: editor session is the source of truth; periodic loads never replace the editor's draft; becoming editor triggers a one-time forced `/load` bootstrap replacing local property data; passive observers refresh at most once per minute with a quiet toast on replacement (`PROPERTY_LOCK.md:100-114`; §11 editor-skip wiring).
- **Immediate close release**: closing the editor tab sends `release_lock` at once instead of the 70s port-disconnect grace (`src/background.ts:3822-3824`, `property-lock-background.ts:636-657`); ordinary port disconnects wait 70s before disposing the runtime (`:1168-1178`).
- **Render-mode reload**: reconnecting-after-inspection status instead of the loss countdown; popup re-claims and polls after re-injection (`PROPERTY_LOCK.md:58-62`).
- **Extension-context invalidation**: terminal for the page script instance — stop reconnects, reset UI, wait for the fresh content script (`PROPERTY_LOCK.md:115-127`).
- The lock holds the SW keepalive for the lifetime of a connected runtime (`property-lock-background.ts:215-241`).

---

## 13. Page types, Todo list, Lynx checklist, Send to Lynx

**Taxonomy**: fetched from config-server `GET /page-types` and cached (`initPageTypeTaxonomy`; retry loop popup-side `src/popup.ts:9505-9538`); defines slug set + labels + ordering used for validation (`isSupportedPageTypeValue`, `src/common/config.ts:550-553`) and display.

**Live-Page candidates ("Todo List")**: GraphQL `propertyPageTypes(domainId)` normalized to `{key,title,candidates:[{url,wordsCount,duplicate,duplicatePageTypes}]}` (`src/common/lynx-checklist.ts:174-250`); candidate URLs normalized (hash stripped, host lowercased, default ports removed, trailing slashes trimmed) and compared protocol-collapsed to https (`lynx-live-pages.ts:94-97`). Popup caches per site for 2 min (`src/popup.ts:768`; `ensurePropertyPageTypes` `site-resolution.ts:163-260`); a background 2-min alarm nudges refresh while the popup is open (`src/background/page-types-monitor.ts`, popup handler `src/popup.ts:9981-9986`).

- The Todo section is visible once siteId + render mode are ready (`src/popup.ts` refreshUiInner: `todoListVisible = siteIdReady && renderModeReady`), lists each page type with Ready/Missing badges and candidates (word counts, Current/Marked/Duplicate badges), and offers per-subsection expand/collapse, expand/collapse-all, auto-collapse (`src/common/text.ts:301-326`, `src/popup/ui.tsx:1372-1405`). Clicking a candidate navigates the active tab (confirming when leaving a marking session — `confirmNavigationAwayFromMarking` `src/popup.ts:7462-7515`).
- **Todo completion counts backend-saved page markings only, never local drafts** (`src/popup.ts` refreshUiInner ~5477: "Todo completion must reflect persisted save results"; coverage model built from `backendSavedPageMarkingItems`).
- **Current page candidacy** (`getCurrentPageCandidateState`, `lynx-live-pages.ts:99-139`): `candidate` (with page type) / `missing` / `duplicate` / `empty` — drives the enable gate (§9), notices ("not one of the current Live Page candidates", "appears under multiple page types…"), and the marked-page pruning of invalid urls.
- Marked pages are also listed separately with counts (excluded + included per page) (`collectStoredPageMarkingItems`, `src/background/remote-config-sync.ts:56-86`).

**"Save" button → Lynx checklist popover → Send to Lynx** (three-step user flow):
1. `handleSaveExcludes` (`src/popup.ts:8999-9033`) — the toolbar "send" action on the *silent-highlighting* surface: gates on render mode + secondary gates (server sync pending / requires AI run / no session changes / busy — each named in a toast), then **opens the Lynx checklist popover**.
2. Popover (`openLynxChecklistPopover` `src/popup.ts:6882-6897`): shows page-type coverage (all page types must have ≥1 marked page — `buildLynxChecklistViewModel().canSend`, blocking reasons `no_candidates` / `missing_page_types`, `lynx-checklist.ts:380-406`), and runs the **cssInfo staleness gate**: fetch `cssInfo(url)`, sanitize both selector sets (split on commas, whitespace-collapse, dedupe, order-insensitive; no case folding) and **fail-closed** — send disabled while the check is `pending`, on `error`, and on `match` (backend already holds the identical set; empty backend or `usesUnfluffify:false` never blocks) (`lynx-checklist.ts:432-484`, `src/popup.ts:6912-6947`; pending/error retry on click `:8963-8968`).
3. `handleLynxChecklistSend` (`src/popup.ts:8953-8997`) → `submitSelectorSetToServer` (`:8781-8951`):
   - Locks the whole configuration UI; gates: no reconciliation pending, no dirty draft, non-empty selector set, stage base present, siteId resolved.
   - (flagged-off) page-type assignments POST.
   - GraphQL `updateScrapingConditions(domainId, includeCss, excludeCss, renderingMode)` where includeCss = inclusion selectors joined ", ", excludeCss = exclusion selectors (via `buildSelectorSetForGraphqlSubmit`), renderingMode = `STATIC|RENDERED` from local config.
   - On mutation success: local config updated with `submittedSelectorsFingerprint = JSON.stringify(normalized selector set)` (`:8922-8927`; fingerprint semantics `config.ts:736-745,854-865` — `areCurrentSelectorsSubmitted` compares current selectors' fingerprint against it), then a follow-up `syncBaseConfigToServer` persists the fingerprint/selectors to the config server (merge path, no page-marking expansion).
   - Status line reports combined outcomes ("submitted", "+synced", "sync failed/skipped").

**Send to Lynx lives on the silent-highlighting surface; marking mode has no send** (README:102,231).

---

## 14. Silent highlighting, consent handling, motion freeze (content surface)

- **Silent highlighting**: overlay showing excluded (and optionally included) content computed from backend-saved page data + stored selectors; renders on editor activation when selectors exist; refresh machinery with settle-before-redraw (`src/content-main.ts:560-590` state; rules `src/content/silent-highlight-rules.ts`). Passive observers use backend-saved page data; the active editor uses local session data (README:110).
- **Consent handling**: cookie/consent UI is hidden on **every** configured property page at load, pre-activation (`src/content-main.ts:5604-5610`), again before render-mode capture (`runRenderModeHideConsentStep`) and before page save; hidden consent text is submitted under the same invisible-text rules as other hidden content (README:113,223).
- **Motion freeze**: on editor activation one reveal sweep runs (scroll-reveal/lazy content normalized to visible posture; semantic hidden UI stays hidden), then page motion is paused for both silent and marking modes; marking enable runs its own bounded instant scroll sweep and restores scroll; an MDI snowflake indicator shows while frozen; overlay/status UI stays live (README:227). Freeze control is injected MAIN-world via `chrome.scripting` and serialized per tab/frame (`src/background.ts:2538-2589`).
- **Page toast**: content-side toasts for draft save feedback (`src/content/page-toast.ts`).

---

## 15. Housekeeping and infrastructure behaviors

- **SW keepalive** (`src/background/sw-keepalive.ts`): refcounted 20s `getPlatformInfo` ping; held during AI runs (`src/background.ts:2245,2321`), every background command dispatch (`:2421`), tab operations (`:2852-2872`), storage-proxy replies (`replyWithKeepAlive` `:2955-2974`), and live lock runtimes.
- **Alarms**: `uf-auth-token-check` (10 min), `uf-page-types-refresh` (2 min), tab-inactivity observer alarms (no-JS restore) — all multiplexed in one `onAlarm` listener (`src/background.ts:899-905`).
- **Spinners/busy state**: background-owned per-tab spinner queue projected to popup via the brain; popup acquires "spinner leases" for every user operation; navigation-inspection overlays with 15s fail-open timers (`src/popup.ts:2213-2214`); marking FSM overlays fail open at 30s.
- **Command ledger / world trace**: per-tab command history + diagnostics behind debug flags (`src/background.ts:2381-2410`, `src/background/world-trace.ts`).
- **Migrations**: none formal; `getConfigs()` normalizes-on-read and rewrites when anything changed — key normalization, entry dedupe/merge, legacy field drops (`src/common/config.ts:1329-1383`).
- **Uninstall/install hooks**: none.
- **Popup keyboard shortcuts**: Ctrl/Cmd+E toggle marking, Ctrl/Cmd+S save session, Ctrl/Cmd+M desktop preview (flag-gated) (`src/popup.ts:9655-9697`).
- **Popup lifecycle**: side-panel is tab-bound; tab switches re-bind the bus client, clear transient spinners, and refresh quietly (`src/popup.ts:9699-9754`); `resolvePopupTabContext` resolves debug tab → side-panel-bound tab → active tab (`src/background.ts:2637-2686`).

---

## 16. Storage inventory (quick reference)

| Store | Key | Content |
|---|---|---|
| sync | `globalToken/globalEndpoint/globalConfigEndpoint/globalStageBase/globalAuthContextVersion/globalTheme/globalThemeMode` | settings (§3) |
| session | `tabState:{id}` (default scope) | `{active, enabled, baseUrl, pageType}` |
| session | `tabState:{id}` (`initial` scope) | `{active, desktopPreviewEnabled, propertyLock* recovery fields}` |
| session | `tabState:{id}` (`restore` scope) | always cleared — marking never auto-restores |
| session | `deviceEmulation:{id}` | `{enabled, mode, scale}` |
| session | `popupAiRun` | persisted AI-run record `{sessionId, siteId, expiresAt, deadlineAt}` |
| session | `remote-config-*` | transfer payloads |
| session | render-mode no-JS-held flag per tab | `src/common/render-mode-js-state.ts` |
| IndexedDB | `configs` | per-baseUrl v5-shaped property config |
| IndexedDB | `backendSavedPageMarkings` | last confirmed backend page-marking snapshot per baseUrl |
| IndexedDB | `pageSaveReconciliations` | pending save reconciliation per `[baseUrl,pageUrl]` |
| IndexedDB | page-type taxonomy cache | slugs/labels |
| page sessionStorage | property-lock clientId; content inspection flag | lock identity; render-mode inspection latch |

---

## 17. Risk notes cross-referenced with known live findings

1. **Destructive /save (half-snapshot)**: §11 — Send-to-Lynx-path payloads carry only backend-saved-cached pages; an empty/stale `backendSavedPageMarkings` cache yields an empty `pageMarkings` in a 200 `/save`. `includeAllLocalPageMarkings` protects the Save Session path only. The abandoned guard commit (`e11059b1`, visible from the rewrite repo) targeted this.
2. **AI selectors never reaching config**: `applyComputedSelectorSet` bumps `selectorsUpdatedAt` only when `selectorsChanged` (`src/popup.ts:8400-8410`); freshness is further gated by `isSelectorSetCurrentForRenderMode` — a render-mode timestamp newer than the selector timestamp silently discards the set from every "current selectors" read (`config.ts:745-767,867-901`), so a save can persist stale/empty selectors while the UI showed a completed run.
3. **Un-bootstrappable property after record deletion**: the not-found path clears local data and fences the site's load cache (`remote-config.ts:267-292`; `page-data-lifecycle.ts:349-390`); re-creation depends on a fresh confirmed render mode + a successful save; a property stuck with only one of the two render-mode inspections completed cannot confirm (Set requires a chosen mode; chooser requires confidence from inspections) — matches the live QA re-bootstrap finding.
4. **Property lock**: entire subsystem present but compiled off; any rewrite parity decision must know production users currently have *no* lock protection despite README/PROPERTY_LOCK.md describing it as a feature.
