# P18 transient-surface and toast browser gate

This gate owns `ACCEPT-P18-TRANSIENT-ESCAPE` and `ACCEPT-P18-TOASTS`.
It uses separate real Chromium documents for the popup and inspected page so a
surface in one extension realm cannot incorrectly compete with a surface in the
other.

The popup fixture mounts the shipping React `App`, popup store, event source,
transient-surface manager, toast controller, scroll lock, and production CSS.
The inspected-page fixture starts the shipping content entrypoint behind a
deterministic background-authority adapter. Physical right-click therefore
flows through the actual content listener, canonical marking engine, and
shipping marking menu. The adapter supplies only external browser/background
answers; it contains no surface ordering or marking action model.

The browser catalog uses physical pointer and keyboard input for menu mutual
exclusion, outside dismissal, nested topmost-only Escape, busy protection, the
Preview Escape request boundary, popup scroll restoration, content right-click
integration, and restored marking interaction. Popup and content notifications
are produced by their shipping toast controllers. Playwright's browser clock
advances those production timeout callbacks to prove replacement, manual close,
and the exact 1.8/4/6 second deadlines without duplicating a scheduler.

Some authority deliberately stays in focused tests. Popup/content entrypoint
regressions own completed preview restoration and irreversible work that is
already in flight. Pure manager and fake-clock tests own listener/timer resource
cleanup. Manifest and build tests own global-shortcut absence and production
artifact stripping. The browser report names those files instead of recreating
their authority inside the fixture.

The modules listed by `REQUIRED_PRODUCTION_SEAMS` are bundle inputs and appear
in the artifact's exact source manifest. The fixture contains no local surface
manager, toast component, or toast scheduler.

Commands:

```sh
pnpm performance:p18:smoke
pnpm performance:p18
```

Smoke runs accept a dirty source set and retain their report in `/tmp`.
Acceptance runs require a clean worktree and retain an immutable report under
`output/playwright/p18-transient-toast/`. Both modes hash the harness, exact
bundle inputs, ephemeral bundles, browser errors, and complete cleanup state.
