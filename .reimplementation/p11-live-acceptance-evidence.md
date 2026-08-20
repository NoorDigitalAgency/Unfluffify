# P11 Witnessed Live Acceptance Evidence

**Acceptance date:** 2026-08-20 (Europe/Stockholm)  
**Extension commit under test:** `82cd129d` on `re-write`  
**Production artifact:** `.output/chrome-mv3`, manifest `2.0.0`  
**Deterministic file-tree SHA-256:** `1866ccd438cfb120b92de756a1828e9439d783c880bee3c6cd1a2fc82671a25b`  
**Browser:** Chromium 151.0.0.0, production extension build  
**Hub commit:** `9bdce9f99f16f3f7dc86996c5521730af8d41438` on clean `develop`  
**Deployed Alpha evidence:** GitHub Actions run `32230797511`, successful at
2026-08-19T08:08:18Z for the same Hub commit  
**Property identity:** environment `a.lynxdev.se`, site `60`, base URL
`https://bonliva.se`

The live browser reused the configured extension profile but dropped the prior
service-worker registration before each run. The production artifact was loaded
unpacked and the target page was reloaded, so no stale worker or debug build was
involved. The production popup correctly exposed no debug API.

## Required live matrix

| Requirement | Result | Witnessed evidence |
|---|---|---|
| Todo candidate navigation | Passed | From `/`, selected `/artikel/vad-tjanar-en-arbetsterapeut-konsult-i-lon`, received the exact inline discard warning, confirmed it, and reached the exact URL in bound tab `1926052770`. The popup retained the editor lock and enabling marking on the new document produced `view=marking`, a checked toggle, and an enabled Run AI action. |
| Reveal, lazy wait, freeze, and scroll restore | Passed | The live page settled at its original `scrollY=0` with `data-uf-lazy-loading-suppressed`, `data-uf-page-motion-paused=true`, and the pause indicator present. The home-page growth result was `scrollHeight=15364`. The focused content gate asserts the ordered reveal/freeze commands and one-visit lifecycle, including suppression before the final freeze. |
| Forced mobile emulation | Passed | Before the marking toggle moved, the page reported a 412×960 viewport, DPR 1, and the Googlebot mobile UA (`Nexus 5X`, `Googlebot/2.1`). The posture remained mobile through marking activation, deactivation, candidate navigation, and reload. |
| Border grammar | Passed | Live silent content/excluded borders were 2 px dashed in the rewrite colors; immutable borders were 1 px dashed; explicit marking borders were 3 px solid. The production stylesheet retained the AI dash animation and focus blink. |
| Responsive marking and modifiers | Passed | On the live article, marking rendered 556 classified rows without a visible interaction stall. Default click excluded; Alt-click included; Shift-click widened the exclusion while preserving the explicit inclusion; right-click exposed Include, Exclude, Widen exclusion, and Clear mark; Space temporarily switched to passthrough and restored exclusion mode on key-up. |
| Constrained silent/post-AI interaction | Passed | Toggle-off returned the popup to `view=silent` and restored silent highlights while motion pause and lazy suppression remained active. A trusted click on the visible Cookiepolicy link did not navigate. A trusted wheel event moved `scrollY` from 0 to 650 while the URL, freeze, lazy suppression, and silent highlights remained intact. |
| Shadow-flattened capture | Passed | The production marking surface exposed the flattened classified row set. `tests/capture-page-snapshot-handler.test.ts` and `tests/golden/ai-snapshot.test.ts` provide the open-shadow fixture proof for flattening, markability, artifact removal, capture, and exact submitted output; Bonliva did not expose a suitable open-shadow fixture to mutate live. |
| Save/Discard/Todo/Send and recovery paths | Passed | Todo navigation, inline Discard confirmation, candidate recovery, lock continuation, same-tab navigation, reload, and post-navigation marking were witnessed live. Save, publication, endpoint-token invalidation, panel close/reopen, lock transfer, duplicate/publication-unknown recovery, and MV3 restart are covered by the P9 state-bearing integration matrix and the green P10/P11 production-equivalent contract suite. Shared Alpha Save/Send mutations were not issued merely to manufacture evidence against the user's live property. |

## Live failures found and repaired

1. Candidate navigation forgot the tab brain and restarted signal numbering at
   one. A popup cursor that had already consumed sequence one rejected the next
   `marking.enabled` signal. The background now retains the last signal head
   across navigation/reload cleanup, seeds the replacement brain and durable
   facts from that head, and clears it only when the tab is terminally closed.
2. Leaving marking mode used the terminal teardown path. Silent highlights were
   restored, but the teardown had already lifted motion pause and lazy-loading
   suppression. Toggle-off and successful Save now enter a distinct read-only
   silent transition that removes marking listeners and overlays while retaining
   the visit's page-world stabilization. Navigation, unregister, configuration
   deletion, and tab cleanup still use terminal teardown.

Both repairs are in `82cd129d` and were retested in the final production build.

## Automated rerun

| Command | Result |
|---|---|
| `pnpm vitest run tests/c4-content-entrypoint.test.ts tests/src/popup/entrypoint.test.ts tests/src/background/brain.test.ts tests/integration/rewrite-cutover.test.ts` | 4 files / 66 tests passed. |
| `pnpm verify` | Lint, generated page-world freshness, all TypeScript projects, 91 files / 685 tests, production build, and 7 manifest assertions passed. |

Hub remained clean and unchanged at its already-live Alpha commit, so the
conditional `Alpha Release` workflow was not rerun.
