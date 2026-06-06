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

**Test status: all green. Finding 6 removed `--test-force-exit` from
`package.json`; after backlog C guard tests, the latest full `npm test`
reports `# tests 553`, `# pass 553`, `# fail 0`. All syntax checks clean.**

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
- Remediation Phase 2.2 is complete:
  - F5 URL watcher teardown now uses the previous page URL for pending draft
    persistence and temporary disabled-draft caching.
  - Dirty same-base same-document URL changes preserve the temporary draft
    cache; clean same-base and dirty cross-base transitions keep the discard
    behavior.
  - Regression coverage simulates pushState-style, replaceState-style, hash,
    clean same-base, and dirty cross-base transitions.
  - Latest Phase 2.2 validation: focused URL/disable tests green (`46` pass);
    marking/navigation guard suite green (`243` pass); full `npm test` green
    (`# pass 505`, `# fail 0` in the latest run); syntax checks clean; live
    AI-submission smoke passed on Bonliva and Prowork with `snapshot.ok=true`,
    `errs=0`, and `hasFreezeNode=false` at startup.
- Remediation Phase 3.1 is complete:
  - F7 Save Session retries are bounded to five one-attempt sync tries with the
    existing backoff cadence.
  - Repeated retryable failures now surface the save-failed status/toast,
    refresh the popup, and exit the spinner without applying the post-save
    silent transition or clearing the dirty draft.
  - No new cancel button was added because the existing save overlay has no
    natural action slot; the bounded terminal failure path preserves local work
    and lets the user retry later.
  - Latest Phase 3.1 validation: focused popup save tests green (`63` pass);
    popup/marking guard suite green (`318` pass); full `npm test` green
    (`# pass 545`, `# fail 0` in the latest run); syntax checks clean. Live
    smoke was not required because this phase changes popup retry control flow,
    not content activation or snapshot behavior.
- Remediation Phase 3.2 is complete:
  - F6 test-count stabilization used the technical fix path: `package.json`
    now runs plain `node --test` without `--test-force-exit`.
  - A package-script guard test locks the clean test runner command.
  - Latest Phase 3.2 validation: focused package tests green (`3` pass); five
    consecutive full `npm test` runs all reported `# tests 546`, `# pass 546`,
    `# fail 0`.
- Remediation Phase 4 is complete:
  - F8 stale taxonomy wording/test naming is corrected without changing marking
    behavior.
  - F9 content-loader activation logs and consent scroll-restore logs are
    removed from production page consoles; opt-in trace/toggle-perf diagnostics
    remain available.
  - New source guard coverage rejects bare production content-loader and
    consent scroll-restore `console.*` calls.
  - Latest Phase 4 validation: focused content/marking/trace tests green
    (`55` pass); broader content/marking guard green (`325` pass); full
    `npm test` green (`# tests 547`, `# pass 547`, `# fail 0`); syntax checks
    clean; live AI-submission smoke passed on Bonliva and Prowork with
    `snapshot.ok=true`, `errs=0`, and `hasFreezeNode=false` at startup.

## Already complete (do NOT redo)

- **All 9 code-inspection findings (F1–F9): FIXED.** Phased plan + acceptance
  criteria + the user's binding Q&A decisions are in
  `.copilot/code-inspection-remediation-plan.md`. Treat as history.
- **Subsystem inspection: COMPLETE.** Tier 1, Tier 2, `content/core.js`
  high-risk paths, Tier 3, and a targeted remote-support/DevTools security pass
  are all done and recorded in `.copilot/subsystem-inspection.md` (with passing
  cross-checks). Locked contracts verified enforced (no remote-control replay;
  ICE config fails closed; snapshot sanitizer leak-proof; DevTools panels
  `textContent`-only).
- **Backlog A cheap hardening: COMPLETE.** T2-b now has a single exported
  non-blocking reconciliation-reason set shared by config and page-save UI;
  T1-a timestamp parsing accepts the documented `string|Date|number` inputs;
  T1-b selector-cache filtered-result key requirements are documented.
  Validation: focused config/page-save/selector suites green (`50` pass), full
  `npm test` green (`# tests 550`, `# pass 550`, `# fail 0`), syntax checks
  clean, and Bonliva AI-submission smoke passed (`snapshot.ok=true`, `errs=0`).
