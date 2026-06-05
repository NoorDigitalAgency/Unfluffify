# Unfluffify Plan

## Authority Refactor Handoff

Planning-only handoff prepared for the local Copilot agent:

1. Start with `.copilot/authority-refactor-handoff.md`.
2. The final concrete plan is the authority-boundary refactor: background worker
   as durable runtime authority, popup/side panel as UI and user intent only,
   content scripts as live DOM/page authority, and shared modules as pure logic.
3. Treat marking/XPath inspection as an added preflight step in that process,
   not as a replacement for the authority-refactor plan.
4. Keep page marking, draft DOM logic, snapshots, overlays, XPath calculation,
   and AI preview rendering in content scripts.
5. Migrate in safe steps: tab state/background authority cleanup, popup
   active-tab lifecycle delegation, spinner/navigation inspection delegation,
   AI run orchestration migration, remote config/site discovery orchestration
   cleanup, then removal of obsolete popup-side state mutations.
6. Avoid moving large HTML/server/AI payloads through runtime messages; prefer
   persisted keys/metadata or an owner-context fetch.

Validation checkpoint after Round-7 authority slices:

1. Current committed slices pass the full Node regression suite, focused
   authority/reload/popup/content/AI/GraphQL suites, static popup authority
   surface searches, diagnostics on touched entry points, and the extension
   package staging dry run.
2. Repo-configured live Playwright MCP validation works when invoked with
   absolute paths for `--user-data-dir` and `--config`:
   `npx -y @playwright/mcp@latest --user-data-dir=<repo>/.mcp-browser-profile
   --config=<repo>/.vscode/browser-mcp.config.json`.
3. Validation-infra phase: `@playwright/mcp@0.0.75` expects config under the
   `browser` key (`browser.launchOptions`), not legacy top-level
   `launchOptions`. Keep `.vscode/browser-mcp.config.json` in that schema and
   keep `ignoreDefaultArgs: ["--disable-extensions"]` so the unpacked extension
   is not suppressed by Playwright's default Chrome flags. MCP's default Chrome
   channel did not inject this unpacked extension even with the extension flags
   resolved; using Playwright's bundled Chromium executable at
   `/home/rojan/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`
   with `browser.browserName: "chromium"` matches the standalone working script
   and makes the content-loader and `background.js` service worker appear. The
   repo MCP server entries pass
   absolute `--user-data-dir` and `--config` paths; relative paths can resolve
   incorrectly depending on the MCP client process cwd and have created stray
   `undefined/` browser profiles during manual terminal validation.
   Standalone Playwright scripts that do not use `.mcp.json` / `.vscode/mcp.json`
   must pass the persistent profile path themselves, e.g.
   `/home/rojan/Documents/Git/GitHub/Unfluffify/.mcp-browser-profile`.
   On this Linux host, Chromium sandboxing is unavailable for the repo browser
   validation path; keep `browser.chromiumSandbox: false` and
   `launchOptions.args` including `--no-sandbox` in
   `.vscode/browser-mcp.config.json` so repo-local Playwright validation can
   launch the unpacked extension at all.
4. The Playwright-local MCP browser profile must have Chrome Extensions
   Developer mode enabled before unpacked extension validation is considered
   meaningful. The current persistent `.mcp-browser-profile` has
   `extensions.ui.developer_mode: true` in `Default/Preferences`; fresh profiles
   do not. Prefer the persistent repo profile for live validation, or ask the
   user to open `chrome://extensions` in the MCP browser and enable Developer
   mode before validating a new profile. Do not silently rely on a fresh profile
   as product validation until this prerequisite is satisfied/automated.
   Restart the `playwright-local` MCP server/browser after extension or config
   changes; a long-lived MCP process can keep the persistent profile locked and
   continue serving an older unpacked-extension instance.
5. User-confirmed Playwright validation: launching Chromium with the resolved
   `browser.launchOptions` from `.vscode/browser-mcp.config.json` and the
   persistent `.mcp-browser-profile` loads the unpacked extension and preserves
   the existing extension configuration. A repo-configured MCP run using the
   bundled Chromium executable showed `#unfluffify-page-motion-freeze-script`,
   `data-uf-debug-tab-id`, and service worker
   `chrome-extension://poibphcdecdbdcafahkacjbflalafmjh/background.js` on
   `https://seo.se/`. If `launchOptions.channel === ""` is present in an ad-hoc
   script config, delete that property before calling the core Playwright API;
   the MCP resolver tolerates it, but Playwright's
   `chromium.launchPersistentContext` expects a valid channel or `undefined`.
6. `https://seo.se/` live smoke now passes through the repo-configured
   `playwright-local` MCP after restarting the MCP server/browser with the
   corrected config. The smoke verified content bootstrap injection,
   `background.js` service worker registration, popup load through
   `popup.html?debugTabId=...`, `resolvePopupTabContext`, `getTabState`, and
   `getPersistedAiRunRecord`. The previous `resolvePopupTabContext`
   no-response result was captured before the confirmed working launch shape and
   should not block further authority work until reproduced with the corrected
   profile/config setup. The seo.se page itself logs an unrelated site script
   `Failed to fetch` error from `seo-theme`.
7. Remaining authority work should still avoid proxying large config, HTML, or
   AI request/response bodies through runtime messages; use storage keys,
   owner-context fetches, or a designed background/offscreen ownership path.
8. AI recovery authority slice completed: popup now routes page-side compute
   lock acquire/release and AI-run heartbeat refresh through background runtime
   messages. Background owns the atomic heartbeat sequence: normalize and store
   recovery metadata, ensure `content-main` is active, apply the page-side
   compute lock, and clear recovery metadata if the lock cannot be applied.
   Content acknowledges compute-lock acquisition before refreshing silent
   highlighting so background callers do not hang on page-side rendering work.
   Validation passed focused AI/broker tests, full `npm test`, and a reload-aware
   repo-configured MCP smoke on `https://seo.se/` that verified extension load,
   popup `debugTabId`, `resolvePopupTabContext`, and background-routed compute
   lock on/off.
9. AI status transport slice completed: popup AI polling now routes the small
   `/get_selectors/status/:sessionId` request through background
   `requestAiRunStatus`, while the large AI start payload and result selector
   response remain popup-owned for now to avoid moving heavy AI bodies through
   runtime messages. Focused AI/broker tests lock this boundary.
10. Obsolete popup AI persistence cleanup completed: popup now only loads and
   clears persisted AI-run metadata directly; background-owned heartbeat refresh
   is the only path that saves recovery metadata.
11. Remote invalid-page cleanup transport slice completed: popup still owns the
   invalid URL pruning loop and successful-removal cache, but the small `/remove`
   POST now goes through background `removeRemotePageMarking`; no large config
   payloads are moved through runtime messages.
12. Auth token validation transport slice completed: popup still owns auth UI
   state, invalid-token UX, and validation throttling, but the small
   `accounts.<stageBase>/api/account/validate` GET now goes through background
   `validateAuthToken`; popup no longer fetches that auth endpoint directly.
13. Auth login transport slice completed: popup still owns login form gating,
   token persistence, success/failure toasts, and view transitions, but the
   small `accounts.<stageBase>/api/account/login` POST now goes through
   background `requestAuthLogin`; popup no longer fetches that auth endpoint
   directly.
14. Repo-local Playwright MCP spec alignment completed: `.vscode/mcp.json`,
   `.mcp.json`, and `.codex/config.toml` now all point at the same absolute
   repo-local browser profile and browser config, and
   `.vscode/browser-mcp.config.json` explicitly keeps
   `browser.chromiumSandbox: false` plus `--no-sandbox` for this Linux host.
15. Selector-submit GraphQL transport slice completed: popup still owns
   selector preparation, page-type assignment, local selector-state updates,
   and save UX, but the small `updateScrapingConditions` GraphQL mutation now
   goes through background `submitSelectorSetGraphqlUpdate`; the large
   page-type-assignment HTML payload stays popup-owned.
16. Remote config load transport slice completed: popup still owns local
   config replacement, change notifications, and invalid-page cache cleanup,
   but the small `/load` POST now goes through background
   `loadRemoteConfigSnapshot`; popup hydrates any returned payload through a
   staged storage key instead of fetching that endpoint directly. The shared
   runtime helper now prefers Chrome's Promise-based `runtime.sendMessage`
   path, which matches the repo's MV3 service-worker messaging behavior during
   live browser validation.
17. Responsiveness delegation audit phase added: inspect popup and content
   entry points for heavy, thread-blocking work that can freeze interaction
   (large config syncs, payload assembly, parsing/normalization passes, and
   other long-running orchestration helpers), then move feasible slices behind
   asynchronous background-owned workflows. Use runtime messaging only for
   control metadata and stage heavy request/response bodies through
   `chrome.storage.session` keys so the UI thread stays responsive while the
   popup or content script awaits completion. Validate each slice with focused
   regression tests, full `npm test`, and repo-local headful Playwright live
   verification after reloading the unpacked extension worker.
18. Remote config save transport slice completed: popup still owns config
   normalization, site/page-type reconciliation, merge semantics, invalid-page
   pruning, and UX/retry policy, but the `/save` POST now goes through
   background `saveRemoteConfigSnapshot`. Popup stages the heavy request and
   response bodies through `chrome.storage.session` keys so the runtime message
   carries only control metadata. Repo-local headful validation confirmed the
   live worker transport path and structured server error handling; the current
   persistent profile did not contain a populated local config to exercise a
   successful save response body.
19. Render-mode detection transport slice completed: popup still owns retry
   policy and result normalization, but the heavy `rawHtml` / `renderedHtml`
   request body for `/is_js_rendered` now goes through background
   `requestRenderModeDetection` with the HTML staged through
   `chrome.storage.session`. Live repo-local validation confirmed the staged
   request reaches the worker and returns structured endpoint errors without
   blocking popup-side orchestration.
