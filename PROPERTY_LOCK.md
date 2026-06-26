# Property Lock Contract

This document is the extension-side source of truth for property edit locking.
Do not change this contract unless a task explicitly asks for property-lock
behavior changes, and update `README.md`, `PROPERTY_LOCK.md`, and the focused
property-lock tests in the same commit.

## Ownership Model

- The content script connects to the property-lock background service as soon as
  the current page resolves to a Live Page candidate property.
- The connection stays alive while that tab remains on a candidate page for the
  same property.
- Landing on an eligible Live Page queues the editor claim immediately for that
  extension page session; claiming the editor role no longer waits for marking
  mode to be enabled.
- The lock identity is a stable page-session client ID stored in
  `sessionStorage`, not the Chrome tab ID. Chrome tab IDs can be used only as a
  local routing hint for popup commands.
- A duplicated or cloned tab copies that `sessionStorage` value, so the
  extension must rotate the new tab onto a fresh client ID before lock state,
  popup routing, or observer/editor decisions are derived from it.
- The first page-session client that lands on an eligible Live Page candidate
  property requests the lock and becomes the editor when the server grants it.
- Every other page-session client for the same property is passive and must
  show the locked UI, even when it belongs to the same authenticated user.

## Same-User Tabs

If the current user already edits the property in another tab, the passive tab
shows:

`You are already editing this property in another tab`

When the active editor tab has no unsaved changes, the passive tab can use
`Continue editing here` to transfer the local editor session to itself. When the
active editor tab has unsaved changes, that action is disabled, the UI shows
`Other tab has unsaved changes`, and `Continue editing here anyway` transfers
the editor session while discarding the previous tab's unsaved local draft.

## Heartbeat And Release Windows

- Editor heartbeats are sent every 30 seconds while the editor has interacted
  with the page in the last 30 minutes.
- If there is no page interaction for 30 minutes, heartbeats stop and the editor
  is expected to lose the lock after the server's warning window.
- If the editor loses connectivity, the editor sees a 70 second countdown saying
  that the editor role will be lost unless the connection recovers.
- If the editor stays on a same-property page that is no longer a current Live
  Page candidate, the editor sees a 70 second countdown saying that the editor
  role will be lost unless they return to a candidate page. When that timer
  expires, the extension sends `release_lock` for the current editor session.
- If the editor navigates to a different property's page, the current tab keeps
  the previous property's editor session in a 30 second recovery window. The
  new page and the popup both warn that the editor must return to the previous
  property before the cooldown expires, or the extension sends `release_lock`
  for that previous property session by stored `siteId` + `clientId`.
- Render Mode inspection reloads are expected, short-lived page reloads. During
  that inspection window the editor should see a reconnecting-after-inspection
  status instead of the 70 second connection-loss countdown. After the page is
  re-injected, the popup explicitly re-claims the property lock, then polls the
  lock snapshot until the connection returns to connected/inactive.
- If the editor tab closes, the background immediately sends `release_lock`
  for that tab's editor runtime and disposes the connection instead of waiting
  for the ordinary 70 second port-disconnect grace window.
- During the last 60 seconds before release, passive subscribers see a countdown
  saying that the property will be released for editing. If the editor recovers,
  the passive UI returns to the ordinary locked banner.

The extension checks connectivity through the WebSocket and independent stable
HTTP endpoints. WebSocket state alone is not the sole network signal.

When the popup is open during the off-candidate warning, it mirrors the same
countdown from tab-scoped initial state so reopening the popup during the
warning still shows the remaining time.

The same tab-scoped initial state also carries the cross-property recovery
session metadata (`siteId`, `baseUrl`, `clientId`, and cooldown deadline), so a
return to the original property within the 30 second window can restore the
same editor session instead of creating a new one.

## Takeover Flow

Passive subscribers see `Suggest to take over`. The editor sees the sender's
name with accept and reject actions.

Rejecting the suggestion notifies the requester that the editor prefers to
continue editing. Accepting with unsaved changes asks the editor whether to save
and sync first or discard the local draft. Saving must complete the backend sync
and reload reconciliation before the transfer is accepted.

During transfer, both parties see a locked transfer state:

`Editing is being transferred from User A to User B`

After transfer, the new editor sees a normal editor state and a toast confirming
that they are now the editor. The previous editor becomes passive and sees the
new editor on the lock banner.

## Data Freshness

The current editor's page session is the single source of truth. Ordinary
periodic remote loads must not replace the editor's local draft. When a passive
tab becomes the editor, the popup fetches the latest upstream property payload
once and fully replaces that tab's local property data before editing continues.
After that bootstrap load, the editor stops calling `/load` and local saves stay
authoritative until the explicit backend save completes.

Locked passive observers keep periodic remote loads enabled so extension status,
silent highlighting status, and saved property data can update while they wait.
That observer refresh runs at most once per minute. If a passive observer's
local property data is replaced by `/load`, the replacement is silent apart from
a short-lived toast saying the property data was updated from the server.

## Extension Lifecycle

If Chrome invalidates an old content-script context because the extension was
reloaded, updated, disabled, or otherwise replaced, the old page script must stop
property-lock reconnect work. `Extension context invalidated` is a terminal
extension lifecycle signal for that script instance: clear reconnect timers,
disconnect any local port without notifying the background, reset the local lock
UI, and wait for a fresh content-script instance rather than retrying Chrome
extension APIs from the invalidated context.

Ordinary unexpected port disconnects are different. They should still reset the
local UI and schedule a reconnect so transient service-worker or WebSocket
interruptions recover automatically.

## Regression Tests

The focused guard tests are:

- `tests/property-lock.test.ts`
- `tests/property-lock-background.test.ts`
- `tests/property-lock-render-mode.test.ts`
- `tests/utilities-runtime.test.ts`

They cover stable client IDs, same-user passive locks, heartbeat/release timing,
navigation grace, cloned-tab client rotation, command routing,
extension-context invalidation handling, and source-level guards that prevent
lock acquisition from drifting away from the eligible-page connection flow.
