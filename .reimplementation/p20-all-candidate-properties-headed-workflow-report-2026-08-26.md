# P20 all-candidate headed-browser workflow report — 2026-08-26

## Overall verdict

The current source is **not a release candidate**. The controlled P14–P20
browser gates are green, but the production-site round found two P0 integration
failures and several cross-site P1 contract failures.

- Eight usable candidate pages completed at least marking activation in the
  repository-managed headed browser: DPJ, Aleris, Acne Specialisten, Assist24,
  Arno, ArkivIT, Teknikhallen, and Humanova.
- Acapedia is externally blocked by a current `403 Forbidden` response.
- The 3D Prima `/se` property still advertises candidate URLs, but the tested
  Anycubic and Sinterit candidates currently render 3D Prima's own 404 page.
  Results collected on that error page are not counted as candidate-workflow
  passes.
- Bigbag has no authoritative candidate and remains honestly N/A. JC Flytt was
  replaced by Humanova at the user's request and was not retested.
- Consent suppression is a **pass**, including on DPJ. Blocking commerce,
  account, contact, assembly, country, and consent UI stayed hidden and excluded
  from extraction. Suppression is not listed as a defect.
- No Send-to-Lynx publication was attempted. Every available checklist remained
  fenced and network observation saw zero publish requests.

The principal blockers are:

1. **P0 — Save/lock race:** five of seven candidates that reached Save received
   an unexpected HTTP 409. DPJ recovered only by issuing a second Save; Aleris,
   Acne, ArkivIT, and Humanova still failed after Refresh and retry.
2. **P0 — Teknikhallen Run AI:** the popup remained busy for more than 90
   seconds, emitted no `/get_selectors` request, then reported
   `Run AI failed: The page did not acknowledge the AI start in time.`
3. **P1 — delayed dirty projection:** DPJ, Acne, Assist24, ArkivIT, and Humanova
   took 2.7–4.7 seconds to project `requires-ai-run`, exceeding the one-second
   contract.
4. **P1 — expanded-mark clearing:** a plain click on an expanded exclusion did
   not clear that owner on the reproducible DPJ, Aleris, Assist24, Arno, and
   ArkivIT paths.
5. **P1 — invisible overlay leakage:** exclusion overlays targeted visually
   invisible elements on DPJ, Acne, and ArkivIT.
6. **P1 — silent shield scroll:** Arno failed to move on the sampled wheel
   scroll. Retained reveal freeze/lazy-suppression state is intentional until
   navigation and is not a cleanup defect.
7. **P1 — DPJ Content List coherence:** silent highlighting contained more than
   100 overlays, but **Show Content List** was disabled as “No saved selectors.”

## Source, browser, and method

- Source: branch `re-write`, commit
  `93bc2b2347779fd1e7d19bf8e524f07f8d898789` (`Close Humanova P21
  acceptance`). The tested source set was clean before and after the round; this
  report is the only intentional worktree addition.
- Extension: production and debug builds from package version `2.0.0`.
- Browser: repository `live-browser`, `live-round`, `branch-sync`, and
  `repo-knowledge` procedures with launcher-owned, headed Chromium. No personal
  Chrome profile or generic Playwright browser was used for the production-site
  workflows.
- Extension-owned emulation and Render Inspection ran with external website
  debuggers detached. Short-lived CDP observers were attached only between
  transitions for DOM, payload, network, console, and physical-input evidence.
  Keeping an observer attached during emulation caused false activation failures
  on Aleris and Acne; clean launcher-only retries passed and those attempts are
  classified as observer interference, not product failures.
- Physical pointer, keyboard, modifier, context-menu, scrolling, and row
  activation paths were used. AI and Save request bodies were inspected without
  changing their content.
- The round tested the selected candidate page only. It did not invent a page
  when Hub supplied none, and it did not publish incomplete properties.

## Candidate resolution