20. Page-type assignment transport slice completed: popup still owns
   assignment building, raw-HTML backfills, and selector-submit orchestration,
   but the heavy `/assign_page_types` POST now goes through background
   `submitPageTypeAssignments` with the raw/rendered HTML payload staged
   through `chrome.storage.session`. Live repo-local validation confirmed the
   worker path accepts the staged body and returns structured endpoint errors
   without blocking the popup flow.
21. AI run start/result transport slice completed: popup still owns AI-run
   orchestration, lifecycle gating, status polling, and selector application,
   but the heavy `/get_selectors` start payload and `/get_selectors/result`
   selector response now go through background
   `requestAiRunStartSnapshot` / `requestAiRunResultSnapshot`. The start
   request body and result selector payload are staged through
   `chrome.storage.session`, and live repo-local validation confirmed the
   worker paths return structured start/result failures without blocking popup
   orchestration.
22. Heavy marking/silent recalculation audit result: the actual marking and
   silent-highlight recomputation loops stay content-owned for now. They depend
   on live DOM access, geometry, mutation observers, overlay state, and
   browser-only document APIs; the MV3 service worker does not expose
   `document` or `DOMParser`, so moving those recalculations directly into
   background would violate the authority boundary or require a dedicated
   offscreen compute document. Keep investigating surrounding orchestration and
   serialization work for offload, but keep the core render/rebuild passes in
   `content-main.js` unless the architecture changes.
23. AI corpus preparation offload slice completed: popup still owns AI-run UI,
   page snapshot capture triggers, and the static-mode tail that refines
   `rawXPaths`, but background now owns the expensive stored-page scan,
   missing-raw-HTML backfills, and staged AI corpus assembly via
   `prepareAiRunPayloadSnapshot`. Rendered-mode runs can now avoid popup-side
   corpus assembly entirely, and static-mode runs only do the remaining
   `refineXPathEntries(...)` pass locally because the worker lacks
   document-parsing APIs.
24. Remote config merge/replacement offload slice completed: popup still owns
   remote-load/save orchestration, retry policy, invalid-page pruning, and tab
   refresh notifications, but background now owns the pure-data config
   replacement and merge/reconciliation passes via
   `replaceServerConfigIntoLocalSnapshot` and
   `mergeServerConfigIntoLocalSnapshot`. Both `/load` and `/save` response
   payloads stay staged in `chrome.storage.session` until background consumes
   them, so popup no longer hydrates or normalizes those heavy remote config
   bodies on the UI thread. Live repo-local headful validation confirmed that
   staged payload keys are cleared, current-page replacement detection still
   works, confirmed local page markings can override remote data when requested,
   and invalid remote page URLs are still surfaced for the follow-up prune
   pass.
25. Page-type assignment preparation offload slice completed: popup still owns
   the AI/selector-submit orchestration and error reporting, but background now
   owns the heavy stored-page scan, checklist assignment construction,
   missing-raw-HTML backfills, and staged `/assign_page_types` payload assembly
   via `preparePageTypeAssignmentsSnapshot`. The popup now sends only control
   metadata for that preparation step and no longer builds or backfills the
   assignment HTML payload on the UI thread. Live repo-local headful validation
   confirmed the prepared payload includes the expected page types, clears the
   staged payload after handoff, and persists raw-HTML backfills for reachable
   stored pages.
26. Marking-toggle responsiveness investigation completed:
   the current unresponsive click path is not primarily popup-side. The heavy
   synchronous work sits in `content/core.js` after the click acknowledgement:
   `handleToggleEvent(...)` calls `toggleExplicitExclude(...)` /
   `toggleExplicitInclude(...)`, which mutate the page entry synchronously and
   then call `completeExplicitToggle(...)`. The immediate explicit-layer refresh
   in `refreshExplicitMarkingOverlay(...)` still runs `syncPageMarkings(...)`
   before drawing, and `syncPageMarkingsInner(...)` performs a DOM-heavy pass
   that rebuilds default posture rows by scanning the live document with
   `collectToggleableTargets(...)`, repeated XPath resolution, visibility/text
   checks (`isVisible`, `isTextualContainer`, `hasTextualDescendant`), ancestor
   bookkeeping, and explicit/default precedence reconciliation. Shift-parent
   target resolution can add more synchronous ancestor work through
   `resolveMarkableElement(...)`, but the post-click branch/default
   reconciliation is the larger freeze source.
27. Marking-toggle async design constraint:
   a simple MV3 background-worker offload is not correct for this hotspot
   because the expensive calculations depend on the live page DOM, computed
   style, geometry, XPath resolution, and containment checks. The service
   worker has no `document`, no layout tree, and no `getBoundingClientRect`.
   An offscreen document would still not see the target page DOM. A true worker
   offload is only feasible if the page first serializes a DOM snapshot or a
   compact branch model for the worker, then validates/applies the result back
   on the live page. That is a larger architectural step and should not be the
   first move.
28. Recommended responsiveness plan for marking toggles:
   keep the current early acknowledgement, but split the expensive correctness
   pass into an asynchronous page-side reconciliation pipeline. Phase A:
   preserve a cheap optimistic UI update on the main thread that only records
   the explicit user intent, updates the transient acknowledgement/highlight,
   and stores a pending-operation token without immediately running
   `syncPageMarkings(...)`. Phase B: queue a cancellable reconciliation job
   with generation IDs so rapid repeated toggles coalesce and stale jobs are
   discarded. Run that job on the page side in chunked slices using
   `requestIdleCallback` with `requestAnimationFrame` / extension-timer
   fallback so the event loop can repaint between slices. Phase C: apply the
   final reconciled entry atomically, redraw the explicit layers from the
   reconciled data, and then schedule the already-existing invalidating full
   render path.
29. Recommended scope reduction inside the async reconciliation job:
   do not start with full worker serialization. First reduce the work that the
   job performs per toggle. The current `syncPageMarkingsInner(...)` always
   calls `collectToggleableTargets(...)`, which walks `document.body` and
   recomputes self-markability/default posture globally. For ordinary leaf
   explicit toggles, introduce a subtree-and-ancestor scoped reconciliation
   mode: recompute only the toggled target, its ancestor chain, nested explicit
   descendants, and the affected default-toggleable descendants/ancestors that
   can change precedence. Fall back to the current full-page reconciliation for
   structural cases that are unsafe to localize, such as broad parent
   exclusions, target changes that cross saved-explicit boundaries, DOM
   instability, or cache invalidation caused by visibility/layout churn.
30. Recommended phased implementation order for the responsiveness work:
   1. Add precise toggle-stage diagnostics around
      `toggleExplicitExclude` / `toggleExplicitInclude`,
      `refreshExplicitMarkingOverlay`, `syncPageMarkingsInner`, and
      `collectToggleableTargets` so live profiling can distinguish target
      resolution, entry mutation, subtree/default reconciliation, and redraw.
   2. Introduce a page-side pending-toggle reconcile queue with operation IDs,
      coalescing, cancellation, and a visible "pending" state for the toggled
      node/branch.
   3. Split `syncPageMarkingsInner(...)` into reusable phases so the queue can
      run cheap explicit-row mutation synchronously and defer expensive default
      posture recomputation into chunked slices.
   4. Implement subtree-scoped reconciliation for leaf explicit toggles and
      keep full-page fallback for structural/broad toggles until parity is
      proven.
   5. Only after that stabilization, evaluate whether a serialized branch model
      can be shipped to a dedicated worker for the pure-data parts of the
      branch/default merge, with the page retaining the final DOM validation and
      overlay application.
31. Validation contract for the responsiveness work:
   each phase must preserve the locked marking rules in
   `MARKING_AND_HIGHLIGHTING_LOGIC.md`, pass the focused marking guard suite,
   and add at least one live headful pressure test that exercises rapid
   include/exclude toggles on a deep page while the browser remains responsive.
   When async reconciliation is introduced, tests must also prove operation
   coalescing, stale-job cancellation, and that the final committed entry is
   identical to the current synchronous result for the same DOM state.
32. Marking-toggle responsiveness slice 1 completed:
   the click handler now keeps the immediate interaction acknowledgement on the
   synchronous path but defers the heavy explicit toggle mutation behind a
   queued page-side task boundary. `handleToggleEvent(...)` no longer runs
   `toggleExplicitExclude(...)` / `toggleExplicitInclude(...)` inline after the
   acknowledgement; it enqueues the work so the browser gets a chance to paint
   before the expensive branch/default reconciliation starts. This is not the
   full async chunked reconciliation design yet; `syncPageMarkings(...)` is
   still monolithic once the queued task begins. The landed value is a safer
   first seam for later chunking/cancellation work and an immediate best-effort
   reduction in perceived click jank.
33. Marking-toggle responsiveness slice 2 completed:
   explicit-toggle reconciliation is now generation-scoped, cancellable, and
   chunked across extension-owned async yields instead of forcing the whole
   `syncPageMarkings(...)` pass through one uninterrupted task. The landed
   seam adds `syncPageMarkingsAsync(...)`, `collectToggleableTargetsAsync(...)`,
   `appendSyncedCandidateItemsAsync(...)`, and
   `refreshExplicitMarkingOverlayAsync(...)`, with
   `scheduleAsyncExplicitToggleReconcile(...)` discarding stale jobs when rapid
   repeated toggles supersede older work. Focused tests lock the async path,
   stale-generation cancellation, and deferred toggle mutation contract.
