# P22 cross-property workflow remediation report — 2026-08-27

## Overall result

The repository-owned P22 regressions are remediated and the controlled browser
suite is green. The supplied-property round is **not yet a fully green release
acceptance**, because four otherwise valid workflows still receive an
authoritative Hub `stale_fence` response and 3D Prima still has no live candidate
page supplied by Hub.

- Clean source passed `pnpm verify` with 127 files / 1,167 tests, production and
  debug builds, P14 192 scenarios, P15 36/36, P16 13/13, P17 19/19, P18 14/14,
  the P19 manifest contract 7/7, and P20 4/4.
- The headed rerun used the repository `live-browser` / `live-round` managed
  Chromium and the extension's real side panel. It did not touch personal Chrome.
- DPJ, Aleris, Assist24, Arno, and Teknikhallen completed one authoritative HTTP
  200 Save. Teknikhallen advanced homepage coverage to 1/4 and entered silent mode.
- Acne Specialisten, Acapedia, ArkivIT, and Humanova each emitted exactly one
  current-page-only Save and received HTTP 409 `stale_fence`. Their expected
  property/feed revisions matched Hub's response revisions; the refreshed lock
  token/editor session was rejected by Hub. The extension showed the specific
  failure and restored interactions without retrying.
- Acapedia is currently HTTP 200, superseding the earlier transient 403 result.
  Its newly exposed opacity-zero immutable-image case was fixed and re-proved
  with zero invisible marking or silent exclusion rectangles.
- 3D Prima's offered Anycubic and Sinterit candidates still render site-owned 404
  pages. Bigbag still has no authoritative candidate. Neither result was bypassed.
- Consent and blocking-surface suppression remains intentional and correct.
  Suppressed commerce, account, contact, country, assembly, menu, modal, and
  consent nodes stayed invisible and absent from rows, AI HTML, Save HTML, and
  payload artifacts.
- No publication request was issued. Incomplete Lynx checklists remained fenced.

## Candidate result matrix

Legend: **PASS** = full extension contract passed, **HUB BLOCK** = extension
contract passed through one safe request but Hub rejected its current lock fence,
**EXTERNAL BLOCK** = supplied candidate is not a live content page, and **N/A** =
Hub supplied no candidate.

| Property | Candidate | Result | AI / Content List | Save outcome |
| --- | --- | --- | --- | --- |
| DPJ | `https://www.dpj.se/` | **PASS** | AI current; 405 semantic two-way rows in the full proof | One HTTP 200; current page only |
| Aleris | `/kirurgi/brack/aderbrack/` | **PASS** | 1.233 s; 163 semantic two-way rows | One HTTP 200 |
| Acne Specialisten | `/` | **HUB BLOCK** | 8.057 s; two-way marking/silent list proof; dirty in 263 ms | One HTTP 409 `stale_fence`, revisions 1/1 |
| Acapedia | `/` | **HUB BLOCK** | 1.227 s; 84 semantic two-way rows | One HTTP 409 `stale_fence`, revisions 1/1 |
| Assist24 | `/` | **PASS** | 1.009 s; 44 semantic two-way rows; dirty in 236 ms | One HTTP 200 |
| Arno | `/collections/katting` | **PASS** | 1.272 s; 73 semantic two-way rows; dirty in 253 ms | One HTTP 200 |
| ArkivIT | `/tjanster/arkivering-registratur/` | **HUB BLOCK** | 1.369 s; 98 semantic two-way rows | One HTTP 409 `stale_fence`, revisions 1/1 |
| Teknikhallen | `/` | **PASS** | 7.193 s; 1,018 semantic accessible rows in the focused proof | One HTTP 200; coverage advanced to 1/4 |
| Humanova | `/` | **HUB BLOCK** | 6.891 s; 217 semantic two-way rows; dirty in 243 ms | One HTTP 409 `stale_fence`, revisions 1/1 |
| 3D Prima `/se` | Offered Anycubic/Sinterit pages | **EXTERNAL BLOCK** | Site-owned 404, so no valid candidate workflow | Not attempted |
| Bigbag | None | **N/A** | Popup correctly reports non-candidate | Not attempted |

JC Flytt was replaced by Humanova at the user's request. Bonliva appeared only
as ambient browser state and was not part of the supplied-property acceptance set.

## Contract matrix

| Candidate | Render / emulation | Consent / visible overlays | Marking modifiers and clear | AI freshness | Content List / two-way | Payload hygiene | Shield / reveal / lazy | Save authority | Publish fence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DPJ | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Aleris | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Acne | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **HUB BLOCK** | PASS |
| Acapedia | PASS | PASS | PASS | PASS by typed event contract; sampled edit was a no-op | PASS | PASS | PASS | **HUB BLOCK** | PASS |
| Assist24 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Arno | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| ArkivIT | PASS | PASS | PASS | PASS by typed event contract; sampled edit was a no-op | PASS | PASS | PASS | **HUB BLOCK** | PASS |
| Teknikhallen | PASS | PASS | PASS | PASS by typed event contract; sampled edit was a no-op | PASS | PASS | PASS | PASS | PASS |
| Humanova | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **HUB BLOCK** | PASS |
| 3D Prima `/se` | EXTERNAL BLOCK | N/A | N/A | N/A | N/A | N/A | N/A | N/A | PASS/no request |
| Bigbag | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | PASS/no request |