| Property supplied | Candidate used | Current authority/result |
| --- | --- | --- |
| `dpj.se` | `https://www.dpj.se/` | Usable managed candidate |
| `aleris.se` | `https://www.aleris.se/kirurgi/brack/aderbrack/` | Usable `service_page` candidate |
| `acnespecialisten.se` | `https://www.acnespecialisten.se/` | Usable managed candidate |
| `acapedia.no` | `https://acapedia.no/` | Candidate externally blocked by `403 Forbidden` |
| `3dprima.com/se` | `https://www.3dprima.com/se/3d-skrivare-mer/tillverkare/anycubic` | Hub candidate is stale; page renders site 404. Sinterit candidate also renders site 404 |
| `assist24.dk` | `https://www.assist24.dk/` | Usable managed candidate |
| `arno.eu` | `https://arno.eu/collections/katting` | Usable `category` candidate |
| `bigbag.se` | None | Managed non-candidate with zero candidates; N/A |
| `arkivit.se` | `https://arkivit.se/tjanster/arkivering-registratur/` | Usable `service_page` candidate |
| `teknikhallen.se` | `https://teknikhallen.se/` | Usable managed candidate |
| `humanova.com` | `https://www.humanova.com/` | Usable managed candidate; replaced JC Flytt |

Bonliva was previously present only as ambient browser state, not as a property
the user asked to test, and is outside this matrix.

## Site-level result

| Site | Result | Summary |
| --- | --- | --- |
| DPJ | **FAIL** | Both inspection modes passed after one JavaScript-on retry; marking used 412×960; consent and payload hygiene passed. Dirty projection took 2.835 s, Save emitted 409 then 200 instead of one request, expanded clearing failed, invisible overlays appeared after interaction, and Content List was unavailable despite 109–115 silent overlays. Persistent freeze/lazy suppression was correct. |
| Aleris | **FAIL** | Render, emulation, freshness (212 ms), 164-row two-way Content List, payload hygiene, and silent highlighting passed. Expanded clearing failed and both Save attempts returned 409. |
| Acne Specialisten | **FAIL** | Render, emulation, 295/298-row Content Lists, payload hygiene, and silent highlighting passed. One invisible-target overlay appeared, dirty projection took 4.703 s, and both Save attempts returned 409. |
| Acapedia | **BLOCKED** | The live page body is `403 Forbidden`; there is no eligible content with which to validate marking, AI, Save, preview, or extraction contracts. |
| 3D Prima `/se` | **BLOCKED** | Both currently offered category candidates render a site-owned 404. The error page could be marked and analyzed, but that is not valid candidate evidence and no Save/publication result is claimed. |
| Assist24 | **FAIL** | Render, 412×960 marking, 59-row two-way Content List, clean payload, exactly one HTTP 200 Save, and persistent freeze/lazy suppression passed. Dirty projection took 2.705 s and expanded clearing failed. |
| Arno | **FAIL** | Render, freshness (243 ms), 77/76-row two-way Content Lists, clean payload, exactly one HTTP 200 Save, and persistent freeze/lazy suppression passed. Expanded clearing failed and the sampled shield wheel scroll stayed at `scrollY=2082`. |
| ArkivIT | **FAIL** | Render, 5/5 lazy images, 62-row two-way Content List, clean payload, and silent highlighting passed. Two invisible overlays appeared, dirty projection took 2.734 s, expanded clearing did not work, and both Save attempts returned 409. |
| Teknikhallen | **FAIL** | Marking activated in 29 ms at 412×960 and Render Inspection passed after a JavaScript-off retry. Run AI never sent a request and timed out after 90 s, so Content List, Save, payload, and saved silent highlighting could not be accepted. |
| Humanova | **FAIL** | Render, 421-row marking Content List, 331-row saved silent Content List, clean payload, and silent highlighting passed. Dirty projection took 2.738 s, expanded clearing was not proven, and both Save attempts returned 409. |
| Bigbag | **N/A** | Hub currently supplies no candidate. Candidate-only controls were not bypassed and no functional pass is claimed. |

## Contract matrix

Legend: **P** = pass, **F** = fail, **B** = externally/authority blocked,
**N/A** = contract could not legitimately run, **P\*** = pass after a transient
retry, and **L** = limited evidence.