34. Live Bonliva pressure result and next hotspot:
   on `https://www.bonliva.no/vikar/oppvekst/barnehage`, a clean headful
   Playwright run with the unpacked extension enabled confirmed that the
   overlay activates, the immediate toggle acknowledgement appears, and page
   `requestAnimationFrame` ticks continue to advance during rapid Shift-parent
   toggle bursts on the hero text branch. Two consecutive parent toggles
   completed with ticks still advancing during the post-click sample window,
   but a later broad-branch toggle still stretched to roughly `1.7s`. That
   means the new async queue/yield seam improves paintability and prevents the
   worst all-or-nothing freeze, but some structural toggles still spend too
   long in one reconcile window. The next phase should reduce the remaining
   broad-toggle cost by scoping candidate collection/reprocessing to the
   affected subtree and ancestor/default boundary graph where correctness
   allows, while preserving the full-page fallback for unsafe structural cases.
35. Yield-cadence follow-up completed:
   the cooperative reconcile slice length was tightened from `140` processed
   nodes/items per yield to `40`, then revalidated with the focused guard
   suite, full `npm test`, and the same headful Bonliva Shift-parent burst.
   The live burst still showed page paints advancing during reconciliation and
   shaved the slow broad-toggle sample from roughly `1.68s` to `1.57s`, which
   confirms the current bottleneck is no longer just missing yields. Further
   responsiveness gains now depend more on reducing how much of the page gets
   reconsidered for broad parent toggles than on slicing the same full-page
   workload into even smaller chunks.
36. Traversal-state optimization completed:
   the next broad-toggle bottleneck was not the async queue itself but the
   repeated ancestor coverage checks inside the main DOM walks. The toggleable
   target collection and silent-whitespace candidate scans now propagate
   excluded-subtree state through their traversal stacks instead of repeatedly
   calling `contains(...)` against every excluded ancestor/result boundary for
   each visited node. Focused guards and full suite validation stayed green,
   and the same clean headful Bonliva Shift-parent burst dropped from the prior
   `~1.57s` worst-case sample to roughly `0.43s`, while page
   `requestAnimationFrame` ticks continued advancing during the burst. This
   substantially reduces the need for an immediate risky subtree-only reconcile
   path; the next work can focus on remaining structural hotspots with better
   live instrumentation instead of forcing premature partial-scope semantics.
37. Stage-level toggle instrumentation completed:
   the reconcile path now logs candidate collection, candidate merge,
   silent-whitespace collection, and silent-whitespace merge timing in both the
   synchronous and async sync paths when `unfluffify:toggle-perf=1` is active.
   A headful Bonliva run with perf enabled confirmed that after the traversal
   optimization the remaining parent-toggle cost is dominated by candidate
   collection (`~35-50ms` on the tested branch) and silent-whitespace
   collection (`~22-27ms`), while candidate merge (`~1.7ms`), silent-whitespace
   merge (`~0-0.1ms`), and overlay draw (`~2-3ms`) are comparatively small.
   That means the next real optimization target is narrowing or caching the two
   collection passes, not the later merge/draw phases.
38. Single-pass reconcile scan completed:
   the next safe reduction removed one full-document walk from each reconcile by
   folding raw silent-whitespace candidate discovery into the main toggleable
   target traversal, while keeping the existing exclusion/include filtering
   semantics as a separate post-scan step. Focused guards and the full suite
   stayed green, and the headful Bonliva run showed silent-whitespace
   collection drop from the prior `~22-27ms` range to roughly `~0.2-0.5ms`.
   On the same live toggle path, post-mutation `sync.total` settled around
   `~58-79ms` with candidate collection at `~55-76ms`, which confirms the next
   meaningful hotspot is the main candidate scan plus the pre-scan explicit
   XPath/ancestor setup rather than the secondary whitespace pass.
39. Reconcile setup timing split completed:
   the next investigation consolidated previous-item XPath preparation into one
   cached pass and split that work into a dedicated `sync.entry-setup` perf
   stage so it is no longer conflated with the rest of reconcile timing. A
   headful Bonliva run showed that setup block at only `~0-0.1ms` on the live
   toggle path with `xpathLookupCount: 0` for the tested branch target, while
   candidate collection still dominated at roughly `~60-88ms`. That rules out
   pre-scan entry metadata as the remaining UI-freeze cause on this page and
   narrows the next optimization target to the main candidate traversal and, in
   parallel, the post-sync render rebuild cost.
40. Candidate predicate split completed:
   the next safe diagnostics phase split candidate collection into predicate
   timing so the remaining reconcile hotspot is no longer treated as a black
   box. A headful Bonliva run showed roughly `~1.4k` nodes evaluated during the
   scan, with auto-default evaluation itself costing only about `~3-4.5ms` for
   `~1.4k` checks on the tested page. That means the overwhelming majority of
   the `~70-100ms` candidate-collection budget is not default-boundary
   detection, but the self-markable path (`isSelfMarkableWithoutParentMode(...)`
   and the descendant/visibility/paint checks it triggers). The next phase
   should therefore target the self-markable branch specifically rather than
   spending more time on `matchesAutoToggleableDefaultExcluded(...)`.
41. Self-markable branch split completed:
   the next diagnostics step broke the self-markable path into its major
   subchecks during the live Bonliva reconcile run. On the tested page, the
   dominant contributor inside candidate evaluation was `hasTextualDescendant`
   at roughly `~17-32ms` across the observed runs, followed by
   `isTextualContainer` at about `~9-17ms`, while paint reachability was
   materially smaller at roughly `~3-10ms` and immutable-descendant checks were
   effectively `0ms` on the sampled path. That makes descendant-text discovery
   the clearest next optimization target for toggle responsiveness, with text
   container evaluation as the secondary follow-up.
42. AI payload / response translation investigation completed:
   the current payload-generation path for AI submission is not derived from a
   single canonical marking collection. In [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js),
   `collectAiSubmissionXpathsForCurrentPage(...)` recomputes submission rows by
   walking the whole DOM, converting each live node to snapshot XPath, then
   classifying it with `resolveAiSubmissionRowState(...)`. That path can diverge
   from the already-synced marking entry and from the visible overlay state. In
   particular, a broad ancestor such as an `article` can be marked as
   `markableTextual` even when the user-visible intent is carried by descendants,
   and if `isVisibleForSubmission(...)` returns false for that ancestor the
   submission collector will emit `{ xpath, excluded: true }` for the ancestor
   even without an explicit user exclusion row. The supplied repro payload at
   `/home/rojan/Desktop/inspection/payload.json` for
   `https://www.bonliva.no/artikler/barnehagevikar-lonn` contains a single page
   with `192` rendered XPath rows, `130` of which are submitted as excluded, and
   the supplied `/home/rojan/Desktop/inspection/response.json` contains `27`
   exclusion selectors with no inclusion selectors. That matches the observed
   symptom where article-body structure is being sent to the AI server as
   excluded even though the intended content paragraphs remain submitted as
   included.
