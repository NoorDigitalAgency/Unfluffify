# Remote Support (WebRTC) Design and Endpoint Contract

This document defines the extension-side remote support implementation and the expected backend contracts for `/request-support`, `GET /support`, `POST /support`, and `/webrtc`.

## Implemented extension behavior

- Remote support uses a WebRTC `RTCPeerConnection` + `DataChannel`.
- In MV3, the WebRTC transport runs inside an offscreen document rather than the background service worker, because the service worker does not expose `RTCPeerConnection`.
- The background and offscreen runtimes both keep a session map, so one extension profile can host multiple concurrent support sessions as long as each session is isolated to its own browser tab.
- Two fixed roles:
  - **Requester** → becomes **being_supported**.
  - **Supporter** (joins with support code) → becomes **supporting**.
- Supporter-side join UI is only shown when the popup is opened on the configured backend support page (`GET /support`). On all other tabs, the popup only shows the requester-side "Request remote support" action.
- Session modes:
  - `inactive`
  - `being_supported`
  - `supporting`
- Popup state queries and end-session actions are scoped to the current tab; legacy remote-command messages are rejected.
- DevTools console/network panels attach to the inspected tab and only receive state and telemetry for that tab's active support session.
- Session ends when either side terminates, the tab closes, or inactivity timeout is reached.
- Ended-session and transient transport warnings are retained in the tab-scoped inactive state until the user dismisses them with the icon-only notice button in the popup or `/support` page.
- Inactivity timeout: **10 minutes** without remote activity.
- During the final minute, both peers see a live countdown warning; the requester can rescue the session with a "Continue session" action from the popup.
- One active session per tab.
- Being-supported mode blocks local extension-owned interactions on page UI.
- Supporting mode disables regular popup controls and uses the dedicated `/support` view-only support surface.

## Realtime streams

### 1) Screen stream

- Being-supported side asks the user to share an entire screen through Chrome's screen-only desktop-capture picker.
- The offscreen requester runtime attaches the shared display video track to the peer connection, and the supporter `/support` page renders the remote track as the full-size primary live surface.
- The older data-channel `frame` message remains as a compatibility/fallback path for remote-frame events, but the current screen stream is real WebRTC video.
- Remote support is view-only. No command owner or remote-control handoff is exposed.

### 2) Camera and microphone guidance

- Both peers request local camera and microphone tracks when available.
- Camera and microphone tracks are requested with `navigator.mediaDevices.getUserMedia()` from extension pages, not through the packaged-app-only `audioCapture` or `videoCapture` manifest permissions.
- The supporter viewer shows compact local and remote camera views out of the way of the main shared-screen stream.
- Audio tracks are attached to the same peer connection for bidirectional spoken guidance.
- If camera or microphone capture is denied, the session continues with display sharing and telemetry.

### 3) Page telemetry bridge

- `content-main.js` injects `common/page-telemetry.js` into the page world so actual page scripts can be observed in addition to the extension content script.
- The injected bridge forwards page-world `console`, `fetch`, and XHR telemetry back through the content script to background with the `page` source label.
- Payload capture stays disabled by default and follows the same `includePayloads` control flow as the supporting DevTools network panel.

### 4) Extension telemetry stream

- Console and network telemetry is collected from Unfluffify extension contexts (popup/side panel, content script, and service worker where available) and forwarded to background.
- Telemetry is labeled by source (`page scripts`, `page content script`, `popup.html`, `background worker`, or other extension context) so DevTools tabs can distinguish page-world, content-script, popup, and background activity.
- Support side receives telemetry over the page data channel and displays it in DevTools panels.

## DevTools panels

Two extension DevTools panels are added:

1. **Unfluffify Console**
   - Shows streamed console events with level + timestamp.
  - Shows the cleaned source context (`popup.html`, `page content script`, or `background worker`) for each entry.
  - The panel attaches to the inspected tab and only shows entries for that tab's active supporting session.

2. **Unfluffify Network**
  - Shows source context, URL, status code, method, type, request/response header counts, timestamps, and load time.
  - Includes **Include payloads** toggle.
   - Per-row payload download button (icon-only) when payload exists.
  - The payload toggle only controls the supporting session attached to that DevTools instance.

## Payload policy

- Extension `fetch`/XHR payload streaming includes request and response payloads when enabled.
- Per-payload clamp: **2MB**.
- Total payload budget per active session: **10MB**.
- Payload capture starts disabled and metadata still streams without request/response bodies.

## Expected backend contract

> Auth: Bearer JWT in `Authorization` header for HTTP. For websocket, token can be passed in `?token=...`.

### GET `/support`

Used by supporter side as the dedicated browser tab for joining and viewing a remote session.

Expected behavior:

- Returns an HTML page.
- Does not require authentication.
- The extension popup uses the current tab URL to detect this page and reveal the join-code UI.

### POST `/request-support`

Used by requester side.

Request body (example):

```json
{
  "tabId": 123,
  "pageUrl": "https://example.com/page",
  "requestedAt": "2026-05-24T08:00:00.000Z",
  "extension": "Unfluffify"
}
```

Response body (expected):

