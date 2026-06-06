# Full Codebase Review — Unfluffify

Reviewed at HEAD `e76b01a` (v1.2.0), 2026-06-06. Holistic codebase-level pass
on top of the per-module work recorded in `.copilot/subsystem-inspection.md`
(original 9 findings, Tier 1/2/3, `content/core.js` high-risk paths,
remote-support security pass, UI/UX). This document is the standing record of
that review.

## Overall verdict: healthy / shippable. No High or Medium open issues.

~68k JS LOC across 45 source files + 50 test files (MV3 extension). Builds
cleanly, full `npm test` 559/559 (`# fail 0`), live AI-submission and
property-lock smokes pass.

## Strengths

- **Zero runtime dependencies.** `package.json` declares no `dependencies`; the
  only vendored code is Preact (committed under `popup/vendor/`). Near-zero
  supply-chain surface.
- **Strong test posture.** 50 test files vs 45 source files; deterministic
  runner (after F6 removed `--test-force-exit`); extensive source-pattern guards
  lock contracts against regression.
- **Clean, self-contained build.** `npm run package:extension` uses
  reachability-based staging — exactly 76 files, no `tests/`/`.copilot`/
  `node_modules`/smoke/profile leakage; brand fonts (Inter, JetBrains Mono) and
  the MDI glyph font are bundled.
- **Hygiene.** No secrets / tokens / `.env` / `.key` / `.pem` / the auth-bearing
  `.mcp-browser-profile` are tracked; no `TODO`/`FIXME`/`HACK` debt in source.
- **Security contracts enforced and verified.** No remote-control replay; ICE
  config fails closed at two layers; snapshot sanitizer leak-proof; DevTools
  mirror panels render via `textContent` only; page telemetry now travels over a
  private MessagePort.
- **Coherent architecture.** Clear world separation (background = durable
  authority, content = live DOM authority, popup = UI/intent); a single
  `common/world-messaging-contract.js`; per-tab serialization queues for
  debugger/scripting ops (F1 page-motion control + T2-a device emulation);
  per-pass element-computation caching across marking and silent-highlight.

## Consolidated risk register (no active bugs)

| ID | Area | Status |
|----|------|--------|
| F1–F9 | original code inspection | Fixed |
| T1-a / T1-b | config timestamp types / selector-cache filter contract | Fixed |
| T2-a / T2-b | device-emulation serialization / reconcile-reason dedup | Fixed |
| T3-a | page telemetry bridge | Fixed (private port); irreducible handshake residual accepted |
| 50m (sub-2/sub-6) | silent-highlight collection computation cache | Fixed |
| UI fonts / `--mono` | injected-UI font uniformity + popup mono var | Fixed |
| **CR-1** | over-broad `web_accessible_resources` | **Fixed (2026-06-06)** |
| **CR-2** | content-main page-console warn/error | **Fixed (2026-06-06)** |

## New codebase-level findings

### CR-1 (Low / hardening): over-broad `web_accessible_resources` — FIXED
`manifest.json` exposes `common/*.js` and `content/*.js` as web-accessible to
`<all_urls>`. Only a subset is actually injected into the page world
(`content-main.js` + its import graph). The rest — background-only modules such
as `common/remote-support-background.js`, `common/config.js`,
`common/property-lock-background.js` — are fetchable by any page via
`chrome-extension://<id>/common/…`.
- **Impact:** minor — source/implementation disclosure plus an install/version
  fingerprint. No code execution (a page can fetch the source, not run it in
  extension context).
- **Fix approach:** narrow `web_accessible_resources` to the precise set of
  modules imported into the page world (trace `content-main.js`'s static import
  graph; the page-world-injected files are content-main + the `content/*` and
  `common/*` modules it imports, plus `remote-support-viewer.*`, the cursors,
  and the MDI font). Under-scoping breaks a dynamic `import()`, so verify with
  the live AI-submission smoke (`hasFreezeNode`/`snapshot.ok`) and a
  remote-support load after tightening.
- **Resolution (2026-06-06):** `manifest.json` now enumerates the exact
  page-world module graph instead of exposing `common/*.js` and `content/*.js`.
  Background-only modules are no longer web-accessible.
- **Validation:** focused manifest/source tests green; full `npm test` green
  (`# tests 561`, `# pass 561`, `# fail 0`).

### CR-2 (Low / consistency): page-context console warn/error in content-main — FIXED
`content-main.js` has three `console.warn/error` calls that print to the
customer page console by default (it runs in the ISOLATED world of the page):
- `~2930` `console.warn("Failed to clear page-save reconciliation after save failure", …)`
- `~3006` `console.error("Failed to enable marking from page:", …)`
- `~6590` `console.warn("[Unfluffify] Property lock sync failed; retrying.", …)`

These are error-level diagnostics for genuine failures (more defensible than the
activation/scroll noise removed in F9), but for full consistency with the F9
"quiet on customer pages by default" principle they should be gated behind trace
mode or routed to extension telemetry.
- **Out of scope (correctly noisy where they are):** background-SW console calls
  (`background.js`) and popup console calls (`popup.js`) do not touch customer
  page consoles.
- **Fix approach:** wrap these three in the existing trace/diagnostic gate (the
  same mechanism F9 used) or forward via the telemetry path.
- **Resolution (2026-06-06):** the three warn/error diagnostics now route
  through a shared `logContentDiagnostic` helper gated by `worldTraceEnabled`,
  so normal trace-off pages stay quiet.
- **Validation:** focused source-guard tests green; full `npm test` green
  (`# tests 561`, `# pass 561`, `# fail 0`).

## Noted, not a defect: pervasive error-swallowing
~302 empty / error-swallowing `catch` blocks across source. This is a
deliberate "instrumentation must never break the host page" pattern (most carry
explanatory comments) and is appropriate for an `<all_urls>` content script. No
action recommended — but it is a large surface where a genuine error could be
silently masked, so keep it in mind when debugging field issues.

## Recommendation
Ship as-is. CR-1 and CR-2 are now closed; remaining outstanding work is
human-gated (2-profile remote-support validation) or optional deeper audits.