43. Visibility-policy drift identified:
   marking/silent-highlighting and AI submission do not use the same visibility
   contract. The submission collector in [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   relies on `core.isVisibleForSubmission(...)`, while marking and silent
   highlighting rely on `core.isVisible(...)`, `getVisibleRects(...)`, and
   `shouldRetainIncludedSource(...)`. The collector for silent highlighting also
   retains sources using `visibleToUser: isVisible(el) || !isDefinitelyHiddenSubtreeElement(el)`,
   which is more permissive than AI submission. This split makes partially
   visible or edge-clipped elements especially fragile: they can remain visible
   enough to the user for markings/highlights while still being classified as
   invisible in AI submission, which then flips them into excluded rows. The
   repro payload is consistent with that drift: content descendants under the
   article remain submitted as included while nearby broad structural rows are
   simultaneously emitted as excluded.
44. Snapshot-XPath translation drift identified:
   `collectAiSubmissionXpathsForCurrentPage(...)` remaps explicit rows and
   include rows through `getCurrentPageSnapshotXPath(element)` and separately
   remaps every traversed live DOM node the same way. Because this happens on a
   node-by-node traversal after snapshot stripping, the submission rows can
   represent a different ancestor/descendant shape than the synced marking entry
   that users actually edited. That creates room for ancestor promotion or
   ancestor-only excluded rows that do not correspond to an on-page explicit
   marking, especially when stripped nodes or hidden descendants change the
   apparent shallowest surviving snapshot ancestor.
45. Robust fix plan for payload/response correctness:
   1. Introduce a single shared visibility policy for marking, silent
      highlighting, and AI submission that explicitly treats partially visible
      elements as visible whenever any renderable client rect intersects the
      relevant viewport/document visual area. Use that shared predicate instead
      of letting `isVisible(...)`, `isVisibleForSubmission(...)`, and the
      `shouldRetainIncludedSource(...)` caller drift independently.
   2. Stop recomputing AI submission rows from an unconstrained full DOM walk as
      the primary source of truth. Build AI submission rows from the synced page
      entry plus a canonical resolved collection of included/excluded elements
      that already matches the marking/highlighting contract, then translate
      that resolved collection to snapshot XPath once. The AI payload should be
      a projection of the synced marking model, not an alternate classifier.
   3. Add an explicit ancestor/descendant guard in AI submission so a broad
      ancestor cannot be emitted as `excluded: true` unless it is actually
      explicit/generated in the synced marking entry or is the canonical
      excluded representative after resolved collection collapse. A merely
      `markableTextual && invisible` ancestor must not be auto-promoted over the
      user-visible descendant marking shape.
   4. Split the snapshot remapping into two audited stages:
      live resolved elements -> canonical live XPath rows -> snapshot XPath rows.
      Add validation that the remapped snapshot rows still preserve include /
      exclude precedence and do not introduce new excluded ancestors that were
      absent from the canonical live rows.
   5. Add focused regression fixtures for:
      partially visible content blocks,
      broad textual ancestors with visible descendants,
      article/body-like wrappers where a descendant is the intended content
      carrier,
      snapshot stripping that removes intermediate wrappers,
      and payload/response round-trips using the Bonliva article repro where
      the AI response would otherwise exclude the whole article body.
46. Recommended execution order:
   land the submission-correctness work before or alongside any deeper
   descendant-text optimization in the candidate scan. The next implementation
   slice should therefore start with the shared partial-visibility contract and
   the canonical AI submission row builder, then re-run the payload/response
   repro against the provided case before continuing with the remaining
   responsiveness work.
47. Silent-highlighting responsiveness investigation completed:
   the current silent-highlighting pipeline still performs several large
   synchronous DOM/data passes on the content-script UI thread. The main hot
   path starts in [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   `refreshSilentHighlightings()`, which loads configs, derives the effective
   selector set, runs `collectIncludedNodesFromSelectorSet(...)`, expands
   sources through `buildSilentHighlightRenderableCollections(...)`, and then
   rebuilds overlay DOM via `renderSilentHighlightOverlay(...)` in one turn.
   This is structurally similar to the marking freeze that was already improved:
   there is no cancellable generation boundary between source collection,
   fallback target expansion, rect collection, and DOM writes.
48. Silent-highlighting heavy-duty hotspots identified:
   1. `collectIncludedNodesFromSelectorSet(...)` in
      [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
      does a full-page selector + DOM traversal, repeatedly evaluating
      `core.isVisible(...)`, `hasTextualDescendantForInclusion(...)`,
      `hasRenderableTextOutsideExcludedNature(...)`, and multiple collapse
      passes before producing the three source collections.
   2. `buildSilentHighlightRenderableCollections(...)` immediately performs a
      second expansion pass over those sources, including
      `collectSilentHighlightRenderTargets(...)` descendant walks and
      per-node XPath map construction.
   3. `renderSilentHighlightOverlay(...)` then collects rects for every
      renderable node and writes all overlay boxes in the same task, so large
      selector/highlight pages can block paint during refresh.
   4. `mutationTargetTouchesSilentCollections(...)` linearly scans every
      tracked source/render node for each relevant mutation, which can make the
      observer path expensive on animation-heavy or CMS-driven pages.
   5. The settled reposition loop (`buildSilentHighlightPositionSignature(...)`
      plus `runSilentHighlightSettledRepositionSample()`) repeatedly rescans
      render targets and rects during layout shifts and scroll settling.
49. Silent-highlighting feasibility boundary clarified:
   most of this workload is live-DOM- and layout-dependent, so it is not a
   direct MV3 background-worker offload candidate. The correct analogue to the
   marking responsiveness work is page-side async chunking, generation-based
   cancellation, and narrower recompute scope. Background/session-storage
   staging remains useful only for non-DOM payload transport, not for the
   selector/highlight collection itself.
50. Robust fix plan for silent-highlighting responsiveness:
   1. Split `refreshSilentHighlightings()` into cancellable phases with a
      monotonic generation id:
      config/selector snapshot -> source collection -> render-target expansion
      -> overlay draw/annotation apply.
      Abort stale generations before the next heavy phase starts.
   2. Add an immediate non-blocking UI path similar to marking:
      keep the prior silent overlay visible or hidden-in-place, set a pending
      generation flag, yield with `requestAnimationFrame` / task breaks, and
      only swap in the new collections after the final generation still matches.
   3. Cache render-target expansion per source node for the current DOM epoch so
      reposition and settled-layout sampling can reuse stable render targets
      instead of repeatedly calling `collectSilentHighlightRenderTargets(...)`.
   4. Replace the linear `mutationTargetTouchesSilentCollections(...)` scan with
      a tracked-node index keyed by current source/render nodes so attribute
      mutations can cheaply decide between reposition-only and full refresh.
   5. Keep the existing full recompute for selector-set or structural DOM
      changes, but add narrower paths for:
      position-only tracked-node mutations,
      layout-shift settle redraws,
      and annotation-only reapplications.
   6. If live profiling still shows source collection dominating after
      chunking/cancellation, reuse the marking-side candidate-scan learnings:
      instrument descendant-text checks, avoid redundant collapse passes, and
      memoize visibility/textual-shape decisions per refresh generation.
50a. Phase A AI submission visibility contract completed:
   `isVisibleForSubmission(...)` in [content/core.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/core.js)
   now falls back to a partial-visibility bridge when the strict
   `isActuallyVisibleInDocument(...)` path rejects an element. The bridge,
   `anyClientRectIntersectsSubmissionArea(...)`, accepts any element whose
   client-rect line boxes intersect the submission visual area (viewport width
   x document height for static content, viewport bounds for fixed-position
   content), matching the silent-highlight `shouldRetainIncludedSource(...)`
   contract that already retains non-definitively-hidden sources by client-rect
   reachability. This prevents wrapper/inline rows whose primary bounding rect
   anchors out of bounds from being auto-promoted to `excluded: true` while
   their visible content is still being submitted as included. Focused
   visibility/silent/submission tests (`151/151`) and full `npm test`
   (`443/443`) stayed green.
50a-live. Phase A+B live smoke on Bonliva article completed:
   Headful repo-local `playwright-local` MCP smoke against
   `https://www.bonliva.no/artikler/barnehagevikar-lonn` confirmed the deployed
   `content/core.js` carries the Phase A `anyClientRectIntersectsSubmissionArea(...)`
   bridge in `isVisibleForSubmission(...)` and the deployed
   `content-main.js` carries the Phase B
   `hasVisibleMarkableTextualSubmissionDescendant(...)` guard wired at the
   collector's implicit-excluded-ancestor branch. Driving a real
   `capturePageSnapshot` (persist: true) through `chrome.tabs.sendMessage`
   from the popup context successfully ran `syncPageMarkings(...)` and
   `collectAiSubmissionXpathsForCurrentPage(...)` end-to-end with `ok: true`
   and zero console errors. The captured `entry.submissionXpaths` shape on
   that article changed from the handoff baseline of `192` rows / `130`
   excluded to `190` rows / `122` excluded / `68` included, i.e. eight fewer
   broad implicit-ancestor over-exclusions and six more visible content rows
   submitted as included. The deployed `isVisibleForSubmission(...)`
   predicate also runs cleanly across the full `1202`-element live DOM
   sample (`354` visible, `127` visible+markable, `217`
   markable-but-invisible all in genuinely hidden subtrees so the Phase B
   guard correctly no-ops for them). Phase A and Phase B are confirmed live.
50b. Phase B AI submission ancestor guard completed:
   `collectAiSubmissionXpathsForCurrentPage(...)` in [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now omits an implicit `markableTextual && !visibleToUser` ancestor row when
   a visible markable-textual descendant inside the same branch already carries
   the content. The guard uses `hasVisibleMarkableTextualSubmissionDescendant(...)`
   to early-exit on the first visible markable descendant and skips immutable
   subtrees. Explicit user exclusions, rows inside an excluded ancestor, and
   included rows are unaffected. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`449/449`) stayed
   green.
50c. Phase A+B multi-site live smoke with DOM verification completed:
   Standalone `scripts/smoke-ai-submission.mjs` (driven through `xvfb-run` with
   the persistent `.mcp-browser-profile` and the loaded unpacked extension)
   activates content-main on each target tab, drives `capturePageSnapshot`
   (persist: true) with an explicit derived `baseUrl`, reads the persisted
   `submissionXpaths` from the extension's IndexedDB (`unfluffify` db, `kv`
   store, `configs` key) via the service worker, and reconciles each row
   against the live DOM after temporarily detaching extension-owned nodes
   (`[data-uf-extension-ui]`, `#unfluffify-page-motion-freeze-script`) so XPath
   indices match the sanitized view used at capture time. Results:
   - `https://www.bonliva.no/artikler/barnehagevikar-lonn`: 238 rows, 117
     included / 121 excluded. 117/117 included rows resolve to visibly-painted
     elements with text. Only 2 excluded rows are visible standalone — both
     are default-excluded structural tags (`<nav>`, `<button>`).
   - `https://prowork.se/`: 302 rows, 76 included / 226 excluded. 76/76
     included rows resolve to visible text. Visible-but-excluded rows split
     into 15 default-excluded structural ancestors (HEADER/FOOTER/BUTTON) and
     47 collapsed-FAQ H4/P/H5/H3/STRONG content (Webflow accordion content
     present in DOM but not painted in the rendered view — confirmed by full
     page screenshot showing only FAQ section headers, not the Q&A bodies).
   - `https://www.vitec-pyramid.com/`: 70 rows, 57 included / 13 excluded.
     57/57 included rows visible. Only 2 excluded rows are visible standalone —
     `<header>` and `<footer>` defaults.
   No included row resolves to a hidden element on any site (Phase A's
   partial-visibility bridge is not over-excluding visible content), and no
   visible-excluded row breaks the default-exclusion taxonomy or the Phase B
   ancestor guard. Full `npm test` (`449/449`) stayed green alongside the live
   runs.
50d. Silent-highlight refresh generation token completed:
   `refreshSilentHighlightings()` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now captures a `refreshGeneration` token from
   `silentHighlightingRefreshGeneration` at entry and checks after each `await`
   (`config.getConfigs()` and the conditional `config.saveConfigs(configs)`)
   that the captured token still matches the live counter; if a newer call has
   bumped the counter, the older call returns before touching observer state,
   overlay rendering, or `lastSilentHighlightingRenderKey`. This protects
   against stale older refreshes overwriting newer state when call sites fire
   `refreshSilentHighlightings().then()` overlapping with another refresh.
   Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`450/450`)
   stayed green.
50e. Silent-highlight reposition render-target caching completed:
   `buildSilentHighlightPositionSignature(...)` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now consults a module-scoped `silentHighlightRenderTargetCache` (Map keyed
   by source node) before calling `collectSilentHighlightRenderTargets(...)`,
   so each settle sample reuses the BFS render-target walk computed on the
   first sample for that source node. The cache is reset at both points where
   `silentHighlightCollections` is replaced — the overlay tear-down path
   (clear) and the overlay render path (rebuild) — so a fresh marking pass
   always recomputes targets. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`499/499`)
   stayed green.
