# Unfluffify Knowledge

## Remote Support

- Use Node's built-in test runner via `npm test`; the script includes `--test-force-exit` so mocked extension transports do not keep CI open.
- For focused remote-support validation, run `npm test -- tests/remote-support-offscreen.test.js tests/remote-support-background.test.js tests/remote-support.test.js`.
- The offscreen transport must enforce `REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES` and chunk oversized outbound payloads; a healthy ICE/peer connection can still fail if the data channel closes on a large first payload.
- Remote ICE candidates must be queued until `setRemoteDescription` completes.
- The transport supports named RTCDataChannels. Treat `page` and `default` as primary for session-connected state; `sidebar` must not mark the session connected on its own.
- Remote support is view-only: `remoteSupportSendCommand` and `remoteSupportSetControlOwner` are legacy messages that background rejects.
- Popup and support-page UI should not expose remote-control input handlers or takeover/handoff copy; keep all remote-support wording explicitly view-only.
- After navigation, `content-main.js` must call `getRemoteSupportState` on startup because `content-loader.js` only imports it after `activateContentMain` and the background does not replay session state automatically.
- If the initial remote-support rehydration runs before `document.body` exists, terminate-button sync must retry after `DOMContentLoaded`.
- The supporter `/support` page should coalesce `remoteSupportFrame` updates into a throttled image-only sync path instead of rerendering the full page chrome for every frame.
- The supportee popup/side panel is the source for mirrored sidebar simulation state: it publishes debounced normalized sidebar snapshots to the background, which caches and replays them over the dedicated `sidebar` data channel and forwards them to the supporter `/support` page.
- In content scripts, `Extension context invalidated` means the old extension instance was reloaded/disabled/replaced. Treat it as a terminal lifecycle signal for that script: stop property-lock reconnect loops and wait for the new content script instead of retrying Chrome extension APIs.

## Current Architecture Decisions

- The dedicated `/support` page is the primary supporter viewing surface.
- The supportee's actual Chrome side panel remains the authoritative Unfluffify sidebar during a session.
- Page reflection is a live Chrome-window visual stream, not DOM mirroring.
- Remote support sessions explicitly start with `page` and `sidebar` RTC data channels at the app layer.

## AI Submission Rules

- Starting AI content detection must show compute-busy feedback and apply the page-side compute lock before raw HTML backfills, XPath refinement, or payload construction; the async status poll interval is 5 seconds.
- Heavy `renderedHtml`, `rawHtml`, AI request payloads, AI responses, and server config payloads should not be routed through multiple runtime-message hops. Prefer storage/cache keys or a context-owned fetch when payload size could approach Chrome messaging limits.
- Saved `submissionXpaths` are shallow boundary rows for CSS-selector calculation: exclusion roots are submitted once and their descendants are suppressed unless a descendant is an explicit include.
- Submission XPath indexes must be computed after marking sync against the same sanitized DOM view as saved `renderedHtml`; extension UI, browser-automation roots, and save-time stripped nodes do not count as siblings.
- Exclusion rows include every stored excluded XPath row, plus implicit hidden textual content detected in mobile save mode. Generated/default rows submit as excluded unless explicitly included or suppressed by an excluded ancestor; `explicit: true` remains local user-edit metadata, not the AI-submission gate.
- Immutable defaults and descendants are excluded by the payload's immutable tag list only, not by per-page XPath rows; stale immutable rows must be suppressed.
- Explicit includes always submit as included rows, even when hidden or nested inside excluded ancestors.
- Consent UI is hidden before saving and then handled by normal invisibility detection; do not persist or sync `consentXpaths`.

## Page Save and Candidate Completion

- Local page-marking drafts are not candidate-completion evidence. The Todo List, candidate `Marked` badges, marked-pages list, and Lynx checklist coverage must use the backend-saved page-marking cache populated from confirmed `/load` or valid `/save` backend payloads.
- The Todo List current-page indicator belongs on both the current candidate row and its parent page-type subsection, so the active page type is visible even when the subsection body is collapsed.
- Config sync must not upload unsaved local page drafts by default. It may include backend-saved page markings and the current page only when the user is explicitly saving or reverting that page.
- Empty or partial `/load`/`/save` responses must not replace local saved page snapshots or clear the backend-saved cache; merge confirmed save payloads and incoming remote entries by timestamp.
- Page-save reconciliation must not be cleared merely because `/save` returned OK; the forced backend reload must confirm the current page is present in the backend-saved cache.
- A page with no local or remote saved data must remain saveable even when the user accepts the default markings as-is and has made no manual toggle changes.

## Marking and Highlighting Rules

