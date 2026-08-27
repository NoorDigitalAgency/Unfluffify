# P24 exact-readiness and legacy/rewrite cross-property report

**Date:** 2026-08-27

**Rewrite baseline:** `0f31b54a0c81edb82686eccade9a60fe418a052c` plus the P24 working change

**Pinned legacy:** `28974c2a0c859c91a7167f4757cf84a47ea31e28`

**Hub Alpha repair:** `ff4a460`, released as `v2026.11-alpha.14`

**Overall:** **PARTIAL — P24 remains open**

## Executive result

The exact-document reveal/freeze readiness race is repaired and the former
marking evidence false negative is removed. Automated behavior gates pass, and
the rewrite completed the core headed flow on nine reachable pages. Eight of
those produced exactly one successful authoritative Save with current-page-only,
artifact-free payloads. The Hub no longer rejects a valid cross-process Save as
`stale_fence`.

P24 is not complete. Current live evidence still contains these release blockers:

1. Teknikhallen cannot enable marking in the rewrite; an observer-free launcher
   run reports `Enable marking failed: device emulation could not be applied`.
   The pinned legacy completed this property in the retained production baseline.
2. Ledigajobb's first AI run completes but is very slow (127.4 s), its marking
   Content List contains zero rows, and the post-edit AI acknowledgement fails;
   no current-run Save proof exists.
3. DPJ projects 1,042 disabled Content List rows and does not project
   `requires-ai-run` within one second after the evidence edit.
4. Humanova briefly exposes one exclusion overlay whose target is no longer
   visually visible. Extraction still excludes that element; the failure is the
   visible marking only.
5. Freshness projection missed the one-second requirement on Acne Specialisten
   (1.445 s), ArkivIT (1.404 s), Arno (1.426 s), and DPJ (7.465 s).
6. The persistent page-target observer needed by the measurement harness can
   occupy or delay Chrome's single debugger/emulation path. Sequential timings
   of about 91 seconds on Assist24, Arno, and ArkivIT are therefore not accepted
   as product performance proof. They remain transition-risk evidence until the
   same sequence passes with extension-owned emulation fully observer-free.

No final Send-to-Lynx publication request was issued. Coverage fences remain in
place for incomplete properties.

## Overall property result

`Core` means activation, physical marking evidence, first AI, marking Content
List, post-AI freshness exercise, and Save where the resulting state permitted
it. A successful Save also required one request, HTTP 200, authoritative response
adoption, and a current-page-only clean payload.

| Property / page | Rewrite core | Activation | First AI | Content rows | Save | Legacy comparison | Status note |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Ledigajobb `/` | Partial | 2.291 s | 127.437 s | 0 | Not reached | Current exact run failed after a 492 s AI terminal failure; retained production baseline also failed late | AI/list blocker |
| DPJ `/` | Completed with defects | 4.912 s | 9.272 s | 1,042 | 1 × 200 | Retained legacy: 12.639 s activation, 30.239 s AI | Disabled list rows; 7.465 s freshness |
| Aleris `/` | Mechanically completed | 0.089 s | 1.076 s | 57 | 1 × 200 | Retained legacy: 4.779 s / 5.994 s | Live site returned its not-found page; exclude from content-accuracy denominator |
| Acne Specialisten `/` | Completed | 1.017 s | 6.846 s | 332 | 1 × 200 | Retained legacy: 0.626 s / 30.584 s | Freshness 1.445 s |
| Acapedia `/` | Completed | 0.209 s | 1.347 s | 93 | 1 × 200 | Retained legacy: 3.699 s / 4.988 s | Stale test lock required explicit Take over after an aborted evidence run |
| Assist24 `/` | Completed, timing inconclusive | 91.829 s | 1.393 s | 44 | 1 × 200 | Retained legacy: 4.406 s / 4.731 s | Sequential observer/emulation conflict; row-to-page sample did not scroll |
| Arno `/` | Completed, timing inconclusive | 91.703 s | 1.293 s | 52 | 1 × 200 | Retained legacy: 6.370 s / 7.552 s | Freshness 1.426 s; sequential observer/emulation conflict |
| ArkivIT `/` | Completed, timing inconclusive | 91.812 s | 1.301 s | 98 | 1 × 200 | Retained legacy: 3.823 s / 4.979 s | Freshness 1.404 s; sequential observer/emulation conflict |
| Teknikhallen `/` | Failed | — | — | — | — | Retained legacy: 6.970 s activation, 16.250 s AI | Observer-free emulation failure |
| Humanova `/` | Completed with defect | 0.560 s | 6.846 s | 218 | 1 × 200 | Retained legacy: 11.410 s / 12.358 s | One invisible-target exclusion overlay |