| Candidate | Render inspection | 412×960 / 1920×1080 | Consent exclusion | Marking contract | AI + ≤1 s freshness | Content List / two-way UX | Save / payload | Silent shield + scroll | Reveal/freeze/lazy | Publish fence | Runtime hygiene |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DPJ | P\* | P | P | **F** | **F** | **F** | **F** / P hygiene | P | P | P | P |
| Aleris | P | P | P | **F** | P | P | **F** / P hygiene | P | P | L/no publish | P |
| Acne | P | P | P | **F** | **F** | P | **F** / P hygiene | P | L/early freeze sample | L/no publish | P |
| Acapedia | B | B | B | B | B | B | B | B | B | N/A | P for extension |
| 3D Prima `/se` | B | B | L/error page only | B | B | B | B | B | B | N/A | P for extension |
| Assist24 | P | P | P | **F** | **F** | P | P | P | P | L/no publish | P |
| Arno | P | P | P | **F** | P | P | P | **F** scroll | P | L/no publish | P |
| ArkivIT | P | P | P | **F** | **F** | P | **F** / P hygiene | P | P | P | P |
| Teknikhallen | P\* | P | P | L | **F** | N/A | N/A | N/A | P marking freeze | P | P |
| Humanova | P | P | P | **F/L** | **F** | P | **F** / P hygiene | P | P | P | P |

## Detailed contract findings

### Render Inspection and navigation fencing

- Both **With JavaScript** and **Without JavaScript** reached
  `paint-acknowledged` on every usable candidate.
- DPJ's With-JavaScript run and Teknikhallen's Without-JavaScript run each
  timed out once and then passed on immediate retry. The functional result is a
  pass, but this is a reliability warning rather than a clean first-attempt
  result.
- The controlled P16 gate separately passed all 13 document identity,
  same-document history/fragment, path/query/document fence, double-frame paint,
  guarded starvation fallback, stale acknowledgement, terminal cleanup, and
  lifecycle-stage checks.

### Emulation and session coherence

- Every usable marking session reached the required 412×960 mobile posture.
- Every completed silent check restored 1920×1080 desktop posture.
- Observer-attached activation attempts on Aleris and Acne initially failed;
  detaching the observer before extension-owned emulation produced clean passes.
  This confirms the prescribed split workflow is necessary and prevents those
  observer artifacts from being mistaken for product regressions.
- No completed transition left a stale mobile viewport in silent mode.

### Consent suppression and extraction exclusion

Consent handling passed and is intentional. All measured suppression roots had
`visibleSuppressed=0`:

| Candidate | Suppressed roots | Visible suppressed roots |
| --- | ---: | ---: |
| DPJ | 19 | 0 |
| Aleris | 5 | 0 |
| Acne | 7 | 0 |
| Assist24 | 5 | 0 |
| Arno | 36 | 0 |
| ArkivIT | 2 | 0 |
| Teknikhallen | 7 | 0 |
| Humanova | 17 | 0 |

Suppressed nodes did not enter AI HTML, Save HTML, marking rows, Content List
rows, or publication artifacts. DPJ's cart, account, contact, assembly,
country, modal, and similar blocking UI therefore remain correctly hidden and
excluded.

### Marking, inclusion/exclusion, and visible overlays

- Alt inclusion, Shift widening, and context-menu commands were available on
  the normal content paths.
- The important failure is owner clearing: after an exclusion was expanded, a
  plain click did not remove that expanded mark. On Aleris, Assist24, and Arno,
  observed mark counts progressed `0 → 1 → 2 → 3 → 4`; the final click should
  have reduced the count. DPJ reproduced the same failure in an earlier clean
  retry, and ArkivIT showed no clear delta even though **Clear mark** was
  enabled. Acne and Humanova changed asynchronously, so their individual click
  timing is not treated as conclusive proof of the same mechanism.
- Invisible-target overlays violate the visual contract: DPJ had 16 after the
  interaction/AI sequence, Acne had 1, and ArkivIT had 2. Initial suppression
  remained invisible; these are marking overlays, not visible consent nodes.
- Teknikhallen's sampled plain/Alt points did not produce stable deltas before
  the AI failure. Marking activation itself was fast, but the complete modifier
  contract is classified as limited rather than passed.

### AI lifecycle and local freshness

| Candidate | First AI | Dirty projection | ≤1 s result | Second AI behavior |
| --- | ---: | ---: | --- | --- |
| DPJ | 8.917 s | 2.835 s | **Fail** | Automatic reconciliation, 3.744 s |
| Aleris | 1.143 s | 212 ms | Pass | Explicit, 1.189 s |
| Acne | 8.568 s | 4.703 s | **Fail** | Automatic reconciliation, 6.114 s |
| Assist24 | 1.124 s | 2.705 s | **Fail** | Automatic reconciliation, 2.729 s |
| Arno | 1.351 s | 243 ms | Pass | Explicit, 1.066 s |
| ArkivIT | 1.269 s | 2.734 s | **Fail** | Automatic reconciliation, 2.763 s |
| Teknikhallen | No start acknowledgement | N/A | **Fail** | No request emitted |
| Humanova | 1.397 s | 2.738 s | **Fail** | Automatic reconciliation, 2.745 s |

