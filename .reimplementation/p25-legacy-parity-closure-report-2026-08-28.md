# P25 legacy parity closure report — 2026-08-28

## Overall result

**REWRITE SANITY PASS; STRICT LEGACY PARITY FAIL.** The P25 audit now records
166 distinct legacy/rewrite, architecture, lifecycle, UX, performance, and
evidence-authority findings. The clean rewrite product source passes every
headed stage on every valid candidate: 9 properties × 13 stages = 117/117. The
strict pair matrix remains red because pinned legacy cannot terminalize Render
Inspection, does not complete the shared downstream workflow, and none of the
dynamic page generations has an exact comparable fingerprint. Those baseline
failures are retained rather than converted into a synthetic parity pass.

Consent suppression remains a PASS by contract. Cart, account, contact,
assembly, country, cookie, modal, and similar blocking UI stays hidden and must
not appear as a visible marking or in captured HTML, Content List rows, AI/Save
payloads, or publication artifacts.

The complete issue register, including the original findings and every later
adversarial launcher/live-evidence finding, is
`p25-legacy-rewrite-frame-parity-audit-2026-08-28.md`.

## Source and acceptance authority

- Pinned legacy: `28974c2a0c859c91a7167f4757cf84a47ea31e28`
- Plan publication commit: `6db3433a4eaf5a424a389c42a4abdb91603beb05`
- Rewrite product acceptance commit: `af59ce9d0dee8bfcb85d83fb312b86da8b887d76`
- Latest evidence/harness checkpoint before this report: `b32b96e6`
- Browser: repository-managed Chromium started only through `pnpm browser:live`
- Profile: the same `.wxt/browser-profile`, one implementation and browser
  process at a time
- Extension path: canonical `.output/chrome-mv3`; pinned bundles are staged and
  restored transactionally by the repository launcher
- Publication: the final Lynx `/publish` action is forbidden; the live harness
  must fence it before transmission for the complete run lifetime and fail on
  any attempt

Historical `.temp` evidence remains diagnostic/reference material. The durable
generated aggregates under `output/playwright/p25-live-comparison/` retain the
current run identities, screenshots, frames, network hashes, and zero-attempt
publication guard.

## Implementation result

The rewrite now includes the following closure slices:

- generation-fenced O(visible-hit) marking with painted-fragment owner identity,
  exact plain unmark, Shift-only widened exclusion, eligible Alt inclusion, and
  one cached target for the four context actions; current paint-reachable hits
  override stale transform-only visibility without a document rebuild, and
  unbound Shift owners reject rather than degrading to exact; in-flight
  decisions rebind only to the same physical Element across bridge generations,
  and headed target preparation proves canonical cleanliness through the real
  context capability resolver instead of trusting painted rows alone; shared
  legacy/rewrite gesture timing excludes the rewrite-only action menu, whose
  capability and latency remain independently gated;
- independent paint reachability, hidden/suppressed overlay pruning, distinct
  hard/default/explicit/hover/context/focus/silent layers, identity-stable
  scroll fade, one idle redraw, resize restoration, and silent deduplication;
- transactional ARM/lazy/freeze/destroy commands, lossless capture projection,
  open-shadow and late-owner discovery, dominant nested scroll-owner proof,
  smooth growth-aware true-bottom continuation, two bottom confirmations,
  quiet proof, and exact restore;
- inspection input leasing, top-layer/backdrop neutralization, normalized
  origin/path/query/document identity, two-frame curtain acknowledgement, and a
  guarded starvation fallback owned by the exact content generation;
- event-driven dirty projection, single-flight authority polling, one `/load`
  per property binding, cached definitive `not_found`, serialized Save, exact
  post-commit recovery, truthful Discard/emulation transitions, and trusted-only
  operator event boundaries;
- virtualized semantic Content List buttons, target-indexed two-way routing,
  typed occurrence availability, reason-specific disabled technical rows,
  keyboard focus/activation, accessible ordinal/state labels, linear label
  projection, production/debug text separation, and prompt auto-open;
- recursive consent sanitation across ordinary and declarative-shadow templates,
  extension/freeze artifact stripping, current-page-only Save, and atomic
  publication fencing;
