# P21 Humanova live sanity report — 2026-08-26

## Overall result

**PASS.** The ten reported Humanova marking, Content List, silent-preview,
and reveal/freeze failures are remediated in the rewrite and passed a clean
headed workflow through the repository `live-browser` launcher. Consent
suppression remains intentional extraction hygiene: suppressed UI is hidden
and absent from markings, preview rows, AI HTML, and payload artifacts.

No configuration Save or Send to Lynx publication was performed during this
acceptance run. Every temporary AI result and marking experiment was discarded.

## Contract matrix

| # | Reported contract | Result | Headed evidence |
| --- | --- | --- | --- |
| 1 | Invisible excluded elements do not draw overlays | PASS | Humanova's full-viewport `.newsletter-overlay` remained `visibility:hidden`, `opacity:0`, `z-index:-5000`; its extraction classification persisted without a visible rectangle. |
| 2 | Shift is required for widened exclusion | PASS | Plain interaction targeted the nearest boundary. Shift produced the containing-block overlay; no widened mark was created without Shift. |
| 3 | Alt explicit inclusion works on implicit/default content | PASS | Alt produced the amber include hover, Alt-click changed `pre_ai_clean` to `pre_ai_dirty`, and the context menu exposed both Include and Exclude for default-included content. |
| 4 | One widened exclusion can be unmarked | PASS | A plain click over the widened owner removed that exact parent and restored the previous row count without clearing unrelated marks. |
| 5 | Implicit/explicit marking matches latest legacy | PASS | The contract is now nearest ordinary exclusion, Shift-only widening, Alt explicit inclusion, exact-owner clear, and canonical implicit descendant evaluation. |
| 6 | Content List opens after Run AI | PASS | Final production run completed AI in 6.748 s and opened 132 semantic rows immediately; the broader production hygiene sample opened 217 rows. |
| 7 | Content List is two-way | PASS | Keyboard row activation scrolled the page from 0 to 6,618 px. A real page click landing on the interaction shield focused exact popup row 47. |
| 8 | Silent highlights stay responsive through scroll/resize | PASS | The retained overlay root survived scroll at 80 ms and real viewport resize at 120 ms; geometry was repositioned without layer retirement. |
| 9 | Silent Content List is fast and two-way | PASS | Sidebar became visible at 150 ms and completed 217 rows at 178 ms. Keyboard row-to-page and page-to-row focused exact row 46. |
| 10 | Reveal/freeze follows latest legacy | PASS | Smooth trace ran start 244 px -> top -> midpoint -> lazy suppression -> growth-aware bottom -> freeze -> restore 245 px in about 17.359 s; final document height was 10,693 px. |

## Additional workflow evidence

- Final production marking activation: **251 ms** at the required **412×960**
  mobile viewport.
- Device/session transition: desktop-silent **1920×1080** -> marking-mobile
  **412×960** -> desktop-silent **1920×1080**.
- Production Content List: every row was a native button, all rows had an
  accessible ordinal/label/status name, no selector/XPath diagnostic attributes
  were exposed, and no raw script/style/noscript source leaked. Technical nodes
  used labels such as “Script or embedded code”, “Style rules”, and “No-script
  fallback content”.
- Same-tab, same-URL hard reload: a new content-realm document nonce invalidated
  the silent-projection cache and the overlay returned on the next 15-second
  authority backstop. Repeated ticks in the same document did not reproject.
- Page-to-list clicking is handled before the full-viewport interaction shield
  consumes the input. The input remains blocked from the page itself.
- Scroll, resize, and viewport transitions did not remove silent highlights.
- No unchecked message-port failures or extension-origin console exceptions
  were observed. Chromium emitted unrelated environment diagnostics for GCM,
  MIME cache, GPU, and page metrics; none originated from extension code.

## Automated acceptance

- `pnpm verify`: **PASS** — 127 test files, 1,160 tests, production build, and
  7 manifest assertions.
- `pnpm build:debug`: **PASS**.
- `pnpm performance:p14`: **PASS** — 192 scenarios, zero semantic, budget,
  activation, or mutation failures.
- `pnpm performance:p15`: **PASS** — 36/36.
- `pnpm performance:p16`: **PASS** — 13/13.
- `pnpm performance:p17`: **PASS** — 19/19 on the final clean source set.
- `pnpm performance:p18`: **PASS** — 14/14.
- `pnpm performance:p20`: **PASS** — 4/4.
- The repository has no standalone P19 browser-gate script.

## Evidence artifacts

| Gate | Artifact | SHA-256 |
| --- | --- | --- |
| P14 | `output/playwright/p14-marking-performance/acceptance-2026-08-26T15-30-48-532Z.json` | `4c22636041408e55ed81473fe6f1236f5d331f20d58daff1ee34b753267434d0` |
| P15 | `output/playwright/p15-frozen-shield/acceptance-2026-08-26T15-38-35-503Z.json` | `fc2690aa19362a939dabfc15fef6f6bc478cab736b05ac0d289f63ab3e421bd4` |
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-26T15-39-18-239Z.json` | `33338f11e3522c2f8292811113c6a8fc19b8bb6ed2a026501772bf1f45268c0f` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-26T16-27-55-327Z.json` | `846f2ad94b7ffe2a919b0bb415800fd9d079a1f7d7642e65058f7b1bed16253b` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-26T15-40-18-905Z.json` | `ee22ee394eb38099a99967005ba93c876dea35e37d3b47cf75823818194fd5da` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-26T15-41-26-794Z.json` | `d711333131496e55176e5a599e1a4dd1b0f494aeea76812ea1ba2531ca86a98c` |

## Implementation lineage

- `954adf16` — restore Humanova marking and preview contracts.
- `714e2c4b` — fence silent projection to document identity and route
  page-to-list input through the shield boundary.
- `97ce108e`, `e2ef25c5`, `4a2ab66f`, `557b3e0b`, `8cb7b0d6`, and
  `f7793d32` — clean P14, P15, P16, P17, P18, and P20 evidence runs.
