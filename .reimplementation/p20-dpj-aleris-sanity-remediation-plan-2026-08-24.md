# P20 DPJ/Aleris sanity-remediation plan — 2026-08-24

## Goal

Close the post-acceptance defects found by the full headed DPJ and Aleris rerun,
without weakening consent suppression or any P14–P20 authority fence. P20 is
reopened until focused regressions, `pnpm verify`, the production/debug browser
gates, and clean headed DPJ/Aleris workflows pass from one synchronized source
revision.

## Current facts

- DPJ completed both render-inspection modes, consent suppression, mobile
  marking, AI, Content List, one current-page Save, Todo `0/7 -> 1/7`, fenced
  Send to Lynx, and Discard. Post-AI marking invalidation projected in 28 ms.
- The first mobile-to-desktop DPJ transition changed the page viewport to
  1920x1080 while the active interaction shield retained its prior 412x960
  inline geometry. The shield currently updates geometry in
  `src/content/interaction-shield.ts:updateViewportGeometry`, and popup-owned
  emulation completes in `src/entrypoints/popup/main.tsx:applySessionEmulation`
  without an explicit content-side remeasurement acknowledgement.
- Aleris `/` correctly classified as `managed_non_candidate`; its candidate
  page `/kirurgi/brack/aderbrack/` completed the same first-configuration
  workflow. On return to `/`, the read-only With/Without JavaScript controls
  were disabled by `presentation.lockBanner.visible` in
  `src/popup/App.tsx:App`, even though inspection is not a marking mutation.
- Cancel could remain in `data-view=render-mode` after navigation. In
  `src/popup/render-inspection-controller.ts:adopt`, an authoritative current
  session belonging to an earlier document publishes the inactive projection
  but returns `ignored`; `observe` converts that to `stale`, causing
  `restoreJavascriptView` to report failure after the restoration already
  succeeded.
- Aleris emitted `lock.blocked` about once per second while the semantic lock
  reason was unchanged. `src/background/brain/decide.ts:decideSignals` compares
  the complete lock banner, including `countdownSeconds`, so countdown-only
  presentation changes become new decision signals.
- The canonical launcher opens a `popup.html?debugTabId=...` helper and then the
  real side panel, leaving both application clients alive. Each client has a
  valid per-binding configuration cache, so the helper duplicates `/load`, lock,
  and authority traffic. `scripts/launch-test-browser.mjs:runCdpStateAction`
  already prefers the actual side panel; the helper is needed only to request
  `chrome.sidePanel.open`.
- Production intentionally omits `window.__UNFLUFFIFY_POPUP_DEBUG__`, but
  `scripts/launch-test-browser.mjs:buildPopupActionExpression` waits five
  seconds for that hook and otherwise returns no DOM state. The control channel
  must always expose production-safe DOM state and add debug detail only when
  the hook exists.
- DPJ Save returned HTTP success in about 2.2 seconds and reached its final
  success projection about 11.65 seconds later. This is an observation, not yet
  a proven defect cause. It must be timed by stage before changing success or
  reconciliation ordering.

## Decisions

1. Keep DPJ consent/modal suppression unchanged. Suppressed cart, account,
   contact, assembly, country, dialog, and similar blocking UI remains hidden
   and excluded from captures, marking rows, AI HTML, and payloads.
2. Add one read-only content command that synchronously refreshes active shield
   layering and viewport geometry. `applySessionEmulation` invokes it only after
   the background confirms an active explicit mobile/desktop target. A missing
   content receiver remains a consumed optional-delivery outcome.
3. Render inspection remains available under a non-editor/off-candidate lock.
   Marking, AI, Save, and publication fences are unchanged.
4. Return an explicit `inactive` observation when authoritative current
   inspection state belongs to another page/property. Owner or epoch mismatch
   remains `stale`.
5. Deduplicate `lock.blocked` on semantic lock identity: blocked reason, banner
   visibility/reason, identity copy, and actions. Exclude only the changing
   countdown value; the popup may still render fresh countdown facts.
6. Close the exact bound helper target after the real side-panel target exists,
   then require control actions to use the real side panel. Collect DOM state in
   all builds; expose hook-derived detail only in debug.
