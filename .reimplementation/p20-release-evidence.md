# P20 Integrated Release Evidence

**Recorded:** 2026-08-25 (Europe/Stockholm)

**Status:** accepted — automated gates, production/debug builds, and headed
Bonliva, DPJ, and Aleris acceptance pass.

**Branch:** `re-write`

**Implementation commits:**

- `55300452` — Repair P20 DPJ and Aleris workflows
- `7d466c36` — Harden P20 live preview and payload hygiene
- `15f1c186` — Align P17 preview acceptance semantics

**Manifest:** `2.0.0`; headed closure stamps reached `2.0.0.76`.

## Final release gates

| Command | Result |
|---|---|
| `pnpm verify` | Passed: lint, generated page-world parity, all TypeScript projects, 123 files / 1,116 tests, production build, and 7 manifest assertions. |
| `pnpm build:debug` | Passed with debug-only preview, lock, operation, trace, and Activity detail retained. |
| `pnpm performance:p14` | Passed 192 scenarios with zero semantic, budget, or activation failures. |
| `pnpm performance:p15` | Passed 36/36. |
| `pnpm performance:p16` | Passed 13/13. |
| `pnpm performance:p17` | Passed 19/19 after the oracle was aligned with the live-proven default-content Included semantics. |
| `pnpm performance:p18` | Passed 14/14. |
| `pnpm performance:p20` | Passed 4/4. |

P14–P16 were retained from clean implementation commit `7d466c36`; P17–P20
were retained from clean gate-alignment commit `15f1c186`. The P17-only follow-up
changed its acceptance oracle and documentation, not the production bundle.

## Retained clean-source artifacts

| Gate | Retained artifact | SHA-256 |
|---|---|---|
| P14 | `output/playwright/p14-marking-performance/acceptance-2026-08-24T22-35-33-637Z.json` | `5e6e4619ef3f06018868ff7f07a47a89f7f97ac8ba230a85bd0989928672bdc1` |
| P15 | `output/playwright/p15-frozen-shield/acceptance-2026-08-24T22-43-10-696Z.json` | `b7bd99eafe5c9e98516cf6f09ddf3bfad866ebf49818d13311133d3f09fc5904` |
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-24T22-43-42-507Z.json` | `35f2e0f9998aae749dd02839cd5c779b4a7845fee126da3f415ca9153956383e` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-24T22-45-26-785Z.json` | `6b32af065e5db7f3c56b10062d9cd2980ef3e1b880d9392ae6d32c3bccbc7bce` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-24T22-45-51-080Z.json` | `979cd4e4115937a849631db322c33afb6f95f075d06fc1d254a570248cc769d0` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-24T22-46-41-143Z.json` | `115cab504f3b7e10163f5bbce112423d643318493008e5220568636df623f319` |

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

## Consent and payload decision

Consent/modal suppression is a PASS, not a regression. DPJ cart, account,
contact, assembly, country, and similar blocking UI, plus Aleris Cookiebot
surfaces, stay hidden and excluded from extraction. The implementation does not
restore those nodes. Live payload inspection and automated sanitizer tests prove
suppressed subtrees and extension-owned artifacts are absent from saved HTML.

## Release conclusion

No P20 defect remains. DPJ and Aleris publication remains fenced solely because
their page-type onboarding is incomplete. The extension made no publication
request during acceptance.
