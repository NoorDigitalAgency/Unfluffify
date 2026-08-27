# P22 cross-property workflow remediation

**Status:** In progress — planned 2026-08-27 from the complete headed
candidate round recorded in
`.reimplementation/p20-all-candidate-properties-headed-workflow-report-2026-08-26.md`.

## Goal

Close the cross-property Save, AI-start, dirty-projection, marking-overlay,
silent Content List, and shield-scroll failures without changing consent
suppression, persistent reveal/freeze ownership, extraction payloads, render
mode semantics, or publication fences. P22 completes only after the automated
gates and a clean repository-live-browser rerun pass on every currently usable
candidate.

## Current facts

- The source baseline is `93bc2b2347779fd1e7d19bf8e524f07f8d898789` on
  `re-write`; `origin/re-write` was synchronized at 0 ahead / 0 behind before
  planning. The only pre-existing worktree addition is the headed-round report.
- `pnpm verify`, the debug build, and P14–P20 controlled browser gates are green,
  so the failures are production-shaped integration gaps not broad baseline
  breakage.
- Five usable candidates returned HTTP 409 on Save. The popup re-reads its local
  lock directive immediately before `/save`, but that directive does not ask the
  websocket lock client for a new authoritative `lock_state` and wait for it.
  Retrying behind the operator's click is forbidden; the one request must carry
  the refreshed fence.
- Teknikhallen never reached `/get_selectors`. Its failure is the three-second
  synchronous `syncContentSignals` race after the brain accepted `ai-run-started`.
  A single slow content drain is classified as terminal instead of using the
  existing signals-available/backstop lifecycle within one bounded generation.
- Marking changes do emit brain-owned `markings.changed`, but the event-driven
  popup path enters `pollFastSignalsOnce`, which resolves the tab and reapplies
  session emulation before pulling the already-bound signal. This explains the
  2.7–4.7 second dirty projection on several sites.
- Widened exclusions are stored correctly. Physical clicks over extension
  rectangles discard the overlay from DOM hit-testing and try to rediscover the
  owner through page paint hits, so the exact widened XPath can be lost.
- Interactive exclusion drawing trusts bridge-time `target.visible`; opacity or
  visibility changes on a visually hidden ancestor can leave stale exclusion
  rectangles. Extraction state must remain unchanged.
- Silent highlighting can be sourced from the authoritative saved configuration,
  while the popup button and preview controller currently read only the current
  brain organ's selector set. A fresh popup can therefore show silent borders
  while reporting zero selectors.
- The shield deliberately does not cancel wheel/touch defaults. Arno nevertheless
  retained the same `scrollY`, consistent with a site-owned scroll lock after a
  blocking surface was suppressed. The extension needs a bounded fallback only
  when native shield scrolling produced no movement.
- Persistent `motionPaused` and `lazySuppressed` after reveal/freeze are correct
  until navigation. They are not cleanup defects and must not be released on
  entry to silent mode.

## Decisions

- Add an internal lock-fence refresh operation that sends `client_status` and
  resolves only after a newer authoritative websocket state occurrence (or a
  bounded failure). Save uses that result at its last safe point and still emits
  zero or one `/save`, never an automatic retry.
- Keep the brain as the only producer of running/dirty/terminal truth. Make the
  already-bound signals-available path pull signals directly, with the 500 ms
  poll retaining navigation discovery as a correctness backstop.
- Make AI-start acknowledgement a bounded, event-assisted generation wait:
  retry a timed content drain while the exact binding/run remains current and
  distinguish unreachable, unsupported, timeout, and generation mismatch. Do
  not send `/get_selectors` without exact content acknowledgement.
- Treat a marking overlay's `data-uf-overlay-xpath` as extension-owned interaction
  identity. Plain click and Clear remove that exact explicit owner; Shift remains
  the only way to create a widened exclusion, and ordinary nearest-boundary
  exclusion remains unchanged.
- Recheck current composed-ancestor visual state before drawing exclusions.
  Hidden exclusions remain in evaluation, selectors, capture rows, and payload
  decisions but receive no visible rectangle.
- Introduce one `effectiveSelectors` read owner: current fresh brain selectors in
  marking/post-AI states, authoritative configuration selectors as the silent
  fallback. Use it consistently for silent button availability and preview
  projection; Save continues to require the fresh post-AI set.
- Preserve native wheel/touch behavior. If a wheel on the shield produces no
  root or scroll-container movement by the next frame, apply the delta once to
  the nearest scrollable page container/root and repaint retained geometry.
- Leave consent selector coverage, freeze/lazy lease lifetime, endpoint/public
  payload schemas, extension permissions, and Lynx publication behavior intact.

## Open questions

- None for implementation. Acapedia's current 403 and the site-owned 3D Prima
  candidate 404s require external authority/content changes before their headed
  candidate gates can run; they do not authorize extension workarounds.

## Non-goals

- No consent-suppression selector removal or re-exposure of cart, account,
  contact, assembly, country, modal, or other blocking UI.
