# P20 four-site headed-browser follow-up — 2026-08-25

## Verdict

The remediation is complete in source and automated acceptance. The headed
production round passed the functional workflows on Acne Specialisten,
Acapedia, and the managed 3D Prima `/se` candidate; the 3D Prima root correctly
remained unmanaged. No Lynx publication occurred.

One final source-fresh activation recheck is recorded as **environment-limited**:
the repository-managed Chromium accepted `chrome.debugger.attach` but never
resolved a direct `Emulation.setDeviceMetricsOverride` command, even with the
popup closed and the service worker issuing the command directly. The extension
now bounds that browser failure and releases its posture instead of wedging the
queue. This is not counted as a clean final headed pass, and the report does not
hide it behind the earlier successful run.

## Scope and method

- Repository `.github/skills/live-browser`, `live-round`, and `live-watch`
  procedures only; no OS Chrome or user profile was touched.
- Production extension for the complete site workflows. Debug build and the
  full P14–P20 browser gates are the complementary debug/contract evidence.
- Popup-only CDP clients during extension-owned emulation. Network capture was
  attached to the extension service worker, not the website target.
- Suppressed provider nodes remained in the live DOM but were hidden and
  excluded from marking rows, rendered/raw captures, AI HTML, and Save payloads.
- Publication was never authorized because required page-type coverage was
  incomplete.

## Site results

| Site | Result | Key evidence |
| --- | --- | --- |
| `acnespecialisten.se` | Pass | Both render modes paint-acknowledged; 412×960 marking and 1920×1080 silent desktop; six blockers hidden/zero visible; 335 semantic Content List rows; AI freshness invalidated in 122 ms; one HTTP 200 Save; coverage 1/5; no publish. |
| `acapedia.no` | Pass after remediation | Both inspections passed; provider suppression hid all blockers; a controlled `.cookie-modal` + `html.noScroll` fixture proved overflow release and `scrollY=800` without deleting provider DOM/classes; SVG/non-string IDs no longer throw; marking, AI, Discard, and 1/4 fence passed. |
| `3dprima.com` | Pass as unmanaged | Hub 404 maps to authoritative `property_not_found`; popup no longer reports a transient authority outage; explicit Refresh produced exactly one `/context`; managed-property suppression and marking correctly remained unavailable on this root. |
| `3dprima.com/se` | Functional pass; final activation recheck environment-limited | Exact `/se` is managed/non-candidate and offered candidates. Anycubic candidate passed suppression, reveal/freeze, 412×960 marking, 1920×1080 silent restoration, AI/freshness, semantic preview, one fenced Save, 1/4 coverage, and no publish. A later source-fresh rerun hit the managed-Chromium debugger non-acknowledgement described above. |

## Contract matrix

| Contract | Result | Evidence |
| --- | --- | --- |
| Render inspection | Pass | JavaScript-on and JavaScript-off runs terminalized `paint-acknowledged` in the completed production round. Same-document fragment/history noise preserved the document and lock; path/query/document changes retained navigation fences. |
| Consent/blocking UI | Pass | Acne: 6 hidden/0 visible. Acapedia: provider and controlled fixture hidden/0 visible with scroll restored. 3D `/se`: country/customer blocker set hidden/0 visible. The unmanaged 3D root intentionally kept its provider modal. |
| Extraction hygiene | Pass | Extension nodes, `data-uf-*`, cursor classes, suppressed subtrees, scripts/styles/noscript source, and root-only modal posture classes were absent from captured artifacts. Provider DOM remains inspectable live. |
| Marking/highlighting | Pass | Mobile marking exposed include/exclude/widen/clear. Non-string/SVG IDs are narrowed through `getAttribute`. Hover/focus emphasis and explicit markings stayed coherent. |
| Lazy loading and reveal/freeze | Pass with site note | Reveal/freeze ran once per eligible page visit, walked and restored scroll under freeze, and capped lazy expansion. Acne retained 6/88 already-complete native lazy images after scrolling; extraction and page scrolling still passed and this was site behavior, not an extension exception. |
| Render/emulation posture | Pass in completed round | Marking used 412×960 and silent desktop used 1920×1080. The transition now follows a replacement document only when normalized URL plus `{environmentKey, siteId}` remain exact; apex/`www` spelling is not used as property identity. |
| AI and freshness | Pass | Fresh AI enabled Save/Content List; a post-AI marking change disabled both within 122–305 ms across tested properties, without waiting for a remote poll. |
| Content List UX | Pass | 335 rows on Acne and 86 on Acapedia were semantic buttons with ordinal/label/included-state accessible names; pointer hover and keyboard focus shared emphasis; activation scrolled to the target; production text contained no raw source. The 3D candidate projected 589 semantic rows. |
| Save/payload | Pass | Acne and Acapedia emitted one HTTP 200 Save each. The 3D candidate's final fenced rerun emitted exactly one `/save`, received HTTP 200 with property/feed revision 1, adopted the authoritative response, and advanced coverage to 1/4. No duplicate retry occurred. |
| Polling | Pass | Fast local projection was immediate. Authority traffic was single-flight at the 15-second backstop; explicit Refresh forced one generation; definitive `not_found` remained cached per binding. |
| Lock/session coherence | Pass | Takeover and editor-state changes retained stable environment/site identity. Save revalidated the mutation fence immediately before its single request. Failed debugger operations are bounded and cleanup no longer strands the per-tab queue. |
| Send to Lynx | Pass/fenced | Acne 1/5, Acapedia 1/4, and 3D `/se` 1/4 showed missing page types and a disabled final Send action. Network capture observed zero publish requests. |
| Console/runtime hygiene | Pass for extension | No unchecked message-port rejection or extension exception remained in the completed round. Site-owned Meta/Freshchat/jQuery and Chromium GPU/GCM warnings were classified separately. |

