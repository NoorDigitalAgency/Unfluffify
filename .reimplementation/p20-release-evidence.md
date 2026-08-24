# P20 Integrated Release Evidence

**Recorded:** 2026-08-22; live closure 2026-08-24 (Europe/Stockholm)

**Status:** accepted — Bonliva and DPJ functional acceptance pass; clean-source provenance rerun remains after commit

**Extension implementation base:** current working tree on `64bb6b80`; final
DPJ remediation is intentionally uncommitted

**Clean acceptance HEAD:** `900f8e62` on `re-write`
**Manifest:** `2.0.0`; witnessed DPJ closure registration stamp `2.0.0.68`

The production extension was witnessed against Alpha and `bonliva.se` in the
repository's managed headed browser. The round found and repaired both a harness
debugger conflict and a real canonical/`www` render-inspection defect, then
repeated the release and live gates on the repaired production build.

## DPJ live acceptance supplement

The 2026-08-24 remediation was repeated against Alpha site 4 (`dpj.se`) with
the repository's `live-browser`, `live-round`, and `live-watch` skills. The
complete v66 production round passed both Render Inspection modes, exact
412×960 marking and 1920×1080 silent Desktop preview, consent/payload hygiene,
immediate dirty projection, AI, semantic keyboard-operable Content List, one
current-page-only Save, authoritative adoption, and Todo 0/7 → 1/7. The v68
closure round passed the final canonical-authority Discard case and console
hygiene.

DPJ's blocking cart/account/contact/assembly/country/modal suppression remains
intentional extraction hygiene and is a passing consent result. Homepage is
saved, but six required page types remain missing; the Lynx checklist therefore
kept Send disabled and no publication request was emitted. See
[`p20-dpj-live-workflow-report-2026-08-24.md`](p20-dpj-live-workflow-report-2026-08-24.md)
for the complete matrix and payload evidence.

Final `pnpm verify` passes 123 files / 1,111 tests, production build, and all
seven manifest assertions. The latest full P14–P20 matrices pass every
functional check: P14 has 192 scenarios and zero semantic/budget/activation
failures; P15 36/36; P16 13/13; P17 19/19; P18 14/14; and P20 4/4. Their current
top-level bits are false solely because the requested implementation is still
an uncommitted working tree and those harnesses require `cleanSourceSet:true`.
That provenance rerun belongs after the accepted changes are committed.

## Final release gates

| Command | Result |
|---|---|
| `pnpm verify` | Passed on the final repaired source: lint, generated page-world parity, all TypeScript projects, 123 files / 1,111 tests, production build, and 7 generated-manifest assertions. |
| `pnpm build:debug` | Passed. Debug popup retained Activity, preview detail, lock-fence, publication-operation, and popup trace markers. |
| `pnpm performance:p14` | Passed 192/192 scenarios with 21 measured samples per operation/fixture/runtime and every absolute/relative budget green. |
| `pnpm performance:p15` | Passed 36/36 real-Chromium checks. |
| `pnpm performance:p16` | Passed 13/13 real-Chromium checks on clean source `1c0ed3d7`; retained artifact SHA-256 `9b27e5ef9088b25a6b961d937c49415da9caa9ca750277ea0f56557b566d53fe`. |
| `pnpm performance:p17` | Passed 19/19 real-Chromium checks after the production preview-detail stripping correction. |
| `pnpm performance:p18` | Passed 14/14 real-Chromium checks after the production preview-detail stripping correction. |
| `pnpm performance:p20` | Passed 4/4 on clean source `900f8e62`: physical Space recovery, every production lock reason, debug-only fence/operation detail, and no browser errors. |

The final uncommitted remediation was also run through every matrix. Current
behavioral artifacts are: P14
`acceptance-2026-08-24T17-42-53-965Z.json` (`fc22832e…`, 192 scenarios), P15
`0533e52d…` (36/36), P16 `77efd8c7…` (13/13), P17 `f0fe602b…` (19/19), P18
`32648eb1…` (14/14), and P20 `1e4bf15d…` (4/4). Each reports
`cleanSourceSet:false` as its only failed aggregate condition; controller,
browser, cleanup, and functional checks pass.