50f. Silent-highlight mutation-target index completed:
   `mutationTargetTouchesSilentCollections(...)` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   no longer rebuilds a spread array of every tracked collection on each
   mutation. Instead a module-scoped `silentHighlightTrackedNodeIndex` is
   lazily built once per collections rebuild and exposes a `tracked` Set plus
   an `ancestors` Set (every ancestor of every tracked node). The predicate
   answers each mutation in O(target-depth) Set lookups: direct hit, ancestor
   hit, or walk parent chain for a tracked container. The index is reset at
   both `silentHighlightCollections` rebuild sites alongside the render-target
   cache. The existing source-shape test was updated to assert on the new
   `buildSilentHighlightTrackedNodeIndex` helper; a new guard test in
   `tests/content-activation-order.test.js` locks the Set-lookup structure
   and forbids the old spread/contains scan. Full `npm test` (`451/451`)
   stayed green.
51. Silent-highlighting execution order:
   after the AI payload correctness slice, the next responsiveness branch should
   start with generation/cancellation boundaries around
   `refreshSilentHighlightings()`, then land render-target caching for
   reposition/settle, then optimize mutation-target indexing before attempting
   deeper selector/content-collection micro-optimizations.
52. Silent-highlighting validation expectations:
   each phase should run the focused silent/visibility suite
   (`tests/core-visibility.test.js`, `tests/core-motion-pause.test.js`,
   `tests/core-scheduling.test.js`, `tests/selector-suppression.test.js`,
   `tests/silent-highlight-annotations.test.js`,
   `tests/silent-highlight-rules.test.js`, `tests/submission-rules.test.js`),
   full `npm test`, and a headful live smoke on at least the Bonliva property
   page plus a selector-heavy page while watching mutation/scroll responsiveness
   and overlay correctness.

50g. Silent-highlight overlay-write rAF yield completed:
   `refreshSilentHighlightings()` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now packages the overlay DOM write into a local `applyOverlayUpdate`
   closure and awaits a `requestAnimationFrame` round trip before invoking it
   on the overlay-changing path. The previous overlay stays in place during
   the yield (no immediate clear), so the page can flush queued paint/layout
   work between source collection and the next DOM mutation; the closure
   re-checks the generation token before mutating overlay state so a newer
   refresh that bumped the token mid-yield wins. The no-op fast path
   (`!shouldRenderOverlay && !renderChanged`) invokes the closure synchronously
   to avoid an unnecessary frame delay. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`461/461`)
   stayed green and a repo-local Bonliva + prowork live smoke confirmed
   identical AI-submission verdicts and zero console errors.
50h. Silent-highlight observer style-mutation narrowing completed:
   `SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now includes `"style"` alongside `hidden`/`aria-hidden`/`open`. The mutation
   observer therefore routes inline-style mutations through the cheap
   `scheduleSilentHighlightReposition({ waitForSettle: true })` path instead of
   the full-refresh stampede, since inline style affects rects but not
   selector matches. The relevant-mutation attribute filter still lists
   `"style"` so the observer continues to receive these mutations. Source-level
   guard test added in `tests/content-activation-order.test.js`; full
   `npm test` (`454/454`) stayed green and a repo-local Bonliva + prowork live
   smoke confirmed identical AI-submission verdicts and zero console errors.
50i. Silent-highlight observer class-mutation narrowing completed:
   The mutation observer in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now branches on `class` attribute mutations: when the mutation target
   touches the tracked subtree (direct hit, ancestor of tracked, or descendant
   of tracked per `mutationTargetTouchesSilentCollections(...)`), it still
   triggers a full refresh because the class flip can change selector-match
   membership. When the target does not touch tracked, the mutation is demoted
   to a reposition refresh instead of a full refresh — the reposition path
   picks up any layout shift the far-away class change cascades to tracked
   overlays without rerunning selector matching. This dramatically reduces
   full-refresh frequency on dynamic pages that toggle classes for animations
   and interaction state. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`456/456`)
   stayed green and a repo-local Bonliva + prowork live smoke confirmed
   identical AI-submission verdicts and zero console errors.
50j. Silent-highlight source-collection task break completed:
   `refreshSilentHighlightings()` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now `await`s a `setTimeout(0)` between the
   `collectIncludedNodesFromSelectorSet(...)` source-set computation and the
   subsequent `buildSilentHighlightRenderableCollections(...)` renderable
   expansion, with a generation-token re-check after the task break. On long
   selector-heavy pages this gives the event loop a chance to handle other
   work between two heavy synchronous passes; on shorter pages the cost is a
   single macrotask hop. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`487/487`)
   stayed green and a repo-local Bonliva + prowork live smoke confirmed
   identical AI-submission verdicts and zero console errors.
50k. Silent-highlight visibility memoization completed:
   `collectIncludedNodesFromSelectorSet(...)` in
   [content-main.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content-main.js)
   now declares a local `WeakMap`-backed `memoIsVisible(...)` wrapper that
   caches `core.isVisible(...)` results for the duration of a single
   collection pass. The `isIncludedNodeAvailableForUser(...)` helper, which
   runs once in the explicit-include filter and again in the final include
   filter (and from `shouldRetainIncludedSource(...)`), now consults the memo
   so the same node is not visibility-tested multiple times per pass. The
   memo is scoped to the call closure, so it is discarded as soon as the
   function returns — no staleness window. Source-level guard test added in
   `tests/content-activation-order.test.js`; full `npm test` (`487/487`)
   stayed green and the same Bonliva + prowork live smoke remained clean.
50l. Silent-highlight annotation-only reapply (sub-5 deeper) deferred:
   the "apply selector titles/badges to an already-rendered overlay without
   rebuilding source collections" path has no current call site that would
   trigger it independently of a full refresh — settings/selector changes
   already flow through `refreshSilentHighlightings()` which short-circuits
   when the render key is unchanged. Implementing a standalone annotation
   reapply entry point ahead of an actual caller would be speculative
   architecture; revisit once a concrete trigger (e.g. a selector-name-only
   settings change path) is identified.
53. Silent-highlight responsiveness rollup (status against item 50):
   - **50 sub-1 (cancellable phases)**: partially landed as item 50d — a
     generation token bails on stale calls after each `await`, but the function
     body is not yet split into the four cancellable phases
     (config/selector snapshot → source collection → render-target expansion →
     overlay draw) recommended by item 50.
   - **50 sub-2 (non-blocking UI / rAF yields, keep prior overlay)**:
     landed as items 50g (rAF yield before overlay DOM write, previous
     overlay stays in place during the yield) and 50j (setTimeout(0) task
     break between source-set collection and renderable-collections build,
     with a generation re-check). Deeper subdivision of
     `collectIncludedNodesFromSelectorSet` itself into multiple chunked
     phases remains optional and gated on live profiling.
   - **50 sub-3 (render-target caching)**: landed as item 50e.
   - **50 sub-4 (tracked-node mutation index)**: landed as item 50f.
   - **50 sub-5 (narrower mutation paths — position-only vs full vs
     annotation-only)**: position-only narrowing landed as items 50h
     (inline-style → reposition) and 50i (class on non-tracked-touching →
     reposition; class on tracked-touching stays full-refresh). The
     annotation-only reapply path is deferred (item 50l) until a concrete
     standalone caller exists.
   - **50 sub-6 (per-generation memoization of visibility/textual checks)**:
     landed as item 50k for the direct `core.isVisible(...)` call inside
     `collectIncludedNodesFromSelectorSet(...)`. Plumbing the same memo
     through the deeper helper graph (e.g.
     `collectImplicitIncludedNodesOutsideExplicit(...)`,
     `hasRenderableTextForHighlight(...)`) remains optional and gated on
     live profiling.
   Item 52 live-smoke obligation: items 50d/50e/50f have full `npm test` and
   focused-suite coverage. A headful repo-local smoke through
   `scripts/smoke-ai-submission.mjs` against
   `https://www.bonliva.no/artikler/barnehagevikar-lonn` and
   `https://prowork.se/` after slices 50d/50e/50f ran cleanly: zero page
   console errors, content-loader injection marker present, snapshot persisted,
   and submission-xpath verdicts identical to the pre-Phase 51 baseline
   (bonliva: 117/117 included visible, 2 default-excluded visible; prowork:
   76/76 included visible, 15 default-excluded structural + 47 collapsed-FAQ
   visible-excluded). The smoke does not actively exercise the
   `refreshSilentHighlightings()` reposition/settle loop or mutation observer,
   so a fully interactive live smoke that watches mutation/scroll
   responsiveness on a selector-heavy page remains a follow-up validation step
   for the deeper sub-2/sub-5/sub-6 work.

## Marking Reload Handoff

Phase 0 Q&A captured (2026-06-05):

1. **Reload scope** — Marking does NOT auto-restore across reload/navigation.
   Instead, the navigation/refresh path shows an "unsaved changes will be
   lost" confirmation when there is unsaved work; on rejection the
   navigation/refresh is blocked, on acceptance the session resets and
   marking is disabled on every page including the current one.
2. **Offscreen role** — Keep remote-support-only. Heavy payloads stay in
   IndexedDB with lightweight keys passed by message.
