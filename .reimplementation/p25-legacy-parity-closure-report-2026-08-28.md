# P25 legacy parity closure report — 2026-08-28

## Overall result

**REWRITE SANITY PASS; STRICT LEGACY PARITY FAIL.** The P25 audit now records
174 distinct legacy/rewrite, architecture, lifecycle, UX, performance, and
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
- Rewrite product/evidence source: `01c2c091e11244d05c48836b87d1e9fdbad1f263`
- Exact resize-attribution checkpoint: `21d0e797`
- Exact Content List ownership checkpoint: `01c2c091`
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

The exact closeout repository gate contains 143 test files / 1,509 tests. It
includes the final projection-owned Content List hit-routing regression and the
exact page-clock resize-attribution boundary, as well as the earlier build and
paint-acknowledgement environment protections.

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| Generated page-world parity | PASS |
| WXT prepare + all TypeScript projects | PASS |
| Vitest | PASS — 143 files, 1,509 tests |
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
| P25 composite | PASS — all seven ordered child artifacts retained at `2026-08-30T09-41-21-699Z` |

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

| Property | Stage signature | Sources / rects | Invalid visible paint | Current-run AI | Worst Long Task |
| --- | --- | ---: | ---: | ---: | ---: |
| Ledigajobb | `PFFPFFFFFFFFF` | 36 / 34 | 3 | Not run — baseline lifecycle non-terminal | 456 ms |
| DPJ | `PFFPPFPFFFFFF` | 18 / 18 | 0 | Not run — baseline lifecycle non-terminal | 272 ms |
| Aleris | `PFFPPFPFFFFFF` | 9 / 9 | 0 | Not run — baseline lifecycle non-terminal | 69 ms |
| Acne Specialisten | `PFFPFFPFFFFFF` | 27 / 26 | 7 | Not run — baseline lifecycle non-terminal | 119 ms |
| Assist24 | `PFFPPFPFFFFFF` | 11 / 11 | 0 | Not run — baseline lifecycle non-terminal | 0 ms |
| Arno | `PFFPPFPFFFFFF` | 11 / 21 | 0 | Not run — baseline lifecycle non-terminal | 0 ms |
| ArkivIT | `PFFPPFPFFFFFF` | 12 / 12 | 0 | Not run — baseline lifecycle non-terminal | 70 ms |
| Teknikhallen | `PFFPFFPFFFFFF` | 30 / 30 | 5 | Not run — baseline lifecycle non-terminal | 386 ms |
| Humanova | `PFFPFFPFFFFFF` | 13 / 12 | 1 | Not run — baseline lifecycle non-terminal | 84 ms |

The fresh baseline deliberately records AI as non-comparable rather than
dispatching it after the confirmed non-terminal Render Inspection lifecycle.
Earlier measured legacy diagnostics showed executable source in the AI envelope
and no usable Content List; those historical payload findings remain in the
audit but are not relabeled as fresh-current-run AI. No fresh legacy candidate
proves bidirectional routing, current-page Save, Discard, or the rewrite's
silent-desktop posture. Publication guards remain healthy with zero attempts.

## Rewrite headed result

Every valid rewrite candidate passes all thirteen stages on clean pushed product
source `01c2c091`:

| Property | Stage signature | Sources / rects | Invalid visible paint | AI feedback / terminal | Worst Long Task |
| --- | --- | ---: | ---: | ---: | ---: |
| Ledigajobb | `PPPPPPPPPPPPP` | 13 / 13 | 0 | 29 ms / 123,640 ms | 0 ms |
| DPJ | `PPPPPPPPPPPPP` | 19 / 19 | 0 | 28 ms / 12,460 ms | 0 ms |
| Aleris | `PPPPPPPPPPPPP` | 9 / 9 | 0 | 21 ms / 1,268 ms | 0 ms |
| Acne Specialisten | `PPPPPPPPPPPPP` | 17 / 17 | 0 | 29 ms / 6,913 ms | 0 ms |
| Assist24 | `PPPPPPPPPPPPP` | 12 / 12 | 0 | 26 ms / 1,144 ms | 0 ms |
| Arno | `PPPPPPPPPPPPP` | 9 / 22 | 0 | 17 ms / 1,236 ms | 0 ms |
| ArkivIT | `PPPPPPPPPPPPP` | 13 / 13 | 0 | 16 ms / 1,350 ms | 0 ms |
| Teknikhallen | `PPPPPPPPPPPPP` | 27 / 27 | 0 | 27 ms / 8,817 ms | 0 ms |
| Humanova | `PPPPPPPPPPPPP` | 14 / 14 | 0 | 16 ms / 6,900 ms | 0 ms |

