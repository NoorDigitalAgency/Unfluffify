# P17 canonical preview browser gate

This gate builds separate production and debug browser runtimes around the
shipping preview evaluator, typed bus schemas, content row controller, popup
projection, and React `App`. A deterministic page contributes exactly one row
for each canonical classification:

- `explicit-included`
- `implicit-included`
- `excluded`
- `undetected`
- `immutable`
- `closed-shadow`

The Chromium controller checks the content → bus → popup round trip, readable
and safely rendered copy, production-only simple status, debug-only technical
detail and native diagnostic tooltip, shadow provenance, physical pointer
hover/leave/click behavior, exact center scrolling, stable element and React-row
identity after an XPath-changing mutation, stale-projection rejection, and
absence from the keyboard focus order. Production rows and their descendants
are both required to omit diagnostic `title` surfaces.
It also proves that a selector-only request crosses the shipping typed bus,
content controller, engine, and popup store without changing projection or row
identity while advancing the projection revision exactly once.

Preview occurrence retirement is exercised through the production controller:
cycle-A targeting succeeds before retirement, fails both before and after the
typed cycle-B reprojection, and the cycle-B projection succeeds with a new
projection ID and the same document-stable row ID. Structural mutation coverage
keeps production emphasis active while an XPath changes, proves the engine
rebinds the physical overlay to the new XPath, then removes that target and
proves both projection membership and emphasis are cleared.

Two lifecycle races deliberately remain at their owning production boundaries
instead of being modeled here. `tests/src/popup/entrypoint.test.ts` defers a real
popup `preview.project` reply across preview exit and proves the late reply is
not adopted. `tests/c4-content-entrypoint.test.ts` drives the real same-document
URL watcher and proves it clears hover, disposes the route-A engine, and creates
a new route-B engine before an immediate typed projection. Keeping those checks
in the entrypoints prevents this browser harness from implementing a second
lifecycle authority.

Acceptance runs require a clean worktree and retain a JSON artifact under
`output/playwright/p17-preview/`. Smoke runs accept a dirty source set and retain
their artifact in `/tmp`. Both modes hash the harness sources, exact esbuild
inputs, and ephemeral production/debug bundles; the bundles and browser session
directory are removed before the result is accepted.

Commands:

```sh
pnpm performance:p17:smoke
pnpm performance:p17
```
