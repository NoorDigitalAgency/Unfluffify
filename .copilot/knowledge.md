# Unfluffify Knowledge

## Remote Support

- Use Node's built-in test runner via `npm test`; focused runs work as `npm test -- tests/<file>.js`.
- For the current remote-support slice, validate with `npm test -- tests/remote-support-offscreen.test.js tests/remote-support-background.test.js tests/remote-support.test.js`.
- The offscreen transport must enforce `REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES` and chunk oversized outbound payloads; a healthy ICE/peer connection can still fail if the data channel closes on a large first payload.
- Remote ICE candidates must be queued until `setRemoteDescription` completes.
- The transport supports named RTCDataChannels. Treat `page` and `default` as primary for session-connected state; `sidebar` must not mark the session connected on its own.
- The supported-tab content script must handle the current background message names `remoteSupportState` and `remoteSupportCommand`; relying only on older aliases breaks remote control silently.
- After navigation, `content-main.js` must call `getRemoteSupportState` on startup because `content-loader.js` only imports it after `activateContentMain` and the background does not replay session state automatically.
- If the initial remote-support rehydration runs before `document.body` exists, terminate-button sync must retry after `DOMContentLoaded`.
- The supporter `/support` page should coalesce `remoteSupportFrame` updates into a throttled image-only sync path instead of rerendering the full page chrome for every frame.
- The supportee popup/side panel is now the source for mirrored sidebar simulation state: it publishes debounced normalized sidebar snapshots to the background, which caches and replays them over the dedicated `sidebar` data channel and forwards them to the supporter `/support` page.

## Current Architecture Decisions

- The dedicated `/support` page is the primary supporter controller.
- The supportee's actual Chrome side panel remains the authoritative Unfluffify sidebar during a session.
- Control ownership is explicit: supporter or requester owns control at a given time; commands must be gated by that shared owner state.
- Page reflection remains a live visual stream, not DOM mirroring.
- Remote support sessions now explicitly start with `page` and `sidebar` RTC data channels at the app layer.

## AI Submission Rules

- Saved `submissionXpaths` are shallow boundary rows for CSS-selector calculation: exclusion roots are submitted once and their descendants are suppressed unless a descendant is an explicit include.
- Exclusion roots include explicit excludes, immutable roots, hidden consent roots, toggleable default roots already excluded by markings, and toggleable roots that are currently invisible in mobile save mode.
- Explicit includes always submit as included rows, even when hidden or nested inside excluded ancestors.
