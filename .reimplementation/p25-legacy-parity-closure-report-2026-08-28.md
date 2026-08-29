# P25 legacy parity closure report — 2026-08-28

## Overall result

**OPEN — remediation and clean-source headed acceptance are still in
progress.** The P25 audit records 113 distinct legacy/rewrite, architecture,
lifecycle, UX, performance, and evidence-authority findings. All confirmed
findings have an implemented resolution or an intentional binding decision, but this
report will not call that a parity PASS until the exact committed source passes
the clean P25 composite and the same-profile observer-free candidate matrix.

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
- Rewrite release commit: pending the clean-source acceptance boundary
- Browser: repository-managed Chromium started only through `pnpm browser:live`
- Profile: the same `.wxt/browser-profile`, one implementation and browser
  process at a time
- Extension path: canonical `.output/chrome-mv3`; pinned bundles are staged and
  restored transactionally by the repository launcher
- Publication: the final Lynx `/publish` action is forbidden; the live harness
  must fence it before transmission for the complete run lifetime and fail on
  any attempt

Historical `.temp` evidence is diagnostic/reference material. It cannot certify
the current source and cannot be imported into the checked-in P25 aggregate.

## Implementation result

The rewrite now includes the following closure slices:

- generation-fenced O(visible-hit) marking with painted-fragment owner identity,
  exact plain unmark, Shift-only widened exclusion, eligible Alt inclusion, and
  one cached target for the four context actions;
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

The final dirty-tree verification before the clean acceptance commit passed:

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| Generated page-world parity | PASS |
| WXT prepare + all TypeScript projects | PASS |
| Vitest | PASS — current complete gate: 140 files, 1,418 tests; focused remediation: 4 files, 154 tests |
| Production WXT build | PASS |
| Generated manifest permissions | PASS — 7 checks |
| Debug WXT build | PASS |

The authoritative clean P14–P25 result and retained artifact paths will be added
after the implementation commit.

The first clean aggregate exposed five real acceptance-boundary defects rather
than being waived: marking structural stabilization missed the strict parity
budget, the P17 gate inspected the marking-only hover layer instead of the shared
Content List focus layer, P18/P20 fixtures did not implement the stateful page-
world command contract, P23 let silent geometry move during its opacity
transition, and native smooth scrolling could remain queued indefinitely during
reveal/restore. The repaired dirty-tree browser smokes now pass:

| Browser gate | Current repaired result |
| --- | --- |
| P14 marking/performance | PASS — 48/48 scenarios; zero semantic, budget, activation, mutation-pressure, or input-long-task failures |
| P17 Content List/preview | PASS — 19/19 checks |
| P18 transient/toast/physical marking | PASS — 14/14 checks |
| P20 integrated recovery/copy | PASS — 4/4 checks |
| P23 frozen presentation | PASS — 25/25 checks |

Reveal now uses bounded extension-owned animation frames rather than relying on
Chromium's native smooth-scroll queue. The P18 browser trace proves the ordered
top, midpoint, two true-bottom passes, freeze acknowledgement, and smooth return
to the original position before marking interaction is released. Extension-only
surface mutations no longer reset the capture quiet proof, while adjacent page
content still does.

## Candidate disposition

| Property | Candidate URL | Disposition before final matrix |
| --- | --- | --- |
| Ledigajobb | `https://ledigajobb.se/` | Eligible |
| DPJ | `https://www.dpj.se/` | Eligible |
| Aleris | `https://www.aleris.se/kirurgi/brack/aderbrack/` | Runtime validation required; retained body was not-found |
| Acne Specialisten | `https://www.acnespecialisten.se/` | Eligible |
| Acapedia | `https://acapedia.no/` | Eligible |
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

The latest ten-property pinned-legacy batch did not reach an interactive
marking flow. Every page adopted the 412x960 posture, then timed out with a
configuration/content authority error and painted zero useful marking overlays.
These are external legacy-reference failures, not valid rewrite latency or
behavior samples.

