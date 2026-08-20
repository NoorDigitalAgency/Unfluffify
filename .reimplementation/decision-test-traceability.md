# Rewrite–Legacy Decision Test Traceability

**Authority:** [`rewrite-legacy-decision-spec.md`](./rewrite-legacy-decision-spec.md)

**Status:** Living release-gate index. “Planned” evidence is an obligation of the
owning phase; it is not a claim that the test already exists. P9/P11 exercise all
rows again through the integrated and live matrices.

| Decision | Primary phase | Automated evidence | Live/build evidence |
|---|---|---|---|
| I-01 | P2 | `tests/src/domain/selector-seed.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 marking scenario |
| I-02 | P1 | `tests/src/domain/import-boundary.test.ts`; `tests/integration/rewrite-cutover.test.ts` | `pnpm check` |
| I-03 | P1 | `tests/src/background/brain.test.ts`; `tests/src/popup/signal-cursor.test.ts` | P9 worker-restart scenario |
| I-04 | P1 | `tests/src/messaging/bus.test.ts`; `tests/src/messaging/contracts.test.ts`; `tests/src/messaging/transports/runtime.test.ts` | `pnpm check` |
| I-05 | P1 | `tests/src/background/brain.test.ts`; `tests/src/background/startup.test.ts` | P9 worker-restart scenario |
| I-06 | P1 | `tests/page-world-source-parity.test.ts`; `tests/src/page-world/program.test.ts` | production/debug stale-artifact build gates |
| I-07 | P5 | `tests/src/background/property-authority.test.ts`; `tests/popup-site-resolution.test.ts` | P11 property identity record |
| I-08 | P5 | `tests/src/domain/todo.test.ts`; `tests/page-type-taxonomy.test.ts` | P11 candidate navigation |
| I-09 | P5 | `tests/no-autonomous-backend-io.test.ts`; `tests/src/background/services.test.ts` | P11 Hub network observation |
| I-10 | P5 | `tests/src/background/property-snapshot-authority.test.ts`; `tests/popup-background-snapshot.test.ts` | P9 corpus/save scenario |
| I-11 | P5 | `tests/page-draft-save-handler.test.ts`; `tests/src/domain/publication.test.ts` | P11 singular save |
| I-12 | P5 | planned `tests/authoritative-shrink-integrity.test.ts` | P9 shrink/recovery scenario |
| I-13 | P5 | `tests/src/storage/repositories.test.ts`; planned server-revision contract case | P11 saved revision evidence |
| I-14 | P6 | `tests/src/domain/todo.test.ts`; `tests/popup-todo-recovery.test.ts` | P11 candidate conflict/recovery |
| I-15 | P5 | `tests/page-draft-save-handler.test.ts`; `tests/src/lock/lock.test.ts` | P9 duplicate/stale-fence scenario |
| I-16 | P6 | `tests/property-lock-background.test.ts`; `tests/property-lock-port-client.test.ts` | P11 hidden/unselected-tab lock run |
| I-17 | P6 | `tests/property-lock.test.ts`; planned destructive-transfer integration case | P11 same-user transfer |
| I-18 | P5 | `tests/src/domain/publication.test.ts`; `tests/src/lynx/ai-job.test.ts` | P11 publication-unknown retry |
| I-19 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/marking.test.ts`; `tests/src/domain/selector-seed.test.ts` | P9 marking/output comparison |
| I-20 | P2 | `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 marking scenario |
| I-21 | P2 | `tests/src/domain/widening.test.ts`; `tests/src/content/marking/marking.test.ts` | P11 Shift marking |
| I-22 | P2 | `tests/c4-content-entrypoint.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 Discard flow |
| I-23 | P6 | `tests/navigation-notifier.test.ts`; `tests/session-phase-decider.test.ts` | P11 SPA change |
| I-24 | P6 | `tests/marking-no-auto-restore.test.ts`; `tests/session-facts-content-reconciliation.test.ts` | P11 reload recovery |
| I-25 | P6 | `tests/config-updated-handler.test.ts`; `tests/config.test.ts` | P11 config-deletion onboarding |
| I-26 | P5 | `tests/ai-run-record-store.test.ts`; `tests/post-exit-ai-run-state.test.ts` | P11 panel close/reopen |
| I-27 | P5 | `tests/background-remote-network.test.ts`; planned read/write authority matrix | P9 failure-recovery scenario |
| I-28 | P5 | `tests/popup-ai-run-gating.test.ts`; `tests/reconciliation-fact-brain-authority.test.ts` | P11 operation blocking/recovery |
| I-29 | P8 | `tests/src/popup/theme.test.ts`; `tests/theme-colors.test.ts` | P11 theme matrix |
| I-30 | P8 | `tests/src/popup/app.test.ts`; `tests/popup-view-projector.test.ts` | production package UI run |
| I-31 | P4 | `tests/device-emulation-lifecycle.test.ts`; `tests/popup-render-mode.test.ts` | P11 silent desktop preview |
| I-32 | P4 | `tests/device-emulation-store-hardening.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 CDP emulation facts |
| I-33 | P4 | `tests/device-emulation-lifecycle.test.ts`; `tests/src/background/render-emulation-runtime.test.ts` | P11 navigation/detach self-heal |
| I-34 | P6 | `tests/popup-todo-recovery.test.ts`; `tests/tab-inactivity-observer.test.ts` | P11 candidate polling window |
| I-35 | P4 | `tests/src/content/stabilization/stabilization.test.ts` | P11 reveal trace |
| I-36 | P3 | `tests/src/content/marking/marking.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P11 visual border check |
| I-37 | P6 | `tests/src/popup/entrypoint.test.ts`; planned candidate-confirmation integration case | P11 candidate navigation |
| U-01 | P8 | `tests/src/popup/app.test.ts`; planned responsive-layout snapshot cases | P11 width matrix |
| U-02 | P3 | `tests/src/popup/app.test.ts`; `tests/build-artifact-parity.test.ts` | production asset inspection |
| U-03 | P8 | planned kebab-navigation component test | P11 popup navigation |
| U-04 | P8 | `tests/src/popup/app.test.ts`; planned prioritized-notice projection test | P11 context hierarchy |
| U-05 | P8 | planned production/debug diagnostic reachability test | production/debug build gates |
| U-06 | P8 | `tests/page-toast.test.ts`; planned production Activity-absence test | production package inspection |
| U-07 | P5 | `tests/config.test.ts`; `tests/config-store-queue.test.ts` | P11 configuration edit |
| U-08 | P6 | `tests/src/popup/app.test.ts`; `tests/popup-todo-recovery.test.ts` | P11 Todo expansion choices |
| U-09 | P8 | `tests/property-lock-banner-mode.test.ts`; planned production-copy snapshot | P11 lock copy |
| U-10 | P1 | `tests/src/background/brain.test.ts`; `tests/src/popup/signal-cursor.test.ts`; `tests/src/popup/entrypoint.test.ts` | P9 event/reconciliation scenario |
| U-11 | P6 | `tests/popup-site-resolution.test.ts`; planned sticky-binding navigation case | P11 bound-tab observation |
| U-12 | P3 | `tests/mark-mode-fsm.test.ts`; `tests/c4-content-entrypoint.test.ts` | P11 Space passthrough |
| U-13 | P2 | `tests/src/content/marking/dom-bridge.test.ts` (WeakMap identity; no temporary DOM IDs) | P9 shadow/preview scenario |
| U-14 | P2 | `tests/src/domain/boundary.test.ts`; `tests/src/domain/evaluate.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P9 canonical marking scenario |
| U-15 | P1 | `tests/src/popup/root-recovery.test.ts`; `tests/c3-popup-entrypoint.test.ts` | `pnpm check` and bundle gate |
| U-16 | P1 | `tests/transfer-payload-store.test.ts`; `tests/capture-page-snapshot-handler.test.ts` | P9 large-corpus scenario |
| U-17 | P4 | `tests/device-emulation-lifecycle.test.ts`; planned manual-control absence assertion | production package inspection |
| U-18a | P8 | planned cache/unregister action tests | P11 cache and unregister flow |
| U-18b | P7 | `tests/popup-render-mode.test.ts`; `tests/render-mode-inspector.test.ts` | P11 manual inspection |
| U-18c | P6 | `tests/no-autonomous-backend-io.test.ts`; `tests/src/domain/todo.test.ts` | P11 feed-owned page types |
| U-18d | P7 | planned production/debug preview-classification snapshots | production/debug build gates |
| U-18e | P8 | planned debug-toolkit positive/production-negative tests | production/debug build gates |
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
| D-11 | P3 | `tests/mark-mode-fsm.test.ts`; `tests/c4-content-entrypoint.test.ts` | P11 Space recovery paths |
| D-12 | P3 | `tests/c4-content-entrypoint.test.ts`; `tests/src/content/marking/dom-bridge.test.ts` | P11 passthrough/busy visuals |
| D-13 | P7 | `tests/render-mode-inspection-handlers.test.ts`; planned overlay lifecycle test | P11 inspection teardown |
| D-14 | P3 | `tests/src/content/marking/dom-bridge.test.ts`; production-negative bundle rechecked in P10 | production/debug build gates |
| D-15 | P3 | `tests/src/content/marking/dom-bridge.test.ts` | P11 geometry matrix |
| D-16 | P3 | `tests/src/popup/app.test.ts` | production popup inspection |
| D-17 | P7 | `tests/preview-tooltip.test.ts`; planned hover/scroll correspondence test | P11 preview-list interaction |
| D-18 | P7 | planned internal-to-production classification mapping snapshots | production/debug build gates |
| D-19 | P7 | planned constrained-preview event firewall tests | P11 blocked-actions/allowed-scroll matrix |
| D-20 | P4 | planned hidden-document reveal deferral test | P11 hidden-tab activation |
| D-21 | P4 | `tests/src/content/stabilization/stabilization.test.ts`; planned generation follow-up case | P11 concurrent activation |
| D-22 | P4 | `tests/core-motion-pause.test.ts`; `tests/page-motion-freeze.test.ts` | P11 motion-source matrix |
| D-23 | P4 | `tests/core-visibility.test.ts`; planned entrance-vs-semantic-hidden fixtures | P11 hidden-content matrix |
| D-24 | P4 | `tests/page-motion-freeze.test.ts`; `tests/src/page-world/program.test.ts` | P11 late-motion lifecycle |
| D-25 | P6 | planned bounded navigation-inspection fallback tests | P11 unknown/dirty navigation |
| D-26 | P7 | planned render-inspection watchdog/retry tests | P11 stalled-inspection recovery |
| D-27 | P6 | planned candidate-navigation cleanup/failure integration test | P11 navigation failure recovery |
| D-28 | P5 | `tests/src/background/auth-token-monitor.test.ts`; `tests/src/lynx/token-rotation.test.ts` | P11 endpoint/token invalidation |
| D-29 | P8 | planned dynamic-action-icon state test | production action-icon inspection |
| D-30 | P8 | planned manifest/global-shortcut absence test; `tests/mark-mode-fsm.test.ts` | production package inspection |
| D-31 | P1 | `tests/src/popup/root-recovery.test.ts`; `tests/src/popup/entrypoint.test.ts` | P11 panel corruption recovery |
| D-32 | P8 | planned popup scroll-lock lifecycle test | P11 modal/busy teardown |

## Integrated evidence

- **P9:** scenario tests cover the state of background, content, popup, Hub
  fixtures, and saved/captured artifacts for all decisions.
- **P10:** `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build:debug`, and
  `pnpm verify` plus production/debug reachability and performance gates.
- **P11:** production build on `bonliva.se` against live Alpha, with the matrix
  and artifact identities recorded in the active execution plan.