The delayed cases did eventually become dirty, often by automatically
reconciling/rerunning AI. That does not satisfy the typed local signal contract,
which requires Save and Content List to project `requires-ai-run` within one
second without waiting for remote work.

Teknikhallen is a separate P0 failure: Run AI became busy, but network capture
saw no `/get_selectors` request before the 90-second timeout. The popup later
released and displayed the specific start-acknowledgement error, matching the
user's earlier report.

### Content List and two-way highlighting

On every valid AI result except DPJ, all preview rows were semantic buttons,
had ordinal/readable label/Included-or-Excluded state in the accessible name,
used pointer-and-keyboard instructions, exposed no raw source, and passed both
directions:

| Candidate | Marking rows | Silent rows | Row → page | Page → row |
| --- | ---: | ---: | --- | --- |
| Aleris | 164 | 164 | Pass | Pass |
| Acne | 295 | 298 | Pass | Pass |
| Assist24 | 59 | 59 | Pass | Pass |
| Arno | 77 | 76 | Pass | Pass |
| ArkivIT | 62 | 62 | Pass | Pass |
| Humanova | 421 | 331 | Pass | Pass |

DPJ is incoherent: its current AI projection produced no usable marking rows,
while silent mode visibly retained 109–115 selector overlays. The popup still
disabled **Show Content List** as “No saved selectors.” Teknikhallen never
obtained selectors because AI failed before the request.

### Save serialization, authority, and payloads

| Candidate | Save requests | Statuses | Result |
| --- | ---: | --- | --- |
| DPJ | 2 | 409, 200 | **Fail exact-one contract; eventual authoritative success** |
| Aleris | 2 | 409, 409 | **Fail** |
| Acne | 2 | 409, 409 | **Fail** |
| Assist24 | 1 | 200 | Pass |
| Arno | 1 | 200 | Pass |
| ArkivIT | 2 | 409, 409 | **Fail** |
| Humanova | 2 | 409, 409 | **Fail** |

Every 409 displayed the reason-specific stale-lock toast and interactions were
restored. That cleanup/copy contract passes, but Save serialization/authority
does not: Refresh did not recover four properties, while DPJ could recover only
through a second request, violating the “exactly one current-page-only Save”
contract.

All captured AI and Save bodies passed extraction hygiene:

- the schema carried one singular current-page `page` object and no page array;
- zero extension artifacts or `data-uf-*` surfaces;
- zero non-empty `script`, `style`, or `noscript` bodies;
- zero suppressed consent/blocking subtrees.

No endpoint or public payload schema drift was observed. The defect is the
lock/fence state accompanying otherwise clean payloads.

### Reveal, freeze, lazy loading, and silent preview

- Valid marking sessions invoked reveal/freeze. DPJ completed 109/109 lazy
  images and ArkivIT completed 5/5 in the measured runs. Other usable pages had
  no outstanding native-lazy image in the sampled posture. Acne's first posture
  sample was taken immediately after its unusually fast 26 ms activation and
  did not yet expose the pause/suppression attributes, so that individual
  freeze-state proof is limited rather than promoted to a pass.
- Silent overlays and the opaque interaction shield survived scrolling on every
  page with saved selectors. Acne dynamically reprojected from 65 to 131
  overlays rather than losing highlighting; its shield remained present.
- Persistent `motionPaused` and `lazySuppressed` are owned by the page visit and
  correctly remain active after entering silent mode until navigation. Samples
  that did not expose the flags do not redefine that lifecycle contract.
- Arno's sampled shield wheel scroll remained at `2082 → 2082`; DPJ and
  Assist24 still moved by 720 px under the same persistent freeze posture.
- The probes establish functional traversal, lazy completion, scroll return,
  freeze state, and cleanup. They do not establish subjective animation
  equivalence to every legacy easing frame. Legacy-smoothness parity therefore
  remains a visual review item; retained silent freeze is expected behavior.

### Polling, publication, and runtime hygiene

