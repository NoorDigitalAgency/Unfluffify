# UX Bring-Over Catalog — legacy Unfluffify → `re-write`

**Purpose.** The complete, prioritized inventory of legacy visual design, interaction, copy, timing
and flow that must be ported to the rewrite, with the rewrite's current status for each item and a
porting note that respects the reflex-arc doctrine.

**Trees.**
- LEGACY: `/tmp/claude-1000/-home-rojan-Documents-Git-GitHub-Unfluffify/b1655411-e6e6-4a07-9e06-63a92fc1f3e8/scratchpad/legacy-main` (branch `main`, v1.10.0+3). Citations prefixed `legacy:` are relative to that tree's `src/` unless another root is shown.
- REWRITE: `/home/rojan/Documents/Git/GitHub/Unfluffify` (branch `re-write`). Unprefixed citations are relative to that tree.

**Sources digested in full:** `legacy-popup-ux.md`, `legacy-content-ux.md`, `legacy-feature-flows.md`,
`legacy-locked-contracts.md`, `rewrite-implementation-state.md`. Every load-bearing claim below was
re-verified against code; where I found a report claim to be incomplete or wrong it is called out
inline (see §0.4).

---

## 0. How to read this catalog

### 0.1 Status vocabulary

| Status | Meaning |
|---|---|
| **PRESENT** | Ported; behaves as legacy did (differences, if any, are cosmetic and deliberate) |
| **PARTIAL** | Something exists but the legacy behavior is materially reduced — the "what differs" column is the work |
| **ABSENT** | Nothing in the rewrite does this |
| **ASSET-ONLY** | The file/CSS/artwork already ships in the rewrite tree but no code references it — porting is wiring, not authoring |
| **DARK** | Legacy shipped it behind a production-off feature flag; parity means *build it and ship it dark*, not skip it |

### 0.2 Priority vocabulary

| Prio | Rule |
|---|---|
| **P0** | The operator loop cannot close, or the surface actively misinforms |
| **P1** | The visual language that tells an editor *what they marked* — getting this wrong changes the data they produce |
| **P2** | Established parity/polish: feedback, affordances, copy, shortcuts |
| **P3** | Legacy-dark surfaces; build behind the same gate, ship dark |

### 0.3 Reflex-arc ownership map (where each ported thing must live)

| Organ | Files | Owns |
|---|---|---|
| **Brain** (per-tab, background) | `src/background/brain/{fold,decide,project,signals}.ts` | Which *state* is in force. Publishes **surface vocabulary only** — `{kind, phase, startedAt, deadlineAt, reason}` — never composed display copy (C-SPIN-2, legacy `KN:616`) |
| **Popup organ** | `src/popup/organ/{machine,memory}.ts`, `src/popup/store.ts`, `src/popup/App.tsx` | Every popup pixel and string. State → complete frozen presentation (`memory.ts:55-260`) |
| **Content organ** | `src/entrypoints/content-loader.content.ts`, `src/content/**` | Every in-page pixel and string. Needs its own state→presentation memory (legacy had one: `legacy:content/overlay-memory.ts:38-75`) |
| **Page world** | `src/page-world/program.js` | Motion/timer/lazy gating only — never UI |
| **Services** | `src/background/services.ts`, `src/lynx/**` | Remote I/O only, no copy |
| **Bus** | `src/messaging/realms.ts` (21 commands + 2 events) | Typed transport |

**Doctrine constraint that the bring-over must not violate, and currently does:** the rewrite
already ships **composed display strings across the layer boundary** — `lock-runtime.ts:77` sends
`curtain: { visible, text: "Property locked" }`, and the popup echoes composed copy back into the
content directive (`main.tsx:696-698,785`). Legacy deleted exactly this shortcut
(`deriveDictation`/`phaseToSpinnerState` deleted, `session.dictation` reduced to a phase pointer —
`KN:616`). **Every curtain/banner/toast item in this catalog must be ported as a reason/phase code
plus a per-layer copy table, not by extending the `text` field.** Fixing the existing three sites is
a prerequisite, not a follow-up (§E.1).

### 0.4 Corrections to the input reports

| Report claim | Correction (verified) |
|---|---|
| `rewrite-implementation-state.md` §6.2: "Theming STUBBED — the full 16-theme catalog CSS is present" | Understated. **`theme-color.css`, `theme-components.css` and `theme-utilities.css` are byte-identical to legacy** (`diff -q` clean, 265 / 2289 / 400 lines), `fonts.css` is byte-identical, the MDI webfont + CSS ship and are imported (`main.tsx:1-6`), and the import order matches legacy exactly. The *entire legacy component stylesheet* — `#toast`, `.warning-popover`, `.lynx-checklist-popover__*`, `.todo-*`, `.page-types__empty`, `.section-menu`, `.close-button`, `.preview-sidebar__*`, `.header-logo` — is already in the tree at `src/theme-components.css`. Almost every "ABSENT" surface below is markup-and-wiring work, not design work. |
| Same, §4.2 row 1: "no logo image" | `src/public/logo.png` ships and `.header-logo` CSS exists (`theme-components.css:510-514`); it is ASSET-ONLY, not missing. |
| Same, §6.1: "Confirm dialogs PARTIAL — exactly one" | Correct, but a plain `grep 'confirm('` misses it: the call is `confirmFn.call(window, …)` at `main.tsx:1156`. |
| Same, §5: "Custom cursors ABSENT — the SVGs ship and are web-accessible" | Confirmed, and `wxt.config.ts:71-79` still declares `cursors/*.svg` as web-accessible resources — the manifest is already prepared for the port. |
| — (not in any report) | **`src/popup.css:145,167,195,196` references `--surface`, `--surface-2`, `--ink-soft`, which no theme defines** (`theme-color.css` defines 30 tokens; none of those three). Inherited verbatim from legacy, where the panel was flag-off and invisible. The rewrite promoted that panel to the always-visible Activity log (`App.tsx:1138-1163`), so the bug is now user-visible. See §A.5. |

---

## 1. Executive summary

The rewrite carries **the legacy design system intact but unapplied**, and **the legacy interaction
language almost not at all**.

- **Design tokens/CSS/fonts/icons: PRESENT and byte-identical.** The only drift is (a) nothing
  stamps `data-theme`, so the panel renders on the `:root` indigo fallback instead of legacy's
  forced `nordic`; (b) three undefined tokens in the Activity-log panel; (c) a deliberate 460 px
  width cap on `.app`; (d) different MDI glyph choices for ~12 controls.
- **Popup: structurally parallel, surface-reduced.** Five views resolve from one pure function and a
  12-state machine with a frozen presentation matrix — a faithful re-encoding of legacy's
  `MARKING_SESSION_SURFACE_MEMORY`. Missing: the Todo list, the Lynx checklist modal, the preview
  sidebar, all header menus, all toasts, 7 of 8 confirm dialogs, per-field endpoint editing, the
  spinner-phase contract, the property-URL notice ladder, all lock collaboration buttons.
