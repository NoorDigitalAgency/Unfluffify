# P20 Assist24/Arno/Bigbag/ArkivIT headed-browser sanity report — 2026-08-25

## Verdict

The available production workflows were exercised in repository-managed headed
Chromium on extension build `2.0.0.100` from source commit `f192db66534d`.
Assist24, an authoritative Arno candidate, and an authoritative ArkivIT
candidate completed Render Inspection, marking, AI, Content List, Save, silent
preview, Discard, and Send-to-Lynx fencing. Bigbag supplied no authoritative
candidate or page type, so candidate-only controls were correctly unavailable
and that part of its workflow is blocked by Hub data.

The round is **not a clean P20 pass**. Three cross-site defects remain:

1. AI and Save `renderedHtml` still contain production `<script>`, `<style>`,
   and, on Arno/ArkivIT, `<noscript>` source.
2. Every successful Save was followed by two immediate `/context` plus two
   immediate `/load` reconciliation cycles for the same property binding.
3. The Arno, Bigbag, and ArkivIT roots are authoritative
   `managed_non_candidate`, but the popup says **Not a managed property** rather
   than presenting the managed non-candidate/candidate-selection state.

Consent suppression itself passed and remains intentional. Suppressed provider
DOM stayed hidden and was omitted from marking/AI/Save artifacts. No Lynx
publication request was made.

## Scope and method

- Requested roots: `https://assist24.dk`, `https://arno.eu`,
  `https://bigbag.se`, and `https://arkivit.se`.
- Assist24 normalized to `https://www.assist24.dk/` and was already a homepage
  candidate.
- Arno root authority offered `/collections/katting` (`category`) and a product
  candidate; `/collections/katting` was used for the full candidate workflow.
- ArkivIT root authority offered article and service candidates;
  `/tjanster/arkivering-registratur/` (`service_page`) was used for the full
  candidate workflow.
- Bigbag root returned `managed_non_candidate`, site `5571`, with zero page
  types and zero candidates. No candidate URL was invented.
- Only the repository `live-browser`, `live-round`, and `live-watch` procedures
  and launcher-owned Chromium were used. No OS Chrome/profile was touched.
- Network/exception evidence came from an extension-service-worker observer.
  No observer was attached to a website target during extension-owned Render
  Inspection or emulation.
- A physical browser input path was used for include, exclude, context-menu,
  focus/activation, shield, and scrolling checks. No source files were changed
  during the observation round.

## Site outcomes

| Site | Outcome | Authority and coverage |
| --- | --- | --- |
| Assist24 | Functional workflow passed; payload and polling contracts failed | Candidate homepage, site `5427`; Save advanced/retained coverage at 1/4. |
| Arno | Functional workflow passed; root UI, payload, and polling contracts failed | Root `managed_non_candidate`, site `5333`; category candidate saved; coverage 1/2. |
| Bigbag | Candidate workflow blocked; root UI contract failed | Root `managed_non_candidate`, site `5571`; no page types/candidates; no Save or publication. |
| ArkivIT | Functional workflow passed; root UI, payload, and polling contracts failed | Root `managed_non_candidate`, site `5500`; service candidate saved; coverage 1/2. |

## Assist24 evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| Render Inspection | Pass | With JavaScript and Without JavaScript both completed; With JavaScript was restored and `rendered` selected. |
| Consent/blocking UI | Pass | 5 suppression roots, zero visible. Cookiebot/dialog/extension-suppression artifacts were absent from the captured HTML. |
| Marking/highlighting | Pass | Plain exclude, Alt include, Shift widen, and the Include/Exclude/Widen/Clear context menu worked. Marking used 412×960 visual/screen metrics; the site's meta-viewport produced a 424×988 `innerWidth/innerHeight` quirk. |
| Lazy/reveal/freeze | Pass | The page had no native lazy images. A full 8,689 px document walk reached `scrollY=7,701`, returned to the top, and page motion remained paused. |
| AI/freshness | Pass | AI completed twice. A post-AI physical marking change disabled Save and Content List with `requires-ai-run` in 36.9 ms. |
| Content List | Pass | 58 semantic row buttons: 13 Included and 45 Excluded. Every row had ordinal, readable label, and state in its accessible name; focus and activation scrolled to the target; production copy exposed no raw source. |
| Save | Pass functionally | Exactly one `/save`, HTTP 200. Payload: site `5427`, `/`, `homepage`, `rendered`, property/feed revisions 0/1, 2 selectors, 42 rows, 35,885-byte HTML. |
| Payload hygiene | **Fail** | Zero `data-uf-*`, extension URLs/names, or consent-dialog markers, but 6 `<script>` and 1 `<style>` element remained in both the AI and Save HTML. |
| Polling/reconciliation | **Fail** | Save was followed by context/load, then a second context/load about 0.8–1.4 seconds later for the same binding. Later idle context traffic was single-flight. |
| Silent preview | Pass | Desktop posture exposed 1920×1080 inner/screen metrics. The opaque extension shield blocked an internal-link click while scrolling remained available. |
| Discard and publish fence | Pass | Discard removed a post-Save edit and returned to no pending changes. Checklist showed homepage READY with company/listing/service page types missing; Send stayed disabled and no publish occurred. |

