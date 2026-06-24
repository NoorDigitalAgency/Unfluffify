# WXT Port + Brain Program Handoff (for low-context implementation agent)

## Read first (mandatory, in order)

1. `.copilot/knowledge.md`
2. `.github/instructions/agent-workflow-guardrails.instructions.md`
3. `.github/instructions/browser-launch.instructions.md`
4. `.github/skills/launch-test-browser/SKILL.md`
5. `.copilot/wxt-port-plan.md` (program INDEX: Part A phases + Part B pointer)
6. `.copilot/event-bus-architecture-plan.md` (Part B master spec, WXT-adapted)
7. `.copilot/event-bus/track-00-foundation.md` (Part B Track 0, full detail)
8. `.copilot/event-bus/track-template.md` (Part B per-domain executor-doc template)

## Program shape (two parts, sequenced)

- **Part A — WXT toolchain cutover** (`wxt-port-plan.md` §6): pnpm + WXT + Vitest,
  behavior-preserving. The current runtime modules are wrapped by `entrypoints/*`;
  their internals are not touched. The Brain is NOT introduced in Part A.
- **Part B — Brain (event-bus) rearchitecture** (the event-bus doc set): runs on
  the stable WXT baseline AFTER Part A is complete and green.

**Sequencing (locked):** Part A fully cuts over first; then Part B. Do not build
the Brain on a half-migrated dual Deno+WXT build.

## Branch and baseline

- Working branch: `feat/wxt-port-plan`.
- Migration baseline: **current `main` behavior exactly**.
- The full Brain spec was originally authored against the legacy Deno build on
  `feat/event-bus-architecture` (commit `31ab189`). It has been **brought onto this
  branch and rewritten for the WXT baseline**; use the copies in `.copilot/` (do
  not chase the other branch). The Deno→WXT reconciliation is in
  `.copilot/event-bus-architecture-plan.md` §11.

## User-approved constraints (authoritative)

- Use **pnpm + WXT**; test runner is **Vitest**; lint is **ESLint** (all migrated
  in Part A). After the Part A cutover, no `deno task` command remains.
- Preserve behavior/contracts; tests can be refactored structurally.
- CI/CD may be redesigned to fit WXT.
- Functional target is recent Chrome; strict old manifest process is not required.
- Live debug workflow must remain functionally equivalent (command/path exactness
  not required): `pnpm browser:live <url>`.
- Phased migration with runnable checkpoints (not big-bang).
- The Brain architecture (single background Brain, stateless popup/content layers,
  typed request/publish seams) is the Part B target; it starts only after Part A.
- **WXT bundles the content entry**, so new bus/brain/layer modules are bundled and
  do NOT need individual `web_accessible_resources` entries; only
  `chrome.runtime.getURL(...)` page-world assets (cursors, injected HTML) stay
  web-accessible. This resolves the legacy "bundled content entry" gate (no GATE B).

## WXT command surface

| Purpose | Command |
|---|---|
| dev/watch | `pnpm dev` |
| type-check | `pnpm check` (`wxt prepare && tsc --noEmit`) |
| lint | `pnpm lint` (`eslint .`) |
| test | `pnpm test` (`vitest run`) |
| release build | `pnpm build` (`wxt build` → `.output/chrome-mv3/`) |
| zip | `pnpm zip` (`wxt zip`) |
| verify | `pnpm verify` |
| live browser | `pnpm browser:live <url>` |

## Authority model guardrails (Part B, mandatory)

- Background Brain owns cross-cutting policy/decisions/state projection for migrated
  domains.
- Popup/content layers stay thin: render local state, execute directives, report
  events.
- Exactly one authoritative `request` handler per type per realm.
- Use typed bus contracts and transport seams; keep the legacy bridge only as
  temporary migration scaffolding.
- Migrate domain-by-domain (strangler style), proving behavior parity at each move.
- Locked behavior (marking/silent/visibility/reconciliation/XPath/AI-submission/
  property-lock and `content/core.ts`) is wrap-only unless its approval gate
  (M/S/X/R/P, master spec §4) is granted.

## Baseline capability checklist (must stay true after each cutover)

### Runtime and UX
- Marking/highlighting locked behavior unchanged.
- Property-lock protocol behavior unchanged.
- AI-run / preview / save / reconciliation behavior unchanged.

### Build/run
- Extension builds reproducibly (`pnpm build`) and loads unpacked
  (`.output/chrome-mv3`).
- Dev workflow documented and executable (`pnpm dev`).

### Debug flow parity
- `pnpm browser:live <url>` launches the live browser against a target URL.
- Popup bound to the target tab (`debugTabId` equivalent).
- Button state + transitions inspectable (`state`/`observe`).
- Exit Preview triggerable from control flow (`exit-preview`).
- CDP attach to the same managed browser session.