- exact P14–P25 artifact catalogs, real input Long Task capture, strict rewrite
  p95 `<= 1.05x` legacy, clean-source identity, and a checked-in live evidence
  harness with source/bundle/browser/profile/document identities.

## Automated status

The complete repository gate contains 142 test files / 1,504 tests. The final
closeout rerun additionally protects two evidence-environment boundaries found
after the live matrix: test build output is rejected when a legacy launcher left
a non-package manifest version behind, and the marking entrypoint test waits for
the real paint-acknowledged async toggle instead of sleeping for 25 ms.

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| Generated page-world parity | PASS |
| WXT prepare + all TypeScript projects | PASS |
| Vitest | PASS — 142 files, 1,504 tests after acceptance hardening |
| Production WXT build | PASS |
| Generated manifest permissions | PASS — 7 checks |
| Debug WXT build | PASS |

The current automated browser gates exercise the production path, including the
true-bottom reveal/freeze ritual, lazy suppression, frame-fenced paint, both
marking modifiers, Content List routing, silent retained-node geometry, and
integrated cleanup:

| Browser gate | Current repaired result |
| --- | --- |
| P14 marking/performance | PASS — clean 192-scenario authority retained |
| P15 frozen shield | PASS — 36/36 retained authority |
| P16 Render Inspection | PASS — 13/13 retained authority |
| P17 Content List/preview | PASS — 19/19 checks |
| P18 transient/toast/physical marking | PASS — 14/14 checks |
| P20 integrated recovery/copy | PASS — 4/4 checks |
| P23 frozen presentation | PASS — 25/25 checks |
| P25 composite | PASS — all seven ordered child artifacts retained |

Reveal uses bounded extension-owned animation frames rather than Chromium's
native smooth-scroll queue. The browser trace proves top, midpoint, lazy lock,
two growth-aware true-bottom confirmations, freeze acknowledgement, and smooth
return to the origin before marking interaction is released. Hot pre-freeze
page motion is advisory; post-freeze quiet, identity, and restoration remain
mandatory.

## Candidate disposition

| Property | Candidate URL | Final live disposition |
| --- | --- | --- |
| Ledigajobb | `https://ledigajobb.se/` | Eligible |
| DPJ | `https://www.dpj.se/` | Eligible |
| Aleris | `https://www.aleris.se/kirurgi/brack/aderbrack/` | Eligible — live preflight proved substantive content |
| Acne Specialisten | `https://www.acnespecialisten.se/` | Eligible |
| Acapedia | `https://acapedia.no/` | External/N/A — required inspection reload is replaced by a site-owned 403 |
| Assist24 | `https://www.assist24.dk/` | Eligible |
| Arno | `https://arno.eu/collections/katting` | Eligible |
| ArkivIT | `https://arkivit.se/tjanster/arkivering-registratur/` | Eligible |
| Teknikhallen | `https://teknikhallen.se/surfplattor-tillbehor/samsung-surfplattor/galaxy-tab-s8` | Eligible |
| Humanova | `https://www.humanova.com/` | Eligible; replaced JC Flytt at the user's direction |
| 3D Prima SE | supplied candidate | External/N/A — site-owned 404 |
| Bigbag | none | N/A — Hub supplies no authoritative candidate |

Bonliva was ambient browser state rather than a user-supplied P25 property and
is not added to the denominator.

## Retained legacy reference result

The fresh pinned build reaches preflight and real marking activation on all nine
valid candidates. Its legacy `/load` request is patched before activation with
the configured environment key; the guard records one sanitized patch per run.
The independently proven non-terminal JavaScript-disabled inspection is kept as
two explicit observe-only failures so downstream evidence comes from a fresh,
unpoisoned browser session.

No legacy candidate completes the full shared flow. `P/F` below follows the
ordered thirteen-stage contract: preflight, two render modes, activation,
marking visual, gestures, marking scroll, marking resize, workflow, silent
visual, silent scroll, silent resize, and publication checklist.

