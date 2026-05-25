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

## Current Architecture Decisions

- The dedicated `/support` page is the primary supporter controller.
- The supportee's actual Chrome side panel remains the authoritative Unfluffify sidebar during a session.
- Control ownership is explicit: supporter or requester owns control at a given time; commands must be gated by that shared owner state.
- Page reflection remains a live visual stream, not DOM mirroring.