- **Backlog B T2-a device-emulation serialization: COMPLETE.** `common/emulation.js`
  now serializes debugger attach / metrics override / clear / detach paths
  per tabId using the F1 queue pattern, covering both `updateDeviceEmulation`
  and `clearDeviceEmulationAfterNavigation`. Validation: focused device
  lifecycle suite green (`23` pass), full `npm test` green (`# tests 551`,
  `# pass 551`, `# fail 0`), and `node --check` clean for
  `common/emulation.js` plus the lifecycle guard test.
- **Backlog C T3-a page-telemetry bridge hardening: COMPLETE.**
  `content-main.js` no longer installs the MAIN-world page bridge at startup.
  The bridge is installed only while the tab is in an active
  `being_supported` remote-support session, control/telemetry messages carry a
  per-session nonce, page-supplied `tabId` is dropped before forwarding, and
  `common/extension-telemetry.js` can restore page `console` / `fetch` / XHR
  wrappers on teardown. Validation: focused telemetry/remote-support suites
  green (`45` pass), full `npm test` green (`# tests 553`, `# pass 553`,
  `# fail 0`), syntax checks clean, and Bonliva AI-submission smoke passed
  (`snapshot.ok=true`, `errs=0`, `hasFreezeNode=false`).
- **Backlog D human-gated validations: PARTIAL.** Phase 2 live property-lock
  validation passed with the persistent repo profile and real auth/config.
  Remote-support two-profile validation remains BLOCKED for a human with two
  real Chrome profiles plus screen/camera/microphone permission prompts.
- **Backlog E optional deeper audit: COMPLETE.** Bounded source inspection was
  completed for `content/core.js` rendering/scheduling/teardown and remote
  support reliability internals (background lifecycle, offscreen/viewer WebRTC
  transport, chunk reassembly, buffer limits, media-track cleanup, stale channel
  guards). No new code finding was opened. Focused audit validation passed
  (`208` pass), and the full suite remained green (`# tests 553`, `# pass 553`,
  `# fail 0`).

## What's Left — actionable backlog

Nothing here is an active bug; the branch is shippable as-is. The only
remaining item is human-gated remote-support validation that cannot be honestly
completed inside a single automated profile. Each item below has its own
pointers and acceptance criteria so it can be executed directly.
Full rationale for every finding is in
`.copilot/subsystem-inspection.md` ("Improvement-plan assessment" table).

### A. Cheap hardening batch — COMPLETE

Closed three Low findings without changing the locked marking contract.
Source-guard/runtime coverage was added for each item.

1. **T2-b — de-duplicate the non-blocking reconciliation-reason list.**
   - Source of truth: `common/config.js`
     `NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS` (≈ lines 36–46).
   - Duplicate to remove: the inline array in `isBlockingPageSaveReconciliation`
     in `common/page-save-state.js` (≈ lines 7–17).
   - Action: export the set from `config.js` (or a shared constants module) and
     import it in `page-save-state.js`.
   - Status: complete. `common/config.js` exports the set and
     `common/page-save-state.js` imports it; guard coverage asserts the shared
     source and matching UI/config behavior.

2. **T1-a — fix `isIncomingTimestampNewer` type/JSDoc mismatch.**
   - File: `common/config.js`. `parseTimestampMillis` (≈ line 233) only accepts
     strings (non-strings → NaN → treated as oldest), but the JSDoc on
     `isIncomingTimestampNewer` (≈ line 286) claims `string|Date|number`.
   - Action: EITHER make `parseTimestampMillis` accept `number`/`Date`, OR fix
     the JSDoc to "string only" and normalize/assert at the boundary.
   - Status: complete. `parseTimestampMillis` now accepts finite numeric epochs
     and valid `Date` objects; unit coverage verifies numeric and `Date`
     comparisons plus normalization.

3. **T1-b — document the selector-cache filter contract.**
   - File: `content/shared-selector-cache.js`, `collectCachedSelectorMatches`
     (≈ line 105). It caches `shouldIncludeNode`-filtered results without the
     callback in the cache key.
   - Action: add a doc-comment stating that any `shouldIncludeNode` dependency
     MUST be reflected in `suppressionFingerprint` or a generation bump
     (current sole caller already does this); optionally fold a caller-supplied
     filter fingerprint into the key.
   - Status: complete. `collectCachedSelectorMatches` now documents that
     `shouldIncludeNode` dependencies must be represented by
     `suppressionFingerprint` or a cache-clearing generation bump; source guard
     coverage locks the contract wording.

### B. T2-a — serialize device-emulation debugger ops — COMPLETE

- Original symptom to watch: emulation occasionally not applying, or the
  debugger banner appearing/leaving wrongly, after a rapid device-toggle +
  navigate. Self-heals on next popup open, but this was completed as requested
  in the autonomous backlog run.
