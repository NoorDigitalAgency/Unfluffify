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
- **Status 2026-06-06: FIXED.** `parseTimestampMillis` now accepts the
  documented `string|Date|number` inputs. Tests cover numeric epochs, `Date`
  comparisons, and numeric normalization.
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
- **Status 2026-06-06: FIXED.** `collectCachedSelectorMatches` now documents
  that every `shouldIncludeNode` dependency must be reflected in
  `suppressionFingerprint` or a cache-clearing generation bump; a source guard
  locks the contract wording.
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
- **Status 2026-06-06: FIXED.** `common/emulation.js` now serializes
  `updateDeviceEmulation` and `clearDeviceEmulationAfterNavigation` through a
  per-tab queue keyed by normalized tabId. Guard coverage locks the queue
  mechanics and both debugger-operation call sites.
- Before the fix, `common/emulation.js` `updateDeviceEmulation` (9 call sites:
  popup device-toggle, desktop-preview enable/disable, `ensureEditorMobileSimulation`,
  background `setDeviceEmulation`/`updateDeviceEmulation` handlers, and the
  `chrome.debugger.onDetach` handler) and `clearDeviceEmulationAfterNavigation`
  (webNavigation `onCompleted`) could interleave for the same tab with no
  queue/lock.
- **Risk:** concurrent calls could race `attach` / `setDeviceMetricsOverride` /
  `clearDeviceMetricsOverride` / `detach`, leaving the stored
  `DEVICE_EMULATION_PREFIX` state inconsistent with the actual renderer
  override (e.g. emulation cleared right after being set, or debugger left
  attached/detached out of sync) after a rapid toggle+navigate.
- **Why it was bounded:** `reconcileDeviceEmulationState` self-heals on the next
  popup open, so the inconsistency is transient. Pre-existing — not introduced
  by the 9 fixes.
- **Implemented hardening:** applied the same per-target serialization pattern
  the F1 fix introduced for page-motion MAIN-world control to the
  device-emulation debugger path, keyed by tabId.

#### T2-b (Low / maintainability): non-blocking reconciliation-reason list is duplicated
- **Status 2026-06-06: FIXED.** `common/config.js` exports
  `NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS`, and
  `common/page-save-state.js` imports that single source. Guard coverage checks
  the shared source and behavior parity.
- The set of non-blocking page-save reconciliation reasons is defined twice:
  `NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS` in `common/config.js:36-46`
  and the inline array in `isBlockingPageSaveReconciliation`
  (`common/page-save-state.js:7-17`). They are identical today.
- **Risk:** if one is updated without the other, the UI blocking state
  (`page-save-state.js`) and the config-layer blocking decision (`config.js`)
  diverge silently.
- **Suggested hardening:** export the set from `config.js` and import it in
  `page-save-state.js` (or a shared constants module).

Both Tier 2 items were below the bar of the original 9 and are now fixed as
optional hardening.

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

## Tier 3 — lower-risk subsystems: INSPECTED 2026-06-06 (HEAD `6efad65`)

Read in full for correctness:
- `common/world-messaging-contract.js` (49) — message-type/lifecycle constants.
- `common/page-telemetry.js` (38) — MAIN-world page telemetry installer.
- `common/extension-telemetry.js` (388) — console/fetch/XHR wrapping engine.
- `popup/telemetry.js` (27) — popup telemetry helpers.
- `content/constants.js` (22) — removable consent/modal selectors.
- `common/constants.js` (76) — tab/device/marking-taxonomy constants.
- `scripts/package-extension.mjs` (422) — packaging (dev-only, test-covered by
  `tests/package-extension.test.js`).

### Verdict: one Medium finding (T3-a), now fixed. Everything else clean.

Cross-checks that passed:
- **constants** match the locked taxonomy (`DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS`
  = all − toggleable; BUTTON toggleable; LINK omitted); F8 comment fix present.
- **content/constants** consent selectors all use `:not(body):not(html)` guards
  (never match the root).
