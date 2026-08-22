# P20 Integrated Release Evidence

**Recorded:** 2026-08-22 (Europe/Stockholm)

**Status:** automated release gates complete; witnessed live Alpha acceptance pending

**Extension production source:** `887c193515bf6b2111939dc21bceb17b4ac5b435`

**Evidence HEAD:** `eec38e1b` on `re-write`
**Manifest:** `2.0.0`

P20 remains the resume pointer because its live browser matrix must be witnessed
with the installed production extension against Alpha and `bonliva.se`. The
available browser-control connection reported no browser instances on
2026-08-22, so the live matrix was not replaced with a local fixture or inferred
from older evidence.

## Final release gates

| Command | Result |
|---|---|
| `pnpm verify` | Passed: lint, generated page-world parity, all TypeScript projects, 123 files / 1,097 tests, production build, and 7 generated-manifest assertions. |
| `pnpm build:debug` | Passed. Debug popup retained Activity, preview detail, lock-fence, publication-operation, and popup trace markers. |
| `pnpm performance:p14` | Passed 192/192 scenarios with 21 measured samples per operation/fixture/runtime and every absolute/relative budget green. |
| `pnpm performance:p15` | Passed 36/36 real-Chromium checks. |
| `pnpm performance:p16` | Passed 13/13 real-Chromium checks. |
| `pnpm performance:p17` | Passed 19/19 real-Chromium checks after the production preview-detail stripping correction. |
| `pnpm performance:p18` | Passed 14/14 real-Chromium checks after the production preview-detail stripping correction. |
| `pnpm performance:p20` | Passed 4/4 on clean commit `406632f8`: physical Space recovery, every production lock reason, debug-only fence/operation detail, and no browser errors. |

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
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-22T18-02-35-571Z.json` | `b111c76d02dd86c1687d7e311e0e7e600d6ac3229b6cbd887371126222ed30d6` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-22T18-09-20-617Z.json` | `aa3a42372b4a7f60f13551aaa188ff0b0af7a580828aca53df934f3cb0f7157f` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-22T18-09-51-464Z.json` | `b318820b268e389405cf28cb72f90ab27f84a895a80673ab51b3708d7c65dfdf` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-22T18-35-11-405Z.json` | `ca9406648af6ee7d22ea7e0e81739b84c533a10fbfc7aa04ff91bbc019108da8` |

## Production and debug artifact inspection

- Production extension tree: 39 files, 4,083,403 bytes, deterministic tree
  SHA-256 `0bd776c5a0bc9ae5fcd99200c60aaddd24f4b290a4cbba2c2a390f782af2a510`.
- Production zip: `.output/unfluffify-p20.zip`, 2,638,565 bytes, SHA-256
  `610dacd6507497a4e907fa0f12780affe28bdf1660ad76f30925a0092c67c807`.
- Debug extension tree: 39 files, 4,090,090 bytes, deterministic tree SHA-256
  `e3c55972f1cacab0259ced6c7e117edb28ebc89353b671e3826ff494fe2ed9e6`.
- Production popup contained none of `__UNFLUFFIFY_POPUP_DEBUG__`,
  `data-event-log`, `data-preview-row-debug-detail`, `data-lock-fence`,
  `data-publication-operation`, or the popup trace prefix. The debug popup
  contained every one plus Classification/XPath/Selector/Shadow detail.

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

## Pending witnessed live matrix

Once a browser connection with the production extension/profile is available,
resume P20 and witness the full matrix in
`.reimplementation/rewrite-legacy-execution-plan.md`: non-candidate and late
consent suppression, native-dialog closure, silent/post-AI shield and scrolling,
inspection across reload/panel closure, readable preview/debug classifications,
transient/Escape/toast behavior, shadow content, and interaction performance.
Record the live browser/profile version and final pass/fail here, then check P20.