```json
{
  "sessionId": "sess_...",
  "supportCode": "123456",
  "expiresAt": "2026-05-24T08:10:00.000Z",
  "webrtcWsUrl": "wss://api.example.com/webrtc?token=...",
  "iceServers": [
    {
      "urls": [
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp"
      ],
      "username": "support-user",
      "credential": "support-secret"
    },
    {
      "urls": ["stun:stun.cloudflare.com:3478"]
    }
  ]
}
```

Notes:
- `supportCode` should be valid for initiation for ~10 minutes.
- If `webrtcWsUrl` is omitted, extension falls back to `<config-endpoint>/webrtc?token=...`.
- `iceServers` is required. If the backend returns an empty or invalid list, the extension aborts remote-support bootstrap instead of appending public STUN fallbacks.
- For cross-network support, the backend should publish at least one TURN server in `iceServers`; STUN-only configurations are usually not enough for the hardest network combinations.

### POST `/support`

Used by supporter side with support code after opening the dedicated `GET /support` page in a tab.

Request body (example):

```json
{
  "supportCode": "123456",
  "joinedAt": "2026-05-24T08:01:00.000Z",
  "extension": "Unfluffify"
}
```

Response body (expected):

```json
{
  "sessionId": "sess_...",
  "supportCode": "123456",
  "expiresAt": "2026-05-24T08:10:00.000Z",
  "webrtcWsUrl": "wss://api.example.com/webrtc?token=...",
  "iceServers": [
    {
      "urls": [
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp"
      ],
      "username": "support-user",
      "credential": "support-secret"
    },
    {
      "urls": ["stun:stun.cloudflare.com:3478"]
    }
  ]
}
```

### WebSocket `/webrtc`

Connection URL:

- `wss://.../webrtc?token=<jwt>` (or server-provided `webrtcWsUrl`).

Message envelope:

```json
{
  "type": "register|signal|partner-ready",
  "timestamp": 1710000000000,
  "payload": {}
}
```

Register payload (from each peer):

```json
{
  "sessionId": "sess_...",
  "supportCode": "123456",
  "role": "requester|supporter"
}
```

Signal payload (forwarded between peers):

```json
{
  "signalType": "offer|answer|ice",
  "sessionId": "sess_...",
  "role": "requester|supporter",
  "description": {},
  "candidate": {}
}
```

Server responsibilities:
- Authenticate token.
- Validate session + role + support code.
- Route `signal` messages to opposite peer in same session.
- Emit optional `partner-ready` when both sides registered.
- Close stale/expired sessions.

## Session termination conditions

- Manual end by either peer.
- Active tab closed on being-supported side.
- WebRTC/signaling disconnect.
- Inactivity timeout (10 minutes).

## Temporary notices

- Background stores the last ended-session or transport warning in the tab-scoped inactive state so the next popup/support-page render can explain what happened.
- The popup remote-support cards and dedicated `/support` page render these temporary warnings with an icon-only dismiss button.
- Dismiss sends `remoteSupportDismissError`, clearing the active runtime error or inactive tab snapshot error in background state so the warning stays dismissed across refreshes.

## Security & correctness guarantees

### Extension-side telemetry

The Unfluffify Console and Network DevTools panels consume telemetry from popup/side-panel, content script, injected page-world bridge, and service worker contexts. Each context installs `installExtensionTelemetry()` and forwards its own `console`, `fetch`, and XHR activity through the background relay with a clear source label.

### `includePayloads` gating (three-layer defence)

1. **Telemetry helper** – starts with payload capture disabled and only reads request/response bodies when the current extension context reports `includePayloads: true`.
2. **Background** – `handleExtensionTelemetry()` relays extension telemetry locally to the DevTools panels and, for active requester sessions, forwards a runtime-sanitized copy to the remote peer.
3. **Remote relay** – payload strings are clamped via `clampPayloadSize`, and the total `REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES` budget is enforced before calling `sendDataMessage()`.

### DOM XSS prevention in DevTools panels

Both DevTools panels (`remote-console.js`, `remote-network.js`) build all rows and cells using `document.createElement` and `textContent` exclusively. No `innerHTML` interpolation of data received from the remote peer is performed.

### DevTools checkbox sync

The "Include payloads" checkbox in the network panel is synchronised with the actual session state on port connect via the `remoteSupportStateChanged` message, is disabled when the panel is not in `supporting` mode, and is the single source of truth for `includePayloads`. The popup no longer exposes a second checkbox or writes this state.

### Safe object URL revocation

`downloadPayload()` defers `URL.revokeObjectURL` via `setTimeout(..., 0)` to guarantee the browser has initiated the download before the object URL is torn down.

### View-only surface guards

Supporter-side surfaces render the shared Chrome window and media guidance previews without forwarding `mousemove`, `click`, `wheel`, or `keydown` commands. Background also rejects legacy `remoteSupportSendCommand` and `remoteSupportSetControlOwner` messages so stale UI cannot regain remote-control capability.

### True UTF-8 byte clamping

`clampPayloadSize(value, maxBytes)` (in `common/remote-support.js`) uses `TextEncoder` and a binary search to find the longest prefix of `value` whose **UTF-8 byte length** fits within `maxBytes`, correctly handling multibyte characters.