| Property | Last lifecycle sample | Retained result |
| --- | ---: | --- |
| Acapedia | 46,202 ms | `Content message timed out`; configuration retry |
| Acne Specialisten | 46,616 ms | `Content message timed out`; configuration retry |
| Aleris | 112,236 ms | inspection/configuration timeout; runtime candidate invalid |
| ArkivIT | 47,479 ms | `Content message timed out`; configuration retry |
| Arno | 57,942 ms | `Content message timed out`; configuration retry |
| Assist24 | 45,984 ms | `Content message timed out`; configuration retry |
| DPJ | 112,865 ms | inspection/configuration timeout |
| Humanova | 45,869 ms | `Content message timed out`; configuration retry |
| Ledigajobb | 117,051 ms | inspection/configuration timeout |
| Teknikhallen | 46,794 ms | `Content message timed out`; configuration retry |

A separate shim-assisted Ledigajobb reference reached terminal marking in 4,675
ms (toggle observed enabled at 3,384 ms) at 412x960. Its 99-sample observation
spanned about 38.1 seconds, but `scrollY` remained zero on a 6,986 px document,
so it did not prove the intended true-bottom ritual. The common visual count was
48 visible legacy extension nodes: 22 hard exclusions, seven explicit
exclusions, six AI-content rectangles, one explicit inclusion, ten ordered
layers, and the motion indicator. This is bounded reference evidence, not a
current matrix PASS.

## Contract matrix

| Contract | Implementation | Automated authority | Headed authority |
| --- | --- | --- | --- |
| Render type | Closed | Exact document/generation, two-frame/fallback lifecycle | Pending both real controls and wrong-mode rejection |
| Reveal/freeze | Closed | Transaction, owner, bottom/restore, quiet-proof gates | Pending frame sequence and true-bottom proof per candidate |
| Lazy loading | Closed | Suppression/ledger/no-scroll/open-shadow regressions | Pending stable height/resources and clean capture |
| Highlight visibility | Closed | Composed visibility and reachability regressions | Pending zero hidden/suppressed painted fragments |
| Layers/borders/cardinality | Closed | Exact catalogs and geometry tests | Pending implementation-neutral counts/tolerances |
| Latency/performance | Closed | Real Long Tasks; p95 `<= 1.05x` legacy | Pending equivalent-document live samples |
| Scroll fade/restore | Closed | Marking and silent interim/final frame gates | Pending physical wheel and exact restore |
| Marking targets | Closed | Shared corpus and O(hit) scaling | Pending target-keyed plain/Shift/Alt/context proof |
| Content List | Closed | Virtualization, accessibility, two-way routing | Pending real first paint and both routes |
| AI/spinners | Closed | Exact ACK, phase, feedback, cleanup tests | Pending current AI, second run, and terminal UI |
| Freshness | Closed | Brain signal generation and no remote wait | Pending physical post-edit projection below one second |
| Save/Discard | Closed | One mutation, no retry, posture recovery | Pending real confirmation, one Save, adoption, Discard |
| Consent/capture/payload | Closed | Recursive sanitation and clone restoration | Pending live zero-artifact payload proof |
| Silent shield/posture | Closed | 1920x1080, nested wheel/touch, top-layer tests | Pending real desktop transition and retained scrolling |
| Publication | Closed | Atomic idempotency and coverage fence | Pending checklist-only proof with zero `/publish` attempts |

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

- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-activation.json`
- `.temp/p25-side-by-side/results/stages/legacy-ledigajobb-clean-reveal-observe.json`
- `.temp/p25-side-by-side/results/stages/rewrite-ledigajobb-p25-unbiased2-core.json`
- `.temp/p25-side-by-side/results/rewrite-dpj-p25-core-test.json`
- `.temp/p25-side-by-side/results/legacy-*-p25-final-rerun3.json`
- `output/playwright/p15-frozen-shield/smoke-*.json`

Generated evidence receives exact SHA-256 values in the final appendix after the
clean gates and current-source headed matrix finish.
