# P20 Assist24/Arno/Bigbag/ArkivIT remediation plan — 2026-08-25

**Status:** completed, reviewed, and pushed to `origin/re-write`.

**Finding evidence:**
[`p20-assist24-arno-bigbag-arkivit-live-sanity-report-2026-08-25.md`](./p20-assist24-arno-bigbag-arkivit-live-sanity-report-2026-08-25.md)

## Goal

Close the three repeatable defects from the headed Assist24, Arno, Bigbag, and
ArkivIT workflow round: raw production-code source in clean captures, duplicate
post-Save authority reconciliation, and unmanaged copy on authoritative managed
non-candidate roots. Preserve intentional consent suppression, current marking
semantics, property/navigation fences, and the no-publication rule below complete
candidate coverage.

## Current facts

- AI and Save already share `stripUncapturableHtml`, and their HTML is free of
  extension roots, `data-uf-*` state, and consent-provider dialogs. That sanitizer
  does not remove `SCRIPT`, `STYLE`, or `NOSCRIPT`, so identical raw source appears
  in AI and Save payloads.
- Save is already single-flight and emits one current-page `/save`. After success,
  `performSaveSession` directly forces Todo context refresh, while its paused
  authority queue also owns a trailing forced refresh. The transition back to
  silent desktop can reload the document, but the Save path uses the simplified
  emulation helper that discards `reloadExpected`; the resulting rebound may
  invalidate the binding and configuration cache before the queued refresh.
- Hub correctly reports Arno, Bigbag, and ArkivIT roots as
  `managed_non_candidate` with a non-null `{environmentKey, siteId}`. The lock
  runtime currently throws that identity away and maps the page to the same
  `not-candidate` banner reason used for a truly unmanaged property.
- Bigbag has no authoritative page types or candidates. Its candidate-only gates
  remain honestly N/A until Hub data supplies a candidate; no URL will be invented.

## Decisions

1. Remove raw `SCRIPT`, `STYLE`, and `NOSCRIPT` bodies from the canonical
   sanitized HTML used by AI and Save while preserving their inert element shells
   and XPath positions. Keep immutable-selector definitions, technical mark
   decisions, Content List rows, and debug diagnostics unchanged.
2. Give Save one post-success authority owner. The Save transaction adopts the
   authoritative response, performs a reload-aware transition to silent desktop,
   rebinds if Chrome replaces the document, and then requests one coalesced forced
   authority pass. It does not issue a second direct Todo/context refresh.
3. Preserve `not_candidate` as the public page/lock status, but retain managed
   property identity and emit a distinct typed `managed-non-candidate` banner
   reason. Popup and content surfaces use managed-page guidance; unmanaged roots
   retain `Not a managed property`.
4. Consent suppression and extraction exclusion remain active. No selector,
   permission, Hub endpoint, Save schema, AI schema, or Lynx publication change is
   authorized.

## Non-goals

- Do not restore cart, account, contact, assembly, country, modal, or consent UI.
- Do not change marking defaults, widening, immutable-node behavior, selector
  generation, candidate discovery, or page-type coverage.
- Do not publish any property whose authoritative Todo coverage is incomplete.
- Do not fabricate a Bigbag candidate or classify its missing Hub data as an
  extension defect.

## Implementation phases

### 1. Canonical capture sanitization

- Extend `src/content/marking/submit.ts:stripUncapturableHtml` so raw production
  `SCRIPT`, `STYLE`, and `NOSCRIPT` bodies are removed before extension-attribute
  and class sanitization, without changing the element structure used by rows.
- Add regressions for mixed-case tags, attributes containing `>`, nested-looking
  source text, raw/rendered parity, and preservation of adjacent visible content.
- Focused gate:
  `pnpm vitest run tests/src/content/marking/dom-bridge.test.ts tests/golden/ai-snapshot.test.ts --reporter=dot`.

### 2. Save authority and emulation coalescing

- Make the post-Save silent transition consume the explicit emulation result. If
  a reload is expected, wait for the replacement content realm and rebind to the
  same frozen property identity before any authority work resumes.
- Remove the direct forced Todo refresh from `performSaveSession`. Resume the
  existing paused authority queue once, with a forced trailing run that owns
  context, lock, Todo, configuration, and projection adoption for the rebound
  binding.
- Ensure a same-binding rebound keeps definitive `not_found`/authoritative Save
  adoption and never creates a duplicate `/load`; identity changes still clear
  the cache and fail stale work open.
- Extend queue/entrypoint tests for one `/save`, one trailing `/context`, at most
  one `/load` per binding, reload/no-reload paths, late mutation fencing, and
  interaction cleanup.
- Focused gate:
  `pnpm vitest run tests/src/popup/authority-refresh-queue.test.ts tests/src/popup/configuration-controller.test.ts tests/src/popup/entrypoint.test.ts --reporter=dot`.

### 3. Managed non-candidate presentation

- Add `managed-non-candidate` to the internal lock-reason vocabulary and both
  surface copy tables.
- In `src/background/lock-runtime.ts`, retain the authoritative environment/site
  identity for `managed_non_candidate` and use the new blocked reason after any
  active-editor off-candidate grace path.
- Prove managed roots and truly unmanaged roots remain distinguishable through
  background response parsing, brain signals, popup copy, and content copy.
- Focused gate:
  `pnpm vitest run tests/src/background/services.test.ts tests/src/lock/copy.test.ts tests/src/popup/app.test.ts tests/src/messaging/contracts.test.ts --reporter=dot`.

