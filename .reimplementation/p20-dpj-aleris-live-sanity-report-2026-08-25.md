# P20 DPJ/Aleris headed-browser sanity report — 2026-08-25

## Outcome

P20 passes the repeated DPJ and Aleris production-extension workflows. The
repository `live-browser`, `live-round`, and `live-watch` procedures controlled
the launcher-owned headed Chromium; the temporary `debugTabId` helper closed
after opening the real side panel, and production observation did not depend on
the debug hook.

Consent suppression is a passing extraction-hygiene behavior. Cart, account,
contact, assembly, country, Cookiebot, modal, and similar blocking surfaces stay
hidden and are omitted from marking rows, captures, AI artifacts, and saved
payloads. No selector was relaxed to restore those surfaces.

## Tested builds and URLs

| Property | URL | Production registration stamps | Result |
|---|---|---|---|
| DPJ | `https://www.dpj.se/` | `2.0.0.72` and `2.0.0.73` | Passed; homepage remains saved at 1/7 coverage. |
| Aleris root | `https://www.aleris.se/` | `2.0.0.74` | Passed managed-non-candidate, unlocked read-only inspection, and navigation recovery. |
| Aleris candidate | `https://www.aleris.se/kirurgi/brack/aderbrack/` | `2.0.0.75` and `2.0.0.76` | Passed marking, AI, preview, Save/recovery, payload, shield, and publication fencing. |

The final implementation commits exercised by the automated/live closure are
`55300452`, `7d466c36`, and `15f1c186` on `re-write`.

## DPJ workflow

| Contract | Result | Evidence |
|---|---|---|
| Launcher/client identity | Passed | Only plain `popup.html` and the DPJ page remained open; `state` returned `target:null` and `debugHookAvailable:false`, proving production popup-only observation. |
| Render Inspection | Passed | Both With JavaScript and Without JavaScript terminalized with the expected page copy and `paint-acknowledged`; Cancel restored the silent view. |
| Emulation/session | Passed | Marking used 412×960. Silent Desktop preview used 1920×1080; the shield rect followed the 1912×1080 visual viewport with opacity 1, pointer events enabled, and z-index 2147483647. |
| Consent | Passed | 17 suppressed nodes remained hidden; none was visibly painted. Suppression is intentional and unchanged. |
| Dirty/AI freshness | Passed | A post-mark signal projected the `requires-ai-run` state in 2 ms, before remote polling. Run AI restored Save and Content List. |
| Content List | Passed | 645 semantic button rows used ordinal/readable/status accessible names and pointer-plus-keyboard instructions. Production omitted XPath, internal classifications, and raw script/style source. |
| Focus and activation | Passed | Focus produced row emphasis. Activating off-screen row 39 moved `scrollY` from 0 to 880.67 and placed the target at y=471.18 after the guarded root-scroller fallback. |
| Save/Todo | Passed | The previously witnessed first configuration emitted one current-page `/save`, adopted the response, and advanced homepage coverage to 1/7. The Save diagnosis is timing evidence only; no speculative cause is asserted. |
| Send to Lynx | Passed/fenced | Homepage was READY; six page types remained missing. The checklist Send button stayed disabled and no publication request was emitted. |
| Runtime hygiene | Passed | No extension page, popup, or service-worker exception was observed. Browser GPU/GCM/platform messages were not extension failures. |

## Aleris workflow

| Contract | Result | Evidence |
|---|---|---|
| Root/non-candidate inspection | Passed | `/` remained `managed_non_candidate`; both inspection controls remained usable under the read-only banner and both modes completed. Navigation no longer stranded Cancel/render-mode authority. |
| Authority traffic | Passed | After binding transitions, same-binding `/context` observations were 30.4 seconds apart; the helper client emitted no duplicate poll stream. Definitive load state was cached until an explicit authority event. |
| Candidate transition | Passed | The candidate page adopted silent authority, enabled marking, and moved to exact 412×960 before content activation. |
| Consent | Passed | Five Cookiebot-related nodes were suppressed and zero were visibly painted. No Cookiebot/Cybot or extension label appeared in production Content List copy. |
| Dirty/AI freshness | Passed | A post-AI exclusion disabled Save and Content List with `requires-ai-run` in 113 ms. The fresh AI reconciliation completed in about 1.1 seconds. |
| Content List semantics | Passed | The settled preview contained 164 semantic button rows: 64 Included and 100 Excluded. Default submitted (`undetected`) content correctly appeared Included; excluded, immutable, and inaccessible closed-shadow rows appeared Excluded. Raw production XPath/classification/source was absent. |
| Keyboard/focus/scroll | Passed | Programmatic keyboard focus applied the same active-row/emphasis path. Activating Included row 32 moved `scrollY` from 0 to 1424.67 and painted `uf-hover` on the exact target. Native Enter/Space is covered by the clean P17/P20 gates because direct CDP key dispatch to a Chrome side-panel target is not routed by this Chromium harness. |
| Silent Desktop preview | Passed | Enabling Desktop preview produced 1920×1080 layout and a connected, opaque, interactive, maximum-z shield matching the 1904.67×1064.67 visual viewport. Trusted wheel scrolling remained available by the native-scroll policy. |
| Save serialization | Passed | A current-page save emitted exactly one `POST https://unfluffify.lynxdev.se/save`. The final retry used property revision 2, received HTTP 200 in 1.575 seconds, returned to silent mode, and displayed `Session saved`. |
| Stale fence recovery | Passed | A browser restart encountered the prior editor lease and one update returned HTTP 409 `stale_fence`. The product displayed `Save failed: stale_fence`; explicit Refresh adopted authority and the next one-request Save succeeded. |
| Payload hygiene | Passed | The 124,929-byte final `renderedHtml` contained zero `data-uf-*`, `uf-cursor-*`, `unfluffify`, or `chrome-extension:` occurrences. Only `/kirurgi/brack/aderbrack/` was saved. |
| Send to Lynx | Passed/fenced | Coverage was 1/2: `service_page` READY and `article` MISSING. Send stayed disabled and the network trace contained no publish request. |
| Runtime hygiene | Passed | No extension exception or console error was observed. Remaining warnings were Aleris/Chromium preload and platform messages. |

## Automated closure

`pnpm verify` passed lint, generated page-world parity, all TypeScript projects,
123 test files / 1,116 tests, the production build, and seven manifest
assertions. `pnpm build:debug` also passed.

| Gate | Result | Retained SHA-256 |
|---|---|---|
| P14 | 192 scenarios; zero semantic, budget, or activation failures | `5e6e4619ef3f06018868ff7f07a47a89f7f97ac8ba230a85bd0989928672bdc1` |
| P15 | 36/36 | `b7bd99eafe5c9e98516cf6f09ddf3bfad866ebf49818d13311133d3f09fc5904` |
| P16 | 13/13 | `35f2e0f9998aae749dd02839cd5c779b4a7845fee126da3f415ca9153956383e` |
| P17 | 19/19 | `6b32af065e5db7f3c56b10062d9cd2980ef3e1b880d9392ae6d32c3bccbc7bce` |
| P18 | 14/14 | `979cd4e4115937a849631db322c33afb6f95f075d06fc1d254a570248cc769d0` |
| P20 | 4/4 | `115cab504f3b7e10163f5bbce112423d643318493008e5220568636df623f319` |

## Sanity conclusion

No P20 blocker remains. DPJ and Aleris intentionally remain below full page-type
coverage, so publication is correctly unavailable; this is content onboarding
state, not a workflow defect. Consent suppression remains active by design.