3. **Heavy payload handoff** — IndexedDB key + read-in-owner, with a
   cleanup mechanism (TTL or purge-on-consume) to bound DB growth.
4. **Contract changes** — None during the reload work. The locked marking
   contract is preserved exactly.
5. **Dirty signal definition** — Backend-saved markings are NOT the
   baseline for "dirty"; they are only used for AI payload construction
   and the current page's fresh data + latest AI CSS selectors for Lynx
   submission. The dirty span starts right after the initial fresh
   marking calculation (defaults + AI CSS selectors influence) and ends
   when a successful backend save lands (after the AI run completes).
6. **Guard owner** — A content-side `beforeunload` listener on each
   enabled page, returning a non-empty string when the dirty signal fires.

Revised phase shape:

- Phase 1 — Navigation/reload guard UX: beforeunload-based confirmation
  when there is unsaved work; block navigation on rejection.
- Phase 2 — Editor-tab marking lifecycle + property-lock transitions on
  navigation. Spec (hardened in Phase 0 follow-up Q&A):
  - **Scope of "every page"**: the editor tab's own page-loads (current
    URL, reload, next URL) — NOT other tabs in any browser.
  - **Property lock invariant** (existing): exactly one editor tab per
    property across all tabs/browsers/users. Other same-property tabs are
    locked read-only. Tabs on other properties are independent.
  - **Auto-enable**: marking NEVER auto-enables on any page-load of the
    editor tab. The user must explicitly re-enable marking on each new
    page-load (even a same-URL reload).
  - **Lock lifecycle on navigation**:
    - Same property, candidate → candidate: lock stays with this tab. No
      warning. The editor of one candidate is very likely the editor of
      the others.
    - Same property, candidate → non-candidate: lock stays with this tab
      but a countdown UI (60–120s) warns the user they will lose the
      editor role if they remain off-candidate when the timer expires.
    - Cross-property: lock releases with a short cool-off (~30s) so a
      mistaken navigation can be undone by navigating back into the
      original property before the cool-off completes.
    - Tab close / crash: lock releases immediately (existing behavior).
  - **Inactivity**: the lock is held as long as the user interacts with
    the page or the extension. After a 30-minute inactivity window the
    lock releases. Activity = any input on the page or extension surface
    (mouse move/click/keyboard/scroll on the page, plus any popup or
    sidebar interaction). Background tabs naturally idle out.
  - **Countdown UI**: both an in-page banner on the editor tab (similar
    to the existing property-lock disconnected banner) AND a mirror in
    the popup when it is open, so the user cannot miss the warning.
  - **Editor = mobile-only**: the editor tab always runs in mobile
    simulation while marking mode is active. The previous
    mobile-simulation checkbox + label inside the marking-mode section
    is removed; mobile sim is forced for every editor scenario. If the
    user tries to disable mobile sim by any path (close affordance,
    DevTools device-mode toggle), mobile sim is reapplied unless desktop
    preview (see below) is explicitly enabled.
  - **Desktop preview section** (new popup UI):
    - Lives as a separate section directly on the popup interface, below
      every other section, independent of the popup view / current mode.
    - Only rendered when AI CSS selectors have been calculated for the
      property.
    - Contains a `Preview in desktop mode` checkbox plus an inline
      notice explaining that marking mode is disabled while desktop
      preview is on.
    - Enabling the checkbox switches the page from forced mobile sim to
      desktop sim AND disables the marking-mode toggle. Disabling the
      checkbox returns the page to forced mobile sim and re-enables
      marking-mode entry.
    - Checkbox value persists for the tab lifecycle (survives navigation
      and reload within the same tab; resets when the tab closes).
    - The silent-highlighting matchings list is filtered by current sim
      mode — it shows what is currently visible at the active mobile or
      desktop layout.
    - Styling stays in sync with the rest of the popup sections.
    - DevTools kill switch: clicking the DevTools "stop debugging" /
      device-mode-close path while desktop preview is on disables the
      desktop-preview checkbox and resumes forced mobile sim, so the
      user cannot get stuck in a stale desktop simulation when DevTools
      tears down.
  - **Silent highlighting on non-candidate same-property pages**:
    silent highlighting renders on every page within the configured
    property's base URL, including non-candidate pages, so the user can
    preview how the current AI CSS selectors affect those pages.
    Marking mode remains unavailable on non-candidate pages.
  - **Reset on accepted navigation**: when the editor tab commits a
    navigation/reload (whether unsaved-changes prompt was accepted or
    there was nothing to lose), the marking session resets for the
    editor tab. The new page-load starts with marking off.
- Phase 3 — IDB-key heavy-payload handoff plus TTL/consume-purge cleanup;
  add source guards against accidental large-message paths.

Phase 3 completed:
   The IDB-key pattern was already in place for AI run payload staging and
   all config sync payloads (background writes to session-storage, returns a
   key, consumer reads and deletes in a finally block). The missing piece was
   orphan-key cleanup for aborted flows. Added `sweepStaleTransferPayloads()`
   in [background.js](/home/rojan/Documents/Git/GitHub/Unfluffify/background.js)
   with a shared `TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-"` constant and
   a `TRANSFER_PAYLOAD_MAX_AGE_MS = 5 * 60_000` TTL. The function scans all
   session-storage keys with that prefix, parses the embedded timestamp, and
   removes keys older than 5 minutes. It is called once on service-worker
   start (`sweepStaleTransferPayloads().then()` at module scope) so orphaned
   keys from crashed/aborted AI runs and config syncs are cleaned up on the
   next wake-up. Both the background and popup key builders use the same
   prefix, so the sweep covers popup-originated keys too. Guard test added in
   `tests/marking-no-auto-restore.test.js`; full `npm test` (483/483) green.
- Phase 4 — AI lifecycle: only touch if Phase 2/3 expose stale stored
  snapshots, submissionXpaths, raw backfills, or compute-lock state.

Phase 2 slice 1 completed:
   Background-side auto-restore of marking across navigation/reload is
   retired. `disableExtensionOnTopLevelNavigation(...)` in
   [background.js](/home/rojan/Documents/Git/GitHub/Unfluffify/background.js)
   now calls `clearReloadRestoreTabState(tabId)` followed by
   `utils.disableExtensionForTab(tabId)`, fully tearing down the marking-
   active tab state on every top-level navigation/reload without saving a
   restore-scoped copy. The `setTabState` message handler likewise no
   longer mirrors `enabled: true` into the restore scope; it always clears
   any stale restore entry. `setReloadRestoreTabState(...)` is now a
   declared-but-uncalled helper retained only to keep the diff narrow,
   guarded by a regression test that asserts no remaining callers.
   `disableExtensionForTab(...)` does not touch device emulation, so the
   existing user-controlled device-emulation invariants still hold (test
   `device-emulation-lifecycle.test.js` updated to match the new
   structural shape). Three new guard tests in
   `tests/marking-no-auto-restore.test.js` lock the retired auto-restore
   contract. Full `npm test` (`466/466`) green; live Bonliva smoke clean.