- No release of persistent reveal/freeze or lazy-suppression state before
  navigation.
- No AI, Save, or publication payload-schema change; no multi-page Save; no
  automatic Save retry; no publication below required coverage.
- No candidate fabrication for Bigbag, Acapedia, or 3D Prima and no attempt to
  repair third-party HTTP responses or Hub candidate data from this repository.
- No redesign of keyboard-operable Content List rows, render inspection,
  emulation dimensions, or reveal animation now that those contracts pass.

## Implementation phases

### R1 — Characterization and contract evidence

- Correct the freeze classification and remediation order in
  `.reimplementation/p20-all-candidate-properties-headed-workflow-report-2026-08-26.md`.
- Add production-shaped failing regressions in
  `tests/src/background/lock-browser-lifecycle.test.ts`,
  `tests/src/lock/lock.test.ts`, `tests/src/popup/entrypoint.test.ts`,
  `tests/src/content/marking/interaction.test.ts`,
  `tests/src/content/marking/marking.test.ts`,
  `tests/src/content/interaction-shield.test.ts`, and
  `tests/src/popup/app.test.ts` before changing behavior.
- Validate the focused files with Vitest; if a seam cannot model the observed
  browser path, add a narrow P20 browser assertion rather than weakening the
  acceptance statement.

### R2 — Exact marking ownership and live visibility

- In `src/content/marking/engine.ts`, expose exact current-generation XPath
  resolution for extension-owned overlay interactions while retaining stale
  node/fingerprint rejection in `toggle` and `clear`.
- In `src/entrypoints/content-loader.content.ts`, resolve click/context-menu
  Clear from the owning overlay XPath before page hit-testing. Do not interpret
  the overlay identity as authority to create a new mark.
- In `src/content/marking/renderer.ts`, add a current composed-ancestor visual
  gate for `exception` rectangles and remove stale rectangles in the same paint
  batch. Preserve explicit-inclusion ghost behavior.
- Focused validation: marking resolve/store/interaction/renderer tests plus the
  physical P14 marking matrix.
- Fallback: if composed-tree style inspection is unavailable, suppress the
  exclusion rectangle for that frame; never draw raw exclusion geometry.

### R3 — Immediate dirty projection and bounded AI start

- Split `pollFastSignalsOnce` in `src/entrypoints/popup/main.tsx` so a
  `signals.available` event for the current bound tab directly drains that
  tab/key before any tab resolution, emulation, Todo, context, or configuration
  work. Retain single-flight trailing coalescing and the 500 ms binding backstop.
- Replace the single three-second `syncContentRunGeneration` race with a bounded
  exact-binding/exact-run loop driven by signals-available revisions and short
  delivery attempts. Return distinct `unreachable`, `unsupported`, `timed_out`,
  and `generation_mismatch` outcomes and keep terminal cleanup in `finally`.
- Extend debug stages/copy only enough to identify the failed acknowledgement
  phase; production copy stays concise.
- Focused validation: popup entrypoint, signal scheduler/cursor, operator-action,
  and AI service tests. Acceptance budgets are `<1 s` dirty projection and one
  bounded AI-start handshake before `/get_selectors`.
- Fallback: older content realms may use the existing 500 ms backstop within the
  same deadline; they never bypass generation proof.

### R4 — Authoritative one-shot Save fence

- Add an awaitable status occurrence to `src/lock/client.ts` and an internal
  mutation-fence refresh in `src/background/lock-runtime.ts`. It sends one
  `client_status`, waits for a subsequent authoritative state occurrence, and
  returns a directive only when the same environment/site/editor still owns the
  lock.
- Extend the internal `lock.directive` request in
  `src/messaging/realms.ts` and `src/entrypoints/popup/main.tsx` with an explicit
  fence-refresh intent used only at Save's last safe point.
- Keep `performSaveSession` serialization, frozen binding/selectors/snapshot,
  pause/reconciliation, exactly-one `config.save`, authoritative response
  adoption, visible abort reasons, and `finally` cleanup. A refresh timeout
  blocks locally with zero `/save` requests.
- Focused validation: lock reducer/client/runtime/background services and popup
  Save entrypoint tests, including stale-first websocket state, status refresh,
  one HTTP 200 Save, duplicate clicks, timeout, navigation, and dirty aborts.
- Fallback: fail closed locally with a reason-specific toast; never reuse an
  unproved fence or retry Hub.

### R5 — Silent selector coherence and shield scrolling

- Add `effectiveSelectors` in `src/entrypoints/popup/main.tsx` and use it in
  `operatorActionPresentation`, `previewController`, `showPreview`, and silent
  selector counts. Marking/post-AI Save eligibility remains brain-owned.
- In `src/content/interaction-shield.ts`, add a one-frame wheel fallback that
  runs only for shield-targeted native-scroll input when no native scroll
  position changed. Prefer the nearest scrollable page container, then the
  document scrolling element; apply a delta once and preserve page-listener
  isolation.
- Ensure the geometry stabilizer receives the resulting scroll and retains all
  silent overlay nodes.