The supplied 3D Prima category currently resolves to a site-owned 404 and
Bigbag has no candidate page in the property feed. Neither is counted as a valid
candidate flow. Aleris was exercised because the feed still presents it, but its
live not-found body is excluded from content-accuracy conclusions.

## Contract matrix

| Contract | Rewrite result | Legacy/similarity result | Evidence and remaining work |
| --- | --- | --- | --- |
| Exact document activation acknowledgement | PASS in automated tests; PARTIAL live | Legacy has no exact-occurrence acknowledgement | Success now requires prepared/frozen ritual identity plus installed listeners. Eight strict live acknowledgements passed; Humanova failed only the overlay-visibility add-on. Teknikhallen did not activate. |
| Reveal, lazy loading, freeze | PASS on nine reached pages and P23 24/24 | Intended legacy sequence retained | Every reached rewrite status reported the exact ritual `prepared`, `frozenAtBottom=true`, lazy suppression, motion pause, and 412×960 marking. |
| Marking responsiveness | PASS automated; PARTIAL live | Rewrite is usually faster, but Ledigajobb is worse | P14 completed 192 semantic/performance scenarios. Fresh hover medians were 10.7–43.4 ms on measured pages. Ledigajobb measured 212.8 ms median / 7.9 s p95 under the persistent observer and needs observer-free confirmation. |
| Plain / Shift / Alt / exact clear | PARTIAL | Legacy visual evidence passes where authority allowed it | Canonical row-diff evidence prevents dirty-counter false failures. Full four-operation proof passed Acne and Acapedia; target availability/dynamic-row changes left incomplete cells on other sites. The contract implementation tests pass, but full physical cross-property coverage is not complete. |
| Invisible exclusion paint | FAIL 1 page | Consent/hidden paint intention matches legacy | Eight reached pages reported zero invisible-target overlays; Humanova reported one. Suppressed/excluded extraction state was not changed. |
| Consent suppression | PASS | Similar | All nine reached pages reported zero visibly suppressed nodes. Suppressed commerce/account/contact/modal UI remained excluded from rows, captures, AI HTML, and Save payloads. |
| AI start, spinner, terminal cleanup | PASS correctness; FAIL latency on Ledigajobb | Rewrite faster on eight retained comparisons | First AI succeeded on all nine reached rewrite pages. Spinner observation began in 26–111 ms. Ledigajobb took 127.4 s and its second run failed to acknowledge start. |
| Immediate dirty/freshness projection | FAIL | Rewrite contract is stricter than legacy polling | Five of nine exercised pages projected within one second. Acne, ArkivIT, Arno, and DPJ missed; DPJ took 7.465 s. |
| Content List semantic buttons and hygiene | FAIL 2 pages | Rewrite labels/accessibility improve on legacy | Seven pages had all semantic buttons, no missing accessible names, keyboard wording, and no production raw-source leak. DPJ had 1,042 disabled rows; Ledigajobb had zero rows. |
| Content List two-way routing | PARTIAL | Intended legacy behavior retained | Page-to-row focus passed on all meaningful populated samples. Row-to-page passed on six of nine; Assist24, DPJ, and Ledigajobb did not prove the reverse direction. |
| Silent highlights and desktop posture | PASS automated and observer-free sample | Similar behavior with retained geometry | Acapedia live proof: 17 silent overlays at 412×960; Desktop preview changed to 1920×1080 with shield, motion/lazy freeze, and zero visible suppression. After scroll+resize, highlights remained and reprojected from 17 to 86. P23 covers retained geometry under starved page rAF. |
| Save serialization and Hub fence | PASS on all reachable Saves | Rewrite has stronger authority fencing | Eight of eight current Saves emitted exactly one request, returned 200, and adopted the authoritative revisions. No `stale_fence` remained after Hub `ff4a460`. |
| Payload hygiene | PASS | Rewrite is stricter/current-page-only | Nine first-AI payloads and eight Save payloads contained zero extension artifacts and zero non-empty script/style/noscript bodies. All captured Save payloads used singular current-page shape. |
| Polling cadence | PASS automated; not remeasured in core live pass | Rewrite intentionally differs from legacy | P20's four integrated checks pass. The detached core harness deliberately skipped the idle 15-second window to avoid keeping a website debugger attached. |
| Render Inspection | PASS automated; PARTIAL current headed matrix | Similar user outcome, stronger rewrite proof | Frame/fallback/document-fence tests pass. Already-configured properties were not forced through both render choices in this final Save-bearing pass. |
| Send to Lynx fence | PASS by non-publication | Rewrite adds explicit checklist fence | No final publish request was sent. DPJ remained 1/7 and other incomplete properties remained fenced. |
| Console/message-port hygiene | PASS automated; PARTIAL headed | Rewrite wrapper improves expected no-receiver behavior | Full unit/integration gates report no unchecked expected no-receiver paths. Browser stderr only showed Chromium environment noise; the core harness did not retain a debugger for a complete console-idle window. |