| Property | Stage signature | Sources / rects | Invalid visible paint | AI feedback / terminal | Worst Long Task |
| --- | --- | ---: | ---: | ---: | ---: |
| Ledigajobb | `PFFPFFFFFFFFF` | 36 / 34 | 3 | 462 ms / failed at 18,052 ms | 551 ms |
| DPJ | `PFFPPFFFFFFFF` | 18 / 18 | 0 | 202 ms / failed at 12,688 ms | 294 ms |
| Aleris | `PFFPPFPFFFFFF` | 11 / 13 | 0 | 210 ms / failed at 1,867 ms | 69 ms |
| Acne Specialisten | `PFFPFFFFFFFFF` | 27 / 26 | 7 | 240 ms / failed at 2,285 ms | 123 ms |
| Assist24 | `PFFPPFPFFFFFF` | 6 / 6 | 0 | 177 ms / failed at 1,817 ms | 0 ms |
| Arno | `PFFPPFFFFFFFF` | 7 / 17 | 0 | 181 ms / failed at 2,330 ms | 77 ms |
| ArkivIT | `PFFPFFFFFFFFF` | 12 / 12 | 2 | 184 ms / failed at 1,901 ms | 64 ms |
| Teknikhallen | `PFFPFFFFFFFFF` | 29 / 29 | 5 | 250 ms / failed at 16,713 ms | 570 ms |
| Humanova | `PFFPFFFFFFFFF` | 14 / 13 | 1 | 194 ms / failed at 2,003 ms | 115 ms |

Every legacy AI envelope captured executable source and failed payload hygiene.
The request can return successfully while the popup remains in or falls out of
its working posture without a usable Content List; none proves fresh AI,
bidirectional routing, current-page Save, Discard, or the rewrite silent-desktop
posture. Publication guards remain healthy with zero attempts.

## Rewrite headed result

Every valid rewrite candidate passes all thirteen stages on clean pushed product
source `af59ce9d`:

| Property | Stage signature | Sources / rects | Invalid visible paint | AI feedback / terminal | Worst Long Task |
| --- | --- | ---: | ---: | ---: | ---: |
| Ledigajobb | `PPPPPPPPPPPPP` | 25 / 25 | 0 | 25 ms / 181,859 ms | 50 ms |
| DPJ | `PPPPPPPPPPPPP` | 33 / 34 | 0 | 27 ms / 12,470 ms | 63 ms |
| Aleris | `PPPPPPPPPPPPP` | 15 / 15 | 0 | 15 ms / 1,227 ms | 0 ms |
| Acne Specialisten | `PPPPPPPPPPPPP` | 15 / 15 | 0 | 16 ms / 6,583 ms | 0 ms |
| Assist24 | `PPPPPPPPPPPPP` | 12 / 12 | 0 | 20 ms / 1,070 ms | 0 ms |
| Arno | `PPPPPPPPPPPPP` | 12 / 25 | 0 | 20 ms / 1,161 ms | 0 ms |
| ArkivIT | `PPPPPPPPPPPPP` | 6 / 6 | 0 | 20 ms / 1,051 ms | 0 ms |
| Teknikhallen | `PPPPPPPPPPPPP` | 20 / 20 | 0 | 25 ms / 8,638 ms | 0 ms |
| Humanova | `PPPPPPPPPPPPP` | 19 / 19 | 0 | 19 ms / 6,455 ms | 0 ms |

Ledigajobb's long AI terminal is an authority/backend wait with immediate 25 ms
feedback, not a frozen popup. DPJ's isolated 63 ms sample is retained in the
artifact; the stage passes the source-attribution contract. Because every pair's
dynamic document fingerprint differs, source/rect counts and terminal latency
are descriptive only and are not promoted to strict parity claims.

## Contract matrix