## Defects repaired

1. Consent suppression released known root scroll locks without deleting provider
   DOM or classes; capture sanitization strips only root posture tokens.
2. Marking identity reads are string-safe for SVG/foreign DOM objects.
3. Typed Hub 404 is definitive `property_not_found`; ambiguous failures remain
   unavailable.
4. Authority refresh is single-flight, coalesces one trailing forced pass, and
   no longer duplicates Todo context reads.
5. Emulation reload continuation rebinds the replacement document and compares
   stable environment/site identity rather than canonical-vs-observed base URL.
6. Lock-state delivery carries that identity even when no Save mutation fence is
   currently projected.
7. The debugger API bridge supports callback and promise-only implementations,
   bounds missing acknowledgements, and always attempts physical detach during
   cleanup.
8. Save performs a late fence refresh and preserves typed stale-fence/duplicate
   metadata through every realm.

## Automated validation

- Implementation commit: `2b6691918ddf` (`Repair P20 four-site workflows`).
- `pnpm verify` passed lint, generated page-world parity, every TypeScript
  project, 125 test files / 1,131 tests, the production build, and all seven
  generated-manifest assertions.
- `pnpm build:debug` passed with the debug-only inspection and preview surfaces
  present.
- Clean-source browser gates passed: `pnpm performance:p14` 192 scenarios;
  `pnpm performance:p15` 36/36; `pnpm performance:p16` 13/13;
  `pnpm performance:p17` 19/19; `pnpm performance:p18` 14/14; and
  `pnpm performance:p20` 4/4. All semantic, budget, activation, controller,
  fatal, and cleanup failure counts were zero.

| Gate | Retained artifact | SHA-256 |
| --- | --- | --- |
| P14 | `output/playwright/p14-marking-performance/acceptance-2026-08-25T11-35-15-001Z.json` | `42e9536c8bd5390cad1aa03c4460cdd51ed8fed5b752d2c701bdd448e2524871` |
| P15 | `output/playwright/p15-frozen-shield/acceptance-2026-08-25T11-44-01-421Z.json` | `1f8bf33bbf43abcd3bf11d8fffaad4609cba5fadf4f107d8491a4b96771aca2b` |
| P16 | `output/playwright/p16-render-inspection/acceptance-2026-08-25T11-44-42-949Z.json` | `07378de60989f3cb366233ad1dbbce2488475be35affc809142fbb9b46b5d7ae` |
| P17 | `output/playwright/p17-preview/acceptance-2026-08-25T11-45-01-990Z.json` | `143b3b43c6b605a25f2940cc0dc2a580aacb0e382dc919dd72ca01fc46b85fa1` |
| P18 | `output/playwright/p18-transient-toast/acceptance-2026-08-25T11-45-32-961Z.json` | `b6456ee0b22ab2ea576f6653d6979a69c0b1ead48ddcb1f15c547b17f2074594` |
| P20 | `output/playwright/p20-integrated/acceptance-2026-08-25T11-46-28-841Z.json` | `9130e18930126ebc44af2de53cfae8cefce2a8ae48bb4445c8d584a4f8bde9ec` |

## Remaining status

There is no known source-level workflow blocker after the remediation and full
automated gates. The source-fresh 3D candidate activation should be repeated in
a headed environment whose `chrome.debugger.sendCommand` resolves; until that
external condition is available, this follow-up does not claim a second clean
headed activation on build `2.0.0.99`.