## Save and payload proof

The following rewrite properties each emitted one and only one HTTP 200 Save:
DPJ, Aleris, Acne Specialisten, Acapedia, Assist24, Arno, ArkivIT, and Humanova.
Every request carried an editor session, lock token, expected property revision,
expected feed revision, one `page` object, selector set, and render mode. No
request contained a multi-page array or an extension-owned DOM artifact.

The original Save failure was backend-owned. Hub mutations previously loaded a
process-local cached fence before validation; another Hub process could therefore
reject a current client as stale. The Hub now refreshes persisted mutation
authority while holding the mutation gate. Its focused and full test suites pass,
and the Alpha workflow released `v2026.11-alpha.14` successfully.

## Performance interpretation

For fresh, comparable runs the rewrite activation/AI pair was faster than the
retained legacy production baseline on Acapedia, Aleris, DPJ, and Humanova. Acne
activation was 391 ms slower but its AI was substantially faster. First AI was
also faster on Assist24, Arno, and ArkivIT, while their activation timings are
invalid as comparative numbers because the measurement observer stayed attached
during extension-owned emulation.

Ledigajobb is the clear regression: the rewrite first AI took about twice the
retained legacy baseline, and the current exact legacy run eventually failed as
well. Teknikhallen is also a rewrite-only regression in the current evidence:
legacy completed, while rewrite emulation failed before marking.

## Final automated verification

- Focused P24 tests: 79 passed. The final C4 cleanup regression file passes
  21/21.
- `pnpm verify`: passed with 130 files / 1,181 tests, production build, and
  manifest verification. `pnpm build:debug` also passed.
- P14: 192/192 scenarios, with zero semantic, budget, activation, or
  mutation-pressure failures.
- P15: 36/36, P16: 13/13, P17: 19/19, P18: 14/14, P20: 4/4, and
  P23: 24/24, all on clean source sets where the gate requires one.

The first clean P15 run found a terminal lifecycle defect: unregister removed
the shield and silent rectangles but left one empty extension marking root.
Terminal teardown now sweeps every extension-owned marking renderer occurrence,
including an orphan from an overlapping silent/adoption transition. The focused
test and two subsequent P15 runs establish the failure and the 36/36 repair.

## P24 disposition

P24 remains the first unchecked execution phase. The exact-readiness and Hub
fence slices are complete, but acceptance still requires:

- an observer-free sequential emulation proof and a root fix if the delay
  reproduces;
- a Teknikhallen emulation diagnosis/fix;
- Humanova invisible-overlay cleanup;
- DPJ/Ledigajobb Content List and freshness fixes;
- Ledigajobb second-AI acknowledgement/latency remediation;
- final physical modifier coverage on sites where the evidence target became a
  no-op or disappeared;
- a clean headed rerun of the red cells, followed by final P24 completion.