Ledigajobb's long AI terminal is an authority/backend wait with immediate 29 ms
feedback, not a frozen popup. Every exact-head rewrite frame stage records zero
JavaScript Long Tasks; the post-action collector-tail attribution fixed by
finding 173 is not counted as input work. Because every pair's
dynamic document fingerprint differs, source/rect counts and terminal latency
are descriptive only and are not promoted to strict parity claims.

## Performance, accuracy, and similarity disposition

- **Performance:** all nine exact-head rewrite runs have zero JavaScript Long
  Tasks in every retained activation, marking, scroll, resize, and silent frame
  stage. Trusted Run AI feedback paints in 16–29 ms. The fresh legacy runs range
  from 0 to 456 ms worst Long Task and do not establish the required silent
  posture. Strict `p95 <= 1.05x` pair claims remain N/A because every dynamic
  document fingerprint is non-equivalent; the matrix correctly fails rather
  than comparing unrelated frames.
- **Accuracy:** rewrite marking visual evidence has zero invisible, covered, or
  unresolved painted sources on all nine pages. Plain unmark, Shift expansion,
  Alt inclusion, context actions, Content List auto-open and both routes, fresh
  AI, one current-page Save, authoritative adoption, Discard, and payload
  hygiene pass on every candidate. The fresh legacy baseline paints invalid
  sources on Ledigajobb, Acne Specialisten, Teknikhallen, and Humanova and never
  completes the shared workflow.
- **Similarity:** the shared 1/2/3 px border catalog, 4 px radius, overlay layer
  semantics, hover/focus behavior, reveal order, lazy suppression, and scroll
  fade/restore intent are retained. Exact count, border, and layer parity are
  not asserted across different document generations. Intentional rewrite
  improvements remain: Shift-only exclusion creation, Alt inclusion, semantic
  keyboard rows, 412x960 marking, 1920x1080 silent shield, hidden-decision/no-
  invisible-paint separation, clean payloads, one-page Save, and atomic
  publication fencing.

## Contract matrix

| Contract | Implementation | Automated authority | Headed authority |
| --- | --- | --- | --- |
| Render type | Rewrite PASS / legacy FAIL | Exact document/generation, two-frame/fallback lifecycle | Rewrite 18/18 cells; legacy inspection non-terminal |
| Reveal/freeze | Rewrite PASS | Transaction, owner, bottom/restore, quiet-proof gates | All rewrite activations terminal; legacy does not prove true bottom |
| Lazy loading | Rewrite PASS | Suppression/ledger/no-scroll/open-shadow regressions | Clean rewrite capture and payload on all nine |
| Highlight visibility | Rewrite PASS / legacy FAIL | Composed visibility and reachability regressions | Rewrite zero invalid paint; fresh legacy invalid paint on four pages |
| Layers/borders/cardinality | Rewrite PASS | Exact catalogs and geometry tests | All rewrite visual cells pass; strict count parity N/A on document drift |
| Latency/performance | Rewrite PASS / strict parity N/A | Real Long Tasks and physical-input budgets | Rewrite faster in most comparable slices; no exact document pair |
| Scroll fade/restore | Rewrite PASS / legacy mixed | Marking and silent interim/final frame gates | Rewrite marking and silent stages pass all nine; legacy marking scroll passes 8/9 but silent restoration passes 0/9 |
| Marking targets | Rewrite PASS / legacy FAIL | Shared corpus and O(hit) scaling | Rewrite plain/Shift/Alt/context on all nine; legacy completes none |
| Content List | Rewrite PASS / legacy FAIL | Virtualization, accessibility, two-way routing | Rewrite auto-open and both routes on all nine |
| AI/spinners | Rewrite PASS / legacy non-comparable | Exact ACK, phase, feedback, cleanup tests | Rewrite 16–29 ms feedback; fresh legacy AI is explicitly not run after its non-terminal baseline lifecycle |
| Freshness | Rewrite PASS | Brain signal generation and no remote wait | Physical post-edit projection below one second on all nine |
| Save/Discard | Rewrite PASS | One mutation, no retry, posture recovery | One current-page Save, adoption, and Discard on all nine |
| Consent/capture/payload | PASS | Recursive sanitation and clone restoration | Intentional suppression retained; rewrite payloads clean; historical legacy source-bearing, fresh legacy AI N/A |
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