7. Instrument Save stage duration in debug diagnostics and retained live
   evidence first. Change ordering only if the rerun identifies a redundant or
   unbounded awaited stage; never report Save success before authoritative
   response adoption and required page-interaction cleanup.

## Non-goals

- No suppression-selector change and no restoration of blocking commerce,
  account, contact, assembly, country, modal, or consent UI.
- No Lynx/Hub endpoint, payload schema, permission, or publication change.
- No Send-to-Lynx request while candidate coverage is below `7/7`.
- No global configuration-cache sharing between independent legitimate popup
  clients; the live harness will stop creating the accidental second client.
- No weakening of path/query/document navigation fences, editor authority for
  mutating actions, or the render curtain paint acknowledgement contract.

## Implementation phases

### 1. Shield geometry acknowledgement

- Edit `src/entrypoints/content-loader.content.ts:createContentRouter` to expose
  a read-only `refreshInteractionShieldViewport` handler that calls the existing
  controller refresh and reports the measured active geometry.
- Edit `src/entrypoints/popup/main.tsx:applySessionEmulation` to request that
  refresh after the background confirms active emulation, inside the existing
  serialized transition.
- Extend `tests/src/content/interaction-shield.test.ts`,
  `tests/c4-content-entrypoint.test.ts`, and
  `tests/src/popup/entrypoint.test.ts` to prove 412x960 -> 1920x1080 and reverse
  transitions update the live shield before the transition resolves, including
  optional no-receiver behavior.
- Focused command:
  `pnpm vitest run tests/src/content/interaction-shield.test.ts tests/c4-content-entrypoint.test.ts tests/src/popup/entrypoint.test.ts --reporter=dot`.
- Fallback: if Chrome reports viewport metrics one task after CDP completion,
  make the content handler verify dimensions across at most two animation frames;
  do not add polling.

### 2. Off-candidate read-only inspection and cancellation

- Edit `src/popup/App.tsx:App` so only missing handler or active inspection work
  disables With/Without JavaScript; remove the lock banner as an inspection
  blocker and tooltip source.
- Edit `src/popup/render-inspection-controller.ts:adopt` and `observe` to
  distinguish authoritative inactive state from stale ownership.
- Add characterization to `tests/src/popup/app.test.ts`,
  `tests/src/popup/render-inspection-controller.test.ts`, and
  `tests/src/popup/entrypoint.test.ts` for managed-non-candidate inspection and
  Cancel after navigation.
- Focused command:
  `pnpm vitest run tests/src/popup/app.test.ts tests/src/popup/render-inspection-controller.test.ts tests/src/popup/entrypoint.test.ts --reporter=dot`.

### 3. Semantic lock-signal deduplication

- Edit `src/background/brain/decide.ts:decideSignals` to compare a typed semantic
  lock-banner fingerprint that omits `countdownSeconds` and preserves all other
  operator-meaningful fields.
- Extend `tests/src/background/brain.test.ts` to prove countdown-only facts do
  not mint a second `lock.blocked`, while reason, editor identity, transfer copy,
  visibility, or actions do.
- Focused command:
  `pnpm vitest run tests/src/background/brain.test.ts --reporter=dot`.

### 4. Single-client live-browser harness

- Edit `scripts/launch-test-browser.mjs:openActualSidePanel` to return the
  actual target, close the exact `debugTabId` helper through the CDP HTTP target
  API, and verify its disappearance before declaring readiness.
- Edit `runCdpStateAction` to target the actual side panel only and
  `buildPopupActionExpression` to collect stable view/controls/inputs from the
  DOM in production, merging debug-hook fields only when present.
- Update `tests/playwright-mcp-config.test.ts` with source-contract assertions
  for helper closure, actual-panel-only control, no debug-hook wait, and
  production DOM-state availability.
- Update `.github/skills/live-browser/SKILL.md`,
  `.github/skills/live-round/SKILL.md`, `.github/skills/live-watch/SKILL.md`, and
  `.github/instructions/browser-launch.instructions.md` only where their
  operator contract mentions the helper or assumes a debug hook.
