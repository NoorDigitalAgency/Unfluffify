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

## Tier 2 — feature subsystems: INSPECTED 2026-06-06 (HEAD `06fb75c`)

Read in full for correctness:
- `common/lynx-checklist.js` (365) — page-type/candidate normalization,
  marked-page resolution, checklist view-model.
- `common/lynx-live-pages.js` (118) — stage-base/site-id normalization,
  GraphQL queries, candidate state, token refresh.
- `common/emulation.js` (350) — device emulation core (scale/mode math,
  debugger attach/detach, reconcile).
- `popup/emulation.js` (22) — popup emulation state sync.
- `common/page-save-state.js` (101) — page-save UI state model.
- `popup/ai-run.js` (114) — AI-run parsing/persistence/submission xpath build.
- `popup/messages.js` (155), `popup/helpers.js` (132),
  `popup/chrome-helpers.js` (53), `popup/render-mode.js` (45).

### Verdict: solid. No High/Medium findings.

Cross-checks that passed:
- **lynx normalization:** duplicate-URL candidates are correctly flagged and
  duplicate-URL marked pages are correctly invalidated (can't assign one URL
  to a single page type); page-type ordering follows the allowed-key order.
- **ai-run parsing:** `parseAiRunStartResponse` strictly requires a single
  `session_id` key; `buildAiSubmissionXpaths` strips document-root xpaths and
  tags explicit includes; `normalizePersistedAiRunRecord` validates all fields.
- **emulation math:** scale clamped to [0.25, 1]; `reconcileDeviceEmulationState`
  handles the tri-state `isDebuggerAttachedToTab` (null = unknown → keep) safely;
  `clear`/`detach` are harmless no-ops when not attached.
- **popup message helpers:** all trace logs gated behind `traceModeEnabled`;
  `lastError` handled on every `chrome.tabs.sendMessage`; timeouts guard
  `clearBrowsingData`/`reloadTab`.

### Two Low-severity findings (not bugs today)

#### T2-a (Low / robustness): device-emulation debugger ops are not serialized per tab
- `common/emulation.js` `updateDeviceEmulation` (9 call sites: popup device
  toggle, desktop-preview enable/disable, `ensureEditorMobileSimulation`,
  background `setDeviceEmulation`/`updateDeviceEmulation` handlers, and the
  `chrome.debugger.onDetach` handler) and `clearDeviceEmulationAfterNavigation`
  (webNavigation `onCompleted`) can interleave for the same tab with no
  queue/lock.
- **Risk:** concurrent calls can race `attach` / `setDeviceMetricsOverride` /
  `clearDeviceMetricsOverride` / `detach`, leaving the stored
  `DEVICE_EMULATION_PREFIX` state inconsistent with the actual renderer
  override (e.g. emulation cleared right after being set, or debugger left
  attached/detached out of sync) after a rapid toggle+navigate.
- **Why it's bounded:** `reconcileDeviceEmulationState` self-heals on the next
  popup open, so the inconsistency is transient. Pre-existing — not introduced
  by the 9 fixes.
- **Suggested hardening:** apply the same per-target serialization queue the
  F1 fix introduced for page-motion MAIN-world control
  (`pageMotionFreezeControlQueueByTarget` in `background.js`) to the
  device-emulation debugger path, keyed by tabId.

#### T2-b (Low / maintainability): non-blocking reconciliation-reason list is duplicated
- The set of non-blocking page-save reconciliation reasons is defined twice:
  `NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS` in `common/config.js:36-46`
  and the inline array in `isBlockingPageSaveReconciliation`
  (`common/page-save-state.js:7-17`). They are identical today.
- **Risk:** if one is updated without the other, the UI blocking state
  (`page-save-state.js`) and the config-layer blocking decision (`config.js`)
  diverge silently.
- **Suggested hardening:** export the set from `config.js` and import it in
  `page-save-state.js` (or a shared constants module).

Both are below the bar of the original 9 and need no immediate fix.

---

## `content/core.js` high-risk paths: INSPECTED 2026-06-06 (HEAD `24cd814`)

`content/core.js` is 11,392 lines / 411 functions — too large for an
exhaustive single-pass read. This pass targeted the AI-payload-critical and
locked-contract-critical paths (the parts where a latent bug would corrupt the
submission or violate the marking contract). Lifecycle/state paths
(`disable`, dirty-baseline, URL watcher, async reconcile, motion-pause) were
already read during the 9-finding + Tier 1 work.

Read in this pass:
- `createSanitizedPageSnapshot` + `getSnapshotStripSelectors` +
  `EXTENSION_SNAPSHOT_STRIP_SELECTORS`/`_ROOT_CLASSES` — the AI-payload
  `renderedHtml` sanitizer.
- Consent handling: `hideConsentElements`, `hideConsentElement`,
  `markConsentElementHidden`, `hideConsentElementVisibility`,
  `injectConsentBypassStyle`, `hideConsentOnEnable`, `restorePageScrolling`.
- `isVisibleForSubmission` (+ its ambiguous/definitive visibility walk and the
  Phase A `anyClientRectIntersectsSubmissionArea` bridge).
- `getXPath` / `getElementFromXPath` (Tier 1 cross-check).

### Verdict: solid. No new findings.

Cross-checks that passed:
- **Snapshot is leak-proof:** strip selectors `[id^="unfluffify-"]` +
  `[data-uf-extension-ui="true"]` (plus shadow-root/MCP containers) remove all
  injected UI, and a per-element pass deletes every residual `data-uf-*`
  attribute and title-prefixed `title`. Combined with F1 (no injected freeze
  `<script>` node), this matches the live-smoke `hasFreezeNode:false`.
- **Consent matches the contract:** consent nodes are hidden in place via
  inline `opacity/visibility/pointer-events` (XPath preserved), `<dialog open>`
  is `close()`d to leave the top layer, and no dedicated `consentXpaths` are
  stored/synced/submitted — hidden consent is handled by normal
  hidden-textual detection (so it submits as excluded).
- **Submission visibility is intact:** `isVisibleForSubmission` rejects
  extension UI, honors definitive/ambiguous hidden ancestors with the shared
  hit-test reality check, and falls back to the partial-visibility bridge —
  the Phase A contract is unchanged.

### Honest scope caveat
This was a targeted high-risk pass, NOT a full 411-function audit. The
remaining unread bulk of `content/core.js` is the rendering/scheduling
internals (overlay layout, hover boxes, mark-id management, render scheduling,
reveal/warmup mechanics). Those are visual/perf surfaces (not data-integrity)
and are covered by the focused suites (`core-visibility`, `core-scheduling`,
`marking-rules`, `silent-highlight-*`, `submission-rules`,
`page-motion-freeze`). A full line-by-line audit of those internals remains
available as a future effort if desired, but is lower-risk than anything
inspected so far.

---

## Inspection backlog (NOT yet read for correctness)

Ordered by risk. Pick up when prioritized.

### content/core.js rendering/scheduling internals (lower risk, test-covered)
- Overlay layout/projection, hover/focus boxes, mark-id management, render
  scheduling, reveal/warmup mechanics. Visual/perf surfaces, not
  data-integrity; covered by focused suites. Optional full line-by-line audit.

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
