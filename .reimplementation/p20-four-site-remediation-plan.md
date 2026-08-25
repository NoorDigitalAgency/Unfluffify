# P20 Four-Site Follow-up Remediation Plan

## Goal

Close the failures found in the headed production workflow round on `acnespecialisten.se`, `acapedia.no`, `3dprima.com`, and `3dprima.com/se`, then repeat the complete round with repository-level live-browser tooling. P20 remains complete historically; this document is a follow-up acceptance slice and does not rewrite its prior evidence.

## Current facts

- Acne Specialisten passed the workflow. Its lazy-content observation is a regression check, not a blocker.
- Acapedia consent elements are correctly suppressed, but the provider's `html.noScroll` lock remains effective because the suppression stylesheet does not release root overflow. The same page exposes an SVG/non-string `id`, and two marking predicates call `id.startsWith` without narrowing.
- The unmanaged 3D Prima root returns HTTP 404 from Hub context. The client currently collapses every context transport error to `unavailable`, so the popup reports an authority failure instead of a definitive unmanaged property. Explicit Refresh also performs a forced Todo context read twice.
- `/se` is a recognized 3D Prima property, and its Anycubic category is a candidate. A live capture proved that mobile emulation reloads the document; `bindToTab` advances the binding occurrence, so marking activation abandons the transition on its stale pre-reload binding.
- The visible country/customer modal on unmanaged `3dprima.com` is not a suppression defect. The binding specification scopes consent/blocking-UI suppression to recognized managed properties only.
- Consent suppression remains extraction hygiene: suppressed commerce, account, contact, assembly, country, modal, and similar blocking nodes must stay absent from captures, marking rows, AI HTML, and payloads.

## Decisions

- Release only known root scroll-lock postures while consent suppression is active. Preserve provider classes and DOM; removing the injected bypass stylesheet restores the provider posture.
- Read element IDs through a string-safe DOM attribute helper. Never stringify arbitrary SVG ID objects.
- Translate only a definitive Hub context HTTP 404 into `property_not_found`; authentication, network, and unexpected server failures remain `unavailable`.
- One explicit Refresh owns exactly one forced authority generation. Overlapping refreshes coalesce, and a pending forced request is retained for at most one trailing run.
- Treat the expected same-property, same-normalized-URL emulation reload as a transition continuation: resolve the new document, recapture the binding, revalidate candidate/lock authority, and then activate. Property or URL drift fails closed with a visible reason.
- Preserve typed content-command failures through the popup boundary and show reason-specific activation toasts. Do not add blanket retries.
- Never publish to Lynx during acceptance. Saving a first configuration is allowed only on a managed candidate and only after payload inspection.

## Open questions

None. The repository specification and the live evidence determine the required behavior.

## Non-goals

- Suppressing blocking UI on unmanaged roots.
- Changing Hub/Lynx endpoint or payload schemas, extension permissions, candidate rules, or the seven-page publication fence.
- Removing provider consent nodes or classes from the DOM.
- Treating third-party site console warnings as extension failures.

## Implementation phases

### 1. Consent and marking runtime hygiene

- In `src/content/consent.ts`, extend the temporary bypass stylesheet with narrowly scoped root lock selectors (`noScroll`, `no-scroll`, and `modal-open`) so `html` scrolls and the paired `body` no longer traps overflow while suppression is registered.
- In `src/content/marking/dom-view.ts` and `src/content/marking/engine.ts`, replace direct `element.id.startsWith(...)` access with a shared string-safe predicate based on `getAttribute("id")`.
- Extend `tests/src/content/consent.test.ts` and the focused marking tests with lock-release/restoration and non-string/SVG ID cases.
- Roll back this phase if suppression outlives lifecycle release, changes provider classes, or broadens beyond known lock postures.

### 2. Authority truth and refresh cadence

- In `src/lynx/context.ts`, discriminate transport HTTP status and map only 404 to an authoritative `property_not_found` context.
- In `src/entrypoints/popup/main.tsx`, make the queued authority run carry a coalesced force bit, let that run own the forced Todo/context projection, and remove the duplicate forced refresh from `refreshPopup`.
- Extract a small typed queue helper under `src/popup/` if needed to make single-flight and trailing-force behavior deterministic under unit test.
- Extend Lynx context, page-context, Todo, and popup contract tests for 404 semantics, one forced read, non-overlap, and trailing coalescence.
- Roll back this phase if non-404 failures become authoritative or a normal idle tick can bypass the 15-second backstop.

### 3. Reload-safe marking transition

- In `src/entrypoints/popup/main.tsx`, preserve the explicit target emulation mode and detect a binding change after mobile application.
- If the normalized property and page URL are unchanged, resolve the post-reload context, recapture the current binding, revalidate candidate/lock authority, pull signals, and continue activation on the new document. Any identity drift fails closed.
- Preserve the `ContentMessageDelivery`/command failure reason through activation and report a durable, reason-specific popup toast. Keep interaction and retained desktop/mobile posture restoration in `finally`/failure paths.
- Add regression coverage for expected reload continuation, property/URL drift rejection, no-receiver, structured refusal, and failed-activation posture restoration.
- Roll back this phase if activation can cross a property/page boundary or if failed activation leaves mobile emulation/content interaction active.