- **popup/telemetry** correctly gates payloads on `scopedState.active &&
  includePayloads` (remote-support active).
- **packaging** uses reachability-based inclusion (only files referenced from
  the manifest entry points are staged), so `.copilot/`, tests, node_modules
  cannot leak into the package; `page-motion-freeze-control.js` is traced via
  the background import.

### T3-a (Medium / security+privacy): page telemetry bridge re-introduces the Finding 1 pattern
- **Status 2026-06-06: FIXED.** `content-main.js` now installs the page
  telemetry bridge only while the tab is in an active `being_supported`
  remote-support session. `common/page-telemetry.js` stays inert until it
  receives authenticated enable control, includes the active nonce on outbound
  telemetry, and uninstalls telemetry wrappers on authenticated disable.
  `content-main.handlePageTelemetryWindowMessage` requires the current nonce,
  requires active support mode, sanitizes the message, and drops any
  page-supplied `tabId` before forwarding to background.
- **Independent verification 2026-06-06 (reviewer):** confirmed correct.
  Lifecycle is driven by `applyRemoteSupportSessionState` →
  `syncPageTelemetryBridgeLifecycle()` (install only in `being_supported`,
  teardown otherwise); `main()` no longer installs unconditionally.
  `extension-telemetry.installExtensionTelemetry` now returns an `uninstall`
  controller that restores the original `console`/`fetch`/`XHR` (guarded
  against clobbering re-wraps), so teardown genuinely unwraps. Full
  `npm test` 553/553; AI-submission smoke clean (`errs=0`,
  `snapshot.ok=true`, `hasFreezeNode=false`).
- **Residual hardening 2026-06-06 (reviewer): private MessagePort transport
  added.** The steady-state page-world telemetry stream now travels over a
  `MessageChannel` port transferred once during the enable handshake
  (`syncPageTelemetryControl` creates the channel and transfers `port2`;
  `common/page-telemetry.js` adopts `event.ports[0]` and posts telemetry over
  it; content-main reads it via `handlePageTelemetryPortMessage`). Effects:
  (1) telemetry is no longer broadcast on `window.postMessage`, so other page
  scripts cannot passively observe the captured console/network stream;
  (2) forging an entry now requires racing the one-time port handshake rather
  than knowing the broadcast nonce. The nonce'd `window.postMessage` path
  remains as a graceful fallback when `MessageChannel` is unavailable. Teardown
  closes the port. New tests in `tests/page-telemetry.test.js` cover the port
  path (telemetry over port, no window broadcast, port closed on disable) and
  the content-main handshake/teardown source guards.
- **Irreducible residual (Low, accepted): handshake-time port interception.**
  The single control message that transfers the port still goes through
  `window.postMessage`, so a page script that actively races that one message
  could grab the port. This cannot be fully closed while telemetry capture must
  run in the page's own MAIN world (where any page script shares the global).
  Threat is bounded: only during an ACTIVE support session, the captured data
  is the page's OWN console/network, and the DevTools panels render via
  `textContent` (pollution-not-RCE). Accepted as the floor for cross-world
  telemetry.
- Before the fix, `common/page-telemetry.js` was injected as a persistent
  MAIN-world `<script>` by `ensurePageTelemetryBridge()` in `content-main.js`
  `main()` — on EVERY activated tab, regardless of whether a remote-support
  session was active.
- It called `installExtensionTelemetry` with NO `isEnabled` gate, so the page's
  `console` / `fetch` / `XMLHttpRequest.prototype` were wrapped and network +
  console METADATA were forwarded to the background on every activated page.
  (Request/response BODIES are gated on remote-support `includePayloads`, but
  the wrapping + metadata forwarding were not.)
- It installed a persistent `window` "message" listener gated only on a static
  marker (`unfluffify-page-telemetry-control`); any page script could post that
  marker to flip `includePayloads`.