## Arno evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| Root authority/UI | **Fail** | Hub returned `managed_non_candidate`, site `5333`, with category/product candidates. The popup instead displayed **Not a managed property**. |
| Candidate and Render Inspection | Pass | `/collections/katting` was authoritative `managed_candidate`. Both inspection modes completed; `rendered` was selected. |
| Consent/blocking UI | Pass | 36 suppression roots, zero visible dialogs. CookieYes user-facing consent text was absent from AI/Save HTML. |
| Marking/highlighting | Pass | 412×960 marking; plain exclude, Alt include, Shift widen, and all context-menu actions worked. |
| Lazy/reveal/freeze | Pass | 3/3 lazy images completed. The 6,753 px page scrolled to `y=5,792` and back while motion remained paused. |
| AI/freshness | Pass | AI completed. A post-AI physical footer edit disabled Save and Content List in 51.2 ms. |
| Content List | Pass | 74 semantic row buttons: 22 Included and 52 Excluded. Accessible names, focus emphasis, activation scrolling, pointer-and-keyboard copy, and production/debug text separation passed. |
| Save | Pass functionally | Exactly one `/save`, HTTP 200. Payload: site `5333`, `/collections/katting`, `category`, `rendered`, revisions 0/1, 2 selectors, 6 rows, 103,985-byte HTML. |
| Payload hygiene | **Fail** | Extension markers and consent-dialog copy were absent, but 19 `<script>`, 1 `<style>`, and 1 `<noscript>` remained in AI and Save HTML. A CookieYes class token also survives only inside that raw CSS, not as provider dialog DOM. |
| Polling/reconciliation | **Fail** | Two immediate context/load cycles followed Save; marking reactivation also caused another same-binding `/load`. |
| Silent/Discard/fence | Pass | 1920×1080 silent layout, shielded navigation, scrolling, and Discard passed. Checklist was 1/2: category READY, product MISSING; Send disabled; no publish. |

## Bigbag evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| Root authority/UI | **Fail** | Hub returned `managed_non_candidate`, site `5571`, no conflicts, and no page types/candidates. The popup displayed **Not a managed property** instead of a managed property with no candidate work available. |
| Candidate-only workflow | Blocked/N/A | With no authoritative candidate, Render Inspection selection, marking, AI, Content List, Save, Discard, and Send-to-Lynx were unavailable. This is not reported as a false functional pass. |
| Consent/blocking UI | Pass | 17 suppression roots, zero visible dialogs. |
| Lazy loading | Pass | 7/8 lazy images were complete initially; a full 4,698 px scroll completed 8/8 and returned to the top. |
| Reveal/freeze and emulation | N/A | No candidate/render-mode session existed, so candidate freeze and mobile marking posture could not be invoked. The root retained 1920×1080 desktop posture. |
| Refresh/polling | Pass for applicable root checks | Explicit Refresh emitted one `/context`; idle observations were about 30 seconds apart. Navigation startup did show two closely spaced context reads, consistent with the broader duplicate-authority issue. |
| Runtime/mutations | Pass | No recorded page or extension exception, zero Save requests, and zero publication requests. |