- The marking rules are a locked compatibility contract. Do not change taxonomy, target resolution, sync semantics, overlay projection, or default-exclusion behavior unless the user explicitly requests a marking-rules contract change.
- For reload/page lifecycle work, run a Q&A sanity-check phase before implementation: trace marking rules, rendering rules, XPath calculation, and AI payload construction so fixes preserve the locked contract and avoid large message transfers.
- Any legitimate marking contract change must update `MARKING_AND_HIGHLIGHTING_LOGIC.md`, `.copilot/knowledge.md`, `.copilot/plan.md`, `README.md`, and focused regression tests in the same commit.
- Marking rules are anchored to the approved `052c164b077d459fa7a6e79b306f01144336719c`-derived contract, with deliberate current safeguards: `BUTTON` is toggleable, the redundant void `LINK` tag is omitted from the taxonomy, stricter geometry/paint guards stay active, selector-excluded content has no dedicated marking overlay, and silent highlighting stays `immutable`/`content`/`excluded`.
- Shift expanded exclusion restores the 052c chooser: self structured/toggleable boundary, nearest structured group ancestor, nearest toggleable ancestor, then broadest markable ancestor, while still rejecting shallow generic body-level page shells.
- Alt explicit include restores 052c mixed direct-text ancestor promotion while keeping current silent-whitespace safeguards.
- Toggleable default exclusions are `FOOTER`, `FORM`, `LABEL`, `NAV`, `HEADER`, `DIALOG`, `ASIDE`, and `BUTTON`. Immutable defaults are `IMG`, `INPUT`, `NOSCRIPT`, `SELECT`, `TITLE`, `STYLE`, `SCRIPT`, `TEMPLATE`, `IFRAME`, and `VIDEO`. `LINK` is intentionally omitted from the taxonomy because a `<link>` is a void metadata element that never carries text or descendants and can never be a marking target.
- Exclude clicks drill into markable descendants inside active toggleable default boundaries; the generated default ancestor is stored as `excluded: false` while the descendant becomes explicit. Generated/default descendant rows also participate in suppressing broader auto-default ancestors. Blank/default-boundary clicks can still unmark the boundary itself.
- Toggleable defaults differ from user/CSS-selected exclusions only during the inclusion/exclusion decision. After sync decides a default boundary is excluded, generated rows whose live element still matches a toggleable default render through the ordinary exclude marking path even without `explicit: true` and stay out of the implicit/default content layer; stale untagged non-default excludes must stay hidden.
- Toggleable default exclusions must not have a dedicated visual layer, CSS class, render collection, or post-hoc overlay rule.
- A stored toggleable default row with `excluded: false` unmarks only that boundary without becoming a full explicit include subtree.
- Stored unexcluded default boundaries also suppress their own default-layer marking, but not their descendants, to avoid visual-only ancestor ghosts around explicit descendant marks.
- Default-layer collection remains structural and is not globally filtered by visible explicit marks; broad filtering can make implicit descendants flicker on alternating toggles.
- Fast explicit-toggle overlay refreshes must run `syncPageMarkings` before drawing explicit layers, but must not recompute the default layer. Structural toggles run the invalidating full render immediately after that refresh; leaf explicit-exclude toggles may patch cached lower-priority collections and debounce the invalidating full render to keep mark/unmark acknowledgement responsive.
- Marking enable uses `setEnabled` as the single activation path; do not add a second immediate popup `forceRefresh` after successful enable.
- Full marking passes may use per-pass caches for visibility, text, immutable/default selector, ancestor, and textual-descendant decisions. These caches are derived from the current DOM/config and must not become persistent marking truth.
- Explicit include boundaries block descendant hover targeting and marking until the exact include boundary is removed.
- Hidden explicit include/exclude markings persist while their DOM element exists and render as non-toggleable ghost markings when measurable.
- Marking mode uses `Alt` for explicit include, `Shift` for parent selection, and hold-`Space` for temporary page UI interaction/pass-through.
- Preview Contents is intentionally available in marking mode again, gated on AI-run freshness and page-save reconciliation. Silent Preview Contents still reads the latest stored selector set, and Send to Lynx remains silent-highlighting-only with handler-level guards outside silent mode.
- Shift parent selection may climb wrapper chains to cohesive content boundaries, but must reject shallow generic body-level page shells with broad viewport footprint or multiple page landmarks.
- Marking overlays watch style mutations so dynamic opacity, visibility, and movement changes trigger repositioning.
- Page motion pause is a shared marking/silent-highlighting lifecycle source. Marking enable first shows a page-inspection spinner, blocks page/content-overlay input, performs a bottom-and-top reveal scroll for lazy content, restores the user's scroll, then freezes and renders overlays. Matching base-URL pages stay frozen even before selector overlays exist; the pause uses broad CSS/Web Animations/SVG/media/style-lock coverage plus a page-world timer/rAF gate, normalizes layout-present scroll/viewport/attribute-driven reveal candidates such as Webflow `data-w-id` blocks to visible posture, shows an Unfluffify-scoped Material Design Icons snowflake/code indicator without injecting global `.mdi` page styles, excludes extension-owned UI, keeps internal marking scheduling on extension-owned timers/rAF, and strips all freeze mechanics from snapshots.
- Opening Unfluffify on a supported page enables mobile simulation by default for a fresh tab session. A user-disabled mobile simulation state is a per-session choice and must not be auto-enabled again until the tab session state is cleared.
- If marking remains enabled while page editing is blocked by save reconciliation, the page overlay must visibly enter the temporary disabled state: dim markings, clear hover, show the paused status notice, and strip that UI from snapshots.