### 4. Automated acceptance

- Run the focused tests after each phase.
- Run `pnpm verify` and `pnpm build:debug` from a clean browser state.
- Require no unchecked extension message-port errors, no new TypeScript/lint failures, and no regression in P14-P20 contract suites.

### 5. Headed four-site acceptance

Use `.github/skills/live-browser`, `.github/skills/live-round`, and `.github/skills/live-watch` only. Keep debugger observers detached while extension-owned render inspection or emulation is active.

- Acne Specialisten: repeat render inspection, marking/highlighting, AI freshness, Content List, reveal/freeze, lazy loading, consent/payload hygiene, silent shield, scrolling, Discard, and publication fence checks.
- Acapedia: additionally prove vertical scrolling after consent suppression and absence of the non-string-ID exception.
- 3D Prima root: prove authoritative unmanaged state and exactly one forced `/context` request on explicit Refresh. Do not expect property-scoped suppression or enable marking.
- 3D Prima `/se`: prove exact non-candidate handling, follow a candidate URL, activate marking at 412×960 across any required reload, run AI, inspect included/excluded payload rows, verify immediate freshness invalidation, save at most one current-page configuration, restore 1920×1080 silent preview, and confirm Send to Lynx remains fenced below 4/4.
- Capture results and bugs in `.temp/live-watch-session.sqlite`; update execution evidence and durable knowledge only with reproducible conclusions.

### 6. Review and publication

- Review the complete diff for property/page authority, consent lifecycle, emulation restoration, payload scope, and test adequacy.
- Re-run final validation, commit only the planned files, refresh the codebase graph, fetch, verify the branch is not behind/diverged, and push `re-write` to `origin/re-write`.
- Stop and request direction rather than rebasing if upstream moved after implementation.

## Test matrix

| Area | Automated proof | Live proof |
| --- | --- | --- |
| Consent | temporary root unlock; stylesheet removal restores posture | Acapedia scrolls; suppressed nodes stay excluded |
| Marking DOM | SVG/non-string ID cannot throw | Acapedia marking/highlighting completes cleanly |
| Context | 404 => `property_not_found`; other errors => unavailable | 3D Prima root is unmanaged, not authority-unavailable |
| Refresh | single-flight; one forced generation; trailing force coalesces | explicit Refresh emits one `/context`; idle cadence stays >=15 s |
| Emulation | reload continuation; drift rejection; failure restoration | 3D Prima candidate activates at 412×960 and returns to 1920×1080 silent |
| Payload/freshness | existing current-page and AI-generation contracts pass | suppressed/extension nodes absent; post-AI edit disables Save/List within 1 s |
| Publication | existing coverage fence passes | no publish below complete coverage |

## Risks and mitigations

- **Over-broad scroll override:** scope CSS to explicit lock classes and lifecycle-owned stylesheet removal.
- **Reload crosses identity:** compare normalized property and page URL, then re-resolve authority before activation.
- **Refresh starvation or request multiplication:** retain a force bit in a single-flight queue and cover overlap with deterministic clocks/promises.
- **False unmanaged state:** map only a typed 404; all ambiguous failures stay unavailable/fail closed.

## Acceptance criteria

- All focused tests, `pnpm verify`, and debug build pass.
- Acapedia scrolls with suppression active and logs no extension `startsWith` TypeError.
- 3D Prima root reports authoritative unmanaged state and one forced context call per explicit Refresh.
- A 3D Prima candidate activates after mobile emulation/reload without crossing identity, and any failure is visible and posture-safe.
- The complete four-site production/debug live round satisfies UI, UX, render, consent, lazy-loading, reveal/freeze, marking, highlighting, freshness, payload, Save, coverage, and console contracts.
- No Lynx publish occurs.

## Todo dependency chain

1. `p20-four-plan`
2. `p20-four-consent-dom` depends on 1
3. `p20-four-authority` depends on 2
4. `p20-four-transition` depends on 3
5. `p20-four-verify` depends on 4
6. `p20-four-live` depends on 5
7. `p20-four-evidence` depends on 6
8. `p20-four-review-push` depends on 7

## Execution outcome

- Phases 1–4 are implemented. The live round additionally exposed two transition
  prerequisites: replacement content authority must use `{environmentKey,
  siteId}` rather than base-URL spelling, and Chrome debugger operations must be
  bounded/cleaned up when the host never acknowledges a command.
- The completed production workflows and the source-fresh debugger limitation
  are documented in
  [`p20-four-site-live-sanity-report-2026-08-25.md`](./p20-four-site-live-sanity-report-2026-08-25.md).
- The source-fresh managed-Chromium retry is intentionally not promoted to a
  pass: direct service-worker `Emulation.setDeviceMetricsOverride` also failed
  to resolve after a clean attach, proving the remaining observation is a
  headed-environment constraint rather than a silent popup refusal.
- `pnpm verify` passed 125 files / 1,131 tests, the production build, and all
  seven generated-manifest assertions. `pnpm build:debug` also passed.