### Packaging/release
- CI builds and publishes installable artifact(s) via WXT (`pnpm zip`).

## Current baseline command surface (pre-Part-A source of truth)

These are the commands and outputs that Part A must preserve in behavior before
replacing them:

| Purpose | Current Deno baseline |
|---|---|
| type-check | `deno task check` |
| test | `deno task test` |
| lint | `deno task lint` |
| release build | `deno task build:release` |
| dev build | `deno task build:dev` |
| dev watch | `deno task watch` / `deno task dev` |
| verify | `deno task verify` |
| package | `deno task package` + `deno task package:metadata` |
| live browser | `deno task browser:live <url>` |

Current build outputs and packaging inputs:

- Dev unpacked extension: `dist/extension-dev`
- Release unpacked extension: `dist/extension`
- Release packaging script: `scripts/package-extension.mjs`
- Release workflow: `.github/workflows/build-extension-package.yml`

## Current runtime entrypoint + manifest mapping (pre-Part-A source of truth)

These are the exact runtime roots and manifest bindings that the WXT entrypoints
must mirror before any Brain work starts:

- Background service worker:
  - source root: `background.ts`
  - manifest binding: `background.service_worker = "background.js"`
- Content script (MAIN world bridge):
  - source root: `common/page-motion-freeze-bridge.ts`
  - manifest binding: `"common/page-motion-freeze-bridge.js"` on `<all_urls>`,
    `run_at: "document_start"`, `all_frames: true`, `world: "MAIN"`
- Content script (ISOLATED world):
  - source roots: `content-loader.ts` -> lazy-imports `content-main.ts`
  - manifest binding: `"content-loader.js"` on `<all_urls>`, `run_at:
    "document_start"`
- Popup:
  - source roots: `popup.html` + `popup.ts`
  - runtime usage also depends on `chrome.runtime.getURL("popup.html")` in
    `background.ts`
- Offscreen document:
  - source roots: `offscreen.html` + `offscreen.ts`
  - runtime usage depends on `chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)` in
    `background.ts`

Explicit page-world / runtime asset facts that must remain true:

- Cursor assets are loaded via `chrome.runtime.getURL("cursors/*.svg")` from
  `content/core.ts` and must stay web-accessible.
- `content-loader.ts` lazy-loads `content-main.js` via `chrome.runtime.getURL(...)`;
  any WXT packaging replacement must preserve that load path behavior until the
  loader strategy is intentionally changed.
- `common/page-motion-freeze-control.ts` runs through
  `chrome.scripting.executeScript({ func })` and must NOT become a web-accessible
  resource.
- `scripts/launch-test-browser.ts` currently imports `popup/ui.js` via
  `chrome.runtime.getURL("popup/ui.js")` during live-debug inspection; the WXT
  output must preserve an equivalent inspectable popup module path.

## Baseline live-browser invariants (must survive Part A)

- The only supported current launch path is `deno task browser:live <url>`.
- The launcher builds `dist/extension-dev`, loads that unpacked output, resolves
  the runtime extension id, resolves the target page's tab id, and opens a
  second popup tab `popup.html?debugTabId=<pageTabId>` bound to the page.
- The launcher control channel must keep working with the same capabilities:
  `state`, `observe`, `exit-preview`, `stop-observe`, and CDP attach on
  `http://127.0.0.1:9222`.
- The launcher and all live validation must use only the Playwright-managed
  Chromium bound to `.mcp-browser-profile`; never the OS Chrome.

## Test-migration inventory (A0 freeze)

Current suite shape:

- Total files under `tests/`: **135**
- Files using `Deno.*` APIs directly: **3**
  - `tests/test-kit.ts`
  - `tests/file-kit.ts`
  - `tests/package-extension.test.js`
- Files using `readFileSync(...)`: **51**
- Files reading source files via `readFileSync(...)` or `readFile(...)`: **55**
- Exact source-contract/source-structure subset (source readers that also contain
  `assertMatch`, `assertNotMatch`, `toMatch(...)`, `doesNotMatch(...)`, or
  `.match(...)` assertions): **45**

Primary Deno-only migration surfaces:

- `tests/test-kit.ts` wraps `@std/testing/bdd` and `Deno.TestContext`; this is
  the test-runner abstraction to replace first when moving to Vitest.
- `tests/file-kit.ts` wraps `Deno.readTextFileSync`, `Deno.readDirSync`,
  `Deno.makeTempDir`, `Deno.Command`, and related file/process helpers; this is
  the file/process abstraction to port to Node/Vitest equivalents.