- Files: `common/emulation.js` (`updateDeviceEmulation` — 9 call sites incl.
  the `chrome.debugger.onDetach` handler — and `clearDeviceEmulationAfterNavigation`).
- Action: reuse the F1 per-target serialization queue pattern
  (`pageMotionFreezeControlQueueByTarget` in `background.js`) for the
  device-emulation debugger path, keyed by tabId.
- Status: complete. `runDeviceEmulationOperation` chains per-tab operations and
  only clears the queue if the completing promise is still current; both
  `updateDeviceEmulation` and navigation cleanup run inside it. Source guard
  coverage locks the queue mechanics and call sites. Automated acceptance
  passed; manual rapid toggle+navigate remains optional live UX validation.

### C. T3-a — page telemetry bridge — COMPLETE

- Medium finding completed during the autonomous backlog run. Full remediation
  notes are in `.copilot/subsystem-inspection.md` (T3-a section).
- Files: `common/page-telemetry.js`, `common/extension-telemetry.js`,
  `content-main.js` (`ensurePageTelemetryBridge`,
  `handlePageTelemetryWindowMessage`).
- Required changes completed: (1) install the page telemetry bridge just-in-time
  while a support session needs it, tear down on session end (F1 lifecycle
  model); (2) gate `console`/`fetch`/`XHR` wrapping behind an `isEnabled` tied
  to an active support session; (3) authenticate the telemetry channel
  (nonce/handshake) so arbitrary page scripts cannot inject entries via the
  static `window.postMessage` marker.
- Status: complete. Page telemetry is inert until authenticated enable control
  for the active `being_supported` session; authenticated disable restores the
  original page APIs; content accepts page telemetry only while that nonce is
  current and strips any page-provided tab routing before forwarding. Source
  guards and page-module tests lock the lifecycle, nonce, and teardown
  contracts.

### D. Human-gated validations — PARTIAL

1. **Phase 2 live validation — COMPLETE 2026-06-06.**
   Command run:
   `xvfb-run -a node scripts/smoke-property-lock-phase2.mjs https://seo.se/ https://www.bonliva.no/artikler/barnehagevikar-lonn`
   using the persistent repo profile. The profile had config endpoint, stage
   base, and token present. Final checks:
   - `checks.initialEditor === true`
   - `checks.crossPropertyCountdown === true` (popup shows "Return to it within N seconds")
   - `checks.returnRecovered === true` (popup shows "You are editing")
2. **Remote Support Follow-up — BLOCKED for human validation.** No automated
   two-profile harness exists in this repo. A human must run two real Chrome
   profiles with the unpacked extension loaded and valid support/auth config,
   then verify:
   - supportee requests a code from a normal property page and supporter joins
     from the `/support` page or extension popup;
   - screen-share plus camera/microphone permission prompts work in the real
     browser UI;
   - supporter view is view-only while supportee marking/highlighting/sidebar
     workflows remain usable;
   - navigation and sidebar/popup state stay synced across both profiles;
   - DevTools console/network mirrors label page, content script, popup, and
     background worker sources correctly with payload capture both off and on;
   - teardown from either side clears remote-support UI and does not leave
     media tracks, telemetry wrapping, or session state active.

### E. Optional deeper inspection — COMPLETE

- `content/core.js` rendering/scheduling internals (overlay layout, hover/focus
  boxes, mark-id management, render scheduling, reveal/warmup) — visual/perf, not
  data-integrity.
- Remote-support reliability internals (WebRTC signaling state machine,
  reconnect/backoff, chunked-message reassembly, media-track lifecycle, viewer
  UI).
- **Silent-highlight sub-2/sub-6 deeper** — profiling-gated perf work.

Status: complete for the bounded code-inspection pass requested in the
autonomous backlog run. The audit checked `content/core.js` render scheduling,
explicit overlay refresh/coalescing, cache invalidation, enable/disable
teardown, and the remote-support background/offscreen/viewer reliability paths
for stale-channel guards, chunk reassembly, buffer-limit handling, media-track
cleanup, idle offscreen teardown, and view-only contracts. No new suspicious or
clearly problematic code issue was found. Validation:
`node --test tests/remote-support*.test.js tests/background-remote-support-routing.test.js tests/core-scheduling.test.js tests/core-motion-pause.test.js tests/core-visibility.test.js`
passed (`208` pass), followed by full `npm test` (`553/553`, `# fail 0`).

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