The P14 large-fixture rewrite p95 measurements were 240.9 ms silent
activation, 282.7 ms silent scroll reposition, 611.0 ms silent mutation
stabilization, 255.6 ms marking activation, 33.4 ms hover, 79.3 ms physical
click/commit/paint, 449.7 ms marking scroll reposition, and 590.9 ms marking
mutation stabilization.

## Retained browser artifacts

All artifacts are clean-source acceptances on Chromium `151.0.7922.108`,
1280×900, DPR 1.

| Gate | Retained artifact | SHA-256 |
|---|---|---|
| P14 | `output/playwright/p14-marking-performance/acceptance-2026-08-22T17-53-06-736Z.json` | `85deadaf78bb05262acabe5e3661f14386291b3327c84b036a303eec552a8b04` |
| P15 | `output/playwright/p15-frozen-shield/acceptance-2026-08-22T18-01-51-551Z.json` | `dc630dbb6c92b58122f36200bd9bbdfbb317eb8aaed4754965f8e557930f99a5` |
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-24T09-31-44-145Z.json` | `9b27e5ef9088b25a6b961d937c49415da9caa9ca750277ea0f56557b566d53fe` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-22T18-09-20-617Z.json` | `aa3a42372b4a7f60f13551aaa188ff0b0af7a580828aca53df934f3cb0f7157f` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-22T18-09-51-464Z.json` | `b318820b268e389405cf28cb72f90ab27f84a895a80673ab51b3708d7c65dfdf` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-24T09-32-46-990Z.json` | `3703c3f004fe96aaba8d5016c1c18c45dc91c6669bf33163f94855aa763f678f` |

## Production and debug artifact inspection

- Production extension tree: 39 files, 4,083,485 bytes, sorted path/content
  SHA-256 `49f55e5153aafcce0253d119ff90d8a8001beaaf6a57f09a232b504e45f91039`.
- Production zip: `.output/unfluffify-p20.zip`, 2,638,587 bytes, SHA-256
  `2e1881a4cd7dce9e9219ef39c9ac0e80f7a710e6f14e591ebf1d21cec341c4c2`.
- Debug extension tree: 39 files, 4,090,172 bytes, sorted path/content SHA-256
  `11309b42ff3b6a57a15548d873c29d872989ed21cfec6d9e367d88c872bc1a34`.
- Production popup contained none of `__UNFLUFFIFY_POPUP_DEBUG__`,
  `data-event-log`, `data-preview-row-debug-detail`, `data-lock-fence`,
  `data-publication-operation`, or the popup trace prefix. The debug popup
  contained those debug hooks plus Classification/XPath/Selector/Shadow detail;
  the generated-artifact parity assertions passed in `pnpm verify`.

## Hub and Alpha identity

- Hub remained clean and unchanged at
  `9bdce9f99f16f3f7dc86996c5521730af8d41438` on `develop`; local and
  `origin/develop` were 0/0 ahead/behind.
