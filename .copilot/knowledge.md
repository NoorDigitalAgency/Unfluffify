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

## Current Architecture Decisions

- The dedicated `/support` page is the primary supporter viewing surface.
- The supportee's actual Chrome side panel remains the authoritative Unfluffify sidebar during a session.
- Page reflection is a live Chrome-window visual stream, not DOM mirroring.
- Remote support sessions explicitly start with `page` and `sidebar` RTC data channels at the app layer.

## AI Submission Rules

- Saved `submissionXpaths` are shallow boundary rows for CSS-selector calculation: exclusion roots are submitted once and their descendants are suppressed unless a descendant is an explicit include.
- Exclusion roots include explicit excludes, immutable roots, hidden consent roots, toggleable default roots already excluded by markings, and toggleable roots that are currently invisible in mobile save mode.
- Explicit includes always submit as included rows, even when hidden or nested inside excluded ancestors.

## Marking and Highlighting Rules

- Marking rules are anchored to commit `b9c86238b08dd0b0ee0231fcab7b214625e29670`: plain exclude clicks do not promote default-excluded boundaries to explicit includes.
- Expanded exclusion targets are eligible when they own direct text or contain at least one self-markable descendant, matching the b9 parent-selection behavior.
- Toggleable default exclusions are `FOOTER`, `FORM`, `LABEL`, `NAV`, `HEADER`, `DIALOG`, and `ASIDE`; `BUTTON` is immutable and `LINK` is not default-excluded.
- Exclude clicks drill into markable descendants inside active toggleable default boundaries; the generated default ancestor is stored as `excluded: false` while the descendant becomes explicit. Blank/default-boundary clicks can still unmark the boundary itself.
- Toggleable default exclusions have no separate visual layer: after sync decides a default boundary is excluded, it renders through the ordinary exclude marking path.
- A stored toggleable default row with `excluded: false` unmarks only that boundary without becoming a full explicit include subtree.
- Stored unexcluded default boundaries also suppress their own default-layer marking, but not their descendants, to avoid visual-only ancestor ghosts around explicit descendant marks.
- Default-layer collection remains b9-like and is not globally filtered by visible explicit marks; broad filtering can make implicit descendants flicker on alternating toggles.
- Fast explicit-toggle overlay refreshes must run `syncPageMarkings` before collecting overlays; otherwise generated default ancestors can be drawn from stale pre-sync state.
- Explicit include boundaries block descendant hover targeting and marking until the exact include boundary is removed.
- Hidden explicit include/exclude markings persist while their DOM element exists and render as non-toggleable ghost markings when measurable.
- Marking overlays watch style mutations so dynamic opacity, visibility, and movement changes trigger repositioning.