### 4. Integrated automated and headed acceptance

- Run all focused suites, `git diff --check`, `pnpm lint`, `pnpm check`, and
  `pnpm verify`, followed by `pnpm build:debug` and production/debug P14–P20 gates.
- Use only the repository `live-browser`, `live-round`, and `live-watch` skills in
  launcher-owned headed Chromium. External observers remain detached during
  extension-owned inspection/emulation.
- On Assist24, Arno candidate, and ArkivIT candidate, require both inspection
  modes, 412x960 marking, 1920x1080 silent desktop, consent exclusion,
  reveal/freeze/lazy loading, physical marking/highlighting, sub-second dirty
  projection, semantic Content List behavior, one Save, zero raw source tags in
  AI/Save, one post-Save authority cycle, Discard, shielded navigation with
  scrolling, and a fenced Send-to-Lynx checklist.
- On Arno, Bigbag, and ArkivIT roots, require authoritative managed property
  guidance and no `Not a managed property` copy. Bigbag candidate-only controls
  remain N/A if Hub still supplies no candidates.
- Require zero extension exceptions, unchecked message-port errors, duplicate
  Save, or Lynx publication request.

### 5. Evidence, review, and publication

- Update the finding report, P20 release evidence, and active execution plan with
  exact commands, source revision, acceptance artifacts/hashes, headed outcomes,
  and any honest environment/data limitation.
- Inspect the whole diff, rerun final checks required by `review-push`, commit the
  complete scoped remediation, push `re-write`, verify `0 0` local/upstream
  divergence, and refresh the codebase knowledge graph after commit and push.

## Test matrix

| Contract | Automated evidence | Headed evidence |
|---|---|---|
| Clean AI/Save HTML | sanitizer + golden submission tests | zero raw `script/style/noscript` bodies in captured requests |
| One post-Save authority owner | queue/config/entrypoint tests | one trailing context cycle and no repeat load |
| Reload-safe silent transition | entrypoint emulation tests | 412x960 marking -> 1920x1080 silent |
| Managed root identity/copy | lock runtime, schema, copy, App tests | Arno/Bigbag/ArkivIT root guidance |
| Consent exclusion | existing P13/P20 suites | hidden roots absent from marking and payloads |
| Workflow integrity | `pnpm verify`, P14–P20 prod/debug | inspection through fenced Send/Discard |

## Risks and mitigations

- Removing source tags must not damage visible markup. Reuse the sanitizer's
  balanced-subtree removal and test hostile source bodies plus adjacent content.
- A reload may arrive after the Save response. Freeze `{environmentKey, siteId}`,
  wait only through the existing bounded reload fence, and reject identity drift.
- Queue coalescing could omit required Todo adoption. Make the single forced
  trailing authority run observable in tests and headed network evidence.
- A new reason could drift between realms. Declare it in the shared Zod schema
  and keep exhaustive copy maps/tests so compilation fails on missing surfaces.
- Live sites and Hub candidate feeds can change. Record exact URLs/timestamps and
  distinguish backend data state from product failures.

## Acceptance criteria

- Each of the three defects has a failing-before/passing-after regression.
- Focused suites, `pnpm verify`, debug build, and production/debug P14–P20 gates
  pass from one source revision.
- Headed Assist24/Arno/ArkivIT candidate workflows and all four root authority
  checks pass, except Bigbag candidate-only work may remain documented N/A solely
  for an unchanged zero-candidate Hub response.
- Consent suppression stays active and absent from all extraction artifacts.
- The final evidence states observed facts without speculative causes.
- The reviewed commit is pushed and `re-write...origin/re-write` is `0 0`.

## SQL todo chain

The executable dependency chain is stored in `.temp/run-plan-session.sqlite`:

`capture-sanitization -> save-authority-coalescing -> managed-root-copy -> integrated-validation -> review-push`.

## Execution outcome

- Canonical source-shell sanitization, Save authority coalescing, explicit
  emulation transitions, managed-non-candidate identity/copy, semantic preview
  rows, and optional-message outcomes shipped in `ca332c03`.
- Headed inspection exposed a real emulated-viewport mismatch between
  `innerWidth/innerHeight` and the visual viewport. Content and background paint
  proofs were aligned to `visualViewport` in `8646216f` and `bcf4d2cb`; both
  Assist24 inspection modes then ended `paint-acknowledged`.
- Final lazy-media validation corrected the original report's placeholder-based
  metric. The reveal now makes a bounded live-handler bottom visit, uses instant
  capture scrolling, promotes finite existing `data-src`/`data-srcset`/poster
  media, and requests existing native-lazy resources before the observer fence
  (`737346c8`). ArkivIT resolved 5/5 deferred footer resources and Arno resolved
  3/3 native-lazy footer resources before persistent freeze.
- `pnpm verify` passed 125 files / 1,135 tests, the production build, and seven
  manifest assertions. `pnpm build:debug` passed. Final clean-source gates passed:
  P14 192 scenarios, P15 36/36, P16 13/13, P17 19/19, P18 14/14, and P20 4/4.
- Headed acceptance used only the repository `live-browser`, `live-round`, and
  `live-watch` procedures. Consent suppression remained active and excluded;
  no publication request was emitted. Bigbag still has no authoritative
  candidate, so candidate-only work remains honestly N/A.