- The existing `Alpha Release` run
  [32230797511](https://github.com/NoorDigitalAgency/unfluffify-hub/actions/runs/32230797511)
  remains successful for that exact commit and built/deployed
  `v2026.11-alpha.13`.
- Target live identity remains environment `a.lynxdev.se`, site `60`, base URL
  `https://bonliva.se`.
- No Hub bytes changed during P12–P20, so the conditional Alpha deployment was
  not rerun.

## Witnessed live Alpha matrix

**Browser:** managed Chrome `151.0.7922.10`, 1280×900, headed Linux session

**Extension:** production unpacked id `mfdmappjajojdcmkkmfbgocbgmlbkgaj`,
registration stamp `2.0.0.53`, deterministic id/path match

**Backend:** `v2026.11-alpha.13+9bdce9f99f16f3f7dc86996c5521730af8d41438`

**Property:** `a.lynxdev.se`, site `60`, `https://bonliva.se`, observed page
`https://www.bonliva.se/`

| Requirement | Result | Witnessed evidence |
|---|---|---|
| Managed context and lock | Passed | The production side panel resolved `managed_candidate`, site 60, loaded the 5/5 Todo, and held the editor lock. A same-account browser restart exercised Continue here and returned to Ready. |
| Non-candidate consent posture | Passed | Same-tab navigation to `/fragor-och-svar` disabled Run AI/Save/Discard/Content List, kept all 35 consent nodes hidden, and removed the interaction shield. Returning to `/` reacquired the candidate lock. |
| Late/native consent UI | Passed | Bonliva's own `.cky-banner-element` click created `#ckyPreferenceCenter`; the extension immediately retained `data-uf-consent-hidden=true` with hidden visibility, zero opacity, and no pointer events. No native consent dialog escaped suppression. |
| Silent shield and scrolling | Passed | A trusted page click was intercepted by `[data-uf-interaction-shield]`; a trusted wheel remained available and moved `scrollY` from 14,405 to 13,705. |
| Render inspection through reload | Passed | The real Chrome side panel, with launcher and raw observer detached from the website, completed generation 1 JavaScript-on and generation 2 JavaScript-off. Both terminalized as `paint-acknowledged`; Cancel returned to Ready and preserved the stored Static mode. |
| Production/debug presentation | Passed | The live production panel used curated copy and exposed no raw lock fence or internal classifications. Retained P17/P20 production/debug artifacts prove human-readable production rows and debug-only Classification/XPath/Selector/Shadow, lock-fence, and operation detail. |
| Transients, Escape, toasts, shadow content, and interaction budgets | Passed | Retained clean-source P14, P17, P18, and P20 artifacts cover the full transient/Escape/tone-aware-toast, composed-shadow, physical interaction, and recovery matrices. Bonliva did not expose a safe open-shadow fixture to mutate live, matching the P11 constraint. |

Shared Alpha Save/Publish mutations and a fresh AI run were not issued merely to
manufacture evidence against the live property. Their state-bearing behavior is
covered by the retained automated browser and integration artifacts.

## Live failures found and repaired

1. The canonical launcher kept a persistent Playwright page debugger attached,
   so production Render Inspection could not acquire Chrome's debugger slot.
   `1c0ed3d7` now resolves the browser installed by the exactly-pinned
   `@playwright/mcp@0.0.78` package, launches that managed Chromium directly,
   opens the real side panel, and uses only short-lived CDP control sockets.
2. The Hub correctly authorized observed `www.bonliva.se` for canonical base
   `bonliva.se`, but the render runtime repeated identity using exact origins and
   rejected the pair as `inspection-page-outside-property`. `1c0ed3d7` retains
   the unrelated-host fence while treating canonical/`www` (and scheme/port) as
   one already-authorized property identity. Focused regression tests and the
   final live two-mode inspection both pass.
3. DPJ exposed no-op History API events and a JavaScript-off paint starvation
   path. Document/normalized-URL fences, two-frame acknowledgement, and the
   guarded current-generation fallback now pass live and automated inspection.
4. Save initially raced the asynchronous reconciliation signal. Typed
   signal-availability acknowledgement, split fast/authority polling, cached
   `not_found`, single-flight Save, authoritative adoption, and `finally`
   cleanup now pass one-request first-configuration Save on DPJ.
5. Suppressed DPJ modal subtrees were still present in sanitized raw/rendered
   captures. The live DOM bridge and raw sanitizer now omit the entire hidden
   subtree without restoring or leaking suppression provenance.
6. Discard used the observed origin for a data-affecting content command. The
   final v68 run passes after sending the refreshed directive's canonical
   `baseUrl` and waiting for `session.discarded`.

The prior Bonliva acceptance remains valid, DPJ functional acceptance is now
complete, and no Hub bytes changed. P20 is accepted. The only remaining release
administration is regenerating top-level clean-source artifacts after the owner
commits this working tree.
