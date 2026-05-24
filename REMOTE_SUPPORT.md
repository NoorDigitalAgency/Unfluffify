# Remote Support (WebRTC) Design and Endpoint Contract

This document defines the extension-side remote support implementation and the expected backend contracts for `/request-support`, `/support`, and `/webrtc`.

## Implemented extension behavior

- Remote support uses a WebRTC `RTCPeerConnection` + `DataChannel`.
- Two fixed roles:
  - **Requester** → becomes **being_supported**.
  - **Supporter** (joins with support code) → becomes **supporting**.
- Session modes:
  - `inactive`
  - `being_supported`
  - `supporting`
- Session ends when either side terminates, the tab closes, or inactivity timeout is reached.
- Inactivity timeout: **7 minutes** without remote activity.
- Active tab only.
- Being-supported mode blocks local extension-owned interactions on page UI.
- Supporting mode disables regular popup controls and uses remote control surface.

## Realtime streams

### 1) Frame stream (preview)

- Being-supported side captures visible tab frames (`chrome.tabs.captureVisibleTab`) every ~250ms.
- Frames are sent over WebRTC data channel (`type: frame`).
- Supporting side renders the latest frame in popup control surface.

### 2) Remote commands

- Supporting side sends commands over data channel (`type: command`):
  - `pointer-move` with normalized x/y
  - `pointer-click` with normalized x/y + button
  - `scroll` with deltaX/deltaY
  - `key` with key/code/modifiers
- Being-supported side replays commands against extension-owned interactions.

### 3) Telemetry stream

- Console and AJAX telemetry is collected in page context and forwarded to background.
- Web request metadata is captured via `chrome.webRequest`.
- Support side receives telemetry over data channel and displays it in DevTools panels.

## DevTools panels

Two extension DevTools panels are added:

1. **Unfluffify Console**
   - Shows streamed console events with level + timestamp.

2. **Unfluffify Network**
   - Shows url, status code, method, type, timestamps, load time.
   - Includes **Include AJAX payloads** toggle.
   - Per-row payload download button (icon-only) when payload exists.

## Payload policy

- AJAX payload streaming includes request and response payloads.
- Per-payload clamp: **2MB**.
- Total payload budget per active session: **10MB**.
- Non-AJAX requests stream metadata only.

## Expected backend contract

> Auth: Bearer JWT in `Authorization` header for HTTP. For websocket, token can be passed in `?token=...`.

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
  "webrtcWsUrl": "wss://api.example.com/webrtc?token=..."
}
```

Notes:
- `supportCode` should be valid for initiation for ~10 minutes.
- If `webrtcWsUrl` is omitted, extension falls back to `<config-endpoint>/webrtc?token=...`.

### POST `/support`

Used by supporter side with support code.

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
  "webrtcWsUrl": "wss://api.example.com/webrtc?token=..."
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
- Inactivity timeout (7 minutes).

## Security & correctness guarantees

### Telemetry bridge activation

`installRemoteSupportTelemetryBridge()` is only called when the content-script session mode transitions to `being_supported`. No `console`/`fetch`/XHR monkey-patching is applied on pages that never host an active support session.

### Nonce-based message authentication

When the telemetry bridge is installed, a 16-byte cryptographically random nonce (generated via `crypto.getRandomValues`) is embedded in the injected page script and included in every `postMessage`. The content script validates `data.nonce` before processing any telemetry message. An Array-type guard and a 65 536-byte JSON size cap are also enforced.

### `includePayloads` gating (three-layer defence)

1. **Page hook** – starts with `let includePayloads = false` and only reads request/response bodies when a `unfluffify:remote-support:control` message from the content script sets the flag to `true`.
2. **Content script** – `sendRemoteTelemetryEntry` strips `entry.payload` as a backstop when `remoteSupportIncludePayloads` is `false`.
3. **Background** – `handleTelemetryFromContent()` strips `entry.payload` when `sessionState.includePayloads` is `false`, clamps individual payload strings via `clampPayloadSize`, and enforces the total `REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES` budget before calling `sendDataMessage()`.

### DOM XSS prevention in DevTools panels

Both DevTools panels (`remote-console.js`, `remote-network.js`) build all rows and cells using `document.createElement` and `textContent` exclusively. No `innerHTML` interpolation of data received from the remote peer is performed.

### DevTools checkbox sync

The "Include payloads" checkbox in the network panel is synchronised with the actual session state on port connect via the `remoteSupportStateChanged` message, and is disabled when the panel is not in `supporting` mode.

### Safe object URL revocation

`downloadPayload()` defers `URL.revokeObjectURL` via `setTimeout(..., 0)` to guarantee the browser has initiated the download before the object URL is torn down.

### Remote control surface guards

All four surface event handlers (`mousemove`, `click`, `wheel`, `keydown`) check `remoteSupportControlDisabled` before forwarding commands to the background. `keydown` calls `event.preventDefault()` unconditionally so no default browser key binding fires while the surface has focus.

### True UTF-8 byte clamping

`clampPayloadSize(value, maxBytes)` (in `common/remote-support.js`) uses `TextEncoder` and a binary search to find the longest prefix of `value` whose **UTF-8 byte length** fits within `maxBytes`, correctly handling multibyte characters.