- `tests/package-extension.test.js` directly shells out through `Deno.Command`
  and validates the current packaging script; it is a dedicated packaging
  migration hotspot for Part A6/A7.

Contract-critical suites that must stay green through the toolchain cutover:

- Manifest / WAR / output shape:
  - `tests/manifest-permissions.test.js`
  - `tests/build-artifact-parity.test.js`
  - `tests/dev-reload-build-separation.test.js`
  - `tests/playwright-mcp-config.test.js`
  - `tests/package-extension.test.js`
  - `tests/package-test-script.test.js`
- Background/message hardening:
  - `tests/background-command-hardening.test.js`
  - `tests/background-command-router.test.js`
  - `tests/background-decomposition-boundary.test.js`
  - `tests/world-trace-contract.test.js`
- Popup/background authority and state:
  - `tests/popup-authority-boundary.test.js`
  - `tests/popup-background-snapshot.test.js`
  - `tests/popup-marking-refresh.test.js`
  - `tests/popup-mode-sync.test.js`
  - `tests/popup-ai-run-gating.test.js`
  - `tests/popup-page-reconciliation.test.js`
  - `tests/popup-property-lock-ui.test.js`
- Content/runtime router and boundary protection:
  - `tests/content-decomposition-boundary.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/content-main-service-registry.test.js`
  - `tests/runtime-message-handler.test.js`
- Locked behavior contracts:
  - `tests/background-marking-activation.test.js`
  - `tests/page-save-state.test.js`
  - `tests/selector-suppression.test.js`
  - `tests/silent-highlight-annotations.test.js`
  - `tests/submission-rules.test.js`
  - `tests/property-lock.test.js`
  - `tests/property-lock-background.test.js`
  - `tests/property-lock-state-machine.test.js`
  - `tests/core-motion-pause.test.js`
  - `tests/core-visibility.test.js`

Migration note for Part A4:

- Most tests are already runner-agnostic in spirit but depend on the Deno shim
  layer (`tests/test-kit.ts`, `tests/file-kit.ts`) plus source-file reads. The
  safest migration order is:
  1. port the two shim/helper files,
  2. port the manifest/build/package tests,
  3. port the source-contract suites that read raw files,
  4. then switch the global `pnpm test` command over once parity is proven.

Explicit source-reader inventory to port in Part A4 (`readFileSync(...)` or
`readFile(...)` present):

- Background / messaging / build:
  - `tests/ai-run.test.js`
  - `tests/background-command-hardening.test.js`
  - `tests/background-decomposition-boundary.test.js`
  - `tests/background-marking-activation.test.js`
  - `tests/background-remote-config-sync.test.js`
  - `tests/background-remote-network.test.js`
  - `tests/background-render-mode-inspection.test.js`
  - `tests/build-artifact-parity.test.js`
  - `tests/dev-reload-build-separation.test.js`
  - `tests/feature-flags.test.js`
  - `tests/lifecycle-broker.test.js`
  - `tests/manifest-permissions.test.js`
  - `tests/no-ts-ignore-guard.test.js`
  - `tests/package-extension.test.js`
  - `tests/package-test-script.test.js`
  - `tests/playwright-mcp-config.test.js`
  - `tests/world-trace-contract.test.js`
- Content / runtime-router / bridge / page-world:
  - `tests/content-activation-order.test.js`
  - `tests/content-decomposition-boundary.test.js`
  - `tests/content-high-risk-branches.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/content-main-service-registry.test.js`
  - `tests/page-motion-bridge-isolation.test.js`
  - `tests/page-motion-freeze-bridge.test.js`
  - `tests/page-world-relay.test.js`
- Popup / authority / render-mode:
  - `tests/popup-ai-run-gating.test.js`
  - `tests/popup-authority-boundary.test.js`
  - `tests/popup-background-snapshot.test.js`
  - `tests/popup-decomposition-boundary.test.js`
  - `tests/popup-marking-refresh.test.js`
  - `tests/popup-mode-sync.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/preview-tooltip.test.js`
  - `tests/render-mode-inspection-order.test.js`
- Locked behavior / core / storage / property-lock:
  - `tests/core-motion-pause.test.js`
  - `tests/core-scheduling.test.js`
  - `tests/device-emulation-lifecycle.test.js`
  - `tests/marking-no-auto-restore.test.js`
  - `tests/page-save-state.test.js`
  - `tests/property-lock-background.test.js`
  - `tests/property-lock-render-mode.test.js`
  - `tests/property-lock-state-machine.test.js`
  - `tests/property-lock.test.js`
  - `tests/selector-suppression.test.js`
  - `tests/shared-selector-cache.test.js`
  - `tests/silent-highlight-annotations.test.js`
  - `tests/storage-access-boundary.test.js`
