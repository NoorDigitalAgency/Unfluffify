# Next Agent Handoff

Read this after `.copilot/plan.md`, `.copilot/knowledge.md`, and
`PROPERTY_LOCK.md`.

## Current Status (2026-06-06)

Phase 1 (dirty signal / beforeunload guard), Phase 2 (editor-mobile-only,
desktop preview, property-lock lifecycle), and Phase 3 (orphan payload sweep)
are all implemented and validated. A full code-review pass of the agent commit
`b41c50f` was completed and all drifts were fixed:

1. Desktop preview section placement — moved inside `div.app` grid, outside
   `renderMarkingView`, so it's view-independent.
2. Activity signals — general page input now triggers debounced
   `sendPropertyLockActivity()` (not just marking-specific actions).
3. Dead code — `setReloadRestoreTabState` removed; `tabs.onUpdated` no longer
   reads the restore scope.
4. Tooltip — `mobileSimulationHotkey` text updated to `"M"` and restored to
   the desktop preview label row.
5. Plan — corrected `47/47` test count (was a partial run; full suite is 493+).

**Test status: all green (`# fail 0`). The total count is non-deterministic
(observed 532/521/482/463/515 across runs) because `package.json` uses
`node --test --test-force-exit`, which truncates the subtest counter on exit —
see Finding 6 in `.copilot/code-inspection-remediation-plan.md`. Judge the
suite by `# fail 0`, not a fixed number. All syntax checks clean.**

Pre-implementation Q&A for the 9 remediation findings is complete. The user's
chosen decisions are recorded in
`.copilot/code-inspection-remediation-plan.md` under "Q&A Decisions Recorded
Before Implementation". Use those choices as binding implementation guidance
before changing runtime behavior.

Additional fixes landed after the initial drift audit:
- `onBeforeNavigate` → `onCommitted` for marking teardown (critical: prevents
  "Stay" dialog rejections from destroying the session).
- `setTabState` utility no longer writes to the restore scope.
- Removed `setTabState(tabId, tabState)` race-prone call in `tabs.onUpdated`.
- `setReloadRestoreTabState` dead function removed.
- `getReloadRestoreTabState` fallback removed from `tabs.onUpdated`.
- Remediation Phase 1 is complete:
  - F3 `disable()` now flushes pending draft/snapshot persistence using
    captured pre-clear state.
  - F2 popup/background no longer resurrect marking from stale `restore` scope.
  - F1 page-motion bridge is loaded just-in-time through background
    `chrome.scripting.executeScript({ world: "MAIN" })`; the old startup
    `common/page-motion-freeze.js` bridge and public marker listener are gone.
- Latest Phase 1 validation: focused motion tests green; marking guard suite
  green (`190` pass); full `npm test` green (`# pass 530`, `# fail 0` in the
  latest run); syntax checks clean; live AI-submission smoke passed on
  Bonliva and Prowork with `snapshot.ok=true`, `errs=0`, and
  `hasFreezeNode=false` at startup.
- Remediation Phase 2.1 is complete:
  - F4 async marking reconcile now honors aborts after candidate merge, during
    late silent-whitespace/previous-item loops, and immediately before entry
    mutation/persistence.
  - New regression coverage verifies late aborts do not mutate an existing
    entry and do not insert a newly-created entry into `pageMarkings`; a source
    guard locks the final abort check before `entry.includeXpaths`/`entry.xpaths`
    commit.
  - Latest Phase 2.1 validation: focused scheduling/visibility tests green
    (`86` pass); marking guard suite green (`193` pass); full `npm test` green
    (`# pass 521`, `# fail 0` in the latest run); syntax checks clean; live
    AI-submission smoke passed on Bonliva and Prowork with `snapshot.ok=true`,
    `errs=0`, and `hasFreezeNode=false` at startup.

## What's Left

### PRIORITY: Code-inspection remediation (9 findings)

A two-reviewer code inspection produced 9 verified findings in
`CODE_INSPECTION_TODO.md`. The ordered, phased fix plan with acceptance
criteria and per-item test plans is in
**`.copilot/code-inspection-remediation-plan.md`** — start there.

Phase order (severity-first):
- **Phase 1 (High): complete.** F3 disable() draft flush → F2 popup stale
  restore-scope resurrection → F1 page-motion bridge public control surface.
- **Phase 2 (Medium): in progress.** F4 async reconcile abort coverage complete
  → F5 SPA/hash nav
  silently discarding a dirty session (needs a product decision — captured in
  the plan, default recommendation given).
- **Phase 3 (Medium-low):** F7 Save Session infinite retry → F6 non-
  deterministic test count (root cause: `--test-force-exit`).
- **Phase 4 (Low):** F8 stale names/comments + F9 content-script console logs
  (safe to batch).

Suggested commit sequence and standing validation rules are in the plan.
**Do not change the locked marking contract to make a fix easier.**

### Other open items (lower priority than the 9 findings)

1. **Phase 2 live validation** — requires a real browser session with
   property auth (Bonliva or similar). Run
   `xvfb-run -a node scripts/smoke-property-lock-phase2.mjs <candidate-url> <cross-property-url>`
   with a session that has a valid auth token. The smoke harness is more
   reliable than before (retries up to 3× on popup load). Watch for:
   - `checks.initialEditor === true`
   - `checks.crossPropertyCountdown === true` (popup shows "Return to it
     within N seconds")
   - `checks.returnRecovered === true` (popup shows "You are editing")

2. **Remote Support Follow-up** (manual, 2-profile) — see plan.md.

3. **Silent-highlight sub-2/sub-6 deeper** — optional, profiling-gated.

## What NOT To Do

- Do not invent new Phase 2 behavior slices unless you find a real bug.
- Do not change the marking-rules contract.
- Do not touch IDB payload handling beyond what's already in place.

## Files Most Relevant To Remaining Work

- `scripts/smoke-property-lock-phase2.mjs` — for live Phase 2 validation
- `popup.js`, `content-main.js`, `background.js` — core logic
- `common/property-lock-background.js` — WS runtime
- `tests/device-emulation-lifecycle.test.js` — Phase 2 guard tests
- `tests/popup-marking-refresh.test.js`, `tests/property-lock*.test.js`

## Practical Notes

- Full suite: `npm test`
- Syntax check: `node --check popup.js && node --check background.js && node --check content-main.js`
- AI-submission live smoke: `xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/smoke-ai-submission.mjs <url>`
- Phase 2 property-lock smoke: `xvfb-run -a node scripts/smoke-property-lock-phase2.mjs <candidate-url> <cross-property-url>`
- Use the persistent repo browser profile (`.mcp-browser-profile`) for live validation, not a fresh profile — it has auth state and Developer Mode enabled.