- Idle observation windows emitted zero or one `/context` request and zero
  `/load` requests. No overlapping idle authority traffic was seen. Requests
  triggered by explicit Refresh, AI, or Save are not misclassified as idle.
- DPJ's checklist showed 7 required page types; ArkivIT showed 2; Teknikhallen
  and Humanova showed 4 each. Send stayed disabled and publish request count was
  zero. Where failed Save/fresh authority made the checklist unavailable, the
  result is limited rather than called a pass; it still produced no publication.
- Completed live captures recorded zero extension console errors, site console
  errors, and uncaught page errors. Expected no-receiver messaging did not
  produce unchecked port errors.

## Automated validation

The repository tests and controlled acceptance gates are all green from the same
source. This does not override the production integration failures above.

- `pnpm verify`: passed lint/check, 127 test files / 1,160 tests, production
  build, and 7 manifest tests.
- `pnpm build:debug`: passed.
- `pnpm performance:p14`: passed 192 scenarios with zero semantic, budget,
  activation, or mutation-pressure failures.
- `pnpm performance:p15`: passed 36/36.
- `pnpm performance:p16`: passed 13/13.
- `pnpm performance:p17`: passed 19/19.
- `pnpm performance:p18`: passed 14/14.
- `pnpm performance:p20`: passed 4/4.

The first P15 invocation passed all 36 behavioral checks but failed the
clean-source precondition because P14's newly generated untracked acceptance
artifact was still in the output directory. The artifact was preserved in the
round bundle, the generated copy was moved out of the source set, and P15 was
rerun cleanly. This was harness hygiene, not a product failure.

| Gate | Preserved artifact | SHA-256 |
| --- | --- | --- |
| P14 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-06-05-062Z.json` | `0f66310a0691f84f4c68a4ac0f69137954965854ae4b192770cd562c46b94d39` |
| P15 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-15-27-815Z.json` | `00a70fdd7497826e5af5c0986413c360aeb914ce352ca9f521459951d64af0b6` |
| P16 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-15-59-805Z.json` | `d9f04be7f8f57c1ace7583d6175af2e8a0d48ff3ad789b88122d1cfcf121c1f0` |
| P17 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-16-17-110Z.json` | `4e7cdf72ec76855c173be21a26dc55b7fb92f111027dc428b064ab6ff98594ca` |
| P18 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-16-42-147Z.json` | `ea8e159b0b02311f2b31173d97507d77b69d79ac5db908b0a6e4e732cc5840dd` |
| P20 | `.temp/full-workflow-2026-08-26/acceptance-2026-08-26T21-17-31-961Z.json` | `3ddd5b16dac8f857b596270a3ff80069478d0d835e8b529b223840c4f3564d24` |

Per-site machine-readable evidence and the two split observer harnesses are in
`.temp/full-workflow-2026-08-26/`.

## Required remediation order

1. Fix the Save/authority race so the frozen editor session and mutation fence
   accepted by the UI are the exact values sent in one Save. Add a production-
   shaped regression for the observed `409 → Refresh → 409` path and retain the
   current visible error/cleanup behavior.
2. Instrument and fix the Teknikhallen pre-request AI acknowledgement path.
   Distinguish content-script non-delivery, reveal/freeze wait, generation
   mismatch, and start acknowledgement in the visible error and debug stages.
3. Make the typed local signal projection authoritative immediately after every
   marking mutation. Save and Content List must show `requires-ai-run` within one
   second without starting or waiting for authority/AI work.
4. Repair expanded-exclusion owner clearing and add physical pointer regressions
   for plain clear after Shift widen, including nested and relocated overlays.
5. Filter overlay candidates by current rendered visibility after suppression,
   scroll, resize, and DOM mutation. Invisible nodes may remain excluded in the
   extraction model but must never receive a visible marking overlay.
6. Preserve reveal/freeze and lazy-suppression leases until navigation; repair
   shield scrolling only where a site-owned lock defeats the native wheel
   default, while retaining dynamic highlight reprojection.
7. Reconcile DPJ's saved selector authority with Content List availability so
   the button and rows agree with the 109+ silent overlays.
8. Refresh or remove stale 3D Prima candidate URLs and restore Acapedia access;
   rerun their candidate-only gates once real content is available.

P20 should remain reopened until the production-site Save and Teknikhallen AI
blockers are fixed and a clean headed rerun passes all usable candidates.
