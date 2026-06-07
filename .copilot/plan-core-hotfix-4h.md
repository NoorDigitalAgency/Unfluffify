# Core Hotfix Sprint Plan

Date: 2026-06-07
Branch: main

## Objective

Stabilize core spinner/curtain and silent-highlight behavior reported in the
20-issue bug report. Fix and VERIFY each issue against the real loaded
extension - source reasoning and source-snapshot tests are NOT sufficient for
runtime/visual bugs.

## How to work (mandatory)

Use the live debugging methodology documented in
`.copilot/handoff-core-hotfix.md` ("Live debugging methodology"). In short:
launch the extension headed via Playwright with `--remote-debugging-port=9222`
and a persistent profile, connect over CDP, open an instrumented
`popup.html?debugTabId=<tabId>` page (the Chrome side panel is NOT instrumentable
over CDP), drive it with `popup.click(...)`, and poll a timeline of the popup
`#ui-curtain` + `window.__ufSpinnerDebug()` + broker `getUfBackgroundState` +
content `getInspectionStatus`. Reload code changes with `chrome.runtime.reload()`
via the service worker and re-run the driver. Harness scripts live in
`~/.uf-blink-harness/` (reference copies in `.scratch-blink-test/`).

Key principle proven by this sprint: the bug is usually a DIVERGENCE between
layers (popup-local view state vs background broker vs content status). Always
read all three.

## Rules

1. Fix P0/P1 regressions only; no net-new features.
2. Keep changes minimal, deterministic, and reconciliation-based (avoid
   fixed-time give-ups - issue #2 was exactly a premature give-up).
3. Verify every fix LIVE, capture the before/after timeline, THEN record it.
4. Update this plan and the handoff after every fix. Commit and push per fix.
5. Do not weaken the locked marking contract.

## Issue clusters and status

See `.copilot/handoff-core-hotfix.md` "Issue status" for the authoritative,
per-issue state. Summary:

- Cluster 1 (lifecycle/spinner, messaging): #1 FIXED, #2 FIXED, #5 FIXED,
  #3 OPEN (next), #4 OPEN (low), #20 OPEN.
- Cluster 2 (silent/preview): #6 OPEN, #16 OPEN (very high).
- Cluster 3 (mode transitions/temp reset): #15, #17 (very high), #18, #19 OPEN.
- Cluster 4 (property-lock countdown loop): #10, #11, #12 OPEN.
- Cluster 5 (confirmations/debugger): #7, #8, #9 OPEN.
- Cluster 6 (render-mode/conditional UI): #13, #14 OPEN.

## Priority order for remaining work

1. #3 spinner-never-reappears-after-refresh (Cluster 1, completes the messaging
   layer the user emphasized).
2. Re-evaluate B1.1 background change (premature navInspect clear risk) - see
   handoff CORRECTION.
3. #16 preview list visibility (very high) and #17 AI-exit cannot save (very high).
4. #20, #4 (finish Cluster 1), then Clusters 3-6.

## Verified-fix log

- #1 silent blink: commits 62ea6a3, 8747835 (run.mjs: 6->0 hide/reveal cycles).
- #2/#5 stuck inspection curtain: commit 8eba026 (drive2.mjs: curtain clears
  when content settles instead of sticking; popup reconciler no longer gives up
  early and fails open).

## Commit convention
- hotfix(core): <concise description> (live-verified)
