# P20 DPJ Live Full-Workflow Report

**Recorded:** 2026-08-24 (Europe/Stockholm)

**Verdict:** **PASSED — DPJ functional acceptance is complete**

The remediated production extension was exercised against the real DPJ
homepage in the repository-managed headed Chrome workflow. The complete v66
round passed Render Inspection, emulation, consent suppression, marking,
freshness, AI, Content List, Save, Todo adoption, and the Send-to-Lynx fence.
A focused v68 closure round then proved the final dirty-to-Discard transition
after correcting its canonical-property authority payload.

No Lynx publication was attempted. Saving the homepage advanced DPJ from 0/7
to 1/7; article, category, company, listing, product, and service-page coverage
remain missing, so the checklist correctly kept its Send action disabled.

## Environment and method

| Item | Witnessed value |
|---|---|
| Browser | Repository-managed headed Chromium `151.0.7922.10` |
| Extension | Production unpacked build; live registration stamps `2.0.0.66` and `2.0.0.68` |
| Extension ID | `mfdmappjajojdcmkkmfbgocbgmlbkgaj` |
| Backend environment | `a.lynxdev.se` |
| Site | ID `4`; canonical property `https://dpj.se` |
| Observed page | `https://www.dpj.se/` |
| Initial authoritative state | First configuration absent; Todo 0/7 |
| Final authoritative state | Homepage saved; Todo 1/7 |
| Side panel | Real production `popup.html`, never the `debugTabId` tab |

The run followed the repository's `live-browser`, `live-round`, and
`live-watch` skills. `pnpm dev:no-browser` remained resident; Chrome was
started only with `pnpm browser:live`; the canonical `state` command returned a
`[control:state]` record; and the launcher, observers, and dev server were
stopped in reverse order. External debugger observers were detached during
extension-owned Render Inspection and emulation. Short-lived same-browser CDP
clients were used only for trusted interaction and read-only evidence.

Network instrumentation retained endpoint, method, status, payload shape and
size, and hygiene flags. It did not retain credentials, tokens, or submitted
HTML.

## Acceptance matrix

| Area | Result | Live evidence |
|---|---|---|
| Property identity and lock | **PASS** | Alpha resolved site 4, kept canonical `dpj.se` distinct from observed `www.dpj.se`, identified `/` as the homepage candidate, and granted the editor lock. |
| Render Inspection: JavaScript on | **PASS** | The real side panel reached “Showing the page with JavaScript.” The inspection terminalized through paint acknowledgement while same-document DPJ history noise preserved the document and lock. |
| Render Inspection: JavaScript off | **PASS** | The real side panel reached “Showing the page with JavaScript disabled.” JavaScript was restored and the selected Rendered mode was retained afterward. |
| Inspection fallback and fences | **PASS** | Live acknowledgement used the normal paint path. Automated P16 and focused regressions cover the guarded one-second starvation fallback, hidden-document wait, identity mismatch fail-open, and path/query/document navigation fences. |
| Render-mode decision | **PASS** | Rendered (JavaScript on) remained the confirmed mode and governed AI and Save payloads. |
| Reveal, lazy loading, and freeze | **PASS** | Page-visit reveal/freeze completed; motion pause and lazy-loading suppression stayed active; scroll height, image completion, and capture stabilized. |
| Mobile and desktop posture | **PASS** | Marking was exactly 412×960 at scale 1. Silent Desktop preview was exactly 1920×1080; the root/visual width was 1912 only because of the scrollbar. No stale poll restored the wrong mode. |
| Silent shield | **PASS** | The full-viewport surface was connected, last in the document root, `pointer-events:none`, and at z-index `2147483647`; wheel scrolling remained available. |
| Consent lifecycle | **PASS** | 17 blocking nodes were suppressed in the final rounds. Cart, account, contact, assembly, country, modal, and similar blocking UI intentionally remain hidden and excluded from extraction. No suppression-selector change was made. |
| Consent/payload hygiene | **PASS** | Suppressed subtrees, suppression provenance, and extension artifacts were absent from marking rows, Content List, AI HTML, and Save artifacts. Unique hidden modal strings and `data-uf-consent-hidden` were absent from both request bodies. |
| Marking and highlights | **PASS** | Default exclude, Alt include, Shift widen, context-menu actions, Space passthrough/recovery, scrolling, and the visible highlight grammar remained correct. |
| Immediate freshness | **PASS** | A trusted post-AI edit disabled Save and Content List with `requires-ai-run` in 28 ms; a repeated edit projected in 2 ms, without waiting for an authority request. |
| AI request/result | **PASS** | `/get_selectors` received one current page, HTTP 202, with a 759,877-byte sanitized request. The completed selector result became the current post-AI state. |
| Content List semantics | **PASS** | The clean projection contained 1,434 list items and 1,434 direct semantic buttons. Accessible names included ordinal and included/excluded status. Production copy used human labels such as “Script or embedded code” and “Style rules,” with no raw script/style source. |
| Content List keyboard UX | **PASS** | Native Enter and Space generated trusted button clicks and scrolled to the target. Focus and pointer hover produced the same target emphasis; instructions named both pointer and keyboard operation. |
| First-configuration Save | **PASS** | One click emitted exactly one current-page-only `/save`; duplicate activation emitted no second request. The 760,167-byte request returned HTTP 200 in 1,780 ms and the complete authoritative response was adopted. |
| Save shape | **PASS** | `pageKey:"/"`, `pageType:"homepage"`, six rows, 700,177 rendered bytes, no raw HTML in Rendered mode, no extra page collection, no extension artifact, and no suppressed modal content. |
| Todo adoption | **PASS** | The authoritative Save advanced coverage from 0/7 to 1/7 and returned the panel to Ready/silent. A configuration load occurred once after authoritative Save, which is an allowed cache invalidation. |
| Polling/freshness | **PASS** | Authority traffic was single-flight and no more frequent than the 15-second per-client rule; with both production popup clients open, observed context requests were roughly 30 seconds apart per client. No overlapping load storm recurred. |
| Save abort cleanup | **PASS** | Regression coverage proves each pre-request refusal has reason-specific toast copy and that paused interactions and reconciliation state are restored in `finally`. |
| Discard | **PASS** | In v68, a trusted edit produced `requires-ai-run`; Discard then returned Save and Discard to `no-pending-changes` while marking stayed active. The reset carried the canonical locked `baseUrl`, so the `www`/apex alias fence accepted it. |
| Send-to-Lynx fence | **PASS** | The checklist showed homepage READY 1/1 and six missing types. Send remained disabled and no publish request was emitted. |
| Runtime hygiene | **PASS** | Final raw observation found no Unfluffify exception, unchecked `runtime.lastError`, missing-receiver/message-port error, or publication call. |