- **In-page: the marking overlay is a different visual language.** 5 flat inline styles vs legacy's
  16-class grammar; explicit include is **blue** where legacy was dark green; hover is **cyan** where
  legacy was amber (and cyan was legacy's *focus* colour); one box per bounding rect instead of one
  per client rect; no cursors, no ack pulse, no ghosts, no scroll-hide, no marching AI dashes, no
  candy-stripe immutables. Nothing in-page narrates: no toasts, no inspection card, no freeze
  indicator pill, no lock banner, and the curtain does not block input.
- **Rituals: bookkeeping right, effect missing.** Consent hiding is PRESENT and better than legacy.
  The reveal walk is synchronous and therefore inert (`reveal.ts:21-31`). The freeze machinery is
  real but invisible to the user.
- **Flows: the second half of the product is absent.** Send to Lynx, the page-type Todo list and the
  checklist gate have builders and tests but no callers — the operator can mark and save but cannot
  publish.

**Biggest leverage:** because the stylesheet is already legacy's, porting the Todo card, the
checklist modal, the preview sidebar, toasts and the header menus is markup + state wiring against
CSS that already exists and was already designed.

### 1.1 Prioritized backlog (the order I would do it in)

| # | Work item | Prio | Surface | §|
|---|---|---|---|---|
| 1 | Stamp `data-theme="nordic"` / `data-theme-mode="system"` + `colorScheme` on `<html>` | P0 (1-line) | tokens | A.2 |
| 2 | Fix the three undefined tokens in the Activity-log panel | P1 (trivial) | tokens | A.5 |
| 3 | Replace composed `curtain.text` on the wire with `{kind, phase, reason}` + per-layer copy tables | P0 (doctrine) | rituals | E.1 |
| 4 | Marking overlay grammar: per-client-rect boxes, legacy class/colour catalog, ghosts, ack pulse, scroll-hide | P1 | in-page | D.2–D.5 |
| 5 | Custom cursors + cursor state machine | P1 | in-page | D.6 |
| 6 | In-page narration organ: toasts, inspection card, freeze pill, marking-paused notice, blocking input capture | P1 | in-page/rituals | D.9, E.2–E.5 |
| 7 | Make the reveal walk actually walk (awaits, settle sampling, freeze at absolute bottom) | P1 | rituals | E.2 |
| 8 | Preview: page-side focus/flash/copy + popup "Detected Content" sidebar + Exit | P0 | flows | C.6, F.3 |
| 9 | Todo list card (page-type coverage) | P0 | popup | C.7 |
| 10 | Lynx checklist modal + cssInfo fail-closed gate + Send to Lynx publish | P0 | flows | C.8, F.4 |
| 11 | Toast surface + the ~40-string copy table | P2 | popup | C.9 |
| 12 | Confirm-dialog set (7 missing) | P2 | popup | C.10 |
| 13 | Spinner-phase contract (33 phases) + curtain timers | P2 | rituals | E.1 |
| 14 | Silent highlighting without an open popup + tooltips + click-to-copy | P1 | in-page | D.10 |
| 15 | Per-field endpoint Set/Change/Cancel + notices; login copy parity | P2 | popup | C.2 |
| 16 | Action-icon per-tab states | P2 | chrome | G.1 |
| 17 | Hotkeys (page Ctrl/Cmd+E, Ctrl/Cmd+M; popup Ctrl/Cmd+E/S/M, Escape) | P2 | chrome | G.2 |
| 18 | Header menus (kebab/config, todo controls) | P2 | popup | C.11 |
| 19 | Property-lock collaboration UI (popup strip actions + in-page banner) | P3 | flows | F.5 |
| 20 | Dark surfaces: desktop preview card, appearance/theme picker, diagnostics trace, cache/unregister tools, preview expanded states, page-type change detection | P3 | popup | C.12 |
| 21 | Logo in header | P2 | popup | C.1 |
| 22 | AI-run resume after panel reopen | P2 | flows | F.1 |
| 23 | React render-crash self-healing + `body.is-busy` scroll lock | P2 | popup | B.6 |

---

## A. Design tokens, typography, iconography

### A.1 What is byte-identical (verified by `diff -q`)

| Asset | Rewrite path | Legacy path | Status |
|---|---|---|---|
| Colour tokens + 16-theme catalog (265 lines) | `src/theme-color.css` | `legacy:theme-color.css` | **PRESENT, identical** |
| All component styles (2289 lines) | `src/theme-components.css` | `legacy:theme-components.css` | **PRESENT, identical** |
| Utility classes (400 lines) | `src/theme-utilities.css` | `legacy:theme-utilities.css` | **PRESENT, identical** |
| Self-hosted fonts (Inter 400/500/600/700 + JetBrains Mono 400/500, `font-display: swap`) | `src/public/assets/fonts/` | same | **PRESENT, identical** |
| Material Design Icons webfont + CSS | `src/public/assets/materialdesignicons{.min.css,-webfont.woff2}` | same | **PRESENT** |
| CSS import order (fonts → color → components → popup → utilities → mdi) | `main.tsx:1-6` | `legacy:entrypoints/popup/main.ts` | **PRESENT, same order** — utilities last so they can override components (`theme-utilities.css:1`) |

Base tokens (`theme-color.css:1-20`): `--bg #f8f9fc`, `--bg-accent #f0f2f7`, `--card #ffffff`,
`--ink-base #1a1d26`, `--muted-base #6b7280`, `--line-base #e5e7eb`, `--accent #4f46e5`,
`--accent-dark #3730a3`, `--accent-light #eef2ff`, `--success light-dark(#366342,#80d090)`,
`--danger light-dark(#a33d3d,#ff8080)`, `--warn light-dark(#936d0b,#ffc66e)`, `--warn-ink`,
`--radius 8px`, `--radius-lg 12px`; derived `--ink/--muted/--line/--focus-ring/--focus-ring-soft/
--shadow{,-1,-2,-md}/--control-border` at `:233-265`. All present.

### A.2 Theme application — **the one real token defect**

| Element | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Theme stamp | `data-theme` + `data-theme-mode` on `<html>`, `style.colorScheme = "light dark"\|"light"\|"dark"`; default **`nordic` / `system`**, forced in production because `appearanceCustomization` is off (`legacy:popup.ts:775-776,2369-2391`) | **ABSENT** — `grep data-theme src/**/*.ts*` → 0 hits. The panel renders the `:root` indigo fallback, i.e. **a different accent colour from production Unfluffify** | Popup organ, at boot before first render (`main.tsx` init). One statement; no signal needed. Persisting a user choice is §C.12. **P0 because it is a one-line fix for a visible brand mismatch.** |

Nordic overrides light accent `#3e7d9f` / dark accent `#8fc6dd` (`theme-color.css:181-192`); the
indigo fallback (`#4f46e5`) is what the rewrite shows today.

### A.3 Typography in practice (both trees, from the identical stylesheet)

Body 13px Inter (`theme-components.css:16-17`); mono for readouts, section-menu labels (11px), list
URLs (11px), preview index numbers (11px), trace output (10.5px). Scale: 10/11/12/13/14px. Weights
400 body, 500 buttons/menu items, 600 section titles/labels/badges, 700 lock status, curtain title,
"current" badges. **PRESENT** — the rewrite's markup uses `section-title`, `hint`, `control-label`,
`row-label`, `u-font-mono`, `readout`, `status`, so it inherits all of it.

### A.4 Iconography drift (all glyphs available; choices differ)

| Control | Legacy glyph | Rewrite glyph | Note |
|---|---|---|---|
| Header brand | `img.header-logo` 110px, `alt="Unfluffify"` (`legacy:ui.tsx:1609`, `theme-components.css:510-514`) | `mdi-broom` + text "Unfluffify" (`App.tsx:437-438`) | ASSET-ONLY: `src/public/logo.png` ships |
| Run AI | `auto-fix` | `mdi-robot` (`App.tsx:631`) | |
| Save | `content-save` | `mdi-content-save` (`App.tsx:642`) | match |
| Discard | `restore` | `mdi-undo` (`App.tsx:654`) | |
| Content list | `eye-outline` | `mdi-format-list-bulleted` (`App.tsx:666`) | |
| Enable Marking row | `pencil-box-outline` | `mdi-pencil-ruler` (`App.tsx:562`) | |
| Config entry | `dots-vertical` kebab → menu → `tune` | `mdi-cog` direct button (`App.tsx:471`) | menu removed, §C.11 |
| Back | `arrow-left` | `mdi-arrow-left` (`App.tsx:459`) | match |
| Property URL | `home-outline` + label "Property URL" | `mdi-link-variant` + label "Page" (`App.tsx:477-478`) | **semantic drift: legacy showed the property base URL, rewrite shows the page URL** (§B.4) |
| Render mode values | `language-html5` / `language-javascript` / `monitor-dashboard` | same three (`App.tsx:219-224`) | match |
| Send to Lynx | `cloud-upload-outline` | — | absent |
| Todo list | `format-list-checks`, `progress-check`, `progress-helper`, `unfold-more/less-horizontal` | — | absent |
| Preview exit | `exit-to-app` | — | absent |

**Porting note.** Icon choice is popup-organ-local presentation. Recommend adopting the legacy
glyphs wholesale where a legacy control is being restored (editors have muscle memory for
`auto-fix` = "the AI button"), and flagging the three rewrite-only controls (Refresh, Status card,
Activity) as free choices.

### A.5 Undefined tokens — Activity-log panel renders unstyled (**P1, new finding**)

`src/popup.css:142-200` styles `.trace-events-panel*` with `var(--surface-2)`, `var(--ink-soft)`,
`var(--surface)` — **none of which `theme-color.css` defines**. Inherited verbatim from
`legacy:popup.css:84-141`, where the panel only rendered behind the off-by-default
`traceDiagnostics` flag, so nobody saw it. The rewrite renders the same block **always**
(`App.tsx:1138-1163`), so the panel background/label colour silently drop to nothing.

**Porting note:** popup organ, CSS only. Map `--surface → var(--card)`, `--surface-2 →
var(--bg-accent)`, `--ink-soft → var(--muted)`. Fix in both trees' spirit at once — or, if the
Activity log is kept (§OQ-2), give it a proper token set.

### A.6 Layout drift (deliberate, worth a decision)

| Item | Legacy | Rewrite | Note |
|---|---|---|---|
| Panel width | fluid, `min-width: 320px` (`theme-components.css:12`), user-draggable side panel | `.app { width:100%; max-width:460px; margin-inline:auto }` (`popup.css:13-22`), justified in-comment by the QA flow opening `popup.html` as a full tab | **Deliberate-change candidate:** in the real side panel a user who widens the panel gets 460 px of content centred in dead space. Legacy let the column grow. → **OQ-9** |
| `body.is-busy { overflow:hidden }` | set whenever the curtain is up (`legacy:ui.tsx:884-915`) | CSS rule present (`popup.css:9-11`), **nothing ever sets the class** | Popup organ: set it from `presentation.curtainVisible`. |

---

## B. Popup shell & chrome

| # | Element | Legacy behavior | Rewrite status | Porting note |
|---|---|---|---|---|
| B.1 | **Surface is a side panel, not a bubble** | `action` has no `default_popup`; `action.onClicked` binds `popup.html` to the tab's side panel (`legacy:background.ts:4285-4294`; `legacy:wxt.config.ts:7-9,24-26`) | **PRESENT** — `wxt.config.ts:26-27,52-57` (`SOURCE_ACTION` re-asserted by a `build:manifestGenerated` hook), `background/index.ts:32-43,355-361` | — |
| B.2 | **Panel survives tab switches** | subscribes `tabs.onActivated`, re-binds to the new tab, clears the old tab's transient spinner leases, resets projected state, reconnects the bus, quiet refresh — **explicitly no "Refreshing…" curtain on switch** (`legacy:popup.ts:9699-9754`) | **PARTIAL** — a 500 ms `tabs.query({active:true})` poll re-binds (`main.tsx:294-298,482-487`); ≤500 ms lag, no lease clearing | Popup organ. Keep the poll if it is simpler, but add the *rebind protocol*: drop stale leases, reset the signal cursor, and suppress any curtain the rebind itself causes. |
| B.3 | **Panel survives navigation of the inspected tab** | `tabs.onUpdated` listener: clears remote-config cache per navigation, raises the navigation-inspection overlay when marking (or a post-Set reload) is expected and clears it on the content `inspectionSettled` push, signals `navigated` on a real (non-hash) URL change (`legacy:popup.ts:9756-9833,4489-4518`) | **PARTIAL** — `session.navigated` is emitted by the content SPA watcher (`content-loader:641-687`); the popup has no navigation-specific overlay or cache reset | Content organ already births the signal correctly (provenance at source — good). The **navigation-inspection curtain** must come back as a brain-projected phase, cleared deterministically by an `inspection.ended` signal, with a bounded fail-open (legacy 15 s, `legacy:popup.ts:2213-2214`). |
| B.4 | **Header property-URL row** | Read-only ellipsized text of the **property base URL** with `title` = full value, placeholder "Property not found"; below it `#base-url-notice` (u-alert-warn) driven by a 4-level priority ladder (§30.4: config-retry → site-blocked → off-tab → "Property will be detected automatically") (`legacy:ui.tsx:1697-1711`, `legacy:popup.ts:6079-6087,5092-5104`) | **PARTIAL** — shows the **page** URL (`App.tsx:475-483`), no notice ladder | Popup organ. Show base URL (the property identity is what the operator needs); keep page URL in the Status card. Restore the notice ladder as reason codes from the brain's property-resolution facts. |
| B.5 | **Header actions** | kebab `#config-toggle` (title "Configuration") → `#config-menu`; in Configuration view replaced by `#config-header-back` (`arrow-left`, "Back"), disabled while setup incomplete (`legacy:ui.tsx:1614-1688`) | **PARTIAL** — direct gear `#config-header-open` / back `#config-header-back`, back disabled until `configurationComplete` (`App.tsx:449-473`) | The back-button gating is a faithful port. The kebab menu is §C.11. |
| B.6 | **Render-crash self-healing** | `createRoot` with `onCaughtError`/`onUncaughtError` that unmount + remount the whole app; DOM-level fallback keeps the curtain and `body.is-busy` in sync if React dies mid-render (`legacy:ui.tsx:2481-2514,884-915,2668-2690`) | **ABSENT** — plain `createRoot(rootElement)` (`main.tsx:52`) | Popup organ. Cheap and load-bearing: a side panel that white-screens has no reload affordance. |
| B.7 | **Loading view** | `#popup-loading-view`, `role=status aria-live=polite`, 16px accent spinner + `busyMessage` or **"Loading popup..."**; header shows logo only (`legacy:ui.tsx:1569-1576,1588-1605`) | **PRESENT (copy drift)** — same classes, title `presentation.curtainText \|\| "Starting Unfluffify"`, no `aria-live` (`App.tsx:421-430`) | Add `aria-live="polite"`; decide the copy (**OQ-8**). |
| B.8 | **Debug affordances** | `?debugTabId=<id>` honoured in any build; `?directMode=1` **only in a debug build** (`__UF_DEBUG_BUILD__`); `window.__UNFLUFFIFY_POPUP_DEBUG__` with `getViewState/directModeActive/activateDirectMode`; `localStorage.ufDebugSpinnerQueue` tracing (`legacy:popup.ts:514-549,531-549,1323-1347`) | **PARTIAL** — `debugTabId` honoured (production too), `__UNFLUFFIFY_POPUP_DEBUG__.getViewState()` always on (`main.tsx:274-278,1729-1755`); **`directMode` ABSENT**; `__UF_DEBUG_BUILD__` declared (`wxt.config.ts:41`) but referenced by no code | Direct mode is the only way to exercise marking on an unconfigured page — the live-QA harness depends on it (`KN:60-76`). Restore it behind `__UF_DEBUG_BUILD__`, scope to marking/enumeration/overlay only (save + AI stay gated). |

---

## C. Popup views, components and copy

### C.1 View model

| Legacy | Rewrite |
|---|---|
| 3 top-level views (`Loading`, `Configuration`, `Marking`) + 2 overlay surfaces (preview sidebar, curtain) + 1 modal (checklist). Intra-Marking posture derived from `renderModeSectionVisible`/`mainUiHidden`/`silentModeActive` (`legacy:ui.tsx:42-46`, `legacy:popup.ts:5836-5847,5881-5926`) | 5 views (`loading \| configuration \| render-mode \| marking \| silent`) resolved by one pure function (`view.ts:13,60-76`), i.e. legacy's intra-Marking postures promoted to first-class views. `configurationComplete` = 3 endpoints + token + token-not-rejected (`main.tsx:185-192`) — same predicate as `legacy:popup.ts:5633-5637` |

**Verdict: PRESENT and arguably better.** The promotion is a deliberate improvement; it removes the
visibility-algebra table legacy needed. Keep it. The missing pieces are the two *overlay* surfaces
(preview sidebar, checklist modal) which must **not** become views — legacy's preview replaced the
main view area while keeping the header (`legacy:ui.tsx:1581,1724-1727`), and the checklist was a
modal scrim inside Marking.

**Header brand:** legacy's 110 px logo at 0.9 opacity is ASSET-ONLY in the rewrite (§A.4). **P2.**

### C.2 View: Configuration

| Element | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Card 1 "Endpoints" (`api` icon) + hint **"Set endpoints, login credentials, and sign in to continue."** (`legacy:text.ts:450`) | 3 fields, each = label + input + `Set` (icon `check`) while editing + `Change`/`Cancel` toggle (icon `pencil`/`close`) once set + a per-field u-alert-warn notice; a field with no stored value is **permanently in edit mode**; once set the input goes `readonly` (grey `--bg-accent`); Enter submits (`legacy:ui.tsx:2267-2339`, `legacy:popup.ts:4210-4243,7143-7165`) | **PARTIAL** — one `<details>` "Connection" panel, 3 always-editable text inputs, **one** `Save connection` button gated on `loaded ∧ dirty`, one status line (`App.tsx:963-1002`) | Popup organ. The per-field pattern is not decoration: it makes "which of the three is missing" visible at a glance, and the read-only latch prevents an accidental endpoint edit from silently clearing the token. Port the three field rows + per-field notices; keep one Save if preferred (**OQ-10**). |
| Field labels/placeholders/notices | "Configuration Endpoint"/`https://example.com`/"Set Configuration Endpoint before continuing"; "AI Endpoint"/…/"Set Endpoint before using AI"; "Stage Base"/`noorlynx.com`/"Set Stage Base before signing in" (`legacy:text.ts:466-486`) | "Config endpoint"/`https://config.example.com`; "AI endpoint"/`https://ai.example.com`; "Stage base host"/`stage.example.com` (`App.tsx:207-209`) | Copy drift only; adopt legacy strings. |
| Set-time validation toasts | "Enter a Configuration Endpoint" / "Enter a valid Configuration Endpoint" / **"Configuration endpoint changed. Login required."**; same triad for AI endpoint; "Enter a valid Stage Base" / "Stage Base changed. Login required" (`legacy:popup.ts:8017-8092`) | **ABSENT** — and, per `rewrite-implementation-state.md` §6.1, **endpoint changes do not clear the token** | **Two items:** (a) the token-clearing behavior is a *correctness* port (services layer, `settings.save`), (b) the toasts are §C.9. |
| Configuration notice | u-alert-warn **"Provide Configuration Endpoint, AI Endpoint, Stage Base, then login to continue."**, or **"Problem connecting to the configuration server. Retrying..."** (`legacy:text.ts:451-452`) | **PARTIAL** — a 4-way `data-setup-required` alert (`unreadable`/`unconfigured`/`signed_out`/`unreachable`) with distinct copy (`App.tsx:530-544`) — a rewrite-only affordance that is **better** than legacy's single string | Keep the rewrite's discrimination; add the config-server-retry case. |
| Card 2 "Authentication" (`account-key-outline`) | Email (`type=email`, `name@example.com`), Password (`password`), `.token-row` = `#token-status` left + `#login-action` "Login" right; status **"Token saved"** (success) / **"Login required"** (warning); credentials disabled unless Stage Base set; Login disabled unless email matches `EMAIL_REGEX` ∧ password non-empty (`legacy:ui.tsx`, `legacy:popup.ts:6024-6034`, `legacy:text.ts:495-496`) | **PRESENT+** — "Sign in" section with the same gating (`canLogin` requires `settingsLoaded ∧ stageBaseSet ∧ !busy ∧ email ∧ password`, `App.tsx:403-408`), Enter submits (`:1081-1085`), **plus** signed-in-only `Check token` + `Sign out` (rewrite-only, keep) | Adopt legacy's status copy; the token value is never displayed in either tree (correct). |
| Card 3 "Extras" (collapsible) | Renders only if `appearanceCustomization ∨ traceDiagnostics` — **both false in prod, so the card does not exist** (`legacy:ui.tsx:2151-2232`) | **ABSENT** | **DARK/P3** — §C.12. |
| Continue | legacy returned via `maybeSwitchToMarkingView` after each successful Set | **PRESENT+** — explicit `#configuration-continue` gated on `configurationComplete` (`App.tsx:1124-1132`) with copy "Ready to mark." / "An endpoint or the sign-in is still missing." | Keep; also auto-return after a successful login as legacy did. |

### C.3 View: Marking (and Silent)

Legacy card order (`legacy:ui.tsx:1969-2107`): **1** Render Mode (only while required-and-unset or
editing) → **2** Todo List (`siteIdReady ∧ renderModeReady`) → **3** Enable Marking → **4** merged
controls (marking mode: AI notice + Run AI + [Show Content List] + divider + [session notice] +
Save/Discard + status line; silent mode: Show Content List + divider + Send to Lynx) → **5** checklist
modal (always mounted, hidden).

| Element | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Card ordering | as above | **PARTIAL** — session-controls card, then a rewrite-only "Status" card, then Marked rows (marking) / AI selectors (silent), then Activity log (`App.tsx:546-945,1138`) | Popup organ, presentational only. Restore legacy order once Todo returns; decide the Status/Activity cards (**OQ-2**). |
| Enable Marking row | icon + label "Enable Marking", checkbox `#toggle-enabled`, row `title` tooltip **"CTRL/CMD+E"** (`legacy:text.ts:202,208`) | **PRESENT (no tooltip)** — `App.tsx:560-575`; disabled on lock block or unset render mode | Add the tooltip once the hotkey exists (§G.2). |
| Run AI button | full-width primary `#compute`, icon `auto-fix`, label **"Run AI content detection"** idle / **"AI is working..."** busy, `.loading:disabled { cursor: progress }` (`legacy:text.ts:12-13`) | **PARTIAL** — `#compute`, label "Run AI", no busy label, sits in a 4-up `.button-row` (`App.tsx:624-633`) | Restore full-width primary + both labels. The busy label matters: legacy's curtain covers the popup, but the button state is what survives a curtain race. |
| `#ai-dirty-notice` | u-alert-warn above Run AI: **"Run AI before you can save"** or the reconciliation status (`legacy:popup.ts:6074-6077`) | **PARTIAL** — the same fact surfaces only as `data-blocked-reason="requires-ai-run"` on the disabled Save button + a generic `Blocked: {reason}` hint (`App.tsx:687-691`) | Popup organ: the memory matrix already carries `saveBlockedReason` (`memory.ts:153`); render it as the legacy notice, not a raw code. **Raw reason codes must never reach the user** — that is the single most visible "tester cockpit" tell. |
| Save / Discard | `.button-row` 2-col: `#page-save` primary icon `content-save` **"Save Session"**; `#page-revert` secondary icon `restore` **"Discard"**; below, `#page-draft-status` tone-coloured status line (§30.1) (`legacy:ui.tsx:2010-2036`) | **PARTIAL** — "Save" / "Discard" (danger-styled) in a 4-up row, **no status line** (`App.tsx:634-656`) | Restore labels + the 7-row status-line table (§C.13). Discard as `u-btn-danger` is a rewrite change; legacy used secondary — Discard is recoverable-by-re-marking, not destructive-by-surprise. Minor; recommend secondary. |
| Session notice | u-alert-warn **"Run AI content detection before saving or exiting marking."** (`legacy:page-save-state.ts:86-90`) | ABSENT | with the status line. |
| Show Content List | `#marking-preview` secondary full-width, icon `eye-outline`, label **"Show Content List"**, rendered only when `markingPreviewVisible` (true in `post_ai_clean`) (`legacy:ui.tsx:1993-2008`) | **PARTIAL/VESTIGIAL** — "Content list" button always rendered in marking view, disabled per matrix; clicking it is a one-way door (§F.3) | §F.3. |
| Silent mode controls | `#preview-latest` secondary full-width **"Show Content List"**, divider, `#save-excludes` primary full-width icon `cloud-upload-outline` **"Send to Lynx"** / **"Sending to Lynx..."** (`legacy:ui.tsx:2234-2265`, `legacy:text.ts:14-15`) | **ABSENT** — silent view shows an AI-selectors list + the hint "The stored selectors are applied to the page. Enable marking to make changes." (`App.tsx:672-676,915-945`) | **P0.** Send to Lynx is the silent-surface action (contract C-POP-3: *"Send to Lynx remains silent-highlighting-only"* — hidden, disabled and handler-guarded while marking is active). §F.4. |
| AI selectors list | legacy had **no** such list in the popup | rewrite-only (`App.tsx:915-945`) | Keep — it is genuinely useful and costs nothing. |
| Marked rows list | legacy had explicit exclude/include list *handlers* but **no JSX** (vestigial, `legacy:popup.ts:7371-7447`) | **PARTIAL, rewrite-only** — read-only `aria-disabled` list of index + classification + xpath (`App.tsx:875-910`); **`contentRows` only ever carries `included`/`excluded`**, so the `Immutable`/`Closed shadow` labels (`App.tsx:188-200`) are unreachable | Either wire click-to-focus (which is what makes such a list worth having, cf. the preview sidebar) or drop it. **OQ-2.** |
| Run countdown | curtain-only in legacy (`M:SS`, §E.1) | **PRESENT+** — also a `<time data-run-countdown>` in the card header (`App.tsx:553-557`) | Harmless addition; keep. |
| Visibility algebra | `pageScopedUiDisabled = unsupportedByGraphql ∨ !tabInScope ∨ remoteConfigRetryBlocked ∨ propertyLockBlocking`; `mainUiHidden`, `todoListVisible`, `cssSelectorsVisible` (`legacy:popup.ts:5881-5926`) | **PARTIAL** — `mainUiHidden` in the matrix; off-tab / out-of-scope / GraphQL-unsupported have no popup posture | Brain: these are facts, not views. Fold them into the projection and let the popup memory turn them into the header notice ladder (§B.4). |

### C.4 View: Render mode

| Element | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Container | a **card inside Marking**, visible only while `renderModeRequired ∧ (!renderModeSet ∨ editMode)` (`legacy:popup.ts:5988-5990`) | a **first-class view** (`view.ts`) | Deliberate improvement; keep. |
| 3-step wizard with numbered accent chips (18×18) | Step 1 **"Inspect the page"**; step 2 **"What did you observe?"**; step 3 **"Render mode"** (`legacy:ui.tsx:1152-1285`) | **PARTIAL** — steps 1 and 2 exist with `render-mode-step`/`render-mode-step-index` classes (`App.tsx:764-842`); step 3 (the read-only pill + Set/Change) is merged into the header + a button row | The step-3 pill (`render-mode-selected-value`, accent-tinted, `theme-components.css:879-904`) **is** rendered in the rewrite header (`App.tsx:748-761`) — good. Add the step-3 numbering back for the wizard rhythm, or accept the merge (cosmetic). |
| Step-1 buttons | `#render-mode-inspect-without-javascript` **"Without JavaScript"** / `#render-mode-inspect-with-javascript` **"With JavaScript"**, 2-col secondary; **they alternate** — only the one that changes state is enabled, from the session no-JS-held key (`legacy:popup.ts:5960-5973,4521-4525`) | **PARTIAL** — `#render-mode-with-js` / `#render-mode-without-js`, both always enabled (except busy/lock), the *current* one styled primary (`App.tsx:774-797`) | The rewrite's "current one is primary" is a legitimate re-design of the same information. Keep, but disable the no-op button so a double-click cannot cost a reload. |
| Step-1 copy | (per-step label only) | **PRESENT+** — "Load the page each way and compare them. Whichever view carries the content the crawler needs is the mode to pick." + a narration line "Showing the page with JavaScript disabled. Load it back with JavaScript when you are done." (`App.tsx:250-254,767-770`) | Better than legacy. Keep. |
| Step-2 radios | boxed options with accent highlight: **"Meaningful content the same in both"** (`static`) / **"Meaningful content only with JavaScript"** (`rendered`), + a hidden disabled `undetermined` radio (`legacy:ui.tsx:1190-1227`) | **PARTIAL** — "Rendered (JavaScript on)" / "Static (JavaScript off)" (`App.tsx:212-215,821-841`), no `undetermined` sentinel; the in-code comment explains the hidden-radio class was deliberately not used (keyboard reachability) | **Legacy's copy is better and should win:** it names *what the operator observed*, not the internal enum. The rewrite's labels describe the mechanism; the legacy labels describe the evidence. Port the strings, keep the visible-radio fix. |
| Set / Cancel | `#render-mode-set` **"Set"** (icon `check`, disabled when undetermined) + `#render-mode-edit` **"Change"**/**"Cancel"** (`legacy:ui.tsx:1229-1282`) | **PRESENT** — `#render-mode-set` "Confirm render mode"/"Set render mode", `#render-mode-cancel` only once a mode exists (`App.tsx:846-871`) | Pick-vs-commit separation is faithfully ported. |
| Provenance badge | — | **PRESENT, rewrite-only** — "not saved yet" when the mode is local-only (`App.tsx:756-760`) | Keep; it closes a real legacy ambiguity. |
| Notice ladder | 8 prioritized u-alert-warn strings: off-tab / unmapped / unresolved site / detecting / auto-detect failed / low confidence / **"Confirm Render Mode before continuing"** / **"Set Render Mode to continue"** (`legacy:popup.ts:5611-5631`) | **PARTIAL** — 2 states: "Marking, Run AI and Save stay blocked until you choose." and a busy line (`App.tsx:798-818`) | Popup organ; restore the ladder from brain facts (site resolution, tab scope). The auto-detect entries stay **DARK**. |
| Debugger lifecycle | while the section is visible legacy keeps a debugger attached and hides consent banners for a clean comparison; leaving detaches + reloads (`legacy:popup.ts:6781-6818`) | **PARTIAL** — JS is always restored on exit (`main.tsx:1097-1148`); consent hiding runs unconditionally (better) | Verify the detach-on-exit path exists; the *user-visible* symptom of getting this wrong is a tab stuck without JavaScript. |
| Guard toasts | **"Confirm Render Mode before enabling marking"** / **"…before continuing"** / **"…before sending to Lynx"** (`legacy:text.ts:288-290`) | **PARTIAL** — expressed as `data-blocked-reason="render-mode-not-set"` + hint "Choose a render mode before marking." (`App.tsx:681-685,146`) | §C.9. |

### C.5 Modal: the blocking curtain — see §E.1 (it is a ritual surface, not a view).

### C.6 View: Preview sidebar ("Detected Content") — **ABSENT, P0**

Legacy (`legacy:ui.tsx:1485-1567`, styles `theme-components.css:1864-2013`, all **already in the
rewrite tree**):

| Part | Spec |
|---|---|
| Container | `.card.preview-sidebar` **replaces the main view area** while `previewBlocked ∨ previewActive`; header hides the kebab and property URL (`legacy:ui.tsx:1581,1611,1724-1727`) |
| Sticky header | blurred translucent bg + bottom border; title **"Detected Content"** (or **"Content States"** with show-all on); 24×24 dismiss button, icon `exit-to-app`, aria-label/title **"Exit Preview"**, hover → danger red |
| Hint | opening → `previewBlockedMessage` or **"Loading preview..."**; else **"Click a row or included page content to compare both sides. Exit preview to resume editing."** (`legacy:text.ts:331,334`) |
| List | one button per item: mono index `1.`, `2.`… + item text (11px, pre-wrap); `title` = element title or xpath; click → focus/scroll on the page (`requestTabFocusPreviewElement`); failure toast **"Unable to focus element"**; the active item gets the accent treatment and is auto-scrolled to centre when focus changes (`legacy:ui.tsx:2534-2552`) |
| States | loading → single row **"Loading preview..."**; empty → dashed box **"No content detected"** |
| Anti-flicker (locked contract C-BRAIN-8) | first non-empty hydration **latches**; later empty/stale snapshots keep the latched list; a settled-empty verdict needs a **3 s** confirmation window before "No content detected" renders (`legacy:popup.ts:9268-9388`, `PREVIEW_SETTLED_EMPTY_CONFIRM_MS`). Sidebar visibility is popup-owned via open-intent / suppress-reopen / restore-pending latches and is never flapped by transient probe reads |
| Categories (DARK) | `previewExpandedStates` off in prod: "Show all states" checkbox + 4 tinted item kinds — `excluded` danger, `explicit_included` accent, `implicit_included` success, `undetected` warn (`legacy:popup.css:34-83`) |

**Rewrite:** the CSS exists (`theme-components.css:1864-2013`, `popup.css:45-140` — including all four
category tints and the `--active` overlays). The markup is used for two *other* lists (Marked rows,
Activity log). No sidebar, no exit control, no page-side counterpart.

**Porting note.** Popup organ owns visibility and the item latch (C-BRAIN-8: *"Preview sidebar is
popup-owned"*). The three open paths must each set open-intent and reset the latch. Content organ
owns focus/flash/copy (§D.11). New bus commands needed: `content.previewShow`, `content.previewExit`,
`content.previewFocus`; new content→popup facts: preview items, focus-changed. Signals
`preview.opened` / `preview.exit.requested` / `preview.exited` already exist in the closed vocabulary
(`domain/schema/signals.ts:12-14`) and are already folded — **the machine is waiting for a surface.**

### C.7 Todo List card (page-type coverage) — **ABSENT, P0**

Legacy (`legacy:ui.tsx:1287-1483`; CSS `theme-components.css:1469-1706`, **already in the rewrite**):

| Part | Spec |
|---|---|
| Header | collapsible `▸` + icon `format-list-checks` + **"Todo List"**; right-aligned progress pill `x/y` — done: `progress-check` + success-green; pending: `progress-helper` + muted |
| Completion rule (locked, C-POP-4) | a page type counts complete when it has ≥1 **backend-saved** marked page — *"Todo completion must reflect persisted save results, not temporary local drafts"* (`legacy:popup.ts:5547-5552`). But the **current editor's** popup uses its local session as truth for the current page's badges (`MHL:117-124`) |
| Controls kebab | `#todo-controls-menu-toggle` (⋮, tooltip "Todo controls") → **"Expand all"** / **"Collapse all"** / checkbox **"Auto-collapse"** (default on) |
| Subsections | one bordered box per page type: `▸` + accent 13px/500 title + optional **"Current"** badge + count pill (success if >0); `--missing` warn border when 0 marked; `--current` accent border + accent-light bg |
| Candidates | done/pending indicator + link; label = pathname+search, `title` = full URL, suffix "N words"; current candidate gets the accent card + "Current" badge and is **disabled**; duplicates disabled with **"Also listed under X, Y."** |
| Navigation | clicking a candidate navigates the inspected tab via the background, guarded by the unsaved-session confirm, then auto-collapses |
| Empty state | dashed box **"Live Pages are not prepared for this site yet. Prepare them in Lynx before marking pages here."** or the fetch error or the site-blocked reason |
| Memory | expansion state per `tab\|baseUrl` context, up to **200** contexts; auto-collapse on property change (`legacy:popup.ts:4373-4453,6188-6216`) |
| Notice line (§30.3) | 6 prioritized strings — multi-page-type conflict / no-longer-a-candidate / not-a-candidate / no candidates / invalid stored pages / (DARK) candidates changed |
| C-POP-5 | label **both** the candidate row and its parent subsection "Current" so the active page stays findable when collapsed |

**Rewrite:** `buildPropertyPageTypesRequest` exists and is tested; **no caller**
(`rewrite-implementation-state.md` §6.1). No card, no candidacy gate on enabling marking.

**Porting note.** Services layer fetches `propertyPageTypes` (GraphQL) and the taxonomy; the **brain**
folds "current page candidacy" as a fact (it gates marking enable — C-LIFE/`legacy:popup.ts:7594`);
the **popup organ** renders coverage from the backend-saved snapshot. The 2-minute quiet refresh
(`legacy:popup.ts:768`) belongs to services with a `pageTypesRefreshDue` event; C-POP-6 says
periodic refreshes stay quiet and only interrupt when the candidate signature changes.

### C.8 Lynx checklist modal — **ABSENT, P0**

Legacy (`legacy:ui.tsx:1861-1967`; CSS `.warning-popover` + `.lynx-checklist-popover__*` at
`theme-components.css:906-1100`, **already in the rewrite**):

- Full-screen scrim `role=dialog aria-modal=true`, blur(2px), card `min(560px, 100vw-28px)`.
- Title **"Final check before sending to Lynx:"**; section **"Current Live Page coverage:"**; one box
  per page type with done/pending indicator; missing types get the warn box + **"Candidates:"** and up
  to **3** candidate-URL buttons that navigate the tab (closing the popover first).
- Status area: while the cssInfo check runs and coverage is complete → inline spinner + **"Checking
  Lynx selector status..."**; else one of: **"Lynx already has selectors that match the ones awaiting
  in the extension."** / **"Could not verify the Lynx selector status. Close and reopen this checklist
  to retry."** / **"Live Pages are not prepared for this site yet. Prepare them before sending to
  Lynx."** / **"Mark at least one page for: {titles}."** Plus **"Some stored pages are no longer valid
  candidates and will be ignored."**
- Actions: `#lynx-checklist-cancel` (secondary, `arrow-left`, "Cancel") + `#lynx-checklist-send`
  (primary, `send`, "Send to Lynx"). **Send is enabled only when coverage is complete AND the cssInfo
  gate returned `clear`** — fail-closed for `pending`/`match`/`error` (C-SAVE-7, architect call).
- Every popover open resets the gate to `pending` and re-checks.

**Porting note.** Popup organ renders it; services own `cssInfo`. The **fail-closed** rule is a locked
contract, not a preference: `usesUnfluffify:false` or an empty backend never blocks, but any failure
to verify does.

### C.9 Toasts — **ABSENT, P2 (large surface)**

| Legacy | Rewrite |
|---|---|
| Single `#toast` element, fixed bottom (14 px insets), `padding 10px 12px`, radius 8px, bg `color-mix(in srgb, var(--ink) 88%, transparent)`, text `var(--card)` 12px, fade+slide (opacity 0→1, translateY 8px→0, 0.2 s), `pointer-events:none`, auto-hide **1800 ms** (`theme-components.css:2015-2034`, `legacy:ui.tsx:2648-2666`) | **CSS PRESENT (`#toast` at `theme-components.css:2015-2034`), no element, no code.** Replaced by the persistent Activity log (`App.tsx:1138-1163`, `popup/event-log.ts`) |

Legacy toast inventory (≈40 strings, all in `legacy:text.ts` under `toast*` keys). Grouped:

- **Outcomes:** "Selectors computed locally — Save to sync", "Session saved", "Session discarded",
  "Submitted to server", "Login successful", "Property data updated from server", "Render mode set to
  JavaScript"/"…Static", "Domain cache cleared" (DARK), "Live Page candidates updated" (DARK).
- **Refusals (never silent):** "No changes to save", "Server sync pending", "Working...",
  "Run AI content detection before saving or exiting marking.", "Save is unavailable right now",
  "Property not found", "Current page unavailable", **"Mobile simulation must be enabled to save
  markings."**, "Turn off desktop preview before enabling marking.", "This page is not one of the
  current Live Page candidates…", "Enter a valid Property URL", "Current page is outside the Property
  URL", "Confirm Render Mode before {continuing\|enabling marking\|sending to Lynx}", "Set Endpoint URL
  first", "Login first", "Set Stage Base first", "Enter a valid email", "Enter password".
- **Failures:** "Unable to save session", "Unable to disable marking", "Unable to activate on this
  page", "Unable to focus element", "AI request timed out", "AI request failed", "AI results expired.
  Try again.", "Login expired. Please log in again.", "Login failed ({status})", "Submit response
  error", "Device emulation failed", "Unable to reload page for render mode inspection", **"Something
  went wrong and the render mode could not be confirmed. Please try again."**
- **Pre-announcements before a confirm:** "Save or discard the current session before exiting
  marking." / "Run AI, then save or discard before exiting marking." (`legacy:text.ts:440-441`).

**Porting note.** Popup organ. Build `src/popup/copy.ts`: `reason code → {toast, notice, tone}`. The
machine memory already emits the codes (`memory.ts` `saveBlockedReason: "requires-ai-run"` etc.); the
toast surface is a thin renderer over a small queue. **Do not compose these strings in the brain.**
Whether toasts replace or complement the Activity log is **OQ-2**.

Locked contract to preserve: **P25** — "Show Content List" once failed silently on a state race
between render and click; the fix was *always* surfacing `PopupText.preview.openFailed`. Every
defensive re-check must toast.

### C.10 Confirm dialogs — **PARTIAL (1 of 8), P2**

| Trigger | Legacy exact string | Rewrite |
|---|---|---|
| Discard button | "Discard the current session? Unsaved changes will be lost." (`legacy:text.ts:430`) | **ABSENT** |
| Turning Enable Marking OFF with a pending session | "Disable marking and discard the CSS selectors and markings from this session? This cannot be undone." (`legacy:text.ts:442`) | **PRESENT (reworded)** — "Turning marking off discards your unsaved markings. Continue?" (`main.tsx:1150-1157`) |
| Navigating away (todo/checklist link) with a pending session | "Leave this page and discard the CSS selectors and markings from this session? This cannot be undone." | ABSENT (no navigation affordance yet) |
| Accept lock transfer with unsaved changes | "Save your changes before transferring editing?" → if declined "Discard unsaved changes and transfer editing?" | ABSENT (P3 with the lock UI) |
| Clear domain cache (DARK) | "Clear cookies, local storage, and cached files for {hostname}?" | ABSENT |
| Unregister tab (DARK) | "Do you want to close Unfluffify and refresh the page to normal?" | ABSENT |
| Candidates changed & current page invalid (DARK) | `alert`: "Live Page candidates changed in Lynx, and this page is no longer a valid candidate. Marking has been stopped until you choose a current candidate from the Todo List." | ABSENT |
| Consent drift / newer remote data | `alert` strings defined: "Consent elements changed on this page. Save to keep the updates." / "Newer data for this page was found and replaced your local changes." | ABSENT |

**Locked timing contract (P27):** the confirm must fire **before** any slow roundtrip, and the
spinner must engage **at click** and persist behind the dialog so the press never looks dead
(`legacy:page-reconciliation.ts:107-110,214-218`). **Live-QA gotcha M4:** a lingering Playwright
`connectOverCDP` auto-dismisses `window.confirm` — dialog flows must be tested over raw CDP.

**Deliberate-change candidate:** native `window.confirm` blocks the whole panel and cannot be styled;
legacy already ships `.warning-popover` (used by the checklist). → **OQ-11.**

### C.11 Header menus — **ABSENT, P2**

| Menu | Legacy | Rewrite |
|---|---|---|
| Kebab/config menu | `#config-toggle` (title "Configuration", `aria-haspopup=menu`) → `#config-menu`: **"Open configuration view"** (`tune`); **"View or change render mode"** (`monitor-dashboard`, only when a mode is set on a valid candidate page); (DARK) divider + **"Empty cache for current domain"** (`trash-can-outline`, `.danger`). Any document click or Escape closes all menus; opening one closes the others; preview force-closes menus (`legacy:ui.tsx:1628-1688`, `legacy:popup.ts:9650-9660`) | **ABSENT** — replaced by a direct gear button + an inline "Render mode" row with a pencil (`App.tsx:463-472,600-615`) |
| Todo controls menu | §C.7 | ABSENT |
| Theme menu | §C.12 (DARK) | ABSENT |

CSS is present (`.section-menu*` `theme-components.css:224-297`, `.config-menu` `:489-508`).
**Porting note:** the rewrite's direct buttons are arguably better for a 2-item menu; the menu only
becomes necessary once the DARK items return. Recommend: keep direct buttons, build `.section-menu`
for the Todo controls where it is genuinely needed.

### C.12 DARK surfaces — build, ship dark (**P3**)

`legacy:common/feature-flags.ts:3-17` — **every flag false in the shipped build.** A faithful
re-creation implements them and ships them dark.

| Flag | Surface | Rewrite |
|---|---|---|
| `desktopPreview` | Desktop-preview card: row icon `monitor-eye`, label **"Preview in desktop mode"**, tooltip "M", checkbox `#desktop-preview-enabled`, notice **"Marking mode is disabled while desktop preview is on."**; only when in silent mode with stored selectors; toggling runs curtain "Updating page preview mode..."; 12 s emulation timeout → toast "Device emulation failed"; non-http(s) → "Device simulation is only available on http(s) pages" (`legacy:ui.tsx:1733-1763`) | **PRESENT AND LIVE** (`App.tsx:580-597`, `main.tsx:1159-1174`) — the rewrite un-darkened it. Gate decision: **OQ-12** |
| `deviceEmulationToggle` | manual mobile-simulation toggle (no JSX even in legacy) | ABSENT — fine |
| `traceDiagnostics` | Extras→Diagnostics: "Trace cross-world messaging" checkbox + "Trace events" panel (count badge + read-only 140 px mono textarea, last 20 events, `HH:MM:SS  channel / event  summary`) | The **CSS** is what the Activity log reuses (§A.5). Panel itself ABSENT |
| `renderModeAutoDetection` | `/is_js_rendered` + "Detecting Render Mode…" / "…could not detect…" / low-confidence notices | ABSENT |
| `appearanceCustomization` | Extras→Appearance: prev/next chevrons + custom `#theme-dropdown-toggle` with a 4-swatch mini palette (10×10), listbox of all 16 themes with check on selected, opens up or down by available space, ArrowUp/Down cycles live; Mode 3-button group System/Light/Dark | ABSENT (CSS present `theme-components.css:658-760`) |
| `cacheAndUnregisterTools` | Mac-style red `.close-button` (14×14 `#ff5f57`, × strokes on hover) + "Empty cache for current domain" | ABSENT (CSS present `:2189-2248`) |
| `propertyLockCollaboration` | the whole lock indicator + 18-state tone/icon/copy table + action buttons | §F.5 |
| `previewExpandedStates` | "Show all states" checkbox + 4-category colouring | ABSENT (CSS present `popup.css:91-140`) |
| `pageTypesChangeDetection` | changed-candidates notice/alert/forced-open Todo on the 2-min poll | ABSENT |
| `pageTypeAssignments` | `POST /assign_page_types` during Send to Lynx (endpoint 404s) | ABSENT — keep dark (D11) |

### C.13 Status-string master tables (must be ported verbatim)

**Session status line `#page-draft-status`** (`legacy:page-save-state.ts:72-97`) — 7 rows:

| Condition | Text | Tone |
|---|---|---|
| controls hidden | "" | success |
| reconciliation reason `sync_failed` | "Server sync failed. Save again to retry." | warning |
| `sync_skipped` | "Server sync required. Save again to retry." | warning |
| `load_failed` | "Server refresh failed. Save again to retry." | warning |
| other reconciliation | "Server sync pending" | warning |
| pending changes + needs AI | "Run AI before saving" | warning |
| pending changes | "Changes ready to save" | warning |
| clean | "No unsaved session changes" | success |

**Save-status labels** (`legacy:popup.ts:3301-3350`) — success: "Saved and synced", "Reverted and
synced", "Selectors updated and synced", "Submitted selectors", "Submitted selectors and synced";
warning: "Saved locally (sync skipped)", "Saved locally (server sync pending)", "Reverted locally
(sync skipped)", "Selectors updated locally (sync skipped)", "Submitted selectors (config sync
skipped)", "Selectors computed locally"; danger: "Save failed", "Revert failed", "Saved locally (sync
failed)", "Saved and synced (refresh failed)", "Reverted locally (sync failed)", "Selectors updated
locally (sync failed)", "Submitted selectors (config sync failed)"; muted: "No local changes to
save", "Unknown". All get `" at HH:MM"`.

**Header property-URL notice** (§B.4) and **page-type notice** (§C.7) tables as cited.

**Vestigial in legacy — do NOT rebuild** (`legacy-popup-ux.md` §29): the Server Sync panel
(`syncLoadStatusText`/`syncSaveStatusText` computed, never rendered), the Marked Pages list, the
explicit exclude/include lists, the render-mode warning popover ("How to Verify the Render Mode
Manually" + 9-step `ol`), the device-emulation scale slider. Keep the *strings* for parity where they
feed toasts; build no UI.

---

## D. In-page overlays & interactions

### D.1 Injected chrome inventory

| Legacy element | id | Rewrite |
|---|---|---|
| Marking overlay | `#unfluffify-overlay` (`legacy:core.ts:7543-7545`) | **PARTIAL** — `div.uf-marking-layer-root`, fixed inset 0, z-index 2147483647, `pointer-events:none` (`renderer.ts:51-62`) |
| Marking stylesheet | `#unfluffify-freeze-style` (`legacy:core.ts:7276-7540`, ~260 lines of `uf-*` CSS) | **ABSENT** — the rewrite styles every box with **inline styles** (`renderer.ts:42-49`) |
| Silent overlay + stylesheet | `#unfluffify-silent-highlight-overlay`, `#unfluffify-silent-highlightings-style` | **PARTIAL** — silent boxes go into layer 7 of the same root (`renderer.ts:128-147`) |
| Page-motion pause stylesheet + **indicator pill** | `#unfluffify-page-motion-pause-style`, `#unfluffify-page-motion-pause-indicator` | freeze machinery PRESENT (page world); **indicator ABSENT** |
| Page-inspection cursor style | `#unfluffify-page-inspection-style` (`cursor: progress` page-wide) | ABSENT |
| Popup-busy overlay + style | `#unfluffify-popup-busy-overlay` | **PARTIAL** — one non-blocking scrim (`content-loader:296-335`) |
| Page toast + style | `#unfluffify-page-toast` | ABSENT |
| Property-lock banner + style | `#unfluffify-lock-banner` | ABSENT (generic bottom banner only) |
| AI-preview focus style | `#unfluffify-ai-preview-focus-style` | ABSENT |
| Consent bypass style | `#uf-consent-bypass` | **PRESENT** (`consent.ts`) |
| Extension-UI tag | `data-uf-extension-ui="true"` on everything, excluded from marking, hit-testing, freeze and snapshots (`legacy:core.ts:952-961,2524-2529`) | **PRESENT** (`renderer.ts:54,65,99`; `content-loader:302`) |
| Mark correlation | `data-uf-mark-id="uf-N"` on marked elements ↔ `data-mc-mark-id`/`data-mc-mark-kind` on boxes | **PARTIAL** — `data-uf-overlay-xpath` on boxes (`renderer.ts:101`), nothing on the page element |

### D.2 Overlay geometry and layering — **PARTIAL, P1**

| Aspect | Legacy | Rewrite |
|---|---|---|
| Root | fixed inset 0, z 2147483647, **`pointer-events: auto`** (it *captures* clicks in marking mode); right/bottom inset by the live scrollbar gutter so boxes never draw over scrollbars (`legacy:core.ts:7307-7315,7995-8005`) | `pointer-events: none`; clicks are captured by document-level capture-phase listeners instead (`content-loader:543-603`); **no gutter inset** |
| Layers | **10 semantic layers**, z 2..11: hard, default, saved-explicit-exclude, saved-explicit-include, ai-content, session-explicit-exclude, session-explicit-include, focus, hover, interaction; each `.uf-layer { position:absolute; inset:0; pointer-events:none; transition: opacity .15s ease }` (`legacy:core.ts:7319-7334`) | **11 layers created, 7 used**: 2 implicit-include, 3 explicit-include, 4 exception, 5 immutable, 6 closed-shadow, 7 silent, 10 hover (`renderer.ts:33-40,126,145`). No saved-vs-session split, no focus layer, no interaction layer |
| Box granularity | **one `.uf-rect` per client rect** — multi-line inline elements get one box per line; boxes keyed `markId\|className\|kind\|rectIndex` and **reused** across renders (position patched in place); unused boxes removed at `finalizeLayerRender` (`legacy:core.ts:9846-9903,9836-9844`) | **one box per `getBoundingClientRect()`**, and the whole overlay is torn down and rebuilt every render (`renderer.ts:91,97-106`) |
| Rect sourcing | `getVisibleRects` drops zero-size / off-viewport rects then filters by **5-point paint reachability**; collapsed-text elements borrow the first visible descendant's rects; `getGhostRects` = raw rects, no filter, for hidden marks; reposition-only passes use `getRectsInViewport` (`legacy:core.ts:9959-9974,9932-9957,11462-11467`) | single `isPaintReachable(element)` gate (`renderer.ts:94`); no collapsed-text fallback, no ghost path |
| Whole-overlay states | `.uf-scrolling` → all layers `opacity:0` during **viewport** scroll (nested-container scrolls redraw without hiding), 250 ms debounce; `.uf-page-inspection-active` → layers 0 + overlay bg `rgba(16,20,28,.2)`; `.uf-marking-temporarily-disabled` → `opacity:.28; filter:grayscale(.75) saturate(.55)`, hover+interaction fully hidden (`legacy:core.ts:7335-7348,13110-13155`) | **ABSENT (all three)** |

**Why P1:** a multi-line paragraph draws as one big box in the rewrite where legacy drew one box per
line. That is not cosmetic — it changes which element the editor believes they are marking, and the
bounding-rect box overlaps siblings that are *not* marked.

**Porting note.** Content organ, `src/content/marking/renderer.ts`. Move from inline styles to an
injected stylesheet (the classes are already named in `overlay.ts:3-9`), adopt per-client-rect
drawing with keyed reuse, and add the three overlay state classes. The reuse is not premature
optimization: legacy's P14 CPU-peg and P16 "each target drawn multiple times" both came from
rebuild-everything render paths.

### D.3 Overlay class catalog — the visual language (**P1**)

| Semantics | Legacy visual | Rewrite visual |
|---|---|---|
| Hover target | `uf-hover` — **2px solid `#ffb300` amber**, bg `rgba(255,179,0,.1)` (`legacy:core.ts:7355-7358`, verified) | **2px cyan `rgba(14,165,233,.95)`**, bg `rgba(14,165,233,.12)` (`renderer.ts:121-122`) — **cyan was legacy's *focus* colour**; the two meanings are now confused |
| Preview focus | `uf-focus` — 3px `#00acc1` cyan + `box-shadow 0 0 5px 5px #00acc178` + `animation: blink 1s linear infinite` | ABSENT |
| Immutable defaults | `uf-hard-locked` — 2px dashed `rgba(225,70,70,.4)` + **red/orange 45° candy-stripe** `repeating-linear-gradient` | flat grey `rgba(107,114,128,.18)` / `1px solid rgba(75,85,99,.85)` (`renderer.ts:24-27`) |
| Implicit/default content | `uf-default` — 1px `#2e7d32` green, bg `rgba(46,125,50,.08)` | green `rgba(34,197,94,.18)` / `1px solid rgba(22,163,74,.85)` (`renderer.ts:12-15`) — closest match in the set |
| Explicit include (Alt-click) | `uf-explicit-include` — **3px solid `#1b5e20` dark green**, bg `rgba(27,94,32,.2)` | **BLUE** `rgba(59,130,246,.2)` / `1px solid rgba(37,99,235,.9)` (`renderer.ts:16-19`) — **the include/exclude colour pair is broken**: legacy said green=in, red=out, and weight (1px vs 3px) said implicit vs explicit |
| Explicit include ghost | `uf-explicit-include-ghost` — 1px dotted `rgba(27,94,32,.45)`, transparent | ABSENT |
| Explicit exclude | `uf-explicit-exclude` — 3px solid `#c62828` red, bg `rgba(198,40,40,.2)` | `exception` red `rgba(239,68,68,.2)` / 1px (`renderer.ts:20-23`) — colour close, weight lost |
| AI/CSS-selector content | `uf-ai-content` — 1px transparent border + bg `rgba(46,125,50,.08)` + **four repeating-linear-gradients forming an animated marching-dash green border** (`#35943a`, 6px dash/6px gap, 2px, `uf-ai-content-dash 2s linear infinite`) | **ABSENT** — the rewrite has no distinct AI-content visual at all |
| AI content over an explicit include | `uf-ai-content-overlay` — dashes only, transparent bg, so the solid include green shows through | ABSENT |
| AI content ghost | `uf-ai-content-ghost` — dotted, no animation | ABSENT |
| Click acknowledgement | `uf-interaction-ack` — `uf-interaction-pulse 160ms ease-out forwards` (opacity .95→0, scale 1→1.02); reduced-motion: no animation, `opacity:.6` | ABSENT |
| Closed shadow | — (legacy had no such class) | rewrite-only purple dashed `rgba(168,85,247,.2)` (`renderer.ts:28-31`) — but `contentRows` never carries this classification, so it is unreachable |

**Locked semantics that the port must preserve** (`MHL`):
- Toggleable-default exclusions (FOOTER/FORM/LABEL/NAV/HEADER/DIALOG/ASIDE/BUTTON) have **no dedicated
  visual layer** — once auto-excluded they render through the ordinary red exclude overlay (C-MARK-7).
- Selector-*excluded* matches also get no overlay; they only suppress the default layer at the matched
  element (`MHL:751-753`).
- `uf-explicit-exclude-ghost` is styled but **never drawn** — hidden excludes route to the hard layer
  (`legacy-content-ux.md` §19). Do not port the dead class.

### D.4 Marking interactions

| Interaction | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Mode FSM | `deriveMarkMode`, precedence **disabled > passthrough > include > exclude**; Shift is an orthogonal breadth modifier, never a mode; commit-time mode re-derived from the click's own `altKey`; blur/tab-hide/navigation reset all latches (C-FSM-1, `legacy:core.ts:8105-8174,8250-8303`) | **PRESENT** — capture-phase listeners, mode re-derived from the click's `altKey`, passthrough resets on blur/visibilitychange (`content-loader:221-236,543-603`) | Faithful. |
| Hover feedback | overlay hears mousemove (it is on top), resolves via `getMarkableTarget`, draws boxes over **all** rects, throttled to one rAF, memoized against the exact hit-stack + bounds so an idle cursor costs nothing; suppressed while busy (`legacy:core.ts:9163-9298`) | **PARTIAL** — hover box exists (`renderer.ts:109-127`), single bounding rect, no memoization documented | Add rect-level hover + the memo; the memo is the difference between "free" and "a repaint per mousemove". |
| Exclude click | nearest **self-markable** target from the composed hit stack (elementsFromPoint + open-shadow piercing + pointer-events-suppressed descendant surfacing); **first-click unmark** of a default boundary writes `{excluded:false}` (C-MARK-9); toggling an explicit exclude off runs hierarchy cleanup; clicks inside immutable subtrees toast **"Default exclusions cannot be overridden"**; duplicate clicks on the same target within **320 ms** swallowed (`legacy:core.ts:9357-9509,9686-9696`) | domain rules PRESENT (`src/domain/**`, 20 tests); **toast ABSENT**, duplicate-window unverified | Toasts §D.9. |
| Include click (Alt) | may reach inside excluded parents, prefers explicit targets, restores mixed direct-text ancestor promotion; ineligible → toast **"Element cannot be explicitly included"**; Alt-click on an un-includable excluded element acts as an unmark (`legacy:core.ts:9554-9677`) | domain rules PRESENT; toast ABSENT | |
| Shift widening | ladder: clicked element if structured-group/toggleable → nearest structured-group ancestor → nearest toggleable ancestor → broadest self-markable ancestor; landmark-based page-shell rejection at any depth; ≥2 markable descendants; walk stops at `body` (C-TGT-4/5) | **PRESENT** — width-independent Shift-climb in `domain/widening.ts` | |
| Space passthrough | overlay → `pointer-events:none` **and fades to `opacity:0.5`**; cursor unsets; toast **"Page interaction mode"** once; Alt+click on a link is intercepted to navigate/open-in-new-tab; release/blur/visibility restores and **redraws over the page's new posture** (C-FSM-2, `legacy:core.ts:12252-12269,9727-9798`) | **PARTIAL** — the latch exists; **no visual feedback, no toast, no link interception, no redraw-after-restore** | The 0.5 opacity fade is the only signal that the mode changed — without it Space looks broken. |
| Right-click toggle | contextmenu also toggles (`legacy:core.ts:9711-9717`) | **ABSENT** | one listener. |
| Temporarily-disabled | brain-dictated; overlay stays mounted with `.uf-marking-temporarily-disabled`, marks dim/desaturate, hover clears, cursor → progress, top-centre `aria-live` notice with the reason copy, attempted clicks toast **"Finish server sync before editing"** or **"Marking temporarily paused"** (C-FSM-3) | **PARTIAL** — `temporarilyDisabledOverlay` is in the popup matrix (`memory.ts`), and listeners are removed while blocked (`content-loader:620-627`), but **nothing in-page shows it** | §D.9 + §E.4. |
| Refinement cadence | mutation queued to the next frame; explicit layers redraw fast; invalidating rebuild follows (~180 ms deferred or immediate); settle re-renders at **180/700/1800 ms** after enable; single toggle takes the branch-scoped CP7b rebuild with a **1.5 s** trailing full reconcile (C-PERF-2/4) | domain `evaluateBranch` PRESENT; the *cadence* is not reproduced | Content organ. The cadence is a UX contract (it is what makes a click feel instant on a heavy page), not an implementation detail. |
| `beforeunload` unsaved guard | prompts when the draft is dirty (`legacy:core.ts:13081-13090`) | **PRESENT** — armed only while dirty (`content-loader:106-123`) | |

### D.5 Click acknowledgement pulse — **ABSENT, P1**

Legacy flashes a 160 ms `uf-interaction-ack` box in the matching include/exclude colours on the
`interaction` layer **before any recompute** (`legacy:core.ts:9697,8332-8361`), cleared after 180 ms.
This exists because of pain **P30**: on heavy pages, payload/recompute work ran before any feedback
painted and clicks looked ignored. Reduced motion gets `opacity:.6` and no animation.

**Porting note.** Content organ, first thing in the click handler, before the domain call. Cheap and
high-value.

### D.6 Custom cursors — **ASSET-ONLY, P1**

| Mode | Class | CSS |
|---|---|---|
| exclude (default) | `uf-cursor-exclude` | `cursor: url(".../cursors/exclude.svg") 4 3, crosshair !important` |
| include (Alt) | `uf-cursor-include` | `cursor: url(".../cursors/include.svg") 4 3, copy !important` |
| passthrough (Space) | `uf-cursor-passthrough` | `cursor: unset !important` |
| disabled/busy | `uf-cursor-disabled` | `cursor: progress !important` |

Exactly one class on `<html>`, derived from the marking FSM (`legacy:core.ts:8189-8205,7291-7306`).
Artwork: 32×32 SVG, black arrow + white outline + badge circle — exclude = dark red `#a02626` with a
minus, include = green `#609423` with a plus; hotspot `4 3` = arrow tip. Both SVGs are pre-decoded via
`new Image()` at overlay creation.

**Two locked details:** the fallbacks are deliberately neutral (`crosshair`/`copy`, **never
`not-allowed`**) because Chromium transiently drops custom image cursors and flashed the forbidden
cursor (`legacy:core.ts:7280-7286`, restated in `legacy-content-ux.md` §19); and during the reveal
walk a separate style forces `cursor: progress` on `html.uf-page-inspection-active` **and every
descendant**.

**Rewrite:** `src/public/cursors/{include,exclude}.svg` ship, `wxt.config.ts:71-79` declares them
web-accessible, **no code references them**. Content organ, ~20 lines.

### D.7 Consent chrome hiding — **PRESENT (improved), P0-done**

| Legacy | Rewrite |
|---|---|
| Runs on **every configured property page**, decoupled from candidacy/marking (C-LIFE-1), before every reveal, and on every childList mutation while marking observes. Hiding is **visual, not removal**: `data-uf-consent-hidden="on"` + inline `opacity:0/visibility:hidden/pointer-events:none !important`; open `<dialog>` are `close()`d; scroll locks repaired (`overflow hidden→auto`, `position:fixed→static`, `height→auto`); `#uf-consent-bypass` re-enables pointer-events on `[aria-hidden=true]` page content. Selector list is a **high-precision allowlist** — never generic words (C-LIFE-2) | **PRESENT and better** — 28 selectors, same technique, native `<dialog open>` closed, bypass style, idempotent, MutationObserver-driven, restorable; a test guards that no generic word enters the list (`consent.ts:27-178`, `tests/src/content/consent.test.ts:222`); runs at `document_start` gated only on "is this a property" (`content-loader:361-391,408-444`) |

Remaining gap: verify the **scroll-lock repair** (`overflow`/`position`/`height` on html/body,
`legacy:core.ts:11847-11883`) is ported — grep did not surface it. Without it a cookie wall's scroll
lock survives its own hiding and the reveal walk cannot scroll.

### D.8 Silent highlighting — **PARTIAL, P1**

| Aspect | Legacy | Rewrite |
|---|---|---|
| When | whenever marking is off on a configured property page with stored selectors, **popup open or not** (C-LIFE-4/7) | **only while the popup is open** — painted by `refreshSilentSelectorPreview` inside the 500 ms poll (`main.tsx:509,516-539`; content side `content-loader:749-777`) |
| Overlay | own root `#unfluffify-silent-highlight-overlay`, z **2147483646** — one **below** the marking overlay, so silent overlays never capture clicks (C-SIL-2) | layer 7 of the shared root; root is `pointer-events:none`, so the no-capture property holds |
| Layers | 3, ordered `immutable` < `content` < `excluded` | 1 |
| Classes | `uf-silent-content` 2px dashed `#44b532` + `rgba(68,181,50,.08)`; `uf-silent-content-ghost` 1px dotted; `uf-silent-immutable` 1px dashed `rgba(156,107,107,.45)`; `uf-silent-excluded` 2px dashed `#b03b3b` + `rgba(176,59,59,.08)`; overlay class `uf-silent-hidden` → layers opacity 0 during scroll/rebuild | one blue box `rgba(59,130,246,.8)` (`renderer.ts:142-143`) — **and blue is also the rewrite's explicit-include colour** |
| Tooltips | every highlighted node gets a rewritten `title` (original saved/restored): `"Matched CSS selector: <sel>\nXPath: <xpath>"`, or just the XPath for implicit content | ABSENT |
| Click-to-copy | plain left-click on an annotated node copies its title to the clipboard (wired only while marking is off) | ABSENT |
| Anti-blink choreography | full refresh = hide → rebuild → reveal on a rAF once no reposition timers pend; a live overlay updates **in place** (`keepVisible`) so periodic refreshes do not blink; scroll/resize → hide immediately, reposition after 120 ms; layout-shift settle-sampled every 120 ms until 3 identical signatures or 2600 ms; structural mutations debounced 300 ms with a 1200 ms min interval | ABSENT — skipping `keepVisible` reproduces the historical 1 Hz blink (`legacy-content-ux.md` §19) |
| Narration | "Calculating highlightings..." via a 300 ms-threshold spinner lease; marking counterpart "Calculating markings..." immediately around the first rebuild after enable | ABSENT |

**Porting note.** Content organ must own the silent lifecycle end-to-end, driven by the brain
directive `silentHighlightActive` (C-LIFE-4: *"Ownership: solely the brain directive… content only
reflects it"*). C-LIFE-5 is the trap: the directive must be the **stable intent** and must not be
gated on the activation's own transient signals, or the activation re-triggers forever (the perpetual
"Preparing page content…" curtain). **OQ-6** asks whether popup-closed silent highlighting is
required; the contract says yes.

### D.9 In-page toasts and notices — **ABSENT, P1**

| Surface | Legacy spec | Copy |
|---|---|---|
| Marking-overlay toast `.uf-toast` | fixed bottom (14 px), `padding 10px 12px`, `background rgba(47,42,36,.9)`, `color #fdf6ed`, Inter, 12px, radius 10px, slide-up 8px + fade 0.2 s, auto-hide **1800 ms** (`legacy:core.ts:7440-7459,8007-8019`) | "Default exclusions cannot be overridden" · "Element cannot be explicitly included" · "Page interaction mode" · "Finish server sync before editing" · "Marking temporarily paused" |
| Page toast `#unfluffify-page-toast` | top of page, **3000 ms** (`legacy:page-toast.ts:43-101`) | "Set Base Page URL in the Unfluffify popup first." · "Finish server sync before editing" · "Unable to activate on this page" · "Mobile simulation enabled." · "Simulation disabled." · "Unable to update simulation mode." · property-lock blocked variants (rate-limited ≤1/1.2 s) |
| Marking-paused notice `.uf-marking-disabled-notice` | fixed top-centre, max-width `min(420px, 100vw-28px)`, `padding 9px 12px`, radius 8px, `border 1px solid rgba(255,255,255,.22)`, `background rgba(35,39,47,.94)`, white 13px/650, `box-shadow 0 12px 32px rgba(0,0,0,.22)`, fade/slide 0.16 s, `role=status aria-live=polite`; only while the overlay has `.uf-marking-temporarily-disabled` | "Saving page... marking paused" / "Save sync pending... marking paused" / "Marking temporarily paused" |

**Porting note.** Content organ. One toast element + one notice element, both `data-uf-extension-ui`,
both driven by **reason codes** from the directive (never composed strings — §0.3). The
marking-paused notice's copy is selected from the directive's `blockedReason`, exactly as legacy chose
it at `legacy:core.ts:8059-8070`.

### D.10 Page-motion pause indicator — **ABSENT, P2**

Small fixed pill top-right (`top/right: max(10px, safe-area+10px)`), **48×30 px**, radius 7px,
`border 1px solid rgba(255,255,255,.32)`, `background rgba(17,24,39,.78)`, `backdrop-filter blur(6px)`,
`box-shadow 0 6px 18px rgba(15,23,42,.22)`, two 18px white MDI glyphs — **snowflake `\F0717` +
code-tags `\F1C86`** — from a **content-injected, Unfluffify-scoped** `@font-face` named "Unfluffify
Material Design Icons" (never the global `.mdi` stylesheet — C-FRZ-5). `aria-label`/`title` = **"Page
motion paused"**. `pointer-events:none`, stripped from snapshots (`legacy:core.ts:5690-5767`).

**Why it matters:** the page is frozen for the entire visit and only navigation releases it (C-FRZ-2).
Without the pill, a page that stopped animating looks broken. The woff2 already ships at
`src/public/assets/materialdesignicons-webfont.woff2` and is already web-accessible
(`wxt.config.ts:71-79`).

### D.11 Page-side AI preview — **ABSENT, P0** (pairs with §C.6)

| Behavior | Legacy |
|---|---|
| Entering | popup sends `aiPreviewShow`; marking is disabled (`core.disable()`), marking overlays disappear, silent-style comparison rendering takes over; a hidden popover marker anchors the session |
| Clickability | every preview item's element gets `data-uf-ai-preview-clickable` + `cursor: pointer !important` on it **and descendants**; its `title` is rewritten to the selector/XPath explanation |
| Click | capture-phase (marking off): copies title/XPath to the clipboard, focuses it, notifies the popup (`aiPreviewFocusChanged`); clicking elsewhere clears focus |
| Focus visuals | `uf-focus` box (cyan 3px + glow + 1 s blink) **plus** the element itself flashes `uf-ai-preview-focus-target`: `background: rgb(255,255,0) !important; color: rgb(0,0,0) !important; border-radius:6px; scroll-margin:24vh`, then `scrollIntoView({block:"center"})` |
| Categories | excluded / explicit_included / implicit_included / undetected (undetected = visible markable content the selectors missed) |
| Read-only | no drafts dirtied; marking edits paused with the persistent notice; exit restores the previous mode (silent stays silent — C-POP-3) |
| Comparison rendering | during an active preview, **silent highlights ALSO render alongside** the yellow AI content (C-LIFE-4, architect decision #8) |

### D.12 Hotkeys (page side) — **ABSENT, P2** — see §G.2.

---

## E. Rituals

### E.1 Curtain, spinner phases and the single-spinner contract

| Item | Legacy | Rewrite | Porting note |
|---|---|---|---|
| Popup curtain `#ui-curtain` | fixed inset 0, z 20, scrim `color-mix(in srgb, var(--ink) 40%, transparent)`; card grid `auto 1fr`, min-width 220px, max-width `min(320px, 100vw-32px)`, padding 14/16, radius 12, shadow-md; **16×16 spinner ring** (2px border, accent top, 0.8 s `ui-curtain-spin`); title 12px/700; hint 11px muted; optional timer 11px/700 (`theme-components.css:2036-2148`) | **PRESENT structurally** — same classes and slots (`App.tsx:1165-1174`) | CSS identical; only content differs. |
| Curtain content resolution | strict 6-level priority ladder: session curtain (machine-dictated) → compute-in-flight → generic busy lease → submitting → AI-controls busy → emulation applying (`legacy:ui.tsx:657-782`) | **PARTIAL** — `curtainVisible/curtainText` straight from the state matrix, plus a `blocked` flavour that narrates inline instead of scrimming (`App.tsx:181-186`) | The `blocked` flavour is a good rewrite idea (a lock can outlast the session; scrimming would bury the fix). Keep it and add the ladder for the busy flavours. |
| **Spinner phase contract** | brain broadcasts `{kind, phase, startedAt, deadlineAt, operationId, reason?, spinnerKey?}` — **never composed strings** (C-SPIN-2). Each layer resolves presentation from a shared table (`legacy:common/spinner-contract.ts:171-516`, **33 phases** across ai-run, reveal-freeze, render-mode-inspection, popup-bootstrap, content-bootstrap, config-sync, highlight-render, preview-hydration, page-save, property-lock-transfer), each with title / timer mode (none/elapsed/countdown) / `blockSurfaces` / `maxDurationMs` | **ABSENT.** Worse: composed strings already cross the wire (`lock-runtime.ts:77`, `main.tsx:696-698,785`) | **P0 doctrine fix.** Introduce `src/messaging/contracts/spinner.ts` (phase vocabulary + block surfaces + max durations) and two copy tables (`src/popup/copy.ts`, `src/content/copy.ts`). Then port the 33 phases. |
| Timers | countdown `M:SS` (run deadline) or elapsed `Elapsed M:SS` shown **only after 3 s**; a 1 s interval re-renders live timers (countdown clocks are explicitly exempt from the no-`setInterval` guard — C-SPIN-7) | **PARTIAL** — countdown only, from `run.started.deadlineAt` (`memory.ts:37-50`) | Add elapsed mode + the 3 s threshold. |
| Engage delays | popup-refresh spinner engages only after **180 ms** and is suppressed if another spinner is already active; Save/Discard spinners engage **at click** and persist behind confirms (`legacy:popup.ts:756,6478-6490`) | ABSENT | These two rules are why the legacy popup never flickered a spinner for a fast op and never looked dead on a slow one. |
| MV3 recovery | `projectSurface` fail-opens a selection past `deadlineAt + 30 s` or `startedAt + maxDurationMs + 30 s`; `runBackgroundTabOperation` holds `swKeepAlive` for the operation (C-SPIN-6, born from pain **P20**) | keepalive PRESENT; **fail-open ABSENT** | Also missing: the **30 s overlay fail-open** for `inspecting`/`reconciling` (`legacy:marking-session-machine.ts:63`). A wedged overlay in the rewrite never releases. **P1.** |
| Deterministic settle | curtain driven by the `navigationInspectionPending` fact; content emits `inspectionSettled` (in `finishPageInspectionUi` **and** from the editor activation's `.finally()` — pain **P19**); safety is a single bounded one-shot fail-open, **not polling** (C-SPIN-5) | signals exist (`inspection.started/ended`); no curtain consumes them | |
| **Single-curtain rule** | the content curtain renderer must not raise both the page-inspection notice and the popup-busy overlay: the orchestrator computes `pageBlocking` first and calls `setPageInspectionUiActive(visible, {suppressNotice: pageBlocking})`; `setPopupBusyOnPage` stays independent (C-SPIN-4, from pain **P22**) | N/A (neither surface exists) | Build it with the dedup in the orchestrator from day one. |
| **Popup curtain ⇒ page block** | C-LIFE-6, user-refined: block the page when the popup is busy **AND page interaction can affect results** (reveal/freeze, AI run, save) — not every popup curtain | **BROKEN** — `directiveRoot` sets `pointer-events:none` and the curtain child does not override it (`content-loader:296-335`), so the scrim is decorative. Legacy installed a capture-phase blocker over **22 event types** (`legacy:core.ts:892-916,5390-5440`) with a watchdog fail-open (65 s default, caller lease capped at 10 min) | **P1.** |

**Popup-side operation messages to port** (`legacy:text.ts:211-237`): "Refreshing popup data...",
"Preparing render mode inspection...", "Saving render mode for this site...", "Scrolling to the
selected element...", "Updating exclusion."/"Updating inclusion...", "Preparing this page for
marking...", "Turning off marking on this page...", "Clearing this site's cache and reloading...",
"Disconnecting this tab and reloading...", "Saving this page session...", "Discarding unsaved page
changes...", "Preparing content list...", "Preparing page content...".

**Page-side persistent notices to port:** "Inspecting page... it will be ready soon", "Working... page
controls are temporarily paused", "Saving page... marking paused", "Save sync pending... marking
paused", "Marking temporarily paused", "Analyzing page content with AI...", "Calculating markings..."
/ "Calculating highlightings...".

### E.2 The reveal/freeze ritual — **PARTIAL (bookkeeping right, walk inert), P1**

Locked contract C-FRZ-1: **exactly ONE ritual per page visit**; concurrent warmups **JOIN** the
in-flight ritual; only the walk that engaged the lazy-load lock may release it; the freeze engages at
the **absolute bottom**, never earlier; the return scroll happens under the freeze.

What the user sees, in order (`legacy:core.ts:5245-5336`):

1. Consent chrome hidden first.
2. `html.uf-page-inspection-active`: progress cursor page-wide, overlay dim tint
   `rgba(16,20,28,.2)`, centred card **"Inspecting page... it will be ready soon"** (dead-centre,
   `max-width min(460px, 100vw-32px)`, padding 14/16, radius 12, `background rgba(22,26,34,.96)`,
   white 14px/650, scale 0.98→1 + fade 0.16 s, `aria-live=assertive`) + a 20×20 spinner ring; a
   capture-phase blocker eats every mouse/key/touch/wheel event.
3. Smooth-scroll to top, pause **1000 ms**.
4. Smooth-scroll toward the bottom in up to **10** passes, 1000 ms dwell, each waiting for
   `scrollend`/settle (tolerance 2 px, settle 220 ms, hard timeout 8 s).
5. At **50 %** of the initial scroll height, lazy-load suppression engages in the page world so at most
   ONE lazy expansion happens for the whole ritual.
6. **Freeze engages at the absolute bottom.**
7. Smooth-scroll back to the original offset **under the freeze**.
8. Marking path: overlay renders, then the blocker/tint lift only after the first render completes
   (3 s cap). Silent path: extra **2000 ms** settle, then a full-document motion re-sweep.

Popup mirrors it with REVEAL_FREEZE phases: "Revealing lazy-loaded content", "Scrolling page down",
"Scrolling page up", "Freezing page motion", "Capturing static page", "Restoring page motion" — all
`PAGE_AND_POPUP` blocking with elapsed timers. While editor preparation runs, the blocking
reconciliation reason `editor_preparing` is held so the user cannot interrupt (C-FRZ-6).

**Rewrite:** the one-per-visit latch, load-event wait, 8 s timeout and per-navigation re-arm are
correct and tested (`content-loader:446-527`), but **`runReveal` calls all six steps in one
synchronous task with no awaits** (`reveal.ts:21-31`) — the browser never paints, never fires scroll
events, never runs IntersectionObserver callbacks, so nothing is revealed before the freeze.
`expandedScrollHeight` is passed the same live expression as `initialScrollHeight`
(`content-loader:179-180`), so `lazyExpansions` can only ever be 0. **None of the visible ritual
exists** — no tint, no card, no cursor, no blocker.

**Porting note.** Content organ owns the walk and its own narration; the brain owns the phase
pointer. Pain **P17** is the map of the traps: overlapping warmups' id-bump abort released the
page-world lazy-load lock under the survivor; a walk that skipped engagement released a lock it did
not own; unpaused-subsystem resume unconditionally restored suppression. The fix set — warmups JOIN,
only the engaging walk releases, resume gated on `pageRevealWarmupInFlight`, freeze rides the
`pauseAtBottom` hook — is the design, not an optimization.

**Scope contract C-LIFE-3:** the ritual runs ONLY on a candidate page, in exactly two cases — full
page load with the render mode already set, or immediately after a **first-time** render-mode Set.
Never in marking mode, never during render-mode editing, never later in-session.

### E.3 Page-motion freeze — **PRESENT (mechanics), invisible (UX)**

C-FRZ-2: the pause is a **reason set**; every pause also holds the sticky `page-visit` reason, so
subsystem resumes (marking disable, silent teardown, preview exit) never unfreeze the page. The only
release is navigation. C-FRZ-3 lists coverage: CSS animations/transitions via stylesheet, Web
Animations, SVG clocks, autoplay-ish media, inline locks on motion candidates (cap 800), synthetic
hover-pause (≤500 targets, 8 ancestor levels), page-world timer bridge. C-FRZ-4: reveal-normalization
vs semantic hiding — entrance-animation-hidden elements normalize to visible; modals/menus/tabs/
accordions/`aria-hidden` stay hidden. C-PERF-6: full-document sweeps only at explicit engage points;
the 250 ms tick and the observer use the cheap path (pain **P14**, the 2-hour CPU peg).

**Rewrite:** the MAIN-world program is real (388 lines, nonce-gated ARM/SET_MOTION_PAUSED/
SET_LAZY_LOADING_SUPPRESSED/DESTROY, queue-and-flush, full restore, 15 tests). **Missing UX:** the
indicator pill (§D.10) and any narration.

### E.4 Blocking/temporarily-disabled ritual — see §D.4 (last row), §D.9, §E.1 last row.

### E.5 Render-mode inspection ritual — **PARTIAL**

Legacy page side (`legacy:content/render-mode-inspection-handlers.ts`): `begin` flags the session in
`sessionStorage` and emits busy "Inspecting page..."; after reload `revealOnce` runs **the** one
ritual for the visit (same visuals as §E.2); `captureHtml` takes the sanitized rendered snapshot +
background-fetched static HTML **before** highlighting refresh, popup narrating "Comparing rendered
and raw HTML..."; `end` clears the flag and refreshes the lock banner mode. A **30 s watchdog**
force-clears a stuck inspection (popup closed mid-flow), emits FAILED and restores the correct
posture so the page is never left frozen behind a dead flag. C-FRZ-7: entering the Render Mode view
alone must NOT reveal/freeze while the mode is unconfirmed; the explicit With/Without-JavaScript
action is the only Render-Mode path that may.

**Rewrite:** the CDP mechanics are live (`render-emulation-runtime.ts:218-235`) and
`preparePageVisit` correctly re-probes after a mode is set (`content-loader:838-846`). The visible
ritual, the spinner phases and the watchdog are ABSENT.

---

## F. Flows

### F.1 Run AI content detection

| Step | Legacy | Rewrite |
|---|---|---|
| Preconditions (each a specific toast, never silent) | active tab; base URL ("Property not found"); render mode confirmed ("Confirm Render Mode before continuing"); no reconciliation pending ("Server sync pending"); AI credentials ("Set Endpoint URL first"/"Login first"); run not already up-to-date; current page URL known ("Current page unavailable"); **mobile simulation on if the snapshot is stale** ("Mobile simulation must be enabled to save markings.") | gates exist in code; **no toasts** |
| Ordering contract C-SUB-6 | enter compute-busy, render spinner/countdown, apply the page-side compute lock **before** raw-HTML backfills, XPath refinement and payload construction (pain **P30**) | unverified — must be asserted |
| Curtain | local prepare phases (capture → xpath refine → payload) with **no countdown**, then remote-wait with the **M:SS countdown** (8 min default); note **"This can take up to 8 minutes. Editing stays paused until the AI run finishes."**; fallback text "Up to 8:00" | one generic "Computing selectors" curtain (`memory.ts:166`) + countdown |
| Page side | full-page dim curtain **"Analyzing page content with AI..."** with a real input block, auto-expiring compute lock | ABSENT |
| Failure toasts | "Server sync pending" / "Property is being edited by {editor}" / "Unable to prepare the current page for AI" / "Mark pages before computing selectors" / "AI request timed out" / backend error / "AI request failed" | ABSENT |
| Success | results-applied **tears the run curtain down immediately** and raises the "Preparing content list..." hold (60 s fail-open); the AI preview opens on-page; the popup switches to the preview sidebar seeded with the returned items; status **"Selectors computed locally"** (warning tone) + toast **"Selectors computed locally — Save to sync"** | selectors land in state, content marked clean, `run.completed`; no preview, no status, no toast |
| Resume | interrupted runs persist and resume on popup reopen; a live run re-enters the countdown curtain; server-side loss → toast **"AI results expired. Try again."** | **ABSENT** — run records are written but never read back |
| Timeout single source of truth | C-SUB-7: `AI_RUN_DEFAULT_TIMEOUT_MS/_MINUTES` feeds the abort deadline, the REMOTE_WAIT phase duration, the countdown fallback and the busy note — never hardcode minutes | rewrite uses a 480 s deadline in `services.ts` — verify it is one constant |

### F.2 Save / Discard

**Save** (`legacy:page-reconciliation.ts:101-207`): spinner "Saving this page session..." **from
click**; gate refusals each toast specifically (AI busy → "Working..."; reconciliation →
"Server sync pending"; `no_session_changes` → status "No local changes to save" + toast "No changes to
save"; `requires_ai_run` → "Run AI content detection before saving or exiting marking."; unnamed →
"Save is unavailable right now"); forced token validation; **up to 5 attempts** of
`syncBaseConfigToServer` with 1.5 s→10 s backoff, the curtain showing **"Problem connecting to server.
Retrying..."** between attempts; on success → **post-save silent transition** (mode drops to silent,
machine `saved → silent`), status "Saved and synced" + toast "Session saved"; on failure → status
"Save failed" + toast "Unable to save session"; auth expiry exits quietly.

**Discard** (`:209-263`): spinner "Discarding unsaved page changes..." from click; gates as above;
**confirm before the slow runtime refresh**; on OK the local session resets to PRE_AI immediately and
the content discard fires non-blocking; status/toast "Session discarded"; machine `discarded →
pre_ai_clean` (**marking stays ON with a clean session**); backend reconciliation best-effort
afterwards. C-BRAIN-7 makes the settled-facts publish load-bearing (pain **P15**).

**Rewrite:** two-gate save exists (`main.tsx:1597-1678`) with the right shape; **no retry ladder, no
narration, no toasts, no status line, no Discard confirm**. Discard → `pre_ai_clean` is correct.
`saved → silent` is the shipped D-SAVE decision and is in the machine.

*(Cross-reference, out of UX scope but blocking: `configFromSubmission` posts only the current page's
markings — `main.tsx:866-873` — the same class as the production half-snapshot wipe.)*

### F.3 Preview open / exit — **VESTIGIAL, P0**

Legacy has **two distinct entry points** (C-POP-3, locked):
1. **Silent "Show Content List"** — reads the latest stored selector set from config storage, enabled
   whenever stored selectors exist in silent mode, **does not require a fresh AI run**, and **exit
   returns to the origin mode (silent stays silent)**.
2. **Marking "Show Content List"** — a current-page verification action, exposed only in
   `post_ai_clean`.

Opening/closing a preview must **not** create, mutate or dirty page-marking drafts; exit is
state-neutral and restores the exact pre-preview marking state. Exit budget 20 s with a 1 s restore
fallback; exiting while a restore is pending only re-arms the fallback.

**Rewrite:** clicking `#marking-preview` emits `preview.opened` and moves to `preview_open`
(`main.tsx:1680-1706`). Nothing else happens — **no control anywhere emits `preview.exit.requested`
or `preview.exited`**. The only exits are an edit, a save, a discard, a navigation or turning marking
off. The button that got you there stays enabled; Run AI is disabled. Legacy pain **P26** (silent
preview wrongly capturing a marking snapshot) and **P32** (empty "No content detected" while content
held items) are the traps to avoid when building it.

### F.4 Send to Lynx — **ABSENT, P0**

Three-stage flow:
1. `#save-excludes` click on the **silent** surface → guards (active tab, base URL, render mode →
   "Confirm Render Mode before sending to Lynx") → brain secondary gates (`server_sync_pending` →
   "Server sync pending"; `requires_ai_run` → "Run AI before saving"; `no_session_changes` → "No
   session changes to save"; `busy` → "Finish the current operation before saving") → **opens the
   checklist popover** (§C.8).
2. cssInfo staleness gate, **fail-closed** (C-SAVE-7).
3. Send: popover closes; curtain **"Sending to Lynx..."**; every config/render-mode control
   force-disabled; pipeline = (DARK) page-type assignments POST → GraphQL `updateScrapingConditions`
   (includeCss/excludeCss/renderingMode) → local config stamped with the submitted fingerprint →
   config `/save` sync. Outcome status: "Submitted selectors" / "(config sync skipped)" /
   "(config sync failed)" / "Submitted selectors and synced" + toast "Submitted to server".

**Rewrite:** `buildUpdateScrapingConditionsRequest` and `buildCssInfoRequest` are written, tested and
exported on `services.lynx` — **no caller anywhere**. This is the whole second half of the operator
loop.

### F.5 Property lock — **PARTIAL (transport live, UI absent), P3**

| Surface | Legacy | Rewrite |
|---|---|---|
| Popup indicator | flag-gated strip in the header property-URL block: grid icon\|text\|actions, tone-tinted via `u-surface-tone u-tone-*`, status 12px/700, detail 11px muted, up to two 26px action buttons. **18 distinct states** each with tone/icon/status/detail/buttons (`legacy:property-lock-decider.ts:137-367`, strings `legacy:text.ts:107-151`) — see `legacy-popup-ux.md` §12 for the full table | **PARTIAL** — always-visible strip with icon, status text, `status/role/site` detail, countdown, **Refresh** button (`App.tsx:488-521`); **no takeover / accept / reject / continue-here buttons** |
| In-page banner | fixed full-width top banner, z 2147483645, `padding 12px 16px`, `background #fff3cd`, `border-bottom 1px solid #d39e00`, `color #4d3900`, 14px Inter, `box-shadow 0 4px 14px rgba(0,0,0,.16)`; buttons `#f8b400`/`#bf8500`/12px 600, hover `#e6a700`, disabled `.55` on `#f5d886`. **12 modes**; countdowns tick 1 Hz; while a blocking banner shows, page interactions are intercepted capture-phase and answered with rate-limited toasts (≤1/1.2 s) (`legacy:property-lock-banner.ts:60-316`) | **ABSENT** |
| Collaboration actions | Take over / Suggest to take over / Accept / Reject / Continue editing / Continue editing here / Continue editing here anyway; accept-with-unsaved-changes runs the save/discard confirm pair (C-LOCK-6) | client methods `suggestTakeover`/`respondToSuggestion`/`continueEditing` exist (`lock/client.ts:124-132`) and are **called by nothing** |
| Timings (C-LOCK-3) | heartbeat 30 s while interacted within 30 min; connectivity loss → **70 s** editor countdown; off-candidate → 70 s; cross-property recovery → **30 s**; passive release countdown → **60 s**; tab close → immediate `release_lock` | `lock/timings.ts` mirrors them |
| Statuses | 18 view states | 5 strings (`lock/view.ts:10-49`) |

Legacy shipped this **flag-off**, so production users have no lock protection today. Parity means
building it dark. **OQ-5.**

### F.6 Accounts / sign-in

| Item | Legacy | Rewrite |
|---|---|---|
| Login | guards → toasts "Set Stage Base first"/"Enter a valid email"/"Enter password"; `aiRequestInFlight="login"` disables the configuration UI; failure surfaces the backend text or "Login failed ({status})"/"Login request failed"/"Login response did not include token"; success → token saved, remote-config cache cleared, **password field cleared**, toast "Login successful", auto-switch to Marking | **PRESENT** — password never persisted and dropped on success (`main.tsx:1420-1457`); no toasts; no auto-switch |
| Token status | "Token saved" (green) / "Login required" (amber); the token value is never displayed | **PRESENT (different copy)** — `signed in`/`signed out`/`token rejected`/`checking…` (`App.tsx:234-248`) |
| Validation cadence | at most once per **10 min** on refresh, **forced before Save** and view switches; background alarms validate while the popup is closed and push `tokenInvalid` | **PRESENT** — background monitor every 10 min with a cached verdict the popup adopts |
| Expiry UX | any invalidation → token cleared, popup **force-locked to Configuration**, status "Login required", toast **"Login expired. Please log in again."** | **PARTIAL** — the view resolver locks to configuration when `configurationComplete` is false; no toast |
| Rotation | invisible; flows re-read the freshest stored token mid-flight | **PRESENT+** — silent `x-update-token` rotation queued behind a serialized settings writer |
| Endpoint change clears the token | yes, with a toast per field | **ABSENT** — see §C.2 |

### F.7 Enable Marking toggle

**ON** guards in order (`legacy:popup.ts:7528-7766`): active tab; base URL ("Property not found");
render mode ready (toast + snap back); **current page must be a valid page-type candidate** (toast =
the page-type notice or "This page is not one of the current Live Page candidates. Choose one of the
listed candidates to continue."); base-url parse; page-within-base; siteId resolution; desktop preview
off ("Turn off desktop preview before enabling marking."). Then curtain **"Preparing this page for
marking..."** (180 ms delay). Failure → toast, **toggle snaps back off**.

**OFF**: an immediate spinner **"Turning off marking on this page..."** at click (no delay); pending
session → pre-toast + confirm; Cancel keeps marking on; failure → toast "Unable to disable marking",
toggle snaps back on.

**Rewrite:** lock re-check → emulation assert → activate with selector seed → rows adopted →
`marking.enabled`; refusals logged to the Activity log with reasons (`main.tsx:920-1004`); the
disable confirm exists when dirty. **Missing:** the candidacy gate (needs §C.7), all toasts, the
snap-back, the two curtains, the tooltip.

C-POP-7 (locked): **the content script is the source of truth** for whether the page is in marking
mode; refreshes reconcile the toggle to content's status without sending a redundant `setEnabled`.

### F.8 Device emulation & desktop preview

| Item | Legacy | Rewrite |
|---|---|---|
| Presets | mobile 412×960 dsf 1 `mobile:true`; desktop 1920×1080; auto scale clamped 0.25–1, defaults 0.85 / 0.7 — the user sees a **letterboxed phone-width page centred in the tab** | **PRESENT+** — plus UA + `userAgentMetadata` client-hint spoofing (Pixel 7 / Android 13) derived from the browser's own Chrome version, posture re-assertion on debugger detach, and one self-terminating reload to make the identity real |
| C-EMU-1 | opening Unfluffify enables mobile by default per fresh tab session; a user-disabled state persists for the session while marking is off; the **active marking editor tab forces mobile back on**; render-mode inspection must not clear a session choice | asserted on bind (`main.tsx:612-626`) |
| Desktop preview (DARK in legacy) | see §C.12 | **live** in the rewrite |
| Hotkey Ctrl/Cmd+M (DARK) | toggles simulation from the page with toasts "Mobile simulation enabled."/"Simulation disabled."/"Unable to update simulation mode." | ABSENT |
| Gate | mobile simulation is a **precondition for capturing page snapshots** (toast "Mobile simulation must be enabled to save markings.") | verify it is enforced |
| Side effect | the yellow "started debugging this browser" info-bar is unavoidable in both trees | same |

### F.9 Page-visit lifecycle (the user's-eye view — `legacy-content-ux.md` §13)

1. Non-property page: nothing visible; **default** action icon.
2. Property page, passive: consent chrome vanishes, scroll repaired. If the render mode is confirmed
   and the page is a candidate with the user as editor → the one-per-visit ritual (progress cursor,
   dim tint, "Inspecting page..." card, scroll walk, freeze + snowflake pill). If stored selectors
   exist → silent green/red/dashed overlays with tooltips and click-to-copy. If not → frozen page +
   pill.
3. Enable marking → silent overlays vanish, ritual if not yet frozen, marking overlay mounts (exclude
   cursor, hover boxes, candy-striped immutables, green defaults, animated AI dashes, red/green
   explicit marks); input blocked until the first render lands, "Calculating markings..." on both
   surfaces.
4. Editing: hover amber → click 160 ms pulse then red exclude (or first-click unmark) → Alt-click dark
   green include → Shift widens → Space passes clicks through (overlay half-fades) → Alt+click follows
   links in passthrough. Dirty page arms `beforeunload`.
5. AI run: dim curtain "Analyzing page content with AI..." with a hard input block; afterwards the
   preview comparison; marking edits stay paused.
6. Save: "Saving page... marking paused" / "Save sync pending... marking paused", dimmed marks,
   progress cursor; clicks toast "Finish server sync before editing".
7. Deactivation: overlay unmounts, **page stays frozen**, silent overlays return.
8. Any navigation: the URL notifier releases the freeze (the only release point), disables marking,
   discards the unsaved draft, resets reveal keys; the new page re-evaluates from step 1/2.

**Rewrite reproduces steps 1, 2 (consent only), and the state transitions of 3–8 — but essentially
none of the visible narration.** This section is the acceptance script for the whole bring-over.

---

## G. Chrome-level

### G.1 Browser-action icon states — **ASSET-ONLY, P2**

Two full icon sets ship in both trees (`src/public/icons/{default,active}/icon{16,32,48,128}.png`).
The mascot is a cartoon eraser sweeping with a broom; the **active** variant sits on a green circular
badge, the **default** variant has no badge.

Legacy `updateActionForTab` (`legacy:common/utilities.ts:754-798`): a tab shows the **active** icon
when it is the active tab AND (`tabState.enabled` — marking on — OR `initialState.active` — the
extension has bootstrapped on the tab). Refreshed on `tabs.onActivated`, `windows.onFocusChanged`
(re-sweeping every tab in the window), after bootstrap/activation, and on AI-run transitions.
**No badge text or colour is ever set** in either tree; the action title is static "Unfluffify".

**Rewrite:** no `action.setIcon` call anywhere. The manifest declares only the default set
(`wxt.config.ts:80-85`). **Porting note:** background, driven by the existing per-tab facts —
`marking.enabled`/`marking.disabled` signals plus the activation fact already exist.

### G.2 Keyboard shortcuts — **ABSENT, P2**

| Where | Keys | Action | Guard |
|---|---|---|---|
| Popup (`legacy:popup.ts:9655-9697`) | Ctrl/Cmd+E | Toggle Enable Marking | skipped if `toggleEnabledDisabled` |
| Popup | Ctrl/Cmd+S | Save Session | requires marking on and Save enabled |
| Popup | Ctrl/Cmd+M | Toggle desktop preview | DARK flag + control visible/enabled |
| Popup | Escape | Close config/todo/theme menus | — |
| Page (`legacy:content-main.ts:7395-7423`) | Ctrl/Cmd+E | Toggle marking | base URL match, render mode confirmed, Live-Page candidate, lock free |
| Page | Ctrl/Cmd+M | Toggle mobile simulation | DARK flag |
| Page | Space / Alt / Shift (hold) | passthrough / include / widen | reset on blur/tab-hide |

All popup shortcuts require Ctrl (or Cmd), no Alt/Shift, not `repeat`, not inside an editable target.
They are advertised as plain `title` tooltips on their rows: "CTRL/CMD+E" on the Enable Marking row,
"M" on the desktop-preview row.

**Rewrite:** only the Space/Alt/Shift modifiers exist (`content-loader:543-603`). No Ctrl/Cmd hotkeys
anywhere, in either surface.

### G.3 Manifest & permissions — **PRESENT, identical**

MV3; permissions `storage, sidePanel, tabs, scripting, debugger, alarms, browsingData, webNavigation,
activeTab, offscreen`; `host_permissions: ["<all_urls>"]`; web-accessible resources = the MDI woff2 +
`cursors/*.svg`; no `options_ui`; action carries only `default_title` (`wxt.config.ts:52-86` vs
`legacy:wxt.config.ts:50-85`).

---

## H. Timing constants to port verbatim

Timings are UX. Getting them wrong reproduces named legacy bugs.

| Constant | Value | Where |
|---|---|---|
| Toast visible (popup + marking overlay) | **1800 ms** | popup + content |
| Page toast visible | 3000 ms | content |
| Toggle ack animation / clear | 160 / 180 ms | content |
| Duplicate-toggle swallow window | 320 ms | content |
| Scroll overlay-hide debounce | 250 ms | content |
| Deferred full render after toggle | 180 ms | content |
| Marking settle re-renders | 180 / 700 / 1800 ms | content |
| CP7b trailing full reconcile | 1500 ms | content |
| Reveal: max scrolls / dwell | 10 / 1000 ms | content |
| Reveal scroll-end timeout / settle / tolerance | 8000 ms / 220 ms / 2 px | content |
| Lazy-load suppression point | 50 % of initial height | content |
| Silent warmup settle | 2000 ms | content |
| Silent reposition debounce / settle sample / stable / max | 120 / 120 ms / 3 samples / 2600 ms | content |
| Silent mutation refresh debounce / min interval | 300 / 1200 ms | content |
| Motion-pause maintenance tick | 250 ms | content |
| Motion locks / hover targets cap | 800 / 500 | content |
| Popup-busy watchdog default / max | 65 s / 10 min | content |
| Render-mode inspection watchdog | 30 s | content |
| Calc-narration threshold | 300 ms | content |
| Busy-overlay engage delay (popup refresh & light ops) | 180 ms | popup |
| Token validation interval | 600 s | popup/background |
| Remote-config retry delay | 2.5 s | services |
| Page-type quiet refresh | 120 s | services |
| AI run timeout (countdown) | 8 min, one constant (C-SUB-7) | shared |
| AI status poll cadence | 5 s | services |
| Page-save sync retries | 5 attempts, 1.5 s → 10 s backoff | popup |
| Preview restore fallback / exit budget | 1 s / 20 s | popup |
| Preview settled-empty confirmation | 3 s | popup |
| Marking-session overlay fail-open | 30 s | popup |
| Nav-inspection / stale-inspection fail-open | 15 s | popup |
| Device-emulation apply timeout | 12 s | background |
| Refresh debounce | 120 ms | popup |
| Todo expansion contexts kept | 200 | popup |
| Lock: heartbeat 30 s · idle 30 min · loss 70 s · off-candidate 70 s · cross-property 30 s · passive release 60 s | — | lock |

---

## I. Deliberate-change candidates (legacy UX that was itself awkward)

Flagged, **not** silently changed. Each is an open question in §J.

1. **Raw reason codes in the UI.** The rewrite shows `Blocked: requires-ai-run` and
   `data-blocked-reason` (`App.tsx:687-691`). Legacy always rendered human copy. The codes should
   stay in the DOM as test hooks; the visible text must be prose. *(Not really an open question — do
   it.)*
2. **Native `window.confirm` for destructive actions.** Legacy used 8 of them; they block the panel,
   cannot be styled, and are auto-dismissed by CDP harnesses (M4). The `.warning-popover` component
   already exists. → OQ-11.
3. **Discard requires a confirm but Save does not, and Save ends the session.** Legacy's `saved →
   silent` transition (D-SAVE) surprises editors: saving silently drops you out of marking mode.
   Worth re-examining. → OQ-13.
4. **Two "Show Content List" buttons with the same label and different semantics** (silent =
   stored selectors, marking = fresh-run verification). Distinct labels would help. → OQ-14.
5. **The Property URL row is a read-only text that looks like an input** (`.property-url-text` —
   transparent, no border). The rewrite's `readout` treatment is cleaner. Keep the rewrite's.
6. **Todo auto-collapse default-on** hides the coverage the card exists to show, on every context
   change. → OQ-15.
7. **`.app` capped at 460 px** in a user-resizable side panel. → OQ-9.
8. **The Activity log vs toasts.** A persistent scrollable feed is arguably better than 40 transient
   toasts for an internal tool — but it is not glanceable and it currently shows internal event
   labels. → OQ-2.
9. **Legacy's render-mode radio labels describe the observation** ("Meaningful content the same in
   both"); the rewrite's describe the mechanism ("Rendered (JavaScript on)"). Legacy's are better —
   adopt them. *(Not an open question — do it.)*
10. **Legacy never showed *why* the AI run is long** beyond the note; the rewrite's countdown in the
    card header is a small improvement. Keep.

---

## J. Open questions for the product owner

Only decisions that code cannot answer.

- **OQ-1 — Is "Send to Lynx" (the `updateScrapingConditions` publish + fail-closed cssInfo gate) in
  scope for the rewrite?** Without it the operator can mark and save but cannot publish selectors, so
  the loop does not close. Everything else in this catalog is downstream of this answer.
- **OQ-2 — Tester cockpit: keep, gate, or drop?** The Status card, the raw state name in the header,
  the Marked-rows list and the Activity log have no legacy analogue. Ship to editors, hide behind
  `__UF_DEBUG_BUILD__`, or delete? And if the Activity log stays, does it *replace* toasts or
  complement them?
- **OQ-3 — Is the Todo list / page-type coverage checklist in scope?** It defined which pages editors
  marked and what "done" meant for a property, and it gates marking-enable on candidacy.
- **OQ-4 — Is the preview / "Detected Content" surface required?** If yes it needs the page-side
  focus/flash/copy layer and an Exit control; if no, the button and the four preview machine states
  should be deleted rather than left vestigial.
- **OQ-5 — How much property-lock collaboration UX must return?** The transport already supports
  takeover, suggestion and transfer. Legacy shipped the whole thing dark, so no production user has
  ever seen it. Options: (a) build all 18 popup states + 12 banner modes dark, (b) ship "someone else
  is editing" only, (c) drop the collaboration protocol.
- **OQ-6 — Should silent highlighting run with the panel closed?** The locked contract (C-LIFE-4/7)
  says yes and the whole passive-observer story depends on it; the rewrite currently paints only while
  the popup polls. Confirm the contract still holds.
- **OQ-7 — Theme policy.** Stamp `nordic`/`system` as production legacy did (recommended, one line),
  expose the 16-theme picker (the CSS and the menu design already exist), or stay on the indigo
  fallback? The current state is none of the three by accident.
- **OQ-8 — Copy voice.** Legacy: "Loading popup...", "Run AI content detection", "Save Session",
  "Discard", "Show Content List". Rewrite: "Starting Unfluffify", "Run AI", "Save", "Discard",
  "Content list". Adopt legacy verbatim (editor muscle memory), or ratify the shorter rewrite voice
  and rewrite the ~40 toast strings to match?
- **OQ-9 — Panel width.** Cap the column at 460 px (current rewrite, optimized for the QA full-tab
  view) or let it grow with the user-resized side panel (legacy)?
- **OQ-10 — Endpoint editing model.** Restore legacy's per-field Set / Change / Cancel with a
  read-only latch and per-field notices, or keep one form with a single Save? The latch is what stops
  a stray edit from silently clearing the token.
- **OQ-11 — Confirm dialogs: native `window.confirm` or the in-panel `.warning-popover`?** Native
  blocks the panel and is auto-dismissed by CDP-attached QA harnesses; the styled component already
  exists but must be made genuinely modal.
- **OQ-12 — Desktop preview shipped or dark?** Legacy gated it off (`desktopPreview: false`); the
  rewrite ships it live in the silent view. Which is intended?
- **OQ-13 — Should a successful Save end the marking session?** Legacy's D-SAVE decision drops the
  editor to silent mode on save. Confirm this is still wanted, or make it "save and stay".
- **OQ-14 — Should the two preview entry points share the label "Show Content List"?** They have
  different preconditions and different exits.
- **OQ-15 — Todo auto-collapse default.** On (legacy) hides coverage on every context change; off
  keeps it visible but makes the card tall.
- **OQ-16 — Toolbar icon.** Does the action icon need to reflect per-tab activity (legacy's
  active/default swap), or is the panel itself sufficient signal?
- **OQ-17 — Interrupted AI runs.** Must a run survive closing and reopening the panel (legacy resumed
  from a persisted record), or is a lost run acceptable given the 8-minute ceiling?
- **OQ-18 — Direct mode.** Restore the debug-build-only `?directMode=1` (marking on unconfigured
  pages, save/AI still gated)? The live-QA harness depended on it.

---

## K. Acceptance notes for whoever does the port

- **Do not extend `curtain.text`.** Fix the three composed-string sites first (§0.3); every surface in
  this catalog then lands as a reason/phase code plus a per-layer copy table.
- **The stylesheet is already legacy's.** Before authoring any CSS, grep `src/theme-components.css` —
  `.todo-*`, `.lynx-checklist-popover__*`, `.preview-sidebar__*`, `.section-menu*`, `#toast`,
  `.warning-popover`, `.close-button`, `.header-logo` are all there, byte-identical.
- **The 16 signals are the closed vocabulary** (`domain/schema/signals.ts:6-21`, RAP:95-121). Every
  surface below maps onto existing signals; do not invent new ones without a DECISION line.
- **The reflex-arc rule that keeps this maintainable:** each state applies a *complete* memorized
  presentation. When adding a field to `PopupPresentation`, add it to all 12 matrix rows
  (`memory.ts:55-260`) — a partially-specified state is how legacy's stale-write bugs (P12, P15, P33)
  became possible.
- **Live-QA reality:** background popup tabs get throttled and wedge their CDP socket (keep QA popups
  in their own focused window); a lingering `connectOverCDP` auto-dismisses `confirm()`; never
  `tabs.reload` after `runtime.reload`; the persistent profile caches the MV3 service worker.