Phase 1 slice 2 completed (verification):
   Reviewed the AI-run completion path against the new baseline-based dirty
   contract. AI run output stores to `config.selectors` (per-baseUrl) and
   influences the per-page draft via the next `syncPageMarkings(...)` pass;
   `setSavedPageEntry(...)` is NOT called during AI completion — only when
   the user explicitly saves to the backend (the popup-side save flow at
   `content-main.js:2745`). Therefore the dirty signal correctly flips to
   `true` when AI run output reshapes the draft, and only resets to `false`
   once the user saves (which goes through `setSavedPageEntry` and refreshes
   the baseline). A regression test in `tests/dirty-baseline.test.js`
   ("AI-run-driven draft changes flip dirty to true until a backend save
   lands") locks this expectation. No production code change required.

Phase 1 slice 1 completed:
   `isPageDraftDirty(...)` in
   [content/core.js](/home/rojan/Documents/Git/GitHub/Unfluffify/content/core.js)
   no longer compares the draft directly against the backend-saved entry.
   Instead it consults a per-page `state.cleanBaselineFingerprintByPageUrl`
   Map: the first dirty check after sync populates the draft snapshots the
   current draft fingerprint as the implicit clean baseline and returns
   `false`; subsequent checks compare the live draft fingerprint against
   the recorded baseline, so user edits and AI-driven changes flip the
   signal to `true` while a freshly-synced never-saved page stays clean.
   `setSavedPageEntry(...)` refreshes the baseline whenever a substantive
   backend-confirmed entry lands, so a completed save resets dirty back to
   `false`. The baseline is cleared in `disable(...)` so the next enable
   re-establishes a fresh baseline. Empty `setSavedPageEntry(null)` /
   reset calls do not erase an established baseline mid session.
   `getEntryFingerprint(...)` results are now joined with `"\n"` (a
   character that cannot appear inside any fingerprint segment) so the
   stored baseline strings stay unambiguous. New behavior test in
   `tests/dirty-baseline.test.js` (6/6); full `npm test` (`490/490`)
   stayed green and a Bonliva live smoke still resolved 117/117 included
   rows visible with zero console errors.

Planning-only handoff prepared for the local Copilot agent:

1. Start with `.copilot/marking-reload-handoff.md`.
2. Do not implement until the Phase 0 Q&A sanity check covers marking rules,
   rendering rules, XPath calculation, and AI payload construction.
3. Prioritize page/tab reload marking-state fixes over AI lifecycle work.
4. Keep the locked marking contract intact unless the user explicitly approves a
   marking-rules contract change.
5. Split implementation into safer commits: reload/restore state, popup
   inspection UI, content rehydration/render readiness, payload ownership, and
   only then any directly necessary AI-adjacent fixes.
6. Consider the existing offscreen document only where it is a better lifecycle
   owner than popup/background, and avoid moving large HTML/server/AI payloads
   through runtime messaging.

## Marking and Silent-Highlight Contract Reconciliation

Completed follow-up from comparing the supplied final
`MARKING_AND_HIGHLIGHTING_LOGIC.md` contract against the current docs and
implementation. This phase reconciled docs/knowledge so marking-mode Preview
Contents remains intentional, kept Send to Lynx silent-highlighting-only, added
source-level guards for the separate marking Preview handler, and locked silent
highlight overlay click pass-through.

1. Treat the supplied final document as the marking/silent-highlighting contract
   baseline, except for explicitly accepted later product decisions. The current
   `MARKING_AND_HIGHLIGHTING_LOGIC.md` already contains the supplied contract,
   but it also includes newer orchestration addenda for Save Session gating,
   popup/content mode reconciliation, background spinner brokerage, and Render
   Mode inspection. In the docs sync phase, reconcile those additions
   deliberately: keep them only if they describe accepted committed behavior and
   belong in this source-of-truth doc; otherwise move them to `.copilot/plan.md`,
   `.copilot/knowledge.md`, `README.md`, or the relevant workflow docs.
2. Preview Contents contract reconciliation completed: preview mode intentionally
   exists in marking mode again. The current marking-mode preview path
   (`nextViewState.markingPreviewVisible`, `markingPreviewDisabled`,
   `handleMarkingPreview`, `onMarkingPreview`, and the `#marking-preview` button
   in `popup/ui.js`) remains in place, with coverage in
   `tests/popup-ai-run-gating.test.js` and `tests/popup-marking-refresh.test.js`.
   `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, and `README.md`
   now distinguish marking Preview Contents from silent Preview Contents. Send
   to Lynx remains silent-mode-only unless the user explicitly approves changing
   that separately.
3. Silent-highlight click pass-through guard completed: `tests/silent-highlight-annotations.test.js`
   now locks `pointer-events: none` on `#unfluffify-silent-highlight-overlay`,
   `.uf-silent-layer`, and `.uf-silent-rect`, while preserving the existing
   title-copy behavior from annotated source nodes.
4. Keep the already-verified contract surfaces unchanged while applying the
   above fixes: toggleable default taxonomy (`BUTTON` toggleable, `LINK`
   omitted), ordinary exclude overlay projection, default-row submission,
   hidden textual submission, silent-highlight `immutable`/`content`/`excluded`
   layers, movement-settle redraws, page-motion pause ownership, Space-held page
   interaction, temporary disabled marking state, and the intentionally restored
   marking-mode Preview Contents path. These are covered by the focused
   marking/silent/submission suites and should not be refactored as part of the
   documentation reconciliation work.
5. Validation for this reconciliation phase passed:
   `node --test tests/popup-ai-run-gating.test.js tests/popup-marking-refresh.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/core-scheduling.test.js tests/submission-rules.test.js`
   passed `104/104`; full `npm test` passed `481/481`; repo-configured
   `playwright-local` MCP validation on `https://seo.se/` passed content
   bootstrap, `background.js` service worker, popup `debugTabId`,
   `resolvePopupTabContext`, `getTabState`, and `getPersistedAiRunRecord`.

## Marking Logic Rewrite

First pass completed:

1. Restore the approved 052c-derived marking semantics for target selection and pure rules.
2. Remove stale default-boundary promotion behavior that turned plain exclude clicks into explicit includes.
3. Refresh marking docs, tests, and knowledge notes to match the restored rule set.
4. Run focused marking/submission/silent-highlight tests, then commit and push.

Post-run pass completed:

1. Re-run the broader suite after the first pass lands.
2. Verify adjacent marking/highlighting coverage still passes after the first-pass commit.
3. Leave unrelated telemetry, property-lock, and theme-color failures for a separate follow-up because they do not block the marking/highlighting checks.

## Marking Contract Lock

Completed:

1. Restore default exclusions to synced marking rows instead of generated visual overlays.
2. Document that the marking rules are locked to the restored contract unless the user explicitly requests a marking-rules contract change.
3. Harden focused tests so they fail if default exclusions regain a dedicated layer, class, render collection, or post-hoc overlay rule.
4. Keep generated default-exclude rows in the ordinary exclude overlay even though they are not `explicit: true`, keep them out of the implicit/default content layer, and keep stale untagged non-default excludes hidden.
5. Keep `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and `MARKING_AND_HIGHLIGHTING_LOGIC.md` aligned with the same contract.

Explicit taxonomy change completed:

1. `BUTTON` is now a toggleable default exclusion.
2. `LINK` is intentionally omitted from the taxonomy: a `<link>` is a void metadata element that never carries text or descendants, so listing it as an immutable default exclusion was redundant.
3. Keep this explicit contract change reflected in constants, docs, memory, and regression tests.

052c-derived marking restoration completed:

1. Restore direct-text toggleable default self-targeting and generated/default descendant suppression of broader auto-default ancestors.
2. Restore Shift expanded exclusion chooser order: self structured/toggleable boundary, nearest structured group ancestor, nearest toggleable ancestor, then broadest markable ancestor, while keeping the shallow page-shell guard.
3. Restore Alt explicit include mixed direct-text ancestor promotion while preserving silent-whitespace and geometry safeguards.
4. Keep selector/AI exclusions decision-only with no dedicated AI-excluded marking overlay, and keep silent highlighting on `immutable`, `content`, and `excluded` layers only.
5. Keep `explicit: true` tagging for user-created exclude rows, but submit every stored excluded XPath row as excluded unless it is explicitly included or suppressed by an excluded ancestor.
6. Keep fast explicit-layer acknowledgement; force structural invalidating full marking rebuilds immediately, while leaf explicit-exclude toggles may debounce the full rebuild after patching cached lower-priority collections.
7. Marking enable must inspect the page before the motion freeze: show a spinner, block page/content-overlay input, run a bottom-and-top reveal scroll, restore the original viewport, then freeze and render.

Backend-saved candidate completion completed:

1. Keep local draft page markings separate from backend-confirmed page markings.
2. Build Todo List completion, candidate `Marked` badges, marked-page lists, and Lynx checklist coverage from backend-confirmed page markings only.
3. Do not upload unsaved local page drafts during unrelated config syncs; include the current page only during an explicit page save or revert.
4. Clear page-save reconciliation only after the forced backend reload confirms the current page exists in the backend-saved cache.
5. Preserve the initial-save path so a user can save a newly opened page with default markings accepted as-is.

AI submission alignment completed:

1. Compute AI submission XPath rows against the same sanitized DOM view as the saved `renderedHtml`, so extension UI cannot shift body-child indexes in the payload.
2. Submit every stored excluded XPath row as excluded unless explicitly included or suppressed by an excluded ancestor; keep `explicit: true` as local user-edit metadata rather than the submission gate.
3. Submit hidden textual content as excluded at mobile-save time, while visible textual content remains included unless it is under an explicit excluded ancestor.
4. Keep immutable defaults out of per-page XPath rows and rely on the immutable tag list in the AI payload.
5. Run marking sync before taking the saved snapshot, suppress stale immutable rows, and strip browser automation roots from saved snapshots.
6. Hide consent UI before saving and handle it through normal hidden-textual detection; do not store, sync, or submit dedicated `consentXpaths`.
7. Preserve local saved page snapshots across empty or partial backend responses by timestamp-merging confirmed saves and incoming remote markings.
8. Surface IndexedDB read/write failures instead of allowing failed page saves to appear successful.

AI compute responsiveness pass completed:

1. Show popup compute-busy feedback and apply the page-side compute lock before raw HTML backfills, XPath refinement, or AI payload construction.
2. Poll async AI run status every 5 seconds while the run is active.

Future marking work:

1. Start by reading `MARKING_AND_HIGHLIGHTING_LOGIC.md`.
2. Treat caching, fast refresh, hover, and rendering changes as adaptation layers only.
3. Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks for a marking-rules contract change.
4. Run the focused marking guard suite before committing:
   `node --test tests/core-visibility.test.js tests/core-scheduling.test.js tests/marking-rules.test.js tests/popup-marking-refresh.test.js tests/selector-suppression.test.js tests/silent-highlight-annotations.test.js tests/silent-highlight-rules.test.js tests/submission-rules.test.js`.

Marking performance pass completed:

1. Enabling marking uses `setEnabled` as the single activation path and no longer sends a redundant immediate `forceRefresh`.
2. Explicit refinements redraw only explicit layers immediately and then force an immediate invalidating full render for default/AI/ancestor-layer correctness.
3. Full marking passes share per-pass caches for visibility, text, immutable/default selector, ancestor, and textual-descendant computations.
4. Shift parent expansion rejects shallow generic page shells while preserving cohesive sections, lists, tables, card groups, and toggleable default boundaries.

Motion stability pass completed:

1. Page motion pause is source-owned by marking and silent highlighting, so one lifecycle cannot accidentally resume the other.
2. Matching base-URL pages hold the pause even when no selector highlights or visible overlays exist yet.
3. The freeze covers CSS animations/transitions, Web Animations, SVG clocks, autoplay-like media, generic hover-pause candidates, computed inline locks for common motion properties, and a page-world timer/rAF gate for JavaScript-driven carousel loops.
4. The freeze excludes extension-owned UI and routes marking overlay scheduling through extension-owned timers/rAF, so Unfluffify controls keep rendering while page motion is held.
5. Marking enable shows an inspection spinner, blocks page/content-overlay input, runs a bottom-and-top reveal scroll, restores the user's scroll position, then freezes page motion and renders overlays.
6. Layout-present scroll/viewport/attribute-driven reveal candidates, including Webflow interaction hooks, are normalized to visible posture while semantic hidden UI and carousel states remain hidden.
7. The pause indicator uses an Unfluffify-scoped Material Design Icons snowflake/code glyph pair without injecting global `.mdi` styles into target pages.
8. Save snapshots restore and strip extension-owned pause classes, UI, timer bridge script, reveal normalizations, and inline locks before serializing `renderedHtml`.

Mobile simulation default completed:

1. Opening Unfluffify on a supported page enables mobile simulation by default for a fresh tab session.
2. Disabling mobile simulation from the popup is preserved as a per-session tab choice, including across navigation/reload cleanup, and must not be silently auto-enabled again while marking is off. Active marking sessions on the editor tab force mobile simulation back on until marking is disabled.
3. AI-submission visibility continues to use mobile simulation geometry when classifying visible versus invisible textual content.

Phase 2 slice 2 completed:
   Editor-mobile-only enforcement now runs through the existing device
   emulation paths. Popup marking enable forces mobile simulation before
   `setEnabled`, the popup hides/disables the device toggle while marking is
   active, and `chrome.debugger.onDetach` re-applies mobile emulation instead
   of leaving the editor tab in desktop mode if DevTools tears the override
   down mid-session. This preserves the per-session device-emulation choice
   when marking is off, while enforcing the editor-mobile-only contract during
   active marking.

Phase 2 slice 3 completed:
   Desktop preview now uses the existing initial per-tab state as its
   tab-lifecycle owner. When AI selectors exist for the current property, the
   popup renders a separate `Preview in desktop mode` checkbox below the other
   sections. Turning it on disables active marking if needed, persists the
   checkbox state on the tab, switches emulation to desktop, and disables
   marking re-entry until turned off. Turning it off returns the tab to mobile
   emulation. `chrome.debugger.onDetach` now also clears desktop preview back
   to forced mobile emulation so DevTools device-mode teardown cannot leave the
   tab stuck in stale desktop preview state.

Phase 2 slice 4 completed:
   Same-property off-candidate pages no longer collapse the popup into a fully
   blocked state. Popup property-lock scope now follows the resolved property
   site ID for the page's base URL, not only current candidates, so the user
   still sees editor/passive state and any off-candidate countdowns. The popup
   keeps silent mode available on those pages for selector previewing while
   still auto-disabling marking entry whenever the page is not a current Live
   Page candidate.

Phase 2 slice 5 completed:
   Same-property off-candidate editor countdowns now have real release
   behavior. Content starts a 70 second local warning when the current editor
   remains on an off-candidate page within the same property, persists the
   deadline in initial tab state so the popup can mirror it across reopen, and
   sends `release_lock` when the timer expires unless the user has returned to
   a candidate page first. Candidate re-entry or any non-editor lock state
   clears the warning.

Phase 2 slice 6 completed:
   Cross-property editor recovery now uses a separate 30 second cool-off. When
   the editor tab lands on a different property's page, content disconnects
   from the old property port, persists the previous editor session
   (`siteId`, `baseUrl`, `clientId`) plus cooldown deadline in initial tab
   state, and shows a mirrored countdown on both the page and popup. Returning
   to the original property within that window restores the same client session;
   expiry sends `release_lock` for the old property runtime and clears the
   recovery state.

Phase 2 slice 7 completed:
   Tab-removal release now matches the hardened navigation spec. Ordinary
   property-lock port disconnects still keep the 70 second reconnect grace for
   same-tab reload/navigation recovery, but `chrome.tabs.onRemoved` now
   delegates to the property-lock background to immediately send `release_lock`
   for any editor runtime owned by the removed tab and dispose that runtime
   without waiting for the grace window.

Phase 2 slice 8 completed:
   The remaining teardown ownership splits were collapsed into the shared tab-
   state cleanup paths. `common/utilities.clearTabState(...)` now removes both
   live and `initial` tab state, `background.js` routes unregister/reload and
   tab-removal cleanup through shared helpers instead of hand-deleting keys,
   and the final audit locked that contract with additional lifecycle
   regression coverage. This closes the last obvious Phase 2 state-drift risk
   around desktop-preview and property-lock recovery metadata.

Phase 2 live-validation follow-up status:
   Repo-local smoke diagnostics through
   `scripts/smoke-property-lock-phase2.mjs` found and fixed a real popup-side
   cross-property recovery bug. The page banner and content-side cooldown were
   correct, but the popup could lose or hide the mirrored cooldown because it
   refreshed into the new property's lock snapshot before honoring the
   persisted recovery session from `tabState:initial:<tabId>`. Popup now:
   (1) preserves the pre-refresh recovery session snapshot, (2) gives the
   persisted cross-property recovery session precedence while the page is
   outside that base URL, and (3) renders cross-property / off-candidate
   warning UI from mirrored initial-tab-state countdowns even if the freshly
   fetched live lock snapshot is inactive or no longer reports `isEditor`.
   Focused popup regression coverage was updated and full `npm test` is green
   (`47/47`).

Phase 2 drift audit and fixes (2026-06-06):
   After reviewing the agent commit `b41c50f`, two implementation gaps were
   identified and fixed:

   **Bug 1 — Desktop preview section trapped inside `renderMarkingView`**:
   The agent placed the desktop preview section at the bottom of
   `renderMarkingView`, making it invisible when the popup is in any view
   other than `View.Marking` (e.g. Configuration view). The spec requires it
   to be independent of current view. Fixed by moving the section to the
   top-level render call site in `popup/ui.js`, rendered after the
   view-conditional block and before the toast, wrapped in a
   `section-divider` for visual separation. The incorrect
   `tooltips.mobileSimulationHotkey` tooltip reference on the row was also
   removed (the desktop preview row is not a hotkey action). The `hidden`
   prop on the notice was replaced with a conditional render to match the
   pattern used elsewhere.

   **Bug 2 — Activity signals only fired on marking-specific actions**:
   The spec requires "any input on the page or extension surface (mouse
   move/click/keyboard/scroll)" to reset the 30-minute inactivity window.
   Content-side `sendPropertyLockActivity()` was only called from marking
   actions (page toggles, saves etc.). Fixed by adding debounced
   `mousemove`/`keydown`/`pointerdown`/`scroll` listeners in `main()` that
   fire `sendPropertyLockActivity()` at most once per 10 seconds via a
   `propertyLockPageActivityTimer` debounce.

   **Plan error — `47/47` test count**: The handoff docs stated
   `` `npm test` passes (`47/47`) `` which was a partial focused run count.
   The full suite at that point passed all tests. Current full suite:
   444/444.

   Three new guard tests in `tests/device-emulation-lifecycle.test.js`
   lock: (1) desktop preview section renders outside `renderMarkingView`,
   (2) section has a divider, correct `monitor-eye` icon, no stale
   hotkey tooltip, (3) general activity listeners exist with debounce.
   Full `npm test` (444/444) green; Bonliva live smoke clean.

Phase 2 remaining work:
   Remaining work is validation of the live flows. The repo-local smoke
   harness in `scripts/smoke-property-lock-phase2.mjs` has known flakiness
   around popup reopen/auth bootstrap after unpacked-extension reload. The
   next work item is a same-property candidate→off-candidate→candidate pass
   plus a cross-property return pass in a trustworthy live browser session.
   Once those pass, Phase 2 can be declared fully closed.

Page interaction pass-through completed:

1. Hold `Space` in marking mode to temporarily let clicks reach page UI such as accordions, tabs, and menus.
2. `Alt` stays explicit include and `Shift` stays parent selection.
3. Releasing `Space`, blur, visibility changes, or marking disable restores the overlay and redraws markings over the updated page posture.

Temporary disabled marking state completed:

1. Save reconciliation is the source of truth for marking-active-but-editing-blocked pages.
2. The page overlay dims existing markings, clears hover feedback, switches to a progress cursor, and shows a persistent paused status notice while reconciliation is pending.
3. The disabled-state UI remains extension-owned and is stripped from saved snapshots.

Todo current subsection indicator completed:

1. The Todo List derives the current page-type subsection from the same current candidate state used by the candidate row.
2. The parent subsection shows the `Current` badge and accent state so the active page remains findable when candidates are collapsed.

## Post-Run Follow-up

Resolved (verified during the Phase 51 audit at commit `d1d9eb4`):

1. `tests/page-telemetry.test.js` — payload-control test now passes (2/2);
   the failure noted earlier was incidental and was resolved by intervening
   commits on the branch.
2. `tests/property-lock.test.js` — the live-page site-id resolver
   expectation now passes alongside the other property-lock cases (27/27).
3. `tests/theme-colors.test.js` — popup `color-mix(..., var(--card))`
   violations now pass (5/5).

Full `npm test` runs green from end to end (latest run: 487/487). If any of
these regress in a future change, treat them as standalone fixes rather than
re-opening this rollup.

## Remote Support Follow-up

1. Validate Chrome-window display sharing and camera/microphone permission prompts in two real Chrome profiles.
2. Verify view-only supporter sessions keep supportee marking, highlighting, popup, and sidebar workflows usable.
3. Continue improving remote cursor/sidebar presence as observational metadata only, without reintroducing remote-control command replay.
4. Validate DevTools console/network mirroring labels for page content script, popup.html, and background worker contexts with and without optional payloads.
5. Run manual two-profile validation for navigation, sidebar sync, telemetry, camera/microphone, and teardown after substantial remote-support changes.

## Constraints

- The marking-rules contract is locked to the approved 052c-derived behavior plus deliberate current safeguards and must not drift through unrelated refactors.
- Do not reintroduce supporter remote-control or control handoff/takeover paths.
- Fail remote-support bootstrap when valid ICE config is missing; do not silently fall back away from the Cloudflare-only contract.
