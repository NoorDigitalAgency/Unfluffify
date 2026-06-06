# Subsystem Inspection (beyond the original 9 findings)

Tracks read-for-correctness inspection of subsystems NOT covered by the
original `CODE_INSPECTION_TODO.md` 9-finding pass (which concentrated on
lifecycle/state/security in `background.js`, `content/core.js`, `popup.js`,
and the page-motion module).

"Inspected" = read for latent correctness bugs, not just touched. Many of
these modules are also covered by focused test suites; this pass is an
independent read on top of that.

---

## Tier 1 — product-correctness core: INSPECTED 2026-06-06 (HEAD `f8f09e7`)

Read in full for correctness:
- `common/config.js` (1238) — config storage, normalization, timestamp-merge,
  page-markings persistence, reconciliation state.
- `common/xpath-utilities.js` (412) — static-mode XPath refiner (old→new HTML
  fuzzy matching).
- `content/marking-rules.js` (125) — locked marking taxonomy / target
  resolution pure logic.
- `content/submission-rules.js` (41) — AI submission row-state contract.
- `content/shared-inclusion.js` (79) — inclusion context / normalized text.
- `content/silent-highlight-rules.js` (64) — settle/reposition/overlay rules.
- `common/selector-set.js` (48) — AI selector normalization/equality.
- `content/shared-selector-cache.js` (188) — selector query cache.

### Verdict: solid. No High/Medium findings.

Cross-checks that passed:
- **XPath case consistency:** the refiner (`buildAbsoluteIndexedXPath`) emits
  lowercase tag XPaths, and the marking engine `getXPath` (`content/core.js`)
  also lowercases tags. Inputs resolve against HTML docs correctly; static-mode
  refinement is not silently no-op'd by a case mismatch.
- **submission-rules contract:** ordering is correct — immutable root → no
  submit; explicit include wins over excluded-ancestor; excluded row submits as
  excluded; hidden markable-textual submits as excluded; visible submits as
  included. Matches `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
- **marking-rules contract:** `chooseExcludeParentBoundaryTarget` honors the
  052c Shift order (self structured/toggleable → nearest structured group
  ancestor → nearest toggleable ancestor → broadest markable ancestor).
- **config timestamp/merge:** `mergePageMarkingsByTimestamp` only replaces a
  local entry when incoming is strictly newer, OR ties with a richer snapshot,
  OR (opt-in) ties with differing content; local-wins-on-tie default protects
  local edits. Invalid/missing timestamps sort as oldest (safe).
- **shared-selector-cache invalidation:** `geometryGeneration` is deliberately
  excluded from the cache key because selector matches are geometry-independent;
  `domStructure`/`config`/`pageMarkings` invalidations clear the cache. Correct.

### Two Low-severity hardening items (not bugs today)

#### T1-a (Low / doc + latent-fragility): `isIncomingTimestampNewer` JSDoc overstates accepted types
- `common/config.js:286-292` documents params as `string|Date|number`, but
  `parseTimestampMillis` (`:233`) returns `NaN` for any non-string, and
  `toTimestampMillis` maps that to `NEGATIVE_INFINITY`. So a `Date` or numeric
  epoch passed in would be treated as the oldest possible time.
- **Why it's safe now:** every caller passes normalized ISO strings
  (`normalizeEntryTimestamp` output or `entry.timestamp` from
  `normalizePageMarkings`, which are strings).
- **Risk:** a future caller passing `Date.now()` or a `Date` would get silent
  wrong ordering (always "older"), corrupting a merge decision with no error.
- **Suggested hardening:** either make `parseTimestampMillis` accept
  `number`/`Date`, or fix the JSDoc to say "string only" and assert/normalize
  at the boundary. No behavior change required immediately.

#### T1-b (Low / latent-fragility): selector cache stores `shouldIncludeNode`-filtered results without the callback in the key
- `content/shared-selector-cache.js:105-178` caches the post-filter node set.
  The `shouldIncludeNode` callback is NOT part of the cache key.
- **Why it's safe now:** the only caller that uses `shouldIncludeNode`
  (`content-main.js:4313` silent-highlight path) folds both callback
  dependencies into the key/invalidation — extension-UI membership via
  `domStructureGeneration` (cache cleared on DOM-structure change) and
  suppression via the `suppressionFingerprint`. The other caller
  (`content/core.js:2414`) passes no callback.
- **Risk:** a future caller whose `shouldIncludeNode` depends on state NOT
  captured by the key/generations would silently get stale filtered results.
- **Suggested hardening:** add a short doc comment on
  `collectCachedSelectorMatches` stating that any `shouldIncludeNode`
  dependency MUST be reflected in `suppressionFingerprint` or a generation
  bump, and/or include a caller-supplied filter fingerprint in the key.

Both items are below the bar of the original 9 and need no immediate fix; they
are recorded so a future change near these spots does not reintroduce a real
bug.

---

## Inspection backlog (NOT yet read for correctness)

Ordered by risk. Pick up when prioritized.

### Tier 2 — feature subsystems
- `common/lynx-checklist.js` (365) + `common/lynx-live-pages.js` (118) — Lynx
  checklist / live-page candidate logic and site-id normalization.
- `common/emulation.js` (350) + `popup/emulation.js` — device emulation core
  (scale/mode math, debugger attach/detach).
- `common/page-save-state.js` (101) — page-save UI state model.
- Popup submodules: `popup/ai-run.js`, `popup/helpers.js`,
  `popup/chrome-helpers.js`, `popup/messages.js`, `popup/render-mode.js`.
- `content/core.js` REMAINING SECTIONS — only the slices touched by the 9
  findings + Tier 1 cross-checks were read; the full ~11k-line file
  (marking render pipeline, hover/overlay, consent handling, snapshot
  sanitizer, reveal/warmup) has not had a full independent correctness read.

### Tier 3 — lower risk
- Telemetry: `common/page-telemetry.js`, `common/extension-telemetry.js`,
  `popup/telemetry.js`.
- `common/world-messaging-contract.js`.
- `scripts/package-extension.mjs` (packaging).
- `content/constants.js`, `common/constants.js` (only the exclusion taxonomy
  was checked).

### Deferred with remote-support (user-deprioritized)
- `remote-support-offscreen.js`, `remote-support-viewer.js`,
  `common/remote-support.js`, `common/remote-support-background.js`.
- DevTools mirroring: `devtools/devtools.js`, `devtools/remote-console.js`,
  `devtools/remote-network.js`, `common/devtools-helpers.js`.

---

## How to run validation during any future inspection
- Full suite (now deterministic after F6): `npm test` → expect `# fail 0`.
- Syntax: `node --check popup.js && node --check background.js && node --check content-main.js && node --check content/core.js`.
- Focused marking/motion guard suite: see `.copilot/code-inspection-remediation-plan.md` standing rules.
- Live smoke: `xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/smoke-ai-submission.mjs <url>`.