## ArkivIT evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| Root authority/UI | **Fail** | Hub returned `managed_non_candidate`, site `5500`, with article/service candidates. The popup displayed **Not a managed property**. |
| Candidate and Render Inspection | Pass | `/tjanster/arkivering-registratur/` was authoritative `managed_candidate`. Both inspection modes completed; `rendered` was restored. |
| Consent/blocking UI | Pass | 2 suppression roots, zero visible dialogs. The hidden “This website uses cookies” subtree remained in live DOM but was absent from AI/Save HTML. |
| Marking/highlighting | Pass with observation note | 412×960 marking. Plain exclude, Alt include, and all context-menu actions worked. Shift-widen was invoked, but its independent visual delta could not be measured after the chosen section had already broadened; the command/menu path remained available. |
| Lazy/reveal/freeze | Pass | 5/5 lazy images complete; 5,947 px full-page walk reached `y=4,986.67`, returned to top, and motion stayed paused. |
| AI/freshness | Pass | AI completed twice. A post-AI physical Include menu action disabled Save and Content List in 128.4 ms. |
| Content List | Pass | 102 semantic row buttons: 39 Included and 63 Excluded. All accessible names passed; focus worked; activating row 36 scrolled to `y=2,071.33`; pointer-and-keyboard copy was present; no raw production source was shown. |
| Save | Pass functionally | Exactly one `/save`, HTTP 200. Payload: site `5500`, `/tjanster/arkivering-registratur/`, `service_page`, `rendered`, revisions 0/1, 2 selectors, 52 rows, 104,115-byte HTML. |
| Payload hygiene | **Fail** | Zero extension/`data-uf-*`/consent-dialog artifacts, but 22 `<script>`, 14 `<style>`, and 1 `<noscript>` remained in AI and Save HTML. |
| Polling/reconciliation | **Fail** | Save at 12:42:05Z returned 200, then context/load and a second context/load all completed by 12:42:08Z. |
| Silent preview | Pass | Desktop inner/screen metrics were 1920×1080. The shield was the top element at an internal link, the trusted click did not navigate, and programmatic scrolling reached `y=800`. |
| Discard and publish fence | Pass | A post-Save marking edit enabled Discard; Discard restored no-pending-changes. Checklist was 1/2: service_page READY, article MISSING; Send disabled; no publish. |

## Cross-site contract matrix

| Contract | Assist24 | Arno | Bigbag | ArkivIT |
| --- | --- | --- | --- | --- |
| Authoritative root UI | Pass | **Fail** | **Fail** | **Fail** |
| Candidate Render Inspection | Pass | Pass | N/A | Pass |
| Consent suppression/exclusion | Pass | Pass | Pass | Pass |
| Mobile marking/highlighting | Pass | Pass | N/A | Pass with Shift note |
| Lazy loading/full scroll | Pass | Pass | Pass | Pass |
| Reveal freeze | Pass | Pass | N/A | Pass |
| AI freshness projection | Pass | Pass | N/A | Pass |
| Semantic Content List UX | Pass | Pass | N/A | Pass |
| One Save request / HTTP 200 | Pass | Pass | N/A | Pass |
| Extension/consent artifact removal | Pass | Pass | N/A | Pass |
| Production script/style removal | **Fail** | **Fail** | N/A | **Fail** |
| Save reconciliation/poll cadence | **Fail** | **Fail** | Root-only pass | **Fail** |
| Silent desktop shield/scroll | Pass | Pass | N/A | Pass |
| Discard | Pass | Pass | N/A | Pass |
| Send-to-Lynx fence/no publish | Pass | Pass | N/A/no publish | Pass |

## Network and runtime summary

- 154 extension-service-worker requests and 148 responses were observed.
- Endpoint totals: 112 `/context`, 28 `/load`, 6 AI
  `/get_selectors`, 5 account validation, and 3 `/save`.
- All 3 Save requests received HTTP 200. Each property emitted exactly one Save;
  no duplicate Save retry occurred.
- Every AI request and its corresponding Save used the same rendered HTML size
  and exhibited the same raw production-code leakage.
- Zero publish/send-like requests were observed.
- Zero extension-service-worker exceptions and zero extension console
  warning/error records were observed. Chromium Wayland/GPU/GCM messages were
  browser/environment messages, not extension exceptions.
- A short final ArkivIT main-world error/rejection recorder observed zero new
  errors. A full historical website-console-clean claim is intentionally not
  made because website-target observers were detached during extension-owned
  inspection and emulation.

## Required remediation, in priority order

1. Strip or humanize raw production `SCRIPT`, `STYLE`, and `NOSCRIPT` source in
   the sanitized AI and Save capture, while retaining the existing exclusion
   decisions/technical rows and keeping debug-only diagnostics available.
2. Coalesce post-Save authority adoption so one successful Save does not launch
   two immediate `/context` and two `/load` cycles. Preserve exactly one
   authoritative adoption/Todo refresh and the normal single-flight backstop.
3. Render `managed_non_candidate` roots as managed property state, including
   candidate guidance or an explicit “no candidates/page types available”
   state, rather than **Not a managed property**.
4. Repeat Bigbag candidate-only gates when Hub supplies at least one candidate;
   until then, keep them N/A rather than bypassing authority.

## Final sanity status

Consent, mobile/desktop posture, marking, highlighting, lazy loading,
reveal/freeze, immediate AI freshness, semantic preview UX, Save serialization,
Discard, silent interaction shielding, and publication fencing are healthy on
the three available candidates. P20 should remain reopened because capture
sanitization, post-Save authority coalescing, and managed-non-candidate root UI
are not yet correct, and Bigbag has no candidate with which to execute the
candidate-only gates.