## Payload evidence

### AI

- `POST https://unfluffify.dnscdn.se:8443/get_selectors`
- one current page;
- `renderMode: "rendered"`;
- 759,877-byte sanitized request;
- no extension-owned marker or hidden-modal content;
- HTTP 202 followed by successful status/result completion.

Visible DPJ text such as footer “Kontakta oss,” product “Monteringsklar,” and
the ordinary country trigger remained ordinary candidate content and was
classified by marking. The unique text of the actually suppressed modal
subtrees was absent.

### Save

- exactly one `/save` request;
- 760,167-byte request;
- current page only: `/`, `homepage`;
- six rows;
- 700,177 rendered bytes and `rawHtml:null`;
- no extra page collection, extension artifact, or suppressed-modal content;
- HTTP 200 in 1,780 ms;
- complete response adoption and Todo 1/7.

### Corrected diagnosis of the original Save failure

The failed pre-remediation run proved only that Save performed `/load` → 404,
emitted no `/save`, and gave no visible explanation. Its original report
speculated that `not_found` itself was rejected as a writable baseline. Later
instrumentation established the actual live blocker: the popup pulled before
the asynchronously processed `save-reconciliation-started` fact had published
its signal. The implemented signal-availability acknowledgement fence fixed
that race. `not_found` is also now explicitly cached and accepted as the first-
configuration baseline, but it is not presented as the proven cause of the
observed no-save behavior.

## Final Discard defect and closure

v67 exposed a separate authority-contract failure. `resetContentMain` carried
the observed `pageUrl` but omitted the canonical locked `baseUrl`; DPJ's
`www`/apex identity split therefore produced `base-url-mismatch`. v68 passed
after Discard refreshed the editor directive, sent `lock.baseUrl`, waited for
the authoritative `session.discarded` projection, and showed a visible failure
if either acknowledgement is unavailable.

## Automated verification

Final `pnpm verify` passed lint, generated page-world parity, all TypeScript
projects, 123 test files / 1,111 tests, the production build, and seven
generated-manifest assertions.

The full browser matrices were also behaviorally green:

| Gate | Functional result |
|---|---|
| P14 | 192 scenarios; 0 semantic, budget, or activation failures |
| P15 | 36/36 |
| P16 | 13/13 |
| P17 | 19/19 |
| P18 | 14/14 |
| P19 | Covered by the architecture tests in `pnpm verify` |
| P20 | 4/4 |

The current acceptance artifacts intentionally report top-level `pass:false`
only because every full gate requires `cleanSourceSet:true` and this requested
implementation is still an uncommitted working tree. There was no controller,
browser, cleanup, semantic, budget, or functional failure. A clean-source
release stamp must be produced after the owner commits the accepted changes;
this is provenance, not an unresolved DPJ behavior defect.

## DPJ-owned console noise

DPJ still emits unrelated failures for missing mobile/desktop preview images,
a HelloRetail 400, and Freshmarketer CORS requests. Chromium also reports GCM
endpoint deprecation/quota messages. These are site/browser noise and were not
counted as extension defects.

## Release decision

P20 functional remediation is accepted. The DPJ homepage configuration is
saved at 1/7, consent suppression is a passing extraction-hygiene behavior,
and the remaining six page types correctly prevent publication. Send to Lynx
must remain unused until coverage reaches 7/7. The only outstanding release
administration is rerunning the same automated artifacts from the eventual
clean committed source so their provenance bit can become true.
