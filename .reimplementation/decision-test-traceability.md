# Rewrite–Legacy Decision Test Traceability

**Authority:** [`rewrite-legacy-decision-spec.md`](./rewrite-legacy-decision-spec.md)

**Status:** Executable release-gate index. Implemented behavior is linked to an
exact Vitest assertion using ``tests/path.test.ts::exact test title``. Behavior
owned by a later phase is linked to a stable acceptance ID whose procedure and
required retained artifact are defined below. A file path or free-form phase
note by itself is not decision evidence.

| Decision | Primary phase | Automated evidence | Live/build evidence |
|---|---|---|---|
| I-01 | P2 | `tests/src/domain/selector-seed.test.ts::keeps default markings the selectors say nothing about` | P9 marking scenario |
| I-02 | P1 | `tests/integration/rewrite-cutover.test.ts::keeps the fresh rewrite tree and WXT entrypoints isolated from legacy implementation imports` | `pnpm check` |
| I-03 | P1 | `tests/src/background/brain.test.ts::derives popup outcomes as brain-sourced signals with their decision payloads` | P9 worker-restart scenario |
| I-04 | P1 | `tests/src/messaging/bus.test.ts::returns exactly one typed reply for local commands` | `pnpm check` |
| I-05 | P1 | `tests/src/background/brain.test.ts::persists durable facts and re-derives volatile state on wake` | P9 worker-restart scenario |
| I-06 | P1 | `tests/page-world-source-parity.test.ts::keeps the generated JavaScript byte-identical to the TypeScript build` | production/debug stale-artifact build gates |
| I-07 | P5 | `tests/src/background/services.test.ts::persists one environment-scoped editor session per tab instead of persisting backend identity` | P11 property identity record |
| I-08 | P5 | `tests/src/background/page-context-runtime.test.ts::discards a late navigation generation without replacing the newer canonical context` | P11 candidate navigation |
| I-09 | P5 | `tests/src/background/services.test.ts::resolves authoritative property context through Hub` | P11 Hub network observation |
| I-10 | P5 | `tests/src/background/property-snapshot-authority.test.ts::retains the full stored corpus and overlays the live current page` | P9 corpus/save scenario |
| I-11 | P5 | `tests/src/background/property-snapshot-authority.test.ts::adopts a full save response without dropping untouched pages` | P11 singular save |
| I-12 | P5 | `tests/src/background/property-snapshot-authority.test.ts::adopts unexplained shrink while returning a write-blocking integrity warning` | P9 shrink/recovery scenario |
| I-13 | P5 | `tests/src/lynx/rest.test.ts::loads and saves the owned target unified snapshot` | P11 saved revision evidence |
| I-14 | P6 | `tests/src/domain/todo.test.ts::counts covered/actionable types, omits empty types, and leaves marked counts uncapped` | P11 candidate conflict/recovery |
| I-15 | P5 | `tests/src/lynx/rest.test.ts::preserves a typed stale-fence save conflict instead of flattening it` | P9 duplicate/stale-fence scenario |
| I-16 | P6 | `tests/src/background/lock-browser-lifecycle.test.ts::derives qualifying presence only for the selected tab in the focused, active browser` | P11 hidden/unselected-tab lock run |
| I-17 | P6 | `tests/src/lock/lock.test.ts::fences same-user continuation and accepted takeover commands` | P11 same-user transfer |
| I-18 | P5 | `tests/src/lynx/rest.test.ts::publishes only through Hub and accepts only definitive authoritative success` | P11 publication-unknown retry |
| I-19 | P2 | `tests/golden/ai-snapshot.test.ts::produces byte-stable unified rows and immutable defaults` | P9 marking/output comparison |
| I-20 | P2 | `tests/src/domain/evaluate.test.ts::recomputes only the toggled branch and preserves sibling overlay entries` | P9 marking scenario |
| I-21 | P2 | `tests/src/domain/widening.test.ts::qualifies groups by two eligible direct descendants regardless of width` | P11 Shift marking |
| I-22 | P2 | `tests/src/storage/repositories.test.ts::separates backend baseline from mutable session draft` | P11 Discard flow |
| I-23 | P6 | `tests/c4-content-entrypoint.test.ts::deactivates active marking on same-document URL changes without popup polling` | P11 SPA change |
| I-24 | P6 | `tests/src/background/brain.test.ts::folds facts and disables marking on navigation` | P11 reload recovery |
| I-25 | P6 | `tests/src/popup/entrypoint.test.ts::terminates the bound session and stays in onboarding after definitive configuration deletion` | P11 config-deletion onboarding |
| I-26 | P5 | `tests/src/popup/entrypoint.test.ts::surfaces a background-completed AI run when the side panel opens again` | P11 panel close/reopen |
| I-27 | P5 | `tests/src/background/services.test.ts::does not permanently cache transient context failures` | P9 failure-recovery scenario |
| I-28 | P5 | `tests/src/popup/app.test.ts::scrims a transient busy state but never a lock block` | P11 operation blocking/recovery |
| I-29 | P8 | `tests/src/popup/theme.test.ts::publishes the complete legacy theme order` | P11 theme matrix |
| I-30 | P8 | `tests/src/popup/app.test.ts::opens a fail-closed Lynx checklist over canonical saved coverage` | production package UI run |
| I-31 | P4 | `tests/src/background/emulation-policy.test.ts::preserves only the held silent desktop-preview exception` | P11 silent desktop preview |
| I-32 | P4 | `tests/src/content/stabilization/stabilization.test.ts::sends the mobile identity alongside the mobile metrics` | P11 CDP emulation facts |
| I-33 | P4 | `tests/src/background/emulation-policy.test.ts::forces the fixed crawler posture on first recognition and every later reconciliation` | P11 navigation/detach self-heal |
| I-34 | P6 | `tests/src/popup/todo-recovery.test.ts::does not turn the signal poll into a Hub poll and refreshes at exactly 15 seconds` | P11 candidate polling window |
| I-35 | P4 | `tests/src/content/stabilization/stabilization.test.ts::runs the confirmed-bottom reveal ritual, freezes no-scroll pages, and skips stale cases` | P11 reveal trace |
| I-36 | P3 | `tests/src/content/marking/dom-bridge.test.ts::renders the three legacy silent border classes on separate reusable layers` | P11 visual border check |
| I-37 | P6 | `tests/src/popup/candidate-navigation.test.ts::runs inspection, cleanup, same-tab navigation, and crawler restoration in order` | P11 candidate navigation |
| U-01 | P8 | `tests/popup-responsive-layout.test.ts::fills ordinary side panels, caps wide views, and grants list previews extra width` | P11 width matrix |
| U-02 | P3 | `tests/build-artifact-parity.test.ts::generated extension manifest and resources resolve` | production asset inspection |
| U-03 | P8 | `tests/src/popup/app.test.ts::gives the render mode, the marking session and silent mode a view each` | P11 popup navigation |
| U-04 | P8 | `tests/src/popup/app.test.ts::shows property-first context with the relative page key underneath` | P11 context hierarchy |
| U-05 | P8 | `tests/c3-popup-entrypoint.test.ts::gates the popup diagnostic toolkit behind the debug build literal` | production/debug build gates |
| U-06 | P8 | `tests/build-artifact-parity.test.ts::generated extension manifest and resources resolve` | `ACCEPT-P18-TOASTS` |
| U-07 | P5 | `tests/src/storage/settings.test.ts::commits the whole profile and invalidates a credential in the same value` | P11 configuration edit |
| U-08 | P6 | `tests/src/popup/todo-recovery.test.ts::opens current and incomplete groups, closes completed groups, and preserves an override` | P11 Todo expansion choices |
| U-09 | P8 | `tests/src/lock/copy.test.ts::has local copy for every lock banner reason` | `ACCEPT-P20-LOCK-COPY` |
| U-10 | P1 | `tests/src/background/brain.test.ts::runs a headless observe -> signal -> projection loop` | P9 event/reconciliation scenario |
| U-11 | P6 | `tests/src/popup/entrypoint.test.ts::keeps observing the opening tab when browser focus moves elsewhere` | P11 bound-tab observation |
| U-12 | P3 | `tests/c4-content-entrypoint.test.ts::uses one transaction for marking and silent-selector entrypoints and disposes overlays` | P11 Space passthrough |
| U-13 | P2 | `tests/src/content/marking/dom-bridge.test.ts::keeps preview row identity and exact targeting when a same-tag sibling shifts XPath`; `tests/src/content/marking/dom-bridge.test.ts::rotates projection authority between preview occurrences while preserving element row identity` | `ACCEPT-P17-PREVIEW-TRANSPORT` |
| U-14 | P2 | `tests/src/domain/boundary.test.ts::shares one toggleable-boundary decision for closed and silent surfaces` | P9 canonical marking scenario |
| U-15 | P1 | — | `ACCEPT-P19-DECOMPOSITION` |
| U-16 | P1 | `tests/transfer-payload-store.test.ts::deduplicates one scoped payload and returns an integrity-bearing handle` | P9 large-corpus scenario |
| U-17 | P4 | `tests/src/background/emulation-policy.test.ts::forces the fixed crawler posture on first recognition and every later reconciliation` | production package inspection |
| U-18a | P8 | `tests/src/popup/entrypoint.test.ts::clears only the bound domain and explicitly unregisters then reloads the opening tab` | P11 cache and unregister flow |
| U-18b | P7 | `tests/src/popup/app.test.ts::offers a load for each JavaScript mode rather than an automated verdict` | P11 manual inspection with both JavaScript loads |
| U-18c | P6 | `tests/src/background/page-context-runtime.test.ts::reuses a settled canonical context until an explicit refresh` | P11 feed-owned page types |
| U-18d | P7 | `tests/src/popup/preview-classification.test.ts::keeps the expanded model in debug and collapses production to included/excluded`; `tests/src/popup/app.test.ts::renders readable production rows without technical detail and exact debug rows behind the pure seam` | `ACCEPT-P17-PREVIEW-COPY` |
| U-18e | P8 | `tests/c3-popup-entrypoint.test.ts::gates the popup diagnostic toolkit behind the debug build literal` | production/debug build gates |
| D-01 | P2 | `tests/src/content/marking/dom-bridge.test.ts::seeds toggleable default exclusions before the first read-only render` | P9 toggle/branch scenario |
| D-02 | P2 | `tests/src/content/marking/dom-bridge.test.ts::initializes selector marks in the same single transaction with inclusion winning` | P9 selector-vs-user equivalence |
| D-03 | P2 | `tests/src/content/marking/dom-bridge.test.ts::keeps a collapsed wrapper XPath while drawing its visible descendant geometry` | P11 overlay identity check |
| D-04 | P2 | `tests/src/content/marking/dom-bridge.test.ts::flattens and marks a closed root captured by early instrumentation` | P11 shadow marking/capture |
| D-05 | P2 | `tests/src/content/marking/marking.test.ts::preserves captured-shadow hosts while stripping extension and automation artifacts` | P11 artifact-free payload |
| D-06 | P2 | `tests/src/content/marking/dom-bridge.test.ts::re-renders only the toggled branch` | P9 rapid-toggle scenario |
| D-07 | P3 | `tests/src/content/marking/interaction.test.ts::coalesces storms and stops after two equal layout samples` | P11 scroll/resize alignment |
| D-08 | P3 | `tests/src/content/marking/interaction.test.ts::renders the four right-click actions and commits only the chosen enabled action` | P11 right-click flow |
| D-09 | P3 | `tests/src/content/marking/interaction.test.ts::deduplicates one physical gesture without swallowing a rapid distinct gesture` | P11 rapid-click flow |
| D-10 | P3 | `tests/src/content/marking/dom-bridge.test.ts::draws an immediate mode-coloured acknowledgement and clears it after the pulse` | P11 invalid-target flow |
| D-11 | P3 | `tests/c4-content-entrypoint.test.ts::uses one transaction for marking and silent-selector entrypoints and disposes overlays` | `ACCEPT-P20-SPACE-RECOVERY` |
| D-12 | P3 | `tests/src/content/marking/dom-bridge.test.ts::renders layered overlays and drives a real-element MarkingEngine facade` | P11 passthrough/busy visuals |
| D-13 | P7 | `tests/src/popup/render-mode-inspection.test.ts::releases a stalled UI for retry and leaves no stale timer` | `ACCEPT-P16-INSPECTION-LIFECYCLE` |
| D-14 | P3 | `tests/build-artifact-parity.test.ts::generated extension manifest and resources resolve` | production/debug build gates |
| D-15 | P3 | `tests/src/content/marking/dom-bridge.test.ts::sizes the capture overlay to RTL scrollbar gutters and refreshed zoom geometry` | P11 geometry matrix |
| D-16 | P3 | `tests/src/popup/app.test.ts::renders readable production rows without technical detail and exact debug rows behind the pure seam` | `ACCEPT-P17-PREVIEW-COPY` |
| D-17 | P7 | `tests/src/content/marking/dom-bridge.test.ts::keeps preview row identity and exact targeting when a same-tag sibling shifts XPath`; `tests/src/content/marking/dom-bridge.test.ts::rebinds active preview hover after XPath rebase and forgets it when the row disappears` | `ACCEPT-P17-PREVIEW-COPY` |
| D-18 | P7 | `tests/src/domain/evaluate.test.ts::produces all six preview classifications without downstream reconstruction`; `tests/src/popup/preview-classification.test.ts::keeps the expanded model in debug and collapses production to included/excluded` | `ACCEPT-P17-PREVIEW-TRANSPORT` |
| D-19 | P7 | `tests/src/content/input-firewall.test.ts::blocks page actions and leaves extension-owned overlay input alone` | P11 blocked-actions/allowed-scroll matrix |
| D-20 | P4 | `tests/src/content/stabilization/stabilization.test.ts::defers and coalesces hidden-document runs until visibility returns` | P11 hidden-tab activation |
| D-21 | P4 | `tests/src/content/stabilization/stabilization.test.ts::joins concurrent reveal attempts to the one authoritative ritual` | P11 concurrent activation |
| D-22 | P4 | `tests/src/page-world/program.test.ts::freezes and restores the complete motion-source matrix, including late work` | P11 motion-source matrix |
| D-23 | P4 | `tests/src/page-world/program.test.ts::freezes and restores the complete motion-source matrix, including late work` | P11 hidden-content matrix |
| D-24 | P4 | `tests/src/page-world/program.test.ts::freezes and restores the complete motion-source matrix, including late work` | P11 late-motion lifecycle |
| D-25 | P6 | `tests/src/popup/candidate-navigation.test.ts::fails open after bounded unknown inspection but retains a generic warning` | P11 unknown/dirty navigation |
| D-26 | P7 | `tests/src/popup/render-mode-inspection.test.ts::releases a stalled UI for retry and leaves no stale timer` | P11 stalled-inspection recovery |
| D-27 | P6 | `tests/src/popup/candidate-navigation.test.ts::restores a usable surface and never unregisters when navigation fails` | P11 navigation failure recovery |
| D-28 | P5 | `tests/src/storage/settings.test.ts::changes when any JWT-receiving backend identity changes` | P11 endpoint/token invalidation |
| D-29 | P8 | `tests/src/background/action-icon.test.ts::projects the five approved states and deduplicates unchanged updates` | production action-icon inspection |
| D-30 | P8 | `tests/manifest-permissions.test.ts::manifest does not register global keyboard shortcuts` | `ACCEPT-P18-TRANSIENT-ESCAPE` |
| D-31 | P1 | `tests/src/popup/root-recovery.test.ts::recreates a detached root, re-renders the latest UI, and rehydrates once` | P11 panel corruption recovery |
| D-32 | P8 | `tests/src/popup/scroll-lock.test.ts::is idempotent and restores the captured panel position on every terminal path` | P11 modal/busy teardown |
| N-01 | P13 | `tests/src/content/marking/dom-bridge.test.ts::omits live consent-suppressed subtrees from rows and capture without mutating the page`; `tests/src/content/marking/dom-bridge.test.ts::removes consent-hidden subtrees regardless of helper attribute quoting` | `ACCEPT-P13-CAPTURE-SANITIZER` |
| N-02 | P15 | — | `ACCEPT-P15-FROZEN-SHIELD` |
| N-03 | P16 | — | `ACCEPT-P16-INSPECTION-LIFECYCLE` |
| N-04 | P17 | `tests/src/domain/evaluate.test.ts::produces all six preview classifications without downstream reconstruction`; `tests/src/messaging/contracts.test.ts::transports the canonical six-state preview corpus without binary collapse`; `tests/c4-content-entrypoint.test.ts::registers typed preview rows and retires their hover and bridge across exit and A-to-B navigation` | `ACCEPT-P17-PREVIEW-TRANSPORT` |
| N-05 | P14 | `tests/src/content/marking/dom-bridge.test.ts::initializes and refreshes defaults in one bridge, evaluation, candidate-index, and render transaction`; `tests/src/content/marking/dom-bridge.test.ts::initializes selector marks in the same single transaction with inclusion winning`; `tests/src/content/marking/dom-bridge.test.ts::initializes silent selector highlighting with one bridge, evaluation, index, and silent render`; `tests/c4-content-entrypoint.test.ts::uses one transaction for marking and silent-selector entrypoints and disposes overlays` | `ACCEPT-P14-SINGLE-PASS` |
| N-06 | P14 | `tests/marking-performance-equivalence.test.ts::keeps pure branch evaluation exact and p95 within the pure full-tree evaluation budget`; `tests/p14-browser-performance-contract.test.ts::keeps the default plan at three warmups and 21 samples with alternating runtime order`; `tests/p14-browser-performance-contract.test.ts::locks every operation budget for both fixtures and keeps click comparison strict` | `ACCEPT-P14-BROWSER-PERFORMANCE` |
| N-07 | P18 | `tests/src/ui/transient-surface-manager.test.ts::mutually excludes menus and closes only the outside top menu`; `tests/src/ui/transient-surface-manager.test.ts::dismisses a nested checklist confirmation before its parent`; `tests/src/ui/transient-surface-manager.test.ts::uses Preview only as an empty-stack fallback and requests each exit once`; `tests/src/content/marking/interaction.test.ts::renders the four right-click actions and commits only the chosen enabled action`; `tests/c4-content-entrypoint.test.ts::uses one transaction for marking and silent-selector entrypoints and disposes overlays` | `ACCEPT-P18-TRANSIENT-ESCAPE` |
| N-08 | P18 | `tests/src/ui/toast-controller.test.ts::replaces in place with a fresh monotonic occurrence and full deadline`; `tests/src/ui/toast-controller.test.ts::manual close clears the exact occurrence and leaves no late notification`; `tests/src/popup/app.test.ts::renders only the current typed toast occurrence with an exact dismissal seam`; `tests/src/popup/entrypoint.test.ts::fences a delayed tab-A result across B and a same-key A rebind`; `tests/c4-content-entrypoint.test.ts::uses one transaction for marking and silent-selector entrypoints and disposes overlays` | `ACCEPT-P18-TOASTS` |
| N-09 | P17 | `tests/src/popup/app.test.ts::renders readable production rows without technical detail and exact debug rows behind the pure seam`; `tests/src/popup/preview-classification.test.ts::collapses the exact six-way model to the public included/excluded distinction` | `ACCEPT-P17-PREVIEW-COPY` |
| N-10 | P13 | `tests/src/page-world/program.test.ts::captures early closed shadow roots as retrievable open roots`; `tests/src/content/marking/dom-bridge.test.ts::flattens a slot nested below a shadow wrapper without duplicating its assigned light node` | P20 forced-open formerly closed shadow content is markable, capturable, and artifact-free |
| N-11 | P13 | `tests/c4-content-entrypoint.test.ts::sweeps a managed non-candidate before render-mode gates and re-sweeps late insertions`; `tests/src/content/consent.test.ts::re-closes a marked native dialog when the site opens it again`; `tests/src/content/consent.test.ts::restores exactly what it hid, and nothing else` | `ACCEPT-P13-CONSENT-LIFECYCLE` |
| N-12 | P12 | `tests/decision-traceability.test.ts::validates the complete decision register, executable assertions, and acceptance catalog` | P20 traceability mutation gate |
| N-13 | P19 | — | `ACCEPT-P19-DECOMPOSITION` |