- Repo/tooling guardrails and helpers:
  - `tests/file-kit.ts`
  - `tests/orchestration-auth.test.js`
  - `tests/orchestration-bus.test.js`
  - `tests/orchestration-runner.test.js`
  - `tests/theme-colors.test.js`
  - `tests/ts-suppression-budget.test.js`
  - `tests/typing-ratchet.test.js`
  - `tests/ui-font-uniformity.test.js`

Exact source-reader + regex-assert subset to port in Part A4 (45 files):

- Background / messaging:
  - `tests/ai-run.test.js`
  - `tests/background-command-hardening.test.js`
  - `tests/background-decomposition-boundary.test.js`
  - `tests/background-marking-activation.test.js`
  - `tests/background-remote-config-sync.test.js`
  - `tests/background-remote-network.test.js`
  - `tests/background-render-mode-inspection.test.js`
  - `tests/feature-flags.test.js`
  - `tests/lifecycle-broker.test.js`
  - `tests/world-trace-contract.test.js`
- Content / runtime-router / page-world:
  - `tests/content-activation-order.test.js`
  - `tests/content-decomposition-boundary.test.js`
  - `tests/content-high-risk-branches.test.js`
  - `tests/content-main-runtime-router-contract.test.js`
  - `tests/content-main-service-registry.test.js`
  - `tests/page-motion-bridge-isolation.test.js`
  - `tests/page-motion-freeze-bridge.test.js`
- Popup / authority / render-mode:
  - `tests/popup-ai-run-gating.test.js`
  - `tests/popup-authority-boundary.test.js`
  - `tests/popup-background-snapshot.test.js`
  - `tests/popup-decomposition-boundary.test.js`
  - `tests/popup-marking-refresh.test.js`
  - `tests/popup-mode-sync.test.js`
  - `tests/popup-render-mode.test.js`
  - `tests/preview-tooltip.test.js`
  - `tests/render-mode-inspection-order.test.js`
- Locked behavior / core / property-lock:
  - `tests/core-motion-pause.test.js`
  - `tests/core-scheduling.test.js`
  - `tests/device-emulation-lifecycle.test.js`
  - `tests/marking-no-auto-restore.test.js`
  - `tests/page-save-state.test.js`
  - `tests/property-lock-background.test.js`
  - `tests/property-lock-render-mode.test.js`
  - `tests/property-lock-state-machine.test.js`
  - `tests/property-lock.test.js`
  - `tests/selector-suppression.test.js`
  - `tests/shared-selector-cache.test.js`
  - `tests/silent-highlight-annotations.test.js`
- Build / launcher / orchestration / repo guardrails:
  - `tests/orchestration-auth.test.js`
  - `tests/orchestration-bus.test.js`
  - `tests/orchestration-runner.test.js`
  - `tests/playwright-mcp-config.test.js`
  - `tests/theme-colors.test.js`
  - `tests/ts-suppression-budget.test.js`
  - `tests/ui-font-uniformity.test.js`

## Execution todos (from SQL `todos`/`todo_deps`)

Part A (sequential):
- `wxt-a0-baseline-inventory`
- `wxt-a1-bootstrap-toolchain`
- `wxt-a2-entrypoint-adapters`
- `wxt-a3-manifest-war-parity`
- `wxt-a4-vitest-eslint-migration`
- `wxt-a5-browser-live-debug-flow`
- `wxt-a6-ci-release-migration`
- `wxt-a7-cutover-cleanup`

Part B (depends on `wxt-a7-cutover-cleanup`, then predecessors per master spec §7):
- `bus-track0-foundation` … `bus-track13-legacy-teardown`

Follow the dependency order in `todo_deps`.

## Immediate next action for implementer

`wxt-a0-baseline-inventory` is complete. Start `wxt-a1-bootstrap-toolchain`:

1. Add `package.json` with the canonical pnpm/WXT/Vitest/ESLint scripts from
   `.copilot/wxt-port-plan.md` §5a and Phase A1.
2. Add `wxt.config.ts`, `eslint.config.js`, and `vitest.config.ts` scaffolding,
   keeping the current Deno tasks alive temporarily in parallel.
3. Validate `pnpm wxt --help`, `pnpm check`, and the existing `deno task check`
   before moving to `wxt-a2-entrypoint-adapters`.

Do NOT start Part B (Brain) until `wxt-a7-cutover-cleanup` is done and
`.copilot/event-bus-architecture-plan.md` §0 preconditions all hold. Then proceed
phase-by-phase from `.copilot/wxt-port-plan.md` and track-by-track from the
event-bus doc set.
