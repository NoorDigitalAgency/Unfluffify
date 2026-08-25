# P20 Integrated Release Evidence

**Recorded:** 2026-08-25 (Europe/Stockholm)

**Status:** accepted — automated gates, production/debug builds, and headed
Bonliva, DPJ, Aleris, Assist24, Arno, Bigbag, and ArkivIT acceptance pass for
all authoritative/applicable workflows.

**Branch:** `re-write`

**Implementation commits:**

- `55300452` — Repair P20 DPJ and Aleris workflows
- `7d466c36` — Harden P20 live preview and payload hygiene
- `15f1c186` — Align P17 preview acceptance semantics
- `ca332c03` — Repair P20 four-site sanity defects
- `8646216f` — Fix emulated viewport inspection acknowledgement
- `bcf4d2cb` — Align background curtain viewport proof
- `737346c8` — Hydrate deferred media before page freeze

**Manifest:** `2.0.0`; headed closure stamps reached `2.0.0.114`.

## Final release gates

| Command | Result |
|---|---|
| `pnpm verify` | Passed: lint, generated page-world parity, all TypeScript projects, 125 files / 1,135 tests, production build, and 7 manifest assertions. |
| `pnpm build:debug` | Passed with debug-only preview, lock, operation, trace, and Activity detail retained. |
| `pnpm performance:p14` | Passed 192 scenarios with zero semantic, budget, or activation failures. |
| `pnpm performance:p15` | Passed 36/36. |
| `pnpm performance:p16` | Passed 13/13. |
| `pnpm performance:p17` | Passed 19/19 after the oracle was aligned with the live-proven default-content Included semantics. |
| `pnpm performance:p18` | Passed 14/14. |
| `pnpm performance:p20` | Passed 4/4. |

All final artifacts below were regenerated after production source commit
`737346c8`. Each gate reported a clean source set; artifact-only evidence commits
were made between runs so the next gate also began clean.

## Retained clean-source artifacts

| Gate | Retained artifact | SHA-256 |
|---|---|---|
| P14 | `output/playwright/p14-marking-performance/acceptance-2026-08-25T14-58-13-360Z.json` | `d53f4a2936a69e28bfd653fcfb8c6d27e52f4f9f174637132fa185e04db579bc` |
| P15 | `output/playwright/p15-frozen-shield/acceptance-2026-08-25T15-06-17-340Z.json` | `04478f93b2dcba624308708ef2ceffd7caa3e626403c6e7da51a96bbcfce1c13` |
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-25T15-07-03-724Z.json` | `e5a535e0a939efdd78ce9c93dcfb320876b755978922726c312d8409cd7a4014` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-25T15-07-30-380Z.json` | `8585249113edf042a66d50470dcab62e2a9a139d8a976a02c2300dff1a8f2243` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-25T15-08-06-449Z.json` | `3b11ad9470c16e2fa41585f60e53a2b160f578757fecca2059a03d1aae18c185` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-25T15-09-10-311Z.json` | `8711f775242898dead91d6730ee035af68474aaaddeb10f042f7de448877636a` |

## Headed live acceptance

The repository's `live-browser`, `live-round`, and `live-watch` skills operated
only the launcher-owned managed Chromium and its same-session CDP endpoint.
The bound helper closed after the real side panel opened, production state
worked without `window.__UNFLUFFIFY_POPUP_DEBUG__`, and external debugger
observers were detached for extension-owned Render Inspection.

### Bonliva baseline

The prior Alpha baseline remains accepted: managed context/lock, non-candidate
posture, native/late consent suppression, silent shield with native scrolling,
both render modes, production/debug separation, transients, toasts, and
interaction gates passed. No Hub bytes changed during this remediation.

### DPJ closure

DPJ passed both `paint-acknowledged` inspection modes, 412×960 marking,
1920×1080 silent Desktop preview, exact shield refresh, intentional suppression
of 17 blocking nodes, immediate dirty projection, AI, semantic Content List,
off-screen activation, current-page Save adoption, Discard, and console hygiene.
Homepage coverage is 1/7; six page types remain missing, so Send to Lynx is
correctly disabled and no publication request was emitted.

### Aleris closure

Aleris `/` remained managed non-candidate while both read-only inspection modes
worked under the banner. The candidate page passed 412×960 marking, 1920×1080
silent Desktop preview, five-node Cookiebot suppression, 113 ms post-AI
invalidation, a 164-row semantic preview (64 Included / 100 Excluded), focus and
off-screen activation, and single-request Save serialization.

A browser restart intentionally exercised a stale editor lease: Save returned
HTTP 409 and displayed `Save failed: stale_fence`; explicit Refresh restored
authority and the next single `/save` returned HTTP 200. The final 124,929-byte
`renderedHtml` contained zero `data-uf-*`, `uf-cursor-*`, `unfluffify`, or
`chrome-extension:` artifacts. Coverage is 1/2; the missing article type kept
Send disabled, with no publish request.

The full measurement and workflow matrix is in
[`p20-dpj-aleris-live-sanity-report-2026-08-25.md`](./p20-dpj-aleris-live-sanity-report-2026-08-25.md).
The earlier detailed DPJ discovery round remains in
[`p20-dpj-live-workflow-report-2026-08-24.md`](./p20-dpj-live-workflow-report-2026-08-24.md).

### Assist24, Arno, Bigbag, and ArkivIT closure

Assist24 passed both `paint-acknowledged` inspection modes, 412×960 marking,
1920×1080 silent preview, 28 ms dirty projection, semantic keyboard/pointer
preview, clean production AI/Save HTML, one successful Save request, and one
post-Save context/load adoption. A stale-lock 409 was visibly reported and
interaction recovered before Refresh and the successful retry.

Arno, Bigbag, and ArkivIT roots now retain managed property identity and present
managed non-candidate guidance. Arno and ArkivIT candidate pages retained mobile
marking, consent exclusion, persistent freeze, and fenced coverage. Corrected
real-resource checks loaded Arno's 3/3 native-lazy footer images and ArkivIT's
5/5 deferred Bricks resources before freeze. Bigbag still has no authoritative
candidate; candidate-only contracts are N/A and no URL was fabricated.

The detailed finding and closure matrix is in
[`p20-assist24-arno-bigbag-arkivit-live-sanity-report-2026-08-25.md`](./p20-assist24-arno-bigbag-arkivit-live-sanity-report-2026-08-25.md).

## Consent and payload decision

Consent/modal suppression is a PASS, not a regression. DPJ cart, account,
contact, assembly, country, and similar blocking UI, plus Aleris Cookiebot
surfaces, stay hidden and excluded from extraction. The implementation does not
restore those nodes. Live payload inspection and automated sanitizer tests prove
suppressed subtrees and extension-owned artifacts are absent from saved HTML.

## Release conclusion

No observed P20 product defect remains in the authoritative/applicable workflow.
Publication remains fenced where page-type onboarding is incomplete, and Bigbag
remains candidate-workflow N/A because Hub supplies no candidates. The extension
made no publication request during acceptance.
