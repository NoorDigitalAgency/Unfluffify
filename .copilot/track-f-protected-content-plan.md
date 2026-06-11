# Track F Dedicated Plan - Protected Content Areas

Last updated: 2026-06-11
Branch: main

## Approval

Track F required explicit user approval before implementation.

Approval evidence:
- Assistant reported that Track F required explicit approval before starting.
- User replied: "Continue" on 2026-06-11.

## Phase F1 - Page Toast Helper Extraction

Why this phase:
- `content-main.js` still owns page-toast style/DOM/timer logic that is independent
  from marking decisions.
- This is the lowest-risk Track F extraction and reduces main-file UI utility
  surface while preserving behavior.

New module:
- `content/page-toast.js`

Files to edit:
- `content-main.js`
- `content/page-toast.js`
- `manifest.json`
- `tests/content-decomposition-boundary.test.js`
- Add `tests/page-toast.test.js`

Exact function boundary:
- Move page-toast internals currently inside:
  - `ensurePageToastStyle`
  - `showPageToast`
- Keep a thin `showPageToast` wrapper in `content-main.js` so current call sites
  remain unchanged.
- Keep snapshot stripping behavior (`#unfluffify-page-toast` and
  `#unfluffify-page-toast-style`) exactly preserved.

Rules:
1. Do not alter toast copy strings or call sites.
2. Do not alter toast display duration (3000ms).
3. Keep `data-uf-extension-ui="true"` on toast root.
4. Keep style z-index/position/animation semantics unchanged.
5. Do not touch marking, selector, or silent-highlight decision logic.

Focused validation:
```bash
npm test -- tests/page-toast.test.js tests/content-decomposition-boundary.test.js tests/manifest-permissions.test.js tests/content-activation-order.test.js
```

Full validation:
```bash
npm test
```

Live validation:
- Optional for this phase; proceed only if automated tests and code review are
  not sufficient.

Rollback criteria:
- Any regression in content activation/order tests, snapshot stripping, or UI
  filtering behavior should trigger rollback of the phase.

Commit message:
```text
refactor(content): extract page toast helper
```