## Remediation evidence

### Marking and visual exclusion paint

- A plain click now resolves an exact visible expanded exclusion owner before a
  new leaf candidate. Shift remains the only path that widens an exclusion.
- Alt explicit inclusion, ordinary exclusion, exact-owner unmark, context Clear,
  and implicit/explicit state remain distinct.
- Widening may replace several child marks with one ancestor, so mark count is
  not required to increase. Focused DPJ and Acne proofs confirmed the ancestor
  owner appears and a following plain click removes it.
- Live composed visibility now gates explicit exceptions, immutable exclusions,
  closed-shadow exclusions, and saved silent exclusion borders. Extraction rows
  are unchanged. The final Acapedia proof rendered 17 marking overlays and 22
  silent highlights with zero invisible targets in either mode.

### AI lifecycle and local freshness

- A current-tab `signals.available` event drains the exact bound brain signal
  directly instead of waiting behind tab resolution, emulation, context, Todo,
  or configuration work.
- AI start now has a bounded exact-generation handshake with typed unreachable,
  unsupported, timeout, and mismatch outcomes. Teknikhallen moved from a
  90-second no-request timeout to one 7.193-second AI result and a responsive
  post-AI panel.
- Meaningful post-AI edits projected `requires-ai-run` in 236–263 ms on the
  sampled current sites. Three automated sampling points were already implicit
  exclusions and therefore made no change; the typed event regression and the
  clean integrated gates prove the changed-event path without misclassifying a
  no-op click as delayed freshness.

### Content List and silent highlighting

- Current fresh brain selectors own marking/post-AI projection; the authoritative
  saved configuration is the silent fallback. DPJ no longer shows borders while
  claiming that no saved selectors exist.
- Rows are semantic buttons with ordinal, readable label, and Included/Excluded
  state in their accessible names. Pointer/keyboard row-to-page and physical
  page-to-row focus passed. Production rows contain human labels rather than raw
  script/style/noscript source.
- Silent highlight geometry survives scroll and resize. The shield keeps native
  scrolling primary and applies one task-based root fallback only if the native
  wheel produces no movement while the page animation clock is frozen.

### Save, payload, and authority

- Save pauses interactions, freezes the binding/generation/selectors/snapshot,
  reconciles once, refreshes the websocket authority at the last safe point,
  and emits zero or one `config.save`. It never retries behind the operator.
- Every observed request was singular and current-page-only. AI and Save bodies
  contained zero extension artifacts, zero suppressed subtrees, and empty
  production `script`, `style`, and `noscript` bodies.
- The four remaining 409 responses are not stale-revision cases: request and
  response both carried property/feed revisions 1/1. The mutation fence came
  from the post-reconciliation websocket grant, but Hub rejected its token/editor
  session. Resolving that distributed authority inconsistency requires Hub-side
  ownership; adding a hidden extension retry would violate the one-click contract.
- The initial Teknikhallen focused observer reported no request because it
  observed popup traffic rather than the service worker and sampled after the
  1.8-second success toast expired. A direct real-side-panel replay showed
  `Session saved`, silent mode, stored 22 selectors, and Todo coverage 1/4.

## Automated evidence

| Gate | Result | Artifact |
| --- | --- | --- |
| `pnpm verify` | PASS — 127 files / 1,167 tests; manifest 7/7 | command output |
| `pnpm build:debug` | PASS | command output |
| P14 | PASS — 192 scenarios, zero semantic/budget/activation/mutation failures | `output/playwright/p14-marking-performance/acceptance-2026-08-27T00-19-57-010Z.json` |
| P15 | PASS — 36/36 | `output/playwright/p15-frozen-shield/acceptance-2026-08-27T00-28-01-255Z.json` |
| P16 | PASS — 13/13 | `output/playwright/p16-render-inspection/acceptance-2026-08-27T00-29-00-098Z.json` |
| P17 | PASS — 19/19 | `output/playwright/p17-preview/acceptance-2026-08-27T00-29-20-510Z.json` |
| P18 | PASS — 14/14 | `output/playwright/p18-transient-toast/acceptance-2026-08-27T00-29-50-123Z.json` |
| P20 | PASS — 4/4 | `output/playwright/p20-integrated/acceptance-2026-08-27T00-30-43-997Z.json` |

## Release blockers

1. Hub must accept or explain the current websocket mutation fence for Acne
   Specialisten, Acapedia, ArkivIT, and Humanova. The client-side safe behavior
   already passes: one request, visible reason, no retry, and complete cleanup.
2. Hub/site ownership must replace 3D Prima's stale 404 candidates before a
   candidate workflow can be accepted.
3. Bigbag requires an authoritative candidate before candidate-only controls can
   legitimately run.

P22 therefore remains open as a release checklist item even though the
repository-owned remediation and automated acceptance are complete.