## Acceptance catalog

An acceptance entry is an executable obligation, not a claim that its owning
phase has passed. The named artifact must be retained when that phase runs.

| Acceptance ID | Procedure | Required artifact |
|---|---|---|
| ACCEPT-P13-CAPTURE-SANITIZER | Serialize a fixture whose consent helper changed only selected inline properties; compare direct capture, fingerprint input, and AI payload; verify authored styles remain while helper styles, marker, and all extension attributes are absent. | Focused test output plus the three sanitized payload digests. |
| ACCEPT-P15-FROZEN-SHIELD | In a real browser fixture, enter silent and post-AI modes; attempt CSS-only hover, JavaScript hover/click, navigation, wheel/touch scrolling, and extension preview actions. | Browser report and trace showing blocked page activation, preserved scrolling, and working extension UI. |
| ACCEPT-P16-INSPECTION-LIFECYCLE | Start a tokenized inspection, reload, close the panel, restart the worker, send stale and matching paint acknowledgements, then exercise timeout, failure, navigation, and Unregister. | Integration output plus browser trace proving only the matching terminal acknowledgement clears the surface. |
| ACCEPT-P17-PREVIEW-TRANSPORT | Send explicit-included, implicit-included, excluded, undetected, immutable, and closed-shadow rows through content, bus, and popup without reconstruction. | Canonical corpus diff and production/debug projection test output. |
| ACCEPT-P14-SINGLE-PASS | Instrument composed-tree discovery, default calculation, selector seeding, indexing, and first render for marking and silent startup. | Counter report proving one initialization transaction and one composed-document bridge pass per startup. |
| ACCEPT-P14-BROWSER-PERFORMANCE | Run fixed small and large fixtures against rewrite and preserved legacy for activation, hover, physical click through painted overlay, scroll repositioning, and mutation stabilization after semantic equality succeeds. | Retained sample set, percentile report, browser version, fixture digest, and semantic diff. |
| ACCEPT-P18-TRANSIENT-ESCAPE | Open competing menus and nested dismissible surfaces; exercise outside-click and Escape with and without preview while Save, Discard, marking state, and busy work are active. | Focused ordering test output and browser trace proving topmost-only dismissal and safe preview restoration. |
| ACCEPT-P18-TOASTS | With fake time and a production build, replace toasts, manually close them, and advance success, warning, and error clocks through 1.8, 4, and 6 seconds. | Fake-clock output plus production artifact inspection showing concise closable toasts and no debug Activity surface. |
| ACCEPT-P17-PREVIEW-COPY | Render rows with readable text, XPath, all classifications, and selector diagnostics in production and debug; hover and click each row and inspect focusability. | Production/debug DOM snapshots and browser interaction report showing readable pointer-only production rows and debug-only technical detail. |
| ACCEPT-P13-CONSENT-LIFECYCLE | Visit candidate and non-candidate pages; exercise ordinary overlays, native dialogs, late insertion, Save, Discard, preview, marking changes, same-property navigation, property exit, configuration removal, Unregister, and unload. | Browser lifecycle trace showing continuous suppression and restoration only on a named terminal condition. |
| ACCEPT-P19-DECOMPOSITION | After behavioral gates pass, inspect imports and run characterization tests for extracted configuration, inspection, preview, Todo, maintenance, consent, transient-surface controllers, and focused React sections. | Import-boundary report, bundle reachability report, and green characterization suite for each extraction commit. |
| ACCEPT-P20-SPACE-RECOVERY | Hold Space during marking and recover through keyup, blur, visibility loss, same-document navigation, and a deliberately missed keyup. | Focused browser trace showing passthrough only while held and deterministic marking restoration on every recovery path. |
| ACCEPT-P20-LOCK-COPY | Inspect production and debug lock surfaces for every lock reason and an active operation. | Production/debug snapshots proving curated plain-language production copy and debug-only raw role, site, fence, and operation detail. |

## Integrated evidence

- **P9:** scenario tests cover the state of background, content, popup, Hub
  fixtures, and saved/captured artifacts for the original decisions.
- **P10:** `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build:debug`, and
  `pnpm verify` plus production/debug reachability and performance gates.
- **P11:** production build on `bonliva.se` against live Alpha, with the matrix
  and artifact identities recorded in the active execution plan.
- **P17:** clean-source Chromium acceptance on commit `a4bcd4db38ec` retained
  `output/playwright/p17-preview/acceptance-2026-08-21T19-44-18-338Z.json`
  (SHA-256 `37ec1923581ed60185233cf62e739b73cb9919d5503395d36d49d9b96da39ae9`),
  with all 19 canonical transport, disclosure, pointer, occurrence, mutation,
  focus-order, error, and cleanup checks passing.
- **P20:** reruns every acceptance ID still applicable after P13–P19 and records
  the required artifacts above.