- Focused validation: popup App/preview controller, interaction shield/input
  firewall, silent renderer/stabilizer, and P17/P18/P20 browser gates.
- Fallback: if no scroll owner exists, leave the page unchanged and surface the
  condition only in debug diagnostics; never re-enable page interactions.

### R6 — Integration, headed acceptance, evidence, and delivery

- Run `pnpm lint`, `pnpm check`, focused/full `pnpm test`, `pnpm build`,
  `pnpm build:debug`, `pnpm verify`, and P14–P20 gates. Preserve generated
  artifacts outside the source set when clean-source gates require it.
- Rebuild and run repository `live-browser` headed workflows on DPJ, Aleris,
  Acne Specialisten, Assist24, Arno, ArkivIT, Teknikhallen, and Humanova. Use
  external observers only between extension-owned emulation/inspection
  transitions.
- Verify both render modes, 412×960 marking, 1920×1080 silent posture,
  intentional suppression/exclusion, modifier and exact-clear behavior,
  `<1 s` dirty projection, bounded Teknikhallen AI start, semantic two-way
  Content List, one 200 Save, shield scrolling with retained overlays,
  persistent reveal/freeze/lazy state, payload hygiene, publication fences, and
  clean consoles.
- Record external blocks for Acapedia/3D Prima and N/A for Bigbag without
  downgrading or fabricating results. Update P22/P20 evidence and the execution
  checklist.
- Perform a final high-signal diff review, explicit staging, commit, graph
  refresh, ahead/behind check, non-force push to `origin/re-write`, and final
  graph refresh.

## Test matrix

| Contract | Unit/component | Integration | Headed acceptance |
| --- | --- | --- | --- |
| Exact widened-owner clear | engine/store/listener | content entrypoint physical action | plain click + context Clear after Shift widen |
| Invisible exclusion paint | renderer/composed visibility | mutation + branch repaint | DPJ, Acne, ArkivIT hidden UI |
| Dirty projection `<1 s` | popup signal queue/cursor | content fact -> brain -> popup | all usable candidates after post-AI edit |
| AI start acknowledgement | scheduler/generation outcomes | popup/content/background bus | Teknikhallen sends one AI request or precise bounded failure |
| One-shot Save fence | lock client/runtime/services | popup reconciliation -> Hub | one current-page `/save`, HTTP 200, no retry |
| Silent selector authority | presentation/preview controller | config load + new popup organ | DPJ button, rows, and 100+ overlays agree |
| Shield scroll fallback | input firewall/shield | scroll + geometry stabilizer | Arno moves and overlay identities persist |
| Existing invariants | current suites | P14–P20 | consent, payload, freeze, render, emulation, publish fence |

## Regression risks

- A status waiter could accept an unrelated websocket event. Fence it by client
  instance, monotonically increasing state occurrence, property identity,
  editor session, ownership role, and token; timeout locally.
- Direct signal pulls could race navigation. Require the exact bound tab/key and
  let the existing navigation occurrence reset discard stale results.
- Overlay XPath interaction could clear a relocated/stale row. Resolve only from
  the current bridge generation and require an exact explicit canonical row.
- Ancestor visual checks can be expensive on huge DOMs. Run only for exclusion
  rows being painted, stop at the document root, and retain geometry batching.
- Scroll fallback could double-scroll. Measure before/after the native frame and
  apply only if every candidate scroll owner is unchanged.
- Silent selector fallback could expose stale data during marking. Restrict it
  to silent presentation/projection; post-AI and Save continue using brain state.

## Acceptance

- Every code-owned failure in the 2026-08-26 report has an automated regression
  and passes on the usable headed candidate set.
- Each usable Save click emits at most one current-page-only `/save`; successful
  scenarios receive one HTTP 200 and adopt the authoritative response. Local
  fence-refresh failure emits zero requests and a visible reason.
- Teknikhallen reaches `/get_selectors` after exact generation acknowledgement
  without a minute-long popup stall; all terminal paths release popup/content
  busy state promptly.
- A post-AI edit disables Save and Content List within one second on every usable
  candidate.
- Shift widening, plain exact-owner unmark, Alt inclusion, and context Clear pass;
  no visually invisible exclusion rectangle is present while extraction state
  remains excluded.
- DPJ silent highlighting, selector count, Content List availability, rows, and
  two-way focus agree. Arno scrolls under the shield without losing highlights.
- Persistent freeze/lazy suppression remains active until navigation, consent
  suppression stays intentional, payloads remain singular/clean, and no publish
  request occurs below coverage.
- Full automated validation, clean headed evidence, final review, commit, graph
  refresh, and non-force push all complete.

## Todo chain

- [ ] R1 — Characterization and contract evidence
- [ ] R2 — Exact marking ownership and live visibility
- [ ] R3 — Immediate dirty projection and bounded AI start
- [ ] R4 — Authoritative one-shot Save fence
- [ ] R5 — Silent selector coherence and shield scrolling
- [ ] R6 — Integration, headed acceptance, evidence, and delivery
