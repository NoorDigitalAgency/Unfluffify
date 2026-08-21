# Rewrite–Legacy Decision Test Traceability

**Authority:** [`rewrite-legacy-decision-spec.md`](./rewrite-legacy-decision-spec.md)

**Status:** Executable release-gate index. Every local automated-evidence path is
validated on disk, every row names executable automated evidence, and every row
also names a specific live/build acceptance. P9/P11 accepted the original 91
rows; P20 re-exercises all 104 rows through the integrated and live matrices.

| Decision | Primary phase | Automated evidence | Live/build evidence |
|---|---|---|---|
| I-01 | P2 | `tests/src/domain/selector-seed.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 marking scenario |
| I-02 | P1 | `tests/src/domain/import-boundary.test.ts`; `tests/integration/rewrite-cutover.test.ts` | `pnpm check` |
| I-03 | P1 | `tests/src/background/brain.test.ts`; `tests/src/popup/signal-cursor.test.ts` | P9 worker-restart scenario |
| I-04 | P1 | `tests/src/messaging/bus.test.ts`; `tests/src/messaging/contracts.test.ts`; `tests/src/messaging/transports/runtime.test.ts` | `pnpm check` |
| I-05 | P1 | `tests/src/background/brain.test.ts`; `tests/src/background/startup.test.ts` | P9 worker-restart scenario |
| I-06 | P1 | `tests/page-world-source-parity.test.ts`; `tests/src/page-world/program.test.ts` | production/debug stale-artifact build gates |
| I-07 | P5 | `tests/src/background/property-authority.test.ts`; `tests/src/background/services.test.ts` | P11 property identity record |
| I-08 | P5 | `tests/src/domain/todo.test.ts`; `tests/src/messaging/contracts.test.ts` | P11 candidate navigation |
| I-09 | P5 | `tests/src/background/services.test.ts`; Hub `ConfigSyncApiTests` / `PropertyContextApiTests` | P11 Hub network observation |
| I-10 | P5 | `tests/src/background/property-snapshot-authority.test.ts`; `tests/src/background/startup.test.ts` | P9 corpus/save scenario |
| I-11 | P5 | `tests/src/lynx/rest.test.ts`; Hub `ConfigSyncApiTests` / `ConfigSnapshotV2Tests` | P11 singular save |
| I-12 | P5 | `tests/src/background/property-snapshot-authority.test.ts`; `tests/src/background/property-authority.test.ts` | P9 shrink/recovery scenario |
| I-13 | P5 | `tests/src/storage/repositories.test.ts`; Hub `ConfigSnapshotV2Tests` / `ConfigSyncApiTests` | P11 saved revision evidence |
| I-14 | P6 | `tests/src/domain/todo.test.ts`; `tests/src/popup/todo-recovery.test.ts`; `tests/src/background/services.test.ts` | P11 candidate conflict/recovery |
| I-15 | P5 | `tests/src/lynx/rest.test.ts`; `tests/src/lock/lock.test.ts`; Hub `PropertyAuthorityServiceTests` | P9 duplicate/stale-fence scenario |
| I-16 | P6 | `tests/src/background/lock-browser-lifecycle.test.ts`; `tests/src/background/services.test.ts`; `tests/orchestration-property-lock-scenario.test.ts` | P11 hidden/unselected-tab lock run |
| I-17 | P6 | `tests/src/lock/lock.test.ts`; `tests/src/background/services.test.ts`; `tests/orchestration-property-lock-scenario.test.ts` | P11 same-user transfer |
| I-18 | P5 | `tests/src/domain/publication.test.ts`; `tests/src/lynx/rest.test.ts`; Hub `PropertyPublicationGatewayTests` | P11 publication-unknown retry |
| I-19 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/marking.test.ts`; `tests/src/domain/selector-seed.test.ts` | P9 marking/output comparison |
| I-20 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 marking scenario |
| I-21 | P2 | `tests/src/domain/widening.test.ts`; `tests/src/content/marking/marking.test.ts` | P11 Shift marking |
| I-22 | P2 | `tests/c4-content-entrypoint.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 Discard flow |
| I-23 | P6 | `tests/c4-content-entrypoint.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 SPA change |
| I-24 | P6 | `tests/src/background/lock-browser-lifecycle.test.ts`; `tests/c4-content-entrypoint.test.ts`; `tests/src/background/startup.test.ts` | P11 reload recovery |
| I-25 | P6 | `tests/src/popup/entrypoint.test.ts`; `tests/src/messaging/contracts.test.ts`; `tests/src/background/startup.test.ts` | P11 config-deletion onboarding |
| I-26 | P5 | `tests/src/background/services.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/src/storage/repositories.test.ts` | P11 panel close/reopen |
| I-27 | P5 | `tests/src/background/property-authority.test.ts`; `tests/src/background/services.test.ts`; `tests/src/background/startup.test.ts` | P9 failure-recovery scenario |
| I-28 | P5 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 operation blocking/recovery |
| I-29 | P8 | `tests/src/popup/theme.test.ts`; `tests/theme-colors.test.ts` | P11 theme matrix |
| I-30 | P8 | `tests/src/popup/app.test.ts`; `tests/popup-responsive-layout.test.ts`; `tests/build-artifact-parity.test.ts` | production package UI run |
| I-31 | P4 | `tests/src/background/emulation-policy.test.ts`; `tests/src/popup/app.test.ts` | P11 silent desktop preview |
| I-32 | P4 | `tests/src/content/stabilization/stabilization.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 CDP emulation facts |
| I-33 | P4 | `tests/src/background/emulation-policy.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 navigation/detach self-heal |
| I-34 | P6 | `tests/src/popup/todo-recovery.test.ts`; `tests/src/background/lock-browser-lifecycle.test.ts`; `tests/src/background/services.test.ts` | P11 candidate polling window |
| I-35 | P4 | `tests/src/content/stabilization/stabilization.test.ts` | P11 reveal trace |
| I-36 | P3 | `tests/src/content/marking/marking.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P11 visual border check |
| I-37 | P6 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/src/popup/candidate-navigation.test.ts` | P11 candidate navigation |
| U-01 | P8 | `tests/src/popup/app.test.ts`; `tests/popup-responsive-layout.test.ts` | P11 width matrix |
| U-02 | P3 | `tests/src/popup/app.test.ts`; `tests/build-artifact-parity.test.ts` | production asset inspection |
| U-03 | P8 | `tests/src/popup/app.test.ts` | P11 popup navigation |
| U-04 | P8 | `tests/src/popup/app.test.ts` | P11 context hierarchy |
| U-05 | P8 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/c3-popup-entrypoint.test.ts`; `tests/build-artifact-parity.test.ts` | production/debug build gates |
| U-06 | P8 | `tests/src/popup/app.test.ts`; `tests/build-artifact-parity.test.ts` | production package toast inspection |
| U-07 | P5 | `tests/src/storage/settings.test.ts`; `tests/src/background/startup.test.ts`; `tests/src/popup/app.test.ts` | P11 configuration edit |
| U-08 | P6 | `tests/src/popup/app.test.ts`; `tests/src/popup/todo-recovery.test.ts` | P11 Todo expansion choices |
| U-09 | P8 | `tests/src/popup/app.test.ts`; `tests/build-artifact-parity.test.ts` | P11 lock copy and production detail exclusion |
| U-10 | P1 | `tests/src/background/brain.test.ts`; `tests/src/popup/signal-cursor.test.ts`; `tests/src/popup/entrypoint.test.ts` | P9 event/reconciliation scenario |
| U-11 | P6 | `tests/src/popup/entrypoint.test.ts` | P11 bound-tab observation |
| U-12 | P3 | `tests/c4-content-entrypoint.test.ts`; `tests/src/content/marking/interaction.test.ts` | P11 Space passthrough and recovery |
| U-13 | P2 | `tests/src/content/marking/dom-bridge.test.ts` (WeakMap identity; no temporary DOM IDs) | P9 shadow/preview scenario |
| U-14 | P2 | `tests/src/domain/boundary.test.ts`; `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 canonical marking scenario |
| U-15 | P1 | `tests/src/popup/root-recovery.test.ts`; `tests/c3-popup-entrypoint.test.ts` | `pnpm check` and bundle gate |
| U-16 | P1 | `tests/transfer-payload-store.test.ts`; `tests/capture-page-snapshot-handler.test.ts` | P9 large-corpus scenario |
| U-17 | P4 | `tests/src/background/emulation-policy.test.ts`; `tests/src/popup/app.test.ts` | production package inspection |
| U-18a | P8 | `tests/src/background/domain-cache.test.ts`; `tests/src/messaging/contracts.test.ts`; `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 cache and unregister flow |
| U-18b | P7 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/src/popup/render-mode-inspection.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 manual inspection with both JavaScript loads |
| U-18c | P6 | `tests/src/domain/todo.test.ts`; `tests/src/lynx/context.test.ts`; `tests/src/background/page-context-runtime.test.ts` | P11 feed-owned page types |
| U-18d | P7 | `tests/src/popup/preview-classification.test.ts`; `tests/src/popup/app.test.ts` | production/debug build gates |
| U-18e | P8 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/c3-popup-entrypoint.test.ts`; `tests/build-artifact-parity.test.ts` | production/debug build gates |
| D-01 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 toggle/branch scenario |
| D-02 | P2 | `tests/src/domain/selector-seed.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 selector-vs-user equivalence |
| D-03 | P2 | `tests/src/content/marking/dom-bridge.test.ts` collapsed-wrapper identity/geometry case | P11 overlay identity check |
| D-04 | P2 | `tests/src/page-world/program.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` captured-closed/nested/slotted/inaccessible cases | P11 shadow marking/capture |
| D-05 | P2 | `tests/src/content/marking/dom-bridge.test.ts`; `tests/src/content/marking/marking.test.ts`; `tests/golden/ai-snapshot.test.ts` | P11 artifact-free payload |
| D-06 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` branch-splice and stale-generation cases | P9 rapid-toggle scenario |
| D-07 | P3 | `tests/src/content/marking/dom-bridge.test.ts`; `tests/src/content/marking/interaction.test.ts` | P11 scroll/resize alignment |
| D-08 | P3 | `tests/src/content/marking/interaction.test.ts`; `tests/c4-content-entrypoint.test.ts` | P11 right-click flow |
| D-09 | P3 | `tests/src/content/marking/interaction.test.ts` | P11 rapid-click flow |
| D-10 | P3 | `tests/c4-content-entrypoint.test.ts`; `tests/src/content/marking/marking.test.ts` | P11 invalid-target flow |
| D-11 | P3 | `tests/c4-content-entrypoint.test.ts`; `tests/src/content/marking/interaction.test.ts` | P11 Space recovery paths |
| D-12 | P3 | `tests/c4-content-entrypoint.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P11 passthrough/busy visuals |
| D-13 | P7 | `tests/src/popup/entrypoint.test.ts`; `tests/src/popup/render-mode-inspection.test.ts`; `tests/src/background/render-emulation-runtime.test.ts`; `tests/src/content/organ.test.ts` | P11 inspection teardown after either JavaScript load |
| D-14 | P3 | `tests/src/content/marking/dom-bridge.test.ts`; production-negative bundle rechecked in P10 | production/debug build gates |
| D-15 | P3 | `tests/src/content/marking/dom-bridge.test.ts` | P11 geometry matrix |
| D-16 | P3 | `tests/src/popup/app.test.ts` | production popup inspection |
| D-17 | P7 | `tests/src/content/marking/dom-bridge.test.ts`; `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 preview-list hover, click-to-scroll, and exit interaction |
| D-18 | P7 | `tests/src/popup/preview-classification.test.ts`; `tests/src/popup/app.test.ts` | production/debug build gates |
| D-19 | P7 | `tests/src/content/input-firewall.test.ts`; `tests/src/content/organ.test.ts`; `tests/src/popup/app.test.ts` | P11 blocked-actions/allowed-scroll matrix |
| D-20 | P4 | `tests/src/content/stabilization/stabilization.test.ts`; `tests/c4-content-entrypoint.test.ts` | P11 hidden-tab activation |
| D-21 | P4 | `tests/src/content/stabilization/stabilization.test.ts` | P11 concurrent activation |
| D-22 | P4 | `tests/src/page-world/program.test.ts` | P11 motion-source matrix |
| D-23 | P4 | `tests/src/page-world/program.test.ts` | P11 hidden-content matrix |
| D-24 | P4 | `tests/src/page-world/program.test.ts`; `tests/page-world-source-parity.test.ts` | P11 late-motion lifecycle |
| D-25 | P6 | `tests/src/popup/candidate-navigation.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 unknown/dirty navigation |
| D-26 | P7 | `tests/src/popup/render-mode-inspection.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 stalled-inspection recovery |
| D-27 | P6 | `tests/src/popup/candidate-navigation.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 navigation failure recovery |
| D-28 | P5 | `tests/src/storage/settings.test.ts`; `tests/src/background/startup.test.ts`; `tests/src/lynx/token-rotation.test.ts` | P11 endpoint/token invalidation |
| D-29 | P8 | `tests/src/background/action-icon.test.ts`; `tests/src/background/startup.test.ts` | production action-icon inspection |
| D-30 | P8 | `tests/manifest-permissions.test.ts`; `tests/c4-content-entrypoint.test.ts` | production package shortcut absence and in-page Space handling |
| D-31 | P1 | `tests/src/popup/root-recovery.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 panel corruption recovery |
| D-32 | P8 | `tests/src/popup/scroll-lock.test.ts`; `tests/src/popup/app.test.ts` | P11 modal/busy teardown |
| N-01 | P13 | `tests/src/content/consent.test.ts`; `tests/src/content/marking/dom-bridge.test.ts`; `tests/capture-page-snapshot-handler.test.ts` | P20 direct capture, fingerprint, and AI payload contain no consent-helper style or marker |
| N-02 | P15 | `tests/src/content/input-firewall.test.ts`; `tests/src/content/organ.test.ts`; `tests/c4-content-entrypoint.test.ts` | P20 CSS/JavaScript hover and click stay blocked while wheel/touch scroll and extension UI work |
| N-03 | P16 | `tests/src/popup/render-mode-inspection.test.ts`; `tests/src/background/render-emulation-runtime.test.ts`; `tests/src/popup/entrypoint.test.ts` | P20 inspection survives reload, panel closure, and worker restart until matching paint acknowledgement |
| N-04 | P17 | `tests/src/popup/preview-classification.test.ts`; `tests/src/messaging/contracts.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P20 all six canonical classifications survive transport; production is simple and debug is complete |
| N-05 | P14 | `tests/src/domain/selector-seed.test.ts`; `tests/src/content/marking/dom-bridge.test.ts`; `tests/c4-content-entrypoint.test.ts` | P20 instrumented marking and silent activation perform one composed-document bridge pass |
| N-06 | P14 | `tests/marking-performance-equivalence.test.ts`; `tests/src/content/marking/marking.test.ts`; `tests/src/content/marking/interaction.test.ts` | P20 deterministic rewrite-versus-legacy browser benchmark covers activation through painted click and stabilization |
| N-07 | P18 | `tests/src/popup/app.test.ts`; `tests/src/popup/entrypoint.test.ts`; `tests/c4-content-entrypoint.test.ts` | P20 competing menus, outside-click, topmost Escape, preview exit, and busy protection matrix |
| N-08 | P18 | `tests/src/popup/app.test.ts`; `tests/build-artifact-parity.test.ts` | P20 production success/warning/error toast timers, replacement, and manual close |
| N-09 | P17 | `tests/src/popup/app.test.ts`; `tests/src/popup/preview-classification.test.ts`; `tests/build-artifact-parity.test.ts` | P20 production rows lead with readable text and exclude XPath/details while debug retains them |
| N-10 | P13 | `tests/src/page-world/program.test.ts`; `tests/page-world-source-parity.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P20 forced-open formerly closed shadow content is markable, capturable, and artifact-free |
| N-11 | P13 | `tests/src/content/consent.test.ts`; `tests/c4-content-entrypoint.test.ts`; `tests/src/background/property-authority.test.ts` | P20 candidate and non-candidate property pages suppress ordinary/native/late consent UI until a terminal property exit |
| N-12 | P12 | `tests/decision-traceability.test.ts` | P20 release gate rejects missing/duplicate IDs, stale paths, and unnamed acceptance evidence |
| N-13 | P19 | `tests/src/domain/import-boundary.test.ts`; `tests/src/popup/root-recovery.test.ts`; `tests/c3-popup-entrypoint.test.ts` | P20 extracted controllers preserve authority, lifecycle behavior, and production/debug bundle boundaries |

## Integrated evidence

- **P9:** scenario tests cover the state of background, content, popup, Hub
  fixtures, and saved/captured artifacts for all decisions.
- **P10:** `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build:debug`, and
  `pnpm verify` plus production/debug reachability and performance gates.
- **P11:** production build on `bonliva.se` against live Alpha, with the matrix
  and artifact identities recorded in the active execution plan.
- **P20:** production and debug builds on `bonliva.se`, with the 13 follow-up
  decisions exercised by their explicitly named acceptance checks above.