- Focused command:
  `pnpm test:node -- tests/playwright-mcp-config.test.ts` (or the repository's
  owning test command if this file is aggregated by `pnpm test`).

### 5. Integrated verification and live acceptance

- Run all focused suites above, `pnpm lint`, `pnpm check`, `git diff --check`,
  and `pnpm verify`.
- Run production and debug P14–P20 gates. Retain only their normal acceptance
  artifacts and record exact hashes/status in P20 evidence.
- Use the repository `live-browser` procedure in headed Chrome, with external
  observers detached during extension-owned emulation, to repeat DPJ and Aleris.
- DPJ acceptance: both inspections `paint-acknowledged`; shield geometry equals
  412x960 in marking and 1920x1080 in desktop silent preview; suppression and
  payload hygiene pass; post-AI edit invalidates within one second; one `/load`
  per binding and one current-page Save; Todo reaches `1/7`; publish remains
  fenced; reveal/freeze/lazy load/scroll/keyboard/Discard/console checks pass.
- Aleris acceptance: `/` remains managed non-candidate; read-only inspection
  works despite the non-editor banner; Cancel exits render mode; candidate page
  completes first-config workflow; no countdown-only `lock.blocked` stream;
  one `/load` per binding; shield/emulation/suppression/payload/console checks
  pass; publish remains fenced below coverage.
- Capture debug Save stage timings. If no redundant application wait is proven,
  record the latency as site-dependent evidence rather than inventing a fix.

### 6. Evidence, review, and publication

- Update `.reimplementation/p20-dpj-live-workflow-report-2026-08-24.md`,
  `.reimplementation/p20-release-evidence.md`, and
  `.reimplementation/rewrite-legacy-execution-plan.md` with exact source,
  commands, outcomes, artifacts, and any remaining honest limitation.
- Run the repository review-push workflow: inspect the whole diff, run the
  final required checks, commit the complete scoped P20 remediation, push
  `re-write`, and verify local/upstream equality.

## Test matrix

| Contract | Unit/integration | Browser/live |
|---|---|---|
| Shield follows emulation | content shield + popup entrypoint | exact 412x960 / 1920x1080 DPJ and Aleris geometry |
| Read-only inspection under lock | App + controller + entrypoint | Aleris `/` both modes and Cancel |
| Lock event stability | brain decisions | no once-per-second Aleris `lock.blocked` activity |
| One production client | launcher contract | one side panel, no helper, one `/load` per binding |
| Production observability | launcher contract | state/click/input work without debug hook |
| Save integrity | existing Save regressions + full verify | one current-page request, authoritative adoption, stage timings |
| Consent/payload hygiene | existing P13/P20 tests | suppressed subtrees absent on both properties |
| Release regression | `pnpm verify`, P14–P20 prod/debug | no fatal/page/console/controller cleanup failures |

## Risks and mitigations

- Closing the wrong extension target could terminate the real panel. Close by
  the exact helper target id captured before opening the panel, then wait for
  that id to disappear while the exact plain `popup.html` target remains.
- Shield refresh could race a navigation. The existing popup binding/command
  epoch and content realm document identity fence own staleness; the refresh is
  read-only and ignored when no receiver exists.
- Lock deduplication could hide a meaningful transfer change. Fingerprint every
  banner field except countdown and test each identity/action change.
- Treating binding mismatch as inactive could mask a stale owner. Check owner
  and operation epoch first; only an authoritative `current` response for the
  current owner may return inactive.
- Live sites may change. Record exact URLs, timestamps, extension version,
  viewport, HTTP observations, and distinguish application defects from site or
  backend variability.

## Acceptance criteria

- All four observed defects have failing-before/passing-after regression tests.
- Focused suites, `pnpm verify`, and production/debug P14–P20 gates pass.
- Headed DPJ and Aleris workflows meet the phase-5 matrix with no extension
  runtime errors and no accidental publication.
- Consent suppression remains active and excluded from every extraction/output
  artifact.
- P20 evidence is internally consistent and no speculative Save cause is stated
  as fact.
- The final scoped commit is pushed and `re-write...origin/re-write` is `0 0`.