- `content-main.handlePageTelemetryWindowMessage` forwarded ANY page
  `window.postMessage` carrying the static `PAGE_TELEMETRY_MESSAGE_MARKER` +
  `message.type === "remoteSupportExtensionTelemetry"` straight to the
  background with NO origin/shape validation → a page could **inject fabricated
  telemetry entries** (including an attacker-chosen `tabId`) into the
  supporter's console/network mirror.
- This was the same class of issue Finding 1 fixed for the page-motion bridge:
  persistent page-world script, static-marker control surface, page-API
  wrapping, page-spoofable.
- **Why it was not catastrophic:** only on activated tabs; metadata-only
  outside an active support session; the spoofed/forwarded telemetry pollutes
  the supporter's own mirror during a support session rather than exfiltrating
  to the page. Still a fingerprint + perf + privacy concern on every activated
  page, and a spoofing vector into the supporter view.
- **Implemented remediation:** just-in-time bridge install/teardown follows the
  remote-support content state; `installExtensionTelemetry` now returns an
  uninstall controller so MAIN-world page API wrappers are restored on disable;
  page control and telemetry forwarding are nonce-gated, and content forwards a
  sanitized telemetry message without trusting page-provided tab routing.

---

## Inspection backlog (NOT yet read for correctness)

Ordered by risk. Pick up when prioritized.

### content/core.js rendering/scheduling internals (lower risk, test-covered)
- Overlay layout/projection, hover/focus boxes, mark-id management, render
  scheduling, reveal/warmup mechanics. Visual/perf surfaces, not
  data-integrity; covered by focused suites. Optional full line-by-line audit.

_(none — all subsystems have had at least a targeted pass; see below.)_

---

## Remote-support + DevTools: TARGETED SECURITY PASS 2026-06-06 (HEAD `510d5db`)

6,396 lines of WebRTC/signaling — too large for a full line-by-line audit in
one pass. This was a TARGETED pass on the locked-contract constraints and the
injection-prone surfaces (not a complete audit of the signaling state machine,
reconnect logic, media-track management, or viewer UI).

Files touched:
- `common/remote-support.js` (238), `common/devtools-helpers.js` (72),
  `devtools/remote-console.js` (129), `devtools/remote-network.js` (192) —
  read in full.
- `remote-support-offscreen.js` (1876), `common/remote-support-background.js`
  (2153), `remote-support-viewer.js` (1725) — targeted reads of the
  contract/security surfaces only.

### Verdict: locked contracts enforced; no new High/Medium findings.

- **No remote-control replay (contract):** `remoteSupportSendCommand` and
  `remoteSupportSetControlOwner` both hard-return
  `{ ok:false, error:"Remote control is not available in support sessions" }`.
  The offscreen data-channel `onmessage` only forwards inbound payloads as
  `incoming-message` transport events (no page interaction / no synthetic
  input). No `dispatchEvent`/synthetic `MouseEvent`/`KeyboardEvent`/`.click()`
  applied to the supportee page from peer input.
- **Fail-closed on missing ICE config (contract):** enforced at TWO layers —
  background (`"...missing ICE configuration"` → `ok:false`) and offscreen
  (`throw new Error("Missing remote support ICE servers")`). ICE servers come
  only from the server payload (`normalizeRemoteSupportIceServers`); no
  hardcoded public STUN/TURN fallback is injected anywhere.
- **DevTools mirror is XSS-safe:** `remote-console.js` and `remote-network.js`
  render every field via `textContent` (never `innerHTML`). This bounds T3-a:
  fabricated telemetry can POLLUTE the supporter's panels but cannot execute
  script there — T3-a is spoofing/pollution, not RCE.
- **Message hygiene:** `parseRemoteSupportMessage` validates JSON shape;
  payload size caps (`REMOTE_SUPPORT_PAYLOAD_MAX_BYTES`,
  `..._TOTAL_..._BYTES`, data-channel buffer limit) are defined and
  `clampPayloadSize` enforces UTF-8-correct truncation.

### Not covered (remains backlog, lower risk)
A full line-by-line audit of the WebRTC signaling state machine, reconnect /
backoff, chunked-message reassembly (`consumeChunkedDataChannelMessage`),
media-track lifecycle, and the 1.7k-line viewer UI. These are reliability/UX
surfaces, not contract or injection surfaces.