- Rewrite: `2026-08-30T08-47-19-943Z-a119b9cb-rewrite-ledigajobb`
- Rewrite: `2026-08-30T08-52-56-638Z-c014883e-rewrite-dpj`
- Rewrite: `2026-08-30T08-55-01-431Z-68b69a2e-rewrite-aleris`
- Rewrite: `2026-08-30T08-56-22-812Z-c8e59352-rewrite-acne-specialisten`
- Rewrite: `2026-08-30T08-58-04-291Z-7d5964e4-rewrite-assist24`
- Rewrite: `2026-08-30T08-59-28-742Z-93ab739a-rewrite-arno`
- Rewrite: `2026-08-30T09-00-51-570Z-27bcb1f9-rewrite-arkivit`
- Rewrite: `2026-08-30T09-02-16-740Z-a8107a2a-rewrite-teknikhallen`
- Rewrite: `2026-08-30T09-05-05-674Z-ca674688-rewrite-humanova`
- Focused Acne proof: `2026-08-30T08-45-08-049Z-90b4ef41-rewrite-acne-specialisten`
- Legacy: `2026-08-30T09-14-49-403Z-048af3cd-legacy-ledigajobb`
- Legacy: `2026-08-30T09-17-00-931Z-7a18cb29-legacy-dpj`
- Legacy: `2026-08-30T09-18-34-742Z-9978d99d-legacy-aleris`
- Legacy: `2026-08-30T09-19-40-422Z-47a37c1f-legacy-acne-specialisten`
- Legacy: `2026-08-30T09-20-51-498Z-931c9c59-legacy-assist24`
- Legacy: `2026-08-30T09-22-00-744Z-c19adc89-legacy-arno`
- Legacy: `2026-08-30T09-23-02-054Z-f9a83a2d-legacy-arkivit`
- Legacy: `2026-08-30T09-24-10-439Z-d1b5b080-legacy-teknikhallen`
- Legacy: `2026-08-30T09-25-48-988Z-423d356d-legacy-humanova`
- Strict matrix:
  `output/playwright/p25-live-comparison/comparisons/2026-08-30T09-28-27-284Z-matrix.json`
- Final automated composite:
  `.temp/p25-final-evidence-01c2c091/p25-parity/acceptance-2026-08-30T09-41-21-699Z.json`
- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-activation.json`
- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-reveal-observe.json`
- `.temp/p25-side-by-side/results/stages/rewrite-ledigajobb-p25-unbiased2-core.json`
- `.temp/p25-side-by-side/results/rewrite-dpj-p25-core-test.json`
- `.temp/p25-side-by-side/results/legacy-*-p25-final-rerun3.json`
- `output/playwright/p15-frozen-shield/smoke-*.json`

Every generated aggregate carries exact SHA-256 identities for retained frame,
network, screenshot, source, bundle, browser, profile, and publication-guard
evidence. Generated runs remain immutable and intentionally uncommitted.
