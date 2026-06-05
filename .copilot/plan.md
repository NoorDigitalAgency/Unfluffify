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
50c. Phase A+B multi-site live smoke completed:
   Standalone `scripts/smoke-ai-submission.mjs` driven through `xvfb-run` with
   the persistent `.mcp-browser-profile` and the loaded unpacked extension
   confirmed that `capturePageSnapshot` (persist: true) round-trips through the
   background service worker and the content script with `ok: true` and zero
   page console errors on `https://www.bonliva.no/artikler/barnehagevikar-lonn`,
   `https://prowork.se/`, and `https://www.vitec-pyramid.com/`. The
   content-loader injection marker
   (`#unfluffify-page-motion-freeze-script`) is present on all three sites
   before the snapshot runs, so the Phase A partial-visibility bridge and the
   Phase B ancestor guard execute against real DOMs without runtime regression.
   Full `npm test` (`449/449`) stayed green alongside the live runs.
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

## Marking Reload Handoff

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
2. Disabling mobile simulation from the popup is preserved as a per-session tab choice, including across navigation/reload cleanup, and must not be silently auto-enabled again.
3. AI-submission visibility continues to use mobile simulation geometry when classifying visible versus invisible textual content.

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

1. Fix `tests/page-telemetry.test.js` payload-control failure.
2. Update `tests/property-lock.test.js` or `content-main.js` for the live-page site-id resolver expectation drift.
3. Fix `tests/theme-colors.test.js` popup `color-mix(..., var(--card))` violations.

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