| Contract | Implementation | Automated authority | Headed authority |
| --- | --- | --- | --- |
| Render type | Rewrite PASS / legacy FAIL | Exact document/generation, two-frame/fallback lifecycle | Rewrite 18/18 cells; legacy inspection non-terminal |
| Reveal/freeze | Rewrite PASS | Transaction, owner, bottom/restore, quiet-proof gates | All rewrite activations terminal; legacy does not prove true bottom |
| Lazy loading | Rewrite PASS | Suppression/ledger/no-scroll/open-shadow regressions | Clean rewrite capture and payload on all nine |
| Highlight visibility | Rewrite PASS / legacy FAIL | Composed visibility and reachability regressions | Rewrite zero invalid paint; legacy invalid paint on five pages |
| Layers/borders/cardinality | Rewrite PASS | Exact catalogs and geometry tests | All rewrite visual cells pass; strict count parity N/A on document drift |
| Latency/performance | Rewrite PASS / strict parity N/A | Real Long Tasks and physical-input budgets | Rewrite faster in most comparable slices; no exact document pair |
| Scroll fade/restore | Rewrite PASS / legacy mixed | Marking and silent interim/final frame gates | Rewrite 36/36 viewport cells; legacy marking scroll passes only Aleris/Assist24 |
| Marking targets | Rewrite PASS / legacy FAIL | Shared corpus and O(hit) scaling | Rewrite plain/Shift/Alt/context on all nine; legacy completes none |
| Content List | Rewrite PASS / legacy FAIL | Virtualization, accessibility, two-way routing | Rewrite auto-open and both routes on all nine |
| AI/spinners | Rewrite PASS / legacy FAIL | Exact ACK, phase, feedback, cleanup tests | Rewrite 15–27 ms feedback; legacy 177–462 ms and no usable list |
| Freshness | Rewrite PASS | Brain signal generation and no remote wait | Physical post-edit projection below one second on all nine |
| Save/Discard | Rewrite PASS | One mutation, no retry, posture recovery | One current-page Save, adoption, and Discard on all nine |
| Consent/capture/payload | PASS | Recursive sanitation and clone restoration | Intentional suppression retained; rewrite payloads clean, legacy source-bearing |
| Silent shield/posture | Rewrite PASS / legacy FAIL | 1920x1080, nested wheel/touch, top-layer tests | Rewrite visual/scroll/resize on all nine; legacy establishes none |
| Publication | PASS | Atomic idempotency and coverage fence | Complete matrix records zero `/publish` attempts |

## Evidence integrity blockers closed during final review

The first draft of the checked-in live harness was not accepted. Final review
closed false-pass paths involving a stage-local publication fence, dynamic
extension targets, the legacy GraphQL publication mutation, pair/matrix label
tampering, absent actual parity budgets, shallow hidden-element proof,
non-targeted gesture evidence, incomplete resize posture restoration,
stale/out-of-root automated artifacts, unverifiable bundle/profile ownership,
and missing real silent/Content List/freshness/Save/Discard/checklist stages. The
final live matrix uses only the hardened harness; no earlier scratch aggregate
is promoted.

## Retained evidence anchors

- `output/playwright/p25-live-comparison/runs/2026-08-30T03-13-23-075Z-be2911a9-rewrite-ledigajobb/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-19-31-164Z-085206ee-rewrite-dpj/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-21-09-596Z-e50e858a-rewrite-aleris/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-22-06-257Z-beafbbb7-rewrite-acne-specialisten/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-23-17-905Z-cab44b10-rewrite-assist24/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-24-19-570Z-49da06ae-rewrite-arno/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-25-16-355Z-29745fec-rewrite-arkivit/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-26-15-598Z-b7d47cc1-rewrite-teknikhallen/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T03-28-41-077Z-528566a1-rewrite-humanova/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-00-11-121Z-783fccb3-legacy-ledigajobb/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-02-36-602Z-df3a3f0c-legacy-dpj/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-04-14-888Z-f07758f7-legacy-aleris/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-05-25-686Z-b29a827e-legacy-acne-specialisten/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-06-24-175Z-8f41c3d8-legacy-assist24/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-07-45-351Z-de29be90-legacy-arno/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-08-37-578Z-446f54fd-legacy-arkivit/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-09-32-856Z-e31b9ebc-legacy-teknikhallen/aggregate.json`
- `output/playwright/p25-live-comparison/runs/2026-08-30T04-11-18-785Z-13fd40e2-legacy-humanova/aggregate.json`
- `output/playwright/p25-live-comparison/comparisons/2026-08-30T04-15-26-672Z-matrix.json`
- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-activation.json`
- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-reveal-observe.json`
- `.temp/p25-side-by-side/results/stages/rewrite-ledigajobb-p25-unbiased2-core.json`
- `.temp/p25-side-by-side/results/rewrite-dpj-p25-core-test.json`
- `.temp/p25-side-by-side/results/legacy-*-p25-final-rerun3.json`
- `output/playwright/p15-frozen-shield/smoke-*.json`

Every generated aggregate carries exact SHA-256 identities for retained frame,
network, screenshot, source, bundle, browser, profile, and publication-guard
evidence. Generated runs remain immutable and intentionally uncommitted.
