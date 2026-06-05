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
   `launchOptions`. Keep `.vscode/browser-mcp.config.json` in that schema before
   treating a fresh-profile MCP run as product validation. After the schema
   update, `browser_get_config` resolves the extension launch args correctly,
   but a fresh-profile MCP run on `https://seo.se/` still showed no
   `content-loader` DOM bootstrap and no extension service worker. This remains
   a validation-infra blocker to resolve before treating fresh-profile MCP as a
   product-behavior signal.
4. `https://seo.se/` live smoke status: the MCP loaded the page, loaded the
   extension, exposed the target tab ID, and opened
   `popup.html?debugTabId=<seo-tab-id>`. The popup page had `chrome.runtime`
   available and no popup console errors, but a direct popup-context
   `chrome.runtime.sendMessage({ type: "resolvePopupTabContext", debugTabId })`
   returned no response with `chrome.runtime.lastError` = `The message port
   closed before a response was received.` Treat this as a validation-blocking
   authority-refactor follow-up before moving more popup/background ownership.
   A message-safe tab serialization attempt did not change the MCP failure, so
   the next investigation should focus on whether the background listener is
   receiving/keeping the popup-originated `resolvePopupTabContext` message alive
   in the extension-page context, not on raw `chrome.tabs.Tab` serialization.
   The seo.se page itself also logs an unrelated site script `Failed to fetch`
   error from `seo-theme`.
5. Remaining authority work should still avoid proxying large config, HTML, or
   AI request/response bodies through runtime messages; use storage keys,
   owner-context fetches, or a designed background/offscreen ownership path.

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