---

## Improvement-plan assessment (2026-06-06)

All findings to date, with status:

| ID  | Sev | Area | Active bug? | Status |
|-----|-----|------|-------------|--------|
| F1-F9 | — | (original) | — | FIXED |
| T1-a | Low | config timestamp JSDoc/type | No (safe today) | FIXED |
| T1-b | Low | selector-cache filter key | No (safe today) | FIXED |
| T2-a | Low | device-emulation debugger race | No (self-heals) | FIXED |
| T2-b | Low | duplicated reconcile-reason list | No (identical now) | FIXED |
| T3-a | Medium | page telemetry F1-pattern | No (metadata-only outside support; pollution-not-RCE) | FIXED |

**Do we need a fix plan? Conclusion: no open code-remediation plan remains.**
The identified optional hardening items are fixed. The only remaining work is
human-gated live validation plus optional deeper inspections listed below.

Recommended (optional) groupings if/when capacity allows:

1. **Cheap hardening batch (1 small PR, ~Low effort):**
   - T2-b: export the non-blocking reconcile-reason set from `common/config.js`
     and import it in `common/page-save-state.js` (kill the duplicate).
   - T1-a: make `parseTimestampMillis` accept `number`/`Date`, or fix the
     JSDoc to say "string only" + normalize at the boundary.
   - T1-b: add a doc-comment contract on `collectCachedSelectorMatches` that
     any `shouldIncludeNode` dependency MUST be reflected in
     `suppressionFingerprint` or a generation bump (or add a filter
     fingerprint to the key).
   These are doc/dedup/guard changes with negligible risk; add a source-guard
   test for each.

2. **T2-a:** completed in the autonomous backlog run. The device-emulation
   debugger path now uses a per-tab queue, keyed by tabId, to serialize
   concurrent attach / metrics override / clear / detach operations.

3. **T3-a:** completed in the autonomous backlog run. The page-telemetry bridge
   now uses just-in-time active-session install, `isEnabled`/teardown-backed
   page API wrapping, nonce-gated control/forwarding, and sanitized forwarding
   without page-provided tab routing.

Remaining pure-inspection gap (optional): closed for the bounded autonomous
audit on 2026-06-06. `content/core.js` rendering/scheduling/teardown and
remote-support background/offscreen/viewer reliability internals were inspected
for stale-channel guards, chunk reassembly, buffer-limit handling, media-track
cleanup, idle offscreen teardown, render coalescing, cache invalidation, and
enable/disable cancellation. No new code finding was opened.

Validation follow-up (2026-06-06):
- Phase 2 property-lock live smoke passed with the persistent repo profile:
  `xvfb-run -a node scripts/smoke-property-lock-phase2.mjs https://seo.se/ https://www.bonliva.no/artikler/barnehagevikar-lonn`
  reported `initialEditor:true`, `crossPropertyCountdown:true`, and
  `returnRecovered:true`.
- Remote-support two-profile validation remains BLOCKED for human execution:
  no automated two-profile harness exists here, and the required screen share,
  camera, microphone, navigation, telemetry, and teardown checks need two real
  Chrome profiles with valid support/auth configuration.
- Optional deeper audit E passed:
  `node --test tests/remote-support*.test.js tests/background-remote-support-routing.test.js tests/core-scheduling.test.js tests/core-motion-pause.test.js tests/core-visibility.test.js`
  reported `208` pass, followed by full `npm test` reporting `553/553` and
  `# fail 0`.

---

## How to run validation during any future inspection
- Full suite (now deterministic after F6): `npm test` → expect `# fail 0`.
- Syntax: `node --check popup.js && node --check background.js && node --check content-main.js && node --check content/core.js`.
- Focused marking/motion guard suite: see `.copilot/code-inspection-remediation-plan.md` standing rules.
- Live smoke: `xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/smoke-ai-submission.mjs <url>`.
